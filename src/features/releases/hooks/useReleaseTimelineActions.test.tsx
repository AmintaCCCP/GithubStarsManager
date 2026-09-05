import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useReleaseTimelineActions } from './useReleaseTimelineActions';

const mocks = vi.hoisted(() => ({
  useAppStore: vi.fn(),
  toast: vi.fn(),
  confirm: vi.fn(),
  getAllWatchedRepositories: vi.fn(),
  setReleaseSourceRepositories: vi.fn(),
  forceSyncToBackend: vi.fn(),
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: mocks.useAppStore,
}));

vi.mock('../../../hooks/useDialog', () => ({
  useDialog: () => ({ toast: mocks.toast, confirm: mocks.confirm }),
}));

vi.mock('../../../services/githubApi', () => ({
  GitHubApiService: class {
    getAllWatchedRepositories = mocks.getAllWatchedRepositories;
  },
}));

vi.mock('../../../services/autoSync', () => ({
  forceSyncToBackend: mocks.forceSyncToBackend,
}));

vi.mock('../../../services/backendAdapter', () => ({
  backend: { isAvailable: false, markAllReleasesAsRead: vi.fn() },
}));

const createStoreState = () => ({
  // selectReleaseTimelineState 全字段
  releases: [],
  repositories: [],
  releaseSubscriptions: new Set<number>(),
  releaseSourceSettings: {
    enabledSourceIds: ['watch-custom-release'],
    watchCustomReleaseRepos: [
      { full_name: 'owner/watched', html_url: 'https://github.com/owner/watched', release_hidden: true },
    ],
    customReleaseRepos: [],
  },
  readReleases: new Set<number>(),
  githubToken: 'github-token' as string | null,
  language: 'zh' as const,
  assetFilters: new Map(),
  addReleases: vi.fn(),
  upsertReleases: vi.fn(),
  markReleaseAsRead: vi.fn(),
  markAssetAsRead: vi.fn(),
  markAllReleasesAsRead: vi.fn(),
  batchUnsubscribeReleases: vi.fn(),
  removeReleasesByRepoFullName: vi.fn(),
  updateRepository: vi.fn(),
  removeReleaseSourceRepository: vi.fn(),
  updateReleaseSourceRepository: vi.fn(),
  releaseViewMode: 'grouped' as const,
  releaseSelectedFilters: new Set<string>(),
  releaseSearchQuery: '',
  releaseExpandedRepositories: new Set<string>(),
  releaseIsRefreshing: false,
  setReleaseViewMode: vi.fn(),
  toggleReleaseSelectedFilter: vi.fn(),
  clearReleaseSelectedFilters: vi.fn(),
  setReleaseSearchQuery: vi.fn(),
  toggleReleaseExpandedRepository: vi.fn(),
  setReleaseIsRefreshing: vi.fn(),
  includePreRelease: false,
  setIncludePreRelease: vi.fn(),
  releaseShowMode: 'all' as const,
  setReleaseShowMode: vi.fn(),
  releaseLatestMode: 'latest' as const,
  setReleaseLatestMode: vi.fn(),
  // 独立单值 selector
  setReleaseSourceRepositories: mocks.setReleaseSourceRepositories,
});

let storeState = createStoreState();
const mockUseAppStore = vi.mocked(mocks.useAppStore);
mockUseAppStore.mockImplementation((selector?: (state: typeof storeState) => unknown) =>
  selector ? selector(storeState) : storeState);
(mockUseAppStore as unknown as { getState: () => typeof storeState }).getState = () => storeState;

describe('useReleaseTimelineActions.syncWatchedSources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState = createStoreState();
  });

  it('returns silently without token or while a sync is running', async () => {
    storeState.githubToken = null;
    const { result } = renderHook(() => useReleaseTimelineActions());
    await act(async () => { await result.current.syncWatchedSources(); });
    expect(mocks.getAllWatchedRepositories).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(mocks.setReleaseSourceRepositories).not.toHaveBeenCalled();
  });

  it('maps watched repositories, keeps release_hidden, writes the store and toasts success', async () => {
    mocks.getAllWatchedRepositories.mockResolvedValue([
      {
        id: 1,
        name: 'watched',
        full_name: 'owner/watched',
        html_url: 'https://github.com/owner/watched',
        owner: { login: 'owner', avatar_url: 'https://example.com/a.png' },
        description: 'desc',
        language: 'TypeScript',
        stargazers_count: 5,
        forks_count: 1,
        forks: 1,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-02T00:00:00.000Z',
        pushed_at: '2026-01-03T00:00:00.000Z',
        topics: [],
      },
      {
        id: 2,
        name: 'fresh',
        full_name: 'owner/fresh',
        html_url: 'https://github.com/owner/fresh',
        owner: { login: 'owner', avatar_url: 'https://example.com/a.png' },
        description: 'd2',
        language: 'Go',
        stargazers_count: 7,
        forks_count: 2,
        forks: 2,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-02T00:00:00.000Z',
        pushed_at: '2026-01-03T00:00:00.000Z',
        topics: [],
      },
    ]);
    const { result } = renderHook(() => useReleaseTimelineActions());
    await act(async () => { await result.current.syncWatchedSources(); });

    expect(mocks.setReleaseSourceRepositories).toHaveBeenCalledTimes(1);
    const [sourceId, repos] = mocks.setReleaseSourceRepositories.mock.calls[0];
    expect(sourceId).toBe('watch-custom-release');
    expect(repos).toHaveLength(2);
    const previouslyHidden = repos.find((repo: { full_name: string }) => repo.full_name === 'owner/watched');
    expect(previouslyHidden.release_hidden).toBe(true);
    const fresh = repos.find((repo: { full_name: string }) => repo.full_name === 'owner/fresh');
    expect(fresh.release_hidden).toBeUndefined();
    expect(mocks.toast).toHaveBeenCalledWith('已同步 2 个 Watch 仓库。', 'success');
    expect(result.current.isSyncingWatchedSources).toBe(false);
    expect(mocks.forceSyncToBackend).not.toHaveBeenCalled();
  });

  it('reads release_hidden from the latest state after the request resolves', async () => {
    // 模拟同步期间用户在设置面板切换隐藏状态：await 挂起时改 store，
    // 完成后写入的 sourceRepos 必须保留切换后的值而非调用时的旧快照。
    let resolveWatched!: (repos: unknown[]) => void;
    mocks.getAllWatchedRepositories.mockImplementation(() => new Promise((resolve) => {
      resolveWatched = resolve;
    }));
    const { result } = renderHook(() => useReleaseTimelineActions());

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.syncWatchedSources();
    });
    await waitFor(() => expect(mocks.getAllWatchedRepositories).toHaveBeenCalled());
    act(() => {
      storeState.releaseSourceSettings = {
        ...storeState.releaseSourceSettings,
        watchCustomReleaseRepos: [
          { full_name: 'owner/watched', html_url: 'https://github.com/owner/watched', release_hidden: false },
        ],
      };
    });
    resolveWatched([
      {
        id: 1,
        name: 'watched',
        full_name: 'owner/watched',
        html_url: 'https://github.com/owner/watched',
        owner: { login: 'owner', avatar_url: 'https://example.com/a.png' },
        description: 'desc',
        language: 'TypeScript',
        stargazers_count: 5,
        forks_count: 1,
        forks: 1,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-02T00:00:00.000Z',
        pushed_at: '2026-01-03T00:00:00.000Z',
        topics: [],
      },
    ]);
    await act(async () => { await pending; });

    const repos = mocks.setReleaseSourceRepositories.mock.calls[0][1];
    expect(repos[0].release_hidden).toBeUndefined();
    expect(mocks.toast).toHaveBeenCalledWith('已同步 1 个 Watch 仓库。', 'success');
  });

  it('toasts a failure without writing the store when the api rejects', async () => {
    mocks.getAllWatchedRepositories.mockRejectedValue(new Error('rate limited'));
    const { result } = renderHook(() => useReleaseTimelineActions());
    await act(async () => { await result.current.syncWatchedSources(); });

    expect(mocks.setReleaseSourceRepositories).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith('同步 Watch 仓库失败，请检查网络或 Token 权限。', 'error');
    expect(result.current.isSyncingWatchedSources).toBe(false);
  });
});
