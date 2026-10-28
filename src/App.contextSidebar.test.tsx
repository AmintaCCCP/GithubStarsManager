import { act, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const storeState = {
    isAuthenticated: true,
    currentView: 'repositories',
    selectedCategory: 'all',
    theme: 'light',
    themePreset: null,
    themeTokens: null,
    language: 'zh',
    setCurrentView: vi.fn(),
    hasHydrated: true,
    searchResults: [],
    searchFilters: {
      query: '',
      tags: [],
      languages: [],
      platforms: [],
      licenses: [],
      sortBy: 'stars',
      sortOrder: 'desc',
    },
    repositories: [],
    githubToken: 'test-token',
    setSelectedCategory: vi.fn(),
    similarView: null,
    exitSimilarCategory: undefined,
    exitSimilarView: vi.fn(),
    starredGists: [],
    customCategories: [],
    hiddenDefaultCategoryIds: [],
    defaultCategoryOverrides: {},
    categoryOrder: [],
    collapsedSidebarCategoryCount: 6,
    categoryMatchMode: 'effective',
    deleteCustomCategory: vi.fn(),
    hideDefaultCategory: vi.fn(),
    showDefaultCategory: vi.fn(),
    updateRepository: vi.fn(),
    isSidebarCollapsed: false,
    setSidebarCollapsed: vi.fn(),
    toggleDiscoveryChannel: vi.fn(),
    discoveryRepos: {},
    discoveryIsLoading: {},
    assetFilters: [],
  };

  const gistActions = {
    user: { login: 'tamina' },
    gists: [],
    starredGists: [],
    gistSearchFilters: { query: '', sortBy: 'updated', sortOrder: 'desc' },
    gistSearchResults: [],
    selectedGistCategory: 'all',
    setGistSearchFilters: vi.fn(),
    setGistSearchResults: vi.fn(),
    setSelectedGistCategory: vi.fn(),
    setStarredGists: vi.fn(),
    refreshGists: vi.fn(),
    aiSearch: vi.fn(),
    analyzeVisibleGists: vi.fn(),
    fetchGistDetail: vi.fn(),
    submitGist: vi.fn(),
    isRefreshing: false,
    isSearching: false,
    isAnalyzingAll: false,
  };

  const discoveryActions = {
    githubToken: 'test-token',
    language: 'zh',
    discoveryChannels: [
      { id: 'trending', name: '趋势', nameEn: 'Trending', icon: 'trending', description: '', enabled: true },
    ],
    discoveryRepos: {},
    discoveryLastRefresh: {},
    discoveryIsLoading: {},
    discoveryIsLoadingMore: {},
    discoveryLoadMoreError: {},
    selectedDiscoveryChannel: 'trending',
    setSelectedDiscoveryChannel: vi.fn(),
    setDiscoveryScrollPosition: vi.fn(),
    analysisProgress: { total: 0, processed: 0 },
    discoveryPlatform: 'all',
    setDiscoveryPlatform: vi.fn(),
    discoveryLanguage: 'all',
    setDiscoveryLanguage: vi.fn(),
    discoverySortBy: 'stars',
    setDiscoverySortBy: vi.fn(),
    discoverySortOrder: 'desc',
    setDiscoverySortOrder: vi.fn(),
    discoverySearchQuery: '',
    setDiscoverySearchQuery: vi.fn(),
    discoverySearchMode: 'keyword',
    setDiscoverySearchMode: vi.fn(),
    discoverySearchPhase: 'idle',
    discoverySearchPhaseDetail: '',
    discoverySearchEmptyReason: null,
    discoverySelectedTopic: null,
    setDiscoverySelectedTopic: vi.fn(),
    discoveryHasMore: {},
    discoveryNextPage: {},
    discoveryTotalCount: {},
    trendingTimeRange: 'daily',
    setTrendingTimeRange: vi.fn(),
    weeklyOnlyCollected: false,
    setWeeklyOnlyCollected: vi.fn(),
    weeklySyncStatus: null,
    xTweetFollows: [],
    xTweetAuth: null,
    xTweetAuthRevision: null,
    xTweetSyncStatus: null,
    telegramFollows: [],
    telegramSyncStatus: null,
    t: (key: string) => key,
    isAnalyzing: false,
    refreshChannel: vi.fn(),
    handleAnalyzePage: vi.fn(),
    handleAbortAnalysis: vi.fn(),
  };

  return {
    storeState,
    useAppStore: vi.fn((selector?: (state: typeof storeState) => unknown) =>
      selector ? selector(storeState) : storeState,
    ),
    gistActions,
    discoveryActions,
  };
});

Object.assign(mocks.useAppStore, {
  getState: vi.fn(() => mocks.storeState),
});

vi.mock('./store/useAppStore', () => ({
  useAppStore: mocks.useAppStore,
  getAllCategories: () => [
    { id: 'all', name: '全部分类', icon: '📁', keywords: [] },
    { id: 'cat-ai', name: 'AI 工具', icon: '🤖', keywords: [], isCustom: true },
    { id: 'cat-dev', name: '开发工具', icon: '🛠️', keywords: [], isCustom: true },
  ],
  sortCategoriesByOrder: (categories: unknown[]) => categories,
}));
vi.mock('./services/backendAdapter', () => ({
  backend: { init: vi.fn(), isAvailable: true, syncSettings: vi.fn() },
}));
vi.mock('./services/logger', () => ({
  logger: {
    setLevel: vi.fn(),
    isDebugMode: vi.fn(() => false),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    errorFromError: vi.fn(),
  },
}));
vi.mock('./hooks/useAutoUpdateCheck', () => ({ useAutoUpdateCheck: vi.fn() }));
vi.mock('./services/mcpElectronBridge', () => ({
  startMcpElectronBridge: vi.fn(),
  stopMcpElectronBridge: vi.fn(),
  refreshMcpElectronBridge: vi.fn(),
}));
vi.mock('./services/autoSync', async () => {
  const actual = await vi.importActual<typeof import('./services/autoSync')>('./services/autoSync');
  return {
    ...actual,
    syncFromBackend: vi.fn(),
    startAutoSync: vi.fn(() => vi.fn()),
    stopAutoSync: vi.fn(),
    tryRestoreAuthFromBackend: vi.fn(async () => false),
  };
});
vi.mock('./features/lifecycle/hooks/useBackendLifecycle', () => ({ useBackendLifecycle: vi.fn() }));

vi.mock('./components/LoginScreen', () => ({ LoginScreen: () => null }));
vi.mock('./components/Header', () => ({ Header: () => null }));
vi.mock('./components/SearchBar', () => ({ SearchBar: () => null }));
vi.mock('./components/RepositoryList', () => ({ RepositoryList: () => <div data-testid="repositories-view" /> }));
vi.mock('./components/CategoryEditModal', () => ({
  CategoryEditModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="category-edit-modal" /> : null,
}));
vi.mock('./hooks/useDialog', () => ({
  useDialog: () => ({ toast: vi.fn(), confirm: vi.fn().mockResolvedValue(true) }),
}));
vi.mock('./features/repositories/hooks/useCategorySyncActions', () => ({
  useCategorySyncActions: () => ({ forceSyncToBackend: vi.fn().mockResolvedValue(undefined) }),
}));

vi.mock('./features/releases/hooks/useReleaseTimelineActions', async () => {
  const { defaultReleaseSourceSettings } = await import('./types');
  return {
    useReleaseTimelineActions: () => ({
      releases: [],
      repositories: [],
      releaseSubscriptions: new Set<number>(),
      releaseSourceSettings: defaultReleaseSourceSettings,
      readReleases: new Set<number>(),
      language: 'zh',
      assetFilters: [],
      markReleaseAsRead: vi.fn(),
      markAssetAsRead: vi.fn(),
      releaseViewMode: 'list',
      releaseSelectedFilters: [],
      releaseSearchQuery: '',
      releaseExpandedRepositories: new Set<number>(),
      releaseIsRefreshing: false,
      setReleaseViewMode: vi.fn(),
      toggleReleaseSelectedFilter: vi.fn(),
      clearReleaseSelectedFilters: vi.fn(),
      setReleaseSearchQuery: vi.fn(),
      toggleReleaseExpandedRepository: vi.fn(),
      includePreRelease: false,
      setIncludePreRelease: vi.fn(),
      releaseShowMode: 'all',
      setReleaseShowMode: vi.fn(),
      releaseLatestMode: 'all',
      setReleaseLatestMode: vi.fn(),
      lastRefreshTime: null,
      isMarkingAllRead: false,
      handleRefresh: vi.fn(),
      handleMarkAllRead: vi.fn(),
      handleUnsubscribeRelease: vi.fn(),
    }),
  };
});

vi.mock('./features/forks/hooks/useForkTimelineActions', () => ({
  useForkTimelineActions: () => ({
    readForks: new Set<number>(),
    language: 'zh',
    markForkAsRead: vi.fn(),
    forkSearchQuery: '',
    forkIsRefreshing: false,
    setForkSearchQuery: vi.fn(),
    isLoadingOrganizations: false,
    personalOwnerLogin: 'tamina',
    activeForkOwner: 'tamina',
    ownerForks: [],
    forkOwnerOptions: [],
    lastRefreshTime: null,
    expandedWorkflows: new Set<number>(),
    workflowsMap: {},
    loadingWorkflows: {},
    syncingForks: new Set<number>(),
    runningWorkflows: new Set<number>(),
    needsSyncMap: {},
    syncModal: { isOpen: false, fork: null },
    setSyncModal: vi.fn(),
    syncModalBranches: [],
    isFetchingBranches: false,
    handleRefresh: vi.fn(),
    handleForkOwnerChange: vi.fn(),
    toggleWorkflows: vi.fn(),
    handleSyncUpstream: vi.fn(),
    confirmSyncUpstream: vi.fn(),
    handleRunWorkflow: vi.fn(),
  }),
}));

vi.mock('./features/settings/hooks/useBackendAvailability', () => ({
  useBackendAvailability: () => false,
}));
vi.mock('./features/settings/hooks/useVectorSearchActions', () => ({
  useVectorSearchActions: () => ({ unindexedRepoCount: 0 }),
}));
vi.mock('./components/ReleaseSourceSettingsModal', () => ({
  ReleaseSourceSettingsModal: () => null,
}));
vi.mock('./components/ReleaseCard', () => ({ default: () => null }));
vi.mock('./components/ForkCard', () => ({ default: () => null }));
vi.mock('./components/settings', () => ({
  AppearancePanel: () => <div data-testid="AppearancePanel-content" />,
  GeneralPanel: () => <div data-testid="GeneralPanel-content" />,
  AIConfigPanel: () => <div data-testid="AIConfigPanel-content" />,
  WebDAVPanel: () => <div data-testid="WebDAVPanel-content" />,
  BackupPanel: () => <div data-testid="BackupPanel-content" />,
  BackendPanel: () => <div data-testid="BackendPanel-content" />,
  CategoryPanel: () => <div data-testid="CategoryPanel-content" />,
  DataManagementPanel: () => <div data-testid="DataManagementPanel-content" />,
  NetworkPanel: () => <div data-testid="NetworkPanel-content" />,
  DiagnosticLogsPanel: () => <div data-testid="DiagnosticLogsPanel-content" />,
  MenuManagementPanel: () => <div data-testid="MenuManagementPanel-content" />,
  StarSyncPanel: () => <div data-testid="StarSyncPanel-content" />,
  VectorSearchSettings: () => <div data-testid="VectorSearchSettings-content" />,
  McpSettingsPanel: () => <div data-testid="McpSettingsPanel-content" />,
  PluginSettingsPanel: () => <div data-testid="PluginSettingsPanel-content" />,
}));

vi.mock('./components/GistCard', () => ({ GistCard: () => null }));
vi.mock('./components/GistDetailModal', () => ({ GistDetailModal: () => null }));
vi.mock('./components/GistEditorModal', () => ({ GistEditorModal: () => null }));
vi.mock('./features/gists/hooks/useGistActions', () => ({ useGistActions: () => mocks.gistActions }));

vi.mock('./hooks/useWebScrapeSupport', () => ({
  useWebScrapeSupport: () => ({ supported: true, settled: true }),
}));
vi.mock('./features/discovery/hooks/useTrendingSnapshotCapture', () => ({
  useTrendingSnapshotCapture: vi.fn(),
}));
vi.mock('./features/discovery/hooks/useDiscoveryActions', async () => {
  const { makeT } = await import('./i18n/useT');
  const t = makeT('zh', 'discovery');
  return {
    useDiscoveryActions: () => ({ ...mocks.discoveryActions, t }),
  };
});
vi.mock('./features/discovery/components/TrendingHistoryPanel', () => ({
  TrendingHistoryPanel: () => null,
}));
vi.mock('./components/CodeSearchView', () => ({ CodeSearchView: () => null }));
vi.mock('./components/SubscriptionRepoCard', () => ({ SubscriptionRepoCard: () => null }));
vi.mock('./components/ScrollToBottom', () => ({ ScrollToBottom: () => null }));
vi.mock('./components/SortAlgorithmTooltip', () => ({ SortAlgorithmTooltip: () => null }));
vi.mock('./components/XTweetSettingsModal', () => ({ XTweetSettingsModal: () => null }));
vi.mock('./components/TelegramSettingsModal', () => ({ TelegramSettingsModal: () => null }));

vi.mock('./components/DebugModeIndicator', () => ({ DebugModeIndicator: () => null }));
vi.mock('./components/BackToTop', () => ({ BackToTop: () => null }));
vi.mock('./components/ErrorBoundary', () => ({ ErrorBoundary: ({ children }: { children: unknown }) => children }));
vi.mock('./components/SyncModeChoiceModal', () => ({ SyncModeChoiceModal: () => null }));
vi.mock('./components/UpdateNotificationBanner', () => ({ UpdateNotificationBanner: () => null }));
vi.mock('./components/ListsPushIndicator', () => ({ ListsPushIndicator: () => null }));

import App from './App';

const switchView = async (
  rerender: (ui: React.ReactElement) => void,
  view: string,
) => {
  mocks.storeState.currentView = view;
  await act(async () => {
    rerender(<App />);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

const expectNoForeignControls = () => {
  expect(screen.queryByLabelText('仓库分类')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '添加分类' })).not.toBeInTheDocument();
  expect(screen.queryByText('显示范围')).not.toBeInTheDocument();
  expect(screen.queryByText('设置标签页')).not.toBeInTheDocument();
  expect(screen.queryByText('拥有者:')).not.toBeInTheDocument();
};

describe('App route-aware context sidebars', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.storeState.currentView = 'repositories';
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
    if (typeof Element.prototype.scrollTo !== 'function') {
      Element.prototype.scrollTo = vi.fn();
    }
  });

  it('repositories 路由：唯一 repositories 侧栏，含分类管理与分类集合，不串台其他路由控件', async () => {
    render(<App />);

    const sidebar = await screen.findByLabelText('仓库分类');
    expect(sidebar.getAttribute('data-context-sidebar')).toBe('repositories');
    expect(document.querySelectorAll('[data-context-sidebar]')).toHaveLength(1);
    expect(screen.getByRole('button', { name: '添加分类' })).toBeInTheDocument();
    expect(within(sidebar).getByText('全部仓库')).toBeInTheDocument();
    expect(within(sidebar).getByText('AI 工具')).toBeInTheDocument();
    expect(screen.queryByText('显示范围')).not.toBeInTheDocument();
    expect(screen.queryByText('设置标签页')).not.toBeInTheDocument();
    expect(screen.queryByText('拥有者:')).not.toBeInTheDocument();
  });

  it('gists 路由：唯一 gists 侧栏，含 All/Starred/Mine，不串台仓库分类与其他路由控件', async () => {
    const { rerender } = render(<App />);
    await screen.findByLabelText('仓库分类');
    await switchView(rerender, 'gists');

    const sidebar = await screen.findByLabelText('Gist 上下文侧栏', {}, { timeout: 5000 });
    expect(sidebar.getAttribute('data-context-sidebar')).toBe('gists');
    expect(document.querySelectorAll('[data-context-sidebar]')).toHaveLength(1);
    expect(within(sidebar).getByRole('button', { name: /^全部 gist/ })).toBeInTheDocument();
    expect(within(sidebar).getByRole('button', { name: /^星标 gist/ })).toBeInTheDocument();
    expect(within(sidebar).getByRole('button', { name: /^我的 gist/ })).toBeInTheDocument();
    expectNoForeignControls();
  });

  it('subscription 路由：唯一 discovery 侧栏，含发现频道，不串台仓库分类与其他路由控件', async () => {
    const { rerender } = render(<App />);
    await screen.findByLabelText('仓库分类');
    await switchView(rerender, 'subscription');

    const sidebar = await screen.findByLabelText('发现频道', {}, { timeout: 5000 });
    expect(sidebar.getAttribute('data-context-sidebar')).toBe('discovery');
    expect(document.querySelectorAll('[data-context-sidebar]')).toHaveLength(1);
    expect(within(sidebar).getByRole('button', { name: /^趋势/ })).toBeInTheDocument();
    expectNoForeignControls();
  });

  it('releases 路由：唯一 releases 侧栏，含发布筛选且不串台仓库分类', async () => {
    const { rerender } = render(<App />);
    await screen.findByLabelText('仓库分类');
    await switchView(rerender, 'releases');

    const sidebar = await screen.findByLabelText('发布', {}, { timeout: 5000 });
    expect(sidebar.getAttribute('data-context-sidebar')).toBe('releases');
    expect(document.querySelectorAll('[data-context-sidebar]')).toHaveLength(1);
    expect(within(sidebar).getByText('收件箱')).toBeInTheDocument();
    expect(within(sidebar).getByRole('button', { name: 'Release 来源设置' })).toBeInTheDocument();
    expect(screen.queryByLabelText('仓库分类')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '添加分类' })).not.toBeInTheDocument();
  });

  it('forks 路由：唯一 forks 侧栏，拥有者属于页面作用域且不串台仓库分类', async () => {
    const { rerender } = render(<App />);
    await screen.findByLabelText('仓库分类');
    await switchView(rerender, 'forks');

    const sidebar = await screen.findByLabelText('复刻', {}, { timeout: 5000 });
    expect(sidebar.getAttribute('data-context-sidebar')).toBe('forks');
    expect(document.querySelectorAll('[data-context-sidebar]')).toHaveLength(1);
    expect(within(sidebar).getByRole('button', { name: /^全部复刻/ })).toBeInTheDocument();
    expect(within(sidebar).queryByText('上游仓库')).not.toBeInTheDocument();
    expect(sidebar.querySelector('[role="combobox"]')).toBeNull();
    expect(screen.getAllByRole('combobox', { name: '拥有者:' })[0].closest('[data-context-sidebar]')).toBeNull();
    expect(screen.queryByLabelText('仓库分类')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '添加分类' })).not.toBeInTheDocument();
  });

  it('settings 路由：唯一 settings 侧栏，含设置标签且不串台仓库分类', async () => {
    const { rerender } = render(<App />);
    await screen.findByLabelText('仓库分类');
    await switchView(rerender, 'settings');

    const sidebar = await screen.findByLabelText('设置', {}, { timeout: 5000 });
    expect(sidebar.getAttribute('data-context-sidebar')).toBe('settings');
    expect(document.querySelectorAll('[data-context-sidebar]')).toHaveLength(1);
    expect(within(sidebar).getByRole('tablist', { name: '设置标签页' })).toBeInTheDocument();
    expect(screen.queryByLabelText('仓库分类')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '添加分类' })).not.toBeInTheDocument();
  });

  it('连续切换路由时上一路由的侧栏被卸载，不残留重复 data-context-sidebar', async () => {
    const { rerender } = render(<App />);
    await screen.findByLabelText('仓库分类');
    expect(document.querySelectorAll('[data-context-sidebar]')).toHaveLength(1);

    await switchView(rerender, 'gists');
    await waitFor(() => {
      expect(document.querySelectorAll('[data-context-sidebar]')).toHaveLength(1);
    });
    expect(document.querySelector('[data-context-sidebar]')?.getAttribute('data-context-sidebar')).toBe('gists');

    await switchView(rerender, 'repositories');
    await waitFor(() => {
      expect(document.querySelectorAll('[data-context-sidebar]')).toHaveLength(1);
    });
    expect(document.querySelector('[data-context-sidebar]')?.getAttribute('data-context-sidebar')).toBe('repositories');
  });
});
