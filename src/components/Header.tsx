import React, { useState, useMemo } from 'react';
import { Settings, Calendar, Search, Moon, Sun, LogOut, TrendingUp, GitFork, FileCode2, Menu, X } from 'lucide-react';
import { Button } from './ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
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
    <header className="linear-header sticky top-0 z-50 hd-drag lg:hd-drag relative">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="linear-header-inner flex h-14 items-center justify-between">
          {/* Logo and Title */}
          <div className="flex min-w-0 items-center space-x-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-card">
              <img 
                src="./icon.png" 
                alt="GitHub Stars Manager" 
                className="h-full w-full object-cover"
              />
            </div>
            <div className="min-w-0 hidden sm:block">
              <h1 className="truncate text-sm font-semibold tracking-tight text-foreground">
                GitHub Stars Manager
              </h1>
              <p className="truncate text-xs text-muted-foreground">
                AI-powered repository management
              </p>
            </div>
            <div className="min-w-0 sm:hidden">
              <h1 className="truncate text-sm font-semibold tracking-tight text-foreground">
                GitHub Stars
              </h1>
            </div>
          </div>

          {/* Navigation - Desktop & Tablet (≥768px) */}
          <nav className="hidden items-center gap-1 hd-btns md:flex lg:hd-btns">
            {visibleMenus.map(menuItem => {
              const meta = MENU_META[menuItem.id];
              const Icon = meta.icon;
              const label = t(meta.labelZh, meta.labelEn);
              const isActive = currentView === menuItem.id;
              return (
                <Button
                  key={menuItem.id}
                  type="button"
                  variant={isActive ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setCurrentView(menuItem.id as AppState['currentView'])}
                  aria-pressed={isActive}
                  title={label}
                  aria-label={label}
                  className="whitespace-nowrap xl:px-3"
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="hidden xl:inline">{label}</span>
                </Button>
              );
            })}
          </nav>

          {/* Mobile Dropdown Menu (<768px) */}
          <DropdownMenu open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="md:hidden"
                aria-label={t('菜单', 'Menu')}
              >
                {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 md:hidden">
              {visibleMenus.map(menuItem => {
                const meta = MENU_META[menuItem.id];
                const Icon = meta.icon;
                const isActive = currentView === menuItem.id;
                return (
                  <DropdownMenuItem
                    key={menuItem.id}
                    onSelect={() => {
                      setCurrentView(menuItem.id as AppState['currentView']);
                      setMobileMenuOpen(false);
                    }}
                    aria-current={isActive ? 'page' : undefined}
                    className={isActive ? 'bg-muted dark:bg-accent' : undefined}
                  >
                    <Icon className="mr-3 h-4 w-4" />
                    {t(meta.labelZh, meta.labelEn)}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* User Actions */}
          <div className="flex items-center gap-2 sm:gap-3 hd-btns lg:hd-btns">
            {/* Theme Toggle */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
                  aria-label={t('切换主题', 'Toggle theme')}
                >
                  {theme === 'light' ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('切换主题', 'Toggle theme')}</TooltipContent>
            </Tooltip>

            {/* User Profile */}
            {user && (
              <div className="flex items-center space-x-2 sm:space-x-3">
                <img
                  src={user.avatar_url}
                  alt={user.name || user.login}
                  className="w-8 h-8 rounded-full"
                />
                <div className="min-w-0 hidden sm:block">
                  <p className="truncate text-sm font-medium text-foreground">
                    {user.name || user.login}
                  </p>
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
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
                      aria-label={t('退出登录', 'Logout')}
                    >
                      <LogOut className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t('退出登录', 'Logout')}</TooltipContent>
                </Tooltip>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
