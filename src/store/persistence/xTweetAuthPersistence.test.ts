import { describe, expect, it } from 'vitest';
import { appPersistenceOptions } from './options';
import { normalizePersistedState } from '../normalizers/persistedState';
import { createInitialState } from '../initialState';
import type { AppStoreState } from '../types';

describe('xTweetAuth persistence & security', () => {
  it('excludes plaintext xTweetAuth from partialize snapshot (CWE-922 protection)', () => {
    const state = {
      ...createInitialState(),
      xTweetAuth: {
        authToken: 'test_token_123',
        ct0: 'test_ct0_456',
      },
      xTweetAuthRevision: 2,
    } as unknown as AppStoreState;

    expect(appPersistenceOptions.partialize).toBeDefined();
    const partial = appPersistenceOptions.partialize!(state);
    expect((partial as Record<string, unknown>).xTweetAuth).toBeUndefined();
    expect(partial.xTweetAuthRevision).toBe(2);
  });

  it('preserves desktop-restored currentState.xTweetAuth during hydration without resetting to null', () => {
    const currentState = {
      ...createInitialState(),
      xTweetAuth: {
        authToken: 'desktop_token_123',
        ct0: 'desktop_ct0_456',
      },
    } as unknown as AppStoreState;

    const normalized = normalizePersistedState({}, currentState);
    expect(normalized.xTweetAuth).toEqual({
      authToken: 'desktop_token_123',
      ct0: 'desktop_ct0_456',
    });
  });

  it('sanitizes currentState.xTweetAuth and clears invalid quote-only auth during hydration', () => {
    const currentState = {
      ...createInitialState(),
      xTweetAuth: {
        authToken: '""',
        ct0: "''",
      },
    } as unknown as AppStoreState;

    const normalized = normalizePersistedState({}, currentState);
    expect(normalized.xTweetAuth).toBeNull();
  });

  it('removes plaintext xTweetAuth from legacy snapshot during migration', () => {
    const rawState = {
      xTweetAuth: {
        authToken: 'legacy_auth',
        ct0: 'legacy_ct0',
      },
    };

    // 显式断言前置条件：migrate 缺失时测试必须失败，而不是静默跳过校验
    if (typeof appPersistenceOptions.migrate !== 'function') {
      throw new Error('appPersistenceOptions.migrate 必须存在，否则遗留明文 xTweetAuth 快照无法被迁移清理');
    }
    const migrated = appPersistenceOptions.migrate(rawState as unknown, 14) as Record<string, unknown>;
    expect('xTweetAuth' in migrated).toBe(false);
  });
});
