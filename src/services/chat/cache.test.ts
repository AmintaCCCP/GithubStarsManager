import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitHubApiService, RepositoryFileRead, RepositoryTreeRead } from '../githubApi';

const tree: RepositoryTreeRead = {
  ref: 'sha-a',
  sha: 'sha-a',
  truncated: false,
  entries: [{ path: 'README.md', type: 'blob' }],
};

const file: RepositoryFileRead = {
  path: 'README.md',
  ref: 'sha-a',
  sha: 'file-sha',
  size: 9,
  content: '# Read me',
};

describe('cached repository reads', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: new IDBFactory() });
  });

  afterEach(() => {
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: undefined });
  });

  it('reads a pinned tree and file from GitHub once, then serves later turns from IndexedDB', async () => {
    const { readRepositoryFileWithCache, readRepositoryTreeWithCache } = await import('./cache');
    const github = {
      getRepositoryTree: vi.fn().mockResolvedValue(tree),
      getRepositoryMarkdownEvidenceFile: vi.fn().mockResolvedValue(file),
      getRepositoryFile: vi.fn(),
    } as unknown as GitHubApiService;

    await expect(readRepositoryTreeWithCache(github, 'owner/repo', 'owner', 'repo', 'sha-a')).resolves.toEqual(tree);
    await expect(readRepositoryTreeWithCache(github, 'owner/repo', 'owner', 'repo', 'sha-a')).resolves.toEqual(tree);
    await expect(readRepositoryFileWithCache(github, 'owner/repo', 'owner', 'repo', 'README.md', 'sha-a')).resolves.toEqual(file);
    await expect(readRepositoryFileWithCache(github, 'owner/repo', 'owner', 'repo', 'README.md', 'sha-a')).resolves.toEqual(file);

    expect(github.getRepositoryTree).toHaveBeenCalledTimes(1);
    expect(github.getRepositoryMarkdownEvidenceFile).toHaveBeenCalledTimes(1);
    expect(github.getRepositoryFile).not.toHaveBeenCalled();
  });
});
