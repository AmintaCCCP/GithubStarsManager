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

  it('is a silent no-op when IndexedDB is unavailable', async () => {
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: undefined });
    const { repositoryChatCache } = await import('./repositoryChatCache');

    await expect(repositoryChatCache.getTree('owner/repo', 'sha-a')).resolves.toBeNull();
    await expect(repositoryChatCache.putTree('owner/repo', 'sha-a', tree)).resolves.toBeUndefined();
  });
});
