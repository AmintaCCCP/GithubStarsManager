import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const PROFILE_ID = 'p_222';

const rawOpen = (name: string, onUpgrade?: (db: IDBDatabase) => void): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = window.indexedDB.open(name, 1);
    request.onupgradeneeded = () => onUpgrade?.(request.result);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });

/** Row count, or null when the store does not exist (i.e. the DB was never created by the storage layer). */
const storeCount = async (dbName: string, storeName: string): Promise<number | null> => {
  const db = await rawOpen(dbName);
  try {
    if (!db.objectStoreNames.contains(storeName)) return null;
    return await new Promise<number>((resolve, reject) => {
      const request = db.transaction(storeName, 'readonly').objectStore(storeName).count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
};

describe('channel IndexedDB profile isolation', () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
    window.localStorage.setItem('gsm:active-profile', PROFILE_ID);
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: new IDBFactory() });
  });

  afterEach(() => {
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: undefined });
    window.localStorage.clear();
  });

  it('writes channel caches only to the current profile database', async () => {
    const { weeklyIssuesStorage } = await import('./weeklyIssuesStorage');
    const { xTweetStorage } = await import('./xTweetStorage');
    const { telegramStorage } = await import('./telegramStorage');

    await weeklyIssuesStorage.saveIssues([
      { number: 1, title: 't', body: null, labels: [], state: 'open', createdAt: '', updatedAt: '', htmlUrl: '', repoFullNames: [] },
    ]);
    await xTweetStorage.saveTweets([
      { tweetId: '1', handle: 'a', displayName: 'A', content: '', htmlUrl: '', createdAt: '', repoFullNames: [] },
    ]);
    await telegramStorage.saveMessages([
      { messageId: 'c/1', channel: 'c', displayName: 'C', content: '', htmlUrl: '', createdAt: '', repoFullNames: [] },
    ]);

    expect(await storeCount(`github-stars-weekly__${PROFILE_ID}`, 'issues')).toBe(1);
    expect(await storeCount(`github-stars-x-tweet__${PROFILE_ID}`, 'tweets')).toBe(1);
    expect(await storeCount(`github-stars-telegram__${PROFILE_ID}`, 'messages')).toBe(1);

    // The unscoped names are what the default profile uses; this profile must not touch them.
    expect(await storeCount('github-stars-weekly', 'issues')).toBeNull();
    expect(await storeCount('github-stars-x-tweet', 'tweets')).toBeNull();
    expect(await storeCount('github-stars-telegram', 'messages')).toBeNull();
  });

  it('deleteProfileIndexedDbs removes the channel databases of that profile only', async () => {
    const { deleteProfileIndexedDbs } = await import('./indexedDbStorage');
    const { weeklyIssuesStorage } = await import('./weeklyIssuesStorage');

    // Default-profile data must survive a profile deletion.
    const defaultDb = await rawOpen('github-stars-weekly', (db) => db.createObjectStore('issues'));
    await new Promise<void>((resolve, reject) => {
      const tx = defaultDb.transaction('issues', 'readwrite');
      tx.objectStore('issues').put({ number: 99 }, 99);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    defaultDb.close();
    await weeklyIssuesStorage.saveIssues([
      { number: 1, title: 't', body: null, labels: [], state: 'open', createdAt: '', updatedAt: '', htmlUrl: '', repoFullNames: [] },
    ]);

    await deleteProfileIndexedDbs(PROFILE_ID);

    expect(await storeCount(`github-stars-weekly__${PROFILE_ID}`, 'issues')).toBeNull();
    expect(await storeCount(`github-stars-x-tweet__${PROFILE_ID}`, 'tweets')).toBeNull();
    expect(await storeCount(`github-stars-telegram__${PROFILE_ID}`, 'messages')).toBeNull();
    expect(await storeCount('github-stars-weekly', 'issues')).toBe(1);
  });
});
