import { describe, expect, it } from 'vitest';
import type { AppState, Repository } from '../types';
import { defaultReleaseSourceSettings } from '../types';
import {
  CUSTOM_RELEASE_SOURCE_ID,
  STARRED_RELEASE_SOURCE_ID,
  WATCH_CUSTOM_RELEASE_SOURCE_ID,
  createCustomReleaseRepository,
  getSourcesForReleaseRepository,
  normalizeGitHubRepoInput,
  resolveReleaseSources,
} from './releaseSources';

const createRepository = (id: number, fullName: string): Repository => {
  const [owner, name] = fullName.split('/');
  return {
    id,
    name,
    full_name: fullName,
    description: null,
    html_url: `https://github.com/${fullName}`,
    stargazers_count: 1,
    forks_count: 0,
    forks: 0,
    language: 'TypeScript',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    pushed_at: '2026-01-01T00:00:00.000Z',
    owner: { login: owner, avatar_url: `https://github.com/${owner}.png` },
    topics: [],
  };
};

const createState = (overrides: Partial<AppState>): Pick<AppState, 'repositories' | 'releaseSubscriptions' | 'releaseSourceSettings'> => ({
  repositories: [],
  releaseSubscriptions: new Set<number>(),
  releaseSourceSettings: defaultReleaseSourceSettings,
  ...overrides,
});

describe('releaseSources utilities', () => {
  it('normalizes GitHub repo inputs', () => {
    expect(normalizeGitHubRepoInput('owner/repo')).toMatchObject({ full_name: 'owner/repo' });
    expect(normalizeGitHubRepoInput('github.com/owner/repo')).toMatchObject({ full_name: 'owner/repo' });
    expect(normalizeGitHubRepoInput('https://github.com/owner/repo/')).toMatchObject({ full_name: 'owner/repo' });
    expect(normalizeGitHubRepoInput('https://example.com/owner/repo')).toBeNull();
    expect(normalizeGitHubRepoInput('owner')).toBeNull();
  });

  it('dedupes the same repository across selected sources', () => {
    const starred = createRepository(1, 'owner/repo');
    const watchRepo = createCustomReleaseRepository('OWNER/repo', WATCH_CUSTOM_RELEASE_SOURCE_ID)!;
    const customRepo = createCustomReleaseRepository('owner/repo', CUSTOM_RELEASE_SOURCE_ID)!;

    const resolved = resolveReleaseSources(createState({
      repositories: [starred],
      releaseSubscriptions: new Set([1]),
      releaseSourceSettings: {
        enabledSourceIds: [STARRED_RELEASE_SOURCE_ID, WATCH_CUSTOM_RELEASE_SOURCE_ID, CUSTOM_RELEASE_SOURCE_ID],
        watchCustomReleaseRepos: [watchRepo],
        customReleaseRepos: [customRepo],
      },
    }));

    expect(resolved.repositories).toHaveLength(1);
    expect(resolved.entries[0].sources).toEqual([
      STARRED_RELEASE_SOURCE_ID,
      WATCH_CUSTOM_RELEASE_SOURCE_ID,
      CUSTOM_RELEASE_SOURCE_ID,
    ]);
  });

  it('reports source memberships for unsubscribe prompts', () => {
    const starred = createRepository(1, 'owner/repo');
    const customRepo = createCustomReleaseRepository('owner/repo', CUSTOM_RELEASE_SOURCE_ID)!;

    const sources = getSourcesForReleaseRepository(createState({
      repositories: [starred],
      releaseSubscriptions: new Set([1]),
      releaseSourceSettings: {
        enabledSourceIds: [STARRED_RELEASE_SOURCE_ID, CUSTOM_RELEASE_SOURCE_ID],
        watchCustomReleaseRepos: [],
        customReleaseRepos: [customRepo],
      },
    }), {
      id: 1,
      name: 'repo',
      full_name: 'owner/repo',
    });

    expect(sources).toEqual([STARRED_RELEASE_SOURCE_ID, CUSTOM_RELEASE_SOURCE_ID]);
  });

  it('reports disabled source memberships so unsubscribe removes hidden entries too', () => {
    const starred = createRepository(1, 'owner/repo');
    const customRepo = createCustomReleaseRepository('owner/repo', CUSTOM_RELEASE_SOURCE_ID)!;

    const sources = getSourcesForReleaseRepository(createState({
      repositories: [starred],
      releaseSubscriptions: new Set([1]),
      releaseSourceSettings: {
        enabledSourceIds: [STARRED_RELEASE_SOURCE_ID],
        watchCustomReleaseRepos: [],
        customReleaseRepos: [customRepo],
      },
    }), {
      id: 1,
      name: 'repo',
      full_name: 'owner/repo',
    });

    expect(sources).toEqual([STARRED_RELEASE_SOURCE_ID, CUSTOM_RELEASE_SOURCE_ID]);
  });
});
