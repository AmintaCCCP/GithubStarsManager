/**
 * grep.app 代码搜索服务（前端直连优先）。
 *
 * 接口为非官方逆向规格：`GET https://grep.app/api/search`，无需认证。
 * 实测注意：
 * - 机房 IP 会触发 Vercel Challenge（429），浏览器 egress 正常，故默认由浏览器直接 fetch。
 * - `repo/path` 实际为纯字符串（文档中的 `{raw}` 包裹已过时），此处做双向兼容。
 * - `f.lang` 等过滤有效，但 `facets` 仍返回全局分布，UI 需用 facets 做选项、用 hits 做展示。
 */

export const GREP_APP_BASE_URL = 'https://grep.app';
export const GREP_APP_SEARCH_URL = `${GREP_APP_BASE_URL}/api/search`;

export type GrepMatchMode = 'fuzzy' | 'words' | 'regexp';

export interface GrepSearchParams {
  q: string;
  /** 匹配模式：fuzzy（默认，啥都不传）/ words（全词）/ regexp（RE2 正则） */
  mode?: GrepMatchMode;
  /** 区分大小写，可与任意模式叠加 */
  caseSensitive?: boolean;
  /** 语言过滤（多值重复传 f.lang） */
  langs?: string[];
  /** 仓库过滤（owner/repo，多值重复传 f.repo） */
  repos?: string[];
  /** 路径过滤（多值重复传 f.path） */
  paths?: string[];
  /** 分页页码（对应 Load More），默认 1 */
  page?: number;
}

export interface GrepFacetBucket {
  val: string;
  count: number;
}

export interface GrepCodeHit {
  repo: string;
  branch: string;
  path: string;
  language: string;
  totalMatches: string;
  /** 服务端返回的 highlight-table HTML（含 <mark>），渲染前需消毒 */
  snippetHtml: string;
}

export interface GrepSearchResult {
  total: number;
  repoFacets: GrepFacetBucket[];
  pathFacets: GrepFacetBucket[];
  langFacets: GrepFacetBucket[];
  hits: GrepCodeHit[];
}

/** 兼容文档旧格式 `{raw: string}` 与实际纯字符串（数值型按字符串归一化） */
function rawToString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (value && typeof value === 'object' && typeof (value as { raw?: unknown }).raw === 'string') {
    return (value as { raw: string }).raw;
  }
  return '';
}

function toBucketList(input: unknown): GrepFacetBucket[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => {
      const record = item as { val?: unknown; count?: unknown };
      const val = typeof record.val === 'string' ? record.val : '';
      const count = typeof record.count === 'number' ? record.count : Number(record.count) || 0;
      return { val, count };
    })
    .filter((bucket) => bucket.val !== '');
}

/** 拼接 grep.app 搜索 URL：多值过滤重复传参，全词与正则互斥由调用方保证。 */
export function buildGrepSearchUrl(params: GrepSearchParams): string {
  const query = new URLSearchParams();
  query.set('q', params.q);
  if (params.mode === 'words') query.set('words', 'true');
  if (params.mode === 'regexp') query.set('regexp', 'true');
  if (params.caseSensitive) query.set('case', 'true');
  for (const lang of params.langs ?? []) {
    if (lang) query.append('f.lang', lang);
  }
  for (const repo of params.repos ?? []) {
    if (repo) query.append('f.repo', repo);
  }
  for (const path of params.paths ?? []) {
    if (path) query.append('f.path', path);
  }
  if (params.page && params.page > 1) query.set('page', String(params.page));
  return `${GREP_APP_SEARCH_URL}?${query.toString()}`;
}

/** 归一化 grep.app 响应：兼容纯字符串与旧 `{raw}` 包裹两种命中形状。 */
export function normalizeGrepSearchResponse(data: unknown): GrepSearchResult {
  const root = (data ?? {}) as Record<string, unknown>;
  const facets = (root.facets ?? {}) as Record<string, unknown>;
  const hitsNode = (root.hits ?? {}) as Record<string, unknown>;
  const rawHits = Array.isArray(hitsNode.hits) ? (hitsNode.hits as unknown[]) : [];

  const total =
    typeof facets.count === 'number'
      ? facets.count
      : typeof hitsNode.total === 'number'
        ? hitsNode.total
        : rawHits.length;

  const repoFacets = toBucketList((facets.repo as { buckets?: unknown } | undefined)?.buckets);
  const pathFacets = toBucketList((facets.path as { buckets?: unknown } | undefined)?.buckets);
  const langFacets = toBucketList((facets.lang as { buckets?: unknown } | undefined)?.buckets);

  const hits: GrepCodeHit[] = rawHits.map((item) => {
    const record = (item ?? {}) as Record<string, unknown>;
    const content = (record.content ?? {}) as Record<string, unknown>;
    return {
      repo: rawToString(record.repo),
      branch: rawToString(record.branch) || 'main',
      path: rawToString(record.path),
      language: rawToString(record.language ?? record.lang),
      totalMatches: rawToString(record.total_matches ?? record.totalMatches),
      snippetHtml: typeof content.snippet === 'string' ? content.snippet : '',
    };
  });

  return { total, repoFacets, pathFacets, langFacets, hits };
}

/** 判断错误是否为 grep.app 限流（HTTP 429），供重试 UI 使用。 */
export function isGrepRateLimitError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const status = (error as { status?: unknown }).status;
  return status === 429;
}

export interface GrepSearchOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * 执行一次 grep.app 搜索：空查询直接返回空结果；支持外部取消与超时取消；
 * 429 抛出带 `status` 的错误，其余非 2xx 同理。
 */
export async function searchGrepApp(
  params: GrepSearchParams,
  options: GrepSearchOptions = {}
): Promise<GrepSearchResult> {
  const q = params.q.trim();
  if (!q) {
    return { total: 0, repoFacets: [], pathFacets: [], langFacets: [], hits: [] };
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 25000;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  // 外层 signal 若已处于 aborted 状态，addEventListener 不会回放，需显式同步一次
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(buildGrepSearchUrl(params), {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (response.status === 429) {
      const error = new Error('Code search rate limited (429), please retry later');
      (error as { status?: number }).status = 429;
      throw error;
    }
    if (!response.ok) {
      const error = new Error(`Code search request failed: ${response.status}`);
      (error as { status?: number }).status = response.status;
      throw error;
    }
    const data = await response.json();
    return normalizeGrepSearchResponse(data);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * 收藏过滤：按 full_name 大小写不敏感匹配。
 * grep 命中只有 `owner/repo` 字符串，本地 star 列表是唯一可信来源。
 */
export function filterStarredHits(hits: GrepCodeHit[], starredFullNames: Iterable<string>): GrepCodeHit[] {
  const starred = new Set<string>();
  for (const name of starredFullNames) {
    if (typeof name === 'string' && name) starred.add(name.toLowerCase());
  }
  return hits.filter((hit) => starred.has(hit.repo.toLowerCase()));
}

/**
 * 最小化消毒：DOMParser 允许名单实现，仅保留 pygments highlight-table
 * 排版与 `<mark>` 高亮所需的标签，剥离其余元素（保留子节点文本）与全部属性。
 * 不引入 DOMPurify 新依赖，避免包体积变化。仅运行于浏览器/jsdom 环境。
 */
export function sanitizeGrepSnippet(html: string): string {
  if (!html) return '';
  const allowed = new Set([
    'TABLE', 'TBODY', 'THEAD', 'TR', 'TD', 'DIV',
    'PRE', 'SPAN', 'MARK', 'BR', 'CODE',
  ]);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // 可执行/样式元素连内容整体移除，避免解包后残留脚本正文
  doc.querySelectorAll('script, style').forEach((el) => el.remove());

  const sanitizeChildren = (parent: Element): void => {
    for (const child of Array.from(parent.children)) {
      sanitizeChildren(child);
      if (!allowed.has(child.tagName)) {
        // 非允许名单元素：解包保留子节点（文本/高亮）后移除
        child.replaceWith(...Array.from(child.childNodes));
        continue;
      }
      // 允许名单元素：剥离全部属性（含 on* 事件与 javascript: 伪协议）
      for (const attr of Array.from(child.attributes)) {
        child.removeAttribute(attr.name);
      }
    }
  };

  sanitizeChildren(doc.body);
  return doc.body.innerHTML;
}
