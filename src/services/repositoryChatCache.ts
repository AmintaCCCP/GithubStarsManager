import type { RepositoryFileRead, RepositoryTreeRead } from './githubApi';

const DB_NAME = 'gsm-repository-chat-cache-db';
const DB_VERSION = 2;
const TREE_STORE = 'trees';
const BLOB_STORE = 'blobs';
const META_STORE = 'metadata';
export const REPOSITORY_CHAT_CACHE_MAX_BYTES = 50 * 1024 * 1024;

type CacheRecord<T> = {
  key: string;
  repoFullName: string;
  sha: string;
  accessedAt: number;
  size: number;
  value: T;
};

type BlobCacheRecord = CacheRecord<RepositoryFileRead> & { path: string };
type SizedCacheRecord = { key: string; accessedAt: number; size: number };
type CacheStoreName = typeof TREE_STORE | typeof BLOB_STORE;
type CacheMetadata = SizedCacheRecord & { dataKey: string; store: CacheStoreName };

const treeKey = (repoFullName: string, sha: string): string => `${repoFullName}@${sha}:tree`;
const blobKey = (repoFullName: string, sha: string, path: string): string => `${repoFullName}@${sha}:${path}`;
const encodedSize = (value: string): number => new TextEncoder().encode(value).byteLength;

let dbPromise: Promise<IDBDatabase> | null = null;

const canUseIndexedDb = (): boolean => typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';

const recordSize = (record: Omit<CacheRecord<unknown>, 'size'> & { size?: number }): number => encodedSize(JSON.stringify({ ...record, size: 0 }));

const openDb = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TREE_STORE)) {
        db.createObjectStore(TREE_STORE, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(BLOB_STORE)) {
        db.createObjectStore(BLOB_STORE, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        const metadata = db.createObjectStore(META_STORE, { keyPath: 'key' });
        const transaction = request.transaction;
        if (event.oldVersion > 0 && transaction) {
          for (const storeName of [TREE_STORE, BLOB_STORE] as const) {
            const cursorRequest = transaction.objectStore(storeName).openCursor();
            cursorRequest.onsuccess = () => {
              const cursor = cursorRequest.result;
              if (!cursor) return;
              const record = cursor.value as CacheRecord<unknown>;
              metadata.put({
                key: `${storeName}:${record.key}`,
                dataKey: record.key,
                store: storeName,
                size: recordSize(record),
                accessedAt: record.accessedAt,
              });
              cursor.continue();
            };
          }
        }
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error('Unable to open repository chat cache'));
    };
  });
  return dbPromise;
};

const requestValue = <T>(request: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error('Repository chat cache request failed'));
});

const runStores = async <T>(
  storeNames: Array<CacheStoreName | typeof META_STORE>,
  mode: IDBTransactionMode,
  operation: (stores: IDBObjectStore[]) => Promise<T>,
): Promise<T> => {
  const db = await openDb();
  const transaction = db.transaction(storeNames, mode);
  const value = await operation(storeNames.map((storeName) => transaction.objectStore(storeName)));
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Repository chat cache transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Repository chat cache transaction aborted'));
  });
  return value;
};

const runStore = async <T>(
  storeName: CacheStoreName | typeof META_STORE,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => Promise<T>,
): Promise<T> => await runStores([storeName], mode, async ([store]) => await operation(store));

/** Oldest records are removed first; oversized records evict themselves. */
export const selectCacheEvictions = (records: SizedCacheRecord[], maxBytes: number): string[] => {
  let total = records.reduce((sum, record) => sum + Math.max(0, record.size), 0);
  if (total <= maxBytes) return [];
  const evicted: string[] = [];
  for (const record of [...records].sort((left, right) => left.accessedAt - right.accessedAt)) {
    if (total <= maxBytes) break;
    evicted.push(record.key);
    total -= Math.max(0, record.size);
  }
  return evicted;
};

export const enforceCacheLimit = async (maxBytes = REPOSITORY_CHAT_CACHE_MAX_BYTES): Promise<void> => {
  const records = await runStore(META_STORE, 'readonly', async (store) => await requestValue(store.getAll()) as CacheMetadata[]);
  const evictedKeys = new Set(selectCacheEvictions(records, maxBytes));
  const evicted = records.filter((record) => evictedKeys.has(record.key));
  if (evicted.length > 0) {
    await runStores([TREE_STORE, BLOB_STORE, META_STORE], 'readwrite', async (stores) => {
      const [trees, blobs, metadata] = stores;
      await Promise.all(evicted.flatMap((record) => {
        const store = record.store === TREE_STORE ? trees : blobs;
        return [requestValue(store.delete(record.dataKey)), requestValue(metadata.delete(record.key))];
      }));
    });
  }
};

const putRecord = async (
  storeName: CacheStoreName,
  record: Omit<CacheRecord<unknown>, 'size'>,
): Promise<void> => {
  const size = recordSize(record);
  await runStores([storeName, META_STORE], 'readwrite', async ([store, metadata]) => {
    await requestValue(store.put({ ...record, size }));
    await requestValue(metadata.put({
      key: `${storeName}:${record.key}`,
      dataKey: record.key,
      store: storeName,
      size,
      accessedAt: record.accessedAt,
    }));
  });
  await enforceCacheLimit();
};

const getRecord = async <T>(
  storeName: CacheStoreName,
  key: string,
): Promise<CacheRecord<T> | null> => {
  const record = await runStores([storeName, META_STORE], 'readwrite', async ([store, metadata]) => {
    const found = await requestValue(store.get(key)) as CacheRecord<T> | undefined;
    if (!found) return null;
    const accessedAt = Date.now();
    const size = recordSize(found);
    const accessed = { ...found, accessedAt, size };
    await requestValue(store.put(accessed));
    await requestValue(metadata.put({
      key: `${storeName}:${key}`,
      dataKey: key,
      store: storeName,
      size,
      accessedAt,
    }));
    return accessed;
  });
  return record;
};

const withCache = async <T>(operation: () => Promise<T>, fallback: T): Promise<T> => {
  if (!canUseIndexedDb()) return fallback;
  try {
    return await operation();
  } catch (error) {
    console.warn('[repository-chat] cache operation skipped', error);
    return fallback;
  }
};

export const repositoryChatCache = {
  async getTree(repoFullName: string, sha: string): Promise<RepositoryTreeRead | null> {
    return await withCache(async () => (await getRecord<RepositoryTreeRead>(TREE_STORE, treeKey(repoFullName, sha)))?.value ?? null, null);
  },

  async putTree(repoFullName: string, sha: string, value: RepositoryTreeRead): Promise<void> {
    await withCache(async () => {
      await putRecord(TREE_STORE, {
        key: treeKey(repoFullName, sha),
        repoFullName,
        sha,
        accessedAt: Date.now(),
        value,
      });
    }, undefined);
  },

  async getFile(repoFullName: string, sha: string, path: string): Promise<RepositoryFileRead | null> {
    return await withCache(async () => (await getRecord<RepositoryFileRead>(BLOB_STORE, blobKey(repoFullName, sha, path)))?.value ?? null, null);
  },

  async putFile(repoFullName: string, sha: string, value: RepositoryFileRead): Promise<void> {
    await withCache(async () => {
      const record: Omit<BlobCacheRecord, 'size'> = {
        key: blobKey(repoFullName, sha, value.path),
        repoFullName,
        sha,
        path: value.path,
        accessedAt: Date.now(),
        value,
      };
      await putRecord(BLOB_STORE, record);
    }, undefined);
  },

  async clear(): Promise<void> {
    await withCache(async () => {
      await runStores([TREE_STORE, BLOB_STORE, META_STORE], 'readwrite', async (stores) => {
        await Promise.all(stores.map((store) => requestValue(store.clear())));
      });
    }, undefined);
  },
};
