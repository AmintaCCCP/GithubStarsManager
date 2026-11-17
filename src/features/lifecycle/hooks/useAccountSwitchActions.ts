import { useCallback, useState } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { accountIdKey, applyAccountWorkspace } from '../../../store/helpers/accountWorkspace';
import { backend, isValidBackendRestoreAccount } from '../../../services/backendAdapter';
import {
  consumePendingAccountSync,
  prepareForAccountSwitch,
  syncFromBackend,
  syncToBackend,
  withAccountSwitchGuard,
  withAccountSwitchGuardSync,
} from '../../../services/autoSync';
import { refreshMcpElectronBridge } from '../../../services/mcpElectronBridge';
import { useLoginActions } from './useLoginActions';
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
  addAccountWithToken: (token: string) => Promise<AddAccountResult>;
  /** AddAccountModal 后端恢复模式：连接后端并恢复其活跃账号（已登录时先安全归档当前账号） */
  addAccountFromBackend: (url: string, secret: string) => Promise<AddAccountResult>;
  /** 从已保存账号列表移除指定账号（保留其本地工作区数据） */
  removeAccount: (targetAccountId: string) => Promise<void>;
  /** 退出登录（含二次确认调用方） */
  logoutCurrentAccount: () => Promise<void>;
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

  /** 外部恢复失败/取消时，把被归档的当前账号工作区与凭证原样恢复（零丢失）。 */
  const recoverParkedAccount = useCallback((parkedAccountId: string | null): void => {
    if (!parkedAccountId) return;
    const state = useAppStore.getState();
    if (state.user) return; // 已成功登录另一账号，无需恢复
    const saved = state.savedAccounts[parkedAccountId];
    const workspace = state.accountWorkspaces[parkedAccountId];
    // 恢复写入同样属于切换簿记：静音订阅，避免工作区回放在无账号上下文下
    // 触发 isFullSync 推送（失败且无 savedAccount 时 user 仍为 null）。
    withAccountSwitchGuardSync(() => {
      if (workspace) {
        useAppStore.setState(applyAccountWorkspace(workspace));
      }
      if (saved) {
        state.setGitHubToken(saved.githubToken);
        state.setUser(saved.user);
      }
    });
  }, []);

  /**
   * 切换/添加完成后的后端对齐（步骤 5）。
   * 必须携带 user_profile：accounts.user_json 的唯一写入路径就是
   * PUT /api/settings 的 user_profile 字段，否则后端恢复的账号列表没有头像/昵称。
   * 冲刷失败遗留的账号级待推状态在这里消费：切回该账号后先补推本地工作区
   * （含未推修改），再拉取后端——顺序绝不能颠倒，否则非强制拉取会用后端旧
   * 快照覆盖未推送的本地修改（数据丢失红线）。
   */
  const alignTargetAccountOnBackend = useCallback(async (accountId: string, token: string, user: GitHubUser): Promise<void> => {
    if (!backend.isAvailable) return;
    try {
      await backend.syncSettings({
        github_token: token,
        active_account_id: accountId,
        user_profile: user,
      });
    } catch (error) {
      console.warn('Failed to align account settings on backend:', error);
    }
    try {
      // 冲刷失败遗留：先补推本地工作区（推送失败时标志置回，非强制拉取会被
      // 跳过，后端旧快照无法覆盖本地修改），成功后再拉取后端。
      if (consumePendingAccountSync(accountId)) {
        await syncToBackend();
      }
      // force=false：后端已有数据则合并；后端分区为空而本地有数据时，
      // autoSync 的空保护会自动把本地该账号数据补推到 targetAccountId 分区。
      await syncFromBackend({ force: false });
    } catch (error) {
      console.warn('Failed to pull target account data from backend:', error);
    }
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
      refreshMcpElectronBridge();
      return { ok: true };
    } catch (error) {
      console.error('Account switch failed:', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      releaseAccountSwitchLock();
      setIsSwitching(false);
    }
  }, [alignTargetAccountOnBackend]);

  const addAccountWithToken = useCallback(async (token: string): Promise<AddAccountResult> => {
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

      // 校验等待期间会话可能已被其他路径改变：以当前 Store 状态为准
      const latest = useAppStore.getState();
      const currentAccountId = accountIdKey(latest.user);
      if (currentAccountId === targetAccountId) {
        // 同一账号重复添加：仅更新 Token
        withAccountSwitchGuardSync(() => {
          latest.setGitHubToken(token);
          latest.setUser(user);
        });
        return { ok: true, user };
      }

      await prepareForAccountSwitch(currentAccountId);
      await withAccountSwitchGuard(async () => {
        // R2 预防：先把当前已登录账号工作区安全归档并清空顶层，再落新账号
        parkedAccountId = useAppStore.getState().parkCurrentAccountForRestore();
        useAppStore.getState().setGitHubToken(token);
        useAppStore.getState().setUser(user);
      });
      await alignTargetAccountOnBackend(targetAccountId, token, user);
      refreshMcpElectronBridge();
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
  }, [alignTargetAccountOnBackend, authenticateWithGitHub, recoverParkedAccount]);

  const addAccountFromBackend = useCallback(async (url: string, secret: string): Promise<AddAccountResult> => {
    if (!acquireAccountSwitchLock()) {
      return { ok: false, error: 'switch-in-progress' };
    }
    setIsSwitching(true);
    const previousSecret = useAppStore.getState().backendApiSecret;
    const currentAccountId = accountIdKey(useAppStore.getState().user);
    let parkedAccountId: string | null = null;
    let succeeded = false;
    try {
      // 切换后端前先在旧 URL/旧密钥上下文下排空旧后端的推送与在途同步；
      // 恢复期间由 withAccountSwitchGuard 静音订阅，阻止新推送把旧账号数据
      // 发送到新后端（backend.init 提交新 URL 后，晚启动的推送会以旧密钥与
      // 旧账号请求头写入新后端分区——审计：Data Integrity）。
      await prepareForAccountSwitch(currentAccountId);
      // 候选 API Key 必须在恢复/校验请求之前写入 Store：verifyAuth 与
      // restoreAuth 通过 getBackendAuthHeaders() 读取 Store 密钥，不传入参。
      // 否则目标后端使用不同 Key 时会以旧密钥校验并返回 unauthorized。
      useAppStore.getState().setBackendApiSecret(secret);
      const result = await withAccountSwitchGuard(() => restoreBackendSession(url));
      if (result.status === 'backend-unavailable') return { ok: false, error: 'backend-unavailable' };
      if (result.status === 'unauthorized') return { ok: false, error: 'unauthorized' };
      if (result.status === 'restore-failed') return { ok: false, error: 'restore-failed' };
      if (result.status === 'restored-token-invalid' || result.status === 'github-token-required') {
        return { ok: false, error: result.status };
      }

      const targetAccountId = accountIdKey(result.user);
      if (!targetAccountId) return { ok: false, error: 'invalid-github-user' };

      if (currentAccountId && targetAccountId !== currentAccountId) {
        // R2 预防：拉取后端数据写入 Store 前先归档当前账号
        await prepareForAccountSwitch(currentAccountId);
        parkedAccountId = parkCurrentAccountForRestore();
      }

      await withAccountSwitchGuard(async () => {
        useAppStore.getState().setBackendApiSecret(secret);
        useAppStore.getState().setGitHubToken(result.githubToken);
        useAppStore.getState().setUser(result.user);
      });
      // 登记后端保存的全部有效账号（与 tryRestoreAuthFromBackend / 登录页
      // handleBackendConnect 共用同一过滤规则），否则新设备连接后端后
      // 账号下拉菜单只显示当前账号。
      for (const account of result.accounts) {
        if (!isValidBackendRestoreAccount(account)) continue;
        useAppStore.getState().upsertSavedAccount(account.user, account.githubToken);
      }
      await alignTargetAccountOnBackend(targetAccountId, result.githubToken, result.user);
      refreshMcpElectronBridge();
      succeeded = true;
      return { ok: true, user: result.user };
    } catch (error) {
      console.error('Restore account from backend failed:', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      if (!succeeded) {
        // 每个失败返回路径都必须恢复原密钥：失败的候选密钥绝不能残留
        //（包括当前账号仍处于登录态、原有 !user 条件不成立的情况）。
        useAppStore.getState().setBackendApiSecret(previousSecret);
        // 恢复失败/取消：归档的原账号原样恢复，当前会话毫发无损
        recoverParkedAccount(parkedAccountId);
      }
      releaseAccountSwitchLock();
      setIsSwitching(false);
    }
  }, [recoverParkedAccount, restoreBackendSession, alignTargetAccountOnBackend, parkCurrentAccountForRestore]);

  const removeAccount = useCallback(async (targetAccountId: string): Promise<void> => {
    if (!acquireAccountSwitchLock()) return;
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
      refreshMcpElectronBridge();
    } finally {
      releaseAccountSwitchLock();
      setIsSwitching(false);
    }
  }, []);

  const logoutCurrentAccount = useCallback(async (): Promise<void> => {
    if (!acquireAccountSwitchLock()) return;
    setIsSwitching(true);
    try {
      const currentAccountId = accountIdKey(useAppStore.getState().user);
      await prepareForAccountSwitch(currentAccountId);
      useAppStore.getState().logout();
      refreshMcpElectronBridge();
    } finally {
      releaseAccountSwitchLock();
      setIsSwitching(false);
    }
  }, []);

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
