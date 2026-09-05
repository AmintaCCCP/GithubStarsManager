import React, { Suspense, useEffect, useMemo, useCallback } from 'react';
import { LoginScreen } from './components/LoginScreen';
import { Header } from './components/Header';
import { SearchBar } from './components/SearchBar';
import { RepositoryList } from './components/RepositoryList';
import { CategorySidebar } from './components/CategorySidebar';

import { DebugModeIndicator } from './components/DebugModeIndicator';

import { BackToTop } from './components/BackToTop';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SyncModeChoiceModal } from './components/SyncModeChoiceModal';
import { useAppStore } from './store/useAppStore';
import { selectAppShellState } from './store/selectors';
import { useShallow } from 'zustand/react/shallow';
import { applyThemePreset } from './lib/themePresets';
import { useAutoUpdateCheck } from './hooks/useAutoUpdateCheck';
import { logger } from './services/logger';
import { UpdateNotificationBanner } from './components/UpdateNotificationBanner';
import { ListsPushIndicator } from './components/ListsPushIndicator';
import { useBackendLifecycle } from './features/lifecycle/useBackendLifecycle';
import type { AppState } from './types';
import { hasActiveSearchFilters } from './utils/repoSearch';

const LazyReleaseTimeline = React.lazy(() =>
  import('./components/ReleaseTimeline').then((module) => ({ default: module.ReleaseTimeline }))
);
const LazyForkTimeline = React.lazy(() =>
  import('./components/ForkTimeline').then((module) => ({ default: module.ForkTimeline }))
);
const LazySettingsPanel = React.lazy(() =>
  import('./components/SettingsPanel').then((module) => ({ default: module.SettingsPanel }))
);
const LazyDiscoveryView = React.lazy(() =>
  import('./components/DiscoveryView').then((module) => ({ default: module.DiscoveryView }))
);
const LazyGistView = React.lazy(() =>
  import('./components/GistView').then((module) => ({ default: module.GistView }))
);

const ViewLoadingFallback: React.FC = () => (
  <div className="flex min-h-[12rem] items-center justify-center bg-background text-foreground" role="status" aria-live="polite">
    <div className="animate-pulse text-lg font-medium text-foreground">Loading...</div>
  </div>
);

const LazyViewBoundary: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ErrorBoundary>
    <Suspense fallback={<ViewLoadingFallback />}>{children}</Suspense>
  </ErrorBoundary>
);

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
  const similarView = useAppStore((state) => state.similarView);
  const exitSimilarView = useAppStore((state) => state.exitSimilarView);

  // 相似视图下用户发起搜索时，自动退出相似视图（搜索优先于相似浏览，避免界面歧义）
  useEffect(() => {
    if (similarView?.active && isActive) {
      exitSimilarView();
    }
  }, [similarView?.active, isActive, exitSimilarView]);

  // 相似仓库视图激活时，列表数据源切换为相似结果，且忽略分类过滤
  const listRepositories = similarView?.active
    ? similarView.similarResults
    : (isActive ? searchResults : repositories);

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
          repositories={listRepositories}
          selectedCategory={similarView?.active ? 'all' : selectedCategory}
        />
      </div>
    </div>
  );
});
RepositoriesView.displayName = 'RepositoriesView';

const ReleasesView = React.memo(() => (
  <LazyViewBoundary>
    <LazyReleaseTimeline />
  </LazyViewBoundary>
));
ReleasesView.displayName = 'ReleasesView';

const GistsView = React.memo(() => (
  <LazyViewBoundary>
    <LazyGistView />
  </LazyViewBoundary>
));
GistsView.displayName = 'GistsView';

const ForksView = React.memo(() => (
  <LazyViewBoundary>
    <LazyForkTimeline />
  </LazyViewBoundary>
));
ForksView.displayName = 'ForksView';

const SettingsView = React.memo(() => (
  <LazyViewBoundary>
    <LazySettingsPanel />
  </LazyViewBoundary>
));
SettingsView.displayName = 'SettingsView';

const DiscoverySubscriptionView = React.memo(() => (
  <Suspense fallback={<ViewLoadingFallback />}>
    <LazyDiscoveryView />
  </Suspense>
));
DiscoverySubscriptionView.displayName = 'DiscoverySubscriptionView';

function App() {
  const {
    isAuthenticated,
    currentView,
    selectedCategory,
    theme,
    themePreset,
    hasHydrated,
    searchResults,
    searchFilters,
    repositories,
    setSelectedCategory,
  } = useAppStore(useShallow(selectAppShellState));

  useAutoUpdateCheck();
  useBackendLifecycle(hasHydrated);

  // Restore persisted frontend debug level at startup so capture is active
  // app-wide, not only after DiagnosticLogsPanel mounts.
  useEffect(() => {
    if (sessionStorage.getItem('gsm:frontend-debug') === 'true') {
      logger.setLevel('debug');
    }
  }, []);

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    // Suppress every color transition for one frame so the theme flip snaps
    // instead of smearing across the whole shell (better-ui recipe).
    const style = document.createElement('style');
    style.textContent = '*,*::before,*::after{transition:none !important}';
    document.head.appendChild(style);
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => style.remove()));
    return () => {
      cancelAnimationFrame(raf);
      style.remove();
    };
  }, [theme]);

  // Theme preset (palette/radius/font/shadow skin) rides on data-theme.
  useEffect(() => {
    applyThemePreset(themePreset);
  }, [themePreset]);

  const handleCategorySelect = useCallback((category: string) => {
    // 相似仓库视图下点击分类 = 离开相似视图并切换到该分类，避免交互歧义
    if (useAppStore.getState().similarView?.active) {
      useAppStore.getState().exitSimilarView();
    }
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
      case 'gists':
        return <GistsView />;
      case 'releases':
        return <ReleasesView />;
      case 'forks':
        return <ForksView />;
      case 'subscription':
        return (
          <ErrorBoundary>
            <DiscoverySubscriptionView />
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
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <div className="animate-pulse text-lg font-medium text-foreground">
          Loading...
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  return (
    <div className="ui-shell min-h-screen transition-colors duration-200">
      <UpdateNotificationBanner />
      <Header />
      <main className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-7">
        {currentViewContent}
      </main>
      <BackToTop />
      <DebugModeIndicator />
      <SyncModeChoiceModal />
      <ListsPushIndicator />
    </div>
  );
}

export default App;
