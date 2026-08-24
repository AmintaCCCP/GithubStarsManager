import React, { useState } from 'react';
import { AlertCircle, ArrowRight, Github, Key, Moon, Sun } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { GitHubApiService } from '../services/githubApi';
import { backend } from '../services/backendAdapter';
import { safeReadText } from '../utils/clipboardUtils';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

export const LoginScreen: React.FC = () => {
  const [token, setToken] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const { setUser, setGitHubToken, repositories, lastSync, language, setLanguage, theme, setTheme } = useAppStore();

  const handleConnect = async () => {
    if (!token.trim()) {
      setError(language === 'zh' ? '请输入有效的GitHub token' : 'Please enter a valid GitHub token');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const githubApi = new GitHubApiService(token);
      const user = await githubApi.getCurrentUser();
      setGitHubToken(token);
      setUser(user);

      if (backend.isAvailable) {
        try {
          await backend.syncSettings({ github_token: token });
        } catch (backendError) {
          console.warn('Failed to save GitHub token to backend:', backendError);
          setError(language === 'zh'
            ? '已登录，但 GitHub Token 未能保存到后端，README 等后端代理功能可能不可用。'
            : 'Signed in, but failed to save GitHub token to backend. README and other backend proxy features may be unavailable.');
        }
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

  const handleKeyPress = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !isLoading) {
      handleConnect();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && !isLoading) {
      const result = await safeReadText();
      if (result.success && result.text) {
        setToken(result.text.trim());
        setError('');
      } else {
        console.warn('Clipboard read failed:', result.error);
      }
    }
  };

  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

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
            <Github className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <h2 className="mb-2 text-lg font-semibold tracking-tight text-foreground">{t('连接GitHub', 'Connect with GitHub')}</h2>
            <p className="text-sm text-muted-foreground">{t('输入您的GitHub个人访问令牌以开始使用', 'Enter your GitHub personal access token to get started')}</p>
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
            <div className="space-y-2">
              <Label htmlFor="github-token">GitHub Personal Access Token</Label>
              <div className="relative">
                <Key className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground dark:text-muted-foreground/70" />
                <Input
                  id="github-token"
                  type="password"
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                  value={token}
                  onChange={(e) => {
                    setToken(e.target.value);
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

            <Button type="button" onClick={handleConnect} disabled={isLoading || !token.trim()} className="w-full">
              {isLoading ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                  <span>{t('连接中...', 'Connecting...')}</span>
                </>
              ) : (
                <>
                  <span>{t('连接到GitHub', 'Connect to GitHub')}</span>
                  <ArrowRight className="h-5 w-5" />
                </>
              )}
            </Button>
          </div>

          <div className="mt-6 rounded-md border border-border bg-muted/50 p-4">
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
          </div>
        </Card>
      </div>
    </div>
  );
};
