import { useCallback, useState } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { accountIdKey, applyAccountWorkspace } from '../../../store/helpers/accountWorkspace';
import { backend, normalizeBackendRestoreAccount } from '../../../services/backendAdapter';
import {
  hasPendingAccountSync,
  markPendingAccountSync,
  prepareForAccountSwitch,
  schedulePendingAccountSyncRetry,
  syncFromBackend,
  syncToBackend,
  withAccountSwitchFrozen,
  withAccountSwitchGuard,
  withAccountSwitchGuardSync,
} from '../../../services/autoSync';
import { refreshMcpElectronBridge } from '../../../services/mcpElectronBridge';
import { useLoginActions } from './useLoginActions';
import type { BackendLoginResult } from './useLoginActions';
import type { GitHubUser } from '../../../types';

// 模块级共享切换锁（Issue #611 审计修复）：Header 与 AddAccountModal 各自创建
// 本 Hook 实例，实例内 useRef 锁互不可见，两个切换流程可并发执行——先结束的
// 流程会在守卫 finally 中解除订阅静音，使仍在执行的另一流程把 Store 写入与
// 后端对齐推送到错误账号分区。所有 Hook 实例必须共享同一把锁。
let _isAccountSwitchFlowRunning = false;

/** 尝试获取全局唯一的切换流程锁；已有流程在执行时返回 false。 */
const acquireAccountSwitchLock = (): boolean => {
  if (_isAccountSwitchFlowRunning) return false;
  _isAccountSwitchFlowRunning = true;
  return true;
};

/** 释放全局切换流程锁（必须在覆盖整个流程的 finally 中调用）。 */
const releaseAccountSwitchLock = (): void => {
  _isAccountSwitchFlowRunning = false;
};

export interface AccountSwitchResult {
  ok: boolean;
  needsToken?: boolean;
  error?: string;
}

export interface AddAccountResult {
  ok: boolean;
  user?: GitHubUser;
  error?: string;
}

export interface AccountSwitchActions {
  isSwitching: boolean;
  /** 外部数据恢复前归档当前已登录账号工作区（LoginScreen/AddAccountModal 使用） */
  parkCurrentAccountForRestore: () => string | null;
  /** 在已保存账号间无缝切换（冲刷旧账号在途同步 -> 原子切换工作区 -> 对齐后端目标分区） */
  switchToAccount: (targetAccountId: string) => Promise<AccountSwitchResult>;
  /** 用 PAT 在线添加并切换到新账号（不登出当前账号；取消弹窗对当前账号零影响） */
  addAccountWithToken: (token: string, expectedAccountId?: string) => Promise<AddAccountResult>;
  /** AddAccountModal 后端恢复模式：连接后端并恢复其活跃账号（已登录时先安全归档当前账号） */
  addAccountFromBackend: (url: string, secret: string, expectedAccountId?: string) => Promise<AddAccountResult>;
  /** 从已保存账号列表移除指定账号（保留其本地工作区数据） */
  removeAccount: (targetAccountId: string) => Promise<AccountSwitchResult>;
  /**
   * 退出登录（含二次确认调用方）。expectedAccountId 为审计修复 B9 的期望
   * 账号标识（确认框打开时的账号）：获取切换锁后与当前账号比较，不一致则
   * 不执行退出并返回 false，由调用方提示用户对当前账号重新发起退出。
   */
  logoutCurrentAccount: (expectedAccountId?: string) => Promise<boolean>;
}

/**
 * 账号切换编排层（Issue #611，模块 2.3）。
 *
 * 遵守分层守则：本 Hook 是唯一允许编排 services/autoSync、services/backendAdapter、
 * services/githubApiFactory 的切换入口；视图组件（src/components/**）只调用本 Hook。
 *
 * switchToAccount 的零数据丢失执行序列：
 * 1. 前置守卫（同账号直接返回）；
 * 2. 检查目标凭证（缺失返回 needsToken，由 UI 弹出 AddAccountModal 补填）；
 * 3. prepareForAccountSwitch：旧账号上下文下冲刷未决防抖推送并排空在途同步；
 * 4. withAccountSwitchGuard 内原子切换 Store 工作区（switchAccount）；
 * 5. 若后端可用：syncSettings 携带 github_token / active_account_id / user_profile
 *    对齐目标账号分区，再 syncFromBackend 合并/补推；
 * 6. 释放切换锁并刷新桌面端 MCP 桥接。
 */
export const useAccountSwitchActions = (): AccountSwitchActions => {
  const [isSwitching, setIsSwitching] = useState(false);
  const { restoreBackendSession, authenticateWithGitHub } = useLoginActions();

  /**
   * 外部恢复失败/取消时，把被归档的当前账号工作区与凭证原样恢复（零丢失）。
   * R2-B14：`failedAccountId` 用于「身份已提交但流程失败」——仅当当前顶层身份
   * 正是本次失败流程提交的目标账号时，先做与 park 对称的身份回滚
   *（setGitHubToken(null)/setUser(null) + 清空工作区），再恢复归档账号。正常
   * 成功路径（state.user 为其他账号或未传失败账号）保持早退，绝不误伤。
   */
  const recoverParkedAccount = useCallback((
    parkedAccountId: string | null,
    failedAccountId?: string | null,
  ): void => {
    if (!parkedAccountId) return;
    const state = useAppStore.getState();
    if (state.user) {
      if (!failedAccountId || accountIdKey(state.user) !== failedAccountId) {
        return; // 已成功登录另一账号，无需恢复
      }
      // 失败流程提交的身份仍留在顶层：先回滚身份与工作区，使后续恢复写入
      // 与 park 前状态对称（user 为 null 时才算回到可恢复状态）。
      withAccountSwitchGuardSync(() => {
        useAppStore.getState().setGitHubToken(null);
        useAppStore.getState().setUser(null);
        useAppStore.setState(applyAccountWorkspace(undefined));
      });
    }
    const recoverable = useAppStore.getState();
    const saved = recoverable.savedAccounts[parkedAccountId];
    const workspace = recoverable.accountWorkspaces[parkedAccountId];
    // 恢复写入同样属于切换簿记：静音订阅，避免工作区回放在无账号上下文下
    // 触发 isFullSync 推送（失败且无 savedAccount 时 user 仍为 null）。
    withAccountSwitchGuardSync(() => {
      if (workspace) {
        useAppStore.setState(applyAccountWorkspace(workspace));
      }
      if (saved) {
        recoverable.setGitHubToken(saved.githubToken);
        recoverable.setUser(saved.user);
      }
    });
  }, []);

  /** 桌面端 MCP 桥接刷新失败不得让已提交的登录/切换失败（R2-B14）。 */
  const refreshMcpBridgeSafely = useCallback((): void => {
    try {
      refreshMcpElectronBridge();
    } catch (error) {
      console.warn('Failed to refresh MCP bridge after account change:', error);
    }
  }, []);

  /**
   * 切换/添加完成后的后端对齐（步骤 5）。
   * 必须携带 user_profile：accounts.user_json 的唯一写入路径就是
   * PUT /api/settings 的 user_profile 字段，否则后端恢复的账号列表没有头像/昵称。
   * 冲刷失败遗留的账号级待推状态在这里消费：切回该账号后先补推本地工作区
   * （含未推修改），再拉取后端——顺序绝不能颠倒，否则非强制拉取会用后端旧
   * 快照覆盖未推送的本地修改（数据丢失红线）。
   */
  const alignTargetAccountOnBackend = useCallback(async (accountId: string, token: string, user: GitHubUser): Promise<boolean> => {
    if (!backend.isAvailable) return true;
    // R2-C11：凭据写入失败必须回报调用方（addAccountWithToken）——静默吞错会让
    // 代理继续使用旧 PAT，用户看到「添加成功」但后续 GitHub 请求持续失败。
    let credentialsAligned = true;
    try {
      await backend.syncSettings({
        github_token: token,
        active_account_id: accountId,
        user_profile: user,
      });
    } catch (error) {
      credentialsAligned = false;
      console.warn('Failed to align account settings on backend:', error);
    }
    try {
      // 冲刷失败遗留：先补推本地工作区（推送失败时保留持久待推标记，非强制拉取
      // 会走合并分支；只有推送确认成功后才由 pushLatest 清除待推标记）。
      if (hasPendingAccountSync(accountId)) {
        if (!await syncToBackend()) {
          markPendingAccountSync(accountId);
          schedulePendingAccountSyncRetry(accountId);
        }
      }
      // force=false：后端已有数据则合并；后端分区为空而本地有数据时，
      // autoSync 的空保护会自动把本地该账号数据补推到 targetAccountId 分区。
      await syncFromBackend({ force: false });
    } catch (error) {
      console.warn('Failed to pull target account data from backend:', error);
    }
    return credentialsAligned;
  }, []);

  const parkCurrentAccountForRestore = useCallback((): string | null => {
    try {
      return useAppStore.getState().parkCurrentAccountForRestore();
    } catch {
      // 测试桩（store 被整体 mock）无 getState：跳过归档，保持旧测试契约
      return null;
    }
  }, []);

  const switchToAccount = useCallback(async (targetAccountId: string): Promise<AccountSwitchResult> => {
    const current = useAppStore.getState();
    // 同账号：仅当当前会话已使用目标凭证且已认证时才提前返回。水化后可能出现
    // user 保留但顶层凭证丢失/未认证的破损会话——此时必须继续走完整流程，
    // 由 store.switchAccount 的同账号分支恢复凭证与登录态（审计修复）。
    if (
      accountIdKey(current.user) === targetAccountId
      && current.isAuthenticated
      && !!current.githubToken?.trim()
    ) {
      return { ok: true };
    }
    const target = current.savedAccounts[targetAccountId];
    if (!target || !target.githubToken.trim()) {
      return { ok: false, needsToken: true };
    }
    if (!acquireAccountSwitchLock()) {
      return { ok: false, error: 'switch-in-progress' };
    }

    setIsSwitching(true);
    const previousAccountId = accountIdKey(useAppStore.getState().user);
    try {
      // 步骤 3：冲刷并冻结旧账号在途同步（R3/R4 推送半程）
      await prepareForAccountSwitch(previousAccountId);
      // 步骤 4-6：原子切换 + 后端对齐（切换期间抑制 Store 订阅误推送）
      await withAccountSwitchGuard(async () => {
        const applied = useAppStore.getState().switchAccount(targetAccountId);
        if (!applied) {
          throw new Error('switch-account-failed');
        }
        const switched = useAppStore.getState();
        await alignTargetAccountOnBackend(
          targetAccountId,
          switched.githubToken ?? target.githubToken,
          target.user,
        );
      });
      refreshMcpBridgeSafely();
      return { ok: true };
    } catch (error) {
      console.error('Account switch failed:', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      releaseAccountSwitchLock();
      setIsSwitching(false);
    }
  }, [alignTargetAccountOnBackend, refreshMcpBridgeSafely]);

  const addAccountWithToken = useCallback(async (
    token: string,
    expectedAccountId?: string,
  ): Promise<AddAccountResult> => {
    // 切换锁必须在首次 await（authenticateWithGitHub 身份校验）之前获取，
    // 并保持到整个流程结束：否则校验等待窗口内用户可以取消弹窗或重复提交，
    // 而校验完成后代码仍会归档当前账号并切换（审计：Functional Correctness）。
    if (!acquireAccountSwitchLock()) {
      return { ok: false, error: 'switch-in-progress' };
    }
    setIsSwitching(true);
    let parkedAccountId: string | null = null;
    const preAuthAccountId: string | null = accountIdKey(useAppStore.getState().user);
    try {
      let user: GitHubUser;
      try {
        // 直连校验调用方传入的 token（与登录一致，避免代理用旧 Token 身份冒充）
        user = await authenticateWithGitHub(token);
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      const targetAccountId = accountIdKey(user);
      if (!targetAccountId) {
        return { ok: false, error: 'invalid-github-user' };
      }
      // 补全 Token（reauth）必须校验身份仍是目标账号：Token 输错成另一个
      // 账号时不能把该账号登记/切换到本机。
      if (expectedAccountId && targetAccountId !== expectedAccountId) {
        return { ok: false, error: 'account-mismatch' };
      }

      // 校验等待期间会话可能已被其他路径改变：以当前 Store 状态为准
      const latest = useAppStore.getState();
      const currentAccountId = accountIdKey(latest.user);
      if (currentAccountId === targetAccountId) {
        // 同一账号重复添加：仅更新 Token
        withAccountSwitchGuardSync(() => {
          latest.setGitHubToken(token);
          latest.setUser(user);
        });
        // 审计修复：后端保存的旧 Token 可能已失效——直连校验通过后必须把新
        // 凭据对齐到后端目标分区（syncSettings 携带 github_token/账号头），否则
        // 后端代理继续读取旧 Token，后续 GitHub 请求反复失败。当前账号工作区
        // 保持不变（不归档、不切换）。
        const aligned = await alignTargetAccountOnBackend(targetAccountId, token, user);
        if (!aligned) {
          // R2-C11：已验证的本地 PAT 已保留（上面 setGitHubToken），但后端凭据
          // 尚未更新——明确失败并允许用户重试补授权。
          return { ok: false, error: 'backend-credential-sync-failed' };
        }
        refreshMcpBridgeSafely();
        return { ok: true, user };
      }

      await prepareForAccountSwitch(currentAccountId);
      await withAccountSwitchGuard(async () => {
        // R2 预防：先把当前已登录账号工作区安全归档并清空顶层，再落新账号
        parkedAccountId = useAppStore.getState().parkCurrentAccountForRestore();
        // 审计修复：身份写入属于切换簿记，必须包入同步簿记守卫——异步守卫只置
        // _isSwitchingAccount，订阅器会把窗口内的任何状态变化记为待推，守卫
        // 释放时立即以新账号（本地尚无快照、仓库列表为空）的工作区 isFullSync
        // 推送，早于 alignTargetAccountOnBackend 的拉取，会删除新账号后端分区
        // 中已有的全部仓库与发布记录。
        withAccountSwitchGuardSync(() => {
          useAppStore.getState().setGitHubToken(token);
          useAppStore.getState().setUser(user);
        });
      });
      const aligned = await alignTargetAccountOnBackend(targetAccountId, token, user);
      if (!aligned) {
        // R2-C11：本地 PAT 已随身份切换保留；后端凭据尚未更新，重试补授权
        //（此时目标已是当前账号，走同账号分支）即可修复。
        return { ok: false, error: 'backend-credential-sync-failed' };
      }
      refreshMcpBridgeSafely();
      return { ok: true, user };
    } catch (error) {
      console.error('Add account failed:', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      if (!useAppStore.getState().user) {
        // 与 addAccountFromBackend 对称：归档后写入新账号失败时，
        // 被归档的原账号工作区与凭证原样恢复，当前会话毫发无损。
        recoverParkedAccount(parkedAccountId ?? preAuthAccountId);
      }
      releaseAccountSwitchLock();
      setIsSwitching(false);
    }
  }, [alignTargetAccountOnBackend, authenticateWithGitHub, recoverParkedAccount, refreshMcpBridgeSafely]);

  const addAccountFromBackend = useCallback(async (url: string, secret: string, expectedAccountId?: string): Promise<AddAccountResult> => {
    if (!acquireAccountSwitchLock()) {
      return { ok: false, error: 'switch-in-progress' };
    }
    setIsSwitching(true);
    const previousSecret = useAppStore.getState().backendApiSecret;
    // 审计修复：保存切换前的后端 URL——restoreBackendSession 在
    // restored-token-invalid / github-token-required 分支会保留候选后端的 URL，
    // 失败时只恢复密钥会让原账号拿着原密钥请求候选后端，原连接无法继续工作。
    const previousBackendUrl = backend.backendUrl;
    // 审计修复（C63）：保存切换前持久化的后端 URL——restoreBackendSession 在
    // 身份校验通过后经 rememberActiveUrl 持久化候选 URL，调用方（账号校验/
    // 恢复结果）未接受即失败时必须还原，否则回滚后的 init 自动探测会读到
    // 刚保存的候选 URL，把原会话悄悄连回候选后端。
    const previousPersistedUrl = backend.persistedUrl;
    const currentAccountId = accountIdKey(useAppStore.getState().user);
    let parkedAccountId: string | null = null;
    let succeeded = false;
    // R2-B14：身份已提交的目标账号（仅当确实提交后流程失败才可用于复原，
    // recoverParkedAccount 内部还会核对顶层当前身份，正常成功路径不受影响）。
    let committedAccountId: string | null = null;
    try {
      // 切换后端前先在旧 URL/旧密钥上下文下排空旧后端的推送与在途同步；
      // 恢复期间由 withAccountSwitchGuard 静音订阅，阻止新推送把旧账号数据
      // 发送到新后端（backend.init 提交新 URL 后，晚启动的推送会以旧密钥与
      // 旧账号请求头写入新后端分区——审计：Data Integrity）。
      await prepareForAccountSwitch(currentAccountId);
      // 审计修复（C64）：候选 API Key 不再在此处提前写入 Store——候选 URL
      // 提交前请求仍读原密钥（/health 探测不使用密钥，prepareForAccountSwitch
      // 已排空旧后端在途请求）；候选密钥经 restoreBackendSession 的 apiSecret
      // 选项在候选 URL 提交后、verifyAuth 之前对请求可见。
      // 审计修复：backend.init 提交候选 URL 起到旧账号归档前的整个窗口内，
      // 后端连接处于「候选后端」状态。恢复守卫本身不冻结订阅簿记——窗口内的
      // 真实编辑会被订阅器记为待推，并在守卫退出时立即 syncToBackend，此时
      // 旧账号尚未归档，其完整工作区会以旧账号请求头写入候选后端分区，
      // 可能覆盖该分区已有数据。用冻结窗口包住「恢复 → 归档 → 身份提交」：
      // 窗口内编辑不记录、不推送（冻结期间轮询同样暂停），失败恢复后由
      // 下一次真实编辑在已复原的连接上下文中照常补推。
      type ConnectedRestore = Extract<BackendLoginResult, { status: 'connected' }>;
      const restoreOutcome = await withAccountSwitchFrozen(async (): Promise<
        { ok: false; error: string } | { ok: true; result: ConnectedRestore; targetAccountId: string }
      > => {
        // R4 审计修复：本机仍登录旧账号 A 时，恢复请求绝不能携带 A 的账号头
        // （X-GitHub-Account-Id）——服务端会优先选择 A 分区，候选后端的活跃
        // 账号是 B 时返回 github_token: null，B 的有效凭证被误判为
        // github-token-required。显式省略账号头，让服务端回退到候选后端自己
        // 的 active_account_id 分区。
        const result = await withAccountSwitchGuard(() => restoreBackendSession(url, { omitAccountHeader: true, apiSecret: secret }));
        if (result.status === 'backend-unavailable') return { ok: false, error: 'backend-unavailable' };
        if (result.status === 'unauthorized') return { ok: false, error: 'unauthorized' };
        if (result.status === 'restore-failed') return { ok: false, error: 'restore-failed' };
        if (result.status === 'restored-token-invalid' || result.status === 'github-token-required') {
          return { ok: false, error: result.status };
        }
        const targetAccountId = accountIdKey(result.user);
        if (!targetAccountId) return { ok: false, error: 'invalid-github-user' };
        // 补授权固定到被点名的账号：候选后端的活跃账号是别人时绝不能
        // 借这次补授权把会话切到那个账号（B 仍然缺 Token）。
        if (expectedAccountId && targetAccountId !== expectedAccountId) {
          return { ok: false, error: 'account-mismatch' };
        }
        if (currentAccountId && targetAccountId !== currentAccountId) {
          // R2 预防：拉取后端数据写入 Store 前先归档当前账号（仍在冻结窗口内：
          // 归档本身是簿记写入，且窗口内不存在会外发旧账号数据的推送）
          parkedAccountId = parkCurrentAccountForRestore();
        }
        // R2-B14：可能同步抛错的登记循环放在身份提交之前——此时顶层仍无
        // 账号（park 后 user 为 null），失败走 recoverParkedAccount 能完整
        // 恢复归档账号；登记使用恢复响应中的凭证，不依赖即将提交的身份。
        for (const account of result.accounts) {
          // R2-C12：user:null 条目先用其分区 PAT 核对 GitHub 身份再登记。
          const normalizedAccount = await normalizeBackendRestoreAccount(account);
          if (!normalizedAccount) continue;
          useAppStore.getState().upsertSavedAccount(normalizedAccount.user, normalizedAccount.githubToken);
        }
        // 审计修复：身份与工作区提交纳入恢复守卫覆盖，并以同步簿记守卫包裹
        // setGitHubToken/setUser——否则订阅器把这两项写入记为待推，守卫释放时
        // 以（本地尚无快照、可能为空的）新账号工作区 isFullSync 推送到候选后端，
        // 删除其分区中已有的仓库与发布记录。
        await withAccountSwitchGuard(async () => {
          withAccountSwitchGuardSync(() => {
            useAppStore.getState().setBackendApiSecret(secret);
            useAppStore.getState().setGitHubToken(result.githubToken);
            useAppStore.getState().setUser(result.user);
          });
        });
        return { ok: true, result, targetAccountId };
      });
      if (!restoreOutcome.ok) {
        return { ok: false, error: restoreOutcome.error };
      }
      const { result, targetAccountId } = restoreOutcome;
      committedAccountId = targetAccountId;

      // 后端保存的有效账号已在上面的冻结窗口内（身份提交前）登记完毕。
      await alignTargetAccountOnBackend(targetAccountId, result.githubToken, result.user);
      refreshMcpBridgeSafely();
      succeeded = true;
      return { ok: true, user: result.user };
    } catch (error) {
      console.error('Restore account from backend failed:', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      if (!succeeded) {
        // 每个失败返回路径都必须恢复原密钥与原后端 URL：失败的候选密钥与
        // 候选 URL 绝不能残留（包括当前账号仍处于登录态、原有 !user 条件
        // 不成立的情况），否则原账号拿原密钥请求候选后端无法继续工作。
        // 先还原持久化 URL 再复原连接，最后复原密钥：还原持久化 URL 保证
        // 复原连接的探测/自动探测不会读到刚保存的候选 URL；原连接为 null
        // （本地/自动探测）时显式断开，绝不经 init(undefined) 触发候选后端
        // 自动探测（审计修复 C63）。
        if (backend.persistedUrl !== previousPersistedUrl) {
          backend.persistUrl(previousPersistedUrl);
        }
        if (backend.backendUrl !== previousBackendUrl) {
          try {
            if (previousBackendUrl) {
              await backend.init(previousBackendUrl);
            } else {
              backend.disconnect();
            }
          } catch {
            // 复原连接探测失败时保持探测结果（本地模式或原 URL），不叠加新错误
          }
        }
        useAppStore.getState().setBackendApiSecret(previousSecret);
        // 恢复失败/取消：归档的原账号原样恢复，当前会话毫发无损
        recoverParkedAccount(parkedAccountId, committedAccountId);
        // R4 审计修复：冻结窗口内的真实编辑已按原后端绑定记入待推集合（或
        // 此前冲刷失败遗留的标记）。只有连接已成功复原到原后端时才立即补推；
        // 若复原失败，标记仍保留绑定在原后端，绝不推往候选后端。
        if (backend.backendUrl === previousBackendUrl && hasPendingAccountSync(currentAccountId)) {
          void syncToBackend();
        }
      }
      releaseAccountSwitchLock();
      setIsSwitching(false);
    }
  }, [recoverParkedAccount, restoreBackendSession, alignTargetAccountOnBackend, parkCurrentAccountForRestore, refreshMcpBridgeSafely]);

  const removeAccount = useCallback(async (targetAccountId: string): Promise<AccountSwitchResult> => {
    // R2-B13：切换锁被占用时返回明确失败（不再静默 void），由 Header 提示
    // 用户等待切换完成后重试；与 logoutCurrentAccount 的失败语义一致。
    if (!acquireAccountSwitchLock()) {
      return { ok: false, error: 'switch-in-progress' };
    }
    setIsSwitching(true);
    try {
      const current = useAppStore.getState();
      const currentAccountId = accountIdKey(current.user);
      // 只要有活跃账号就先执行切换准备：移除当前账号时 removeSavedAccount
      // 会经 switchAccount 取消防抖推送，跳过冲刷会让未推修改永远留在本地
      // 工作区（凭证同时被删除，补推需要重新添加账号）。冲刷在仍是当前账号
      // 的上下文中执行，推送使用该账号的数据与请求头。
      if (currentAccountId) {
        await prepareForAccountSwitch(currentAccountId);
      }
      useAppStore.getState().removeSavedAccount(targetAccountId);
      // 审计修复：移除当前账号时 removeSavedAccount 会自动切换到最近使用的
      // 备选账号，但该路径此前只刷新桥接——备选账号的 Token 若仅保存在本机，
      // 后端分区没有其凭据，代理请求会返回 GITHUB_TOKEN_NOT_CONFIGURED，且
      // 常规自动同步不上传 github_token，轮询无法自愈。删除完成后重新读取
      // 当前账号：若已自动切换到备选账号，复用与正常切换相同的后端对齐
      //（先补推再拉取）；没有备选账号时保持现有登出行为。
      const nextUser = useAppStore.getState().user;
      const nextAccountId = accountIdKey(nextUser);
      if (nextUser && nextAccountId && nextAccountId !== currentAccountId) {
        await alignTargetAccountOnBackend(
          nextAccountId,
          useAppStore.getState().githubToken ?? '',
          nextUser,
        );
      }
      refreshMcpBridgeSafely();
      return { ok: true };
    } finally {
      releaseAccountSwitchLock();
      setIsSwitching(false);
    }
  }, [alignTargetAccountOnBackend, refreshMcpBridgeSafely]);

  const logoutCurrentAccount = useCallback(async (expectedAccountId?: string): Promise<boolean> => {
    // 切换流程占用锁时明确返回失败，由调用方提示用户（绝不静默忽略退出）。
    if (!acquireAccountSwitchLock()) return false;
    setIsSwitching(true);
    try {
      const currentAccountId = accountIdKey(useAppStore.getState().user);
      // 审计修复（B9）：退出动作绑定打开确认框时的账号——期间账号已被切换
      // 时不执行退出，返回失败交由调用方提示对当前账号重新发起退出。
      if (expectedAccountId !== undefined && currentAccountId !== expectedAccountId) {
        return false;
      }
      await prepareForAccountSwitch(currentAccountId);
      // 冲刷在途同步期间账号仍可能被并发流程切换：store.logout 以期望账号做
      // 最终校验（拒绝时返回 false），绝不登出另一个账号。
      const loggedOut = useAppStore.getState().logout(expectedAccountId);
      if (loggedOut === false) return false;
      refreshMcpBridgeSafely();
      return true;
    } finally {
      releaseAccountSwitchLock();
      setIsSwitching(false);
    }
  }, [refreshMcpBridgeSafely]);

  return {
    isSwitching,
    parkCurrentAccountForRestore,
    switchToAccount,
    addAccountWithToken,
    addAccountFromBackend,
    removeAccount,
    logoutCurrentAccount,
  };
};
