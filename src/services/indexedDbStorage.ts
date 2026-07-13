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

/**
 * Snapshot helpers — used to pick the *richest* available copy so a stale or
 * empty IndexedDB value can never shadow good data held in localStorage (and
 * vice-versa). Persistence must never silently drop historical user data.
 */
interface PersistSnapshot {
  state?: Record<string, unknown>;
  version?: number;
}

const parseSnapshot = (raw: string | null): PersistSnapshot | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PersistSnapshot;
  } catch {
    return null;
  }
};

const isNonEmptySnapshot = (snap: PersistSnapshot | null): boolean => {
  if (!snap || !snap.state) return false;
  const st = snap.state;
  const repos = Array.isArray(st.repositories) ? (st.repositories as unknown[]).length : 0;
  const gists = Array.isArray(st.gists) ? (st.gists as unknown[]).length : 0;
  const starred = Array.isArray(st.starredGists) ? (st.starredGists as unknown[]).length : 0;
  return !!st.user || repos > 0 || gists > 0 || starred > 0;
};

const snapshotRichness = (snap: PersistSnapshot | null): number => {
  if (!snap || !snap.state) return 0;
  const st = snap.state;
  const repos = Array.isArray(st.repositories) ? (st.repositories as unknown[]).length : 0;
  const gists = Array.isArray(st.gists) ? (st.gists as unknown[]).length : 0;
  const starred = Array.isArray(st.starredGists) ? (st.starredGists as unknown[]).length : 0;
  return repos + gists + starred + (st.user ? 1 : 0);
};

// Cache the latest value so we can mirror it to localStorage on page unload,
// where an async IndexedDB write would never complete.
let latestValue: { name: string; value: string } | null = null;
let flushListenersRegistered = false;

const registerFlushListeners = (): void => {
  if (flushListenersRegistered || typeof window === 'undefined') return;
  flushListenersRegistered = true;

  const flush = (): void => {
    if (latestValue) {
      // localStorage writes are synchronous and survive page teardown, making
      // them a reliable unload-safe mirror of the most recent state.
      safeLocalStorageSet(latestValue.name, latestValue.value);
    }
  };

  window.addEventListener('pagehide', flush);
  window.addEventListener('beforeunload', flush);

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        flush();
      }
    });
  }
};

/**
 * IndexedDB-backed Zustand persist storage with seamless migration:
 * - Reads from IndexedDB and localStorage, preferring whichever copy holds the
 *   richest (non-empty) snapshot — a stale/empty IndexedDB value can no
 *   longer shadow good data held in the other store.
 * - On read, if localStorage holds the only good copy it is migrated into
 *   IndexedDB so the two stay consistent.
 * - Writes go to IndexedDB (large-data friendly) and a localStorage mirror is
 *   kept as an unload-safe fallback. The only good copy is never destroyed.
 * - localStorage is also used as the sole store when IndexedDB is unavailable
 *   or a write fails, so persistence works in constrained environments.
 */
export const indexedDBStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    if (typeof window === 'undefined') return null;

    // Hard fallback for environments without IndexedDB
    if (!canUseIndexedDB()) {
      return safeLocalStorageGet(name);
    }

    try {
      const idbRaw = await withTimeout(idbGet(name));
      const lsRaw = safeLocalStorageGet(name);
      const idbSnap = parseSnapshot(idbRaw);
      const lsSnap = parseSnapshot(lsRaw);
      const idbOk = isNonEmptySnapshot(idbSnap);
      const lsOk = isNonEmptySnapshot(lsSnap);

      let chosen: string | null;
      if (idbOk && lsOk) {
        // Both have data: prefer the richer copy to avoid stale rollback.
        chosen = snapshotRichness(idbSnap) >= snapshotRichness(lsSnap) ? idbRaw : lsRaw;
      } else if (idbOk) {
        chosen = idbRaw;
      } else if (lsOk) {
        chosen = lsRaw;
      } else {
        // Neither has meaningful data; return whatever exists.
        chosen = idbRaw ?? lsRaw;
      }

      // If localStorage held the only good copy, migrate it into IndexedDB.
      if (lsOk && !idbOk && lsRaw) {
        try {
          await withTimeout(idbSet(name, lsRaw));
          console.info('[storage] migrated state from localStorage to IndexedDB');
        } catch (error) {
          console.warn('[storage] IndexedDB migration write failed, keeping localStorage', error);
        }
      }

      return chosen;
    } catch (error) {
      console.warn('[storage] IndexedDB get failed, fallback to localStorage:', error);
      return safeLocalStorageGet(name);
    }
  },

  setItem: async (name: string, value: string): Promise<void> => {
    if (typeof window === 'undefined') return;

    latestValue = { name, value };
    registerFlushListeners();

    // Primary path: IndexedDB first (large data friendly)
    if (canUseIndexedDB()) {
      try {
        await withTimeout(idbSet(name, value));
        return;
      } catch (error) {
        console.warn('[storage] IndexedDB set failed, fallback to localStorage:', error);
      }
    }

    // Keep a localStorage mirror as a reliable, unload-safe copy.
    if (!safeLocalStorageSet(name, value)) {
      throw new Error('[storage] localStorage fallback write failed');
    }
  },

  removeItem: async (name: string): Promise<void> => {
    if (typeof window === 'undefined') return;

    latestValue = null;
    safeLocalStorageRemove(name);

    if (!canUseIndexedDB()) return;

    try {
      await withTimeout(idbDelete(name));
    } catch (error) {
      console.warn('[storage] IndexedDB remove failed:', error);
    }
  },
};
