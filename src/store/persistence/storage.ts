
import type { PersistStorage, StorageValue } from 'zustand/middleware';
import { indexedDBStorage, removeLegacySnapshot, setStorageEntries } from '../../services/indexedDbStorage';
import { logger } from '../../services/logger';
import {
  PERSISTENCE_SHARD_FORMAT,
  PERSISTENCE_SHARD_NAMES,
  buildShardViews,
  findDirtyShards,
  metaKeyFor,
  shardKeyFor,
  type PersistenceShardName,
  type ShardMeta,
  type ShardPayload,
} from './shards';

const scheduleIdleTask = (callback: () => void): number => {
  if (typeof window === 'undefined') {
    return setTimeout(callback, 0) as unknown as number;
  }

  if ('requestIdleCallback' in window) {
    return window.requestIdleCallback(callback, { timeout: 3000 });
  }

  return globalThis.setTimeout(callback, 0) as unknown as number;
};

const cancelIdleTask = (id: number): void => {
  if (typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
    window.cancelIdleCallback(id);
    return;
  }

  clearTimeout(id);
};

let persistTimeoutId: ReturnType<typeof setTimeout> | null = null;
let persistIdleTaskId: number | null = null;
let latestPersistName: string | null = null;
let latestPersistValue: StorageValue<unknown> | null = null;
let persistWriteVersion = 0;
let persistFlushListenersRegistered = false;

// 分片持久化的会话内簿记：
// - lastWrittenShards 记录每个分片上次成功写入的字段引用，作为判脏基准；
// - committedShards 记录本会话已成功提交过的分片，用于判定 legacy 旧快照可以退役；
// - legacySnapshotHydrated 表示本次会话从旧版单键快照（或部分分片+旧快照兜底）水合，
//   下一次写入将强制提交全部分片，以便一次性完成迁移并退役旧键。
type ShardViews = Record<PersistenceShardName, Record<string, unknown>>;
let lastWrittenShards: ShardViews | null = null;
const committedShards = new Set<PersistenceShardName>();
let legacySnapshotHydrated = false;

const emptyShardViews = (): ShardViews => {
  const views = {} as ShardViews;
  for (const shard of PERSISTENCE_SHARD_NAMES) {
    views[shard] = {};
  }
  return views;
};

const cancelPendingPersistTasks = (): void => {
  if (persistTimeoutId) {
    clearTimeout(persistTimeoutId);
    persistTimeoutId = null;
  }

  if (persistIdleTaskId !== null) {
    cancelIdleTask(persistIdleTaskId);
    persistIdleTaskId = null;
  }
};

const parseShardPayload = (raw: string | null): Record<string, unknown> | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ShardPayload | null;
    if (!parsed || parsed.format !== PERSISTENCE_SHARD_FORMAT || !parsed.state
      || typeof parsed.state !== 'object') {
      return null;
    }
    return parsed.state;
  } catch {
    return null;
  }
};

const readMeta = async (name: string): Promise<ShardMeta | null> => {
  const raw = await Promise.resolve(indexedDBStorage.getItem(metaKeyFor(name)));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ShardMeta | null;
    if (!parsed || parsed.format !== PERSISTENCE_SHARD_FORMAT
      || !Array.isArray(parsed.shards) || parsed.shards.length === 0
      || typeof parsed.version !== 'number') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const readLegacySnapshot = async (
  name: string,
): Promise<StorageValue<unknown> | null> => {
  const raw = await Promise.resolve(indexedDBStorage.getItem(name));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StorageValue<unknown>;
  } catch {
    return null;
  }
};

/**
 * 读取持久化快照。
 *
 * 读取顺序（保证升级无感、历史数据零丢失）：
 * 1. meta + 全部分片齐全 → 拼装新格式快照；
 * 2. meta 存在但部分分片缺失/损坏 → 存在的分片内容与旧版单键快照合并
 *    （分片提交时间晚于旧快照，是各字段的最新已知状态）；
 * 3. meta 缺失或为新格式不识别 → 回退旧版单键快照（v16 行为，升级首启即此路径）。
 */
const readPersistedSnapshot = async (
  name: string,
): Promise<StorageValue<unknown> | null> => {
  const meta = await readMeta(name);
  if (!meta) return null;

  const shardStates = await Promise.all(
    meta.shards.map(async (shard) => ({
      shard,
      state: parseShardPayload(await Promise.resolve(indexedDBStorage.getItem(shardKeyFor(name, shard)))),
    })),
  );

  const parts: Record<string, unknown> = {};
  const views = emptyShardViews();
  const missing: PersistenceShardName[] = [];
  for (const { shard, state } of shardStates) {
    if (state === null) {
      missing.push(shard);
      continue;
    }
    Object.assign(parts, state);
    views[shard] = state;
  }

  if (missing.length === 0) {
    lastWrittenShards = views;
    // 分片齐全且读取成功：旧版单键快照已完成使命，异步退役（幂等）。
    void Promise.resolve(removeLegacySnapshot(name)).catch(() => undefined);
    return { state: parts, version: meta.version };
  }

  logger.warn('store.persist', 'Some persistence shards are missing; merging with legacy snapshot', {
    missing,
    shards: meta.shards,
  });

  const legacy = await readLegacySnapshot(name);
  if (!legacy || !legacy.state || typeof legacy.state !== 'object') {
    // 无旧快照可兜底（极端：分片被外部清除），尽力返回可读分片，缺失字段按空处理。
    logger.errorFromError(
      'store.persist',
      'Persistence shards missing and no legacy snapshot available; hydrating best-effort',
      new Error(`missing shards: ${missing.join(', ')}`),
    );
    lastWrittenShards = views;
    return { state: parts, version: meta.version };
  }

  // 以旧快照为底、存在的分片覆盖：每个字段都取最新已知状态，避免回退到整体旧数据。
  const legacyState = legacy.state as Record<string, unknown>;
  const legacyViews = buildShardViews(legacyState);
  const mergedState: Record<string, unknown> = { ...legacyState, ...parts };
  for (const { shard, state } of shardStates) {
    views[shard] = state ?? legacyViews[shard];
  }
  lastWrittenShards = views;
  legacySnapshotHydrated = true;
  return { state: mergedState, version: meta.version };
};

const writeShardedSnapshot = async (
  name: string,
  value: StorageValue<unknown>,
  writeVersion: number,
  source: 'idle' | 'flush',
): Promise<void> => {
  if (latestPersistValue === null || latestPersistName !== name || persistWriteVersion !== writeVersion) {
    return;
  }

  // 载荷中的 version 必须是 persist 版本号（水合时驱动 migrate），
  // writeVersion 仅用于丢弃过期的写入调度。
  const persistVersion = typeof value.version === 'number' ? value.version : 0;
  const state = (value.state ?? {}) as Record<string, unknown>;
  const views = buildShardViews(state);
  // 从旧版快照水合的会话：首次写入强制提交全部分片，完成迁移后即可退役旧键。
  const dirty = legacySnapshotHydrated
    ? [...PERSISTENCE_SHARD_NAMES]
    : findDirtyShards(views, lastWrittenShards);
  if (dirty.length === 0) return;

  const entries: Array<readonly [string, string]> = [];
  try {
    for (const shard of dirty) {
      const stringifyStartedAt = performance.now();
      const payload: ShardPayload = {
        format: PERSISTENCE_SHARD_FORMAT,
        version: persistVersion,
        state: views[shard],
      };
      const serialized = JSON.stringify(payload);
      const stringifyMs = Math.round(performance.now() - stringifyStartedAt);
      if (stringifyMs > 50) {
        logger.warn('store.persist', 'Large state stringify completed', {
          source,
          shard,
          stringifyMs,
          bytes: serialized.length,
        });
      }
      entries.push([shardKeyFor(name, shard), serialized]);
    }
    const meta: ShardMeta = {
      format: PERSISTENCE_SHARD_FORMAT,
      version: persistVersion,
      shards: [...PERSISTENCE_SHARD_NAMES],
      savedAt: new Date().toISOString(),
    };
    entries.push([metaKeyFor(name), JSON.stringify(meta)]);
  } catch (e) {
    logger.errorFromError('store.persist', 'Failed to stringify state for persistence', e);
    return;
  }

  const writeStartedAt = performance.now();
  try {
    await setStorageEntries(entries);
  } catch (error) {
    // 提交失败（原子回滚）：旧快照原样保留，无数据丢失，等待下次变更重试。
    logger.errorFromError('store.persist', 'Sharded persist write failed; previous snapshot kept', error, {
      source,
      shards: dirty,
    });
    return;
  }
  const writeMs = Math.round(performance.now() - writeStartedAt);
  if (writeMs > 50) {
    logger.warn('store.persist', 'Large state IndexedDB write completed', {
      source,
      shards: dirty,
      writeMs,
    });
  }

  // 即使本写入期间已有更新的调度（版本过期），磁盘上落盘的也是本批内容，
  // 判脏缓存必须如实反映磁盘状态；更新的写入排在本批之后，会以该基准重新判脏。
  const nextCache: ShardViews = { ...(lastWrittenShards ?? emptyShardViews()) };
  for (const shard of dirty) {
    nextCache[shard] = views[shard];
    committedShards.add(shard);
  }
  lastWrittenShards = nextCache;

  // 全部分片至少成功提交一次后，旧版单键快照才可安全退役（保证可回退读取）。
  if (legacySnapshotHydrated && PERSISTENCE_SHARD_NAMES.every((shard) => committedShards.has(shard))) {
    legacySnapshotHydrated = false;
    logger.info('store.persist', 'Legacy single-key snapshot retired after sharded migration');
    await removeLegacySnapshot(name);
  }
};

let writeChain: Promise<void> = Promise.resolve();

/**
 * 串行化分片写入：判脏必须基于上一次已完成写入的缓存（lastWrittenShards）。
 * idle 写入与 flush 写入可能重叠，若并发执行，后写入者会以过期基准判脏而
 * 跳过写盘，把已撤销的状态留在磁盘上且缓存不自知。
 */
const enqueueShardedWrite = (
  name: string,
  value: StorageValue<unknown>,
  writeVersion: number,
  source: 'idle' | 'flush',
): Promise<void> => {
  writeChain = writeChain
    .catch(() => undefined)
    .then(() => writeShardedSnapshot(name, value, writeVersion, source));
  return writeChain;
};

const flushPendingPersistSnapshot = (): Promise<void> => {
  if (latestPersistName === null || latestPersistValue === null) return Promise.resolve();

  cancelPendingPersistTasks();
  const name = latestPersistName;
  const value = latestPersistValue;
  const scheduledVersion = persistWriteVersion;
  return enqueueShardedWrite(name, value, scheduledVersion, 'flush');
};

const registerPersistFlushListeners = (): void => {
  if (persistFlushListenersRegistered || typeof window === 'undefined') return;
  persistFlushListenersRegistered = true;

  window.addEventListener('pagehide', flushPendingPersistSnapshot);
  window.addEventListener('beforeunload', flushPendingPersistSnapshot);

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        flushPendingPersistSnapshot();
      }
    });
  }
};

// Create a debounced storage to avoid frequent JSON.stringify calls on large state objects
// which causes V8 JIT assertion failures (EXC_BREAKPOINT) on macOS ARM64.
//
// Since the sharded layout, each flush only stringifies and rewrites the shards whose
// persisted fields actually changed (reference-dirty check) — a trivial UI change now
// costs a few KB instead of re-serializing the whole ~100MB snapshot.
const debouncedPersistStorage: PersistStorage<unknown> = {
  getItem: async (name) => {
    const sharded = await readPersistedSnapshot(name);
    if (sharded) return sharded;

    // Migration path: v16 之前的单键快照（IndexedDB 或 localStorage 镜像）。
    const legacy = await readLegacySnapshot(name);
    if (legacy && legacy.state && typeof legacy.state === 'object') {
      legacySnapshotHydrated = true;
      lastWrittenShards = buildShardViews(legacy.state as Record<string, unknown>);
      return legacy;
    }
    return null;
  },
  setItem: (name: string, value: StorageValue<unknown>) => {
    registerPersistFlushListeners();
    latestPersistName = name;
    latestPersistValue = value;
    persistWriteVersion++;
    const scheduledVersion = persistWriteVersion;

    cancelPendingPersistTasks();
    persistTimeoutId = setTimeout(() => {
      persistTimeoutId = null;
      persistIdleTaskId = scheduleIdleTask(() => {
        persistIdleTaskId = null;
        void enqueueShardedWrite(name, value, scheduledVersion, 'idle');
      });
    }, 1000);
  },
  removeItem: (name) => {
    latestPersistName = null;
    latestPersistValue = null;
    persistWriteVersion++;
    cancelPendingPersistTasks();
    lastWrittenShards = null;
    committedShards.clear();
    legacySnapshotHydrated = false;
    void Promise.resolve(indexedDBStorage.removeItem(name)).catch((error: unknown) => {
      logger.errorFromError('store.persist', 'Failed to remove persisted state snapshot', error);
    });
  },
};

export { debouncedPersistStorage, flushPendingPersistSnapshot };
