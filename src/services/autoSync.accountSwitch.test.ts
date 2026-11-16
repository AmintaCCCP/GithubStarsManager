import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from '../types';
import { resetSyncHashes, startAutoSync, stopAutoSync } from './autoSync';
import { backend } from './backendAdapter';
import { useAppStore } from '../store/useAppStore';

vi.mock('./backendAdapter', () => ({
  backend: {
    isAvailable: true,
    fetchRepositories: vi.fn(),
    fetchReleases: vi.fn(),
    fetchAIConfigs: vi.fn(),
    fetchWebDAVConfigs: vi.fn(),
    fetchEmbeddingConfigs: vi.fn(),
    fetchVectorSearchConfig: vi.fn(),
    fetchSettings: vi.fn(),
    syncRepositories: vi.fn().mockResolvedValue(undefined),
    syncReleases: vi.fn().mockResolvedValue(undefined),
    syncAIConfigs: vi.fn().mockResolvedValue(undefined),
    syncWebDAVConfigs: vi.fn().mockResolvedValue(undefined),
    syncEmbeddingConfigs: vi.fn().mockResolvedValue(undefined),
    syncVectorSearchConfig: vi.fn().mockResolvedValue(undefined),
    syncSettings: vi.fn().mockResolvedValue(undefined),
  },
}));

// src/test/setup.ts replaces the store with a hook-level mock for component
// tests. The teardown guards must be validated against the real subscription,
// so restore the actual store module for this file.
vi.mock('../store/useAppStore', async () => await vi.importActual('../store/useAppStore'));

const userA = { id: 1, login: 'alice', name: 'Alice', avatar_url: 'https://x/a.png', email: null };
const userB = { id: 2, login: 'bob', name: 'Bob', avatar_url: 'https://x/b.png', email: null };

const createRepository = (id: number, overrides: Partial<Repository> = {}): Repository => ({
  id,
  name: `repo-${id}`,
  full_name: `owner/repo-${id}`,
  description: null,
  html_url: `https://github.com/owner/repo-${id}`,
  stargazers_count: 1,
  forks_count: 0,
  forks: 0,
  language: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  pushed_at: '2026-01-01T00:00:00.000Z',
  owner: { login: 'owner', avatar_url: '' },
  topics: [],
  ...overrides,
});

/**
 * Issue #611 红线回归：账号拆除/切换（logout / 移除当前账号 / 归档恢复）
 * 会整体替换工作区。任何一次未加守卫的工作区替换都会触发 autoSync 订阅，
 * 2 秒后以「新账号」或「无账号（后端回退 active_account_id 分区）」请求头
 * 把陈旧/空快照 isFullSync 推送到后端，物理删除分区中不在快照里的数据。
 * 以下测试断言：拆除路径绝不调度任何推送；常规本地编辑仍然照常推送。
 */
describe('account teardown never schedules an isFullSync push (Issue #611)', () => {
  let originalState: ReturnType<typeof useAppStore.getState>;
  let unsubscribe: (() => void) | undefined;

  beforeEach(() => {
    originalState = useAppStore.getState();
    vi.useFakeTimers();
    resetSyncHashes();
    vi.mocked(backend.syncRepositories).mockClear();
    vi.mocked(backend.syncReleases).mockClear();
    vi.mocked(backend.syncSettings).mockClear();
    unsubscribe = startAutoSync();
  });

  afterEach(() => {
    if (unsubscribe) {
      stopAutoSync(unsubscribe);
      unsubscribe = undefined;
    }
    vi.useRealTimers();
    useAppStore.setState(originalState);
  });

  const seedTwoAccounts = (bobWorkspaceRepos: Repository[]) => {
    useAppStore.setState({
      user: userA,
      githubToken: 'ghp_a',
      isAuthenticated: true,
      savedAccounts: {
        '1': { accountId: '1', user: userA, githubToken: 'ghp_a', addedAt: 't', lastUsedAt: 't' },
        '2': { accountId: '2', user: userB, githubToken: 'ghp_b', addedAt: 't', lastUsedAt: 't' },
      },
      accountWorkspaces: {
        '2': {
          repositories: bobWorkspaceRepos,
          lastSync: null,
          gists: [],
          starredGists: [],
          selectedGistCategory: 'all',
          releases: [],
          releaseSubscriptions: [],
          releaseSourceSettings: useAppStore.getState().releaseSourceSettings,
          readReleases: [],
          forks: [],
          readForks: [],
          customCategories: [],
          hiddenDefaultCategoryIds: [],
          categoryOrder: [],
          defaultCategoryOverrides: {},
          categoryListIdMap: {},
          syncMode: 'stars',
          syncModeConfigured: false,
        },
      },
      repositories: [createRepository(1, { ai_summary: 'alice-ai' })],
      searchResults: [createRepository(1)],
    });
  };

  it('removing the current account switches without scheduling a push under the next account', async () => {
    // 账号 B 的本地工作区为空，而其后端分区可能有其他设备写入的数据：
    // 未加守卫时 2s 后的 isFullSync 空推送会物理删除 B 的后端分区。
    seedTwoAccounts([]);
    vi.mocked(backend.syncSettings).mockClear();

    useAppStore.getState().removeSavedAccount('1');

    expect(useAppStore.getState().user?.id).toBe(2);
    expect(useAppStore.getState().repositories).toEqual([]);
    expect(useAppStore.getState().accountWorkspaces['1']?.repositories[0]?.ai_summary).toBe('alice-ai');

    await vi.advanceTimersByTimeAsync(3000);
    expect(backend.syncRepositories).not.toHaveBeenCalled();
    expect(backend.syncSettings).not.toHaveBeenCalled();
    expect(backend.syncReleases).not.toHaveBeenCalled();
  });

  it('logout does not schedule an empty push after the session ends', async () => {
    seedTwoAccounts([]);
    useAppStore.setState({ user: userA, githubToken: 'ghp_a', isAuthenticated: true });

    useAppStore.getState().logout();

    expect(useAppStore.getState().user).toBeNull();
    await vi.advanceTimersByTimeAsync(3000);
    expect(backend.syncRepositories).not.toHaveBeenCalled();
    expect(backend.syncSettings).not.toHaveBeenCalled();
  });

  it('parking the current account for an external restore does not schedule a push', async () => {
    seedTwoAccounts([]);

    useAppStore.getState().parkCurrentAccountForRestore();

    expect(useAppStore.getState().user).toBeNull();
    expect(useAppStore.getState().repositories).toEqual([]);
    expect(useAppStore.getState().accountWorkspaces['1']?.repositories[0]?.ai_summary).toBe('alice-ai');
    await vi.advanceTimersByTimeAsync(3000);
    expect(backend.syncRepositories).not.toHaveBeenCalled();
    expect(backend.syncSettings).not.toHaveBeenCalled();
  });

  it('stale pending edits from the previous session do not leak into the next switch push', async () => {
    // 账号 A 下发生本地编辑（待推防抖已调度）→ 用户随即移除当前账号切换到 B：
    // 旧会话的待推语义必须随切换取消，绝不能以 B 的请求头推送 A 的快照。
    seedTwoAccounts([createRepository(2)]);
    useAppStore.getState().addRepository(createRepository(99, { full_name: 'owner/repo-99' }));

    useAppStore.getState().removeSavedAccount('1');

    expect(useAppStore.getState().user?.id).toBe(2);
    await vi.advanceTimersByTimeAsync(3000);
    const pushedPayloads = vi.mocked(backend.syncRepositories).mock.calls;
    expect(pushedPayloads).toHaveLength(0);
  });

  it('regular local edits still push after the guards (control)', async () => {
    seedTwoAccounts([]);
    useAppStore.setState({ user: userA, githubToken: 'ghp_a', isAuthenticated: true });

    useAppStore.getState().addRepository(createRepository(5, { full_name: 'owner/repo-5' }));
    await vi.advanceTimersByTimeAsync(3000);

    expect(backend.syncRepositories).toHaveBeenCalledTimes(1);
    expect(vi.mocked(backend.syncRepositories).mock.calls[0][0].map(repo => repo.id)).toContain(5);
  });
});
