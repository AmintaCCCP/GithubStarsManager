import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountWorkspace, Repository } from '../../../types';

const mocks = vi.hoisted(() => ({
  prepareForAccountSwitch: vi.fn(),
  syncFromBackend: vi.fn(),
  withAccountSwitchGuard: vi.fn(),
  consumePendingAccountSync: vi.fn(),
  syncToBackend: vi.fn(),
  backend: {
    isAvailable: true,
    syncSettings: vi.fn(),
  },
  restoreBackendSession: vi.fn(),
  authenticateWithGitHub: vi.fn(),
  refreshMcpElectronBridge: vi.fn(),
}));

vi.mock('../../../services/autoSync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/autoSync')>();
  return {
    ...actual,
    prepareForAccountSwitch: mocks.prepareForAccountSwitch,
    syncFromBackend: mocks.syncFromBackend,
    consumePendingAccountSync: mocks.consumePendingAccountSync,
    syncToBackend: mocks.syncToBackend,
    // 透传执行被包裹的切换序列，并记录调用次数
    withAccountSwitchGuard: async (fn: () => Promise<unknown>) => {
      mocks.withAccountSwitchGuard();
      return fn();
    },
  };
});
vi.mock('../../../services/backendAdapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/backendAdapter')>();
  return { ...actual, backend: mocks.backend };
});
vi.mock('../../../services/mcpElectronBridge', () => ({ refreshMcpElectronBridge: mocks.refreshMcpElectronBridge }));
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
import type { GitHubUser } from '../../../types';
import { useAccountSwitchActions } from './useAccountSwitchActions';

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
    mocks.backend.isAvailable = false;
    mocks.syncFromBackend.mockResolvedValue(undefined);
    mocks.prepareForAccountSwitch.mockResolvedValue(undefined);
    mocks.consumePendingAccountSync.mockReturnValue(false);
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

  it('updates only the token when re-adding the current account', async () => {
    useAppStore.setState({
      user: userA,
      githubToken: 'ghp_a',
      isAuthenticated: true,
      savedAccounts: { '1': { accountId: '1', user: userA, githubToken: 'ghp_a', addedAt: 't0', lastUsedAt: 't' } },
    });
    mocks.authenticateWithGitHub.mockResolvedValue(userA);

    const { result } = renderHook(() => useAccountSwitchActions());
    let outcome;
    await act(async () => {
      outcome = await result.current.addAccountWithToken('ghp_a2');
    });

    expect(outcome).toEqual({ ok: true, user: userA });
    expect(useAppStore.getState().githubToken).toBe('ghp_a2');
    expect(useAppStore.getState().savedAccounts['1']?.githubToken).toBe('ghp_a2');
    expect(useAppStore.getState().savedAccounts['1']?.addedAt).toBe('t0');
    // 同账号刷新：不触发归档与后端切换对齐
    expect(mocks.prepareForAccountSwitch).not.toHaveBeenCalled();
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
    // 登出保留已保存账号，供登录页一键恢复
    expect(state.savedAccounts['1']?.githubToken).toBe('ghp_a');
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
    mocks.backend.isAvailable = false;
    mocks.syncFromBackend.mockResolvedValue(undefined);
    mocks.prepareForAccountSwitch.mockResolvedValue(undefined);
    mocks.consumePendingAccountSync.mockReturnValue(false);
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
    await act(async () => { await Promise.resolve(); });
    expect(mocks.authenticateWithGitHub).not.toHaveBeenCalled();

    // 另一 Hook 实例（模拟 AddAccountModal）的添加流程被共享锁拒绝
    let secondOutcome;
    await act(async () => {
      secondOutcome = await second.result.current.addAccountWithToken('ghp_c');
    });
    expect(secondOutcome).toEqual({ ok: false, error: 'switch-in-progress' });

    await act(async () => {
      releasePrepare();
      await pendingSwitch;
    });
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
    await act(async () => { await Promise.resolve(); });
    // 校验等待期间：忙碌状态置位，重复提交被拒绝，账号 A 未被归档
    expect(result.current.isSwitching).toBe(true);
    let repeatOutcome;
    await act(async () => {
      repeatOutcome = await result.current.addAccountWithToken('ghp_b');
    });
    expect(repeatOutcome).toEqual({ ok: false, error: 'switch-in-progress' });
    expect(useAppStore.getState().user?.login).toBe('alice');

    await act(async () => {
      releaseAuth(userB);
      await pending;
    });
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

  it('writes the candidate API secret before restoring and restores the previous secret on failure', async () => {
    useAppStore.setState({
      user: userA,
      githubToken: 'ghp_a',
      isAuthenticated: true,
      savedAccounts: { '1': { accountId: '1', user: userA, githubToken: 'ghp_a', addedAt: 't', lastUsedAt: 't' } },
    });
    useAppStore.getState().setBackendApiSecret('old-key');
    const secretsSeenDuringRestore: Array<string | null> = [];
    mocks.restoreBackendSession.mockImplementation(async () => {
      secretsSeenDuringRestore.push(useAppStore.getState().backendApiSecret);
      return { status: 'unauthorized' };
    });

    const { result } = renderHook(() => useAccountSwitchActions());
    let outcome;
    await act(async () => {
      outcome = await result.current.addAccountFromBackend('https://backend.example', 'candidate-key');
    });

    expect(outcome).toEqual({ ok: false, error: 'unauthorized' });
    // 恢复/校验请求必须已携带候选密钥；失败后原密钥恢复（当前账号仍登录也必须恢复）
    expect(secretsSeenDuringRestore).toEqual(['candidate-key']);
    expect(useAppStore.getState().backendApiSecret).toBe('old-key');
    expect(useAppStore.getState().user?.login).toBe('alice');
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
    mocks.consumePendingAccountSync.mockImplementation((accountId: string) => accountId === '2');
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
