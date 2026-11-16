import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountWorkspace, Repository } from '../../../types';

const mocks = vi.hoisted(() => ({
  prepareForAccountSwitch: vi.fn(),
  syncFromBackend: vi.fn(),
  withAccountSwitchGuard: vi.fn(),
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
    // 透传执行被包裹的切换序列，并记录调用次数
    withAccountSwitchGuard: async (fn: () => Promise<unknown>) => {
      mocks.withAccountSwitchGuard();
      return fn();
    },
  };
});
vi.mock('../../../services/backendAdapter', () => ({ backend: mocks.backend }));
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
