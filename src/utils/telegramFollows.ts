/**
 * Telegram 频道关注配置的纯工具：默认关注与输入归一化。
 * 被 store（hydration/migrate）与设置弹窗共用，不依赖 React / Store。
 */

import type { TelegramFollow } from '../types';

/** 初始关注列表（用户可删除/追加） */
export const DEFAULT_TELEGRAM_FOLLOWS: TelegramFollow[] = [
  { channel: 'geekhub23', addedAt: '2026-09-13T00:00:00.000Z' },
];

/**
 * Telegram 频道用户名的宽松语义：3-64 位字母/数字/下划线。公开预览页
 * t.me/s/<name> 是唯一判定标准，这里放宽到不误杀，无效名由抓取阶段报错。
 */
const CHANNEL_PATTERN = /^[A-Za-z0-9_]{3,64}$/;

/**
 * 把用户输入归一化为频道名（不含 @）。接受多种形式：
 * `@name`、裸 `name`、`https://t.me/name`（含 /s/name 预览链接、末尾消息 id
 * 与查询参数）。无法识别时返回 null。
 */
export const normalizeTelegramChannelInput = (input: string): string | null => {
  const raw = input.trim();
  if (!raw) return null;

  let candidate = raw;
  const urlMatch = raw.match(/^https?:\/\/(?:www\.)?t\.me\/(?:s\/)?([A-Za-z0-9_]+)(?:[/?#].*)?$/i);
  if (urlMatch) {
    candidate = urlMatch[1];
  } else {
    candidate = raw.replace(/^@+/, '');
  }

  return CHANNEL_PATTERN.test(candidate) ? candidate : null;
};

/** 排序键：按频道名去重时保留最早添加的记录 */
const byAddedAtAsc = (a: TelegramFollow, b: TelegramFollow) => a.addedAt.localeCompare(b.addedAt);

/** 修复持久化/外部输入的关注列表：去重（大小写不敏感）、剔除非法项。 */
export const normalizeTelegramFollows = (value: unknown): TelegramFollow[] => {
  if (!Array.isArray(value)) return DEFAULT_TELEGRAM_FOLLOWS.map((follow) => ({ ...follow }));

  const byKey = new Map<string, TelegramFollow>();
  for (const item of value) {
    const channel = typeof (item as { channel?: unknown })?.channel === 'string'
      ? normalizeTelegramChannelInput((item as { channel: string }).channel)
      : null;
    if (!channel) continue;
    const addedAt = typeof (item as { addedAt?: unknown })?.addedAt === 'string'
      && Number.isFinite(Date.parse((item as { addedAt: string }).addedAt))
      ? (item as { addedAt: string }).addedAt
      : '1970-01-01T00:00:00.000Z';
    const key = channel.toLowerCase();
    const existing = byKey.get(key);
    if (!existing || byAddedAtAsc({ channel, addedAt }, existing) < 0) {
      byKey.set(key, { channel, addedAt });
    }
  }
  return [...byKey.values()];
};
