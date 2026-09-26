import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from '../types';
import { mergeRepositoriesPreservingLocalMetadata, stripLocalRepositoryFields } from '../utils/repositoryMerge';
import { hasActiveSearchFilters } from '../utils/repoSearch';
import { forceSyncToBackend, repositoryPayloadHash, resetSyncHashes, startAutoSync, stopAutoSync, syncFromBackend, syncToBackend } from './autoSync';
import { backend } from './backendAdapter';
import { useAppStore } from '../store/useAppStore';

vi.mock('./backendAdapter', () => ({
  backend: {
    isAvailable: true,
    fetchRepositories: vi.fn(),
    fetchReleases: vi.fn(),
    fetchAIConfigs: vi.fn(),
    fetchWebDAVConfigs: vi.fn(),
    fetchEmbeddingConfigs: vi.fn(),
    fetchVectorSearchConfig: vi.fn(),
    fetchSettings: vi.fn(),
    syncRepositories: vi.fn().mockResolvedValue(undefined),
    syncReleases: vi.fn().mockResolvedValue(undefined),
    syncAIConfigs: vi.fn().mockResolvedValue(undefined),
    syncWebDAVConfigs: vi.fn().mockResolvedValue(undefined),
    syncEmbeddingConfigs: vi.fn().mockResolvedValue(undefined),
    syncVectorSearchConfig: vi.fn().mockResolvedValue(undefined),
    syncSettings: vi.fn().mockResolvedValue(undefined),
  },
}));

// src/test/setup.ts replaces the store with a hook-level mock for component
// tests. syncFromBackend drives the real store directly (setRepositories,
// getState), so restore the actual module for this file.
vi.mock('../store/useAppStore', async () => await vi.importActual('../store/useAppStore'));

// Regression for Issue #304: the repos hash committed after a pull must be the
// RAW backend hash. Committing quickHash(merged) instead made the next poll's
// backend hash differ forever (the merge injects client-only metadata such as
// analysis_error / has_fetched_releases that the backend never stores), so
// setRepositories — which used to reset searchResults — fired on every 5s poll
// cycle and unmounted the card whose edit modal was open.
//
// The same loop-breaker applies to the push side: syncToBackend commits the
// hash through stripLocalRepositoryFields, the identical projection the pull
// side uses (repositoryPayloadHash delegates to it), so a successful push and
// the next pull always agree.

const createRepository = (id: number, overrides: Partial<Repository> = {}): Repository => ({
  id,
  name: `repo-${id}`,
  full_name: `owner/repo-${id}`,
  description: 'A test repository',
  html_url: `https://github.com/owner/repo-${id}`,
  stargazers_count: 10,
  forks_count: 1,
  forks: 1,
  language: 'TypeScript',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
  pushed_at: '2026-01-03T00:00:00.000Z',
  owner: {
    login: 'owner',
    avatar_url: 'https://github.com/avatar.png',
  },
  topics: ['test'],
  ...overrides,
});

describe('backend sync hash convergence (Issue #304 loop-breaker)', () => {
  it('merge output differs from the backend payload when local metadata exists', () => {
    const backendRepos = [createRepository(1)];
    const localRepos = [createRepository(1, { vector_indexed_at: '2026-08-01T00:00:00.000Z' })];

    const merged = mergeRepositoriesPreservingLocalMetadata(backendRepos, localRepos);

    // This inequality is exactly why hashing the merged result never converged.
    expect(JSON.stringify(merged)).not.toBe(JSON.stringify(backendRepos));
    // The local-only field survives the merge.
    expect(merged[0].vector_indexed_at).toBe('2026-08-01T00:00:00.000Z');
  });

  it('two consecutive pulls of an unchanged backend hash identically', () => {
    // Mirrors the poll loop: pull → commit hashes.repos → next pull compares
    // against that value. With the raw backend hash committed, the second pull
    // sees no change and skips setRepositories.
    const backendPayload = [createRepository(1, { ai_summary: 'from backend' })];
    const localRepos = [createRepository(1, { ai_summary: 'from backend', ai_tags: ['ai-tag'] })];

    const firstPullHash = JSON.stringify(backendPayload);
    const merged = mergeRepositoriesPreservingLocalMetadata(backendPayload, localRepos);

    // The fix commits the raw backend hash (firstPullHash), not quickHash(merged).
    expect(firstPullHash).not.toBe(JSON.stringify(merged));
    // Second poll re-hashes the same backend payload → equals the committed hash.
    expect(JSON.stringify(backendPayload)).toBe(firstPullHash);
  });

  it('merged output is stable across repeated merges of the same inputs', () => {
    const backendRepos = [createRepository(1)];
    const localRepos = [createRepository(1, { subscribed_to_releases: true })];

    const firstMerge = mergeRepositoriesPreservingLocalMetadata(backendRepos, localRepos);
    const secondMerge = mergeRepositoriesPreservingLocalMetadata(backendRepos, localRepos);

    expect(JSON.stringify(secondMerge)).toBe(JSON.stringify(firstMerge));
  });

it('omits client-only fields from both pull and successful-push hashes', () => {
    const backendPayload = [createRepository(1)];
    const localRepositories = [createRepository(1, {
      analysis_error: 'temporary failure detail',
      has_fetched_releases: true,
      last_release_fetch_time: '2026-08-01T00:00:00.000Z',
    })];

    expect(repositoryPayloadHash(localRepositories)).toBe(repositoryPayloadHash(backendPayload));
  });

  it('stripLocalRepositoryFields removes every client-only field (CodeRabbit push-hash fix)', () => {
    const repo = createRepository(1, {
      analysis_error: 'model unavailable',
      has_fetched_releases: true,
      last_release_fetch_time: '2026-08-01T00:00:00.000Z',
      vector_indexed_at: '2026-08-01T00:00:00.000Z',
      ai_summary: 'summary',
    });

    const stripped = stripLocalRepositoryFields([repo]);

    // All client-only fields are gone
    expect(stripped[0].analysis_error).toBeUndefined();
    expect(stripped[0].has_fetched_releases).toBeUndefined();
    expect(stripped[0].last_release_fetch_time).toBeUndefined();
    expect(stripped[0].forks_count).toBeUndefined();
    expect(stripped[0].forks).toBeUndefined();
    // Backend-owned fields survive
    expect(stripped[0].id).toBe(1);
    expect(stripped[0].name).toBe('repo-1');
    expect(stripped[0].stargazers_count).toBe(10);
  });

  it('stripLocalRepositoryFields hash matches the backend pull payload hash (CodeRabbit convergence)', () => {
    // Model what the server actually returns: no forks_count/forks (not stored),
    // no analysis_error / has_fetched_releases (client-only), but vector_indexed_at
    // IS round-tripped (stored + returned by GET /api/repositories).
    const backendPayload = [createRepository(1, {
      forks_count: undefined,
      forks: undefined,
      vector_indexed_at: '2026-08-01T00:00:00.000Z',
    })];
    const localRepos = [createRepository(1, {
      analysis_error: 'model unavailable',
      has_fetched_releases: true,
      vector_indexed_at: '2026-08-01T00:00:00.000Z',
    })];

    // After push, we hash stripLocalRepositoryFields(state.repositories) — the
    // state has client-only fields injected by the merge. After pull, we hash
    // the raw backend payload. These must be equal so the next poll skips the
    // merge.
    const pushHash = JSON.stringify(stripLocalRepositoryFields(localRepos));
    const pullHash = JSON.stringify(backendPayload);

    expect(pushHash).toBe(pullHash);
  });

  it('push and pull fingerprints share the same projection even with analysis_error (CodeRabbit)', () => {
    // analysis_error is client-only: the backend never stores it. The push side
    // hashes the store (which may carry analysis_error) through
    // stripLocalRepositoryFields; the pull side hashes the backend payload
    // through repositoryPayloadHash (which delegates to the same projection).
    // Both must yield the same hash so a repo with a local analysis_error
    // doesn't re-trigger setRepositories forever.
    const backendPayload = [createRepository(1, { forks_count: undefined, forks: undefined })];
    const localRepos = [createRepository(1, { analysis_error: 'model unavailable' })];

    expect(repositoryPayloadHash(localRepos)).toBe(repositoryPayloadHash(backendPayload));
    expect(JSON.stringify(stripLocalRepositoryFields(localRepos))).toBe(JSON.stringify(backendPayload));
  });
});

describe('syncFromBackend two-pull loop (Issue #304 end-to-end)', () => {
  const backendPayload = [createRepository(1, { ai_summary: 'from backend' })];

  beforeEach(() => {
    vi.mocked(backend.fetchRepositories).mockResolvedValue({ repositories: backendPayload, total: 1 });
    vi.mocked(backend.fetchReleases).mockResolvedValue({ releases: [], total: 0 });
    vi.mocked(backend.fetchAIConfigs).mockResolvedValue([]);
    vi.mocked(backend.fetchWebDAVConfigs).mockResolvedValue([]);
    vi.mocked(backend.fetchEmbeddingConfigs).mockResolvedValue([]);
    vi.mocked(backend.fetchVectorSearchConfig).mockResolvedValue({
      enabled: false,
      workerUrl: '',
      authToken: '',
      embeddingConfigId: '',
      indexMode: 'readme',
      readmeMaxChars: 6000,
    });
    vi.mocked(backend.fetchSettings).mockResolvedValue({});
  });

  it('applies a changed backend payload once; an unchanged second pull is a no-op', async () => {
    // The local repo carries client-only metadata (analysis_error) the backend
    // never stores, so quickHash(merged) — the pre-fix commit value — can never
    // equal the raw backend hash. If the pull side ever reverts to committing
    // quickHash(merged), the second pull below re-applies setRepositories
    // (new repositories reference) and this test fails.
    const localRepo = createRepository(1, { ai_summary: 'from backend', analysis_error: 'stale local error' });
    useAppStore.setState({
      repositories: [localRepo],
      searchResults: [localRepo],
      searchFilters: { ...useAppStore.getState().searchFilters, query: 'repo' },
    });
    const searchResultsBeforePull = useAppStore.getState().searchResults;

    await syncFromBackend(); // pull 1 — payload differs from the initial hash → applied

    const afterFirstPull = useAppStore.getState();
    expect(afterFirstPull.repositories).toHaveLength(1);
    expect(afterFirstPull.repositories[0].ai_summary).toBe('from backend');
    // Local-only metadata survives the merge.
    expect(afterFirstPull.repositories[0].analysis_error).toBe('stale local error');
    // Active search filters: the searchResults reference is preserved so the
    // card being edited stays mounted.
    expect(afterFirstPull.searchResults).toBe(searchResultsBeforePull);

    const repositoriesAfterFirstPull = afterFirstPull.repositories;
    await syncFromBackend(); // pull 2 — identical backend payload

    expect(useAppStore.getState().repositories).toBe(repositoriesAfterFirstPull);
    expect(useAppStore.getState().searchResults).toBe(searchResultsBeforePull);
  });

  it('does not wipe local repositories when the backend returns an empty list', async () => {
    vi.mocked(backend.fetchRepositories).mockResolvedValue({ repositories: [], total: 0 });
    const localRepo = createRepository(1, { ai_summary: 'keep-me' });
    useAppStore.setState({
      repositories: [localRepo],
      searchResults: [localRepo],
    });

    await syncFromBackend();

    expect(useAppStore.getState().repositories).toHaveLength(1);
    expect(useAppStore.getState().repositories[0].ai_summary).toBe('keep-me');
  });

  it('force pull applies backend repositories even when a local debounce is pending', async () => {
    const backendRepos = [createRepository(2, { ai_summary: 'from-backend' })];
    vi.mocked(backend.fetchRepositories).mockResolvedValue({ repositories: backendRepos, total: 1 });
    const localRepo = createRepository(1, { ai_summary: 'local-only' });
    useAppStore.setState({
      repositories: [localRepo],
      searchResults: [localRepo],
    });

    await syncFromBackend({ force: true });

    expect(useAppStore.getState().repositories).toHaveLength(1);
    expect(useAppStore.getState().repositories[0].id).toBe(2);
    expect(useAppStore.getState().repositories[0].ai_summary).toBe('from-backend');
  });

  it('force pull keeps an empty backend list instead of preserving leftover local repos', async () => {
    vi.mocked(backend.fetchRepositories).mockResolvedValue({ repositories: [], total: 0 });
    const localRepo = createRepository(1, { ai_summary: 'local-only' });
    useAppStore.setState({
      repositories: [localRepo],
      searchResults: [localRepo],
    });

    await syncFromBackend({ force: true });

    expect(useAppStore.getState().repositories).toEqual([]);
  });
});

describe('sync defaultCategoryOverrides with backend settings', () => {
  let originalState: ReturnType<typeof useAppStore.getState>;
  let unsubscribe: (() => void) | undefined;

  const stubBackendSlices = () => {
    vi.mocked(backend.fetchRepositories).mockResolvedValue({ repositories: [], total: 0 });
    vi.mocked(backend.fetchReleases).mockResolvedValue({ releases: [], total: 0 });
    vi.mocked(backend.fetchAIConfigs).mockResolvedValue([]);
    vi.mocked(backend.fetchWebDAVConfigs).mockResolvedValue([]);
    vi.mocked(backend.fetchEmbeddingConfigs).mockResolvedValue([]);
    vi.mocked(backend.fetchVectorSearchConfig).mockResolvedValue({
      enabled: false, workerUrl: '', authToken: '', embeddingConfigId: '', indexMode: 'readme', readmeMaxChars: 6000,
    });
  };

  beforeEach(() => {
    originalState = useAppStore.getState();
    stubBackendSlices();
    resetSyncHashes();
    vi.mocked(backend.fetchSettings).mockResolvedValue({});
    vi.mocked(backend.syncSettings).mockClear();
    useAppStore.setState({ defaultCategoryOverrides: {} });
  });

  afterEach(() => {
    if (unsubscribe) {
      stopAutoSync(unsubscribe);
      unsubscribe = undefined;
    }
    useAppStore.setState(originalState);
  });

  it('applies defaultCategoryOverrides from backend settings', async () => {
    const defaultCategoryOverrides = { web: { name: 'Web Apps', keywords: ['web'] } };
    vi.mocked(backend.fetchSettings).mockResolvedValue({ defaultCategoryOverrides });

    await syncFromBackend();

    expect(useAppStore.getState().defaultCategoryOverrides).toEqual(defaultCategoryOverrides);
  });

  it('pushes defaultCategoryOverrides with the rest of settings', async () => {
    const defaultCategoryOverrides = { ai: { name: 'AI Tools', icon: 'sparkles' } };
    useAppStore.setState({ defaultCategoryOverrides });

    await syncToBackend();

    expect(vi.mocked(backend.syncSettings)).toHaveBeenCalledWith(
      expect.objectContaining({ defaultCategoryOverrides }),
    );
  });

  it('queues a backend push when defaultCategoryOverrides change locally', async () => {
    vi.useFakeTimers();
    try {
      unsubscribe = startAutoSync();
      vi.mocked(backend.syncSettings).mockClear();
      useAppStore.setState({ defaultCategoryOverrides: { web: { name: 'Web' } } });
      await vi.advanceTimersByTimeAsync(2000);
      expect(vi.mocked(backend.syncSettings)).toHaveBeenCalledWith(
        expect.objectContaining({ defaultCategoryOverrides: { web: { name: 'Web' } } }),
      );
    } finally {
      if (unsubscribe) {
        stopAutoSync(unsubscribe);
        unsubscribe = undefined;
      }
      vi.useRealTimers();
    }
  });
});

describe('explicit backend push error reporting', () => {
  it('resolves when all backend writes succeed', async () => {
    await expect(forceSyncToBackend()).resolves.toBeUndefined();
    expect(backend.syncRepositories).toHaveBeenCalled();
  });

  it('reports settled slice failures without rejecting automatic pushes', async () => {
    vi.mocked(backend.syncRepositories).mockRejectedValueOnce(new Error('offline'));
    await expect(syncToBackend()).resolves.toBe(false);
    vi.mocked(backend.syncRepositories).mockRejectedValueOnce(new Error('offline'));
    await expect(forceSyncToBackend()).resolves.toBeUndefined();
    vi.mocked(backend.syncRepositories).mockRejectedValueOnce(new Error('offline'));
    await expect(forceSyncToBackend({ reportFailures: true })).rejects.toThrow('Failed to sync to backend');
    // Failure must release the push lock, allowing a subsequent successful retry.
    await expect(forceSyncToBackend()).resolves.toBeUndefined();
  });

  it('reports synchronous adapter exceptions from the outer catch', async () => {
    vi.mocked(backend.syncRepositories).mockImplementationOnce(() => { throw new Error('adapter failed'); });
    await expect(forceSyncToBackend({ reportFailures: true })).rejects.toThrow('Failed to sync to backend');
    await expect(forceSyncToBackend()).resolves.toBeUndefined();
  });

  it('keeps standalone mode a no-op when no backend is configured', async () => {
    const available = vi.spyOn(backend, 'isAvailable', 'get').mockReturnValue(false);
    try {
      await expect(forceSyncToBackend()).resolves.toBeUndefined();
    } finally {
      available.mockRestore();
    }
  });
});

describe('hasActiveSearchFilters (Issue #304 searchResults guard)', () => {
  const baseFilters = (): import('../types').SearchFilters => ({
    query: '',
    languages: [],
    tags: [],
    platforms: [],
    licenses: [],
    sortBy: 'stars',
    sortOrder: 'desc',
  });

  it('treats a non-empty query as active', () => {
    expect(hasActiveSearchFilters({ ...baseFilters(), query: 'react' })).toBe(true);
  });

  it('treats default sort as inactive and a changed sort as active', () => {
    expect(hasActiveSearchFilters(baseFilters())).toBe(false);
    expect(hasActiveSearchFilters({ ...baseFilters(), sortBy: 'updated' })).toBe(true);
  });

  it('treats facet selections as active', () => {
    expect(hasActiveSearchFilters({ ...baseFilters(), languages: ['TypeScript'] })).toBe(true);
    expect(hasActiveSearchFilters({ ...baseFilters(), licenses: ['MIT'] })).toBe(true);
  });

  it('treats a license-only selection as active (CodeRabbit)', () => {
    expect(hasActiveSearchFilters({ ...baseFilters(), licenses: ['MIT'] })).toBe(true);
  });
});


describe('backend pushes requested during another sync', () => {
  let originalState: ReturnType<typeof useAppStore.getState>;
  let unsubscribe: () => void;
  const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
  };

  beforeEach(() => {
    originalState = useAppStore.getState();
    vi.mocked(backend.syncRepositories).mockReset().mockResolvedValue(undefined);
    vi.mocked(backend.fetchRepositories).mockResolvedValue({ repositories: [], total: 0 });
    vi.mocked(backend.fetchReleases).mockResolvedValue({ releases: [], total: 0 });
    vi.mocked(backend.fetchAIConfigs).mockResolvedValue([]);
    vi.mocked(backend.fetchWebDAVConfigs).mockResolvedValue([]);
    vi.mocked(backend.fetchEmbeddingConfigs).mockResolvedValue([]);
    vi.mocked(backend.fetchSettings).mockResolvedValue({});
    resetSyncHashes();
    useAppStore.setState({ repositories: [createRepository(1)] });
    unsubscribe = startAutoSync();
  });

  afterEach(() => {
    stopAutoSync(unsubscribe);
    useAppStore.setState(originalState);
  });

  it('waits for the push queued behind a pull and reports its failure', async () => {
    const fetch = deferred<{ repositories: Repository[]; total: number }>();
    vi.mocked(backend.fetchRepositories).mockReturnValueOnce(fetch.promise);
    const pull = syncFromBackend();
    useAppStore.getState().addRepository(createRepository(2));
    vi.mocked(backend.syncRepositories).mockRejectedValue(new Error('offline'));
    let settled = false;
    const forced = forceSyncToBackend({ reportFailures: true });
    const outcome = forced.then(() => { settled = true; return ''; }, error => {
      settled = true;
      return (error as Error).message;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    fetch.resolve({ repositories: [createRepository(1)], total: 1 });
    await pull;
    expect(await outcome).toBe('Failed to sync to backend');
    expect(useAppStore.getState().repositories.map(repo => repo.full_name)).toContain('owner/repo-2');
    expect(backend.syncRepositories).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ full_name: 'owner/repo-2' })]));
    vi.mocked(backend.syncRepositories).mockResolvedValue(undefined);
    await expect(forceSyncToBackend()).resolves.toBeUndefined();
  });

  it.each([false, true])('awaits the latest snapshot after an active push (failure: %s)', async fail => {
    const first = deferred<void>();
    const followUp = deferred<void>();
    vi.mocked(backend.syncRepositories).mockReturnValueOnce(first.promise).mockImplementationOnce(() =>
      followUp.promise.then(() => { if (fail) throw new Error('offline'); }),
    );
    const initialPush = syncToBackend();
    useAppStore.getState().addRepository(createRepository(2));
    let settled = false;
    const outcome = forceSyncToBackend({ reportFailures: true }).then(() => { settled = true; return ''; }, error => {
      settled = true;
      return (error as Error).message;
    });
    first.resolve();
    await vi.waitFor(() => expect(backend.syncRepositories).toHaveBeenCalledTimes(2));
    expect(settled).toBe(false);
    expect(vi.mocked(backend.syncRepositories).mock.calls[1][0]).toEqual(expect.arrayContaining([expect.objectContaining({ full_name: 'owner/repo-2' })]));
    followUp.resolve();
    expect(await outcome).toBe(fail ? 'Failed to sync to backend' : '');
    await initialPush;
    if (fail) {
      await syncFromBackend();
      expect(useAppStore.getState().repositories.map(repo => repo.full_name)).toContain('owner/repo-2');
      await expect(forceSyncToBackend()).resolves.toBeUndefined();
    }
  });

  it('automatically pushes edits made after the active snapshot', async () => {
    const first = deferred<void>();
    vi.mocked(backend.syncRepositories).mockReturnValueOnce(first.promise);
    const push = syncToBackend();
    useAppStore.getState().addRepository(createRepository(2));
    first.resolve();
    await push;
    expect(backend.syncRepositories).toHaveBeenCalledTimes(2);
    expect(vi.mocked(backend.syncRepositories).mock.calls[1][0]).toEqual(expect.arrayContaining([expect.objectContaining({ full_name: 'owner/repo-2' })]));
  });

  it('keeps remotely arrived repositories when local edits queue a push after the pull', async () => {
    const fetch = deferred<{ repositories: Repository[]; total: number }>();
    vi.mocked(backend.fetchRepositories).mockReturnValueOnce(fetch.promise);
    const pull = syncFromBackend();
    useAppStore.getState().addRepository(createRepository(2));
    fetch.resolve({ repositories: [createRepository(1), createRepository(3)], total: 2 });
    await pull;

    const fullNames = useAppStore.getState().repositories.map(repo => repo.full_name);
    expect(fullNames).toContain('owner/repo-2');
    expect(fullNames).toContain('owner/repo-3');

    await syncToBackend();
    const pushedCalls = vi.mocked(backend.syncRepositories).mock.calls;
    const pushed = pushedCalls[pushedCalls.length - 1][0];
    const pushedNames = pushed.map(repo => repo.full_name);
    expect(pushedNames).toContain('owner/repo-2');
    expect(pushedNames).toContain('owner/repo-3');
  });

  it('does not resurrect repositories deleted locally during the pull', async () => {
    const fetch = deferred<{ repositories: Repository[]; total: number }>();
    vi.mocked(backend.fetchRepositories).mockReturnValueOnce(fetch.promise);
    const pull = syncFromBackend();
    useAppStore.getState().deleteRepository(createRepository(1).id);
    fetch.resolve({ repositories: [createRepository(1), createRepository(3)], total: 2 });
    await pull;

    const fullNames = useAppStore.getState().repositories.map(repo => repo.full_name);
    expect(fullNames).not.toContain('owner/repo-1');
    expect(fullNames).toContain('owner/repo-3');
  });

  it('does not queue a push when the repositories fetch fails during local edits', async () => {
    vi.mocked(backend.fetchRepositories).mockRejectedValueOnce(new Error('offline'));
    const pull = syncFromBackend();
    useAppStore.getState().addRepository(createRepository(2));
    await pull;

    expect(backend.syncRepositories).not.toHaveBeenCalled();
    expect(useAppStore.getState().repositories.map(repo => repo.full_name)).toContain('owner/repo-2');
  });

  it('treats a successful empty repository list as valid when local edits queue a push', async () => {
    const fetch = deferred<{ repositories: Repository[]; total: number }>();
    vi.mocked(backend.fetchRepositories).mockReturnValueOnce(fetch.promise);
    const pull = syncFromBackend();
    useAppStore.getState().addRepository(createRepository(2));
    fetch.resolve({ repositories: [], total: 0 });
    await pull;

    await vi.waitFor(() => expect(backend.syncRepositories).toHaveBeenCalled());
    const pushedCalls = vi.mocked(backend.syncRepositories).mock.calls;
    const pushed = pushedCalls[pushedCalls.length - 1][0];
    expect(pushed.map(repo => repo.full_name)).toContain('owner/repo-2');
    expect(useAppStore.getState().repositories.map(repo => repo.full_name)).toContain('owner/repo-2');
  });
});
