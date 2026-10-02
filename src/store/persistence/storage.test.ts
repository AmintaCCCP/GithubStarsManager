import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StorageValue } from 'zustand/middleware';
import { indexedDBStorage, setStorageEntries, writeEntriesToFallbackStorage } from '../../services/indexedDbStorage';
import { appPersistenceOptions } from './options';
import { createInitialState } from '../initialState';
import { flushPendingPersistSnapshot } from './storage';
import { debouncedPersistStorage } from './storage';
import {
  PERSISTENCE_SHARD_FIELDS,
  PERSISTENCE_SHARD_NAMES,
  buildShardViews,
  findDirtyShards,
  metaKeyFor,
  shardKeyFor,
} from './shards';

const KEY = 'github-stars-manager';

const tick = (ms = 20): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const buildState = (): Record<string, unknown> => ({
  theme: 'dark',
  language: 'zh',
  repositories: [{ id: 1, name: 'repo-one' }],
  lastSync: '2026-01-01T00:00:00.000Z',
  gists: [{ id: 'gist-1' }],
  starredGists: [],
  releases: [{ id: 101 }],
  forks: [],
  accountWorkspaces: {
    '1': { repositories: [{ id: 1, name: 'repo-one' }], lastSync: '2026-01-01T00:00:00.000Z' },
  },
  trendingSnapshots: [
    { period: 'daily', platform: 'All', capturedAt: '2026-01-01T00:00:00.000Z', entries: [] },
  ],
  customCategories: [{ id: 'cat-1', name: 'Work' }],
});

const readRaw = async (key: string): Promise<string | null> => indexedDBStorage.getItem(key);
const readMeta = async (): Promise<{ savedAt: string; version: number; shards: string[] } | null> => {
  const raw = await readRaw(metaKeyFor(KEY));
  return raw ? JSON.parse(raw) : null;
};
const readShardState = async (shard: Parameters<typeof shardKeyFor>[1]): Promise<Record<string, unknown>> => {
  const raw = await readRaw(shardKeyFor(KEY, shard));
  expect(raw).not.toBeNull();
  return JSON.parse(raw as string).state as Record<string, unknown>;
};

beforeEach(async () => {
  vi.restoreAllMocks();
  debouncedPersistStorage.removeItem(KEY);
  await tick();
});

describe('persistence shard layout', () => {
  it('assigns fields to the expected shards and falls back to core for unknown fields', () => {
    const views = buildShardViews({
      theme: 'dark',
      repositories: [{ id: 1 }],
      lastSync: '2026-01-01T00:00:00.000Z',
      gists: [],
      starredGists: [],
      releases: [],
      forks: [],
      accountWorkspaces: {},
      trendingSnapshots: [],
      someFutureField: 'kept-in-core',
    });

    expect(Object.keys(views.core)).toEqual(['theme', 'someFutureField']);
    expect(views.repositories).toEqual({
      repositories: [{ id: 1 }],
      lastSync: '2026-01-01T00:00:00.000Z',
    });
    expect(Object.keys(views.gists)).toEqual(['gists', 'starredGists']);
    expect(Object.keys(views.releases)).toEqual(['releases']);
    expect(Object.keys(views.forks)).toEqual(['forks']);
    expect(Object.keys(views.accountWorkspaces)).toEqual(['accountWorkspaces']);
    expect(Object.keys(views.trendingSnapshots)).toEqual(['trendingSnapshots']);
  });

  it('covers every persisted partialize key with exactly one shard', () => {
    const partialize = appPersistenceOptions.partialize!;
    const persistedKeys = Object.keys(partialize(createInitialState() as never));
    expect(persistedKeys.length).toBeGreaterThan(0);

    const covered = PERSISTENCE_SHARD_NAMES.flatMap((shard) => [...PERSISTENCE_SHARD_FIELDS[shard]]);
    expect(new Set(covered).size).toBe(covered.length);
    for (const key of persistedKeys) {
      expect(covered, `persisted key "${key}" must be assigned to a shard`).toContain(key);
    }
  });
});

describe('persistence shard dirty detection', () => {
  const viewsOf = (state: Record<string, unknown>) => buildShardViews(state);

  it('treats every shard as dirty without a baseline and none as dirty with identical references', () => {
    const state = buildState();
    const views = viewsOf(state);

    expect(findDirtyShards(views, null)).toEqual([...PERSISTENCE_SHARD_NAMES]);
    expect(findDirtyShards(views, views)).toEqual([]);
  });

  it('marks only the shard whose field reference changed', () => {
    const state = buildState();
    const baseline = viewsOf(state);
    const next = viewsOf({ ...state, theme: 'light' });

    expect(findDirtyShards(next, baseline)).toEqual(['core']);
  });

  it('ignores hydration-normalized accountWorkspaces with equal content and detects real changes', () => {
    // 规整化后的工作区包含全部已知字段；重数组与重对象字段在规整化间保持引用
    const workspaceFields = {
      repositories: [{ id: 1, name: 'repo-one' }],
      lastSync: '2026-01-01T00:00:00.000Z',
      gists: [],
      starredGists: [],
      releases: [],
      forks: [],
      customCategories: [],
      categoryOrder: [],
      readReleases: [],
      readForks: [],
      releaseSubscriptions: [],
      hiddenDefaultCategoryIds: [],
      selectedGistCategory: 'all',
      releaseSourceSettings: { sources: [] },
      defaultCategoryOverrides: {},
      categoryListIdMap: {},
      syncMode: 'stars',
      syncModeConfigured: false,
    };
    const state = { ...buildState(), accountWorkspaces: { '1': workspaceFields } };
    const baseline = viewsOf(state);

    // hydration 规整化会重建工作区对象：内容相同（重数组引用一致）时不应判脏
    const normalizedWorkspaces = { '1': { ...workspaceFields } };
    const untouched = findDirtyShards(viewsOf({ ...state, accountWorkspaces: normalizedWorkspaces }), baseline);
    expect(untouched).toEqual([]);

    // 真实变更（logout 快照替换了重数组引用）必须判脏
    const changedWorkspaces = {
      '1': { ...workspaceFields, repositories: [{ id: 2, name: 'repo-two' }] },
    };
    expect(findDirtyShards(viewsOf({ ...state, accountWorkspaces: changedWorkspaces }), baseline))
      .toEqual(['accountWorkspaces']);
  });
});

describe('sharded persist storage', () => {
  it('hydrates from the legacy single-key snapshot, commits shards atomically and retires the legacy key', async () => {
    const legacyValue: StorageValue<unknown> = { state: buildState(), version: 16 };
    await indexedDBStorage.setItem(KEY, JSON.stringify(legacyValue));

    const hydrated = await debouncedPersistStorage.getItem(KEY);
    expect(hydrated).toEqual(legacyValue);

    const nextValue: StorageValue<unknown> = { state: buildState(), version: 16 };
    debouncedPersistStorage.setItem(KEY, nextValue);
    await flushPendingPersistSnapshot();

    // 全部分片 + meta 已提交
    const meta = await readMeta();
    expect(meta?.version).toBe(16);
    expect(meta?.shards).toEqual([...PERSISTENCE_SHARD_NAMES]);
    const repositoriesShard = await readShardState('repositories');
    expect(repositoriesShard.repositories).toEqual([{ id: 1, name: 'repo-one' }]);
    expect(repositoriesShard.lastSync).toBe('2026-01-01T00:00:00.000Z');
    const coreShard = await readShardState('core');
    expect(coreShard.theme).toBe('dark');

    // 旧单键快照在完整迁移提交后退役
    expect(await readRaw(KEY)).toBeNull();

    // 重新水合得到完整状态（无感升级）
    const rehydrated = await debouncedPersistStorage.getItem(KEY);
    expect(rehydrated?.version).toBe(16);
    expect(rehydrated?.state).toEqual(nextValue.state);
  });

  it('skips the write entirely when no shard field reference changed', async () => {
    const value: StorageValue<unknown> = { state: buildState(), version: 16 };
    debouncedPersistStorage.setItem(KEY, value);
    await flushPendingPersistSnapshot();
    const savedAtAfterFirstWrite = (await readMeta())?.savedAt;

    debouncedPersistStorage.setItem(KEY, value);
    await flushPendingPersistSnapshot();
    expect((await readMeta())?.savedAt).toBe(savedAtAfterFirstWrite);
  });

  it('rewrites only the core shard when a small preference changes', async () => {
    const state = buildState();
    debouncedPersistStorage.setItem(KEY, { state, version: 16 });
    await flushPendingPersistSnapshot();
    const repositoriesShardBefore = await readRaw(shardKeyFor(KEY, 'repositories'));
    const gistsShardBefore = await readRaw(shardKeyFor(KEY, 'gists'));

    // 展开保留重数据字段引用，模拟真实 partialize 行为
    const nextState = { ...state, language: 'en' };
    debouncedPersistStorage.setItem(KEY, { state: nextState, version: 16 });
    await flushPendingPersistSnapshot();

    const coreShard = await readShardState('core');
    expect(coreShard.language).toBe('en');
    // 重数据字段引用未变：分片内容保持原样
    expect(await readRaw(shardKeyFor(KEY, 'repositories'))).toBe(repositoriesShardBefore);
    expect(await readRaw(shardKeyFor(KEY, 'gists'))).toBe(gistsShardBefore);
  });

  it('rewrites the repositories shard when its array reference changes but leaves other heavy shards', async () => {
    const state = buildState();
    debouncedPersistStorage.setItem(KEY, { state, version: 16 });
    await flushPendingPersistSnapshot();
    const gistsShardBefore = await readRaw(shardKeyFor(KEY, 'gists'));

    const nextState = { ...state, repositories: [{ id: 1, name: 'repo-one', ai_summary: 'new' }] };
    debouncedPersistStorage.setItem(KEY, { state: nextState, version: 16 });
    await flushPendingPersistSnapshot();

    expect((await readShardState('repositories')).repositories).toEqual([
      { id: 1, name: 'repo-one', ai_summary: 'new' },
    ]);
    expect(await readRaw(shardKeyFor(KEY, 'gists'))).toBe(gistsShardBefore);
  });

  it('merges persisted shards with the legacy snapshot when some shards are missing, then converges', async () => {
    // 模拟迁移中途崩溃：meta + 部分分片已提交，旧单键快照仍在
    const legacyState = { ...buildState(), gists: [{ id: 'legacy-gist' }], theme: 'light' };
    await indexedDBStorage.setItem(KEY, JSON.stringify({ state: legacyState, version: 16 }));
    await setStorageEntries([
      [metaKeyFor(KEY), JSON.stringify({ format: 1, version: 16, shards: [...PERSISTENCE_SHARD_NAMES], savedAt: 't0' })],
      [shardKeyFor(KEY, 'core'), JSON.stringify({ format: 1, version: 16, state: { theme: 'dark', language: 'zh' } })],
    ]);

    const hydrated = await debouncedPersistStorage.getItem(KEY);
    // 存在的分片内容（更新）覆盖旧快照，缺失分片回退旧快照
    expect(hydrated?.state).toMatchObject({ theme: 'dark', language: 'zh', gists: [{ id: 'legacy-gist' }] });

    // 下一次写入强制提交全部分片并退役旧键（收敛迁移）
    debouncedPersistStorage.setItem(KEY, { state: buildState(), version: 16 });
    await flushPendingPersistSnapshot();

    expect(await readRaw(KEY)).toBeNull();
    expect(await readShardState('gists')).toMatchObject({ gists: [{ id: 'gist-1' }] });
    const rehydrated = await debouncedPersistStorage.getItem(KEY);
    expect(rehydrated?.state).toMatchObject({ theme: 'dark', gists: [{ id: 'gist-1' }] });
  });

  it('assembles a full shard set and retires a leftover legacy key on read', async () => {
    // 模拟提交成功但清理前崩溃：分片齐全 + 旧键残留
    const value: StorageValue<unknown> = { state: buildState(), version: 16 };
    debouncedPersistStorage.setItem(KEY, value);
    await flushPendingPersistSnapshot();
    await indexedDBStorage.setItem(KEY, JSON.stringify({ state: { stale: true }, version: 16 }));

    const hydrated = await debouncedPersistStorage.getItem(KEY);
    expect(hydrated?.state).toEqual(value.state);
    await tick();
    expect(await readRaw(KEY)).toBeNull();
  });

  it('falls back to the legacy snapshot when the meta format is unknown', async () => {
    const legacyValue: StorageValue<unknown> = { state: buildState(), version: 16 };
    await indexedDBStorage.setItem(KEY, JSON.stringify(legacyValue));
    await setStorageEntries([
      [metaKeyFor(KEY), JSON.stringify({ format: 999, version: 99, shards: ['core'], savedAt: 't0' })],
    ]);

    const hydrated = await debouncedPersistStorage.getItem(KEY);
    expect(hydrated).toEqual(legacyValue);
  });

  it('treats corrupt shard payloads as missing and recovers from the legacy snapshot', async () => {
    const legacyState = buildState();
    await indexedDBStorage.setItem(KEY, JSON.stringify({ state: legacyState, version: 16 }));
    await setStorageEntries([
      [metaKeyFor(KEY), JSON.stringify({ format: 1, version: 16, shards: [...PERSISTENCE_SHARD_NAMES], savedAt: 't0' })],
      [shardKeyFor(KEY, 'core'), 'not-json'],
    ]);

    const hydrated = await debouncedPersistStorage.getItem(KEY);
    expect(hydrated?.state).toEqual(legacyState);
  });

  it('hydrates best-effort from readable shards when nothing else is available', async () => {
    await setStorageEntries([
      [metaKeyFor(KEY), JSON.stringify({ format: 1, version: 16, shards: [...PERSISTENCE_SHARD_NAMES], savedAt: 't0' })],
      [shardKeyFor(KEY, 'core'), JSON.stringify({ format: 1, version: 16, state: { theme: 'dark' } })],
    ]);

    const hydrated = await debouncedPersistStorage.getItem(KEY);
    expect(hydrated?.version).toBe(16);
    expect(hydrated?.state).toEqual({ theme: 'dark' });
  });

  it('removes every derived key on removeItem', async () => {
    const value: StorageValue<unknown> = { state: buildState(), version: 16 };
    debouncedPersistStorage.setItem(KEY, value);
    await flushPendingPersistSnapshot();
    expect(await readMeta()).not.toBeNull();

    debouncedPersistStorage.removeItem(KEY);
    await tick();

    expect(await readRaw(KEY)).toBeNull();
    expect(await readMeta()).toBeNull();
    for (const shard of PERSISTENCE_SHARD_NAMES) {
      expect(await readRaw(shardKeyFor(KEY, shard))).toBeNull();
    }
  });
});

describe('indexedDbStorage batch helpers', () => {
  it('writes every entry to localStorage on the fallback path', async () => {
    await writeEntriesToFallbackStorage([['fallback-a', '1'], ['fallback-b', '2']]);
    expect(window.localStorage.getItem('fallback-a')).toBe('1');
    expect(window.localStorage.getItem('fallback-b')).toBe('2');
    window.localStorage.removeItem('fallback-a');
    window.localStorage.removeItem('fallback-b');
  });

  it('rolls back the whole fallback batch when any key write fails', async () => {
    window.localStorage.setItem('fallback-c', 'previous');
    const setItemSpy = vi.spyOn(window.localStorage, 'setItem').mockImplementation((key, value) => {
      if (key === 'fallback-b') throw new Error('quota exceeded');
      Storage.prototype.setItem.call(window.localStorage, key, value);
    });
    try {
      await expect(writeEntriesToFallbackStorage([['fallback-a', '1'], ['fallback-b', '2']])).rejects.toThrow();
      // 已写入的键必须回滚，且不覆盖既有值
      expect(window.localStorage.getItem('fallback-a')).toBeNull();
      expect(window.localStorage.getItem('fallback-c')).toBe('previous');
    } finally {
      setItemSpy.mockRestore();
      window.localStorage.removeItem('fallback-a');
      window.localStorage.removeItem('fallback-c');
    }
  });

  it('writes batch entries through the IndexedDB path and reads them back', async () => {
    await setStorageEntries([['idb-a', '1'], ['idb-b', '2']]);
    expect(await indexedDBStorage.getItem('idb-a')).toBe('1');
    expect(await indexedDBStorage.getItem('idb-b')).toBe('2');
    await indexedDBStorage.removeItem('idb-a');
    await indexedDBStorage.removeItem('idb-b');
  });

  it('migrates an existing localStorage snapshot when reading a key missing from IndexedDB', async () => {
    window.localStorage.setItem('migrate-me', '{"legacy":true}');
    try {
      expect(await indexedDBStorage.getItem('migrate-me')).toBe('{"legacy":true}');
      // 读取即迁移：快照进入 IndexedDB，localStorage 镜像被清除
      expect(window.localStorage.getItem('migrate-me')).toBeNull();
      expect(await readRaw('migrate-me')).toBe('{"legacy":true}');
    } finally {
      await indexedDBStorage.removeItem('migrate-me');
    }
  });

  it('sweeps derived `${name}#` keys from localStorage on removeItem', async () => {
    window.localStorage.setItem(KEY, 'legacy');
    window.localStorage.setItem(`${KEY}#shard:core`, '{}');
    window.localStorage.setItem(`${KEY}#meta`, '{}');
    window.localStorage.setItem('unrelated-key', 'keep');

    await indexedDBStorage.removeItem(KEY);

    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(window.localStorage.getItem(`${KEY}#shard:core`)).toBeNull();
    expect(window.localStorage.getItem(`${KEY}#meta`)).toBeNull();
    expect(window.localStorage.getItem('unrelated-key')).toBe('keep');
    window.localStorage.removeItem('unrelated-key');
  });
});
