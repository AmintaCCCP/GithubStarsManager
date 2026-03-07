import type { StateStorage } from 'zustand/middleware';

const DB_NAME = 'github-stars-manager-db';
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

const safeLocalStorageSet = (key: string, value: string): void => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Quota/security errors are expected in some environments; ignore.
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
 * IndexedDB-backed Zustand persist storage with seamless migration + dual write:
 * - First read from IndexedDB
 * - If empty, fall back to existing localStorage snapshot and migrate to IndexedDB
 * - Every write goes to IndexedDB and localStorage (backward compatibility window)
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
      } catch (error) {
        console.warn('[storage] IndexedDB set failed:', error);
      }
    }

    // Secondary compatibility backup (best effort only)
    safeLocalStorageSet(name, value);
  },

  removeItem: async (name: string): Promise<void> => {
    if (typeof window === 'undefined') return;

    safeLocalStorageRemove(name);

    if (!canUseIndexedDB()) return;

    try {
      await withTimeout(idbDelete(name));
    } catch (error) {
      console.warn('[storage] IndexedDB remove failed:', error);
    }
  },
};
