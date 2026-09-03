
import type { StoreApi } from 'zustand';
import type {
  AppState,
  Gist,
  GistCategoryId,
  GistSearchFilters,
  Repository,
  Release,
  ForkRepo,
  AIConfig,
  WebDAVConfig,
  EmbeddingConfig,
  VectorSearchConfig,
  VectorSearchStatus,
  McpServiceConfig,
  VectorIndexingState,
  ProxyConfig,
  RpcDownloadConfig,
  SearchFilters,
  GitHubUser,
  Category,
  AssetFilter,
  UpdateNotification,
  AnalysisProgress,
  DiscoveryChannelId,
  DiscoveryRepo,
  DiscoveryPlatform,
  ProgrammingLanguage,
  SortBy,
  SortOrder,
  TrendingTimeRange,
  TopicCategory,
  CustomReleaseRepository,
  ReleaseSourceId,
  ReleaseSourceSettings,
  HeaderMenuItem,
  SyncMode,
  TranslationEngine,
  RepositoryChatSettings,
} from '../types';
import type { ThemePresetId } from '../constants/themePresets';
import type { GitHubListsApiService } from '../services/githubListsApi';

export interface AppActions {
  // Auth actions
  setUser: (user: GitHubUser | null) => void;
  setGitHubToken: (token: string | null) => void;
  logout: () => void;

  // Repository actions
  setRepositories: (repos: Repository[]) => void;
  updateRepository: (repo: Repository) => void;
  /** 批量更新多个仓库的指定字段，保留当前过滤的 searchResults 不被重置 */
  updateRepositoriesMetadata: (updates: { id: number; patch: Partial<Repository> }[]) => void;
  addRepository: (repo: Repository) => void;
  setLoading: (loading: boolean) => void;
  setSyncingStars: (syncing: boolean) => void;
  setLastSync: (timestamp: string) => void;
  setSyncMode: (mode: SyncMode) => void;
  setSyncModeConfigured: (configured: boolean) => void;
  pushCategoriesToLists: (api: GitHubListsApiService) => Promise<void>;
  resetListsPush: () => void;
  setListsPushError: (error: string | null) => void;
  setCategoryListIdMap: (categoryId: string, listId: string) => void;
  deleteRepository: (repoId: number) => void;
  setAnalyzingRepository: (repoId: number, isAnalyzing: boolean) => void;

  // Gist actions
  setGists: (gists: Gist[]) => void;
  setStarredGists: (gists: Gist[]) => void;
  updateGist: (gist: Gist) => void;
  deleteGist: (gistId: string) => void;
  setGistSearchFilters: (filters: Partial<GistSearchFilters>) => void;
  setGistSearchResults: (results: Gist[]) => void;
  setSelectedGistCategory: (category: GistCategoryId) => void;
  setAnalyzingGist: (gistId: string, isAnalyzing: boolean) => void;

  // AI actions
  addAIConfig: (config: AIConfig) => void;
  updateAIConfig: (id: string, updates: Partial<AIConfig>) => void;
  deleteAIConfig: (id: string) => void;
  setActiveAIConfig: (id: string | null) => void;
  setAIConfigs: (configs: AIConfig[]) => void;
  setRepositoryChatSettings: (settings: Partial<RepositoryChatSettings>) => void;

  // WebDAV actions
  addWebDAVConfig: (config: WebDAVConfig) => void;
  updateWebDAVConfig: (id: string, updates: Partial<WebDAVConfig>) => void;
  deleteWebDAVConfig: (id: string) => void;
  setActiveWebDAVConfig: (id: string | null) => void;
  setWebDAVConfigs: (configs: WebDAVConfig[]) => void;
  setLastBackup: (timestamp: string) => void;

  // Embedding actions
  addEmbeddingConfig: (config: EmbeddingConfig) => void;
  updateEmbeddingConfig: (id: string, updates: Partial<EmbeddingConfig>) => void;
  deleteEmbeddingConfig: (id: string) => void;
  setActiveEmbeddingConfig: (id: string | null) => void;
  setEmbeddingConfigs: (configs: EmbeddingConfig[]) => void;

  // Vector Search actions
  setVectorSearchConfig: (config: Partial<VectorSearchConfig>) => void;
  setVectorSearchStatus: (status: VectorSearchStatus | undefined) => void;
  setVectorIndexingState: (state: Partial<VectorIndexingState>) => void;

  // MCP service (local prefs; backend SQLite is source of truth when connected)
  setMcpConfig: (config: Partial<McpServiceConfig>) => void;

  // Similar repositories view actions
  enterSimilarView: (repos: Repository[], anchor: Repository) => void;
  resetSimilarView: () => void;
  exitSimilarView: () => void;

  // Search actions
  setSearchFilters: (filters: Partial<SearchFilters>) => void;
  setSearchResults: (results: Repository[]) => void;

  // Release actions
  setReleases: (releases: Release[]) => void;
  addReleases: (releases: Release[]) => void;
  /** 按 id 合并更新已存在 Release 的资产/元数据；内容变化后重置为未读（is_read=false 并从 readReleases 移除） */
  upsertReleases: (releases: Release[]) => void;
  toggleReleaseSubscription: (repoId: number) => void;
  batchUnsubscribeReleases: (repoIds: number[]) => void;
  removeReleasesByRepoId: (repoId: number) => void;
  removeReleasesByRepoFullName: (fullName: string) => void;
  /** 标记 Release 已读；被标记的条目同时清空 updated_asset_ids（“资产已更新”标识随已读消失） */
  markReleaseAsRead: (releaseId: number) => void;
  /** 点击某条资产后清除其"资产已更新"标识（从 updated_asset_ids 移除），不影响 Release 级未读状态 */
  markAssetAsRead: (assetId: number) => void;
  markAllReleasesAsRead: () => void;
  setReleaseSourceSettings: (settings: ReleaseSourceSettings) => void;
  setReleaseEnabledSources: (sourceIds: ReleaseSourceId[]) => void;
  toggleReleaseSource: (sourceId: ReleaseSourceId) => void;
  setReleaseSourceRepositories: (sourceId: ReleaseSourceId, repos: CustomReleaseRepository[]) => void;
  addReleaseSourceRepository: (sourceId: ReleaseSourceId, repo: CustomReleaseRepository) => void;
  removeReleaseSourceRepository: (sourceId: ReleaseSourceId, fullName: string) => void;
  updateReleaseSourceRepository: (sourceId: ReleaseSourceId, fullName: string, updates: Partial<CustomReleaseRepository>) => void;

  // Fork actions
  setForks: (forks: ForkRepo[]) => void;
  addForks: (forks: ForkRepo[]) => void;
  updateFork: (fork: ForkRepo) => void;
  markForkAsRead: (forkId: number) => void;
  markAllForksAsRead: () => void;

  // Category actions
  addCustomCategory: (category: Category) => void;
  updateCustomCategory: (id: string, updates: Partial<Category>) => void;
  updateDefaultCategory: (id: string, updates: Partial<Category>) => void;
  resetDefaultCategory: (id: string) => void;
  resetDefaultCategoryNameIcon: (id: string) => void;
  resetDefaultCategoryKeywords: (id: string) => void;
  deleteCustomCategory: (id: string) => void;
  hideDefaultCategory: (id: string) => void;
  showDefaultCategory: (id: string) => void;
  setCategoryOrder: (order: string[]) => void;
  reorderCategories: (oldIndex: number, newIndex: number) => void;
  setCollapsedSidebarCategoryCount: (count: number) => void;
  setCategoryMatchMode: (mode: 'legacy' | 'effective') => void;

  // Asset Filter actions
  addAssetFilter: (filter: AssetFilter) => void;
  updateAssetFilter: (id: string, updates: Partial<AssetFilter>) => void;
  deleteAssetFilter: (id: string) => void;

  // UI actions
  setTheme: (theme: 'light' | 'dark') => void;
  setThemePreset: (preset: ThemePresetId) => void;
  setCurrentView: (view: 'repositories' | 'gists' | 'releases' | 'forks' | 'settings' | 'subscription') => void;
  setSelectedCategory: (category: string) => void;
  setLanguage: (language: 'zh' | 'en') => void;
  setTranslationEngine: (engine: TranslationEngine) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setReadmeModalOpen: (open: boolean) => void;
  setHeaderMenuConfig: (config: HeaderMenuItem[]) => void;

  // Hydration state
  setHasHydrated: (hydrated: boolean) => void;

  // Update actions
  setUpdateNotification: (notification: UpdateNotification | null) => void;
  dismissUpdateNotification: () => void;

  // Update Analysis Progress
  setAnalysisProgress: (newProgress: AnalysisProgress) => void;

  // Backend actions
  setBackendApiSecret: (secret: string | null) => void;

  // Proxy actions
  setProxyConfig: (updates: Partial<ProxyConfig>) => void;
  setRouteMode: (mode: import('../types').RouteMode) => void;

  // RPC Download actions
  setRpcDownloadConfig: (updates: Partial<RpcDownloadConfig>) => void;

  // Repository list view actions
  setRepositoryViewMode: (mode: 'grid' | 'list') => void;

  // Release Timeline View actions
  setReleaseViewMode: (mode: 'timeline' | 'repository') => void;
  setReleaseShowMode: (mode: 'all' | 'unread') => void;
  setReleaseLatestMode: (mode: 'all' | 'latest') => void;
  setReleaseSelectedFilters: (filters: string[]) => void;
  toggleReleaseSelectedFilter: (filterId: string) => void;
  clearReleaseSelectedFilters: () => void;
  setReleaseSearchQuery: (query: string) => void;
  toggleReleaseExpandedRepository: (repoId: number) => void;
  setReleaseExpandedRepositories: (repoIds: Set<number>) => void;
  setReleaseIsRefreshing: (refreshing: boolean) => void;
  setIncludePreRelease: (include: boolean) => void;

  // Backup/Export key inclusion preference
  setIncludeKeysInBackup: (include: boolean) => void;

  // Fork Timeline View actions
  setForkViewMode: (mode: 'timeline' | 'repository') => void;
  setForkSelectedFilters: (filters: string[]) => void;
  toggleForkSelectedFilter: (filterId: string) => void;
  clearForkSelectedFilters: () => void;
  setForkSearchQuery: (query: string) => void;
  toggleForkExpandedRepository: (repoId: number) => void;
  setForkExpandedRepositories: (repoIds: Set<number>) => void;
  setForkIsRefreshing: (refreshing: boolean) => void;

  // Discovery actions
  setSelectedDiscoveryChannel: (channel: DiscoveryChannelId) => void;
  setDiscoveryLoading: (channel: DiscoveryChannelId, loading: boolean) => void;
  setDiscoveryLoadingMore: (channel: DiscoveryChannelId, loading: boolean) => void;
  setDiscoveryLoadMoreError: (channel: DiscoveryChannelId, error: string | null) => void;
  setDiscoveryRepos: (channel: DiscoveryChannelId, repos: DiscoveryRepo[], append?: boolean) => void;
  setDiscoveryLastRefresh: (channel: DiscoveryChannelId, timestamp: string) => void;
  updateDiscoveryRepo: (repo: DiscoveryRepo) => void;
  toggleDiscoveryChannel: (channelId: DiscoveryChannelId) => void;
  setDiscoveryPlatform: (platform: DiscoveryPlatform) => void;
  setDiscoveryLanguage: (language: ProgrammingLanguage) => void;
  setDiscoverySortBy: (sortBy: SortBy) => void;
  setDiscoverySortOrder: (sortOrder: SortOrder) => void;
  setDiscoverySearchQuery: (query: string) => void;
  setDiscoverySelectedTopic: (topic: TopicCategory | null) => void;
  setDiscoveryHasMore: (channel: DiscoveryChannelId, hasMore: boolean) => void;
  setDiscoveryNextPage: (channel: DiscoveryChannelId, page: number) => void;
  setDiscoveryTotalCount: (channel: DiscoveryChannelId, count: number) => void;
  setDiscoveryScrollPosition: (channel: DiscoveryChannelId, position: number) => void;
  setTrendingTimeRange: (range: TrendingTimeRange) => void;
  appendDiscoveryRepos: (channel: DiscoveryChannelId, repos: DiscoveryRepo[]) => void;
}

export type AppStoreState = AppState & AppActions;
export type AppStoreSet = StoreApi<AppStoreState>['setState'];
export type AppStoreGet = StoreApi<AppStoreState>['getState'];
export type AppStoreSlice<T> = (set: AppStoreSet, get: AppStoreGet) => T;
