import type { StateStorage } from 'zustand/middleware';

export const DB_NAME = 'github-stars-manager-db';
const STORE_NAME = 'app_state';
const DB_VERSION = 1;

const canUseIndexedDB = () => typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';

const withTimeout = async <T>(promise: Promise<T>, timeoutMs = 2000): Promise<T> => {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('IndexedDB timeout')), timeoutMs)),
  ]);
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

const openDb = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const idbGet = async (key: string): Promise<string | null> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(key);

    req.onsuccess = () => resolve((req.result as string | undefined) ?? null);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
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
 * localStorage 兜底写入：按“全部成功才算提交”处理，任一键失败即回滚并抛错。
 * 回滚时恢复每个键写入前的旧值（而非简单删除）——批次中的分片键通常已有
 * 上次提交的内容，删掉会让仍引用它们的 meta 在下次水合时误判为分片缺失。
 */
export const writeEntriesToFallbackStorage = async (
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
    for (let i = written.length - 1; i >= 0; i--) {
      const [key, previous] = written[i];
      if (previous === null) {
        safeLocalStorageRemove(key);
      } else {
        safeLocalStorageSet(key, previous);
      }
    }
    throw error;
  }
};

/**
 * 在单个 IndexedDB 事务里批量写入多个键（分片持久化的提交点）。
 * - IndexedDB 可用时：一个 readwrite 事务承载全部分片与 meta，天然原子——
 *   任一分片写入失败则整批回滚，旧快照原样保留，不会出现半新半旧的撕裂状态。
 * - IndexedDB 不可用时：退回 localStorage（见 writeEntriesToFallbackStorage）。
 */
export const setStorageEntries = async (
  entries: ReadonlyArray<readonly [string, string]>,
): Promise<void> => {
  if (typeof window === 'undefined') return;
  if (entries.length === 0) return;

  if (canUseIndexedDB()) {
    try {
      await withTimeout(idbSetMany(entries));
      for (const [key] of entries) {
        safeLocalStorageRemove(key);
      }
      return;
    } catch (error) {
      console.warn('[storage] IndexedDB batch set failed, fallback to localStorage:', error);
    }
  }

  await writeEntriesToFallbackStorage(entries);
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
    await withTimeout(idbDelete(name));
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
      const idbValue = await withTimeout(idbGet(name));
      if (idbValue !== null) return idbValue;

      // Migration path: restore existing localStorage snapshot into IndexedDB
      const legacyValue = safeLocalStorageGet(name);
      if (legacyValue !== null) {
        await withTimeout(idbSet(name, legacyValue));
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
        await withTimeout(idbSet(name, value));
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
      await withTimeout(idbDeleteWithDerivedKeys(name));
    } catch (error) {
      console.warn('[storage] IndexedDB remove failed:', error);
    }
  },
};
