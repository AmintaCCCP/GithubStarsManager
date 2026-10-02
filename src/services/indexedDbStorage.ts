import type { StateStorage } from 'zustand/middleware';

export const DB_NAME = 'github-stars-manager-db';
const STORE_NAME = 'app_state';
const DB_VERSION = 1;

const canUseIndexedDB = () => typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';

const withTimeout = async <T>(promise: Promise<T>, timeoutMs = 2000): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('IndexedDB timeout')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const safeLocalStorageGet = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const safeLocalStorageSet = (key: string, value: string): boolean => {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    // Quota/security errors are expected in some environments; report failure to caller.
    return false;
  }
};

const safeLocalStorageRemove = (key: string): void => {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
};

/** 仅对「打开数据库」设超时；事务本身由 oncomplete/onabort/onerror 保证收敛。 */
const openDb = (): Promise<IDBDatabase> => withTimeout(new Promise<IDBDatabase>((resolve, reject) => {
  const request = window.indexedDB.open(DB_NAME, DB_VERSION);

  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(STORE_NAME)) {
      db.createObjectStore(STORE_NAME);
    }
  };

  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
}), 2000);

const idbGet = async (key: string): Promise<string | null> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(key);

    req.onsuccess = () => resolve((req.result as string | undefined) ?? null);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error('[storage] IndexedDB read transaction aborted'));
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
};

const idbSet = async (key: string, value: string): Promise<void> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, key);

    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error('[storage] IndexedDB write transaction aborted'));
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
};

const idbDelete = async (key: string): Promise<void> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);

    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error('[storage] IndexedDB delete transaction aborted'));
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
};

/** 单事务批量写入：所有键要么一起提交，要么一起回滚（分片持久化的原子提交点）。 */
const idbSetMany = async (entries: ReadonlyArray<readonly [string, string]>): Promise<void> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const [key, value] of entries) {
      store.put(value, key);
    }

    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error('[storage] IndexedDB batch transaction aborted'));
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
};

/** 单连接 + 单 readonly 事务批量读取，避免水合阶段并发打开多个连接。 */
const idbGetMany = async (keys: ReadonlyArray<string>): Promise<Array<string | null>> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const results: Array<string | null> = new Array(keys.length).fill(null);
    keys.forEach((key, index) => {
      const req = store.get(key);
      req.onsuccess = () => {
        results[index] = (req.result as string | undefined) ?? null;
      };
      req.onerror = () => reject(req.error);
    });

    tx.oncomplete = () => {
      db.close();
      resolve(results);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error('[storage] IndexedDB batch read transaction aborted'));
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
};

/** 只探测键是否存在（不传输值），用于廉价的 legacy 快照存在性检查。 */
const idbHasKey = async (key: string): Promise<boolean> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getKey(key);

    req.onsuccess = () => resolve(req.result !== undefined);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error('[storage] IndexedDB key probe aborted'));
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
};

/** 删除精确键及其全部派生键（`${name}#` 前缀：分片与 meta）。 */
const idbDeleteWithDerivedKeys = async (name: string): Promise<void> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(name);
    if (typeof IDBKeyRange !== 'undefined') {
      store.delete(IDBKeyRange.bound(`${name}#`, `${name}#\uffff`));
    }

    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error('[storage] IndexedDB delete transaction aborted'));
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
};

const safeLocalStorageRemoveByPrefix = (prefix: string): void => {
  try {
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(prefix)) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    // ignore
  }
};

const safeLocalStorageRemoveWithDerivedKeys = (name: string): void => {
  safeLocalStorageRemove(name);
  safeLocalStorageRemoveByPrefix(`${name}#`);
};

/**
 * localStorage 兜底权威标记：IndexedDB 批量写失败而回退写入成功时置位，
 * 表示「这些键的最新已提交值在 localStorage，读取必须优先 localStorage」。
 * 下一次 IndexedDB 写入成功时清除。若不标记，读取端会继续优先返回 IndexedDB
 * 中的旧值，localStorage 里的新值永远不会生效（状态静默回滚）。
 */
const fallbackMarkerKey = (name: string): string => `${name}#fallback`;

const isFallbackAuthoritative = (name: string): boolean =>
  safeLocalStorageGet(fallbackMarkerKey(name)) !== null;

/**
 * localStorage 兜底写入：按“全部成功才算提交”处理，任一键失败即回滚并抛错。
 * 回滚时恢复每个键写入前的旧值（而非简单删除）——批次中的分片键通常已有
 * 上次提交的内容，删掉会让仍引用它们的 meta 在下次水合时误判为分片缺失。
 * 成功后：置权威标记，并尽力删除对应的旧 IndexedDB 键（双保险，防止读取
 * 被旧 IndexedDB 值遮蔽）。
 */
export const writeEntriesToFallbackStorage = async (
  name: string,
  entries: ReadonlyArray<readonly [string, string]>,
): Promise<void> => {
  const written: Array<readonly [string, string | null]> = [];
  try {
    for (const [key, value] of entries) {
      const previous = safeLocalStorageGet(key);
      if (!safeLocalStorageSet(key, value)) {
        throw new Error('[storage] localStorage fallback write failed');
      }
      written.push([key, previous]);
    }
  } catch (error) {
    const unrestorable: string[] = [];
    for (let i = written.length - 1; i >= 0; i--) {
      const [key, previous] = written[i];
      const restored = previous === null
        ? (safeLocalStorageRemove(key), true)
        : safeLocalStorageSet(key, previous);
      if (!restored) {
        unrestorable.push(key);
      }
    }
    if (unrestorable.length > 0) {
      console.warn('[storage] fallback rollback could not restore keys:', unrestorable);
    }
    throw error;
  }

  if (!safeLocalStorageSet(fallbackMarkerKey(name), new Date().toISOString())) {
    console.warn('[storage] failed to mark localStorage as fallback authority;');
  }
  if (canUseIndexedDB()) {
    for (const [key] of entries) {
      try {
        await idbDelete(key);
      } catch (error) {
        console.warn('[storage] failed to invalidate stale IndexedDB key after fallback:', key, error);
      }
    }
  }
};

/**
 * 在单个 IndexedDB 事务里批量写入多个键（分片持久化的提交点）。
 * - IndexedDB 可用时：一个 readwrite 事务承载全部分片与 meta，天然原子——
 *   任一分片写入失败则整批回滚，旧快照原样保留，不会出现半新半旧的撕裂状态。
 *   事务不设超时：超时无法取消已启动的事务，迟到提交与 localStorage 兜底
 *   并存会造成双写；事务本身由 oncomplete/onabort/onerror 保证收敛。
 * - IndexedDB 不可用或写入失败时：退回 localStorage，并置权威标记
 *   （见 writeEntriesToFallbackStorage）。
 */
export const setStorageEntries = async (
  name: string,
  entries: ReadonlyArray<readonly [string, string]>,
): Promise<void> => {
  if (typeof window === 'undefined') return;
  if (entries.length === 0) return;

  if (canUseIndexedDB()) {
    try {
      await idbSetMany(entries);
      for (const [key] of entries) {
        safeLocalStorageRemove(key);
      }
      safeLocalStorageRemove(fallbackMarkerKey(name));
      return;
    } catch (error) {
      console.warn('[storage] IndexedDB batch set failed, fallback to localStorage:', error);
    }
  }

  await writeEntriesToFallbackStorage(name, entries);
};

/**
 * 严格读取：读取失败（IndexedDB 打开失败/事务异常）时抛出，而不是静默降级——
 * 调用方必须能区分「键不存在」与「暂时读不到」，后者绝不能被当作空数据覆盖。
 * 读取优先级：localStorage 兜底权威标记置位时 localStorage 优先；否则
 * IndexedDB 优先，缺失时回退 localStorage（覆盖兜底写入后的场景）。
 */
export const getStorageItemStrict = async (name: string, key: string): Promise<string | null> => {
  if (typeof window === 'undefined') return null;
  if (!canUseIndexedDB()) return safeLocalStorageGet(key);

  const idbValue = await idbGet(key);
  if (idbValue !== null) {
    return isFallbackAuthoritative(name) ? (safeLocalStorageGet(key) ?? idbValue) : idbValue;
  }
  return safeLocalStorageGet(key);
};

/** 批量严格读取：任一读取失败即整体抛出（单连接单事务，缩小超时/失败窗口）。 */
export const getStorageEntriesStrict = async (
  name: string,
  keys: ReadonlyArray<string>,
): Promise<Array<string | null>> => {
  if (typeof window === 'undefined') return keys.map(() => null);
  if (!canUseIndexedDB()) {
    return keys.map((key) => safeLocalStorageGet(key));
  }

  const results = await idbGetMany(keys);
  if (isFallbackAuthoritative(name)) {
    return keys.map((key, index) => safeLocalStorageGet(key) ?? results[index]);
  }
  // 与单键严格读一致：IDB 未命中时回退 localStorage。兜底写入期间被尽力删除的
  // IDB 键在权威标记清除后仍可能缺失（之后的 IDB 批次只回写了当批脏分片），
  // 不回退会把「键在 localStorage」误判为「分片缺失」。
  return keys.map((key, index) => results[index] ?? safeLocalStorageGet(key));
};

/** 廉价探测旧版单键快照是否仍存在（不读取值本身）。 */
export const hasLegacySnapshot = async (name: string): Promise<boolean> => {
  if (typeof window === 'undefined') return false;
  if (safeLocalStorageGet(name) !== null) return true;
  if (!canUseIndexedDB()) return false;
  try {
    return await idbHasKey(name);
  } catch {
    return false;
  }
};

/**
 * 仅删除旧版单键快照（不含分片/派生键）。
 * 分片迁移完成后由持久化层调用以释放旧快照占用的空间；
 * 与 removeItem（连带清扫派生键）语义不同，误用会清掉刚提交的分片。
 */
export const removeLegacySnapshot = async (name: string): Promise<void> => {
  if (typeof window === 'undefined') return;

  safeLocalStorageRemove(name);

  if (!canUseIndexedDB()) return;

  try {
    await idbDelete(name);
  } catch (error) {
    console.warn('[storage] IndexedDB legacy snapshot remove failed:', error);
  }
};

/**
 * IndexedDB-backed Zustand persist storage with seamless migration:
 * - First read from IndexedDB
 * - If empty, migrate an existing localStorage snapshot to IndexedDB and then remove it
 * - Normal writes go to IndexedDB and clear any legacy localStorage snapshot.
 * - localStorage is only kept as the current snapshot when IndexedDB is unavailable or a write fails.
 *   This avoids stale fallback rollbacks while preserving persistence in constrained environments.
 * - removeItem also sweeps the derived sharding keys (`${name}#...`) so data-management
 *   wipes and test resets remove every persisted trace of the app.
 */
export const indexedDBStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    if (typeof window === 'undefined') return null;

    // Hard fallback for environments without IndexedDB
    if (!canUseIndexedDB()) {
      return safeLocalStorageGet(name);
    }

    try {
      const idbValue = await idbGet(name);
      if (idbValue !== null) return idbValue;

      // Migration path: restore existing localStorage snapshot into IndexedDB
      const legacyValue = safeLocalStorageGet(name);
      if (legacyValue !== null) {
        await idbSet(name, legacyValue);
        safeLocalStorageRemove(name);
        console.info('[storage] migrated state from localStorage to IndexedDB');
      }
      return legacyValue;
    } catch (error) {
      console.warn('[storage] IndexedDB get failed, fallback to localStorage:', error);
      return safeLocalStorageGet(name);
    }
  },

  setItem: async (name: string, value: string): Promise<void> => {
    if (typeof window === 'undefined') return;

    // Primary path: IndexedDB first (large data friendly)
    if (canUseIndexedDB()) {
      try {
        await idbSet(name, value);
        safeLocalStorageRemove(name);
        return;
      } catch (error) {
        console.warn('[storage] IndexedDB set failed, fallback to localStorage:', error);
      }
    }

    if (!safeLocalStorageSet(name, value)) {
      throw new Error('[storage] localStorage fallback write failed');
    }
  },

  removeItem: async (name: string): Promise<void> => {
    if (typeof window === 'undefined') return;

    safeLocalStorageRemoveWithDerivedKeys(name);

    if (!canUseIndexedDB()) return;

    try {
      await idbDeleteWithDerivedKeys(name);
    } catch (error) {
      console.warn('[storage] IndexedDB remove failed:', error);
    }
  },
};
