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
  'accountWorkspaces',
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
  'weeklyOnlyCollected',
  'xTweetFollows',
  'xTweetAuthRevision',
  'telegramFollows',
  'proxyConfig',
  'rpcDownloadConfig',
  'routeMode',
  'linkedApplications',
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
  // v17: 已有合法 My Apps 记录的快照——重复 migrate 必须原样保留（幂等）
  buildPersistedSnapshot({
    linkedApplications: [{
      id: 'linked-1',
      repositoryFullName: 'owner/tool',
      displayName: 'Tool',
      installedVersion: '1.0.0',
      platform: 'linux',
      architecture: 'x64',
      linkSource: 'manual',
      includePrereleases: false,
      repositorySourceUrl: 'https://github.com/owner/tool',
      linkedAt: '2026-03-01T00:00:00.000Z',
    }],
  }),
  // v17: 损坏/半成品记录——必须在 migrate 里被收敛或丢弃，不得抛错
  buildPersistedSnapshot({
    linkedApplications: [
      { repositoryFullName: 'owner/missing-id' },
      { id: 'kept', repositoryFullName: 'Owner/Kept', installedVersion: 42, linkedAt: 'not-a-date' },
      42,
      null,
      'junk',
    ],
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

    expect(options.version).toBe(16);
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

  it('normalizes My Apps records during hydration without a version bump', () => {
    const options = persistenceOptions();
    const initialState = actualStore.useAppStore.getInitialState();

    const legacy = options.merge(buildPersistedSnapshot(), initialState);
    expect(legacy.linkedApplications).toEqual([]);

    const migrated = options.merge(buildPersistedSnapshot({
      linkedApplications: [
        { repositoryFullName: 'owner/missing-id' },
        {
          id: 'kept',
          repositoryFullName: 'Owner/Kept',
          installedVersion: 42,
          linkedAt: 'not-a-date',
          includePrereleases: 'yes',
        },
      ],
    }), initialState);

    const records = migrated.linkedApplications as unknown as Array<Record<string, unknown>>;
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      id: 'kept',
      repositoryFullName: 'Owner/Kept',
      displayName: 'Kept',
      installedVersion: null,
      platform: 'unknown',
      linkSource: 'manual',
      // 非法值（'yes'）与缺失字段一样回落到"只跟踪稳定版"
      includePrereleases: false,
      repositorySourceUrl: 'https://github.com/Owner/Kept',
      linkedAt: '',
    });

    // 幂等：对已规范化快照再走 hydration 结果不变
    const twice = options.merge(buildPersistedSnapshot({ linkedApplications: records as never }), initialState);
    expect(twice.linkedApplications).toEqual(records);
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
    expect(normalized.discoveryRepos).toEqual({ trending: [], 'hot-release': [], 'most-popular': [], topic: [], 'x-tweet': [], telegram: [], weekly: [], search: [], 'code-search': [] });
    expect(normalized.discoveryIsLoading).toEqual({ trending: false, 'hot-release': false, 'most-popular': false, topic: false, 'x-tweet': false, telegram: false, weekly: false, search: false, 'code-search': false });
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
