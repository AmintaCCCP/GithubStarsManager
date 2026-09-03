import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  buildPersistedSnapshot,
  buildTransientDiscoverySnapshot,
  type PersistedSnapshot,
} from './__fixtures__/persistedSnapshots';
import { useBulkRepositoryActions } from '../features/repositories/hooks/useBulkRepositoryActions';
import { useRepositoryAnalysisJob } from '../features/repositories/hooks/useRepositoryAnalysisJob';
import { useRepositoryCardActions } from '../features/repositories/hooks/useRepositoryCardActions';
import { useAIConfigActions } from '../features/settings/hooks/useAIConfigActions';
import { useBackendSettingsActions } from '../features/settings/hooks/useBackendSettingsActions';
import { useBackupActions } from '../features/settings/hooks/useBackupActions';
import { useDiagnosticBackendActions } from '../features/settings/hooks/useDiagnosticBackendActions';
import { useMcpActions } from '../features/settings/hooks/useMcpActions';
import { useNetworkActions } from '../features/settings/hooks/useNetworkActions';
import { useStarSyncActions } from '../features/settings/hooks/useStarSyncActions';
import { useVectorSearchActions } from '../features/settings/hooks/useVectorSearchActions';
import { useWebDAVActions } from '../features/settings/hooks/useWebDAVActions';

type ActualStoreModule = typeof import('./useAppStore');
type AppStore = ActualStoreModule['useAppStore'];

let actualStore: ActualStoreModule;

beforeAll(async () => {
  actualStore = await vi.importActual<ActualStoreModule>('./useAppStore');
});

type PersistenceOptions = {
  version: number;
  partialize: (state: ReturnType<AppStore['getState']>) => PersistedSnapshot;
  migrate: (snapshot: PersistedSnapshot, version: number) => PersistedSnapshot | Promise<PersistedSnapshot>;
  merge: (
    snapshot: PersistedSnapshot,
    currentState: ReturnType<AppStore['getState']>,
  ) => ReturnType<AppStore['getState']>;
};

const persistenceOptions = (): PersistenceOptions => (
  actualStore.useAppStore.persist.getOptions() as unknown as PersistenceOptions
);

const partialize = (overrides: Partial<ReturnType<AppStore['getState']>> = {}): PersistedSnapshot => (
  persistenceOptions().partialize({ ...actualStore.useAppStore.getState(), ...overrides })
);

const currentPersistedKeys = [
  'user',
  'githubToken',
  'isAuthenticated',
  'repositories',
  'lastSync',
  'gists',
  'starredGists',
  'gistSearchFilters',
  'selectedGistCategory',
  'analyzingGistIds',
  'aiConfigs',
  'activeAIConfig',
  'repositoryChatSettings',
  'embeddingConfigs',
  'activeEmbeddingConfig',
  'vectorSearchConfig',
  'vectorSearchStatus',
  'mcpConfig',
  'webdavConfigs',
  'activeWebDAVConfig',
  'lastBackup',
  'releaseSubscriptions',
  'releaseSourceSettings',
  'readReleases',
  'releases',
  'forks',
  'readForks',
  'customCategories',
  'hiddenDefaultCategoryIds',
  'categoryOrder',
  'collapsedSidebarCategoryCount',
  'categoryMatchMode',
  'defaultCategoryOverrides',
  'assetFilters',
  'theme',
  'themePreset',
  'currentView',
  'selectedCategory',
  'language',
  'translationEngine',
  'isSidebarCollapsed',
  'headerMenuConfig',
  'backendApiSecret',
  'syncMode',
  'syncModeConfigured',
  'categoryListIdMap',
  'searchFilters',
  'repositoryViewMode',
  'releaseViewMode',
  'releaseShowMode',
  'releaseLatestMode',
  'releaseSelectedFilters',
  'releaseSearchQuery',
  'releaseExpandedRepositories',
  'includePreRelease',
  'includeKeysInBackup',
  'forkViewMode',
  'forkSelectedFilters',
  'forkSearchQuery',
  'forkExpandedRepositories',
  'discoveryChannels',
  'selectedDiscoveryChannel',
  'discoveryPlatform',
  'discoveryLanguage',
  'discoverySortBy',
  'discoverySortOrder',
  'discoverySelectedTopic',
  'proxyConfig',
  'rpcDownloadConfig',
  'routeMode',
] as const;

const historicalSnapshots = (): PersistedSnapshot[] => [
  buildPersistedSnapshot(),
  buildPersistedSnapshot({
    repositories: [{
      id: 7,
      name: 'historical',
      full_name: 'owner/historical',
      description: 'legacy description',
      html_url: 'https://github.com/owner/historical',
      stargazers_count: 1,
      forks_count: 0,
      forks: 0,
      language: 'TypeScript',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      pushed_at: '2026-01-01T00:00:00.000Z',
      owner: { login: 'owner', avatar_url: '' },
      topics: [],
      custom_description: '__EMPTY__',
    }],
    subscriptionChannels: [{ id: 'daily-dev', name: 'Daily developers', enabled: true }],
  }),
  buildPersistedSnapshot({
    ...buildTransientDiscoverySnapshot(),
    mcpConfig: { enabled: true, token: 'historical-token' },
    vectorSearchConfig: {
      enabled: true,
      workerUrl: 'https://vector.example.com',
      authToken: 'vector-token',
      embeddingConfigId: 'missing-config',
      indexMode: 'readme',
      readmeMaxChars: 6000,
      searchThreshold: 0.35,
      searchTopK: 30,
      enableHyDE: true,
      enableReranking: true,
      embeddingFormatVersion: 1,
    },
  }),
];

describe('PR-07 Store modularization compatibility', () => {
  it('keeps exactly one persistence shell and the current persisted key set', () => {
    const options = persistenceOptions();
    const persisted = partialize({
      analyzingGistIds: new Set(['gist-1']),
      proxyConfig: { enabled: true, type: 'http', host: 'proxy.example.com', port: 7890, password: 'proxy-password' },
      rpcDownloadConfig: { enabled: true, host: 'rpc.example.com', port: 6800, secret: 'rpc-secret' },
    });

    expect(options.version).toBe(13);
    expect(Object.keys(persisted)).toEqual(currentPersistedKeys);
    expect(persisted.analyzingGistIds).toEqual(['gist-1']);
    expect(persisted.proxyConfig).toMatchObject({ password: 'proxy-password' });
    expect(persisted.rpcDownloadConfig).toMatchObject({ secret: 'rpc-secret' });

    for (const transientKey of [
      'discoveryRepos',
      'discoveryLastRefresh',
      'discoveryTotalCount',
      'discoveryHasMore',
      'discoveryNextPage',
      'discoveryIsLoading',
      'discoveryScrollPositions',
      'subscriptionChannels',
      'subscriptionRepos',
      'subscriptionLastRefresh',
      'subscriptionIsLoading',
      'trendingTimeRange',
    ]) {
      expect(persisted).not.toHaveProperty(transientKey);
    }
  });

  it('keeps migration presence checks idempotent and hydration-equivalent across historical fixtures', async () => {
    const options = persistenceOptions();

    for (const fixture of historicalSnapshots()) {
      const once = await options.migrate(structuredClone(fixture), 0);
      const twice = await options.migrate(structuredClone(once), 999);

      expect(twice).toEqual(once);
      expect(options.merge(once, actualStore.useAppStore.getInitialState())).toEqual(
        options.merge(twice, actualStore.useAppStore.getInitialState()),
      );
    }
  });

  it('retains the historical normalize-only resets and release backfill behavior', () => {
    const snapshot = buildPersistedSnapshot({
      ...buildTransientDiscoverySnapshot(),
      analyzingGistIds: ['gist-1'],
      repositories: [{
        id: 11,
        name: 'release-repository',
        full_name: 'owner/release-repository',
        description: '',
        html_url: 'https://github.com/owner/release-repository',
        stargazers_count: 1,
        forks_count: 0,
        forks: 0,
        language: 'TypeScript',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        pushed_at: '2026-01-01T00:00:00.000Z',
        owner: { login: 'owner', avatar_url: '' },
        topics: [],
      }],
      releases: [{
        id: 101,
        tag_name: 'v1.0.0',
        name: 'v1.0.0',
        body: null,
        published_at: '2026-02-01T00:00:00.000Z',
        html_url: 'https://github.com/owner/release-repository/releases/tag/v1.0.0',
        assets: [],
        repository: { id: 11, full_name: 'owner/release-repository', name: 'release-repository' },
      }],
    });

    const normalized = actualStore.normalizePersistedState(snapshot, actualStore.useAppStore.getInitialState());

    expect(normalized.analyzingGistIds).toEqual(new Set());
    expect(normalized.discoveryRepos).toEqual({ trending: [], 'hot-release': [], 'most-popular': [], topic: [], search: [] });
    expect(normalized.discoveryIsLoading).toEqual({ trending: false, 'hot-release': false, 'most-popular': false, topic: false, search: false });
    expect(normalized.repositories?.[0]).toMatchObject({
      has_fetched_releases: true,
      last_release_fetch_time: '2026-02-01T00:00:00.000Z',
    });
  });

  it('preserves the root public API and all PR-04 to PR-06 Hook import paths', () => {
    expect(actualStore.useAppStore.getState).toBeTypeOf('function');
    expect(actualStore.sortCategoriesByOrder).toBeTypeOf('function');
    expect(actualStore.getAllCategories).toBeTypeOf('function');
    expect(actualStore.defaultCategories).toBeInstanceOf(Array);
    expect(actualStore.normalizePersistedState).toBeTypeOf('function');
    expect(actualStore.LEGACY_EMBEDDING_FORMAT_VERSION).toBe(1);
    expect(actualStore.isKnownEmbeddingFormatVersion(actualStore.LEGACY_EMBEDDING_FORMAT_VERSION)).toBe(true);

    for (const hook of [
      useRepositoryCardActions,
      useRepositoryAnalysisJob,
      useBulkRepositoryActions,
      useAIConfigActions,
      useBackendSettingsActions,
      useBackupActions,
      useDiagnosticBackendActions,
      useMcpActions,
      useNetworkActions,
      useStarSyncActions,
      useVectorSearchActions,
      useWebDAVActions,
    ]) {
      expect(hook).toBeTypeOf('function');
    }
  });
});
