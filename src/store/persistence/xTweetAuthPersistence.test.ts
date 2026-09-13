import { describe, expect, it } from 'vitest';
import { appPersistenceOptions } from './options';
import { normalizePersistedState } from '../normalizers/persistedState';
import { createInitialState } from '../initialState';
import type { AppStoreState } from '../types';

describe('xTweetAuth persistence', () => {
  it('includes xTweetAuth in partialize snapshot', () => {
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
    expect(partial.xTweetAuth).toEqual({
      authToken: 'test_token_123',
      ct0: 'test_ct0_456',
    });
    expect(partial.xTweetAuthRevision).toBe(2);
  });

  it('normalizes and preserves valid xTweetAuth during hydration', () => {
    const rawPersisted = {
      xTweetAuth: {
        authToken: '  abc12345  ',
        ct0: '  def67890  ',
      },
      xTweetAuthRevision: 5,
    };

    const normalized = normalizePersistedState(
      rawPersisted,
      createInitialState() as unknown as AppStoreState,
    );
    expect(normalized.xTweetAuth).toEqual({
      authToken: 'abc12345',
      ct0: 'def67890',
    });
    expect(normalized.xTweetAuthRevision).toBe(5);
  });

  it('falls back to null when persisted xTweetAuth is invalid', () => {
    const rawPersisted = {
      xTweetAuth: {
        authToken: '',
        ct0: 'valid_ct0',
      },
    };

    const normalized = normalizePersistedState(
      rawPersisted,
      createInitialState() as unknown as AppStoreState,
    );
    expect(normalized.xTweetAuth).toBeNull();
  });

  it('preserves xTweetAuth during migration', () => {
    const rawState = {
      xTweetAuth: {
        authToken: 'my_auth',
        ct0: 'my_ct0',
      },
    };

    if (typeof appPersistenceOptions.migrate === 'function') {
      const migrated = appPersistenceOptions.migrate(rawState as unknown, 14) as Record<string, unknown>;
      expect(migrated.xTweetAuth).toEqual({
        authToken: 'my_auth',
        ct0: 'my_ct0',
      });
    }
  });
});
