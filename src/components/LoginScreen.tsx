import { useT } from "../i18n/useT";
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, Database, Key, Link, Loader2, Moon, Sun } from 'lucide-react';
import { Github } from './ui/brand-icons';
import { useAppStore } from '../store/useAppStore';
import { resolveTheme } from '../store/selectors';
import { useOptionalDialog } from '../hooks/useDialog';
import { useShallow } from 'zustand/react/shallow';
import { normalizeBackendRestoreAccount, useLoginActions, type BackendAuthRestoreAccount } from '../features/lifecycle/hooks/useLoginActions';
import { useAccountSwitchActions } from '../features/lifecycle/hooks/useAccountSwitchActions';
import { safeReadText } from '../utils/clipboardUtils';
import { normalizeBackendUrl } from '../utils/backendUrl';
import {
  accountIdKey,
  captureAccountWorkspace,
  getAccountSessionGeneration,
  workspaceHasData,
  type AccountWorkspace,
  type WorkspaceDataCandidate,
} from '../store/helpers/accountWorkspace';
import { normalizeReleaseSourceSettings } from '../utils/releaseSources';
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

// 审计修复：workspaceHasData 只覆盖列表类内容（仓库/Gist/发布/复刻/分类）。
// 仅含发行版订阅、自定义发行版来源或已读状态（readReleases/readForks）的
// 工作区此前被判为「空」，两个恢复入口会跳过覆盖确认，后端拉取会无声替换
// 这些本地归档。完整快照判定补充订阅、来源与已读状态；默认来源设置与空
// 集合仍视为空工作区。
const workspaceSnapshotHasData = (workspace: WorkspaceDataCandidate | null | undefined): boolean => {
  if (!workspace) return false;
  if (workspaceHasData(workspace)) return true;
  const countOf = (value: Set<number> | number[] | undefined): number => (
    value instanceof Set ? value.size : value?.length ?? 0
  );
  if (countOf(workspace.releaseSubscriptions) > 0) return true;
  if (countOf(workspace.readReleases) > 0) return true;
  if (countOf(workspace.readForks) > 0) return true;
  const settings = normalizeReleaseSourceSettings(workspace.releaseSourceSettings ?? null);
  return JSON.stringify(settings) !== JSON.stringify(normalizeReleaseSourceSettings(null));
};

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
      setIsRestoringPreviousBackend(true);
      void rollbackBackendConnection(restoreUrl, restoreSecret).finally(() => {
        setIsRestoringPreviousBackend(false);
      });
    }
    setReauthAccountId(null);
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
      const { ok } = await syncTokenToBackend(token);
      if (!ok) {
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
    const url = backendUrl.trim();
    const apiKey = backendApiKey.trim();
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
    // onClick 直传的事件对象不是账号 ID：仅接受字符串形参作为重试账号。
    const selectedAccountId = typeof retryAccountId === 'string' ? retryAccountId : undefined;

    setIsLoading(true);
    setError('');
    // 审计修复（R2-B9）：候选 API Key 不再提前写入 Store——经
    // restoreBackendSession 的 apiSecret 选项在候选 URL 提交后才对请求可见；
    // /health 探测阶段的请求仍读原密钥。失败回滚时 URL 与密钥必须成对恢复
    //（R2-B5/B11），否则原密钥会被发往候选后端（轮询/诊断请求仍在运行）。
    const isFirstAttempt = selectedAccountId === undefined;
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
        // 或自定义来源的实时工作区同样要触发覆盖确认（workspaceSnapshotHasData）。
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
        && workspaceSnapshotHasData(liveWorkspace);
      const targetHasParkedData = workspaceSnapshotHasData(parkedWorkspace);

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
        await syncBackendData({ targetAccountId: nextAccountId ?? undefined });
        // 同步更新目标账号归档为刚拉取的快照：即使后端返回空快照，随后 setUser
        // 切换工作区时也不会回退到该账号的旧归档。
        if (nextAccountId) {
          const pulledWorkspace = captureAccountWorkspace(useAppStore.getState());
          useAppStore.setState((state) => ({
            accountWorkspaces: {
              ...state.accountWorkspaces,
              [nextAccountId]: pulledWorkspace,
            },
          }));
        }
        setGitHubToken(result.githubToken);
        setUser(result.user);
        loginCommitted = true;
      };

      if (liveBelongsToTarget || targetHasParkedData) {
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
          // 「保留本地」：跳过拉取并直接提交工作区与登录态；只保留 B 自己的
          // 快照——park 无法归档的无主顶层残留不随登录提交给 B（B14）。
          discardPartialLoginWorkspace();
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

      // 登记后端保存的全部有效账号（Issue #611 审计修复）：与
      // tryRestoreAuthFromBackend / addAccountFromBackend 共用同一过滤规则，
      // 否则新设备经登录页连接后端后，账号下拉菜单只显示当前账号。
      // R2-C12：user:null 的条目用其分区 PAT 向 GitHub /user 核对归属后补齐
      // 完整身份，核对失败/不一致的条目拒绝登记。
      // 登记循环进入前记录会话代次：等待 GitHub /user 校验期间若用户退出或切换账号，
      // 必须立即停止登记剩余条目，防止已清除的 PAT 被重新写入 Store 和安全存储。
      const registerSessionGeneration = getAccountSessionGeneration();
      for (const account of result.accounts ?? []) {
        const normalizedAccount = await normalizeBackendRestoreAccount(account);
        if (getAccountSessionGeneration() !== registerSessionGeneration) break;
        if (!normalizedAccount) continue;
        upsertSavedAccount(normalizedAccount.user, normalizedAccount.githubToken);
      }
    };

    try {
      await (runWithBackendRestoreFrozen ? runWithBackendRestoreFrozen(runConnect) : runConnect());
      // 审计修复（R2-B12）：登录提交完成后才持久化候选后端 URL——进入令牌
      // 配置步骤（未提交登录）或登记账号环节抛错时不持久化，严格仓库拉取
      // 失败保留原持久化 URL。
      if (loginCommitted) {
        rememberActiveBackendUrl();
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
        && workspaceSnapshotHasData(currentWorkspace);
      const targetHasParkedData = workspaceSnapshotHasData(parkedWorkspace);
      const localHasData = liveBelongsToTarget || targetHasParkedData;
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
        await syncBackendData({ targetAccountId: nextAccountId ?? undefined });
        if (nextAccountId) {
          const pulledWorkspace = captureAccountWorkspace(useAppStore.getState());
          useAppStore.setState((state) => ({
            accountWorkspaces: {
              ...state.accountWorkspaces,
              [nextAccountId]: pulledWorkspace,
            },
          }));
        }
      } else if (!liveBelongsToTarget) {
        // 「保留本地」：跳过拉取，仅在顶层不属于目标账号时清理无主残留，让 setUser 恢复目标归档。
        discardPartialLoginWorkspace();
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

        {savedAccountList.length > 0 && (
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
