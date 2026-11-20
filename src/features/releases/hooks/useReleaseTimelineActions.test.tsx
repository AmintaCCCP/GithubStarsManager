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
    storeState.releases = [{
      id: 101,
      repository: { id: 1, name: 'repo', full_name: 'owner/repo' },
      name: 'v1',
      is_read: false,
      updated_asset_ids: [10],
    } as unknown as Release];
    // 与真实 timelineSlice 一致：用当前 release ID 替换 readReleases，并更新 is_read 与资产更新标记
    (storeState.markAllReleasesAsRead as unknown as () => void) = vi.fn(() => {
      storeState.readReleases = new Set(storeState.releases.map((item) => item.id));
      storeState.releases = storeState.releases.map((item) => ({
        ...item,
        is_read: true,
        updated_asset_ids: [],
      }));
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
    // 只撤销本次操作新增的已读（101），补回操作前的 7/8，并恢复 release 字段
    expect(storeState.readReleases).toEqual(new Set([7, 8]));
    expect(storeState.releases[0]).toMatchObject({ id: 101, is_read: false, updated_asset_ids: [10] });
  });

  it('does not roll back into the new account when the backend call fails after a switch', async () => {
    mocks.markAllReleasesAsRead.mockImplementation(async () => {
      switchToB();
      throw new Error('backend down');
    });
    const { result } = renderActions();

    await act(async () => { await result.current.handleMarkAllRead(); });

    // 会话已切换：不向新会话显示旧请求的失败提示
    expect(mocks.toast).not.toHaveBeenCalled();
    // 切号后回滚被丢弃：B 的独立已读集合不被 A 的回滚改写（B 不被修改）
    expect(storeState.readReleases).toEqual(new Set([205]));
    // A 的归档快照只回滚本次操作：乐观新增的 101 被撤销，操作前的 7/8 保留，release 字段也恢复
    const parked = (storeState as { accountWorkspaces?: Record<string, Record<string, unknown>> }).accountWorkspaces?.['1'];
    expect(parked?.readReleases).toEqual([7, 8]);
    expect((parked?.releases as Array<Record<string, unknown>>)?.[0]).toMatchObject({
      id: 101,
      is_read: false,
      updated_asset_ids: [10],
    });
  });

  it('rolls back the live read set when A→B→A reactivates the originating account', async () => {
    const { bumpAccountSessionGeneration } = await import('../../../store/helpers/accountWorkspace');
    mocks.markAllReleasesAsRead.mockImplementation(async () => {
      // A→B→A：切到 B 后立即切回 A，且推进会话代次以进入重新激活分支（非同会话回滚）。
      switchToB();
      bumpAccountSessionGeneration();
      (storeState as { user?: unknown }).user = { id: 1, login: 'me', avatar_url: '' };
      storeState.readReleases = new Set<number>([101]);
      storeState.releases = [{
        id: 101,
        repository: { id: 1, name: 'repo', full_name: 'owner/repo' },
        name: 'v1',
        is_read: true,
        updated_asset_ids: [],
      } as unknown as Release];
      bumpAccountSessionGeneration();
      throw new Error('backend down');
    });
    const { result } = renderActions();

    await act(async () => { await result.current.handleMarkAllRead(); });

    // 代次已变化：抑制旧会话提示，同时仍对重新激活的 A 执行归属明确的回滚
    expect(mocks.toast).not.toHaveBeenCalled();
    // R2-C29：发起账号已重新激活——实时集合与 release 字段必须撤销乐观更新，归档未被改写
    expect(storeState.readReleases).toEqual(new Set([7, 8]));
    expect(storeState.releases[0]).toMatchObject({ id: 101, is_read: false, updated_asset_ids: [10] });
    const parked = (storeState as { accountWorkspaces?: Record<string, Record<string, unknown>> }).accountWorkspaces?.['1'];
    expect(parked?.readReleases).toEqual([101]);
  });

  it('does not create a workspace snapshot when the originating account has none', async () => {
    mocks.markAllReleasesAsRead.mockImplementation(async () => {
      switchToBWithoutArchive();
      throw new Error('backend down');
    });
    // 发起账号没有归档快照（如从未切过号的全新会话）：不得凭空创建
    const { result } = renderActions();

    await act(async () => { await result.current.handleMarkAllRead(); });

    expect(mocks.toast).not.toHaveBeenCalled();
    expect(storeState.readReleases).toEqual(new Set([205]));
    expect((storeState as { accountWorkspaces?: Record<string, unknown> }).accountWorkspaces).toBeUndefined();
  });

  const seedCustomSource = () => {
    // R12（finding 1）：给同一仓库配置自定义来源——只有存在来源时退订流程
    // 才会进入来源移除分支，切号守卫的断言才有意义。
    (storeState as { releaseSourceSettings: unknown }).releaseSourceSettings = {
      enabledSourceIds: ['custom-release'],
      watchCustomReleaseRepos: [],
      customReleaseRepos: [{
        id: 1,
        name: 'repo',
        full_name: 'owner/repo',
        html_url: 'https://github.com/owner/repo',
        owner: { login: 'owner', avatar_url: '' },
      }],
    };
  };

  it('aborts the unsubscribe flow entirely when the account switched during the confirm dialog', async () => {
    seedCustomSource();
    mocks.confirm.mockImplementation(async () => {
      switchToB();
      return true;
    });
    const { result } = renderActions();

    await act(async () => { await result.current.handleUnsubscribeRelease(1); });

    // 确认等待期间切号：来源移除、Release 删除与同步全部跳过
    expect(storeState.removeReleaseSourceRepository).not.toHaveBeenCalled();
    expect(storeState.batchUnsubscribeReleases).not.toHaveBeenCalled();
    expect(storeState.updateRepository).not.toHaveBeenCalled();
    expect(storeState.removeReleasesByRepoFullName).not.toHaveBeenCalled();
    expect(mocks.forceSyncToBackend).not.toHaveBeenCalled();
  });

  it('does not expand a collapsed repository when the unsubscribe rollback runs (R12 finding 20)', async () => {
    seedCustomSource();
    mocks.forceSyncToBackend.mockRejectedValue(new Error('backend down'));
    storeState.removeReleaseSourceRepository.mockImplementation(() => {
      (storeState as unknown as { releaseSourceSettings: { customReleaseRepos: unknown[] } })
        .releaseSourceSettings.customReleaseRepos = [];
    });
    // 该仓库原本处于收起状态
    storeState.releaseExpandedRepositories = new Set<number>();
    const { result } = renderActions();

    await act(async () => { await result.current.handleUnsubscribeRelease(1); });

    // 失败回滚只恢复删除前已展开的仓库——原本收起的仓库保持收起
    expect(storeState.releaseExpandedRepositories.size).toBe(0);
  });

  it('still unsubscribes when the account never changed (control)', async () => {
    seedCustomSource();
    // 真实 store action 会移除来源；测试桩需同步修改夹具，后续 alreadySubscribed
    // 判定（stillActive）才会走「来源已清空 → 删除 Release」分支。
    storeState.removeReleaseSourceRepository.mockImplementation(() => {
      (storeState as unknown as { releaseSourceSettings: { customReleaseRepos: unknown[] } })
        .releaseSourceSettings.customReleaseRepos = [];
    });
    const { result } = renderActions();

    await act(async () => { await result.current.handleUnsubscribeRelease(1); });

    expect(mocks.confirm).toHaveBeenCalled();
    expect(mocks.forceSyncToBackend).toHaveBeenCalled();
    // 来源移除必须携带预期的来源 ID 与仓库名
    expect(storeState.removeReleaseSourceRepository).toHaveBeenCalledWith('custom-release', 'owner/repo');
    // 审计回归守护：来源已清空时必须实际删除该仓库的时间线 Release
    //（R11 修复曾误删此调用，导致退订后 Release 残留）。
    expect(storeState.removeReleasesByRepoFullName).toHaveBeenCalledWith('owner/repo');
  });
});
