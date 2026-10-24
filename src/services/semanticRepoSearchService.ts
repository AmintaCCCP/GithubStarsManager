/**
 * 发现页「仓库搜索」频道的 AI 语义搜索（全网仓库）。
 *
 * 三段式管道（参考仓库页"无向量 AI 搜索"，但候选池来自全网而非本地 star 列表）：
 * ① LLM 查询扩展（AIService.expandSearchQuery）→ {intent, terms}
 * ② grep.app 词法召回全网仓库：多个词的并集等价于一次 `(?:q|t1|t2…)` 正则交替
 *    查询（请求数 4→1，降低 429 风险与延迟），并在 Markdown 文档域优先召回
 *    （f.lang=Markdown：README/文档命中更能代表项目主题，避开全库代码搜索的
 *    变量名/泛词污染）；失败/零命中时逐词 fuzzy 回退（≤3 次，不带语言过滤仍查全库）。
 *    召回池 = repoFacets ∪ hits 分页聚合（≤3 页，唯一仓库 <60 且仍有余量才翻页）→ ≤60 仓库。
 * ③ GitHub 元数据补全（GraphQL 批量，整批失败回退 REST 逐仓并发 8）→ 语言后过滤
 *    （过滤后 <10 个放弃过滤）→ LLM 精选排序（selectRelevantRepositories + 召回证据行）。
 *
 * 竞态/取消语义：AbortSignal 全链路传播，abort 一律重抛、绝不产出兜底结果
 * （对齐 aiService 现有语义）；结果写入 'search' 频道，不分页（≤20 个）。
 */

import type { DiscoveryRepo, PaginatedDiscoveryRepositories, ProgrammingLanguage } from '../types';
import type { GitHubApiService, GitHubRepoDetailRead } from './githubApi';
import { AIService, isAbortError } from './aiService';
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
}

/** 聚合后的召回条目：为什么该仓库被召回（命中次数 / 样本文件 / 语言）。 */
export interface RecallAggregatedEntry {
  /** 仓库 full_name（保留召回结果里的原始大小写形态） */
  repo: string;
  /** 命中次数：以 repoFacets 求和为准；仅出现在 hits 的仓库按出现次数计 */
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
 * 词法召回：先尝试一次 Markdown 文档域（f.lang=Markdown）正则交替查询（并按需
 * 翻页）；非 429 失败或 total===0 时逐词 fuzzy 回退（query 优先、≤3 词、间隔
 * 250ms，不带语言过滤仍查全库）。grep 请求预算保持 ≤1 次正则（含翻页）+3 次
 * 回退不变。429 立即重抛（专用限流提示），abort 一律重抛；单个回退查询失败
 * 记日志后继续。
 */
async function recallRepositories(
  query: string,
  terms: string[],
  options: { signal?: AbortSignal; fetchImpl?: typeof fetch },
): Promise<Map<string, RecallAggregatedEntry>> {
  const collected: GrepSearchResult[] = [];
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
  return aggregateRecall(collected);
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
        if (error instanceof Error && /rate limit exceeded/i.test(error.message)) {
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

/** 词法命中数兜底排序：count 降序（同 count 保持召回顺序），≤20。 */
function fallbackOrderByCount(pool: Array<{ repo: DiscoveryRepo; count: number }>): DiscoveryRepo[] {
  return pool
    .slice()
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_RESULT_COUNT)
    .map(candidate => candidate.repo);
}

/**
 * 全网仓库 AI 语义搜索主入口。结果写入 'search' 频道渲染（不分页）。
 * - 召回为空 → onFallback('recall_empty') + 空结果；
 * - LLM 精选返回 []（明确判空）→ onFallback('ai_empty') + 空结果；
 * - LLM 精选不可解析/失败（非 abort）→ onFallback('unparseable'/'ai_failed') + 按命中数兜底；
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

  // ② grep.app 词法召回（单次正则交替 + 按需逐词回退）
  onPhase?.('recalling');
  const aggregation = await recallRepositories(trimmed, terms, { signal, fetchImpl });
  if (aggregation.size === 0) {
    onFallback?.('recall_empty');
    return emptyResult();
  }

  // ③ GitHub 元数据补全：top-60（count 降序，稳定排序）
  const topEntries = [...aggregation.values()].sort((a, b) => b.count - a.count).slice(0, RECALL_POOL_LIMIT);
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
    if (error instanceof Error && /rate limit exceeded/i.test(error.message)) throw error;
    logger.warn('semanticSearch', 'GraphQL 批量补全失败，回退 REST 逐仓补全', { error: errorMessage(error) });
    details = await enrichViaRest(api, fullNames, signal);
  }

  // 组装候选：null（已删除/不可访问）与 id===0（GraphQL 映射失败）的仓库直接跳过
  const candidates: Array<{ repo: DiscoveryRepo; count: number; paths: string[]; langs: Set<string> }> = [];
  for (const entry of topEntries) {
    const detail = details.get(entry.repo.toLowerCase());
    if (!detail || detail.id === 0) continue;
    candidates.push({
      repo: { ...detail, rank: candidates.length + 1, channel: 'search', platform: 'All' },
      count: entry.count,
      paths: entry.paths,
      langs: entry.langs,
    });
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

  // 召回证据行（语言中性格式）：让重排模型看到"为什么被召回"
  const evidence = new Map<string, string>();
  for (const candidate of pool) {
    evidence.set(
      candidate.repo.full_name.toLowerCase(),
      `matches=${candidate.count}; paths=${candidate.paths.slice(0, 3).join(',')}; langs=${[...candidate.langs].join(',')}`,
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
      // 响应缺失/格式非法：按词法命中数兜底
      onFallback?.('unparseable');
      ordered = fallbackOrderByCount(pool);
    } else if (ranked.length === 0) {
      // 模型明确判定无相关仓库：尊重该判断返回空态
      onFallback?.('ai_empty');
      return emptyResult();
    } else {
      // selectRelevantRepositories 返回的 Repository 即带 rank/channel/platform 的 DiscoveryRepo
      ordered = ranked as DiscoveryRepo[];
    }
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) throw error;
    onFallback?.('ai_failed');
    ordered = fallbackOrderByCount(pool);
  }

  const repos = ordered.slice(0, MAX_RESULT_COUNT).map((repo, index) => ({ ...repo, rank: index + 1 }));
  return { repos, hasMore: false, nextPageIndex: 1, totalCount: repos.length };
}
