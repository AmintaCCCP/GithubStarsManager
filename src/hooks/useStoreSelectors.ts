import { useAppStore } from '../store/useAppStore';
import { shallow } from 'zustand/shallow';
import { useCallback, useMemo } from 'react';
import type { Repository, Category } from '../types';

export const useAuth = () => {
  return useAppStore(
    useCallback(
      (state) => ({
        isAuthenticated: state.isAuthenticated,
        user: state.user,
        githubToken: state.githubToken,
        logout: state.logout,
        setUser: state.setUser,
        setGitHubToken: state.setGitHubToken,
      }),
      []
    ),
    shallow
  );
};

export const useTheme = () => {
  return useAppStore(
    useCallback(
      (state) => ({
        theme: state.theme,
        setTheme: state.setTheme,
      }),
      []
    ),
    shallow
  );
};

export const useLanguage = () => {
  return useAppStore(
    useCallback(
      (state) => ({
        language: state.language,
        setLanguage: state.setLanguage,
      }),
      []
    ),
    shallow
  );
};

export const useCurrentView = () => {
  return useAppStore(
    useCallback(
      (state) => ({
        currentView: state.currentView,
        setCurrentView: state.setCurrentView,
      }),
      []
    ),
    shallow
  );
};

export const useRepositories = () => {
  return useAppStore(
    useCallback(
      (state) => ({
        repositories: state.repositories,
        setRepositories: state.setRepositories,
        updateRepository: state.updateRepository,
        addRepository: state.addRepository,
        deleteRepository: state.deleteRepository,
        isLoading: state.isLoading,
        setLoading: state.setLoading,
      }),
      []
    ),
    shallow
  );
};

export const useSearchFilters = () => {
  return useAppStore(
    useCallback(
      (state) => ({
        searchFilters: state.searchFilters,
        setSearchFilters: state.setSearchFilters,
        searchResults: state.searchResults,
        setSearchResults: state.setSearchResults,
      }),
      []
    ),
    shallow
  );
};

export const useCategories = () => {
  const customCategories = useAppStore((state) => state.customCategories);
  const hiddenDefaultCategoryIds = useAppStore((state) => state.hiddenDefaultCategoryIds);
  const defaultCategoryOverrides = useAppStore((state) => state.defaultCategoryOverrides);
  const categoryOrder = useAppStore((state) => state.categoryOrder);
  const language = useAppStore((state) => state.language);
  const addCustomCategory = useAppStore((state) => state.addCustomCategory);
  const updateCustomCategory = useAppStore((state) => state.updateCustomCategory);
  const deleteCustomCategory = useAppStore((state) => state.deleteCustomCategory);
  const hideDefaultCategory = useAppStore((state) => state.hideDefaultCategory);
  const showDefaultCategory = useAppStore((state) => state.showDefaultCategory);
  const setCategoryOrder = useAppStore((state) => state.setCategoryOrder);

  return useMemo(
    () => ({
      customCategories,
      hiddenDefaultCategoryIds,
      defaultCategoryOverrides,
      categoryOrder,
      language,
      addCustomCategory,
      updateCustomCategory,
      deleteCustomCategory,
      hideDefaultCategory,
      showDefaultCategory,
      setCategoryOrder,
    }),
    [
      customCategories,
      hiddenDefaultCategoryIds,
      defaultCategoryOverrides,
      categoryOrder,
      language,
      addCustomCategory,
      updateCustomCategory,
      deleteCustomCategory,
      hideDefaultCategory,
      showDefaultCategory,
      setCategoryOrder,
    ]
  );
};

export const useAIConfig = () => {
  return useAppStore(
    useCallback(
      (state) => ({
        aiConfigs: state.aiConfigs,
        activeAIConfig: state.activeAIConfig,
        addAIConfig: state.addAIConfig,
        updateAIConfig: state.updateAIConfig,
        deleteAIConfig: state.deleteAIConfig,
        setActiveAIConfig: state.setActiveAIConfig,
        setAIConfigs: state.setAIConfigs,
      }),
      []
    ),
    shallow
  );
};

export const useReleases = () => {
  return useAppStore(
    useCallback(
      (state) => ({
        releases: state.releases,
        releaseSubscriptions: state.releaseSubscriptions,
        readReleases: state.readReleases,
        setReleases: state.setReleases,
        addReleases: state.addReleases,
        toggleReleaseSubscription: state.toggleReleaseSubscription,
        batchUnsubscribeReleases: state.batchUnsubscribeReleases,
        removeReleasesByRepoId: state.removeReleasesByRepoId,
        markReleaseAsRead: state.markReleaseAsRead,
        markAllReleasesAsRead: state.markAllReleasesAsRead,
      }),
      []
    ),
    shallow
  );
};

export const useAnalysisProgress = () => {
  return useAppStore(
    useCallback(
      (state) => ({
        analysisProgress: state.analysisProgress,
        setAnalysisProgress: state.setAnalysisProgress,
        analyzingRepositoryIds: state.analyzingRepositoryIds,
        setAnalyzingRepository: state.setAnalyzingRepository,
      }),
      []
    ),
    shallow
  );
};

export const useSelectedCategory = () => {
  return useAppStore(
    useCallback(
      (state) => ({
        selectedCategory: state.selectedCategory,
        setSelectedCategory: state.setSelectedCategory,
      }),
      []
    ),
    shallow
  );
};

export const useSidebarState = () => {
  return useAppStore(
    useCallback(
      (state) => ({
        isSidebarCollapsed: state.isSidebarCollapsed,
        setSidebarCollapsed: state.setSidebarCollapsed,
        collapsedSidebarCategoryCount: state.collapsedSidebarCategoryCount,
        setCollapsedSidebarCategoryCount: state.setCollapsedSidebarCategoryCount,
      }),
      []
    ),
    shallow
  );
};

export const useRepositoryStats = (repositories: Repository[], allCategories: Category[]) => {
  return useMemo(() => {
    let unanalyzedCount = 0;
    let analyzedCount = 0;
    let failedCount = 0;

    for (const repo of repositories) {
      if (repo.analysis_failed) {
        failedCount++;
      } else if (repo.analyzed_at) {
        analyzedCount++;
      } else {
        unanalyzedCount++;
      }
    }

    return { unanalyzedCount, analyzedCount, failedCount, total: repositories.length };
  }, [repositories]);
};

export const useFilteredRepositories = (
  repositories: Repository[],
  selectedCategory: string,
  allCategories: Category[]
) => {
  return useMemo(() => {
    if (selectedCategory === 'all') return repositories;

    const selectedCategoryObj = allCategories.find((cat) => cat.id === selectedCategory);
    if (!selectedCategoryObj) return [];

    return repositories.filter((repo) => {
      if (repo.custom_category !== undefined) {
        if (repo.custom_category === '') {
          return false;
        }
        return repo.custom_category === selectedCategoryObj.name;
      }

      if (repo.ai_tags && repo.ai_tags.length > 0) {
        return repo.ai_tags.some(
          (tag) =>
            selectedCategoryObj.keywords.some(
              (keyword) =>
                tag.toLowerCase().includes(keyword.toLowerCase()) ||
                keyword.toLowerCase().includes(tag.toLowerCase())
            )
        );
      }

      const repoText = [
        repo.name,
        repo.description || '',
        repo.language || '',
        ...(repo.topics || []),
        repo.ai_summary || '',
      ]
        .join(' ')
        .toLowerCase();

      return selectedCategoryObj.keywords.some((keyword) =>
        repoText.includes(keyword.toLowerCase())
      );
    });
  }, [repositories, selectedCategory, allCategories]);
};
