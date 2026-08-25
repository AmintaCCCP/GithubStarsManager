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
  discoveryLastRefresh: {
    trending: '2026-02-01T00:00:00.000Z',
    'hot-release': '2026-02-02T00:00:00.000Z',
    'most-popular': '2026-02-03T00:00:00.000Z',
    topic: '2026-02-04T00:00:00.000Z',
    search: '2026-02-05T00:00:00.000Z',
  },
  discoveryTotalCount: {
    trending: 100,
    'hot-release': 80,
    'most-popular': 60,
    topic: 40,
    search: 20,
  },
  discoveryHasMore: {
    trending: true,
    'hot-release': true,
    'most-popular': true,
    topic: true,
    search: true,
  },
  discoveryNextPage: {
    trending: 6,
    'hot-release': 5,
    'most-popular': 4,
    topic: 3,
    search: 2,
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
  discoveryLastRefresh: {
    trending: null,
    'hot-release': null,
    'most-popular': null,
    topic: null,
    search: null,
  },
  discoveryTotalCount: {
    trending: 0,
    'hot-release': 0,
    'most-popular': 0,
    topic: 0,
    search: 0,
  },
  discoveryHasMore: {
    trending: false,
    'hot-release': false,
    'most-popular': false,
    topic: false,
    search: false,
  },
  discoveryNextPage: {
    trending: 1,
    'hot-release': 1,
    'most-popular': 1,
    topic: 1,
    search: 1,
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
