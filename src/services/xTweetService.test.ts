import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { GitHubApiService, GitHubRepoDetailRead } from './githubApi';
import {
  decodeTweetRef,
  parseXTimelineHtml,
  tweetSnowflakeToDate,
  tweetDateToIso,
  buildTweetContentHtml,
  buildUserTweetsUrl,
  buildUserByScreenNameUrl,
  parseXUserTweetsJson,
  extractXGraphQLQueryIds,
  ingestFeedTweets,
  reposNeedingDetail,
  buildXTweetDiscoveryRepos,
  syncXTweetChannel,
  probeXTweetSource,
  X_TWEET_CARD_PAGE_SIZE,
  type XTimelineTransport,
  type XGraphQLTransport,
} from './xTweetService';
import { xTweetStorage, type XStoredRepo, type XStoredTweet, type XTweetSyncMeta } from './xTweetStorage';
import type { XTweetAuth, XTweetFollow } from '../types';

/**
 * fixture 是从 x.com/geekbb 未登录主页真实响应中截取的 Flight 数据段
 * （含真实推文与 expanded_url 实体），解析器直接对着真实上游格式测。
 */
const REAL_TIMELINE_HTML = readFileSync(
  path.join(__dirname, '__fixtures__', 'x-timeline-geekbb.html'),
  'utf-8',
);
/** 鉴权路径 fixture：登录态 UserTweets GraphQL 真实响应（geekbb 最新页）。 */
const REAL_USER_TWEETS_JSON = readFileSync(
  path.join(__dirname, '__fixtures__', 'x-usertweets-geekbb-auth.json'),
  'utf-8',
);

// 内存版存储替身（jsdom 无 IndexedDB；meta 每次读取返回深拷贝，仿 IDB 语义）
const storage = vi.hoisted(() => {
  const tweetsStore = new Map<string, unknown>();
  const reposStore = new Map<string, unknown>();
  const metaRef = {
    current: {
      lastSyncedAt: null as string | null,
      followsSignature: '',
      pages: {} as Record<string, { cursor: string | null; exhausted: boolean }>,
      userIds: {} as Record<string, string>,
      queryIds: {} as Record<string, string>,
    },
  };
  const copyMeta = (): XTweetSyncMeta => ({
    ...metaRef.current,
    pages: Object.fromEntries(Object.entries(metaRef.current.pages).map(([k, v]) => [k, { ...v }])),
    userIds: { ...metaRef.current.userIds },
    queryIds: { ...metaRef.current.queryIds },
  });
  let failSyncBatchOnRepo: string | null = null;
  return {
    tweetsStore,
    reposStore,
    metaRef,
    setFailSyncBatchOnRepo(fullName: string | null) {
      failSyncBatchOnRepo = fullName;
    },
    failSyncBatchOnRepoNow: () => failSyncBatchOnRepo,
    reset() {
      tweetsStore.clear();
      reposStore.clear();
      metaRef.current = {
        lastSyncedAt: null,
        followsSignature: '',
        pages: {},
        userIds: {},
        queryIds: {},
      };
      failSyncBatchOnRepo = null;
    },
    copyMeta,
  };
});

vi.mock('./xTweetStorage', () => ({
  xTweetStorage: {
    saveTweets: async (tweets: XStoredTweet[]) => {
      for (const tweet of tweets) storage.tweetsStore.set(tweet.tweetId, tweet);
    },
    getAllTweets: async () => new Map(storage.tweetsStore) as Map<string, XStoredTweet>,
    saveRepos: async (repos: XStoredRepo[]) => {
      for (const repo of repos) storage.reposStore.set(repo.fullName.toLowerCase(), repo);
    },
    getAllRepos: async () => new Map(storage.reposStore) as Map<string, XStoredRepo>,
    getSyncMeta: async () => storage.copyMeta(),
    saveSyncMeta: async (meta: XTweetSyncMeta) => {
      storage.metaRef.current = JSON.parse(JSON.stringify(meta));
    },
    saveSyncBatch: async (payload: { tweets: XStoredTweet[]; repos: XStoredRepo[]; meta: XTweetSyncMeta }) => {
      // 原子语义在真实现由单事务保证；替身以"先抛错后应用"模拟失败回滚
      if (storage.failSyncBatchOnRepoNow()
        && payload.repos.some((repo) => repo.fullName.toLowerCase() === storage.failSyncBatchOnRepoNow())) {
        throw new Error('sync batch tx failed');
      }
      for (const tweet of payload.tweets) storage.tweetsStore.set(tweet.tweetId, tweet);
      for (const repo of payload.repos) storage.reposStore.set(repo.fullName.toLowerCase(), repo);
      storage.metaRef.current = JSON.parse(JSON.stringify(payload.meta));
    },
    clearAll: async () => storage.reset(),
  },
}));

const makeDetail = (fullName: string): GitHubRepoDetailRead => ({
  id: fullName.length,
  name: fullName.split('/')[1],
  full_name: fullName,
  description: `desc of ${fullName}`,
  html_url: `https://github.com/${fullName}`,
  stargazers_count: 100,
  forks_count: 10,
  forks: 10,
  language: 'TypeScript',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  pushed_at: '2026-01-01T00:00:00Z',
  owner: { login: fullName.split('/')[0], avatar_url: `https://github.com/${fullName.split('/')[0]}.png` },
  topics: [],
} as unknown as GitHubRepoDetailRead);

const makeApi = (
  details: Map<string, GitHubRepoDetailRead | null>,
  graphqlError: Error | null = null,
): GitHubApiService => ({
  graphqlFetchRepositories: vi.fn(async (fullNames: string[]) => {
    if (graphqlError) throw graphqlError;
    const result = new Map<string, GitHubRepoDetailRead | null>();
    // 与真实 GraphQL 语义一致：不存在的仓库不产生键（而非显式 null），
    // 这样 REST 回退分支（restTargets）才可能被覆盖
    for (const fullName of fullNames) {
      const key = fullName.toLowerCase();
      if (details.has(key)) result.set(key, details.get(key) ?? null);
    }
    return result;
  }),
  getRepositoryDetails: vi.fn(async (owner: string, name: string) => {
    const detail = details.get(`${owner}/${name}`.toLowerCase());
    if (!detail) throw new Error(`404: ${owner}/${name}`);
    return detail;
  }),
} as unknown as GitHubApiService);

/** 传输替身：按 handle 返回预设 HTML（或抛错），记录每次调用 */
const stubTransport = (pages: Record<string, string | Error>): { transport: XTimelineTransport; calls: string[] } => {
  const calls: string[] = [];
  const transport: XTimelineTransport = async (handle) => {
    calls.push(handle);
    const page = pages[handle];
    if (page instanceof Error) throw page;
    return page ?? '<html></html>';
  };
  return { transport, calls };
};

const follows: XTweetFollow[] = [
  { handle: 'geekbb', addedAt: '2026-09-12T00:00:00.000Z' },
  { handle: 'ghost', addedAt: '2026-09-12T00:00:00.000Z' },
];

beforeEach(() => {
  storage.reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('decodeTweetRef', () => {
  it('解码 Flight 的 client 引用为推文 ID', () => {
    // base64("Tweet:2098629676495159496")
    expect(decodeTweetRef('VHdlZXQ6MjA5ODYyOTY3NjQ5NTE1OTQ5Ng==')).toBe('2098629676495159496');
    expect(decodeTweetRef('bm90LWEtdHdlZXQ=')).toBeNull();
    expect(decodeTweetRef('!!!not-base64!!!')).toBeNull();
  });
});

describe('tweetSnowflakeToDate', () => {
  it('从雪花 ID 推导发布时间（ID 超出 Number 安全范围，精度无损）', () => {
    // 已知样本：2098678373753225483 = 2026-09-12T07:41:30.518Z（Twitter epoch 1288834974657）
    expect(tweetSnowflakeToDate('2098678373753225483')).toBe('2026-09-12T07:41:30.518Z');
    // 与相邻雪花 ID 的时间差与 ID 差同向
    const later = tweetSnowflakeToDate('2098678373753225484');
    expect(Date.parse(later)).toBeGreaterThanOrEqual(Date.parse('2026-09-12T07:41:30.518Z'));
  });
});

describe('parseXTimelineHtml（真实 x.com 未登录主页 fixture）', () => {
  const tweets = () => parseXTimelineHtml(REAL_TIMELINE_HTML, 'geekbb');

  it('解析出顶层时间线的 5 条真实推文（精确 ID），嵌套引用推文不计入', () => {
    const parsed = tweets();
    // fixture 的 5 个顶层 TimelineTimelineEntry；2097971881596916185 是嵌套
    // 引用推文（其他作者），不得归属给 geekbb
    expect(new Set(parsed.map((t) => t.tweetId))).toEqual(new Set([
      '2098678373753225483',
      '2098629676495159496',
      '2098604072572162341',
      '2098581405253189796',
      '2098310980103200951',
    ]));
    expect(parsed.some((t) => t.tweetId === '2097971881596916185')).toBe(false);
    expect(parsed.every((t) => t.handle === 'geekbb')).toBe(true);
    expect(parsed.every((t) => t.htmlUrl.startsWith('https://x.com/geekbb/status/'))).toBe(true);
  });

  it('按雪花 ID 时间倒序（解析顺序无关）', () => {
    const parsed = tweets();
    const times = parsed.map((t) => Date.parse(t.createdAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('从 expanded_url 实体提取 GitHub 仓库链接（geekbb 真实分享的仓库）', () => {
    const parsed = tweets();
    const allRepos = parsed.flatMap((t) => t.repoFullNames);
    expect(allRepos).toContain('obsidianmd/knap');
    expect(allRepos).toContain('zhihui-hu/one-ip');
    expect(allRepos).toContain('sumimakito/mac-duo');
  });

  it('还原正文的 \n 转义（Flight 字符串字面量）', () => {
    const parsed = tweets();
    const withNewline = parsed.find((t) => t.content.includes('\n\n'));
    expect(withNewline).toBeDefined();
  });

  it('非推文页（空 HTML）返回空数组', () => {
    expect(parseXTimelineHtml('<html><body>login wall</body></html>', 'geekbb')).toEqual([]);
  });
});

describe('ingestFeedTweets', () => {
  it('按 tweetId 去重；同仓库多推文时原贴指向最新推文', () => {
    const tweets = new Map<string, XStoredTweet>();
    const repos = new Map<string, XStoredRepo>();
    const make = (id: string, daysAgo: number) => ({
      tweetId: id,
      handle: 'geekbb',
      displayName: 'geekbb',
      content: 'repo https://github.com/a/one',
      htmlUrl: `https://x.com/geekbb/status/${id}`,
      createdAt: new Date(Date.now() - daysAgo * 86400_000).toISOString(),
      repoFullNames: ['a/one'],
    });
    const first = ingestFeedTweets([make('1', 5)], tweets, repos);
    expect(first.newTweets).toHaveLength(1);
    expect(ingestFeedTweets([make('1', 5)], tweets, repos).newTweets).toHaveLength(0);
    ingestFeedTweets([make('2', 1)], tweets, repos);
    expect(repos.get('a/one')!.sourceTweetId).toBe('2');
  });
});

describe('reposNeedingDetail', () => {
  it('新触达必补全；新鲜快照跳过；过期快照与到期不可用仓库重试', () => {
    const now = Date.now();
    const repos = new Map<string, XStoredRepo>();
    repos.set('a/new', { fullName: 'a/new', detail: null, lastFetchedAt: '', sourceTweetId: '1', tweetCreatedAt: '' });
    repos.set('a/fresh', { fullName: 'a/fresh', detail: makeDetail('a/fresh'), lastFetchedAt: new Date(now - 10 * 86400_000).toISOString(), sourceTweetId: '1', tweetCreatedAt: '' });
    repos.set('a/stale', { fullName: 'a/stale', detail: makeDetail('a/stale'), lastFetchedAt: new Date(now - 40 * 86400_000).toISOString(), sourceTweetId: '1', tweetCreatedAt: '' });
    repos.set('a/dead', { fullName: 'a/dead', detail: null, lastFetchedAt: new Date(now - 8 * 86400_000).toISOString(), sourceTweetId: '1', tweetCreatedAt: '' });
    const targets = reposNeedingDetail(repos, new Set(['a/new', 'a/fresh', 'a/stale', 'a/dead']), now);
    expect(targets.map((repo) => repo.fullName)).toEqual(['a/new', 'a/stale', 'a/dead']);
  });
});

describe('buildXTweetDiscoveryRepos', () => {
  it('只展示当前关注 + 已补全详情的仓库，按推文时间倒序并赋 rank', () => {
    const tweets = new Map<string, XStoredTweet>();
    const repos = new Map<string, XStoredRepo>();
    const make = (id: string, handle: string, daysAgo: number, repo: string) => ({
      tweetId: id,
      handle,
      displayName: handle,
      content: 'x',
      htmlUrl: `https://x.com/${handle}/status/${id}`,
      createdAt: new Date(Date.now() - daysAgo * 86400_000).toISOString(),
      repoFullNames: [repo],
    });
    ingestFeedTweets([make('1', 'alice', 1, 'a/one'), make('2', 'alice', 3, 'a/two')], tweets, repos);
    ingestFeedTweets([make('3', 'bob', 2, 'b/three')], tweets, repos);
    ingestFeedTweets([make('4', 'carol', 0, 'c/four')], tweets, repos);
    repos.set('a/two', { ...repos.get('a/two')!, detail: null });
    repos.set('b/three', { ...repos.get('b/three')!, detail: makeDetail('b/three') });
    repos.set('a/one', { ...repos.get('a/one')!, detail: makeDetail('a/one') });
    repos.set('c/four', { ...repos.get('c/four')!, detail: makeDetail('c/four') });

    const list = buildXTweetDiscoveryRepos(tweets, repos, ['alice', 'bob']);
    expect(list.map((repo) => repo.full_name)).toEqual(['a/one', 'b/three']);
    expect(list[0].rank).toBe(1);
    expect(list[0].channel).toBe('x-tweet');
    expect(list[0].xTweet?.handle).toBe('alice');
  });
});

describe('syncXTweetChannel', () => {
  it('首页逐博主真实抓取：解析推文、补全仓库详情、返回前缀切片', async () => {
    const { transport, calls } = stubTransport({ geekbb: REAL_TIMELINE_HTML, ghost: '<html></html>' });
    const api = makeApi(new Map([
      ['obsidianmd/knap', makeDetail('obsidianmd/knap')],
      ['zhihui-hu/one-ip', makeDetail('zhihui-hu/one-ip')],
      ['sumimakito/mac-duo', makeDetail('sumimakito/mac-duo')],
    ]));

    const result = await syncXTweetChannel(api, 1, follows.slice(0, 1), undefined, transport);
    expect(calls).toEqual(['geekbb']);
    // fixture 中 geekbb 的三条推文各含一个 GitHub 仓库链接 → 3 张卡片
    expect(result.repos.map((repo) => repo.full_name).sort())
      .toEqual(['obsidianmd/knap', 'sumimakito/mac-duo', 'zhihui-hu/one-ip']);
    expect(result.hasMore).toBe(false);
    expect(storage.metaRef.current.lastSyncedAt).not.toBeNull();
  });

  it('60 秒内重复刷新走缓存，不再调用传输层', async () => {
    const { transport, calls } = stubTransport({ geekbb: REAL_TIMELINE_HTML });
    const api = makeApi(new Map());
    await syncXTweetChannel(api, 1, follows.slice(0, 1), undefined, transport);
    const callsAfterFirst = calls.length;
    await syncXTweetChannel(api, 1, follows.slice(0, 1), undefined, transport);
    expect(calls.length).toBe(callsAfterFirst);
  });

  it('单个博主失败不拖垮整轮；全部失败才抛出传输层错误', async () => {
    const { transport } = stubTransport({
      geekbb: REAL_TIMELINE_HTML,
      ghost: new Error('x.com responded 404'),
    });
    const api = makeApi(new Map([['obsidianmd/knap', makeDetail('obsidianmd/knap')]]));
    const result = await syncXTweetChannel(api, 1, follows, undefined, transport);
    expect(result.repos.length).toBeGreaterThan(0);

    // 清掉首轮同步写入的 60 秒水位，让全失败轮真正触网
    storage.metaRef.current.lastSyncedAt = null;
    const allFail = stubTransport({ geekbb: new Error('x.com responded 503'), ghost: new Error('offline') });
    await expect(
      syncXTweetChannel(makeApi(new Map()), 1, follows, undefined, allFail.transport),
    ).rejects.toThrow('x.com responded 503');
  });

  it('无效 handle 的关注被过滤，不发请求', async () => {
    const { transport, calls } = stubTransport({});
    const api = makeApi(new Map());
    const result = await syncXTweetChannel(
      api, 1,
      [{ handle: 'not a handle!', addedAt: '2026-09-12T00:00:00.000Z' }],
      undefined, transport,
    );
    expect(calls).toEqual([]);
    expect(result.repos).toEqual([]);
    expect(result.hasMore).toBe(false);
  });

  it('取消关注后其仓库不再出现在列表中', async () => {
    const { transport } = stubTransport({ geekbb: REAL_TIMELINE_HTML });
    const api = makeApi(new Map([['obsidianmd/knap', makeDetail('obsidianmd/knap')]]));
    await syncXTweetChannel(api, 1, follows.slice(0, 1), undefined, transport);
    const afterUnfollow = await syncXTweetChannel(api, 1, [], undefined, transport);
    expect(afterUnfollow.repos).toHaveLength(0);
    expect(afterUnfollow.hasMore).toBe(false);
  });

  it('翻页返回累积前缀；缓存不足且刚同步过时不再触网', async () => {
    // 在真实 fixture 后追加 25 条带仓库链接的推文，凑出超过一页窗口的缓存
    const extra = Array.from({ length: 25 }, (_, i) => {
      // base64("Tweet:<id>") 本身自带 VHdlZXQ6 前缀，client: 后直接拼即可；
      // 解析器只认顶层 TimelineTimelineEntry，合成块需一并带上
      const id = (9000000000000000000n + BigInt(i)).toString();
      const ref = Buffer.from(`Tweet:${id}`).toString('base64');
      return `client:urt:server:TimelineTimelineEntry:tweet-${id}:content client:${ref}:details full_text:"repo https://github.com/alice/repo${i}" expanded_url:"https://github.com/alice/repo${i}"`;
    }).join(' ');
    const { transport } = stubTransport({ geekbb: REAL_TIMELINE_HTML + ' ' + extra });
    const details = new Map<string, GitHubRepoDetailRead | null>([
      ['obsidianmd/knap', makeDetail('obsidianmd/knap')],
      ...Array.from({ length: 25 }, (_, i) => [`alice/repo${i}`, makeDetail(`alice/repo${i}`)] as const),
    ]);
    const api = makeApi(new Map(details));

    await syncXTweetChannel(api, 1, follows.slice(0, 1), undefined, transport);
    // 60 秒水位内：翻页纯切片，前缀 = min(缓存, 40)
    const page2 = await syncXTweetChannel(api, 2, follows.slice(0, 1), undefined, transport);
    expect(page2.repos.length).toBeGreaterThan(X_TWEET_CARD_PAGE_SIZE);
    expect(page2.hasMore).toBe(false);
  });
});

describe('落盘失败传播', () => {
  it('第一个博主落盘成功、第二个博主写失败时中止整轮：不持久化缺原贴的仓库，也不推进水位', async () => {
    const ghostHtml = [
      'client:urt:server:TimelineTimelineEntry:tweet-8888888888888888888:content',
      'client:VHdlZXQ6' + Buffer.from('Tweet:8888888888888888888').toString('base64').slice(8) + ':details',
      'full_text:"repo https://github.com/ghost/repo"',
      'expanded_url:"https://github.com/ghost/repo"',
    ].join(' ');
    const { transport } = stubTransport({ geekbb: REAL_TIMELINE_HTML, ghost: ghostHtml });
    const api = makeApi(new Map([['obsidianmd/knap', makeDetail('obsidianmd/knap')]]));
    // 第二批（含 ghost/repo 的落盘）写失败
    storage.setFailSyncBatchOnRepo('ghost/repo');

    await expect(
      syncXTweetChannel(api, 1, follows, undefined, transport),
    ).rejects.toThrow('sync batch tx failed');

    // 首批（geekbb）已原子持久化且原贴齐全；ghost 的脏合并未混入
    expect(storage.reposStore.has('ghost/repo')).toBe(false);
    for (const [key, repo] of storage.reposStore) {
      expect(storage.tweetsStore.has((repo as XStoredRepo).sourceTweetId)).toBe(true);
      expect(key.length).toBeGreaterThan(0);
    }
    expect(storage.metaRef.current.lastSyncedAt).toBeNull();
  });
});

describe('REST 回退', () => {
  it('GraphQL 整批失败时逐仓回退 REST 补全', async () => {
    const { transport } = stubTransport({ geekbb: REAL_TIMELINE_HTML });
    const api = makeApi(
      new Map([['obsidianmd/knap', makeDetail('obsidianmd/knap')]]),
      new Error('GraphQL batch failed: bad gateway'),
    );
    const result = await syncXTweetChannel(api, 1, follows.slice(0, 1), undefined, transport);
    // knap 走 REST 成功；one-ip/mac-duo 不在详情表 → REST 404 → 标记不可用不出卡
    expect(result.repos.map((repo) => repo.full_name)).toEqual(['obsidianmd/knap']);
    expect(api.getRepositoryDetails).toHaveBeenCalledWith('obsidianmd', 'knap', expect.anything());
    expect(api.getRepositoryDetails).toHaveBeenCalledWith('zhihui-hu', 'one-ip', expect.anything());
  });
});

describe('probeXTweetSource', () => {
  it('真实解析返回推文数与仓库链接数', async () => {
    const { transport } = stubTransport({ geekbb: REAL_TIMELINE_HTML });
    const result = await probeXTweetSource('geekbb', transport);
    expect(result.ok).toBe(true);
    expect(result.tweetCount!).toBe(5);
    expect(result.repoCount!).toBe(3);
  });

  it('无效用户名与抓取失败均返回可展示错误', async () => {
    expect((await probeXTweetSource('bad handle!', stubTransport({}).transport)).ok).toBe(false);
    const fail = stubTransport({ geekbb: new Error('timeout') });
    const result = await probeXTweetSource('geekbb', fail.transport);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('timeout');
  });
});

/* ============ 鉴权 GraphQL 路径 ============ */

const AUTH: XTweetAuth = { authToken: '4e61test', ct0: 'a3ddtest' };
const authFollows: XTweetFollow[] = [{ handle: 'geekbb', addedAt: '2026-09-13T00:00:00.000Z' }];

const makeUserByScreenNameBody = (restId: string): string => JSON.stringify({
  data: { user: { result: { __typename: 'User', rest_id: restId } } },
});

const makeUserTweetsBody = (
  entries: Array<Record<string, unknown>>,
  cursor: string | null,
): string => JSON.stringify({
  data: {
    user: {
      result: {
        __typename: 'User',
        timeline: { timeline: { instructions: [{ type: 'TimelineAddEntries', entries: cursor ? [...entries, { entryId: 'cursor-bottom-1', content: { entryType: 'TimelineTimelineCursor', value: cursor } }] : entries }] } },
      },
    },
  },
});

const tweetEntry = (
  id: number,
  fullText: string,
  createdAt: string,
  urls: Array<{ url: string; expanded_url: string; indices: [number, number] }> = [],
): Record<string, unknown> => ({
  entryId: `tweet-${id}`,
  content: {
    entryType: 'TimelineTimelineItem',
    itemContent: {
      tweet_results: {
        result: { __typename: 'Tweet', rest_id: String(id), legacy: { full_text: fullText, created_at: createdAt, entities: { urls } } },
      },
    },
  },
});

/** 鉴权传输替身：按 URL 正则返回预设响应（或抛错），记录每次调用 */
const stubGraphQL = (
  handlers: Array<{ match: RegExp; body: string | Error }>,
): { graphQL: XGraphQLTransport; calls: string[] } => {
  const calls: string[] = [];
  const graphQL: XGraphQLTransport = async (url) => {
    calls.push(url);
    const handler = handlers.find((h) => h.match.test(url));
    if (!handler) throw new Error(`unexpected url: ${url.slice(0, 120)}`);
    if (handler.body instanceof Error) throw handler.body;
    return handler.body;
  };
  return { graphQL, calls };
};

describe('tweetDateToIso', () => {
  it('解析 Twitter 时间格式并回退纪元', () => {
    expect(tweetDateToIso('Sun Sep 13 06:17:25 +0000 2026')).toBe('2026-09-13T06:17:25.000Z');
    expect(tweetDateToIso('not-a-date')).toBe('1970-01-01T00:00:00.000Z');
  });
});

describe('buildTweetContentHtml', () => {
  it('按实体索引把 t.co 短链替换为 expanded_url 锚点', () => {
    const html = buildTweetContentHtml('look https://t.co/xyz end', [
      { url: 'https://t.co/xyz', expanded_url: 'https://github.com/foo/bar', indices: [5, 21] },
    ]);
    expect(html).toBe('look <a href="https://github.com/foo/bar">https://t.co/xyz</a> end');
  });

  it('转义正文 HTML、换行转 <br/>、非法索引跳过', () => {
    const html = buildTweetContentHtml('a <b>\nc', [
      { url: 'https://t.co/x', expanded_url: 'https://x.com/x', indices: [10, 12] },
    ]);
    expect(html).toBe('a &lt;b&gt;<br/>c');
  });
});

describe('buildUserTweetsUrl / buildUserByScreenNameUrl', () => {
  it('variables 含 userId；仅传入 cursor 时带 cursor 参数', () => {
    const p1 = buildUserTweetsUrl('123', null, 'QID');
    expect(p1).toContain('/i/api/graphql/QID/UserTweets');
    expect(decodeURIComponent(p1)).toContain('"userId":"123"');
    expect(decodeURIComponent(p1)).not.toContain('"cursor"');
    const p2 = buildUserTweetsUrl('123', 'CUR', 'QID');
    expect(decodeURIComponent(p2)).toContain('"cursor":"CUR"');
    expect(decodeURIComponent(buildUserByScreenNameUrl('geekbb', 'QID2'))).toContain('"screen_name":"geekbb"');
  });
});

describe('parseXUserTweetsJson（真实 UserTweets fixture）', () => {
  it('解析出 19 条真实推文；无 core.name 时 displayName 回退 handle', () => {
    const parsed = parseXUserTweetsJson(REAL_USER_TWEETS_JSON, 'geekbb');
    expect(parsed.tweets).toHaveLength(19);
    expect(parsed.exhausted).toBe(false);
    expect(parsed.nextCursor).toBeTruthy();
    expect(new Set(parsed.tweets.map((t) => t.displayName))).toEqual(new Set(['geekbb']));
    const ids = parsed.tweets.map((t) => t.tweetId);
    expect(ids).toContain('2098629676495159496');
    const knap = parsed.tweets.find((t) => t.tweetId === '2098629676495159496');
    expect(knap?.createdAt).toBe('2026-09-12T04:28:00.000Z');
    expect(knap?.htmlUrl).toBe('https://x.com/geekbb/status/2098629676495159496');
    expect(knap?.repoFullNames).toContain('obsidianmd/knap');
    expect(knap?.content).toContain('<a href="https://github.com/obsidianmd/knap"');
  });

  it('鉴权失效（code 32）抛可读错误；账号不可用抛错', () => {
    const authInvalid = JSON.stringify({ errors: [{ code: 32, message: 'Could not authenticate you' }] });
    expect(() => parseXUserTweetsJson(authInvalid, 'geekbb')).toThrow('鉴权已失效');
    const unavailable = JSON.stringify({ data: { user: { result: { __typename: 'UserUnavailable' } } } });
    expect(() => parseXUserTweetsJson(unavailable, 'geekbb')).toThrow('无法获取');
  });

  it('Tombstone 跳过；TweetWithVisibilityResults 包装（result.tweet）兼容；无 cursor 即取尽', () => {
    const body = JSON.stringify({
      data: {
        user: {
          result: {
            __typename: 'User',
            timeline: {
              timeline: {
                instructions: [{
                  type: 'TimelineAddEntries',
                  entries: [
                    { entryId: 'tweet-1', content: { entryType: 'TimelineTimelineItem', itemContent: { tweet_results: { result: { __typename: 'TweetTombstone' } } } } },
                    { entryId: 'tweet-2', content: { entryType: 'TimelineTimelineItem', itemContent: { tweet_results: { result: { __typename: 'TweetWithVisibilityResults', tweet: { rest_id: '2', legacy: { full_text: 'wrapped https://github.com/a/b', created_at: 'Sun Sep 13 00:00:00 +0000 2026', entities: { urls: [{ url: 'https://t.co/x', expanded_url: 'https://github.com/a/b', indices: [8, 22] }] } } } } } } } },
                  ],
                }],
              },
            },
          },
        },
      },
    });
    const parsed = parseXUserTweetsJson(body, 'geekbb');
    expect(parsed.tweets).toHaveLength(1);
    expect(parsed.tweets[0].tweetId).toBe('2');
    expect(parsed.tweets[0].repoFullNames).toEqual(['a/b']);
    expect(parsed.exhausted).toBe(true);
  });
});

describe('extractXGraphQLQueryIds', () => {
  it('从登录态首页引用的 main bundle 提取 UserTweets/UserByScreenName queryId', async () => {
    const { graphQL } = stubGraphQL([
      { match: /^https:\/\/x\.com\/home$/, body: '<html><script src="https://abs.twimg.com/responsive-web/client-web/main.abc123def.js"></script></html>' },
      { match: /main\.abc123def\.js$/, body: 'queryId:"QIDTWEETS",operationName:"UserTweets" ... queryId:"QIDUSER",operationName:"UserByScreenName"' },
    ]);
    const ids = await extractXGraphQLQueryIds(AUTH, graphQL);
    expect(ids).toEqual({ UserTweets: 'QIDTWEETS', UserByScreenName: 'QIDUSER' });
  });

  it('定位不到主脚本或 operation 时抛错', async () => {
    const { graphQL } = stubGraphQL([{ match: /^https:\/\/x\.com\/home$/, body: '<html></html>' }]);
    await expect(extractXGraphQLQueryIds(AUTH, graphQL)).rejects.toThrow('无法定位');
  });
});

describe('syncXTweetChannel（鉴权路径）', () => {
  const getFixtureCursor = (): string => {
    const d = JSON.parse(REAL_USER_TWEETS_JSON);
    const instructions = d.data.user.result.timeline.timeline.instructions;
    const entries = instructions.find((i: { type?: string }) => i.type === 'TimelineAddEntries').entries;
    return entries.find((e: { entryId?: string }) => e.entryId?.startsWith('cursor-bottom')).content.value;
  };

  it('首页逐博主真实抓取：解析用户 ID、初始化游标、补全仓库详情、返回前缀切片', async () => {
    const fixtureCursor = getFixtureCursor();
    const { graphQL, calls } = stubGraphQL([
      { match: /UserByScreenName/, body: makeUserByScreenNameBody('168139512') },
      { match: /UserTweets/, body: REAL_USER_TWEETS_JSON },
    ]);
    const details = new Map<string, GitHubRepoDetailRead | null>([['obsidianmd/knap', makeDetail('obsidianmd/knap')]]);
    const result = await syncXTweetChannel(makeApi(details), 1, authFollows, undefined, undefined, AUTH, graphQL);

    expect(calls.some((url) => url.includes('/UserByScreenName'))).toBe(true);
    expect(calls.some((url) => url.includes('/UserTweets'))).toBe(true);
    expect(result.repos.length).toBeGreaterThan(0);
    expect(result.repos[0].xTweet).toBeDefined();
    expect(result.hasMore).toBe(true);
    const meta = await xTweetStorage.getSyncMeta();
    expect(meta.userIds['geekbb']).toBe('168139512');
    expect(meta.pages['geekbb']).toEqual({ cursor: fixtureCursor, exhausted: false });
    expect(meta.lastSyncedAt).not.toBeNull();
  });

  it('加载更多按落盘游标拉下一页（一次点击翻一页），不受 60 秒水位拦截', async () => {
    const fixtureCursor = getFixtureCursor();
    const p2Cursor = 'CURSOR_PAGE_3';
    const p2Body = makeUserTweetsBody([
      tweetEntry(1, 'older https://github.com/eee/fff', 'Sun Sep 06 00:00:00 +0000 2026', [
        { url: 'https://t.co/fff', expanded_url: 'https://github.com/eee/fff', indices: [6, 20] },
      ]),
    ], p2Cursor);
    const { graphQL, calls } = stubGraphQL([
      { match: /UserByScreenName/, body: makeUserByScreenNameBody('168139512') },
      { match: /UserTweets/, body: p2Body },
    ]);
    const details = new Map<string, GitHubRepoDetailRead | null>([
      ['obsidianmd/knap', makeDetail('obsidianmd/knap')],
      ['eee/fff', makeDetail('eee/fff')],
    ]);
    const api = makeApi(details);
    // 预置 page 1 状态（游标来自 fixture 最新页），水位刚推进
    await syncXTweetChannel(makeApi(details), 1, authFollows, undefined, undefined, AUTH, stubGraphQL([
      { match: /UserByScreenName/, body: makeUserByScreenNameBody('168139512') },
      { match: /UserTweets/, body: REAL_USER_TWEETS_JSON },
    ]).graphQL);
    // 刚同步过（60 秒水位内）仍必须翻页
    const page2 = await syncXTweetChannel(api, 2, authFollows, undefined, undefined, AUTH, graphQL);

    const tweetsCall = calls.find((url) => url.includes('/UserTweets'));
    expect(tweetsCall).toBeDefined();
    expect(decodeURIComponent(tweetsCall!)).toContain(`"cursor":"${fixtureCursor}"`);
    expect(page2.hasMore).toBe(true);
    const meta = await xTweetStorage.getSyncMeta();
    expect(meta.pages['geekbb']).toEqual({ cursor: p2Cursor, exhausted: false });
    expect(page2.totalCount).toBeGreaterThanOrEqual(2);
  });

  it('page 1 刷新重抓最新页但不回退已推进的游标', async () => {
    const p2Cursor = 'CURSOR_PAGE_3';
    const { graphQL } = stubGraphQL([
      { match: /UserByScreenName/, body: makeUserByScreenNameBody('168139512') },
      { match: /UserTweets/, body: makeUserTweetsBody([tweetEntry(1, 'older', 'Sun Sep 06 00:00:00 +0000 2026')], p2Cursor) },
    ]);
    const api = makeApi(new Map([['obsidianmd/knap', makeDetail('obsidianmd/knap')]]));
    await syncXTweetChannel(api, 1, authFollows, undefined, undefined, AUTH, stubGraphQL([
      { match: /UserByScreenName/, body: makeUserByScreenNameBody('168139512') },
      { match: /UserTweets/, body: REAL_USER_TWEETS_JSON },
    ]).graphQL);
    await syncXTweetChannel(api, 2, authFollows, undefined, undefined, AUTH, graphQL);
    expect((await xTweetStorage.getSyncMeta()).pages['geekbb']).toEqual({ cursor: p2Cursor, exhausted: false });

    // 让水位失效强制 page 1 重新触网（用新的替身便于断言最新页调用）
    const meta = await xTweetStorage.getSyncMeta();
    meta.lastSyncedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    await xTweetStorage.saveSyncMeta(meta);
    const { graphQL: refreshGraphQL, calls } = stubGraphQL([
      { match: /UserByScreenName/, body: makeUserByScreenNameBody('168139512') },
      { match: /UserTweets/, body: REAL_USER_TWEETS_JSON },
    ]);
    await syncXTweetChannel(api, 1, authFollows, undefined, undefined, AUTH, refreshGraphQL);
    const tweetsCall = calls.find((url) => url.includes('/UserTweets'))!;
    expect(decodeURIComponent(tweetsCall)).not.toContain('"cursor"');
    expect((await xTweetStorage.getSyncMeta()).pages['geekbb']).toEqual({ cursor: p2Cursor, exhausted: false });
  });

  it('时间线取尽后：纯切片不触网，缓存耗尽即 hasMore=false', async () => {
    const { graphQL, calls } = stubGraphQL([
      { match: /UserByScreenName/, body: makeUserByScreenNameBody('168139512') },
      { match: /UserTweets/, body: makeUserTweetsBody([tweetEntry(1, 'end https://github.com/gg/hh', 'Sun Sep 06 00:00:00 +0000 2026', [{ url: 'https://t.co/h', expanded_url: 'https://github.com/gg/hh', indices: [4, 18] }])], null) },
    ]);
    const api = makeApi(new Map([['gg/hh', makeDetail('gg/hh')]]));
    await syncXTweetChannel(api, 1, authFollows, undefined, undefined, AUTH, graphQL);
    const page2 = await syncXTweetChannel(api, 2, authFollows, undefined, undefined, AUTH, graphQL);
    expect((await xTweetStorage.getSyncMeta()).pages['geekbb']).toEqual({ cursor: null, exhausted: true });

    const callsBefore = calls.length;
    const page3 = await syncXTweetChannel(api, 3, authFollows, undefined, undefined, AUTH, graphQL);
    expect(calls.length).toBe(callsBefore);
    expect(page3.totalCount).toBe(page2.totalCount);
    expect(page3.hasMore).toBe(false);
  });

  it('鉴权失效（HTTP 401 / GraphQL code 32）向上传播可读错误', async () => {
    const { graphQL } = stubGraphQL([
      { match: /UserByScreenName/, body: makeUserByScreenNameBody('168139512') },
      { match: /UserTweets/, body: JSON.stringify({ errors: [{ code: 32, message: 'Could not authenticate you' }] }) },
    ]);
    await expect(syncXTweetChannel(makeApi(new Map()), 1, authFollows, undefined, undefined, AUTH, graphQL))
      .rejects.toThrow('鉴权已失效');

    const { graphQL: httpGraphQL } = stubGraphQL([
      { match: /UserByScreenName/, body: makeUserByScreenNameBody('168139512') },
      { match: /UserTweets/, body: new Error('x.com responded 401') },
    ]);
    await expect(syncXTweetChannel(makeApi(new Map()), 1, authFollows, undefined, undefined, AUTH, httpGraphQL))
      .rejects.toThrow('鉴权已失效');
  });

  it('缓存的 queryId 过期（404）时自动从 bundle 重提取并重试', async () => {
    const { graphQL: fullGraphQL, calls: fullCalls } = stubGraphQL([
      { match: /UserByScreenName/, body: makeUserByScreenNameBody('168139512') },
      { match: /^https:\/\/x\.com\/home$/, body: '<html><script src="https://abs.twimg.com/responsive-web/client-web/main.deadbeef.js"></script></html>' },
      { match: /main\.deadbeef\.js$/, body: 'queryId:"FRESHQID",operationName:"UserTweets" queryId:"FRESHUSER",operationName:"UserByScreenName"' },
      { match: /STALEQID/, body: new Error('x.com responded 404') },
      { match: /FRESHQID/, body: REAL_USER_TWEETS_JSON },
    ]);
    // 预置过期缓存 queryId，让第一次 UserTweets 命中 404
    storage.metaRef.current.queryIds = { UserTweets: 'STALEQID', UserByScreenName: 'FRESHUSER' };
    const details = new Map<string, GitHubRepoDetailRead | null>([['obsidianmd/knap', makeDetail('obsidianmd/knap')]]);
    const result = await syncXTweetChannel(makeApi(details), 1, authFollows, undefined, undefined, AUTH, fullGraphQL);
    expect(result.repos.length).toBeGreaterThan(0);
    expect((await xTweetStorage.getSyncMeta()).queryIds.UserTweets).toBe('FRESHQID');
    // home + main bundle + 两次 UserTweets（过期 + 重试）
    expect(fullCalls.some((url) => url.includes('x.com/home'))).toBe(true);
    expect(fullCalls.filter((url) => url.includes('/UserTweets')).length).toBe(2);
  });
});

describe('probeXTweetSource（鉴权路径）', () => {
  it('走 GraphQL 解析并返回推文数与仓库链接数', async () => {
    const { graphQL } = stubGraphQL([
      { match: /UserByScreenName/, body: makeUserByScreenNameBody('168139512') },
      { match: /UserTweets/, body: REAL_USER_TWEETS_JSON },
    ]);
    const result = await probeXTweetSource('geekbb', undefined, AUTH, graphQL);
    expect(result).toMatchObject({ ok: true, tweetCount: 19 });
    expect(result.repoCount).toBeGreaterThan(0);
  });
});
