import { useT } from "../i18n/useT";
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, Database, Key, Link, Loader2, Moon, Sun } from 'lucide-react';
import { Github } from './ui/brand-icons';
import { useAppStore } from '../store/useAppStore';
import { resolveTheme } from '../store/selectors';
import { useOptionalDialog } from '../hooks/useDialog';
import { useShallow } from 'zustand/react/shallow';
import { normalizeBackendRestoreAccount, useLoginActions, type BackendAuthRestoreAccount } from '../features/lifecycle/hooks/useLoginActions';
import { markPendingBackendCredentialAlign, useAccountSwitchActions } from '../features/lifecycle/hooks/useAccountSwitchActions';
import { safeReadText } from '../utils/clipboardUtils';
import { normalizeBackendUrl } from '../utils/backendUrl';
import {
  accountIdKey,
  applyAccountWorkspace,
  captureAccountWorkspace,
  getAccountSessionGeneration,
  isSavedAccountRemovedInSession,
  workspaceHasRetainableData,
  type AccountWorkspace,
} from '../store/helpers/accountWorkspace';
import {
  mergeWorkspaceCategorySettings,
  mergeWorkspacesById,
} from '../utils/backupWorkspace';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { APP_LANGUAGES, type AppLanguage } from '../i18n/languages';
import { GitHubTokenPermissions } from './GitHubTokenPermissions';
import { cn } from '../lib/utils';

/** GitHub-contribution-heatmap style band across the top of the login card:
 *  deterministic pseudo-random cells with four intensity levels, fading
 *  towards the bottom. Sized for the widest card layout; clipped on narrow ones. */
const HEATMAP_ROWS = 4;
const HEATMAP_COLS = 66;
const HEATMAP_PITCH = 13;
const HEATMAP_CELL = 10;

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HEATMAP_CELLS = (() => {
  const random = mulberry32(20261001);
  const levelOpacity = [0, 0.07, 0.14, 0.24];
  const rowFade = [1, 0.7, 0.4, 0.15];
  const cells: Array<{ x: number; y: number; opacity: number }> = [];
  for (let row = 0; row < HEATMAP_ROWS; row += 1) {
    for (let col = 0; col < HEATMAP_COLS; col += 1) {
      const roll = random();
      const level = roll < 0.32 ? 0 : roll < 0.62 ? 1 : roll < 0.86 ? 2 : 3;
      const opacity = levelOpacity[level] * rowFade[row];
      if (opacity <= 0) continue;
      cells.push({ x: col * HEATMAP_PITCH, y: row * HEATMAP_PITCH, opacity });
    }
  }
  return cells;
})();

function LoginCardPattern() {
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute left-6 top-7 h-[49px] w-[calc(100%-48px)]"
    >
      {HEATMAP_CELLS.map((cell, index) => (
        <rect
          key={index}
          x={cell.x}
          y={cell.y}
          width={HEATMAP_CELL}
          height={HEATMAP_CELL}
          rx="2"
          fill="currentColor"
          fillOpacity={cell.opacity}
        />
      ))}
    </svg>
  );
}

/**
 * syncBackendData（useLoginActions 透传 services/autoSync 的 syncFromBackend）
 * 返回的分片成败——结构与 autoSync 的 SyncFromBackendPullResult 一致（D 域接口
 * 透传；视图层按结构引用，不直接 import 业务服务，字段增删由调用侧类型检查守卫）。
 * null = 拉取未执行/被丢弃/失败。
 */
interface LoginPullShardResult {
  shards: {
    settings: boolean;
    releases: boolean;
  };
}

/**
 * 审计修复（R13 finding 36）：覆盖恢复拉取自被 park/discard 清空的顶层——
 * settings 或 releases 分片读取失败时（syncFromBackend 只记录该分片不可用，
 * 不抛错），applyBackendSettings/setReleases 不执行，顶层保留空默认值；直接
 * 把 captureAccountWorkspace 结果写入目标账号归档会用默认值覆盖该账号原有的
 * 分类与发布数据。写入归档前把「读取失败」分片对应的目标账号原归档字段
 * （accountWorkspaces[target] = park 刚归档的本机实时数据或既有归档快照）
 * 叠加回拉取快照：失败分片的字段保持原归档值，成功分片照常覆盖为拉取值
 * （数据为空≠失败）。回退字段集 = 两个分片实际写入顶层工作区的字段
 * （applyBackendSettings 的 settings 覆盖面 ∩ AccountWorkspace：
 * customCategories/hiddenDefaultCategoryIds/categoryOrder/defaultCategoryOverrides/
 * releaseSourceSettings；setReleases 的 releases）；可选全局配置分片
 * （ai/webdav/embedding/vectorSearch）按 finding 语义不纳入强制回退。
 * pullResult 为 null（拉取未执行/被丢弃/失败）时保持现行为——严格拉取路径的
 * 丢弃与失败已抛错走既有回滚，此处不重复处理。
 */
const overlayUnfetchedShardsFromPreviousArchive = (
  pullResult: LoginPullShardResult | null | undefined,
  pulledWorkspace: AccountWorkspace,
  previousArchive: AccountWorkspace | undefined,
): AccountWorkspace => {
  if (!previousArchive) return pulledWorkspace;
  const overlaySettings = Boolean(pullResult && !pullResult.shards.settings);
  const overlayReleases = Boolean(pullResult && !pullResult.shards.releases);
  return {
    ...pulledWorkspace,
    // 审计修复（finding 27）：后端拉取不包含 Gist、Fork、已读状态与发布订阅
    // （syncFromBackend 只拉取 repositories/releases/settings 与全局配置），
    // 无论分片是否成功都必须保留目标账号原归档中的这些本地字段。
    gists: previousArchive.gists,
    starredGists: previousArchive.starredGists,
    selectedGistCategory: previousArchive.selectedGistCategory,
    forks: previousArchive.forks,
    readForks: previousArchive.readForks,
    readReleases: previousArchive.readReleases,
    releaseSubscriptions: previousArchive.releaseSubscriptions,
    ...(overlaySettings ? {
      customCategories: previousArchive.customCategories,
      hiddenDefaultCategoryIds: previousArchive.hiddenDefaultCategoryIds,
      categoryOrder: previousArchive.categoryOrder,
      defaultCategoryOverrides: previousArchive.defaultCategoryOverrides,
      releaseSourceSettings: previousArchive.releaseSourceSettings,
    } : {}),
    ...(overlayReleases ? { releases: previousArchive.releases } : {}),
  };
};

export const LoginScreen: React.FC = () => {
  const {
    authenticateWithGitHub, configuredBackendUrl, restoreBackendSession, setupBackendGitHubToken,
    syncBackendData, syncTokenToBackend, getBackendUrl, getPersistedUrl, persistUrl,
    rememberActiveBackendUrl, rollbackBackendConnection, runWithBackendRestoreFrozen,
    drainInFlightBackendPulls,
  } = useLoginActions();
  const { switchToAccount, parkCurrentAccountForRestore } = useAccountSwitchActions();
  // 审计修复：快捷登录的后端凭据对齐失败发生在登录页卸载之后——全局
  // DialogProvider 常驻，其 toast 在组件卸载后仍可见。useOptionalDialog 在
  // 无 Provider 的测试环境返回 null（降级为仅 setError）。
  const dialog = useOptionalDialog();
  const githubTokenInputRef = useRef<HTMLInputElement | null>(null);
  const [loginMode, setLoginMode] = useState<'github' | 'backend'>('github');
  // 转交 2（Issue #612 A19）：accountSelection 为候选后端恢复歧义步骤——服务端
  // 返回 account_selection_required: true 时展示账号选择列表，选定后携带账号 ID
  // 重试恢复。
  const [backendStep, setBackendStep] = useState<'credentials' | 'accountSelection' | 'githubToken'>('credentials');
  const [tokenSetupReason, setTokenSetupReason] = useState<'missing' | 'invalid'>('missing');
  const [reauthAccountId, setReauthAccountId] = useState<string | null>(null);
  const [pendingFocusGithubToken, setPendingFocusGithubToken] = useState(false);
  const [token, setToken] = useState('');
  const [backendUrl, setBackendUrl] = useState(() => {
    if (configuredBackendUrl) return configuredBackendUrl.replace(/\/api$/, '');
    // A desktop webview origin (file://, tauri://, …) is not a usable backend
    // address; only a web deployment can share its origin with the backend.
    return /^https?:$/.test(window.location.protocol) ? window.location.origin : '';
  });
  const [backendApiKey, setBackendApiKey] = useState('');
  const [backendGithubToken, setBackendGithubToken] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  // 审计修复（B12）：候选后端连接仅供设置步骤使用。进入令牌配置步骤时记录
  // 候选连接之前的后端 URL 与 API Key；离开设置步骤（返回 GitHub 模式）时先
  // 成对恢复原连接与原密钥，再开放已保存账号快捷登录，防止把已保存账号的
  // PAT 发送给候选后端，也防止原密钥残留在 Store 被发给候选后端（R2-B5）。
  // undefined 表示当前没有活跃的候选连接；null 表示候选之前的连接为本地/自动探测。
  const candidatePreviousUrlRef = useRef<string | null | undefined>(undefined);
  const candidatePreviousSecretRef = useRef<string | null | undefined>(undefined);
  // 转交 2：候选连接之前的持久化后端 URL——账号选择/重试路径的失败回滚需要
  // 成对还原（R2-B7），重试时不能把已提交的候选 URL 当回滚目标。
  const candidatePreviousPersistedUrlRef = useRef<string | null | undefined>(undefined);
  // 审计修复（R13 finding 35）：定向恢复必须沿用产生账号列表的候选 URL 与
  // API Key——延迟返回的剪贴板读取可以在账号列表出现后改写输入框状态，重试
  // 若重新读取输入状态，会把改写后的 URL/密钥连同选定账号一起传给
  // restoreBackendSession。首次提交（无选定账号）时保存本次提交的候选凭据，
  // 定向重试一律使用保存值；用户返回凭据页面再次提交时刷新保存值（新候选）。
  const candidateSubmittedUrlRef = useRef<string | null>(null);
  const candidateSubmittedSecretRef = useRef<string | null>(null);
  // 审计修复（R13 finding 82）：候选连接回滚失败标记——复原探测失败时活动
  // 连接可能仍是候选后端或本地空连接，后续 PAT 登录不得把「未写入任何后端」
  // 的 syncTokenToBackend { ok: true } 当作同步成功显示。
  const previousBackendRestoreFailedRef = useRef(false);
  // 审计修复（R13 finding 81）：定向恢复选定账号后进入补 Token 步骤时固定的
  // 目标账号——补 Token 提交的 PAT 必须属于该账号才可写入其分区并登录。
  const [tokenSetupTargetAccount, setTokenSetupTargetAccount] = useState<{ accountId: string; login: string | null } | null>(null);
  // 转交 2：恢复歧义时服务端返回的可选账号列表；null 表示当前无账号选择状态。
  const [restoreAccountCandidates, setRestoreAccountCandidates] = useState<BackendAuthRestoreAccount[] | null>(null);
  const [isRestoringPreviousBackend, setIsRestoringPreviousBackend] = useState(false);
  // Data conflict dialog state for backend login
  const [conflictDialogOpen, setConflictDialogOpen] = useState(false);
  // Ref to resolve the conflict dialog promise
  const conflictResolveRef = useRef<((overwrite: boolean) => void) | null>(null);
  const {
    setUser, setGitHubToken, upsertSavedAccount,
    discardPartialLoginWorkspace,
    repositories,
    lastSync, accountWorkspaces, savedAccounts, language, setLanguage, themeMode, systemTheme, setThemeMode,
  } = useAppStore(useShallow((state) => ({
    setUser: state.setUser,
    setGitHubToken: state.setGitHubToken,
    upsertSavedAccount: state.upsertSavedAccount,
    discardPartialLoginWorkspace: state.discardPartialLoginWorkspace,
    repositories: state.repositories,
    lastSync: state.lastSync,
    accountWorkspaces: state.accountWorkspaces,
    savedAccounts: state.savedAccounts,
    language: state.language,
    setLanguage: state.setLanguage,
    themeMode: state.themeMode,
    systemTheme: state.systemTheme,
    setThemeMode: state.setThemeMode,
  })));
  const theme = resolveTheme(themeMode, systemTheme);
  const t = useT('login');
  const parkedWorkspaces = Object.values(accountWorkspaces ?? {});
  const cachedRepoCount = repositories.length > 0
    ? repositories.length
    : parkedWorkspaces.reduce((total, workspace) => total + workspace.repositories.length, 0);
  const parkedLastSyncs = parkedWorkspaces
    .map((workspace) => workspace.lastSync)
    .filter((value): value is string => typeof value === 'string')
    .sort();
  const cachedLastSync = lastSync ?? parkedLastSyncs[parkedLastSyncs.length - 1] ?? null;
  // 已保存账号快捷列表（Issue #611）：按 lastUsedAt 倒序，一键恢复会话
  const savedAccountList = Object.values(savedAccounts ?? {})
    .filter(account => !!account?.user)
    .sort((a, b) => (a.lastUsedAt < b.lastUsedAt ? 1 : a.lastUsedAt > b.lastUsedAt ? -1 : 0));

  useEffect(() => {
    if (pendingFocusGithubToken && loginMode === 'github') {
      githubTokenInputRef.current?.focus();
      setPendingFocusGithubToken(false);
    }
  }, [pendingFocusGithubToken, loginMode]);

  const handleQuickSignIn = async (accountId: string, hasToken: boolean) => {
    // 转交 2：账号选择步骤同样封闭快捷登录（候选连接仍活跃，B12 同款约束）。
    if (backendStep === 'githubToken' || backendStep === 'accountSelection') return;
    // B12：候选后端连接复原完成前不得开放快捷登录（避免把已保存账号的
    // PAT 发给候选后端）。
    if (isRestoringPreviousBackend) return;
    if (!hasToken) {
      // Token 缺失（如导入脱敏备份）：记录待补授权账号 ID，切到 GitHub 模式后聚焦输入框
      setReauthAccountId(accountId);
      setLoginMode('github');
      setBackendStep('credentials');
      setTokenSetupReason('missing');
      setError(t('loginScreen.token-required'));
      if (loginMode === 'github') {
        githubTokenInputRef.current?.focus();
      } else {
        setPendingFocusGithubToken(true);
      }
      return;
    }
    setReauthAccountId(null);
    setIsLoading(true);
    setError('');
    try {
      const result = await switchToAccount(accountId);
      if (!result.ok) {
        if (result.needsToken) {
          setReauthAccountId(accountId);
          setLoginMode('github');
          setBackendStep('credentials');
          setTokenSetupReason('missing');
          setError(t('loginScreen.token-required'));
          setPendingFocusGithubToken(true);
        } else {
          // 审计修复：switchToAccount 先提交 isAuthenticated（App 卸载登录页）
          // 再做后端凭据对齐——对齐失败返回 backend-credential-sync-failed 时
          // setError 作用于已卸载组件，用户看不到任何提示。改经全局 toast
          // 显示失败（DialogProvider 常驻，卸载后仍可见）；会话保持在目标
          // 账号，后端凭据对齐标记允许用户稍后重试对齐。
          if (result.error === 'backend-credential-sync-failed') {
            dialog?.toast(t('app:accountModal.backend-credential-sync-failed'), 'error');
          }
          setError(result.error ?? t('loginScreen.sign-in-failed-please-try-again'));
        }
        return;
      }
      // 成功切换后 App 因 isAuthenticated=true 自动渲染主界面
    } finally {
      setIsLoading(false);
    }
  };

  const switchLoginMode = (mode: 'github' | 'backend') => {
    // 审计修复（B12 / R2-B5）：离开候选后端令牌配置/账号选择步骤返回 GitHub
    // 模式时，先成对恢复候选连接之前的原后端连接与原 API Key（Store 仍留
    // 候选 Key，只恢复 URL 会把候选 Key 发给原后端），再开放已保存账号快捷
    // 登录；继续停留在设置步骤（未离开 backend 模式）时保留候选连接与候选密钥。
    if (mode === 'github' && loginMode === 'backend'
      && (backendStep === 'githubToken' || backendStep === 'accountSelection')
      && candidatePreviousUrlRef.current !== undefined) {
      const restoreUrl = candidatePreviousUrlRef.current;
      const restoreSecret = candidatePreviousSecretRef.current;
      candidatePreviousUrlRef.current = undefined;
      candidatePreviousSecretRef.current = undefined;
      candidatePreviousPersistedUrlRef.current = undefined;
      candidateSubmittedUrlRef.current = null;
      candidateSubmittedSecretRef.current = null;
      setIsRestoringPreviousBackend(true);
      // 审计修复（R13 finding 82）：回滚失败必须与成功区分——rollback 复原
      // 探测失败时保持现有连接（活动连接可能仍是候选后端，或本地空连接）。
      // 复原完成后核对活动后端 URL 是否已回到候选之前的值；失败时登记标记，
      // 后续 PAT 登录据其判定「未写入任何后端」的同步结果。
      void rollbackBackendConnection(restoreUrl, restoreSecret).then(() => {
        const restoreTargetUrl = restoreUrl === null ? null : normalizeBackendUrl(restoreUrl);
        previousBackendRestoreFailedRef.current = (getBackendUrl() ?? null) !== restoreTargetUrl;
      }).finally(() => {
        setIsRestoringPreviousBackend(false);
      });
    }
    setReauthAccountId(null);
    setTokenSetupTargetAccount(null);
    // 转交 2：离开账号选择步骤时清除候选账号列表。
    setRestoreAccountCandidates(null);
    setLoginMode(mode);
    setBackendStep('credentials');
    setTokenSetupReason('missing');
    setError('');
  };

  const handleConnect = async () => {
    // 审计修复（R2-B8）：候选连接回滚完成前原连接尚未恢复（活动连接可能仍是
    // 候选后端 B），此时提交 PAT 会经 syncTokenToBackend 把 PAT 发给候选后端。
    if (isRestoringPreviousBackend) return;
    if (!token.trim()) {
      setError(t('loginScreen.please-enter-a-valid-github-token'));
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const user = await authenticateWithGitHub(token);
      if (reauthAccountId && accountIdKey(user) !== reauthAccountId) {
        const expectedAccount = savedAccounts?.[reauthAccountId];
        setError(t('app:accountModal.account-mismatch', { login: expectedAccount?.user.login ?? reauthAccountId }));
        return;
      }
      setReauthAccountId(null);
      // R2 防护（Issue #611 审计修复）：登录页可能仍保留已登录账号 A（持久化
      // user 但未认证的边缘态）。写入新凭证前必须先归档当前账号，否则
      // setGitHubToken 会以 A 为所有者把账号 B 的 Token 写进 savedAccounts[A]，
      // 切回 A 时会拿 B 的凭证发起请求，且 A 原有 Token 丢失。
      parkCurrentAccountForRestore();
      setGitHubToken(token);
      setUser(user);

      // syncTokenToBackend checks backend availability itself at call time and
      // returns { ok: true } when the backend is unreachable-by-design; only a
      // real failure surfaces the warning banner below.
      // 审计修复（R13 finding 82）：候选连接回滚失败后原连接可能仍不可用——
      // 此时 syncTokenToBackend 不写入任何后端也返回 { ok: true }，不得把该
      // 结果当作「已同步到后端」。
      const { ok } = await syncTokenToBackend(token);
      const backendUnavailableAfterFailedRestore = previousBackendRestoreFailedRef.current
        && !getBackendUrl();
      if (!ok || backendUnavailableAfterFailedRestore) {
        // 审计修复（R15 finding 12）：syncTokenToBackend 返回 ok:false（含内部
        // 捕获异常的失败返回）时，为刚提交的当前账号登记待对齐标记——提示文案
        // 承诺「从账号菜单重试」，Header 的重试入口以该标记为准（单账号用户
        // 否则没有重试入口）。markPendingBackendCredentialAlign 为 features 域
        // 公开导出（写入成员变化即通知订阅者，Header 立即重算重试入口）；
        // 后端不可用的 ok:true 分支（R14 finding 10）无后端可对齐，不登记。
        if (!ok) {
          const loggedInAccountId = accountIdKey(user);
          if (loggedInAccountId) {
            markPendingBackendCredentialAlign(loggedInAccountId);
          }
        }
        // 审计修复（R14 finding 10）：普通 PAT 登录已先 setUser 提交本地会话——
        // 真实 App 中登录页随即卸载，登录页本地的 setError 无法再显示。复用
        // 快捷登录的全局 toast 告知用户后端凭据未能更新（本地会话保留，不撤销）。
        dialog?.toast(t('app:accountModal.backend-credential-sync-failed'), 'error');
        setError(t('loginScreen.signed-in-but-failed-to-save-github-token-to-bac'));
      }

      console.log('Successfully authenticated user:', user);
    } catch (error) {
      console.error('Authentication failed:', error);
      setError(
        error instanceof Error
          ? error.message
          : (t('loginScreen.failed-to-authenticate-please-check-your-token'))
      );
    } finally {
      setIsLoading(false);
    }
  };

  // 审计修复（B14）：归档前先排空当前账号的在途后端拉取（autoSync 侧能力，
  // 见 HANDOFF-B-TO-C.md），防止旧账号 A 的在途拉取把数据写进归档后的无主
  // 顶层；autoSync 落地前由 C8 的会话代次校验兜底丢弃迟到结果。
  const parkForBackendRestore = async () => {
    const parkedAccountId = accountIdKey(useAppStore.getState().user);
    await drainInFlightBackendPulls(parkedAccountId);
    parkCurrentAccountForRestore();
  };

  // 转交 2：retryAccountId 为用户在恢复歧义（account_selection_required）中选定
  // 的账号 ID——携带该 ID 重试定向恢复。重试沿用首次连接记录的回滚上下文：
  // 候选连接此刻已处于活跃状态，实时读取到的 URL/密钥/持久化 URL 都是候选值，
  // 绝不能当作回滚目标（R2-B5/B11/R2-B7 语义保持）。
  const handleBackendConnect = async (retryAccountId?: string) => {
    // onClick 直传的事件对象不是账号 ID：仅接受字符串形参作为重试账号。
    const isFirstAttempt = typeof retryAccountId !== 'string';
    // 审计修复（R13 finding 35）：定向重试沿用首次提交保存的候选凭据，绝不
    // 重新读取可能已被延迟剪贴板写入改写的输入框状态。
    const url = isFirstAttempt ? backendUrl.trim() : (candidateSubmittedUrlRef.current ?? '');
    const apiKey = isFirstAttempt ? backendApiKey.trim() : (candidateSubmittedSecretRef.current ?? '');
    if (!url || !apiKey) {
      setError(t('loginScreen.please-enter-the-backend-url-and-api-key'));
      return;
    }
    if (!normalizeBackendUrl(url)) {
      setError(t('loginScreen.invalid-backend-url-remote-backends-must-use-htt'));
      return;
    }
    // 审计修复（R2-B8）：候选连接回滚完成前不得发起连接（活动连接可能仍是
    // 候选后端 B）。
    if (isRestoringPreviousBackend) return;
    const selectedAccountId = isFirstAttempt ? undefined : retryAccountId;
    if (isFirstAttempt) {
      // 首次提交创建新候选连接：保存本次提交的候选凭据供定向重试使用
      //（finding 35）；返回凭据页面再次提交时刷新保存值。
      candidateSubmittedUrlRef.current = url;
      candidateSubmittedSecretRef.current = apiKey;
    }

    setIsLoading(true);
    setError('');
    // 审计修复（R2-B9）：候选 API Key 不再提前写入 Store——经
    // restoreBackendSession 的 apiSecret 选项在候选 URL 提交后才对请求可见；
    // /health 探测阶段的请求仍读原密钥。失败回滚时 URL 与密钥必须成对恢复
    //（R2-B5/B11），否则原密钥会被发往候选后端（轮询/诊断请求仍在运行）。
    const previousApiSecret = isFirstAttempt
      ? useAppStore.getState().backendApiSecret
      : candidatePreviousSecretRef.current;
    const previousBackendUrl = isFirstAttempt
      ? getBackendUrl()
      : candidatePreviousUrlRef.current ?? null;
    // 审计修复（R2-B7）：候选认证前记录持久化的后端 URL——失败回滚时还原；
    // 绝不能用 backend.backendUrl 作为恢复值（探测失败时内存值可能为 null）。
    const previousPersistedUrl = isFirstAttempt
      ? getPersistedUrl()
      : candidatePreviousPersistedUrlRef.current ?? null;
    // 审计修复（B13）：恢复流程重构——恢复拉取以显式账号 ID 固定请求头，
    // 登录态（凭证 + 工作区归属）在拉取成功后统一提交；恢复完成前
    // LoginScreen 保持挂载（isAuthenticated 不提前置 true），失败时错误
    // 显示在当前登录页。
    let loginCommitted = false;
    // R12：其余账号登记在冻结窗口结束后进行——记录待登记列表，runConnect 内
    // 提交登录后填充。
    let pendingRegistrationAccounts: BackendAuthRestoreAccount[] = [];
    // 审计修复（R2-B10）：拉取尚未开始（如候选返回 unauthorized 在归档前抛错）
    // 时绝不丢弃顶层工作区——里面可能是未归档的旧版顶层缓存或活跃账号实时
    // 工作区（自定义分类/顺序无法从 GitHub 重同步）。拉取开始前捕获顶层
    // 快照：park 未能归档的无主残留不属于本次拉取写入的数据，丢弃拉取残留后
    // 原样恢复。
    let pullStarted = false;
    let prePullWorkspace: AccountWorkspace | null = null;

    const runConnect = async () => {
      // 登录页可能残留上一会话的账号头：候选后端必须按自身 active_account_id
      // 恢复，绝不能携带本机旧账号分区。候选密钥经 apiSecret 选项传入
      //（R2-B9）；deferPersist（R2-B12）让候选完成身份验证也不持久化 URL；
      // 转交 2：恢复歧义重试时携带用户选定账号 ID 定向恢复。
      const result = await restoreBackendSession(url, {
        omitAccountHeader: true,
        apiSecret: apiKey,
        deferPersist: true,
        ...(selectedAccountId ? { accountId: selectedAccountId } : {}),
      });
      if (result.status === 'backend-unavailable') {
        throw new Error(t('loginScreen.unable-to-connect-to-this-backend-url'));
      }
      if (result.status === 'unauthorized') {
        throw new Error(t('loginScreen.invalid-api-key-please-check-it-and-try-again'));
      }
      if (result.status === 'restore-failed') {
        throw new Error(t('loginScreen.failed-to-read-login-data-from-the-backend'));
      }
      if (result.status === 'account-selection-required') {
        // 转交 2（server/src/routes/authRestore.ts A19 契约）：无账号头恢复歧义
        // ——服务端已返回 accounts 列表 + 空 github_token。不得进入
        // github-token-required 流程：记录候选之前的回滚上下文，展示账号选择
        // 列表；候选连接与候选密钥保留供选定账号后的定向重试。
        candidatePreviousUrlRef.current = previousBackendUrl;
        candidatePreviousSecretRef.current = previousApiSecret;
        candidatePreviousPersistedUrlRef.current = previousPersistedUrl;
        setRestoreAccountCandidates(result.accounts);
        setBackendStep('accountSelection');
        return;
      }
      // 恢复继续推进（成功/令牌配置）：离开账号选择状态。
      setRestoreAccountCandidates(null);
      if (result.status === 'restored-token-invalid' || result.status === 'github-token-required') {
        // 进入令牌配置步骤：候选后端连接与候选密钥保留供设置使用（B12），
        // 记录候选之前的连接与密钥以便离开设置步骤时成对复原（R2-B5）。
        candidatePreviousUrlRef.current = previousBackendUrl;
        candidatePreviousSecretRef.current = previousApiSecret;
        // 审计修复（R13 finding 81）：定向恢复进入补 Token 步骤时固定所选
        // 账号——补 Token 提交的 PAT 必须属于该账号才可写入其分区并登录。
        setTokenSetupTargetAccount(selectedAccountId
          ? {
              accountId: selectedAccountId,
              login: restoreAccountCandidates?.find((candidate) => candidate?.accountId === selectedAccountId)?.user?.login ?? null,
            }
          : null);
        setTokenSetupReason(result.status === 'restored-token-invalid' ? 'invalid' : 'missing');
        setBackendStep('githubToken');
        return;
      }

      // Backend, auth, and stored token are all proven. Before syncing data,
      // check whether the local client already has data for this account (in
      // current live workspace or parked workspace). If so, ask the user
      // whether to overwrite local data with backend data.
      // 审计修复（R2-B6）：仅当实时工作区属于目标账号，或目标账号存在归档
      // 工作区数据时才询问覆盖——缓存只属于其他账号（如 A）而目标 B 无本地
      // 数据时，先归档 A，再直接拉取 B 的远端数据（不因「保留本地」跳过
      // B 的拉取）。
      const nextAccountId = accountIdKey(result.user);
      const liveState = useAppStore.getState();
      const liveWorkspace = {
        repositories: liveState.repositories,
        gists: liveState.gists,
        starredGists: liveState.starredGists,
        releases: liveState.releases,
        forks: liveState.forks,
        // 审计修复：订阅/来源设置/已读状态也属于工作区数据——仅含发行版订阅
        // 或自定义来源的实时工作区同样要触发覆盖确认（workspaceHasRetainableData）。
        releaseSubscriptions: liveState.releaseSubscriptions,
        releaseSourceSettings: liveState.releaseSourceSettings,
        readReleases: liveState.readReleases,
        readForks: liveState.readForks,
        customCategories: liveState.customCategories,
        categoryOrder: liveState.categoryOrder,
        hiddenDefaultCategoryIds: liveState.hiddenDefaultCategoryIds,
        defaultCategoryOverrides: liveState.defaultCategoryOverrides,
        categoryListIdMap: liveState.categoryListIdMap,
      };
      const parkedWorkspace = nextAccountId ? liveState.accountWorkspaces[nextAccountId] : undefined;
      const liveBelongsToTarget = !!nextAccountId
        && accountIdKey(liveState.user) === nextAccountId
        && workspaceHasRetainableData(liveWorkspace);
      const targetHasParkedData = workspaceHasRetainableData(parkedWorkspace);

      const startPull = async () => {
        prePullWorkspace = captureAccountWorkspace(useAppStore.getState());
        pullStarted = true;
        if (!liveBelongsToTarget) {
          // 清理无主顶层残留（如旧版 customCategories），避免后端设置响应省略该字段时
          // 残留被归档进目标账号或成为其实时工作区；拉取失败时 catch 会按 prePullWorkspace 还原。
          discardPartialLoginWorkspace();
        }
        // 审计修复（B13）：以显式账号 ID 拉取（不提前 setUser 生成请求头），
        // 拉取成功后统一提交工作区与登录态。
        const pullResult = await syncBackendData({ targetAccountId: nextAccountId ?? undefined });
        // 同步更新目标账号归档为刚拉取的快照：即使后端返回空快照，随后 setUser
        // 切换工作区时也不会回退到该账号的旧归档。
        // 审计修复（R13 finding 36）：settings/releases 分片读取失败时，目标
        // 账号原归档的对应字段保持原值（叠加回拉取快照），绝不被清空顶层的
        // 默认值覆盖；成功分片照常覆盖为拉取值。
        if (nextAccountId) {
          const pulledWorkspace = captureAccountWorkspace(useAppStore.getState());
          const archivedWorkspace = overlayUnfetchedShardsFromPreviousArchive(
            pullResult,
            pulledWorkspace,
            useAppStore.getState().accountWorkspaces[nextAccountId],
          );
          useAppStore.setState((state) => ({
            ...applyAccountWorkspace(archivedWorkspace),
            accountWorkspaces: {
              ...state.accountWorkspaces,
              [nextAccountId]: archivedWorkspace,
            },
          }));
        }
        setGitHubToken(result.githubToken);
        setUser(result.user);
        loginCommitted = true;
      };

      // 审计修复（R12）：升级后的登录页可能没有 user，但顶层仍保留旧版自定义
      // 分类等无法从 GitHub 重同步的未归属缓存。此时目标账号无归档数据，此前
      // 不经确认直接清空顶层并拉取——拉取成功后 prePullWorkspace 不会恢复，
      // 旧分类永久丢失。顶层无主数据存在时同样先请用户明确确认；用户选择
      // 「保留本地」时原样保留（显式确认的归属，绝不自动归并），没有旧缓存
      // 时仍直接拉取。
      const topLevelHasUnownedLegacyCache = !liveState.user && workspaceHasRetainableData(liveWorkspace);
      if (liveBelongsToTarget || targetHasParkedData || topLevelHasUnownedLegacyCache) {
        // Show conflict dialog and wait for user decision
        const overwrite = await new Promise<boolean>((resolve) => {
          conflictResolveRef.current = resolve;
          setConflictDialogOpen(true);
          setIsLoading(false); // Let user interact with dialog
        });
        setIsLoading(true);
        await parkForBackendRestore();
        if (overwrite) {
          await startPull();
        } else {
          // 「保留本地」：跳过拉取并直接提交工作区与登录态。目标账号有自己的
          // 归档快照时，清掉 park 未能归档的无主残留（park 在确认前已执行，
          // 实时工作区此时已归档进目标账号快照），让 setUser 恢复 B 自己的
          // 快照（B14）。
          // 审计修复（R15 finding 10）：顶层仍是用户显式要求保留的无主旧版缓存
          // 时（park 未能归档、无单独的丢弃确认），绝不清空——无主缓存独立
          // 保留为登录后的实时工作区（switchAccountWorkspace 对可保留顶层保持
          // 现状），绝不自动并入目标账号，目标账号归档原样留在
          // accountWorkspaces 供后续切换恢复；顶层无可保留数据时才清空并恢复
          // 目标归档。
          // 审计修复（finding 26）：当目标账号 B 已有归档且顶层仍存在无主旧版缓存时，
          // 仅把无主缓存留在顶层并调用 setUser(B) 会在下次从 B 切走时用顶层覆盖 B 原归档。
          // 按 ID 将无主缓存安全合并进 B 既有归档（B 原归档优先）并同步到顶层与归档，
          // 既保留无主缓存又绝不覆盖丢失 B 的既有数据。
          const currentState = useAppStore.getState();
          const liveHasRetainableData = workspaceHasRetainableData(currentState);
          if (targetHasParkedData && !liveHasRetainableData) {
            discardPartialLoginWorkspace();
          } else if (targetHasParkedData && liveHasRetainableData && nextAccountId) {
            const existingTargetArchive = currentState.accountWorkspaces[nextAccountId];
            if (existingTargetArchive) {
              const liveUnowned = captureAccountWorkspace(currentState);
              const mergedWorkspace: AccountWorkspace = {
                ...mergeWorkspacesById(existingTargetArchive, liveUnowned),
                ...mergeWorkspaceCategorySettings(liveUnowned, existingTargetArchive),
              };
              useAppStore.setState((state) => ({
                ...applyAccountWorkspace(mergedWorkspace),
                accountWorkspaces: {
                  ...state.accountWorkspaces,
                  [nextAccountId]: mergedWorkspace,
                },
              }));
            }
          }
          setGitHubToken(result.githubToken);
          setUser(result.user);
          loginCommitted = true;
        }
        // Either way, complete login with backend credentials
      } else {
        await parkForBackendRestore();
        // 缓存只属于其他账号（或目标账号无本地数据）：归档后直接拉取目标
        // 账号的远端数据（R2-B6）。
        await startPull();
      }

      // R12：待登记账号列表交给冻结窗口结束后的独立登记环节（见 try 块）。
      pendingRegistrationAccounts = result.accounts ?? [];
    };

    try {
      await (runWithBackendRestoreFrozen ? runWithBackendRestoreFrozen(runConnect) : runConnect());
      // 审计修复（R2-B12）：登录提交完成后才持久化候选后端 URL——进入令牌
      // 配置步骤（未提交登录）或登记账号环节抛错时不持久化，严格仓库拉取
      // 失败保留原持久化 URL。
      // R12：持久化必须先于其余账号登记执行——登记要等待各账号的 GitHub
      // /user 身份校验（每账号最长 15s），若等登记结束才持久化，界面已显示
      // 登录成功而地址仍未落盘，用户在校验等待期间刷新/退出后下次启动仍读
      // 旧地址。此刻冻结窗口已释放、登录态已提交，保存为同步写即时完成。
      if (loginCommitted) {
        rememberActiveBackendUrl();
      }
      // 登记后端保存的全部有效账号（Issue #611 审计修复）：与
      // tryRestoreAuthFromBackend / addAccountFromBackend 共用同一过滤规则，
      // 否则新设备经登录页连接后端后，账号下拉菜单只显示当前账号。
      // R2-C12：user:null 的条目用其分区 PAT 向 GitHub /user 核对归属后补齐
      // 完整身份，核对失败/不一致的条目拒绝登记。
      // R12：登记是登录提交后的独立工作，不再阻塞候选后端地址的持久化；
      // 登记循环进入前记录会话代次：等待 GitHub /user 校验期间若用户退出或
      // 切换账号，必须立即停止登记剩余条目，防止已清除的 PAT 被重新写入
      // Store 和安全存储。
      const registerSessionGeneration = getAccountSessionGeneration();
      for (const account of pendingRegistrationAccounts) {
        const normalizedAccount = await normalizeBackendRestoreAccount(account);
        if (getAccountSessionGeneration() !== registerSessionGeneration) break;
        if (!normalizedAccount) continue;
        // 审计修复（R15 finding 11）：恢复开始后用户可能在登记等待期间移除某个
        // 账号——removeSavedAccount 的非当前账号分支不推进会话代次，仅靠上方
        // 的代次复核拦不住迟到的登记写入（被移除账号会连同其 PAT 重新写回
        // savedAccounts 并同步加密存储）。异步处理完成后、写入前查会话级移除
        // 登记并跳过（store 域机制：removeSavedAccount 登记 / upsertSavedAccount
        // 撤销登记；helpers.isSavedAccountRemovedInSession 为提交回写前的点查，
        // 返回 true 时消费方必须跳过 upsert）。备份条目的 accountId 与规范化后
        // 的实际写入目标 ID 任一已登记移除即跳过，其余账号照常登记。
        const normalizedAccountId = accountIdKey(normalizedAccount.user);
        if (
          (typeof account.accountId === 'string' && isSavedAccountRemovedInSession(account.accountId))
          || (normalizedAccountId !== null && isSavedAccountRemovedInSession(normalizedAccountId))
        ) {
          continue;
        }
        upsertSavedAccount(normalizedAccount.user, normalizedAccount.githubToken);
      }
    } catch (error) {
      // 审计修复（R2-B7）：先还原持久化 URL 再复原连接——复原连接的自动探测
      // 绝不能读到刚持久化的候选 URL；原值为空时移除持久化键。
      if (getPersistedUrl() !== previousPersistedUrl) {
        persistUrl(previousPersistedUrl);
      }
      // 审计修复（R2-B5/B11）：候选连接失败成对恢复原 URL 与原 API 密钥。
      await rollbackBackendConnection(previousBackendUrl, previousApiSecret);
      if (loginCommitted) {
        // 拉取成功、登录提交之后仍可能失败（如登记账号环节抛错）：按
        // 「同步失败不提交登录状态」契约回滚登录态。
        setUser(null);
        setGitHubToken(null);
      }
      // 审计修复（B13 / R2-B10）：仅当恢复拉取已经开始时才丢弃本次拉取写入
      // 的数据（绝不归档）；拉取尚未开始时顶层可能是未归档的旧版缓存或活跃
      // 账号实时工作区，不得清空；park 未能归档的无主残留按拉取前快照恢复。
      if (pullStarted) {
        discardPartialLoginWorkspace(prePullWorkspace);
      }
      // 转交 2：候选连接已回滚——账号选择状态一并清除并回到凭据步骤，
      // 避免留下指向已回滚连接的失效选择列表。
      setRestoreAccountCandidates(null);
      if (backendStep === 'accountSelection') {
        setBackendStep('credentials');
      }
      setError(error instanceof Error ? error.message : t('loginScreen.sign-in-failed-please-try-again'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleBackendTokenSetup = async () => {
    const githubToken = backendGithubToken.trim();
    if (!githubToken) {
      setError(t('loginScreen.please-enter-a-valid-github-access-token'));
      return;
    }
    // 审计修复（R2-B8）：候选连接回滚完成前不得提交。
    if (isRestoringPreviousBackend) return;

    setIsLoading(true);
    setError('');
    // 审计修复（B13）：与 handleBackendConnect 相同的恢复时序——恢复拉取以
    // 显式账号 ID 固定请求头，登录态在拉取成功后统一提交；失败时错误停留在
    // 当前登录页。
    let loginCommitted = false;
    // 审计修复（R2-B10）：同 handleBackendConnect——拉取尚未开始不丢弃顶层，
    // 拉取开始前捕获快照，park 未能归档的无主残留丢弃后原样恢复。
    let pullStarted = false;
    let prePullWorkspace: AccountWorkspace | null = null;
    // 审计修复（R2-B7）：候选认证前记录持久化 URL——令牌配置流程失败同样
    // 必须还原持久化键，绝不留下指向候选后端的持久化 URL。
    const previousPersistedUrl = getPersistedUrl();
    try {
      // 审计修复（R13 finding 81）：定向恢复选中的账号进入补 Token 步骤时，
      // 先直连核对提交 PAT 的真实身份——与所选账号不一致时返回失败，绝不
      // 写入任何设置（syncSettings）或登录（与 restoreBackendSession 定向
      // 恢复的 accountIdKey(user) !== accountId 拒绝语义同一约束）。
      if (tokenSetupTargetAccount) {
        const probedUser = await authenticateWithGitHub(githubToken);
        if (accountIdKey(probedUser) !== tokenSetupTargetAccount.accountId) {
          setError(t('app:accountModal.account-mismatch', {
            login: tokenSetupTargetAccount.login ?? tokenSetupTargetAccount.accountId,
          }));
          return;
        }
      }
      // R2 防护（Issue #611）：先归档当前已登录账号（边缘态：持久化了 user 但
      // 停留在登录页），再向后端写入新 Token——否则 setupBackendGitHubToken 的
      // settings 写入会携带旧账号请求头，把新账号的 Token 写进旧账号分区。
      // 归档失败无副作用：parked 快照会在该账号下次登录时自动恢复。
      // B14：归档前先排空该账号的在途后端拉取。
      await parkForBackendRestore();
      const user = await setupBackendGitHubToken(githubToken);
      const nextAccountId = accountIdKey(user);
      const liveState = useAppStore.getState();
      const parkedWorkspace = nextAccountId ? liveState.accountWorkspaces[nextAccountId] : undefined;
      const currentWorkspace = {
        repositories: liveState.repositories,
        gists: liveState.gists,
        starredGists: liveState.starredGists,
        releases: liveState.releases,
        forks: liveState.forks,
        // 审计修复：订阅/来源设置/已读状态也属于工作区数据（同 handleBackendConnect）。
        releaseSubscriptions: liveState.releaseSubscriptions,
        releaseSourceSettings: liveState.releaseSourceSettings,
        readReleases: liveState.readReleases,
        readForks: liveState.readForks,
        customCategories: liveState.customCategories,
        categoryOrder: liveState.categoryOrder,
        hiddenDefaultCategoryIds: liveState.hiddenDefaultCategoryIds,
        defaultCategoryOverrides: liveState.defaultCategoryOverrides,
        categoryListIdMap: liveState.categoryListIdMap,
      };
      const liveBelongsToTarget = !!nextAccountId
        && accountIdKey(liveState.user) === nextAccountId
        && workspaceHasRetainableData(currentWorkspace);
      const targetHasParkedData = workspaceHasRetainableData(parkedWorkspace);
      // 审计修复（R12）：顶层残留的无主旧版缓存（park 未能归档——登录页无 user
      // 时 park 为空操作）同样属于本地数据，清空前必须请用户确认；「保留本地」
      // 且目标账号无归档时原样保留（同 handleBackendConnect）。
      const topLevelHasUnownedLegacyCache = !liveState.user && workspaceHasRetainableData(currentWorkspace);
      const localHasData = liveBelongsToTarget || targetHasParkedData || topLevelHasUnownedLegacyCache;
      let overwrite = true;
      if (localHasData) {
        overwrite = await new Promise<boolean>((resolve) => {
          conflictResolveRef.current = resolve;
          setConflictDialogOpen(true);
          setIsLoading(false);
        });
        setIsLoading(true);
      }
      if (overwrite) {
        // 审计修复（B13）：以显式账号 ID 拉取（不提前 setUser 生成请求头），
        // 拉取成功后统一提交工作区与登录态。
        prePullWorkspace = captureAccountWorkspace(useAppStore.getState());
        pullStarted = true;
        if (!liveBelongsToTarget) {
          // 清理无主顶层残留，避免后端未返回 customCategories 等字段时混入目标账号工作区。
          discardPartialLoginWorkspace();
        }
        // 审计修复（R13 finding 36）：补 Token 流程的覆盖拉取与 startPull 同一
        // 语义——settings/releases 分片读取失败时目标账号原归档的对应字段保持
        // 原值，绝不被清空顶层的默认值覆盖；成功分片照常覆盖为拉取值。
        const pullResult = await syncBackendData({ targetAccountId: nextAccountId ?? undefined });
        if (nextAccountId) {
          const pulledWorkspace = captureAccountWorkspace(useAppStore.getState());
          const archivedWorkspace = overlayUnfetchedShardsFromPreviousArchive(
            pullResult,
            pulledWorkspace,
            useAppStore.getState().accountWorkspaces[nextAccountId],
          );
          useAppStore.setState((state) => ({
            ...applyAccountWorkspace(archivedWorkspace),
            accountWorkspaces: {
              ...state.accountWorkspaces,
              [nextAccountId]: archivedWorkspace,
            },
          }));
        }
      } else if (!liveBelongsToTarget && targetHasParkedData) {
        // 「保留本地」：跳过拉取；仅当目标账号确有归档快照要恢复时才清理
        // park 未能归档的无主残留，让 setUser 恢复目标归档。
        // 审计修复（R15 finding 10）：与 handleBackendConnect 的保留本地分支
        // 同一语义——顶层仍是用户显式要求保留的无主旧版缓存时绝不清空（无
        // 单独的丢弃确认，也不自动并入目标账号），无主缓存独立保留，目标归档
        // 留在 accountWorkspaces；顶层无可保留数据时才清理并恢复目标归档。
        const currentState = useAppStore.getState();
        const liveHasRetainableData = workspaceHasRetainableData(currentState);
        if (!liveHasRetainableData) {
          discardPartialLoginWorkspace();
        } else if (nextAccountId) {
          const existingTargetArchive = currentState.accountWorkspaces[nextAccountId];
          if (existingTargetArchive) {
            const liveUnowned = captureAccountWorkspace(currentState);
            const mergedWorkspace: AccountWorkspace = {
              ...mergeWorkspacesById(existingTargetArchive, liveUnowned),
              ...mergeWorkspaceCategorySettings(liveUnowned, existingTargetArchive),
            };
            useAppStore.setState((state) => ({
              ...applyAccountWorkspace(mergedWorkspace),
              accountWorkspaces: {
                ...state.accountWorkspaces,
                [nextAccountId]: mergedWorkspace,
              },
            }));
          }
        }
      }
      setGitHubToken(githubToken);
      setUser(user);
      loginCommitted = true;
      // 审计修复（R2-B12）：登录提交完成后再持久化候选后端 URL（严格仓库
      // 拉取失败保留原持久化 URL）。
      rememberActiveBackendUrl();
      // 审计修复（R2-B5）：候选设置完成——保留候选连接与候选密钥，
      // 清除取消恢复登记。
      candidatePreviousUrlRef.current = undefined;
      candidatePreviousSecretRef.current = undefined;
    } catch (error) {
      // 审计修复（R2-B7）：令牌配置流程失败同样还原持久化 URL。
      if (getPersistedUrl() !== previousPersistedUrl) {
        persistUrl(previousPersistedUrl);
      }
      if (loginCommitted) {
        // 拉取成功、登录提交之后仍可能失败：按「同步失败不提交登录状态」契约回滚。
        setUser(null);
        setGitHubToken(null);
      }
      // 审计修复（B13 / R2-B10）：仅当恢复拉取已经开始时才丢弃本次拉取写入
      // 的数据（绝不归档）；拉取尚未开始时顶层可能是未归档的旧版缓存或活跃
      // 账号实时工作区，不得清空。
      if (pullStarted) {
        discardPartialLoginWorkspace(prePullWorkspace);
      }
      setError(error instanceof Error ? error.message : t('loginScreen.setup-failed-please-try-again'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    // 审计修复（R2-B8）：候选连接回滚完成前，任何登录提交（含 PAT）都必须阻止。
    if (e.key === 'Enter' && !isLoading && !isRestoringPreviousBackend) {
      if (loginMode === 'github') {
        void handleConnect();
      } else if (backendStep === 'githubToken') {
        void handleBackendTokenSetup();
      } else {
        void handleBackendConnect();
      }
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && !isLoading) {
      // e.currentTarget is only valid during dispatch; capture the id before
      // awaiting the clipboard so the paste lands in the focused field.
      const inputId = e.currentTarget.id;
      const result = await safeReadText();
      if (result.success && result.text) {
        const text = result.text.trim();
        if (inputId === 'backend-url') {
          setBackendUrl(text);
        } else if (inputId === 'backend-api-key') {
          setBackendApiKey(text);
        } else if (inputId === 'backend-github-token') {
          setBackendGithubToken(text);
        } else if (inputId === 'github-token') {
          setToken(text);
        }
        setError('');
      } else {
        console.warn('Clipboard read failed:', result.error);
      }
    }
  };

  const handleConflictConfirm = useCallback(() => {
    setConflictDialogOpen(false);
    conflictResolveRef.current?.(true);
    conflictResolveRef.current = null;
  }, []);

  const handleConflictCancel = useCallback(() => {
    setConflictDialogOpen(false);
    conflictResolveRef.current?.(false);
    conflictResolveRef.current = null;
  }, []);

  const showsTokenPermissions = loginMode === 'github' || backendStep === 'githubToken';

  return (
    <div className="relative flex min-h-screen bg-background p-4 text-foreground transition-colors duration-300 sm:p-6">
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-[28rem] w-[46rem] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -bottom-48 -left-32 h-96 w-96 rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute -right-32 -bottom-48 h-96 w-96 rounded-full bg-primary/5 blur-3xl" />
      </div>

      <div className="fixed right-4 top-4 z-50 flex items-center gap-2">
        <div className="flex items-center overflow-hidden rounded-md border border-border bg-card/80 shadow-sm backdrop-blur-sm">
          <Select value={language} onValueChange={(value) => setLanguage(value as AppLanguage)}>
            <SelectTrigger aria-label={t('loginScreen.interface-language')} className="h-9 w-[150px] rounded-none border-0 bg-transparent shadow-none focus:ring-0 focus:ring-offset-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {APP_LANGUAGES.map((definition) => (
                <SelectItem key={definition.code} value={definition.code}>
                  {definition.nativeName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="border border-border bg-card/80 shadow-sm backdrop-blur-sm" onClick={() => setThemeMode(theme === 'light' ? 'dark' : 'light')} aria-label={t('loginScreen.toggle-theme')}>
              {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('loginScreen.toggle-theme')}</TooltipContent>
        </Tooltip>
      </div>

      {/* 语言/主题切换是 fixed 定位，窄屏会压住 logo，因此顶部留出它的高度。 */}
      <div className={cn('relative m-auto w-full max-w-md pt-12 sm:pt-0', showsTokenPermissions && 'lg:max-w-4xl')}>
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center overflow-hidden rounded-xl border border-border bg-card shadow-md">
            <img src="./icon.png" alt="GitHub Stars Manager" className="h-full w-full object-cover" />
          </div>
          <h1 className="mb-2 text-2xl font-semibold tracking-tight text-foreground">GitHub Stars Manager</h1>
          <p className="text-sm text-muted-foreground">{t('loginScreen.ai-powered-repository-management')}</p>
        </div>

        {/* 审计修复（R13 finding 80 / Issue #611）：单账号保持原登录界面——
            常规账号选择卡片仅在保存了多个账号时显示；单账号仍从原登录表单
            补充 PAT（快捷登录入口不改变单账号的界面与交互）。 */}
        {savedAccountList.length > 1 && (
          <Card className="mb-4 border-border bg-card/60 p-3 shadow-sm">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('loginScreen.saved-accounts')}
            </p>
            <div className="space-y-1">
              {savedAccountList.map((account) => (
                <button
                  key={account.accountId}
                  type="button"
                  disabled={isLoading || backendStep === 'githubToken' || backendStep === 'accountSelection' || isRestoringPreviousBackend}
                  onClick={() => void handleQuickSignIn(account.accountId, !!account.githubToken.trim())}
                  className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                >
                  <img
                    src={account.user.avatar_url}
                    alt={account.user.name || account.user.login}
                    className="h-8 w-8 shrink-0 rounded-full"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {account.user.name || account.user.login}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      @{account.user.login} · {t('loginScreen.click-to-sign-in')}
                    </span>
                  </span>
                  {!account.githubToken.trim() && (
                    <span className="shrink-0 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-600 dark:text-amber-400">
                      {t('loginScreen.token-required')}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </Card>
        )}

        <Card className="relative overflow-hidden border-border bg-card p-0 shadow-lg shadow-black/5">
          <div className={cn('relative grid', showsTokenPermissions && 'lg:grid-cols-2')}>
            <div className="relative flex flex-col justify-center overflow-hidden px-6 py-12 sm:px-8">
              <LoginCardPattern />
              <div className="relative">
              <div className="mb-6 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-muted">
                  <div className="flex h-full w-full items-center justify-center rounded-full bg-foreground text-background dark:bg-primary/10 dark:text-primary">
                    {loginMode === 'github' ? <Github className="h-6 w-6" /> : <Database className="h-6 w-6" />}
                  </div>
                </div>
                <h2 className="mb-2 text-lg font-semibold tracking-tight text-foreground">
                  {loginMode === 'github'
                    ? t('loginScreen.connect-with-github')
                    : backendStep === 'credentials'
                      ? t('loginScreen.connect-to-your-backend')
                      : backendStep === 'accountSelection'
                        ? t('loginScreen.select-account-to-restore')
                        : t('loginScreen.set-up-github-access-token')}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {loginMode === 'github'
                    ? t('loginScreen.enter-your-github-personal-access-token-to-get-s')
                    : backendStep === 'credentials'
                      ? t('loginScreen.enter-the-backend-url-and-api-key-to-restore-you')
                      : backendStep === 'accountSelection'
                        ? t('loginScreen.multiple-accounts-exist-on-this-backend-select-th')
                        : tokenSetupReason === 'invalid'
                          ? t('loginScreen.the-github-token-stored-on-the-backend-is-not-wo')
                          : t('loginScreen.no-token-is-configured-on-this-backend-complete')}
                </p>
              </div>

              {cachedRepoCount > 0 && (
                <div className="mb-4 rounded-md border border-success/30 bg-success/10 p-3 text-success">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-success" />
                    <span className="text-sm font-medium">{t('loginScreen.cachedrepocount-repositories-cached', { cachedRepoCount: cachedRepoCount })}</span>
                  </div>
                  {cachedLastSync && <p className="mt-1 text-xs text-success">{t('loginScreen.last-sync')} {new Date(cachedLastSync).toLocaleString()}</p>}
                </div>
              )}

              <div className="space-y-4">
                {loginMode === 'backend' && backendStep === 'credentials' && (
                  <div className="space-y-2">
                    <Label htmlFor="backend-url">{t('loginScreen.backend-url')}</Label>
                    <div className="relative">
                      <Link className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground dark:text-muted-foreground/70" />
                      <Input
                        id="backend-url"
                        type="url"
                        autoComplete="url"
                        placeholder="https://example.com"
                        value={backendUrl}
                        onChange={(e) => {
                          setBackendUrl(e.target.value);
                          setError('');
                        }}
                        onKeyDown={handleKeyPress}
                        disabled={isLoading}
                        className="pl-10"
                      />
                    </div>
                  </div>
                )}

                {/* 转交 2（Issue #612 A19）：候选后端恢复歧义——展示账号选择列表，
                    风格与「已保存账号」快捷列表一致；选定后携带账号 ID 重试恢复。
                    Token 缺失的账号同样可选：定向重试会返回空 github_token 并进入
                    令牌配置步骤为该账号补全。 */}
                {loginMode === 'backend' && backendStep === 'accountSelection' && restoreAccountCandidates !== null && (
                  <div className="space-y-2" data-testid="restore-account-selection">
                    <div className="space-y-1">
                      {restoreAccountCandidates
                        .filter((account) => account && typeof account.accountId === 'string')
                        .map((account) => (
                          <button
                            key={account.accountId}
                            type="button"
                            data-testid={`restore-account-option-${account.accountId}`}
                            disabled={isLoading || isRestoringPreviousBackend}
                            onClick={() => void handleBackendConnect(account.accountId)}
                            className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                          >
                            {account.user?.avatar_url ? (
                              <img
                                src={account.user.avatar_url}
                                alt={account.user.name || account.user.login}
                                className="h-8 w-8 shrink-0 rounded-full"
                              />
                            ) : (
                              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground">
                                {account.accountId}
                              </span>
                            )}
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-foreground">
                                {account.user?.name || account.user?.login || account.accountId}
                              </span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {account.user?.login ? `@${account.user.login} · ` : ''}#{account.accountId}
                              </span>
                            </span>
                            {!account.githubToken && (
                              <span className="shrink-0 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-600 dark:text-amber-400">
                                {t('loginScreen.token-required')}
                              </span>
                            )}
                          </button>
                        ))}
                    </div>
                  </div>
                )}

                {/* 转交 2：账号选择步骤没有待输入的表单——隐藏令牌/API Key 输入。 */}
                {!(loginMode === 'backend' && backendStep === 'accountSelection') && (
                <div className="space-y-2">
                  <Label htmlFor={loginMode === 'github' ? 'github-token' : backendStep === 'credentials' ? 'backend-api-key' : 'backend-github-token'}>
                    {loginMode === 'github' || backendStep === 'githubToken' ? 'GitHub Personal Access Token' : 'API Key'}
                  </Label>
                  <div className="relative">
                    <Key className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground dark:text-muted-foreground/70" />
                    <Input
                      ref={loginMode === 'github' ? githubTokenInputRef : undefined}
                      id={loginMode === 'github' ? 'github-token' : backendStep === 'credentials' ? 'backend-api-key' : 'backend-github-token'}
                      type="password"
                      autoComplete="current-password"
                      placeholder={loginMode === 'github' || backendStep === 'githubToken' ? 'ghp_xxxxxxxxxxxxxxxxxxxx' : t('loginScreen.enter-backend-api-secret')}
                      value={loginMode === 'github' ? token : backendStep === 'credentials' ? backendApiKey : backendGithubToken}
                      onChange={(e) => {
                        if (loginMode === 'github') {
                          setToken(e.target.value);
                        } else if (backendStep === 'githubToken') {
                          setBackendGithubToken(e.target.value);
                        } else {
                          setBackendApiKey(e.target.value);
                        }
                        setError('');
                      }}
                      onKeyDown={handleKeyPress}
                      disabled={isLoading}
                      className="pl-10"
                    />
                  </div>
                </div>
                )}

                {error && (
                  <div role="alert" className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-destructive">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <p className="text-sm">{error}</p>
                  </div>
                )}

                {/* 转交 2：账号选择步骤的动作在账号行上（点击即定向重试），主按钮隐藏。 */}
                {!(loginMode === 'backend' && backendStep === 'accountSelection') && (
                <Button
                  type="button"
                  onClick={loginMode === 'github'
                    ? handleConnect
                    : backendStep === 'credentials'
                      ? () => void handleBackendConnect()
                      : handleBackendTokenSetup}
                  disabled={
                    isLoading
                    || isRestoringPreviousBackend
                    || !(loginMode === 'github' ? token : backendStep === 'credentials' ? backendApiKey : backendGithubToken).trim()
                    || (loginMode === 'backend' && backendStep === 'credentials' && !backendUrl.trim())
                  }
                  className="w-full"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="animate-spin" />
                      <span>{t('loginScreen.connecting')}</span>
                    </>
                  ) : (
                    <>
                      <span>
                        {loginMode === 'github'
                          ? t('loginScreen.connect-to-github')
                          : backendStep === 'credentials'
                            ? t('loginScreen.connect-and-restore-data')
                            : t('loginScreen.save-and-continue')}
                      </span>
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </Button>
                )}
              </div>

              <Button
                type="button"
                variant="ghost"
                className="mt-4 w-full text-muted-foreground hover:text-foreground"
                onClick={() => switchLoginMode(loginMode === 'github' ? 'backend' : 'github')}
                disabled={isLoading || isRestoringPreviousBackend}
              >
                {loginMode === 'github' ? (
                  <>
                    <span>{t('loginScreen.already-have-backend-data')}</span>
                    <ArrowRight className="h-4 w-4" />
                  </>
                ) : (
                  <>
                    <ArrowLeft className="h-4 w-4" />
                    <span>{t('loginScreen.sign-in-with-github-token')}</span>
                  </>
                )}
              </Button>
              </div>
            </div>

            {showsTokenPermissions && (
              <div className="flex flex-col justify-center border-t border-border px-6 py-12 sm:px-8 lg:border-l lg:border-t-0">
                <GitHubTokenPermissions />
              </div>
            )}
          </div>
        </Card>
      </div>

      <ConfirmDialog
        isOpen={conflictDialogOpen}
        title={t('loginScreen.local-data-conflict')}
        message={t('loginScreen.this-account-already-has-cached-repository-data')}
        confirmText={t('loginScreen.use-backend-data')}
        cancelText={t('loginScreen.keep-local')}
        onConfirm={handleConflictConfirm}
        onCancel={handleConflictCancel}
        type="warning"
      />
    </div>
  );
};
