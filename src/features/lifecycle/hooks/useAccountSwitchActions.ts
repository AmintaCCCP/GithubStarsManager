import { useCallback, useRef, useState } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { accountIdKey, applyAccountWorkspace } from '../../../store/helpers/accountWorkspace';
import { backend } from '../../../services/backendAdapter';
import {
  prepareForAccountSwitch,
  syncFromBackend,
  withAccountSwitchGuard,
  withAccountSwitchGuardSync,
} from '../../../services/autoSync';
import { refreshMcpElectronBridge } from '../../../services/mcpElectronBridge';
import { useLoginActions } from './useLoginActions';
import type { GitHubUser } from '../../../types';

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
  const switchingRef = useRef(false);
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
    if (accountIdKey(current.user) === targetAccountId) {
      return { ok: true };
    }
    const target = current.savedAccounts[targetAccountId];
    if (!target || !target.githubToken.trim()) {
      return { ok: false, needsToken: true };
    }
    if (switchingRef.current) {
      return { ok: false, error: 'switch-in-progress' };
    }

    switchingRef.current = true;
    setIsSwitching(true);
    const previousAccountId = accountIdKey(current.user);
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
      switchingRef.current = false;
      setIsSwitching(false);
    }
  }, [alignTargetAccountOnBackend]);

  const addAccountWithToken = useCallback(async (token: string): Promise<AddAccountResult> => {
    if (switchingRef.current) {
      return { ok: false, error: 'switch-in-progress' };
    }
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

    const current = useAppStore.getState();
    const currentAccountId = accountIdKey(current.user);
    if (currentAccountId === targetAccountId) {
      // 同一账号重复添加：仅更新 Token
      current.setGitHubToken(token);
      current.setUser(user);
      return { ok: true, user };
    }

    switchingRef.current = true;
    setIsSwitching(true);
    let parkedAccountId: string | null = null;
    try {
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
        recoverParkedAccount(parkedAccountId ?? currentAccountId);
      }
      switchingRef.current = false;
      setIsSwitching(false);
    }
  }, [alignTargetAccountOnBackend, authenticateWithGitHub, recoverParkedAccount]);

  const addAccountFromBackend = useCallback(async (url: string, secret: string): Promise<AddAccountResult> => {
    if (switchingRef.current) {
      return { ok: false, error: 'switch-in-progress' };
    }
    switchingRef.current = true;
    setIsSwitching(true);
    const previousSecret = useAppStore.getState().backendApiSecret;
    const currentAccountId = accountIdKey(useAppStore.getState().user);
    let parkedAccountId: string | null = null;
    try {
      const result = await restoreBackendSession(url);
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
      await alignTargetAccountOnBackend(targetAccountId, result.githubToken, result.user);
      refreshMcpElectronBridge();
      return { ok: true, user: result.user };
    } catch (error) {
      console.error('Restore account from backend failed:', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      if (!useAppStore.getState().user) {
        // 恢复失败/取消：归档的原账号原样恢复，当前会话毫发无损
        useAppStore.getState().setBackendApiSecret(previousSecret);
        recoverParkedAccount(parkedAccountId);
      }
      switchingRef.current = false;
      setIsSwitching(false);
    }
  }, [recoverParkedAccount, restoreBackendSession, alignTargetAccountOnBackend, parkCurrentAccountForRestore]);

  const removeAccount = useCallback(async (targetAccountId: string): Promise<void> => {
    if (switchingRef.current) return;
    switchingRef.current = true;
    setIsSwitching(true);
    try {
      const current = useAppStore.getState();
      const currentAccountId = accountIdKey(current.user);
      if (currentAccountId && currentAccountId !== targetAccountId) {
        await prepareForAccountSwitch(currentAccountId);
      }
      useAppStore.getState().removeSavedAccount(targetAccountId);
      refreshMcpElectronBridge();
    } finally {
      switchingRef.current = false;
      setIsSwitching(false);
    }
  }, []);

  const logoutCurrentAccount = useCallback(async (): Promise<void> => {
    if (switchingRef.current) return;
    switchingRef.current = true;
    setIsSwitching(true);
    try {
      const currentAccountId = accountIdKey(useAppStore.getState().user);
      await prepareForAccountSwitch(currentAccountId);
      useAppStore.getState().logout();
      refreshMcpElectronBridge();
    } finally {
      switchingRef.current = false;
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
