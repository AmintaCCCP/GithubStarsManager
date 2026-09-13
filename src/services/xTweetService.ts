/**
 * X 推文频道数据服务（自研抓取器，直连 x.com，不依赖第三方实例）。
 *
 * 两种抓取模式：
 * - 未登录（默认）：传输层（Electron 主进程 IPC 或 fullstack 服务端路由）
 *   代抓 https://x.com/<handle> 未登录主页 HTML → 解析页面内嵌的 React
 *   Flight 数据（推文 ID 在 `client:VHdlZXQ6<base64>` 引用中解码，正文与
 *   链接实体在 `:details` 块内，发布时间由雪花 ID 推导）→ expanded_url 提取
 *   GitHub 仓库链接（复用周刊提取规则）。源能力边界（2026-09 实测）：每次
 *   返回每博主最新一小批推文、无历史翻页游标。
 * - 鉴权（用户在设置中填写自己的 auth_token/ct0）：走 x.com GraphQL 内部
 *   接口（公共 Web Bearer + 用户 Cookie），UserByScreenName 解析 rest_id、
 *   UserTweets 拉取时间线——每位博主每页约 20 条、bottom cursor 支持真实
 *   服务端翻页（与 Telegram 频道同构：游标落盘跨会话续传，page 1 刷新
 *   不回退已推进游标，60 秒水位只拦 page 1）。queryId 会随发版轮换：
 *   缓存命中优先，未命中/404 时从登录态首页引用的 main.<hash>.js bundle
 *   重新提取，失败再退回内置兜底值。
 *
 * 两条路径共用：仓库 upsert（原贴指向发布时间最新的推文）→ 详情补全
 * （GraphQL 批量优先，REST 逐仓回退）→ 独立 IndexedDB 持久化 → 按推文
 * 时间倒序分页切片。纯浏览器（静态部署）受 CORS 限制不可用，需桌面版或
 * 服务端模式。
 */

import type {
  DiscoveryChannelId,
  DiscoveryRepo,
  PaginatedDiscoveryRepositories,
  WeeklySyncStatus,
  XTweetAuth,
  XTweetFollow,
} from '../types';
import { logger } from './logger';
import { backend } from './backendAdapter';
import { fetchXTimelineViaDesktop, fetchXGraphQLViaDesktop } from './electronProxy';
import type { GitHubApiService } from './githubApi';
import { extractRepoFullNames } from './weeklyIssuesService';
import {
  xTweetStorage,
  type XStoredRepo,
  type XStoredTweet,
  type XTweetSyncMeta,
} from './xTweetStorage';

const X_TWEET_CHANNEL: DiscoveryChannelId = 'x-tweet';
/** 频道每页卡片数 */
export const X_TWEET_CARD_PAGE_SIZE = 20;
const HANDLE_THROTTLE_MS = 500;
const REST_ENRICH_THROTTLE_MS = 80;
/** 仓库详情的刷新周期：30 天内的快照视为新鲜 */
const REPO_DETAIL_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** 不可用仓库（404/私有）的重试周期 */
const UNAVAILABLE_RETRY_MS = 7 * 24 * 60 * 60 * 1000;
/** 60 秒内同步过则跳过刷新遍历（重复触发走缓存） */
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

export const isValidXTweetHandle = (handle: string): boolean =>
  /^[A-Za-z0-9_]{1,15}$/.test(handle);

export type XTimelineTransport = (handle: string) => Promise<string>;

/**
 * 传输层：抓取 x.com 未登录主页 HTML。桌面端走主进程 IPC（跟随应用代理），
 * 失败时回退 fullstack 服务端路由；两者都不可用时抛错（纯浏览器模式不支持）。
 */
export const defaultXTimelineTransport: XTimelineTransport = async (handle) => {
  let desktopError: unknown = null;
  if (typeof window !== 'undefined' && window.electronAPI?.xFetchTimeline) {
    try {
      const html = await fetchXTimelineViaDesktop(handle);
      if (html !== null) return html;
    } catch (error) {
      desktopError = error;
    }
  }
  const backendUrl = backend.backendUrl;
  if (backendUrl) {
    const response = await fetch(`${backendUrl}/xtweet/profile/${encodeURIComponent(handle)}`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`服务端抓取 x.com 失败 (${response.status})`);
    }
    const data = await response.json();
    if (typeof data?.html === 'string') return data.html;
    throw new Error('服务端返回数据无效');
  }
  if (desktopError) throw desktopError;
  throw new Error('当前运行模式不支持 X 推文抓取：需要桌面版（Electron）或服务端模式');
};

/** 从 Flight 的 client 引用解码推文 ID（VHdlZXQ6… == base64("Tweet:<id>")） */
export function decodeTweetRef(ref: string): string | null {
  try {
    const decoded = atob(ref);
    const match = decoded.match(/^Tweet:(\d+)$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/* ============ 鉴权 GraphQL 路径 ============ */

/** 兜底 queryId（2026-09 实测；queryId 随 x.com 发版轮换，缓存未命中时重新提取） */
const FALLBACK_X_QUERY_IDS: Record<string, string> = {
  UserTweets: 'OeFjWKHutsuyWXZGmLr02A',
  UserByScreenName: 'KybxDj9RrADIITXlGG8kpw',
};
const X_GRAPHQL_OPERATIONS = ['UserTweets', 'UserByScreenName'] as const;
/** 每页请求的推文数（与官网客户端一致） */
const USER_TWEETS_PAGE_SIZE = 20;

const X_GRAPHQL_FEATURES = JSON.stringify({
  rweb_tipjar_consumption_enabled: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_metadata_extensions_enabled: true,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  articles_preview_enabled: true,
  tweetypie_unmention_optimization_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  creator_subscriptions_quote_tweet_preview_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  rweb_video_timestamps_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
});

/**
 * 鉴权路径传输层：GET 一个 x.com GraphQL / 静态资源 URL，返回响应正文。
 * 鉴权 Cookie 只经桌面 IPC 参数或服务端 POST 体传递（URL 不带敏感信息）。
 * 非 2xx 抛错（消息含状态码，供上层映射"鉴权失效/限流"）。
 */
export type XGraphQLTransport = (url: string, auth: XTweetAuth) => Promise<string>;

export const defaultXGraphQLTransport: XGraphQLTransport = async (url, auth) => {
  let desktopError: unknown = null;
  if (typeof window !== 'undefined' && window.electronAPI?.xFetchGraphQL) {
    try {
      const body = await fetchXGraphQLViaDesktop(url, auth);
      if (body !== null) return body;
    } catch (error) {
      desktopError = error;
    }
  }
  const backendUrl = backend.backendUrl;
  if (backendUrl) {
    const response = await fetch(`${backendUrl}/xtweet/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, auth }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`服务端 X GraphQL 请求失败 (${response.status})`);
    }
    const data = await response.json();
    if (typeof data?.body === 'string') return data.body;
    throw new Error('服务端返回数据无效');
  }
  if (desktopError) throw desktopError;
  throw new Error('当前运行模式不支持 X 鉴权抓取：需要桌面版（Electron）或服务端模式');
};

const compactJson = (value: Record<string, unknown>): string => JSON.stringify(value);

/** UserTweets 请求 URL（cursor 为空即第一页） */
export const buildUserTweetsUrl = (
  userId: string,
  cursor: string | null | undefined,
  queryId: string,
): string =>
  `https://x.com/i/api/graphql/${queryId}/UserTweets?variables=${encodeURIComponent(compactJson({
    userId,
    count: USER_TWEETS_PAGE_SIZE,
    ...(cursor ? { cursor } : {}),
    includePromotedContent: false,
    withQuickPromoteEligibilityTweetFields: false,
    withVoice: false,
  }))}&features=${encodeURIComponent(X_GRAPHQL_FEATURES)}`;

/** UserByScreenName 请求 URL（handle → rest_id） */
export const buildUserByScreenNameUrl = (handle: string, queryId: string): string =>
  `https://x.com/i/api/graphql/${queryId}/UserByScreenName?variables=${encodeURIComponent(compactJson({
    screen_name: handle,
    withGrokTranslatedBio: false,
  }))}`;

/**
 * 从登录态首页引用的 main.<hash>.js bundle 提取当前 queryId
 * （queryId 随 x.com 发版轮换；登录态首页才引用含全部 operation 的 bundle）。
 */
export async function extractXGraphQLQueryIds(
  auth: XTweetAuth,
  graphQL: XGraphQLTransport,
): Promise<Record<string, string>> {
  const homeHtml = await graphQL('https://x.com/home', auth);
  const mainJsUrl = homeHtml.match(/https:\/\/abs\.twimg\.com\/responsive-web\/client-web\/main\.[a-f0-9]+\.js/)?.[0];
  if (!mainJsUrl) throw new Error('无法定位 x.com 主脚本（页面结构可能已变化）');
  const mainJs = await graphQL(mainJsUrl, auth);
  const ids: Record<string, string> = {};
  for (const operation of X_GRAPHQL_OPERATIONS) {
    const id = mainJs.match(new RegExp(`queryId:"([A-Za-z0-9_-]+)",operationName:"${operation}"`))?.[1];
    if (id) ids[operation] = id;
  }
  if (!ids.UserTweets || !ids.UserByScreenName) {
    throw new Error('无法从 x.com 主脚本提取 GraphQL queryId');
  }
  return ids;
}

/** queryId 解析：meta 缓存 → 线上 bundle 提取（成功后写缓存）→ 内置兜底。 */
async function resolveXQueryIds(
  meta: XTweetSyncMeta,
  auth: XTweetAuth,
  graphQL: XGraphQLTransport,
): Promise<Record<string, string>> {
  if (meta.queryIds.UserTweets && meta.queryIds.UserByScreenName) return meta.queryIds;
  try {
    const ids = await extractXGraphQLQueryIds(auth, graphQL);
    meta.queryIds = { ...meta.queryIds, ...ids };
    void xTweetStorage.saveSyncMeta(meta);
    return meta.queryIds;
  } catch (error) {
    logger.warn('xTweet', 'queryId bundle extraction failed, using fallback', error);
    return { ...FALLBACK_X_QUERY_IDS, ...meta.queryIds };
  }
}

/** 用户 ID 解析：meta 缓存 → UserByScreenName。 */
async function resolveXUserId(
  handle: string,
  meta: XTweetSyncMeta,
  auth: XTweetAuth,
  graphQL: XGraphQLTransport,
): Promise<string> {
  const cached = meta.userIds[handle.toLowerCase()];
  if (cached) return cached;
  const ids = await resolveXQueryIds(meta, auth, graphQL);
  const body = await graphQL(buildUserByScreenNameUrl(handle, ids.UserByScreenName), auth);
  const restId = JSON.parse(body)?.data?.user?.result?.rest_id;
  if (typeof restId !== 'string' || !restId) {
    throw new Error(`无法解析 @${handle} 的用户 ID（账号可能不存在或已受限）`);
  }
  meta.userIds[handle.toLowerCase()] = restId;
  return restId;
}

/** 推文时间（"Sun Sep 13 06:17:25 +0000 2026"）→ ISO；无法解析回退纪元。 */
export function tweetDateToIso(value: string): string {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : new Date(0).toISOString();
}

const escapeHtmlText = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * full_text + url 实体 → 展示用 HTML 片段：t.co 短链按实体索引替换为指向
 * expanded_url 的锚点，其余文本转义，换行转 <br/>。索引按 UTF-16 逐段
 * 切分（与 Twitter 的 indices 语义一致）。
 */
export function buildTweetContentHtml(
  fullText: string,
  urls: Array<{ url?: string; expanded_url?: string; indices?: [number, number] }>,
): string {
  const sorted = [...urls]
    .filter((u) => Array.isArray(u.indices) && u.indices.length === 2)
    .sort((a, b) => a.indices![0] - b.indices![0]);
  const parts: string[] = [];
  let pos = 0;
  for (const entity of sorted) {
    const [start, end] = entity.indices!;
    if (start < pos || start >= end || end > fullText.length) continue;
    parts.push(escapeHtmlText(fullText.slice(pos, start)));
    const href = entity.expanded_url || entity.url || '';
    parts.push(`<a href="${escapeHtmlText(href)}">${escapeHtmlText(fullText.slice(start, end))}</a>`);
    pos = end;
  }
  parts.push(escapeHtmlText(fullText.slice(pos)));
  return parts.join('').replace(/\n/g, '<br/>');
}

interface TweetLegacyCore {
  full_text?: string;
  created_at?: string;
  entities?: { urls?: Array<{ url?: string; expanded_url?: string; indices?: [number, number] }> };
}

/**
 * 解析 UserTweets 响应 JSON：时间线条目 → 推文（含转推条目，归博主）。
 * 鉴权失效（code 32/239）抛可读错误；账号不存在/受限抛错由上层跳过。
 * cursor-bottom 是下一页游标，缺失即时间线取尽。
 */
export function parseXUserTweetsJson(
  body: string,
  handle: string,
): { tweets: XStoredTweet[]; nextCursor: string | null; exhausted: boolean } {
  let data: {
    errors?: Array<{ code?: number; message?: string }>;
    data?: {
      user?: {
        result?: {
          __typename?: string;
          core?: { name?: string };
          timeline_v2?: XTimelinePayload;
          timeline?: XTimelinePayload;
        };
      };
    };
  };
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error('X GraphQL 响应不是有效 JSON');
  }
  if (!data?.data && Array.isArray(data?.errors) && data.errors.length > 0) {
    const code = data.errors[0]?.code;
    if (code === 32 || code === 239 || code === 89 || code === 326) {
      throw new Error('X 鉴权已失效（auth_token/ct0 无效或过期），请在设置中更新或清除鉴权配置');
    }
    throw new Error(`X GraphQL 错误: ${data.errors[0]?.message ?? 'unknown'}`);
  }
  const userResult = data?.data?.user?.result;
  if (!userResult || userResult.__typename === 'UserUnavailable') {
    throw new Error(`无法获取 @${handle} 的时间线（账号可能不存在、受限制或已注销）`);
  }
  const displayName = userResult.core?.name || handle;
  const instructions = (userResult.timeline_v2 ?? userResult.timeline)?.timeline?.instructions ?? [];
  const entries = (instructions.find((instruction) => instruction.type === 'TimelineAddEntries')?.entries ?? []) as Array<{
    entryId?: string;
    content?: {
      entryType?: string;
      value?: string;
      itemContent?: {
        tweet_results?: {
          result?: {
            __typename?: string;
            rest_id?: string;
            legacy?: TweetLegacyCore;
            tweet?: { rest_id?: string; legacy?: TweetLegacyCore };
          };
        };
      };
    };
  }>;

  const tweets: XStoredTweet[] = [];
  let nextCursor: string | null = null;
  for (const entry of entries) {
    const entryId = entry.entryId ?? '';
    if (entryId.startsWith('cursor-bottom') && entry.content?.value) {
      nextCursor = entry.content.value;
      continue;
    }
    if (!entryId.startsWith('tweet-') || entry.content?.entryType !== 'TimelineTimelineItem') continue;
    const result = entry.content?.itemContent?.tweet_results?.result;
    if (!result || result.__typename === 'TweetTombstone') continue;
    const tweetId = result.rest_id ?? result.tweet?.rest_id ?? entryId.slice('tweet-'.length);
    const legacy = result.legacy ?? result.tweet?.legacy;
    if (!tweetId || !legacy?.full_text) continue;
    const urls = legacy.entities?.urls ?? [];
    tweets.push({
      tweetId,
      handle,
      displayName,
      content: buildTweetContentHtml(legacy.full_text, urls),
      htmlUrl: `https://x.com/${handle}/status/${tweetId}`,
      createdAt: tweetDateToIso(legacy.created_at ?? ''),
      repoFullNames: [...new Set(
        extractRepoFullNames([
          ...urls.map((u) => u.expanded_url ?? ''),
          legacy.full_text,
        ].join('\n')),
      )].map((fullName) => fullName.toLowerCase()),
    });
  }
  return { tweets, nextCursor, exhausted: nextCursor === null };
}

interface XTimelinePayload {
  timeline?: { instructions?: Array<{ type?: string; entries?: unknown }> };
}

/** 单博主一页的鉴权抓取：queryId 404 时失效缓存并重提取一次后重试。 */
async function fetchXUserTimelinePage(
  userId: string,
  cursor: string | null | undefined,
  meta: XTweetSyncMeta,
  auth: XTweetAuth,
  graphQL: XGraphQLTransport,
): Promise<string> {
  const ids = await resolveXQueryIds(meta, auth, graphQL);
  try {
    return await graphQL(buildUserTweetsUrl(userId, cursor, ids.UserTweets), auth);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('401') || message.includes('403')) {
      throw new Error('X 鉴权已失效（auth_token/ct0 无效或过期），请在设置中更新或清除鉴权配置');
    }
    if (!message.includes('404')) throw error;
    logger.warn('xTweet', 'UserTweets queryId stale, re-extracting from bundle');
    delete meta.queryIds.UserTweets;
    const fresh = await resolveXQueryIds(meta, auth, graphQL);
    return graphQL(buildUserTweetsUrl(userId, cursor, fresh.UserTweets), auth);
  }
}

/** 仍有历史页可拉的博主（pages 无记录视为未翻过页） */
const handlesWithMore = (meta: XTweetSyncMeta, handles: string[]): string[] =>
  handles.filter((handle) => {
    const state = meta.pages[handle.toLowerCase()];
    return !state || !state.exhausted;
  });

/**
 * 单博主一页的抓取-解析-落盘（推文+仓库+游标/用户ID/queryId 同一事务），
 * 返回本轮触达的仓库键。抓取/解析失败向上抛出，由调用方按"跳过该博主"
 * 处理。cursor 为 null/undefined（page 1 或该博主从未翻过页）时拉最新页，
 * 且只在从未初始化过游标时写入——绝不回退已推进的位置。
 */
async function fetchAndIngestXUserPage(
  handle: string,
  page: number,
  meta: XTweetSyncMeta,
  auth: XTweetAuth,
  tweets: Map<string, XStoredTweet>,
  repos: Map<string, XStoredRepo>,
  graphQL: XGraphQLTransport,
  signal: AbortSignal,
): Promise<Set<string>> {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const userId = await resolveXUserId(handle, meta, auth, graphQL);
  const key = handle.toLowerCase();
  const known = meta.pages[key];
  const cursor = page <= 1
    ? null
    : (meta.pages[key]?.cursor ?? null);
  const body = await fetchXUserTimelinePage(userId, cursor, meta, auth, graphQL);
  const parsed = parseXUserTweetsJson(body, handle);
  if (cursor === null || cursor === undefined) {
    // 最新页：游标只在从未翻过页时初始化，绝不回退已推进的位置
    if (!known) {
      meta.pages[key] = { cursor: parsed.nextCursor, exhausted: parsed.exhausted };
    }
  } else {
    meta.pages[key] = { cursor: parsed.nextCursor, exhausted: parsed.exhausted };
  }
  const { newTweets, pendingRepoKeys } = ingestFeedTweets(parsed.tweets, tweets, repos);
  // 逐博主原子落盘（推文+仓库+meta 同一事务，水位此时不推进）
  await xTweetStorage.saveSyncBatch({
    tweets: newTweets,
    repos: [...pendingRepoKeys]
      .map((repoKey) => repos.get(repoKey))
      .filter((repo): repo is XStoredRepo => Boolean(repo)),
    meta,
  });
  return pendingRepoKeys;
}

/** 雪花 ID → 发布时间（Twitter epoch 1288834974657）。ID 超出 Number 安全范围，必须用 BigInt。 */
export function tweetSnowflakeToDate(tweetId: string): string {
  try {
    const ms = (BigInt(tweetId) >> 22n) + 1288834974657n;
    return new Date(Number(ms)).toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}

/** Flight 内嵌字符串是 JS 字面量（\n \" 转义），按 JSON 字符串语义还原。 */
const unescapeFlightString = (raw: string): string => {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw;
  }
};

const TWEET_MARK_PATTERN = /client:(VHdlZXQ6[A-Za-z0-9+/=]+):(legacy|details|counts|views)/g;
/** 顶层时间线条目：TimelineTimelineEntry:tweet-<ID>:content（嵌套的引用/转推原文不在其中） */
const TIMELINE_ENTRY_PATTERN = /TimelineTimelineEntry:tweet-(\d+):content/g;

/**
 * 解析 x.com 未登录主页 HTML 中的推文。只认顶层时间线条目列出的推文——
 * 嵌套的引用推文（quoted status）属于其他作者，若一并扫入会把它们误归属
 * 给被关注的博主。每条推文的 `:details` 块内含 full_text 与链接实体；
 * 同一推文的引用在 Flight 图中重复出现，按 ID 去重。
 */
export function parseXTimelineHtml(html: string, handle: string): XStoredTweet[] {
  const timelineIds = new Set([...html.matchAll(TIMELINE_ENTRY_PATTERN)].map((m) => m[1]));
  const tweets = new Map<string, XStoredTweet>();
  const marks = [...html.matchAll(TWEET_MARK_PATTERN)];
  for (let i = 0; i < marks.length; i++) {
    const mark = marks[i];
    if (mark[2] !== 'details') continue;
    const tweetId = decodeTweetRef(mark[1]);
    if (!tweetId || !timelineIds.has(tweetId) || tweets.has(tweetId)) continue;
    const blockStart = (mark.index ?? 0) + mark[0].length;
    const blockEnd = i + 1 < marks.length ? (marks[i + 1].index ?? blockStart) : blockStart + 8000;
    const body = html.slice(blockStart, blockEnd);
    const fullText = body.match(/full_text:"((?:[^"\\]|\\.)*)"/);
    if (!fullText) continue;
    const content = unescapeFlightString(fullText[1]);
    const repoFullNames = [...new Set(
      [...body.matchAll(/expanded_url:"(https:\/\/github\.com\/[^"]+)"/g)]
        .map((m) => extractRepoFullNames(unescapeFlightString(m[1])))
        .flat(),
    )].map((fullName) => fullName.toLowerCase());
    tweets.set(tweetId, {
      tweetId,
      handle,
      displayName: handle,
      content,
      htmlUrl: `https://x.com/${handle}/status/${tweetId}`,
      createdAt: tweetSnowflakeToDate(tweetId),
      repoFullNames,
    });
  }
  return [...tweets.values()];
}

/**
 * 处理一轮解析结果：新推文进内存映射并登记，推文涉及的仓库 upsert
 * （原贴指向发布时间最新的推文），返回本轮需要补全详情的仓库键。
 */
export function ingestFeedTweets(
  feed: XStoredTweet[],
  tweets: Map<string, XStoredTweet>,
  repos: Map<string, XStoredRepo>,
): { newTweets: XStoredTweet[]; pendingRepoKeys: Set<string> } {
  const newTweets: XStoredTweet[] = [];
  const pendingRepoKeys = new Set<string>();
  for (const tweet of feed) {
    if (tweets.has(tweet.tweetId)) continue;
    tweets.set(tweet.tweetId, tweet);
    newTweets.push(tweet);

    for (const key of tweet.repoFullNames) {
      const repo = repos.get(key);
      if (!repo) {
        repos.set(key, {
          fullName: key,
          detail: null,
          lastFetchedAt: '',
          sourceTweetId: tweet.tweetId,
          tweetCreatedAt: tweet.createdAt,
        });
      } else if (tweet.createdAt > repo.tweetCreatedAt) {
        repo.sourceTweetId = tweet.tweetId;
        repo.tweetCreatedAt = tweet.createdAt;
      }
      pendingRepoKeys.add(key);
    }
  }
  return { newTweets, pendingRepoKeys };
}

/** 需要补全/维护详情的仓库：新触达（从未拉过）、过期快照、到期重试的不可用仓库。 */
export function reposNeedingDetail(
  repos: Map<string, XStoredRepo>,
  touchedKeys: Set<string>,
  nowMs: number,
): XStoredRepo[] {
  const targets: XStoredRepo[] = [];
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
  targets: XStoredRepo[],
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
      logger.warn('xTweet', `Repo details unavailable: ${repo.fullName}`, error);
      repo.lastFetchedAt = new Date().toISOString();
    }
    onStatus?.({ phase: 'enriching', current: i + 1, total: targets.length });
    await sleep(REST_ENRICH_THROTTLE_MS);
  }
}

/** GraphQL 批量补全；部分批次失败时仅对未成功的仓库回退 REST。 */
async function enrichRepos(
  api: GitHubApiService,
  targets: XStoredRepo[],
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
      if (detail) repo.detail = detail;
    }
  } catch (error) {
    if (isAbortError(error) || isRateLimitError(error) || isTokenInvalidError(error)) throw error;
    logger.warn('xTweet', 'GraphQL batch enrichment failed, falling back to REST', error);
  }
  const restTargets = targets.filter((repo) => !appliedKeys.has(repo.fullName.toLowerCase()));
  if (restTargets.length > 0) {
    await enrichReposViaRest(api, restTargets, onStatus, signal);
  }
}

/** 由已补全详情的仓库构建频道卡片（未补全详情的条目暂不展示）。 */
export function buildXTweetDiscoveryRepos(
  tweets: Map<string, XStoredTweet>,
  repos: Map<string, XStoredRepo>,
  handles: string[],
): DiscoveryRepo[] {
  const handleSet = new Set(handles.map((handle) => handle.toLowerCase()));
  const list: DiscoveryRepo[] = [];
  for (const repo of repos.values()) {
    if (!repo.detail) continue;
    const tweet = tweets.get(repo.sourceTweetId);
    if (!tweet || !handleSet.has(tweet.handle.toLowerCase())) continue;
    list.push({
      ...repo.detail,
      rank: 0,
      channel: X_TWEET_CHANNEL,
      platform: 'All',
      xTweet: {
        tweetId: tweet.tweetId,
        handle: tweet.handle,
        displayName: tweet.displayName,
        content: tweet.content,
        html_url: tweet.htmlUrl,
        createdAt: tweet.createdAt,
      },
    });
  }
  list.sort((a, b) => (b.xTweet?.createdAt ?? '').localeCompare(a.xTweet?.createdAt ?? ''));
  list.forEach((repo, index) => { repo.rank = index + 1; });
  return list;
}

let syncAbortController: AbortController | null = null;
let syncInFlight: Promise<void> | null = null;

/** 互斥执行：新请求中止上一轮并等待其落盘结算后再开新一轮。 */
async function runExclusiveSync(
  body: (signal: AbortSignal) => Promise<void>,
  onStatus: StatusCallback,
): Promise<void> {
  syncAbortController?.abort();
  // 等待被中止轮次完成落盘，避免旧快照覆盖新一轮刚写入的结果
  if (syncInFlight) await syncInFlight.catch(() => {});
  const controller = new AbortController();
  syncAbortController = controller;
  const run = body(controller.signal);
  syncInFlight = run.then(() => {}, () => {});
  try {
    await run;
  } finally {
    // 仅在仍持有同步权时清空状态，避免被中止的旧轮次清掉新一轮的进度显示
    if (syncAbortController === controller) {
      syncAbortController = null;
      onStatus?.(null);
    }
  }
}

/**
 * 60 秒水位需同时满足：时间在窗口内 + 关注列表签名一致。
 * 只看时间戳会让"同步后 60 秒内新添加的关注"被跳过、直到窗口结束才被抓取。
 */
const isRecentlySynced = (meta: { lastSyncedAt: string | null; followsSignature: string }, signature: string): boolean =>
  meta.followsSignature === signature
  && meta.lastSyncedAt !== null
  && Number.isFinite(Date.parse(meta.lastSyncedAt))
  && Date.now() - Date.parse(meta.lastSyncedAt) < RECENT_SYNC_SKIP_MS;

/** 关注列表签名：规范化 handle 排序拼接（大小写不敏感去重后的集合身份） */
const followsSignatureOf = (handles: string[]): string =>
  [...new Set(handles.map((handle) => handle.toLowerCase()))].sort().join(',');

/**
 * 频道抓取入口（refreshChannel 调用）：
 * - 配置了 auth（鉴权 GraphQL 路径）：走 syncXTweetChannelWithAuth——真实
 *   服务端翻页，"加载更多"每点击一次对每位未取尽的博主拉下一页；
 * - 未配置（默认未登录路径）：
 *   - page 1（手动刷新/首次进入）：距上次同步超 60 秒时，逐博主重抓最新
 *     批次（增量，已知推文按 ID 跳过），新触达仓库批量补全详情；
 *   - page N（加载更多）：缓存不足该页窗口且距上次同步超 60 秒时补一次
 *     刷新，否则纯切片；
 *   每页返回累积前缀（前 page × 20 张卡片，调用方整体替换），因为刷新
 *   新增的卡片会落进已消费的窗口内，append 切片永远补不到。
 */
export async function syncXTweetChannel(
  api: GitHubApiService,
  page: number,
  follows: XTweetFollow[],
  onStatus: StatusCallback,
  transport: XTimelineTransport = defaultXTimelineTransport,
  auth: XTweetAuth | null = null,
  graphQL: XGraphQLTransport = defaultXGraphQLTransport,
): Promise<PaginatedDiscoveryRepositories> {
  const handles = [...new Set(
    follows.map((follow) => follow.handle).filter((handle) => isValidXTweetHandle(handle)),
  )];
  if (handles.length === 0) {
    return { repos: [], hasMore: false, nextPageIndex: page + 1, totalCount: 0 };
  }
  if (auth) {
    return syncXTweetChannelWithAuth(api, page, handles, auth, onStatus, graphQL);
  }

  const windowEnd = page * X_TWEET_CARD_PAGE_SIZE;
  const signature = followsSignatureOf(handles);
  const meta0 = await xTweetStorage.getSyncMeta();
  const recent = isRecentlySynced(meta0, signature);
  // 预读快照：不触网时直接复用为结算数据，避免同一次调用里重复全量遍历
  let snapshot: { tweets: Map<string, XStoredTweet>; repos: Map<string, XStoredRepo> } | null = null;
  let needsSync = page <= 1 && !recent;
  if (!needsSync) {
    const [tweets, repos] = await Promise.all([
      xTweetStorage.getAllTweets(),
      xTweetStorage.getAllRepos(),
    ]);
    snapshot = { tweets, repos };
    if (page > 1) {
      needsSync = buildXTweetDiscoveryRepos(tweets, repos, handles).length < windowEnd;
    }
  }

  if (needsSync) {
    await runExclusiveSync(async (signal) => {
      // 上一轮可能已落盘新数据，重读最新状态
      const meta = await xTweetStorage.getSyncMeta();
      if (isRecentlySynced(meta, signature)) return;
      meta.followsSignature = signature;
      const tweets = await xTweetStorage.getAllTweets();
      const repos = await xTweetStorage.getAllRepos();

      const touchedRepoKeys = new Set<string>();
      let succeeded = 0;
      let firstError: unknown = null;
      for (const handle of handles) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        onStatus?.({ phase: 'syncing', current: succeeded, total: handles.length });
        // 抓取/解析失败只跳过该博主（账号不存在/网络抖动不拖垮整轮）
        let parsed: XStoredTweet[];
        try {
          const html = await transport(handle);
          parsed = parseXTimelineHtml(html, handle);
        } catch (error) {
          if (isAbortError(error)) throw error;
          logger.warn('xTweet', `Timeline fetch failed for @${handle}`, error);
          firstError = firstError ?? error;
          await sleep(HANDLE_THROTTLE_MS);
          continue;
        }
        const { newTweets, pendingRepoKeys } = ingestFeedTweets(parsed, tweets, repos);
        for (const key of pendingRepoKeys) touchedRepoKeys.add(key);
        // 逐博主原子落盘（推文+仓库同一事务，水位此时不推进）。
        // 写失败必须上抛中止整轮：内存合并态（tweets/原贴指针）无法安全
        // 回滚，带着脏状态继续会让未持久化的合并混入末轮落盘
        await xTweetStorage.saveSyncBatch({
          tweets: newTweets,
          repos: [...touchedRepoKeys]
            .map((key) => repos.get(key))
            .filter((repo): repo is XStoredRepo => Boolean(repo)),
          meta,
        });
        succeeded++;
        await sleep(HANDLE_THROTTLE_MS);
      }
      if (succeeded === 0 && handles.length > 0) {
        throw firstError instanceof Error
          ? firstError
          : new Error('X 推文抓取失败：所有博主的时间线均不可达');
      }

      const enrichTargets = reposNeedingDetail(repos, touchedRepoKeys, Date.now());
      const touchedRepos = () => [...touchedRepoKeys]
        .map((key) => repos.get(key))
        .filter((repo): repo is XStoredRepo => Boolean(repo));
      try {
        await enrichRepos(api, enrichTargets, onStatus, signal);
        // 成功路径：详情与水位同一事务提交——若失败回滚，下轮会重抓而不是
        // 带着新水位跳过、把缺详情的仓库晾到 TTL 才补
        meta.lastSyncedAt = new Date().toISOString();
        await xTweetStorage.saveSyncBatch({ tweets: [], repos: touchedRepos(), meta });
      } catch (error) {
        if (isAbortError(error)) {
          // 取消：保留已获取的详情，但不推进水位（下轮继续补全）
          await xTweetStorage.saveSyncBatch({ tweets: [], repos: touchedRepos(), meta });
        }
        // 限流/令牌错误：不提交部分或降级详情，也不推进水位
        throw error;
      }
    }, onStatus);
  }

  // 触网轮次内部已有原子落盘，结算读最新；未触网轮次复用预读快照
  const settled = needsSync
    ? {
        tweets: await xTweetStorage.getAllTweets(),
        repos: await xTweetStorage.getAllRepos(),
      }
    : snapshot!;
  const accumulated = buildXTweetDiscoveryRepos(settled.tweets, settled.repos, handles);
  return {
    repos: accumulated.slice(0, windowEnd),
    hasMore: accumulated.length > windowEnd,
    nextPageIndex: page + 1,
    totalCount: accumulated.length,
  };
}

/**
 * 鉴权 GraphQL 同步（真实服务端翻页，与 Telegram 频道同构）：
 * - page 1：距上次同步超 60 秒时逐博主重抓最新页（增量）；
 * - page N：对每位未取尽的博主按落盘游标拉下一页（一次点击翻一页，
 *   不受水位拦截），随后整体重建切片；
 * - 游标/用户 ID/queryId 随推文原子落盘跨会话续传；page 1 刷新不回退
 *   已推进的游标；频道全部取尽后纯切片直至缓存耗尽。
 */
async function syncXTweetChannelWithAuth(
  api: GitHubApiService,
  page: number,
  handles: string[],
  auth: XTweetAuth,
  onStatus: StatusCallback,
  graphQL: XGraphQLTransport,
): Promise<PaginatedDiscoveryRepositories> {
  const windowEnd = page * X_TWEET_CARD_PAGE_SIZE;
  // 签名带鉴权标记：切换鉴权/匿名后 60 秒水位立即失效，触发重抓
  const signature = `${followsSignatureOf(handles)}|${auth ? 'auth' : 'anon'}`;
  const meta0 = await xTweetStorage.getSyncMeta();
  const recent = isRecentlySynced(meta0, signature);
  let snapshot: { tweets: Map<string, XStoredTweet>; repos: Map<string, XStoredRepo> } | null = null;
  let needsSync = page <= 1 && !recent;
  if (!needsSync) {
    const [tweets, repos] = await Promise.all([
      xTweetStorage.getAllTweets(),
      xTweetStorage.getAllRepos(),
    ]);
    snapshot = { tweets, repos };
    if (page > 1) {
      needsSync = handlesWithMore(meta0, handles).length > 0;
    }
  }

  if (needsSync) {
    await runExclusiveSync(async (signal) => {
      const meta = await xTweetStorage.getSyncMeta();
      if (page <= 1 && isRecentlySynced(meta, signature)) return;
      meta.followsSignature = signature;
      const tweets = await xTweetStorage.getAllTweets();
      const repos = await xTweetStorage.getAllRepos();

      const touchedRepoKeys = new Set<string>();
      let succeeded = 0;
      let firstError: unknown = null;
      // page N 只翻未取尽的博主；page 1 始终重抓全部博主最新页
      const targets = page <= 1 ? handles : handlesWithMore(meta, handles);
      for (const handle of targets) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        onStatus?.({ phase: 'syncing', current: succeeded, total: targets.length });
        try {
          const pendingKeys = await fetchAndIngestXUserPage(
            handle, page, meta, auth, tweets, repos, graphQL, signal,
          );
          for (const key of pendingKeys) touchedRepoKeys.add(key);
        } catch (error) {
          if (isAbortError(error)) throw error;
          // 抓取/解析失败只跳过该博主（账号不存在/网络抖动不拖垮整轮）
          logger.warn('xTweet', `Authenticated timeline fetch failed for @${handle}`, error);
          firstError = firstError ?? error;
          await sleep(HANDLE_THROTTLE_MS);
          continue;
        }
        succeeded++;
        await sleep(HANDLE_THROTTLE_MS);
      }
      if (succeeded === 0 && targets.length > 0) {
        throw firstError instanceof Error
          ? firstError
          : new Error('X 推文抓取失败：所有博主的时间线均不可达');
      }

      const enrichTargets = reposNeedingDetail(repos, touchedRepoKeys, Date.now());
      const touchedRepos = () => [...touchedRepoKeys]
        .map((key) => repos.get(key))
        .filter((repo): repo is XStoredRepo => Boolean(repo));
      try {
        await enrichRepos(api, enrichTargets, onStatus, signal);
        meta.lastSyncedAt = new Date().toISOString();
        await xTweetStorage.saveSyncBatch({ tweets: [], repos: touchedRepos(), meta });
      } catch (error) {
        if (isAbortError(error)) {
          // 取消：保留已获取的详情，但不推进水位（下轮继续补全）
          await xTweetStorage.saveSyncBatch({ tweets: [], repos: touchedRepos(), meta });
        }
        throw error;
      }
    }, onStatus);
  }

  const settled = needsSync
    ? {
        tweets: await xTweetStorage.getAllTweets(),
        repos: await xTweetStorage.getAllRepos(),
      }
    : snapshot!;
  const settledMeta = await xTweetStorage.getSyncMeta();
  const accumulated = buildXTweetDiscoveryRepos(settled.tweets, settled.repos, handles);
  const allExhausted = handlesWithMore(settledMeta, handles).length === 0;
  return {
    repos: accumulated.slice(0, windowEnd),
    hasMore: allExhausted ? accumulated.length > windowEnd : true,
    nextPageIndex: page + 1,
    totalCount: accumulated.length,
  };
}

/** 设置弹窗"测试连接"：真实抓取一位博主主页并解析，返回可验证的结果。
 *  配置鉴权时走 GraphQL UserTweets（每页约 20 条），否则走未登录 HTML。 */
export async function probeXTweetSource(
  handle: string,
  transport: XTimelineTransport = defaultXTimelineTransport,
  auth: XTweetAuth | null = null,
  graphQL: XGraphQLTransport = defaultXGraphQLTransport,
): Promise<{ ok: boolean; tweetCount?: number; repoCount?: number; error?: string }> {
  if (!isValidXTweetHandle(handle)) {
    return { ok: false, error: '无效的用户名' };
  }
  try {
    if (auth) {
      const meta = await xTweetStorage.getSyncMeta();
      const userId = await resolveXUserId(handle, meta, auth, graphQL);
      const body = await fetchXUserTimelinePage(userId, null, meta, auth, graphQL);
      const parsed = parseXUserTweetsJson(body, handle);
      return {
        ok: true,
        tweetCount: parsed.tweets.length,
        repoCount: parsed.tweets.reduce((sum, tweet) => sum + tweet.repoFullNames.length, 0),
      };
    }
    const html = await transport(handle);
    const parsed = parseXTimelineHtml(html, handle);
    return {
      ok: true,
      tweetCount: parsed.length,
      repoCount: parsed.reduce((sum, tweet) => sum + tweet.repoFullNames.length, 0),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
