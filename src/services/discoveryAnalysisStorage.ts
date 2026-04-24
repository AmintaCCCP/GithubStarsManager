export interface DiscoveryAnalysisData {
  ai_summary?: string;
  ai_tags?: string[];
  ai_platforms?: string[];
  analyzed_at?: string;
  analysis_failed?: boolean;
}

const DB_NAME = 'github-stars-discovery-analysis';
const STORE_NAME = 'analysis';
const DB_VERSION = 1;

const canUseIndexedDB = (): boolean =>
  typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';

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

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs = 3000,
  onLate?: (value: T) => void
): Promise<T> => {
  let isSettled = false;

  const wrappedPromise = promise
    .then((value) => {
      if (isSettled && onLate) {
        onLate(value);
      }
      return value;
    })
    .catch((error) => {
      if (isSettled && onLate) {
        console.warn('[discoveryAnalysisStorage] Late error after timeout:', error);
      }
      throw error;
    });

  const timeoutPromise = new Promise<T>((_, reject) =>
    setTimeout(() => {
      isSettled = true;
      reject(new Error('DiscoveryAnalysisStorage timeout'));
    }, timeoutMs)
  );

  return await Promise.race([wrappedPromise, timeoutPromise]);
};

export const discoveryAnalysisStorage = {
  async saveAnalysis(repoId: number, data: DiscoveryAnalysisData): Promise<void> {
    if (!canUseIndexedDB()) return;
    try {
      const db = await withTimeout(openDb(), 3000, (lateDb) => lateDb.close());
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(JSON.stringify(data), repoId);

        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      });
    } catch (e) {
      console.warn('[discoveryAnalysisStorage] saveAnalysis failed:', e);
    }
  },

  async loadAnalysis(repoId: number): Promise<DiscoveryAnalysisData | null> {
    if (!canUseIndexedDB()) return null;
    try {
      const db = await withTimeout(openDb(), 3000, (lateDb) => lateDb.close());
      return await new Promise<DiscoveryAnalysisData | null>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(repoId);

        req.onsuccess = () => {
          const raw = req.result as string | undefined;
          if (!raw) {
            resolve(null);
            return;
          }
          try {
            resolve(JSON.parse(raw) as DiscoveryAnalysisData);
          } catch {
            resolve(null);
          }
        };
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      });
    } catch (e) {
      console.warn('[discoveryAnalysisStorage] loadAnalysis failed:', e);
      return null;
    }
  },

  async loadAllAnalyses(): Promise<Map<number, DiscoveryAnalysisData>> {
    const result = new Map<number, DiscoveryAnalysisData>();
    if (!canUseIndexedDB()) return result;

    try {
      const db = await withTimeout(openDb(), 3000, (lateDb) => lateDb.close());
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).openCursor();

        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) {
            resolve();
            return;
          }
          const key = cursor.key as number;
          const raw = cursor.value as string;
          try {
            result.set(key, JSON.parse(raw) as DiscoveryAnalysisData);
          } catch {
            // skip corrupted entries
          }
          cursor.continue();
        };
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      });
    } catch (e) {
      console.warn('[discoveryAnalysisStorage] loadAllAnalyses failed:', e);
    }

    return result;
  },

  async deleteAnalysis(repoId: number): Promise<void> {
    if (!canUseIndexedDB()) return;
    try {
      const db = await withTimeout(openDb(), 3000, (lateDb) => lateDb.close());
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(repoId);

        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      });
    } catch (e) {
      console.warn('[discoveryAnalysisStorage] deleteAnalysis failed:', e);
    }
  },
};
