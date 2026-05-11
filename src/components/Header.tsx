import React, { useState, useRef, useEffect } from 'react';
import { Settings, Calendar, Search, Moon, Sun, LogOut, RefreshCw, TrendingUp, GitFork } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { Repository } from '../types';
import { GitHubApiService } from '../services/githubApi';
import { backend } from '../services/backendAdapter';
import { useDialog } from '../hooks/useDialog';

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

  const { toast, confirm } = useDialog();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isTextWrapped, setIsTextWrapped] = useState(false);
  const navRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const checkIfTextWrapped = () => {
      const windowWidth = window.innerWidth;
      if (windowWidth < 1100) {
        setIsTextWrapped(true);
        return;
      }

      if (navRef.current) {
        const buttons = navRef.current.querySelectorAll('button');
        let wrapped = false;
        buttons.forEach(button => {
          if (button.scrollHeight > button.clientHeight + 5) {
            wrapped = true;
          }
        });
        setIsTextWrapped(wrapped);
      }
    };

    checkIfTextWrapped();
    
    const resizeObserver = new ResizeObserver(checkIfTextWrapped);
    if (navRef.current) {
      resizeObserver.observe(navRef.current);
    }
    
    window.addEventListener('resize', checkIfTextWrapped);
    
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', checkIfTextWrapped);
    };
  }, []);

  const handleSync = async () => {
    // 优先通过后端代理同步，确保后端为唯一数据源
    if (backend.isAvailable) {
      setLoading(true);
      try {
        // 分页拉取所有星标仓库（通过后端代理，Token 存储在后端）
        const allStarred: Repository[] = [];
        let page = 1;
        const perPage = 100;
        while (true) {
          const repos = await backend.fetchStarredRepos(page, perPage);
          allStarred.push(...repos);
          if (repos.length < perPage) break;
          page++;
        }

        // 合并已有数据，保留 AI 分析结果和自定义字段
        const existingRepoMap = new Map(repositories.map(repo => [repo.id, repo]));
        const merged = allStarred.map(newRepo => {
          const existing = existingRepoMap.get(newRepo.id);
          if (existing) {
            return {
              ...newRepo,
              has_fetched_releases: existing.has_fetched_releases,
              last_release_fetch_time: existing.last_release_fetch_time,
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

        // 全量同步到后端数据库
        await backend.syncRepositories(merged, true);

        setRepositories(merged);
        setLastSync(new Date().toISOString());

        const existingIds = new Set(repositories.map(r => r.id));
        const newRepoCount = allStarred.filter(r => !existingIds.has(r.id)).length;
        if (newRepoCount > 0) {
          toast(t(`同步完成！发现 ${newRepoCount} 个新仓库。`, `Sync completed! Found ${newRepoCount} new repositories.`), 'success');
        } else {
          toast(t('同步完成！所有仓库都是最新的。', 'Sync completed! All repositories are up to date.'), 'info');
        }
      } catch (error) {
        console.error('Backend sync failed:', error);
        toast(t('同步失败，请检查后端连接。', 'Sync failed. Please check backend connection.'), 'error');
      } finally {
        setLoading(false);
      }
      return;
    }

    // 后端不可用时走前端直接调用 GitHub API（降级方案）
    if (!githubToken) {
      toast(t('GitHub token 未找到，请重新登录。', 'GitHub token not found. Please login again.'), 'error');
      return;
    }

    setLoading(true);
    try {
      const githubApi = new GitHubApiService(githubToken);
      const newRepositories = await githubApi.getAllStarredRepositories();

      const existingRepoMap = new Map(repositories.map(repo => [repo.id, repo]));
      const mergedRepositories = newRepositories.map(newRepo => {
        const existing = existingRepoMap.get(newRepo.id);
        if (existing) {
          return {
            ...newRepo,
            has_fetched_releases: existing.has_fetched_releases,
            last_release_fetch_time: existing.last_release_fetch_time,
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
      setLastSync(new Date().toISOString());

      const existingIds = new Set(repositories.map(r => r.id));
      const newRepoCount = newRepositories.filter(r => !existingIds.has(r.id)).length;
      if (newRepoCount > 0) {
        toast(t(`同步完成！发现 ${newRepoCount} 个新仓库。`, `Sync completed! Found ${newRepoCount} new repositories.`), 'success');
      } else {
        toast(t('同步完成！所有仓库都是最新的。', 'Sync completed! All repositories are up to date.'), 'info');
      }
    } catch (error) {
      console.error('Sync failed:', error);
      if (error instanceof Error && error.message.includes('token')) {
        toast(t('GitHub token 已过期或无效，请重新登录。', 'GitHub token has expired or is invalid. Please login again.'), 'error');
        logout();
      } else {
        toast(t('同步失败，请检查网络连接。', 'Sync failed. Please check your network connection.'), 'error');
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
    <header className="bg-light-bg dark:bg-panel-dark border-b border-black/[0.06] dark:border-white/[0.04] sticky top-0 z-50 hd-drag lg:hd-drag relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14 sm:h-16">
          {/* Logo and Title */}
          <div className="flex min-w-0 items-center space-x-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg overflow-hidden flex-shrink-0">
              <img 
                src="./icon.png" 
                alt="GitHub Stars Manager" 
                className="w-10 h-10 object-cover"
              />
            </div>
            <div className="min-w-0 hidden sm:block">
              <h1 className="truncate text-xl font-medium text-gray-900 dark:text-text-primary tracking-tight">
                GitHub Stars Manager
              </h1>
              <p className="truncate text-sm text-gray-500 dark:text-text-tertiary">
                AI-powered repository management
              </p>
            </div>
            <div className="min-w-0 sm:hidden">
              <h1 className="truncate text-base font-bold text-gray-900 dark:text-text-primary tracking-tight">
                GitHub Stars
              </h1>
            </div>
          </div>

          {/* Navigation - Desktop (≥1300px): Icon + Text + Badge */}
          <nav ref={navRef} className={`hidden xl:flex items-center space-x-1 hd-btns xl:hd-btns ${isTextWrapped ? 'flex-wrap' : ''}`}>
            <button
              onClick={() => setCurrentView('repositories')}
              aria-label={isTextWrapped ? t('仓库', 'Repositories') : undefined}
              title={isTextWrapped ? t('仓库', 'Repositories') : undefined}
              className={`${isTextWrapped ? 'p-2.5' : 'px-4 py-2'} rounded-lg font-medium transition-colors ${
                currentView === 'repositories'
                  ? 'bg-white dark:bg-white/[0.1] text-gray-900 dark:text-text-primary shadow-sm border border-black/[0.06] dark:border-white/[0.04]'
                  : 'text-gray-700 dark:text-text-secondary hover:bg-light-surface dark:hover:bg-white/5'
              }`}
            >
              <Search className={`${isTextWrapped ? 'w-5 h-5' : 'w-4 h-4'} ${isTextWrapped ? '' : 'inline mr-2'}`} />
              {!isTextWrapped && (
                <>
                  {t('仓库', 'Repositories')}
                  {currentView === 'repositories' && repositories.length > 0 && (
                    <span className="ml-1.5 text-sm text-brand-violet">
                      {repositories.length}
                    </span>
                  )}
                </>
              )}
            </button>
            <button
              onClick={() => setCurrentView('releases')}
              aria-label={isTextWrapped ? t('发布', 'Releases') : undefined}
              title={isTextWrapped ? t('发布', 'Releases') : undefined}
              className={`${isTextWrapped ? 'p-2.5' : 'px-4 py-2'} rounded-lg font-medium transition-colors ${
                currentView === 'releases'
                  ? 'bg-white dark:bg-white/[0.1] text-gray-900 dark:text-text-primary shadow-sm border border-black/[0.06] dark:border-white/[0.04]'
                  : 'text-gray-700 dark:text-text-secondary hover:bg-light-surface dark:hover:bg-white/5'
              }`}
            >
              <Calendar className={`${isTextWrapped ? 'w-5 h-5' : 'w-4 h-4'} ${isTextWrapped ? '' : 'inline mr-2'}`} />
              {!isTextWrapped && t('发布', 'Releases')}
            </button>
            <button
              onClick={() => setCurrentView('forks')}
              aria-label={isTextWrapped ? t('复刻', 'Forks') : undefined}
              title={isTextWrapped ? t('复刻', 'Forks') : undefined}
              className={`${isTextWrapped ? 'p-2.5' : 'px-4 py-2'} rounded-lg font-medium transition-colors ${
                currentView === 'forks'
                  ? 'bg-white dark:bg-white/[0.1] text-gray-900 dark:text-text-primary shadow-sm border border-black/[0.06] dark:border-white/[0.04]'
                  : 'text-gray-700 dark:text-text-secondary hover:bg-light-surface dark:hover:bg-white/5'
              }`}
            >
              <GitFork className={`${isTextWrapped ? 'w-5 h-5' : 'w-4 h-4'} ${isTextWrapped ? '' : 'inline mr-2'}`} />
              {!isTextWrapped && t('复刻', 'Forks')}
            </button>
            <button
              onClick={() => setCurrentView('subscription')}
              aria-label={isTextWrapped ? t('趋势', 'Trending') : undefined}
              title={isTextWrapped ? t('趋势', 'Trending') : undefined}
              className={`${isTextWrapped ? 'p-2.5' : 'px-4 py-2'} rounded-lg font-medium transition-colors ${
                currentView === 'subscription'
                  ? 'bg-white dark:bg-white/[0.1] text-gray-900 dark:text-text-primary shadow-sm border border-black/[0.06] dark:border-white/[0.04]'
                  : 'text-gray-700 dark:text-text-secondary hover:bg-light-surface dark:hover:bg-white/5'
              }`}
            >
              <TrendingUp className={`${isTextWrapped ? 'w-5 h-5' : 'w-4 h-4'} ${isTextWrapped ? '' : 'inline mr-2'}`} />
              {!isTextWrapped && t('趋势', 'Trending')}
            </button>
            <button
              onClick={() => setCurrentView('settings')}
              aria-label={isTextWrapped ? t('设置', 'Settings') : undefined}
              title={isTextWrapped ? t('设置', 'Settings') : undefined}
              className={`${isTextWrapped ? 'p-2.5' : 'px-4 py-2'} rounded-lg font-medium transition-colors ${
                currentView === 'settings'
                  ? 'bg-white dark:bg-white/[0.1] text-gray-900 dark:text-text-primary shadow-sm border border-black/[0.06] dark:border-white/[0.04]'
                  : 'text-gray-700 dark:text-text-secondary hover:bg-light-surface dark:hover:bg-white/5'
              }`}
            >
              <Settings className={`${isTextWrapped ? 'w-5 h-5' : 'w-4 h-4'} ${isTextWrapped ? '' : 'inline mr-2'}`} />
              {!isTextWrapped && t('设置', 'Settings')}
            </button>
          </nav>

          {/* Navigation - Tablet (768px-1299px): Icon only */}
          <nav className="hidden md:flex xl:hidden items-center space-x-1 hd-btns md:hd-btns">
            <button
              onClick={() => setCurrentView('repositories')}
              className={`p-2.5 rounded-lg transition-colors ${
                currentView === 'repositories'
                  ? 'bg-white dark:bg-white/[0.1] text-gray-900 dark:text-text-primary shadow-sm border border-black/[0.06] dark:border-white/[0.04]'
                  : 'text-gray-700 dark:text-text-secondary hover:bg-light-surface dark:hover:bg-white/5'
              }`}
              title={t('仓库', 'Repositories')}
            >
              <Search className="w-5 h-5" />
            </button>
            <button
              onClick={() => setCurrentView('releases')}
              className={`p-2.5 rounded-lg transition-colors ${
                currentView === 'releases'
                  ? 'bg-white dark:bg-white/[0.1] text-gray-900 dark:text-text-primary shadow-sm border border-black/[0.06] dark:border-white/[0.04]'
                  : 'text-gray-700 dark:text-text-secondary hover:bg-light-surface dark:hover:bg-white/5'
              }`}
              title={t('发布', 'Releases')}
            >
              <Calendar className="w-5 h-5" />
            </button>
            <button
              onClick={() => setCurrentView('forks')}
              className={`p-2.5 rounded-lg transition-colors ${
                currentView === 'forks'
                  ? 'bg-white dark:bg-white/[0.1] text-gray-900 dark:text-text-primary shadow-sm border border-black/[0.06] dark:border-white/[0.04]'
                  : 'text-gray-700 dark:text-text-secondary hover:bg-light-surface dark:hover:bg-white/5'
              }`}
              title={t('复刻', 'Forks')}
            >
              <GitFork className="w-5 h-5" />
            </button>
            <button
              onClick={() => setCurrentView('subscription')}
              className={`p-2.5 rounded-lg transition-colors ${
                currentView === 'subscription'
                  ? 'bg-white dark:bg-white/[0.1] text-gray-900 dark:text-text-primary shadow-sm border border-black/[0.06] dark:border-white/[0.04]'
                  : 'text-gray-700 dark:text-text-secondary hover:bg-light-surface dark:hover:bg-white/5'
              }`}
              title={t('趋势', 'Trending')}
            >
              <TrendingUp className="w-5 h-5" />
            </button>
            <button
              onClick={() => setCurrentView('settings')}
              className={`p-2.5 rounded-lg transition-colors ${
                currentView === 'settings'
                  ? 'bg-white dark:bg-white/[0.1] text-gray-900 dark:text-text-primary shadow-sm border border-black/[0.06] dark:border-white/[0.04]'
                  : 'text-gray-700 dark:text-text-secondary hover:bg-light-surface dark:hover:bg-white/5'
              }`}
              title={t('设置', 'Settings')}
            >
              <Settings className="w-5 h-5" />
            </button>
          </nav>

          {/* Mobile Dropdown Menu (<768px) */}
          {mobileMenuOpen && (
            <div className="absolute top-[calc(100%+1px)] left-0 right-0 md:hidden bg-light-bg dark:bg-surface-3 border-b border-black/[0.06] dark:border-white/[0.04] shadow-dialog animate-expand-fade z-[100]">
              <nav className="flex flex-col p-2 space-y-1">
                <button
                  onClick={() => {
                    setCurrentView('repositories');
                    setMobileMenuOpen(false);
                  }}
                  className={`flex items-center justify-between px-4 py-3 rounded-lg font-medium transition-colors ${
                    currentView === 'repositories'
                      ? 'bg-white dark:bg-white/[0.1] text-gray-900 dark:text-text-primary shadow-sm border border-black/[0.06] dark:border-white/[0.04]'
                      : 'text-gray-700 dark:text-text-secondary hover:bg-light-surface dark:hover:bg-white/5'
                  }`}
                >
                  <div className="flex items-center">
                    <Search className="w-5 h-5 mr-3" />
                    {t('仓库', 'Repositories')}
                  </div>
                  {currentView === 'repositories' && repositories.length > 0 && (
                    <span className="text-sm text-brand-violet">
                      {repositories.length}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => {
                    setCurrentView('releases');
                    setMobileMenuOpen(false);
                  }}
                  className={`flex items-center justify-between px-4 py-3 rounded-lg font-medium transition-colors ${
                    currentView === 'releases'
                      ? 'bg-white dark:bg-white/[0.1] text-gray-900 dark:text-text-primary shadow-sm border border-black/[0.06] dark:border-white/[0.04]'
                      : 'text-gray-700 dark:text-text-secondary hover:bg-light-surface dark:hover:bg-white/5'
                  }`}
                >
                  <div className="flex items-center">
                    <Calendar className="w-5 h-5 mr-3" />
                    {t('发布', 'Releases')}
                  </div>
                </button>
                <button
                  onClick={() => {
                    setCurrentView('forks');
                    setMobileMenuOpen(false);
                  }}
                  className={`flex items-center justify-between px-4 py-3 rounded-lg font-medium transition-colors ${
                    currentView === 'forks'
                      ? 'bg-white dark:bg-white/[0.1] text-gray-900 dark:text-text-primary shadow-sm border border-black/[0.06] dark:border-white/[0.04]'
                      : 'text-gray-700 dark:text-text-secondary hover:bg-light-surface dark:hover:bg-white/5'
                  }`}
                >
                  <div className="flex items-center">
                    <GitFork className="w-5 h-5 mr-3" />
                    {t('复刻', 'Forks')}
                  </div>
                </button>
                <button
                  onClick={() => {
                    setCurrentView('subscription');
                    setMobileMenuOpen(false);
                  }}
                  className={`flex items-center justify-between px-4 py-3 rounded-lg font-medium transition-colors ${
                    currentView === 'subscription'
                      ? 'bg-white dark:bg-white/[0.1] text-gray-900 dark:text-text-primary shadow-sm border border-black/[0.06] dark:border-white/[0.04]'
                      : 'text-gray-700 dark:text-text-secondary hover:bg-light-surface dark:hover:bg-white/5'
                  }`}
                >
                  <div className="flex items-center">
                    <TrendingUp className="w-5 h-5 mr-3" />
                    {t('趋势', 'Trending')}
                  </div>
                </button>
                <button
                  onClick={() => {
                    setCurrentView('settings');
                    setMobileMenuOpen(false);
                  }}
                  className={`flex items-center px-4 py-3 rounded-lg font-medium transition-colors ${
                    currentView === 'settings'
                      ? 'bg-white dark:bg-white/[0.1] text-gray-900 dark:text-text-primary shadow-sm border border-black/[0.06] dark:border-white/[0.04]'
                      : 'text-gray-700 dark:text-text-secondary hover:bg-light-surface dark:hover:bg-white/5'
                  }`}
                >
                  <div className="flex items-center">
                    <Settings className="w-5 h-5 mr-3" />
                    {t('设置', 'Settings')}
                  </div>
                </button>
              </nav>
            </div>
          )}

          {/* User Actions */}
          <div className="flex items-center gap-2 sm:gap-3 hd-btns lg:hd-btns">
            {/* Sync Status */}
            <div className="hidden sm:flex items-center space-x-2 text-sm text-gray-500 dark:text-text-tertiary">
              <span>{t('上次同步:', 'Last sync:')} {formatLastSync(lastSync)}</span>
              <button
                onClick={handleSync}
                disabled={isLoading}
                className="p-1 rounded hover:bg-light-surface dark:hover:bg-white/5 transition-colors disabled:opacity-50"
                title={t('同步星标仓库列表（不包含Release）', 'Sync starred repos list (excludes Release)')}
              >
                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {/* Theme Toggle */}
            <button
              onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
              className="p-2 rounded-lg hover:bg-light-surface dark:hover:bg-white/5 transition-colors"
              title={t('切换主题', 'Toggle theme')}
            >
              {theme === 'light' ? (
                <Moon className="w-5 h-5 text-gray-700 dark:text-text-secondary" />
              ) : (
                <Sun className="w-5 h-5 text-gray-700 dark:text-text-secondary" />
              )}
            </button>

            {/* User Profile */}
            {user && (
              <div className="flex items-center space-x-2 sm:space-x-3">
                <img
                  src={user.avatar_url}
                  alt={user.name || user.login}
                  className="w-8 h-8 rounded-full"
                />
                <div className="min-w-0 hidden sm:block">
                  <p className="truncate text-sm font-medium text-gray-900 dark:text-text-primary">
                    {user.name || user.login}
                  </p>
                </div>
                <button
                  onClick={async () => {
                    const confirmed = await confirm(
                      t('退出登录确认', 'Logout Confirmation'),
                      language === 'zh'
                        ? '退出后您的 AI 配置、WebDAV 设置、自定义分类等数据仍会保留。如需完全清除所有数据，请前往「设置 → 数据管理」。'
                        : 'Your AI configs, WebDAV settings, custom categories and other data will be preserved. To completely clear all data, please go to "Settings → Data Management".',
                      { type: 'warning' }
                    );
                    if (confirmed) {
                      logout();
                    }
                  }}
                    className="p-2 rounded-lg hover:bg-light-surface dark:hover:bg-white/5 transition-colors"
                  title={t('退出登录', 'Logout')}
                >
                  <LogOut className="w-4 h-4 text-gray-700 dark:text-text-secondary" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
