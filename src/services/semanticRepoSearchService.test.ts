import { describe, expect, it, vi } from 'vitest';
import type { Repository } from '../types';
import type { GitHubApiService, GitHubRepoDetailRead } from './githubApi';
import type { AIService, RepoSearchQuery } from './aiService';
import {
  __resetGithubSearchPacingForTest,
  aggregateRecall,
  assembleGithubQuery,
  buildRecallRegex,
  buildSpecificRecallRegex,
  escapeRe2Literal,
  runGithubSearchRecall,
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
const grepResponse = (result: GrepSearchResult) => grepRawResponse(result, true);

/**
 * Markdown 域（带 f.lang）实测响应形状：服务端缺 facets.count 字段，
 * normalizeGrepSearchResponse 回落 hits.total。
 */
const markdownGrepResponse = (result: GrepSearchResult) => grepRawResponse(result, false);

const grepRawResponse = (result: GrepSearchResult, withFacetCount: boolean) => ({
  ok: true,
  status: 200,
  json: async () => ({
    facets: {
      ...(withFacetCount ? { count: result.total } : {}),
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

const makeSearchRepo = (fullName: string, stars: number): Repository => ({
  ...makeDetail(fullName, stars + 100),
  stargazers_count: stars,
});

/** GitHub API 桩：默认 GraphQL 全命中，可覆盖两个方法。 */
const makeApi = (overrides: {
  graphql?: ReturnType<typeof vi.fn>;
  rest?: ReturnType<typeof vi.fn>;
  rawSearch?: ReturnType<typeof vi.fn>;
} = {}) => {
  const graphqlFetchRepositories = overrides.graphql ?? vi.fn(async (fullNames: string[], options?: { onBatchDone?: (done: number, total: number) => void }) => {
    options?.onBatchDone?.(1, 1);
    return new Map(fullNames.map((name, index) => [name.toLowerCase(), makeDetail(name, 1000 + index)]));
  });
  const getRepositoryDetails = overrides.rest ?? vi.fn(async (owner: string, repo: string) => makeDetail(`${owner}/${repo}`, 2000));
  const searchRepositoriesRaw = overrides.rawSearch ?? vi.fn(async () => []);
  return { graphqlFetchRepositories, getRepositoryDetails, searchRepositoriesRaw } as unknown as GitHubApiService;
};

/** AIService 桩：默认扩展返回空、精选按候选原序返回。 */
const makeAi = (behavior: {
  expand?: (query: string) => Promise<{ terms: string[]; intent: string }>;
  generateQueries?: (query: string, intent: string) => Promise<RepoSearchQuery[]>;
  select?: (candidates: Repository[], query: string, intent: string, signal?: AbortSignal, evidence?: Map<string, string>) => Promise<Repository[] | null>;
} = {}) => {
  const expandSearchQuery = vi.fn(behavior.expand ?? (async () => ({ terms: [], intent: '' })));
  const generateRepoSearchQueries = vi.fn(behavior.generateQueries ?? (async () => []));
  const selectRelevantRepositories = vi.fn(behavior.select ?? (async (candidates: Repository[]) => candidates.slice(0, 20)));
  return { expandSearchQuery, generateRepoSearchQueries, selectRelevantRepositories } as unknown as AIService & {
    expandSearchQuery: ReturnType<typeof vi.fn>;
    generateRepoSearchQueries: ReturnType<typeof vi.fn>;
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

  it('长度窗口：空白与超长（>60）成员被剔除（2 字符术语另受具体性门槛约束，见下）', () => {
    expect(buildRecallRegex('   ', [])).toBeNull();
    expect(buildRecallRegex('a'.repeat(61), ['okm'])).toBe('(?:okm)');
    expect(buildRecallRegex('ok', ['b'.repeat(61)])).toBe('(?:ok)');
  });

  it('成员上限 6 个（术语需 ≥3 字符拉丁词以通过具体性门槛）', () => {
    const regex = buildRecallRegex('q0', ['t01', 't02', 't03', 't04', 't05', 't06', 't07']);
    expect(regex).toBe('(?:q0|t01|t02|t03|t04|t05)');
  });

  it('成员逐个转义后拼接', () => {
    expect(buildRecallRegex('a.b', ['c+d'])).toBe('(?:a\\.b|c\\+d)');
  });

  it('无有效成员返回 null', () => {
    expect(buildRecallRegex('', [])).toBeNull();
  });

  it('总长预算 64：长 query + 多术语贪心纳入，超预算成员被跳过后继续尝试更短成员', () => {
    const regex = buildRecallRegex('terminal file manager', ['file manager', 'filemanager', 'explorer', 'alternative', 'tui']);
    // alternative（加入后 71>64）被跳过，更短的 tui（加入后恰好 64≤64）仍被纳入
    expect(regex).toBe('(?:terminal file manager|file manager|filemanager|explorer|tui)');
    expect(regex?.length ?? 0).toBeLessThanOrEqual(64);
  });

  it('总长预算按转义后长度计算：30 个点号恰好 64 字符保留，31 个点号单独超限剔除', () => {
    // '.'.repeat(30) 转义后 60 字符，(?:…) 共 64 字符，恰好卡线保留
    expect(buildRecallRegex('.'.repeat(30), [])).toBe(`(?:${'\\.'.repeat(30)})`);
    // '.'.repeat(31) 转义后 62 字符，(?:…) 共 66 > 64 → 剔除；后续具体成员正常纳入
    expect(buildRecallRegex('.'.repeat(31), ['yazi'])).toBe('(?:yazi)');
  });

  it('总长预算：单个超长成员被剔除后其余成员正常', () => {
    expect(buildRecallRegex('.'.repeat(40), ['yazi', 'okm'])).toBe('(?:yazi|okm)');
  });

  it('术语具体性：<3 字符拉丁术语剔除、2 字符 CJK 术语保留、query 不受约束', () => {
    expect(buildRecallRegex('main query', ['mc', 'go', '翻译', 'tokyo'])).toBe('(?:main query|翻译|tokyo)');
    // query 成员（即使 <3 字符拉丁词）不受具体性规则影响，不破坏单词搜索
    expect(buildRecallRegex('go', ['golang', 'mc'])).toBe('(?:go|golang)');
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

describe('semanticRepoSearchService — assembleGithubQuery', () => {
  it('清理 GitHub 语法、映射 scope 并全局去重', () => {
    const queries: RepoSearchQuery[] = [
      { terms: ['"(terminal)"', 'file:manager'], scope: 'metadata' },
      { terms: ['password vault'], scope: 'metadata' },
      { terms: ['todo', 'task'], scope: 'readme' },
      { terms: ['password vault'], scope: 'metadata' },
      { terms: ['sync engine'], scope: 'any' },
    ];
    expect(assembleGithubQuery(queries)).toEqual([
      'terminal file manager in:name,description,topics',
      'password vault in:name,description,topics',
      'todo task in:readme',
      'sync engine',
    ]);
  });

  it('丢弃超 3 词、全泛词、非法 scope 的条目；少于 3 条有效查询返回 null', () => {
    const queries = [
      { terms: ['one two three four'], scope: 'metadata' },
      { terms: ['cli', 'tool'], scope: 'readme' },
      { terms: ['valid'], scope: 'invalid' },
      { terms: ['terminal file manager'], scope: 'metadata' },
      { terms: ['password vault'], scope: 'readme' },
    ] as unknown as RepoSearchQuery[];
    expect(assembleGithubQuery(queries)).toBeNull();
  });

  it('最多保留 5 条有效查询', () => {
    const queries: RepoSearchQuery[] = Array.from({ length: 6 }, (_, i) => ({
      terms: [`topic${i} term${i}`],
      scope: i % 2 === 0 ? 'metadata' : 'readme',
    }));
    expect(assembleGithubQuery(queries)).toHaveLength(5);
  });

  it('丢弃含布尔运算符（NOT/AND/OR）或 -/+ 前缀词的整条查询', () => {
    const queries: RepoSearchQuery[] = [
      { terms: ['password NOT vault'], scope: 'metadata' },
      { terms: ['todo OR task'], scope: 'metadata' },
      { terms: ['-vault'], scope: 'metadata' },
      { terms: ['+sync'], scope: 'readme' },
      { terms: ['password vault'], scope: 'metadata' },
      { terms: ['password sync'], scope: 'metadata' },
      { terms: ['vault readme'], scope: 'readme' },
    ];
    expect(assembleGithubQuery(queries)).toEqual([
      'password vault in:name,description,topics',
      'password sync in:name,description,topics',
      'vault readme in:readme',
    ]);
  });

  it('缺少 2 条 metadata 或 1 条 readme 时返回 null', () => {
    const queries: RepoSearchQuery[] = [
      { terms: ['terminal manager'], scope: 'metadata' },
      { terms: ['file browser'], scope: 'metadata' },
      { terms: ['terminal sync'], scope: 'any' },
    ];
    expect(assembleGithubQuery(queries)).toBeNull();
  });

  it('传入用户词时只保留至少命中一个主题词的查询', () => {
    const queries: RepoSearchQuery[] = [
      { terms: ['terminal file manager'], scope: 'metadata' },
      { terms: ['password vault'], scope: 'metadata' },
      { terms: ['terminal sync'], scope: 'metadata' },
      { terms: ['file browser'], scope: 'readme' },
    ];
    expect(assembleGithubQuery(queries, 'terminal file manager')).toEqual([
      'terminal file manager in:name,description,topics',
      'terminal sync in:name,description,topics',
      'file browser in:readme',
    ]);
  });

  it('用户词按标点拆分：todo/task 能匹配 todo 或 task', () => {
    const queries: RepoSearchQuery[] = [
      { terms: ['todo manager'], scope: 'metadata' },
      { terms: ['task sync'], scope: 'metadata' },
      { terms: ['task list'], scope: 'readme' },
    ];
    expect(assembleGithubQuery(queries, 'todo/task')).toEqual([
      'todo manager in:name,description,topics',
      'task sync in:name,description,topics',
      'task list in:readme',
    ]);
  });

  it('截断前优先保留 metadata/readme，避免前 5 条全是 any', () => {
    const queries: RepoSearchQuery[] = [
      ...Array.from({ length: 5 }, (_, i) => ({ terms: [`any${i} word${i}`], scope: 'any' as const })),
      { terms: ['meta one'], scope: 'metadata' as const },
      { terms: ['meta two'], scope: 'metadata' as const },
      { terms: ['read me'], scope: 'readme' as const },
    ];
    const result = assembleGithubQuery(queries);
    expect(result).toHaveLength(5);
    expect(result).toEqual(expect.arrayContaining([
      'meta one in:name,description,topics',
      'meta two in:name,description,topics',
      'read me in:readme',
    ]));
  });
});

describe('semanticRepoSearchService — runGithubSearchRecall', () => {
  const generated: RepoSearchQuery[] = [
    { terms: ['terminal file manager'], scope: 'metadata' },
    { terms: ['terminal manager'], scope: 'metadata' },
    { terms: ['file manager'], scope: 'readme' },
  ];

  it('串行查询、按 full_name 去重、star 降序并截断 60，同时记录查询证据', async () => {
    __resetGithubSearchPacingForTest();
    let clock = 1_000_000;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    try {
    const first = Array.from({ length: 25 }, (_, i) => makeSearchRepo(`o/a-${i}`, 100 + i));
    const second = [
      ...Array.from({ length: 25 }, (_, i) => makeSearchRepo(`o/b-${i}`, 200 + i)),
      makeSearchRepo('O/A-0', 9999),
    ];
    const third = Array.from({ length: 25 }, (_, i) => makeSearchRepo(`o/c-${i}`, 50 + i));
    const rawSearch = vi.fn(async (...args: Parameters<GitHubApiService['searchRepositoriesRaw']>) => {
      void args;
      return [] as Repository[];
    })
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second)
      .mockResolvedValueOnce(third);
    const sleepImpl = vi.fn(async (ms: number) => { clock += ms; });
    const ai = makeAi({ generateQueries: async () => generated });

    const result = await runGithubSearchRecall('terminal file manager', 'find a TUI file manager', {
      api: makeApi({ rawSearch }),
      aiService: ai,
      sleepImpl,
    });

    expect(rawSearch).toHaveBeenCalledTimes(3);
    expect(rawSearch.mock.calls.map(call => call[0])).toEqual([
      'terminal file manager in:name,description,topics',
      'terminal manager in:name,description,topics',
      'file manager in:readme',
    ]);
    expect(rawSearch.mock.calls.every(call => call[1] === 25)).toBe(true);
    expect(sleepImpl).toHaveBeenCalledTimes(2);
    expect(sleepImpl.mock.calls.every(call => call[0] === 2100)).toBe(true);
    expect(result.aggregation.size).toBe(60);
    expect([...result.aggregation.values()][0]).toMatchObject({ repo: 'o/b-24', count: 224 });
    expect(result.aggregation.get('o/a-0')).toMatchObject({ repo: 'o/a-0', count: 100 });
    expect(result.evidence.get('o/a-0')).toBe('gh_search=terminal file manager in:name,description,topics');
    } finally {
      nowSpy.mockRestore();
      __resetGithubSearchPacingForTest();
    }
  });

  it('单条查询失败跳过，其余查询继续', async () => {
    const rawSearch = vi.fn()
      .mockRejectedValueOnce(new Error('GitHub API error: 500 Internal Server Error'))
      .mockResolvedValueOnce([makeSearchRepo('o/ok-1', 10)])
      .mockResolvedValueOnce([makeSearchRepo('o/ok-2', 20)]);
    const ai = makeAi({ generateQueries: async () => generated });

    const result = await runGithubSearchRecall('q', '', {
      api: makeApi({ rawSearch }),
      aiService: ai,
      sleepImpl: async () => {},
    });
    expect(rawSearch).toHaveBeenCalledTimes(3);
    expect([...result.aggregation.keys()]).toEqual(['o/ok-2', 'o/ok-1']);
  });

  it('全部查询失败时抛错；真实限流立即上抛，普通 403 视作可跳过', async () => {
    const allFailed = vi.fn(async () => { throw new Error('GitHub API error: 500 Internal Server Error'); });
    await expect(runGithubSearchRecall('q', '', {
      api: makeApi({ rawSearch: allFailed }),
      aiService: makeAi({ generateQueries: async () => generated }),
      sleepImpl: async () => {},
    })).rejects.toThrow(/all recall requests failed/);

    // 普通 403（权限/代理拒绝）不是配额信号：按失败跳过，全部失败后聚合上抛
    const forbidden = vi.fn(async () => { throw new Error('GitHub API error: 403 Forbidden'); });
    await expect(runGithubSearchRecall('q', '', {
      api: makeApi({ rawSearch: forbidden }),
      aiService: makeAi({ generateQueries: async () => generated }),
      sleepImpl: async () => {},
    })).rejects.toThrow(/all recall requests failed/);
    expect(forbidden).toHaveBeenCalledTimes(3);

    for (const message of ['GitHub API error: 429 Too Many Requests', 'GitHub API rate limit exceeded. Resets at 2030/1/1']) {
      const limited = vi.fn(async () => { throw new Error(message); });
      await expect(runGithubSearchRecall('q', '', {
        api: makeApi({ rawSearch: limited }),
        aiService: makeAi({ generateQueries: async () => generated }),
        sleepImpl: async () => {},
      })).rejects.toThrow(message);
      expect(limited).toHaveBeenCalledTimes(1);
    }
  });

  it('查询生成解析失败返回空池且不发起 GitHub 请求；abort 向上传播', async () => {
    const rawSearch = vi.fn(async () => []);
    const empty = await runGithubSearchRecall('q', '', {
      api: makeApi({ rawSearch }),
      aiService: makeAi({ generateQueries: async () => [] }),
    });
    expect(empty.aggregation.size).toBe(0);
    expect(rawSearch).not.toHaveBeenCalled();

    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    await expect(runGithubSearchRecall('q', '', {
      api: makeApi({ rawSearch }),
      aiService: makeAi({ generateQueries: async () => { throw abort; } }),
    })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('abort 等待时回滚未使用的节流时隙', async () => {
    __resetGithubSearchPacingForTest();
    let clock = 1_000_000;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    try {
      let sleepCalls = 0;
      const abortingSleep = vi.fn(async (ms: number) => {
        sleepCalls += 1;
        if (sleepCalls === 1) {
          clock += ms;
          return;
        }
        throw new DOMException('Aborted', 'AbortError');
      });
      await expect(runGithubSearchRecall('terminal file manager', '', {
        api: makeApi({ rawSearch: vi.fn(async () => []) }),
        aiService: makeAi({ generateQueries: async () => generated }),
        sleepImpl: abortingSleep,
      })).rejects.toMatchObject({ name: 'AbortError' });

      const nextSleep = vi.fn(async (ms: number) => { clock += ms; });
      await runGithubSearchRecall('terminal file manager', '', {
        api: makeApi({ rawSearch: vi.fn(async () => []) }),
        aiService: makeAi({ generateQueries: async () => generated }),
        sleepImpl: nextSleep,
      });
      // 不回滚时会残留第三个未发送请求的时隙，首个等待会变成 4200ms。
      expect(nextSleep.mock.calls[0][0]).toBe(2100);
    } finally {
      nowSpy.mockRestore();
      __resetGithubSearchPacingForTest();
    }
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

  it('GitHub Search 有结果时不走 grep，重排证据使用 gh_search=<query>', async () => {
    const generated: RepoSearchQuery[] = [
      { terms: ['terminal file manager'], scope: 'metadata' },
      { terms: ['terminal manager'], scope: 'metadata' },
      { terms: ['file manager'], scope: 'readme' },
    ];
    const rawSearch = vi.fn()
      .mockResolvedValueOnce([
        makeSearchRepo('o/github-a', 10),
        makeSearchRepo('o/github-b', 20),
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const select = vi.fn(async (...args: Parameters<AIService['selectRelevantRepositories']>) => args[0]);
    const ai = makeAi({
      expand: async () => ({ terms: ['editor'], intent: 'find a terminal file manager' }),
      generateQueries: async () => generated,
      select,
    });
    const { fetchImpl } = installGrepFetch([]);

    const result = await searchRepositoriesSemantically(makeApi({ rawSearch }), ai, 'terminal file manager', {
      fetchImpl,
      githubSleepImpl: async () => {},
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(rawSearch).toHaveBeenCalledTimes(3);
    expect(result.repos.map(repo => repo.full_name)).toEqual(['o/github-b', 'o/github-a']);
    const evidence = select.mock.calls[0][4] as Map<string, string>;
    expect(evidence.get('o/github-b')).toBe('gh_search=terminal file manager in:name,description,topics');
    expect(evidence.get('o/github-a')).toBe('gh_search=terminal file manager in:name,description,topics');
  });

  it('GitHub Search 空池或非限流失败时回退 grep.app，并保留旧 evidence 格式', async () => {
    const generated: RepoSearchQuery[] = [
      { terms: ['terminal file manager'], scope: 'metadata' },
      { terms: ['terminal manager'], scope: 'metadata' },
      { terms: ['file manager'], scope: 'readme' },
    ];
    const emptyGithub = vi.fn(async () => []);
    const emptySelect = vi.fn(async (...args: Parameters<AIService['selectRelevantRepositories']>) => args[0]);
    const { fetchImpl } = installGrepFetch([
      grepResponse(grepResult({
        total: 1,
        repoFacets: [{ val: 'grep/result', count: 3 }],
        hits: [hit('grep/result', 'README.md')],
      })),
    ]);
    const result = await searchRepositoriesSemantically(
      makeApi({ rawSearch: emptyGithub }),
      makeAi({ generateQueries: async () => generated, select: emptySelect }),
      'terminal file manager',
      { fetchImpl, githubSleepImpl: async () => {} },
    );
    expect(emptyGithub).toHaveBeenCalledTimes(3);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(emptySelect.mock.calls[0][4]!.get('grep/result')).toBe('matches=3; paths=README.md; langs=TypeScript');
    expect(result.repos.map(repo => repo.full_name)).toEqual(['grep/result']);

    const failedGithub = vi.fn(async () => { throw new Error('GitHub API error: 500 Internal Server Error'); });
    const { fetchImpl: fallbackFetch } = installGrepFetch([
      grepResponse(grepResult({
        total: 1,
        repoFacets: [{ val: 'grep/fallback', count: 1 }],
        hits: [hit('grep/fallback', 'README.md')],
      })),
    ]);
    const fallbackResult = await searchRepositoriesSemantically(
      makeApi({ rawSearch: failedGithub }),
      makeAi({ generateQueries: async () => generated }),
      'terminal file manager',
      { fetchImpl: fallbackFetch, githubSleepImpl: async () => {} },
    );
    expect(failedGithub).toHaveBeenCalledTimes(3);
    expect(fallbackResult.repos.map(repo => repo.full_name)).toEqual(['grep/fallback']);
  });

  it('GitHub Search 403/429（限流或拒绝）时回退 grep.app，不中止搜索', async () => {
    const generated: RepoSearchQuery[] = [
      { terms: ['terminal file manager'], scope: 'metadata' },
      { terms: ['terminal manager'], scope: 'metadata' },
      { terms: ['file manager'], scope: 'readme' },
    ];
    for (const message of ['GitHub API error: 403 Forbidden', 'GitHub API error: 429 Too Many Requests']) {
      const limited = vi.fn(async () => { throw new Error(message); });
      const { fetchImpl } = installGrepFetch([
        grepResponse(grepResult({
          total: 1,
          repoFacets: [{ val: 'grep/fallback', count: 1 }],
          hits: [hit('grep/fallback', 'README.md')],
        })),
      ]);
      const result = await searchRepositoriesSemantically(
        makeApi({ rawSearch: limited }),
        makeAi({ generateQueries: async () => generated }),
        'terminal file manager',
        { fetchImpl, githubSleepImpl: async () => {} },
      );
      expect(fetchImpl).toHaveBeenCalled();
      expect(result.repos.map(repo => repo.full_name)).toEqual(['grep/fallback']);
    }
  });

  it('GitHub 召回补全后全被过滤 → 回退 grep.app 重新补全', async () => {
    const generated: RepoSearchQuery[] = [
      { terms: ['terminal file manager'], scope: 'metadata' },
      { terms: ['terminal manager'], scope: 'metadata' },
      { terms: ['file manager'], scope: 'readme' },
    ];
    const rawSearch = vi.fn()
      .mockResolvedValueOnce([makeSearchRepo('o/gh-a', 10)])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const graphql = vi.fn(async (fullNames: string[]) => new Map<string, GitHubRepoDetailRead | null>(
      fullNames.map(name => [name.toLowerCase(), name.startsWith('o/gh-') ? null : makeDetail(name, 500)]),
    ));
    const { fetchImpl } = installGrepFetch([
      grepResponse(grepResult({
        total: 1,
        repoFacets: [{ val: 'grep/result', count: 2 }],
        hits: [hit('grep/result', 'README.md')],
      })),
    ]);
    const onFallback = vi.fn();
    const result = await searchRepositoriesSemantically(
      makeApi({ rawSearch, graphql }),
      makeAi({ generateQueries: async () => generated }),
      'terminal file manager',
      { fetchImpl, githubSleepImpl: async () => {}, onFallback },
    );
    expect(rawSearch).toHaveBeenCalledTimes(3);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(graphql).toHaveBeenCalledTimes(2);
    expect(result.repos.map(repo => repo.full_name)).toEqual(['grep/result']);
    expect(onFallback).not.toHaveBeenCalledWith('recall_empty');
  });

  it('GraphQL 429（无 statusText）按限流上抛，不回退 REST', async () => {
    const generated: RepoSearchQuery[] = [
      { terms: ['terminal file manager'], scope: 'metadata' },
      { terms: ['terminal manager'], scope: 'metadata' },
      { terms: ['file manager'], scope: 'readme' },
    ];
    const rawSearch = vi.fn(async () => [makeSearchRepo('o/gh-a', 10)]);
    const graphql = vi.fn(async () => { throw new Error('GitHub API error: 429'); });
    const rest = vi.fn(async () => makeDetail('o/gh-a', 1));
    await expect(searchRepositoriesSemantically(
      makeApi({ rawSearch, graphql, rest }),
      makeAi({ generateQueries: async () => generated }),
      'terminal file manager',
      { githubSleepImpl: async () => {} },
    )).rejects.toThrow('GitHub API error: 429');
    expect(rest).not.toHaveBeenCalled();
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

    // grep 恰好 1 次请求，且确为 Markdown 域优先的正则模式
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(calls[0]).toContain('regexp=true');
    expect(calls[0]).toContain('f.lang=Markdown');
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

  it('Markdown 优先：md 正则 total===0（缺 facets.count 回落 hits.total）→ 回退 fuzzy 且不带 f.lang=Markdown', async () => {
    const ai = makeAi({ expand: async () => ({ terms: ['cli', 'note'], intent: '' }) });
    const { fetchImpl, calls } = installGrepFetch([
      markdownGrepResponse(grepResult({ total: 0 })),
      grepResponse(grepResult({ total: 0 })),
      grepResponse(grepResult({ total: 0 })),
      grepResponse(grepResult({ total: 0 })),
    ]);
    await searchRepositoriesSemantically(makeApi(), ai, 'markdown notes', { fetchImpl });

    // 首个正则请求带 f.lang=Markdown（实测带 f.lang 的响应缺 facets.count，total 回落 hits.total）
    expect(calls[0]).toContain('f.lang=Markdown');
    expect(decodeUrl(calls[0])).toContain('(?:markdown notes|cli|note)');
    // md 正则零命中 → 1 次正则 + 3 次 fuzzy；fuzzy 回退不带语言过滤仍查全库
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(calls.slice(1).every(url => !url.includes('f.lang=Markdown') && !url.includes('regexp=true'))).toBe(true);
    expect(decodeUrl(calls[1])).toContain('q=markdown notes');
  });

  it('术语具体性同步应用于 fuzzy 回退：<3 字符拉丁术语不发起回退请求', async () => {
    const ai = makeAi({ expand: async () => ({ terms: ['mc', 'go', 'note'], intent: '' }) });
    const emptyGrep = grepResponse(grepResult({ total: 0 }));
    const { fetchImpl, calls } = installGrepFetch([emptyGrep, emptyGrep, emptyGrep]);
    await searchRepositoriesSemantically(makeApi(), ai, 'markdown notes', { fetchImpl });

    // 正则成员剔除 mc/go；fuzzy 回退仅 markdown notes / note 两个词（共 3 次请求）
    expect(decodeUrl(calls[0])).toContain('(?:markdown notes|note)');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(decodeUrl(calls[1])).toContain('q=markdown notes');
    expect(decodeUrl(calls[2])).toContain('q=note');
    expect(calls.slice(1).every(url => !decodeUrl(url).includes('q=mc') && !decodeUrl(url).includes('q=go'))).toBe(true);
  });

  it('Markdown 正则首个请求 429 → 立即重抛且不做任何回退', async () => {
    const ai = makeAi();
    const { fetchImpl, calls } = installGrepFetch([rateLimitedResponse(), rateLimitedResponse()]);
    await expect(searchRepositoriesSemantically(makeApi(), ai, 'markdown', { fetchImpl })).rejects.toMatchObject({ status: 429 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
    // Markdown 优先召回：首个（正则）请求即带 f.lang=Markdown
    expect(calls[0]).toContain('f.lang=Markdown');
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

  it('重排分支：AI 返回 [] → ai_empty 上报 + 按池序词法兜底（不清空结果）', async () => {
    const select = vi.fn(async () => []);
    const ai = makeAi({ select });
    const onFallback = vi.fn();
    const { fetchImpl } = installGrepFetch([
      grepResponse(grepResult({ total: 2, repoFacets: [{ val: 'a/small', count: 1 }, { val: 'b/big', count: 9 }] })),
    ]);
    const result = await searchRepositoriesSemantically(makeApi(), ai, 'kw', { fetchImpl, onFallback });
    expect(onFallback).toHaveBeenCalledWith('ai_empty');
    expect(result.repos.map(repo => repo.full_name)).toEqual(['b/big', 'a/small']);
    expect(result.repos.map(repo => repo.rank)).toEqual([1, 2]);
    expect(result.totalCount).toBe(2);
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

  it('#494 实测回归：噪声候选池 + 模型判空 → 仍返回词法兜底结果（辅路命中优先）而非空数组', async () => {
    // 复刻真实抓包 case（openai账号注册机）：召回池 22 个里 4 个直接对口
    // （GPT-Register-Tool 等），旧过滤式提示词下模型全部返回 []、最终展示为空。
    // 服务层修复：判空不清空结果，按池序（辅路命中优先、并集计数降序）兜底。
    const noise = Array.from({ length: 20 }, (_, i) => ({ val: `noise/repo-${i}`, count: 100 - i }));
    const fetchImpl = vi.fn(async (input: string | URL | RequestInfo) => {
      const q = decodeURIComponent(String(input).replace(/\+/g, ' '));
      if (q.includes('openai')) {
        // 主路并集正则（query + 术语）：大量噪声 + 直接对口仓库
        return grepResponse(grepResult({
          total: 21,
          repoFacets: [...noise, { val: 'acme/gpt-register-tool', count: 6 }],
          hits: [hit('noise/repo-0', 'docs/a.md')],
        })) as unknown as Response;
      }
      // 辅路高具体性正则（仅 CJK 术语）：只有对口仓库命中
      return grepResponse(grepResult({
        total: 1,
        repoFacets: [{ val: 'acme/gpt-register-tool', count: 1 }],
        hits: [hit('acme/gpt-register-tool', 'README.md')],
      })) as unknown as Response;
    });
    const select = vi.fn(async () => []);
    const ai = makeAi({ expand: async () => ({ terms: ['注册机'], intent: '批量注册 OpenAI 账号的工具' }), select });
    const onFallback = vi.fn();
    const result = await searchRepositoriesSemantically(makeApi(), ai, 'openai账号注册机', { fetchImpl, onFallback });
    expect(onFallback).toHaveBeenCalledWith('ai_empty');
    expect(result.repos.length).toBe(20);
    expect(result.repos[0].full_name).toBe('acme/gpt-register-tool');
    expect(result.repos[1].full_name).toBe('noise/repo-0');
    expect(result.totalCount).toBe(20);
  });
});

describe('semanticRepoSearchService — REST 回退限流处理', () => {
  it('REST 回退遇 GitHub 限流（rate limit exceeded）→ 重抛，不产出残缺候选结果', async () => {
    const graphql = vi.fn(async () => { throw new Error('GraphQL batch failed: empty data'); });
    const rest = vi.fn(async () => { throw new Error('GitHub API error: 403 rate limit exceeded'); });
    const ai = makeAi();
    const onFallback = vi.fn();
    const { fetchImpl } = installGrepFetch([
      grepResponse(grepResult({ total: 2, repoFacets: [{ val: 'a/b', count: 2 }, { val: 'c/d', count: 1 }] })),
    ]);
    await expect(searchRepositoriesSemantically(makeApi({ graphql, rest }), ai, 'kw', { fetchImpl, onFallback }))
      .rejects.toThrow(/rate limit exceeded/);
    // 限流不能被吞成"仓库不可用"：不允许拿着残缺候选集继续走重排兜底
    expect(onFallback).not.toHaveBeenCalled();
    expect(rest).toHaveBeenCalledTimes(2);
  });
});

describe('semanticRepoSearchService — 翻页 facets 与 REST 限流停机（CodeRabbit 二轮意见回归）', () => {
  it('同一查询翻页时 repoFacets 不被重复累加（facets 是全局分布，仅首页有效）', async () => {
    const selectEvidence = new Map<string, string>();
    const aiWithCapture = makeAi({
      select: async (candidates, _query, _intent, _signal, evidence) => {
        for (const [key, value] of evidence ?? []) selectEvidence.set(key, value);
        return candidates;
      },
    });
    const page = () => grepResponse(grepResult({
      total: 10,
      repoFacets: [{ val: 'a/b', count: 5 }],
      hits: [hit('a/b', 'x')],
    }));
    const { fetchImpl } = installGrepFetch([page(), page(), page(), page()]);
    await searchRepositoriesSemantically(makeApi(), aiWithCapture, 'kw', { fetchImpl });
    // 翻到第 3 页，若每页 facets 都累加会得到 15；正确行为是只认首页的 5
    expect(selectEvidence.get('a/b')).toBe('matches=5; paths=x; langs=TypeScript');
  });

  it('REST 限流触发停止标志：其余 worker 不再从队列取仓库烧配额', async () => {
    const names = Array.from({ length: 30 }, (_, i) => `o/r${i}`);
    const graphql = vi.fn(async () => { throw new Error('GraphQL batch failed: empty data'); });
    const rest = vi.fn(async (owner: string, repo: string) => {
      if (repo === 'r0') throw new Error('GitHub API error: 403 rate limit exceeded');
      await new Promise(resolve => setTimeout(resolve, 20));
      return makeDetail(`${owner}/${repo}`, 9000);
    });
    const { fetchImpl } = installGrepFetch([
      grepResponse(grepResult({ total: 1, repoFacets: names.map(name => ({ val: name, count: 1 })), hits: [hit('o/r0', 'x')] })),
    ]);
    await expect(searchRepositoriesSemantically(makeApi({ graphql, rest }), makeAi(), 'kw', { fetchImpl }))
      .rejects.toThrow(/rate limit exceeded/);
    // 并发 8：首个 worker 命中限流即停机，最多 8 个在途请求；未修复时会打满 30 个
    expect(rest.mock.calls.length).toBeLessThanOrEqual(8);
  });
});

describe('semanticRepoSearchService — 召回故障语义（CodeRabbit 三轮意见回归）', () => {
  it('GraphQL 批量限流 → 直接上抛，不回退 REST（避免共用限流退避长时间阻塞）', async () => {
    const graphql = vi.fn(async () => { throw new Error('GitHub API error: 403 rate limit exceeded'); });
    const rest = vi.fn(async () => makeDetail('a/b', 1));
    const { fetchImpl } = installGrepFetch([
      grepResponse(grepResult({ total: 1, repoFacets: [{ val: 'a/b', count: 1 }] })),
    ]);
    await expect(searchRepositoriesSemantically(makeApi({ graphql, rest }), makeAi(), 'kw', { fetchImpl }))
      .rejects.toThrow(/rate limit exceeded/);
    expect(rest).not.toHaveBeenCalled();
  });

  it('正则与全部 fuzzy 回退都失败 → 上抛错误而非谎报零命中（不产出 recall_empty）', async () => {
    const ai = makeAi({ expand: async () => ({ terms: ['cli', 'note'], intent: '' }) });
    const networkError = new Error('Code search request failed: 503');
    const { fetchImpl } = installGrepFetch([networkError, networkError, networkError, networkError]);
    const onFallback = vi.fn();
    await expect(searchRepositoriesSemantically(makeApi(), ai, 'kw', { fetchImpl, onFallback }))
      .rejects.toThrow(/all recall requests failed/);
    expect(onFallback).not.toHaveBeenCalled();
  });

  it('部分成功（正则失败、任一 fuzzy 成功）→ 正常召回，不受全失败上抛影响', async () => {
    const ai = makeAi({ expand: async () => ({ terms: ['cli'], intent: '' }) });
    const { fetchImpl } = installGrepFetch([
      new Error('Code search request failed: 503'),
      grepResponse(grepResult({ total: 1, repoFacets: [{ val: 'a/b', count: 2 }] })),
    ]);
    const result = await searchRepositoriesSemantically(makeApi(), ai, 'kw', { fetchImpl });
    expect(result.repos.map(repo => repo.full_name)).toEqual(['a/b']);
  });

  it('fuzzy 回退按语言类别轮流选词：跨语言代表词不被同语言词挤出名额', async () => {
    const ai = makeAi({ expand: async () => ({
      terms: ['深度学习', '模型训练', 'machine learning', 'llm framework'],
      intent: '',
    }) });
    const emptyGrep = grepResponse(grepResult({ total: 0 }));
    const { fetchImpl, calls } = installGrepFetch([emptyGrep, emptyGrep, emptyGrep, emptyGrep]);
    await searchRepositoriesSemantically(makeApi(), ai, '机器学习框架', { fetchImpl });

    // 名额 3：query + 每个语言类别各一个代表词（而非前两个中文词占满）
    expect(decodeUrl(calls[1])).toContain('q=机器学习框架');
    expect(decodeUrl(calls[2])).toContain('q=深度学习');
    expect(decodeUrl(calls[3])).toContain('q=machine learning');
  });
});

describe('semanticRepoSearchService — 未发起请求的边界（CodeRabbit 四轮意见回归）', () => {
  it('查询超长且扩展无可用词 → 一次请求都不发起，按 recall_empty 处理而非抛服务故障', async () => {
    const ai = makeAi({ expand: async () => ({ terms: [], intent: '' }) });
    const onFallback = vi.fn();
    const { fetchImpl } = installGrepFetch([]);
    const result = await searchRepositoriesSemantically(makeApi(), ai, 'a'.repeat(61), { fetchImpl, onFallback });
    expect(result.repos).toEqual([]);
    expect(onFallback).toHaveBeenCalledWith('recall_empty');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('semanticRepoSearchService — 高具体性辅路召回（用户实测"经常没有结果"回归）', () => {
  it('泛词并集命中 5 万+ 时，命中罕见词的相关仓库排进池顶（真实 case：junk 973 次 vs 相关 2 次+辅路命中）', async () => {
    // 真实 HAR 场景：并集（含 desktop app/github stars 等泛词）在 Markdown 域 53934 命中，
    // junk 仓库 973 次刷进池顶，相关仓库只命中 2 次；辅路只查 CJK 罕见词，相关仓库命中
    const fetchImpl = vi.fn(async (input: string | URL | RequestInfo) => {
      const url = String(input);
      const page = url.includes('page=') ? Number(url.match(/page=(\d+)/)?.[1] ?? 1) : 1;
      const q = decodeURIComponent(url.replace(/\+/g, ' '));
      if (!q.includes('desktop app')) {
        // 辅路：仅 CJK 罕见词——相关仓库高分命中，junk 不命中
        return grepResponse(grepResult({
          total: 6,
          repoFacets: [{ val: 'good/star-manager', count: 6 }],
          hits: [hit('good/star-manager', 'README.md')],
        })) as unknown as Response;
      }
      if (page === 1) {
        return grepResponse(grepResult({
          total: 53934,
          repoFacets: [
            { val: 'junk/windows-use', count: 973 },
            { val: 'good/star-manager', count: 2 },
          ],
          hits: [hit('junk/windows-use', 'docs/app.md')],
        })) as unknown as Response;
      }
      // 翻页页：同样 junk
      return grepResponse(grepResult({
        total: 53934,
        repoFacets: [{ val: 'junk/more', count: 500 }],
        hits: [hit('junk/more', 'docs/x.md')],
      })) as unknown as Response;
    });
    const select = vi.fn(async (candidates: Repository[]) => candidates);
    const aiSpy = makeAi({ expand: async () => ({ terms: ['github星标', 'github stars', '桌面端应用', 'desktop app'], intent: '' }), select });
    const result = await searchRepositoriesSemantically(makeApi(), aiSpy, '管理github星标仓库的桌面端应用', { fetchImpl, language: 'All' });
    // 相关仓库（命中 CJK 罕见词，并集计数仅 2）必须排到 junk（973 次）之前
    // select 桩原样返回全部候选，junk 会在结果中，断言相对顺序：
    // 相关仓库（命中 CJK 罕见词，并集计数仅 2）必须排到 junk（973 次）之前
    const names = result.repos.map(r => r.full_name);
    expect(names[0]).toBe('good/star-manager');
    expect(names.indexOf('good/star-manager')).toBeLessThan(names.indexOf('junk/windows-use'));
  });

  it('辅路查询失败（非 429）不影响主路召回', async () => {
    const ai = makeAi({ expand: async () => ({ terms: ['划词翻译', 'translate'], intent: '' }) });
    const { fetchImpl } = installGrepFetch([
      grepResponse(grepResult({ total: 2, repoFacets: [{ val: 'a/b', count: 2 }] })),
      new Error('Code search request failed: 500'),
    ]);
    const result = await searchRepositoriesSemantically(makeApi(), ai, '划词翻译', { fetchImpl });
    expect(result.repos.map(repo => repo.full_name)).toEqual(['a/b']);
  });
});

describe('semanticRepoSearchService — buildSpecificRecallRegex', () => {
  it('优先取 CJK 成员；无 CJK 时取最长多词短语；均无则返回 null', () => {
    expect(buildSpecificRecallRegex(['github stars', '桌面端应用', 'desktop app', '仓库管理'])).toBe('(?:桌面端应用|仓库管理)');
    expect(buildSpecificRecallRegex(['ranger', 'terminal file manager', 'yazi'])).toBe('(?:terminal file manager)');
    expect(buildSpecificRecallRegex(['ranger', 'yazi'])).toBeNull();
    // 预算内贪心：CJK 成员过多时按 64 字符截断不报错
    const long = buildSpecificRecallRegex(Array.from({ length: 8 }, (_, i) => `中文词表第${i}项`));
    expect(long?.startsWith('(?:')).toBe(true);
    expect(long!.length).toBeLessThanOrEqual(64);
  });
});
