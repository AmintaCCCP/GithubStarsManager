import type { StateStorage } from 'zustand/middleware';

export const DB_NAME = 'github-stars-manager-db';
const STORE_NAME = 'app_state';
const DB_VERSION = 1;

// Freshness metadata embedded alongside every persisted snapshot so we can pick
// the *newest* valid copy regardless of collection size (a newer snapshot may
// legitimately contain fewer repositories after intentional deletions, and equal
// sizes can hide newer edits to settings/tags/metadata).
const META_KEY = '__gsm_meta';
interface SnapshotMeta {
  ts: number;
}

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
 * Snapshot helpers — used to pick the *newest valid* available copy so a
 * stale snapshot can never shadow good data, and to repair divergence between
 * IndexedDB and localStorage.
 */
interface PersistSnapshot {
  state?: Record<string, unknown>;
  version?: number;
  [META_KEY]?: SnapshotMeta;
}

const normalizeValue = (value: unknown): string => {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return 'null';
  }
};

const stamp = (raw: string): string => {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    obj[META_KEY] = { ts: Date.now() } as SnapshotMeta;
    return JSON.stringify(obj);
  } catch {
    return raw;
  }
};

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
 * - Reads from IndexedDB and localStorage, selecting the *newest valid*
 *   snapshot via embedded write timestamps — never by collection size, so a
 *   stale (but larger) copy can no longer be restored; if neither copy
 *   carries freshness metadata (legacy recovery), richness is the fallback.
 * - After selecting, the divergent/older store is repaired from the chosen
 *   snapshot so the two copies stay consistent.
 * - Writes go to IndexedDB (large-data friendly) and a localStorage mirror
 *   carrying the same timestamp; the mirror is best-effort (quota-limited)
 *   and used as an unload-safe fallback. The only good copy is never
 *   destroyed.
 * - localStorage is also used as the sole store when IndexedDB is
 *   unavailable or a write fails, so persistence works in constrained
 *   environments.
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

      let selected: string | null;
      if (idbOk && lsOk) {
        const idbTs = idbSnap?.[META_KEY]?.ts;
        const lsTs = lsSnap?.[META_KEY]?.ts;
        if (typeof idbTs === 'number' && typeof lsTs === 'number') {
          // Both carry freshness metadata: pick the newest; tie-break by richness.
          selected =
            idbTs > lsTs || (idbTs === lsTs && snapshotRichness(idbSnap) >= snapshotRichness(lsSnap))
              ? idbRaw
              : lsRaw;
        } else if (typeof idbTs === 'number') {
          // Only IndexedDB has metadata (current build) → it is the newer copy.
          selected = idbRaw;
        } else if (typeof lsTs === 'number') {
          selected = lsRaw;
        } else {
          // Legacy recovery: neither carries metadata, fall back to richness.
          selected = snapshotRichness(idbSnap) >= snapshotRichness(lsSnap) ? idbRaw : lsRaw;
        }
      } else if (idbOk) {
        selected = idbRaw;
      } else if (lsOk) {
        selected = lsRaw;
      } else {
        // Neither has meaningful data; return whatever exists.
        selected = idbRaw ?? lsRaw;
      }

      // Repair the divergent/older store from the selected snapshot so the two
      // copies converge (idempotent; skipped silently on failure).
      if (selected) {
        if (selected === idbRaw && selected !== lsRaw) {
          if (!safeLocalStorageSet(name, selected)) {
            console.warn('[storage] localStorage repair write failed (quota?)');
          }
        } else if (selected === lsRaw && selected !== idbRaw) {
          try {
            // Repair verbatim: preserve the selected snapshot's original
            // timestamp so it never appears newer than a concurrent genuine write.
            await withTimeout(idbSet(name, selected));
          } catch (error) {
            console.warn('[storage] IndexedDB repair write failed', error);
          }
        }
      }

      return selected;
    } catch (error) {
      console.warn('[storage] IndexedDB get failed, fallback to localStorage:', error);
      return safeLocalStorageGet(name);
    }
  },

  setItem: async (name: string, value: string): Promise<void> => {
    if (typeof window === 'undefined') return;

    const stamped = stamp(normalizeValue(value));

    // Defensive gate: never let an empty/invalid snapshot clobber a
    // non-empty one. A failed hydration (migrate/merge error or an
    // unreadable snapshot) otherwise writes the initial empty state over
    // good data and wipes the user's entire history in one write.
    if (!isNonEmptySnapshot(parseSnapshot(stamped))) {
      try {
        const [idbRaw, lsRaw] = await Promise.all([
          canUseIndexedDB() ? withTimeout(idbGet(name)).catch(() => null) : Promise.resolve(null),
          Promise.resolve(safeLocalStorageGet(name)),
        ]);
        const existingOk =
          isNonEmptySnapshot(parseSnapshot(idbRaw)) ||
          isNonEmptySnapshot(parseSnapshot(lsRaw));
        if (existingOk) {
          console.warn('[storage] refusing to overwrite non-empty data with an empty snapshot');
          return;
        }
      } catch {
        // If we cannot verify the existing copy, refuse the empty write
        // rather than risk clobbering good data.
        console.warn('[storage] refusing empty write (cannot verify existing data)');
        return;
      }
    }

    // Only cache the value for unload-time flush *after* the empty-write gate
    // has accepted it. Caching a rejected write would let pagehide/visibilitychange
    // persist the empty snapshot to localStorage, bypassing the guard and
    // destroying the only good copy in localStorage-only environments.
    latestValue = { name, value: stamped };
    registerFlushListeners();

    // Primary path: IndexedDB first (large data friendly)
    if (canUseIndexedDB()) {
      try {
        await withTimeout(idbSet(name, stamped));
        // Best-effort mirror so localStorage also carries freshness metadata and
        // can be used as an unload-safe fallback. Quota failures are non-fatal.
        if (!safeLocalStorageSet(name, stamped)) {
          console.warn('[storage] localStorage mirror write failed (quota?)');
        }
        return;
      } catch (error) {
        console.warn('[storage] IndexedDB set failed, fallback to localStorage:', error);
      }
    }

    if (!safeLocalStorageSet(name, stamped)) {
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
