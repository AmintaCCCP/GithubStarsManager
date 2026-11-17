import { logger } from '../../services/logger';
import {
  cancelPendingAccountSwitchPush,
  resetSyncHashes,
  withAccountSwitchGuardSync,
} from '../../services/autoSync';
import type { AppStoreSlice } from '../types';
import {
  accountIdKey,
  applyAccountWorkspace,
  captureAccountWorkspace,
  switchAccountWorkspace,
} from '../helpers/accountWorkspace';
import { initialGistSearchFilters, initialSearchFilters } from '../schema';
import { clearAuthMirror, writeAuthMirror, writeSessionBackendSecret } from '../persistence/authStorage';

const nowIso = (): string => new Date().toISOString();

/** 从 savedAccounts 中剔除指定账号，保持其余条目引用不变。 */
const excludeSavedAccount = (
  savedAccounts: Record<string, import('../../types').SavedAccount>,
  accountId: string,
): Record<string, import('../../types').SavedAccount> => {
  if (!(accountId in savedAccounts)) return savedAccounts;
  const rest: Record<string, import('../../types').SavedAccount> = {};
  for (const [key, value] of Object.entries(savedAccounts)) {
    if (key !== accountId) rest[key] = value;
  }
  return rest;
};

export const createAuthSlice: AppStoreSlice<Pick<import('../types').AppActions,
  'setUser' | 'setGitHubToken' | 'setBackendApiSecret' | 'logout'
  | 'upsertSavedAccount' | 'switchAccount' | 'removeSavedAccount' | 'parkCurrentAccountForRestore'
>> = (set, get) => ({
      setUser: (user) => {
        logger.info('store.setUser', 'Setting user', { hasUser: !!user, userId: user?.id ?? null });
        const current = get();
        const previousAccountId = accountIdKey(current.user);
        const nextAccountId = accountIdKey(user);
        if (user && nextAccountId) {
          const switched = switchAccountWorkspace(current, previousAccountId, nextAccountId);
          set({
            user,
            isAuthenticated: true,
            accountWorkspaces: switched.accountWorkspaces,
            ...(switched.workspace ?? {}),
          });
        } else {
          set({ user, isAuthenticated: !!user });
        }
        // 无论首次登录、重新登录还是测试代码调用 setGitHubToken + setUser，
        // 只要有有效 Token 就把当前账号自动登记进 savedAccounts（Issue #611）。
        const { githubToken, backendApiSecret, savedAccounts } = get();
        if (user && nextAccountId && githubToken) {
          const existing = savedAccounts[nextAccountId];
          const now = nowIso();
          set({
            savedAccounts: {
              ...savedAccounts,
              [nextAccountId]: {
                accountId: nextAccountId,
                user,
                githubToken,
                addedAt: existing?.addedAt ?? now,
                lastUsedAt: now,
              },
            },
          });
        }
        writeAuthMirror({ user, githubToken, backendApiSecret });
      },
      setGitHubToken: (token) => {
        logger.info('store.setGitHubToken', 'Setting GitHub token', { hasToken: !!token });
        set({ githubToken: token });
        // 已有登录用户且 Token 非空时，同步刷新 savedAccounts 中该账号的 Token。
        const { user, backendApiSecret, savedAccounts } = get();
        const accountId = accountIdKey(user);
        if (user && accountId && token) {
          const existing = savedAccounts[accountId];
          if (existing) {
            set({
              savedAccounts: {
                ...savedAccounts,
                [accountId]: { ...existing, user, githubToken: token },
              },
            });
          }
        }
        writeAuthMirror({ user, githubToken: token, backendApiSecret });
      },
      setBackendApiSecret: (backendApiSecret) => {
        writeSessionBackendSecret(backendApiSecret);
        set({ backendApiSecret });
        const { user, githubToken } = get();
        writeAuthMirror({ user, githubToken, backendApiSecret });
      },
      logout: () => {
        // Credential teardown only. Snapshot the GitHub-id workspace first, then
        // park the live lists so the login screen cannot inherit another account.
        const current = get();
        const accountId = accountIdKey(current.user);
        const accountWorkspaces = accountId
          ? { ...current.accountWorkspaces, [accountId]: captureAccountWorkspace(current) }
          : current.accountWorkspaces;
        clearAuthMirror();
        writeSessionBackendSecret(null);
        // Issue #611：登出后推送通道失去账号上下文（无 X-GitHub-Account-Id，
        // 后端回退 active_account_id 分区），旧会话的待推防抖与本次工作区清空
        // 都绝不能触发 isFullSync 推送，否则会把空快照写入上一账号分区。
        cancelPendingAccountSwitchPush();
        // Reset sync fingerprints so the next force sync (e.g. backend
        // login restore) applies every shard even if the backend data has
        // not changed since this session.
        resetSyncHashes();
        withAccountSwitchGuardSync(() => set({
          user: null,
          githubToken: null,
          backendApiSecret: null,
          isAuthenticated: false,
          accountWorkspaces,
          ...applyAccountWorkspace(undefined),
        }));
        // logout 保留 savedAccounts 中的历史账号记录：用户停留在 LoginScreen
        // 时仍可一键恢复会话，或从下拉菜单直接切换账号。
      },
      upsertSavedAccount: (user, githubToken) => {
        const accountId = accountIdKey(user);
        if (!accountId) return;
        const { savedAccounts } = get();
        const existing = savedAccounts[accountId];
        const now = nowIso();
        set({
          savedAccounts: {
            ...savedAccounts,
            [accountId]: {
              accountId,
              user,
              githubToken,
              addedAt: existing?.addedAt ?? now,
              lastUsedAt: now,
            },
          },
        });
      },
      switchAccount: (targetAccountId) => {
        const current = get();
        const target = current.savedAccounts[targetAccountId];
        if (!target || !target.githubToken.trim()) return false;
        const currentAccountId = accountIdKey(current.user);
        if (currentAccountId === targetAccountId) {
          // 同账号：仅当当前会话已使用目标凭证且已认证时直接返回（刷新 lastUsedAt）。
          // 水化后可能出现 user 保留但顶层 githubToken 丢失/未认证的破损会话：
          // 此时同账号切换必须从 savedAccounts 恢复认证字段并同步认证镜像，
          // 否则调用方拿到 true 但登录态依旧是坏的（审计：Functional Correctness）。
          const sessionUsesTargetCredentials = current.isAuthenticated
            && current.githubToken === target.githubToken;
          const now = nowIso();
          set({
            savedAccounts: {
              ...current.savedAccounts,
              [targetAccountId]: { ...target, lastUsedAt: now },
            },
            ...(sessionUsesTargetCredentials ? {} : {
              githubToken: target.githubToken,
              isAuthenticated: true,
            }),
          });
          if (!sessionUsesTargetCredentials) {
            writeAuthMirror({
              user: target.user,
              githubToken: target.githubToken,
              backendApiSecret: current.backendApiSecret,
            });
          }
          return true;
        }
        const previousAccountId = currentAccountId;
        // Issue #611：切换会整体替换工作区。旧会话的待推防抖若在切换后触发，
        // 会把旧账号的（可能陈旧/为空的）快照以新账号请求头 isFullSync 推送，
        // 删除新账号后端分区中不在快照里的数据。取消待推并静音订阅。
        cancelPendingAccountSwitchPush();
        const switched = switchAccountWorkspace(current, previousAccountId, targetAccountId);
        const now = nowIso();
        const savedAccounts = {
          ...current.savedAccounts,
          ...(previousAccountId && current.savedAccounts[previousAccountId]
            ? {
                [previousAccountId]: {
                  ...current.savedAccounts[previousAccountId],
                  lastUsedAt: now,
                },
              }
            : {}),
          [targetAccountId]: { ...target, lastUsedAt: now },
        };
        withAccountSwitchGuardSync(() => set({
          user: target.user,
          githubToken: target.githubToken,
          isAuthenticated: true,
          accountWorkspaces: switched.accountWorkspaces,
          savedAccounts,
          ...(switched.workspace ?? {}),
          // 重置会话级瞬态 UI 状态，防止旧账号视图状态残留到新账号
          selectedCategory: 'all',
          currentView: 'repositories',
          searchFilters: {
            ...initialSearchFilters,
            sortBy: current.searchFilters.sortBy,
            sortOrder: current.searchFilters.sortOrder,
          },
          gistSearchFilters: {
            ...initialGistSearchFilters,
            sortBy: current.gistSearchFilters.sortBy,
            sortOrder: current.gistSearchFilters.sortOrder,
          },
          releaseExpandedRepositories: new Set<number>(),
          forkExpandedRepositories: new Set<number>(),
          releaseSelectedFilters: [],
          releaseSearchQuery: '',
          forkSelectedFilters: [],
          forkSearchQuery: '',
          analysisProgress: { current: 0, total: 0 },
          vectorIndexingState: { isIndexing: false, phase: null, phaseDone: 0, phaseTotal: 0, result: null },
          similarView: null,
          readmeModalOpen: false,
        }));
        resetSyncHashes();
        writeAuthMirror({
          user: target.user,
          githubToken: target.githubToken,
          backendApiSecret: current.backendApiSecret,
        });
        return true;
      },
      removeSavedAccount: (accountId) => {
        const current = get();
        const currentAccountId = accountIdKey(current.user);
        if (accountId !== currentAccountId) {
          // 移除非当前账号：仅删除保存的凭证，保留其 accountWorkspaces 数据
          set({ savedAccounts: excludeSavedAccount(current.savedAccounts, accountId) });
          return;
        }
        // 移除当前账号：优先切换到最近使用的其他已保存账号；没有则登出
        const remaining = Object.values(current.savedAccounts)
          .filter((acc) => acc.accountId !== accountId && acc.githubToken.trim())
          .sort((a, b) => (a.lastUsedAt < b.lastUsedAt ? 1 : a.lastUsedAt > b.lastUsedAt ? -1 : 0));
        const next = remaining[0];
        if (next) {
          get().switchAccount(next.accountId);
          set({ savedAccounts: excludeSavedAccount(get().savedAccounts, accountId) });
          return;
        }
        get().logout();
        set({ savedAccounts: excludeSavedAccount(get().savedAccounts, accountId) });
      },
      parkCurrentAccountForRestore: () => {
        const current = get();
        const previousAccountId = accountIdKey(current.user);
        if (!previousAccountId) return null;
        const parked = captureAccountWorkspace(current);
        // Issue #611：归档会清空顶层工作区并把 user 置空。取消旧会话的待推
        // 防抖并静音本次订阅，防止 2s 后以无账号请求头（后端回退
        // active_account_id 分区）把空快照 isFullSync 推送出去。
        cancelPendingAccountSwitchPush();
        resetSyncHashes();
        withAccountSwitchGuardSync(() => set({
          user: null,
          // 保持 isAuthenticated 原值：LoginScreen 恢复流程（未登录）停留在登录页，
          // AddAccountModal 后端恢复流程（已登录）保持主界面与弹窗挂载不被卸载。
          isAuthenticated: current.isAuthenticated,
          accountWorkspaces: {
            ...current.accountWorkspaces,
            [previousAccountId]: parked,
          },
          ...applyAccountWorkspace(undefined),
        }));
        writeAuthMirror({ user: null, githubToken: null, backendApiSecret: current.backendApiSecret });
        logger.info('store.parkCurrentAccountForRestore', 'Parked account workspace for external restore', {
          accountId: previousAccountId,
        });
        return previousAccountId;
      },

});
