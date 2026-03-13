import React, { useState } from 'react';
import { Star, Github, Key, User, ArrowRight, AlertCircle, Mail } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { authService } from '../services/auth';

export const LoginScreen: React.FC = () => {
  const [isLoginView, setIsLoginView] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [githubToken, setGithubTokenForm] = useState('');
  
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  
  const { setBackendApiSecret, setBackendUser, language } = useAppStore();

  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError(language === 'zh' ? '请输入邮箱和密码' : 'Please enter email and password');
      return;
    }
    
    if (!validateEmail(email)) {
      setError(language === 'zh' ? '请输入有效的邮箱地址' : 'Please enter a valid email address');
      return;
    }
    
    if (!isLoginView && !githubToken.trim()) {
      setError(language === 'zh' ? '请输入有效的GitHub token' : 'Please enter a valid GitHub token');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      if (isLoginView) {
        const response = await authService.login(email, password);
        setBackendApiSecret(response.token);
        setBackendUser(response.user);
      } else {
        const response = await authService.register(email, password, githubToken, displayName || undefined);
        setBackendApiSecret(response.token);
        setBackendUser(response.user);
      }
    } catch (err) {
      console.error('Authentication failed:', err);
      setError(
        err instanceof Error 
          ? err.message 
          : (language === 'zh' ? '认证失败，请检查您的输入。' : 'Failed to authenticate. Please check your inputs.')
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !isLoading) {
      if (document.activeElement?.tagName === 'INPUT') {
        const form = (e.target as HTMLElement).closest('form');
        form?.requestSubmit();
      }
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

        <div className="bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden">
          <div className="flex border-b border-gray-200">
            <button
              className={`flex-1 py-4 text-sm font-medium transition-colors ${isLoginView ? 'bg-blue-50 text-blue-700 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
              onClick={() => { setIsLoginView(true); setError(''); }}
            >
              {t('登录', 'Login')}
            </button>
            <button
              className={`flex-1 py-4 text-sm font-medium transition-colors ${!isLoginView ? 'bg-blue-50 text-blue-700 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
              onClick={() => { setIsLoginView(false); setError(''); }}
            >
              {t('注册', 'Register')}
            </button>
          </div>

          <div className="p-8">
            <div className="text-center mb-6">
              <Github className="w-10 h-10 text-gray-700 mx-auto mb-3" />
              <h2 className="text-xl font-semibold text-gray-900 mb-2">
                {isLoginView ? t('欢迎回来', 'Welcome Back') : t('创建账号', 'Create Account')}
              </h2>
              <p className="text-gray-600 text-sm">
                {isLoginView 
                  ? t('登录以管理您的GitHub Stars', 'Login to manage your GitHub Stars')
                  : t('注册新账号（首个用户将自动成为管理员）', 'Register a new account (First user becomes admin)')}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('邮箱', 'Email')}
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <input
                    type="email"
                    placeholder="email@example.com"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setError(''); }}
                    onKeyPress={handleKeyPress}
                    disabled={isLoading}
                    autoComplete="email"
                    className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-gray-900 disabled:bg-gray-50 disabled:text-gray-500"
                  />
                </div>
              </div>

              {!isLoginView && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t('显示名称（可选）', 'Display Name (Optional)')}
                  </label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                    <input
                      type="text"
                      placeholder={t('您的昵称', 'Your nickname')}
                      value={displayName}
                      onChange={(e) => { setDisplayName(e.target.value); setError(''); }}
                      onKeyPress={handleKeyPress}
                      disabled={isLoading}
                      autoComplete="name"
                      className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-gray-900 disabled:bg-gray-50 disabled:text-gray-500"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('密码', 'Password')}
                </label>
                <div className="relative">
                  <Key className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <input
                    type="password"
                    placeholder="Password"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError(''); }}
                    onKeyPress={handleKeyPress}
                    disabled={isLoading}
                    autoComplete={isLoginView ? "current-password" : "new-password"}
                    className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-gray-900 disabled:bg-gray-50 disabled:text-gray-500"
                  />
                </div>
              </div>

              {!isLoginView && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    GitHub Personal Access Token
                  </label>
                  <div className="relative">
                    <Github className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                    <input
                      type="password"
                      placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                      value={githubToken}
                      onChange={(e) => { setGithubTokenForm(e.target.value); setError(''); }}
                      onKeyPress={handleKeyPress}
                      disabled={isLoading}
                      className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-gray-900 disabled:bg-gray-50 disabled:text-gray-500"
                    />
                  </div>
                </div>
              )}

              {error && (
                <div className="flex items-center space-x-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}

              <button 
                type="submit"
                disabled={isLoading || !email.trim() || !password.trim() || (!isLoginView && !githubToken.trim())}
                className="w-full flex items-center justify-center space-x-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors mt-6"
              >
                {isLoading ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>{t('处理中...', 'Processing...')}</span>
                  </>
                ) : (
                  <>
                    <span>{isLoginView ? t('登录', 'Login') : t('注册', 'Register')}</span>
                    <ArrowRight className="w-5 h-5" />
                  </>
                )}
              </button>
            </form>
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
