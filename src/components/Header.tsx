import React, { useState, useMemo } from 'react';
import { Settings, Calendar, Search, Moon, Sun, LogOut, TrendingUp, GitFork, FileCode2 } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { useDialog } from '../hooks/useDialog';
import { HeaderMenuId, AppState } from '../types';

const MENU_META: Record<HeaderMenuId, {
  icon: React.ComponentType<{ className?: string }>;
  labelZh: string;
  labelEn: string;
}> = {
  repositories: { icon: Search, labelZh: '仓库', labelEn: 'Repositories' },
  gists: { icon: FileCode2, labelZh: 'Gist', labelEn: 'Gist' },
  releases: { icon: Calendar, labelZh: '发布', labelEn: 'Releases' },
  forks: { icon: GitFork, labelZh: '复刻', labelEn: 'Forks' },
  subscription: { icon: TrendingUp, labelZh: '趋势', labelEn: 'Trending' },
  settings: { icon: Settings, labelZh: '设置', labelEn: 'Settings' },
};

export const Header: React.FC = () => {
  const {
    user,
    theme,
    currentView,
    headerMenuConfig,
    setTheme,
    setCurrentView,
    logout,
    language,
  } = useAppStore();

  const { confirm } = useDialog();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const visibleMenus = useMemo(() =>
    [...headerMenuConfig]
      .filter(item => item.visible)
      .sort((a, b) => a.order - b.order),
    [headerMenuConfig]
  );

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

          {/* Navigation - Desktop & Tablet (≥768px) */}
          <nav className="hidden md:flex flex-nowrap items-center space-x-1 hd-btns lg:hd-btns">
            {visibleMenus.map(menuItem => {
              const meta = MENU_META[menuItem.id];
              const Icon = meta.icon;
              const isActive = currentView === menuItem.id;
              return (
                <button
                  key={menuItem.id}
                  onClick={() => setCurrentView(menuItem.id as AppState['currentView'])}
                  title={t(meta.labelZh, meta.labelEn)}
                  aria-label={t(meta.labelZh, meta.labelEn)}
                  className={`flex items-center whitespace-nowrap rounded-lg font-medium transition-colors ${
                    isActive
                      ? 'bg-white dark:bg-white/[0.1] text-gray-900 dark:text-text-primary shadow-sm border border-black/[0.06] dark:border-white/[0.04]'
                      : 'text-gray-700 dark:text-text-secondary hover:bg-light-surface dark:hover:bg-white/5'
                  } xl:px-4 xl:py-2 p-2.5`}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <span className="hidden xl:inline ml-2">{t(meta.labelZh, meta.labelEn)}</span>
                </button>
              );
            })}
          </nav>

          {/* Mobile Dropdown Menu (<768px) */}
          {mobileMenuOpen && (
            <div className="absolute top-[calc(100%+1px)] left-0 right-0 md:hidden bg-light-bg dark:bg-surface-3 border-b border-black/[0.06] dark:border-white/[0.04] shadow-dialog animate-expand-fade z-[100]">
              <nav className="flex flex-col p-2 space-y-1">
                {visibleMenus.map(menuItem => {
                  const meta = MENU_META[menuItem.id];
                  const Icon = meta.icon;
                  const isActive = currentView === menuItem.id;
                  return (
                    <button
                      key={menuItem.id}
                      onClick={() => {
                        setCurrentView(menuItem.id as AppState['currentView']);
                        setMobileMenuOpen(false);
                      }}
                      className={`flex items-center px-4 py-3 rounded-lg font-medium transition-colors ${
                        isActive
                          ? 'bg-white dark:bg-white/[0.1] text-gray-900 dark:text-text-primary shadow-sm border border-black/[0.06] dark:border-white/[0.04]'
                          : 'text-gray-700 dark:text-text-secondary hover:bg-light-surface dark:hover:bg-white/5'
                      }`}
                    >
                      <Icon className="w-5 h-5 mr-3" />
                      {t(meta.labelZh, meta.labelEn)}
                    </button>
                  );
                })}
              </nav>
            </div>
          )}

          {/* User Actions */}
          <div className="flex items-center gap-2 sm:gap-3 hd-btns lg:hd-btns">
            {/* Mobile menu toggle */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 rounded-lg hover:bg-light-surface dark:hover:bg-white/5 transition-colors"
              aria-label={t('菜单', 'Menu')}
            >
              <svg className="w-5 h-5 text-gray-700 dark:text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                {mobileMenuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>

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
