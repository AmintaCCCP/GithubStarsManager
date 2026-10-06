import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StorageValue } from 'zustand/middleware';
import {
  getStorageEntriesStrict,
  getStorageItemStrict,
  indexedDBStorage,
  setStorageEntries,
  writeEntriesToFallbackStorage,
} from '../../services/indexedDbStorage';
import { appPersistenceOptions } from './options';
import { createInitialState } from '../initialState';
import { flushPendingPersistSnapshot, __setPersistTimingsForTest } from './storage';
import { debouncedPersistStorage, removePersistedSnapshot } from './storage';
import { normalizeAccountWorkspaces } from '../helpers/accountWorkspace';
import {
  PERSISTENCE_SHARD_FIELDS,
  PERSISTENCE_SHARD_NAMES,
  WORKSPACE_REFERENCE_FIELDS,
  WORKSPACE_VALUE_FIELDS,
  buildShardViews,
  findDirtyShards,
  metaKeyFor,
  shardKeyFor,
} from './shards';
import { normalizeTrendingSnapshots } from '../../utils/trendingSnapshots';

// 提交点屏障：在真实存储提交入口（setStorageEntries）拦停写入，用于让并发
// 测试确定性地与「写入 A 仍在提交中」重叠——setTimeout 等待无法保证这一点。
const commitGate = vi.hoisted(() => {
  let hold = false;
  let release: () => void = () => undefined;
  let markReached: (() => void) | null = null;
  let reached: Promise<void> = Promise.resolve();
  return {
    arm: () => {
      hold = true;
      reached = new Promise<void>((resolve) => {
        markReached = resolve;
      });
    },
    waitReached: (): Promise<void> => reached,
    release: () => {
      hold = false;
      release();
    },
    reset: () => {
      hold = false;
      release();
    },
    wrap: async <T>(run: () => Promise<T>): Promise<T> => {
      if (hold) {
        markReached?.();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return run();
    },
  };
});

vi.mock('../../services/indexedDbStorage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/indexedDbStorage')>();
  return {
    ...actual,
    // 真实签名是 (name, entries)——转发参数必须一一对应，否则会静默改写调用语义。
    setStorageEntries: (name: string, entries: ReadonlyArray<readonly [string, string]>) =>
      commitGate.wrap(() => actual.setStorageEntries(name, entries)),
  };
});

const KEY = 'github-stars-manager';

const tick = (ms = 20): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const buildState = (): Record<string, unknown> => ({
  // 以 createInitialState 为底：partialize 会直读全部持久化字段（如
  // state.gistSearchFilters.sortBy），手写的稀疏对象会让它抛错。
  ...(createInitialState() as unknown as Record<string, unknown>),
  theme: 'dark',
  language: 'zh',
  repositories: [{ id: 1, name: 'repo-one' }],
  lastSync: '2026-01-01T00:00:00.000Z',
  gists: [{ id: 'gist-1' }],
  starredGists: [],
  releases: [{ id: 101 }],
  forks: [],
  // 规整化后的工作区包含全部 18 个字段：键数量不同的工作区会被判脏守卫拦下
  accountWorkspaces: {
    '1': {
      repositories: [{ id: 1, name: 'repo-one' }],
      lastSync: '2026-01-01T00:00:00.000Z',
      gists: [],
      starredGists: [],
      releases: [],
      forks: [],
      customCategories: [],
      categoryOrder: ['cat-a'],
      readReleases: [1, 2],
      readForks: [],
      releaseSubscriptions: [1],
      hiddenDefaultCategoryIds: ['cat-b'],
      selectedGistCategory: 'all',
      releaseSourceSettings: { enabledSourceIds: ['starred-release-subscription'], watchCustomReleaseRepos: [], customReleaseRepos: [] },
      defaultCategoryOverrides: {},
      categoryListIdMap: {},
      syncMode: 'stars',
      syncModeConfigured: false,
    },
  },
  // 快照必须至少含一条 entry（空 entries 的快照会被规整化丢弃）
  trendingSnapshots: [
    {
      period: 'daily',
      platform: 'All',
      capturedAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
      entries: [{ repositoryFullName: 'a/b', rank: 1, stars: 9 }],
    },
  ],
  customCategories: [{ id: 'cat-1', name: 'Work' }],
});

const readRaw = async (key: string): Promise<string | null> => indexedDBStorage.getItem(key);
const readStrict = async (key: string): Promise<string | null> => getStorageItemStrict(KEY, key);
const readMeta = async (): Promise<{ savedAt: string; version: number; shards: string[] } | null> => {
  const raw = await readRaw(metaKeyFor(KEY));
  return raw ? JSON.parse(raw) : null;
};
const readShardState = async (shard: Parameters<typeof shardKeyFor>[1]): Promise<Record<string, unknown>> => {
  const raw = await readRaw(shardKeyFor(KEY, shard));
  expect(raw).not.toBeNull();
  return JSON.parse(raw as string).state as Record<string, unknown>;
};

/** 把磁盘分片改写成缩进 JSON，用于检测「哪些分片被后续启动重写」。 */
const markShardsOnDisk = async (): Promise<void> => {
  for (const shard of PERSISTENCE_SHARD_NAMES) {
    const rawJson = await readRaw(shardKeyFor(KEY, shard));
    if (rawJson) {
      await indexedDBStorage.setItem(shardKeyFor(KEY, shard), JSON.stringify(JSON.parse(rawJson), null, 2));
    }
  }
};

const rewrittenShards = async (): Promise<string[]> => {
  const rewritten: string[] = [];
  for (const shard of PERSISTENCE_SHARD_NAMES) {
    const rawJson = await readRaw(shardKeyFor(KEY, shard));
    if (rawJson && !rawJson.includes('\n  "')) rewritten.push(shard);
  }
  return rewritten;
};

beforeEach(async () => {
  vi.restoreAllMocks();
  commitGate.reset();
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

    expect(Object.keys(views.core)).toEqual(['theme', 'lastSync', 'someFutureField']);
    expect(views.repositories).toEqual({ repositories: [{ id: 1 }] });
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

  it('covers every normalized workspace field with exactly one comparison list', () => {
    // AccountWorkspace 新增字段时必须归入 REFERENCE 或 VALUE 列表之一，
    // 否则该字段的内容变化会被判脏逻辑漏掉（漏写）。
    const normalized = normalizeAccountWorkspaces({ '1': {} })['1'];
    const covered = new Set<string>([...WORKSPACE_REFERENCE_FIELDS, ...WORKSPACE_VALUE_FIELDS]);
    for (const field of Object.keys(normalized)) {
      expect(covered.has(field), `workspace field "${field}" must be in a comparison list`).toBe(true);
    }
    for (const field of covered) {
      expect(field in normalized, `comparison list field "${field}" must exist on the workspace`).toBe(true);
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
    // 穿过真实的 normalizeAccountWorkspaces：规整化不得因重建数组引用而把
    // 未变更的工作区判为已变更（否则每次启动都会全量重写该分片）。
    const state = buildState();
    const baseline = viewsOf(state);
    const normalized = normalizeAccountWorkspaces(state.accountWorkspaces);

    const untouched = findDirtyShards(viewsOf({ ...state, accountWorkspaces: normalized }), baseline);
    expect(untouched).toEqual([]);

    // 真实变更（logout 快照替换了重数组引用）必须判脏
    const changedWorkspaces = {
      '1': {
        ...(normalized as unknown as Record<string, Record<string, unknown>>)['1'],
        repositories: [{ id: 2, name: 'repo-two' }],
      },
    };
    expect(findDirtyShards(viewsOf({ ...state, accountWorkspaces: changedWorkspaces }), baseline))
      .toEqual(['accountWorkspaces']);
  });

  it('keeps trendingSnapshots reference when normalization is content-equal', () => {
    const state = buildState();
    const snapshots = state.trendingSnapshots as unknown as Array<Record<string, unknown>>;
    expect(normalizeTrendingSnapshots(snapshots as never)).toBe(snapshots as never);

    // 内容真正过期/非法时仍然重建
    const stale = [{ ...snapshots[0], capturedAt: '2000-01-01T00:00:00.000Z' }];
    expect(normalizeTrendingSnapshots(stale)).toEqual([]);
  });

  it('compares core shard fields by content because partialize rebuilds small objects', () => {
    // 真实 partialize 每次都会重建 searchFilters/proxyConfig/派生数组等 core 字段；
    // core 按内容判脏才能让「无变化的写入」真正跳过。
    const state = buildState();
    const first = appPersistenceOptions.partialize!(state as never);
    const second = appPersistenceOptions.partialize!(state as never);
    const baseline = viewsOf(first as Record<string, unknown>);

    expect(findDirtyShards(viewsOf(second as Record<string, unknown>), baseline)).toEqual([]);

    const changed = appPersistenceOptions.partialize!({ ...state, theme: 'light' } as never);
    expect(findDirtyShards(viewsOf(changed as Record<string, unknown>), baseline)).toEqual(['core']);
  });
});

describe('sharded persist storage', () => {
  it('hydrates from the legacy single-key snapshot, commits shards atomically and retires the legacy key', async () => {
    const legacyValue: StorageValue<unknown> = { state: buildState(), version: 16 };
    await indexedDBStorage.setItem(KEY, JSON.stringify(legacyValue));

    const hydrated = await debouncedPersistStorage.getItem(KEY);
    // legacy 快照经 JSON 往返（Set→对象、undefined 丢弃），期望侧做同样归一化
    expect(hydrated).toEqual(JSON.parse(JSON.stringify(legacyValue)));

    const nextValue: StorageValue<unknown> = { state: buildState(), version: 16 };
    debouncedPersistStorage.setItem(KEY, nextValue);
    await flushPendingPersistSnapshot();

    // 全部分片 + meta 已提交
    const meta = await readMeta();
    expect(meta?.version).toBe(16);
    expect(meta?.shards).toEqual([...PERSISTENCE_SHARD_NAMES]);
    const repositoriesShard = await readShardState('repositories');
    expect(repositoriesShard.repositories).toEqual([{ id: 1, name: 'repo-one' }]);
    const coreShard = await readShardState('core');
    expect(coreShard.theme).toBe('dark');
    expect(coreShard.lastSync).toBe('2026-01-01T00:00:00.000Z');

    // 旧单键快照在完整迁移提交后退役
    expect(await readRaw(KEY)).toBeNull();

    // 重新水合得到完整状态（无感升级）
    const rehydrated = await debouncedPersistStorage.getItem(KEY);
    expect(rehydrated?.version).toBe(16);
    expect(rehydrated?.state).toEqual(JSON.parse(JSON.stringify(nextValue.state)));
  });

  it('skips the write entirely when two real partialize calls produce equal content', async () => {
    // 生产路径中 partialize 每次都重建小对象，只有 core 按内容判脏才能跳过。
    const state = buildState();
    debouncedPersistStorage.setItem(KEY, { state: appPersistenceOptions.partialize!(state as never) as Record<string, unknown>, version: 16 });
    await flushPendingPersistSnapshot();
    const savedAtAfterFirstWrite = (await readMeta())?.savedAt;

    debouncedPersistStorage.setItem(KEY, { state: appPersistenceOptions.partialize!(state as never) as Record<string, unknown>, version: 16 });
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

  it('does not rewrite heavy shards on a plain boot after data has converged', async () => {
    // 契约：水合 → merge → partialize 的启动序列不得重写任何重数据分片
    //（accountWorkspaces/trendingSnapshots 的规整化引用保留 + lastSync 归 core）。
    const seedState = appPersistenceOptions.partialize!(buildState() as never);
    debouncedPersistStorage.setItem(KEY, { state: seedState as Record<string, unknown>, version: 16 });
    await flushPendingPersistSnapshot();
    await markShardsOnDisk();

    const hydrated = await debouncedPersistStorage.getItem(KEY);
    const merged = appPersistenceOptions.merge!(hydrated!.state as never, createInitialState() as never);
    debouncedPersistStorage.setItem(KEY, { state: appPersistenceOptions.partialize!(merged as never) as Record<string, unknown>, version: 16 });
    await flushPendingPersistSnapshot();

    expect(await rewrittenShards()).toEqual([]);
  });

  it('serializes overlapping idle/flush writes so the dirty baseline never trails the disk', async () => {
    // 回归：写入 A 提交期间（版本已过期），写入 B 若以过期基准判脏会跳过写盘，
    // 把 A 的旧值留在磁盘上且缓存不自知。
    const state = buildState();
    debouncedPersistStorage.setItem(KEY, { state, version: 16 });
    await flushPendingPersistSnapshot();

    const stateLight = { ...state, theme: 'light' };
    const stateDark = { ...state, theme: 'dark' };
    commitGate.arm();
    debouncedPersistStorage.setItem(KEY, { state: stateLight, version: 16 });
    const flushInFlight = flushPendingPersistSnapshot();
    await commitGate.waitReached(); // 写入 A 已完成判脏，在真实提交点被确定性拦停
    debouncedPersistStorage.setItem(KEY, { state: stateDark, version: 16 });
    const flushAfterDark = flushPendingPersistSnapshot(); // B 排队在 A 之后
    commitGate.release();
    await flushInFlight;
    await flushAfterDark;

    expect((await readShardState('core')).theme).toBe('dark');
    const rehydrated = await debouncedPersistStorage.getItem(KEY);
    expect(rehydrated?.state).toMatchObject({ theme: 'dark', language: 'zh' });
  });

  it('rebuilds the full shard set when removeItem follows a write still in flight', async () => {
    const state = buildState();
    commitGate.arm();
    debouncedPersistStorage.setItem(KEY, { state, version: 16 });
    const inFlightWrite = flushPendingPersistSnapshot();
    await commitGate.waitReached(); // 写入 A 已完成判脏，在真实提交点被确定性拦停
    debouncedPersistStorage.removeItem(KEY);
    const nextState = { ...state, language: 'en' };
    debouncedPersistStorage.setItem(KEY, { state: nextState, version: 16 });
    const flushAfterClear = flushPendingPersistSnapshot(); // 排队在删除之后
    commitGate.release();
    await inFlightWrite;
    await flushAfterClear;

    // 删除后的首个写入必须全量重建：meta 与全部分片一致，不存在缺失分片
    const rehydrated = await debouncedPersistStorage.getItem(KEY);
    expect(rehydrated?.state).toMatchObject({ theme: 'dark', language: 'en' });
    expect(await readMeta()).not.toBeNull();
    expect(await readShardState('gists')).toMatchObject({ gists: [{ id: 'gist-1' }] });
    expect(await readShardState('repositories')).toMatchObject({
      repositories: [{ id: 1, name: 'repo-one' }],
    });
  });

  it('merges persisted shards with the legacy snapshot when some shards are missing, then converges', async () => {
    // 模拟迁移中途崩溃：meta + 部分分片已提交，旧单键快照仍在
    const legacyState = { ...buildState(), gists: [{ id: 'legacy-gist' }], theme: 'light' };
    await indexedDBStorage.setItem(KEY, JSON.stringify({ state: legacyState, version: 16 }));
    await setStorageEntries(KEY, [
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
    expect(hydrated?.state).toEqual(JSON.parse(JSON.stringify(value.state)));
    await tick();
    expect(await readRaw(KEY)).toBeNull();
  });

  it('falls back to the legacy snapshot when the meta format is unknown', async () => {
    const legacyValue: StorageValue<unknown> = { state: buildState(), version: 16 };
    await indexedDBStorage.setItem(KEY, JSON.stringify(legacyValue));
    await setStorageEntries(KEY, [
      [metaKeyFor(KEY), JSON.stringify({ format: 999, version: 99, shards: ['core'], savedAt: 't0' })],
    ]);

    const hydrated = await debouncedPersistStorage.getItem(KEY);
    expect(hydrated).toEqual(JSON.parse(JSON.stringify(legacyValue)));
  });

  it('treats an incomplete or duplicated shard list as an invalid meta and keeps the legacy snapshot', async () => {
    // H2 回归：格式合法但只列出部分分片的 meta 不得绕过恢复路径，
    // 也不得退役唯一可兜底的 legacy 单键快照。
    const legacyValue: StorageValue<unknown> = {
      state: { theme: 'light', repositories: [{ id: 1 }], gists: [{ id: 'keep' }] },
      version: 16,
    };
    await indexedDBStorage.setItem(KEY, JSON.stringify(legacyValue));
    for (const shards of [['core'], ['core', 'core'], [...PERSISTENCE_SHARD_NAMES.slice(0, -1)], ['core', 'unknown-shard']]) {
      await setStorageEntries(KEY, [
        [metaKeyFor(KEY), JSON.stringify({ format: 1, version: 16, shards, savedAt: 't0' })],
        [shardKeyFor(KEY, 'core'), JSON.stringify({ format: 1, version: 16, state: { theme: 'dark' } })],
      ]);
      await indexedDBStorage.setItem(KEY, JSON.stringify(legacyValue));

      const hydrated = await debouncedPersistStorage.getItem(KEY);
      expect(hydrated?.state).toMatchObject({ theme: 'light', gists: [{ id: 'keep' }] });
      await tick();
      expect(await readRaw(KEY), `legacy must survive invalid meta ${JSON.stringify(shards)}`).not.toBeNull();
    }
  });

  it('salvages readable orphaned shards when meta and legacy are both gone', async () => {
    await setStorageEntries(KEY, [
      [shardKeyFor(KEY, 'core'), JSON.stringify({ format: 1, version: 16, state: { theme: 'dark', language: 'zh' } })],
      [shardKeyFor(KEY, 'repositories'), JSON.stringify({ format: 1, version: 16, state: { repositories: [{ id: 7 }] } })],
    ]);

    const hydrated = await debouncedPersistStorage.getItem(KEY);
    expect(hydrated?.state).toMatchObject({ theme: 'dark', repositories: [{ id: 7 }] });

    // 打捞后的首次写入以空基准全量重建（含 meta 自愈）
    debouncedPersistStorage.setItem(KEY, { state: buildState(), version: 16 });
    await flushPendingPersistSnapshot();
    expect(await readMeta()).not.toBeNull();
    expect(await readShardState('gists')).toMatchObject({ gists: [{ id: 'gist-1' }] });
  });

  it('treats corrupt shard payloads as missing and recovers from the legacy snapshot', async () => {
    const legacyState = buildState();
    await indexedDBStorage.setItem(KEY, JSON.stringify({ state: legacyState, version: 16 }));
    await setStorageEntries(KEY, [
      [metaKeyFor(KEY), JSON.stringify({ format: 1, version: 16, shards: [...PERSISTENCE_SHARD_NAMES], savedAt: 't0' })],
      [shardKeyFor(KEY, 'core'), 'not-json'],
    ]);

    const hydrated = await debouncedPersistStorage.getItem(KEY);
    expect(hydrated?.state).toEqual(JSON.parse(JSON.stringify(legacyState)));
  });

  it('hydrates best-effort from readable shards when nothing else is available', async () => {
    await setStorageEntries(KEY, [
      [metaKeyFor(KEY), JSON.stringify({ format: 1, version: 16, shards: [...PERSISTENCE_SHARD_NAMES], savedAt: 't0' })],
      [shardKeyFor(KEY, 'core'), JSON.stringify({ format: 1, version: 16, state: { theme: 'dark' } })],
    ]);

    const hydrated = await debouncedPersistStorage.getItem(KEY);
    expect(hydrated?.version).toBe(16);
    expect(hydrated?.state).toEqual({ theme: 'dark' });
  });

  it('keeps the fallback authority marker while localStorage still holds shard keys', async () => {
    // 回归（CodeRabbit r4165367360）：IDB 批量写成功后无条件清除权威标记的做法，
    // 在「兜底写入 + 兜底期 IDB 旧键删除失败」组合下，会让旧 IDB 分片在下次水合
    // 遮蔽 localStorage 里的新值——用户偏好静默回退，且判脏基准已按新值更新、
    // 永不自愈。
    const state = buildState();
    debouncedPersistStorage.setItem(KEY, { state, version: 16 });
    await flushPendingPersistSnapshot();

    // 兜底插曲：仅 core 经兜底路径写入 localStorage；模拟兜底期间的 IDB 删除
    // 失败（IDB 刚出过故障，这并不罕见），旧 core 留在 IndexedDB
    const fallbackCore = JSON.stringify({ format: 1, version: 16, state: { theme: 'light', language: 'en' } });
    const originalDelete = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function () { throw new Error('simulated delete failure'); };
    try {
      await writeEntriesToFallbackStorage(KEY, [[shardKeyFor(KEY, 'core'), fallbackCore]]);
    } finally {
      IDBObjectStore.prototype.delete = originalDelete;
    }
    expect(window.localStorage.getItem(`${KEY}#fallback`)).not.toBeNull();
    expect(await readRaw(shardKeyFor(KEY, 'core'))).not.toBeNull(); // 旧 IDB core 未被删掉

    // 之后一批不含 core 的写入经 IndexedDB 成功：LS 仍持有较新的 core → 标记必须保留
    await setStorageEntries(KEY, [
      [shardKeyFor(KEY, 'releases'), JSON.stringify({ format: 1, version: 16, state: { releases: [{ id: 202 }] } })],
      [metaKeyFor(KEY), JSON.stringify({ format: 1, version: 16, shards: [...PERSISTENCE_SHARD_NAMES], savedAt: 't2' })],
    ]);
    expect(window.localStorage.getItem(`${KEY}#fallback`)).not.toBeNull();

    // 水合读到 localStorage 里的新 core，而不是 IndexedDB 里的旧 core
    const hydrated = await debouncedPersistStorage.getItem(KEY);
    expect(hydrated?.state).toMatchObject({
      theme: 'light',
      language: 'en',
      releases: [{ id: 202 }],
      gists: [{ id: 'gist-1' }],
    });

    // 自愈：当批写入覆盖 core 且经 IDB 成功后，LS 镜像被清、不再有派生键残留，
    // 标记这才清除；之后的读取回到 IDB 优先
    const healedCore = JSON.stringify({ format: 1, version: 16, state: { theme: 'dark', language: 'zh' } });
    await setStorageEntries(KEY, [[shardKeyFor(KEY, 'core'), healedCore]]);
    expect(window.localStorage.getItem(`${KEY}#fallback`)).toBeNull();
    expect(await readStrict(shardKeyFor(KEY, 'core'))).toBe(healedCore);
  });

  it('refuses to write after a shard read failure so real data cannot be overwritten', async () => {
    // F2r2 回归：读取失败（区别于「键不存在」）后的水合结果不完整，
    // 后续写入必须被拒绝，否则会用默认值覆盖磁盘上的真实分片。
    const state = buildState();
    debouncedPersistStorage.setItem(KEY, { state, version: 16 });
    await flushPendingPersistSnapshot();
    const savedAtBefore = (await readMeta())?.savedAt;
    const gistsBefore = await readRaw(shardKeyFor(KEY, 'gists'));

    const originalGet = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function () { throw new Error('simulated transient IDB failure'); };
    try {
      const hydrated = await debouncedPersistStorage.getItem(KEY);
      expect(hydrated).toBeNull();
    } finally {
      IDBObjectStore.prototype.get = originalGet;
    }

    debouncedPersistStorage.setItem(KEY, { state: { ...state, language: 'en' }, version: 16 });
    await flushPendingPersistSnapshot();

    // 写入被拒绝：磁盘保持原样
    expect((await readMeta())?.savedAt).toBe(savedAtBefore);
    expect(await readRaw(shardKeyFor(KEY, 'gists'))).toBe(gistsBefore);

    // 读取恢复后写入重新可用
    const recovered = await debouncedPersistStorage.getItem(KEY);
    expect(recovered?.state).toMatchObject({ theme: 'dark' });
    debouncedPersistStorage.setItem(KEY, { state: { ...state, language: 'en' }, version: 16 });
    await flushPendingPersistSnapshot();
    expect((await readShardState('core')).language).toBe('en');
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

  it('removeItem resolves only after the on-disk removal has completed', async () => {
    // 「清空所有数据」后 2 秒 reload：removeItem 必须可 await（zustand v4 的
    // clearStorage 不回传 Promise），否则 reload 可能早于删除提交，数据复活。
    debouncedPersistStorage.setItem(KEY, { state: buildState(), version: 16 });
    await flushPendingPersistSnapshot();
    expect(await readMeta()).not.toBeNull();

    // 不 sleep：返回的 Promise 本身应覆盖整条串行链（排队写入 → 清盘 → 簿记重置）
    await expect(debouncedPersistStorage.removeItem(KEY)).resolves.toBeUndefined();

    expect(await readRaw(KEY)).toBeNull();
    expect(await readMeta()).toBeNull();
    expect(await readRaw(shardKeyFor(KEY, 'core'))).toBeNull();
  });

  it('removePersistedSnapshot rejects when the on-disk removal fails, without poisoning the write chain', async () => {
    // 回归（CodeRabbit r4165367349）：删除失败必须如实传给调用方（清空数据流
    // 据此跳过状态重置与 reload，而不是把残留快照当作已删除）；同时共享写链
    // 不 reject、簿记仍重置，后续写入全量重建、状态恢复一致。
    debouncedPersistStorage.setItem(KEY, { state: buildState(), version: 16 });
    await flushPendingPersistSnapshot();
    expect(await readMeta()).not.toBeNull();

    const originalDelete = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function () { throw new Error('simulated delete failure'); };
    try {
      await expect(removePersistedSnapshot(KEY)).rejects.toThrow('simulated delete failure');
    } finally {
      IDBObjectStore.prototype.delete = originalDelete;
    }

    // 磁盘上的旧数据未被删除（失败如实暴露，而不是被当作成功）
    expect(await readMeta()).not.toBeNull();

    // 链未被毒化、簿记已重置：后续写入全量重建，重新水合得到一致状态
    const nextState = { ...buildState(), language: 'en' };
    debouncedPersistStorage.setItem(KEY, { state: nextState, version: 16 });
    await flushPendingPersistSnapshot();
    expect((await readShardState('core')).language).toBe('en');
    const rehydrated = await debouncedPersistStorage.getItem(KEY);
    expect(rehydrated?.state).toMatchObject({ theme: 'dark', language: 'en' });
  });
});

describe('idle 大分片写入节流', () => {
  // 大分片按上次成功写入的序列化体积判定（阈值 SHARD_SIZE_WARN_BYTES = 5MB），
  // 用 5MB+ 的字符串构造 releases 分片。
  const bigBlob = (ch: string): string => ch.repeat(5 * 1024 * 1024 + 1024);
  const bigReleases = [{ id: 1, blob: bigBlob('x') }];

  // 用真实计时器验证节流时序：经 __setPersistTimingsForTest 注入更小的
  // 防抖/冷却时长。此前用 fake timers 跳 60s，fake-indexeddb 的事务推进依赖
  // 真实 macrotask，两者交错在慢速 CI 上出现「冷却到期写入尚未提交就读盘」
  // 的不稳定（本地快环境难以复现）；真实计时器下不存在两套时钟互踩。
  // 注入值需满足 冷却间隔 > 防抖 + 单次等待窗口，冷却才有约束意义。
  const DEBOUNCE_MS = 5;
  const INTERVAL_MS = 300;
  /** 轮询磁盘直到 check 成立；按实际经过时间截止（默认 5s），两次检查之间短暂真实等待——迭代数上限在极慢环境下可能先于防抖耗尽。 */
  const settleUntil = async (check: () => Promise<boolean>, message: string, deadlineMs = 5000): Promise<void> => {
    const deadline = Date.now() + deadlineMs;
    for (;;) {
      if (await check()) return;
      if (Date.now() >= deadline) throw new Error(`${message}（等待超时，实际状态未满足）`);
      await realWait(5);
    }
  };
  const diskReleasesEquals = async (expected: unknown): Promise<boolean> => {
    const current = (await readShardState('releases')).releases;
    return JSON.stringify(current) === JSON.stringify(expected);
  };
  const realWait = async (ms: number): Promise<void> => {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  };

  beforeEach(() => {
    __setPersistTimingsForTest({ debounceMs: DEBOUNCE_MS, idleTimeoutMs: 10, largeShardIdleMinIntervalMs: INTERVAL_MS });
  });

  afterEach(() => {
    __setPersistTimingsForTest({ debounceMs: 1000, idleTimeoutMs: 3000, largeShardIdleMinIntervalMs: 60_000 });
  });

  it('冷却期内的多次 idle 写入合并为一次最终写，落盘为最新值', async () => {
    const baseState = { ...buildState(), releases: bigReleases };
    debouncedPersistStorage.setItem(KEY, { state: baseState, version: 16 });
    await flushPendingPersistSnapshot(); // 首次写入建立基准（releases 序列化体积 > 5MB）
    const savedAtAfterFirst = (await readMeta())?.savedAt;

    // 冷却期内第 1 次写入：releases 引用变化 → 被推迟，磁盘保持基准内容。
    // 负向断言必须等防抖派发确实发生（防抖 5ms + 空闲回调上限 10ms + 余量），
    // 否则断言可能在派发前通过、即使节流被移除也检测不到。
    const releasesV2 = [{ id: 2, blob: bigBlob('y') }];
    debouncedPersistStorage.setItem(KEY, { state: { ...baseState, releases: releasesV2 }, version: 16 });
    await realWait(60);
    expect(await diskReleasesEquals(bigReleases)).toBe(true);

    // 冷却期内第 2 次写入：与第 1 次合并，定时器重新对齐到冷却期末
    const releasesV3 = [{ id: 3, blob: bigBlob('z') }];
    debouncedPersistStorage.setItem(KEY, {
      state: { ...baseState, releases: releasesV3, theme: 'light' },
      version: 16,
    });
    await realWait(60);
    expect(await diskReleasesEquals(bigReleases)).toBe(true);

    // 冷却到期（距上次成功写入 300ms）：定时器触发一次最终写，内容为最新值
    await settleUntil(() => diskReleasesEquals(releasesV3), '冷却到期后应落盘最新值 v3');
    expect((await readShardState('core')).theme).toBe('light');
    expect((await readMeta())?.savedAt).not.toBe(savedAtAfterFirst);
  });

  it('冷却期外的 idle 写入不再等待，到点立即落盘', async () => {
    const baseState = { ...buildState(), releases: bigReleases };
    debouncedPersistStorage.setItem(KEY, { state: baseState, version: 16 });
    await flushPendingPersistSnapshot();

    // 距上次写入超过冷却间隔：防抖+idle 到点后直接写入，无额外推迟
    await realWait(INTERVAL_MS + 150);
    const releasesV2 = [{ id: 2, blob: bigBlob('y') }];
    debouncedPersistStorage.setItem(KEY, { state: { ...baseState, releases: releasesV2 }, version: 16 });
    await settleUntil(() => diskReleasesEquals(releasesV2), '冷却期外写入应立即落盘 v2');
  });

  it('flush 等非 idle 来源绕过节流，冷却期内也立即写入', async () => {
    const baseState = { ...buildState(), releases: bigReleases };
    debouncedPersistStorage.setItem(KEY, { state: baseState, version: 16 });
    await flushPendingPersistSnapshot();

    // 刚写完大分片（冷却期内）：flush（pagehide/visibilitychange 路径）必须立即落盘
    const releasesV2 = [{ id: 2, blob: bigBlob('y') }];
    debouncedPersistStorage.setItem(KEY, { state: { ...baseState, releases: releasesV2 }, version: 16 });
    await flushPendingPersistSnapshot();
    await settleUntil(() => diskReleasesEquals(releasesV2), 'flush 应绕过冷却立即落盘 v2');
  });

  it('大分片冷却期内，仅小分片变化仍立即写入', async () => {
    const baseState = { ...buildState(), releases: bigReleases };
    debouncedPersistStorage.setItem(KEY, { state: baseState, version: 16 });
    await flushPendingPersistSnapshot();

    // releases 引用未变（仅 core 的 theme 变化）：不落入大分片冷却，防抖后立即写入
    debouncedPersistStorage.setItem(KEY, { state: { ...baseState, theme: 'light' }, version: 16 });
    await settleUntil(async () => (await readShardState('core')).theme === 'light', '仅小分片变化应立即落盘');
    expect((await readShardState('releases')).releases).toEqual(bigReleases);
  });

  it('在途写入未提交时把状态改回旧值，恢复更新不能被丢弃', async () => {
    // commitGate 挂停提交入口制造确定性的在途窗口：v2 写入已到达
    // setStorageEntries 但未提交，lastWrittenShards 仍是 v1 旧基准——此时
    // 把状态改回旧基准，派发口按旧基准判脏为空，不能据此丢弃该更新。
    const baseState = { ...buildState(), releases: bigReleases };
    debouncedPersistStorage.setItem(KEY, { state: baseState, version: 16 });
    await flushPendingPersistSnapshot(); // 基准 = v1

    try {
      commitGate.arm();
      const releasesV2 = [{ id: 2, blob: bigBlob('y') }];
      debouncedPersistStorage.setItem(KEY, { state: { ...baseState, releases: releasesV2 }, version: 16 });
      const flushing = flushPendingPersistSnapshot(); // v2 写入开始并在提交点挂停
      await commitGate.waitReached(); // v2 已在途、未提交
      debouncedPersistStorage.setItem(KEY, { state: baseState, version: 16 }); // 改回旧基准
      // 在闸门仍挂停时等防抖(5ms)+空闲回调(10ms)派发确实发生：此时按旧基准
      // 判脏为空。提前 release 会让 v2 先提交、判脏变非空，测试失去判别力。
      await realWait(60);
      commitGate.release(); // 放行 v2 提交
      await flushing;
      await settleUntil(() => diskReleasesEquals(bigReleases), '恢复旧值的更新不应被在途写入丢弃');
    } finally {
      commitGate.reset(); // 失败路径也不让挂停状态泄漏到后续用例
    }
  });
});

describe('indexedDbStorage batch helpers', () => {
  it('writes every entry to localStorage on the fallback path', async () => {
    await writeEntriesToFallbackStorage(KEY, [['fallback-a', '1'], ['fallback-b', '2']]);
    expect(window.localStorage.getItem('fallback-a')).toBe('1');
    expect(window.localStorage.getItem('fallback-b')).toBe('2');
    window.localStorage.removeItem('fallback-a');
    window.localStorage.removeItem('fallback-b');
  });

  it('rolls back the whole fallback batch when any key write fails', async () => {
    // Node ≥24 的原生 localStorage 经 vitest 拷入后每次访问可能返回新包装对象，
    // vi.spyOn 拦截不可靠；整体替换为可控 fake 保证模块与测试看到同一实例。
    // 批次内的 fallback-a 预置旧值：回滚必须恢复旧值而不是删除
    //（meta 仍引用该分片键，删除会被水合误判为分片缺失）。
    const backing = new Map<string, string>([
      ['fallback-a', 'old-committed-core'],
      ['fallback-c', 'previous'],
    ]);
    const failingStorage: Storage = {
      clear: () => backing.clear(),
      getItem: (key: string) => (backing.has(key) ? (backing.get(key) as string) : null),
      key: (index: number) => Array.from(backing.keys())[index] ?? null,
      removeItem: (key: string) => {
        backing.delete(key);
      },
      setItem: (key: string, value: string) => {
        if (key === 'fallback-b') throw new Error('quota exceeded');
        backing.set(key, String(value));
      },
      get length() {
        return backing.size;
      },
    };
    const savedDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', { configurable: true, value: failingStorage });
    try {
      await expect(writeEntriesToFallbackStorage(KEY, [['fallback-a', '1'], ['fallback-b', '2']])).rejects.toThrow();
      // 已覆盖的键恢复旧值；本批新增的键回滚删除；批次外的键不受影响
      expect(backing.get('fallback-a')).toBe('old-committed-core');
      expect(backing.has('fallback-b')).toBe(false);
      expect(backing.get('fallback-c')).toBe('previous');
    } finally {
      if (savedDescriptor) {
        Object.defineProperty(window, 'localStorage', savedDescriptor);
      } else {
        delete (window as unknown as Record<string, unknown>).localStorage;
      }
    }
  });

  it('marks localStorage as the authority after a fallback write so stale IDB values cannot shadow it', async () => {
    // F1 回归（CodeRabbit 线程 r4164377998）：IDB 批量写失败而回退写入成功后，
    // 旧的 IndexedDB 分片/meta 必须失效，否则重启水合会静默回滚到旧状态。
    await setStorageEntries(KEY, [[`${KEY}#shard:core`, 'OLD-FROM-IDB'], [metaKeyFor(KEY), '{"format":1}']]);

    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () { throw new Error('simulated quota exceeded'); };
    try {
      await setStorageEntries(KEY, [[`${KEY}#shard:core`, 'NEW-FROM-FALLBACK']]);
    } finally {
      IDBObjectStore.prototype.put = originalPut;
    }

    // 严格读必须拿到回退写入的新值（而非旧 IDB 值）
    expect(await readStrict(`${KEY}#shard:core`)).toBe('NEW-FROM-FALLBACK');
    // localStorage 权威标记已置位
    expect(window.localStorage.getItem(`${KEY}#fallback`)).not.toBeNull();

    // IDB 恢复后的下一次成功写入清除权威标记并回写 IDB
    await setStorageEntries(KEY, [[`${KEY}#shard:core`, 'NEWER-FROM-IDB']]);
    expect(await readStrict(`${KEY}#shard:core`)).toBe('NEWER-FROM-IDB');
  });

  it('falls back to localStorage for batch-read keys missing from IndexedDB even without the authority marker', async () => {
    // 极端角落（如兜底标记自身写入失败）：IDB 无此键但 localStorage 有值且无标记，
    // 批量严格读必须与单键严格读一致地回退 localStorage，而不是判成分片缺失。
    window.localStorage.setItem(`${KEY}#shard:core`, 'LS-ONLY');
    try {
      expect(await getStorageEntriesStrict(KEY, [`${KEY}#shard:core`])).toEqual(['LS-ONLY']);
      // 对照：IDB 有该键时值以 IDB 为准（LS 镜像不会被误用）
      await setStorageEntries(KEY, [[`${KEY}#shard:core`, 'IDB-VALUE']]);
      expect(await getStorageEntriesStrict(KEY, [`${KEY}#shard:core`])).toEqual(['IDB-VALUE']);
    } finally {
      window.localStorage.removeItem(`${KEY}#shard:core`);
      await indexedDBStorage.removeItem(`${KEY}#shard:core`);
    }
  });

  it('writes batch entries through the IndexedDB path and reads them back', async () => {
    await setStorageEntries(KEY, [['idb-a', '1'], ['idb-b', '2']]);
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
