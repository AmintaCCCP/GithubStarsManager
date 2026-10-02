
import type { PersistStorage, StorageValue } from 'zustand/middleware';
import {
  getStorageEntriesStrict,
  getStorageItemStrict,
  hasLegacySnapshot,
  indexedDBStorage,
  removeLegacySnapshot,
  setStorageEntries,
} from '../../services/indexedDbStorage';
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
//   下一次写入将强制提交全部分片，以便一次性完成迁移并退役旧键；
// - hydratedIncomplete 表示最近一次水合存在读取失败（IDB 故障/超时）。此时水合
//   结果不完整，绝不能写盘——否则会把磁盘上仍然完好的真实分片用默认值覆盖。
// 已知权衡（多标签页/多窗口）：判脏基准是各标签页自己水合时的快照，互相不感知；
// 一个标签页清盘后另一标签页的部分写入可能产生「meta 全量声明 + 部分分片缺失」，
// 读取端会走合并/best-effort 降级路径。与旧单键方案的整快照 LWW 相比，撕裂窗口
// 更小但存在；跨标签页仲裁（BroadcastChannel/版本号）留作后续跟进。
type ShardViews = Record<PersistenceShardName, Record<string, unknown>>;
let lastWrittenShards: ShardViews | null = null;
const committedShards = new Set<PersistenceShardName>();
let legacySnapshotHydrated = false;
let hydratedIncomplete = false;

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

const parseShardPayload = (raw: string | null): { state: Record<string, unknown>; version: number } | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ShardPayload | null;
    if (!parsed || parsed.format !== PERSISTENCE_SHARD_FORMAT || !parsed.state
      || typeof parsed.state !== 'object') {
      return null;
    }
    return { state: parsed.state, version: typeof parsed.version === 'number' ? parsed.version : 0 };
  } catch {
    return null;
  }
};

/**
 * meta 是分片布局的目录，必须视为不可信输入：
 * - 分片名必须是已知分片，且集合与 PERSISTENCE_SHARD_NAMES 完全一致（无缺失、
 *   无重复、无未知项）。不完整的 meta 会让字段静默消失并被当作「分片齐全」，
 *   进而过早退役唯一的兜底（legacy 单键快照）。
 * - meta 本身读取失败（IDB 故障/超时）由调用方区分处理。
 */
const parseMeta = (raw: string | null): ShardMeta | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ShardMeta | null;
    if (!parsed || parsed.format !== PERSISTENCE_SHARD_FORMAT
      || typeof parsed.version !== 'number'
      || !Array.isArray(parsed.shards)
      || parsed.shards.length !== PERSISTENCE_SHARD_NAMES.length
      || !PERSISTENCE_SHARD_NAMES.every((shard) => parsed.shards.includes(shard))) {
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
  const raw = await getStorageItemStrict(name, name);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StorageValue<unknown>;
  } catch {
    return null;
  }
};

/** meta 缺失/损坏时的打捞：按已知分片名直接读取仍可解析的分片载荷。 */
const salvageOrphanedShards = async (name: string): Promise<{
  parts: Record<string, unknown> | null;
  version: number | null;
  readFailed: boolean;
  foundButUnreadable: boolean;
}> => {
  const keys = PERSISTENCE_SHARD_NAMES.map((shard) => shardKeyFor(name, shard));
  let results: Array<string | null>;
  try {
    results = await getStorageEntriesStrict(name, keys);
  } catch (error) {
    logger.errorFromError('store.persist', 'Failed to salvage orphaned persistence shards', error);
    return { parts: null, version: null, readFailed: true, foundButUnreadable: false };
  }

  const parts: Record<string, unknown> = {};
  let version: number | null = null;
  let foundButUnreadable = false;
  PERSISTENCE_SHARD_NAMES.forEach((_shard, index) => {
    const parsed = parseShardPayload(results[index]);
    if (results[index] !== null && !parsed) {
      foundButUnreadable = true;
    }
    if (!parsed) return;
    Object.assign(parts, parsed.state);
    version = version ?? parsed.version;
  });
  return {
    parts: Object.keys(parts).length > 0 ? parts : null,
    version,
    readFailed: false,
    foundButUnreadable,
  };
};

/**
 * 读取持久化快照。
 *
 * 读取顺序（保证升级无感、历史数据零丢失）：
 * 1. meta（精确分片集）+ 全部分片齐全 → 拼装新格式快照；
 * 2. meta 存在但部分分片缺失/损坏 → 存在的分片内容与旧版单键快照合并
 *    （分片提交时间晚于旧快照，是各字段的最新已知状态）；
 * 3. meta 缺失/损坏/不完整 → 回退旧版单键快照（v16 行为，升级首启即此路径）；
 * 4. legacy 也不存在 → 按已知分片名打捞孤儿分片（meta 被清/损坏但分片健在）；
 * 5. 任何「读取失败」（区别于「确定不存在」）都会置 hydratedIncomplete，
 *    之后拒绝写盘，防止用不完整的水合结果覆盖磁盘上的真实数据。
 */
const readPersistedSnapshot = async (
  name: string,
): Promise<StorageValue<unknown> | null> => {
  let readFailed = false;

  let meta: ShardMeta | null = null;
  try {
    meta = parseMeta(await getStorageItemStrict(name, metaKeyFor(name)));
  } catch (error) {
    readFailed = true;
    logger.errorFromError('store.persist', 'Failed to read persistence meta', error);
  }

  if (!meta) {
    const legacy = await readLegacySnapshot(name).catch(() => {
      readFailed = true;
      return null;
    });
    if (legacy && legacy.state && typeof legacy.state === 'object') {
      // meta 不可读但 legacy 单键快照可读：以 legacy 为准（完整快照，写全量安全）。
      legacySnapshotHydrated = true;
      lastWrittenShards = buildShardViews(legacy.state as Record<string, unknown>);
      hydratedIncomplete = false;
      return legacy;
    }

    // legacy 不存在：打捞孤儿分片（meta 键丢失/损坏但分片仍可读）。
    const salvage = await salvageOrphanedShards(name);
    if (salvage.readFailed) readFailed = true;
    if (salvage.parts) {
      logger.errorFromError(
        'store.persist',
        'Persistence meta missing but shards are readable; recovering from orphaned shards',
        new Error('meta missing'),
      );
      // 基准留空：下次写入全量重建（含 meta 自愈）；打捞内容会随全量写入写回。
      lastWrittenShards = null;
      hydratedIncomplete = false;
      return { state: salvage.parts, version: salvage.version ?? 0 };
    }
    if (readFailed || salvage.foundButUnreadable) {
      // 磁盘上存在持久化数据但当前不可读：拒绝以空状态水合（随后的写入会覆盖真实数据）。
      hydratedIncomplete = true;
      logger.errorFromError(
        'store.persist',
        'Persisted data exists but cannot be read; refusing to hydrate and overwrite',
        new Error('meta and shards unreadable'),
      );
      return null;
    }
    return null;
  }

  let shardResults: Array<string | null>;
  try {
    shardResults = await getStorageEntriesStrict(
      name,
      PERSISTENCE_SHARD_NAMES.map((shard) => shardKeyFor(name, shard)),
    );
  } catch (error) {
    readFailed = true;
    logger.errorFromError('store.persist', 'Failed to read persistence shards', error);
    shardResults = PERSISTENCE_SHARD_NAMES.map(() => null);
  }

  const parts: Record<string, unknown> = {};
  const views = emptyShardViews();
  const missing: PersistenceShardName[] = [];
  PERSISTENCE_SHARD_NAMES.forEach((shard, index) => {
    const parsed = parseShardPayload(shardResults[index]);
    if (!parsed) {
      missing.push(shard);
      return;
    }
    Object.assign(parts, parsed.state);
    views[shard] = parsed.state;
  });

  if (missing.length === 0 && !readFailed) {
    lastWrittenShards = views;
    // 分片齐全且读取成功：旧版单键快照已完成使命，确认仍存在时才退役（幂等、廉价）。
    if (await hasLegacySnapshot(name)) {
      void Promise.resolve(removeLegacySnapshot(name)).catch(() => undefined);
    }
    return { state: parts, version: meta.version };
  }

  if (readFailed) {
    logger.warn('store.persist', 'Some persistence shards failed to read; merge degraded', {
      missing,
    });
  } else {
    logger.warn('store.persist', 'Some persistence shards are missing; merging with legacy snapshot', {
      missing,
      shards: meta.shards,
    });
  }

  const legacy = await readLegacySnapshot(name).catch(() => {
    readFailed = true;
    return null;
  });
  if (!legacy || !legacy.state || typeof legacy.state !== 'object') {
    // 无旧快照可兜底（极端：分片被外部清除），尽力返回可读分片，缺失字段按空处理。
    logger.errorFromError(
      'store.persist',
      'Persistence shards missing and no legacy snapshot available; hydrating best-effort',
      new Error(`missing shards: ${missing.join(', ')}`),
    );
    lastWrittenShards = views;
    hydratedIncomplete = readFailed;
    return { state: parts, version: meta.version };
  }

  // 以旧快照为底、存在的分片覆盖：每个字段都取最新已知状态，避免回退到整体旧数据。
  const legacyState = legacy.state as Record<string, unknown>;
  const legacyViews = buildShardViews(legacyState);
  const mergedState: Record<string, unknown> = { ...legacyState, ...parts };
  PERSISTENCE_SHARD_NAMES.forEach((shard, index) => {
    const parsed = parseShardPayload(shardResults[index]);
    views[shard] = parsed?.state ?? legacyViews[shard];
  });
  lastWrittenShards = views;
  legacySnapshotHydrated = true;
  hydratedIncomplete = readFailed;
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

  if (hydratedIncomplete) {
    // 最近一次水合存在读取失败：水合结果不完整，写盘会用默认值覆盖磁盘上
    // 仍然完好的真实分片。拒绝写入直到下一次完整读取成功。
    logger.errorFromError(
      'store.persist',
      'Skipping persist write: last hydration was incomplete; refusing to overwrite',
      new Error('hydrated incomplete'),
      { source },
    );
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

  const SHARD_SIZE_WARN_BYTES = 5 * 1024 * 1024;
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
      } else if (serialized.length > SHARD_SIZE_WARN_BYTES) {
        logger.warn('store.persist', 'Large state shard serialized', {
          source,
          shard,
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
    await setStorageEntries(name, entries);
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
  // 链尾兜底 catch：writeChain 永不 reject，调用方（idle 的 void 调度、
  // pagehide 的同步事件处理器）不会产生 unhandled rejection。
  writeChain = writeChain
    .catch(() => undefined)
    .then(() => writeShardedSnapshot(name, value, writeVersion, source))
    .catch((error: unknown) => {
      logger.errorFromError('store.persist', 'Persist write chain failed', error, { source });
    });
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

/**
 * 清空持久化快照（含 `${name}#` 派生键），返回覆盖整条串行链的 Promise：
 * 排队中的写入先完成、随后清盘、最后重置判脏簿记（含删除失败路径）。
 * 删除与写盘共用同一条串行链——若清盘即重置，in-flight 写入完成后会重新填充
 * 缓存，删除后的首个写入只补写脏分片，而 meta 仍列出全部分片，重启即缺失。
 *
 * 失败语义：共享写链永不 reject（后续写入不被删除失败连坐），但返回给调用方
 * 的 Promise 在删除失败时如实 reject——「清空所有数据」流据此跳过状态重置与
 * reload，而不是把残留快照当作已删除导致数据在重启后复活。
 *
 * 注意：zustand v4 的 persist.clearStorage() 不回传 removeItem 的 Promise，
 * 需要等待删除真正落盘的调用方应直接调用并 await 本函数。
 */
const removePersistedSnapshot = (name: string): Promise<void> => {
  latestPersistName = null;
  latestPersistValue = null;
  persistWriteVersion++;
  cancelPendingPersistTasks();
  const removal = writeChain
    .catch(() => undefined)
    .then(() => indexedDBStorage.removeItem(name));
  writeChain = removal
    .catch((error: unknown) => {
      logger.errorFromError('store.persist', 'Failed to remove persisted state snapshot', error);
    })
    .then(() => {
      lastWrittenShards = null;
      committedShards.clear();
      legacySnapshotHydrated = false;
      hydratedIncomplete = false;
    });
  return removal.then(() => writeChain);
};

// Create a debounced storage to avoid frequent JSON.stringify calls on large state objects
// which causes V8 JIT assertion failures (EXC_BREAKPOINT) on macOS ARM64.
//
// Since the sharded layout, each flush only stringifies and rewrites the shards whose
// persisted fields actually changed (reference-dirty check) — a trivial UI change now
// costs a few KB instead of re-serializing the whole ~100MB snapshot.
const debouncedPersistStorage: PersistStorage<unknown> = {
  getItem: async (name) => {
    // 每次水合重新评估读取完整性；读取失败会在 readPersistedSnapshot 内置位，
    // 使后续写入被拒绝，直到出现一次完整读取。
    hydratedIncomplete = false;
    return await readPersistedSnapshot(name);
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
  removeItem: (name) => removePersistedSnapshot(name),
};

export { debouncedPersistStorage, flushPendingPersistSnapshot, removePersistedSnapshot };
