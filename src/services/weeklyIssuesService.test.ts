import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GitHubApiService, GitHubIssueListRead, GitHubRepoDetailRead } from './githubApi';
import {
  extractRepoFullNames,
  processWeeklyIssue,
  pendingReposFromKeys,
  refreshMaintenanceRepos,
  buildWeeklyDiscoveryRepos,
  syncWeeklyChannel,
  fetchWeeklyIssueBody,
  hasCollectedLabel,
} from './weeklyIssuesService';
import type { WeeklyStoredIssue, WeeklyStoredRepo } from './weeklyIssuesStorage';

// 内存版存储替身（jsdom 无 IndexedDB）：验证 syncWeeklyChannel 的分页/游标/缓存语义
const storage = vi.hoisted(() => {
  const issuesStore = new Map<number, unknown>();
  const reposStore = new Map<string, unknown>();
  const metaRef = {
    current: { lastSyncedAt: null as string | null, deepNextPage: 1, historyComplete: false },
  };
  return {
    issuesStore,
    reposStore,
    metaRef,
    setLastSyncedAt(v: string | null) {
      metaRef.current = { ...metaRef.current, lastSyncedAt: v };
    },
    reset() {
      issuesStore.clear();
      reposStore.clear();
      metaRef.current = { lastSyncedAt: null, deepNextPage: 1, historyComplete: false };
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
    getSyncMeta: async () => ({ ...storage.metaRef.current }),
    saveSyncMeta: async (m: { lastSyncedAt: string | null; deepNextPage: number; historyComplete: boolean }) => {
      storage.metaRef.current = { ...m };
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

describe('enrichment target selection', () => {
  const repo = (overrides: Partial<WeeklyStoredRepo>): WeeklyStoredRepo => ({
    fullName: 'foo/bar',
    detail: null,
    lastFetchedAt: '',
    sourceIssueNumber: 1,
    issueLabels: [],
    issueCreatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  });

  it('pendingReposFromKeys only returns never-fetched repos from the given keys', () => {
    const repos = new Map<string, WeeklyStoredRepo>([
      ['a/a', repo({ fullName: 'a/a' })],
      ['b/b', repo({ fullName: 'b/b', lastFetchedAt: '2026-06-01T00:00:00Z', detail: makeDetail('b/b') })],
      ['c/c', repo({ fullName: 'c/c' })],
    ]);
    const result = pendingReposFromKeys(repos, new Set(['a/a', 'b/b', 'd/d']));
    expect(result.map(r => r.fullName)).toEqual(['a/a']);
  });

  it('maintenance caps stale snapshots and TTL-gated unavailable retries, excludes changed pendings', () => {
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
      ['new/new', repo({ fullName: 'new/new' })],
    ]);
    const changedKeys = new Set(['new/new']);
    const result = refreshMaintenanceRepos(repos, changedKeys, now);
    expect(result.map(r => r.fullName)).toEqual(['stale/stale']);
    // 不在 changed 集合内的游离 pending 会被维护队列兜底收录
    const resultWithoutChanged = refreshMaintenanceRepos(repos, new Set<string>(), now);
    expect(resultWithoutChanged.map(r => r.fullName)).toContain('new/new');
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

describe('syncWeeklyChannel on-demand paging', () => {
  /** 构造按页返回的 mock API；issues 数组的每页条目 number 连续。 */
  const makeApi = (pages: GitHubIssueListRead[][]) => {
    return {
      listRepositoryIssues: vi.fn(async (_owner: string, _repo: string, opts?: { page?: number; since?: string }) => {
        const idx = (opts?.page ?? 1) - 1;
        return pages[idx] ?? [];
      }),
      graphqlFetchRepositories: vi.fn(async (fullNames: string[]) => {
        const map = new Map<string, GitHubRepoDetailRead | null>();
        for (const fullName of fullNames) map.set(fullName.toLowerCase(), makeDetail(fullName));
        return map;
      }),
      getRepositoryDetails: vi.fn(async (owner: string, name: string) => makeDetail(`${owner}/${name}`)),
    } as unknown as GitHubApiService & { listRepositoryIssues: ReturnType<typeof vi.fn>; graphqlFetchRepositories: ReturnType<typeof vi.fn>; getRepositoryDetails: ReturnType<typeof vi.fn> };
  };

  /** 生成一页 100 条 issue，仓库 full_name 由 nameOf(i) 决定。 */
  const issuePage = (startNumber: number, nameOf: (i: number) => string, count = 100, labelOf?: (i: number) => string[]) =>
    Array.from({ length: count }, (_, i) => makeIssue({
      number: startNumber + i,
      body: `https://github.com/${nameOf(i)}`,
      created_at: new Date(Date.parse('2026-01-01T00:00:00Z') + (startNumber + i) * 60_000).toISOString(),
      updated_at: new Date(Date.parse('2026-01-01T00:00:00Z') + (startNumber + i) * 60_000).toISOString(),
      labels: labelOf?.(i) ?? [],
    }));

  beforeEach(() => {
    storage.reset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('first run fetches exactly one full issue page and marks the cursor', async () => {
    const api = makeApi([issuePage(1, (i) => `org${i}/repo${i}`), issuePage(101, () => 'x/y')]);
    const result = await syncWeeklyChannel(api, 1, false, () => {});
    expect(api.listRepositoryIssues).toHaveBeenCalledTimes(1);
    expect(result.repos).toHaveLength(50);
    expect(result.hasMore).toBe(true);
    expect(storage.metaRef.current.deepNextPage).toBe(2);
    expect(storage.metaRef.current.historyComplete).toBe(false);
  });

  it('marks history complete when the first page is short', async () => {
    const api = makeApi([issuePage(1, (i) => `org${i}/repo${i}`, 4)]);
    const result = await syncWeeklyChannel(api, 1, false, () => {});
    expect(api.listRepositoryIssues).toHaveBeenCalledTimes(1);
    expect(result.hasMore).toBe(false);
    expect(storage.metaRef.current.historyComplete).toBe(true);
  });

  it('fetches deeper pages only when the requested UI page exceeds cached cards', async () => {
    // P1: 100 个新仓库；P2: 50 新 + 50 重复引用 P1 仓库；P3: 100 新；P4: 空
    const p1 = issuePage(1, (i) => `org${i}/repo${i}`);
    const p2 = issuePage(101, (i) => (i < 50 ? `zed${i}/repo${i}` : `org${i - 50}/repo${i - 50}`));
    const p3 = issuePage(201, (i) => `gamma${i}/repo${i}`);
    const api = makeApi([p1, p2, p3, []]);

    await syncWeeklyChannel(api, 1, false, () => {});
    expect(api.listRepositoryIssues).toHaveBeenCalledTimes(1);
    expect(storage.metaRef.current.deepNextPage).toBe(2);

    // 页 2（需要 100 张卡片，缓存恰好 100）→ 纯缓存切片
    const spy = api.listRepositoryIssues as ReturnType<typeof vi.fn>;
    spy.mockClear();
    await syncWeeklyChannel(api, 2, false, () => {});
    expect(spy).not.toHaveBeenCalled();

    // 页 3（需要 150 > 100）→ 深度遍历：重叠重读 P1（跳过）+ P2（+50）
    await syncWeeklyChannel(api, 3, false, () => {});
    expect(spy).toHaveBeenCalledTimes(2);
    expect(storage.metaRef.current.deepNextPage).toBe(3);

    // 页 4（需要 200 > 150）→ 从游标 3-1=2 继续：P2（跳过）+ P3（+100）
    spy.mockClear();
    await syncWeeklyChannel(api, 4, false, () => {});
    expect(spy).toHaveBeenCalledTimes(2);
    expect(storage.metaRef.current.deepNextPage).toBe(4);
  });

  it('stops at history end and reports hasMore=false', async () => {
    const p1 = issuePage(1, (i) => `org${i}/repo${i}`);
    const api = makeApi([p1, []]);
    // 先取到第 5 页触发深度遍历直到空页
    await syncWeeklyChannel(api, 1, false, () => {});
    const result = await syncWeeklyChannel(api, 5, false, () => {});
    expect(result.hasMore).toBe(false);
    expect(storage.metaRef.current.historyComplete).toBe(true);
  });

  it('refresh walk passes since and does not advance the deep cursor', async () => {
    const api = makeApi([issuePage(1, (i) => `org${i}/repo${i}`), issuePage(101, (i) => `late${i}/repo${i}`, 3)]);
    // 预置旧同步水位（不在 60 秒窗口内）
    storage.setLastSyncedAt('2026-06-01T00:00:00Z');

    await syncWeeklyChannel(api, 1, false, () => {});
    expect(api.listRepositoryIssues).toHaveBeenCalledTimes(2); // P1 满 100 继续，P2 仅 3 条停止
    const firstCallOpts = (api.listRepositoryIssues as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(firstCallOpts.since).toBe('2026-05-25T00:00:00.000Z'); // 上次同步 - 7 天
    // since 遍历不推进深度游标、不标记取尽
    expect(storage.metaRef.current.deepNextPage).toBe(1);
    expect(storage.metaRef.current.historyComplete).toBe(false);
  });

  it('deep-walks to fill a filtered page when onlyCollected is on', async () => {
    // P1: 100 条中仅 10 条带 weekly label；P2: 100 条中 45 条带 label
    const p1 = issuePage(1, (i) => `org${i}/repo${i}`, 100, (i) => (i < 10 ? ['weekly'] : []));
    const p2 = issuePage(101, (i) => `zed${i}/repo${i}`, 100, (i) => (i < 45 ? ['weekly'] : []));
    const api = makeApi([p1, p2, []]);

    const result = await syncWeeklyChannel(api, 1, true, () => {});
    // 刷新遍历 1 页 + 深度遍历补足过滤后的 50 张卡片（重叠重读 P1 + P2）
    expect(api.listRepositoryIssues).toHaveBeenCalledTimes(3);
    expect(result.repos).toHaveLength(50);
    expect(result.repos.every(r => r.weeklyIssue?.labels.some(l => l.toLowerCase() === 'weekly'))).toBe(true);
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
