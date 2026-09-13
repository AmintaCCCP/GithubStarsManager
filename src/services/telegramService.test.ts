import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { GitHubApiService, GitHubRepoDetailRead } from './githubApi';
import {
  parseTelegramChannelHtml,
  ingestFeedMessages,
  reposNeedingDetail,
  buildTelegramDiscoveryRepos,
  syncTelegramChannel,
  abortTelegramSync,
  probeTelegramSource,
  TELEGRAM_CARD_PAGE_SIZE,
  type TelegramChannelTransport,
} from './telegramService';
import {
  telegramStorage,
  type TelegramStoredMessage,
  type TelegramStoredRepo,
  type TelegramSyncMeta,
} from './telegramStorage';
import type { TelegramFollow } from '../types';

/**
 * fixture 是从 https://t.me/s/geekhub23 公开预览页真实响应中截取的
 * （内联脚本/自定义 emoji 与 CDN 图片已裁剪，DOM 结构与消息、rel=prev
 * 翻页锚点保持原样），解析器直接对着真实上游格式测。
 */
const PAGE1_HTML = readFileSync(
  path.join(__dirname, '__fixtures__', 'telegram-channel-geekhub23-page1.html'),
  'utf-8',
);
const PAGE2_HTML = readFileSync(
  path.join(__dirname, '__fixtures__', 'telegram-channel-geekhub23-page2.html'),
  'utf-8',
);

// 内存版存储替身（jsdom 无 IndexedDB）
const storage = vi.hoisted(() => {
  const messagesStore = new Map<string, unknown>();
  const reposStore = new Map<string, unknown>();
  const metaRef = { current: { lastSyncedAt: null as string | null, followsSignature: '', pages: {} } };
  return {
    messagesStore,
    reposStore,
    metaRef,
    reset() {
      messagesStore.clear();
      reposStore.clear();
      metaRef.current = { lastSyncedAt: null, followsSignature: '', pages: {} };
    },
  };
});

vi.mock('./telegramStorage', () => ({
  telegramStorage: {
    saveMessages: async (messages: TelegramStoredMessage[]) => {
      for (const message of messages) storage.messagesStore.set(message.messageId, message);
    },
    getAllMessages: async () => new Map(storage.messagesStore) as Map<string, TelegramStoredMessage>,
    saveRepos: async (repos: TelegramStoredRepo[]) => {
      for (const repo of repos) storage.reposStore.set(repo.fullName.toLowerCase(), repo);
    },
    getAllRepos: async () => new Map(storage.reposStore) as Map<string, TelegramStoredRepo>,
    getSyncMeta: async () => ({ ...storage.metaRef.current, pages: { ...storage.metaRef.current.pages } }) as TelegramSyncMeta,
    saveSyncMeta: async (meta: TelegramSyncMeta) => {
      storage.metaRef.current = { ...meta, pages: { ...meta.pages } };
    },
    saveSyncBatch: async (payload: { messages: TelegramStoredMessage[]; repos: TelegramStoredRepo[]; meta: TelegramSyncMeta }) => {
      for (const message of payload.messages) storage.messagesStore.set(message.messageId, message);
      for (const repo of payload.repos) storage.reposStore.set(repo.fullName.toLowerCase(), repo);
      storage.metaRef.current = { ...payload.meta, pages: { ...payload.meta.pages } };
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

/** 传输替身：按 `<channel>|<before|''>` 返回预设 HTML（或抛错），记录每次调用 */
const stubTransport = (pages: Record<string, string | Error>): { transport: TelegramChannelTransport; calls: string[] } => {
  const calls: string[] = [];
  const transport: TelegramChannelTransport = async (channel, before) => {
    calls.push(`${channel}|${before ?? ''}`);
    const page = pages[`${channel}|${before ?? ''}`];
    if (page instanceof Error) throw page;
    return page ?? '<html></html>';
  };
  return { transport, calls };
};

const follows: TelegramFollow[] = [
  { channel: 'geekhub23', addedAt: '2026-09-13T00:00:00.000Z' },
];

beforeEach(() => {
  storage.reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseTelegramChannelHtml（真实 t.me/s/geekhub23 公开预览 fixture）', () => {
  it('解析出最新页 20 条真实消息（ID 589-608），游标与取尽标记来自 rel=prev', () => {
    const parsed = parseTelegramChannelHtml(PAGE1_HTML, 'geekhub23');
    expect(parsed.messages).toHaveLength(20);
    const ids = parsed.messages.map((message) => Number(message.messageId.split('/')[1]));
    expect(ids).toEqual(Array.from({ length: 20 }, (_, i) => 589 + i));
    expect(parsed.nextCursor).toBe('589');
    expect(parsed.exhausted).toBe(false);
  });

  it('第二页（?before=589）解析出更早的 20 条（ID 569-588），游标推进到 569', () => {
    const parsed = parseTelegramChannelHtml(PAGE2_HTML, 'geekhub23');
    const ids = parsed.messages.map((message) => Number(message.messageId.split('/')[1]));
    expect(ids).toEqual(Array.from({ length: 20 }, (_, i) => 569 + i));
    expect(parsed.nextCursor).toBe('569');
    expect(parsed.exhausted).toBe(false);
  });

  it('消息字段完整：复合 ID、频道名、显示名、消息链接、发布时间', () => {
    const parsed = parseTelegramChannelHtml(PAGE1_HTML, 'geekhub23');
    const first = parsed.messages[0];
    expect(first.messageId).toBe('geekhub23/589');
    expect(first.channel).toBe('geekhub23');
    expect(first.displayName).toBe('GeekHub资源分享');
    expect(first.htmlUrl).toBe('https://t.me/geekhub23/589');
    expect(first.createdAt).toBe('2026-08-28T02:32:35.000Z');
  });

  it('从正文提取 GitHub 仓库链接（geekhub23 真实分享的仓库，去重小写）', () => {
    const parsed = parseTelegramChannelHtml(PAGE1_HTML, 'geekhub23');
    const first = parsed.messages.find((message) => message.messageId === 'geekhub23/589');
    expect(first?.repoFullNames).toContain('microsoft/powertoys');
    const allRepos = new Set(parsed.messages.flatMap((message) => message.repoFullNames));
    expect(allRepos.has('shubhamsaboo/awesome-llm-apps')).toBe(true);
  });

  it('正文中的相对链接改写为 t.me 绝对地址（频道内话题搜索）', () => {
    const parsed = parseTelegramChannelHtml(PAGE1_HTML, 'geekhub23');
    const withTagLink = parsed.messages.find((message) => message.content.includes('?q=%23'));
    expect(withTagLink).toBeDefined();
    expect(withTagLink!.content).toMatch(/https:\/\/t\.me\/geekhub23\?q=%23/);
    expect(withTagLink!.content).not.toMatch(/href="\?q=/);
  });

  it('无 rel=prev 的页面标记频道历史取尽（末页语义）', () => {
    const html = PAGE1_HTML.replace(/<link rel="prev"[^>]*>/, '');
    const parsed = parseTelegramChannelHtml(html, 'geekhub23');
    expect(parsed.nextCursor).toBeNull();
    expect(parsed.exhausted).toBe(true);
    expect(parsed.messages).toHaveLength(20);
  });

  it('非频道页（空 HTML）返回空消息与取尽标记', () => {
    const parsed = parseTelegramChannelHtml('<html></html>', 'geekhub23');
    expect(parsed.messages).toEqual([]);
    expect(parsed.exhausted).toBe(true);
  });

  it('无正文的消息保留为来源候选：正文为空、链接预览中的仓库链接仍被提取', () => {
    const html = `<html><head><link rel="prev" href="/s/chan?before=9"></head><body>
      <div class="tgme_widget_message text_not_supported_wrap js-widget_message" data-post="chan/9">
        <a class="tgme_widget_message_date" href="/chan/9"><time datetime="2026-09-01T10:00:00+00:00"></time></a>
        <a class="tgme_widget_message_link_preview" href="https://github.com/foo/bar">
          <div class="tgme_widget_message_link_title">bar</div>
        </a>
      </div>
    </body></html>`;
    const parsed = parseTelegramChannelHtml(html, 'chan');
    expect(parsed.messages).toHaveLength(1);
    expect(parsed.messages[0].content).toBe('');
    expect(parsed.messages[0].repoFullNames).toEqual(['foo/bar']);
    expect(parsed.messages[0].createdAt).toBe('2026-09-01T10:00:00.000Z');
  });
});

describe('ingestFeedMessages', () => {
  it('按复合 ID 去重；同仓库多消息时原贴指向最新消息', () => {
    const messages = new Map<string, TelegramStoredMessage>();
    const repos = new Map<string, TelegramStoredRepo>();
    const mk = (id: number, createdAt: string, repo: string): TelegramStoredMessage => ({
      messageId: `chan/${id}`,
      channel: 'chan',
      displayName: 'Chan',
      content: `see https://github.com/${repo}`,
      htmlUrl: `https://t.me/chan/${id}`,
      createdAt,
      repoFullNames: [repo.toLowerCase()],
    });
    ingestFeedMessages([mk(1, '2026-09-01T00:00:00.000Z', 'foo/one'), mk(2, '2026-09-02T00:00:00.000Z', 'foo/one')], messages, repos);
    ingestFeedMessages([mk(1, '2026-09-01T00:00:00.000Z', 'foo/one'), mk(3, '2026-08-30T00:00:00.000Z', 'foo/one')], messages, repos);
    expect(messages.size).toBe(3);
    expect(repos.get('foo/one')!.sourceMessageId).toBe('chan/2');
    expect(repos.get('foo/one')!.messageCreatedAt).toBe('2026-09-02T00:00:00.000Z');
  });

  it('正确更新已编辑消息的正文与仓库关联，重新计算来源归属', () => {
    const messages = new Map<string, TelegramStoredMessage>();
    const repos = new Map<string, TelegramStoredRepo>();

    const msg1: TelegramStoredMessage = {
      messageId: 'chan/10',
      channel: 'chan',
      displayName: 'Chan',
      content: 'old text https://github.com/foo/old',
      htmlUrl: 'https://t.me/chan/10',
      createdAt: '2026-09-01T00:00:00.000Z',
      repoFullNames: ['foo/old'],
    };
    ingestFeedMessages([msg1], messages, repos);
    expect(messages.get('chan/10')!.content).toBe('old text https://github.com/foo/old');
    expect(repos.has('foo/old')).toBe(true);

    // 编辑消息：改为了 foo/new，移除了 foo/old
    const editedMsg1: TelegramStoredMessage = {
      ...msg1,
      content: 'new text https://github.com/foo/new',
      repoFullNames: ['foo/new'],
    };
    const { newMessages, pendingRepoKeys } = ingestFeedMessages([editedMsg1], messages, repos);
    expect(newMessages).toEqual([editedMsg1]);
    expect(messages.get('chan/10')!.content).toBe('new text https://github.com/foo/new');
    expect(repos.has('foo/old')).toBe(false);
    expect(repos.has('foo/new')).toBe(true);
    expect(repos.get('foo/new')!.sourceMessageId).toBe('chan/10');
    expect(pendingRepoKeys.has('foo/new')).toBe(true);
  });
});

describe('reposNeedingDetail', () => {
  it('新触达必补全；新鲜快照跳过；过期快照与到期不可用仓库重试', () => {
    const now = Date.now();
    const repos = new Map<string, TelegramStoredRepo>([
      ['a/b', { fullName: 'a/b', detail: null, lastFetchedAt: '', sourceMessageId: 'c/1', messageCreatedAt: '' }],
      ['c/d', { fullName: 'c/d', detail: makeDetail('c/d'), lastFetchedAt: new Date(now - 1000).toISOString(), sourceMessageId: 'c/1', messageCreatedAt: '' }],
      ['e/f', { fullName: 'e/f', detail: makeDetail('e/f'), lastFetchedAt: new Date(now - 31 * 24 * 3600 * 1000).toISOString(), sourceMessageId: 'c/1', messageCreatedAt: '' }],
      ['g/h', { fullName: 'g/h', detail: null, lastFetchedAt: new Date(now - 8 * 24 * 3600 * 1000).toISOString(), sourceMessageId: 'c/1', messageCreatedAt: '' }],
    ]);
    const targets = reposNeedingDetail(repos, new Set(['a/b', 'c/d', 'e/f', 'g/h']), now);
    expect(targets.map((repo) => repo.fullName)).toEqual(['a/b', 'e/f', 'g/h']);
  });
});

describe('buildTelegramDiscoveryRepos', () => {
  it('只展示当前关注 + 已补全详情的仓库，按消息时间倒序并赋 rank', () => {
    const messages = new Map<string, TelegramStoredMessage>([
      ['a/1', { messageId: 'a/1', channel: 'chan1', displayName: 'C1', content: 'x', htmlUrl: '', createdAt: '2026-09-01T00:00:00.000Z', repoFullNames: ['o/one'] }],
      ['b/2', { messageId: 'b/2', channel: 'chan2', displayName: 'C2', content: 'x', htmlUrl: '', createdAt: '2026-09-02T00:00:00.000Z', repoFullNames: ['o/two'] }],
      ['c/3', { messageId: 'c/3', channel: 'chan3', displayName: 'C3', content: 'x', htmlUrl: '', createdAt: '2026-09-03T00:00:00.000Z', repoFullNames: ['o/three'] }],
    ]);
    const repos = new Map<string, TelegramStoredRepo>([
      ['o/one', { fullName: 'o/one', detail: makeDetail('o/one'), lastFetchedAt: 'x', sourceMessageId: 'a/1', messageCreatedAt: '2026-09-01T00:00:00.000Z' }],
      ['o/two', { fullName: 'o/two', detail: null, lastFetchedAt: 'x', sourceMessageId: 'b/2', messageCreatedAt: '2026-09-02T00:00:00.000Z' }],
      ['o/three', { fullName: 'o/three', detail: makeDetail('o/three'), lastFetchedAt: 'x', sourceMessageId: 'c/3', messageCreatedAt: '2026-09-03T00:00:00.000Z' }],
    ]);
    const list = buildTelegramDiscoveryRepos(messages, repos, ['chan1', 'Chan3']);
    expect(list.map((repo) => repo.full_name)).toEqual(['o/three', 'o/one']);
    expect(list.map((repo) => repo.rank)).toEqual([1, 2]);
    expect(list[0].channel).toBe('telegram');
    expect(list[0].telegram?.messageId).toBe('c/3');
    expect(list[0].telegram?.displayName).toBe('C3');
  });
});

describe('syncTelegramChannel', () => {
  it('首页逐频道真实抓取：解析消息、初始化游标、补全仓库详情、返回前缀切片', async () => {
    const { transport, calls } = stubTransport({ 'geekhub23|': PAGE1_HTML });
    const details = new Map<string, GitHubRepoDetailRead | null>([['microsoft/powertoys', makeDetail('microsoft/PowerToys')]]);
    const result = await syncTelegramChannel(makeApi(details), 1, follows, undefined, transport);

    expect(calls).toEqual(['geekhub23|']);
    expect(result.repos.length).toBeGreaterThan(0);
    expect(result.repos[0].telegram?.channel).toBe('geekhub23');
    expect(result.totalCount).toBe(result.repos.length);
    // 20 条消息不足以填满 20 张卡片窗口且频道未取尽 → 还有更多
    expect(result.hasMore).toBe(true);
    expect(result.nextPageIndex).toBe(2);

    const meta = await telegramStorage.getSyncMeta();
    expect(meta.lastSyncedAt).not.toBeNull();
    expect(meta.pages['geekhub23']).toEqual({ cursor: '589', exhausted: false });
  });

  it('加载更多按落盘游标拉下一页（一次点击翻一页），返回累积前缀', async () => {
    const { transport, calls } = stubTransport({
      'geekhub23|': PAGE1_HTML,
      'geekhub23|589': PAGE2_HTML,
    });
    const details = new Map<string, GitHubRepoDetailRead | null>([
      ['microsoft/powertoys', makeDetail('microsoft/PowerToys')],
      ['shubhamsaboo/awesome-llm-apps', makeDetail('Shubhamsaboo/awesome-llm-apps')],
    ]);
    const api = makeApi(details);
    const page1 = await syncTelegramChannel(api, 1, follows, undefined, transport);
    const page1Count = page1.totalCount ?? 0;

    const page2 = await syncTelegramChannel(api, 2, follows, undefined, transport);
    expect(calls).toEqual(['geekhub23|', 'geekhub23|589']);
    expect(page2.totalCount).toBeGreaterThanOrEqual(page1Count);
    // 累积前缀语义：窗口内是全量列表的前 page × 20 张
    expect(page2.repos).toEqual(
      buildTelegramDiscoveryRepos(
        await telegramStorage.getAllMessages(),
        await telegramStorage.getAllRepos(),
        ['geekhub23'],
      ).slice(0, 2 * TELEGRAM_CARD_PAGE_SIZE),
    );
    const meta = await telegramStorage.getSyncMeta();
    expect(meta.pages['geekhub23']).toEqual({ cursor: '569', exhausted: false });
  });

  it('page 1 刷新重抓最新页但不回退已推进的游标', async () => {
    const { transport } = stubTransport({
      'geekhub23|': PAGE1_HTML,
      'geekhub23|589': PAGE2_HTML,
    });
    const api = makeApi(new Map([['microsoft/powertoys', makeDetail('microsoft/PowerToys')]]));
    await syncTelegramChannel(api, 1, follows, undefined, transport);
    await syncTelegramChannel(api, 2, follows, undefined, transport);
    expect((await telegramStorage.getSyncMeta()).pages['geekhub23']).toEqual({ cursor: '569', exhausted: false });

    // 让 60 秒水位失效，强制 page 1 重新触网
    const meta = await telegramStorage.getSyncMeta();
    meta.lastSyncedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    await telegramStorage.saveSyncMeta(meta);

    await syncTelegramChannel(api, 1, follows, undefined, transport);
    expect((await telegramStorage.getSyncMeta()).pages['geekhub23']).toEqual({ cursor: '569', exhausted: false });
  });

  it('加载更多不受 60 秒水位拦截：刚同步过仍按游标翻页', async () => {
    const { transport, calls } = stubTransport({
      'geekhub23|': PAGE1_HTML,
      'geekhub23|589': PAGE2_HTML,
    });
    const api = makeApi(new Map([['microsoft/powertoys', makeDetail('microsoft/PowerToys')]]));
    await syncTelegramChannel(api, 1, follows, undefined, transport);
    await syncTelegramChannel(api, 2, follows, undefined, transport);
    expect(calls).toEqual(['geekhub23|', 'geekhub23|589']);
  });

  it('频道历史取尽后：纯切片不触网，缓存耗尽即 hasMore=false', async () => {
    const lastPageHtml = PAGE2_HTML.replace(/<link rel="prev"[^>]*>/, '');
    const { transport, calls } = stubTransport({
      'geekhub23|': PAGE1_HTML,
      'geekhub23|589': lastPageHtml,
    });
    const api = makeApi(new Map([['microsoft/powertoys', makeDetail('microsoft/PowerToys')]]));
    await syncTelegramChannel(api, 1, follows, undefined, transport);
    const page2 = await syncTelegramChannel(api, 2, follows, undefined, transport);
    expect((await telegramStorage.getSyncMeta()).pages['geekhub23']).toEqual({ cursor: null, exhausted: true });

    const callsBefore = calls.length;
    const page3 = await syncTelegramChannel(api, 3, follows, undefined, transport);
    expect(calls.length).toBe(callsBefore);
    expect(page3.totalCount).toBe(page2.totalCount);
    expect(page3.hasMore).toBe(false);
  });

  it('加载更多时游标未前进入上抛，不落盘停滞游标', async () => {
    const stalledHtml = PAGE1_HTML; // rel=prev 仍是 before=589
    const { transport } = stubTransport({
      'geekhub23|': PAGE1_HTML,
      'geekhub23|589': stalledHtml,
    });
    const api = makeApi(new Map([['microsoft/powertoys', makeDetail('microsoft/PowerToys')]]));
    await syncTelegramChannel(api, 1, follows, undefined, transport);
    await expect(syncTelegramChannel(api, 2, follows, undefined, transport))
      .rejects.toThrow('分页游标未前进');
    expect((await telegramStorage.getSyncMeta()).pages['geekhub23']).toEqual({ cursor: '589', exhausted: false });
  });

  it('60 秒内重复刷新走缓存，不再调用传输层', async () => {
    const { transport, calls } = stubTransport({ 'geekhub23|': PAGE1_HTML });
    const api = makeApi(new Map([['microsoft/powertoys', makeDetail('microsoft/PowerToys')]]));
    await syncTelegramChannel(api, 1, follows, undefined, transport);
    await syncTelegramChannel(api, 1, follows, undefined, transport);
    expect(calls).toEqual(['geekhub23|']);
  });

  it('单个频道失败不拖垮整轮；全部失败才抛出传输层错误', async () => {
    const multiFollows: TelegramFollow[] = [
      { channel: 'broken', addedAt: '2026-09-13T00:00:00.000Z' },
      { channel: 'geekhub23', addedAt: '2026-09-13T00:00:00.000Z' },
    ];
    const { transport, calls } = stubTransport({
      'broken|': new Error('upstream 502'),
      'geekhub23|': PAGE1_HTML,
    });
    const api = makeApi(new Map([['microsoft/powertoys', makeDetail('microsoft/PowerToys')]]));
    const result = await syncTelegramChannel(api, 1, multiFollows, undefined, transport);
    expect(calls).toEqual(['broken|', 'geekhub23|']);
    expect(result.repos.length).toBeGreaterThan(0);

    await expect(syncTelegramChannel(api, 1, [{ channel: 'broken', addedAt: 'x' }], undefined, stubTransport({ 'broken|': new Error('upstream 502') }).transport))
      .rejects.toThrow('upstream 502');
  });

  it('无效频道名的关注被过滤，不发请求', async () => {
    const { transport, calls } = stubTransport({ 'geekhub23|': PAGE1_HTML });
    const api = makeApi(new Map());
    await syncTelegramChannel(api, 1, [
      { channel: 'bad name!', addedAt: 'x' },
      { channel: 'geekhub23', addedAt: 'x' },
    ], undefined, transport);
    expect(calls).toEqual(['geekhub23|']);
  });

  it('取消关注后其仓库不再出现在列表中（消息缓存保留）', async () => {
    const { transport } = stubTransport({ 'geekhub23|': PAGE1_HTML });
    const api = makeApi(new Map([['microsoft/powertoys', makeDetail('microsoft/PowerToys')]]));
    await syncTelegramChannel(api, 1, follows, undefined, transport);
    const result = await syncTelegramChannel(api, 1, [{ channel: 'other', addedAt: 'x' }], undefined, transport);
    expect(result.repos).toEqual([]);
    expect((await telegramStorage.getAllMessages()).size).toBe(20);
  });

  it('GraphQL 整批失败时逐仓回退 REST 补全', async () => {
    const { transport } = stubTransport({ 'geekhub23|': PAGE1_HTML });
    const api = makeApi(new Map([['microsoft/powertoys', makeDetail('microsoft/PowerToys')]]), new Error('graphql down'));
    const result = await syncTelegramChannel(api, 1, follows, undefined, transport);
    const repo = result.repos.find((item) => item.full_name === 'microsoft/PowerToys');
    expect(repo).toBeDefined();
    expect(api.getRepositoryDetails).toHaveBeenCalled();
  });

  it('onStatus 上报 syncing 与 enriching 进度', async () => {
    const { transport } = stubTransport({ 'geekhub23|': PAGE1_HTML });
    const api = makeApi(new Map([['microsoft/powertoys', makeDetail('microsoft/PowerToys')]]));
    const statuses: (import('../types').WeeklySyncStatus | null)[] = [];
    await syncTelegramChannel(api, 1, follows, (status) => statuses.push(status), transport);
    expect(statuses.some((status) => status?.phase === 'syncing')).toBe(true);
    expect(statuses.some((status) => status?.phase === 'enriching')).toBe(true);
  });

  it('abortTelegramSync 可中断进行中的同步任务', async () => {
    let transportCalled = false;
    const slowTransport: TelegramChannelTransport = async () => {
      transportCalled = true;
      await new Promise((resolve) => setTimeout(resolve, 500));
      return PAGE1_HTML;
    };
    const api = makeApi(new Map());
    const syncPromise = syncTelegramChannel(api, 1, follows, undefined, slowTransport);
    await vi.waitFor(() => expect(transportCalled).toBe(true));
    await abortTelegramSync();
    await expect(syncPromise).rejects.toThrow();
  });
});

describe('probeTelegramSource', () => {
  it('真实解析返回消息数与仓库链接数', async () => {
    const { transport } = stubTransport({ 'geekhub23|': PAGE1_HTML });
    const result = await probeTelegramSource('geekhub23', transport);
    expect(result).toMatchObject({ ok: true, messageCount: 20 });
    expect(result.repoCount).toBeGreaterThan(0);
  });

  it('公开预览无消息（频道不存在/私有/无公开消息）返回可读错误', async () => {
    const { transport } = stubTransport({ 'ghost|': '<html><body>Telegram: Contact @ghost</body></html>' });
    const result = await probeTelegramSource('ghost', transport);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('未解析到公开消息');
  });

  it('无效频道名与抓取失败均返回可展示错误', async () => {
    expect((await probeTelegramSource('bad name!', async () => PAGE1_HTML)).ok).toBe(false);
    expect((await probeTelegramSource('geekhub23', async () => { throw new Error('network down'); })).error).toBe('network down');
  });
});
