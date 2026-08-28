import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from '../types';
import { mergeRepositoriesPreservingLocalMetadata, stripLocalRepositoryFields } from '../utils/repositoryMerge';
import { hasActiveSearchFilters } from '../utils/repoSearch';
import { repositoryPayloadHash, syncFromBackend } from './autoSync';
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
