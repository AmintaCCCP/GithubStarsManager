import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { 
  AppState, 
  Repository, 
  Release, 
  AIConfig, 
  WebDAVConfig, 
  SearchFilters, 
  GitHubUser, 
  Category, 
  AssetFilter, 
  UpdateNotification, 
  AnalysisProgress, 
  DiscoveryChannel, 
  DiscoveryChannelId, 
  DiscoveryRepo,
  DiscoveryPlatform,
  ProgrammingLanguage,
  DiscoverySortBy,
  DiscoverySortOrder,
  TopicCategory,
  SubscriptionChannel,
  SubscriptionRepo,
  defaultSubscriptionChannels,
  TrendingParams,
  TrendingTimeRange,
  TopicParams,
  SearchParams,
  RSSTimeRange
} from '../types';
import { indexedDBStorage } from '../services/indexedDbStorage';
import { PRESET_FILTERS } from '../constants/presetFilters';

const BACKEND_SECRET_SESSION_KEY = 'github-stars-manager-backend-secret';

const readSessionBackendSecret = (): string | null => {
  if (typeof window === 'undefined') return null;
  return window.sessionStorage.getItem(BACKEND_SECRET_SESSION_KEY);
};

const writeSessionBackendSecret = (secret: string | null): void => {
  if (typeof window === 'undefined') return;
  if (secret) {
    window.sessionStorage.setItem(BACKEND_SECRET_SESSION_KEY, secret);
  } else {
    window.sessionStorage.removeItem(BACKEND_SECRET_SESSION_KEY);
  }
};

interface AppActions {
  // Auth actions
  setUser: (user: GitHubUser | null) => void;
  setGitHubToken: (token: string | null) => void;
  logout: () => void;
  
  // Repository actions
  setRepositories: (repos: Repository[]) => void;
  updateRepository: (repo: Repository) => void;
  addRepository: (repo: Repository) => void;
  setLoading: (loading: boolean) => void;
  setLastSync: (timestamp: string) => void;
  deleteRepository: (repoId: number) => void;
  setAnalyzingRepository: (repoId: number, isAnalyzing: boolean) => void;
  
  // AI actions
  addAIConfig: (config: AIConfig) => void;
  updateAIConfig: (id: string, updates: Partial<AIConfig>) => void;
  deleteAIConfig: (id: string) => void;
  setActiveAIConfig: (id: string | null) => void;
  setAIConfigs: (configs: AIConfig[]) => void;
  
  // WebDAV actions
  addWebDAVConfig: (config: WebDAVConfig) => void;
  updateWebDAVConfig: (id: string, updates: Partial<WebDAVConfig>) => void;
  deleteWebDAVConfig: (id: string) => void;
  setActiveWebDAVConfig: (id: string | null) => void;
  setWebDAVConfigs: (configs: WebDAVConfig[]) => void;
  setLastBackup: (timestamp: string) => void;
  
  // Search actions
  setSearchFilters: (filters: Partial<SearchFilters>) => void;
  setSearchResults: (results: Repository[]) => void;
  
  // Release actions
  setReleases: (releases: Release[]) => void;
  addReleases: (releases: Release[]) => void;
  toggleReleaseSubscription: (repoId: number) => void;
  batchUnsubscribeReleases: (repoIds: number[]) => void;
  removeReleasesByRepoId: (repoId: number) => void;
  markReleaseAsRead: (releaseId: number) => void;
  markAllReleasesAsRead: () => void;
  
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

  // Asset Filter actions
  addAssetFilter: (filter: AssetFilter) => void;
  updateAssetFilter: (id: string, updates: Partial<AssetFilter>) => void;
  deleteAssetFilter: (id: string) => void;
  
  // UI actions
  setTheme: (theme: 'light' | 'dark') => void;
  setCurrentView: (view: 'repositories' | 'releases' | 'settings' | 'subscription') => void;
  setSelectedCategory: (category: string) => void;
  setLanguage: (language: 'zh' | 'en') => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  
  // Update actions
  setUpdateNotification: (notification: UpdateNotification | null) => void;
  dismissUpdateNotification: () => void;

  // Update Analysis Progress
  setAnalysisProgress: (newProgress: AnalysisProgress) => void;

  // Backend actions
  setBackendApiSecret: (secret: string | null) => void;

  // Release Timeline View actions
  setReleaseViewMode: (mode: 'timeline' | 'repository') => void;
  setReleaseSelectedFilters: (filters: string[]) => void;
  toggleReleaseSelectedFilter: (filterId: string) => void;
  clearReleaseSelectedFilters: () => void;
  setReleaseSearchQuery: (query: string) => void;
  toggleReleaseExpandedRepository: (repoId: number) => void;
  setReleaseExpandedRepositories: (repoIds: Set<number>) => void;
  setReleaseIsRefreshing: (refreshing: boolean) => void;

  // Discovery actions
  setSelectedDiscoveryChannel: (channel: DiscoveryChannelId) => void;
  setDiscoveryLoading: (channel: DiscoveryChannelId, loading: boolean) => void;
  setDiscoveryRepos: (channel: DiscoveryChannelId, repos: DiscoveryRepo[], append?: boolean) => void;
  setDiscoveryLastRefresh: (channel: DiscoveryChannelId, timestamp: string) => void;
  updateDiscoveryRepo: (repo: DiscoveryRepo) => void;
  toggleDiscoveryChannel: (channelId: DiscoveryChannelId) => void;
  setDiscoveryPlatform: (platform: DiscoveryPlatform) => void;
  setDiscoveryLanguage: (language: ProgrammingLanguage) => void;
  setDiscoverySearchQuery: (query: string) => void;
  setDiscoverySelectedTopic: (topic: TopicCategory | null) => void;
  setDiscoveryHasMore: (channel: DiscoveryChannelId, hasMore: boolean) => void;
  setDiscoveryNextPage: (channel: DiscoveryChannelId, page: number) => void;
  setDiscoveryTotalCount: (channel: DiscoveryChannelId, count: number) => void;
  setDiscoveryScrollPosition: (channel: DiscoveryChannelId, position: number) => void;
  appendDiscoveryRepos: (channel: DiscoveryChannelId, repos: DiscoveryRepo[]) => void;
  setDiscoveryCurrentPage: (channel: DiscoveryChannelId, page: number) => void;
  setTrendingParams: (params: Partial<TrendingParams>) => void;
  setTopicParams: (params: Partial<TopicParams>) => void;
  setSearchParams: (params: Partial<SearchParams>) => void;
  setRssTimeRange: (timeRange: RSSTimeRange) => void;
}

const initialSearchFilters: SearchFilters = {
  query: '',
  tags: [],
  languages: [],
  platforms: [],
  sortBy: 'stars',
  sortOrder: 'desc',
  isAnalyzed: undefined,
  isSubscribed: undefined,
  isEdited: undefined,
  isCategoryLocked: undefined,
  analysisFailed: undefined,
};

type PersistedAppState = Partial<
  Pick<
    AppState,
    | 'user'
    | 'githubToken'
    | 'isAuthenticated'
    | 'repositories'
    | 'lastSync'
    | 'aiConfigs'
    | 'activeAIConfig'
    | 'webdavConfigs'
    | 'activeWebDAVConfig'
    | 'lastBackup'
    | 'releases'
    | 'customCategories'
    | 'hiddenDefaultCategoryIds'
    | 'defaultCategoryOverrides'
    | 'categoryOrder'
    | 'collapsedSidebarCategoryCount'
    | 'assetFilters'
    | 'theme'
    | 'currentView'
    | 'selectedCategory'
    | 'language'
    | 'searchFilters'
    | 'isSidebarCollapsed'
    | 'releaseViewMode'
    | 'releaseSelectedFilters'
    | 'releaseSearchQuery'
    | 'discoveryRepos'
    | 'discoveryLastRefresh'
    | 'discoveryTotalCount'
    | 'discoveryHasMore'
    | 'discoveryNextPage'
    | 'discoveryCurrentPage'
    | 'selectedDiscoveryChannel'
    | 'discoveryChannels'
    | 'discoveryPlatform'
    | 'discoveryLanguage'
    | 'trendingParams'
    | 'topicParams'
    | 'searchParams'
    | 'rssTimeRange'
    | 'subscriptionRepos'
    | 'subscriptionLastRefresh'
    | 'subscriptionIsLoading'
    | 'subscriptionChannels'
  >
> & {
  releaseSubscriptions?: unknown;
  readReleases?: unknown;
  releaseExpandedRepositories?: unknown;
};

const normalizeNumberSet = (value: unknown): Set<number> => {
  if (value instanceof Set) {
    return new Set(Array.from(value).filter((item): item is number => typeof item === 'number'));
  }

  if (Array.isArray(value)) {
    return new Set(value.filter((item): item is number => typeof item === 'number'));
  }

  return new Set<number>();
};

const normalizePersistedState = (
  persisted: PersistedAppState | undefined,
  currentState: AppState & AppActions
): Partial<AppState & AppActions> => {
  const safePersisted = persisted ?? {};

  const repositories = Array.isArray(safePersisted.repositories) ? safePersisted.repositories : [];
  const releases = Array.isArray(safePersisted.releases) ? safePersisted.releases : [];

  return {
    ...currentState,
    ...safePersisted,
    repositories,
    releases,
    searchResults: repositories,
    releaseSubscriptions: normalizeNumberSet(safePersisted.releaseSubscriptions),
    readReleases: normalizeNumberSet(safePersisted.readReleases),
    releaseExpandedRepositories: normalizeNumberSet(safePersisted.releaseExpandedRepositories),
    searchFilters: {
      ...initialSearchFilters,
      ...safePersisted.searchFilters,
      sortBy: safePersisted.searchFilters?.sortBy || 'stars',
      sortOrder: safePersisted.searchFilters?.sortOrder || 'desc',
    },
    webdavConfigs: Array.isArray(safePersisted.webdavConfigs) ? safePersisted.webdavConfigs : [],
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
    assetFilters: Array.isArray(safePersisted.assetFilters) && safePersisted.assetFilters.length > 0 ? safePersisted.assetFilters : defaultPresetFilters,
    language: safePersisted.language || 'zh',
    isAuthenticated: !!(safePersisted.user && safePersisted.githubToken),
    releaseViewMode: safePersisted.releaseViewMode || 'timeline',
    releaseSelectedFilters: Array.isArray(safePersisted.releaseSelectedFilters) ? safePersisted.releaseSelectedFilters : [],
    releaseSearchQuery: typeof safePersisted.releaseSearchQuery === 'string' ? safePersisted.releaseSearchQuery : '',
    discoveryRepos: (() => {
      const persisted = (safePersisted as Record<string, unknown>).discoveryRepos as Record<DiscoveryChannelId, DiscoveryRepo[]>;
      const defaults: Record<DiscoveryChannelId, DiscoveryRepo[]> = { trending: [], topic: [], search: [], 'rss-trending': [] };
      return { ...defaults, ...persisted };
    })(),
    discoveryLastRefresh: (() => {
      const persisted = (safePersisted as Record<string, unknown>).discoveryLastRefresh;
      if (persisted && typeof persisted === 'object' && !Array.isArray(persisted)) {
        return persisted as Record<string, string | null>;
      }
      return { 'trending': null, 'topic': null, 'search': null, 'rss-trending': null };
    })(),
    discoveryTotalCount: (() => {
        const persisted = (safePersisted as Record<string, unknown>).discoveryTotalCount;
        if (persisted && typeof persisted === 'object' && !Array.isArray(persisted)) {
          return persisted as Record<string, number>;
        }
        return { 'trending': 0, 'topic': 0, 'search': 0, 'rss-trending': 0 };
      })(),
      discoveryCurrentPage: (() => {
        const persisted = (safePersisted as Record<string, unknown>).discoveryCurrentPage;
        if (persisted && typeof persisted === 'object' && !Array.isArray(persisted)) {
          return persisted as Record<string, number>;
        }
        return { 'trending': 1, 'topic': 1, 'search': 1, 'rss-trending': 1 };
      })(),
    rssTimeRange: (() => {
      const persisted = (safePersisted as Record<string, unknown>).rssTimeRange;
      const validValues = ['daily', 'weekly', 'monthly'];
      if (typeof persisted === 'string' && validValues.includes(persisted)) {
        return persisted as RSSTimeRange;
      }
      return 'daily' as RSSTimeRange;
    })(),
    trendingParams: (() => {
      const persisted = (safePersisted as Record<string, unknown>).trendingParams;
      const validTimeRanges = ['weekly-hot', 'monthly-trending', 'new-stars', 'classic', 'quarterly'];
      const validSortBy = ['Stars', 'Forks', 'Updated'];
      const validMinStars = [100, 500, 1000, 5000, 10000];
      const defaults = { timeRange: 'monthly-trending' as const, language: 'All' as const, minStars: 100, sortBy: 'Stars' as const, sortOrder: 'Desc' as const };
      if (persisted && typeof persisted === 'object' && !Array.isArray(persisted)) {
        const tp = persisted as Record<string, unknown>;
        if (tp.projectType) delete tp.projectType;
        const timeRange = validTimeRanges.includes(tp.timeRange as string) ? tp.timeRange as TrendingTimeRange : defaults.timeRange;
        const minStars = validMinStars.includes(tp.minStars as number) ? tp.minStars as number : defaults.minStars;
        const sortBy = validSortBy.includes(tp.sortBy as string) ? tp.sortBy as DiscoverySortBy : defaults.sortBy;
        return { timeRange, language: (tp.language as ProgrammingLanguage) || defaults.language, minStars, sortBy, sortOrder: defaults.sortOrder };
      }
      return defaults;
    })(),
    // 确保 subscription 相关状态包含 trending 键
    subscriptionRepos: (() => {
      const defaults = { 'most-stars': [], 'most-forks': [], 'most-dev': [], 'trending': [] };
      const persisted = safePersisted.subscriptionRepos;
      if (persisted && typeof persisted === 'object' && !Array.isArray(persisted)) {
        return { ...defaults, ...persisted } as Record<string, SubscriptionRepo[]>;
      }
      return defaults as Record<string, SubscriptionRepo[]>;
    })(),
    subscriptionLastRefresh: (() => {
      const defaults = { 'most-stars': null, 'most-forks': null, 'most-dev': null, 'trending': null };
      const persisted = safePersisted.subscriptionLastRefresh;
      if (persisted && typeof persisted === 'object' && !Array.isArray(persisted)) {
        return { ...defaults, ...persisted } as Record<string, string | null>;
      }
      return defaults as Record<string, string | null>;
    })(),
    subscriptionIsLoading: (() => {
      const defaults = { 'most-stars': false, 'most-forks': false, 'most-dev': false, 'trending': false };
      const persisted = safePersisted.subscriptionIsLoading;
      if (persisted && typeof persisted === 'object' && !Array.isArray(persisted)) {
        return { ...defaults, ...persisted } as Record<string, boolean>;
      }
      return defaults as Record<string, boolean>;
    })(),
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
  };
};

const defaultCategories: Category[] = [
  {
    id: 'all',
    name: '全部分类',
    icon: '📁',
    keywords: []
  },
  {
    id: 'web',
    name: 'Web应用',
    icon: '🌐',
    keywords: ['web应用', 'web', 'website', 'frontend', 'react', 'vue', 'angular']
  },
  {
    id: 'mobile',
    name: '移动应用',
    icon: '📱',
    keywords: ['移动应用', 'mobile', 'android', 'ios', 'flutter', 'react-native']
  },
  {
    id: 'desktop',
    name: '桌面应用',
    icon: '💻',
    keywords: ['桌面应用', 'desktop', 'electron', 'gui', 'qt', 'gtk']
  },
  {
    id: 'database',
    name: '数据库',
    icon: '🗄️',
    keywords: ['数据库', 'database', 'sql', 'nosql', 'mongodb', 'mysql', 'postgresql']
  },
  {
    id: 'ai',
    name: 'AI/机器学习',
    icon: '🤖',
    keywords: ['ai工具', 'ai', 'ml', 'machine learning', 'deep learning', 'neural']
  },
  {
    id: 'devtools',
    name: '开发工具',
    icon: '🔧',
    keywords: ['开发工具', 'tool', 'cli', 'build', 'deploy', 'debug', 'test', 'automation']
  },
  {
    id: 'security',
    name: '安全工具',
    icon: '🛡️',
    keywords: ['安全工具', 'security', 'encryption', 'auth', 'vulnerability']
  },
  {
    id: 'game',
    name: '游戏',
    icon: '🎮',
    keywords: ['游戏', 'game', 'gaming', 'unity', 'unreal', 'godot']
  },
  {
    id: 'design',
    name: '设计工具',
    icon: '🎨',
    keywords: ['设计工具', 'design', 'ui', 'ux', 'graphics', 'image']
  },
  {
    id: 'productivity',
    name: '效率工具',
    icon: '⚡',
    keywords: ['效率工具', 'productivity', 'note', 'todo', 'calendar', 'task']
  },
  {
    id: 'education',
    name: '教育学习',
    icon: '📚',
    keywords: ['教育学习', 'education', 'learning', 'tutorial', 'course']
  },
  {
    id: 'social',
    name: '社交网络',
    icon: '👥',
    keywords: ['社交网络', 'social', 'chat', 'messaging', 'communication']
  },
  {
    id: 'analytics',
    name: '数据分析',
    icon: '📊',
    keywords: ['数据分析', 'analytics', 'data', 'visualization', 'chart']
  }
];

// 导出默认分类供其他模块使用
export { defaultCategories };

// 预设筛选器图标映射
const PRESET_FILTER_ICONS: Record<string, string> = {
  'preset-windows': 'Monitor',
  'preset-macos': 'Apple',
  'preset-linux': 'Terminal',
  'preset-android': 'Smartphone',
  'preset-source': 'Package',
};

// 默认预设筛选器
const defaultPresetFilters: AssetFilter[] = PRESET_FILTERS.map(pf => ({
  ...pf,
  isPreset: true,
  icon: PRESET_FILTER_ICONS[pf.id] || 'Package',
}));

const defaultDiscoveryChannels: DiscoveryChannel[] = [
  {
    id: 'trending',
    name: '仓库探索',
    nameEn: 'Repository Discovery',
    icon: 'trending',
    description: '发现热门项目，支持新项目/活跃项目/经典项目筛选，可自定义时间范围和排序方式',
    enabled: true,
  },
  {
    id: 'topic',
    name: '专题浏览',
    nameEn: 'Topics',
    icon: 'tag',
    description: '按技术主题分类浏览优质项目',
    enabled: true,
  },
  {
    id: 'search',
    name: '搜索',
    nameEn: 'Search',
    icon: 'search',
    description: '自定义关键词搜索发现新项目',
    enabled: true,
  },
  {
    id: 'rss-trending',
    name: 'RSS 趋势',
    nameEn: 'RSS Trending',
    icon: 'rss',
    description: '通过 RSS 订阅获取 GitHub Trending 仓库（今日/本周/本月）',
    enabled: true,
  },
];

const store = create<AppState & AppActions>()(
  persist(
    (set) => ({
      // Initial state
      user: null,
      githubToken: null,
      isAuthenticated: false,
      repositories: [],
      isLoading: false,
      lastSync: null,
      analyzingRepositoryIds: new Set<number>(),
      aiConfigs: [],
      activeAIConfig: null,
      webdavConfigs: [],
      activeWebDAVConfig: null,
      lastBackup: null,
      searchFilters: initialSearchFilters,
      searchResults: [],
      releases: [],
      releaseSubscriptions: new Set<number>(),
      readReleases: new Set<number>(),
      customCategories: [],
      hiddenDefaultCategoryIds: [],
      defaultCategoryOverrides: {},
      categoryOrder: [],
      collapsedSidebarCategoryCount: 20,
      assetFilters: defaultPresetFilters,
      theme: 'light',
      currentView: 'repositories',
      selectedCategory: 'all',
      language: 'zh',
      updateNotification: null,
      analysisProgress: { current: 0, total: 0 },
      backendApiSecret: readSessionBackendSecret(),
      isSidebarCollapsed: false,
      releaseViewMode: 'timeline',
      releaseSelectedFilters: [],
      releaseSearchQuery: '',
      releaseExpandedRepositories: new Set<number>(),
      releaseIsRefreshing: false,

      discoveryChannels: defaultDiscoveryChannels,
      discoveryRepos: { 'trending': [], 'topic': [], 'search': [], 'rss-trending': [] },
      discoveryLastRefresh: { 'trending': null, 'topic': null, 'search': null, 'rss-trending': null },
      discoveryIsLoading: { 'trending': false, 'topic': false, 'search': false, 'rss-trending': false },
      selectedDiscoveryChannel: 'trending',
      discoveryPlatform: 'All',
      discoveryLanguage: 'All',
      discoverySearchQuery: '',
      discoverySelectedTopic: null,
      discoveryHasMore: { 'trending': false, 'topic': false, 'search': false, 'rss-trending': false },
      discoveryNextPage: { 'trending': 1, 'topic': 1, 'search': 1, 'rss-trending': 1 },
      discoveryTotalCount: { 'trending': 0, 'topic': 0, 'search': 0, 'rss-trending': 0 },
      discoveryScrollPositions: { 'trending': 0, 'topic': 0, 'search': 0, 'rss-trending': 0 },
      discoveryCurrentPage: { 'trending': 1, 'topic': 1, 'search': 1, 'rss-trending': 1 },
      trendingParams: { timeRange: 'monthly-trending', language: 'All', minStars: 100, sortBy: 'Stars', sortOrder: 'Desc' },
      topicParams: { sortBy: 'Stars', sortOrder: 'Desc' },
      searchParams: { sortBy: 'BestMatch', sortOrder: 'Desc' },
      rssTimeRange: 'daily',

      // Subscription
      subscriptionRepos: { 'most-stars': [], 'most-forks': [], 'most-dev': [], 'trending': [] },
      subscriptionLastRefresh: { 'most-stars': null, 'most-forks': null, 'most-dev': null, 'trending': null },
      subscriptionIsLoading: { 'most-stars': false, 'most-forks': false, 'most-dev': false, 'trending': false },
      subscriptionChannels: defaultSubscriptionChannels,

      // Auth actions
      setUser: (user) => {
        console.log('Setting user:', user);
        set({ user, isAuthenticated: !!user });
      },
      setGitHubToken: (token) => {
        console.log('Setting GitHub token:', !!token);
        set({ githubToken: token });
      },
      logout: () => set({
        user: null,
        githubToken: null,
        isAuthenticated: false,
        repositories: [],
        releases: [],
        releaseSubscriptions: new Set(),
        readReleases: new Set(),
        analyzingRepositoryIds: new Set(),
        searchResults: [],
        lastSync: null,
      }),

      // Repository actions
      setRepositories: (repositories) => set({ repositories, searchResults: repositories }),
      updateRepository: (repo) => set((state) => {
        const updatedRepositories = state.repositories.map(r => r.id === repo.id ? repo : r);
        return {
          repositories: updatedRepositories,
          searchResults: state.searchResults.map(r => r.id === repo.id ? repo : r)
        };
      }),
      addRepository: (repo) => set((state) => {
        // 检查是否已存在相同 full_name 的仓库
        const existingRepoIndex = state.repositories.findIndex(r => r.full_name === repo.full_name);
        let updatedRepositories;
        
        if (existingRepoIndex >= 0) {
          // 如果存在，更新现有仓库（保留ID）
          updatedRepositories = [...state.repositories];
          updatedRepositories[existingRepoIndex] = {
            ...repo,
            id: updatedRepositories[existingRepoIndex].id,
            // 保留自定义编辑的内容
            custom_description: updatedRepositories[existingRepoIndex].custom_description,
            custom_tags: updatedRepositories[existingRepoIndex].custom_tags,
            custom_category: updatedRepositories[existingRepoIndex].custom_category,
            category_locked: updatedRepositories[existingRepoIndex].category_locked,
            last_edited: updatedRepositories[existingRepoIndex].last_edited,
            subscribed_to_releases: updatedRepositories[existingRepoIndex].subscribed_to_releases,
          };
        } else {
          // 如果不存在，添加新仓库（生成新ID）
          // 使用 timestamp + random 确保唯一性，避免并发时的竞态条件
          const timestamp = Date.now();
          const random = Math.floor(Math.random() * 10000);
          const maxExistingId = state.repositories.length > 0
            ? Math.max(...state.repositories.map(r => r.id))
            : 0;
          const newId = Math.max(timestamp, maxExistingId + 1) + random;
          updatedRepositories = [...state.repositories, { ...repo, id: newId }];
        }
        
        return {
          repositories: updatedRepositories,
          searchResults: updatedRepositories
        };
      }),
      setLoading: (isLoading) => set({ isLoading }),
      setLastSync: (lastSync) => set({ lastSync }),
      deleteRepository: (repoId) => set((state) => {
        const nextReleaseSubscriptions = new Set(state.releaseSubscriptions);
        nextReleaseSubscriptions.delete(repoId);

        const filteredReleases = state.releases.filter(release => release.repository.id !== repoId);
        const remainingReleaseIds = new Set(filteredReleases.map(release => release.id));
        const nextReadReleases = new Set(
          Array.from(state.readReleases).filter(releaseId => remainingReleaseIds.has(releaseId))
        );

        return {
          repositories: state.repositories.filter(r => r.id !== repoId),
          searchResults: state.searchResults.filter(r => r.id !== repoId),
          releases: filteredReleases,
          releaseSubscriptions: nextReleaseSubscriptions,
          readReleases: nextReadReleases,
        };
      }),
      setAnalyzingRepository: (repoId, isAnalyzing) => set((state) => {
        const nextAnalyzingIds = new Set(state.analyzingRepositoryIds);
        if (isAnalyzing) {
          nextAnalyzingIds.add(repoId);
        } else {
          nextAnalyzingIds.delete(repoId);
        }
        return { analyzingRepositoryIds: nextAnalyzingIds };
      }),

      // AI actions
      addAIConfig: (config) => set((state) => ({
        aiConfigs: [...state.aiConfigs, config]
      })),
      updateAIConfig: (id, updates) => set((state) => ({
        aiConfigs: state.aiConfigs.map(config => 
          config.id === id ? { ...config, ...updates } : config
        )
      })),
      deleteAIConfig: (id) => set((state) => ({
        aiConfigs: state.aiConfigs.filter(config => config.id !== id),
        activeAIConfig: state.activeAIConfig === id ? null : state.activeAIConfig
      })),
      setActiveAIConfig: (activeAIConfig) => set({ activeAIConfig }),
      setAIConfigs: (aiConfigs) => set({ aiConfigs }),

      // WebDAV actions
      addWebDAVConfig: (config) => set((state) => ({
        webdavConfigs: [...state.webdavConfigs, config]
      })),
      updateWebDAVConfig: (id, updates) => set((state) => ({
        webdavConfigs: state.webdavConfigs.map(config => 
          config.id === id ? { ...config, ...updates } : config
        )
      })),
      deleteWebDAVConfig: (id) => set((state) => ({
        webdavConfigs: state.webdavConfigs.filter(config => config.id !== id),
        activeWebDAVConfig: state.activeWebDAVConfig === id ? null : state.activeWebDAVConfig
      })),
      setActiveWebDAVConfig: (activeWebDAVConfig) => set({ activeWebDAVConfig }),
      setWebDAVConfigs: (webdavConfigs) => set({ webdavConfigs }),
      setLastBackup: (lastBackup) => set({ lastBackup }),

      // Search actions
      setSearchFilters: (filters) => set((state) => {
        const newFilters = { ...state.searchFilters, ...filters };
        
        // 处理互斥筛选器：isAnalyzed 和 analysisFailed 不能同时设置
        if (filters.isAnalyzed !== undefined && filters.isAnalyzed !== null) {
          // 如果设置了 isAnalyzed，清除 analysisFailed
          newFilters.analysisFailed = undefined;
        }
        if (filters.analysisFailed !== undefined && filters.analysisFailed !== null) {
          // 如果设置了 analysisFailed，清除 isAnalyzed
          newFilters.isAnalyzed = undefined;
        }
        
        return { searchFilters: newFilters };
      }),
      setSearchResults: (searchResults) => set({ searchResults }),

      // Release actions
      setReleases: (releases) => set({ releases }),
      addReleases: (newReleases) => set((state) => {
        const existingIds = new Set(state.releases.map(r => r.id));
        const uniqueReleases = newReleases.filter(r => !existingIds.has(r.id));
        return { releases: [...state.releases, ...uniqueReleases] };
      }),
      toggleReleaseSubscription: (repoId) => set((state) => {
        const newSubscriptions = new Set(state.releaseSubscriptions);
        const wasSubscribed = newSubscriptions.has(repoId);
        
        if (wasSubscribed) {
          newSubscriptions.delete(repoId);
        } else {
          newSubscriptions.add(repoId);
        }
        
        return { releaseSubscriptions: newSubscriptions };
      }),
      batchUnsubscribeReleases: (repoIds) => set((state) => {
        const newSubscriptions = new Set(state.releaseSubscriptions);
        repoIds.forEach(repoId => {
          newSubscriptions.delete(repoId);
        });
        return { releaseSubscriptions: newSubscriptions };
      }),
      removeReleasesByRepoId: (repoId) => set((state) => {
        const filteredReleases = state.releases.filter(release => release.repository.id !== repoId);
        const remainingReleaseIds = new Set(filteredReleases.map(r => r.id));
        const nextReadReleases = new Set(
          Array.from(state.readReleases).filter(releaseId => remainingReleaseIds.has(releaseId))
        );
        const nextExpandedRepos = new Set(state.releaseExpandedRepositories);
        nextExpandedRepos.delete(repoId);
        return {
          releases: filteredReleases,
          readReleases: nextReadReleases,
          releaseExpandedRepositories: nextExpandedRepos,
        };
      }),
      markReleaseAsRead: (releaseId) => set((state) => {
        const newReadReleases = new Set(state.readReleases);
        newReadReleases.add(releaseId);
        return { readReleases: newReadReleases };
      }),
      markAllReleasesAsRead: () => set((state) => {
        const allReleaseIds = new Set(state.releases.map(r => r.id));
        return { readReleases: allReleaseIds };
      }),

      // Category actions
      addCustomCategory: (category) => set((state) => ({
        customCategories: [...state.customCategories, { ...category, isCustom: true }]
      })),
      updateCustomCategory: (id, updates) => set((state) => {
        const targetCategory = state.customCategories.find(category => category.id === id);
        const nextCategories = state.customCategories.map(category => 
          category.id === id ? { ...category, ...updates } : category
        );

        if (!targetCategory || !updates.name || updates.name === targetCategory.name) {
          return { customCategories: nextCategories };
        }

        const nextRepositories = state.repositories.map(repo =>
          repo.custom_category === targetCategory.name
            ? { ...repo, custom_category: updates.name, last_edited: new Date().toISOString() }
            : repo
        );

        return {
          customCategories: nextCategories,
          repositories: nextRepositories,
          searchResults: state.searchResults.map(repo =>
            repo.custom_category === targetCategory.name
              ? { ...repo, custom_category: updates.name, last_edited: new Date().toISOString() }
              : repo
          )
        };
      }),
      updateDefaultCategory: (id, updates) => set((state) => {
        const defaultCat = defaultCategories.find(c => c.id === id);
        if (!defaultCat) return {};

        const originalName = defaultCat.name;
        const displayedName = state.language === 'en' ? translateCategoryName(originalName) : originalName;
        const originalIcon = defaultCat.icon;
        const originalKeywords = defaultCat.keywords || [];
        const currentOverride = state.defaultCategoryOverrides[id];
        const currentName = currentOverride?.name || originalName;
        const newName = updates.name;

        const filteredUpdates: { name?: string; icon?: string; keywords?: string[] } = {};
        
        if (updates.name !== undefined && updates.name !== '' && updates.name !== originalName && updates.name !== displayedName) {
          filteredUpdates.name = updates.name;
        }
        if (updates.icon !== undefined && updates.icon !== originalIcon) {
          filteredUpdates.icon = updates.icon;
        }
        if (updates.keywords !== undefined) {
          const sortedOriginal = [...originalKeywords].sort().join(',');
          const sortedNew = [...updates.keywords].sort().join(',');
          if (sortedNew !== sortedOriginal) {
            filteredUpdates.keywords = updates.keywords;
          }
        }

        const existingOverride = state.defaultCategoryOverrides[id] || {};
        const mergedOverride = { ...existingOverride, ...filteredUpdates };
        
        for (const key of ['name', 'icon', 'keywords'] as const) {
          if (key in mergedOverride) {
            if (key === 'keywords') {
              const sortedOriginal = [...originalKeywords].sort().join(',');
              const sortedMerged = [...(mergedOverride.keywords || [])].sort().join(',');
              if (sortedMerged === sortedOriginal) {
                delete mergedOverride.keywords;
              }
            } else if (key === 'name' && (mergedOverride.name === originalName || mergedOverride.name === displayedName || mergedOverride.name === '')) {
              delete mergedOverride.name;
            } else if (key === 'icon' && mergedOverride.icon === originalIcon) {
              delete mergedOverride.icon;
            }
          }
        }

        const nextOverrides = { ...state.defaultCategoryOverrides };
        if (Object.keys(mergedOverride).length === 0) {
          delete nextOverrides[id];
        } else {
          nextOverrides[id] = mergedOverride;
        }

        const currentDisplayedName = currentOverride?.name ?? displayedName;
        if (!newName || newName === currentName || newName === currentDisplayedName) {
          return { defaultCategoryOverrides: nextOverrides };
        }

        const currentNameVariants = getCategoryNameVariants(originalName, currentName);
        // Avoid self-rewrite when newName already matches the displayed default name.

        const nextRepositories = state.repositories.map(repo =>
          currentNameVariants.includes(repo.custom_category || '')
            ? { ...repo, custom_category: newName, last_edited: new Date().toISOString() }
            : repo
        );

        return {
          defaultCategoryOverrides: nextOverrides,
          repositories: nextRepositories,
          searchResults: state.searchResults.map(repo =>
            currentNameVariants.includes(repo.custom_category || '')
              ? { ...repo, custom_category: newName, last_edited: new Date().toISOString() }
              : repo
          )
        };
      }),
      resetDefaultCategory: (id) => set((state) => {
        const defaultCat = defaultCategories.find(c => c.id === id);
        if (!defaultCat) return {};

        const override = state.defaultCategoryOverrides[id];
        if (!override) return {};

        const overriddenName = override.name;
        const originalName = defaultCat.name;

        const nextOverrides = { ...state.defaultCategoryOverrides };
        delete nextOverrides[id];

        if (!overriddenName || overriddenName === originalName) {
          return { defaultCategoryOverrides: nextOverrides };
        }

        const overriddenNameVariants = getCategoryNameVariants(originalName, overriddenName);

        const nextRepositories = state.repositories.map(repo =>
          overriddenNameVariants.includes(repo.custom_category || '')
            ? { ...repo, custom_category: originalName, last_edited: new Date().toISOString() }
            : repo
        );

        return {
          defaultCategoryOverrides: nextOverrides,
          repositories: nextRepositories,
          searchResults: state.searchResults.map(repo =>
            overriddenNameVariants.includes(repo.custom_category || '')
              ? { ...repo, custom_category: originalName, last_edited: new Date().toISOString() }
              : repo
          )
        };
      }),
      resetDefaultCategoryNameIcon: (id) => set((state) => {
        const defaultCat = defaultCategories.find(c => c.id === id);
        if (!defaultCat) return {};

        const override = state.defaultCategoryOverrides[id];
        if (!override) return {};

        const overriddenName = override.name;
        const originalName = defaultCat.name;

        const nextOverride = { ...override };
        delete nextOverride.name;
        delete nextOverride.icon;

        const nextOverrides = { ...state.defaultCategoryOverrides };
        if (Object.keys(nextOverride).length === 0) {
          delete nextOverrides[id];
        } else {
          nextOverrides[id] = nextOverride;
        }

        if (!overriddenName || overriddenName === originalName) {
          return { defaultCategoryOverrides: nextOverrides };
        }

        const overriddenNameVariants = getCategoryNameVariants(originalName, overriddenName);

        const nextRepositories = state.repositories.map(repo =>
          overriddenNameVariants.includes(repo.custom_category || '')
            ? { ...repo, custom_category: originalName, last_edited: new Date().toISOString() }
            : repo
        );

        return {
          defaultCategoryOverrides: nextOverrides,
          repositories: nextRepositories,
          searchResults: state.searchResults.map(repo =>
            overriddenNameVariants.includes(repo.custom_category || '')
              ? { ...repo, custom_category: originalName, last_edited: new Date().toISOString() }
              : repo
          )
        };
      }),
      resetDefaultCategoryKeywords: (id) => set((state) => {
        const override = state.defaultCategoryOverrides[id];
        if (!override) return {};

        const nextOverride = { ...override };
        delete nextOverride.keywords;

        const nextOverrides = { ...state.defaultCategoryOverrides };
        if (Object.keys(nextOverride).length === 0) {
          delete nextOverrides[id];
        } else {
          nextOverrides[id] = nextOverride;
        }

        return { defaultCategoryOverrides: nextOverrides };
      }),
      deleteCustomCategory: (id) => set((state) => {
        const targetCategory = state.customCategories.find(category => category.id === id);
        const nextSelectedCategory = state.selectedCategory === id ? 'all' : state.selectedCategory;

        if (!targetCategory) {
          return {
            customCategories: state.customCategories.filter(category => category.id !== id),
            selectedCategory: nextSelectedCategory
          };
        }

        const clearedRepositories = state.repositories.map(repo =>
          repo.custom_category === targetCategory.name
            ? { ...repo, custom_category: undefined, category_locked: false, last_edited: new Date().toISOString() }
            : repo
        );

        return {
          customCategories: state.customCategories.filter(category => category.id !== id),
          repositories: clearedRepositories,
          searchResults: state.searchResults.map(repo =>
            repo.custom_category === targetCategory.name
              ? { ...repo, custom_category: undefined, category_locked: false, last_edited: new Date().toISOString() }
              : repo
          ),
          selectedCategory: nextSelectedCategory
        };
      }),
      hideDefaultCategory: (id) => set((state) => ({
        hiddenDefaultCategoryIds: state.hiddenDefaultCategoryIds.includes(id)
          ? state.hiddenDefaultCategoryIds
          : [...state.hiddenDefaultCategoryIds, id],
        selectedCategory: state.selectedCategory === id ? 'all' : state.selectedCategory
      })),
      showDefaultCategory: (id) => set((state) => ({
        hiddenDefaultCategoryIds: state.hiddenDefaultCategoryIds.filter(categoryId => categoryId !== id)
      })),
      setCategoryOrder: (order) => set({ categoryOrder: order }),
      reorderCategories: (oldIndex, newIndex) => set((state) => {
        const allCategories = getAllCategories(state.customCategories, state.language, state.hiddenDefaultCategoryIds, state.defaultCategoryOverrides);
        const orderedCategories = sortCategoriesByOrder(allCategories, state.categoryOrder);
        const newOrder = orderedCategories.map(c => c.id);
        const [movedId] = newOrder.splice(oldIndex, 1);
        newOrder.splice(newIndex, 0, movedId);
        return { categoryOrder: newOrder };
      }),
      setCollapsedSidebarCategoryCount: (count) => set({ collapsedSidebarCategoryCount: count }),

      // Asset Filter actions
      addAssetFilter: (filter) => set((state) => ({
        assetFilters: [...state.assetFilters, filter]
      })),
      updateAssetFilter: (id, updates) => set((state) => ({
        assetFilters: state.assetFilters.map(filter => 
          filter.id === id ? { ...filter, ...updates } : filter
        )
      })),
      deleteAssetFilter: (id) => set((state) => ({
        assetFilters: state.assetFilters.filter(filter => filter.id !== id)
      })),

      // UI actions
      setTheme: (theme) => set({ theme }),
      setCurrentView: (currentView) => set({ currentView }),
      setSelectedCategory: (selectedCategory) => set({ selectedCategory }),
      setLanguage: (language) => set({ language }),
      setSidebarCollapsed: (isSidebarCollapsed) => set({ isSidebarCollapsed }),
      
      // Update actions
      setUpdateNotification: (notification) => set({ updateNotification: notification }),
      dismissUpdateNotification: () => set({ updateNotification: null }),
      setAnalysisProgress: (newProgress) => set({ analysisProgress: newProgress }),
      setBackendApiSecret: (backendApiSecret) => {
        writeSessionBackendSecret(backendApiSecret);
        set({ backendApiSecret });
      },

      // Release Timeline View actions
      setReleaseViewMode: (releaseViewMode) => set({ releaseViewMode }),
      setReleaseSelectedFilters: (releaseSelectedFilters) => set({ releaseSelectedFilters }),
      toggleReleaseSelectedFilter: (filterId) => set((state) => ({
        releaseSelectedFilters: state.releaseSelectedFilters.includes(filterId)
          ? state.releaseSelectedFilters.filter(id => id !== filterId)
          : [...state.releaseSelectedFilters, filterId]
      })),
      clearReleaseSelectedFilters: () => set({ releaseSelectedFilters: [] }),
      setReleaseSearchQuery: (releaseSearchQuery) => set({ releaseSearchQuery }),
      toggleReleaseExpandedRepository: (repoId) => set((state) => {
        const newSet = new Set(state.releaseExpandedRepositories);
        if (newSet.has(repoId)) {
          newSet.delete(repoId);
        } else {
          newSet.add(repoId);
        }
        return { releaseExpandedRepositories: newSet };
      }),
      setReleaseExpandedRepositories: (releaseExpandedRepositories) => set({ releaseExpandedRepositories }),
      setReleaseIsRefreshing: (releaseIsRefreshing) => set({ releaseIsRefreshing }),

    // Discovery actions
    setSelectedDiscoveryChannel: (selectedDiscoveryChannel) => set({ selectedDiscoveryChannel }),
    setDiscoveryLoading: (channel, loading) => set((state) => ({
      discoveryIsLoading: { ...state.discoveryIsLoading, [channel]: loading },
    })),
    setDiscoveryRepos: (channel, repos, append = false) => set((state) => ({
      discoveryRepos: { 
        ...state.discoveryRepos, 
        [channel]: append ? [...(state.discoveryRepos[channel] || []), ...repos] : repos 
      },
    })),
    setDiscoveryLastRefresh: (channel, timestamp) => set((state) => ({
      discoveryLastRefresh: { ...state.discoveryLastRefresh, [channel]: timestamp },
    })),
    updateDiscoveryRepo: (repo) => set((state) => {
      const channel = repo.channel;
      const channelRepos = state.discoveryRepos[channel] || [];
      return {
        discoveryRepos: {
          ...state.discoveryRepos,
          [channel]: channelRepos.map(r => r.id === repo.id ? repo : r),
        },
      };
    }),
    toggleDiscoveryChannel: (channelId) => set((state) => ({
      discoveryChannels: state.discoveryChannels.map(ch =>
        ch.id === channelId ? { ...ch, enabled: !ch.enabled } : ch
      ),
    })),
    setDiscoveryPlatform: (discoveryPlatform) => set({ discoveryPlatform }),
    setDiscoveryLanguage: (discoveryLanguage) => set({ discoveryLanguage }),
    setDiscoverySearchQuery: (discoverySearchQuery) => set({ discoverySearchQuery }),
    setDiscoverySelectedTopic: (discoverySelectedTopic) => set({ discoverySelectedTopic }),
    setDiscoveryHasMore: (channel, hasMore) => set((state) => ({
      discoveryHasMore: { ...state.discoveryHasMore, [channel]: hasMore },
    })),
    setDiscoveryNextPage: (channel, page) => set((state) => ({
      discoveryNextPage: { ...state.discoveryNextPage, [channel]: page },
    })),
    setDiscoveryTotalCount: (channel, count) => set((state) => ({
      discoveryTotalCount: { ...state.discoveryTotalCount, [channel]: count },
    })),
    setDiscoveryScrollPosition: (channel, position) => set((state) => ({
      discoveryScrollPositions: { ...state.discoveryScrollPositions, [channel]: position },
    })),
    appendDiscoveryRepos: (channel, repos) => set((state) => ({
      discoveryRepos: { 
        ...state.discoveryRepos, 
        [channel]: [...(state.discoveryRepos[channel] || []), ...repos] 
      },
    })),
    setDiscoveryCurrentPage: (channel, page) => set((state) => {
      const validPage = Math.max(1, page);
      console.log(`[Discovery] Set page for ${channel}: ${validPage}`);
      return {
        discoveryCurrentPage: { ...state.discoveryCurrentPage, [channel]: validPage },
      };
    }),
    setTrendingParams: (params) => set((state) => ({
      trendingParams: { ...state.trendingParams, ...params },
    })),
    setTopicParams: (params) => set((state) => ({
      topicParams: { ...state.topicParams, ...params },
    })),
    setSearchParams: (params) => set((state) => ({
      searchParams: { ...state.searchParams, ...params },
    })),
    setRssTimeRange: (timeRange) => set({ rssTimeRange: timeRange }),
  }),
  {
    name: 'github-stars-manager',
      version: 6,
      storage: createJSONStorage(() => indexedDBStorage),
      partialize: (state) => ({
        // 持久化用户信息和认证状态
        user: state.user,
        githubToken: state.githubToken,
        isAuthenticated: state.isAuthenticated,

        // 持久化仓库数据
        repositories: state.repositories,
        lastSync: state.lastSync,

        // 持久化AI配置
        aiConfigs: state.aiConfigs,
        activeAIConfig: state.activeAIConfig,

        // 持久化WebDAV配置
        webdavConfigs: state.webdavConfigs,
        activeWebDAVConfig: state.activeWebDAVConfig,
        lastBackup: state.lastBackup,

        // 持久化Release订阅和已读状态
        releaseSubscriptions: Array.from(state.releaseSubscriptions),
        readReleases: Array.from(state.readReleases),
        releases: state.releases,

        // 持久化自定义分类
        customCategories: state.customCategories,
        hiddenDefaultCategoryIds: state.hiddenDefaultCategoryIds,
        categoryOrder: state.categoryOrder,
        collapsedSidebarCategoryCount: state.collapsedSidebarCategoryCount,
        defaultCategoryOverrides: state.defaultCategoryOverrides,

        // 持久化资源过滤器
        assetFilters: state.assetFilters,

        // 持久化UI设置
        theme: state.theme,
        currentView: state.currentView,
        selectedCategory: state.selectedCategory,
        language: state.language,
        isSidebarCollapsed: state.isSidebarCollapsed,

        // backendApiSecret: 保留在内存中，不持久化（安全考虑）

        // 持久化搜索排序设置
        searchFilters: {
          sortBy: state.searchFilters.sortBy,
          sortOrder: state.searchFilters.sortOrder,
        },

        // 持久化Release页面视图设置
        releaseViewMode: state.releaseViewMode,
        releaseSelectedFilters: state.releaseSelectedFilters,
        releaseSearchQuery: state.releaseSearchQuery,
        releaseExpandedRepositories: Array.from(state.releaseExpandedRepositories),

      // 持久化发现设置
      discoveryChannels: state.discoveryChannels,
      selectedDiscoveryChannel: state.selectedDiscoveryChannel,
      discoveryRepos: state.discoveryRepos,
      discoveryLastRefresh: state.discoveryLastRefresh,
      discoveryTotalCount: state.discoveryTotalCount,
      discoveryHasMore: state.discoveryHasMore,
      discoveryNextPage: state.discoveryNextPage,
      discoveryCurrentPage: state.discoveryCurrentPage,
      discoveryPlatform: state.discoveryPlatform,
      discoveryLanguage: state.discoveryLanguage,
      trendingParams: state.trendingParams,
      topicParams: state.topicParams,
      searchParams: state.searchParams,
      discoverySelectedTopic: state.discoverySelectedTopic,
      rssTimeRange: state.rssTimeRange,
      }),
      migrate: (persistedState, fromVersion) => {
        const CURRENT_STORE_VERSION = 8;
        const state = persistedState as PersistedAppState | undefined;
        
        if (!state) return undefined as unknown as PersistedAppState;
        
        console.log(`Store migration: from version ${fromVersion} to ${CURRENT_STORE_VERSION}`);
        
        // 版本 0-1: 初始化基础字段
        if (fromVersion < 1) {
          if (!Array.isArray(state.categoryOrder)) {
            state.categoryOrder = [];
          }
          if (typeof state.collapsedSidebarCategoryCount !== 'number') {
            state.collapsedSidebarCategoryCount = 20;
          }
          if (typeof state.defaultCategoryOverrides !== 'object') {
            state.defaultCategoryOverrides = {};
          }
        }
        
        // 版本 1-2: 迁移仓库数据中的旧标记
        if (fromVersion < 2 && Array.isArray(state.repositories)) {
          let migratedCount = 0;
          state.repositories = state.repositories.map((repo: Repository) => {
            if (repo.custom_description === '__EMPTY__') {
              migratedCount++;
              return { ...repo, custom_description: '' };
            }
            return repo;
          });
          if (migratedCount > 0) {
            console.log(`Migrated ${migratedCount} repositories: converted '__EMPTY__' to empty string`);
          }
        }
        
        // 版本 2-3: 初始化发现频道选择
        if (fromVersion < 3) {
          if (!state.selectedDiscoveryChannel) {
            state.selectedDiscoveryChannel = 'trending';
          }
        }
        
        // 版本 3-4: 迁移订阅频道
        if (fromVersion < 4) {
          const defaultChannelsMap = new Map(defaultSubscriptionChannels.map(ch => [ch.id, ch]));
          if (!Array.isArray(state.subscriptionChannels)) {
            state.subscriptionChannels = defaultSubscriptionChannels;
          } else {
            state.subscriptionChannels = state.subscriptionChannels.map((ch: unknown) => {
              const chRecord = ch as Record<string, unknown>;
              const defaultCh = defaultChannelsMap.get(chRecord.id as string);
              if (chRecord.id === 'daily-dev' || chRecord.id === 'most-dev') {
                return { ...chRecord, id: 'most-dev', name: '热门开发者', nameEn: 'Top Developers', icon: '👤' } as unknown as SubscriptionChannel;
              }
              if (defaultCh) {
                return {
                  ...(chRecord as Partial<SubscriptionChannel>),
                  name: defaultCh.name,
                  nameEn: (chRecord.nameEn as string) || defaultCh.nameEn || (chRecord.name as string) || defaultCh.nameEn,
                  icon: (chRecord.icon as string) || defaultCh.icon,
                  description: (chRecord.description as string) || defaultCh.description,
                } as unknown as SubscriptionChannel;
              }
              return chRecord as unknown as SubscriptionChannel;
            });
            const hasTrending = state.subscriptionChannels.some((ch: SubscriptionChannel) => ch.id === 'trending');
            if (!hasTrending) {
              state.subscriptionChannels.push({
                id: 'trending',
                name: '热门趋势',
                nameEn: 'Trending',
                icon: 'trending',
                description: 'GitHub 上近期最受关注的项目 Top 10',
                enabled: true,
              } as SubscriptionChannel);
            }
          }
        }
        
        // 版本 4-5: 初始化发现平台和语言
        if (fromVersion < 5) {
          if (!state.discoveryPlatform) {
            state.discoveryPlatform = 'All';
          }
          if (!state.discoveryLanguage) {
            state.discoveryLanguage = 'All';
          }
          // 迁移旧的排序参数到新的参数结构
          if (!state.trendingParams) {
            const oldSortBy = (state as Record<string, unknown>).discoverySortBy as string | undefined;
            const oldSortOrder = (state as Record<string, unknown>).discoverySortOrder as string | undefined;
            const sortBy: DiscoverySortBy = oldSortBy === 'MostStars' ? 'Stars' : oldSortBy === 'MostForks' ? 'Forks' : 'Stars';
            const sortOrder: DiscoverySortOrder = oldSortOrder === 'Ascending' ? 'Asc' : 'Desc';
            state.trendingParams = { timeRange: 'monthly-trending', language: 'All', minStars: 100, sortBy, sortOrder };
            delete (state as Record<string, unknown>).discoverySortBy;
            delete (state as Record<string, unknown>).discoverySortOrder;
          }
          if (!state.topicParams) {
            state.topicParams = { sortBy: 'Stars', sortOrder: 'Desc' };
          }
          if (!state.searchParams) {
            state.searchParams = { sortBy: 'BestMatch', sortOrder: 'Desc' };
          }
          if (!state.discoveryCurrentPage) {
            state.discoveryCurrentPage = { 'trending': 1, 'topic': 1, 'search': 1, 'rss-trending': 1 };
          }
        }
        
        // 版本 5-6: 迁移发现频道
        if (fromVersion < 6) {
          const validChannelIds = new Set(defaultDiscoveryChannels.map(ch => ch.id));
          if (Array.isArray(state.discoveryChannels)) {
            const oldChannels = state.discoveryChannels as Array<{ id: string }>;
            const hasOldChannels = oldChannels.some(ch => ch.id === 'hot-release' || ch.id === 'most-popular');
            if (hasOldChannels) {
              state.discoveryChannels = defaultDiscoveryChannels;
            } else {
              state.discoveryChannels = (oldChannels as DiscoveryChannel[]).filter(ch => validChannelIds.has(ch.id));
            }
          }
        }

        // 版本 6-7: 初始化 RSS 时间范围
        if (fromVersion < 7) {
          const validRSSTimeRanges = ['daily', 'weekly', 'monthly'];
          const persistedRSSRange = (state as Record<string, unknown>).rssTimeRange;
          if (!persistedRSSRange || !validRSSTimeRanges.includes(persistedRSSRange as string)) {
            (state as Record<string, unknown>).rssTimeRange = 'daily';
          }
        }

        // 版本 7-8: 迁移 trendingParams，删除 projectType，合并为场景化 timeRange
        if (fromVersion < 8) {
          const tp = (state as Record<string, unknown>).trendingParams as Record<string, unknown> | undefined;
          if (tp) {
            const oldProjectType = tp.projectType as string | undefined;
            const oldTimeRange = tp.timeRange as string | undefined;
            delete tp.projectType;

            const validTimeRanges = ['weekly-hot', 'monthly-trending', 'new-stars', 'classic', 'quarterly'];
            if (validTimeRanges.includes(oldTimeRange as string)) {
              tp.timeRange = oldTimeRange;
            } else {
              const projectTypeToTimeRange: Record<string, string> = {
                'new': 'new-stars',
                'active': 'monthly-trending',
                'classic': 'classic',
              };
              const timeRangeMap: Record<string, string> = {
                'today': 'weekly-hot',
                'week': 'weekly-hot',
                'month': 'monthly-trending',
                'quarter': 'quarterly',
                'year': 'quarterly',
              };
              if (oldProjectType && projectTypeToTimeRange[oldProjectType]) {
                tp.timeRange = projectTypeToTimeRange[oldProjectType];
              } else if (oldTimeRange && timeRangeMap[oldTimeRange]) {
                tp.timeRange = timeRangeMap[oldTimeRange];
              } else {
                tp.timeRange = 'monthly-trending';
              }
            }

            const validMinStars = [100, 500, 1000, 5000, 10000];
            if (!validMinStars.includes(tp.minStars as number)) {
              const oldMinStars = tp.minStars as number;
              if (oldMinStars <= 100) tp.minStars = 100;
              else if (oldMinStars <= 500) tp.minStars = 500;
              else if (oldMinStars <= 1000) tp.minStars = 1000;
              else if (oldMinStars <= 5000) tp.minStars = 5000;
              else tp.minStars = 10000;
            }

            const validSortBy = ['Stars', 'Forks', 'Updated'];
            if (!validSortBy.includes(tp.sortBy as string)) {
              tp.sortBy = 'Stars';
            }
            tp.sortOrder = 'Desc';
          }
        }

        // 迁移 discovery 相关状态：确保所有频道键存在
        if (state) {
          const discoveryChannels = ['trending', 'topic', 'search', 'rss-trending'] as const;
          const defaultDiscoveryRepos = { 'trending': [], 'topic': [], 'search': [], 'rss-trending': [] };
          const defaultDiscoveryLastRefresh = { 'trending': null, 'topic': null, 'search': null, 'rss-trending': null };
          const defaultDiscoveryIsLoading = { 'trending': false, 'topic': false, 'search': false, 'rss-trending': false };
          const defaultDiscoveryHasMore = { 'trending': false, 'topic': false, 'search': false, 'rss-trending': false };
          const defaultDiscoveryTotalCount = { 'trending': 0, 'topic': 0, 'search': 0, 'rss-trending': 0 };
          const defaultDiscoveryCurrentPage = { 'trending': 1, 'topic': 1, 'search': 1, 'rss-trending': 1 };

          if (!state.discoveryRepos || typeof state.discoveryRepos !== 'object') {
            console.log('Migrating: initializing discoveryRepos');
            state.discoveryRepos = defaultDiscoveryRepos;
          } else {
            for (const ch of discoveryChannels) {
              if (!(ch in (state.discoveryRepos as Record<string, unknown>))) {
                console.log(`Migrating: adding missing key ${ch} to discoveryRepos`);
                (state.discoveryRepos as Record<string, unknown>)[ch] = [];
              }
            }
          }

          if (!state.discoveryLastRefresh || typeof state.discoveryLastRefresh !== 'object') {
            console.log('Migrating: initializing discoveryLastRefresh');
            state.discoveryLastRefresh = defaultDiscoveryLastRefresh;
          } else {
            for (const ch of discoveryChannels) {
              if (!(ch in (state.discoveryLastRefresh as Record<string, unknown>))) {
                console.log(`Migrating: adding missing key ${ch} to discoveryLastRefresh`);
                (state.discoveryLastRefresh as Record<string, unknown>)[ch] = null;
              }
            }
          }

          if (!state.discoveryIsLoading || typeof state.discoveryIsLoading !== 'object') {
            console.log('Migrating: initializing discoveryIsLoading');
            state.discoveryIsLoading = defaultDiscoveryIsLoading;
          } else {
            for (const ch of discoveryChannels) {
              if (!(ch in (state.discoveryIsLoading as Record<string, unknown>))) {
                console.log(`Migrating: adding missing key ${ch} to discoveryIsLoading`);
                (state.discoveryIsLoading as Record<string, unknown>)[ch] = false;
              }
            }
          }

          if (!state.discoveryHasMore || typeof state.discoveryHasMore !== 'object') {
            console.log('Migrating: initializing discoveryHasMore');
            state.discoveryHasMore = defaultDiscoveryHasMore;
          } else {
            for (const ch of discoveryChannels) {
              if (!(ch in (state.discoveryHasMore as Record<string, unknown>))) {
                console.log(`Migrating: adding missing key ${ch} to discoveryHasMore`);
                (state.discoveryHasMore as Record<string, unknown>)[ch] = false;
              }
            }
          }

          if (!state.discoveryTotalCount || typeof state.discoveryTotalCount !== 'object') {
            console.log('Migrating: initializing discoveryTotalCount');
            state.discoveryTotalCount = defaultDiscoveryTotalCount;
          } else {
            for (const ch of discoveryChannels) {
              if (!(ch in (state.discoveryTotalCount as Record<string, unknown>))) {
                console.log(`Migrating: adding missing key ${ch} to discoveryTotalCount`);
                (state.discoveryTotalCount as Record<string, unknown>)[ch] = 0;
              }
            }
          }

          if (!state.discoveryCurrentPage || typeof state.discoveryCurrentPage !== 'object') {
            console.log('Migrating: initializing discoveryCurrentPage');
            state.discoveryCurrentPage = defaultDiscoveryCurrentPage;
          } else {
            for (const ch of discoveryChannels) {
              if (!(ch in (state.discoveryCurrentPage as Record<string, unknown>))) {
                console.log(`Migrating: adding missing key ${ch} to discoveryCurrentPage`);
                (state.discoveryCurrentPage as Record<string, unknown>)[ch] = 1;
              }
            }
          }

          if (!state.selectedDiscoveryChannel) {
            state.selectedDiscoveryChannel = 'trending';
          }
        }

        return state as PersistedAppState;
      },
      merge: (persistedState, currentState) => {
        const normalized = normalizePersistedState(
          persistedState as PersistedAppState | undefined,
          currentState as AppState & AppActions
        );

        console.log('Store rehydrated:', {
          isAuthenticated: normalized.isAuthenticated,
          repositoriesCount: normalized.repositories?.length || 0,
          lastSync: normalized.lastSync,
          language: normalized.language,
          webdavConfigsCount: normalized.webdavConfigs?.length || 0,
          customCategoriesCount: normalized.customCategories?.length || 0,
        });

        return {
          ...currentState,
          ...normalized,
        };
      },
    }
  )
);

export const useAppStore = store;

export const useAppStoreRaw = () => store.getState();

// Helper function to sort categories by order
export const sortCategoriesByOrder = (
  categories: Category[],
  categoryOrder: string[]
): Category[] => {
  if (!categoryOrder || categoryOrder.length === 0) {
    return categories;
  }

  const orderMap = new Map(categoryOrder.map((id, index) => [id, index]));

  return [...categories].sort((a, b) => {
    const orderA = orderMap.get(a.id);
    const orderB = orderMap.get(b.id);

    // 如果两个都有顺序，按顺序排序
    if (orderA !== undefined && orderB !== undefined) {
      return orderA - orderB;
    }
    // 如果只有a有顺序，a排在前面
    if (orderA !== undefined) return -1;
    // 如果只有b有顺序，b排在前面
    if (orderB !== undefined) return 1;
    // 都没有顺序，保持原顺序
    return 0;
  });
};

// Helper function to get all categories (default + custom)
export const getAllCategories = (
  customCategories: Category[],
  language: 'zh' | 'en' = 'zh',
  hiddenDefaultCategoryIds: string[] = [],
  defaultCategoryOverrides: Record<string, Partial<Category>> = {}
): Category[] => {
  const translatedDefaults = defaultCategories
    .filter(cat => !hiddenDefaultCategoryIds.includes(cat.id))
    .map(cat => {
      const override = defaultCategoryOverrides[cat.id];
      const baseName = language === 'en' ? translateCategoryName(cat.name) : cat.name;
      return {
        ...cat,
        name: baseName,
        ...(override ? { name: override.name ?? baseName, icon: override.icon ?? cat.icon, keywords: override.keywords ?? cat.keywords } : {})
      };
    });

  return [...translatedDefaults, ...customCategories];
};

// Helper function to translate category names
const translateCategoryName = (zhName: string): string => {
  const translations: Record<string, string> = {
    '全部分类': 'All Categories',
    'Web应用': 'Web Apps',
    '移动应用': 'Mobile Apps',
    '桌面应用': 'Desktop Apps',
    '数据库': 'Database',
    'AI/机器学习': 'AI/Machine Learning',
    '开发工具': 'Development Tools',
    '安全工具': 'Security Tools',
    '游戏': 'Games',
    '设计工具': 'Design Tools',
    '效率工具': 'Productivity Tools',
    '教育学习': 'Education',
    '社交网络': 'Social Network',
    '数据分析': 'Data Analytics'
  };
  
  return translations[zhName] || zhName;
};

// Helper function to get all possible name variants for a category (original + translated)
const getCategoryNameVariants = (originalName: string, overrideName?: string): string[] => {
  const variants = new Set<string>();
  
  // Add original name
  variants.add(originalName);
  
  // Add translated name
  const translated = translateCategoryName(originalName);
  if (translated !== originalName) {
    variants.add(translated);
  }
  
  // Add override name if provided and different
  if (overrideName && overrideName !== originalName) {
    variants.add(overrideName);
    // Also add translated version of override if it matches a known pattern
    const overrideTranslated = translateCategoryName(overrideName);
    if (overrideTranslated !== overrideName) {
      variants.add(overrideTranslated);
    }
  }
  
  return Array.from(variants);
};
