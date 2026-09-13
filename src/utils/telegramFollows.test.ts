import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TELEGRAM_FOLLOWS,
  normalizeTelegramChannelInput,
  normalizeTelegramFollows,
} from './telegramFollows';

describe('normalizeTelegramChannelInput', () => {
  it('接受 t.me 频道链接（含公开预览 /s/、消息 id、查询参数）', () => {
    expect(normalizeTelegramChannelInput('https://t.me/geekhub23')).toBe('geekhub23');
    expect(normalizeTelegramChannelInput('https://t.me/s/geekhub23')).toBe('geekhub23');
    expect(normalizeTelegramChannelInput('https://t.me/geekhub23/589')).toBe('geekhub23');
    expect(normalizeTelegramChannelInput('https://t.me/geekhub23?before=589')).toBe('geekhub23');
    expect(normalizeTelegramChannelInput('http://www.t.me/geekhub23')).toBe('geekhub23');
  });

  it('接受 @频道名与裸频道名', () => {
    expect(normalizeTelegramChannelInput('@geekhub23')).toBe('geekhub23');
    expect(normalizeTelegramChannelInput('geekhub23')).toBe('geekhub23');
    expect(normalizeTelegramChannelInput('  geekhub23  ')).toBe('geekhub23');
  });

  it('拒绝无效输入', () => {
    expect(normalizeTelegramChannelInput('')).toBeNull();
    expect(normalizeTelegramChannelInput('   ')).toBeNull();
    expect(normalizeTelegramChannelInput('ab')).toBeNull();
    expect(normalizeTelegramChannelInput('bad name!')).toBeNull();
    expect(normalizeTelegramChannelInput('https://x.com/geekbb')).toBeNull();
    expect(normalizeTelegramChannelInput('https://t.me/')).toBeNull();
  });
});

describe('normalizeTelegramFollows', () => {
  it('默认关注 geekhub23（用户可删除/追加）', () => {
    expect(DEFAULT_TELEGRAM_FOLLOWS).toEqual([
      { channel: 'geekhub23', addedAt: expect.any(String) },
    ]);
    expect(normalizeTelegramFollows(undefined)).toEqual(DEFAULT_TELEGRAM_FOLLOWS);
  });

  it('大小写不敏感去重并保留最早添加的记录', () => {
    const result = normalizeTelegramFollows([
      { channel: 'GeekHub23', addedAt: '2026-09-13T02:00:00.000Z' },
      { channel: 'geekhub23', addedAt: '2026-09-13T01:00:00.000Z' },
      { channel: 'https://t.me/geekhub23', addedAt: '2026-09-13T03:00:00.000Z' },
    ]);
    expect(result).toEqual([{ channel: 'geekhub23', addedAt: '2026-09-13T01:00:00.000Z' }]);
  });

  it('剔除非法项；addedAt 缺失或非法时回退纪元时间', () => {
    const result = normalizeTelegramFollows([
      { channel: 'goodname', addedAt: 'not-a-date' },
      { channel: 'bad name!', addedAt: '2026-09-13T00:00:00.000Z' },
      { channel: 'goodname2' },
    ]);
    expect(result).toEqual([
      { channel: 'goodname', addedAt: '1970-01-01T00:00:00.000Z' },
      { channel: 'goodname2', addedAt: '1970-01-01T00:00:00.000Z' },
    ]);
  });
});
