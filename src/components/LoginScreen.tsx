import React, { useState } from 'react';
import { Star, Github, Key, ArrowRight, AlertCircle } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { GitHubApiService } from '../services/githubApi';

export const LoginScreen: React.FC = () => {
  const [token, setToken] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const { setUser, setGitHubToken, repositories, lastSync, language } = useAppStore();

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

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isLoading) {
      handleConnect();
    }
  };

  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl mx-auto mb-4 shadow-lg">
            <Star className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            GitHub Stars Manager
          </h1>
          <p className="text-gray-600 text-lg">
            {t('AI驱动的仓库管理工具', 'AI-powered repository management')}
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-8">
          <div className="text-center mb-6">
            <Github className="w-10 h-10 text-gray-700 mx-auto mb-3" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              {t('连接GitHub', 'Connect with GitHub')}
            </h2>
            <p className="text-gray-600 text-sm">
              {t('输入您的GitHub个人访问令牌以开始使用', 'Enter your GitHub personal access token to get started')}
            </p>
          </div>

          {/* 显示缓存状态 */}
          {repositories.length > 0 && lastSync && (
            <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
              <div className="flex items-center space-x-2 text-green-700">
                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                <span className="text-sm font-medium">
                  {t(`已缓存 ${repositories.length} 个仓库`, `${repositories.length} repositories cached`)}
                </span>
              </div>
              <p className="text-xs text-green-600 mt-1">
                {t('上次同步:', 'Last sync:')} {new Date(lastSync).toLocaleString()}
              </p>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                GitHub Personal Access Token
              </label>
              <div className="relative">
                <Key className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                <input
                  type="password"
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                  value={token}
                  onChange={(e) => {
                    setToken(e.target.value);
                    setError(''); // Clear error when user types
                  }}
                  onKeyPress={handleKeyPress}
                  disabled={isLoading}
                  className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-gray-900 disabled:bg-gray-50 disabled:text-gray-500"
                />
              </div>
            </div>

            {error && (
              <div className="flex items-center space-x-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            <button 
              onClick={handleConnect}
              disabled={isLoading || !token.trim()}
              className="w-full flex items-center justify-center space-x-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
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

          <div className="mt-6 p-4 bg-gray-50 rounded-lg">
            <h3 className="font-medium text-gray-900 mb-2 text-sm">
              {t('如何创建GitHub token:', 'How to create a GitHub token:')}
            </h3>
            <ol className="text-xs text-gray-600 space-y-1">
              <li>1. {t('访问GitHub Settings → Developer settings → Personal access tokens', 'Go to GitHub Settings → Developer settings → Personal access tokens')}</li>
              <li>2. {t('点击"Generate new token (classic)"', 'Click "Generate new token (classic)"')}</li>
              <li>3. {t('选择权限范围：', 'Select scopes:')} <strong>repo</strong> {t('和', 'and')} <strong>user</strong></li>
              <li>4. {t('复制生成的token并粘贴到上方', 'Copy the generated token and paste it above')}</li>
            </ol>
            <div className="mt-3">
              <a
                href="https://github.com/settings/tokens"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:text-blue-700 text-sm font-medium hover:underline"
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