/**
 * 发现页「仓库搜索」频道的 AI 语义搜索（全网仓库）。
 *
 * 三段式管道（参考仓库页"无向量 AI 搜索"，但候选池来自全网而非本地 star 列表）：
 * ① LLM 查询扩展（AIService.expandSearchQuery）→ {intent, terms}
 * ② grep.app 词法召回全网仓库：多个词的并集等价于一次 `(?:q|t1|t2…)` 正则交替
 *    查询（请求数 4→1，降低 429 风险与延迟），并在 Markdown 文档域优先召回
 *    （f.lang=Markdown：README/文档命中更能代表项目主题，避开全库代码搜索的
 *    变量名/泛词污染）。并集 facets 计数 ∝ 仓库文档量 × 词的泛化度，泛词会把
 *    无关大仓库刷进池顶、把真正相关的仓库挤出池子——因此追加一路"高具体性"
 *    正则（CJK 词 / 长多词短语单独成查），其命中仓库在池内排序优先于仅命中
 *    泛词的仓库。失败/零命中时逐词 fuzzy 回退（≤3 次，不带语言过滤仍查全库）。
 *    召回池 = repoFacets ∪ hits 分页聚合（≤3 页，唯一仓库 <60 且仍有余量才翻页）→ ≤60 仓库。
 * ③ GitHub 元数据补全（GraphQL 批量，整批失败回退 REST 逐仓并发 8）→ 语言后过滤
 *    （过滤后 <10 个放弃过滤）→ LLM 精选排序（宽松排序提示词：全网召回池必然
 *    混杂词法噪声，"没有真正满足意图就返回 []"的过滤式措辞会让模型塌缩判空——
 *    实测 flash 模型 3/3 真实查询返回空数组而候选里有直接对口仓库）。判空不再
 *    清空结果：按池序词法兜底，ai_empty 仅作信号上报。
 *
 * 竞态/取消语义：AbortSignal 全链路传播，abort 一律重抛、绝不产出兜底结果
 * （对齐 aiService 现有语义）；结果写入 'search' 频道，不分页（≤20 个）。
 */

import type { DiscoveryRepo, PaginatedDiscoveryRepositories, ProgrammingLanguage } from '../types';
import type { GitHubApiService, GitHubRepoDetailRead } from './githubApi';
import { AIService, isAbortError, type RepoSearchQuery } from './aiService';
import { isGrepRateLimitError, searchGrepApp, type GrepMatchMode, type GrepSearchResult } from './grepAppService';
import { logger } from './logger';

/** grep.app 单次查询超时（正则查询通常数百毫秒返回，15s 已很宽裕）。 */
const GREP_TIMEOUT_MS = 15000;
/** 召回池上限：平衡 LLM 上下文（重排候选）与覆盖面。 */
const RECALL_POOL_LIMIT = 60;
/** 单个 grep 查询最多翻页数（首页 + 2 页）。 */
const MAX_RECALL_PAGES = 3;
/** 正则交替成员上限（RE2 查询长度与语义发散度的折中）。 */
const RECALL_MAX_ALTERNATIONS = 6;
/** 正则成员与 fuzzy 回退词的长度窗口。 */
const RECALL_TERM_MIN_LENGTH = 1;
const RECALL_TERM_MAX_LENGTH = 60;
/**
 * 正则交替模式总长上限（按转义后字符计，含 `(?:`/`)` 包裹）。实测 grep.app 服务端
 * 会把正则 q 参数截断到 64 字符后再编译：≤64 返回 200，>64 直接 400
 * （`{"error":"missing closing ): ..."}`，右括号被截掉）→ 整次召回失效，
 * 必须在前端守住预算。
 */
const MAX_RECALL_PATTERN_LENGTH = 64;
/** Markdown 文档域优先召回的语言过滤（README/文档命中更能代表项目主题）。 */
const RECALL_MARKDOWN_LANGS = ['Markdown'];
/** 逐词 fuzzy 回退的请求上限（含原始 query，总请求数 ≤ 1 次正则 + 3 次回退）。 */
const FALLBACK_QUERY_LIMIT = 3;
/** 回退请求之间的固定间隔，降低 grep.app 429 风险。 */
const FALLBACK_INTERVAL_MS = 250;
/** GitHub Search 单条查询返回数；5 条查询合并后截断到 RECALL_POOL_LIMIT。 */
const GITHUB_SEARCH_PER_PAGE = 25;
/** GitHub Search 串行请求间隔（未认证配额 10 req/min）。 */
const GITHUB_SEARCH_INTERVAL_MS = 2100;
/** 少于 3 条有效语法槽查询时视为生成失败，直接走 grep.app 回退。 */
const GITHUB_QUERY_MIN_VALID = 3;
const GITHUB_QUERY_MAX_VALID = 5;
/** GraphQL 批量补全的批大小（与既有 graphqlFetchRepositories 默认一致）。 */
const ENRICH_BATCH_SIZE = 100;
/** GraphQL 整批失败后的 REST 逐仓补全并发。 */
const REST_ENRICH_CONCURRENCY = 8;
/** 语言后过滤后至少要剩下的候选数，否则放弃过滤交给 LLM。 */
const LANGUAGE_FILTER_MIN_RESULT = 10;
/** 最终返回的仓库上限（与 LLM 精选 SELECTION_MAX_RESULTS 对齐）。 */
const MAX_RESULT_COUNT = 20;

export type SemanticSearchPhase = 'expanding' | 'recalling' | 'enriching' | 'reranking';

export interface SemanticRepoSearchOptions {
  /** 语言后过滤（'All' 或缺省不过滤；过滤后不足 10 个时放弃过滤） */
  language?: ProgrammingLanguage;
  signal?: AbortSignal;
  onPhase?: (phase: SemanticSearchPhase, detail?: string) => void;
  onFallback?: (reason: 'ai_failed' | 'unparseable' | 'ai_empty' | 'recall_empty') => void;
  /** 测试注入口：透传给 searchGrepApp 的 fetch 实现（生产不传，走默认 fetch） */
  fetchImpl?: typeof fetch;
  /** 测试注入口：GitHub Search 查询间隔（生产不传，使用默认节流）。 */
  githubSleepImpl?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export interface GithubSearchRecallResult {
  aggregation: Map<string, RecallAggregatedEntry>;
  evidence: Map<string, string>;
}

export interface GithubSearchRecallOptions {
  api: GitHubApiService;
  aiService: AIService;
  signal?: AbortSignal;
  /** 查询扩展词（与用户原始查询一起用于主题校验）。 */
  topicTerms?: string[];
  /** 测试注入口：替换查询间等待。 */
  sleepImpl?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/** 聚合后的召回条目：为什么该仓库被召回（命中次数 / 样本文件 / 语言）。 */
export interface RecallAggregatedEntry {
  /** 仓库 full_name（保留召回结果里的原始大小写形态） */
  repo: string;
  /** 召回排序分：grep 路径为命中次数；GitHub 路径为查询优先级 + 返回位次的召回分。 */
  count: number;
  /** 样本文件路径（≤3、去重，取自 hits） */
  paths: string[];
  /** 出现过的代码语言集合（取自 hits） */
  langs: Set<string>;
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** REST 单仓补全时"仓库不可用"（404 已删除/改名、403 无权限）的判定。 */
function isRestRepoUnavailable(error: unknown): boolean {
  return error instanceof Error && /GitHub API error: 40[43]/.test(error.message);
}

const emptyResult = (): PaginatedDiscoveryRepositories => ({
  repos: [],
  hasMore: false,
  nextPageIndex: 1,
  totalCount: 0,
});

/** 可被 abort 打断的固定等待（回退请求间隔）。 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

const GITHUB_GENERIC_WORDS = new Set([
  'app',
  'apps',
  'application',
  'cli',
  'open',
  'opensource',
  'software',
  'source',
  'tool',
  'tools',
]);

/**
 * Only real quota signals count as rate limits. A bare 403 (permission,
 * secondary abuse limit, proxy denial) must fall back to grep.app instead of
 * aborting the semantic search.
 */
function isGithubRateLimitError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if ((error as { status?: unknown }).status === 429) return true;
  return /rate limit exceeded/i.test(error.message)
    || /GitHub API error:\s*429\b/.test(error.message)
    || /too many requests/i.test(error.message);
}

/** 用户查询与扩展词的去重小写词集合，用于校验生成查询是否锁定主题。 */
function topicWordSet(...sources: string[]): Set<string> {
  const words = new Set<string>();
  for (const source of sources) {
    // Split on any non-alphanumeric run so `todo/task` yields `todo` and `task`.
    // Keep single-character words too (e.g. query `C`) so topic filtering stays on.
    for (const part of source.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
      if (part.length >= 1) words.add(part);
    }
  }
  return words;
}

/**
 * 校验模型生成的语法槽并拼装 GitHub q。模型不能写限定符：这里只保留
 * 1-3 个内容词，按 scope 追加代码固定后缀。含 GitHub 布尔运算符（NOT/AND/OR）
 * 或以 `-`/`+` 开头的词的查询整条丢弃；传入用户词时只保留至少命中一个主题词的查询。有效查询
 * 少于 3 条，或缺少 ≥2 条 metadata / ≥1 条 readme 时返回 null，触发 grep 回退。
 */
export function assembleGithubQuery(queries: RepoSearchQuery[], userText?: string): string[] | null {
  const topicWords = userText ? topicWordSet(userText) : null;
  const hasTopicFilter = topicWords !== null && topicWords.size > 0;
  const assembled: string[] = [];
  const seen = new Set<string>();
  const scopeByQuery = new Map<string, RepoSearchQuery['scope']>();
  let metadataCount = 0;
  let readmeCount = 0;
  for (const query of queries) {
    if (!query || !Array.isArray(query.terms)) continue;
    if (query.scope !== 'metadata' && query.scope !== 'readme' && query.scope !== 'any') continue;

    const words: string[] = [];
    const seenWords = new Set<string>();
    let hasQuerySyntax = false;
    for (const raw of query.terms) {
      if (typeof raw !== 'string') continue;
      const cleaned = raw
        .replace(/["'`“”‘’():：（）]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!cleaned) continue;
      for (const word of cleaned.split(' ')) {
        if (/^(?:NOT|AND|OR)$/.test(word) || /^[-+]/.test(word)) {
          hasQuerySyntax = true;
          continue;
        }
        const key = word.toLowerCase();
        if (!seenWords.has(key)) {
          seenWords.add(key);
          words.push(word);
        }
      }
    }
    if (hasQuerySyntax) continue;
    if (words.length === 0 || words.length > 3) continue;
    if (words.every(word => GITHUB_GENERIC_WORDS.has(word.toLowerCase()))) continue;
    if (hasTopicFilter && topicWords && !words.some(word => topicWords.has(word.toLowerCase()))) continue;

    const suffix = query.scope === 'metadata'
      ? ' in:name,description,topics'
      : query.scope === 'readme'
        ? ' in:readme'
        : '';
    const q = `${words.join(' ')}${suffix}`;
    const key = q.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    assembled.push(q);
    scopeByQuery.set(q, query.scope);
    if (query.scope === 'metadata') metadataCount++;
    else if (query.scope === 'readme') readmeCount++;
  }
  if (assembled.length < GITHUB_QUERY_MIN_VALID || metadataCount < 2 || readmeCount < 1) return null;
  // Keep the required scoped queries inside the cap even if the model listed
  // five `any` queries first.
  const required = new Set<string>([
    ...assembled.filter(q => scopeByQuery.get(q) === 'metadata').slice(0, 2),
    ...assembled.filter(q => scopeByQuery.get(q) === 'readme').slice(0, 1),
  ]);
  return [
    ...required,
    ...assembled.filter(q => !required.has(q)),
  ].slice(0, GITHUB_QUERY_MAX_VALID);
}

/**
 * 跨调用共享 GitHub Search 配额时间轴：每次请求在单线程内原子预占一个
 * 2.1s 时间片，重叠的窗口/调用因此串行排队，而不是各自 5 连发耗尽 30/min。
 */
let nextGithubSearchAt = 0;

/** 测试专用：重置共享配额时间轴。 */
export function __resetGithubSearchPacingForTest(): void {
  nextGithubSearchAt = 0;
}

/**
 * GitHub Search 召回：5 条语法槽查询串行执行，按 full_name 去重、查询优先级与
 * 返回位次排序并截断到 60。单条非限流失败跳过；403/429 与 abort 立即上抛；
 * 全部失败也上抛，由主流程回退到 grep.app。
 */
export async function runGithubSearchRecall(
  query: string,
  intent: string,
  options: GithubSearchRecallOptions,
): Promise<GithubSearchRecallResult> {
  const { api, aiService, signal } = options;
  const wait = options.sleepImpl ?? sleep;
  const startTime = Date.now();
  const generated = await aiService.generateRepoSearchQueries(query, intent, signal);
  const assembled = assembleGithubQuery(generated, [query, ...(options.topicTerms ?? [])].join(' '));
  if (!assembled) {
    logger.warn('semanticSearch', 'GitHub search query generation produced fewer than 3 valid queries', {
      generated: generated.length,
    });
    return { aggregation: new Map(), evidence: new Map() };
  }

  const byRepo = new Map<string, RecallAggregatedEntry>();
  const evidence = new Map<string, string>();
  let successfulRequests = 0;
  for (let i = 0; i < assembled.length; i++) {
    // Atomically reserve the next shared slot before awaiting, so concurrent
    // recalls queue behind each other instead of firing five requests in parallel.
    const now = Date.now();
    const scheduledAt = Math.max(now, nextGithubSearchAt);
    const reservedUntil = scheduledAt + GITHUB_SEARCH_INTERVAL_MS;
    nextGithubSearchAt = reservedUntil;
    if (scheduledAt > now) {
      try {
        await wait(scheduledAt - now, signal);
      } catch (error) {
        // Aborted before the request: release the unused slot if no later call claimed it.
        if (nextGithubSearchAt === reservedUntil) nextGithubSearchAt = scheduledAt;
        throw error;
      }
    }
    const q = assembled[i];
    try {
      const repos = await api.searchRepositoriesRaw(q, GITHUB_SEARCH_PER_PAGE, signal);
      successfulRequests += 1;
      const queryWeight = assembled.length - i;
      for (let rank = 0; rank < repos.length; rank++) {
        const repo = repos[rank];
        if (!repo.full_name) continue;
        const key = repo.full_name.toLowerCase();
        // GitHub returns best-match order; earlier queries (metadata) and
        // earlier ranks are stronger signals than stars.
        const score = queryWeight * GITHUB_SEARCH_PER_PAGE - rank;
        const existing = byRepo.get(key);
        if (existing) {
          if (score > existing.count) existing.count = score;
          continue;
        }
        byRepo.set(key, {
          repo: repo.full_name,
          count: score,
          paths: [],
          langs: new Set(repo.language ? [repo.language] : []),
        });
        evidence.set(key, `gh_search=${q}`);
      }
    } catch (error) {
      if (signal?.aborted || isAbortError(error) || isGithubRateLimitError(error)) throw error;
      logger.warn('semanticSearch', 'GitHub search query failed, skipping', {
        query: q,
        error: errorMessage(error),
      });
    }
  }
  if (successfulRequests === 0) {
    throw new Error('GitHub search unavailable: all recall requests failed');
  }

  const sorted = [...byRepo.entries()]
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, RECALL_POOL_LIMIT);
  const aggregation = new Map(sorted);
  const cappedEvidence = new Map<string, string>();
  for (const [key] of sorted) {
    const value = evidence.get(key);
    if (value) cappedEvidence.set(key, value);
  }
  logger.info('semanticSearch', 'GitHub search recall completed', {
    queries: assembled.length,
    successfulRequests,
    poolSize: aggregation.size,
    durationMs: Date.now() - startTime,
  });
  return { aggregation, evidence: cappedEvidence };
}

/** 转义 RE2 元字符（`\.+*?()|[]{}^$`），把任意字符串安全地作为正则字面量。 */
export function escapeRe2Literal(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 术语具体性门槛（仅约束扩展术语，不约束用户原始 query）：实测 `mc` 这类
 * 2 字符拉丁泛词作正则成员会在全库代码匹配中产生海量命中，repoFacets 头部桶
 * 全被泛词仓库占据，真正相关的仓库被挤出 top-60。纯拉丁字母/数字词要求 ≥3 字符；
 * CJK 字符信息密度高，含 CJK 的词 ≥2 字符即可。
 */
function isSpecificRecallTerm(term: string): boolean {
  if (/[\u4e00-\u9fff]/.test(term)) return term.length >= 2;
  return term.length >= 3;
}

/**
 * 构造单次正则交替查询：成员 = [query, ...terms]（大小写不敏感去重、原始长度
 * 1..60、上限 6 个），逐个转义后用 `|` 连接包成 `(?:...)`。术语成员还需通过
 * 具体性门槛（query 成员不受限，不破坏单词搜索）。在总长预算内贪心构造：
 * 长度按转义后字符计（转义会加长，如 `a.b` → 5 字符），当前成员使
 * `(?:` + 已选成员 + `)` 总长超过 64 时跳过、继续尝试后续更短成员；首个成员
 * 单独即超预算时同样按长度窗剔除逻辑丢弃。没有有效成员时返回 null
 * （调用方直接走逐词回退）。
 */
export function buildRecallRegex(query: string, terms: string[]): string | null {
  const seen = new Set<string>();
  const members: string[] = [];
  let isQueryTurn = true;
  for (const raw of [query, ...terms]) {
    const isQueryMember = isQueryTurn;
    isQueryTurn = false;
    const term = raw.trim();
    if (term.length < RECALL_TERM_MIN_LENGTH || term.length > RECALL_TERM_MAX_LENGTH) continue;
    if (!isQueryMember && !isSpecificRecallTerm(term)) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const candidate = `(?:${members.map(escapeRe2Literal).concat(escapeRe2Literal(term)).join('|')})`;
    if (candidate.length > MAX_RECALL_PATTERN_LENGTH) continue;
    members.push(term);
    if (members.length >= RECALL_MAX_ALTERNATIONS) break;
  }
  if (members.length === 0) return null;
  return `(?:${members.map(escapeRe2Literal).join('|')})`;
}

/**
 * 构造"高具体性"正则（第二路召回，用于把命中罕见词的仓库在池内排前）。
 * 背景（真实 case）：全并集正则的 facets 计数 ∝ 仓库文档量 × 词的泛化度，
 * `github stars`/`desktop app` 这类英文高频词会带来数万命中，把海量无关
 * 大仓库刷进 top-60，而真正相关的仓库（往往只命中罕见词一两次）被挤出
 * 池子，精选模型只能判空——用户看到"经常没有结果"。单次并集查询无法
 * 区分"哪个成员命中"（RE2 不支持环视、无逐成员归因），因此把最可能罕见
 * 的成员单独成查：CJK 词在以英文为主的代码语料里天然罕见；无 CJK 成员时
 * 退化为最长的多词短语（短语比单词具体）。其命中仓库在池内排序时优先于
 * 仅命中泛词的仓库（主键 = 是否命中罕见词，次键 = 并集计数）。
 * 没有可挑成员（或与并集等价）时返回 null，跳过第二路。
 */
export function buildSpecificRecallRegex(terms: string[]): string | null {
  const seen = new Set<string>();
  const valid: string[] = [];
  for (const raw of terms) {
    const term = raw.trim();
    if (term.length < RECALL_TERM_MIN_LENGTH || term.length > RECALL_TERM_MAX_LENGTH) continue;
    if (!isSpecificRecallTerm(term)) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    valid.push(term);
  }
  let members = valid.filter(term => /[\u4e00-\u9fff]/.test(term));
  if (members.length === 0) {
    members = valid.filter(term => term.includes(' ')).sort((a, b) => b.length - a.length).slice(0, 2);
  }
  // 与 buildRecallRegex 相同的 64 字符预算机制（按转义后长度贪心纳入）
  const picked: string[] = [];
  for (const term of members) {
    const candidate = `(?:${picked.map(escapeRe2Literal).concat(escapeRe2Literal(term)).join('|')})`;
    if (candidate.length > MAX_RECALL_PATTERN_LENGTH) continue;
    picked.push(term);
  }
  if (picked.length === 0) return null;
  const specific = `(?:${picked.map(escapeRe2Literal).join('|')})`;
  return specific;
}

/**
 * 聚合多次 grep 查询/多页结果：Map 以 full_name 小写为键。
 * count 以 repoFacets 求和为准（facets 反映查询的全局分布，跨查询求和代表
 * 综合召回强度）；仅出现在 hits 的仓库按出现次数计；paths/langs 取自 hits
 * （paths ≤3、去重）。
 */
export function aggregateRecall(results: GrepSearchResult[]): Map<string, RecallAggregatedEntry> {
  const map = new Map<string, RecallAggregatedEntry>();
  // 有 facet 计数的仓库：count 只来自 facets 求和，hits 不叠加；
  // 仅出现在 hits 的仓库（不在该集合）按出现次数累计。
  const facetBackedKeys = new Set<string>();
  const ensure = (repo: string): RecallAggregatedEntry => {
    const key = repo.toLowerCase();
    let entry = map.get(key);
    if (!entry) {
      entry = { repo, count: 0, paths: [], langs: new Set() };
      map.set(key, entry);
    }
    return entry;
  };
  const absorbHit = (entry: RecallAggregatedEntry, path: string, language: string): void => {
    if (entry.paths.length < 3 && !entry.paths.includes(path)) entry.paths.push(path);
    if (language) entry.langs.add(language);
  };
  for (const result of results) {
    for (const bucket of result.repoFacets) {
      facetBackedKeys.add(bucket.val.toLowerCase());
      ensure(bucket.val).count += bucket.count;
    }
  }
  for (const result of results) {
    for (const hitItem of result.hits) {
      const key = hitItem.repo.toLowerCase();
      const existing = map.get(key);
      if (existing && facetBackedKeys.has(key)) {
        // 已有 facet 计数的仓库：hits 只补充样本路径与语言
        absorbHit(existing, hitItem.path, hitItem.language);
        continue;
      }
      // 仅出现在 hits 的仓库：按出现次数计（跨结果累计）
      const entry = ensure(hitItem.repo);
      entry.count += 1;
      absorbHit(entry, hitItem.path, hitItem.language);
    }
  }
  return map;
}

/** 执行单个 grep 查询（langs 为可选语言过滤，翻页请求同样携带）；paginate 时按需翻页（≤3 页，唯一仓库 <60 且仍有余量）。 */
async function runGrepQuery(
  q: string,
  mode: GrepMatchMode,
  collected: GrepSearchResult[],
  options: { signal?: AbortSignal; fetchImpl?: typeof fetch },
  paginate: boolean,
  langs?: string[],
): Promise<GrepSearchResult> {
  const first = await searchGrepApp({ q, mode, langs }, { signal: options.signal, timeoutMs: GREP_TIMEOUT_MS, fetchImpl: options.fetchImpl });
  collected.push(first);
  if (!paginate) return first;
  let fetchedHits = first.hits.length;
  let page = 1;
  while (page < MAX_RECALL_PAGES && fetchedHits < first.total && aggregateRecall(collected).size < RECALL_POOL_LIMIT) {
    page += 1;
    const next = await searchGrepApp({ q, mode, langs, page }, { signal: options.signal, timeoutMs: GREP_TIMEOUT_MS, fetchImpl: options.fetchImpl });
    // facets 是整个查询的全局分布，同一查询的每一页返回相同 repoFacets：
    // 翻页结果清空 facets，只保留首页的，避免同仓库计数被页数成倍放大
    // （污染证据行 matches=N 与词法兜底排序）；跨查询求和语义不受影响
    collected.push({ ...next, repoFacets: [] });
    if (next.hits.length === 0) break;
    fetchedHits += next.hits.length;
  }
  return first;
}

/**
 * 词法召回（两路正则 + fuzzy 回退）：
 * ① 主路：Markdown 文档域（f.lang=Markdown）全并集正则交替查询（并按需翻页）；
 * ② 辅路：高具体性成员（CJK 词 / 长多词短语）单独成查——并集 facets 计数
 *    ∝ 仓库文档量 × 词的泛化度，泛词会淹没真正相关的仓库（详见
 *    buildSpecificRecallRegex 注释）；辅路命中的仓库在池内排序时优先。
 * 主路非 429 失败或 total===0 时逐词 fuzzy 回退（query 优先、跨语言轮流、
 * ≤3 词、间隔 250ms，不带语言过滤仍查全库）；辅路失败仅记日志（主路仍在）。
 * 请求预算：成功路径 ≤1+2 页+1 = 4，失败路径 ≤1+3 = 4。429 立即重抛，
 * abort 一律重抛；单个回退查询失败记日志后继续。
 * 返回聚合池 + 辅路命中仓库集合（供上层排序：具体优先，次按并集计数）。
 */
async function recallRepositories(
  query: string,
  terms: string[],
  options: { signal?: AbortSignal; fetchImpl?: typeof fetch },
): Promise<{ aggregation: Map<string, RecallAggregatedEntry>; specificRepoKeys: Set<string> }> {
  const collected: GrepSearchResult[] = [];
  const specificCollected: GrepSearchResult[] = [];
  const regex = buildRecallRegex(query, terms);
  let needFallback = !regex;
  // 实际发起的主请求次数（正则 1 次 + fuzzy 回退各 1 次，翻页不计）：
  // 仅当"发过请求且一次都没成功"才判定检索服务不可用；一次都没发起
  // （如查询超长且扩展无可用词）返回空聚合，由上层按 recall_empty 处理
  let attemptedRequests = 0;
  if (regex) {
    try {
      // Markdown 文档域优先：实测 f.lang=Markdown 过滤可用且效果显著（yazi 的
      // README.md 直接出现在 "terminal file manager" 查询命中里）；全库代码搜索
      // 则易被变量名/泛词污染刷屏
      attemptedRequests += 1;
      const first = await runGrepQuery(regex, 'regexp', collected, options, true, RECALL_MARKDOWN_LANGS);
      if (first.total === 0) needFallback = true;
      else {
        // 辅路：高具体性成员单独成查，把被泛词计数淹没的相关仓库标记出来。
        // 与主路同域同超时；失败仅记日志（主路结果仍在），限流/abort 照常上抛
        const specificRegex = buildSpecificRecallRegex(terms);
        if (specificRegex && specificRegex !== regex) {
          attemptedRequests += 1;
          try {
            await runGrepQuery(specificRegex, 'regexp', specificCollected, options, false, RECALL_MARKDOWN_LANGS);
          } catch (error) {
            if (options.signal?.aborted || isAbortError(error)) throw error;
            if (isGrepRateLimitError(error)) throw error;
            logger.warn('semanticSearch', '高具体性召回查询失败，忽略辅路加权', { error: errorMessage(error) });
          }
        }
      }
    } catch (error) {
      if (options.signal?.aborted || isAbortError(error)) throw error;
      if (isGrepRateLimitError(error)) throw error;
      logger.warn('semanticSearch', 'Markdown 正则召回查询失败，回退逐词 fuzzy 查询', { error: errorMessage(error) });
      needFallback = true;
    }
  }
  if (needFallback) {
    // fuzzy 回退不带语言过滤（Markdown 域零命中不代表全库零命中）
    const seen = new Set<string>();
    const isValidFallbackWord = (word: string, isQuery: boolean): boolean => {
      if (word.length < RECALL_TERM_MIN_LENGTH || word.length > RECALL_TERM_MAX_LENGTH) return false;
      // 术语与正则成员同门槛：泛词不发起回退请求；query 成员不受限
      if (!isQuery && !isSpecificRecallTerm(word)) return false;
      const key = word.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    };
    const queryWord = query.trim();
    const hasQuery = isValidFallbackWord(queryWord, true);
    // 术语按语言类别（CJK / 非 CJK）轮流选取：模型常先返回一串同语言词，
    // 直接按原顺序截断会把跨语言代表词挤出名额（≤3 个），多语言仓库漏召回
    const termsByLang = new Map<boolean, string[]>();
    for (const raw of terms) {
      const word = raw.trim();
      if (!isValidFallbackWord(word, false)) continue;
      const isCjk = /[\u4e00-\u9fff]/.test(word);
      const bucket = termsByLang.get(isCjk) ?? [];
      bucket.push(word);
      termsByLang.set(isCjk, bucket);
    }
    const interleaved: string[] = [];
    let picked = true;
    while (picked) {
      picked = false;
      for (const bucket of termsByLang.values()) {
        const word = bucket.shift();
        if (word) {
          interleaved.push(word);
          picked = true;
        }
      }
    }
    const fallbackWords = [...(hasQuery ? [queryWord] : []), ...interleaved].slice(0, FALLBACK_QUERY_LIMIT);
    for (let i = 0; i < fallbackWords.length; i++) {
      if (i > 0) await sleep(FALLBACK_INTERVAL_MS, options.signal);
      attemptedRequests += 1;
      try {
        await runGrepQuery(fallbackWords[i], 'fuzzy', collected, options, false);
      } catch (error) {
        if (options.signal?.aborted || isAbortError(error)) throw error;
        if (isGrepRateLimitError(error)) throw error;
        logger.warn('semanticSearch', 'fuzzy 回退查询失败，跳过该词继续', { error: errorMessage(error) });
      }
    }
  }
  // collected 只在请求成功时 push（含"首页成功、翻页失败"的部分成功场景）：
  // 发过请求但一次都没成功说明检索服务整体不可用（超时/网络错误等），应向上抛错，
  // 而不是把服务故障谎报成"零命中"（recall_empty）；一次都没发起则交由上层按
  // recall_empty 处理
  if (collected.length === 0 && attemptedRequests > 0) {
    throw new Error('Code search unavailable: all recall requests failed');
  }
  const aggregation = aggregateRecall(collected);
  const specificRepoKeys = new Set(aggregateRecall(specificCollected).keys());
  return { aggregation, specificRepoKeys };
}

/** GraphQL 整批失败后的 REST 逐仓补全：并发 8，404/403（不可用仓库）与其他错误均跳过该仓库。 */
async function enrichViaRest(
  api: GitHubApiService,
  fullNames: string[],
  signal?: AbortSignal,
): Promise<Map<string, GitHubRepoDetailRead | null>> {
  const details = new Map<string, GitHubRepoDetailRead | null>();
  const queue = [...fullNames];
  // 限流后停止取新任务：搜索已注定失败（限流错误向上抛），其余 worker 不应
  // 继续从队列取仓库烧 GitHub 请求额度
  let stopped = false;
  const workerCount = Math.min(REST_ENRICH_CONCURRENCY, queue.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (!stopped && queue.length > 0) {
      const fullName = queue.shift();
      if (!fullName) break;
      const [owner, repo] = fullName.split('/');
      try {
        details.set(fullName.toLowerCase(), await api.getRepositoryDetails(owner, repo, signal));
      } catch (error) {
        if (signal?.aborted || isAbortError(error)) throw error;
        // GitHub 限流（主限流/次级限流均报 403 "rate limit exceeded"）不能吞成
        // "仓库不可用"，否则管道会拿着不完整的候选集继续跑并把残缺结果交给 LLM：
        // 直接向上抛，由 hook 的错误路径提示用户
        if (isGithubRateLimitError(error)) {
          stopped = true;
          throw error;
        }
        if (!isRestRepoUnavailable(error)) {
          logger.warn('semanticSearch', 'REST 单仓补全失败，跳过该仓库', { fullName, error: errorMessage(error) });
        }
        details.set(fullName.toLowerCase(), null);
      }
    }
  });
  await Promise.all(workers);
  return details;
}

/** ProgrammingLanguage 枚举值 → GitHub language 字段名（仅 C#/C++ 与枚举拼写不同）。 */
const LANGUAGE_NAME_MAP: Record<string, string> = {
  csharp: 'c#',
  cplusplus: 'c++',
};

/** 语言后过滤：与 GitHub language 字段大小写不敏感比较。 */
function matchesLanguageFilter(repoLanguage: string | null | undefined, filter: ProgrammingLanguage): boolean {
  if (!repoLanguage) return false;
  const key = filter.toLowerCase();
  const expected = LANGUAGE_NAME_MAP[key] ?? key;
  return repoLanguage.toLowerCase() === expected;
}

/**
 * 用查询词 + 扩展词对补全后的仓库元数据做词法打分排序，避免重排失败时退回
 * 纯 star 排序把"高星但无关"的仓库顶到前面；同分再用召回分稳定排序。
 */
function orderPoolByLexicalRelevance<T extends { repo: DiscoveryRepo; count: number }>(
  pool: T[],
  query: string,
  terms: string[],
  specificRepoKeys: Set<string>,
): T[] {
  const scored = AIService.rankLexicalCandidates(
    pool.map(candidate => candidate.repo),
    query,
    terms,
    { includePopularity: false },
  );
  const scoreByKey = new Map(scored.map(item => [item.repo.full_name.toLowerCase(), item.score]));
  return pool.slice().sort((a, b) => {
    const specificA = specificRepoKeys.has(a.repo.full_name.toLowerCase()) ? 1 : 0;
    const specificB = specificRepoKeys.has(b.repo.full_name.toLowerCase()) ? 1 : 0;
    const scoreA = scoreByKey.get(a.repo.full_name.toLowerCase()) ?? 0;
    const scoreB = scoreByKey.get(b.repo.full_name.toLowerCase()) ?? 0;
    return specificB - specificA || scoreB - scoreA || b.count - a.count;
  });
}

/**
 * 全网仓库 AI 语义搜索主入口。结果写入 'search' 频道渲染（不分页）。
 * - 召回为空 → onFallback('recall_empty') + 空结果；
 * - LLM 精选返回 []（明确判空）→ onFallback('ai_empty') + 按池序词法兜底
 *   （全网搜索语境下判空几乎必是模型塌缩而非真实空态，不清空结果）；
 * - LLM 精选不可解析/失败（非 abort）→ onFallback('unparseable'/'ai_failed') + 按词法相关性兜底；
 * - abort 一律重抛，绝不产出兜底结果。
 */
export async function searchRepositoriesSemantically(
  api: GitHubApiService,
  aiService: AIService,
  query: string,
  options: SemanticRepoSearchOptions = {},
): Promise<PaginatedDiscoveryRepositories> {
  const { signal, onPhase, onFallback, fetchImpl } = options;
  const trimmed = query.trim();
  if (!trimmed) return emptyResult();

  // ① LLM 查询扩展 + 意图复述（失败不阻断：terms=[] 继续走词法召回）
  onPhase?.('expanding');
  let terms: string[] = [];
  let intent = '';
  try {
    const expanded = await aiService.expandSearchQuery(trimmed, signal, { multilingual: true });
    terms = expanded.terms;
    intent = expanded.intent;
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) throw error;
    logger.warn('semanticSearch', '查询扩展失败，使用原始查询词法召回', { error: errorMessage(error) });
  }

  // ② GitHub Search 召回；生成/召回为空或非限流失败时回退 grep.app 词法召回。
  onPhase?.('recalling');
  let aggregation = new Map<string, RecallAggregatedEntry>();
  let specificRepoKeys = new Set<string>();
  let githubEvidence: Map<string, string> | null = null;
  try {
    const githubRecall = await runGithubSearchRecall(trimmed, intent, {
      api,
      aiService,
      signal,
      topicTerms: terms,
      sleepImpl: options.githubSleepImpl,
    });
    if (githubRecall.aggregation.size > 0) {
      aggregation = githubRecall.aggregation;
      githubEvidence = githubRecall.evidence;
    }
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) throw error;
    logger.warn('semanticSearch', isGithubRateLimitError(error)
      ? 'GitHub search rate limited, falling back to grep.app'
      : 'GitHub search recall failed, falling back to grep.app', { error: errorMessage(error) });
  }
  if (!githubEvidence) {
    const grepRecall = await recallRepositories(trimmed, terms, { signal, fetchImpl });
    aggregation = grepRecall.aggregation;
    specificRepoKeys = grepRecall.specificRepoKeys;
  }
  if (aggregation.size === 0) {
    onFallback?.('recall_empty');
    return emptyResult();
  }

  // ③ GitHub 元数据补全：top-60。grep 路径按辅路命中优先、并集计数降序；
  //     GitHub 路径按查询优先级与返回位次排序。Array.sort 稳定。
  const buildCandidates = async (
    pool: Map<string, RecallAggregatedEntry>,
    specific: Set<string>,
  ): Promise<Array<{ repo: DiscoveryRepo; count: number; paths: string[]; langs: Set<string> }>> => {
    const topEntries = [...pool.values()]
      .sort((a, b) => {
        const aSpecific = specific.has(a.repo.toLowerCase()) ? 1 : 0;
        const bSpecific = specific.has(b.repo.toLowerCase()) ? 1 : 0;
        return bSpecific - aSpecific || b.count - a.count;
      })
      .slice(0, RECALL_POOL_LIMIT);
    const fullNames = topEntries.map(entry => entry.repo);
    onPhase?.('enriching');
    let details: Map<string, GitHubRepoDetailRead | null>;
    try {
      details = await api.graphqlFetchRepositories(fullNames, {
        signal,
        batchSize: ENRICH_BATCH_SIZE,
        onBatchDone: (doneBatches) => {
          const done = Math.min(fullNames.length, doneBatches * ENRICH_BATCH_SIZE);
          onPhase?.('enriching', `${done}/${fullNames.length}`);
        },
      });
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) throw error;
      // GraphQL 限流时直接向上抛：REST 回退与 GraphQL 共用限流退避
      // （rateLimitRemaining/rateLimitReset），会静默等待限流窗口重置（最长约 1 小时）
      // 且不向用户报错，与 enrichViaRest 的"限流即上抛"约定保持一致
      if (isGithubRateLimitError(error)) throw error;
      logger.warn('semanticSearch', 'GraphQL 批量补全失败，回退 REST 逐仓补全', { error: errorMessage(error) });
      details = await enrichViaRest(api, fullNames, signal);
    }

    // 组装候选：null（已删除/不可访问）与 id===0（GraphQL 映射失败）的仓库直接跳过
    const built: Array<{ repo: DiscoveryRepo; count: number; paths: string[]; langs: Set<string> }> = [];
    for (const entry of topEntries) {
      const detail = details.get(entry.repo.toLowerCase());
      if (!detail || detail.id === 0) continue;
      built.push({
        repo: { ...detail, rank: built.length + 1, channel: 'search', platform: 'All' },
        count: entry.count,
        paths: entry.paths,
        langs: entry.langs,
      });
    }
    return built;
  };

  let candidates = await buildCandidates(aggregation, specificRepoKeys);
  // GitHub 召回非空但补全后全被过滤 → grep.app 兜底重试一次
  if (candidates.length === 0 && githubEvidence) {
    const grepRecall = await recallRepositories(trimmed, terms, { signal, fetchImpl });
    if (grepRecall.aggregation.size > 0) {
      githubEvidence = null;
      candidates = await buildCandidates(grepRecall.aggregation, grepRecall.specificRepoKeys);
    }
  }
  if (candidates.length === 0) {
    onFallback?.('recall_empty');
    return emptyResult();
  }

  // 语言后过滤：过滤后不足 10 个则放弃过滤，交给 LLM 在全量候选内精选
  let pool = candidates;
  const languageFilter = options.language;
  if (languageFilter && languageFilter !== 'All') {
    const filtered = candidates.filter(candidate => matchesLanguageFilter(candidate.repo.language, languageFilter));
    if (filtered.length >= LANGUAGE_FILTER_MIN_RESULT) pool = filtered;
  }
  pool = orderPoolByLexicalRelevance(pool, trimmed, terms, specificRepoKeys);

  // 召回证据行（语言中性格式）：让重排模型看到"为什么被召回"
  const evidence = new Map<string, string>();
  for (const candidate of pool) {
    const key = candidate.repo.full_name.toLowerCase();
    evidence.set(
      key,
      githubEvidence?.get(key)
        ?? `matches=${candidate.count}; paths=${candidate.paths.slice(0, 3).join(',')}; langs=${[...candidate.langs].join(',')}`,
    );
  }

  // ④ LLM 精选排序
  onPhase?.('reranking');
  let ordered: DiscoveryRepo[];
  try {
    const ranked = await aiService.selectRelevantRepositories(
      pool.map(candidate => candidate.repo),
      trimmed,
      intent,
      signal,
      evidence,
    );
    if (ranked === null) {
      // 响应缺失/格式非法：按词法相关性兜底
      onFallback?.('unparseable');
      ordered = pool.slice(0, MAX_RESULT_COUNT).map(candidate => candidate.repo);
    } else if (ranked.length === 0) {
      // 全网搜索语境下召回池按扩展词构造，"所有候选都与查询无关"几乎不可能是真命题：
      // 模型判空基本是塌缩失败而非真实空态（实测提示词过严时 flash 模型 3/3 判空，
      // 候选里明明有直接对口仓库）。尊重判空信号（ai_empty 照常上报）但不清空结果，
      // 按池序（辅路命中优先、并集计数降序）词法兜底；结果非空时 UI 不会展示空态。
      onFallback?.('ai_empty');
      ordered = pool.slice(0, MAX_RESULT_COUNT).map(candidate => candidate.repo);
    } else {
      // selectRelevantRepositories 返回的 Repository 即带 rank/channel/platform 的 DiscoveryRepo
      ordered = ranked as DiscoveryRepo[];
    }
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) throw error;
    onFallback?.('ai_failed');
    ordered = pool.slice(0, MAX_RESULT_COUNT).map(candidate => candidate.repo);
  }

  const repos = ordered.slice(0, MAX_RESULT_COUNT).map((repo, index) => ({ ...repo, rank: index + 1 }));
  return { repos, hasMore: false, nextPageIndex: 1, totalCount: repos.length };
}
