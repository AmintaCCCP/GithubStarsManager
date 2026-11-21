import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from '../types';
import {
  cancelPendingAccountSwitchPush,
  clearPendingSyncState,
  consumePendingAccountSync,
  forceSyncToBackend,
  hasPendingAccountSync,
  markPendingAccountSync,
  prepareForAccountSwitch,
  resetSyncHashes,
  startAutoSync,
  stopAutoSync,
  syncFromBackend,
  syncToBackend,
  withAccountSwitchFrozen,
  withAccountSwitchGuard,
  withAccountSwitchGuardSync,
} from './autoSync';
import { backend } from './backendAdapter';
import { useAppStore } from '../store/useAppStore';

vi.mock('./backendAdapter', () => ({
  backend: {
    isAvailable: true,
    // 破坏性推送前会先观察目标分区（非破坏性对账）；默认后端为空。
    fetchRepositories: vi.fn(async () => ({ repositories: [], total: 0 })),
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

  it('merges remotely arrived repositories before a destructive full push (audit fix)', async () => {
    // 本机陈旧快照（1,6）vs 后端分区（1,6,7）：全量推送前必须先并入 7，
    // 否则 isFullSync 会删除另一台设备新增的仓库。
    seedTwoAccounts([]);
    useAppStore.getState().addRepository(createRepository(6));
    vi.mocked(backend.fetchRepositories).mockResolvedValueOnce({
      repositories: [createRepository(1), createRepository(6), createRepository(7)],
      total: 3,
    });
    vi.mocked(backend.syncRepositories).mockClear();

    await syncToBackend();

    const pushed = vi.mocked(backend.syncRepositories).mock.calls.at(-1)?.[0] ?? [];
    expect(pushed.map(repo => repo.id).sort()).toEqual([1, 6, 7]);
  });

  it('refuses a destructive full push when the backend partition cannot be observed', async () => {
    seedTwoAccounts([]);
    useAppStore.getState().addRepository(createRepository(6));
    vi.mocked(backend.fetchRepositories).mockRejectedValueOnce(new Error('network down'));
    vi.mocked(backend.syncRepositories).mockClear();

    await syncToBackend();

    expect(backend.syncRepositories).not.toHaveBeenCalled();
  });

  it('identity writes inside the switch guard are bookkeeping and never schedule a push (addAccountWithToken R2)', async () => {
    // 审计修复回归（addAccountWithToken）：park 后落新账号的 setGitHubToken/setUser
    // 属于切换簿记，必须包入 withAccountSwitchGuardSync——否则订阅器把这两项写入
    // 记为待推，异步守卫释放时立即以新账号（本地尚无快照、仓库列表为空）的
    // 工作区 isFullSync 推送，早于后端对齐拉取，会删除新账号后端分区的数据。
    seedTwoAccounts([]);
    vi.mocked(backend.syncRepositories).mockClear();
    vi.mocked(backend.syncSettings).mockClear();

    await withAccountSwitchGuard(async () => {
      useAppStore.getState().parkCurrentAccountForRestore();
      withAccountSwitchGuardSync(() => {
        useAppStore.getState().setGitHubToken('ghp_b');
        useAppStore.getState().setUser(userB);
      });
    });

    expect(useAppStore.getState().user?.id).toBe(2);
    await vi.advanceTimersByTimeAsync(3000);
    expect(backend.syncRepositories).not.toHaveBeenCalled();
    expect(backend.syncSettings).not.toHaveBeenCalled();
  });

  it('edits inside a frozen switch window are not flushed at guard exit (backend-in-flux window)', async () => {
    // 审计修复回归（addAccountFromBackend）：候选后端 init 提交 URL 起到旧账号
    // 归档前的窗口内，后端连接处于「候选后端」状态——窗口内编辑若被记为待推，
    // 守卫退出会把尚未归档的旧账号工作区（或空工作区）写入候选后端分区。
    // 冻结窗口（withAccountSwitchFrozen）内编辑不推送。
    seedTwoAccounts([]);
    // 种子数据本身的 setState 会被订阅器记为待推并调度防抖——与本用例无关的
    // 噪声，先取消（与拆除类动作的既有语义一致），再进入冻结窗口
    cancelPendingAccountSwitchPush();
    vi.mocked(backend.syncRepositories).mockClear();
    vi.mocked(backend.syncSettings).mockClear();

    await withAccountSwitchFrozen(async () => {
      await withAccountSwitchGuard(async () => {
        // 模拟恢复等待期间的用户编辑（categoryOrder 是订阅器跟踪的字段）
        useAppStore.setState({ categoryOrder: ['reordered'] });
        expect(useAppStore.getState().categoryOrder).toEqual(['reordered']);
      });
    });

    await vi.advanceTimersByTimeAsync(3000);
    expect(backend.syncRepositories).not.toHaveBeenCalled();
    expect(backend.syncSettings).not.toHaveBeenCalled();
    // R4 审计修复：窗口内的编辑按归属账号并入待推集合（零推送的前提下保留
    // 补推标记）。清理标记避免泄漏到后续用例。
    consumePendingAccountSync('1');
  });

  it('routes real frozen-window edits to the originating account pending marker with zero pushes (R4)', async () => {
    // R4 审计修复回归：冻结窗口内的真实编辑不再被静默丢弃——按编辑时的活跃
    // 账号记入窗口缓冲，窗口退出并入 _pendingSyncAccounts（恢复成功场景：
    // 下次进入该账号先补推再拉取），全程零推送。
    seedTwoAccounts([]);
    cancelPendingAccountSwitchPush();
    vi.mocked(backend.syncRepositories).mockClear();
    vi.mocked(backend.syncSettings).mockClear();
    expect(hasPendingAccountSync('1')).toBe(false);

    await withAccountSwitchFrozen(async () => {
      // 模拟恢复等待期间（归档前）的用户编辑：顶层工作区仍属于账号 A
      useAppStore.setState({ categoryOrder: ['reordered-by-alice'] });
    });

    // 窗口退出：绝不推送（连接可能指向候选后端），但发起账号必须带上补推标记
    await vi.advanceTimersByTimeAsync(3000);
    expect(backend.syncRepositories).not.toHaveBeenCalled();
    expect(backend.syncSettings).not.toHaveBeenCalled();
    expect(hasPendingAccountSync('1')).toBe(true);
    expect(consumePendingAccountSync('1')).toBe(true);
    expect(hasPendingAccountSync('1')).toBe(false);
  });

  it('keeps guardSync bookkeeping writes inside a frozen window suppressed (R4)', async () => {
    // 簿记变更（guardSync 覆盖的工作区替换/身份提交）不得被当成真实编辑记入
    // 缓冲——否则恢复流程自身的工作区替换会给发起账号挂上补推标记。
    seedTwoAccounts([]);
    cancelPendingAccountSwitchPush();
    vi.mocked(backend.syncRepositories).mockClear();
    vi.mocked(backend.syncSettings).mockClear();

    await withAccountSwitchFrozen(async () => {
      await withAccountSwitchGuard(async () => {
        withAccountSwitchGuardSync(() => {
          // 恢复流程自身的簿记写入（如身份提交）——归属账号 A 在登录态
          useAppStore.setState({ categoryOrder: ['bookkeeping-write'] });
        });
      });
    });

    // 只有簿记写入时：缓冲为空、零标记、零推送
    await vi.advanceTimersByTimeAsync(3000);
    expect(backend.syncRepositories).not.toHaveBeenCalled();
    expect(backend.syncSettings).not.toHaveBeenCalled();
    expect(hasPendingAccountSync('1')).toBe(false);
    expect(hasPendingAccountSync('2')).toBe(false);
  });

  it('delivers a buffered frozen-window edit to the original backend partition on re-push (R4 failure path, C60a)', async () => {
    // 审计修复（C60a）：为冻结窗口配置不同 backendUrl——原后端进入冻结窗口，
    // 窗口内切到候选后端（模拟 backend.init 提交候选 URL）。缓冲编辑按原后端
    // 登记：候选后端上无 A 待推标记，切回原后端才可见；成功补推后仅清除
    // 原后端标记并核对写入目标。
    seedTwoAccounts([]);
    cancelPendingAccountSwitchPush();
    const adapter = backend as unknown as { backendUrl?: string };
    adapter.backendUrl = 'http://origin';
    vi.mocked(backend.syncRepositories).mockClear();
    vi.mocked(backend.syncSettings).mockClear();

    await withAccountSwitchFrozen(async () => {
      useAppStore.setState({ categoryOrder: ['restored-edit'] });
      // 候选后端连接提交（窗口内）
      adapter.backendUrl = 'http://candidate';
    });

    // 候选后端上无 A 待推标记（标记归属原后端）
    expect(hasPendingAccountSync('1')).toBe(false);

    // 切回原后端：标记才可见
    adapter.backendUrl = 'http://origin';
    expect(hasPendingAccountSync('1')).toBe(true);

    // 模拟调用方失败收尾：连接已复原、发起账号仍活跃——立即补推
    await syncToBackend();
    const settingsPayloads = vi.mocked(backend.syncSettings).mock.calls;
    const lastPayload = settingsPayloads[settingsPayloads.length - 1][0] as { categoryOrder?: string[] };
    expect(lastPayload.categoryOrder).toEqual(['restored-edit']);
    expect(backend.syncRepositories).toHaveBeenCalledTimes(1);
    // 第 12 轮审计修复：补推写入必须指向原后端与发起账号——「标记回到原后端，
    // 写入仍指向候选后端」的回归在此暴露。syncSettings 不携带写入选项参数，
    // 目标与账号断言落在携带写入选项的仓库分片上（设置分片经当前连接写入，
    // 当前连接已复原为 http://origin）。
    const repoSyncOptions = vi.mocked(backend.syncRepositories).mock.calls[0]?.[1];
    expect(repoSyncOptions).toMatchObject({ backendUrl: 'http://origin', accountId: '1' });
    // 补推成功即清除账号级标记（审计修复：仅在确认对账成功后清除）；
    // 失败路径由 pushToBackend 保留标记，重启后仍会补推。
    expect(hasPendingAccountSync('1')).toBe(false);
    delete adapter.backendUrl;
  });

  it('persists frozen-window pending setting values and replays them after another backend overwrote the workspace (R12 finding 3)', async () => {
    // 同账号 A 从原后端 X 恢复到候选后端 Y：窗口内的设置编辑只为 (A, X)
    // 记录脏键+值；Y 的拉取随后覆盖本地工作区。切回 X 补推时必须发送保存的
    // 值，而不是 Y 已覆盖的实时工作区值。
    clearPendingSyncState();
    seedTwoAccounts([]);
    cancelPendingAccountSwitchPush();
    const adapter = backend as unknown as { backendUrl?: string };
    adapter.backendUrl = 'http://origin';
    vi.mocked(backend.syncRepositories).mockClear();
    vi.mocked(backend.syncSettings).mockClear();

    await withAccountSwitchFrozen(async () => {
      useAppStore.setState({ categoryOrder: ['pending-origin-edit'] });
    });

    // 脏键与值一起按 (A, X) 持久化（四元组格式）。
    expect(hasPendingAccountSync('1')).toBe(true);
    const persisted = JSON.parse(window.localStorage.getItem('gsm.pendingSyncAccounts') ?? '[]') as unknown[];
    expect(persisted).toContainEqual([
      '1',
      'http://origin',
      ['categoryOrder'],
      { categoryOrder: ['pending-origin-edit'] },
    ]);

    // 恢复到候选后端 Y：Y 的拉取把本地 categoryOrder 覆盖为 Y 的值；候选
    // 后端上没有 (A, X) 的待推记录。
    adapter.backendUrl = 'http://candidate';
    withAccountSwitchGuardSync(() => {
      useAppStore.setState({ categoryOrder: ['candidate-backend-value'] });
    });
    expect(hasPendingAccountSync('1')).toBe(false);

    // 切回原后端 X：补推前恢复保存的待推值，并按该值构造设置载荷。
    adapter.backendUrl = 'http://origin';
    expect(hasPendingAccountSync('1')).toBe(true);
    await syncToBackend();

    expect(useAppStore.getState().categoryOrder).toEqual(['pending-origin-edit']);
    const settingsPayloads = vi.mocked(backend.syncSettings).mock.calls;
    const lastPayload = settingsPayloads[settingsPayloads.length - 1][0] as { categoryOrder?: string[] };
    expect(lastPayload.categoryOrder).toEqual(['pending-origin-edit']);
    expect(hasPendingAccountSync('1')).toBe(false);
    delete adapter.backendUrl;
  });

  it('replacing into a non-empty B workspace does not schedule a push (C60b)', async () => {
    // 审计修复（C60b）：退场测试升级——B 的本地工作区非空时，工作区替换
    // 同样不得调度推送（B 的快照在其后端分区被对齐拉取观察前绝不能外发）；
    // 空工作区用例保留为独立回归。
    seedTwoAccounts([createRepository(2)]);
    cancelPendingAccountSwitchPush();
    vi.mocked(backend.syncRepositories).mockClear();
    vi.mocked(backend.syncSettings).mockClear();

    useAppStore.getState().removeSavedAccount('1');

    expect(useAppStore.getState().user?.id).toBe(2);
    expect(useAppStore.getState().repositories[0]?.id).toBe(2);
    await vi.advanceTimersByTimeAsync(3000);
    expect(backend.syncRepositories).not.toHaveBeenCalled();
    expect(backend.syncSettings).not.toHaveBeenCalled();
    expect(backend.syncReleases).not.toHaveBeenCalled();
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
    vi.mocked(backend.syncSettings).mockReset().mockResolvedValue({ tokenUpdateSkipped: false, tokenUpdateSuperseded: false });
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

  it('returns the awaited push shard result to every concurrent force call (R12 finding 1)', async () => {
    seedAccountA();
    // 只有仓库分片失败：设置等辅助分片成功。
    vi.mocked(backend.syncRepositories).mockRejectedValue(new Error('repos down'));
    vi.mocked(backend.syncSettings).mockResolvedValue({ tokenUpdateSkipped: false, tokenUpdateSuperseded: false });

    // 第二次调用在第一次推送等待期间进入：旧实现会在入口清空模块级失败状态，
    // 导致先发起方在 await 返回后读到 pushAttempted=false / 空分片列表。
    const first = forceSyncToBackend({ reportFailures: true });
    const second = forceSyncToBackend({ reportFailures: true });
    const outcomes = await Promise.allSettled([first, second]);

    for (const outcome of outcomes) {
      expect(outcome.status).toBe('rejected');
      if (outcome.status !== 'rejected') continue;
      const error = outcome.reason as Error & { failedShards?: string[]; pushAttempted?: boolean };
      expect(error.pushAttempted).toBe(true);
      expect(error.failedShards).toContain('repositories');
    }
  });

  it('persists dirty setting values when the flush fails and replays them after a backend switch (R12 finding 3)', async () => {
    clearPendingSyncState();
    seedAccountA();
    const adapter = backend as unknown as { backendUrl?: string };
    adapter.backendUrl = 'http://origin';
    vi.mocked(backend.syncSettings).mockClear();

    // 失败的冲刷：设置编辑留在会话脏键里，prepareForAccountSwitch 必须把
    // 键与值一起持久化，并清空会话脏键（否则返回原后端时旧脏键标记会阻止
    // 恢复保存值）。
    useAppStore.setState({ categoryOrder: ['flush-failed-edit'] });
    rejectAllSyncs();
    await prepareForAccountSwitch('1');

    const persisted = JSON.parse(window.localStorage.getItem('gsm.pendingSyncAccounts') ?? '[]') as unknown[];
    expect(persisted).toContainEqual([
      '1',
      'http://origin',
      ['categoryOrder'],
      { categoryOrder: ['flush-failed-edit'] },
    ]);

    // 同账号切到另一后端：其拉取覆盖本地工作区。
    adapter.backendUrl = 'http://candidate';
    withAccountSwitchGuardSync(() => {
      useAppStore.setState({ categoryOrder: ['candidate-backend-value'] });
    });

    // 切回原后端重试：补推载荷必须使用持久化的值，而不是被覆盖后的工作区值。
    // 第 13 轮审计修复 [76]：记录重试前的调用次数——首次失败冲刷已写入
    // ['flush-failed-edit']，若重试因待推状态丢失而提前返回，最后一次调用仍
    // 来自失败冲刷，只看载荷会误通过。先断言重试产生了新调用，再检查载荷。
    adapter.backendUrl = 'http://origin';
    const syncSettingsCallsBeforeRetry = vi.mocked(backend.syncSettings).mock.calls.length;
    await syncToBackend();
    const settingsPayloads = vi.mocked(backend.syncSettings).mock.calls;
    expect(settingsPayloads.length).toBeGreaterThan(syncSettingsCallsBeforeRetry);
    const lastPayload = settingsPayloads[settingsPayloads.length - 1][0] as { categoryOrder?: string[] };
    expect(lastPayload.categoryOrder).toEqual(['flush-failed-edit']);
    delete adapter.backendUrl;
  });

  it('keeps the account pending record when no push runs and clears it only after a successful push', async () => {
    seedAccountA();
    // 先制造一条失败记录
    rejectAllSyncs();
    useAppStore.getState().addRepository(createRepository(98, { full_name: 'owner/repo-98' }));
    await prepareForAccountSwitch('1');
    expect(hasPendingAccountSync('1')).toBe(true);

    // 第二次准备：会话级标志已随失败冲刷统一清零，推送循环被整体跳过——
    // 没有任何推送发生，绝不能清除仍未补推的账号标记（审计修复：修复前
    // 这里会因「标志为空」误删标记，后续非强制拉取会用后端旧快照覆盖
    // 未推送的本地修改）
    useAppStore.setState({ user: userA, githubToken: 'ghp_a', isAuthenticated: true });
    await prepareForAccountSwitch('1');
    expect(hasPendingAccountSync('1')).toBe(true);

    // 补推实际成功（新编辑触发推送通道并成功落盘）后标记才被清除，
    // 且推送负载必须包含此前未推送的 repo-98 与本次新编辑 repo-97
    vi.mocked(backend.syncRepositories).mockResolvedValue(undefined);
    vi.mocked(backend.syncReleases).mockResolvedValue(undefined);
    vi.mocked(backend.syncAIConfigs).mockResolvedValue(undefined);
    vi.mocked(backend.syncWebDAVConfigs).mockResolvedValue(undefined);
    vi.mocked(backend.syncEmbeddingConfigs).mockResolvedValue(undefined);
    vi.mocked(backend.syncVectorSearchConfig).mockResolvedValue(undefined);
    vi.mocked(backend.syncSettings).mockResolvedValue({ tokenUpdateSkipped: false, tokenUpdateSuperseded: false });
    useAppStore.getState().addRepository(createRepository(97, { full_name: 'owner/repo-97' }));
    await prepareForAccountSwitch('1');
    expect(hasPendingAccountSync('1')).toBe(false);
    expect(consumePendingAccountSync('1')).toBe(false);
    const pushedPayloads = vi.mocked(backend.syncRepositories).mock.calls;
    const lastPayload = pushedPayloads[pushedPayloads.length - 1][0] as Repository[];
    expect(lastPayload.map((repo) => repo.id)).toEqual(expect.arrayContaining([98, 97]));
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
    // 先在没有待处理编辑、且拉取仍挂起时启动准备流程，确保前置冲刷循环未运行
    let prepared = false;
    const preparePromise = prepareForAccountSwitch('1').then(() => { prepared = true; });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(prepared).toBe(false);
    // 确认准备流程正在等待拉取后再添加本地编辑并放行 fetchSettings：
    // 此时只有拉取后的排空逻辑会继续等待推送完成
    useAppStore.getState().addRepository(createRepository(99, { full_name: 'owner/repo-99' }));
    releaseSettings({});

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

/**
 * R5 审计修复（CodeRabbit 发现 1）回归：
 * 切换到本地无快照的账号（本地真空）时仓库列表为空，而后端分区可能已有其他
 * 设备写入的数据。对齐窗口内的用户编辑被订阅器记为待推 → 非强制 syncFromBackend
 * 因待推标志直接返回（后端数据从未拉取）→ 守卫退出冲刷以空列表 isFullSync 推送
 * → 服务端物理删除该账号分区的仓库与 release。
 *
 * 修复语义（三段）：
 * 1. 「本地真空 + 后端事实未知」时 pushToBackend 拒绝空列表全量推送并保留待推
 *    标记（守卫退出冲刷、防抖推送、对齐补推全部经此拒收）；
 * 2. 非强制拉取在该状态下放行待推早退（走只并入后端新到仓库的待推分支），
 *    对齐得以完成、死锁解除；
 * 3. 本地列表曾非空（用户主动清空）或后端分区已被成功拉取观察过 → 空列表
 *    推送照常放行。
 */
describe('vacuum account sessions never push an empty full-sync snapshot before alignment (R5 finding 1)', () => {
  let originalState: ReturnType<typeof useAppStore.getState>;
  let unsubscribe: (() => void) | undefined;

  beforeEach(() => {
    originalState = useAppStore.getState();
    vi.useFakeTimers();
    vi.mocked(backend.syncRepositories).mockReset().mockResolvedValue(undefined);
    vi.mocked(backend.syncReleases).mockReset().mockResolvedValue(undefined);
    vi.mocked(backend.syncAIConfigs).mockReset().mockResolvedValue(undefined);
    vi.mocked(backend.syncWebDAVConfigs).mockReset().mockResolvedValue(undefined);
    vi.mocked(backend.syncEmbeddingConfigs).mockReset().mockResolvedValue(undefined);
    vi.mocked(backend.syncVectorSearchConfig).mockReset().mockResolvedValue(undefined);
    vi.mocked(backend.syncSettings).mockReset().mockResolvedValue({ tokenUpdateSkipped: false, tokenUpdateSuperseded: false });
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
    vi.useRealTimers();
    useAppStore.setState(originalState);
  });

  /** 账号 A 已登录且仓库非空；账号 B 已保存但本地工作区为空（真空）。 */
  const seedVacuumTarget = () => {
    useAppStore.setState({
      user: userA,
      githubToken: 'ghp_a',
      isAuthenticated: true,
      savedAccounts: {
        '1': { accountId: '1', user: userA, githubToken: 'ghp_a', addedAt: 't', lastUsedAt: 't' },
        '2': { accountId: '2', user: userB, githubToken: 'ghp_b', addedAt: 't', lastUsedAt: 't' },
      },
      repositories: [createRepository(1)],
      searchResults: [createRepository(1)],
    });
    // 种子 setState 会被订阅器记为待推并调度防抖——与本用例无关的噪声，先取消
    cancelPendingAccountSwitchPush();
    vi.mocked(backend.syncRepositories).mockClear();
    vi.mocked(backend.syncSettings).mockClear();
  };

  /** 在切换守卫内完成「簿记工作区替换 + 窗口内真实用户编辑」。 */
  const switchWithInWindowEdit = async (targetUser: typeof userB, categoryOrder: string[]) => {
    await withAccountSwitchGuard(async () => {
      withAccountSwitchGuardSync(() => {
        useAppStore.getState().setGitHubToken(`ghp_${targetUser.login.toLowerCase()}`);
        useAppStore.getState().setUser(targetUser);
      });
      // 窗口内真实编辑（categoryOrder 是订阅器跟踪字段）：订阅器在静音窗口内
      // 将其记为待推，守卫退出时触发冲刷
      useAppStore.setState({ categoryOrder });
    });
  };

  it('guard-exit flush with a vacuum target account performs zero push, keeps edits pending, and recovers after the alignment pull', async () => {
    seedVacuumTarget();

    // 切到真空账号 B + 窗口内用户编辑（对齐拉取被待推标志跳过前的典型时序）
    await switchWithInWindowEdit(userB, ['user-edit-in-window']);
    expect(useAppStore.getState().user?.id).toBe(2);
    expect(useAppStore.getState().repositories).toEqual([]);

    // 守卫退出冲刷：真空 + 后端事实未知 → 拒绝空列表 isFullSync 推送，零推送
    await vi.advanceTimersByTimeAsync(100);
    expect(backend.syncRepositories).not.toHaveBeenCalled();
    expect(backend.syncSettings).not.toHaveBeenCalled();

    // 对齐拉取不再被待推标志卡死：拉取成功合并后端数据并排空待推队列
    vi.mocked(backend.fetchRepositories).mockResolvedValue({
      repositories: [createRepository(7), createRepository(8)],
      total: 2,
    });
    await syncFromBackend();
    expect(useAppStore.getState().repositories.map((repo) => repo.id)).toEqual(expect.arrayContaining([7, 8]));

    await vi.advanceTimersByTimeAsync(100);
    expect(backend.syncRepositories).toHaveBeenCalledTimes(1);
    const pushedRepos = vi.mocked(backend.syncRepositories).mock.calls[0][0] as Repository[];
    expect(pushedRepos.map((repo) => repo.id)).toEqual(expect.arrayContaining([7, 8]));
    // 窗口内的用户编辑未被对齐流程静默丢弃：随排空推送一并落盘
    const settingsPayloads = vi.mocked(backend.syncSettings).mock.calls;
    const lastSettings = settingsPayloads[settingsPayloads.length - 1][0] as { categoryOrder?: string[] };
    expect(lastSettings.categoryOrder).toEqual(['user-edit-in-window']);
  });

  it('switching into a non-empty workspace still flushes at guard exit (control)', async () => {
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
          repositories: [createRepository(3)],
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
      repositories: [createRepository(1)],
      searchResults: [createRepository(1)],
    });
    cancelPendingAccountSwitchPush();
    vi.mocked(backend.syncRepositories).mockClear();
    vi.mocked(backend.syncSettings).mockClear();

    // 换入非空工作区：守卫退出冲刷卡在空列表豁免之外——照常推送该账号自己的完整数据
    await switchWithInWindowEdit(userB, ['b-edit']);

    await vi.advanceTimersByTimeAsync(100);
    expect(backend.syncRepositories).toHaveBeenCalledTimes(1);
    const pushedRepos = vi.mocked(backend.syncRepositories).mock.calls[0][0] as Repository[];
    expect(pushedRepos.map((repo) => repo.id)).toContain(3);
    const settingsPayloads = vi.mocked(backend.syncSettings).mock.calls;
    const lastSettings = settingsPayloads[settingsPayloads.length - 1][0] as { categoryOrder?: string[] };
    expect(lastSettings.categoryOrder).toEqual(['b-edit']);
  });

  it('a deliberate full clear still pushes the empty snapshot (seen-non-empty exemption)', async () => {
    seedVacuumTarget();

    // 用户在本会话内主动清空全部仓库：本地列表曾非空 → 空列表全量推送必须放行，
    // 否则删除永远无法同步到后端（僵尸仓库回潮）
    useAppStore.setState({ repositories: [] });
    await vi.advanceTimersByTimeAsync(3000);

    expect(backend.syncRepositories).toHaveBeenCalledTimes(1);
    expect(vi.mocked(backend.syncRepositories).mock.calls[0][0]).toEqual([]);
  });

  it('direct syncToBackend in an unaligned vacuum session refuses the empty push until the backend partition is observed', async () => {
    seedVacuumTarget();
    // 模拟对齐拉取被跳过后的真空会话：直接推送必须被拒收
    useAppStore.setState({ user: userB, githubToken: 'ghp_b', isAuthenticated: true, repositories: [] });
    cancelPendingAccountSwitchPush();

    await syncToBackend();
    expect(backend.syncRepositories).not.toHaveBeenCalled();
    expect(backend.syncSettings).not.toHaveBeenCalled();

    // 一次成功的仓库拉取观察过后端分区后，推送通道恢复
    vi.mocked(backend.fetchRepositories).mockResolvedValue({
      repositories: [createRepository(9)],
      total: 1,
    });
    await syncFromBackend();
    await vi.advanceTimersByTimeAsync(100);
    expect(backend.syncRepositories).toHaveBeenCalledTimes(1);
    const pushedRepos = vi.mocked(backend.syncRepositories).mock.calls[0][0] as Repository[];
    expect(pushedRepos.map((repo) => repo.id)).toContain(9);
  });
});

/**
 * 第 14 轮审计修复回归：冻结窗口栈化（缓冲指向/阶段状态/重置代次）、待推
 * 设置按编辑版本合并、评估标记时序、精确键清除与脏键恢复范围、推送链严格
 * 结果、冲突重试快照重验、基线删除归因、webdav 对齐标记重置与 forceVerify
 * 未验证分片上报。
 */
describe('round 14 audit fixes (frozen window stack, pending merge, push chain)', () => {
  let originalState: ReturnType<typeof useAppStore.getState>;
  let unsubscribe: (() => void) | undefined;
  const adapter = backend as unknown as { backendUrl?: string };

  beforeEach(() => {
    originalState = useAppStore.getState();
    vi.useFakeTimers();
    clearPendingSyncState();
    vi.mocked(backend.syncRepositories).mockReset().mockResolvedValue(undefined);
    vi.mocked(backend.syncReleases).mockReset().mockResolvedValue(undefined);
    vi.mocked(backend.syncAIConfigs).mockReset().mockResolvedValue(undefined);
    vi.mocked(backend.syncWebDAVConfigs).mockReset().mockResolvedValue(undefined);
    vi.mocked(backend.syncEmbeddingConfigs).mockReset().mockResolvedValue(undefined);
    vi.mocked(backend.syncVectorSearchConfig).mockReset().mockResolvedValue(undefined);
    vi.mocked(backend.syncSettings).mockReset().mockResolvedValue({ tokenUpdateSkipped: false, tokenUpdateSuperseded: false });
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
    useAppStore.setState({
      user: userA,
      githubToken: 'ghp_a',
      isAuthenticated: true,
      savedAccounts: {
        '1': { accountId: '1', user: userA, githubToken: 'ghp_a', addedAt: 't', lastUsedAt: 't' },
      },
      repositories: [],
      releases: [],
      aiConfigs: [],
      webdavConfigs: [],
      customCategories: [],
      categoryOrder: [],
    } as never);
    resetSyncHashes();
    adapter.backendUrl = 'http://origin';
    unsubscribe = startAutoSync();
  });

  afterEach(() => {
    if (unsubscribe) {
      stopAutoSync(unsubscribe);
      unsubscribe = undefined;
    }
    vi.useRealTimers();
    useAppStore.setState(originalState);
    clearPendingSyncState();
    delete adapter.backendUrl;
  });

  const pendingRecords = (): unknown[] => (
    JSON.parse(window.localStorage.getItem('gsm.pendingSyncAccounts') ?? '[]') as unknown[]
  );

  it('merges pending setting values by edit order, not by frozen-window exit order (round-14 [12])', async () => {
    // 外层窗口先编辑 v1，内层窗口稍后编辑 v2；内层先退出保存 v2，外层晚退出
    // 的陈旧 v1 不得按退出顺序覆盖内层的新值。
    await withAccountSwitchFrozen(async () => {
      useAppStore.setState({ categoryOrder: ['outer-v1'] });
      await withAccountSwitchFrozen(async () => {
        useAppStore.setState({ categoryOrder: ['inner-v2'] });
      }, 'http://origin');
    }, 'http://origin');

    const persisted = pendingRecords() as Array<[string, string, string[], Record<string, string[]>]>;
    expect(persisted).toHaveLength(1);
    expect(persisted[0][3]).toEqual({ categoryOrder: ['inner-v2'] });
  });

  it('hands the edit buffers to the still-active window when a concurrent window exits first (round-14 [15])', async () => {
    // X 先进入（origin X）先退出、Y 后进入（origin Y）仍在等待：X 退出后发生
    // 的编辑必须落入 Y 的缓冲并在 Y 退出时持久化——不得落入已失效缓冲丢失。
    let enterY!: () => void;
    const yEntered = new Promise<void>((resolve) => { enterY = resolve; });
    let exitXGate!: (value: void) => void;
    const xDone = new Promise<void>((resolve) => { exitXGate = resolve; });

    const xPromise = withAccountSwitchFrozen(async () => {
      useAppStore.setState({ categoryOrder: ['edit-in-x'] });
      enterY();
      await xDone;
    }, 'http://x');

    await yEntered;
    const yPromise = withAccountSwitchFrozen(async () => {
      exitXGate();
      await xPromise;
      // X 已完全退出：此刻的编辑必须仍被捕获（Y 的缓冲仍是活跃缓冲）
      useAppStore.setState({ categoryOrder: ['edit-in-y'] });
    }, 'http://y');

    await yPromise;
    await xPromise;

    const persisted = pendingRecords() as Array<[string, string, string[]]>;
    const recordFor = (url: string) => persisted.find((entry) => entry[1] === url);
    expect(recordFor('http://x')?.[2]).toEqual(['categoryOrder']);
    expect(recordFor('http://y')?.[2]).toEqual(['categoryOrder']);
    // 值归属：切回各自 origin 时恢复的必须是各自窗口内的编辑
    expect(pendingRecords()).toHaveLength(2);
  });

  it('restores the pre-freeze switch state when the last concurrent window exits (round-14 [19])', async () => {
    // X 先进先出、Y 后进后出：Y 保存的 previousSwitching 是 true——最后退出
    // 时必须恢复整个冻结阶段开始前的状态（false），否则轮询持续跳过自动拉取。
    let enterY!: () => void;
    const yEntered = new Promise<void>((resolve) => { enterY = resolve; });
    let exitXGate!: (value: void) => void;
    const xDone = new Promise<void>((resolve) => { exitXGate = resolve; });

    const xPromise = withAccountSwitchFrozen(async () => {
      enterY();
      await xDone;
    }, 'http://x');
    await yEntered;
    const yPromise = withAccountSwitchFrozen(async () => {
      exitXGate();
      await xPromise;
    }, 'http://y');
    await yPromise;
    await xPromise;

    // 阶段结束后轮询恢复：5s 轮询必须发起一次普通拉取
    await vi.advanceTimersByTimeAsync(5000);
    expect(backend.fetchRepositories).toHaveBeenCalled();
  });

  it('does not persist frozen-window edits captured before a full data reset (round-14 [23])', async () => {
    await withAccountSwitchFrozen(async () => {
      useAppStore.setState({ categoryOrder: ['edit-before-reset'] });
      // 清空全部数据发生在窗口生命周期内：递增重置代次并清空待推记录
      clearPendingSyncState();
    }, 'http://origin');

    // 窗口退出释放，但旧窗口的编辑绝不写回磁盘（重置后不得复活）
    expect(pendingRecords()).toEqual([]);
    expect(hasPendingAccountSync('1')).toBe(false);
  });

  it('keeps unknown-origin pending records on a confirmed push and does not restore their dirty keys for outbound push (round-14 [21][22])', async () => {
    useAppStore.setState({ repositories: [createRepository(1)] });
    // 精确匹配记录（无脏键）+ 来源未知（backendUrl ''）记录（带脏键）
    markPendingAccountSync('1', 'http://origin');
    markPendingAccountSync('1', '', { dirtySettingKeys: ['categoryOrder'] });

    await syncToBackend();

    // [21]：成功推送只清除精确匹配记录；来源未知记录保留
    const persisted = pendingRecords() as Array<[string, string, string?]>;
    expect(persisted).toContainEqual(['1', '', ['categoryOrder']]);
    expect(persisted).not.toContainEqual(['1', 'http://origin']);
    // [22]：未知来源脏键未恢复为当前后端的出站待推项——设置未对齐且无脏键
    // ⇒ 设置分片整体跳过（绝不把当前工作区值写到未归属后端的语义下外发）
    expect(backend.syncSettings).not.toHaveBeenCalled();
  });

  it('restores persisted dirty keys before constructing the settings payload so restored fields are sent (round-14 [18])', async () => {
    // 非空仓库列表：绕过空推送保护，让补推真正发出
    useAppStore.setState({ repositories: [createRepository(1)] });
    // 冻结窗口同时编辑 categoryOrder 与 customCategories：值+脏键按 (1, origin) 持久化
    await withAccountSwitchFrozen(async () => {
      useAppStore.setState({
        categoryOrder: ['frozen-order'],
        customCategories: [{ id: 'cat-frozen', name: 'Frozen', icon: 'folder', keywords: [], isCustom: true }],
      });
    }, 'http://origin');

    // 不经过拉取（设置未对齐）直接补推：恢复的值与脏键必须先于载荷构造恢复
    await syncToBackend();
    const settingsCalls = vi.mocked(backend.syncSettings).mock.calls;
    expect(settingsCalls.length).toBeGreaterThan(0);
    const lastPayload = settingsCalls[settingsCalls.length - 1][0] as {
      categoryOrder?: string[];
      customCategories?: Array<{ id: string }>;
    };
    expect(lastPayload.categoryOrder).toEqual(['frozen-order']);
    expect(lastPayload.customCategories?.[0]?.id).toBe('cat-frozen');
  });

  it('clears the webdav alignment marker on hash reset so a failed forced pull cannot push an empty list (round-14 [13])', async () => {
    // 第一次拉取：远端 WebDAV 为空 → 读取标记置位
    await syncFromBackend();
    // 新对齐会话（resetSyncHashes）后强制拉取的 WebDAV 请求失败：旧标记必须清除
    resetSyncHashes();
    vi.mocked(backend.fetchWebDAVConfigs).mockRejectedValueOnce(new Error('webdav fetch failed'));
    await syncFromBackend({ force: true });
    // 设置编辑触发推送：未对齐空列表必须跳过 WebDAV 写入（保护远端其他设备配置）
    useAppStore.setState({ categoryOrder: ['edited'] });
    cancelPendingAccountSwitchPush();
    await syncToBackend();
    expect(backend.syncWebDAVConfigs).not.toHaveBeenCalled();
  });

  it('reports skipped AI/WebDAV shards as unverified in forceVerify mode while keeping the auto-push protection (round-14 [14])', async () => {
    // 设置已对齐（拉取成功），AI/WebDAV 读取失败且本机列表为空
    vi.mocked(backend.fetchAIConfigs).mockRejectedValueOnce(new Error('ai down'));
    vi.mocked(backend.fetchWebDAVConfigs).mockRejectedValueOnce(new Error('webdav down'));
    await syncFromBackend();

    // 手动同步：跳过的配置分片按未验证上报（绝不报告同步成功）
    await expect(forceSyncToBackend({ forceVerify: true, reportFailures: true })).rejects.toMatchObject({
      failedShards: expect.arrayContaining(['aiConfigs', 'webdavConfigs']),
    });
    // 自动推送保留现有保护：跳过不视为失败
    await expect(syncToBackend()).resolves.toBe(true);
    expect(backend.syncAIConfigs).not.toHaveBeenCalled();
    expect(backend.syncWebDAVConfigs).not.toHaveBeenCalled();
  });

  it('re-validates the local repository snapshot before retrying a conflicted full PUT (round-14 [16])', async () => {
    useAppStore.setState({ repositories: [createRepository(1)] });
    vi.mocked(backend.fetchRepositories)
      .mockResolvedValueOnce({ repositories: [], total: 0, revision: 1 })
      .mockResolvedValueOnce({ repositories: [createRepository(2)], total: 1, revision: 2 });
    vi.mocked(backend.syncRepositories)
      .mockImplementationOnce(() => {
        // 首个 PUT 在途期间用户新增仓库 3，随后服务端返回快照冲突
        useAppStore.setState({ repositories: [createRepository(1), createRepository(3)] });
        return Promise.reject(Object.assign(new Error('conflict'), { statusCode: 409 }));
      })
      .mockResolvedValueOnce(undefined);

    await syncToBackend();

    // 重试载荷基于当前快照 [1,3] 重新对账，并保留远端的 2（随后一次重推是
    // 在途变更的合法补推，不影响本次断言）
    expect(vi.mocked(backend.syncRepositories).mock.calls.length).toBeGreaterThan(1);
    const retryPayload = vi.mocked(backend.syncRepositories).mock.calls[1][0] as Repository[];
    expect(retryPayload.map((repo) => repo.id).sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it('does not treat remote-pull removals as local deletions when pushing after another device re-added a repo (round-14 [24])', async () => {
    // 1. 首次成功推送 [1,2] → 推送基线 {1,2}
    useAppStore.setState({ repositories: [createRepository(1), createRepository(2)] });
    await syncToBackend();
    // 取消 seeding 遗留的防抖定时器（否则其会拦截下一步的拉取）
    cancelPendingAccountSwitchPush();
    expect(vi.mocked(backend.syncRepositories)).toHaveBeenCalledTimes(1);

    // 2. 另一设备删除 2：本机后台拉取静音应用 [1]（不产生本地删除记录）
    vi.mocked(backend.fetchRepositories).mockResolvedValueOnce({
      repositories: [createRepository(1)], total: 1, revision: 2,
    });
    await syncFromBackend();
    expect(useAppStore.getState().repositories.map((repo) => repo.id)).toEqual([1]);

    // 3. 另一设备重新添加 2；本机新增 3 并推送：陈旧基线不得把 2 当本地删除
    vi.mocked(backend.fetchRepositories).mockResolvedValueOnce({
      repositories: [createRepository(1), createRepository(2)], total: 2, revision: 3,
    });
    useAppStore.setState({ repositories: [createRepository(1), createRepository(3)] });
    await syncToBackend();

    const lastPayload = vi.mocked(backend.syncRepositories).mock.calls.at(-1)![0] as Repository[];
    expect(lastPayload.map((repo) => repo.id).sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it('returns an unfinished result to strict callers when a queued forceVerify is skipped by a frozen window (round-14 [17])', async () => {
    useAppStore.setState({ repositories: [createRepository(1)] });
    let releaseRepoSync!: () => void;
    const repoSyncInvoked = new Promise<void>((resolve) => {
      vi.mocked(backend.syncRepositories).mockImplementationOnce(() => new Promise<void>((resolve2) => {
        releaseRepoSync = resolve2;
        resolve();
      }));
    });

    const plainPush = syncToBackend();
    await repoSyncInvoked; // 普通推送已挂在 syncRepositories 上
    // 普通推送在途：手动同步把 forceVerify 排入同一推送链
    const strictSync = forceSyncToBackend({ forceVerify: true, reportFailures: true })
      .then(() => null, (err: Error) => err);
    // 连接探测冻结同步：普通推送完成后，排队的校验不得执行
    let releaseWindow!: () => void;
    const windowDone = new Promise<void>((resolve) => { releaseWindow = resolve; });
    void withAccountSwitchFrozen(async () => { await windowDone; }, 'http://origin');

    releaseRepoSync();
    await plainPush;
    const strictError = await strictSync;

    // 严格调用方收到明确的未完成结果（普通推送的成功不得冒充校验成功）
    expect(strictError).toBeInstanceOf(Error);
    expect((strictError as Error & { pushAttempted?: boolean }).pushAttempted).toBe(true);

    // 解冻后排空的排队校验
    releaseWindow();
    await windowDone;
    await syncToBackend();
  });
});
