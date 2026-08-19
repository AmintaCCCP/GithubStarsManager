import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendPanel } from './BackendPanel';

const mocks = vi.hoisted(() => {
  const storeState = {
    repositories: [],
    releases: [],
    aiConfigs: [],
    webdavConfigs: [],
    activeAIConfig: null,
    activeWebDAVConfig: null,
    hiddenDefaultCategoryIds: [],
    categoryOrder: [],
    customCategories: [],
    assetFilters: {},
    collapsedSidebarCategoryCount: 20,
    backendApiSecret: null,
    githubToken: 'ghp-local-token',
    setBackendApiSecret: vi.fn(),
    setRepositories: vi.fn(),
    setReleases: vi.fn(),
    setAIConfigs: vi.fn(),
    setWebDAVConfigs: vi.fn(),
    showDefaultCategory: vi.fn(),
    hideDefaultCategory: vi.fn(),
  };

  return {
    storeState,
    useAppStore: vi.fn(() => storeState),
    backend: {
      init: vi.fn(),
      checkHealth: vi.fn(),
      verifyAuth: vi.fn(),
      isAvailable: true,
      syncRepositories: vi.fn(),
      syncReleases: vi.fn(),
      syncAIConfigs: vi.fn(),
      syncWebDAVConfigs: vi.fn(),
      syncSettings: vi.fn(),
      fetchRepositories: vi.fn(),
      fetchReleases: vi.fn(),
      fetchAIConfigs: vi.fn(),
      fetchWebDAVConfigs: vi.fn(),
      fetchSettings: vi.fn(),
    },
    tryRestoreAuthFromBackend: vi.fn(),
    syncLocalGitHubTokenToBackend: vi.fn(),
    toast: vi.fn(),
    confirm: vi.fn(),
  };
});

vi.mock('../../store/useAppStore', () => ({ useAppStore: mocks.useAppStore }));
vi.mock('../../services/backendAdapter', () => ({ backend: mocks.backend }));
vi.mock('../../services/autoSync', () => ({
  tryRestoreAuthFromBackend: mocks.tryRestoreAuthFromBackend,
  syncLocalGitHubTokenToBackend: mocks.syncLocalGitHubTokenToBackend,
}));
vi.mock('../../hooks/useDialog', () => ({
  useDialog: () => ({ toast: mocks.toast, confirm: mocks.confirm }),
}));

const health = { version: '0.1.0', timestamp: '2026-08-19T00:00:00Z' };
const t = (zh: string, en: string) => en;

describe('BackendPanel token synchronization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.backend.init.mockResolvedValue(undefined);
    mocks.backend.verifyAuth.mockResolvedValue(true);
    mocks.syncLocalGitHubTokenToBackend.mockResolvedValue(true);
    mocks.tryRestoreAuthFromBackend.mockResolvedValue(false);
  });

  it('syncs the local GitHub token when the backend becomes reachable on panel mount', async () => {
    mocks.backend.checkHealth.mockResolvedValue(health);

    render(<BackendPanel t={t} />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.syncLocalGitHubTokenToBackend).toHaveBeenCalledOnce();
    expect(screen.getByText('Connected')).toBeTruthy();
  });

  it('syncs the local GitHub token after a successful manual test connection', async () => {
    mocks.backend.checkHealth.mockResolvedValueOnce(null).mockResolvedValue(health);

    render(<BackendPanel t={t} />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.syncLocalGitHubTokenToBackend).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Test Connection'));

    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.syncLocalGitHubTokenToBackend).toHaveBeenCalledOnce();
  });

  it('does not sync the token when the backend is unreachable', async () => {
    mocks.backend.checkHealth.mockResolvedValue(null);

    render(<BackendPanel t={t} />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.syncLocalGitHubTokenToBackend).not.toHaveBeenCalled();
    expect(screen.getByText('Not Connected')).toBeTruthy();
  });
});