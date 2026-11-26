import React, { Suspense, useEffect, useLayoutEffect, useMemo, useCallback, useDeferredValue, useState, useRef } from 'react';
import { LoginScreen } from './components/LoginScreen';
import { Header } from './components/Header';
import { SearchBar } from './components/SearchBar';
import { RepositoryList } from './components/RepositoryList';
import { CategorySidebar } from './components/CategorySidebar';
import { WorkspacePageHeader } from './components/WorkspacePageHeader';

import { DebugModeIndicator } from './components/DebugModeIndicator';

import { BackToTop } from './components/BackToTop';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SyncModeChoiceModal } from './components/SyncModeChoiceModal';
import { useAppStore, getAllCategories } from './store/useAppStore';
import { useSystemThemeSync } from './hooks/useSystemThemeSync';
import { resolveTheme, selectAppShellState } from './store/selectors';
import { useShallow } from 'zustand/react/shallow';
import { applyThemePreset } from './lib/themePresets';
import { applyThemeTokens } from './utils/themeTokens';
import { changeAppLanguage } from './i18n';
import { useAutoUpdateCheck } from './hooks/useAutoUpdateCheck';
import { logger } from './services/logger';
import { UpdateNotificationBanner } from './components/UpdateNotificationBanner';
import { ProfileStatusBanners } from './components/ProfileStatusBanners';
import { ListsPushIndicator } from './components/ListsPushIndicator';
import { PluginPageHost } from './components/PluginPageHost';
import { useBackendLifecycle } from './features/lifecycle/hooks/useBackendLifecycle';
import type { AppState } from './types';
import { hasActiveSearchFilters } from './utils/repoSearch';
import { isElectron, loadEncryptedXAuthViaDesktop } from './services/electronProxy';
import { useT } from './i18n/useT';
import { matchesCategory } from './utils/categoryUtils';

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

const DEFAULT_SIDEBAR_WIDTH = 232;
const MIN_SIDEBAR_WIDTH = 196;
const MAX_SIDEBAR_WIDTH = 340;
const SIDEBAR_WIDTH_STORAGE_KEY = 'gsm:sidebar-width';

function readPersistedSidebarWidth(): number {
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    const parsed = raw ? Number(raw) : NaN;
    if (Number.isFinite(parsed) && parsed >= MIN_SIDEBAR_WIDTH && parsed <= MAX_SIDEBAR_WIDTH) {
      return Math.round(parsed);
    }
  } catch {
    // Ignore storage read failures in restricted environments.
  }
  return DEFAULT_SIDEBAR_WIDTH;
}

const ViewLoadingFallback: React.FC = () => (
  <div className="flex min-h-[12rem] items-center justify-center bg-navigator text-foreground" role="status" aria-live="polite">
    <div className="animate-pulse text-label font-medium text-secondary">Loading...</div>
  </div>
);

// 懒视图只保留错误边界。Suspense 上移到 App 视图容器的外层：这样懒模块
// 加载期间整个淡入容器都不挂载，动画在目标内容真正提交时才开始播放，
// 而不是先在 loading 占位上播完。
const LazyViewBoundary: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ErrorBoundary>{children}</ErrorBoundary>
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
  const t = useT('app');
  const isActive = hasActiveSearchFilters(searchFilters);
  const similarView = useAppStore((state) => state.similarView);
  const exitSimilarView = useAppStore((state) => state.exitSimilarView);
  const {
    language,
    customCategories,
    hiddenDefaultCategoryIds,
    defaultCategoryOverrides,
    categoryMatchMode,
  } = useAppStore(useShallow((state) => ({
    language: state.language,
    customCategories: state.customCategories,
    hiddenDefaultCategoryIds: state.hiddenDefaultCategoryIds,
    defaultCategoryOverrides: state.defaultCategoryOverrides,
    categoryMatchMode: state.categoryMatchMode,
  })));
  const allCategories = useMemo(
    () => getAllCategories(customCategories, language, hiddenDefaultCategoryIds, defaultCategoryOverrides),
    [customCategories, language, hiddenDefaultCategoryIds, defaultCategoryOverrides]
  );
  const currentCategory = allCategories.find((category) => category.id === selectedCategory);
  const currentCategoryRepositories = useMemo(() => {
    if (selectedCategory === 'all') return repositories;
    const category = allCategories.find((item) => item.id === selectedCategory);
    return category
      ? repositories.filter((repository) => matchesCategory(repository, category, categoryMatchMode))
      : [];
  }, [repositories, selectedCategory, allCategories, categoryMatchMode]);
  const analyzedRepositoryCount = currentCategoryRepositories.filter(
    (repository) => repository.analyzed_at && !repository.analysis_failed
  ).length;
  // Similar view preserves the user's sort preference, which is not a search
  // filter and must not trigger the "search takes precedence" exit.
  const hasActiveQueryOrFilter = hasActiveSearchFilters({
    ...searchFilters,
    sortBy: 'stars',
    sortOrder: 'desc',
  });

  // 相似视图下用户发起搜索时，自动退出相似视图（搜索优先于相似浏览，避免界面歧义）
  useEffect(() => {
    if (similarView?.active && hasActiveQueryOrFilter) {
      exitSimilarView();
    }
  }, [similarView?.active, hasActiveQueryOrFilter, exitSimilarView]);

  const [sidebarWidth, setSidebarWidth] = useState<number>(readPersistedSidebarWidth);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const resizeCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => {
    resizeCleanupRef.current?.();
  }, []);

  const persistSidebarWidth = useCallback((width: number) => {
    try {
      localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(width));
    } catch {
      // Ignore storage write failures in restricted environments.
    }
  }, []);

  const commitSidebarWidth = useCallback((nextWidth: number) => {
    // End any in-flight drag first so its deferred persist (stopResizing) cannot
    // overwrite the value we are about to commit.
    resizeCleanupRef.current?.();
    const clamped = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(nextWidth)));
    setSidebarWidth(clamped);
    persistSidebarWidth(clamped);
  }, [persistSidebarWidth]);

  const handleSidebarResizeStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    let latestWidth = startWidth;
    setIsResizingSidebar(true);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const next = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(startWidth + (moveEvent.clientX - startX))));
      latestWidth = next;
      setSidebarWidth(next);
    };

    const stopResizing = () => {
      setIsResizingSidebar(false);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResizing);
      window.removeEventListener('pointercancel', stopResizing);
      resizeCleanupRef.current = null;
      persistSidebarWidth(latestWidth);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResizing);
    window.addEventListener('pointercancel', stopResizing);
    resizeCleanupRef.current = stopResizing;
  }, [sidebarWidth, persistSidebarWidth]);

  const handleSidebarResizeReset = useCallback(() => {
    commitSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
  }, [commitSidebarWidth]);

  const handleSidebarResizeKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 32 : 16;
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        commitSidebarWidth(sidebarWidth - step);
        break;
      case 'ArrowRight':
        event.preventDefault();
        commitSidebarWidth(sidebarWidth + step);
        break;
      case 'Home':
        event.preventDefault();
        commitSidebarWidth(MIN_SIDEBAR_WIDTH);
        break;
      case 'End':
        event.preventDefault();
        commitSidebarWidth(MAX_SIDEBAR_WIDTH);
        break;
      case 'Enter':
      case '0':
        event.preventDefault();
        commitSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
        break;
      default:
        break;
    }
  }, [sidebarWidth, commitSidebarWidth]);

  // 相似仓库视图激活时，列表数据源切换为相似结果，且忽略分类过滤
  const listRepositories = similarView?.active
    ? similarView.similarResults
    : (isActive ? searchResults : repositories);

  return (
    <div
      className={`route-workspace lg:[&_.linear-sidebar]:border-e-0 ${isResizingSidebar ? 'select-none' : ''}`}
      style={{ '--app-sidebar-width': `${sidebarWidth}px` } as React.CSSProperties}
    >
      <CategorySidebar
        repositories={repositories}
        selectedCategory={selectedCategory}
        onCategorySelect={onCategorySelect}
      />
      <div
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-label="Sidebar resizer"
        aria-valuenow={sidebarWidth}
        aria-valuemin={MIN_SIDEBAR_WIDTH}
        aria-valuemax={MAX_SIDEBAR_WIDTH}
        onPointerDown={handleSidebarResizeStart}
        onDoubleClick={handleSidebarResizeReset}
        onKeyDown={handleSidebarResizeKeyDown}
        className="group hidden w-2 shrink-0 cursor-col-resize items-stretch justify-center self-stretch rounded-sm select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:flex"
      >
        <div
          className={`my-2 w-[2px] rounded-full transition-colors duration-micro ease-out-subtle ${
            isResizingSidebar ? 'bg-accent-solid/70' : 'bg-transparent group-hover:bg-border-alpha-strong group-focus-visible:bg-border-alpha-strong'
          }`}
        />
      </div>
      <div className="workspace-content app-workspace-content flex flex-col !p-0 lg:!py-2 lg:!pr-2.5 lg:!pl-0">
        <div className="min-w-0 flex-1 space-y-4 bg-paper px-4 py-4 shadow-elev-0 sm:px-5 lg:rounded-lg">
          <WorkspacePageHeader
            eyebrow={t('categorySidebar.workspace-label')}
            section={t('header.menu-repositories')}
            title={selectedCategory === 'all'
              ? t('categorySidebar.all-repositories')
              : currentCategory?.name ?? t('categorySidebar.all-repositories')}
            meta={(
              <div className="flex items-center gap-2 text-label-sm text-tertiary tabular-nums">
                <span>{t('categorySidebar.repository-count', { count: currentCategoryRepositories.length })}</span>
                {analyzedRepositoryCount > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{t('searchResultStats.ai-analyzed-count', { count: analyzedRepositoryCount })}</span>
                  </>
                )}
              </div>
            )}
          />
          <SearchBar />
          <RepositoryList
            repositories={listRepositories}
            selectedCategory={similarView?.active ? 'all' : selectedCategory}
          />
        </div>
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

const DiscoverySubscriptionView = React.memo(() => <LazyDiscoveryView />);
DiscoverySubscriptionView.displayName = 'DiscoverySubscriptionView';

function App() {
  const {
    isAuthenticated,
    currentView,
    selectedCategory,
    themeMode,
    systemTheme,
    themePresetLight,
    themePresetDark,
    themeTokens,
    language,
    hasHydrated,
    searchResults,
    searchFilters,
    repositories,
    setSelectedCategory,
  } = useAppStore(useShallow(selectAppShellState));

  useAutoUpdateCheck();
  useBackendLifecycle(hasHydrated);

  const theme = resolveTheme(themeMode, systemTheme);
  useSystemThemeSync(themeMode);

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

  // Theme preset (palette/radius/font/shadow skin) rides on data-theme;
  // 深浅模式可分别配置，随解析出的主题切换生效。
  const activeThemePreset = theme === 'dark' ? themePresetDark : themePresetLight;
  useEffect(() => {
    applyThemePreset(activeThemePreset);
  }, [activeThemePreset]);

  // Theme token（开发守则 §14）：内联 CSS 变量覆盖预设；恢复默认时删掉内联值，
  // 预设的 --radius / --primary 自然重新生效。排在预设 effect 之后即可。
  useEffect(() => {
    applyThemeTokens(themeTokens);
  }, [themeTokens, theme, activeThemePreset]);

  // 视图切换并发渲染：切换瞬间先保留旧视图画面，新视图在低优先级渲染完
  // 再一次性提交，避免重视图（几百张卡片）同步挂载造成的长帧卡顿。
  const deferredView = useDeferredValue(currentView);

  // 滚动重置跟随 deferredView：新视图提交的同一帧再回顶，避免旧视图
  // 还在屏上时滚动先跳、新内容后到的闪跳。用布局 effect 保证复位发生在
  // 新内容绘制之前（reduced-motion 下没有淡入遮盖位置跳变）。
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [deferredView]);

  // Language side effect: zustand 的 language 是唯一事实源，这里只负责装载
  // 语言包、切换 i18next 并同步 <html lang>。
  useEffect(() => {
    void changeAppLanguage(language);
  }, [language]);

  const handleCategorySelect = useCallback((category: string) => {
    // 相似仓库视图下点击分类 = 离开相似视图并切换到该分类，避免交互歧义
    if (useAppStore.getState().similarView?.active) {
      useAppStore.getState().exitSimilarView();
    }
    setSelectedCategory(category);
  }, [setSelectedCategory]);

  const currentViewContent = useMemo(() => {
    switch (deferredView) {
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
  }, [deferredView, repositories, searchResults, searchFilters, selectedCategory, handleCategorySelect]);

  // Show loading state while store is hydrating to ensure correct theme is applied
  if (!hasHydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-navigator text-foreground">
        <div className="animate-pulse text-label font-medium text-secondary">
          Loading...
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <>
        <ProfileStatusBanners />
        <LoginScreen />
      </>
    );
  }

  return (
    <div className="ui-shell min-h-screen bg-navigator text-foreground transition-colors duration-200">
      <ProfileStatusBanners />
      <UpdateNotificationBanner />
      <Header />
      <main className="app-main">
        {/* key 化包裹层：视图切换时重挂载并重放 200ms 淡入，消除硬切的突兀感。
            只动 opacity（transform 动画期间会为 fixed 后代创建 containing block）。
            Suspense 在容器外层：懒加载 fallback 不在淡入容器内，动画等目标
            内容真正提交时才开始。切换是低优先级更新，期间旧视图保持可见。 */}
        <Suspense fallback={<ViewLoadingFallback />}>
          <div key={deferredView} className="motion-safe:animate-fade-in">
            {currentViewContent}
          </div>
        </Suspense>
      </main>
      <BackToTop />
      <DebugModeIndicator />
      <SyncModeChoiceModal />
      <ListsPushIndicator />
      <PluginPageHost />
    </div>
  );
}

export default App;
