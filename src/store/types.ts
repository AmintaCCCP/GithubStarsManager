import type { StoreApi } from 'zustand';
import type { AppLanguage } from '../i18n/languages';
import type {
  AppState,
  Gist,
  GistCategoryId,
  GistSearchFilters,
  ThemeMode,
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
  ExternalFeedKind,
  ProgrammingLanguage,
  SortBy,
  SortOrder,
  TrendingTimeRange,
  WeeklySyncStatus,
  XTweetAuth,
  TopicCategory,
  CustomReleaseRepository,
  ReleaseSourceId,
  ReleaseSourceSettings,
  HeaderMenuItem,
  SyncMode,
  TranslationEngine,
  RepositoryCardFieldId,
  RepositoryCardActionPreference,
  RepositoryChatSettings,
  ThemeTokens,
  TrendingSnapshot,
} from '../types';
import type { ThemePresetId } from '../constants/themePresets';
import type { GitHubListsApiService } from '../services/githubListsApi';

export interface AppActions {
  // Auth actions
  setUser: (user: GitHubUser | null) => void;
  setGitHubToken: (token: string | null) => void;
  /**
   * 清除当前会话凭证并归档工作区。expectedAccountId 为审计修复 B9 的期望账号
   * 标识（退出确认框打开时的账号）；当前账号与之不一致时拒绝执行并返回 false。
   */
  logout: (expectedAccountId?: string) => boolean;

  // Auth & Multi-account actions (Issue #611)
  /** 保存或更新某个账号的凭证与用户信息到 savedAccounts */
  upsertSavedAccount: (user: GitHubUser, githubToken: string) => void;
  /** 在已保存账号间原子切换（快照当前账号工作区 -> 恢复目标账号工作区与凭证）；失败返回 false */
  switchAccount: (accountId: string) => boolean;
  /** 从已保存账号列表中移除指定账号（保留其 accountWorkspaces；移除当前账号则切到下一个账号或登出） */
  removeSavedAccount: (accountId: string) => void;
  /** 在执行外部数据恢复（如后端恢复）前，预先将当前已登录账号的工作区安全归档并清空顶层工作区，防止 R2 污染 */
  parkCurrentAccountForRestore: () => string | null;
  /**
   * 丢弃一次未完成登录残留在顶层工作区的部分同步数据（重置为空工作区，绝不归档为账号快照）。
   * restoreWorkspace（R2-B10）为拉取发起前捕获的顶层快照：park 未能归档的无主
   * 残留（如旧版顶层缓存）在丢弃拉取残留后原样恢复，防止误清不可再同步的数据。
   */
  discardPartialLoginWorkspace: (restoreWorkspace?: import('./helpers/accountWorkspace').AccountWorkspace | null) => void;
  /** 水化后从桌面端安全存储回填账号 Token（B7；Web 构建无持久化 PAT，不会调用） */
  restorePersistedAccountTokens: (tokens: Record<string, string>) => void;

  // Repository actions
  setRepositories: (repos: Repository[], options?: { allowEmpty?: boolean }) => void;
  updateRepository: (repo: Repository) => void;
  /** 批量更新多个仓库的指定字段，保留当前过滤的 searchResults 不被重置 */
  updateRepositoriesMetadata: (updates: { id: number; patch: Partial<Repository> }[]) => void;
  addRepository: (repo: Repository) => void;
  setLoading: (loading: boolean) => void;
  setSyncingStars: (syncing: boolean) => void;
  setLastSync: (timestamp: string) => void;
  setSyncMode: (mode: SyncMode) => void;
  setSyncModeConfigured: (configured: boolean) => void;
  pushCategoriesToLists: (
    api: GitHubListsApiService,
    categoryIds?: string[],
    session?: { accountId: string | null; generation: number },
  ) => Promise<void>;
  resetListsPush: () => void;
  setListsPushError: (error: string | null) => void;
  setCategoryListIdMap: (categoryId: string, listId: string) => void;
  deleteRepository: (repoId: number) => void;
  setAnalyzingRepository: (repoId: number, isAnalyzing: boolean) => void;

  // Gist actions
  setGists: (gists: Gist[], options?: { allowEmpty?: boolean }) => void;
  setStarredGists: (gists: Gist[], options?: { allowEmpty?: boolean }) => void;
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
  setReleases: (releases: Release[], options?: { allowEmpty?: boolean }) => void;
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
  setForks: (forks: ForkRepo[], options?: { allowEmpty?: boolean }) => void;
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
  setThemeMode: (mode: ThemeMode) => void;
  setSystemTheme: (systemTheme: 'light' | 'dark') => void;
  setThemePresetLight: (preset: ThemePresetId) => void;
  setThemePresetDark: (preset: ThemePresetId) => void;
  setCurrentView: (view: 'repositories' | 'gists' | 'releases' | 'forks' | 'settings' | 'subscription') => void;
  setSelectedCategory: (category: string) => void;
  setLanguage: (language: AppLanguage) => void;
  setTranslationEngine: (engine: TranslationEngine) => void;
  setAutoTranslateRepoDescription: (enabled: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setReadmeModalOpen: (open: boolean) => void;
  setHeaderMenuConfig: (config: HeaderMenuItem[]) => void;

  // Hydration state
  setHasHydrated: (hydrated: boolean) => void;

  // Update actions
  setUpdateNotification: (notification: UpdateNotification | null) => void;
  dismissUpdateNotification: () => void;
  setAutoUpdateCheckEnabled: (enabled: boolean) => void;
  setUpdatePromptDismissedVersion: (version: string | null) => void;

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
  /**
   * Release 刷新状态（审计修复 B4）：发起时传 owner（发起账号 ID + 会话代次）；
   * 异步 finally 清理必须传入发起刷新时使用的同一 owner——仅当该身份仍是标志
   * 持有者才清除（跨账号/跨会话的过期 finally 不清除新账号已重新发起的刷新状态）。
   * 不传 owner 时，仅在没有旧 owner 记录阻止清理的情况下沿用布尔语义；若仍记录着
   * 旧账号或旧代次的 owner，无 owner 的 setReleaseIsRefreshing(false) 会被忽略。
   */
  setReleaseIsRefreshing: (refreshing: boolean, owner?: { accountId: string | null; generation: number }) => void;
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
  addExternalDiscoveryChannel: (name: string, sourceUrl: string, kind?: ExternalFeedKind) => DiscoveryChannelId | null;
  removeExternalDiscoveryChannel: (channelId: DiscoveryChannelId) => void;
  setDiscoveryPlatform: (platform: DiscoveryPlatform) => void;
  setDiscoveryLanguage: (language: ProgrammingLanguage) => void;
  setDiscoverySortBy: (sortBy: SortBy) => void;
  setDiscoverySortOrder: (sortOrder: SortOrder) => void;
  setDiscoverySearchQuery: (query: string) => void;
  setDiscoverySearchMode: (mode: 'keyword' | 'semantic') => void;
  setDiscoverySearchPhase: (phase: string | null) => void;
  setDiscoverySearchPhaseDetail: (detail: string | null) => void;
  setDiscoverySearchEmptyReason: (reason: 'recall_empty' | 'ai_empty' | null) => void;
  setDiscoverySelectedTopic: (topic: TopicCategory | null) => void;
  setDiscoveryHasMore: (channel: DiscoveryChannelId, hasMore: boolean) => void;
  setDiscoveryNextPage: (channel: DiscoveryChannelId, page: number) => void;
  setDiscoveryTotalCount: (channel: DiscoveryChannelId, count: number) => void;
  setDiscoveryScrollPosition: (channel: DiscoveryChannelId, position: number) => void;
  setTrendingTimeRange: (range: TrendingTimeRange) => void;
  setWeeklyOnlyCollected: (only: boolean) => void;
  setWeeklySyncStatus: (status: WeeklySyncStatus | null) => void;
  setXTweetSyncStatus: (status: WeeklySyncStatus | null) => void;
  /** 添加 X 推文频道关注（接受 @handle / handle / x.com 链接，重复添加忽略） */
  addXTweetFollow: (handle: string) => void;
  removeXTweetFollow: (handle: string) => void;
  /** 保存 X 推文频道登录鉴权 Cookie（覆盖旧值） */
  setXTweetAuth: (auth: XTweetAuth) => void;
  clearXTweetAuth: () => void;
  setTelegramSyncStatus: (status: WeeklySyncStatus | null) => void;
  /** 添加 Telegram 频道关注（接受 @channel / channel / t.me 链接，重复添加忽略） */
  addTelegramFollow: (channel: string) => void;
  removeTelegramFollow: (channel: string) => void;
  appendDiscoveryRepos: (channel: DiscoveryChannelId, repos: DiscoveryRepo[]) => void;

  // Theme tokens（开发守则 §14）
  /** 局部更新：内部与当前值合并，调用方不必自己展开（避免拿到过期的渲染值）。 */
  updateThemeTokens: (patch: Partial<ThemeTokens>) => void;
  /** Trending 快照（开发守则 §7）：记一份榜单快照，去重与上限在 utils 里处理。 */
  recordTrendingSnapshot: (snapshot: TrendingSnapshot) => void;
  // 仓库卡片可见字段（开发守则 §14）
  /** 切换某个字段的显示；未提供的字段沿用当前值。 */
  setRepositoryCardField: (id: RepositoryCardFieldId, visible: boolean) => void;
  setRepositoryCardActions: (actions: RepositoryCardActionPreference[]) => void;
  setPluginCustomIcon: (pluginId: string, icon: string | null) => void;
}

export type AppStoreState = AppState & AppActions;
export type AppStoreSet = StoreApi<AppStoreState>['setState'];
export type AppStoreGet = StoreApi<AppStoreState>['getState'];
export type AppStoreSlice<T> = (set: AppStoreSet, get: AppStoreGet) => T;
