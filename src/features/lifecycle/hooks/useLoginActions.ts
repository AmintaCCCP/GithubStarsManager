import { useCallback } from 'react';
import { GITHUB_TOKEN_INVALID_ERROR } from '../../../services/githubApi';
import { useAppStore } from '../../../store/useAppStore';
import { createGitHubApiService } from '../../../services/githubApiFactory';
import { backend, isValidBackendRestoreAccount, type BackendAuthRestoreAccount } from '../../../services/backendAdapter';
import { syncFromBackend } from '../../../services/autoSync';
import { accountIdKey } from '../../../store/helpers/accountWorkspace';
import type { GitHubUser } from '../../../types';

// 视图组件（LoginScreen）不得直接 import 业务服务（ADR 0001 分层守则）：
// 后端账号条目的共享过滤规则经本 hook 模块转出口，供登录页与
// tryRestoreAuthFromBackend / addAccountFromBackend 使用同一规则。
export { isValidBackendRestoreAccount };

export type BackendLoginResult =
  | { status: 'connected'; githubToken: string; user: GitHubUser; accounts: BackendAuthRestoreAccount[] }
  | { status: 'backend-unavailable' }
  | { status: 'unauthorized' }
  | { status: 'restore-failed' }
  | { status: 'restored-token-invalid' }
  | { status: 'github-token-required' };

export interface LoginActions {
  authenticateWithGitHub: (token: string) => Promise<GitHubUser>;
  syncTokenToBackend: (token: string) => Promise<{ ok: boolean }>;
  configuredBackendUrl: string | null;
  /**
   * 候选后端恢复。options.omitAccountHeader 为 true 时显式省略
   * X-GitHub-Account-Id 请求头（addAccountFromBackend 在本机仍登录旧账号时
   * 必须省略——否则服务端优先选择本机旧账号分区，候选后端活跃账号 B 的
   * 有效凭证会被误判为 github-token-required；R4 审计修复）。
   */
  restoreBackendSession: (url: string, options?: { omitAccountHeader?: boolean }) => Promise<BackendLoginResult>;
  setupBackendGitHubToken: (token: string) => Promise<GitHubUser>;
  syncBackendData: () => Promise<void>;
  /** 当前后端 URL：候选连接失败时用于成对恢复 URL 与 API 密钥。 */
  getBackendUrl: () => string | null;
  /** 把后端 URL 复原到候选连接之前的值（密钥由调用方成对恢复）。 */
  rollbackBackendConnection: (url: string | null) => Promise<void>;
}

export const useLoginActions = (): LoginActions => {
  const authenticateWithGitHub = useCallback(async (token: string) => {
    // 必须直连校验调用方传入的 token：走后端代理时服务端用的是库里存的
    // github_token，会拿旧令牌的身份冒充本次登录校验结果。
    const api = createGitHubApiService(token, { direct: true });
    return api.getCurrentUser();
  }, []);
  const syncTokenToBackend = useCallback(async (token: string) => {
    if (!backend.isAvailable) return { ok: true };
    try {
      // 首次上传 Token 时附带 user_profile / active_account_id：accounts.user_json
      // 的唯一写入路径就是 PUT /api/settings 的 user_profile（Issue #611）。
      const { user } = useAppStore.getState();
      const accountId = accountIdKey(user);
      await backend.syncSettings({
        github_token: token,
        ...(accountId ? { active_account_id: accountId } : {}),
        ...(user ? { user_profile: user } : {}),
      });
      return { ok: true };
    } catch (e) {
      console.warn('Failed to save GitHub token to backend:', e);
      return { ok: false };
    }
  }, []);
  const restoreBackendSession = useCallback(async (
    url: string,
    options?: { omitAccountHeader?: boolean },
  ): Promise<BackendLoginResult> => {
    const previousUrl = backend.backendUrl;
    await backend.init(url);
    if (!backend.isAvailable) return { status: 'backend-unavailable' };
    if (!await backend.verifyAuth()) {
      // Wrong key: drop the candidate and fall back to whatever backend was
      // active before (or auto-detect), so a failed candidate is never kept.
      await backend.init(previousUrl ?? undefined);
      return { status: 'unauthorized' };
    }

    const restored = await backend.restoreAuth(options);
    if (!restored) {
      await backend.init(previousUrl ?? undefined);
      return { status: 'restore-failed' };
    }
    if (!restored.github_token) return { status: 'github-token-required' };

    try {
      const user = await authenticateWithGitHub(restored.github_token);
      // Backend, API key, and stored token are all proven — remember the URL
      // (the setup step re-remembers after persisting a new token).
      backend.rememberActiveUrl();
      return {
        status: 'connected',
        githubToken: restored.github_token,
        user,
        accounts: Array.isArray(restored.accounts) ? restored.accounts : [],
      };
    } catch (err) {
      if (err instanceof Error && err.message === GITHUB_TOKEN_INVALID_ERROR) {
        // Confirmed auth failure: the stored token is what failed, while the
        // backend and API key are fine — keep the connection for token setup;
        // saving a new token there overwrites the broken one on the backend.
        return { status: 'restored-token-invalid' };
      }
      // Network failures, rate limits, and 5xx are transient — propagate so
      // the user can retry without being pushed into token setup.
      throw err;
    }
  }, [authenticateWithGitHub]);
  const setupBackendGitHubToken = useCallback(async (token: string) => {
    const user = await authenticateWithGitHub(token);
    // 附带 user_profile / active_account_id，让后端 accounts 表拿到头像与昵称。
    // 请求头必须显式携带目标账号（审计修复）：LoginScreen 先 park 当前账号
    // （Store user 为 null）再调用本流程，缺省头会缺 X-GitHub-Account-Id，
    // 服务端回退全局 active_account_id——旧账号 A 的凭据会被新账号 B 的
    // Token/user_profile 覆盖。
    const accountId = accountIdKey(user);
    await backend.syncSettings({
      github_token: token,
      ...(accountId ? { active_account_id: accountId } : {}),
      user_profile: user,
    }, undefined, accountId);
    backend.rememberActiveUrl();
    return user;
  }, [authenticateWithGitHub]);
  const syncBackendData = useCallback(async () => {
    await syncFromBackend({ force: true });
  }, []);

  const getBackendUrl = useCallback(() => backend.backendUrl, []);
  const rollbackBackendConnection = useCallback(async (url: string | null) => {
    if ((backend.backendUrl ?? null) === (url ?? null)) return;
    try {
      await backend.init(url ?? undefined);
    } catch {
      // 复原探测失败时保持现有连接，不叠加新错误
    }
  }, []);

  return {
    authenticateWithGitHub,
    syncTokenToBackend,
    configuredBackendUrl: backend.configuredUrl,
    restoreBackendSession,
    setupBackendGitHubToken,
    syncBackendData,
    getBackendUrl,
    rollbackBackendConnection,
  };
};
