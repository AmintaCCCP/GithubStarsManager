import { useT } from "../i18n/useT";
import React, { useState, useCallback, useRef } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, Database, Key, Link, Loader2, Moon, Sun } from 'lucide-react';
import { Github } from './ui/brand-icons';
import { useAppStore } from '../store/useAppStore';
import { resolveTheme } from '../store/selectors';
import { useShallow } from 'zustand/react/shallow';
import { isValidBackendRestoreAccount, useLoginActions } from '../features/lifecycle/hooks/useLoginActions';
import { useAccountSwitchActions } from '../features/lifecycle/hooks/useAccountSwitchActions';
import { safeReadText } from '../utils/clipboardUtils';
import { normalizeBackendUrl } from '../utils/backendUrl';
import { accountIdKey, workspaceHasData } from '../store/helpers/accountWorkspace';
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

export const LoginScreen: React.FC = () => {
  const { authenticateWithGitHub, configuredBackendUrl, restoreBackendSession, setupBackendGitHubToken, syncBackendData, syncTokenToBackend, getBackendUrl, rollbackBackendConnection } = useLoginActions();
  const { switchToAccount, parkCurrentAccountForRestore } = useAccountSwitchActions();
  const githubTokenInputRef = useRef<HTMLInputElement | null>(null);
  const [loginMode, setLoginMode] = useState<'github' | 'backend'>('github');
  const [backendStep, setBackendStep] = useState<'credentials' | 'githubToken'>('credentials');
  const [tokenSetupReason, setTokenSetupReason] = useState<'missing' | 'invalid'>('missing');
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
  // Data conflict dialog state for backend login
  const [conflictDialogOpen, setConflictDialogOpen] = useState(false);
  // Ref to resolve the conflict dialog promise
  const conflictResolveRef = useRef<((overwrite: boolean) => void) | null>(null);
  const {
    setUser, setGitHubToken, setBackendApiSecret, upsertSavedAccount, backendApiSecret,
    discardPartialLoginWorkspace,
    repositories, gists, starredGists, releases, forks,
    customCategories, categoryOrder, hiddenDefaultCategoryIds,
    defaultCategoryOverrides, categoryListIdMap,
    lastSync, accountWorkspaces, savedAccounts, language, setLanguage, themeMode, systemTheme, setThemeMode,
  } = useAppStore(useShallow((state) => ({
    setUser: state.setUser,
    setGitHubToken: state.setGitHubToken,
    setBackendApiSecret: state.setBackendApiSecret,
    upsertSavedAccount: state.upsertSavedAccount,
    backendApiSecret: state.backendApiSecret,
    discardPartialLoginWorkspace: state.discardPartialLoginWorkspace,
    repositories: state.repositories,
    gists: state.gists,
    starredGists: state.starredGists,
    releases: state.releases,
    forks: state.forks,
    customCategories: state.customCategories,
    categoryOrder: state.categoryOrder,
    hiddenDefaultCategoryIds: state.hiddenDefaultCategoryIds,
    defaultCategoryOverrides: state.defaultCategoryOverrides,
    categoryListIdMap: state.categoryListIdMap,
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

  const handleQuickSignIn = async (accountId: string, hasToken: boolean) => {
    if (!hasToken) {
      // Token 缺失（如导入脱敏备份）：聚焦 Token 输入框重新授权
      setLoginMode('github');
      setBackendStep('credentials');
      setTokenSetupReason('missing');
      setError(t('loginScreen.token-required'));
      githubTokenInputRef.current?.focus();
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      const result = await switchToAccount(accountId);
      if (!result.ok) {
        if (result.needsToken) {
          setError(t('loginScreen.token-required'));
          githubTokenInputRef.current?.focus();
        } else {
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
    setLoginMode(mode);
    setBackendStep('credentials');
    setTokenSetupReason('missing');
    setError('');
  };

  const handleConnect = async () => {
    if (!token.trim()) {
      setError(t('loginScreen.please-enter-a-valid-github-token'));
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const user = await authenticateWithGitHub(token);
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

  const handleBackendConnect = async () => {
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

    setIsLoading(true);
    setError('');
    const previousApiSecret = backendApiSecret;
    // 候选连接作为一个整体：失败时 URL 与密钥必须成对恢复，否则原密钥会
    // 被发往候选后端（轮询/诊断请求仍在运行）。
    const previousBackendUrl = getBackendUrl();
    setBackendApiSecret(apiKey);
    // 拉取固定到已验证账号（Issue #611 审计修复）后，登录态必须先于拉取落地；
    // 若随后的后端同步失败，回滚登录态以保持「同步失败不提交登录状态」契约
    // （已归档的旧账号数据安全，重新登录即可恢复）。
    let loginCommitted = false;

    try {
      // 登录页可能残留上一会话的账号头：候选后端必须按自身 active_account_id
      // 恢复，绝不能携带本机旧账号分区。
      const result = await restoreBackendSession(url, { omitAccountHeader: true });
      if (result.status === 'backend-unavailable') {
        throw new Error(t('loginScreen.unable-to-connect-to-this-backend-url'));
      }
      if (result.status === 'unauthorized') {
        throw new Error(t('loginScreen.invalid-api-key-please-check-it-and-try-again'));
      }
      if (result.status === 'restore-failed') {
        throw new Error(t('loginScreen.failed-to-read-login-data-from-the-backend'));
      }
      if (result.status === 'restored-token-invalid') {
        setTokenSetupReason('invalid');
        setBackendStep('githubToken');
        return;
      }
      if (result.status === 'github-token-required') {
        setTokenSetupReason('missing');
        setBackendStep('githubToken');
        return;
      }

      // Backend, auth, and stored token are all proven. Before syncing data,
      // check whether the local client already has data for this account (in
      // current live workspace or parked workspace). If so, ask the user
      // whether to overwrite local data with backend data.
      const nextAccountId = accountIdKey(result.user);
      const parkedWorkspace = nextAccountId ? accountWorkspaces[nextAccountId] : undefined;
      const currentWorkspace = {
        repositories,
        gists,
        starredGists,
        releases,
        forks,
        customCategories,
        categoryOrder,
        hiddenDefaultCategoryIds,
        defaultCategoryOverrides,
        categoryListIdMap,
      };
      const localHasData = workspaceHasData(currentWorkspace) || workspaceHasData(parkedWorkspace);

      if (localHasData) {
        // Show conflict dialog and wait for user decision
        const overwrite = await new Promise<boolean>((resolve) => {
          conflictResolveRef.current = resolve;
          setConflictDialogOpen(true);
          setIsLoading(false); // Let user interact with dialog
        });
        setIsLoading(true);
        // R2 防护（Issue #611）：拉取后端数据写入 Store 前先把当前已登录账号
        // 的工作区安全归档并清空顶层，防止被新账号数据污染后作为旧快照覆盖
        parkCurrentAccountForRestore();
        // 恢复拉取必须固定到已验证账号（Issue #611 审计修复）：先落新账号
        // 凭证再拉取，使 syncFromBackend 的全部请求携带
        // X-GitHub-Account-Id（已验证账号）。归档后 user 为 null 时请求头
        // 缺失，服务端 computeAccountScope 会回退到全局 active_account_id，
        // 可能读到其他账号的分区。
        setGitHubToken(result.githubToken);
        setUser(result.user);
        loginCommitted = true;
        if (overwrite) {
          await syncBackendData();
        }
        // Either way, complete login with backend credentials
      } else {
        parkCurrentAccountForRestore();
        // 同上：恢复拉取固定到已验证账号（显式登录态，而非服务端全局分区）
        setGitHubToken(result.githubToken);
        setUser(result.user);
        loginCommitted = true;
        // No conflict: sync backend data directly
        await syncBackendData();
      }

      // 登记后端保存的全部有效账号（Issue #611 审计修复）：与
      // tryRestoreAuthFromBackend / addAccountFromBackend 共用同一过滤规则，
      // 否则新设备经登录页连接后端后，账号下拉菜单只显示当前账号。
      for (const account of result.accounts ?? []) {
        if (!isValidBackendRestoreAccount(account)) continue;
        upsertSavedAccount(account.user, account.githubToken);
      }
    } catch (error) {
      await rollbackBackendConnection(previousBackendUrl);
      setBackendApiSecret(previousApiSecret);
      if (loginCommitted) {
        // 后端同步失败：回滚登录态，保持「同步失败不提交登录状态」契约。
        // 已落地的凭证保留在 savedAccounts 中（下次一键恢复），归档数据不受影响。
        setUser(null);
        setGitHubToken(null);
        // 审计修复：同步失败前已写入顶层的账号 B 部分同步结果必须一并丢弃——
        // 只清 user/token 时，下一次登录的 park 因无当前用户返回 null、
        // switchAccountWorkspace 在顶层已有数据时保留顶层，账号 B 的残留数据
        // 会被账号 C 看到。重置顶层工作区为空，且绝不归档（未完成同步的数据
        // 不能存为账号 B 的快照）。
        discardPartialLoginWorkspace();
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

    setIsLoading(true);
    setError('');
    let loginCommitted = false;
    try {
      // R2 防护（Issue #611）：先归档当前已登录账号（边缘态：持久化了 user 但
      // 停留在登录页），再向后端写入新 Token——否则 setupBackendGitHubToken 的
      // settings 写入会携带旧账号请求头，把新账号的 Token 写进旧账号分区。
      // 归档失败无副作用：parked 快照会在该账号下次登录时自动恢复。
      parkCurrentAccountForRestore();
      const user = await setupBackendGitHubToken(githubToken);
      // 恢复拉取固定到已验证账号（Issue #611 审计修复）：先落登录态再拉取，
      // 全部拉取请求携带已验证账号的 X-GitHub-Account-Id，不回退到服务端全局
      // active_account_id 分区。
      setGitHubToken(githubToken);
      setUser(user);
      loginCommitted = true;
      await syncBackendData();
    } catch (error) {
      if (loginCommitted) {
        // 后端同步失败：回滚登录态，保持「同步失败不提交登录状态」契约。
        setUser(null);
        setGitHubToken(null);
        // 审计修复：与 handleBackendConnect 的回滚分支一致——同步失败前写入
        // 顶层的部分同步结果一并丢弃（不归档），防止残留数据串到下一个账号。
        discardPartialLoginWorkspace();
      }
      setError(error instanceof Error ? error.message : t('loginScreen.setup-failed-please-try-again'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !isLoading) {
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
                  disabled={isLoading}
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
                      : t('loginScreen.set-up-github-access-token')}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {loginMode === 'github'
                    ? t('loginScreen.enter-your-github-personal-access-token-to-get-s')
                    : backendStep === 'credentials'
                      ? t('loginScreen.enter-the-backend-url-and-api-key-to-restore-you')
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

                {error && (
                  <div role="alert" className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-destructive">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <p className="text-sm">{error}</p>
                  </div>
                )}

                <Button
                  type="button"
                  onClick={loginMode === 'github' ? handleConnect : backendStep === 'credentials' ? handleBackendConnect : handleBackendTokenSetup}
                  disabled={isLoading || !(loginMode === 'github' ? token : backendStep === 'credentials' ? backendApiKey : backendGithubToken).trim() || (loginMode === 'backend' && backendStep === 'credentials' && !backendUrl.trim())}
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
              </div>

              <Button
                type="button"
                variant="ghost"
                className="mt-4 w-full text-muted-foreground hover:text-foreground"
                onClick={() => switchLoginMode(loginMode === 'github' ? 'backend' : 'github')}
                disabled={isLoading}
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
