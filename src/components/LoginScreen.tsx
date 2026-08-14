import React, { useState } from 'react';
import { Github, Key, ArrowRight, AlertCircle, Moon, Sun } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { GitHubApiService } from '../services/githubApi';
import { backend } from '../services/backendAdapter';
import { safeReadText } from '../utils/clipboardUtils';

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
      // Test the token by fetching user info
      const githubApi = new GitHubApiService(token);
      const user = await githubApi.getCurrentUser();
      
      // If successful, save the token and user info
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

    // 兼容桌面端首次登录场景下 Ctrl/Cmd + V 无法触发默认粘贴的问题
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && !isLoading) {
      const result = await safeReadText();
      if (result.success && result.text) {
        setToken(result.text.trim());
        setError('');
      } else {
        // 读取剪贴板失败，让浏览器/系统默认行为继续兜底
        console.warn('Clipboard read failed:', result.error);
      }
    }
  };

  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

  return (
    <div className="linear-login-shell min-h-screen flex items-center justify-center p-4 transition-colors duration-300">
      {/* Theme and Language Toggle */}
      <div className="fixed top-4 right-4 flex items-center gap-2 z-50">
        {/* Language Toggle */}
        <div className="linear-login-toggle flex items-center overflow-hidden">
          <button
            onClick={() => setLanguage('zh')}
            className={`linear-login-language px-3 py-2 w-16 text-center text-sm font-medium ${language === 'zh' ? 'is-active' : ''}`}
          >
            中文
          </button>
          <button
            onClick={() => setLanguage('en')}
            className={`linear-login-language px-3 py-2 w-16 text-center text-sm font-medium ${language === 'en' ? 'is-active' : ''}`}
          >
            EN
          </button>
        </div>

        {/* Theme Toggle */}
        <button
          onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
          className="linear-icon-button linear-login-theme p-2"
          title={t('切换主题', 'Toggle theme')}
        >
          {theme === 'light' ? (
            <Moon className="w-5 h-5 text-gray-900 dark:text-text-primary" />
          ) : (
            <Sun className="w-5 h-5 text-gray-300" />
          )}
        </button>
      </div>

      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <div className="linear-login-mark flex items-center justify-center w-14 h-14 mx-auto mb-4 overflow-hidden">
            <img
              src="./icon.png"
              alt="GitHub Stars Manager"
              className="w-full h-full object-cover"
            />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-text-primary mb-2">
            GitHub Stars Manager
          </h1>
          <p className="text-gray-700 dark:text-text-tertiary text-lg">
            {t('AI驱动的仓库管理工具', 'AI-powered repository management')}
          </p>
        </div>

        <div className="linear-login-card p-6 sm:p-7">
          <div className="text-center mb-6">
            <Github className="w-10 h-10 text-gray-900 dark:text-text-secondary mx-auto mb-3" />
            <h2 className="text-xl font-semibold text-gray-900 dark:text-text-primary mb-2">
              {t('连接GitHub', 'Connect with GitHub')}
            </h2>
            <p className="text-gray-700 dark:text-text-tertiary text-sm">
              {t('输入您的GitHub个人访问令牌以开始使用', 'Enter your GitHub personal access token to get started')}
            </p>
          </div>

          {/* 显示缓存状态 */}
          {repositories.length > 0 && lastSync && (
            <div className="mb-4 p-3 bg-status-emerald border border-black/[0.06] dark:border-white/[0.04] dark:border-black/[0.06] dark:border-white/[0.04] rounded-lg">
              <div className="flex items-center space-x-2 text-status-emerald ">
                <div className="w-2 h-2 bg-status-emerald0 rounded-full"></div>
                <span className="text-sm font-medium">
                  {t(`已缓存 ${repositories.length} 个仓库`, `${repositories.length} repositories cached`)}
                </span>
              </div>
              <p className="text-xs text-status-emerald mt-1">
                {t('上次同步:', 'Last sync:')} {new Date(lastSync).toLocaleString()}
              </p>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-900 dark:text-text-secondary mb-2">
                GitHub Personal Access Token
              </label>
              <div className="relative">
                <Key className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-text-quaternary w-5 h-5" />
                <input
                  type="password"
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                  value={token}
                  onChange={(e) => {
                    setToken(e.target.value);
                    setError(''); // Clear error when user types
                  }}
                  onKeyDown={handleKeyPress}
                  disabled={isLoading}
                  className="ui-field w-full pl-10 pr-4 py-3 text-gray-900 dark:text-text-primary disabled:opacity-60"
                />
              </div>
            </div>

            {error && (
              <div className="flex items-center space-x-2 p-3 bg-gray-100 dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.04] dark:border-black/[0.06] dark:border-white/[0.04] rounded-lg">
                <AlertCircle className="w-5 h-5 text-gray-700 dark:text-text-secondary flex-shrink-0" />
                <p className="text-sm text-gray-700 dark:text-text-secondary ">{error}</p>
              </div>
            )}

            <button 
              onClick={handleConnect}
              disabled={isLoading || !token.trim()}
              className="ui-button-primary w-full flex items-center justify-center space-x-2 px-6 py-3 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              {isLoading ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>{t('连接中...', 'Connecting...')}</span>
                </>
              ) : (
                <>
                  <span>{t('连接到GitHub', 'Connect to GitHub')}</span>
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </button>
          </div>

          <div className="linear-login-help mt-6 p-4">
            <h3 className="font-medium text-gray-900 dark:text-text-primary mb-2 text-sm">
              {t('如何创建GitHub token:', 'How to create a GitHub token:')}
            </h3>
            <ol className="text-xs text-gray-700 dark:text-text-tertiary space-y-1">
              <li>1. {t('访问GitHub Settings → Developer settings → Personal access tokens', 'Go to GitHub Settings → Developer settings → Personal access tokens')}</li>
              <li>2. {t('点击"Generate new token (classic)"', 'Click "Generate new token (classic)"')}</li>
              <li>3. {t('选择权限范围：', 'Select scopes:')} <strong>repo</strong>、<strong>user</strong> {t('和', 'and')} <strong>gist</strong></li>
              <li>4. {t('复制生成的token并粘贴到上方', 'Copy the generated token and paste it above')}</li>
            </ol>
            <div className="mt-3">
              <a
                href="https://github.com/settings/tokens"
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-violet hover:text-gray-700 dark:text-text-secondary dark:text-brand-violet dark:hover:text-gray-700 dark:text-text-secondary text-sm font-medium hover:underline"
              >
                {t('在GitHub上创建token →', 'Create token on GitHub →')}
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
