import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepositoryFileRead, RepositoryTreeRead } from './githubApi';

const tree: RepositoryTreeRead = {
  ref: 'sha-a',
  sha: 'sha-a',
  truncated: false,
  entries: [{ path: 'README.md', type: 'blob' }],
};

const file = (path: string, content: string): RepositoryFileRead => ({
  path,
  ref: 'sha-a',
  sha: `${path}-sha`,
  size: content.length,
  content,
});

describe('repositoryChatCache', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: new IDBFactory() });
  });

  afterEach(() => {
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: undefined });
  });

  it('reuses trees and files only for the same repository and pinned SHA', async () => {
    const { repositoryChatCache } = await import('./repositoryChatCache');
    await repositoryChatCache.putTree('owner/repo', 'sha-a', tree);
    await repositoryChatCache.putFile('owner/repo', 'sha-a', file('README.md', '# Read me'));

    await expect(repositoryChatCache.getTree('owner/repo', 'sha-a')).resolves.toEqual(tree);
    await expect(repositoryChatCache.getTree('owner/repo', 'sha-b')).resolves.toBeNull();
    await expect(repositoryChatCache.getFile('owner/repo', 'sha-a', 'README.md')).resolves.toMatchObject({ content: '# Read me' });
    await expect(repositoryChatCache.getFile('owner/repo', 'sha-b', 'README.md')).resolves.toBeNull();
  });

  it('evicts the least recently accessed records first', async () => {
    const { selectCacheEvictions } = await import('./repositoryChatCache');
    const evicted = selectCacheEvictions([
      { key: 'newest', size: 40, accessedAt: 3 },
      { key: 'oldest', size: 40, accessedAt: 1 },
      { key: 'middle', size: 40, accessedAt: 2 },
    ], 100);

    expect(evicted).toEqual(['oldest']);
  });

  it('persists metadata and keeps the combined cache stores under the eviction limit', async () => {
    const { repositoryChatCache, enforceCacheLimit } = await import('./repositoryChatCache');
    await repositoryChatCache.putFile('owner/repo', 'sha-a', file('docs/large-old.md', 'a'.repeat(2_000)));
    await new Promise((resolve) => setTimeout(resolve, 2));
    await repositoryChatCache.putTree('owner/repo', 'sha-a', {
      ...tree,
      entries: Array.from({ length: 40 }, (_, index) => ({ path: `src/file-${index}.ts`, type: 'blob' as const })),
    });
    await new Promise((resolve) => setTimeout(resolve, 2));
    await repositoryChatCache.putFile('owner/repo', 'sha-a', file('docs/large-new.md', 'b'.repeat(2_000)));

    await enforceCacheLimit(2_500);

    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = window.indexedDB.open('gsm-repository-chat-cache-db');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const records = await new Promise<Array<{ key: string; size: number }>>((resolve, reject) => {
      const request = db.transaction('metadata', 'readonly').objectStore('metadata').getAll();
      request.onsuccess = () => resolve(request.result as Array<{ key: string; size: number }>);
      request.onerror = () => reject(request.error);
    });
    db.close();

    expect(records.reduce((total, record) => total + record.size, 0)).toBeLessThanOrEqual(2_500);
    await expect(repositoryChatCache.getFile('owner/repo', 'sha-a', 'docs/large-new.md')).resolves.toMatchObject({ content: 'b'.repeat(2_000) });
  });

  it('is a silent no-op when IndexedDB is unavailable', async () => {
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: undefined });
    const { repositoryChatCache } = await import('./repositoryChatCache');

    await expect(repositoryChatCache.getTree('owner/repo', 'sha-a')).resolves.toBeNull();
    await expect(repositoryChatCache.putTree('owner/repo', 'sha-a', tree)).resolves.toBeUndefined();
  });
});
