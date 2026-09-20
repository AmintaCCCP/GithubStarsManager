import React, { Suspense, useEffect, useMemo, useCallback } from 'react';
import { LoginScreen } from './components/LoginScreen';
import { Header } from './components/Header';

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
import { useBackendLifecycle } from './features/lifecycle/hooks/useBackendLifecycle';
import { isElectron, loadEncryptedXAuthViaDesktop } from './services/electronProxy';

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
const LazyRepositoriesView = React.lazy(() =>
  import('./components/RepositoriesView').then((module) => ({ default: module.RepositoriesView }))
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

  // Restore persisted encrypted X auth cookies on desktop startup after hydration completes (#356)
  useEffect(() => {
    if (!hasHydrated || !isElectron()) return;
    loadEncryptedXAuthViaDesktop().then((auth) => {
      if (auth) {
        const current = useAppStore.getState().xTweetAuth;
        if (!current || current.authToken !== auth.authToken || current.ct0 !== auth.ct0) {
          logger.info('xAuth', 'Restoring encrypted X auth from disk');
          useAppStore.getState().setXTweetAuth(auth);
        } else {
          logger.debug('xAuth', 'Encrypted X auth already matches in-memory state; skipping restore');
        }
      } else {
        logger.debug('xAuth', 'No encrypted X auth found on disk');
      }
    }).catch((err: unknown) => {
      logger.errorFromError('xAuth', 'Failed to load encrypted X auth from disk', err);
    });
  }, [hasHydrated]);

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
          <LazyViewBoundary>
            <LazyRepositoriesView
              repositories={repositories}
              searchResults={searchResults}
              searchFilters={searchFilters}
              selectedCategory={selectedCategory}
              onCategorySelect={handleCategorySelect}
            />
          </LazyViewBoundary>
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
