import { useT } from "../i18n/useT";
import React, { useState, useCallback, useRef } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, Database, Key, Link, Loader2, Moon, Sun } from 'lucide-react';
import { Github } from './ui/brand-icons';
import { useAppStore } from '../store/useAppStore';
import { resolveTheme } from '../store/selectors';
import { useShallow } from 'zustand/react/shallow';
import { useLoginActions } from '../features/lifecycle/hooks/useLoginActions';
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
      className="pointer-events-none absolute left-6 top-6 h-[49px] w-[calc(100%-48px)] opacity-55 text-tertiary"
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
  const { authenticateWithGitHub, configuredBackendUrl, restoreBackendSession, setupBackendGitHubToken, syncBackendData, syncTokenToBackend } = useLoginActions();
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
    setUser, setGitHubToken, setBackendApiSecret, backendApiSecret,
    repositories, gists, starredGists, releases, forks,
    customCategories, categoryOrder, hiddenDefaultCategoryIds,
    defaultCategoryOverrides, categoryListIdMap,
    lastSync, accountWorkspaces, language, setLanguage, themeMode, systemTheme, setThemeMode,
  } = useAppStore(useShallow((state) => ({
    setUser: state.setUser,
    setGitHubToken: state.setGitHubToken,
    setBackendApiSecret: state.setBackendApiSecret,
    backendApiSecret: state.backendApiSecret,
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
    setBackendApiSecret(apiKey);

    try {
      const result = await restoreBackendSession(url);
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
        if (overwrite) {
          await syncBackendData();
        }
        // Either way, complete login with backend credentials
      } else {
        // No conflict: sync backend data directly
        await syncBackendData();
      }

      setGitHubToken(result.githubToken);
      setUser(result.user);
    } catch (error) {
      setBackendApiSecret(previousApiSecret);
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
    try {
      const user = await setupBackendGitHubToken(githubToken);
      await syncBackendData();
      setGitHubToken(githubToken);
      setUser(user);
    } catch (error) {
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
    <div className="relative flex min-h-screen bg-navigator p-4 text-foreground transition-colors duration-base sm:p-6">
      <div aria-hidden className="titlebar-drag-region hd-drag fixed inset-x-0 top-0 h-10" />

      <div className="titlebar-no-drag hd-btns fixed right-4 top-3.5 z-50 flex items-center gap-1.5">
        <Select value={language} onValueChange={(value) => setLanguage(value as AppLanguage)}>
          <SelectTrigger
            aria-label={t('loginScreen.interface-language')}
            className="h-control w-[140px] rounded-md border-0 bg-raised px-2.5 text-label-sm shadow-elev-0 hover:bg-fill-hover"
          >
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

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-control rounded-md bg-raised text-secondary shadow-elev-0 hover:bg-fill-hover hover:text-foreground"
              onClick={() => setThemeMode(theme === 'light' ? 'dark' : 'light')}
              aria-label={t('loginScreen.toggle-theme')}
            >
              {theme === 'light' ? <Moon className="size-4" /> : <Sun className="size-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('loginScreen.toggle-theme')}</TooltipContent>
        </Tooltip>
      </div>

      {/* 语言/主题切换是 fixed 定位，窄屏会压住 logo，因此顶部留出它的高度。 */}
      <div className={cn('relative m-auto w-full max-w-md pt-10 sm:pt-0', showsTokenPermissions && 'lg:max-w-4xl')}>
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex size-11 items-center justify-center overflow-hidden rounded-lg bg-paper shadow-elev-0">
            <img src="./icon.png" alt="GitHub Stars Manager" className="h-full w-full object-cover" />
          </div>
          <h1 className="mb-1 text-title font-semibold text-foreground">GitHub Stars Manager</h1> {/* i18n-allow-literal */}
          <p className="text-label text-secondary">{t('loginScreen.ai-powered-repository-management')}</p>
        </div>

        <Card className="relative overflow-hidden rounded-xl border-0 bg-paper p-0 shadow-elev-2">
          <div className={cn('relative grid', showsTokenPermissions && 'lg:grid-cols-2')}>
            <div className="relative flex flex-col justify-center overflow-hidden px-6 py-10 sm:px-8">
              <LoginCardPattern />
              <div className="relative">
                <div className="mb-5 text-center">
                  <div className="mx-auto mb-3 flex size-9 items-center justify-center rounded-md bg-fill-hover text-foreground">
                    {loginMode === 'github' ? <Github className="size-4" /> : <Database className="size-4" />}
                  </div>
                  <h2 className="mb-1 text-label-lg font-semibold text-foreground">
                    {loginMode === 'github'
                      ? t('loginScreen.connect-with-github')
                      : backendStep === 'credentials'
                        ? t('loginScreen.connect-to-your-backend')
                        : t('loginScreen.set-up-github-access-token')}
                  </h2>
                  <p className="text-label text-secondary">
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
                  <div className="mb-4 rounded-md bg-success-tint px-3 py-2.5 text-foreground">
                    <div className="flex items-center gap-2">
                      <span className="size-1.5 shrink-0 rounded-full bg-status-green" />
                      <span className="text-label-sm font-medium text-status-green">
                        {t('loginScreen.cachedrepocount-repositories-cached', { cachedRepoCount: cachedRepoCount })}
                      </span>
                    </div>
                    {cachedLastSync && (
                      <p className="mt-1 pl-3.5 text-caption text-tertiary tabular-nums">
                        {t('loginScreen.last-sync')} {new Date(cachedLastSync).toLocaleString()}
                      </p>
                    )}
                  </div>
                )}

                <div className="space-y-3.5">
                  {loginMode === 'backend' && backendStep === 'credentials' && (
                    <div className="space-y-1.5">
                      <Label htmlFor="backend-url" className="text-label font-medium text-foreground">
                        {t('loginScreen.backend-url')}
                      </Label>
                      <div className="relative">
                        <Link className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-tertiary" />
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
                          className="pl-8"
                        />
                      </div>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label
                      htmlFor={loginMode === 'github' ? 'github-token' : backendStep === 'credentials' ? 'backend-api-key' : 'backend-github-token'}
                      className="text-label font-medium text-foreground"
                    >
                      {loginMode === 'github' || backendStep === 'githubToken' ? 'GitHub Personal Access Token' : 'API Key'}
                    </Label>
                    <div className="relative">
                      <Key className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-tertiary" />
                      <Input
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
                        className="pl-8"
                      />
                    </div>
                  </div>

                  {error && (
                    <div role="alert" className="flex items-center gap-2 rounded-md bg-destructive-tint px-3 py-2.5 text-destructive">
                      <AlertCircle className="size-4 shrink-0" />
                      <p className="text-label-sm">{error}</p>
                    </div>
                  )}

                  <Button
                    type="button"
                    variant="primary"
                    size="lg"
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
                        <ArrowRight className="size-4" />
                      </>
                    )}
                  </Button>
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  className="mt-3 w-full text-secondary hover:text-foreground"
                  onClick={() => switchLoginMode(loginMode === 'github' ? 'backend' : 'github')}
                  disabled={isLoading}
                >
                  {loginMode === 'github' ? (
                    <>
                      <span>{t('loginScreen.already-have-backend-data')}</span>
                      <ArrowRight className="size-4" />
                    </>
                  ) : (
                    <>
                      <ArrowLeft className="size-4" />
                      <span>{t('loginScreen.sign-in-with-github-token')}</span>
                    </>
                  )}
                </Button>
              </div>
            </div>

            {showsTokenPermissions && (
              <div className="flex flex-col justify-center border-t border-subtle bg-raised/50 px-6 py-10 sm:px-8 lg:border-l lg:border-t-0">
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
