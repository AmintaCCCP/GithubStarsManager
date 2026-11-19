import { useCallback } from 'react';
import { GITHUB_TOKEN_INVALID_ERROR } from '../../../services/githubApi';
import { useAppStore } from '../../../store/useAppStore';
import { createGitHubApiService } from '../../../services/githubApiFactory';
import { backend, isValidBackendRestoreAccount, normalizeBackendRestoreAccount, type BackendAuthRestoreAccount } from '../../../services/backendAdapter';
import { drainInFlightBackendPulls as drainInFlightBackendPullsImpl, syncFromBackend, withAccountSwitchFrozen } from '../../../services/autoSync';
import { accountIdKey } from '../../../store/helpers/accountWorkspace';
import type { GitHubUser } from '../../../types';

// 视图组件（LoginScreen）不得直接 import 业务服务（ADR 0001 分层守则）：
// 后端账号条目的共享过滤规则经本 hook 模块转出口，供登录页与
// tryRestoreAuthFromBackend / addAccountFromBackend 使用同一规则。
// R2-C12：user:null 条目的异步归一化（用分区 PAT 核对 /user）同样经此处出口。
export { isValidBackendRestoreAccount, normalizeBackendRestoreAccount };

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
   * options.apiSecret（审计修复 C64 / R2-B9）：候选 API Key 在候选 URL 提交后
   * 才写入 Store——/health 探测不使用密钥，提交前的请求仍读原密钥，绝不把
   * 候选 Key 发给尚未切换的原后端。
   * options.deferPersist（R2-B12）：为 true 时候选后端完成身份验证也不持久化
   * URL；调用方接受恢复结果并提交登录后调用 rememberActiveBackendUrl 再保存，
   * 严格仓库拉取失败时保留原持久化 URL。
   */
  restoreBackendSession: (url: string, options?: { omitAccountHeader?: boolean; apiSecret?: string; deferPersist?: boolean }) => Promise<BackendLoginResult>;
  setupBackendGitHubToken: (token: string) => Promise<GitHubUser>;
  /**
   * 拉取后端数据。options.targetAccountId 为审计修复 B13 的显式账号恢复：
   * 恢复拉取以已验证账号 ID 构造请求头（不依赖提前 setUser 落登录态），
   * 拉取成功后由调用方统一提交工作区与登录态；恢复失败时登录页保持在
   * 当前页面并可见错误。autoSync 侧支持见 HANDOFF-B-TO-C.md。
   */
  syncBackendData: (options?: { targetAccountId?: string }) => Promise<void>;
  /** 当前后端 URL：候选连接失败时用于成对恢复 URL 与 API 密钥。 */
  getBackendUrl: () => string | null;
  /** 持久化的后端 URL（R2-B7：候选认证前记录，失败回滚时还原）。 */
  getPersistedUrl: () => string | null;
  /** 显式写入/清除持久化的后端 URL（R2-B7：原值为空时传 null 移除持久化键）。 */
  persistUrl: (url: string | null) => void;
  /**
   * 把当前活跃的后端 URL 持久化（R2-B12）：调用方接受恢复结果并提交登录后
   * 再调用；候选仅完成身份验证绝不提前持久化。
   */
  rememberActiveBackendUrl: () => void;
  /**
   * 把后端连接复原到候选连接之前的值（R2-B11：URL 与 API 密钥成对恢复）。
   * secret 为 undefined 时不改动密钥；先复原 URL 再写密钥，避免原密钥经
   * Store 发给仍活动的候选后端。
   */
  rollbackBackendConnection: (url: string | null, secret?: string | null) => Promise<void>;
  /** 在候选后端恢复期间冻结自动同步与推送窗口。 */
  runWithBackendRestoreFrozen?: <T>(fn: () => Promise<T>) => Promise<T>;
  /**
   * B14（见 HANDOFF-B-TO-C.md）：归档账号前暂停新拉取并排空该账号的在途
   * 后端拉取，防止旧账号 A 的在途拉取把数据写进归档后的无主顶层。
   * autoSync 侧实现（drainInFlightBackendPulls）由 Agent C 承担；落地前为
   * no-op，由 C8 的「拉取结果应用前校验会话代次」兜底。
   */
  drainInFlightBackendPulls: (accountId: string | null) => Promise<void>;
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
    options?: { omitAccountHeader?: boolean; apiSecret?: string; deferPersist?: boolean },
  ): Promise<BackendLoginResult> => {
    const previousUrl = backend.backendUrl;
    await backend.init(url);
    if (!backend.isAvailable) return { status: 'backend-unavailable' };
    // 审计修复（C64）：候选密钥仅在候选 URL 提交后才对请求可见——/health
    // 探测不使用密钥，提交前的任何请求继续读取原密钥。
    if (options?.apiSecret !== undefined) {
      useAppStore.getState().setBackendApiSecret(options.apiSecret);
    }
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
      // R2-B12：deferPersist 为 true 时候选仅完成身份验证不持久化 URL——调用方
      // 接受恢复结果并提交登录后再经 rememberActiveBackendUrl 保存，严格仓库
      // 拉取失败时保留原持久化 URL。
      if (!options?.deferPersist) {
        backend.rememberActiveUrl();
      }
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
    // R2-B12：候选后端完成 Token 设置不等于登录提交成功——严格仓库拉取失败
    // 时必须保留原持久化 URL，持久化改由调用方在登录提交完成后经
    // rememberActiveBackendUrl 执行。
    return user;
  }, [authenticateWithGitHub]);
  const syncBackendData = useCallback(async (options?: { targetAccountId?: string }) => {
    // B13（HANDOFF-B-TO-C.md 已落地）：targetAccountId 为显式账号恢复——
    // 恢复拉取以已验证账号 ID 构造请求头，不依赖提前 setUser 生成请求头，
    // 登录态由调用方在拉取成功后统一提交。
    await syncFromBackend({
      force: true,
      throwOnRepoFailure: true,
      ...(options?.targetAccountId ? { targetAccountId: options.targetAccountId } : {}),
    });
  }, []);

  const getBackendUrl = useCallback(() => backend.backendUrl, []);
  const getPersistedUrl = useCallback(() => backend.persistedUrl, []);
  const persistUrlAction = useCallback((url: string | null) => {
    backend.persistUrl(url);
  }, []);
  const rememberActiveBackendUrl = useCallback(() => {
    backend.rememberActiveUrl();
  }, []);
  // R2-B11：候选连接取消/失败时成对恢复原 URL 与原 API 密钥——只恢复 URL 会
  // 让下一请求从 Store 读到候选密钥发给原后端。先复原 URL 再写密钥，避免原
  // 密钥经 Store 发给仍活动的候选后端；secret 为 undefined 表示调用方无需
  // 改动密钥。
  const rollbackBackendConnection = useCallback(async (url: string | null, secret?: string | null) => {
    if ((backend.backendUrl ?? null) !== (url ?? null)) {
      // 审计修复（C63）：原连接为 null（本地/自动探测）时显式断开，绝不经
      // backend.init(undefined) 触发候选后端自动探测读取刚保存的候选 URL。
      if (url === null) {
        try {
          backend.disconnect();
        } catch {
          // 断开失败时保持现有连接，不叠加新错误
        }
      } else {
        try {
          await backend.init(url);
        } catch {
          // 复原探测失败时保持现有连接，不叠加新错误
        }
      }
    }
    if (secret !== undefined) {
      useAppStore.getState().setBackendApiSecret(secret);
    }
  }, []);
  // B14（HANDOFF-B-TO-C.md 已落地）：归档账号前暂停新拉取并排空该账号的
  // 在途后端拉取，防止旧账号 A 的在途拉取把数据写进归档后的无主顶层。
  const drainInFlightBackendPulls = useCallback(
    (accountId: string | null) => drainInFlightBackendPullsImpl(accountId),
    [],
  );

  return {
    authenticateWithGitHub,
    syncTokenToBackend,
    configuredBackendUrl: backend.configuredUrl,
    restoreBackendSession,
    setupBackendGitHubToken,
    syncBackendData,
    getBackendUrl,
    getPersistedUrl,
    persistUrl: persistUrlAction,
    rememberActiveBackendUrl,
    rollbackBackendConnection,
    runWithBackendRestoreFrozen: withAccountSwitchFrozen,
    drainInFlightBackendPulls,
  };
};
