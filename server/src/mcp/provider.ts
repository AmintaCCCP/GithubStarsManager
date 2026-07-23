import { getDb } from '../db/connection.js';
import { decrypt } from '../services/crypto.js';
import { config } from '../config.js';
import { logger } from '../services/logger.js';
import {
  type McpRepository,
  type McpSearchFilters,
  projectRepoForAgent,
  searchRepositories,
} from './repoSearch.js';

function parseJsonColumn(value: unknown): unknown[] {
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function transformRepoRow(row: Record<string, unknown>): McpRepository {
  return {
    id: row.id as number,
    name: row.name as string,
    full_name: row.full_name as string,
    description: (row.description as string | null) ?? null,
    html_url: row.html_url as string,
    stargazers_count: (row.stargazers_count as number) ?? 0,
    language: (row.language as string | null) ?? null,
    created_at: (row.created_at as string | null) ?? null,
    updated_at: (row.updated_at as string | null) ?? null,
    pushed_at: (row.pushed_at as string | null) ?? null,
    starred_at: (row.starred_at as string | null) ?? null,
    owner: {
      login: (row.owner_login as string) ?? '',
      avatar_url: (row.owner_avatar_url as string) ?? '',
    },
    topics: parseJsonColumn(row.topics) as string[],
    ai_summary: (row.ai_summary as string | null) ?? null,
    ai_tags: parseJsonColumn(row.ai_tags) as string[],
    ai_platforms: parseJsonColumn(row.ai_platforms) as string[],
    analyzed_at: (row.analyzed_at as string | null) ?? null,
    analysis_failed: !!row.analysis_failed,
    custom_description: (row.custom_description as string | null) ?? null,
    custom_tags: parseJsonColumn(row.custom_tags) as string[],
    custom_category: (row.custom_category as string | null) ?? null,
    category_locked: !!row.category_locked,
    subscribed_to_releases: !!row.subscribed_to_releases,
  };
}

/** Soft cap to avoid unbounded memory if a DB ever holds extreme row counts. */
const MAX_REPOS_IN_MEMORY = 50_000;

export function loadAllRepositories(): McpRepository[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM repositories ORDER BY stargazers_count DESC LIMIT ?')
    .all(MAX_REPOS_IN_MEMORY) as Record<string, unknown>[];
  return rows.map(transformRepoRow);
}

export function getRepository(idOrFullName: string | number): McpRepository | null {
  const db = getDb();
  let row: Record<string, unknown> | undefined;
  if (typeof idOrFullName === 'number' || /^\d+$/.test(String(idOrFullName))) {
    row = db
      .prepare('SELECT * FROM repositories WHERE id = ?')
      .get(Number(idOrFullName)) as Record<string, unknown> | undefined;
  } else {
    row = db
      .prepare('SELECT * FROM repositories WHERE full_name = ? COLLATE NOCASE')
      .get(String(idOrFullName)) as Record<string, unknown> | undefined;
  }
  return row ? transformRepoRow(row) : null;
}

export function listCategories(): Array<Record<string, unknown>> {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM categories ORDER BY sort_order ASC, name ASC')
    .all() as Record<string, unknown>[];
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    keywords: parseJsonColumn(row.keywords),
    color: row.color,
    sort_order: row.sort_order,
  }));
}

export function searchRepos(filters: McpSearchFilters) {
  const all = loadAllRepositories();
  const { items, total } = searchRepositories(all, filters);
  return {
    total,
    count: items.length,
    offset: filters.offset ?? 0,
    limit: Math.min(100, Math.max(1, filters.limit ?? 20)),
    items: items.map((r) => projectRepoForAgent(r)),
  };
}

export function getStats() {
  const repos = loadAllRepositories();
  const byLanguage: Record<string, number> = {};
  const tagCounts: Record<string, number> = {};
  let analyzed = 0;
  let subscribed = 0;
  let failed = 0;

  for (const r of repos) {
    const lang = r.language || 'Unknown';
    byLanguage[lang] = (byLanguage[lang] || 0) + 1;
    if (r.analyzed_at && !r.analysis_failed) analyzed += 1;
    if (r.analyzed_at && r.analysis_failed) failed += 1;
    if (r.subscribed_to_releases) subscribed += 1;
    for (const tag of [...(r.ai_tags || []), ...(r.custom_tags || [])]) {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    }
  }

  const topTags = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([tag, count]) => ({ tag, count }));

  return {
    totalRepositories: repos.length,
    analyzed,
    analysisFailed: failed,
    unanalyzed: repos.length - analyzed - failed,
    subscribedToReleases: subscribed,
    byLanguage,
    topTags,
  };
}

export interface VectorAvailability {
  available: boolean;
  reason?: string;
  workerUrl?: string;
  embeddingModel?: string;
}

export function getVectorAvailability(): VectorAvailability {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM vector_search_configs WHERE id = ?')
    .get('default') as Record<string, unknown> | undefined;

  if (!row || !row.enabled) {
    return { available: false, reason: 'vector_search_disabled' };
  }
  const workerUrl = String(row.worker_url || '').trim();
  if (!workerUrl) {
    return { available: false, reason: 'worker_url_missing' };
  }
  const embeddingId = String(row.embedding_config_id || '').trim();
  if (!embeddingId) {
    return { available: false, reason: 'embedding_config_missing' };
  }
  const emb = db
    .prepare('SELECT * FROM embedding_configs WHERE id = ?')
    .get(embeddingId) as Record<string, unknown> | undefined;
  if (!emb) {
    return { available: false, reason: 'embedding_config_not_found' };
  }
  const hasKey = !!emb.api_key_encrypted || emb.api_type === 'ollama';
  if (!hasKey && emb.api_type !== 'ollama') {
    return { available: false, reason: 'embedding_api_key_missing' };
  }
  return {
    available: true,
    workerUrl,
    embeddingModel: String(emb.model || ''),
  };
}

const FETCH_TIMEOUT_MS = 15_000;

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = FETCH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Match app EmbeddingClient URL rules in vectorSearchService.ts:
 * - openai / siliconflow: `${baseUrl}/v1/embeddings` (baseUrl usually host without /v1)
 * - openai-compatible: baseUrl is the full embeddings endpoint
 * - ollama: `${baseUrl}/api/embed` with { model, input }
 */
async function embedQuery(
  texts: string[],
  emb: Record<string, unknown>
): Promise<number[]> {
  const apiType = String(emb.api_type || 'openai');
  const model = String(emb.model || '');
  let apiKey = '';
  if (emb.api_key_encrypted) {
    try {
      apiKey = decrypt(String(emb.api_key_encrypted), config.encryptionKey);
    } catch {
      throw new Error('Failed to decrypt embedding API key');
    }
  }

  const baseUrl = String(emb.base_url || '').replace(/\/+$/, '');
  let url: string;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  let body: Record<string, unknown>;

  if (apiType === 'ollama') {
    url = `${baseUrl || 'http://127.0.0.1:11434'}/api/embed`;
    body = { model, input: texts };
  } else if (apiType === 'gemini') {
    const root = baseUrl || 'https://generativelanguage.googleapis.com';
    url = `${root}/v1beta/models/${model}:batchEmbedContents?key=${encodeURIComponent(apiKey)}`;
    body = {
      requests: texts.map((t) => ({
        model: `models/${model}`,
        content: { parts: [{ text: t }] },
        taskType: 'RETRIEVAL_QUERY',
      })),
    };
  } else if (apiType === 'cohere') {
    url = `${baseUrl || 'https://api.cohere.com'}/v1/embed`;
    headers.Authorization = `Bearer ${apiKey}`;
    body = { model, texts, input_type: 'search_query' };
  } else if (apiType === 'openai-compatible') {
    if (!baseUrl) {
      throw new Error('openai-compatible base_url is required (full embeddings endpoint)');
    }
    url = baseUrl;
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    body = { model, input: texts };
  } else {
    // openai / siliconflow
    const root =
      baseUrl ||
      (apiType === 'siliconflow' ? 'https://api.siliconflow.cn' : 'https://api.openai.com');
    url = /\/v1$/i.test(root) ? `${root}/embeddings` : `${root}/v1/embeddings`;
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    body = { model, input: texts };
  }

  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Embedding API error ${res.status} (${apiType} ${url}): ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as Record<string, unknown>;

  if (apiType === 'ollama') {
    const embeddings = data.embeddings as number[][] | undefined;
    if (embeddings?.[0]) return embeddings[0];
    const embVec = data.embedding as number[] | undefined;
    if (embVec) return embVec;
    throw new Error('Ollama embedding missing');
  }
  if (apiType === 'gemini') {
    const batch = data.embeddings as Array<{ values?: number[] }> | undefined;
    if (batch?.[0]?.values) return batch[0].values;
    const embObj = data.embedding as { values?: number[] } | undefined;
    if (embObj?.values) return embObj.values;
    throw new Error('Gemini embedding missing');
  }
  if (apiType === 'cohere') {
    const embeddings = data.embeddings as number[][] | undefined;
    if (!embeddings?.[0]) throw new Error('Cohere embedding missing');
    return embeddings[0];
  }
  const list = data.data as Array<{ embedding: number[] }> | undefined;
  if (!list?.[0]?.embedding) throw new Error('OpenAI-compatible embedding missing');
  return list[0].embedding;
}

export async function vectorSearch(
  query: string,
  opts: { topK?: number; threshold?: number } = {}
): Promise<{ available: false; reason: string } | { available: true; matches: Array<Record<string, unknown>> }> {
  const availability = getVectorAvailability();
  if (!availability.available) {
    return { available: false, reason: availability.reason || 'unavailable' };
  }

  const db = getDb();
  const vs = db
    .prepare('SELECT * FROM vector_search_configs WHERE id = ?')
    .get('default') as Record<string, unknown>;
  const emb = db
    .prepare('SELECT * FROM embedding_configs WHERE id = ?')
    .get(String(vs.embedding_config_id)) as Record<string, unknown>;

  let workerToken = '';
  if (vs.auth_token_encrypted) {
    try {
      workerToken = decrypt(String(vs.auth_token_encrypted), config.encryptionKey);
    } catch (err) {
      logger.warn('mcp.vector', 'Failed to decrypt worker auth token');
      return { available: false, reason: 'worker_token_decrypt_failed' };
    }
  }

  const topK = Math.min(50, Math.max(1, opts.topK ?? 20));
  const threshold = opts.threshold ?? 0.35;

  let vector: number[];
  try {
    vector = await embedQuery([query], emb);
  } catch (err) {
    logger.warn('mcp.vector', 'Embedding failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { available: false, reason: `embedding_failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  const workerUrl = String(vs.worker_url).replace(/\/$/, '');
  const res = await fetchWithTimeout(`${workerUrl}/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(workerToken ? { Authorization: `Bearer ${workerToken}` } : {}),
    },
    body: JSON.stringify({ vector, topK, threshold }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { available: false, reason: `worker_query_failed: ${res.status} ${text.slice(0, 120)}` };
  }
  const data = (await res.json()) as {
    matches?: Array<{ id: string; score: number; metadata?: Record<string, unknown> }>;
  };
  const matches = data.matches || [];
  const repos = loadAllRepositories();
  const byId = new Map(repos.map((r) => [String(r.id), r]));

  const enriched = matches
    .map((m) => {
      const repo = byId.get(String(m.id));
      if (!repo) return null;
      return {
        score: m.score,
        ...projectRepoForAgent(repo),
      };
    })
    .filter(Boolean) as Array<Record<string, unknown>>;

  return { available: true, matches: enriched };
}
