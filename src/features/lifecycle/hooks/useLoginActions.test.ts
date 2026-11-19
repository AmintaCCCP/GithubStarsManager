import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../../store/useAppStore';

const mocks = vi.hoisted(() => ({
  apiTokens: [] as string[],
  getCurrentUser: vi.fn(),
  syncFromBackend: vi.fn(),
  backend: {
    configuredUrl: 'https://backend.example/api',
    backendUrl: null as string | null,
    persistedUrl: null as string | null,
    init: vi.fn(),
    isAvailable: true,
    verifyAuth: vi.fn(),
    restoreAuth: vi.fn(),
    syncSettings: vi.fn(),
    rememberActiveUrl: vi.fn(),
    persistUrl: vi.fn(),
  },
}));

vi.mock('../../../services/githubApi', () => ({
  GITHUB_TOKEN_INVALID_ERROR: 'GitHub token expired or invalid',
  GitHubApiService: class {
    constructor(token: string) {
      mocks.apiTokens.push(token);
    }

    getCurrentUser() {
      return mocks.getCurrentUser();
    }
  },
}));
vi.mock('../../../services/backendAdapter', () => ({ backend: mocks.backend }));
vi.mock('../../../services/autoSync', () => ({
  syncFromBackend: mocks.syncFromBackend,
  withAccountSwitchFrozen: (fn: () => Promise<unknown>) => fn(),
}));

// 恢复真实 Store：全局 setup.ts 将 ../store/useAppStore mock 成选择器桩，
// 而 rollbackBackendConnection 的密钥成对恢复（R2-B11）需要驱动真实 Store。
vi.mock('../../../store/useAppStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../store/useAppStore')>();
  return actual;
});

import { useLoginActions } from './useLoginActions';

const user = { id: 1, login: 'octocat' };

describe('useLoginActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiTokens.splice(0);
    mocks.backend.isAvailable = true;
    mocks.backend.backendUrl = null;
    mocks.backend.persistedUrl = null;
    // 模拟真实适配器语义：init 成功提交后活跃 URL 随之切换。
    mocks.backend.init.mockImplementation(async (url?: string) => {
      mocks.backend.backendUrl = url ?? null;
    });
    mocks.backend.verifyAuth.mockResolvedValue(true);
    mocks.backend.restoreAuth.mockResolvedValue({ github_token: 'ghp_restored', accounts: [] });
    mocks.getCurrentUser.mockResolvedValue(user);
  });

  it('restores a GitHub session from an authenticated backend', async () => {
    const { result } = renderHook(() => useLoginActions());

    let restored;
    await act(async () => {
      restored = await result.current.restoreBackendSession('https://backend.example');
    });

    expect(result.current.configuredBackendUrl).toBe('https://backend.example/api');
    expect(mocks.backend.init).toHaveBeenCalledWith('https://backend.example');
    expect(mocks.backend.verifyAuth).toHaveBeenCalledOnce();
    expect(mocks.backend.restoreAuth).toHaveBeenCalledOnce();
    expect(mocks.backend.rememberActiveUrl).toHaveBeenCalledOnce();
    expect(mocks.apiTokens).toEqual(['ghp_restored']);
    // 多账号扩展（Issue #611）：connected 结果携带后端已保存账号列表
    expect(restored).toEqual({ status: 'connected', githubToken: 'ghp_restored', user, accounts: [] });
  });

  it('does not remember the URL before the token setup step', async () => {
    mocks.backend.restoreAuth.mockResolvedValueOnce({ github_token: null });
    const { result } = renderHook(() => useLoginActions());

    await expect(result.current.restoreBackendSession('https://backend.example')).resolves.toEqual({
      status: 'github-token-required',
    });
    expect(mocks.getCurrentUser).not.toHaveBeenCalled();
    expect(mocks.backend.rememberActiveUrl).not.toHaveBeenCalled();
  });

  it('defers URL persistence when the caller asks for it (R2-B12)', async () => {
    const { result } = renderHook(() => useLoginActions());

    await expect(result.current.restoreBackendSession('https://backend.example', { deferPersist: true }))
      .resolves.toMatchObject({ status: 'connected' });
    // 候选仅完成身份验证不持久化 URL：调用方接受恢复结果并提交登录后再保存。
    expect(mocks.backend.rememberActiveUrl).not.toHaveBeenCalled();
  });

  it('falls back to the previous backend when the key is rejected', async () => {
    mocks.backend.backendUrl = 'https://old.example/api';
    mocks.backend.verifyAuth.mockResolvedValueOnce(false);
    const { result } = renderHook(() => useLoginActions());

    await expect(result.current.restoreBackendSession('https://backend.example')).resolves.toEqual({
      status: 'unauthorized',
    });
    expect(mocks.backend.init).toHaveBeenLastCalledWith('https://old.example/api');
    expect(mocks.backend.rememberActiveUrl).not.toHaveBeenCalled();
  });

  it('reports an unusable stored token instead of a raw auth error', async () => {
    mocks.getCurrentUser.mockRejectedValueOnce(new Error('GitHub token expired or invalid'));
    const { result } = renderHook(() => useLoginActions());

    await expect(result.current.restoreBackendSession('https://backend.example')).resolves.toEqual({
      status: 'restored-token-invalid',
    });
  });

  it('propagates transient GitHub errors instead of flagging the stored token', async () => {
    mocks.getCurrentUser.mockRejectedValueOnce(new Error('GitHub API error: 503 Service Unavailable'));
    const { result } = renderHook(() => useLoginActions());

    await expect(result.current.restoreBackendSession('https://backend.example')).rejects.toThrow(
      'GitHub API error: 503 Service Unavailable'
    );
  });

  it('does not treat a backend proxy credential failure as an invalid stored token', async () => {
    mocks.getCurrentUser.mockRejectedValueOnce(new Error('Backend API key was rejected. Please check your backend settings'));
    const { result } = renderHook(() => useLoginActions());

    await expect(result.current.restoreBackendSession('https://backend.example')).rejects.toThrow(
      'Backend API key was rejected'
    );
  });

  it('distinguishes unreachable and unauthorized backends', async () => {
    const { result } = renderHook(() => useLoginActions());
    mocks.backend.isAvailable = false;
    await expect(result.current.restoreBackendSession('https://offline.example')).resolves.toEqual({
      status: 'backend-unavailable',
    });

    mocks.backend.isAvailable = true;
    mocks.backend.verifyAuth.mockResolvedValueOnce(false);
    await expect(result.current.restoreBackendSession('https://backend.example')).resolves.toEqual({
      status: 'unauthorized',
    });
  });

  it('validates and stores a token before syncing backend data', async () => {
    const { result } = renderHook(() => useLoginActions());

    await expect(result.current.setupBackendGitHubToken('ghp_new')).resolves.toEqual(user);
    expect(mocks.apiTokens).toEqual(['ghp_new']);
    // Issue #611：Token 首传附带 user_profile 与 active_account_id（accounts 表唯一写入路径）
    // 审计修复：请求头必须显式携带目标账号——登录页先 park 当前账号（Store
    // user 为 null），缺省头会缺 X-GitHub-Account-Id，服务端回退全局
    // active_account_id 分区，新账号凭据会覆盖旧账号行
    expect(mocks.backend.syncSettings).toHaveBeenLastCalledWith(
      {
        github_token: 'ghp_new',
        active_account_id: '1',
        user_profile: user,
      },
      undefined,
      '1',
    );
    // R2-B12：Token 设置完成不等于登录提交成功——持久化 URL 改由调用方在
    // 登录提交后经 rememberActiveBackendUrl 执行，严格仓库拉取失败保留原值。
    expect(mocks.backend.rememberActiveUrl).not.toHaveBeenCalled();
    expect(mocks.syncFromBackend).not.toHaveBeenCalled();

    await result.current.syncBackendData();
    expect(mocks.syncFromBackend).toHaveBeenCalledWith({ force: true, throwOnRepoFailure: true });
  });

  it('restores the persisted URL through the exposed wrappers (R2-B7)', async () => {
    const { result } = renderHook(() => useLoginActions());
    mocks.backend.persistedUrl = 'https://stored.example/api';
    expect(result.current.getPersistedUrl()).toBe('https://stored.example/api');

    result.current.persistUrl(null);
    expect(mocks.backend.persistUrl).toHaveBeenLastCalledWith(null);
    result.current.persistUrl('https://stored.example/api');
    expect(mocks.backend.persistUrl).toHaveBeenLastCalledWith('https://stored.example/api');
    mocks.backend.persistedUrl = null;
    expect(result.current.getPersistedUrl()).toBeNull();
  });

  it('restores the API key together with the URL on rollback (R2-B11)', async () => {
    const { result } = renderHook(() => useLoginActions());
    useAppStore.setState({ backendApiSecret: 'candidate-secret' });

    // URL 不同：先复原连接，再成对写回原密钥。
    mocks.backend.backendUrl = 'https://candidate.example/api';
    await result.current.rollbackBackendConnection('https://old.example/api', 'original-secret');
    expect(mocks.backend.init).toHaveBeenLastCalledWith('https://old.example/api');
    expect(useAppStore.getState().backendApiSecret).toBe('original-secret');

    // URL 已一致时也要恢复密钥（候选连接被 restoreBackendSession 内部复原的
    // 场景）：不再重复 init，但密钥必须成对复原。
    useAppStore.setState({ backendApiSecret: 'candidate-secret' });
    await result.current.rollbackBackendConnection('https://old.example/api', 'original-secret');
    expect(mocks.backend.init).toHaveBeenCalledOnce();
    expect(useAppStore.getState().backendApiSecret).toBe('original-secret');

    // secret 为 undefined：不改动密钥。
    useAppStore.setState({ backendApiSecret: 'keep-me' });
    await result.current.rollbackBackendConnection(null);
    expect(useAppStore.getState().backendApiSecret).toBe('keep-me');
    // 原连接为 null：显式断开（C63），绝不经 init 触发候选后端自动探测。
    expect(mocks.backend.init).toHaveBeenCalledOnce();
  });
});
