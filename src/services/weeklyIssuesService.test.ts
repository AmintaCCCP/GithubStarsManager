import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GitHubApiService, GitHubIssueListRead, GitHubRepoDetailRead } from './githubApi';
import {
  extractRepoFullNames,
  processWeeklyIssue,
  selectReposToEnrich,
  buildWeeklyDiscoveryRepos,
  syncWeeklyChannel,
  fetchWeeklyIssueBody,
  hasCollectedLabel,
} from './weeklyIssuesService';
import type { WeeklyStoredIssue, WeeklyStoredRepo } from './weeklyIssuesStorage';

// 内存版存储替身（jsdom 无 IndexedDB）：验证 syncWeeklyChannel 的分页/缓存复用语义
const storage = vi.hoisted(() => {
  const issuesStore = new Map<number, unknown>();
  const reposStore = new Map<string, unknown>();
  let lastSyncedAt: string | null = null;
  return {
    issuesStore,
    reposStore,
    get lastSyncedAt() { return lastSyncedAt; },
    setLastSyncedAt(v: string | null) { lastSyncedAt = v; },
    reset() {
      issuesStore.clear();
      reposStore.clear();
      lastSyncedAt = null;
    },
  };
});

vi.mock('./weeklyIssuesStorage', () => ({
  weeklyIssuesStorage: {
    saveIssues: async (issues: Array<{ number: number }>) => {
      for (const issue of issues) storage.issuesStore.set(issue.number, issue);
    },
    getAllIssues: async () => new Map(storage.issuesStore) as Map<number, never>,
    getIssue: async (number: number) => storage.issuesStore.get(number) ?? null,
    saveRepos: async (repos: Array<{ fullName: string }>) => {
      for (const repo of repos) storage.reposStore.set(repo.fullName.toLowerCase(), repo);
    },
    getAllRepos: async () => new Map(storage.reposStore) as Map<string, never>,
    getSyncMeta: async () => ({ lastSyncedAt: storage.lastSyncedAt }),
    saveSyncMeta: async (meta: { lastSyncedAt: string | null }) => {
      storage.setLastSyncedAt(meta.lastSyncedAt);
    },
    clearAll: async () => storage.reset(),
  },
}));

const makeIssue = (overrides: Partial<GitHubIssueListRead> & { number: number }): GitHubIssueListRead => ({
  title: '【开源自荐】some tool',
  state: 'open',
  html_url: `https://github.com/ruanyf/weekly/issues/${overrides.number}`,
  body: '项目地址：https://github.com/foo/bar',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  labels: [],
  isPullRequest: false,
  ...overrides,
});

const makeDetail = (fullName: string, stars = 10): GitHubRepoDetailRead => ({
  id: 42,
  name: fullName.split('/')[1],
  full_name: fullName,
  description: 'a repo',
  html_url: `https://github.com/${fullName}`,
  stargazers_count: stars,
  forks_count: 3,
  forks: 3,
  language: 'TypeScript',
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  pushed_at: '2026-01-02T00:00:00Z',
  topics: ['cli'],
  owner: { login: fullName.split('/')[0], avatar_url: `https://github.com/${fullName.split('/')[0]}.png` },
  license: 'MIT',
});

describe('extractRepoFullNames', () => {
  it('extracts plain repo urls and dedupes', () => {
    const body = '项目地址：https://github.com/foo/bar\n备用：https://github.com/foo/bar';
    expect(extractRepoFullNames(body)).toEqual(['foo/bar']);
  });

  it('strips subpaths, www prefix and .git suffix', () => {
    expect(extractRepoFullNames('see https://www.github.com/foo/bar/tree/main/docs')).toEqual(['foo/bar']);
    expect(extractRepoFullNames('git clone https://github.com/foo/bar.git')).toEqual(['foo/bar']);
    expect(extractRepoFullNames('https://github.com/foo/bar/blob/master/README.md')).toEqual(['foo/bar']);
  });

  it('excludes user-attachments, site paths and the weekly repo itself', () => {
    const body = [
      '![img](https://github.com/user-attachments/assets/abcd-1234)',
      'https://github.com/features/codespaces',
      'https://github.com/ruanyf/weekly/issues/1',
      '项目：https://github.com/real/one',
    ].join('\n');
    expect(extractRepoFullNames(body)).toEqual(['real/one']);
  });

  it('returns empty for null/empty body and tolerates trailing CJK punctuation', () => {
    expect(extractRepoFullNames(null)).toEqual([]);
    expect(extractRepoFullNames('')).toEqual([]);
    expect(extractRepoFullNames('仓库：https://github.com/foo/bar。欢迎试用')).toEqual(['foo/bar']);
  });

  it('strips trailing ascii periods but preserves legal trailing hyphens', () => {
    expect(extractRepoFullNames('https://github.com/foo/bar.')).toEqual(['foo/bar']);
    expect(extractRepoFullNames('https://github.com/foo/bar...')).toEqual(['foo/bar']);
    expect(extractRepoFullNames('https://github.com/foo/bar-')).toEqual(['foo/bar-']);
    expect(extractRepoFullNames('https://github.com/foo/.')).toEqual([]);
  });
});

describe('processWeeklyIssue', () => {
  it('skips pull requests, off-topic titles and link-less bodies', () => {
    const issues = new Map<number, WeeklyStoredIssue>();
    const repos = new Map<string, WeeklyStoredRepo>();
    const changedIssues = new Set<number>();
    const changedRepos = new Set<string>();

    expect(processWeeklyIssue(makeIssue({ number: 1, isPullRequest: true }), issues, repos, changedIssues, changedRepos)).toBe(false);
    expect(processWeeklyIssue(makeIssue({ number: 2, title: '【文章推荐】weekly blog' }), issues, repos, changedIssues, changedRepos)).toBe(false);
    expect(processWeeklyIssue(makeIssue({ number: 3, body: '看这里 https://example.com/x' }), issues, repos, changedIssues, changedRepos)).toBe(false);
    expect(issues.size).toBe(0);
    expect(repos.size).toBe(0);
  });

  it('stores matched issues and repo entries keyed by lowercased full_name', () => {
    const issues = new Map<number, WeeklyStoredIssue>();
    const repos = new Map<string, WeeklyStoredRepo>();
    const changedIssues = new Set<number>();
    const changedRepos = new Set<string>();

    expect(processWeeklyIssue(makeIssue({ number: 10, body: 'https://github.com/Foo/Bar' }), issues, repos, changedIssues, changedRepos)).toBe(true);
    expect(issues.get(10)?.repoFullNames).toEqual(['foo/bar']);
    expect(repos.get('foo/bar')?.fullName).toBe('Foo/Bar');
    expect(repos.get('foo/bar')?.sourceIssueNumber).toBe(10);
  });

  it('keeps the newest issue as the source post and refreshes labels of the source issue', () => {
    const issues = new Map<number, WeeklyStoredIssue>();
    const repos = new Map<string, WeeklyStoredRepo>();
    const changedIssues = new Set<number>();
    const changedRepos = new Set<string>();

    processWeeklyIssue(makeIssue({ number: 1, created_at: '2026-01-01T00:00:00Z', labels: [] }), issues, repos, changedIssues, changedRepos);
    processWeeklyIssue(makeIssue({ number: 2, created_at: '2026-02-01T00:00:00Z', labels: ['weekly'] }), issues, repos, changedIssues, changedRepos);
    expect(repos.get('foo/bar')?.sourceIssueNumber).toBe(2);
    expect(repos.get('foo/bar')?.issueLabels).toEqual(['weekly']);

    // 同一原贴 label 补加（issue 编辑后 updated_at 变化）
    processWeeklyIssue(makeIssue({ number: 2, updated_at: '2026-02-05T00:00:00Z', labels: ['weekly', 'issue-300'] }), issues, repos, changedIssues, changedRepos);
    expect(repos.get('foo/bar')?.issueLabels).toEqual(['weekly', 'issue-300']);
  });

  it('fast-skips issues whose updated_at is unchanged', () => {
    const issues = new Map<number, WeeklyStoredIssue>();
    const repos = new Map<string, WeeklyStoredRepo>();
    const changedIssues = new Set<number>();
    const changedRepos = new Set<string>();

    processWeeklyIssue(makeIssue({ number: 1 }), issues, repos, changedIssues, changedRepos);
    const before = changedIssues.size;
    processWeeklyIssue(makeIssue({ number: 1 }), issues, repos, changedIssues, changedRepos);
    expect(changedIssues.size).toBe(before);
  });
});

describe('selectReposToEnrich', () => {
  const repo = (overrides: Partial<WeeklyStoredRepo>): WeeklyStoredRepo => ({
    fullName: 'foo/bar',
    detail: null,
    lastFetchedAt: '',
    sourceIssueNumber: 1,
    issueLabels: [],
    issueCreatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  });

  it('only enqueues never-fetched repos', () => {
    const repos = new Map<string, WeeklyStoredRepo>([
      ['a/a', repo({ fullName: 'a/a', lastFetchedAt: '2026-06-01T00:00:00Z', detail: makeDetail('a/a') })],
      ['b/b', repo({ fullName: 'b/b' })],
    ]);
    const result = selectReposToEnrich(repos, Date.parse('2026-07-01T00:00:00Z'));
    expect(result.map(r => r.fullName)).toEqual(['b/b']);
  });

  it('caps stale refreshes and retries unavailable repos only after TTL', () => {
    const now = Date.parse('2026-07-01T00:00:00Z');
    const repos = new Map<string, WeeklyStoredRepo>([
      ['stale/stale', repo({
        fullName: 'stale/stale',
        lastFetchedAt: '2026-01-01T00:00:00Z',
        detail: makeDetail('stale/stale'),
        issueCreatedAt: '2026-05-01T00:00:00Z',
      })],
      ['dead/dead', repo({
        fullName: 'dead/dead',
        lastFetchedAt: '2026-06-28T00:00:00Z', // 3 天前，未到 7 天重试期
        detail: null,
      })],
    ]);
    const result = selectReposToEnrich(repos, now);
    expect(result.map(r => r.fullName)).toEqual(['stale/stale']);
  });
});

describe('buildWeeklyDiscoveryRepos', () => {
  it('sorts by submission time desc, assigns ranks and skips un-enriched repos', () => {
    const issues = new Map<number, WeeklyStoredIssue>([
      [1, { number: 1, title: 'old', body: null, labels: [], state: 'open', createdAt: '2026-01-01T00:00:00Z', updatedAt: '', htmlUrl: 'u1', repoFullNames: ['a/a'] }],
      [2, { number: 2, title: 'new', body: null, labels: ['weekly'], state: 'open', createdAt: '2026-02-01T00:00:00Z', updatedAt: '', htmlUrl: 'u2', repoFullNames: ['b/b'] }],
    ]);
    const repos = new Map<string, WeeklyStoredRepo>([
      ['a/a', { fullName: 'a/a', detail: makeDetail('a/a'), lastFetchedAt: '2026-06-01T00:00:00Z', sourceIssueNumber: 1, issueLabels: [], issueCreatedAt: '2026-01-01T00:00:00Z' }],
      ['b/b', { fullName: 'b/b', detail: makeDetail('b/b'), lastFetchedAt: '2026-06-01T00:00:00Z', sourceIssueNumber: 2, issueLabels: ['weekly'], issueCreatedAt: '2026-02-01T00:00:00Z' }],
      ['c/c', { fullName: 'c/c', detail: null, lastFetchedAt: '', sourceIssueNumber: 3, issueLabels: [], issueCreatedAt: '2026-03-01T00:00:00Z' }],
    ]);

    const list = buildWeeklyDiscoveryRepos(repos, issues, false);
    expect(list.map(r => r.full_name)).toEqual(['b/b', 'a/a']);
    expect(list.map(r => r.rank)).toEqual([1, 2]);
    expect(list[0].weeklyIssue?.number).toBe(2);
    expect(list[0].channel).toBe('weekly');
  });

  it('filters by weekly-collected label when onlyCollected is on', () => {
    const issues = new Map<number, WeeklyStoredIssue>();
    const repos = new Map<string, WeeklyStoredRepo>([
      ['a/a', { fullName: 'a/a', detail: makeDetail('a/a'), lastFetchedAt: 'x', sourceIssueNumber: 1, issueLabels: ['weekly'], issueCreatedAt: '2026-01-01T00:00:00Z' }],
      ['b/b', { fullName: 'b/b', detail: makeDetail('b/b'), lastFetchedAt: 'x', sourceIssueNumber: 2, issueLabels: [], issueCreatedAt: '2026-02-01T00:00:00Z' }],
    ]);
    expect(buildWeeklyDiscoveryRepos(repos, issues, true).map(r => r.full_name)).toEqual(['a/a']);
    expect(buildWeeklyDiscoveryRepos(repos, issues, false).length).toBe(2);
  });

  it('detects the collected label case-insensitively', () => {
    expect(hasCollectedLabel(['Weekly'])).toBe(true);
    expect(hasCollectedLabel(['wontfix'])).toBe(false);
  });
});

describe('syncWeeklyChannel', () => {
  const makeApi = (pages: GitHubIssueListRead[][], overrides: Partial<Record<string, unknown>> = {}) => {
    let page = 0;
    return {
      listRepositoryIssues: vi.fn(async () => {
        const items = pages[page] ?? [];
        page++;
        return items;
      }),
      graphqlFetchRepositories: vi.fn(async (fullNames: string[]) => {
        const map = new Map<string, GitHubRepoDetailRead | null>();
        for (const fullName of fullNames) map.set(fullName.toLowerCase(), makeDetail(fullName));
        return map;
      }),
      getRepositoryDetails: vi.fn(async (owner: string, name: string) => makeDetail(`${owner}/${name}`)),
      ...overrides,
    } as unknown as GitHubApiService;
  };

  beforeEach(() => {
    storage.reset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('syncs issues, enriches repos and returns the first page', async () => {
    const api = makeApi([
      [
        makeIssue({ number: 1, isPullRequest: true }),
        makeIssue({ number: 2, title: '【文章推荐】blog', body: 'https://github.com/skip/me' }),
        makeIssue({ number: 3, body: 'https://github.com/alpha/one', created_at: '2026-03-01T00:00:00Z' }),
        makeIssue({ number: 4, body: 'https://github.com/beta/two', created_at: '2026-02-01T00:00:00Z' }),
      ],
      [], // 第二页为空 → 遍历结束
    ]);

    const result = await syncWeeklyChannel(api, 1, false, () => {});
    // 首页 4 条 < per_page(100)，单次调用即结束遍历
    expect(api.listRepositoryIssues).toHaveBeenCalledTimes(1);
    expect(result.repos.map(r => r.full_name)).toEqual(['alpha/one', 'beta/two']);
    expect(result.hasMore).toBe(false);
    expect(result.totalCount).toBe(2);
    expect(result.repos[0].stargazers_count).toBe(10);
    expect(result.repos[0].weeklyIssue?.number).toBe(3);
  });

  it('falls back to REST enrichment when GraphQL fails', async () => {
    const api = makeApi(
      [[makeIssue({ number: 5, body: 'https://github.com/gamma/three' })], []],
      {
        graphqlFetchRepositories: vi.fn(async () => {
          throw new Error('GraphQL batch failed: unsupported');
        }),
      },
    );
    const result = await syncWeeklyChannel(api, 1, false, () => {});
    expect(api.getRepositoryDetails).toHaveBeenCalledWith('gamma', 'three', expect.anything());
    expect(result.repos.map(r => r.full_name)).toEqual(['gamma/three']);
  });

  it('page > 1 loads purely from cache without touching the network', async () => {
    const issues = Array.from({ length: 120 }, (_, i) => makeIssue({
      number: i + 1,
      body: `https://github.com/org${i}/repo${i}`,
      created_at: new Date(Date.parse('2026-01-01T00:00:00Z') + i * 60_000).toISOString(),
    }));
    const api = makeApi([issues, []]);
    await syncWeeklyChannel(api, 1, false, () => {});
    const listSpy = api.listRepositoryIssues as ReturnType<typeof vi.fn>;
    listSpy.mockClear();

    const page2 = await syncWeeklyChannel(api, 2, false, () => {});
    expect(listSpy).not.toHaveBeenCalled();
    expect(page2.repos).toHaveLength(50);
    expect(page2.hasMore).toBe(true);
    expect(page2.repos[0].full_name).toBe('org69/repo69');
  });
});

describe('fetchWeeklyIssueBody without token', () => {
  beforeEach(() => {
    storage.reset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  const storedIssue = (number: number): WeeklyStoredIssue => ({
    number,
    title: '【开源自荐】cached',
    body: 'cached body',
    labels: ['weekly'],
    state: 'open',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    htmlUrl: `https://github.com/ruanyf/weekly/issues/${number}`,
    repoFullNames: ['foo/bar'],
  });

  it('returns cached issue without any API when token is missing', async () => {
    storage.issuesStore.set(7, storedIssue(7));
    const result = await fetchWeeklyIssueBody(null, 7);
    expect(result?.body).toBe('cached body');
  });

  it('returns null without touching the network when cache misses and token is missing', async () => {
    const api = {
      getRepositoryIssue: vi.fn(),
    } as unknown as GitHubApiService;
    const result = await fetchWeeklyIssueBody(null, 8);
    expect(result).toBeNull();
    expect(api.getRepositoryIssue).not.toHaveBeenCalled();
  });

  it('falls back to live fetch only when cache misses and api is provided', async () => {
    const api = {
      getRepositoryIssue: vi.fn(async (_o: string, _r: string, n: number) => makeIssue({ number: n, body: 'live body' })),
    } as unknown as GitHubApiService;
    const miss = await fetchWeeklyIssueBody(api, 9);
    expect(miss?.body).toBe('live body');
    expect(api.getRepositoryIssue).toHaveBeenCalledWith('ruanyf', 'weekly', 9);

    storage.issuesStore.set(10, storedIssue(10));
    const hit = await fetchWeeklyIssueBody(api, 10);
    expect(hit?.body).toBe('cached body');
    expect(api.getRepositoryIssue).toHaveBeenCalledTimes(1);
  });
});
