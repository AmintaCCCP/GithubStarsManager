
import type { AppStoreSlice } from '../types';
import { REQUIRED_HEADER_MENU_IDS } from '../schema';

export const createPreferenceSlice: AppStoreSlice<Pick<import('../types').AppActions,
  | 'setTheme'
  | 'setThemePreset'
  | 'setCurrentView'
  | 'setSelectedCategory'
  | 'setLanguage'
  | 'setTranslationEngine'
  | 'setSidebarCollapsed'
  | 'setReadmeModalOpen'
  | 'setHeaderMenuConfig'
  | 'setHasHydrated'
  | 'setUpdateNotification'
  | 'dismissUpdateNotification'
  | 'setAnalysisProgress'
  | 'setProxyConfig'
  | 'setRpcDownloadConfig'
  | 'setRepositoryViewMode'
  | 'setReleaseViewMode'
  | 'setReleaseShowMode'
  | 'setReleaseLatestMode'
  | 'setReleaseSelectedFilters'
  | 'toggleReleaseSelectedFilter'
  | 'clearReleaseSelectedFilters'
  | 'setReleaseSearchQuery'
  | 'toggleReleaseExpandedRepository'
  | 'setReleaseExpandedRepositories'
  | 'setReleaseIsRefreshing'
  | 'setIncludePreRelease'
  | 'setIncludeKeysInBackup'
>> = (set) => ({
      // UI actions
      setTheme: (theme) => set({ theme }),
      setThemePreset: (themePreset) => set({ themePreset }),
      setCurrentView: (currentView) => set({ currentView }),
      setSelectedCategory: (selectedCategory) => set({ selectedCategory }),
      setLanguage: (language) => set({ language }),
      setTranslationEngine: (translationEngine) => set({ translationEngine }),
      setSidebarCollapsed: (isSidebarCollapsed) => set({ isSidebarCollapsed }),
      setReadmeModalOpen: (readmeModalOpen) => set({ readmeModalOpen }),
      setHeaderMenuConfig: (config) => set({
        headerMenuConfig: config.map(item =>
          REQUIRED_HEADER_MENU_IDS.has(item.id) ? { ...item, visible: true } : item
        ),
      }),

      // Hydration state
      setHasHydrated: (hasHydrated) => set({ hasHydrated }),

      // Update actions
      setUpdateNotification: (notification) => set({ updateNotification: notification }),
      dismissUpdateNotification: () => set({ updateNotification: null }),
      setAnalysisProgress: (newProgress) => set({ analysisProgress: newProgress }),
      setProxyConfig: (updates) => set((state) => ({
        proxyConfig: { ...state.proxyConfig, ...updates }
      })),
      setRpcDownloadConfig: (updates) => set((state) => ({
        rpcDownloadConfig: { ...state.rpcDownloadConfig, ...updates }
      })),

      // Repository list view actions
      setRepositoryViewMode: (repositoryViewMode) => set({ repositoryViewMode }),

      // Release Timeline View actions
      setReleaseViewMode: (releaseViewMode) => set({ releaseViewMode }),
      setReleaseShowMode: (releaseShowMode) => set({ releaseShowMode }),
      setReleaseLatestMode: (releaseLatestMode) => set({ releaseLatestMode }),
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
      setIncludePreRelease: (includePreRelease) => set({ includePreRelease }),
      setIncludeKeysInBackup: (includeKeysInBackup) => set({ includeKeysInBackup }),

});
