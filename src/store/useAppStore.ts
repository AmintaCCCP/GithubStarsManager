import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { AppState, Repository, Release, AIConfig, WebDAVConfig, SearchFilters, GitHubUser, Category } from '../types';

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
  
  // AI actions
  addAIConfig: (config: AIConfig) => void;
  updateAIConfig: (id: string, updates: Partial<AIConfig>) => void;
  deleteAIConfig: (id: string) => void;
  setActiveAIConfig: (id: string | null) => void;
  
  // WebDAV actions
  addWebDAVConfig: (config: WebDAVConfig) => void;
  updateWebDAVConfig: (id: string, updates: Partial<WebDAVConfig>) => void;
  deleteWebDAVConfig: (id: string) => void;
  setActiveWebDAVConfig: (id: string | null) => void;
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
  
  // UI actions
  setTheme: (theme: 'light' | 'dark') => void;
  setCurrentView: (view: 'repositories' | 'releases' | 'settings') => void;
  setLanguage: (language: 'zh' | 'en') => void;
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

const defaultCategories: Category[] = [
  {
    id: 'all',
    name: '全部分类',
    icon: 'Folder',
    keywords: []
  },
  {
    id: 'web',
    name: 'Web应用',
    icon: 'Globe',
    keywords: ['web应用', 'web', 'website', 'frontend', 'react', 'vue', 'angular']
  },
  {
    id: 'mobile',
    name: '移动应用',
    icon: 'Smartphone',
    keywords: ['移动应用', 'mobile', 'android', 'ios', 'flutter', 'react-native']
  },
  {
    id: 'desktop',
    name: '桌面应用',
    icon: 'Code',
    keywords: ['桌面应用', 'desktop', 'electron', 'gui', 'qt', 'gtk']
  },
  {
    id: 'database',
    name: '数据库',
    icon: 'Database',
    keywords: ['数据库', 'database', 'sql', 'nosql', 'mongodb', 'mysql', 'postgresql']
  },
  {
    id: 'ai',
    name: 'AI/机器学习',
    icon: 'Bot',
    keywords: ['ai工具', 'ai', 'ml', 'machine learning', 'deep learning', 'neural']
  },
  {
    id: 'devtools',
    name: '开发工具',
    icon: 'Wrench',
    keywords: ['开发工具', 'tool', 'cli', 'build', 'deploy', 'debug', 'test', 'automation']
  },
  {
    id: 'security',
    name: '安全工具',
    icon: 'Shield',
    keywords: ['安全工具', 'security', 'encryption', 'auth', 'vulnerability']
  },
  {
    id: 'game',
    name: '游戏',
    icon: 'Gamepad2',
    keywords: ['游戏', 'game', 'gaming', 'unity', 'unreal', 'godot']
  },
  {
    id: 'design',
    name: '设计工具',
    icon: 'Palette',
    keywords: ['设计工具', 'design', 'ui', 'ux', 'graphics', 'image']
  },
  {
    id: 'productivity',
    name: '效率工具',
    icon: 'Zap',
    keywords: ['效率工具', 'productivity', 'note', 'todo', 'calendar', 'task']
  },
  {
    id: 'education',
    name: '教育学习',
    icon: 'BookOpen',
    keywords: ['教育学习', 'education', 'learning', 'tutorial', 'course']
  },
  {
    id: 'social',
    name: '社交网络',
    icon: 'Users',
    keywords: ['社交网络', 'social', 'chat', 'messaging', 'communication']
  },
  {
    id: 'analytics',
    name: '数据分析',
    icon: 'BarChart3',
    keywords: ['数据分析', 'analytics', 'data', 'visualization', 'chart']
  }
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
      theme: 'light',
      currentView: 'repositories',
      language: 'zh',

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
        if (newSubscriptions.has(repoId)) {
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
      updateCustomCategory: (id, updates) => set((state) => ({
        customCategories: state.customCategories.map(category => 
          category.id === id ? { ...category, ...updates } : category
        )
      })),
      deleteCustomCategory: (id) => set((state) => ({
        customCategories: state.customCategories.filter(category => category.id !== id)
      })),

      // UI actions
      setTheme: (theme) => set({ theme }),
      setCurrentView: (currentView) => set({ currentView }),
      setLanguage: (language) => set({ language }),
    }),
    {
      name: 'github-stars-manager',
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
        
        // 持久化UI设置
        theme: state.theme,
        language: state.language,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Convert arrays back to Sets
          if (Array.isArray(state.releaseSubscriptions)) {
            state.releaseSubscriptions = new Set(state.releaseSubscriptions as number[]);
          } else {
            state.releaseSubscriptions = new Set<number>();
          }
          
          if (Array.isArray(state.readReleases)) {
            state.readReleases = new Set(state.readReleases as number[]);
          } else {
            state.readReleases = new Set<number>();
          }
          
          // 确保认证状态正确
          state.isAuthenticated = !!(state.user && state.githubToken);
          
          // 初始化搜索结果为所有仓库
          state.searchResults = state.repositories || [];
          
          // 重置搜索过滤器
          state.searchFilters = initialSearchFilters;
          
          // 确保语言设置存在
          if (!state.language) {
            state.language = 'zh';
          }
          
          // 初始化WebDAV配置数组
          if (!state.webdavConfigs) {
            state.webdavConfigs = [];
          }
          
          // 初始化自定义分类
          if (!state.customCategories) {
            state.customCategories = [];
          }
          
          console.log('Store rehydrated:', {
            isAuthenticated: state.isAuthenticated,
            repositoriesCount: state.repositories?.length || 0,
            lastSync: state.lastSync,
            language: state.language,
            webdavConfigsCount: state.webdavConfigs?.length || 0,
            customCategoriesCount: state.customCategories?.length || 0
          });
        }
      },
    }
  )
);

// Helper function to get all categories (default + custom)
export const getAllCategories = (customCategories: Category[], language: 'zh' | 'en' = 'zh'): Category[] => {
  const translatedDefaults = defaultCategories.map(cat => ({
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