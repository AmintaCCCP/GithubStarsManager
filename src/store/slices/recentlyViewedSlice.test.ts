import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_RECENTLY_VIEWED } from '../../utils/recentlyViewed';
import type { Repository } from '../../types';

vi.mock('../../services/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

// 全局 setup 把 useAppStore mock 成三个字段的桩，这里要真实 store 才能验证切片行为
const { useAppStore, normalizePersistedState } = await vi.importActual<typeof import('../useAppStore')>('../useAppStore');
const repository = (id: number): Repository => ({
  id,
  name: `repo-${id}`,
  full_name: `owner/repo-${id}`,
  description: null,
  html_url: `https://github.com/owner/repo-${id}`,
  stargazers_count: 0,
  forks_count: 0,
  forks: 0,
  language: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  pushed_at: '2026-01-01T00:00:00.000Z',
  owner: { login: 'owner', avatar_url: 'https://example.com/avatar.png' },
  topics: [],
});

describe('recentlyViewed slice', () => {
  beforeEach(() => {
    useAppStore.setState({ recentlyViewed: [], recentlyViewedEnabled: true, discoveryHideSeen: false });
  });

  it('records views newest first and clears them on demand', () => {
    const { recordRepositoryView, clearRecentlyViewed } = useAppStore.getState();

    recordRepositoryView(repository(1));
    recordRepositoryView(repository(2));
    expect(useAppStore.getState().recentlyViewed.map((entry) => entry.repository.id)).toEqual([2, 1]);

    clearRecentlyViewed();
    expect(useAppStore.getState().recentlyViewed).toEqual([]);
  });

  it('stops recording once the user turns the preference off but keeps existing entries', () => {
    const { recordRepositoryView } = useAppStore.getState();
    recordRepositoryView(repository(1));

    useAppStore.getState().setRecentlyViewedEnabled(false);
    recordRepositoryView(repository(2));

    expect(useAppStore.getState().recentlyViewed.map((entry) => entry.repository.id)).toEqual([1]);
  });

  it('keeps the stored list within the configured cap', () => {
    for (let id = 1; id <= MAX_RECENTLY_VIEWED + 3; id += 1) {
      useAppStore.getState().recordRepositoryView(repository(id));
    }

    expect(useAppStore.getState().recentlyViewed).toHaveLength(MAX_RECENTLY_VIEWED);
    expect(useAppStore.getState().recentlyViewed[0]?.repository.id).toBe(MAX_RECENTLY_VIEWED + 3);
  });

  it('exposes an independent discovery hide-seen preference', () => {
    useAppStore.getState().setDiscoveryHideSeen(true);
    expect(useAppStore.getState().discoveryHideSeen).toBe(true);
    expect(useAppStore.getState().recentlyViewedEnabled).toBe(true);
  });
});

describe('recentlyViewed persistence migration', () => {
  it('initializes the new fields for snapshots created before v17', async () => {
    const { appPersistenceOptions } = await import('../persistence/options');
    const migrated = appPersistenceOptions.migrate?.({ user: null }, 16) as Record<string, unknown>;

    expect(migrated.recentlyViewed).toEqual([]);
    expect(migrated.recentlyViewedEnabled).toBe(true);
    expect(migrated.discoveryHideSeen).toBe(false);
  });

  it('is idempotent for already-migrated snapshots', async () => {
    const { appPersistenceOptions } = await import('../persistence/options');
    const once = appPersistenceOptions.migrate?.({ user: null }, 16) as Record<string, unknown>;
    const twice = appPersistenceOptions.migrate?.(once, 17) as Record<string, unknown>;
    const entries = [{ repository: repository(1), viewedAt: '2026-09-21T04:00:00.000Z' }];

    const rerun = appPersistenceOptions.migrate?.(
      { ...twice, recentlyViewed: entries, recentlyViewedEnabled: false },
      17,
    ) as Record<string, unknown>;

    expect(rerun.recentlyViewed).toEqual(entries);
    expect(rerun.recentlyViewedEnabled).toBe(false);
  });

  it('drops malformed entries during migration and direct hydration', async () => {
    const { appPersistenceOptions } = await import('../persistence/options');
    const valid = { repository: repository(1), viewedAt: '2026-09-21T04:00:00.000Z' };
    const corrupted = [null, { repository: { id: 2 }, viewedAt: 'invalid' }, valid];

    const migrated = appPersistenceOptions.migrate?.(
      { user: null, recentlyViewed: corrupted },
      17,
    ) as Record<string, unknown>;
    expect(migrated.recentlyViewed).toEqual([valid]);

    const normalized = normalizePersistedState(
      { recentlyViewed: corrupted } as never,
      useAppStore.getInitialState(),
    );
    expect(normalized.recentlyViewed).toEqual([valid]);
  });

  it('accepts only boolean persisted preferences', () => {
    const initialState = useAppStore.getInitialState();
    const invalid = normalizePersistedState(
      { recentlyViewedEnabled: 'false', discoveryHideSeen: 'true' } as never,
      initialState,
    );
    const valid = normalizePersistedState(
      { recentlyViewedEnabled: false, discoveryHideSeen: true } as never,
      initialState,
    );

    expect(invalid.recentlyViewedEnabled).toBe(true);
    expect(invalid.discoveryHideSeen).toBe(false);
    expect(valid.recentlyViewedEnabled).toBe(false);
    expect(valid.discoveryHideSeen).toBe(true);
  });
});
