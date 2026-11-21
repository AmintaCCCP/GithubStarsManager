import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from '../../../types';
import { useBulkRepositoryActions } from './useBulkRepositoryActions';
import { useAppStore } from '../../../store/useAppStore';
import { bumpAccountSessionGeneration } from '../../../store/helpers/accountWorkspace';

const mocks = vi.hoisted(() => ({
  useAppStore: vi.fn(),
  toast: vi.fn(),
  confirm: vi.fn(),
  unstarRepository: vi.fn(),
  forceSyncToBackend: vi.fn(),
  markPendingAccountSync: vi.fn(),
  markPendingRepositoryDeletion: vi.fn(),
  backend: { backendUrl: null as string | null },
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: mocks.useAppStore,
}));

vi.mock('../../../hooks/useDialog', () => ({
  useDialog: () => ({ toast: mocks.toast, confirm: mocks.confirm }),
}));

vi.mock('../../../services/githubApi', () => ({
  GitHubApiService: vi.fn(function GitHubApiService() {
    return {
      unstarRepository: mocks.unstarRepository,
      setBackendUrl: vi.fn(),
      setBackendAuthToken: vi.fn(),
      setBackendAccountId: vi.fn(),
    };
  }),
}));

vi.mock('../../../services/autoSync', () => ({
  forceSyncToBackend: mocks.forceSyncToBackend,
  markPendingAccountSync: mocks.markPendingAccountSync,
  markPendingRepositoryDeletion: mocks.markPendingRepositoryDeletion,
  withAccountSwitchGuardSync: (fn: () => unknown) => fn(),
}));

vi.mock('../../../services/backendAdapter', () => ({
  backend: mocks.backend,
}));

const repository = (id: number, overrides: Partial<Repository> = {}): Repository => ({
  id,
  name: `repository-${id}`,
  full_name: `owner/repository-${id}`,
  description: 'Repository description',
  html_url: `https://github.com/owner/repository-${id}`,
  stargazers_count: 10,
  forks_count: 1,
  forks: 1,
  language: 'TypeScript',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
  pushed_at: '2026-01-03T00:00:00.000Z',
  owner: { login: 'owner', avatar_url: 'https://example.com/avatar.png' },
  topics: [],
  ...overrides,
});

const categories = [
  { id: 'all', name: '全部分类', icon: 'folder', keywords: [] },
  { id: 'tools', name: '工具', icon: 'wrench', keywords: ['tool'], isCustom: true },
];

const createStoreState = () => ({
  githubToken: 'github-token',
  language: 'zh' as const,
  updateRepository: vi.fn(),
  deleteRepository: vi.fn(),
  toggleReleaseSubscription: vi.fn(),
  batchUnsubscribeReleases: vi.fn(),
  releaseSubscriptions: new Set<number>(),
});

let storeState = createStoreState();
const mockUseAppStore = vi.mocked(useAppStore);
const renderActions = () => renderHook(() => useBulkRepositoryActions({ allCategories: categories }));

describe('useBulkRepositoryActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState = createStoreState();
    mockUseAppStore.mockImplementation(((selector?: (state: typeof storeState) => unknown) => (
      selector ? selector(storeState) : storeState
    )) as typeof useAppStore);
    mocks.confirm.mockResolvedValue(true);
    mocks.forceSyncToBackend.mockResolvedValue(undefined);
    mocks.unstarRepository.mockResolvedValue(undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('has zero side effects when batch unstar confirmation is cancelled', async () => {
    mocks.confirm.mockResolvedValue(false);
    const { result } = renderActions();

    await act(async () => {
      await result.current.unstar([repository(1)]);
    });

    expect(mocks.unstarRepository).not.toHaveBeenCalled();
    expect(storeState.deleteRepository).not.toHaveBeenCalled();
    expect(mocks.forceSyncToBackend).not.toHaveBeenCalled();
  });

  it('deletes only remote-successful repositories, reports partial batch unstar failure, and syncs once', async () => {
    const first = repository(1);
    const second = repository(2);
    mocks.unstarRepository.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('network unavailable'));
    const { result } = renderActions();

    await act(async () => {
      await result.current.unstar([first, second]);
    });

    expect(storeState.deleteRepository).toHaveBeenCalledTimes(1);
    expect(storeState.deleteRepository).toHaveBeenCalledWith(first.id);
    expect(storeState.deleteRepository).not.toHaveBeenCalledWith(second.id);
    expect(mocks.forceSyncToBackend).toHaveBeenCalledTimes(1);
    expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('失败 (1 个)'), 'error');
  });

  it('restores original fields through the pure patch and syncs exactly once', async () => {
    const target = repository(1, {
      custom_description: 'Custom description',
      custom_tags: ['custom'],
      custom_category: '工具',
      category_locked: true,
      ai_summary: 'AI summary',
      ai_tags: ['ai'],
      analyzed_at: '2026-02-01T00:00:00.000Z',
    });
    const { result } = renderActions();

    await act(async () => {
      await result.current.restore([target], {
        description: { enabled: true, target: 'original' },
        tags: { enabled: true, target: 'original' },
        category: { enabled: true, target: 'original' },
      });
    });

    expect(storeState.updateRepository).toHaveBeenCalledWith(expect.objectContaining({
      id: target.id,
      custom_description: undefined,
      custom_tags: undefined,
      custom_category: undefined,
      category_locked: false,
      ai_summary: undefined,
    }));
    expect(mocks.forceSyncToBackend).toHaveBeenCalledTimes(1);
  });

  it('uses category and lock patches while synchronizing each completed batch once', async () => {
    const categorized = repository(1, { ai_tags: ['tool'], custom_category: '手动' });
    const notCategorized = repository(2);
    const { result } = renderActions();

    await act(async () => {
      await result.current.categorize([categorized], '工具');
    });
    expect(storeState.updateRepository).toHaveBeenCalledWith(expect.objectContaining({ id: categorized.id, custom_category: undefined }));
    expect(mocks.forceSyncToBackend).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    mocks.forceSyncToBackend.mockResolvedValue(undefined);
    await act(async () => {
      await result.current.lockCategory([categorized, notCategorized]);
    });
    expect(storeState.updateRepository).toHaveBeenCalledWith(expect.objectContaining({ id: categorized.id, category_locked: true }));
    expect(storeState.updateRepository).not.toHaveBeenCalledWith(expect.objectContaining({ id: notCategorized.id, category_locked: true }));
    expect(mocks.forceSyncToBackend).toHaveBeenCalledTimes(1);
  });

  it('keeps release subscription markers and subscriptions consistent on subscribe and unsubscribe', async () => {
    const alreadySubscribed = repository(1, { subscribed_to_releases: true });
    const toSubscribe = repository(2);
    storeState.releaseSubscriptions = new Set([alreadySubscribed.id]);
    const { result } = renderActions();

    await act(async () => {
      await result.current.subscribe([alreadySubscribed, toSubscribe]);
    });
    expect(storeState.updateRepository).toHaveBeenCalledWith(expect.objectContaining({ id: alreadySubscribed.id, subscribed_to_releases: true }));
    expect(storeState.updateRepository).toHaveBeenCalledWith(expect.objectContaining({ id: toSubscribe.id, subscribed_to_releases: true }));
    expect(storeState.toggleReleaseSubscription).toHaveBeenCalledTimes(1);
    expect(storeState.toggleReleaseSubscription).toHaveBeenCalledWith(toSubscribe.id);
    expect(mocks.forceSyncToBackend).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    mocks.forceSyncToBackend.mockResolvedValue(undefined);
    await act(async () => {
      await result.current.unsubscribe([alreadySubscribed, toSubscribe]);
    });
    expect(storeState.batchUnsubscribeReleases).toHaveBeenCalledWith([alreadySubscribed.id]);
    expect(storeState.updateRepository).toHaveBeenCalledWith(expect.objectContaining({ id: alreadySubscribed.id, subscribed_to_releases: false }));
    expect(storeState.updateRepository).not.toHaveBeenCalledWith(expect.objectContaining({ id: toSubscribe.id, subscribed_to_releases: false }));
    expect(mocks.forceSyncToBackend).toHaveBeenCalledTimes(1);
  });
});

/**
 * 账号代次校验回归（Issue #611 审计修复）：操作所属账号必须在任何 await 之前
 * 保存；确认返回后、每次远端操作前与删除本地仓库前都用保存值复核。等待期间
 * 切号后：远端操作按发起账号完成（不可撤销），本地删除与同步被整体跳过。
 */
describe('useBulkRepositoryActions account switch guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState = createStoreState();
    mockUseAppStore.mockImplementation(((selector?: (state: typeof storeState) => unknown) => (
      selector ? selector(storeState) : storeState
    )) as typeof useAppStore);
    (mockUseAppStore as unknown as { getState: () => typeof storeState }).getState = () => storeState;
    (storeState as { user?: unknown }).user = { id: 1, login: 'me', avatar_url: '' };
    mocks.confirm.mockResolvedValue(true);
    mocks.forceSyncToBackend.mockResolvedValue(undefined);
    mocks.unstarRepository.mockResolvedValue(undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const switchToB = () => {
    (storeState as { user?: unknown }).user = { id: 2, login: 'other', avatar_url: '' };
  };

  it('stops before any remote call when the account switched during the confirm dialog', async () => {
    mocks.confirm.mockImplementation(async () => {
      switchToB();
      return true;
    });

    const { result } = renderActions();
    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.unstar([repository(1), repository(2)]);
    });

    expect(outcome).toBe(false);
    expect(mocks.unstarRepository).not.toHaveBeenCalled();
    expect(storeState.deleteRepository).not.toHaveBeenCalled();
    expect(mocks.forceSyncToBackend).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('keeps completed remote unstars but skips local deletion and sync after a mid-loop switch', async () => {
    let calls = 0;
    mocks.unstarRepository.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) switchToB();
      return undefined;
    });

    const { result } = renderActions();
    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.unstar([repository(1), repository(2)]);
    });

    // 第一个远端取消星标已完成（不可撤销），第二个不再发起
    expect(calls).toBe(1);
    expect(outcome).toBe(false);
    expect(storeState.deleteRepository).not.toHaveBeenCalled();
    expect(mocks.forceSyncToBackend).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('stops without remote calls after A→B→A (session generation advanced)', async () => {
    // 审计修复（C27a）：A→B→A 后账号 ID 与确认前相同，只有会话代次能识别
    // 这次切号——确认返回前切 B 再切回 A 并推进实际代次，操作必须整体退出。
    mocks.confirm.mockImplementation(async () => {
      switchToB();
      bumpAccountSessionGeneration();
      (storeState as { user?: unknown }).user = { id: 1, login: 'me', avatar_url: '' };
      return true;
    });

    const { result } = renderActions();
    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.unstar([repository(1)]);
    });

    expect(outcome).toBe(false);
    expect(mocks.unstarRepository).not.toHaveBeenCalled();
    expect(storeState.deleteRepository).not.toHaveBeenCalled();
    expect(mocks.forceSyncToBackend).not.toHaveBeenCalled();
    expect(mocks.markPendingAccountSync).not.toHaveBeenCalled();
  });

  it('writes completed remote unstars back to the parked account archive only (C27b)', async () => {
    // 审计修复（C27b）：会话失效分支的已确认远端操作按结果归属写回发起账号
    // 的归档快照——setState 应用到含 A/B 归档的夹具，断言首仓库及其 Release
    // 从 A 归档移除、第二仓库保留、B 不变，且仅为 A 标记待补推。
    const first = repository(1);
    const second = repository(2);
    const otherAccountSameIdRepo = repository(1, { full_name: 'other/repository-1' });
    const otherAccountRepo = repository(3, { full_name: 'other/repository-3' });
    mocks.backend.backendUrl = 'https://backend-x.example/api';
    storeState = {
      ...storeState,
      accountWorkspaces: {
        '1': {
          repositories: [first, second],
          releases: [
            { id: 101, repository: { id: 1 } } as unknown as import('../../../types').Release,
            { id: 102, repository: { id: 2 } } as unknown as import('../../../types').Release,
          ],
          releaseSubscriptions: [1, 2],
          readReleases: [101, 102, 999],
        },
        '2': {
          repositories: [otherAccountSameIdRepo, otherAccountRepo],
          releases: [
            { id: 201, repository: { id: 1 } } as unknown as import('../../../types').Release,
          ],
          releaseSubscriptions: [1],
          readReleases: [201],
        },
      },
    } as typeof storeState;
    const appliedPatches: Array<Record<string, unknown>> = [];
    (mockUseAppStore as unknown as { setState: (updater: unknown) => void }).setState = vi.fn((updater: unknown) => {
      const patch = typeof updater === 'function'
        ? (updater as (state: typeof storeState) => Record<string, unknown>)(storeState)
        : updater as Record<string, unknown>;
      appliedPatches.push(patch);
    });
    let calls = 0;
    mocks.unstarRepository.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        switchToB();
        // 模拟等待期间后端从 X 切到 Y：待推记录仍必须绑定发起时的 X
        mocks.backend.backendUrl = 'https://backend-y.example/api';
      }
      return undefined;
    });

    const { result } = renderActions();
    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.unstar([first, second]);
    });

    expect(calls).toBe(1);
    expect(outcome).toBe(false);
    expect(appliedPatches).toHaveLength(1);
    type ArchivedWorkspace = {
      repositories: Repository[];
      releases: Array<{ repository: { id: number } }>;
      releaseSubscriptions?: number[];
      readReleases?: number[];
    };
    const archivedA = (appliedPatches[0].accountWorkspaces as Record<string, ArchivedWorkspace>)['1'];
    const archivedB = (appliedPatches[0].accountWorkspaces as Record<string, ArchivedWorkspace>)['2'];
    // 首仓库及其 Release 从 A 归档移除，第二仓库保留
    expect(archivedA.repositories.map(r => r.id)).toEqual([2]);
    expect(archivedA.releases.map(rel => rel.repository.id)).toEqual([2]);
    // R12（finding 21）：与 deleteRepository 同一清理规则——归档中的订阅与
    // 已读索引同步清理（999 不属于剩余 Release，一并清理）
    expect(archivedA.releaseSubscriptions).toEqual([2]);
    expect(archivedA.readReleases).toEqual([102]);
    // B 归档中与 A 同 ID 的仓库 1 及其 Release 均完整保留
    expect(archivedB.repositories.map(r => r.id)).toEqual([1, 3]);
    expect(archivedB.releases.map(rel => rel.repository.id)).toEqual([1]);
    // 仅为发起账号 A 登记待确认删除与待补推，且绑定发起时的后端 URL X
    expect(mocks.markPendingRepositoryDeletion).toHaveBeenCalledTimes(1);
    expect(mocks.markPendingRepositoryDeletion).toHaveBeenCalledWith('1', 1, 'https://backend-x.example/api');
    expect(mocks.markPendingAccountSync).toHaveBeenCalledTimes(1);
    expect(mocks.markPendingAccountSync).toHaveBeenCalledWith('1', 'https://backend-x.example/api');
    expect(mocks.markPendingAccountSync).not.toHaveBeenCalledWith('2', expect.anything());
    mocks.backend.backendUrl = null;
  });

  it('preserves a same-id repo re-starred during the switch and skips the pending deletion (R12 finding 0)', async () => {
    const original = repository(1, { starred_at: '2026-01-01T00:00:00.000Z' });
    const restarred = repository(1, { starred_at: '2026-03-01T00:00:00.000Z', full_name: 'owner/repository-1' });
    storeState = {
      ...storeState,
      accountWorkspaces: {
        '1': {
          // R13 审计修复（CodeRabbit）：发起请求时归档仍是 original——重新加星
          // 发生在请求等待期间（见 unstarRepository mock），对账必须读取响应
          // 完成时的记录，而不是发起时的快照。
          repositories: [original],
          releases: [{ id: 101, repository: { id: 1 } } as unknown as import('../../../types').Release],
          releaseSubscriptions: [1],
          readReleases: [101],
        },
      },
    } as typeof storeState;
    const appliedPatches: Array<Record<string, unknown>> = [];
    (mockUseAppStore as unknown as { setState: (updater: unknown) => void }).setState = vi.fn((updater: unknown) => {
      const patch = typeof updater === 'function'
        ? (updater as (state: typeof storeState) => Record<string, unknown>)(storeState)
        : updater as Record<string, unknown>;
      appliedPatches.push(patch);
    });
    mocks.unstarRepository.mockImplementation(async () => {
      switchToB();
      // 等待期间用户对同 ID 仓库重新加星：A 归档更新为 restarred
      (storeState as unknown as {
        accountWorkspaces: Record<string, { repositories: Repository[] }>;
      }).accountWorkspaces['1'].repositories = [restarred];
      return undefined;
    });
    const { result } = renderActions();

    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.unstar([original]);
    });

    expect(outcome).toBe(false);
    // 同 ID 记录在等待期间重新加星：归档完整保留，且不登记待删除/待补推
    const parkedA = (storeState as unknown as {
      accountWorkspaces: Record<string, { repositories: Repository[]; releases: Array<{ id: number }> }>;
    }).accountWorkspaces['1'];
    expect(parkedA.repositories.map(r => r.id)).toEqual([1]);
    expect(parkedA.releases.map(rel => rel.id)).toEqual([101]);
    expect(mocks.markPendingRepositoryDeletion).not.toHaveBeenCalled();
    expect(mocks.markPendingAccountSync).not.toHaveBeenCalled();
    expect(appliedPatches).toHaveLength(0);
  });

  it('deletes locally and syncs when the account never changed (control)', async () => {
    const { result } = renderActions();
    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.unstar([repository(1)]);
    });

    expect(outcome).toBe(true);
    expect(storeState.deleteRepository).toHaveBeenCalledWith(1);
    expect(mocks.forceSyncToBackend).toHaveBeenCalledOnce();
  });
});
