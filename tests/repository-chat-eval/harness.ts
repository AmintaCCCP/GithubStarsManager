import type { AIConfig, Repository } from '../../src/types';
import type {
  RepositoryChatMessage,
  RepositoryChatSession,
  RepositoryChatTurnMetrics,
  ToolEvidence,
} from '../../src/types/repositoryChat';
import {
  resolveRepositoryChatHeadSha,
  runEvidenceDrivenRepositoryChatTurn,
  type ChatToolEventInput,
} from '../../src/services/repositoryChatService';

export interface EvalCase {
  id: string;
  repo: string;
  question: string;
  language: 'zh' | 'en';
  /** Distinct files the answer must cite (path without leading slash). */
  expectedSources?: string[];
  /** Keywords or commands that must appear in the answer. */
  mustInclude?: string[];
  /** Commands that must appear inside a fenced code block, i.e. as a runnable step. */
  mustIncludeInCode?: string[];
  /** Regexes that must not appear in the answer. */
  mustNotMatch?: string[];
  maxChars?: number;
  /** Maximum occurrences of a single citation token. */
  maxCitationRepeats?: number;
  /** Expected answer path: README fast path vs. full evidence loop. */
  fastPath?: boolean;
  maxLlmCalls?: number;
  maxRounds?: number;
  /** Follow-up turns sent after the first answer in the same session. */
  followUps?: Array<{ question: string; mustInclude?: string[]; mustIncludeInCode?: string[]; mustNotMatch?: string[] }>;
}

export interface EvalResult {
  caseId: string;
  repo: string;
  sha: string;
  content: string;
  evidences: ToolEvidence[];
  metrics: RepositoryChatTurnMetrics | null;
  toolEvents: ChatToolEventInput[];
  failures: string[];
  answers: string[];
}

export const createEvalRepository = (fullName: string): Repository => {
  const [owner, name] = fullName.split('/');
  return {
    id: 0,
    name,
    full_name: fullName,
    description: null,
    html_url: `https://github.com/${fullName}`,
    stargazers_count: 0,
    forks_count: 0,
    forks: 0,
    language: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    pushed_at: '2026-01-01T00:00:00.000Z',
    owner: { login: owner, avatar_url: `https://github.com/${owner}.png` },
    topics: [],
  };
};

const userMessage = (sessionId: string, content: string, createdAt: string): RepositoryChatMessage => ({
  id: `user-${createdAt}`,
  sessionId,
  role: 'user',
  content,
  status: 'complete',
  evidenceIds: [],
  createdAt,
});

const assistantMessage = (sessionId: string, content: string, createdAt: string, evidenceIds: string[]): RepositoryChatMessage => ({
  id: `assistant-${createdAt}`,
  sessionId,
  role: 'assistant',
  content,
  status: 'complete',
  evidenceIds,
  createdAt,
});

export interface RunTurnOptions {
  githubToken: string;
  aiConfig: AIConfig;
  /** Pre-resolved pinned SHA; resolved from GitHub when omitted. */
  sha?: string;
  messages?: RepositoryChatMessage[];
  onChunk?: (fullText: string) => void;
  signal?: AbortSignal;
}

export const runEvalTurn = async (
  evalCase: EvalCase,
  question: string,
  options: RunTurnOptions,
  languageOverride?: 'zh' | 'en',
) => {
  const repository = createEvalRepository(evalCase.repo);
  const sha = options.sha ?? await resolveRepositoryChatHeadSha(repository, options.githubToken);
  const createdAt = new Date().toISOString();
  const messages = [
    ...(options.messages ?? []),
    userMessage(`eval-${evalCase.id}`, question, createdAt),
  ];
  const session: RepositoryChatSession = {
    id: `eval-${evalCase.id}`,
    repoId: repository.id,
    repoFullName: repository.full_name,
    sourceRefSha: sha,
    title: evalCase.id,
    createdAt,
    updatedAt: createdAt,
  };
  const toolEvents: ChatToolEventInput[] = [];
  const evidences: ToolEvidence[] = [];
  const result = await runEvidenceDrivenRepositoryChatTurn({
    repository,
    session,
    messages,
    question,
    githubToken: options.githubToken,
    aiConfig: options.aiConfig,
    language: languageOverride ?? evalCase.language,
    maxToolsPerTurn: 12,
    taskDepth: 'default',
    streaming: Boolean(options.onChunk),
    onAnswerChunk: options.onChunk,
    onToolEvent: (event) => toolEvents.push(event),
    onEvidence: (newEvidence) => evidences.push(...newEvidence),
    signal: options.signal,
  });
  return {
    content: result.content,
    evidences: result.evidences.length > 0 ? result.evidences : evidences,
    sha,
    toolEvents,
    messages: [...messages, assistantMessage(session.id, result.content, new Date().toISOString(), result.evidences.map((evidence) => evidence.id))],
  };
};

const CITATION = /`(\/[^`\n]+? - \d+(?:\s*-\s*\d+)?)`/g;
// 区间分隔符必须是独立的 " - "，否则 ADR-20260828-obtain… 这类路径会被误判。
// 第二条备选规则抓结束行号后直接跟字母的引用（`/README.md - 1-24abc`），它既
// 不被 CITATION 认成有效引用，也不会被第一条规则标记为错误。
// 第三条规则单独抓三段行号（`1-24-3`）：若把 `-\d` 放进第二条的可选范围之后，
// 正则会在 `1-68` 上回溯成“行号 1 + 尾随 -6”，把合法的连字符路径误判为错误。
const MALFORMED_CITATION = /`\/[^`\n]*\s+-\s*\d+\s*-\s*[^\d\s`][^`\n]*`|`\/[^`\n]+? - \d+(?:\s*-\s*\d+)?(?:-\D|\s+[^\d\s`-]|[^\d\s`-])[^`\n]*`|`\/[^`\n]+? - \d+-\d+-\d+[^`\n]*`|`\/[^`\n]+? - \d+(?:\s*-\s*\d+){2,}[^`\n]*`/g;

export const citationTokens = (content: string): string[] => Array.from(content.matchAll(CITATION), (match) => match[1]);

export const malformedCitations = (content: string): string[] => Array.from(content.matchAll(MALFORMED_CITATION), (match) => match[0]);

export const turnMetrics = (events: ChatToolEventInput[]): RepositoryChatTurnMetrics | null => {
  const detail = events.filter((event) => event.toolName === 'turn_metrics').at(-1)?.detail;
  if (!detail) return null;
  try {
    return JSON.parse(detail) as RepositoryChatTurnMetrics;
  } catch {
    return null;
  }
};

export const evaluateAnswer = (evalCase: EvalCase, answer: string): string[] => {
  const failures: string[] = [];
  for (const keyword of evalCase.mustInclude ?? []) {
    if (!answer.toLowerCase().includes(keyword.toLowerCase())) failures.push(`missing "${keyword}"`);
  }
  const code = Array.from(answer.matchAll(/```[^\n]*\n([\s\S]*?)```/g), (match) => match[1]).join('\n');
  for (const keyword of evalCase.mustIncludeInCode ?? []) {
    if (!code.includes(keyword)) failures.push(`"${keyword}" is not a runnable step`);
  }
  // 行内代码是调用语法（`start()`），不是被清理掉的空引用括号；只遮蔽空参调用，
  // 带参数或自然语言的代码片段照常参与禁用词检查。
  const prose = answer.replace(/`[\p{L}\p{N}_.#$-]*\(\s*\)`/gu, 'CODE');
  for (const pattern of evalCase.mustNotMatch ?? []) {
    if (new RegExp(pattern, 'i').test(prose)) failures.push(`unexpected /${pattern}/`);
  }
  if (evalCase.maxChars && answer.length > evalCase.maxChars) {
    failures.push(`answer too long: ${answer.length} > ${evalCase.maxChars}`);
  }
  if (evalCase.maxCitationRepeats) {
    const counts = new Map<string, number>();
    for (const token of citationTokens(answer)) counts.set(token, (counts.get(token) ?? 0) + 1);
    const worst = Math.max(0, ...counts.values());
    if (worst > evalCase.maxCitationRepeats) {
      failures.push(`citation repeated ${worst} times (max ${evalCase.maxCitationRepeats})`);
    }
  }
  // 方案 §2.3 / §7：回答不得出现“未证实”小节。
  if (/Unverified or missing information|未证实或缺失的信息/.test(answer)) {
    failures.push('contains an unverified section');
  }
  if (evalCase.expectedSources?.length) {
    const citedPaths = new Set(citationTokens(answer).map((token) => token.split(' - ')[0].replace(/^\//, '')));
    const missing = evalCase.expectedSources.filter((source) => !citedPaths.has(source));
    if (missing.length > 0) failures.push(`uncited sources: ${missing.join(', ')}`);
  }
  const malformed = malformedCitations(answer);
  if (malformed.length > 0) {
    failures.push(`malformed citations: ${malformed.join(', ')}`);
  }
  const standaloneCitationLines = answer
    .split('\n')
    .filter((line) => line.trim() !== '' && line.trim().replace(new RegExp(CITATION.source, 'g'), '').trim() === '')
    .length;
  if (standaloneCitationLines > 0) failures.push(`${standaloneCitationLines} standalone citation line(s)`);
  return failures;
};

export const runEvalCase = async (
  evalCase: EvalCase,
  options: RunTurnOptions,
): Promise<EvalResult> => {
  const failures: string[] = [];
  const answers: string[] = [];
  const first = await runEvalTurn(evalCase, evalCase.question, options);
  answers.push(first.content);
  const metrics = turnMetrics(first.toolEvents);
  failures.push(...evaluateAnswer(evalCase, first.content));
  if (evalCase.fastPath !== undefined && metrics && metrics.fastPath !== evalCase.fastPath) {
    failures.push(`fastPath=${metrics.fastPath}, expected ${evalCase.fastPath}`);
  }
  if (evalCase.maxLlmCalls && metrics && metrics.llmCalls > evalCase.maxLlmCalls) {
    failures.push(`llmCalls=${metrics.llmCalls} > ${evalCase.maxLlmCalls}`);
  }
  if (evalCase.maxRounds && metrics && metrics.rounds > evalCase.maxRounds) {
    failures.push(`rounds=${metrics.rounds} > ${evalCase.maxRounds}`);
  }
  let messages = first.messages;
  for (const followUp of evalCase.followUps ?? []) {
    const next = await runEvalTurn(evalCase, followUp.question, { ...options, sha: first.sha, messages });
    answers.push(next.content);
    messages = next.messages;
    for (const keyword of followUp.mustInclude ?? []) {
      if (!next.content.toLowerCase().includes(keyword.toLowerCase())) failures.push(`follow-up missing "${keyword}"`);
    }
    failures.push(...evaluateAnswer({
      ...evalCase,
      mustInclude: [],
      mustIncludeInCode: followUp.mustIncludeInCode,
      mustNotMatch: followUp.mustNotMatch,
      followUps: [],
    }, next.content));
  }
  return {
    caseId: evalCase.id,
    repo: evalCase.repo,
    sha: first.sha,
    content: first.content,
    evidences: first.evidences,
    metrics,
    toolEvents: first.toolEvents,
    failures,
    answers,
  };
};

export const toMarkdownReport = (results: EvalResult[], meta: Record<string, string>): string => {
  const lines = [
    '# Repository chat eval report',
    '',
    ...Object.entries(meta).map(([key, value]) => `- ${key}: ${value}`),
    '',
    `Cases: ${results.length} · passed: ${results.filter((result) => result.failures.length === 0).length}`,
    '',
  ];
  for (const result of results) {
    const metrics = result.metrics;
    // 回答里通常有 ```bash 等围栏，外层围栏必须比其中最长的反引号序列更长，
    // 否则会提前闭合，把后续标题吞进代码块。
    const fence = '`'.repeat(Math.max(3, ...(result.content.match(/`+/g) ?? []).map((run) => run.length + 1)));
    lines.push(
      `## ${result.failures.length === 0 ? 'PASS' : 'FAIL'} ${result.caseId} (${result.repo})`,
      '',
      `- sha: \`${result.sha}\``,
      `- llmCalls: ${metrics?.llmCalls ?? 'n/a'} · toolCalls: ${metrics?.toolCalls ?? 'n/a'} · rounds: ${metrics?.rounds ?? 'n/a'} · fastPath: ${metrics?.fastPath ?? 'n/a'} · endReason: ${metrics?.endReason ?? 'n/a'}`,
      `- totalMs: ${metrics?.totalMs ?? 'n/a'}${metrics?.ttftMs !== undefined ? ` · ttftMs: ${metrics.ttftMs}` : ''}`,
      `- answer chars: ${result.content.length} · citations: ${citationTokens(result.content).length}`,
      ...(result.failures.length > 0 ? ['', 'Failures:', ...result.failures.map((failure) => `- ${failure}`)] : []),
      '',
      `${fence}markdown`,
      result.content.slice(0, 4_000),
      fence,
      '',
    );
  }
  return lines.join('\n');
};
