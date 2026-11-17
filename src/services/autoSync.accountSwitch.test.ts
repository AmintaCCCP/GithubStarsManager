import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from '../types';
import {
  consumePendingAccountSync,
  hasPendingAccountSync,
  prepareForAccountSwitch,
  resetSyncHashes,
  startAutoSync,
  stopAutoSync,
  syncFromBackend,
} from './autoSync';
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

/**
 * 冲刷失败语义（Issue #611 审计修复）：
 * 1. 切换前冲刷失败时不得只清除模块级待推标志——旧账号的未推修改必须记入
 *    账号级集合，切回该账号时先补推再拉取，否则非强制拉取会用后端旧快照
 *    覆盖未推送的本地修改（数据丢失红线）。
 * 2. 拉取等待结束后必须继续排空推送通道：拉取的 finally 会启动未被等待的
 *    syncToBackend()，账号切换不得早于该推送完成。
 */
describe('prepareForAccountSwitch flush semantics (audit fix)', () => {
  let originalState: ReturnType<typeof useAppStore.getState>;
  let unsubscribe: (() => void) | undefined;

  beforeEach(() => {
    originalState = useAppStore.getState();
    // mockReset 清除前序用例遗留的 persistent rejection 实现，再回填默认成功值
    vi.mocked(backend.syncRepositories).mockReset().mockResolvedValue(undefined);
    vi.mocked(backend.syncReleases).mockReset().mockResolvedValue(undefined);
    vi.mocked(backend.syncAIConfigs).mockReset().mockResolvedValue(undefined);
    vi.mocked(backend.syncWebDAVConfigs).mockReset().mockResolvedValue(undefined);
    vi.mocked(backend.syncEmbeddingConfigs).mockReset().mockResolvedValue(undefined);
    vi.mocked(backend.syncVectorSearchConfig).mockReset().mockResolvedValue(undefined);
    vi.mocked(backend.syncSettings).mockReset().mockResolvedValue(undefined);
    vi.mocked(backend.fetchRepositories).mockReset().mockResolvedValue({ repositories: [], total: 0 });
    vi.mocked(backend.fetchReleases).mockReset().mockResolvedValue({ releases: [], total: 0 });
    vi.mocked(backend.fetchAIConfigs).mockReset().mockResolvedValue([]);
    vi.mocked(backend.fetchWebDAVConfigs).mockReset().mockResolvedValue([]);
    vi.mocked(backend.fetchEmbeddingConfigs).mockReset().mockResolvedValue([]);
    vi.mocked(backend.fetchVectorSearchConfig).mockReset().mockResolvedValue({
      enabled: false, workerUrl: '', authToken: '', embeddingConfigId: '',
      indexMode: 'description', readmeMaxChars: 6000, searchThreshold: 0.35,
      searchTopK: 30, enableHyDE: true, enableReranking: true,
    });
    vi.mocked(backend.fetchSettings).mockReset().mockResolvedValue({});
    resetSyncHashes();
    unsubscribe = startAutoSync();
  });

  afterEach(() => {
    if (unsubscribe) {
      stopAutoSync(unsubscribe);
      unsubscribe = undefined;
    }
    useAppStore.setState(originalState);
  });

  const seedAccountA = () => {
    useAppStore.setState({
      user: userA,
      githubToken: 'ghp_a',
      isAuthenticated: true,
      savedAccounts: {
        '1': { accountId: '1', user: userA, githubToken: 'ghp_a', addedAt: 't', lastUsedAt: 't' },
      },
      repositories: [createRepository(1)],
      searchResults: [createRepository(1)],
    });
  };

  const rejectAllSyncs = () => {
    vi.mocked(backend.syncRepositories).mockRejectedValue(new Error('backend down'));
    vi.mocked(backend.syncReleases).mockRejectedValue(new Error('backend down'));
    vi.mocked(backend.syncAIConfigs).mockRejectedValue(new Error('backend down'));
    vi.mocked(backend.syncWebDAVConfigs).mockRejectedValue(new Error('backend down'));
    vi.mocked(backend.syncEmbeddingConfigs).mockRejectedValue(new Error('backend down'));
    vi.mocked(backend.syncVectorSearchConfig).mockRejectedValue(new Error('backend down'));
    vi.mocked(backend.syncSettings).mockRejectedValue(new Error('backend down'));
  };

  it('records the previous account as pending when the flush fails, then the record is consumed once', async () => {
    seedAccountA();
    // 三次冲刷全部失败：pushToBackend 保留待推标志
    rejectAllSyncs();

    useAppStore.getState().addRepository(createRepository(99, { full_name: 'owner/repo-99' }));
    await prepareForAccountSwitch('1');

    // 账号级待推状态已记录，供切回账号 A 时先补推再拉取
    expect(hasPendingAccountSync('1')).toBe(true);
    expect(consumePendingAccountSync('1')).toBe(true);
    // 记录只消费一次
    expect(consumePendingAccountSync('1')).toBe(false);
    expect(hasPendingAccountSync('1')).toBe(false);
  });

  it('clears the account pending record when the flush succeeds', async () => {
    seedAccountA();
    // 先制造一条失败记录
    rejectAllSyncs();
    useAppStore.getState().addRepository(createRepository(98, { full_name: 'owner/repo-98' }));
    await prepareForAccountSwitch('1');
    expect(hasPendingAccountSync('1')).toBe(true);

    // 第二次切换前冲刷成功：记录被清除，不带入陈旧待推语义
    useAppStore.setState({ user: userA, githubToken: 'ghp_a', isAuthenticated: true });
    await prepareForAccountSwitch('1');
    expect(hasPendingAccountSync('1')).toBe(false);
    expect(consumePendingAccountSync('1')).toBe(false);
  });

  it('waits for the push started by the pull finally before resolving (finding: drain after pull)', async () => {
    seedAccountA();
    // 让 fetchSettings 挂起，保证本地编辑发生在拉取在途窗口内
    let releaseSettings: (value: Record<string, unknown>) => void = () => undefined;
    vi.mocked(backend.fetchSettings).mockImplementation(
      () => new Promise((resolve) => { releaseSettings = resolve; }),
    );
    // 让首次推送挂起：prepareForAccountSwitch 在推送通道排空前不得返回。
    // 放行后的后续推送立即成功（flush 循环可能对同一推送通道排队一次）。
    let slowPush = true;
    const pushResolvers: Array<(value: undefined) => void> = [];
    vi.mocked(backend.syncRepositories).mockImplementation(() => {
      if (!slowPush) return Promise.resolve(undefined);
      return new Promise((resolve) => { pushResolvers.push(resolve); });
    });

    const pull = syncFromBackend({ force: true });
    // 等待 doSync 实际进入 fetch 等待窗口（force 路径先 await waitForInFlightSync）
    await new Promise((resolve) => setTimeout(resolve, 0));
    // 拉取在途窗口内的本地编辑：订阅器记录待推 → 拉取 finally 启动未等待的推送
    useAppStore.getState().addRepository(createRepository(99, { full_name: 'owner/repo-99' }));
    releaseSettings({});

    let prepared = false;
    const preparePromise = prepareForAccountSwitch('1').then(() => { prepared = true; });
    await pull;
    // 推送通道已被启动但仍未完成：prepare 必须等待而不是提前返回
    expect(backend.syncRepositories).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(prepared).toBe(false);
    // 排空推送后 prepareForAccountSwitch 才允许返回
    slowPush = false;
    for (const resolve of pushResolvers.splice(0)) resolve(undefined);
    await preparePromise;
    expect(prepared).toBe(true);
    expect(vi.mocked(backend.syncRepositories).mock.calls[0][0].map(repo => repo.id)).toContain(99);
    expect(hasPendingAccountSync('1')).toBe(false);
  });
});
