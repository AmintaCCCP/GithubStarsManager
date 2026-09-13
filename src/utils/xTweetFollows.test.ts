import { describe, it, expect } from 'vitest';
import {
  DEFAULT_XTWEET_FOLLOWS,
  normalizeXTweetFollows,
  normalizeXTweetHandleInput,
  normalizeXTweetAuth,
} from './xTweetFollows';

describe('normalizeXTweetHandleInput', () => {
  it('接受 @用户名、裸用户名与 x.com/twitter.com 主页链接', () => {
    expect(normalizeXTweetHandleInput('@geekbb')).toBe('geekbb');
    expect(normalizeXTweetHandleInput('geekbb')).toBe('geekbb');
    expect(normalizeXTweetHandleInput('https://x.com/geekbb')).toBe('geekbb');
    expect(normalizeXTweetHandleInput('https://twitter.com/geekbb')).toBe('geekbb');
    expect(normalizeXTweetHandleInput('https://x.com/geekbb?foo=1')).toBe('geekbb');
    expect(normalizeXTweetHandleInput('  @geekbb  ')).toBe('geekbb');
  });

  it('拒绝空输入、超长与非法字符', () => {
    expect(normalizeXTweetHandleInput('')).toBeNull();
    expect(normalizeXTweetHandleInput('   ')).toBeNull();
    expect(normalizeXTweetHandleInput('this-handle-is-way-too-long-for-x')).toBeNull();
    expect(normalizeXTweetHandleInput('bad handle!')).toBeNull();
    expect(normalizeXTweetHandleInput('https://example.com/geekbb')).toBeNull();
  });
});

describe('normalizeXTweetFollows', () => {
  it('非数组回退默认关注（geekbb）', () => {
    expect(normalizeXTweetFollows(undefined)).toEqual(DEFAULT_XTWEET_FOLLOWS);
    expect(normalizeXTweetFollows('nope')).toEqual(DEFAULT_XTWEET_FOLLOWS);
  });

  it('空数组被尊重（用户可清空关注）', () => {
    expect(normalizeXTweetFollows([])).toEqual([]);
  });

  it('剔除非法项并按 handle 去重（大小写不敏感，保留最早添加）', () => {
    const result = normalizeXTweetFollows([
      { handle: 'geekbb', addedAt: '2026-09-12T00:00:00.000Z' },
      { handle: '@GeekBB', addedAt: '2026-09-13T00:00:00.000Z' },
      { handle: 'not a handle!', addedAt: '2026-09-13T00:00:00.000Z' },
      { handle: 'ruanyf', addedAt: 'invalid-date' },
    ]);
    expect(result).toEqual([
      { handle: 'geekbb', addedAt: '2026-09-12T00:00:00.000Z' },
      { handle: 'ruanyf', addedAt: '1970-01-01T00:00:00.000Z' },
    ]);
  });
});

describe('normalizeXTweetAuth', () => {
  it('两端去空白后成对保存；任一为空即整体视为未配置', () => {
    expect(normalizeXTweetAuth({ authToken: '  abc  ', ct0: ' def ' })).toEqual({ authToken: 'abc', ct0: 'def' });
    expect(normalizeXTweetAuth({ authToken: 'abc', ct0: '' })).toBeNull();
    expect(normalizeXTweetAuth({ authToken: '', ct0: 'def' })).toBeNull();
    expect(normalizeXTweetAuth(null)).toBeNull();
    expect(normalizeXTweetAuth('junk')).toBeNull();
    expect(normalizeXTweetAuth({ authToken: 1, ct0: 2 })).toBeNull();
  });

  it('去除首尾包裹的引号；纯引号输入判定为无效并返回 null', () => {
    expect(normalizeXTweetAuth({ authToken: '"my_token"', ct0: "'my_ct0'" })).toEqual({
      authToken: 'my_token',
      ct0: 'my_ct0',
    });
    expect(normalizeXTweetAuth({ authToken: '""', ct0: 'valid_ct0' })).toBeNull();
    expect(normalizeXTweetAuth({ authToken: 'valid_token', ct0: "''" })).toBeNull();
    expect(normalizeXTweetAuth({ authToken: '  "  "  ', ct0: 'valid_ct0' })).toBeNull();
  });
});
