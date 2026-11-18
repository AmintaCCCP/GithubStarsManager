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
// setState 桩支持函数更新器（真实 zustand 语义）：切号快照回写用
// setState((state) => ...) 提交，测试需要观察更新器对归档工作区的修改
mocks.setState.mockImplementation((partial: unknown) => {
  const patch = typeof partial === 'function'
    ? (partial as (state: typeof storeState) => unknown)(storeState)
    : partial;
  if (patch && typeof patch === 'object') Object.assign(storeState, patch as Record<string, unknown>);
});
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
    // afterEach 的 restoreAllMocks 会清掉模块级实现：每次重建函数更新器支持
    mocks.setState.mockImplementation((partial: unknown) => {
      const patch = typeof partial === 'function'
        ? (partial as (state: typeof storeState) => unknown)(storeState)
        : partial;
      if (patch && typeof patch === 'object') Object.assign(storeState, patch as Record<string, unknown>);
    });
    (storeState as { user?: unknown }).user = { id: 1, login: 'me', avatar_url: '' };
    // 与真实 store 一致：乐观「全部已读」把当前 Release 全部并入已读集合
    (storeState.markAllReleasesAsRead as unknown as () => void) = vi.fn(() => {
      storeState.readReleases = new Set([...storeState.readReleases, ...storeState.releases.map((item) => item.id)]);
    });
    mocks.confirm.mockResolvedValue(true);
    mocks.forceSyncToBackend.mockResolvedValue(undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const switchToB = () => {
    // 审计修复（C42）：切号桩升级为真实 switchAccount 语义——归档 A 的当前
    // 集合进其工作区快照，并为 B 装载独立集合（Release [202] / 已读 {205}），
    // 使「B 不被修改、A 归档仅撤销本次操作」可被精确断言。
    const stateWithArchives = storeState as { accountWorkspaces?: Record<string, Record<string, unknown>> };
    stateWithArchives.accountWorkspaces = {
      ...stateWithArchives.accountWorkspaces,
      '1': {
        repositories: [...storeState.repositories],
        releases: [...storeState.releases],
        readReleases: [...storeState.readReleases],
      },
    };
    (storeState as { user?: unknown }).user = { id: 2, login: 'other', avatar_url: '' };
    storeState.releases = [{ id: 202, repository: { id: 20, name: 'other-repo', full_name: 'other/repo' }, name: 'v2' } as unknown as Release];
    storeState.readReleases = new Set<number>([205]);
  };

  // 不归档的切号（模拟发起账号从未有过快照的全新会话）
  const switchToBWithoutArchive = () => {
    (storeState as { user?: unknown }).user = { id: 2, login: 'other', avatar_url: '' };
    storeState.releases = [{ id: 202, repository: { id: 20, name: 'other-repo', full_name: 'other/repo' }, name: 'v2' } as unknown as Release];
    storeState.readReleases = new Set<number>([205]);
  };

  it('rolls back readReleases into the originating account when no switch happened', async () => {
    mocks.markAllReleasesAsRead.mockRejectedValue(new Error('backend down'));
    const { result } = renderActions();

    await act(async () => { await result.current.handleMarkAllRead(); });

    expect(mocks.toast).toHaveBeenCalledWith('标记全部已读失败', 'error');
    // 只撤销本次操作新增的已读（101），操作前的 7/8 保留
    expect(storeState.readReleases).toEqual(new Set([7, 8]));
  });

  it('does not roll back into the new account when the backend call fails after a switch', async () => {
    mocks.markAllReleasesAsRead.mockImplementation(async () => {
      switchToB();
      throw new Error('backend down');
    });
    const { result } = renderActions();

    await act(async () => { await result.current.handleMarkAllRead(); });

    expect(mocks.toast).toHaveBeenCalledWith('标记全部已读失败', 'error');
    // 切号后回滚被丢弃：B 的独立已读集合不被 A 的回滚改写（B 不被修改）
    expect(storeState.readReleases).toEqual(new Set([205]));
    // A 的归档快照只回滚本次操作：乐观新增的 101 被撤销，操作前的 7/8 保留
    const parked = (storeState as { accountWorkspaces?: Record<string, Record<string, unknown>> }).accountWorkspaces?.['1'];
    expect(parked?.readReleases).toEqual([7, 8]);
  });

  it('writes the read-state rollback into the originating account snapshot after a switch', async () => {
    mocks.markAllReleasesAsRead.mockImplementation(async () => {
      switchToB();
      throw new Error('backend down');
    });
    // 切换时 switchAccountWorkspace 已把包含乐观更新（全部已读）的 live 工作区
    // 写入账号 A 的归档快照——这里以「全部已读后的已读集合」模拟该快照
    // 快照是切号瞬间的 live 工作区：含操作前的 7/8 与本次乐观新增的 101
    (storeState as { accountWorkspaces?: Record<string, Record<string, unknown>> }).accountWorkspaces = {
      '1': { repositories: [], releases: [], readReleases: [7, 8, 101] },
    };
    const { result } = renderActions();

    await act(async () => { await result.current.handleMarkAllRead(); });

    expect(mocks.toast).toHaveBeenCalledWith('标记全部已读失败', 'error');
    // 当前账号 B 的 live 已读集合（B 自己的 {205}）没有被 A 的回滚改写
    expect(storeState.readReleases).toEqual(new Set([205]));
    // 发起账号 A 的快照已回写为操作前的已读集合，下次激活时不再显示
    // 服务端已失败的「全部已读」状态
    const parked = (storeState as { accountWorkspaces?: Record<string, Record<string, unknown>> }).accountWorkspaces?.['1'];
    // 只移除本次操作新增的 101，操作前的 7/8 保留
    expect(parked?.readReleases).toEqual([7, 8]);
  });

  it('does not create a workspace snapshot when the originating account has none', async () => {
    mocks.markAllReleasesAsRead.mockImplementation(async () => {
      switchToBWithoutArchive();
      throw new Error('backend down');
    });
    // 发起账号没有归档快照（如从未切过号的全新会话）：不得凭空创建
    const { result } = renderActions();

    await act(async () => { await result.current.handleMarkAllRead(); });

    expect(mocks.toast).toHaveBeenCalledWith('标记全部已读失败', 'error');
    expect(storeState.readReleases).toEqual(new Set([205]));
    expect((storeState as { accountWorkspaces?: Record<string, unknown> }).accountWorkspaces).toBeUndefined();
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
