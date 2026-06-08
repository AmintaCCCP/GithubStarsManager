import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Repository, defaultReleaseSourceSettings } from '../types';
import { CUSTOM_RELEASE_SOURCE_ID, createCustomReleaseRepository } from '../utils/releaseSources';

let useAppStore: typeof import('./useAppStore').useAppStore;

beforeAll(async () => {
  const { indexedDBStorage } = await vi.importActual<typeof import('../services/indexedDbStorage')>('../services/indexedDbStorage');
  window.localStorage?.removeItem?.('github-stars-manager');
  await indexedDBStorage.removeItem('github-stars-manager');
  ({ useAppStore } = await vi.importActual<typeof import('./useAppStore')>('./useAppStore'));
});

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

describe('useAppStore release source settings', () => {
  beforeEach(() => {
    useAppStore.setState({
      releaseSourceSettings: defaultReleaseSourceSettings,
      releaseSubscriptions: new Set<number>(),
      releases: [],
      readReleases: new Set<number>(),
    });
  });

  it('keeps the starred release subscription source enabled by default', () => {
    expect(useAppStore.getState().releaseSourceSettings.enabledSourceIds).toEqual(['starred-release-subscription']);
  });

  it('dedupes custom release repositories by full name', () => {
    const first = createCustomReleaseRepository('owner/repo', CUSTOM_RELEASE_SOURCE_ID)!;
    const duplicate = createCustomReleaseRepository('https://github.com/OWNER/repo', CUSTOM_RELEASE_SOURCE_ID)!;

    useAppStore.getState().addReleaseSourceRepository(CUSTOM_RELEASE_SOURCE_ID, first);
    useAppStore.getState().addReleaseSourceRepository(CUSTOM_RELEASE_SOURCE_ID, duplicate);

    expect(useAppStore.getState().releaseSourceSettings.customReleaseRepos).toHaveLength(1);
  });

  it('removes custom release repositories by full name', () => {
    const repo = createCustomReleaseRepository('owner/repo', CUSTOM_RELEASE_SOURCE_ID)!;

    useAppStore.getState().addReleaseSourceRepository(CUSTOM_RELEASE_SOURCE_ID, repo);
    useAppStore.getState().removeReleaseSourceRepository(CUSTOM_RELEASE_SOURCE_ID, 'OWNER/repo');

    expect(useAppStore.getState().releaseSourceSettings.customReleaseRepos).toHaveLength(0);
  });
});

describe('useAppStore repository performance guards', () => {
  beforeEach(() => {
    useAppStore.setState({
      repositories: [],
      searchResults: [],
      analyzingRepositoryIds: new Set(),
    });
  });

  it('does not notify subscribers when updateRepository receives an equivalent repository', () => {
    const repo = createRepository(1);
    useAppStore.setState({ repositories: [repo], searchResults: [repo] });

    const previousRepositories = useAppStore.getState().repositories;
    const previousSearchResults = useAppStore.getState().searchResults;
    let notifications = 0;
    const unsubscribe = useAppStore.subscribe(() => {
      notifications++;
    });

    useAppStore.getState().updateRepository({ ...repo });
    unsubscribe();

    expect(notifications).toBe(0);
    expect(useAppStore.getState().repositories).toBe(previousRepositories);
    expect(useAppStore.getState().searchResults).toBe(previousSearchResults);
  });

  it('updates only lists that contain the repository', () => {
    const repo = createRepository(1);
    useAppStore.setState({ repositories: [repo], searchResults: [] });

    const previousSearchResults = useAppStore.getState().searchResults;
    useAppStore.getState().updateRepository({ ...repo, ai_summary: 'Updated summary' });

    expect(useAppStore.getState().repositories[0].ai_summary).toBe('Updated summary');
    expect(useAppStore.getState().searchResults).toBe(previousSearchResults);
  });

  it('does not notify subscribers when analyzing state is unchanged', () => {
    useAppStore.setState({ analyzingRepositoryIds: new Set([1]) });

    const previousAnalyzingIds = useAppStore.getState().analyzingRepositoryIds;
    let notifications = 0;
    const unsubscribe = useAppStore.subscribe(() => {
      notifications++;
    });

    useAppStore.getState().setAnalyzingRepository(1, true);
    unsubscribe();

    expect(notifications).toBe(0);
    expect(useAppStore.getState().analyzingRepositoryIds).toBe(previousAnalyzingIds);
  });
});
