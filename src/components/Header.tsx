import React from 'react';
import { Settings, Calendar, Search, Moon, Sun, LogOut, RefreshCw } from 'lucide-react';
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
            analysis_failed: existing.analysis_failed,
            custom_description: existing.custom_description,
            custom_tags: existing.custom_tags,
            custom_category: existing.custom_category,
            category_locked: existing.category_locked,
            last_edited: existing.last_edited,
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
    <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-50 hd-drag">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-3 py-3 sm:h-16 sm:flex-row sm:items-center sm:justify-between sm:py-0">
          {/* Logo and Title */}
          <div className="flex items-center justify-between gap-3 sm:justify-start">
            <div className="flex min-w-0 items-center space-x-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-lg overflow-hidden">
                <img 
                  src="./icon.png" 
                  alt="GitHub Stars Manager" 
                  className="w-10 h-10 object-cover"
                />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-xl font-bold text-gray-900 dark:text-white">
                  GitHub Stars Manager
                </h1>
                <p className="truncate text-sm text-gray-500 dark:text-gray-400">
                  AI-powered repository management
                </p>
              </div>
            </div>
            <button
              onClick={handleSync}
              disabled={isLoading}
              className="sm:hidden inline-flex items-center justify-center rounded-lg border border-gray-200 p-2 text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700"
              title={t('同步仓库', 'Sync repositories')}
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* Navigation */}
          <nav className="grid w-full grid-cols-3 gap-2 sm:hidden hd-btns">
            <button
              onClick={() => setCurrentView('repositories')}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                currentView === 'repositories'
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              {t('仓库', 'Repos')}
            </button>
            <button
              onClick={() => setCurrentView('releases')}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                currentView === 'releases'
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              {t('发布', 'Releases')}
            </button>
            <button
              onClick={() => setCurrentView('settings')}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                currentView === 'settings'
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              {t('设置', 'Settings')}
            </button>
          </nav>
          <nav className="hidden md:flex items-center space-x-1 hd-btns">
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
          <div className="flex items-center justify-between gap-3 sm:justify-end hd-btns">
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
              <div className="flex min-w-0 items-center space-x-3">
                <img
                  src={user.avatar_url}
                  alt={user.name || user.login}
                  className="w-8 h-8 rounded-full"
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900 dark:text-white">
                    {user.name || user.login}
                  </p>
                </div>
                <button
                  onClick={() => {
                    const confirmed = confirm(
                      language === 'zh'
                        ? '确定要退出登录吗？\n\n退出后您的 AI 配置、WebDAV 设置、自定义分类等数据仍会保留。如需完全清除所有数据，请前往「设置 → 数据管理」。'
                        : 'Are you sure you want to logout?\n\nYour AI configs, WebDAV settings, custom categories and other data will be preserved. To completely clear all data, please go to "Settings → Data Management".'
                    );
                    if (confirmed) {
                      logout();
                    }
                  }}
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
