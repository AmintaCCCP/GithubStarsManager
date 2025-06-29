import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { AppState, Repository, Release, AIConfig, WebDAVConfig, SearchFilters, GitHubUser } from '../types';

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
        
        // 持久化Release订阅
        releaseSubscriptions: Array.from(state.releaseSubscriptions),
        releases: state.releases,
        
        // 持久化UI设置
        theme: state.theme,
        language: state.language,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Convert array back to Set
          if (Array.isArray(state.releaseSubscriptions)) {
            state.releaseSubscriptions = new Set(state.releaseSubscriptions as number[]);
          } else {
            state.releaseSubscriptions = new Set<number>();
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
          
          console.log('Store rehydrated:', {
            isAuthenticated: state.isAuthenticated,
            repositoriesCount: state.repositories?.length || 0,
            lastSync: state.lastSync,
            language: state.language,
            webdavConfigsCount: state.webdavConfigs?.length || 0
          });
        }
      },
    }
  )
);