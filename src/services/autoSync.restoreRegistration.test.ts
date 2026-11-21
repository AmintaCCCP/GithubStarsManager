import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitHubUser } from '../types';

const mocks = vi.hoisted(() => ({
  restoreAuth: vi.fn(),
  getCurrentUser: vi.fn(),
  normalizeAccount: vi.fn(),
}));

vi.mock('./backendAdapter', () => ({
  backend: {
    isAvailable: true,
    backendUrl: 'http://origin',
    connectionGeneration: 1,
    restoreAuth: mocks.restoreAuth,
  },
  normalizeBackendRestoreAccount: mocks.normalizeAccount,
}));

vi.mock('./githubApiFactory', () => ({
  createGitHubApiService: () => ({ getCurrentUser: mocks.getCurrentUser }),
}));

// src/test/setup.ts replaces the store with a hook-level mock for component
// tests. The restore path writes real store state, so restore the actual store.
vi.mock('../store/useAppStore', async () => await vi.importActual('../store/useAppStore'));

const userA: GitHubUser = { id: 1, login: 'alice', name: 'Alice', avatar_url: 'https://x/a.png', email: null };
const userB: GitHubUser = { id: 2, login: 'bob', name: 'Bob', avatar_url: 'https://x/b.png', email: null };

describe('tryRestoreAuthFromBackend account registration (round-15 [11])', () => {
  let originalState: ReturnType<(typeof import('../store/useAppStore').useAppStore)['getState']>;

  beforeEach(async () => {
    const { useAppStore } = await import('../store/useAppStore');
    originalState = useAppStore.getState();
    useAppStore.setState({
      user: null,
      githubToken: null,
      isAuthenticated: false,
      backendApiSecret: 'secret',
      savedAccounts: {},
      repositories: [],
      releases: [],
    } as never);
    mocks.restoreAuth.mockReset();
    mocks.getCurrentUser.mockReset();
    mocks.normalizeAccount.mockReset();
  });

  afterEach(async () => {
    const { useAppStore } = await import('../store/useAppStore');
    useAppStore.setState(originalState as never);
    vi.resetModules();
  });

  it('skips accounts removed while the identity lookup was in flight', async () => {
    const { useAppStore } = await import('../store/useAppStore');
    const { registerRemovedSavedAccount, isSavedAccountRemovedInSession } =
      await import('../store/helpers/accountWorkspace');
    const { tryRestoreAuthFromBackend } = await import('./autoSync');

    mocks.restoreAuth.mockResolvedValue({
      github_token: 'ghp_restored',
      accounts: [
        { account_id: '1', user: userA, github_token: 'ghp_a' },
        { account_id: '2', user: userB, github_token: 'ghp_b' },
      ],
    });
    mocks.getCurrentUser.mockResolvedValue(userA);
    mocks.normalizeAccount.mockImplementation(async (account: { account_id: string; user: GitHubUser; github_token: string }) => {
      // 模拟等待期间用户移除了账号 2（removeSavedAccount 非当前账号分支
      // 不推进会话代次，仅靠代次检查拦不住）。
      if (account.account_id === '2') registerRemovedSavedAccount('2');
      return { user: account.user, githubToken: account.github_token };
    });

    await expect(tryRestoreAuthFromBackend()).resolves.toBe(true);

    // 主账号照常登记，等待期间被移除的账号 2 绝不被写回
    expect(useAppStore.getState().savedAccounts['1']).toBeDefined();
    expect(useAppStore.getState().savedAccounts['2']).toBeUndefined();
    // 移除登记未被写回路径清除（用户重新添加才会撤销）
    expect(isSavedAccountRemovedInSession('2')).toBe(true);
  });

  it('registers every backend account when nothing was removed during the lookup', async () => {
    const { useAppStore } = await import('../store/useAppStore');
    const { tryRestoreAuthFromBackend } = await import('./autoSync');

    mocks.restoreAuth.mockResolvedValue({
      github_token: 'ghp_restored',
      accounts: [
        { account_id: '1', user: userA, github_token: 'ghp_a' },
        { account_id: '2', user: userB, github_token: 'ghp_b' },
      ],
    });
    mocks.getCurrentUser.mockResolvedValue(userA);
    mocks.normalizeAccount.mockImplementation(async (account: { user: GitHubUser; github_token: string }) => ({
      user: account.user,
      githubToken: account.github_token,
    }));

    await expect(tryRestoreAuthFromBackend()).resolves.toBe(true);

    expect(useAppStore.getState().savedAccounts['1']).toBeDefined();
    expect(useAppStore.getState().savedAccounts['2']).toBeDefined();
  });
});
