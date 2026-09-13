/**
 * Telegram 频道数据服务（自研抓取器，直连 t.me 公开网页预览，不依赖第三方实例）。
 *
 * 数据管道：传输层（Electron 主进程 IPC 或 fullstack 服务端路由）代抓
 * https://t.me/s/<name> 公开预览 HTML → DOMParser 解析消息块（消息 ID 取自
 * data-post，正文在 tgme_widget_message_text，发布时间取 time[datetime]）→
 * 正文与链接预览中提取 GitHub 仓库链接（复用周刊提取规则）→ 按
 * `<channel>/<id>` 去重增量合并 → 仓库详情补全（GraphQL 批量优先，REST 逐仓
 * 回退）→ 独立 IndexedDB 持久化 → 按消息时间倒序分页切片。
 *
 * 分页模型（2026-09 实测）：公开预览页每页返回最新起的 20 条消息，页内
 * <link rel="prev" href="?before=N"> 指向更早一页（before=N 返回 id < N 的
 * 消息），rel=prev 消失即频道历史取尽。与 X 频道不同，这里是真实的服务端
 * 翻页：每个"加载更多"对每个未取尽的关注频道拉取一页，游标（含取尽标记）
 * 随消息原子落盘跨会话续传；page 1 刷新始终重抓最新页且不回退已推进的
 * 游标。60 秒水位只用于 page 1 去抖，不拦"加载更多"（点了就该翻页）。
 * 纯浏览器（静态部署）受 CORS 限制不可用，需桌面版或服务端模式。
 */

import type {
  DiscoveryChannelId,
  DiscoveryRepo,
  PaginatedDiscoveryRepositories,
  TelegramFollow,
  WeeklySyncStatus,
} from '../types';
import { logger } from './logger';
import { backend, getBackendAuthHeaders } from './backendAdapter';
import { fetchTelegramChannelViaDesktop } from './electronProxy';
import type { GitHubApiService } from './githubApi';
import { extractRepoFullNames } from './weeklyIssuesService';
import {
  telegramStorage,
  type TelegramStoredMessage,
  type TelegramStoredRepo,
  type TelegramSyncMeta,
} from './telegramStorage';

const TELEGRAM_CHANNEL: DiscoveryChannelId = 'telegram';
/** 频道每页卡片数（UI 分页窗口） */
export const TELEGRAM_CARD_PAGE_SIZE = 20;
/** 逐频道抓取之间的节流间隔 */
const CHANNEL_THROTTLE_MS = 500;
const REST_ENRICH_THROTTLE_MS = 80;
/** 仓库详情的刷新周期：30 天内的快照视为新鲜 */
const REPO_DETAIL_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** 不可用仓库（404/私有）的重试周期 */
const UNAVAILABLE_RETRY_MS = 7 * 24 * 60 * 60 * 1000;
/** 60 秒内同步过则跳过 page 1 刷新遍历（重复触发走缓存；不拦加载更多） */
const RECENT_SYNC_SKIP_MS = 60 * 1000;

type StatusCallback = ((status: WeeklySyncStatus | null) => void) | undefined;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const isAbortError = (error: unknown): boolean =>
  (error instanceof Error && (error.name === 'AbortError' || error.message === 'Aborted')) ||
  (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError');

const isRateLimitError = (error: unknown): boolean =>
  error instanceof Error && error.message.startsWith('GitHub API rate limit exceeded');

const isTokenInvalidError = (error: unknown): boolean =>
  error instanceof Error && error.message.includes('token expired or invalid');

/** 持久化失败标记：saveSyncBatch 拒绝必须中止整轮，不能按频道抓取失败跳过。 */
const markPersistenceError = (error: unknown): unknown => {
  if (error instanceof Error) {
    (error as Error & { isPersistenceError?: boolean }).isPersistenceError = true;
  }
  return error;
};

const isPersistenceError = (error: unknown): boolean =>
  error instanceof Error && (error as Error & { isPersistenceError?: boolean }).isPersistenceError === true;

/** 分页游标未前进：不能当普通抓取失败跳过，否则 hasMore 会永远为 true。 */
const markStalledCursorError = (error: unknown): unknown => {
  if (error instanceof Error) {
    (error as Error & { isStalledCursorError?: boolean }).isStalledCursorError = true;
  }
  return error;
};

const isStalledCursorError = (error: unknown): boolean =>
  error instanceof Error && (error as Error & { isStalledCursorError?: boolean }).isStalledCursorError === true;

export const isValidTelegramChannel = (channel: string): boolean =>
  /^[A-Za-z0-9_]{3,64}$/.test(channel);

export type TelegramChannelTransport = (channel: string, before?: string) => Promise<string>;

/**
 * 传输层：抓取 t.me/s/<name> 公开预览 HTML（before 为上一页游标）。桌面端走
 * 主进程 IPC（跟随应用代理），失败时回退 fullstack 服务端路由；两者都不可用
 * 时抛错（纯浏览器模式不支持）。
 */
export const defaultTelegramChannelTransport: TelegramChannelTransport = async (channel, before) => {
  let desktopError: unknown = null;
  if (typeof window !== 'undefined' && window.electronAPI?.telegramFetchChannel) {
    try {
      const html = await fetchTelegramChannelViaDesktop(channel, before);
      if (html !== null) return html;
    } catch (error) {
      desktopError = error;
    }
  }
  const backendUrl = backend.backendUrl;
  if (backendUrl) {
    const suffix = before ? `?before=${encodeURIComponent(before)}` : '';
    const response = await fetch(`${backendUrl}/telegram/channel/${encodeURIComponent(channel)}${suffix}`, {
      headers: getBackendAuthHeaders(),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`服务端抓取 t.me 失败 (${response.status})`);
    }
    const data = await response.json();
    if (typeof data?.html === 'string') return data.html;
    throw new Error('服务端返回数据无效');
  }
  if (desktopError) throw desktopError;
  throw new Error('当前运行模式不支持 Telegram 频道抓取：需要桌面版（Electron）或服务端模式');
};

/**
 * 解析 t.me/s/<name> 公开预览页：消息 + 下一页游标。服务消息（如"频道创建"）
 * 无正文，自然跳过；纯媒体消息无正文但可能在链接预览里带仓库链接，照样
 * 收录为仓库来源。正文中相对链接（?q=、/s/）改写为 t.me 绝对地址，供离线
 * 渲染时点击。
 */
export function parseTelegramChannelHtml(
  html: string,
  channel: string,
): { messages: TelegramStoredMessage[]; nextCursor: string | null; exhausted: boolean } {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // <link rel="prev" href="/s/<name>?before=N"> 是官方翻页锚点；缺失即取尽
  const prevHref = doc.querySelector('link[rel="prev"]')?.getAttribute('href') ?? null;
  const prevBefore = prevHref?.match(/[?&]before=(\d+)/)?.[1] ?? null;

  const displayName =
    doc.querySelector('.tgme_widget_message_owner_name span')?.textContent?.trim()
    || doc.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim()
    || channel;

  const messages: TelegramStoredMessage[] = [];
  const blocks = doc.querySelectorAll('.tgme_widget_message[data-post]');
  for (const block of blocks) {
    const post = block.getAttribute('data-post') ?? '';
    const slashIndex = post.indexOf('/');
    if (slashIndex <= 0) continue;
    const postChannel = post.slice(0, slashIndex);
    const messageId = post;
    const timeEl = block.querySelector('time[datetime]');
    const datetime = timeEl?.getAttribute('datetime') ?? '';
    const createdAt = datetime && Number.isFinite(Date.parse(datetime))
      ? new Date(datetime).toISOString()
      : new Date(0).toISOString();

    const textEl = block.querySelector('.tgme_widget_message_text');
    let content = '';
    if (textEl) {
      // 相对链接改写为绝对地址（?q= 是频道内话题搜索，/开头是站内路径）
      for (const anchor of textEl.querySelectorAll('a[href]')) {
        const href = anchor.getAttribute('href');
        if (href && /^[?/]/.test(href) && !href.startsWith('//')) {
          anchor.setAttribute('href', href.startsWith('/')
            ? `https://t.me${href}`
            : `https://t.me/${channel}${href}`);
        }
      }
      content = textEl.innerHTML.trim();
    }
    // 链接预览卡（无正文的纯分享消息也可能命中仓库链接）
    const previewHrefs = [...block.querySelectorAll('.tgme_widget_message_link_preview a[href], a.tgme_widget_message_link_preview[href]')]
      .map((anchor) => anchor.getAttribute('href') ?? '');
    const repoFullNames = [...new Set(
      [content, ...previewHrefs].flatMap((part) => extractRepoFullNames(part)),
    )].map((fullName) => fullName.toLowerCase());

    messages.push({
      messageId,
      channel: postChannel,
      displayName,
      content,
      htmlUrl: `https://t.me/${postChannel}/${messageId.slice(postChannel.length + 1)}`,
      createdAt,
      repoFullNames,
    });
  }

  return {
    messages,
    nextCursor: prevBefore,
    exhausted: prevBefore === null,
  };
}

/**
 * 处理一轮解析结果：新消息进内存映射并登记，消息涉及的仓库 upsert
 * （原贴指向发布时间最新的消息），返回本轮需要补全详情的仓库键。
 */
export function ingestFeedMessages(
  feed: TelegramStoredMessage[],
  messages: Map<string, TelegramStoredMessage>,
  repos: Map<string, TelegramStoredRepo>,
): { newMessages: TelegramStoredMessage[]; pendingRepoKeys: Set<string> } {
  const newMessages: TelegramStoredMessage[] = [];
  const pendingRepoKeys = new Set<string>();
  for (const message of feed) {
    if (messages.has(message.messageId)) continue;
    messages.set(message.messageId, message);
    newMessages.push(message);

    for (const key of message.repoFullNames) {
      const repo = repos.get(key);
      if (!repo) {
        repos.set(key, {
          fullName: key,
          detail: null,
          lastFetchedAt: '',
          sourceMessageId: message.messageId,
          messageCreatedAt: message.createdAt,
        });
      } else if (message.createdAt > repo.messageCreatedAt) {
        repo.sourceMessageId = message.messageId;
        repo.messageCreatedAt = message.createdAt;
      }
      pendingRepoKeys.add(key);
    }
  }
  return { newMessages, pendingRepoKeys };
}

/** 需要补全/维护详情的仓库：新触达（从未拉过）、过期快照、到期重试的不可用仓库。 */
export function reposNeedingDetail(
  repos: Map<string, TelegramStoredRepo>,
  touchedKeys: Set<string>,
  nowMs: number,
): TelegramStoredRepo[] {
  const targets: TelegramStoredRepo[] = [];
  for (const key of touchedKeys) {
    const repo = repos.get(key);
    if (!repo) continue;
    if (!repo.lastFetchedAt) {
      targets.push(repo);
    } else if (repo.detail) {
      if (nowMs - Date.parse(repo.lastFetchedAt) > REPO_DETAIL_TTL_MS) targets.push(repo);
    } else if (nowMs - Date.parse(repo.lastFetchedAt) > UNAVAILABLE_RETRY_MS) {
      targets.push(repo);
    }
  }
  return targets;
}

/** REST 逐仓补全回退路径（GraphQL 不可用时），限流/鉴权错误直接上抛中止本轮。 */
async function enrichReposViaRest(
  api: GitHubApiService,
  targets: TelegramStoredRepo[],
  onStatus: StatusCallback,
  signal?: AbortSignal,
): Promise<void> {
  for (let i = 0; i < targets.length; i++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const repo = targets[i];
    const [owner, name] = repo.fullName.split('/');
    try {
      repo.detail = await api.getRepositoryDetails(owner, name, signal);
      repo.lastFetchedAt = new Date().toISOString();
    } catch (error) {
      if (isAbortError(error) || isRateLimitError(error) || isTokenInvalidError(error)) throw error;
      // 404/410/其他 4xx：标记不可用，到期重试（makeRequest 已做过网络/5xx 重试）
      logger.warn('telegram', `Repo details unavailable: ${repo.fullName}`, error);
      repo.lastFetchedAt = new Date().toISOString();
    }
    onStatus?.({ phase: 'enriching', current: i + 1, total: targets.length });
    await sleep(REST_ENRICH_THROTTLE_MS);
  }
}

/** GraphQL 批量补全；部分批次失败时仅对未成功的仓库回退 REST。 */
async function enrichRepos(
  api: GitHubApiService,
  targets: TelegramStoredRepo[],
  onStatus: StatusCallback,
  signal?: AbortSignal,
): Promise<void> {
  if (targets.length === 0) return;
  const total = targets.length;
  onStatus?.({ phase: 'enriching', current: 0, total });
  const fullNames = targets.map((repo) => repo.fullName);
  const appliedKeys = new Set<string>();
  try {
    const details = await api.graphqlFetchRepositories(fullNames, {
      signal,
      batchSize: 100,
      onBatchDone: (doneBatches) => {
        const done = Math.min(total, doneBatches * 100);
        onStatus?.({ phase: 'enriching', current: done, total });
      },
    });
    const fetchedAtIso = new Date().toISOString();
    for (const [key, detail] of details) {
      const repo = targets.find((repo) => repo.fullName.toLowerCase() === key);
      if (!repo) continue;
      if (detail !== undefined) appliedKeys.add(key);
      repo.lastFetchedAt = fetchedAtIso;
      repo.detail = detail ?? null;
    }
  } catch (error) {
    if (isAbortError(error) || isRateLimitError(error) || isTokenInvalidError(error)) throw error;
    logger.warn('telegram', 'GraphQL batch enrichment failed, falling back to REST', error);
  }
  const restTargets = targets.filter((repo) => !appliedKeys.has(repo.fullName.toLowerCase()));
  if (restTargets.length > 0) {
    await enrichReposViaRest(api, restTargets, onStatus, signal);
  }
}

/** 由已补全详情的仓库构建频道卡片（未补全详情的条目暂不展示）。 */
export function buildTelegramDiscoveryRepos(
  messages: Map<string, TelegramStoredMessage>,
  repos: Map<string, TelegramStoredRepo>,
  channels: string[],
): DiscoveryRepo[] {
  const channelSet = new Set(channels.map((channel) => channel.toLowerCase()));
  const list: DiscoveryRepo[] = [];
  for (const repo of repos.values()) {
    if (!repo.detail) continue;
    const message = messages.get(repo.sourceMessageId);
    if (!message || !channelSet.has(message.channel.toLowerCase())) continue;
    list.push({
      ...repo.detail,
      rank: 0,
      channel: TELEGRAM_CHANNEL,
      platform: 'All',
      telegram: {
        messageId: message.messageId,
        channel: message.channel,
        displayName: message.displayName,
        content: message.content,
        html_url: message.htmlUrl,
        createdAt: message.createdAt,
      },
    });
  }
  list.sort((a, b) => (b.telegram?.createdAt ?? '').localeCompare(a.telegram?.createdAt ?? ''));
  list.forEach((repo, index) => { repo.rank = index + 1; });
  return list;
}

let syncAbortController: AbortController | null = null;
let syncInFlight: Promise<void> | null = null;

/** 互斥执行：先登记新一轮再等待旧轮，避免重叠请求并发执行 body。 */
async function runExclusiveSync(
  body: (signal: AbortSignal) => Promise<void>,
  onStatus: StatusCallback,
): Promise<void> {
  const controller = new AbortController();
  const prev = syncInFlight;
  const prevController = syncAbortController;
  let resolveSlot: () => void = () => {};
  const slot = new Promise<void>((resolve) => { resolveSlot = resolve; });
  // 先登记：后续请求等待的是本轮 slot，不会与本轮同时进入 body
  syncAbortController = controller;
  syncInFlight = slot;
  prevController?.abort();
  // 等待被中止轮次完成落盘，避免旧快照覆盖新一轮刚写入的结果
  if (prev) await prev.catch(() => {});
  // 等待期间可能已被更新的请求取代：直接退出，不执行 body
  if (syncAbortController !== controller) {
    resolveSlot();
    return;
  }
  const run = body(controller.signal);
  try {
    await run;
  } finally {
    resolveSlot();
    // 仅在仍持有同步权时清空状态，避免被中止的旧轮次清掉新一轮的进度显示
    if (syncAbortController === controller) {
      syncAbortController = null;
      syncInFlight = null;
      onStatus?.(null);
    }
  }
}

/**
 * 60 秒水位需同时满足：时间在窗口内 + 关注列表签名一致。
 * 只看时间戳会让"同步后 60 秒内新添加的关注"被跳过、直到窗口结束才被抓取。
 * 水位只用于 page 1 刷新去抖；"加载更多"每点击一次就该翻一页，不受它拦截。
 */
const isRecentlySynced = (meta: TelegramSyncMeta, signature: string): boolean =>
  meta.followsSignature === signature
  && meta.lastSyncedAt !== null
  && Number.isFinite(Date.parse(meta.lastSyncedAt))
  && Date.now() - Date.parse(meta.lastSyncedAt) < RECENT_SYNC_SKIP_MS;

/** 关注列表签名：规范化频道名排序拼接（大小写不敏感去重后的集合身份） */
const followsSignatureOf = (channels: string[]): string =>
  [...new Set(channels.map((channel) => channel.toLowerCase()))].sort().join(',');

/** 仍有历史页可拉的频道（pages 无记录视为未翻过页） */
const channelsWithMore = (meta: TelegramSyncMeta, channels: string[]): string[] =>
  channels.filter((channel) => {
    const state = meta.pages[channel.toLowerCase()];
    return !state || !state.exhausted;
  });

/**
 * 单频道一页的抓取-解析-落盘（消息+仓库+游标同一事务）。返回本轮新增的
 * 仓库键。抓取/解析失败向上抛出，由调用方按"跳过该频道"处理。
 */
async function fetchAndIngestChannelPage(
  channel: string,
  before: string | null | undefined,
  meta: TelegramSyncMeta,
  messages: Map<string, TelegramStoredMessage>,
  repos: Map<string, TelegramStoredRepo>,
  transport: TelegramChannelTransport,
  signal: AbortSignal,
): Promise<Set<string>> {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  let parsed: ReturnType<typeof parseTelegramChannelHtml>;
  const key = channel.toLowerCase();
  const known = meta.pages[key];
  try {
    const html = await transport(channel, before ?? undefined);
    parsed = parseTelegramChannelHtml(html, channel);
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw error;
  }
  if (before === null || before === undefined) {
    // page 1 刷新：游标只在从未翻过页时初始化，绝不回退已推进的位置
    if (!known) {
      meta.pages[key] = { cursor: parsed.nextCursor, exhausted: parsed.exhausted };
    }
  } else {
    // 请求游标与下一页游标相同且非空：上游未前进，落盘会让 hasMore 永远为 true
    if (before && parsed.nextCursor === before) {
      throw markStalledCursorError(new Error(`Telegram 分页游标未前进（@${channel} before=${before}）`));
    }
    meta.pages[key] = { cursor: parsed.nextCursor, exhausted: parsed.exhausted };
  }
  const { newMessages, pendingRepoKeys } = ingestFeedMessages(parsed.messages, messages, repos);
  // 逐频道原子落盘（消息+仓库+游标同一事务，水位此时不推进）。
  // 写失败必须上抛中止整轮：内存合并态无法安全回滚，带着脏状态继续会让
  // 未持久化的合并混入末轮落盘（调用方按 isPersistenceError 识别并直接抛出）
  try {
    await telegramStorage.saveSyncBatch({
      messages: newMessages,
      repos: [...pendingRepoKeys]
        .map((repoKey) => repos.get(repoKey))
        .filter((repo): repo is TelegramStoredRepo => Boolean(repo)),
      meta,
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw markPersistenceError(error);
  }
  return pendingRepoKeys;
}

/**
 * 频道抓取入口（refreshChannel 调用）：
 * - page 1（手动刷新/首次进入）：距上次同步超 60 秒时，逐频道重抓最新页
 *   （增量，已知消息按 `<channel>/<id>` 跳过），新触达仓库批量补全详情；
 * - page N（加载更多）：对每个未取尽的频道按落盘游标拉取下一页（一次点击
 *   每频道翻一页），随后整体重建切片；频道全部取尽后纯切片直至缓存耗尽。
 * 每页返回累积前缀（前 page × 20 张卡片，调用方整体替换），因为 page 1
 * 刷新新增的卡片会落进已消费的窗口内，append 切片永远补不到。
 */
export async function syncTelegramChannel(
  api: GitHubApiService,
  page: number,
  follows: TelegramFollow[],
  onStatus: StatusCallback,
  transport: TelegramChannelTransport = defaultTelegramChannelTransport,
): Promise<PaginatedDiscoveryRepositories> {
  const channels = [...new Set(
    follows.map((follow) => follow.channel).filter((channel) => isValidTelegramChannel(channel)),
  )];
  if (channels.length === 0) {
    return { repos: [], hasMore: false, nextPageIndex: page + 1, totalCount: 0 };
  }

  const windowEnd = page * TELEGRAM_CARD_PAGE_SIZE;
  const signature = followsSignatureOf(channels);
  const meta0 = await telegramStorage.getSyncMeta();
  const recent = isRecentlySynced(meta0, signature);
  // 预读快照：不触网时直接复用为结算数据，避免同一次调用里重复全量遍历
  let snapshot: { messages: Map<string, TelegramStoredMessage>; repos: Map<string, TelegramStoredRepo> } | null = null;
  let needsSync = page <= 1 && !recent;
  if (!needsSync) {
    const [messages, repos] = await Promise.all([
      telegramStorage.getAllMessages(),
      telegramStorage.getAllRepos(),
    ]);
    snapshot = { messages, repos };
    if (page > 1) {
      needsSync = channelsWithMore(meta0, channels).length > 0;
    }
  }

  if (needsSync) {
    await runExclusiveSync(async (signal) => {
      // 上一轮可能已落盘新数据，重读最新状态
      const meta = await telegramStorage.getSyncMeta();
      if (page <= 1 && isRecentlySynced(meta, signature)) return;
      meta.followsSignature = signature;
      const messages = await telegramStorage.getAllMessages();
      const repos = await telegramStorage.getAllRepos();

      const touchedRepoKeys = new Set<string>();
      let succeeded = 0;
      let firstError: unknown = null;
      // page N 只翻未取尽的频道；page 1 始终重抓全部频道最新页
      const targets = page <= 1 ? channels : channelsWithMore(meta, channels);
      for (const channel of targets) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        onStatus?.({ phase: 'syncing', current: succeeded, total: targets.length });
        const before = page <= 1 ? null : (meta.pages[channel.toLowerCase()]?.cursor ?? null);
        try {
          const pendingKeys = await fetchAndIngestChannelPage(
            channel, before, meta, messages, repos, transport, signal,
          );
          for (const key of pendingKeys) touchedRepoKeys.add(key);
        } catch (error) {
          if (isAbortError(error) || isPersistenceError(error) || isStalledCursorError(error)) throw error;
          // 抓取/解析失败只跳过该频道（频道不可达/网络抖动不拖垮整轮）
          logger.warn('telegram', `Channel page fetch failed for @${channel}`, error);
          firstError = firstError ?? error;
          await sleep(CHANNEL_THROTTLE_MS);
          continue;
        }
        succeeded++;
        await sleep(CHANNEL_THROTTLE_MS);
      }
      if (succeeded === 0 && targets.length > 0) {
        throw firstError instanceof Error
          ? firstError
          : new Error('Telegram 频道抓取失败：所有频道均不可达');
      }

      const enrichTargets = reposNeedingDetail(repos, touchedRepoKeys, Date.now());
      const touchedRepos = () => [...touchedRepoKeys]
        .map((key) => repos.get(key))
        .filter((repo): repo is TelegramStoredRepo => Boolean(repo));
      try {
        await enrichRepos(api, enrichTargets, onStatus, signal);
        // 成功路径：详情与水位同一事务提交——若失败回滚，下轮会重抓而不是
        // 带着新水位跳过、把缺详情的仓库晾到 TTL 才补
        meta.lastSyncedAt = new Date().toISOString();
        await telegramStorage.saveSyncBatch({ messages: [], repos: touchedRepos(), meta });
      } catch (error) {
        if (isAbortError(error)) {
          // 取消：保留已获取的详情，但不推进水位（下轮继续补全）
          await telegramStorage.saveSyncBatch({ messages: [], repos: touchedRepos(), meta });
        }
        // 限流/令牌错误：不提交部分或降级详情，也不推进水位
        throw error;
      }
    }, onStatus);
  }

  // 触网轮次内部已有原子落盘，结算读最新；未触网轮次复用预读快照
  const settled = needsSync
    ? {
        messages: await telegramStorage.getAllMessages(),
        repos: await telegramStorage.getAllRepos(),
      }
    : snapshot!;
  const settledMeta = await telegramStorage.getSyncMeta();
  const accumulated = buildTelegramDiscoveryRepos(settled.messages, settled.repos, channels);
  const allExhausted = channelsWithMore(settledMeta, channels).length === 0;
  return {
    repos: accumulated.slice(0, windowEnd),
    hasMore: allExhausted ? accumulated.length > windowEnd : true,
    nextPageIndex: page + 1,
    totalCount: accumulated.length,
  };
}

/** 设置弹窗"测试连接"：真实抓取一个频道最新页并解析，返回可验证的结果。 */
export async function probeTelegramSource(
  channel: string,
  transport: TelegramChannelTransport = defaultTelegramChannelTransport,
): Promise<{ ok: boolean; messageCount?: number; repoCount?: number; error?: string }> {
  if (!isValidTelegramChannel(channel)) {
    return { ok: false, error: '无效的频道名' };
  }
  try {
    const html = await transport(channel);
    const parsed = parseTelegramChannelHtml(html, channel);
    if (parsed.messages.length === 0) {
      return {
        ok: false,
        error: '未解析到公开消息：频道可能不存在、已转为私有，或没有公开消息',
      };
    }
    return {
      ok: true,
      messageCount: parsed.messages.length,
      repoCount: parsed.messages.reduce((sum, message) => sum + message.repoFullNames.length, 0),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
