import { getDb } from '../db/connection.js';
import { decrypt } from './crypto.js';
import { config } from '../config.js';
import { proxyRequest } from './proxyService.js';

// ── Types ──

interface AnalysisBatch {
  batchId: string;
  repositoryIds: number[];
  configId: string;
  language: string;
  categoryNames: string[];
  status: 'running' | 'completed' | 'cancelled' | 'failed';
  total: number;
  completed: number;
  failed: number;
  startedAt: string;
  completedAt: string | null;
  cancelRequested: boolean;
}

interface RepoInfo {
  id: number;
  full_name: string;
  name: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  topics: string | null;
  owner_login: string;
}

// ── In-memory state ──

const batches = new Map<string, AnalysisBatch>();
const BATCH_TTL_MS = 60 * 60 * 1000; // 1 hour

function cleanupBatches(): void {
  const now = Date.now();
  for (const [id, batch] of batches) {
    if (batch.status !== 'running' && batch.completedAt) {
      if (now - new Date(batch.completedAt).getTime() > BATCH_TTL_MS) {
        batches.delete(id);
      }
    }
  }
}

setInterval(cleanupBatches, 10 * 60 * 1000); // every 10 minutes

function generateId(): string {
  return `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── Public API ──

export function createBatch(
  repositoryIds: number[],
  configId: string,
  language: string,
  categoryNames: string[],
): AnalysisBatch {
  const batch: AnalysisBatch = {
    batchId: generateId(),
    repositoryIds,
    configId,
    language,
    categoryNames,
    status: 'running',
    total: repositoryIds.length,
    completed: 0,
    failed: 0,
    startedAt: new Date().toISOString(),
    completedAt: null,
    cancelRequested: false,
  };
  batches.set(batch.batchId, batch);

  // Fire and forget — don't await
  runBatch(batch.batchId).catch((err) => {
    console.error(`[analysis] Batch ${batch.batchId} failed:`, err);
    const b = batches.get(batch.batchId);
    if (b && b.status === 'running') {
      b.status = 'failed';
      b.completedAt = new Date().toISOString();
    }
  });

  return batch;
}

export function getBatchStatus(batchId: string): AnalysisBatch | undefined {
  return batches.get(batchId);
}

export function cancelBatch(batchId: string): boolean {
  const batch = batches.get(batchId);
  if (!batch || batch.status !== 'running') return false;
  batch.cancelRequested = true;
  batch.status = 'cancelled';
  batch.completedAt = new Date().toISOString();
  return true;
}

// ── Core execution ──

async function runBatch(batchId: string): Promise<void> {
  const batch = batches.get(batchId);
  if (!batch) return;

  const db = getDb();
  const aiConfig = db.prepare('SELECT * FROM ai_configs WHERE id = ?').get(batch.configId) as Record<string, unknown> | undefined;
  if (!aiConfig) {
    batch.status = 'failed';
    batch.completedAt = new Date().toISOString();
    return;
  }

  const concurrency = Math.max(1, Math.min((aiConfig.concurrency as number) || 1, 10));

  const queue = [...batch.repositoryIds];
  let activeWorkers = 0;

  const processNext = async (): Promise<void> => {
    while (true) {
      if (batch.cancelRequested) return;

      const repoId = queue.shift();
      if (repoId === undefined) return;

      activeWorkers++;
      try {
        await processRepository(batch, repoId, aiConfig);
        batch.completed++;
      } catch (err) {
        console.error(`[analysis] Failed to analyze repo ${repoId}:`, err);
        batch.failed++;
      } finally {
        activeWorkers--;
      }
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, () => processNext());
  await Promise.all(workers);

  if (!batch.cancelRequested) {
    batch.status = 'completed';
    batch.completedAt = new Date().toISOString();
  }
}

async function processRepository(
  batch: AnalysisBatch,
  repoId: number,
  aiConfig: Record<string, unknown>,
): Promise<void> {
  if (batch.cancelRequested) return;

  const db = getDb();
  const repo = db.prepare('SELECT id, full_name, name, description, language, stargazers_count, topics, owner_login FROM repositories WHERE id = ?').get(repoId) as RepoInfo | undefined;
  if (!repo) {
    markAnalysisFailed(repoId);
    return;
  }

  // 1. Fetch README
  let readmeContent = '';
  try {
    readmeContent = await fetchReadme(repo.owner_login, repo.name);
  } catch {
    // README fetch failure is not fatal — analyze without it
  }

  // 2. Build prompt
  const customPrompt = aiConfig.custom_prompt as string | undefined;
  const useCustomPrompt = !!(aiConfig.use_custom_prompt as number);
  const language = batch.language;

  const prompt = useCustomPrompt && customPrompt
    ? buildCustomPrompt(customPrompt, repo, readmeContent, batch.categoryNames, language)
    : buildAnalysisPrompt(repo, readmeContent, batch.categoryNames, language);

  // 3. Call AI
  const systemPrompt = language === 'zh'
    ? '你是一个专业的GitHub仓库分析助手。请严格按照用户指定的语言进行分析，无论原始内容是什么语言。请用中文简洁地分析仓库，提供实用的概述、分类标签和支持的平台类型。'
    : 'You are a professional GitHub repository analysis assistant. Please strictly analyze in the language specified by the user, regardless of the original content language. Please analyze repositories concisely in English, providing practical overviews, category tags, and supported platform types.';

  try {
    const content = await callAI(aiConfig, systemPrompt, prompt);
    const result = parseAIResponse(content, language);

    db.prepare(`
      UPDATE repositories
      SET ai_summary = ?, ai_tags = ?, ai_platforms = ?, analyzed_at = ?, analysis_failed = 0
      WHERE id = ?
    `).run(
      result.summary,
      JSON.stringify(result.tags),
      JSON.stringify(result.platforms),
      new Date().toISOString(),
      repoId,
    );
  } catch (err) {
    console.error(`[analysis] AI call failed for repo ${repoId}:`, err);
    markAnalysisFailed(repoId);
  }
}

function markAnalysisFailed(repoId: number): void {
  const db = getDb();
  db.prepare('UPDATE repositories SET analyzed_at = ?, analysis_failed = 1 WHERE id = ?').run(
    new Date().toISOString(),
    repoId,
  );
}

// ── README fetching ──

async function fetchReadme(owner: string, repo: string): Promise<string> {
  const db = getDb();
  const tokenRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('github_token') as { value: string } | undefined;
  let token = '';
  if (tokenRow?.value) {
    try {
      token = decrypt(tokenRow.value, config.encryptionKey);
    } catch {
      // token decryption failed, proceed without auth
    }
  }

  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'GithubStarsManager',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const result = await proxyRequest({
    url: `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/readme`,
    method: 'GET',
    headers,
    timeout: 15000,
  });

  if (result.status !== 200 || !result.data) {
    throw new Error(`GitHub README fetch failed: ${result.status}`);
  }

  const data = result.data as { encoding?: string; content?: string };
  if (data.encoding === 'base64' && data.content) {
    return Buffer.from(data.content, 'base64').toString('utf-8');
  }
  return data.content || '';
}

// ── AI API call ──

function buildApiUrl(baseUrl: string, pathWithVersion: string): string {
  const baseUrlWithSlash = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  try {
    return new URL(pathWithVersion, baseUrlWithSlash).toString();
  } catch {
    return `${baseUrlWithSlash}${pathWithVersion}`;
  }
}

async function callAI(
  aiConfig: Record<string, unknown>,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const apiKey = decrypt(aiConfig.api_key_encrypted as string, config.encryptionKey);
  const apiType = (aiConfig.api_type as string) || 'openai';
  const baseUrl = aiConfig.base_url as string;
  const model = aiConfig.model as string;
  const reasoningEffort = aiConfig.reasoning_effort === 'minimal'
    ? 'low'
    : aiConfig.reasoning_effort as string | null | undefined;

  let targetUrl: string;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
  let requestBody: Record<string, unknown>;

  if (apiType === 'claude') {
    targetUrl = buildApiUrl(baseUrl, 'v1/messages');
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
    requestBody = {
      model,
      max_tokens: 700,
      temperature: 0.3,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    };
  } else if (apiType === 'gemini') {
    const rawModel = model.trim();
    const modelName = rawModel.startsWith('models/') ? rawModel.slice('models/'.length) : rawModel;
    const path = `v1beta/models/${encodeURIComponent(modelName)}:generateContent`;
    targetUrl = buildApiUrl(baseUrl, path);
    const urlObj = new URL(targetUrl);
    urlObj.searchParams.set('key', apiKey);
    targetUrl = urlObj.toString();
    requestBody = {
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 700 },
      systemInstruction: { parts: [{ text: systemPrompt }] },
    };
  } else {
    // openai / openai-responses / openai-compatible
    targetUrl = apiType === 'openai-compatible'
      ? baseUrl.replace(/\/$/, '')
      : buildApiUrl(baseUrl, apiType === 'openai-responses' ? 'v1/responses' : 'v1/chat/completions');
    headers['Authorization'] = `Bearer ${apiKey}`;
    requestBody = {
      model,
      temperature: 0.3,
      max_tokens: 700,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    };
    if (reasoningEffort && (apiType === 'openai' || apiType === 'openai-responses' || apiType === 'openai-compatible')) {
      (requestBody as Record<string, unknown>).reasoning = { effort: reasoningEffort };
    }
  }

  const timeout = apiType === 'openai-responses' || !!reasoningEffort ? 600000 : 120000;

  const result = await proxyRequest({
    url: targetUrl,
    method: 'POST',
    headers,
    body: requestBody,
    timeout,
  });

  if (result.status !== 200) {
    const errData = result.data as Record<string, unknown> | undefined;
    console.error(`[analysis] AI API error details:`, errData);
    const errorMsg = (errData?.error as Record<string, unknown>)?.message || errData?.message || 'Unknown error';
    throw new Error(`AI API returned ${result.status}: ${typeof errorMsg === 'string' ? errorMsg : 'Request failed'}`);
  }

  return extractTextContent(apiType, result.data as Record<string, unknown>);
}

function extractTextContent(apiType: string, data: Record<string, unknown>): string {
  if (apiType === 'claude') {
    const content = (data as { content?: Array<{ type: string; text: string }> }).content;
    if (content && content.length > 0) return content[0].text || '';
  } else if (apiType === 'gemini') {
    const candidates = (data as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }).candidates;
    if (candidates?.[0]?.content?.parts?.[0]?.text) return candidates[0].content.parts[0].text;
  } else if (apiType === 'openai-responses') {
    const outputText = (data as { output_text?: string }).output_text;
    if (outputText) return outputText;
    const output = (data as { output?: Array<{ content?: Array<{ text?: string }> }> }).output;
    if (Array.isArray(output)) {
      return output
        .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
        .map((part) => part?.text || '')
        .join('');
    }
  } else {
    // openai / openai-compatible
    const choices = (data as { choices?: Array<{ message?: { content?: string } }> }).choices;
    if (choices?.[0]?.message?.content) return choices[0].message.content;
  }
  return '';
}

// ── Prompt building (ported from aiService.ts) ──

function repoInfoString(repo: RepoInfo, readmeContent: string, language: string): string {
  const isZh = language === 'zh';
  return [
    `${isZh ? '仓库名称' : 'Repository Name'}: ${repo.full_name}`,
    `${isZh ? '描述' : 'Description'}: ${repo.description || (isZh ? '无描述' : 'No description')}`,
    `${isZh ? '编程语言' : 'Programming Language'}: ${repo.language || (isZh ? '未知' : 'Unknown')}`,
    `${isZh ? 'Star数' : 'Stars'}: ${repo.stargazers_count}`,
    `${isZh ? '主题标签' : 'Topics'}: ${(() => { try { return repo.topics ? JSON.parse(repo.topics).join(', ') : ''; } catch { return ''; } })() || (isZh ? '无' : 'None')}`,
    '',
    `${isZh ? 'README内容 (前2000字符)' : 'README Content (first 2000 characters)'}:`,
    readmeContent.substring(0, 2000),
  ].join('\n');
}

function categoriesInfoString(categoryNames: string[], language: string): string {
  if (categoryNames.length === 0) return '';
  const label = language === 'zh' ? '可用的应用分类' : 'Available Application Categories';
  return `\n\n${label}: ${categoryNames.join(', ')}`;
}

function buildCustomPrompt(
  customPrompt: string,
  repo: RepoInfo,
  readmeContent: string,
  categoryNames: string[],
  language: string,
): string {
  const repoInfo = repoInfoString(repo, readmeContent, language);
  const catsInfo = categoriesInfoString(categoryNames, language);
  return customPrompt
    .replace(/\{REPO_INFO\}/g, repoInfo)
    .replace(/\{CATEGORIES_INFO\}/g, catsInfo)
    .replace(/\{LANGUAGE\}/g, language);
}

function buildAnalysisPrompt(
  repo: RepoInfo,
  readmeContent: string,
  categoryNames: string[],
  language: string,
): string {
  const repoInfo = repoInfoString(repo, readmeContent, language);
  const catsInfo = categoriesInfoString(categoryNames, language);
  const catsHint = categoryNames.length > 0
    ? (language === 'zh' ? '，请优先从提供的分类中选择' : ', please prioritize from the provided categories')
    : '';

  if (language === 'zh') {
    return `
请分析这个GitHub仓库并提供：

1. 一个简洁的中文概述（不超过50字），说明这个仓库的主要功能和用途
2. 3-5个相关的应用类型标签（用中文，类似应用商店的分类，如：开发工具、Web应用、移动应用、数据库、AI工具等${catsHint}）
3. 支持的平台类型（从以下选择：mac、windows、linux、ios、android、docker、web、cli）

重要：请严格使用中文进行分析和回复，无论原始README是什么语言。

请以JSON格式回复：
{
  "summary": "你的中文概述",
  "tags": ["标签1", "标签2", "标签3", "标签4", "标签5"],
  "platforms": ["platform1", "platform2", "platform3"]
}

仓库信息：
${repoInfo}${catsInfo}

重点关注实用性和准确的分类，帮助用户快速理解仓库的用途和支持的平台。
    `.trim();
  }

  return `
Please analyze this GitHub repository and provide:

1. A concise English overview (no more than 50 words) explaining the main functionality and purpose of this repository
2. 3-5 relevant application type tags (in English, similar to app store categories, such as: development tools, web apps, mobile apps, database, AI tools, etc.${catsHint})
3. Supported platform types (choose from: mac, windows, linux, ios, android, docker, web, cli)

Important: Please strictly use English for analysis and response, regardless of the original README language.

Please reply in JSON format:
{
  "summary": "Your English overview",
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "platforms": ["platform1", "platform2", "platform3"]
}

Repository information:
${repoInfo}${catsInfo}

Focus on practicality and accurate categorization to help users quickly understand the repository's purpose and supported platforms.
  `.trim();
}

// ── Response parsing (ported from aiService.ts) ──

function parseAIResponse(content: string, language: string): { summary: string; tags: string[]; platforms: string[] } {
  try {
    const cleaned = content
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    const parsed = extractAndParseAIJson(cleaned);
    if (parsed) {
      return {
        summary: typeof parsed.summary === 'string' && parsed.summary.trim()
          ? parsed.summary.trim()
          : (language === 'zh' ? '无法生成概述' : 'Unable to generate summary'),
        tags: Array.isArray(parsed.tags) ? parsed.tags.filter((v) => typeof v === 'string').slice(0, 5) : [],
        platforms: Array.isArray(parsed.platforms) ? parsed.platforms.filter((v) => typeof v === 'string').slice(0, 8) : [],
      };
    }

    return {
      summary: cleaned.substring(0, 50) + (cleaned.length > 50 ? '...' : ''),
      tags: [],
      platforms: [],
    };
  } catch {
    return {
      summary: language === 'zh' ? '分析失败' : 'Analysis failed',
      tags: [],
      platforms: [],
    };
  }
}

function extractAndParseAIJson(content: string): Record<string, unknown> | null {
  const direct = tryParseJsonObject(content);
  if (direct) return direct;

  const start = content.indexOf('{');
  if (start === -1) return null;

  let inString = false;
  let escaped = false;
  let depth = 0;

  for (let i = start; i < content.length; i++) {
    const char = content[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === '{') depth++;
    if (char === '}') {
      depth--;
      if (depth === 0) {
        return tryParseJsonObject(content.slice(start, i + 1));
      }
    }
  }

  return null;
}

function tryParseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;

  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
