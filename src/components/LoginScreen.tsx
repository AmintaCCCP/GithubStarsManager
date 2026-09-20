import { useT } from "../i18n/useT";
import React, { useState, useCallback, useRef } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, Database, Github, Key, Link, Moon, Sun } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
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
    lastSync, accountWorkspaces, language, setLanguage, theme, setTheme,
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
    theme: state.theme,
    setTheme: state.setTheme,
  })));
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

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4 text-foreground transition-colors duration-300">
      <div className="fixed right-4 top-4 z-50 flex items-center gap-2">
        <div className="flex items-center overflow-hidden rounded-md border border-border bg-card">
          <Select value={language} onValueChange={(value) => setLanguage(value as AppLanguage)}>
            <SelectTrigger aria-label={t('loginScreen.interface-language')} className="h-9 w-[150px] rounded-none border-0 bg-card shadow-none focus:ring-0 focus:ring-offset-0">
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
            <Button type="button" variant="ghost" size="icon" className="border border-border bg-card" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} aria-label={t('loginScreen.toggle-theme')}>
              {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('loginScreen.toggle-theme')}</TooltipContent>
        </Tooltip>
      </div>

      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center overflow-hidden rounded-md border border-border bg-card shadow-sm">
            <img src="./icon.png" alt="GitHub Stars Manager" className="h-full w-full object-cover" />
          </div>
          <h1 className="mb-2 text-2xl font-semibold tracking-tight text-foreground">GitHub Stars Manager</h1>
          <p className="text-sm text-muted-foreground">{t('loginScreen.ai-powered-repository-management')}</p>
        </div>

        <Card className="border-border bg-card p-6 shadow-sm sm:p-7">
          <div className="mb-6 text-center">
            {loginMode === 'github'
              ? <Github className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
              : <Database className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />}
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
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
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

          {loginMode === 'github' && <div className="mt-6 rounded-md border border-border bg-muted/50 p-4">
            <h3 className="mb-2 text-sm font-medium text-foreground">{t('loginScreen.how-to-create-a-github-token')}</h3>
            <ol className="space-y-1 text-xs leading-5 text-muted-foreground">
              <li>1. {t('loginScreen.go-to-github-settings-developer-settings-persona')}</li>
              <li>2. {t('loginScreen.click-generate-new-token-classic')}</li>
              <li>3. {t('loginScreen.select-scopes')} <strong>repo</strong>、<strong>user</strong> {t('loginScreen.and')} <strong>gist</strong></li>
              <li>4. {t('loginScreen.copy-the-generated-token-and-paste-it-above')}</li>
            </ol>
            <div className="mt-3">
              <a href="https://github.com/settings/tokens" target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-primary hover:underline">
                {t('loginScreen.create-token-on-github')}
              </a>
            </div>
          </div>}

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
