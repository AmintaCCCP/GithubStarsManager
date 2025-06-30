import React from 'react';
import { Star, Settings, Calendar, Search, Moon, Sun, LogOut, RefreshCw, Github } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { GitHubApiService } from '../services/githubApi';

export const Header: React.FC = () => {
  const {
    user,
    theme,
    currentView,
    isLoading,
    lastSync,
    githubToken,
    repositories,
    setTheme,
    setCurrentView,
    setRepositories,
    setReleases,
    setLoading,
    setLastSync,
    logout,
    language,
  } = useAppStore();

  const handleSync = async () => {
    if (!githubToken) {
      alert('GitHub token not found. Please login again.');
      return;
    }
    
    setLoading(true);
    try {
      const githubApi = new GitHubApiService(githubToken);
      
      // 1. 获取所有starred仓库
      console.log('Fetching starred repositories...');
      const newRepositories = await githubApi.getAllStarredRepositories();
      
      // 2. 合并现有仓库数据（保留AI分析结果）
      const existingRepoMap = new Map(repositories.map(repo => [repo.id, repo]));
      const mergedRepositories = newRepositories.map(newRepo => {
        const existing = existingRepoMap.get(newRepo.id);
        if (existing) {
          // 保留AI分析结果，更新其他信息
          return {
            ...newRepo,
            ai_summary: existing.ai_summary,
            ai_tags: existing.ai_tags,
            ai_platforms: existing.ai_platforms,
            analyzed_at: existing.analyzed_at,
          };
        }
        return newRepo;
      });
      
      setRepositories(mergedRepositories);
      
      // 3. 获取Release信息
      console.log('Fetching releases...');
      const releases = await githubApi.getMultipleRepositoryReleases(mergedRepositories.slice(0, 20));
      setReleases(releases);
      
      setLastSync(new Date().toISOString());
      console.log('Sync completed successfully');
      
      // 显示同步结果
      const newRepoCount = newRepositories.length - repositories.length;
      if (newRepoCount > 0) {
        alert(`同步完成！发现 ${newRepoCount} 个新仓库。`);
      } else {
        alert('同步完成！所有仓库都是最新的。');
      }
    } catch (error) {
      console.error('Sync failed:', error);
      if (error instanceof Error && error.message.includes('token')) {
        alert('GitHub token 已过期或无效，请重新登录。');
        logout();
      } else {
        alert('同步失败，请检查网络连接。');
      }
    } finally {
      setLoading(false);
    }
  };

  const formatLastSync = (timestamp: string | null) => {
    if (!timestamp) return 'Never';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    
    if (diffHours < 1) return 'Just now';
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
  };

  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

  return (
    <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo and Title */}
          <div className="flex items-center space-x-3">
            <div className="flex items-center justify-center w-10 h-10 bg-blue-600 rounded-lg">
              <Star className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-white">
                GitHub Stars Manager
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                AI-powered repository management
              </p>
            </div>
          </div>

          {/* Navigation */}
          <nav className="hidden md:flex items-center space-x-1">
            <button
              onClick={() => setCurrentView('repositories')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                currentView === 'repositories'
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              <Search className="w-4 h-4 inline mr-2" />
              {t('仓库', 'Repositories')} ({repositories.length})
            </button>
            <button
              onClick={() => setCurrentView('releases')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                currentView === 'releases'
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              <Calendar className="w-4 h-4 inline mr-2" />
              {t('发布', 'Releases')}
            </button>
            <button
              onClick={() => setCurrentView('settings')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                currentView === 'settings'
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              <Settings className="w-4 h-4 inline mr-2" />
              {t('设置', 'Settings')}
            </button>
          </nav>

          {/* User Actions */}
          <div className="flex items-center space-x-3">
            {/* GitHub Repository Link */}
            <a
              href="https://github.com/AmintaCCCP/GithubStarsManager"
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              title={t('查看项目源码', 'View project source code')}
            >
              <Github className="w-5 h-5 text-gray-700 dark:text-gray-300" />
            </a>

            {/* Sync Status */}
            <div className="hidden sm:flex items-center space-x-2 text-sm text-gray-500 dark:text-gray-400">
              <span>{t('上次同步:', 'Last sync:')} {formatLastSync(lastSync)}</span>
              <button
                onClick={handleSync}
                disabled={isLoading}
                className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                title={t('同步仓库', 'Sync repositories')}
              >
                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {/* Theme Toggle */}
            <button
              onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              title={t('切换主题', 'Toggle theme')}
            >
              {theme === 'light' ? (
                <Moon className="w-5 h-5 text-gray-700 dark:text-gray-300" />
              ) : (
                <Sun className="w-5 h-5 text-gray-700 dark:text-gray-300" />
              )}
            </button>

            {/* User Profile */}
            {user && (
              <div className="flex items-center space-x-3">
                <img
                  src={user.avatar_url}
                  alt={user.name || user.login}
                  className="w-8 h-8 rounded-full"
                />
                <div className="hidden sm:block">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    {user.name || user.login}
                  </p>
                </div>
                <button
                  onClick={logout}
                  className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  title={t('退出登录', 'Logout')}
                >
                  <LogOut className="w-4 h-4 text-gray-700 dark:text-gray-300" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};