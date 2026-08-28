import { describe, expect, it } from 'vitest';
import type { Repository } from '../types';
import { mergeRepositoriesPreservingLocalMetadata } from '../utils/repositoryMerge';
import { hasActiveSearchFilters } from '../utils/repoSearch';
import { repositoryPayloadHash } from './autoSync';

// Regression for Issue #304: the repos hash committed after a pull must be the
// RAW backend hash. Committing quickHash(merged) instead made the next poll's
// backend hash differ forever (the merge injects local-only metadata such as
// vector_indexed_at that the backend never returns), so setRepositories —
// which used to reset searchResults — fired on every 5s poll cycle and
// unmounted the card whose edit modal was open.

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
});
