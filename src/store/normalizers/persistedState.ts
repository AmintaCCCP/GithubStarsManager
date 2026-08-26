
import type {
  Category,
  DiscoveryChannelId,
  DiscoveryRepo,
  SubscriptionChannel,
  TrendingTimeRange,
} from '../../types';
import { defaultHeaderMenuConfig, defaultSubscriptionChannels } from '../../types';
import { DEFAULT_THEME_PRESET_ID, isThemePresetId } from '../../constants/themePresets';
import { normalizeReleaseSourceSettings } from '../../utils/releaseSources';
import type { AppStoreState } from '../types';
import { readAuthMirror } from '../persistence/authStorage';
import {
  defaultDiscoveryChannels,
  defaultPresetFilters,
  initialGistSearchFilters,
  initialSearchFilters,
  normalizeMcpConfig,
  normalizeNumberSet,
  normalizeRepositoryChatSettings,
  normalizeVectorSearchConfig,
  normalizeVectorSearchStatus,
  PersistedAppState,
  REQUIRED_HEADER_MENU_IDS,
} from '../schema';

export const normalizePersistedState = (
  persisted: PersistedAppState | undefined,
  currentState: AppStoreState
): Partial<AppStoreState> => {
  const safePersisted = persisted ?? {};
  const defaultDiscoveryChannelIds = new Set(defaultDiscoveryChannels.map((channel) => channel.id));
  const authMirror = readAuthMirror();

  // Effective auth: persisted values win; the synchronous localStorage mirror
  // back-fills when the IndexedDB snapshot lost them (asynchronous unload write).
  const resolvedUser = safePersisted.user ?? authMirror?.user ?? null;
  const resolvedGithubToken =
    typeof safePersisted.githubToken === 'string'
      ? safePersisted.githubToken
      : (authMirror?.githubToken ?? null);
  const resolvedBackendApiSecret =
    typeof safePersisted.backendApiSecret === 'string'
      ? (safePersisted.backendApiSecret || null)
      : (authMirror?.backendApiSecret ?? currentState.backendApiSecret ?? null);

  const repositories = Array.isArray(safePersisted.repositories) ? safePersisted.repositories : [];
  const gists = Array.isArray(safePersisted.gists) ? safePersisted.gists : [];
  const starredGists = Array.isArray(safePersisted.starredGists) ? safePersisted.starredGists : [];
  const releases = Array.isArray(safePersisted.releases) ? safePersisted.releases : [];

  // Migration for old users: mark repos with existing releases as already synced
  const migratedRepositories = repositories.map(repo => {
    const hasExistingRelease = releases.some(r => r.repository?.id === repo.id);
    if (hasExistingRelease && !repo.has_fetched_releases) {
      // Backfill last_release_fetch_time from the latest persisted release timestamp
      const repoReleases = releases.filter(r => r.repository?.id === repo.id);
      const latestReleaseTime = repoReleases.length > 0
        ? Math.max(...repoReleases.map(r => new Date(r.published_at).getTime()))
        : null;
      return {
        ...repo,
        has_fetched_releases: true,
        last_release_fetch_time: repo.last_release_fetch_time || (latestReleaseTime ? new Date(latestReleaseTime).toISOString() : new Date().toISOString())
      };
    }
    return repo;
  });

  // Default includePreRelease to true if not set (backward compatibility)
  const includePreRelease = safePersisted.includePreRelease !== undefined
    ? safePersisted.includePreRelease
    : true;

  return {
    ...currentState,
    ...safePersisted,
    // Auth fallback: if the IndexedDB snapshot is missing the login credentials
    // (e.g. async unload write never completed), restore from the synchronous
    // localStorage mirror. Persisted values always win over the mirror.
    user: resolvedUser,
    githubToken: resolvedGithubToken,
    backendApiSecret: resolvedBackendApiSecret,
    theme:
      safePersisted.theme === 'light' || safePersisted.theme === 'dark'
        ? safePersisted.theme
        : 'dark',
    themePreset: isThemePresetId(safePersisted.themePreset)
      ? safePersisted.themePreset
      : DEFAULT_THEME_PRESET_ID,
    repositories: migratedRepositories,
    gists,
    starredGists,
    gistSearchResults: Array.isArray(safePersisted.gistSearchResults) ? safePersisted.gistSearchResults : gists,
    selectedGistCategory: safePersisted.selectedGistCategory === 'starred' || safePersisted.selectedGistCategory === 'mine'
      ? safePersisted.selectedGistCategory
      : 'all',
    // 不恢复分析中状态：异步任务无法在页面重载后存活，恢复会导致卡片永久卡在“分析中”状态。
    analyzingRepositoryIds: new Set<number>(),
    analyzingGistIds: new Set<string>(),
    releases,
    searchResults: migratedRepositories,
    releaseSubscriptions: normalizeNumberSet(safePersisted.releaseSubscriptions),
    repositoryViewMode: safePersisted.repositoryViewMode === 'list' ? 'list' : 'grid',
    releaseSourceSettings: normalizeReleaseSourceSettings(safePersisted.releaseSourceSettings),
    readReleases: normalizeNumberSet(safePersisted.readReleases),
    readForks: normalizeNumberSet(safePersisted.readForks),
    forks: Array.isArray(safePersisted.forks) ? safePersisted.forks : [],
    forkViewMode: safePersisted.forkViewMode || 'timeline',
    forkSelectedFilters: Array.isArray(safePersisted.forkSelectedFilters) ? safePersisted.forkSelectedFilters : [],
    forkSearchQuery: typeof safePersisted.forkSearchQuery === 'string' ? safePersisted.forkSearchQuery : '',
    forkExpandedRepositories: normalizeNumberSet(safePersisted.forkExpandedRepositories),
    releaseExpandedRepositories: normalizeNumberSet(safePersisted.releaseExpandedRepositories),
    includePreRelease,
    syncMode: safePersisted.syncMode === 'stars-and-lists' ? 'stars-and-lists' : 'stars',
    syncModeConfigured: safePersisted.syncModeConfigured === true,
    // 分类 id → GitHub List id 映射：仅保留字符串键值对，防止损坏数据污染状态
    categoryListIdMap: safePersisted.categoryListIdMap
      && typeof safePersisted.categoryListIdMap === 'object'
      ? Object.fromEntries(
          Object.entries(safePersisted.categoryListIdMap).filter(
            ([key, value]) => typeof key === 'string' && typeof value === 'string'
          )
        )
      : {},
    searchFilters: {
      ...initialSearchFilters,
      ...safePersisted.searchFilters,
      sortBy: safePersisted.searchFilters?.sortBy || 'stars',
      sortOrder: safePersisted.searchFilters?.sortOrder || 'desc',
    },
    gistSearchFilters: {
      ...initialGistSearchFilters,
      ...safePersisted.gistSearchFilters,
      sortBy: safePersisted.gistSearchFilters?.sortBy || 'updated',
      sortOrder: safePersisted.gistSearchFilters?.sortOrder || 'desc',
    },
    webdavConfigs: Array.isArray(safePersisted.webdavConfigs) ? safePersisted.webdavConfigs : [],
    embeddingConfigs: Array.isArray(safePersisted.embeddingConfigs) ? safePersisted.embeddingConfigs : [],
    activeEmbeddingConfig: typeof safePersisted.activeEmbeddingConfig === 'string' ? safePersisted.activeEmbeddingConfig : null,
    vectorSearchConfig: normalizeVectorSearchConfig(
      safePersisted.vectorSearchConfig,
      safePersisted.embeddingConfigs
    ),
    vectorSearchStatus: normalizeVectorSearchStatus(
      safePersisted.vectorSearchStatus ?? currentState.vectorSearchStatus
    ),
// Persist full mcpConfig including token so Agent configs stay stable across restarts
    // unless the user explicitly resets the token.
    mcpConfig: normalizeMcpConfig((safePersisted as Record<string, unknown>).mcpConfig),
    repositoryChatSettings: normalizeRepositoryChatSettings((safePersisted as Record<string, unknown>).repositoryChatSettings),
    customCategories: Array.isArray(safePersisted.customCategories) ? safePersisted.customCategories : [],
    hiddenDefaultCategoryIds: (() => {
      const persistedIds = (safePersisted as Record<string, unknown>).hiddenDefaultCategoryIds;
      return Array.isArray(persistedIds)
        ? persistedIds.filter((id): id is string => typeof id === 'string')
        : [];
    })(),
    defaultCategoryOverrides: (() => {
      const persisted = (safePersisted as Record<string, unknown>).defaultCategoryOverrides;
      return persisted && typeof persisted === 'object' && !Array.isArray(persisted)
        ? persisted as Record<string, Partial<Category>>
        : {};
    })(),
    categoryOrder: Array.isArray(safePersisted.categoryOrder) ? safePersisted.categoryOrder.filter((id: unknown): id is string => typeof id === 'string') : [],
    collapsedSidebarCategoryCount: typeof safePersisted.collapsedSidebarCategoryCount === 'number' && safePersisted.collapsedSidebarCategoryCount > 0 ? safePersisted.collapsedSidebarCategoryCount : 20,
    categoryMatchMode: safePersisted.categoryMatchMode === 'legacy' ? 'legacy' : 'effective',
    assetFilters: Array.isArray(safePersisted.assetFilters) && safePersisted.assetFilters.length > 0 ? safePersisted.assetFilters : defaultPresetFilters,
    language: safePersisted.language || 'zh',
    translationEngine: safePersisted.translationEngine === 'google' || safePersisted.translationEngine === 'ai'
      ? safePersisted.translationEngine
      : 'microsoft',
    isAuthenticated: !!(resolvedUser && resolvedGithubToken),
    releaseViewMode: safePersisted.releaseViewMode || 'timeline',
    releaseShowMode: safePersisted.releaseShowMode === 'unread' ? 'unread' : 'all',
    releaseLatestMode: safePersisted.releaseLatestMode === 'latest' ? 'latest' : 'all',
    releaseSelectedFilters: Array.isArray(safePersisted.releaseSelectedFilters) ? safePersisted.releaseSelectedFilters : [],
    releaseSearchQuery: typeof safePersisted.releaseSearchQuery === 'string' ? safePersisted.releaseSearchQuery : '',
    discoveryChannels: (() => {
      const persisted = (safePersisted as Record<string, unknown>).discoveryChannels;
      if (!Array.isArray(persisted)) return defaultDiscoveryChannels;

      return defaultDiscoveryChannels.map((defaultChannel) => {
        const persistedChannel = persisted.find((channel: unknown) => {
          return (channel as Record<string, unknown>)?.id === defaultChannel.id;
        }) as Record<string, unknown> | undefined;

        if (!persistedChannel) {
          return defaultChannel;
        }

        return {
      ...defaultChannel,
      enabled: persistedChannel.enabled !== false,
    };
      });
    })(),
    // discoveryRepos is session-only runtime data. Never revive a stale legacy
    // cache during hydration, even if a historical snapshot contains the field.
    discoveryRepos: { 'trending': [], 'hot-release': [], 'most-popular': [], 'topic': [], 'search': [] } as Record<DiscoveryChannelId, DiscoveryRepo[]>,
    discoveryLastRefresh: { 'trending': null, 'hot-release': null, 'most-popular': null, 'topic': null, 'search': null },
    discoveryTotalCount: { 'trending': 0, 'hot-release': 0, 'most-popular': 0, 'topic': 0, 'search': 0 },
    selectedDiscoveryChannel: defaultDiscoveryChannelIds.has(safePersisted.selectedDiscoveryChannel as DiscoveryChannelId)
      ? safePersisted.selectedDiscoveryChannel as DiscoveryChannelId
      : 'trending',
    // discoveryIsLoading 不持久化，始终重置为 false（防止旧数据格式异常）
    discoveryIsLoading: { 'trending': false, 'hot-release': false, 'most-popular': false, 'topic': false, 'search': false },
    discoveryIsLoadingMore: { 'trending': false, 'hot-release': false, 'most-popular': false, 'topic': false, 'search': false },
    discoveryLoadMoreError: { 'trending': null, 'hot-release': null, 'most-popular': null, 'topic': null, 'search': null },
    discoveryHasMore: { 'trending': false, 'hot-release': false, 'most-popular': false, 'topic': false, 'search': false },
    discoveryNextPage: { 'trending': 1, 'hot-release': 1, 'most-popular': 1, 'topic': 1, 'search': 1 },
    // discoveryScrollPositions 不持久化，始终重置为 0
    discoveryScrollPositions: { 'trending': 0, 'hot-release': 0, 'most-popular': 0, 'topic': 0, 'search': 0 },
  trendingTimeRange: 'weekly' as TrendingTimeRange,
    // 确保 subscription 相关状态包含 trending 键
    subscriptionRepos: {
      'most-stars': [],
      'most-forks': [],
      'most-dev': [],
      'trending': [],
      ...(safePersisted.subscriptionRepos as Record<string, unknown> || {}),
    },
    subscriptionLastRefresh: {
      'most-stars': null,
      'most-forks': null,
      'most-dev': null,
      'trending': null,
      ...((safePersisted as Record<string, unknown>).subscriptionLastRefresh as Record<string, unknown> || {}),
    },
    subscriptionIsLoading: {
      'most-stars': false,
      'most-forks': false,
      'most-dev': false,
      'trending': false,
      ...((safePersisted as Record<string, unknown>).subscriptionIsLoading as Record<string, unknown> || {}),
    },
    // 确保 subscriptionChannels 包含 trending，且所有频道都有 nameEn（兼容旧数据）
    subscriptionChannels: (() => {
      const persisted = (safePersisted as Record<string, unknown>).subscriptionChannels;
      const defaultChannelsMap = new Map(defaultSubscriptionChannels.map(ch => [ch.id, ch]));
      if (!Array.isArray(persisted)) return defaultSubscriptionChannels;
      // 合并：使用 persisted 的频道，但补全缺失的字段（nameEn、trending 等）
      return persisted.map((ch: unknown) => {
        const chRecord = ch as Record<string, unknown>;
        const defaultCh = defaultChannelsMap.get(chRecord.id as string);
        if (defaultCh) {
          return {
            ...(chRecord as Partial<SubscriptionChannel>),
            name: defaultCh.name, // 始终使用中文名称（默认定义）
            nameEn: (chRecord.nameEn as string) || defaultCh.nameEn || (chRecord.name as string) || defaultCh.nameEn,
            icon: (chRecord.icon as string) || defaultCh.icon,
            description: (chRecord.description as string) || defaultCh.description,
          } as unknown as SubscriptionChannel;
        }
        return chRecord as unknown as SubscriptionChannel;
      }).concat(
        defaultSubscriptionChannels.filter(dch => !persisted.some((ch: unknown) => (ch as Record<string, unknown>).id === dch.id))
      );
    })(),
    proxyConfig: (() => {
      const p = (safePersisted as Record<string, unknown>).proxyConfig;
      if (p && typeof p === 'object') {
        const obj = p as Record<string, unknown>;
        const validType = obj.type === 'http' || obj.type === 'socks5' ? obj.type : 'http';
        const validHost = typeof obj.host === 'string' ? obj.host : '';
        const validPort = typeof obj.port === 'number' && Number.isFinite(obj.port) ? obj.port : 7890;
        return {
          enabled: typeof obj.enabled === 'boolean' ? obj.enabled : false,
          type: validType as import('../../types').ProxyType,
          host: validHost,
          port: validPort,
          username: typeof obj.username === 'string' ? obj.username : undefined,
          password: typeof obj.password === 'string' ? obj.password : undefined,
        };
      }
      return { enabled: false, type: 'http' as const, host: '', port: 7890 };
    })(),
    rpcDownloadConfig: (() => {
      const r = (safePersisted as Record<string, unknown>).rpcDownloadConfig;
      if (r && typeof r === 'object') {
        const obj = r as Record<string, unknown>;
        return {
          enabled: typeof obj.enabled === 'boolean' ? obj.enabled : false,
          host: typeof obj.host === 'string' ? obj.host : '',
          port: typeof obj.port === 'number' && Number.isFinite(obj.port) ? obj.port : 6800,
          secret: typeof obj.secret === 'string' ? obj.secret : undefined,
        };
      }
      return { enabled: false, host: '', port: 6800 };
    })(),
    headerMenuConfig: (() => {
      const persisted = (safePersisted as Record<string, unknown>).headerMenuConfig;
      if (!Array.isArray(persisted)) return defaultHeaderMenuConfig;
      // 合并：确保所有默认菜单都存在，保留用户自定义的 visible/order
      // 防御性过滤：跳过非对象或 null 的损坏数据
      const persistedMap = new Map(
        persisted
          .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
          .map((item) => [item.id, item])
      );
      return defaultHeaderMenuConfig.map((defaultItem) => {
        const persistedItem = persistedMap.get(defaultItem.id);
        if (!persistedItem) return defaultItem;
        const isRequired = REQUIRED_HEADER_MENU_IDS.has(defaultItem.id);
        return {
          ...defaultItem,
          visible: isRequired ? true : (typeof persistedItem.visible === 'boolean' ? persistedItem.visible : defaultItem.visible),
          order: typeof persistedItem.order === 'number' ? persistedItem.order : defaultItem.order,
        };
      });
    })(),
  };
};
