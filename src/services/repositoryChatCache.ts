import type { RepositoryFileRead, RepositoryTreeRead } from './githubApi';

const DB_NAME = 'gsm-repository-chat-cache-db';
const DB_VERSION = 1;
const TREE_STORE = 'trees';
const BLOB_STORE = 'blobs';
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

const treeKey = (repoFullName: string, sha: string): string => `${repoFullName}@${sha}:tree`;
const blobKey = (repoFullName: string, sha: string, path: string): string => `${repoFullName}@${sha}:${path}`;
const encodedSize = (value: string): number => new TextEncoder().encode(value).byteLength;

let dbPromise: Promise<IDBDatabase> | null = null;

const canUseIndexedDb = (): boolean => typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';

const openDb = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TREE_STORE)) {
        db.createObjectStore(TREE_STORE, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(BLOB_STORE)) {
        db.createObjectStore(BLOB_STORE, { keyPath: 'key' });
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

const runStore = async <T>(
  storeName: typeof TREE_STORE | typeof BLOB_STORE,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => Promise<T>,
): Promise<T> => {
  const db = await openDb();
  const transaction = db.transaction(storeName, mode);
  const value = await operation(transaction.objectStore(storeName));
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Repository chat cache transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Repository chat cache transaction aborted'));
  });
  return value;
};

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

const enforceLimit = async (): Promise<void> => {
  const records = [
    ...await runStore(TREE_STORE, 'readonly', async (store) => await requestValue(store.getAll()) as SizedCacheRecord[]),
    ...await runStore(BLOB_STORE, 'readonly', async (store) => await requestValue(store.getAll()) as SizedCacheRecord[]),
  ];
  const evicted = selectCacheEvictions(records, REPOSITORY_CHAT_CACHE_MAX_BYTES);
  if (evicted.length > 0) {
    for (const storeName of [TREE_STORE, BLOB_STORE] as const) {
      await runStore(storeName, 'readwrite', async (store) => {
        await Promise.all(evicted.map((key) => requestValue(store.delete(key))));
      });
    }
  }
};

const putRecord = async (
  storeName: typeof TREE_STORE | typeof BLOB_STORE,
  record: CacheRecord<unknown>,
): Promise<void> => {
  await runStore(storeName, 'readwrite', async (store) => {
    await requestValue(store.put(record));
  });
  await enforceLimit();
};

const getRecord = async <T>(
  storeName: typeof TREE_STORE | typeof BLOB_STORE,
  key: string,
): Promise<CacheRecord<T> | null> => {
  const record = await runStore(storeName, 'readwrite', async (store) => {
    const found = await requestValue(store.get(key)) as CacheRecord<T> | undefined;
    if (!found) return null;
    const accessed = { ...found, accessedAt: Date.now() };
    await requestValue(store.put(accessed));
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
        size: encodedSize(JSON.stringify(value)),
        value,
      });
    }, undefined);
  },

  async getFile(repoFullName: string, sha: string, path: string): Promise<RepositoryFileRead | null> {
    return await withCache(async () => (await getRecord<RepositoryFileRead>(BLOB_STORE, blobKey(repoFullName, sha, path)))?.value ?? null, null);
  },

  async putFile(repoFullName: string, sha: string, value: RepositoryFileRead): Promise<void> {
    await withCache(async () => {
      const record: BlobCacheRecord = {
        key: blobKey(repoFullName, sha, value.path),
        repoFullName,
        sha,
        path: value.path,
        accessedAt: Date.now(),
        size: encodedSize(value.content) + encodedSize(value.path),
        value,
      };
      await putRecord(BLOB_STORE, record);
    }, undefined);
  },

  async clear(): Promise<void> {
    await withCache(async () => {
      for (const storeName of [TREE_STORE, BLOB_STORE] as const) {
        await runStore(storeName, 'readwrite', async (store) => {
          await requestValue(store.clear());
        });
      }
    }, undefined);
  },
};
