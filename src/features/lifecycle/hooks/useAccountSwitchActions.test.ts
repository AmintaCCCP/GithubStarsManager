import { act, renderHook } from '@testing-library/react';
import { getAccountSessionGeneration } from '../../../store/helpers/accountWorkspace';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountWorkspace, Repository } from '../../../types';

const mocks = vi.hoisted(() => ({
  prepareForAccountSwitch: vi.fn(),
  syncFromBackend: vi.fn(),
  withAccountSwitchGuard: vi.fn(),
  hasPendingAccountSync: vi.fn(),
  syncToBackend: vi.fn(),
  backend: {
    isAvailable: true,
    syncSettings: vi.fn(),
    backendUrl: null as string | null,
    init: vi.fn<(url?: string) => Promise<void>>(async () => undefined),
    // 推送链各数据分片的写入方法桩（R13 审计修复）：真实 syncToBackend 的
    // 模块内部调用不经过导出 mock，写入归属必须在 backend 适配器写入边界
    // 记录 URL 才能验证（见 C65b-1 用例）。
    syncRepositories: vi.fn(),
    syncReleases: vi.fn(),
    syncAIConfigs: vi.fn(),
    syncWebDAVConfigs: vi.fn(),
    syncEmbeddingConfigs: vi.fn(),
    syncVectorSearchConfig: vi.fn(),
  },
  restoreBackendSession: vi.fn(),
  authenticateWithGitHub: vi.fn(),
  refreshMcpElectronBridge: vi.fn(),
  abortActiveAnalysisJobs: vi.fn(),
}));

vi.mock('../../../services/autoSync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/autoSync')>();
  mocks.hasPendingAccountSync.mockImplementation((accountId?: string | null) =>
    actual.hasPendingAccountSync(accountId),
  );
  return {
    ...actual,
    prepareForAccountSwitch: mocks.prepareForAccountSwitch,
    syncFromBackend: mocks.syncFromBackend,
    hasPendingAccountSync: mocks.hasPendingAccountSync,
    syncToBackend: mocks.syncToBackend,
    // 透传真实守卫（保留退出时的待推冲刷语义）并记录调用次数
    withAccountSwitchGuard: async <T>(fn: () => Promise<T>) => {
      mocks.withAccountSwitchGuard();
      return actual.withAccountSwitchGuard(fn);
    },
  };
});
vi.mock('../../../services/backendAdapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/backendAdapter')>();
  return { ...actual, backend: mocks.backend };
});
vi.mock('../../../services/mcpElectronBridge', () => ({ refreshMcpElectronBridge: mocks.refreshMcpElectronBridge }));
vi.mock('../../repositories/hooks/analysisJobRegistry', () => ({
  abortActiveAnalysisJobs: mocks.abortActiveAnalysisJobs,
}));
vi.mock('./useLoginActions', () => ({
  useLoginActions: () => ({
    restoreBackendSession: mocks.restoreBackendSession,
    authenticateWithGitHub: mocks.authenticateWithGitHub,
    configuredBackendUrl: null,
    syncTokenToBackend: vi.fn(),
    setupBackendGitHubToken: vi.fn(),
    syncBackendData: vi.fn(),
  }),
}));

import { useAppStore } from '../../../store/useAppStore';
import { hasPendingAccountSync, startAutoSync, stopAutoSync } from '../../../services/autoSync';
import type { GitHubUser } from '../../../types';
import {
  useAccountSwitchActions,
  hasPendingBackendCredentialAlign,
  getPendingBackendCredentialAlignVersion,
  subscribePendingBackendCredentialAlign,
  resetPendingBackendCredentialAlignForTest,
} from './useAccountSwitchActions';

// 恢复真实 Store：全局 setup.ts 将 ../store/useAppStore mock 成了选择器桩，
// 而本测试需要驱动真实的多账号切换编排。
vi.mock('../../../store/useAppStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../store/useAppStore')>();
  return actual;
});

const userA = { id: 1, login: 'alice', name: 'Alice', avatar_url: 'https://x/a.png', email: null };
const userB = { id: 2, login: 'bob', name: 'Bob', avatar_url: 'https://x/b.png', email: null };

const workspaceOf = (repoId: number): AccountWorkspace => ({
  repositories: [{
    id: repoId,
    name: `repo-${repoId}`,
    full_name: `owner/repo-${repoId}`,
    description: null,
    html_url: `https://github.com/owner/repo-${repoId}`,
    stargazers_count: 1,
    forks_count: 0,
    forks: 0,
    language: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    pushed_at: '2026-01-01T00:00:00.000Z',
    owner: { login: 'owner', avatar_url: '' },
    topics: [],
  } as Repository],
  lastSync: null,
  gists: [],
  starredGists: [],
  selectedGistCategory: 'all' as const,
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
  syncMode: 'stars' as const,
  syncModeConfigured: false,
});

describe('useAccountSwitchActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPendingBackendCredentialAlignForTest();
    mocks.backend.isAvailable = false;
    mocks.backend.backendUrl = null;
    mocks.syncFromBackend.mockResolvedValue(undefined);
    mocks.prepareForAccountSwitch.mockResolvedValue(undefined);
    mocks.syncToBackend.mockResolvedValue(true);
    useAppStore.setState({
      user: null,
      githubToken: null,
      isAuthenticated: false,
      accountWorkspaces: {},
      savedAccounts: {},
      repositories: [],
      searchResults: [],
    });
  });

  it('switches to a saved account and aligns the backend partition', async () => {
    useAppStore.setState({
      user: userA,
      githubToken: 'ghp_a',
      isAuthenticated: true,
      savedAccounts: {
        '1': { accountId: '1', user: userA, githubToken: 'ghp_a', addedAt: 't', lastUsedAt: 't' },
        '2': { accountId: '2', user: userB, githubToken: 'ghp_b', addedAt: 't', lastUsedAt: 't' },
      },
      accountWorkspaces: { '2': workspaceOf(2) },
      repositories: [{ id: 1, name: 'repo-1', full_name: 'owner/repo-1' } as never],
      searchResults: [],
    });
    mocks.backend.isAvailable = true;

    const { result } = renderHook(() => useAccountSwitchActions());
    let outcome;
    await act(async () => {
      outcome = await result.current.switchToAccount('2');
    });

    expect(outcome).toEqual({ ok: true });
    expect(mocks.prepareForAccountSwitch).toHaveBeenCalledWith('1');
    // 后端对齐必须携带 user_profile / active_account_id（accounts 表唯一写入路径）
    expect(mocks.backend.syncSettings).toHaveBeenCalledWith({
      github_token: 'ghp_b',
      active_account_id: '2',
      user_profile: userB,
    });
    expect(mocks.syncFromBackend).toHaveBeenCalledWith({ force: false });
    expect(mocks.refreshMcpElectronBridge).toHaveBeenCalled();

    const state = useAppStore.getState();
    expect(state.user?.login).toBe('bob');
    expect(state.githubToken).toBe('ghp_b');
    expect(state.isAuthenticated).toBe(true);
    expect(state.accountWorkspaces['1']?.repositories[0]?.id).toBe(1);
    expect(state.repositories[0]?.id).toBe(2);
    expect(result.current.isSwitching).toBe(false);
  });

  it('reports needsToken when the target account has no usable token', async () => {
    useAppStore.setState({
      user: userA,
      githubToken: 'ghp_a',
      isAuthenticated: true,
      savedAccounts: {
        '1': { accountId: '1', user: userA, githubToken: 'ghp_a', addedAt: 't', lastUsedAt: 't' },
        '2': { accountId: '2', user: userB, githubToken: '', addedAt: 't', lastUsedAt: 't' },
      },
    });

    const { result } = renderHook(() => useAccountSwitchActions());
    let outcome;
    await act(async () => {
      outcome = await result.current.switchToAccount('2');
    });

    expect(outcome).toEqual({ ok: false, needsToken: true });
    expect(mocks.prepareForAccountSwitch).not.toHaveBeenCalled();
    expect(useAppStore.getState().user?.login).toBe('alice');
  });

  it('updates only the token when re-adding the current account and aligns backend credentials', async () => {
    useAppStore.setState({
      user: userA,
      githubToken: 'ghp_a',
      isAuthenticated: true,
      savedAccounts: { '1': { accountId: '1', user: userA, githubToken: 'ghp_a', addedAt: 't0', lastUsedAt: 't' } },
    });
    mocks.authenticateWithGitHub.mockResolvedValue(userA);
    mocks.backend.isAvailable = true;
    const generationBefore = getAccountSessionGeneration();

    const { result } = renderHook(() => useAccountSwitchActions());
    let outcome;
    await act(async () => {
      outcome = await result.current.addAccountWithToken('ghp_a2');
    });

    expect(outcome).toEqual({ ok: true, user: userA });
    // R12 finding 16：同账号提交不同 PAT 必须推进会话代次（旧凭据在途任务失效）
    expect(getAccountSessionGeneration()).toBe(generationBefore + 1);
    expect(useAppStore.getState().githubToken).toBe('ghp_a2');
    expect(useAppStore.getState().savedAccounts['1']?.githubToken).toBe('ghp_a2');
    expect(useAppStore.getState().savedAccounts['1']?.addedAt).toBe('t0');
    // 同账号刷新：不触发归档与切换冲刷（当前账号工作区保持不变）
    expect(mocks.prepareForAccountSwitch).not.toHaveBeenCalled();
    expect(useAppStore.getState().accountWorkspaces['1']).toBeUndefined();
    // 审计修复：后端保存的旧 Token 可能已失效——新凭据必须对齐到后端目标
    // 分区并刷新桥接，否则后端代理继续用旧 Token、后续请求反复失败
    expect(mocks.backend.syncSettings).toHaveBeenCalledWith({
      github_token: 'ghp_a2',
      active_account_id: '1',
      user_profile: userA,
    });
    expect(mocks.refreshMcpElectronBridge).toHaveBeenCalled();
  });

  it('does not advance the session generation when the same PAT is re-submitted (R12 finding 16)', async () => {
    useAppStore.setState({
      user: userA,
      githubToken: 'ghp_a',
      isAuthenticated: true,
      savedAccounts: { '1': { accountId: '1', user: userA, githubToken: 'ghp_a', addedAt: 't0', lastUsedAt: 't' } },
    });
    mocks.authenticateWithGitHub.mockResolvedValue(userA);
    mocks.backend.isAvailable = true;
    const generationBefore = getAccountSessionGeneration();

    const { result } = renderHook(() => useAccountSwitchActions());
    await act(async () => {
      await result.current.addAccountWithToken('ghp_a');
    });

    // 重复提交相同 PAT 不中止当前任务
    expect(getAccountSessionGeneration()).toBe(generationBefore);
  });

  it('aborts dependent analysis jobs before committing the candidate backend (R12 finding 6)', async () => {
    useAppStore.setState({
      user: userA,
      githubToken: 'ghp_a',
      isAuthenticated: true,
      savedAccounts: { '1': { accountId: '1', user: userA, githubToken: 'ghp_a', addedAt: 't', lastUsedAt: 't' } },
    });
    mocks.restoreBackendSession.mockResolvedValue({ status: 'unauthorized' });

    const { result } = renderHook(() => useAccountSwitchActions());
    await act(async () => {
      await result.current.addAccountFromBackend('https://candidate.example', 'secret');
    });

    expect(mocks.abortActiveAnalysisJobs).toHaveBeenCalledTimes(1);
    // 必须在候选连接（restoreBackendSession 提交 URL）之前中止
    expect(mocks.abortActiveAnalysisJobs.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.restoreBackendSession.mock.invocationCallOrder[0]);
  });

  it('archives the current account before switching to a newly added one', async () => {
    useAppStore.setState({
      user: userA,
      githubToken: 'ghp_a',
      isAuthenticated: true,
      savedAccounts: { '1': { accountId: '1', user: userA, githubToken: 'ghp_a', addedAt: 't', lastUsedAt: 't' } },
      repositories: [{ id: 1, name: 'repo-1', full_name: 'owner/repo-1' } as never],
    });
    mocks.authenticateWithGitHub.mockResolvedValue(userB);

    const { result } = renderHook(() => useAccountSwitchActions());
    let outcome;
    await act(async () => {
      outcome = await result.current.addAccountWithToken('ghp_b');
    });

    expect(outcome).toEqual({ ok: true, user: userB });
    const state = useAppStore.getState();
    expect(state.user?.login).toBe('bob');
    expect(state.repositories).toEqual([]);
    // 账号 A 的工作区被安全归档，绝不被新账号数据污染
    expect(state.accountWorkspaces['1']?.repositories[0]?.id).toBe(1);
    expect(state.savedAccounts['2']?.githubToken).toBe('ghp_b');
  });

  it('restores the parked account when adding a new account fails after parking', async () => {
    useAppStore.setState({
      user: userA,
      githubToken: 'ghp_a',
      isAuthenticated: true,
      savedAccounts: { '1': { accountId: '1', user: userA, githubToken: 'ghp_a', addedAt: 't', lastUsedAt: 't' } },
      repositories: [{ id: 1, name: 'repo-1', full_name: 'owner/repo-1' } as never],
      searchResults: [],
    });
    mocks.authenticateWithGitHub.mockResolvedValue(userB);

    // 模拟 park 之后写入新账号失败：首次 setUser 抛错，恢复回放时放行
    const realSetUser = useAppStore.getState().setUser;
    let setUserCalls = 0;
    try {
      useAppStore.setState({
        setUser: (u: Parameters<typeof realSetUser>[0]) => {
          setUserCalls += 1;
          if (setUserCalls === 1) throw new Error('simulated-write-failure');
          realSetUser(u);
        },
      });

      const { result } = renderHook(() => useAccountSwitchActions());
      let outcome;
      await act(async () => {
        outcome = await result.current.addAccountWithToken('ghp_b');
      });

      expect(outcome).toEqual({ ok: false, error: 'simulated-write-failure' });
      const state = useAppStore.getState();
      // 与 addAccountFromBackend 对称：原账号登录态、工作区与凭证原样恢复
      expect(state.user?.login).toBe('alice');
      expect(state.isAuthenticated).toBe(true);
      expect(state.githubToken).toBe('ghp_a');
      expect(state.repositories[0]?.id).toBe(1);
      expect(state.accountWorkspaces['1']?.repositories[0]?.id).toBe(1);
      // 新账号未被登记（半途失败不得留下半份凭证）
      expect(state.savedAccounts['2']).toBeUndefined();
    } finally {
      useAppStore.setState({ setUser: realSetUser });
    }
  });

  it('removes a non-active saved account and keeps its workspace data', async () => {
    useAppStore.setState({
      user: userA,
      githubToken: 'ghp_a',
      isAuthenticated: true,
      savedAccounts: {
        '1': { accountId: '1', user: userA, githubToken: 'ghp_a', addedAt: 't', lastUsedAt: 't' },
        '2': { accountId: '2', user: userB, githubToken: 'ghp_b', addedAt: 't', lastUsedAt: 't' },
      },
      accountWorkspaces: { '2': workspaceOf(2) },
    });

    const { result } = renderHook(() => useAccountSwitchActions());
    await act(async () => {
      await result.current.removeAccount('2');
    });

    const state = useAppStore.getState();
    expect(state.savedAccounts['2']).toBeUndefined();
    expect(state.accountWorkspaces['2']?.repositories[0]?.id).toBe(2);
    expect(state.user?.login).toBe('alice');
  });

  it('logs out after flushing pending sync without clearing savedAccounts', async () => {
    useAppStore.setState({
      user: userA,
      githubToken: 'ghp_a',
      isAuthenticated: true,
      savedAccounts: { '1': { accountId: '1', user: userA, githubToken: 'ghp_a', addedAt: 't', lastUsedAt: 't' } },
      repositories: [{ id: 1, name: 'repo-1', full_name: 'owner/repo-1' } as never],
    });

    const { result } = renderHook(() => useAccountSwitchActions());
    await act(async () => {
      await result.current.logoutCurrentAccount();
    });

    expect(mocks.prepareForAccountSwitch).toHaveBeenCalledWith('1');
    const state = useAppStore.getState();
    expect(state.user).toBeNull();
    expect(state.isAuthenticated).toBe(false);
    expect(state.accountWorkspaces['1']?.repositories[0]?.id).toBe(1);
    // 登出清除当前账号已保存的 PAT（登录页不能凭旧记录直接恢复会话），
    // 但账号资料与工作区保留
    expect(state.savedAccounts['1']?.githubToken).toBe('');
    expect(state.savedAccounts['1']?.user.login).toBe(userA.login);
  });

  it('restores the parked account when a backend account restore fails', async () => {
    useAppStore.setState({
      user: userA,
      githubToken: 'ghp_a',
      isAuthenticated: true,
      savedAccounts: { '1': { accountId: '1', user: userA, githubToken: 'ghp_a', addedAt: 't', lastUsedAt: 't' } },
      repositories: [{ id: 1, name: 'repo-1', full_name: 'owner/repo-1' } as never],
    });
    mocks.restoreBackendSession.mockResolvedValue({ status: 'unauthorized' });

    const { result } = renderHook(() => useAccountSwitchActions());
    let outcome;
    await act(async () => {
      outcome = await result.current.addAccountFromBackend('https://backend.example', 'secret');
    });

    expect(outcome).toEqual({ ok: false, error: 'unauthorized' });
    // 失败恢复：账号 A 保持登录态且数据完好
    const state = useAppStore.getState();
    expect(state.user?.login).toBe('alice');
    expect(state.repositories[0]?.id).toBe(1);
    expect(state.isAuthenticated).toBe(true);
  });
});

/**
 * 审计修复回归（PR #612 分区 B）：
 * - 全局共享切换锁（Header 与 AddAccountModal 各自的 Hook 实例必须互斥）；
 * - addAccountWithToken 在身份校验等待期间保持锁（取消/重复提交不可绕过）；
 * - addAccountFromBackend 先写候选 API Key 再恢复，失败恢复原密钥；
 * - addAccountFromBackend 登记后端返回的全部有效账号；
 * - removeAccount 对当前账号也先冲刷；
 * - 同账号破损会话（user 保留但凭证丢失/未认证）经 switchToAccount 恢复登录态。
 */
describe('useAccountSwitchActions audit fixes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPendingBackendCredentialAlignForTest();
    mocks.backend.isAvailable = false;
    mocks.backend.backendUrl = null;
    mocks.syncFromBackend.mockResolvedValue(undefined);
    mocks.prepareForAccountSwitch.mockResolvedValue(undefined);
    mocks.syncToBackend.mockResolvedValue(true);
    useAppStore.setState({
      user: null,
      githubToken: null,
      isAuthenticated: false,
      accountWorkspaces: {},
      savedAccounts: {},
      repositories: [],
      searchResults: [],
    });
  });

  it('serializes concurrent flows through the module-level shared lock across hook instances', async () => {
    useAppStore.setState({
      user: userA,
      githubToken: 'ghp_a',
      isAuthenticated: true,
      savedAccounts: {
        '1': { accountId: '1', user: userA, githubToken: 'ghp_a', addedAt: 't', lastUsedAt: 't' },
        '2': { accountId: '2', user: userB, githubToken: 'ghp_b', addedAt: 't', lastUsedAt: 't' },
      },
    });
    // 切换流程停在前置冲刷窗口：锁保持占用，验证期间不释放
    let releasePrepare: (value: void | PromiseLike<void>) => void = () => undefined;
    mocks.prepareForAccountSwitch.mockImplementation(
      () => new Promise((resolve) => { releasePrepare = resolve; }),
    );

    const first = renderHook(() => useAccountSwitchActions());
    const second = renderHook(() => useAccountSwitchActions());
    const pendingSwitch = first.result.current.switchToAccount('2');
    // R12（finding 17）：断言失败也必须放行挂起的生产流程，否则模块级切换锁
    // 不会释放，后续用例会以 switch-in-progress 失败。
    try {
      await act(async () => { await Promise.resolve(); });
      expect(mocks.authenticateWithGitHub).not.toHaveBeenCalled();

      // 另一 Hook 实例（模拟 AddAccountModal）的添加流程被共享锁拒绝
      let secondOutcome;
      await act(async () => {
        secondOutcome = await second.result.current.addAccountWithToken('ghp_c');
      });
      expect(secondOutcome).toEqual({ ok: false, error: 'switch-in-progress' });
    } finally {
      await act(async () => {
        releasePrepare();
        await pendingSwitch;
      });
    }
    expect(useAppStore.getState().user?.login).toBe('bob');
    // 流程结束后锁必须释放：其他实例可以立即启动下一个流程
    mocks.prepareForAccountSwitch.mockResolvedValue(undefined);
    let afterRelease;
    await act(async () => {
      afterRelease = await second.result.current.switchToAccount('1');
    });
    expect(afterRelease).toEqual({ ok: true });
  });

  it('holds the switch lock across the GitHub token verification window', async () => {
    useAppStore.setState({
      user: userA,
      githubToken: 'ghp_a',
      isAuthenticated: true,
      savedAccounts: { '1': { accountId: '1', user: userA, githubToken: 'ghp_a', addedAt: 't', lastUsedAt: 't' } },
    });
    let releaseAuth: (value: typeof userB | PromiseLike<typeof userB>) => void = () => undefined;
    mocks.authenticateWithGitHub.mockImplementation(
      () => new Promise((resolve) => { releaseAuth = resolve; }),
    );

    const { result } = renderHook(() => useAccountSwitchActions());
    const pending = result.current.addAccountWithToken('ghp_b');
    // R12（finding 17）：断言失败也必须放行挂起的校验流程（释放共享锁）
    try {
      await act(async () => { await Promise.resolve(); });
      // 校验等待期间：忙碌状态置位，重复提交被拒绝，账号 A 未被归档
      expect(result.current.isSwitching).toBe(true);
      let repeatOutcome;
      await act(async () => {
        repeatOutcome = await result.current.addAccountWithToken('ghp_b');
      });
      expect(repeatOutcome).toEqual({ ok: false, error: 'switch-in-progress' });
      expect(useAppStore.getState().user?.login).toBe('alice');
    } finally {
      await act(async () => {
        releaseAuth(userB);
        await pending;
      });
    }
    expect(useAppStore.getState().user?.login).toBe('bob');
    expect(result.current.isSwitching).toBe(false);
  });

  it('releases the lock when the token verification fails', async () => {
    mocks.authenticateWithGitHub.mockRejectedValueOnce(new Error('Bad credentials'));
    // 重试返回缺少数值 id 的身份 → invalid-github-user（证明锁已释放、流程可重入）
    mocks.authenticateWithGitHub.mockResolvedValueOnce({ login: 'ghost' } as GitHubUser);

    const { result } = renderHook(() => useAccountSwitchActions());
    let outcome;
    await act(async () => {
      outcome = await result.current.addAccountWithToken('ghp_bad');
    });
    expect(outcome).toEqual({ ok: false, error: 'Bad credentials' });
    expect(result.current.isSwitching).toBe(false);

    let retry;
    await act(async () => {
      retry = await result.current.addAccountWithToken('ghp_b');
    });
    expect(retry).toEqual({ ok: false, error: 'invalid-github-user' });
  });

  it('passes the candidate API secret via restore options and restores the previous secret on failure', async () => {
    useAppStore.setState({
      user: userA,
      githubToken: 'ghp_a',
      isAuthenticated: true,
      savedAccounts: { '1': { accountId: '1', user: userA, githubToken: 'ghp_a', addedAt: 't', lastUsedAt: 't' } },
    });
    useAppStore.getState().setBackendApiSecret('old-key');
    const secretsSeenDuringRestore: Array<string | null> = [];
    const optionsSeen: Array<{ omitAccountHeader?: boolean; apiSecret?: string } | undefined> = [];
    mocks.restoreBackendSession.mockImplementation(async (_url: string, options?: { omitAccountHeader?: boolean; apiSecret?: string }) => {
      optionsSeen.push(options);
      // 审计修复（C64）：候选 URL 提交前 Store 仍是原密钥——候选密钥经
      // apiSecret 选项传递，由 restoreBackendSession 在 URL 提交后写入。
      secretsSeenDuringRestore.push(useAppStore.getState().backendApiSecret);
      // CodeRabbit 审计修复：模拟真实 restoreBackendSession 的行为——候选 URL
      // 提交后把候选密钥写入 Store（失败分支会保留候选密钥，靠调用方回滚还原）。
      // 不写入的话，即使删掉生产代码的密钥回滚，末尾的 old-key 断言仍会通过。
      useAppStore.getState().setBackendApiSecret(options?.apiSecret ?? 'candidate-key');
      return { status: 'unauthorized' };
    });

    const { result } = renderHook(() => useAccountSwitchActions());
    let outcome;
    await act(async () => {
      outcome = await result.current.addAccountFromBackend('https://backend.example', 'candidate-key');
    });

    expect(outcome).toEqual({ ok: false, error: 'unauthorized' });
    // 候选密钥经 apiSecret 选项显式传递；调用时刻 Store 仍是原密钥
    expect(optionsSeen[0]?.apiSecret).toBe('candidate-key');
    expect(secretsSeenDuringRestore).toEqual(['old-key']);
    // 失败后原密钥恢复（当前账号仍登录也必须恢复）
    expect(useAppStore.getState().backendApiSecret).toBe('old-key');
    expect(useAppStore.getState().user?.login).toBe('alice');
  });

  it('restores the previous backend URL together with the secret when the candidate keeps its URL', async () => {
    useAppStore.setState({
      user: userA,
      githubToken: 'ghp_a',
      isAuthenticated: true,
      savedAccounts: { '1': { accountId: '1', user: userA, githubToken: 'ghp_a', addedAt: 't', lastUsedAt: 't' } },
    });
    useAppStore.getState().setBackendApiSecret('old-key');
    // 原连接：URL X + 密钥 Kx；候选后端 restoreBackendSession 提交了 Y 的 URL
    //（restored-token-invalid / github-token-required 分支会保留候选 URL）
    mocks.backend.backendUrl = 'https://old.example/api';
    // 审计修复（C65a）：成功的 init 桩把目标 URL 写回连接状态，回滚后的
    // 最终 URL 才能与旧密钥配对断言。
    mocks.backend.init.mockImplementation(async (url?: string) => {
      mocks.backend.backendUrl = url ?? null;
    });
    mocks.restoreBackendSession.mockImplementation(async () => {
      mocks.backend.backendUrl = 'https://candidate.example/api';
      return { status: 'github-token-required' };
    });

    const { result } = renderHook(() => useAccountSwitchActions());
    let outcome;
    await act(async () => {
      outcome = await result.current.addAccountFromBackend('https://candidate.example', 'candidate-key');
    });

    expect(outcome).toEqual({ ok: false, error: 'github-token-required' });
    // 审计修复：失败路径必须同时恢复原 URL 与原密钥——只恢复密钥会让原账号
    // 拿着原密钥请求候选后端 Y，原连接无法继续工作
    expect(useAppStore.getState().backendApiSecret).toBe('old-key');
    expect(mocks.backend.init).toHaveBeenCalledTimes(1);
    expect(mocks.backend.init).toHaveBeenCalledWith('https://old.example/api');
    // 最终 URL 与旧密钥配对：连接回到 X，密钥回到 Kx
    expect(mocks.backend.backendUrl).toBe('https://old.example/api');
    expect(useAppStore.getState().backendApiSecret).toBe('old-key');
  });

  it('buffers edits made during the restore window and re-pushes them after a failed restore', async () => {
    useAppStore.setState({
      user: userA,
      githubToken: 'ghp_a',
      isAuthenticated: true,
      savedAccounts: { '1': { accountId: '1', user: userA, githubToken: 'ghp_a', addedAt: 't', lastUsedAt: 't' } },
    });
    mocks.backend.isAvailable = true;
    mocks.backend.backendUrl = 'https://old.example/api';
    mocks.backend.init.mockImplementation(async (url?: string) => {
      mocks.backend.backendUrl = url ?? null;
      mocks.backend.isAvailable = true;
    });
    const pushes: Array<{ login: string | null; url: string | null }> = [];
    mocks.syncToBackend.mockImplementation(async () => {
      pushes.push({
        login: useAppStore.getState().user?.login ?? null,
        url: mocks.backend.backendUrl,
      });
      return true;
    });
    mocks.restoreBackendSession.mockImplementation(async () => {
      // 模拟 backend.init 已将活跃 URL 从 X 切到候选后端 Y 后、身份验证等待期间的用户编辑
      //（categoryOrder 是订阅器跟踪的字段；此时旧账号尚未归档）
      mocks.backend.backendUrl = 'https://candidate.example/api';
      useAppStore.setState({ categoryOrder: ['reordered-during-restore'] });
      return { status: 'github-token-required' };
    });

    const unsubscribe = startAutoSync();
    try {
      const { result } = renderHook(() => useAccountSwitchActions());
      let outcome;
      await act(async () => {
        outcome = await result.current.addAccountFromBackend('https://candidate.example', 'candidate-key');
      });

      expect(outcome).toEqual({ ok: false, error: 'github-token-required' });
      // R4 审计修复：窗口内编辑被缓冲，绝不推给候选后端（守卫退出零推送）；
      // 连接复原到原后端 X 后按发起账号 A 立即补推一次
      expect(mocks.syncToBackend).toHaveBeenCalledTimes(1);
      expect(pushes[0]).toEqual({ login: 'alice', url: 'https://old.example/api' });
      expect(mocks.backend.backendUrl).toBe('https://old.example/api');
      expect(mocks.backend.syncSettings).not.toHaveBeenCalled();
      // 账号级待推标记保留：本次补推失败时，下次进入该账号仍先补推再拉取
      expect(hasPendingAccountSync('1')).toBe(true);
      // 失败恢复：账号 A 保持登录态且数据完好（含窗口内编辑）
      expect(useAppStore.getState().user?.login).toBe('alice');
      expect(useAppStore.getState().categoryOrder).toEqual(['reordered-during-restore']);
      // R4 审计修复（候选后端恢复）：恢复请求绝不携带本机旧账号头；
      // C64：候选密钥经 apiSecret 选项在 URL 提交后才可见
      expect(mocks.restoreBackendSession).toHaveBeenCalledWith('https://candidate.example', { omitAccountHeader: true, apiSecret: 'candidate-key' });
    } finally {
      stopAutoSync(unsubscribe);
    }
  });

  it('keeps the buffered-edit marker bound to the origin backend while staying on the candidate (C65b-1)', async () => {
    // 审计修复（C65b-1，跨后端归属）：原后端 X 进入冻结窗口 → 候选后端 Y
    // 提交恢复。窗口内编辑按 (A, X) 真实登记——停留在 Y 上不可见也绝不
    // 消费 X 记录；连接回到 X 后记录重新可见。
    useAppStore.setState({
      user: userA,
      githubToken: 'ghp_a',
      isAuthenticated: true,
      savedAccounts: {
        '1': { accountId: '1', user: userA, githubToken: 'ghp_a', addedAt: 't', lastUsedAt: 't' },
        '2': { accountId: '2', user: userB, githubToken: 'ghp_b', addedAt: 't', lastUsedAt: 't' },
      },
      accountWorkspaces: { '2': workspaceOf(2) },
    });
    mocks.backend.isAvailable = true;
    mocks.backend.backendUrl = 'https://origin.example/api';
    // R13 审计修复（CodeRabbit）：写入归属必须在真实后端写入边界验证——
    // mocks.syncToBackend 只替换 autoSync 对外导出的函数，模块内部绑定的
    // 守卫冲刷/重试仍调用真实实现，仅断言导出调用次数发现不了窗口内推送。
    // 在每个写入分片方法上记录发起时的后端 URL 与载荷键。
    const backendWrites: Array<{ method: string; url: string | null; payloadKeys: string[]; payload: unknown }> = [];
    for (const method of [
      'syncRepositories',
      'syncReleases',
      'syncAIConfigs',
      'syncWebDAVConfigs',
      'syncEmbeddingConfigs',
      'syncVectorSearchConfig',
      'syncSettings',
    ] as const) {
      (mocks.backend[method] as ReturnType<typeof vi.fn>).mockImplementation(async (payload?: unknown) => {
        backendWrites.push({
          method,
          url: mocks.backend.backendUrl,
          payloadKeys: payload && typeof payload === 'object' ? Object.keys(payload) : [],
          payload,
        });
        return undefined;
      });
    }
    mocks.restoreBackendSession.mockImplementation(async () => {
      // 候选后端 Y 提交 URL 后，恢复等待期间的真实编辑（归属发起账号 A）
      mocks.backend.backendUrl = 'https://candidate.example/api';
      useAppStore.setState({ categoryOrder: ['edited-during-restore'] });
      return { status: 'connected', githubToken: 'ghp_b', user: userB, accounts: [] };
    });

    const unsubscribe = startAutoSync();
    try {
      const { result } = renderHook(() => useAccountSwitchActions());
      let outcome;
      await act(async () => {
        outcome = await result.current.addAccountFromBackend('https://candidate.example', 'candidate-key');
      });

      expect(outcome).toEqual({ ok: true, user: userB });
      expect(useAppStore.getState().user?.login).toBe('bob');
      // 候选后端零推送：窗口内编辑绝不外发（整个恢复流程 syncToBackend 未被调用）
      expect(mocks.syncToBackend).not.toHaveBeenCalled();
      // 写入边界复核：数据分片在候选 URL 上零写入；syncSettings 在候选 URL 上
      // 恰好写入一次且仅允许恢复提交后的 B 账号凭据对齐载荷（github_token/
      // active_account_id/user_profile），绝不含窗口内 A 的设置编辑
      //（categoryOrder）——键名不变而值串号（如 A 的 github_token /
      // active_account_id 写到候选后端）的回归同样会被捕获。
      expect(backendWrites.filter((write) => write.method !== 'syncSettings' && write.url === 'https://candidate.example/api')).toEqual([]);
      const candidateCredentialWrites = backendWrites.filter((candidate) => candidate.method === 'syncSettings' && candidate.url === 'https://candidate.example/api');
      expect(candidateCredentialWrites).toHaveLength(1);
      for (const write of candidateCredentialWrites) {
        expect(write.payloadKeys).not.toContain('categoryOrder');
        expect(write.payload).toMatchObject({
          github_token: 'ghp_b',
          active_account_id: '2',
          user_profile: userB,
        });
      }
      // 待推记录按原后端 X 登记：停留在候选后端 Y 上不可见、未被消费
      expect(hasPendingAccountSync('1')).toBe(false);
      expect(hasPendingAccountSync('2')).toBe(false);
      // 连接回到 X：记录重新可见（切回 A 时先补推再拉取）
      mocks.backend.backendUrl = 'https://origin.example/api';
      expect(hasPendingAccountSync('1')).toBe(true);
    } finally {
      stopAutoSync(unsubscribe);
    }
  });

  it('pushes the buffered edits before the pull when switching back on the same backend (C65b-2)', async () => {
    // 审计修复（C65b-2，同后端先推后拉顺序）：恢复成功后切回账号 A——
    // 先补推（A 的上下文）再拉取，顺序绝不能颠倒。
    useAppStore.setState({
      user: userA,
      githubToken: 'ghp_a',
      isAuthenticated: true,
      savedAccounts: {
        '1': { accountId: '1', user: userA, githubToken: 'ghp_a', addedAt: 't', lastUsedAt: 't' },
        '2': { accountId: '2', user: userB, githubToken: 'ghp_b', addedAt: 't', lastUsedAt: 't' },
      },
      accountWorkspaces: { '2': workspaceOf(2) },
    });
    mocks.backend.isAvailable = true;
    const pushesAtSync: Array<{ login: string | null; categoryOrder: string[] }> = [];
    // CodeRabbit 审计修复：让补推返回可手动完成的 Promise——invocationCallOrder
    // 只比较调用「开始」顺序，实现若启动补推后不等待结果就直接拉取，旧断言
    // 仍会通过。补推未完成时拉取必须尚未发起。
    let releasePush: (() => void) | null = null;
    mocks.syncToBackend.mockImplementation(() => new Promise<boolean>((resolve) => {
      const s = useAppStore.getState();
      pushesAtSync.push({
        login: s.user?.login ?? null,
        categoryOrder: [...s.categoryOrder],
      });
      releasePush = () => resolve(true);
    }));
    mocks.restoreBackendSession.mockImplementation(async () => {
      // 恢复等待期间的真实编辑（尚未归档，归属发起账号 A）
      useAppStore.setState({ categoryOrder: ['edited-during-restore'] });
      return { status: 'connected', githubToken: 'ghp_b', user: userB, accounts: [] };
    });

    const unsubscribe = startAutoSync();
    try {
      const { result } = renderHook(() => useAccountSwitchActions());
      let outcome;
      await act(async () => {
        outcome = await result.current.addAccountFromBackend('https://candidate.example', 'candidate-key');
      });

      expect(outcome).toEqual({ ok: true, user: userB });
      expect(useAppStore.getState().user?.login).toBe('bob');
      // 候选后端零推送；编辑归属发起账号 A（真实待推记录）
      expect(mocks.syncToBackend).not.toHaveBeenCalled();
      expect(hasPendingAccountSync('1')).toBe(true);
      expect(hasPendingAccountSync('2')).toBe(false);
      // 恢复阶段的对齐本身会拉取一次；切换阶段的新增拉取在补推完成前必须为 0
      const pullsAfterRestore = mocks.syncFromBackend.mock.calls.length;

      // 切回账号 A（同一后端）：真实待推记录驱动先补推再拉取
      let pendingSwitch!: Promise<{ ok: boolean; error?: string }>;
      await act(async () => {
        pendingSwitch = result.current.switchToAccount('1');
      });
      // R12（finding 17）：断言失败也必须放行挂起的补推（释放共享锁）
      try {
        await act(async () => { await Promise.resolve(); });
        // 补推已启动（归属发起账号 A）；补推完成前拉取绝不能开始
        expect(mocks.syncToBackend).toHaveBeenCalledTimes(1);
        expect(pushesAtSync[0]?.login).toBe('alice');
        expect(pushesAtSync[0]?.categoryOrder).toContain('edited-during-restore');
        expect(mocks.syncFromBackend).toHaveBeenCalledTimes(pullsAfterRestore);
      } finally {
        // 补推完成后：当前切换阶段恰好发起一次拉取
        await act(async () => {
          releasePush?.();
          await pendingSwitch;
        });
      }
      expect(mocks.syncFromBackend).toHaveBeenCalledTimes(pullsAfterRestore + 1);
    } finally {
      stopAutoSync(unsubscribe);
    }
  });

  it('aligns the backend for the auto-selected fallback account after removing the current account', async () => {
    useAppStore.setState({
      user: userA,
      githubToken: 'ghp_a',
      isAuthenticated: true,
      savedAccounts: {
        '1': { accountId: '1', user: userA, githubToken: 'ghp_a', addedAt: 't', lastUsedAt: 't' },
        '2': { accountId: '2', user: userB, githubToken: 'ghp_b', addedAt: 't', lastUsedAt: 't' },
      },
      accountWorkspaces: { '2': workspaceOf(2) },
    });
    mocks.backend.isAvailable = true;

    const { result } = renderHook(() => useAccountSwitchActions());
    await act(async () => {
      await result.current.removeAccount('1');
    });

    expect(useAppStore.getState().user?.login).toBe('bob');
    // 审计修复：备选账号的 Token 可能仅保存在本机——删除后自动切换到它时
    // 必须执行与正常切换相同的后端对齐（凭据对齐 + 先补推再拉取）
    expect(mocks.backend.syncSettings).toHaveBeenCalledWith({
      github_token: 'ghp_b',
      active_account_id: '2',
      user_profile: userB,
    });
    expect(mocks.syncFromBackend).toHaveBeenCalledWith({ force: false });
    expect(mocks.refreshMcpElectronBridge).toHaveBeenCalled();
  });

  it('registers every valid backend account after a successful backend restore', async () => {
    useAppStore.setState({
      user: userA,
      githubToken: 'ghp_a',
      isAuthenticated: true,
      savedAccounts: { '1': { accountId: '1', user: userA, githubToken: 'ghp_a', addedAt: 't0', lastUsedAt: 't' } },
    });
    const userC = { id: 3, login: 'carol', name: 'Carol', avatar_url: 'https://x/c.png', email: null };
    mocks.restoreBackendSession.mockResolvedValue({
      status: 'connected',
      githubToken: 'ghp_b',
      user: userB,
      accounts: [
        { accountId: '1', user: userA, githubToken: 'tok-a-valid' },
        { accountId: '3', user: userC, githubToken: 'tok-c' },
        // 无效条目：Token 为空 / user 缺 login / 结构错误
        { accountId: '4', user: userB, githubToken: '' },
        { accountId: '5', user: { id: 5 }, githubToken: 'tok-5' },
        null,
      ],
    });

    const { result } = renderHook(() => useAccountSwitchActions());
    let outcome;
    await act(async () => {
      outcome = await result.current.addAccountFromBackend('https://backend.example', 'candidate-key');
    });

    expect(outcome).toEqual({ ok: true, user: userB });
    const state = useAppStore.getState();
    expect(state.user?.login).toBe('bob');
    expect(state.backendApiSecret).toBe('candidate-key');
    // 全部有效账号已登记，无效条目被过滤
    expect(state.savedAccounts['1']?.githubToken).toBe('tok-a-valid');
    expect(state.savedAccounts['3']?.githubToken).toBe('tok-c');
    expect(state.savedAccounts['4']).toBeUndefined();
    expect(state.savedAccounts['5']).toBeUndefined();
  });

  it('reports backend-credential-sync-failed from account restore while keeping the committed local account', async () => {
    // 审计修复（CodeRabbit）：本地恢复提交与后端凭据对齐是两件事——对齐失败
    // 必须返回 backend-credential-sync-failed，但不得触发 finally 的完整回滚
    //（已验证的本地账号与待对齐标记保留）。
    useAppStore.setState({
      user: userA,
      githubToken: 'ghp_a',
      isAuthenticated: true,
      savedAccounts: { '1': { accountId: '1', user: userA, githubToken: 'ghp_a', addedAt: 't0', lastUsedAt: 't' } },
    });
    mocks.backend.isAvailable = true;
    // Once 变体：beforeEach 仅 clearAllMocks（不清实现），持久实现会泄漏给后续用例
    mocks.backend.syncSettings.mockRejectedValueOnce(new Error('sync failed'));
    mocks.restoreBackendSession.mockResolvedValue({
      status: 'connected',
      githubToken: 'ghp_b',
      user: userB,
      accounts: [{ accountId: '2', user: userB, githubToken: 'ghp_b' }],
    });

    const { result } = renderHook(() => useAccountSwitchActions());
    let outcome;
    await act(async () => {
      outcome = await result.current.addAccountFromBackend('https://backend.example', 'candidate-key');
    });

    expect(outcome).toEqual({ ok: false, error: 'backend-credential-sync-failed' });
    const state = useAppStore.getState();
    // 本地账号已提交，未回滚
    expect(state.user?.login).toBe('bob');
    expect(state.githubToken).toBe('ghp_b');
    expect(state.savedAccounts['2']?.githubToken).toBe('ghp_b');
  });

  it('treats token_update_skipped/superseded syncSettings responses as misaligned credentials', async () => {
    // 转交 1（server/src/routes/configs.ts 契约）：syncSettings 在 PAT 校验超时
    // 或凭据被并发请求覆盖时仍返回 200——响应携带 tokenUpdateSkipped /
    // tokenUpdateSuperseded 时必须视为凭据未对齐，与对齐失败同一处理。
    useAppStore.setState({
      user: userA,
      githubToken: 'ghp_a',
      isAuthenticated: true,
      savedAccounts: { '1': { accountId: '1', user: userA, githubToken: 'ghp_a', addedAt: 't0', lastUsedAt: 't' } },
    });
    mocks.backend.isAvailable = true;
    mocks.backend.syncSettings.mockResolvedValueOnce({ tokenUpdateSkipped: true, tokenUpdateSuperseded: false });
    mocks.restoreBackendSession.mockResolvedValue({
      status: 'connected',
      githubToken: 'ghp_b',
      user: userB,
      accounts: [{ accountId: '2', user: userB, githubToken: 'ghp_b' }],
    });

    const { result } = renderHook(() => useAccountSwitchActions());
    let outcome;
    await act(async () => {
      outcome = await result.current.addAccountFromBackend('https://backend.example', 'candidate-key');
    });

    expect(outcome).toEqual({ ok: false, error: 'backend-credential-sync-failed' });
    expect(useAppStore.getState().user?.login).toBe('bob');
  });

  it('treats active_account_update_skipped as an incomplete switch and allows retry (R12 ISSUE-1)', async () => {
    // 服务端契约：PAT 校验等待期间另一设备的切换抢先时返回
    // active_account_update_skipped。本地已切到目标账号，但后端活跃账号仍指向
    // 其他账号——必须返回失败（不报告成功）并登记待对齐标记；同账号重试不得
    // 被早退短路，重试成功后清除标记。
    useAppStore.setState({
      user: userA,
      githubToken: 'ghp_a',
      isAuthenticated: true,
      savedAccounts: {
        '1': { accountId: '1', user: userA, githubToken: 'ghp_a', addedAt: 't0', lastUsedAt: 't' },
        '2': { accountId: '2', user: userB, githubToken: 'ghp_b', addedAt: 't0', lastUsedAt: 't' },
      },
      accountWorkspaces: { '2': workspaceOf(2) },
      repositories: [],
      searchResults: [],
    });
    mocks.backend.isAvailable = true;
    mocks.backend.syncSettings.mockResolvedValueOnce({
      tokenUpdateSkipped: false,
      tokenUpdateSuperseded: false,
      activeAccountUpdateSkipped: true,
    });

    const { result } = renderHook(() => useAccountSwitchActions());
    let outcome;
    await act(async () => {
      outcome = await result.current.switchToAccount('2');
    });

    expect(outcome).toEqual({ ok: false, error: 'backend-credential-sync-failed' });
    // 本地切换已提交，但后端对齐未完成 → 待对齐标记允许用户重试
    expect(useAppStore.getState().user?.login).toBe('bob');
    expect(hasPendingBackendCredentialAlign('2')).toBe(true);

    // 重试：待对齐标记使同账号早退失效，再次执行后端对齐并清除标记
    mocks.backend.syncSettings.mockResolvedValueOnce({
      tokenUpdateSkipped: false,
      tokenUpdateSuperseded: false,
      activeAccountUpdateSkipped: false,
    });
    await act(async () => {
      outcome = await result.current.switchToAccount('2');
    });
    expect(outcome).toEqual({ ok: true });
    expect(hasPendingBackendCredentialAlign('2')).toBe(false);
  });

  it('notifies subscribers when the pending credential align marker changes (R13 finding 84)', async () => {
    // 待对齐标记是模块级集合而非 React 状态：写入必须触发订阅通知（版本计数
    // 递增），Header 经 useSyncExternalStore 订阅后才能及时渲染重试入口。
    useAppStore.setState({
      user: userA,
      githubToken: 'ghp_a',
      isAuthenticated: true,
      savedAccounts: {
        '1': { accountId: '1', user: userA, githubToken: 'ghp_a', addedAt: 't0', lastUsedAt: 't' },
        '2': { accountId: '2', user: userB, githubToken: 'ghp_b', addedAt: 't0', lastUsedAt: 't' },
      },
      accountWorkspaces: { '2': workspaceOf(2) },
      repositories: [],
      searchResults: [],
    });
    mocks.backend.isAvailable = true;
    mocks.backend.syncSettings.mockResolvedValueOnce({
      tokenUpdateSkipped: false,
      tokenUpdateSuperseded: false,
      activeAccountUpdateSkipped: true,
    });

    const versionBefore = getPendingBackendCredentialAlignVersion();
    let notified = 0;
    const unsubscribe = subscribePendingBackendCredentialAlign(() => {
      notified += 1;
    });

    const { result } = renderHook(() => useAccountSwitchActions());
    let outcome;
    await act(async () => {
      outcome = await result.current.switchToAccount('2');
    });

    // 对齐失败写入标记：版本递增且订阅者收到通知
    expect(outcome).toEqual({ ok: false, error: 'backend-credential-sync-failed' });
    expect(hasPendingBackendCredentialAlign('2')).toBe(true);
    expect(notified).toBe(1);
    expect(getPendingBackendCredentialAlignVersion()).toBe(versionBefore + 1);

    // 幂等重写（标记已存在）不抬版本：对齐再次失败时不再多通知
    mocks.backend.syncSettings.mockResolvedValueOnce({
      tokenUpdateSkipped: true,
      tokenUpdateSuperseded: false,
    });
    await act(async () => {
      outcome = await result.current.switchToAccount('2');
    });
    expect(outcome).toEqual({ ok: false, error: 'backend-credential-sync-failed' });
    expect(notified).toBe(1);
    expect(getPendingBackendCredentialAlignVersion()).toBe(versionBefore + 1);

    // 重试成功清除标记：版本再递增一次
    mocks.backend.syncSettings.mockResolvedValueOnce({
      tokenUpdateSkipped: false,
      tokenUpdateSuperseded: false,
      activeAccountUpdateSkipped: false,
    });
    await act(async () => {
      outcome = await result.current.switchToAccount('2');
    });
    expect(outcome).toEqual({ ok: true });
    expect(hasPendingBackendCredentialAlign('2')).toBe(false);
    expect(notified).toBe(2);
    expect(getPendingBackendCredentialAlignVersion()).toBe(versionBefore + 2);

    unsubscribe();
    // 退订后写入不再通知订阅者。制造一次真实写入：破坏当前令牌使同账号
    // 早退失效（快速路径要求令牌完好且无待对齐标记），重走完整对齐流程并
    // 让 syncSettings 的 Once 桩被消费（clearAllMocks 不清队列，未消费的
    // Once 会泄漏给后续用例）。
    useAppStore.setState({ githubToken: '' });
    mocks.backend.syncSettings.mockResolvedValueOnce({
      tokenUpdateSkipped: false,
      tokenUpdateSuperseded: false,
      activeAccountUpdateSkipped: true,
    });
    await act(async () => {
      outcome = await result.current.switchToAccount('2');
    });
    expect(hasPendingBackendCredentialAlign('2')).toBe(true);
    expect(notified).toBe(2);
  });

  it('directs the restore request at the expected account when re-authorizing (R13 finding 83)', async () => {
    // 候选后端保存多账号且无唯一活跃账号时，无目标恢复会返回
    // account-selection-required 而直接失败——补授权点名账号时恢复请求必须
    // 定向该账号（accountId 选项 → getBackendAuthHeaders(accountId) 显式请求头）。
    useAppStore.setState({
      user: null,
      githubToken: null,
      isAuthenticated: false,
      savedAccounts: { '2': { accountId: '2', user: userB, githubToken: '', addedAt: 't0', lastUsedAt: 't' } },
    });
    mocks.backend.isAvailable = true;
    mocks.restoreBackendSession.mockResolvedValue({
      status: 'connected',
      githubToken: 'ghp_b',
      user: userB,
      accounts: [],
    });

    const { result } = renderHook(() => useAccountSwitchActions());
    let outcome;
    await act(async () => {
      outcome = await result.current.addAccountFromBackend('https://backend.example', 'candidate-key', '2');
    });

    expect(mocks.restoreBackendSession).toHaveBeenCalledWith('https://backend.example', {
      omitAccountHeader: true,
      apiSecret: 'candidate-key',
      accountId: '2',
    });
    expect(outcome).toEqual({ ok: true, user: userB });
    expect(useAppStore.getState().user?.login).toBe('bob');
  });

  it('flushes the current account before removing it (even when target === current)', async () => {
    useAppStore.setState({
      user: userA,
      githubToken: 'ghp_a',
      isAuthenticated: true,
      savedAccounts: {
        '1': { accountId: '1', user: userA, githubToken: 'ghp_a', addedAt: 't', lastUsedAt: 't' },
        '2': { accountId: '2', user: userB, githubToken: 'ghp_b', addedAt: 't', lastUsedAt: 't' },
      },
    });

    const { result } = renderHook(() => useAccountSwitchActions());
    await act(async () => {
      await result.current.removeAccount('1');
    });

    // 移除当前账号也必须先冲刷（removeSavedAccount 内部会 switchAccount 取消防抖推送）
    expect(mocks.prepareForAccountSwitch).toHaveBeenCalledWith('1');
    expect(useAppStore.getState().user?.login).toBe('bob');
    expect(useAppStore.getState().savedAccounts['1']).toBeUndefined();
  });

  it('restores credentials and login state when switching to the same broken account', async () => {
    // 破损会话：水化后 user 保留但顶层 Token 丢失、未认证
    useAppStore.setState({
      user: userA,
      githubToken: null,
      isAuthenticated: false,
      savedAccounts: { '1': { accountId: '1', user: userA, githubToken: 'ghp_a', addedAt: 't', lastUsedAt: 't' } },
    });

    const { result } = renderHook(() => useAccountSwitchActions());
    let outcome;
    await act(async () => {
      outcome = await result.current.switchToAccount('1');
    });

    // 同账号破损会话不得空转返回：必须恢复凭证与登录态
    expect(outcome).toEqual({ ok: true });
    const state = useAppStore.getState();
    expect(state.githubToken).toBe('ghp_a');
    expect(state.isAuthenticated).toBe(true);
    expect(state.user?.login).toBe('alice');
  });

  it('pushes before pulling when the target account has a pending sync record', async () => {
    useAppStore.setState({
      user: userA,
      githubToken: 'ghp_a',
      isAuthenticated: true,
      savedAccounts: {
        '1': { accountId: '1', user: userA, githubToken: 'ghp_a', addedAt: 't', lastUsedAt: 't' },
        '2': { accountId: '2', user: userB, githubToken: 'ghp_b', addedAt: 't', lastUsedAt: 't' },
      },
      accountWorkspaces: { '2': workspaceOf(2) },
    });
    mocks.backend.isAvailable = true;
    // 切换前冲刷失败遗留的账号级待推状态：切回该账号时先补推再拉取
    mocks.hasPendingAccountSync.mockImplementation((accountId: string) => accountId === '2');
    const callOrder: string[] = [];
    mocks.syncToBackend.mockImplementation(async () => {
      callOrder.push('push');
      return true;
    });
    mocks.syncFromBackend.mockImplementation(async () => {
      callOrder.push('pull');
      return undefined;
    });

    const { result } = renderHook(() => useAccountSwitchActions());
    let outcome;
    await act(async () => {
      outcome = await result.current.switchToAccount('2');
    });

    expect(outcome).toEqual({ ok: true });
    expect(callOrder).toEqual(['push', 'pull']);
  });
});
