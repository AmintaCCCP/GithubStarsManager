import { useCallback } from 'react';
import { GITHUB_TOKEN_INVALID_ERROR } from '../../../services/githubApi';
import { useAppStore } from '../../../store/useAppStore';
import { createGitHubApiService } from '../../../services/githubApiFactory';
import {
  backend,
  getBackendAuthHeaders,
  isValidBackendRestoreAccount,
  normalizeBackendRestoreAccount,
  type BackendAuthRestore,
  type BackendAuthRestoreAccount,
} from '../../../services/backendAdapter';
import { drainInFlightBackendPulls as drainInFlightBackendPullsImpl, syncFromBackend, withAccountSwitchFrozen } from '../../../services/autoSync';
import { accountIdKey } from '../../../store/helpers/accountWorkspace';
import type { GitHubUser } from '../../../types';

// 视图组件（LoginScreen）不得直接 import 业务服务（ADR 0001 分层守则）：
// 后端账号条目的共享过滤规则经本 hook 模块转出口，供登录页与
// tryRestoreAuthFromBackend / addAccountFromBackend 使用同一规则。
// R2-C12：user:null 条目的异步归一化（用分区 PAT 核对 /user）同样经此处出口；
// 转交 2：恢复歧义（account_selection_required）的账号条目类型也经此处出口，
// 登录页的账号选择列表使用同一形状。
export { isValidBackendRestoreAccount, normalizeBackendRestoreAccount };
export type { BackendAuthRestoreAccount };

export type BackendLoginResult =
  | { status: 'connected'; githubToken: string; user: GitHubUser; accounts: BackendAuthRestoreAccount[] }
  | { status: 'backend-unavailable' }
  | { status: 'unauthorized' }
  | { status: 'restore-failed' }
  | { status: 'restored-token-invalid' }
  // 转交 2（server/src/routes/authRestore.ts A19 契约）：无账号头恢复请求无法
  // 唯一确定目标分区时，服务端返回 account_selection_required: true + 完整
  // accounts 列表 + 空 github_token。不得误报 github-token-required——由登录页
  // 展示账号选择，用户选定后携带账号 ID 重试恢复。
  | { status: 'account-selection-required'; accounts: BackendAuthRestoreAccount[] }
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
   * options.accountId（转交 2）：显式账号恢复——服务端对无账号头恢复返回
   * account_selection_required 时，用户选定账号后携带该账号 ID（经
   * X-GitHub-Account-Id 头）重试恢复。
   */
  restoreBackendSession: (url: string, options?: { omitAccountHeader?: boolean; apiSecret?: string; deferPersist?: boolean; accountId?: string }) => Promise<BackendLoginResult>;
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

// 转交 2：显式账号的定向恢复请求。backendAdapter.restoreAuth 只支持省略账号头
//（omitAccountHeader）或读取 Store 当前账号两种形态，不支持显式账号参数（services
// 域接口，本域不可改动）；恢复歧义重试需要携带用户选定的账号 ID。这里复用
// 适配器导出的 getBackendAuthHeaders(accountId)（Bearer 密钥 + 显式
// X-GitHub-Account-Id）与同一 /sync/auth 路由——server/src/routes/authRestore.ts
// 接受请求头 x-github-account-id 或 body account_id 指定恢复目标，此处沿用请求头
// 形态。8s 截止与「非 200/网络失败返回 null」的语义与 restoreAuth 保持一致。
const RESTORE_AUTH_TIMEOUT_MS = 8000;
const restoreAuthWithExplicitAccount = async (accountId: string): Promise<BackendAuthRestore | null> => {
  if (!backend.backendUrl) return null;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), RESTORE_AUTH_TIMEOUT_MS);
  try {
    const res = await fetch(`${backend.backendUrl}/sync/auth`, {
      method: 'POST',
      headers: getBackendAuthHeaders(accountId),
      signal: controller.signal,
      // R12（finding 18）：定向恢复请求带认证头，禁止跟随重定向——同源重定向
      // 可以把带认证头的请求转到另一个路径，并让恢复流程接受该路径的响应。
      // 直接响应不受影响；重定向按网络失败处理（restore-failed，可重试）。
      redirect: 'error',
    });
    if (!res.ok) return null;
    return await res.json() as BackendAuthRestore;
  } catch {
    // 超时/网络失败统一返回 null：调用方按 restore-failed 处理，流程可重试。
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
};

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
    options?: { omitAccountHeader?: boolean; apiSecret?: string; deferPersist?: boolean; accountId?: string },
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

    // 转交 2：显式账号重试（恢复歧义后用户选定账号）走定向恢复请求；其余
    // 恢复沿用适配器实现（省略账号头/读取 Store 账号）。
    const restored = options?.accountId
      ? await restoreAuthWithExplicitAccount(options.accountId)
      : await backend.restoreAuth(options);
    if (!restored) {
      await backend.init(previousUrl ?? undefined);
      return { status: 'restore-failed' };
    }
    // 转交 2（server/src/routes/authRestore.ts A19 契约）：无账号头恢复歧义时
    // 服务端返回 account_selection_required: true + accounts 列表 + 空
    // github_token——在把空 token 判为 github-token-required 之前先检查该标志，
    // 把可选账号列表暴露给登录页的账号选择 UI；单账号无歧义恢复沿用现有流程。
    if (restored.account_selection_required === true) {
      return {
        status: 'account-selection-required',
        accounts: Array.isArray(restored.accounts) ? restored.accounts : [],
      };
    }
    if (!restored.github_token) return { status: 'github-token-required' };

    try {
      const user = await authenticateWithGitHub(restored.github_token);
      // R12（finding 8）：定向恢复必须核对身份归属——服务端返回的 Token 属于
      // 用户选中的账号时才可返回 connected。不匹配时按可处理的失败返回
      // restored-token-invalid（进入补填 Token 流程），绝不持久化 URL，也绝不
      // 把另一个账号当作已连接用户返回。
      if (options?.accountId && accountIdKey(user) !== options.accountId) {
        return { status: 'restored-token-invalid' };
      }
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
