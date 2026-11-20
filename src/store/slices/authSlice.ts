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
  bumpAccountSessionGeneration,
  captureAccountWorkspace,
  switchAccountWorkspace,
  workspaceHasRetainableData,
} from '../helpers/accountWorkspace';
import { initialGistSearchFilters, initialSearchFilters } from '../schema';
import { clearAuthMirror, writeAuthMirror, writeSessionBackendSecret } from '../persistence/authStorage';
import { syncGhAccountTokensFromState } from '../persistence/ghAccountSecrets';
import { forgetV19MigrationInputs } from '../persistence/v19MigrationInputs';

const nowIso = (): string => new Date().toISOString();

/** listsPush 的空闲快照：会话拆除/切换时重置旧会话的推送标记（形状与 resetListsPush 一致）。 */
const listsPushIdle = { isRunning: false, total: 0, done: 0, currentLabel: null, message: null, error: null };

/**
 * 从 savedAccounts 中剔除指定账号，保持其余条目引用不变。
 */
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
  | 'discardPartialLoginWorkspace' | 'restorePersistedAccountTokens'
>> = (set, get) => ({
      setUser: (user) => {
        logger.info('store.setUser', 'Setting user', { hasUser: !!user, userId: user?.id ?? null });
        const current = get();
        const previousAccountId = accountIdKey(current.user);
        const nextAccountId = accountIdKey(user);
        if (user && nextAccountId) {
          const switched = switchAccountWorkspace(current, previousAccountId, nextAccountId);
          if (nextAccountId !== previousAccountId) bumpAccountSessionGeneration();
          set({
            user,
            isAuthenticated: true,
            accountWorkspaces: switched.accountWorkspaces,
            // 会话代次递增后旧会话的 Lists 推送已失效：其 isRunning 标记不得
            // 残留到新账号（否则 pushCategoriesToLists 的重入保护会永久阻止
            // 新账号发起推送）；此刻新会话尚不可能已开始推送。
            ...(nextAccountId !== previousAccountId ? { listsPush: listsPushIdle } : {}),
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
          syncGhAccountTokensFromState(get());
        }
        writeAuthMirror({ user, githubToken, backendApiSecret });
      },
      setGitHubToken: (token) => {
        logger.info('store.setGitHubToken', 'Setting GitHub token', { hasToken: !!token });
        set({ githubToken: token });
        // 已有登录用户且 Token 非空时，同步刷新 savedAccounts 中该账号的 Token。
        // 审计修复（B3）：savedAccounts 尚无当前账号条目时（如 setUser(A) 先落、
        // Token 后到）也必须一并登记已验证用户与新 PAT，不能以旧条目存在为前提，
        // 否则 setUser(A) → setGitHubToken(A_PAT) 后 switchAccount(A) 拿不到凭证。
        const { user, backendApiSecret, savedAccounts } = get();
        const accountId = accountIdKey(user);
        if (user && accountId && token) {
          const existing = savedAccounts[accountId];
          const now = nowIso();
          set({
            savedAccounts: {
              ...savedAccounts,
              [accountId]: {
                accountId,
                user,
                githubToken: token,
                addedAt: existing?.addedAt ?? now,
                lastUsedAt: existing?.lastUsedAt ?? now,
              },
            },
          });
          syncGhAccountTokensFromState(get());
        }
        writeAuthMirror({ user, githubToken: token, backendApiSecret });
      },
      setBackendApiSecret: (backendApiSecret) => {
        writeSessionBackendSecret(backendApiSecret);
        set({ backendApiSecret });
        const { user, githubToken } = get();
        writeAuthMirror({ user, githubToken, backendApiSecret });
      },
      logout: (expectedAccountId) => {
        // 审计修复（B9）：退出确认绑定打开确认框时的账号——编排层在获取切换锁后
        // 传入期望账号标识；期间账号已被切换/变更时拒绝执行（返回 false），
        // 调用方提示用户对当前账号重新发起退出。
        const current = get();
        const currentAccountId = accountIdKey(current.user);
        if (expectedAccountId !== undefined && currentAccountId !== expectedAccountId) {
          logger.warn('store.logout', 'Refusing logout: session account changed since confirmation', {
            expectedAccountId,
            currentAccountId,
          });
          return false;
        }
        // Credential teardown only. Snapshot the GitHub-id workspace first, then
        // park the live lists so the login screen cannot inherit another account.
        bumpAccountSessionGeneration();
        const accountId = currentAccountId;
        const accountWorkspaces = accountId
          ? { ...current.accountWorkspaces, [accountId]: captureAccountWorkspace(current) }
          : current.accountWorkspaces;
        // 旧会话的 Lists 推送随会话拆除失效：清除其 isRunning 标记，避免残留
        // 标记通过重入保护阻止下一次登录后的推送（同 B4 的会话级重置语义）。
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
        // 第 12 轮审计 ISSUE-1(C)：登出必须让该账号的 v19 迁移输入立即失效。
        // 这次 set() 会同步触发 partialize——若迁移输入仍在，未确认态下
        // savedAccountsForShard 会把旧 PAT 回填进分片，下次启动即可凭旧记录
        // 一键恢复已退出账号（违反「退出即清除已保存 PAT」）。
        if (accountId) forgetV19MigrationInputs([accountId]);
        withAccountSwitchGuardSync(() => set({
          user: null,
          githubToken: null,
          backendApiSecret: null,
          isAuthenticated: false,
          accountWorkspaces,
          // 会话级刷新状态随会话拆除重置（B4）
          releaseIsRefreshing: false,
          // Fork 刷新标志同 B4 语义随会话拆除重置（第 12 轮审计修复）：旧账号
          // 的在途 Fork 刷新不得禁用登录后新会话的刷新入口；过期 finally 清理
          // 由 setForkIsRefreshing 的归属校验拦截。
          forkIsRefreshing: false,
          // 旧会话的 Lists 推送标记随会话拆除重置（同 B4 语义）
          listsPush: listsPushIdle,
          // 退出即清除当前账号已保存的 PAT：登录页不能凭旧记录一键恢复会话。
          savedAccounts: accountId && current.savedAccounts[accountId]
            ? {
                ...current.savedAccounts,
                [accountId]: { ...current.savedAccounts[accountId], githubToken: '' },
              }
            : current.savedAccounts,
          ...applyAccountWorkspace(undefined),
        }));
        // logout 保留其他账号的记录；当前账号仅保留资料与工作区，凭据已清除。
        // 被清除的当前账号 Token 也要从桌面端加密存储移除（B7）。显式移除列表
        // 保证即使磁盘映射未完整加载，也会真正删除该账号的 PAT（自审计补充）。
        // 第 12 轮审计修复：内存会话已在上方清除，设备端删除结果单独处理——
        // 删除失败（加密存储暂时不可写）时不得静默，记录告警；待删标记已随
        // 保存请求持久化（ghAccountSecrets），下次启动读取会继续屏蔽旧 PAT，
        // 水化收尾的重试（options.ts 无 Token 分支）会再次应用删除。UI 侧的
        // 「设备清理未完成」提示与重试入口由 hooks 层按
        // hasPendingGhAccountSecretRemovals() 消费。
        void syncGhAccountTokensFromState(get(), accountId ? [accountId] : []).then((deviceRemoved) => {
          if (!deviceRemoved) {
            logger.warn('store.logout', 'Device-side gh-account secret removal failed; old PAT stays masked until retry', {
              accountId: accountId ?? null,
            });
          }
        });
        return true;
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
        syncGhAccountTokensFromState(get());
      },
      switchAccount: (targetAccountId) => {
        const current = get();
        // 第 12 轮审计修复：先确认 targetAccountId 是 savedAccounts 自身的键——
        // 普通对象读取继承属性（如 'constructor'）会得到非账号值，后续
        // target.githubToken.trim() 会抛异常而不是返回 false。
        const target = Object.prototype.hasOwnProperty.call(current.savedAccounts, targetAccountId)
          ? current.savedAccounts[targetAccountId]
          : undefined;
        if (!target || !target.githubToken.trim()) return false;
        const currentAccountId = accountIdKey(current.user);
        if (currentAccountId === targetAccountId) {
          // 同账号：仅当当前会话已使用目标凭证且已认证时直接返回（刷新 lastUsedAt）。
          // 水化后可能出现 user 保留但顶层 githubToken 丢失/未认证的破损会话：
          // 此时同账号切换必须从 savedAccounts 恢复认证字段并同步认证镜像，
          // 否则调用方拿到 true 但登录态依旧是坏的（审计：Functional Correctness）。
          // 审计修复（B2）：同账号同凭证只刷新 lastUsedAt，不递增会话代次——
          // 递增会作废当前会话在途刷新的结果；仅恢复/使用不同凭证时才递增。
          const sessionUsesTargetCredentials = current.isAuthenticated
            && current.githubToken === target.githubToken;
          const now = nowIso();
          if (!sessionUsesTargetCredentials) {
            // 先推进会话代次，再同时提交新凭证与刷新状态重置，确保旧会话异步操作无法控制新会话加载状态
            bumpAccountSessionGeneration();
          }
          set({
            savedAccounts: {
              ...current.savedAccounts,
              [targetAccountId]: { ...target, lastUsedAt: now },
            },
            ...(sessionUsesTargetCredentials ? {} : {
              githubToken: target.githubToken,
              isAuthenticated: true,
              releaseIsRefreshing: false,
              // 会话代次已递增：旧会话的 Fork 刷新标志与 Lists 推送标记一并
              // 重置（同 B4 语义），防止残留标志阻止新会话操作。
              forkIsRefreshing: false,
              // 会话代次已递增：旧会话的 Lists 推送标记一并重置，防止
              // isRunning 残留阻止后续推送（同下方跨账号切换的语义）。
              listsPush: listsPushIdle,
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
        // 切换到不同账号：递增会话代次，作废旧账号会话的在途任务。
        bumpAccountSessionGeneration();
        const previousAccountId = currentAccountId;
        // Issue #611：切换会整体替换工作区。旧会话的待推防抖若在切换后触发，
        // 会把旧账号的（可能陈旧/为空的）快照以新账号请求头 isFullSync 推送，
        // 删除新账号后端分区中不在快照里的数据。取消待推并静音订阅。
        cancelPendingAccountSwitchPush();
        const switched = switchAccountWorkspace(current, previousAccountId, targetAccountId, { forceLoadTarget: true });
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
          // 审计修复（B4）：Release 刷新状态随账号会话重置——旧账号的在途刷新
          // 不得禁用新账号的刷新入口；其 finally 清理由
          // setReleaseIsRefreshing(false) 的归属会话校验拦截（preferenceSlice）。
          releaseIsRefreshing: false,
          // Fork 刷新标志同 B4 语义随账号切换重置（第 12 轮审计修复）：旧账号
          // 的在途 Fork 刷新不得禁用新账号的刷新按钮与账号选择器；过期 finally
          // 清理由 setForkIsRefreshing 的归属校验拦截（timelineSlice）。
          forkIsRefreshing: false,
          // 旧会话的 Lists 推送随会话切换失效：其 isRunning 标记不得残留到新
          // 账号（否则 pushCategoriesToLists 的重入保护会永久阻止新账号发起
          // 推送）；此刻新会话尚不可能已开始推送，重置不会误清新会话状态。
          listsPush: listsPushIdle,
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
        // 第 12 轮审计 ISSUE-1(C)：移除账号即让该账号的 v19 迁移输入失效——
        // 与登出同语义，后续 partialize 不得把旧 PAT 回填进分片。
        forgetV19MigrationInputs([accountId]);
        if (accountId !== currentAccountId) {
          // 移除非当前账号：仅删除保存的凭证，保留其 accountWorkspaces 数据
          set({ savedAccounts: excludeSavedAccount(current.savedAccounts, accountId) });
          // 审计修复（R2-B2）：被移除账号的 Token 也要从桌面端加密存储移除
          //（与当前账号移除分支一致），gh-accounts.enc 只保留剩余账号的 PAT。
          syncGhAccountTokensFromState(get(), [accountId]);
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
          // 被移除账号的 Token 同步从桌面端加密存储移除（B7）。
          syncGhAccountTokensFromState(get(), [accountId]);
          return;
        }
        get().logout();
        set({ savedAccounts: excludeSavedAccount(get().savedAccounts, accountId) });
        syncGhAccountTokensFromState(get(), [accountId]);
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
          // 凭证必须随 user 一起清空（审计修复）：仅清 user 会留下「无归属用户
          // 的在内存 Token」，mirror 与 Store 的登录态判断分裂；恢复流程中途
          // 抛错时，以 githubToken 为守卫的逻辑会继续用被归档账号的凭据发请求。
          githubToken: null,
          // 保持 isAuthenticated 原值：LoginScreen 恢复流程（未登录）停留在登录页，
          // AddAccountModal 后端恢复流程（已登录）保持主界面与弹窗挂载不被卸载。
          isAuthenticated: current.isAuthenticated,
          accountWorkspaces: {
            ...current.accountWorkspaces,
            [previousAccountId]: parked,
          },
          // 索引任务随账号切换中止；不复位会让新账号设置面板永久显示「索引中」
          vectorIndexingState: { isIndexing: false, phase: null, phaseDone: 0, phaseTotal: 0, result: null },
          // Release 刷新状态随归档中止（B4）：被归档账号的在途刷新不再禁用
          // 恢复后新会话的刷新入口
          releaseIsRefreshing: false,
          // Fork 刷新标志同 B4 语义随归档中止（第 12 轮审计修复）
          forkIsRefreshing: false,
          ...applyAccountWorkspace(undefined),
        }));
        writeAuthMirror({ user: null, githubToken: null, backendApiSecret: current.backendApiSecret });
        logger.info('store.parkCurrentAccountForRestore', 'Parked account workspace for external restore', {
          accountId: previousAccountId,
        });
        return previousAccountId;
      },

      /**
       * 丢弃一次未完成登录残留在顶层工作区的部分同步数据（Issue #611 审计修复）。
       * 后端同步失败回滚登录态时调用：只清 user/githubToken 会让下一次登录的
       * park 返回 null（无当前用户不归档）、switchAccountWorkspace 在顶层已有
       * 数据时保留顶层——残留数据会串到下一个登录的账号。这里把顶层工作区
       * 重置为空；与 park 不同，绝不归档（未完成同步的数据不能存为任何账号
       * 的快照）。
       * 审计修复（R2-B10）：restoreWorkspace 为拉取发起前捕获的顶层快照——
       * park 未能归档的无主残留（如旧版顶层缓存）不属于本次拉取写入的数据，
       * 丢弃拉取残留后原样恢复，防止误清无法从 GitHub 重同步的自定义分类/顺序。
       */
      discardPartialLoginWorkspace: (restoreWorkspace?: import('../../types').AccountWorkspace | null) => {
        // 回滚时推送通道已失去账号上下文：取消旧会话的待推防抖并静音本次
        // 重置，防止空快照/无主快照以无账号请求头（服务端回退
        // active_account_id 分区）isFullSync 推送出去。
        cancelPendingAccountSwitchPush();
        resetSyncHashes();
        // 第 12 轮审计 ISSUE-1：与登录页/switchAccountWorkspace 共用同一个
        // 「工作区是否有可保留数据」判定——订阅/已读/自定义来源设置同样要恢复。
        const restore = restoreWorkspace
          && (workspaceHasRetainableData(restoreWorkspace)
            || restoreWorkspace.syncModeConfigured === true)
          ? restoreWorkspace
          : undefined;
        withAccountSwitchGuardSync(() => {
          set({ ...applyAccountWorkspace(restore) });
        });
        logger.info('store.discardPartialLoginWorkspace', 'Discarded partially synced top-level workspace after failed login', {
          restoredPrePullResidue: !!restore,
        });
      },

      /**
       * 水化后从桌面端安全存储回填账号 Token（审计修复 B7）：持久化分片只含
       * savedAccounts 非敏感元数据，PAT 存于 gh-accounts.enc。仅补全缺失 Token
       * 的既有条目；当前登录会话缺 Token 且安全存储有其凭证时一并恢复登录态。
       * Web 构建（无 IPC 桥）不会走到这里——PAT 不持久化，要求重新授权。
       */
      restorePersistedAccountTokens: (tokens) => {
        const current = get();
        const savedAccounts = { ...current.savedAccounts };
        let touched = false;
        for (const [accountId, token] of Object.entries(tokens)) {
          if (!/^\d{1,20}$/.test(accountId)) continue;
          if (typeof token !== 'string' || !token.trim()) continue;
          const existing = savedAccounts[accountId];
          if (existing && !existing.githubToken) {
            savedAccounts[accountId] = { ...existing, githubToken: token };
            touched = true;
          }
        }
        const currentAccountId = accountIdKey(current.user);
        const currentToken = currentAccountId ? tokens[currentAccountId] : undefined;
        const sessionNeedsToken = !!currentAccountId
          && !current.githubToken
          && typeof currentToken === 'string'
          && !!currentToken.trim();
        if (!touched && !sessionNeedsToken) return;
        set({
          savedAccounts,
          ...(sessionNeedsToken ? { githubToken: currentToken, isAuthenticated: true } : {}),
        });
        writeAuthMirror({
          user: current.user,
          githubToken: sessionNeedsToken ? currentToken : current.githubToken,
          backendApiSecret: current.backendApiSecret,
        });
        logger.info('store.restorePersistedAccountTokens', 'Restored account tokens from desktop secure storage', {
          restored: Object.keys(savedAccounts).filter((id) => savedAccounts[id]?.githubToken).length,
          sessionRestored: sessionNeedsToken,
        });
      },

});
