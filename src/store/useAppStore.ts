import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { AppState, Repository, Release, AIConfig, WebDAVConfig, SearchFilters, GitHubUser, Category, AssetFilter, UpdateNotification, AnalysisProgress, SubscriptionChannel, SubscriptionChannelId, SubscriptionRepo, SubscriptionDev } from '../types';
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
  setLoading: (loading: boolean) => void;
  setLastSync: (timestamp: string) => void;
  deleteRepository: (repoId: number) => void;
  
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

  // Subscription actions
  setSelectedSubscriptionChannel: (channel: SubscriptionChannelId) => void;
  setSubscriptionLoading: (channel: SubscriptionChannelId, loading: boolean) => void;
  setSubscriptionRepos: (channel: SubscriptionChannelId, repos: SubscriptionRepo[]) => void;
  setSubscriptionDevs: (devs: SubscriptionDev[]) => void;
  setSubscriptionLastRefresh: (channel: SubscriptionChannelId, timestamp: string) => void;
  updateSubscriptionRepo: (repo: SubscriptionRepo) => void;
  updateSubscriptionDev: (dev: SubscriptionDev) => void;
  toggleSubscriptionChannel: (channelId: SubscriptionChannelId) => void;
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

const defaultSubscriptionChannels: SubscriptionChannel[] = [
  {
    id: 'most-stars',
    name: '最多 Star',
    nameEn: 'Most Stars',
    icon: '⭐',
    description: 'GitHub 上 Star 数量最多的项目 Top 10',
    enabled: true,
  },
  {
    id: 'most-forks',
    name: '最多 Fork',
    nameEn: 'Most Forks',
    icon: '🔱',
    description: 'GitHub 上 Fork 数量最多的项目 Top 10',
    enabled: true,
  },
  {
    id: 'most-dev',
    name: '热门开发者',
    nameEn: 'Top Developers',
    icon: '👤',
    description: 'GitHub 上最受关注的开发者 Top 10 及其最热项目',
    enabled: true,
  },
  {
    id: 'trending',
    name: '热门趋势',
    nameEn: 'Trending',
    icon: '🔥',
    description: 'GitHub 上近期最受关注的项目 Top 10',
    enabled: true,
  },
];

export const useAppStore = create<AppState & AppActions>()(
  persist(
    (set) => ({
      // Initial state
      user: null,
      githubToken: null,
      isAuthenticated: false,
      repositories: [],
      isLoading: false,
      lastSync: null,
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

    // Subscription
    subscriptionChannels: defaultSubscriptionChannels,
    subscriptionRepos: { 'most-stars': [], 'most-forks': [], 'most-dev': [], 'trending': [] },
    subscriptionDevs: [],
    subscriptionLastRefresh: { 'most-stars': null, 'most-forks': null, 'most-dev': null, 'trending': null },
    subscriptionIsLoading: { 'most-stars': false, 'most-forks': false, 'most-dev': false, 'trending': false },
    selectedSubscriptionChannel: 'most-stars',

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

    // Subscription actions
    setSelectedSubscriptionChannel: (selectedSubscriptionChannel) => set({ selectedSubscriptionChannel }),
    setSubscriptionLoading: (channel, loading) => set((state) => ({
      subscriptionIsLoading: { ...state.subscriptionIsLoading, [channel]: loading },
    })),
    setSubscriptionRepos: (channel, repos) => set((state) => ({
      subscriptionRepos: { ...state.subscriptionRepos, [channel]: repos },
    })),
    setSubscriptionDevs: (devs) => set({ subscriptionDevs: devs }),
    setSubscriptionLastRefresh: (channel, timestamp) => set((state) => ({
      subscriptionLastRefresh: { ...state.subscriptionLastRefresh, [channel]: timestamp },
    })),
    updateSubscriptionRepo: (repo) => set((state) => {
      const channel = repo.channel;
      const channelRepos = state.subscriptionRepos[channel] || [];
      return {
        subscriptionRepos: {
          ...state.subscriptionRepos,
          [channel]: channelRepos.map(r => r.id === repo.id ? repo : r),
        },
      };
    }),
    updateSubscriptionDev: (dev) => set((state) => ({
      subscriptionDevs: state.subscriptionDevs.map(d => d.login === dev.login ? dev : d),
    })),
    toggleSubscriptionChannel: (channelId) => set((state) => ({
      subscriptionChannels: state.subscriptionChannels.map(ch =>
        ch.id === channelId ? { ...ch, enabled: !ch.enabled } : ch
      ),
    })),
    }),
    {
      name: 'github-stars-manager',
      version: 5,
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

      // 持久化订阅设置
      subscriptionChannels: state.subscriptionChannels,
      selectedSubscriptionChannel: state.selectedSubscriptionChannel,
      subscriptionRepos: state.subscriptionRepos,
      subscriptionDevs: state.subscriptionDevs,
      subscriptionLastRefresh: state.subscriptionLastRefresh,
      }),
      migrate: (persistedState) => {
        // 版本升级适配处理
        const state = persistedState as PersistedAppState | undefined;

        // 从旧版本升级时，确保 categoryOrder 字段存在
        if (state && !Array.isArray(state.categoryOrder)) {
          console.log('Migrating from old version: initializing categoryOrder');
          state.categoryOrder = [];
        }

        // 从旧版本升级时，确保 collapsedSidebarCategoryCount 字段存在
        if (state && typeof state.collapsedSidebarCategoryCount !== 'number') {
          console.log('Migrating from old version: initializing collapsedSidebarCategoryCount');
          state.collapsedSidebarCategoryCount = 20;
        }

        // 从旧版本升级时，确保 defaultCategoryOverrides 字段存在
        if (state && typeof state.defaultCategoryOverrides !== 'object') {
          console.log('Migrating from old version: initializing defaultCategoryOverrides');
          state.defaultCategoryOverrides = {};
        }

        // 迁移仓库数据中的旧标记
        if (state && Array.isArray(state.repositories)) {
          let migratedCount = 0;
          state.repositories = state.repositories.map((repo: Repository) => {
            // 将旧的 '__EMPTY__' 标记转换为空字符串（表示用户明确清空）
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

  // 迁移订阅频道（版本 4→5：daily-dev → most-dev，新增 trending）
  if (state && !Array.isArray(state.subscriptionChannels)) {
    console.log('Migrating: initializing subscription channels');
    state.subscriptionChannels = defaultSubscriptionChannels;
  } else if (state && Array.isArray(state.subscriptionChannels)) {
    state.subscriptionChannels = state.subscriptionChannels.map((ch: Record<string, unknown>) => {
      if (ch.id === 'daily-dev' || ch.id === 'most-dev') {
        return { ...ch, id: 'most-dev', name: '热门开发者', nameEn: 'Top Developers', icon: '👤' };
      }
      return ch;
    });
  }
  if (state && !state.selectedSubscriptionChannel) {
    state.selectedSubscriptionChannel = 'most-stars';
  } else if (state && state.selectedSubscriptionChannel === 'daily-dev') {
    state.selectedSubscriptionChannel = 'most-dev';
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
