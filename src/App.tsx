import React, { useEffect, useMemo, useCallback } from 'react';
import { LoginScreen } from './components/LoginScreen';
import { Header } from './components/Header';
import { SearchBar } from './components/SearchBar';
import { RepositoryList } from './components/RepositoryList';
import { CategorySidebar } from './components/CategorySidebar';
import { ReleaseTimeline } from './components/ReleaseTimeline';
import { SettingsPanel } from './components/SettingsPanel';
import { DiscoveryView } from './components/DiscoveryView';
import { BackToTop } from './components/BackToTop';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useAppStore } from './store/useAppStore';
import { useAutoUpdateCheck } from './components/UpdateChecker';
import { UpdateNotificationBanner } from './components/UpdateNotificationBanner';
import { backend } from './services/backendAdapter';
import { syncFromBackend, startAutoSync, stopAutoSync } from './services/autoSync';
import type { AppState } from './types';

const RepositoriesView = React.memo(({ 
  repositories, 
  searchResults, 
  selectedCategory, 
  onCategorySelect 
}: { 
  repositories: AppState['repositories'];
  searchResults: AppState['searchResults'];
  selectedCategory: string;
  onCategorySelect: (category: string) => void;
}) => (
  <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
    <CategorySidebar 
      repositories={repositories}
      selectedCategory={selectedCategory}
      onCategorySelect={onCategorySelect}
    />
    <div className="flex-1 space-y-6">
      <SearchBar />
      <RepositoryList 
        repositories={searchResults.length > 0 ? searchResults : repositories}
        selectedCategory={selectedCategory}
      />
    </div>
  </div>
));
RepositoriesView.displayName = 'RepositoriesView';

const ReleasesView = React.memo(() => <ReleaseTimeline />);
ReleasesView.displayName = 'ReleasesView';

const SettingsView = React.memo(() => <SettingsPanel />);
SettingsView.displayName = 'SettingsView';

function App() {
  const { 
    isAuthenticated, 
    currentView, 
    selectedCategory,
    theme,
    searchResults,
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
            selectedCategory={selectedCategory}
            onCategorySelect={handleCategorySelect}
          />
        );
      case 'releases':
        return <ReleasesView />;
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
  }, [currentView, repositories, searchResults, selectedCategory, handleCategorySelect]);

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
