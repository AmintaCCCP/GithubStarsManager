import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Release } from '../../../types';
import { useAppStore } from '../../../store/useAppStore';
import { useReleaseTimelineActions } from './useReleaseTimelineActions';

const mocks = vi.hoisted(() => ({
  useAppStore: vi.fn(),
  toast: vi.fn(),
  confirm: vi.fn(),
  markAllReleasesAsRead: vi.fn(),
  forceSyncToBackend: vi.fn(),
  setState: vi.fn(),
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: mocks.useAppStore,
}));

vi.mock('../../../hooks/useDialog', () => ({
  useDialog: () => ({ toast: mocks.toast, confirm: mocks.confirm }),
}));

vi.mock('../../../services/autoSync', () => ({
  forceSyncToBackend: mocks.forceSyncToBackend,
}));

vi.mock('../../../services/backendAdapter', () => ({
  backend: {
    isAvailable: true,
    markAllReleasesAsRead: mocks.markAllReleasesAsRead,
  },
}));

vi.mock('../../../services/githubApiFactory', () => ({
  createGitHubApiService: () => ({
    getMultipleRepositoryReleases: vi.fn().mockResolvedValue({ releases: [], latestReleases: [], failedRepos: [] }),
  }),
}));

const release = {
  id: 101,
  repository: { id: 1, name: 'repo', full_name: 'owner/repo' },
  name: 'v1',
} as unknown as Release;

const createStoreState = () => ({
  releases: [release],
  repositories: [],
  releaseSubscriptions: new Set<number>(),
  releaseSourceSettings: {},
  readReleases: new Set<number>([7, 8]),
  githubToken: 'github-token',
  language: 'zh' as const,
  assetFilters: {},
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
  releaseViewMode: 'all' as const,
  releaseSelectedFilters: [],
  releaseSearchQuery: '',
  releaseExpandedRepositories: new Set<number>(),
  releaseIsRefreshing: false,
  setReleaseViewMode: vi.fn(),
  toggleReleaseSelectedFilter: vi.fn(),
  clearReleaseSelectedFilters: vi.fn(),
  setReleaseSearchQuery: vi.fn(),
  toggleReleaseExpandedRepository: vi.fn(),
  setReleaseIsRefreshing: vi.fn(),
  includePreRelease: false,
});

let storeState = createStoreState();
const mockUseAppStore = vi.mocked(mocks.useAppStore);
mockUseAppStore.mockImplementation(((selector?: (state: typeof storeState) => unknown) => (
  selector ? selector(storeState) : storeState
)) as typeof useAppStore);
(mockUseAppStore as unknown as { getState: () => typeof storeState }).getState = () => storeState;
(mockUseAppStore as unknown as { setState: typeof mocks.setState }).setState = mocks.setState;

const renderActions = () => renderHook(() => useReleaseTimelineActions());

/**
 * 账号代次校验回归（Issue #611 审计修复）：
 * - 「全部已读」失败回滚只在发起账号仍是当前账号时执行，切号后不得把旧账号
 *   的已读快照写入新账号工作区；
 * - 取消订阅在等待确认期间切号后整体退出，不得用旧账号的来源信息/回滚快照
 *   修改新账号工作区。
 */
describe('useReleaseTimelineActions account switch guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState = createStoreState();
    mockUseAppStore.mockImplementation(((selector?: (state: typeof storeState) => unknown) => (
      selector ? selector(storeState) : storeState
    )) as typeof useAppStore);
    (mockUseAppStore as unknown as { getState: () => typeof storeState }).getState = () => storeState;
    (mockUseAppStore as unknown as { setState: typeof mocks.setState }).setState = mocks.setState;
    (storeState as { user?: unknown }).user = { id: 1, login: 'me', avatar_url: '' };
    mocks.confirm.mockResolvedValue(true);
    mocks.forceSyncToBackend.mockResolvedValue(undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const switchToB = () => {
    (storeState as { user?: unknown }).user = { id: 2, login: 'other', avatar_url: '' };
  };

  const rollbackCalls = () => mocks.setState.mock.calls.filter(
    (call) => call[0] && typeof call[0] === 'object' && 'readReleases' in (call[0] as object),
  );

  it('rolls back readReleases into the originating account when no switch happened', async () => {
    mocks.markAllReleasesAsRead.mockRejectedValue(new Error('backend down'));
    const { result } = renderActions();

    await act(async () => { await result.current.handleMarkAllRead(); });

    expect(mocks.toast).toHaveBeenCalledWith('标记全部已读失败', 'error');
    const rollbacks = rollbackCalls();
    expect(rollbacks).toHaveLength(1);
    expect((rollbacks[0][0] as { readReleases: Set<number> }).readReleases).toEqual(new Set([7, 8]));
  });

  it('does not roll back into the new account when the backend call fails after a switch', async () => {
    mocks.markAllReleasesAsRead.mockImplementation(async () => {
      switchToB();
      throw new Error('backend down');
    });
    const { result } = renderActions();

    await act(async () => { await result.current.handleMarkAllRead(); });

    expect(mocks.toast).toHaveBeenCalledWith('标记全部已读失败', 'error');
    // 切号后回滚被丢弃：绝不以账号 A 的已读快照覆盖账号 B
    expect(rollbackCalls()).toHaveLength(0);
  });

  it('aborts the unsubscribe flow entirely when the account switched during the confirm dialog', async () => {
    mocks.confirm.mockImplementation(async () => {
      switchToB();
      return true;
    });
    const { result } = renderActions();

    await act(async () => { await result.current.handleUnsubscribeRelease(1); });

    // 确认等待期间切号：来源移除、Release 删除与同步全部跳过
    expect(storeState.batchUnsubscribeReleases).not.toHaveBeenCalled();
    expect(storeState.updateRepository).not.toHaveBeenCalled();
    expect(storeState.removeReleasesByRepoFullName).not.toHaveBeenCalled();
    expect(mocks.forceSyncToBackend).not.toHaveBeenCalled();
  });

  it('still unsubscribes when the account never changed (control)', async () => {
    const { result } = renderActions();

    await act(async () => { await result.current.handleUnsubscribeRelease(1); });

    expect(mocks.confirm).toHaveBeenCalled();
    expect(mocks.forceSyncToBackend).toHaveBeenCalled();
  });
});
