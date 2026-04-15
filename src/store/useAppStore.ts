import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { AppState, Repository, Release, AIConfig, WebDAVConfig, SearchFilters, GitHubUser, Category, AssetFilter, UpdateNotification, AnalysisProgress } from '../types';
import { indexedDBStorage } from '../services/indexedDbStorage';

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
  markReleaseAsRead: (releaseId: number) => void;
  markAllReleasesAsRead: () => void;
  
  // Category actions
  addCustomCategory: (category: Category) => void;
  updateCustomCategory: (id: string, updates: Partial<Category>) => void;
  deleteCustomCategory: (id: string) => void;
  hideDefaultCategory: (id: string) => void;
  showDefaultCategory: (id: string) => void;
  
  // Asset Filter actions
  addAssetFilter: (filter: AssetFilter) => void;
  updateAssetFilter: (id: string, updates: Partial<AssetFilter>) => void;
  deleteAssetFilter: (id: string) => void;
  
  // UI actions
  setTheme: (theme: 'light' | 'dark') => void;
  setCurrentView: (view: 'repositories' | 'releases' | 'settings') => void;
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
    | 'assetFilters'
    | 'theme'
    | 'currentView'
    | 'selectedCategory'
    | 'language'
    | 'searchFilters'
    | 'isSidebarCollapsed'
  >
> & {
  releaseSubscriptions?: unknown;
  readReleases?: unknown;
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

  const savedSortBy = safePersisted.searchFilters?.sortBy || 'stars';
  const savedSortOrder = safePersisted.searchFilters?.sortOrder || 'desc';

  return {
    ...currentState,
    ...safePersisted,
    repositories,
    releases,
    searchResults: repositories,
    releaseSubscriptions: normalizeNumberSet(safePersisted.releaseSubscriptions),
    readReleases: normalizeNumberSet(safePersisted.readReleases),
    searchFilters: {
      ...initialSearchFilters,
      sortBy: savedSortBy,
      sortOrder: savedSortOrder,
    },
    webdavConfigs: Array.isArray(safePersisted.webdavConfigs) ? safePersisted.webdavConfigs : [],
    customCategories: Array.isArray(safePersisted.customCategories) ? safePersisted.customCategories : [],
    hiddenDefaultCategoryIds: Array.isArray((safePersisted as any).hiddenDefaultCategoryIds) ? (safePersisted as any).hiddenDefaultCategoryIds.filter((id: unknown): id is string => typeof id === 'string') : [],
    assetFilters: Array.isArray(safePersisted.assetFilters) && safePersisted.assetFilters.length > 0 ? safePersisted.assetFilters : defaultPresetFilters,
    language: safePersisted.language || 'zh',
    isAuthenticated: !!(safePersisted.user && safePersisted.githubToken),
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

// 默认预设筛选器
const defaultPresetFilters: AssetFilter[] = [
  { id: 'preset-windows', name: 'Windows', keywords: ['windows', 'win', 'exe', 'msi', '.zip'], isPreset: true, icon: 'Monitor' },
  { id: 'preset-macos', name: 'macOS', keywords: ['mac', 'macos', 'darwin', 'dmg', 'pkg'], isPreset: true, icon: 'Apple' },
  { id: 'preset-linux', name: 'Linux', keywords: ['linux', 'appimage', 'deb', 'rpm', 'tar.gz'], isPreset: true, icon: 'Terminal' },
  { id: 'preset-android', name: 'Android', keywords: ['android', 'apk'], isPreset: true, icon: 'Smartphone' },
  { id: 'preset-source', name: 'Source', keywords: ['source', 'src', 'tar.gz', 'tar.xz', 'zip'], isPreset: true, icon: 'Package' },
];

export const useAppStore = create<AppState & AppActions>()(
  persist(
    (set, get) => ({
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
      assetFilters: defaultPresetFilters,
      theme: 'light',
      currentView: 'repositories',
      selectedCategory: 'all',
      language: 'zh',
      updateNotification: null,
      analysisProgress: { current: 0, total: 0 },
      backendApiSecret: readSessionBackendSecret(),
      isSidebarCollapsed: false,

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
      setSearchFilters: (filters) => set((state) => ({
        searchFilters: { ...state.searchFilters, ...filters }
      })),
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
    }),
    {
      name: 'github-stars-manager',
      version: 1,
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
      }),
      migrate: (persistedState) => persistedState as PersistedAppState,
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

// Helper function to get all categories (default + custom)
export const getAllCategories = (
  customCategories: Category[],
  language: 'zh' | 'en' = 'zh',
  hiddenDefaultCategoryIds: string[] = []
): Category[] => {
  const translatedDefaults = defaultCategories
    .filter(cat => !hiddenDefaultCategoryIds.includes(cat.id))
    .map(cat => ({
      ...cat,
      name: language === 'en' ? translateCategoryName(cat.name) : cat.name
    }));
  
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
