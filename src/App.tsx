import React, { useEffect, useMemo, useCallback } from 'react';
import { LoginScreen } from './components/LoginScreen';
import { Header } from './components/Header';
import { SearchBar } from './components/SearchBar';
import { RepositoryList } from './components/RepositoryList';
import { CategorySidebar } from './components/CategorySidebar';
import { ReleaseTimeline } from './components/ReleaseTimeline';
import { ForkTimeline } from './components/ForkTimeline';
import { SettingsPanel } from './components/SettingsPanel';
import { DiscoveryView } from './components/DiscoveryView';
import { BackToTop } from './components/BackToTop';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useAppStore } from './store/useAppStore';
import { useAutoUpdateCheck } from './components/UpdateChecker';
import { UpdateNotificationBanner } from './components/UpdateNotificationBanner';
import { backend } from './services/backendAdapter';
import { syncFromBackend, startAutoSync, stopAutoSync } from './services/autoSync';
import type { AppState, SearchFilters } from './types';

/**
 * Check if any search/filter/sort condition is active (non-default).
 * Used to decide whether to display searchResults or the full repository list.
 */
function hasActiveSearchFilters(filters: SearchFilters): boolean {
  return (
    !!filters.query.trim() ||
    filters.languages.length > 0 ||
    filters.tags.length > 0 ||
    filters.platforms.length > 0 ||
    filters.minStars !== undefined ||
    filters.maxStars !== undefined ||
    filters.isAnalyzed !== undefined ||
    filters.isSubscribed !== undefined ||
    filters.isEdited !== undefined ||
    filters.isCategoryLocked !== undefined ||
    filters.analysisFailed !== undefined ||
    filters.sortBy !== 'stars' ||
    filters.sortOrder !== 'desc'
  );
}

/**
 * Main repository view combining category sidebar, search bar, and repository list.
 * Switches between search results and full list based on active search filters.
 */
const RepositoriesView = React.memo(({
  repositories,
  searchResults,
  searchFilters,
  selectedCategory,
  onCategorySelect
}: {
  repositories: AppState['repositories'];
  searchResults: AppState['searchResults'];
  searchFilters: AppState['searchFilters'];
  selectedCategory: string;
  onCategorySelect: (category: string) => void;
}) => {
  const isActive = hasActiveSearchFilters(searchFilters);

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
      <CategorySidebar
        repositories={repositories}
        selectedCategory={selectedCategory}
        onCategorySelect={onCategorySelect}
      />
      <div className="flex-1 space-y-6">
        <SearchBar />
        <RepositoryList
          repositories={isActive ? searchResults : repositories}
          selectedCategory={selectedCategory}
        />
      </div>
    </div>
  );
});
RepositoriesView.displayName = 'RepositoriesView';

const ReleasesView = React.memo(() => <ReleaseTimeline />);
ReleasesView.displayName = 'ReleasesView';

const ForksView = React.memo(() => <ForkTimeline />);
ForksView.displayName = 'ForksView';

const SettingsView = React.memo(() => <SettingsPanel />);
SettingsView.displayName = 'SettingsView';

function App() {
  const {
    isAuthenticated,
    currentView,
    selectedCategory,
    theme,
    hasHydrated,
    searchResults,
    searchFilters,
    repositories,
    setSelectedCategory,
  } = useAppStore();

  useAutoUpdateCheck();

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;

    const initBackend = async () => {
      try {
        await backend.init();
        if (backend.isAvailable && !cancelled) {
          await syncFromBackend();
          if (!cancelled) {
            unsubscribe = startAutoSync();
          }
        }
      } catch (err) {
        console.error('Failed to initialize backend:', err);
      }
    };

    initBackend();

    return () => {
      cancelled = true;
      if (unsubscribe) {
        stopAutoSync(unsubscribe);
      }
    };
  }, []);

  const handleCategorySelect = useCallback((category: string) => {
    setSelectedCategory(category);
  }, [setSelectedCategory]);

  const currentViewContent = useMemo(() => {
    switch (currentView) {
      case 'repositories':
        return (
          <RepositoriesView
            repositories={repositories}
            searchResults={searchResults}
            searchFilters={searchFilters}
            selectedCategory={selectedCategory}
            onCategorySelect={handleCategorySelect}
          />
        );
      case 'releases':
        return <ReleasesView />;
      case 'forks':
        return <ForksView />;
      case 'subscription':
        return (
          <ErrorBoundary>
            <DiscoveryView />
          </ErrorBoundary>
        );
      case 'settings':
        return <SettingsView />;
      default:
        return null;
    }
  }, [currentView, repositories, searchResults, searchFilters, selectedCategory, handleCategorySelect]);

  // Show loading state while store is hydrating to ensure correct theme is applied
  if (!hasHydrated) {
    return (
      <div className="min-h-screen bg-light-bg dark:bg-marketing-black flex items-center justify-center">
        <div className="text-gray-900 dark:text-text-primary text-lg font-medium animate-pulse">
          Loading...
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  return (
    <div className="min-h-screen bg-light-bg dark:bg-marketing-black text-gray-900 dark:text-text-primary transition-colors duration-200">
      <UpdateNotificationBanner />
      <Header />
      <main className="max-w-[1200px] mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-8">
        {currentViewContent}
      </main>
      <BackToTop />
    </div>
  );
}

export default App;
