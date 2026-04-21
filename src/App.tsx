import React, { useEffect, useMemo, useCallback, Suspense, lazy, useState } from 'react';
import { LoginScreen } from './components/LoginScreen';
import { Header } from './components/Header';
import { SearchBar } from './components/SearchBar';
import { CategorySidebar } from './components/CategorySidebar';
import { BackToTop } from './components/BackToTop';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useAppStore } from './store/useAppStore';
import { useAutoUpdateCheck } from './components/UpdateChecker';
import { UpdateNotificationBanner } from './components/UpdateNotificationBanner';
import { backend } from './services/backendAdapter';
import { syncFromBackend, startAutoSync, stopAutoSync } from './services/autoSync';
import { measureRender } from './utils/performanceMonitor';
import type { AppState } from './types';

const RepositoryList = lazy(() => import('./components/RepositoryList').then(m => ({ default: m.RepositoryList })));
const ReleaseTimeline = lazy(() => import('./components/ReleaseTimeline').then(m => ({ default: m.ReleaseTimeline })));
const SettingsPanel = lazy(() => import('./components/SettingsPanel').then(m => ({ default: m.SettingsPanel })));
const DiscoveryView = lazy(() => import('./components/DiscoveryView').then(m => ({ default: m.DiscoveryView })));

const LoadingSpinner = () => (
  <div className="flex items-center justify-center min-h-[400px]">
    <div className="flex flex-col items-center gap-3">
      <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
      <span className="text-sm text-gray-500 dark:text-gray-400">加载中...</span>
    </div>
  </div>
);

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
}) => {
  const endMeasure = measureRender('RepositoriesView');
  useEffect(() => {
    endMeasure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
      <CategorySidebar 
        repositories={repositories}
        selectedCategory={selectedCategory}
        onCategorySelect={onCategorySelect}
      />
      <div className="flex-1 space-y-6">
        <SearchBar />
        <ErrorBoundary>
          <Suspense fallback={<LoadingSpinner />}>
            <RepositoryList 
              repositories={searchResults.length > 0 ? searchResults : repositories}
              selectedCategory={selectedCategory}
            />
          </Suspense>
        </ErrorBoundary>
      </div>
    </div>
  );
});
RepositoriesView.displayName = 'RepositoriesView';

const ReleasesView = React.memo(() => (
  <ErrorBoundary>
    <Suspense fallback={<LoadingSpinner />}>
      <ReleaseTimeline />
    </Suspense>
  </ErrorBoundary>
));
ReleasesView.displayName = 'ReleasesView';

const SettingsView = React.memo(() => (
  <ErrorBoundary>
    <Suspense fallback={<LoadingSpinner />}>
      <SettingsPanel />
    </Suspense>
  </ErrorBoundary>
));
SettingsView.displayName = 'SettingsView';

const DiscoveryViewWrapper = React.memo(() => (
  <ErrorBoundary>
    <Suspense fallback={<LoadingSpinner />}>
      <DiscoveryView />
    </Suspense>
  </ErrorBoundary>
));
DiscoveryViewWrapper.displayName = 'DiscoveryViewWrapper';

const VIEW_COMPONENTS = {
  repositories: RepositoriesView,
  releases: ReleasesView,
  subscription: DiscoveryViewWrapper,
  settings: SettingsView,
} as const;

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

  const [isInitialized, setIsInitialized] = useState(false);

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
      } finally {
        if (!cancelled) {
          setIsInitialized(true);
        }
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

  useEffect(() => {
    if (currentView === 'releases') {
      import('./components/ReleaseTimeline');
    } else if (currentView === 'subscription') {
      import('./components/DiscoveryView');
    } else if (currentView === 'settings') {
      import('./components/SettingsPanel');
    }
  }, [currentView]);

  const handleCategorySelect = useCallback((category: string) => {
    setSelectedCategory(category);
  }, [setSelectedCategory]);

  const currentViewContent = useMemo(() => {
    if (currentView === 'repositories') {
      return (
        <RepositoriesView 
          repositories={repositories}
          searchResults={searchResults}
          selectedCategory={selectedCategory}
          onCategorySelect={handleCategorySelect}
        />
      );
    }

    const ViewComponent = VIEW_COMPONENTS[currentView];
    if (!ViewComponent) return null;

    return <ViewComponent />;
  }, [currentView, repositories, searchResults, selectedCategory, handleCategorySelect]);

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  if (!isInitialized) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <UpdateNotificationBanner />
      <Header />
      <main className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-8">
        {currentViewContent}
      </main>
      <BackToTop />
    </div>
  );
}

export default App;
