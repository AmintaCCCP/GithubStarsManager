/**
 * X 推文频道关注配置的纯工具：默认关注与输入归一化。
 * 被 store（hydration/migrate）与设置弹窗共用，不依赖 React / Store。
 */

import type { XTweetAuth, XTweetFollow } from '../types';

/** 初始关注列表（用户可删除/追加） */
export const DEFAULT_XTWEET_FOLLOWS: XTweetFollow[] = [
  { handle: 'geekbb', addedAt: '2026-09-12T00:00:00.000Z' },
];

/** X handle 语义：1-15 位字母数字下划线（宽松允许中间连字符以兼容改名过渡期） */
const HANDLE_PATTERN = /^[A-Za-z0-9_]{1,15}$/;

/**
 * 把用户输入归一化为 handle（不含 @）。接受三种形式：
 * `@handle`、裸 `handle`、`https://x.com/handle`（含 /twitter.com/、末尾路径与查询参数）。
 * 无法识别时返回 null。
 */
export const normalizeXTweetHandleInput = (input: string): string | null => {
  const raw = input.trim();
  if (!raw) return null;

  let candidate = raw;
  const urlMatch = raw.match(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})(?:[/?#].*)?$/i);
  if (urlMatch) {
    candidate = urlMatch[1];
  } else {
    candidate = raw.replace(/^@+/, '');
  }

  return HANDLE_PATTERN.test(candidate) ? candidate : null;
};

/** 排序键：按 handle 去重时保留最早添加的记录 */
const byAddedAtAsc = (a: XTweetFollow, b: XTweetFollow) => a.addedAt.localeCompare(b.addedAt);

/** 修复持久化/外部输入的关注列表：去重（handle 大小写不敏感）、剔除非法项。 */
export const normalizeXTweetFollows = (value: unknown): XTweetFollow[] => {
  if (!Array.isArray(value)) return DEFAULT_XTWEET_FOLLOWS.map((follow) => ({ ...follow }));

  const byKey = new Map<string, XTweetFollow>();
  for (const item of value) {
    const handle = typeof (item as { handle?: unknown })?.handle === 'string'
      ? normalizeXTweetHandleInput((item as { handle: string }).handle)
      : null;
    if (!handle) continue;
    const addedAt = typeof (item as { addedAt?: unknown })?.addedAt === 'string'
      && Number.isFinite(Date.parse((item as { addedAt: string }).addedAt))
      ? (item as { addedAt: string }).addedAt
      : '1970-01-01T00:00:00.000Z';
    const key = handle.toLowerCase();
    const existing = byKey.get(key);
    if (!existing || byAddedAtAsc({ handle, addedAt }, existing) < 0) {
      byKey.set(key, { handle, addedAt });
    }
  }
  return [...byKey.values()];
};

/**
 * 修复持久化的鉴权 Cookie：两端去空白，任一为空即整体视为未配置（null）。
 * Cookie 值本身不做格式校验（x.com 校验），无效值由同步阶段报"鉴权失效"。
 */
export const normalizeXTweetAuth = (value: unknown): XTweetAuth | null => {
  if (!value || typeof value !== 'object') return null;
  const authToken = typeof (value as { authToken?: unknown }).authToken === 'string'
    ? (value as { authToken: string }).authToken.trim()
    : '';
  const ct0 = typeof (value as { ct0?: unknown }).ct0 === 'string'
    ? (value as { ct0: string }).ct0.trim()
    : '';
  if (!authToken || !ct0) return null;
  return { authToken, ct0 };
};
