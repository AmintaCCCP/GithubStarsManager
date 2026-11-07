/**
 * Browser-side seeding of the app's persisted state.
 *
 * GithubStarsManager persists through zustand's `persist` middleware on top of
 * a sharded IndexedDB storage (`src/store/persistence/storage.ts`). The hydrate
 * path has an explicit legacy fallback: when no shard meta exists, it reads the
 * old single-key snapshot (the v16 format) — exactly what an upgrade launch
 * sees. Seeding that legacy snapshot is the supported way to hand the app a
 * full state without replicating the shard layout.
 *
 * This module runs INSIDE the page (page.evaluate), so it must stay
 * self-contained: no imports, no references to module scope.
 */

/** Must match `version` in src/store/persistence/options.ts. Bumping the app's
 *  persist version is safe as long as the migrate chain covers 16 → latest. */
export const PERSIST_VERSION = 16;

/**
 * Seeded via page.evaluate. Writes the legacy zustand StorageValue
 * (`{ state, version }`) to IndexedDB, with a localStorage copy as the
 * fallback channel the storage layer reads when IndexedDB is unavailable.
 */
export function seedPersistedState(payload) {
  // Must stay self-contained: page.evaluate serializes this function alone,
  // so every constant it needs lives right here.
  const DB_NAME = 'github-stars-manager-db';
  const STORE_NAME = 'app_state';
  const LEGACY_KEY = 'github-stars-manager';

  const { state, version } = payload;
  const serialized = JSON.stringify({ state, version });

  const writeLocalStorage = () => {
    try {
      window.localStorage.setItem(LEGACY_KEY, serialized);
      return true;
    } catch {
      return false;
    }
  };

  return new Promise((resolve, reject) => {
    const fail = (error) => {
      if (writeLocalStorage()) {
        resolve({ indexedDB: false, localStorage: true });
      } else {
        reject(new Error(`seed failed: ${error}`));
      }
    };
    try {
      if (typeof indexedDB === 'undefined') {
        if (writeLocalStorage()) resolve({ indexedDB: false, localStorage: true });
        else reject(new Error('seed failed: no indexedDB and no localStorage'));
        return;
      }
      // DB_VERSION is 1 in src/services/indexedDbStorage.ts; omitting the
      // version argument opens whatever already exists, which also keeps the
      // call compatible if the app bumps its DB version.
      const request = indexedDB.open(DB_NAME);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      request.onerror = () => fail(`indexedDB open error: ${request.error?.message ?? 'unknown'}`);
      request.onblocked = () => fail('indexedDB open blocked');
      request.onsuccess = () => {
        const db = request.result;
        try {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          tx.objectStore(STORE_NAME).put(serialized, LEGACY_KEY);
          tx.oncomplete = () => {
            db.close();
            resolve({ indexedDB: true, localStorage: false });
          };
          tx.onerror = () => fail(`indexedDB transaction error: ${tx.error?.message ?? 'unknown'}`);
          tx.onabort = () => fail('indexedDB transaction aborted');
        } catch (error) {
          db.close();
          fail(error instanceof Error ? error.message : String(error));
        }
      };
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
  });
}
