import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const storeState = {
    isAuthenticated: true,
    currentView: 'repositories',
    selectedCategory: 'all',
    theme: 'light',
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
    githubToken: 'ghp-local-token',
    setSelectedCategory: vi.fn(),
  };

  return {
    storeState,
    useAppStore: vi.fn((selector?: (state: typeof storeState) => unknown) =>
      selector ? selector(storeState) : storeState,
    ),
    backend: {
      init: vi.fn(),
      isAvailable: true,
      syncSettings: vi.fn(),
    },
    syncFromBackend: vi.fn(),
    startAutoSync: vi.fn(),
    stopAutoSync: vi.fn(),
    tryRestoreAuthFromBackend: vi.fn(),
    startMcpElectronBridge: vi.fn(),
    stopMcpElectronBridge: vi.fn(),
    refreshMcpElectronBridge: vi.fn(),
    useAutoUpdateCheck: vi.fn(),
    loadedViews: new Set<string>(),
  };
});

Object.assign(mocks.useAppStore, {
  getState: vi.fn(() => mocks.storeState),
});

vi.mock('./store/useAppStore', () => ({ useAppStore: mocks.useAppStore }));
vi.mock('./services/backendAdapter', () => ({ backend: mocks.backend }));
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
vi.mock('./hooks/useAutoUpdateCheck', () => ({ useAutoUpdateCheck: mocks.useAutoUpdateCheck }));
vi.mock('./services/mcpElectronBridge', () => ({
  startMcpElectronBridge: mocks.startMcpElectronBridge,
  stopMcpElectronBridge: mocks.stopMcpElectronBridge,
  refreshMcpElectronBridge: mocks.refreshMcpElectronBridge,
}));
vi.mock('./services/autoSync', async () => {
  const actual = await vi.importActual<typeof import('./services/autoSync')>('./services/autoSync');
  return {
    ...actual,
    syncFromBackend: mocks.syncFromBackend,
    startAutoSync: mocks.startAutoSync,
    stopAutoSync: mocks.stopAutoSync,
    tryRestoreAuthFromBackend: mocks.tryRestoreAuthFromBackend,
  };
});

vi.mock('./components/LoginScreen', () => ({ LoginScreen: () => null }));
vi.mock('./components/Header', () => ({ Header: () => null }));
vi.mock('./components/SearchBar', () => ({ SearchBar: () => null }));
vi.mock('./components/RepositoryList', () => ({ RepositoryList: () => <div data-testid="repositories-view" /> }));
vi.mock('./components/CategorySidebar', () => ({ CategorySidebar: () => null }));
vi.mock('./components/ReleaseTimeline', () => {
  mocks.loadedViews.add('releases');
  return { ReleaseTimeline: () => <div data-testid="releases-view" /> };
});
vi.mock('./components/ForkTimeline', () => {
  mocks.loadedViews.add('forks');
  return { ForkTimeline: () => <div data-testid="forks-view" /> };
});
vi.mock('./components/SettingsPanel', () => {
  mocks.loadedViews.add('settings');
  return { SettingsPanel: () => <div data-testid="settings-view" /> };
});
vi.mock('./components/DebugModeIndicator', () => ({ DebugModeIndicator: () => null }));
vi.mock('./components/DiscoveryView', () => {
  mocks.loadedViews.add('subscription');
  return { DiscoveryView: () => <div data-testid="subscription-view" /> };
});
vi.mock('./components/GistView', () => {
  mocks.loadedViews.add('gists');
  return { GistView: () => <div data-testid="gists-view" /> };
});
vi.mock('./components/BackToTop', () => ({ BackToTop: () => null }));
vi.mock('./components/ErrorBoundary', () => ({ ErrorBoundary: ({ children }: { children: unknown }) => children }));
vi.mock('./components/SyncModeChoiceModal', () => ({ SyncModeChoiceModal: () => null }));
vi.mock('./components/UpdateNotificationBanner', () => ({ UpdateNotificationBanner: () => null }));
vi.mock('./components/ListsPushIndicator', () => ({ ListsPushIndicator: () => null }));

import App from './App';

describe('App backend initialization', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.storeState.currentView = 'repositories';
    mocks.loadedViews.clear();
    mocks.backend.isAvailable = true;
    mocks.backend.init.mockResolvedValue(undefined);
    mocks.tryRestoreAuthFromBackend.mockResolvedValue(false);
    mocks.startAutoSync.mockReturnValue(vi.fn());
    mocks.backend.syncSettings.mockImplementation(
      (_settings: Record<string, unknown>, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
        }),
    );
  });

  it('continues backend loading after a pending local token sync reaches its deadline', async () => {
    render(<App />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.syncFromBackend).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(mocks.backend.syncSettings).toHaveBeenCalledOnce();
    expect(mocks.syncFromBackend).toHaveBeenCalledOnce();
    expect(mocks.startAutoSync).toHaveBeenCalledOnce();
  });

  it('renders repositories before dormant views load, then resolves every lazy primary view after a view switch', async () => {
    vi.useRealTimers();
    const { rerender } = render(<App />);

    expect(screen.getByTestId('repositories-view')).toBeInTheDocument();
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.loadedViews).toEqual(new Set());

    const lazyViews = [
      ['settings', 'settings-view'],
      ['subscription', 'subscription-view'],
      ['gists', 'gists-view'],
      ['releases', 'releases-view'],
      ['forks', 'forks-view'],
    ] as const;

    for (const [currentView, testId] of lazyViews) {
      await act(async () => {
        mocks.storeState.currentView = currentView;
        rerender(<App />);
        await Promise.resolve();
      });
      expect(screen.getByTestId(testId)).toBeInTheDocument();
      expect(mocks.loadedViews).toContain(currentView);
    }
  });
});
