import React, { useState } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, Database, Github, Key, Link, Moon, Sun } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { useLoginActions } from '../features/lifecycle/hooks/useLoginActions';
import { safeReadText } from '../utils/clipboardUtils';
import { normalizeBackendUrl } from '../utils/backendUrl';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

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
  const { setUser, setGitHubToken, setBackendApiSecret, backendApiSecret, repositories, lastSync, language, setLanguage, theme, setTheme } = useAppStore(useShallow((state) => ({
    setUser: state.setUser,
    setGitHubToken: state.setGitHubToken,
    setBackendApiSecret: state.setBackendApiSecret,
    backendApiSecret: state.backendApiSecret,
    repositories: state.repositories,
    lastSync: state.lastSync,
    language: state.language,
    setLanguage: state.setLanguage,
    theme: state.theme,
    setTheme: state.setTheme,
  })));
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

  const switchLoginMode = (mode: 'github' | 'backend') => {
    setLoginMode(mode);
    setBackendStep('credentials');
    setTokenSetupReason('missing');
    setError('');
  };

  const handleConnect = async () => {
    if (!token.trim()) {
      setError(language === 'zh' ? '请输入有效的GitHub token' : 'Please enter a valid GitHub token');
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
        setError(language === 'zh'
          ? '已登录，但 GitHub Token 未能保存到后端，README 等后端代理功能可能不可用。'
          : 'Signed in, but failed to save GitHub token to backend. README and other backend proxy features may be unavailable.');
      }

      console.log('Successfully authenticated user:', user);
    } catch (error) {
      console.error('Authentication failed:', error);
      setError(
        error instanceof Error
          ? error.message
          : (language === 'zh' ? '认证失败，请检查您的token。' : 'Failed to authenticate. Please check your token.')
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleBackendConnect = async () => {
    const url = backendUrl.trim();
    const apiKey = backendApiKey.trim();
    if (!url || !apiKey) {
      setError(t('请输入后端 URL 和 API Key', 'Please enter the backend URL and API key'));
      return;
    }
    if (!normalizeBackendUrl(url)) {
      setError(t(
        '后端地址无效：远程后端需使用 HTTPS，仅 localhost 可使用 HTTP',
        'Invalid backend URL: remote backends must use HTTPS; only localhost may use HTTP'
      ));
      return;
    }

    setIsLoading(true);
    setError('');
    const previousApiSecret = backendApiSecret;
    setBackendApiSecret(apiKey);

    try {
      const result = await restoreBackendSession(url);
      if (result.status === 'backend-unavailable') {
        throw new Error(t('无法连接到该后端 URL', 'Unable to connect to this backend URL'));
      }
      if (result.status === 'unauthorized') {
        throw new Error(t('API Key 无效，请检查后重试', 'Invalid API key. Please check it and try again'));
      }
      if (result.status === 'restore-failed') {
        throw new Error(t('读取后端登录数据失败', 'Failed to read login data from the backend'));
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

      // Commit auth only after the data sync succeeds: the button promised
      // "connect and restore", and a sync failure must not leave a half-
      // logged-in store behind a rolled-back API secret.
      await syncBackendData();
      setGitHubToken(result.githubToken);
      setUser(result.user);
    } catch (error) {
      setBackendApiSecret(previousApiSecret);
      setError(error instanceof Error ? error.message : t('登录失败，请稍后重试', 'Sign-in failed. Please try again'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleBackendTokenSetup = async () => {
    const githubToken = backendGithubToken.trim();
    if (!githubToken) {
      setError(t('请输入有效的 GitHub Access Token', 'Please enter a valid GitHub access token'));
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
      setError(error instanceof Error ? error.message : t('配置失败，请稍后重试', 'Setup failed. Please try again'));
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

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4 text-foreground transition-colors duration-300">
      <div className="fixed right-4 top-4 z-50 flex items-center gap-2">
        <div className="flex items-center overflow-hidden rounded-md border border-border bg-card">
          <Button type="button" variant={language === 'zh' ? 'secondary' : 'ghost'} size="sm" onClick={() => setLanguage('zh')} aria-pressed={language === 'zh'} className="w-16 rounded-none">
            中文
          </Button>
          <Button type="button" variant={language === 'en' ? 'secondary' : 'ghost'} size="sm" onClick={() => setLanguage('en')} aria-pressed={language === 'en'} className="w-16 rounded-none">
            EN
          </Button>
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="border border-border bg-card" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} aria-label={t('切换主题', 'Toggle theme')}>
              {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('切换主题', 'Toggle theme')}</TooltipContent>
        </Tooltip>
      </div>

      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center overflow-hidden rounded-md border border-border bg-card shadow-sm">
            <img src="./icon.png" alt="GitHub Stars Manager" className="h-full w-full object-cover" />
          </div>
          <h1 className="mb-2 text-2xl font-semibold tracking-tight text-foreground">GitHub Stars Manager</h1>
          <p className="text-sm text-muted-foreground">{t('AI驱动的仓库管理工具', 'AI-powered repository management')}</p>
        </div>

        <Card className="border-border bg-card p-6 shadow-sm sm:p-7">
          <div className="mb-6 text-center">
            {loginMode === 'github'
              ? <Github className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
              : <Database className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />}
            <h2 className="mb-2 text-lg font-semibold tracking-tight text-foreground">
              {loginMode === 'github'
                ? t('连接GitHub', 'Connect with GitHub')
                : backendStep === 'credentials'
                  ? t('连接已有后端', 'Connect to your backend')
                  : t('配置 GitHub Access Token', 'Set up GitHub access token')}
            </h2>
            <p className="text-sm text-muted-foreground">
              {loginMode === 'github'
                ? t('输入您的GitHub个人访问令牌以开始使用', 'Enter your GitHub personal access token to get started')
                : backendStep === 'credentials'
                  ? t('输入后端地址和 API Key 恢复账号与数据', 'Enter the backend URL and API key to restore your account and data')
                  : tokenSetupReason === 'invalid'
                    ? t('后端保存的 GitHub Token 无法使用，请重新配置', 'The GitHub token stored on the backend is not working. Please set it up again')
                    : t('后端尚未配置 Token，请完成首次设置', 'No token is configured on this backend. Complete the initial setup')}
            </p>
          </div>

          {repositories.length > 0 && lastSync && (
            <div className="mb-4 rounded-md border border-success/30 bg-success/10 p-3 text-success">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-success" />
                <span className="text-sm font-medium">{t(`已缓存 ${repositories.length} 个仓库`, `${repositories.length} repositories cached`)}</span>
              </div>
              <p className="mt-1 text-xs text-success">{t('上次同步:', 'Last sync:')} {new Date(lastSync).toLocaleString()}</p>
            </div>
          )}

          <div className="space-y-4">
            {loginMode === 'backend' && backendStep === 'credentials' && (
              <div className="space-y-2">
                <Label htmlFor="backend-url">{t('后端 URL', 'Backend URL')}</Label>
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
                  placeholder={loginMode === 'github' || backendStep === 'githubToken' ? 'ghp_xxxxxxxxxxxxxxxxxxxx' : t('输入后端 API_SECRET', 'Enter backend API_SECRET')}
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
                  <span>{t('连接中…', 'Connecting…')}</span>
                </>
              ) : (
                <>
                  <span>
                    {loginMode === 'github'
                      ? t('连接到GitHub', 'Connect to GitHub')
                      : backendStep === 'credentials'
                        ? t('连接并恢复数据', 'Connect and restore data')
                        : t('保存并继续', 'Save and continue')}
                  </span>
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </div>

          {loginMode === 'github' && <div className="mt-6 rounded-md border border-border bg-muted/50 p-4">
            <h3 className="mb-2 text-sm font-medium text-foreground">{t('如何创建GitHub token:', 'How to create a GitHub token:')}</h3>
            <ol className="space-y-1 text-xs leading-5 text-muted-foreground">
              <li>1. {t('访问GitHub Settings → Developer settings → Personal access tokens', 'Go to GitHub Settings → Developer settings → Personal access tokens')}</li>
              <li>2. {t('点击"Generate new token (classic)"', 'Click "Generate new token (classic)"')}</li>
              <li>3. {t('选择权限范围：', 'Select scopes:')} <strong>repo</strong>、<strong>user</strong> {t('和', 'and')} <strong>gist</strong></li>
              <li>4. {t('复制生成的token并粘贴到上方', 'Copy the generated token and paste it above')}</li>
            </ol>
            <div className="mt-3">
              <a href="https://github.com/settings/tokens" target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-primary hover:underline">
                {t('在GitHub上创建token →', 'Create token on GitHub →')}
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
                <span>{t('已有后端数据', 'Already have backend data')}</span>
                <ArrowRight className="h-4 w-4" />
              </>
            ) : (
              <>
                <ArrowLeft className="h-4 w-4" />
                <span>{t('使用 GitHub Token 登录', 'Sign in with GitHub token')}</span>
              </>
            )}
          </Button>
        </Card>
      </div>
    </div>
  );
};
