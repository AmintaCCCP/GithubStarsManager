import { describe, expect, it, vi } from 'vitest';
import type { Repository } from '../types';
import type { GitHubApiService, GitHubRepoDetailRead } from './githubApi';
import type { AIService } from './aiService';
import {
  aggregateRecall,
  buildRecallRegex,
  escapeRe2Literal,
  searchRepositoriesSemantically,
} from './semanticRepoSearchService';
import type { GrepSearchResult } from './grepAppService';

// ---------- 测试数据工厂 ----------

const grepResult = (partial: Partial<GrepSearchResult> & { total: number }): GrepSearchResult => ({
  repoFacets: partial.repoFacets ?? [],
  pathFacets: [],
  langFacets: [],
  hits: partial.hits ?? [],
  total: partial.total,
});

const hit = (repo: string, path: string, language = 'TypeScript') => ({
  repo,
  branch: 'main',
  path,
  language,
  totalMatches: '1',
  snippetHtml: '',
});

/** 以 grep.app 原始 API 形状返回可被 searchGrepApp 消费的伪 Response。 */
const grepResponse = (result: GrepSearchResult) => ({
  ok: true,
  status: 200,
  json: async () => ({
    facets: {
      count: result.total,
      repo: { buckets: result.repoFacets.map(bucket => ({ val: bucket.val, count: bucket.count })) },
      path: { buckets: [] },
      lang: { buckets: [] },
    },
    hits: {
      total: result.total,
      hits: result.hits.map(item => ({
        repo: item.repo,
        branch: item.branch,
        path: item.path,
        language: item.language,
        total_matches: item.totalMatches,
        content: { snippet: '' },
      })),
    },
  }),
});

const rateLimitedResponse = () => ({ ok: false, status: 429 });

/** 队列式 grep fetch 桩：记录每次请求 URL，按顺序弹出响应（或抛错）。 */
const installGrepFetch = (responses: Array<Record<string, unknown> | Error>) => {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | RequestInfo) => {
    const urlText = String(url);
    calls.push(urlText);
    const next = responses.shift();
    if (!next) throw new Error(`unexpected grep fetch: ${urlText}`);
    if (next instanceof Error) throw next;
    return next as unknown as Response;
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
};

/** URLSearchParams 把空格编码为 +，decodeURIComponent 不还原，先替换再解码。 */
const decodeUrl = (url: string): string => decodeURIComponent(url.replace(/\+/g, ' '));

const makeDetail = (fullName: string, id: number, language: string | null = 'TypeScript'): GitHubRepoDetailRead => ({
  id,
  name: fullName.split('/')[1] ?? fullName,
  full_name: fullName,
  description: `desc of ${fullName}`,
  html_url: `https://github.com/${fullName}`,
  stargazers_count: 100,
  forks_count: 1,
  forks: 1,
  language,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-06-01T00:00:00Z',
  pushed_at: '2024-06-01T00:00:00Z',
  topics: [],
  owner: { login: fullName.split('/')[0] ?? 'owner', avatar_url: '' },
  license: null,
  archived: false,
  disabled: false,
  fork: false,
  is_template: false,
  open_issues_count: 0,
  default_branch: 'main',
});

/** GitHub API 桩：默认 GraphQL 全命中，可覆盖两个方法。 */
const makeApi = (overrides: {
  graphql?: ReturnType<typeof vi.fn>;
  rest?: ReturnType<typeof vi.fn>;
} = {}) => {
  const graphqlFetchRepositories = overrides.graphql ?? vi.fn(async (fullNames: string[], options?: { onBatchDone?: (done: number, total: number) => void }) => {
    options?.onBatchDone?.(1, 1);
    return new Map(fullNames.map((name, index) => [name.toLowerCase(), makeDetail(name, 1000 + index)]));
  });
  const getRepositoryDetails = overrides.rest ?? vi.fn(async (owner: string, repo: string) => makeDetail(`${owner}/${repo}`, 2000));
  return { graphqlFetchRepositories, getRepositoryDetails } as unknown as GitHubApiService;
};

/** AIService 桩：默认扩展返回空、精选按候选原序返回。 */
const makeAi = (behavior: {
  expand?: (query: string) => Promise<{ terms: string[]; intent: string }>;
  select?: (candidates: Repository[], query: string, intent: string, signal?: AbortSignal, evidence?: Map<string, string>) => Promise<Repository[] | null>;
} = {}) => {
  const expandSearchQuery = vi.fn(behavior.expand ?? (async () => ({ terms: [], intent: '' })));
  const selectRelevantRepositories = vi.fn(behavior.select ?? (async (candidates: Repository[]) => candidates.slice(0, 20)));
  return { expandSearchQuery, selectRelevantRepositories } as unknown as AIService & {
    expandSearchQuery: ReturnType<typeof vi.fn>;
    selectRelevantRepositories: ReturnType<typeof vi.fn>;
  };
};

// ---------- 纯函数 ----------

describe('semanticRepoSearchService — escapeRe2Literal', () => {
  it('转义全部 RE2 元字符', () => {
    expect(escapeRe2Literal('a.b+c*d?e(f)g|h[i]j{k}l^m$n\\o')).toBe('a\\.b\\+c\\*d\\?e\\(f\\)g\\|h\\[i\\]j\\{k\\}l\\^m\\$n\\\\o');
  });

  it('普通字符保持原样', () => {
    expect(escapeRe2Literal('abc-123_测试')).toBe('abc-123_测试');
  });
});

describe('semanticRepoSearchService — buildRecallRegex', () => {
  it('query 优先、大小写不敏感去重', () => {
    expect(buildRecallRegex('React', ['react', 'Vue'])).toBe('(?:React|Vue)');
  });

  it('长度窗口：空白与超长（>60）成员被剔除', () => {
    expect(buildRecallRegex('   ', [])).toBeNull();
    expect(buildRecallRegex('a'.repeat(61), ['ok'])).toBe('(?:ok)');
    expect(buildRecallRegex('ok', ['b'.repeat(61)])).toBe('(?:ok)');
  });

  it('成员上限 6 个', () => {
    const regex = buildRecallRegex('q0', ['t1', 't2', 't3', 't4', 't5', 't6', 't7']);
    expect(regex).toBe('(?:q0|t1|t2|t3|t4|t5)');
  });

  it('成员逐个转义后拼接', () => {
    expect(buildRecallRegex('a.b', ['c+d'])).toBe('(?:a\\.b|c\\+d)');
  });

  it('无有效成员返回 null', () => {
    expect(buildRecallRegex('', [])).toBeNull();
  });
});

describe('semanticRepoSearchService — aggregateRecall', () => {
  it('count 以 repoFacets 求和为准；仅出现在 hits 的仓库按出现次数计', () => {
    const result = aggregateRecall([
      grepResult({ total: 10, repoFacets: [{ val: 'a/b', count: 7 }], hits: [hit('a/b', 'x.ts'), hit('c/d', 'y.md')] }),
      grepResult({ total: 5, repoFacets: [{ val: 'A/B', count: 3 }], hits: [hit('c/d', 'z.md')] }),
    ]);
    // a/b 的 facets 计数跨结果求和，hits 不叠加
    expect(result.get('a/b')).toMatchObject({ count: 10 });
    // c/d 无 facet 计数，按出现次数（2 次）计
    expect(result.get('c/d')).toMatchObject({ count: 2 });
  });

  it('大小写不敏感合并同一仓库；paths 去重且 ≤3、langs 取自 hits', () => {
    const result = aggregateRecall([
      grepResult({
        total: 6,
        repoFacets: [{ val: 'Owner/Repo', count: 6 }],
        hits: [
          hit('owner/repo', 'README.md'),
          hit('owner/repo', 'README.md'),
          hit('owner/repo', 'package.json'),
          hit('owner/repo', 'src/a.ts'),
          hit('owner/repo', 'src/b.ts'),
        ],
      }),
    ]);
    const entry = result.get('owner/repo');
    expect(entry).toBeDefined();
    expect(entry?.count).toBe(6);
    expect(entry?.paths).toEqual(['README.md', 'package.json', 'src/a.ts']);
    expect([...(entry?.langs ?? [])]).toEqual(['TypeScript']);
  });
});

// ---------- 管道 ----------

describe('semanticRepoSearchService — searchRepositoriesSemantically', () => {
  it('空查询直接返回空结果，不发起任何请求', async () => {
    const api = makeApi();
    const ai = makeAi();
    const { fetchImpl } = installGrepFetch([]);
    const result = await searchRepositoriesSemantically(api, ai, '   ', { fetchImpl });
    expect(result).toEqual({ repos: [], hasMore: false, nextPageIndex: 1, totalCount: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(ai.expandSearchQuery).not.toHaveBeenCalled();
  });

  it('单次正则交替查询（regexp=true），映射 channel/platform 并按 AI 顺序赋 rank，携带召回证据', async () => {
    const selectMock = vi.fn(async (candidates: Repository[]) => [...candidates].reverse());
    const ai = makeAi({
      expand: async () => ({ terms: ['editor'], intent: '找 markdown 编辑器' }),
      select: selectMock,
    });
    const { fetchImpl, calls } = installGrepFetch([
      grepResponse(grepResult({
        total: 2,
        repoFacets: [
          { val: 'a/md-tool', count: 5 },
          { val: 'b/other', count: 2 },
        ],
        hits: [hit('a/md-tool', 'README.md'), hit('a/md-tool', 'package.json'), hit('b/other', 'src/x.ts')],
      })),
    ]);
    const result = await searchRepositoriesSemantically(makeApi(), ai, 'markdown editor', { fetchImpl });

    // grep 恰好 1 次请求，且确为正则模式
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(calls[0]).toContain('regexp=true');
    expect(decodeUrl(calls[0])).toContain('(?:markdown editor|editor)');

    // AI 返回倒序 → 按序赋 rank
    expect(result.repos.map(repo => repo.full_name)).toEqual(['b/other', 'a/md-tool']);
    expect(result.repos.map(repo => repo.rank)).toEqual([1, 2]);
    expect(result.repos.every(repo => repo.channel === 'search' && repo.platform === 'All')).toBe(true);
    expect(result).toMatchObject({ hasMore: false, nextPageIndex: 1, totalCount: 2 });

    // 精选调用携带意图与证据（键为 full_name 小写，值语言中性）
    const selectArgs = selectMock.mock.calls[0] as unknown as [Repository[], string, string, AbortSignal | undefined, Map<string, string>];
    const evidence = selectArgs[4];
    expect(selectArgs[2]).toBe('找 markdown 编辑器');
    expect(evidence.get('a/md-tool')).toBe('matches=5; paths=README.md,package.json; langs=TypeScript');
    expect(evidence.get('b/other')).toBe('matches=2; paths=src/x.ts; langs=TypeScript');
  });

  it('正则 total===0 → 逐词 fuzzy 回退 ≤3 次（query 优先）', async () => {
    const ai = makeAi({ expand: async () => ({ terms: ['cli', 'note'], intent: '' }) });
    const emptyGrep = grepResponse(grepResult({ total: 0 }));
    const { fetchImpl, calls } = installGrepFetch([emptyGrep, emptyGrep, emptyGrep, emptyGrep]);
    await searchRepositoriesSemantically(makeApi(), ai, 'markdown notes', { fetchImpl });

    // 1 次正则 + 3 次 fuzzy（markdown notes / cli / note）
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(decodeUrl(calls[0])).toContain('(?:markdown notes|cli|note)');
    expect(calls[0]).toContain('regexp=true');
    expect(calls.slice(1).every(url => !url.includes('regexp=true'))).toBe(true);
    expect(decodeUrl(calls[1])).toContain('q=markdown notes');
  });

  it('首个请求 429 → 立即重抛且不做任何回退', async () => {
    const ai = makeAi();
    const { fetchImpl, calls } = installGrepFetch([rateLimitedResponse(), rateLimitedResponse()]);
    await expect(searchRepositoriesSemantically(makeApi(), ai, 'markdown', { fetchImpl })).rejects.toMatchObject({ status: 429 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
  });

  it('翻页停止条件：无余量（hits>=total）只查 1 页', async () => {
    const ai = makeAi();
    const { fetchImpl } = installGrepFetch([
      grepResponse(grepResult({ total: 2, repoFacets: [{ val: 'a/b', count: 2 }], hits: [hit('a/b', 'x'), hit('a/b', 'y')] })),
    ]);
    await searchRepositoriesSemantically(makeApi(), ai, 'kw', { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('翻页停止条件：页数上限 3 页', async () => {
    const ai = makeAi();
    const page = () => grepResponse(grepResult({ total: 100, hits: [hit('a/b', 'x'), hit('a/b', 'y')] }));
    const { fetchImpl, calls } = installGrepFetch([page(), page(), page(), page()]);
    await searchRepositoriesSemantically(makeApi(), ai, 'kw', { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(calls[1]).toContain('page=2');
    expect(calls[2]).toContain('page=3');
  });

  it('翻页停止条件：唯一仓库 ≥60 时停止翻页', async () => {
    const ai = makeAi();
    const facets = Array.from({ length: 60 }, (_, i) => ({ val: `owner/repo-${i}`, count: 1 }));
    const { fetchImpl } = installGrepFetch([
      grepResponse(grepResult({ total: 100, repoFacets: facets, hits: [hit('owner/repo-0', 'x')] })),
    ]);
    await searchRepositoriesSemantically(makeApi(), ai, 'kw', { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('召回为空（全部查询零命中）→ recall_empty 空结果', async () => {
    const ai = makeAi({ expand: async () => ({ terms: [], intent: '' }) });
    const emptyGrep = grepResponse(grepResult({ total: 0 }));
    const { fetchImpl } = installGrepFetch([emptyGrep, emptyGrep]);
    const onFallback = vi.fn();
    const onPhase = vi.fn();
    const result = await searchRepositoriesSemantically(makeApi(), ai, 'kw', { fetchImpl, onFallback, onPhase });
    expect(result.repos).toEqual([]);
    expect(onFallback).toHaveBeenCalledWith('recall_empty');
    // 召回为空时管道止步，不进入补全/精选
    expect(onPhase).toHaveBeenCalledWith('recalling');
    expect(onPhase).not.toHaveBeenCalledWith('enriching');
  });

  it('查询扩展失败（非 abort）→ terms=[] 继续走 grep 词法召回', async () => {
    const ai = makeAi({ expand: async () => { throw new Error('ai down'); } });
    const { fetchImpl, calls } = installGrepFetch([
      grepResponse(grepResult({ total: 1, repoFacets: [{ val: 'a/b', count: 1 }] })),
    ]);
    const result = await searchRepositoriesSemantically(makeApi(), ai, 'a.b', { fetchImpl });
    // 仅原始查询（已转义）参与正则
    expect(decodeUrl(calls[0])).toContain('(?:a\\.b)');
    expect(result.repos.map(repo => repo.full_name)).toEqual(['a/b']);
  });

  it('GraphQL 成功路径：null 跳过、id===0 跳过、补全进度上报', async () => {
    const graphql = vi.fn(async (_fullNames: string[], options?: { onBatchDone?: (done: number, total: number) => void }) => {
      options?.onBatchDone?.(1, 1);
      return new Map<string, GitHubRepoDetailRead | null>([
        ['a/ok', makeDetail('a/ok', 11)],
        ['b/null', null],
        ['c/zero', makeDetail('c/zero', 0)],
      ]);
    });
    const onPhase = vi.fn();
    const { fetchImpl } = installGrepFetch([
      grepResponse(grepResult({
        total: 3,
        repoFacets: [{ val: 'a/ok', count: 3 }, { val: 'b/null', count: 2 }, { val: 'c/zero', count: 1 }],
      })),
    ]);
    const result = await searchRepositoriesSemantically(makeApi({ graphql }), makeAi(), 'kw', { fetchImpl, onPhase });
    expect(result.repos.map(repo => repo.full_name)).toEqual(['a/ok']);
    // enriching 阶段带 N/N 计数
    expect(onPhase).toHaveBeenCalledWith('enriching', '3/3');
    // 四个阶段依次上报（enriching 先无计数上报、再由 onBatchDone 带 N/N 计数上报）
    expect([...new Set(onPhase.mock.calls.map(call => call[0]))]).toEqual(['expanding', 'recalling', 'enriching', 'reranking']);
  });

  it('GraphQL 整批抛错 → REST 逐仓回退（并发执行、404/403 跳过）', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const rest = vi.fn(async (owner: string, repo: string) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(resolve => setTimeout(resolve, 5));
      inFlight -= 1;
      if (repo === 'gone') throw new Error('GitHub API error: 404 Not Found');
      if (repo === 'forbid') throw new Error('GitHub API error: 403 Forbidden');
      return makeDetail(`${owner}/${repo}`, 3000);
    });
    const graphql = vi.fn(async () => { throw new Error('GraphQL batch failed: empty data'); });
    const names = ['a/ok1', 'a/gone', 'a/forbid', 'a/ok2', 'a/ok3', 'a/ok4', 'a/ok5', 'a/ok6', 'a/ok7'];
    const { fetchImpl } = installGrepFetch([
      grepResponse(grepResult({ total: names.length, repoFacets: names.map((name, i) => ({ val: name, count: names.length - i })) })),
    ]);
    const result = await searchRepositoriesSemantically(makeApi({ graphql, rest }), makeAi(), 'kw', { fetchImpl });

    expect(rest).toHaveBeenCalledTimes(names.length);
    // 并发 8：9 个仓库时最大在途 ≥8
    expect(maxInFlight).toBeGreaterThanOrEqual(8);
    expect(result.repos.map(repo => repo.full_name).sort()).toEqual(['a/ok1', 'a/ok2', 'a/ok3', 'a/ok4', 'a/ok5', 'a/ok6', 'a/ok7']);
  });

  it('语言过滤：过滤后 ≥10 使用过滤结果', async () => {
    const names = Array.from({ length: 12 }, (_, i) => `o/r${i}`);
    const graphql = vi.fn(async () => new Map<string, GitHubRepoDetailRead | null>(
      names.map((name, i) => [name.toLowerCase(), makeDetail(name, 4000 + i, i === 0 ? 'Python' : 'TypeScript')]),
    ));
    const select = vi.fn(async (candidates: Repository[]) => candidates);
    const ai = makeAi({ select });
    const { fetchImpl } = installGrepFetch([
      grepResponse(grepResult({ total: names.length, repoFacets: names.map(name => ({ val: name, count: 1 })) })),
    ]);
    const result = await searchRepositoriesSemantically(makeApi({ graphql }), ai, 'kw', { fetchImpl, language: 'TypeScript' });
    // 1 个 Python 被过滤，剩 11 个进入精选
    expect(select.mock.calls[0][0]).toHaveLength(11);
    expect(result.repos).toHaveLength(11);
  });

  it('语言过滤：过滤后 <10 放弃过滤，交给 LLM 全量精选', async () => {
    const names = Array.from({ length: 12 }, (_, i) => `o/r${i}`);
    const graphql = vi.fn(async () => new Map<string, GitHubRepoDetailRead | null>(
      names.map((name, i) => [name.toLowerCase(), makeDetail(name, 5000 + i, i < 9 ? 'Python' : 'TypeScript')]),
    ));
    const select = vi.fn(async (candidates: Repository[]) => candidates);
    const ai = makeAi({ select });
    const { fetchImpl } = installGrepFetch([
      grepResponse(grepResult({ total: names.length, repoFacets: names.map(name => ({ val: name, count: 1 })) })),
    ]);
    await searchRepositoriesSemantically(makeApi({ graphql }), ai, 'kw', { fetchImpl, language: 'TypeScript' });
    // 过滤后仅 3 个（<10）：放弃过滤，全量 12 个交给精选
    expect(select.mock.calls[0][0]).toHaveLength(12);
  });

  it('语言过滤映射 CSharp→C#（大小写不敏感）', async () => {
    const names = ['o/a', 'o/b', 'o/c', 'o/d', 'o/e', 'o/f', 'o/g', 'o/h', 'o/i', 'o/j', 'o/k'];
    const graphql = vi.fn(async () => new Map<string, GitHubRepoDetailRead | null>(
      names.map((name, i) => [name.toLowerCase(), makeDetail(name, 6000 + i, i === 0 ? 'Go' : 'C#')]),
    ));
    const select = vi.fn(async (candidates: Repository[]) => candidates);
    const ai = makeAi({ select });
    const { fetchImpl } = installGrepFetch([
      grepResponse(grepResult({ total: names.length, repoFacets: names.map(name => ({ val: name, count: 1 })) })),
    ]);
    const result = await searchRepositoriesSemantically(makeApi({ graphql }), ai, 'kw', { fetchImpl, language: 'CSharp' });
    // 1 个 Go 被过滤，剩 10 个 C# ≥10 → 使用过滤结果
    expect(result.repos).toHaveLength(10);
  });

  it('重排分支：AI 数组按序赋 rank 且 ≤20', async () => {
    const names = Array.from({ length: 25 }, (_, i) => `o/r${i}`);
    const graphql = vi.fn(async () => new Map<string, GitHubRepoDetailRead | null>(
      names.map((name, i) => [name.toLowerCase(), makeDetail(name, 7000 + i)]),
    ));
    const select = vi.fn(async (candidates: Repository[]) => [...candidates].reverse());
    const ai = makeAi({ select });
    const { fetchImpl } = installGrepFetch([
      grepResponse(grepResult({ total: names.length, repoFacets: names.map((name, i) => ({ val: name, count: names.length - i })) })),
    ]);
    const result = await searchRepositoriesSemantically(makeApi({ graphql }), ai, 'kw', { fetchImpl });
    expect(result.repos).toHaveLength(20);
    expect(result.repos.map(repo => repo.rank)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(result.repos[0].full_name).toBe('o/r24');
  });

  it('重排分支：AI 返回 [] → ai_empty 空结果', async () => {
    const select = vi.fn(async () => []);
    const ai = makeAi({ select });
    const onFallback = vi.fn();
    const { fetchImpl } = installGrepFetch([
      grepResponse(grepResult({ total: 1, repoFacets: [{ val: 'a/b', count: 1 }] })),
    ]);
    const result = await searchRepositoriesSemantically(makeApi(), ai, 'kw', { fetchImpl, onFallback });
    expect(onFallback).toHaveBeenCalledWith('ai_empty');
    expect(result.repos).toEqual([]);
    expect(result.totalCount).toBe(0);
  });

  it('重排分支：AI 返回 null → unparseable + 按命中数降序兜底', async () => {
    const select = vi.fn(async () => null);
    const ai = makeAi({ select });
    const onFallback = vi.fn();
    const { fetchImpl } = installGrepFetch([
      grepResponse(grepResult({ total: 2, repoFacets: [{ val: 'a/small', count: 1 }, { val: 'b/big', count: 9 }] })),
    ]);
    const result = await searchRepositoriesSemantically(makeApi(), ai, 'kw', { fetchImpl, onFallback });
    expect(onFallback).toHaveBeenCalledWith('unparseable');
    expect(result.repos.map(repo => repo.full_name)).toEqual(['b/big', 'a/small']);
    expect(result.repos.map(repo => repo.rank)).toEqual([1, 2]);
  });

  it('重排分支：AI 抛错（非 abort）→ ai_failed + 按命中数降序兜底', async () => {
    const select = vi.fn(async () => { throw new Error('ai endpoint down'); });
    const ai = makeAi({ select });
    const onFallback = vi.fn();
    const { fetchImpl } = installGrepFetch([
      grepResponse(grepResult({ total: 2, repoFacets: [{ val: 'a/small', count: 1 }, { val: 'b/big', count: 9 }] })),
    ]);
    const result = await searchRepositoriesSemantically(makeApi(), ai, 'kw', { fetchImpl, onFallback });
    expect(onFallback).toHaveBeenCalledWith('ai_failed');
    expect(result.repos.map(repo => repo.full_name)).toEqual(['b/big', 'a/small']);
  });

  it('重排分支：abort 重抛且不产出兜底结果', async () => {
    const select = vi.fn(async () => {
      throw Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
    });
    const ai = makeAi({ select });
    const onFallback = vi.fn();
    const { fetchImpl } = installGrepFetch([
      grepResponse(grepResult({ total: 1, repoFacets: [{ val: 'a/b', count: 1 }] })),
    ]);
    await expect(searchRepositoriesSemantically(makeApi(), ai, 'kw', { fetchImpl, onFallback }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(onFallback).not.toHaveBeenCalled();
  });
});
