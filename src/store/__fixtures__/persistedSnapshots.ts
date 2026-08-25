export type PersistedSnapshot = Record<string, unknown>;

/**
 * Produces the stable, JSON-serializable shell shared by historical Zustand
 * snapshots. Individual tests override only the fields that define the
 * migration or hydration contract being exercised.
 */
export const buildPersistedSnapshot = (
  overrides: PersistedSnapshot = {},
): PersistedSnapshot => ({
  repositories: [],
  gists: [],
  starredGists: [],
  releases: [],
  releaseSubscriptions: [],
  readReleases: [],
  readForks: [],
  releaseExpandedRepositories: [],
  forkExpandedRepositories: [],
  ...overrides,
});

/**
 * Creates the five-channel shape used by legacy discovery snapshots. The
 * values are intentionally non-default so reset behavior is observable.
 */
export const buildTransientDiscoverySnapshot = (): PersistedSnapshot => ({
  discoveryRepos: {
    trending: [{ id: 1, name: 'should-not-persist' }],
    'hot-release': [],
    'most-popular': [],
    topic: [],
    search: [],
  },
  discoveryIsLoading: {
    trending: true,
    'hot-release': true,
    'most-popular': true,
    topic: true,
    search: true,
  },
  discoveryScrollPositions: {
    trending: 120,
    'hot-release': 80,
    'most-popular': 40,
    topic: 20,
    search: 10,
  },
});

export const buildExpectedResetDiscoveryState = () => ({
  discoveryRepos: {
    trending: [],
    'hot-release': [],
    'most-popular': [],
    topic: [],
    search: [],
  },
  discoveryIsLoading: {
    trending: false,
    'hot-release': false,
    'most-popular': false,
    topic: false,
    search: false,
  },
  discoveryScrollPositions: {
    trending: 0,
    'hot-release': 0,
    'most-popular': 0,
    topic: 0,
    search: 0,
  },
});
