



import { useT } from '../i18n/useT';
import React, { useState, useMemo } from 'react';
import {
  Settings,
  Calendar,
  Search,
  Moon,
  Sun,
  LogOut,
  Compass,
  GitFork,
  FileCode2,
  Menu,
  X,
  Check,
  ChevronDown,
  Trash2,
  UserPlus,
  ArrowLeftRight,
} from 'lucide-react';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { useAppStore } from '../store/useAppStore';
import { resolveTheme } from '../store/selectors';
import { useShallow } from 'zustand/react/shallow';
import { useDialog } from '../hooks/useDialog';
import { useAccountProfiles } from '../hooks/useAccountProfiles';
import type { ProfileEntry } from '../services/profileStorage';
import { AddAccountModal } from './AddAccountModal';
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
  subscription: { icon: Compass, labelZh: '发现', labelEn: 'Discover' },
  settings: { icon: Settings, labelZh: '设置', labelEn: 'Settings' },
};

export const Header: React.FC = () => {
  const {
    user,
    themeMode,
    systemTheme,
    currentView,
    headerMenuConfig,
    setThemeMode,
    setCurrentView,
    logout,

  } = useAppStore(useShallow((state) => ({
    user: state.user,
    themeMode: state.themeMode,
    systemTheme: state.systemTheme,
    currentView: state.currentView,
    headerMenuConfig: state.headerMenuConfig,
    setThemeMode: state.setThemeMode,
    setCurrentView: state.setCurrentView,
    logout: state.logout,
    language: state.language,
  })));
  const theme = resolveTheme(themeMode, systemTheme);

  const { confirm, toast } = useDialog();
  const {
    profiles,
    activeProfileId,
    isSwitching,
    removingProfileIds,
    switchAccount,
    addAccount,
    removeProfile,
  } = useAccountProfiles();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [addAccountOpen, setAddAccountOpen] = useState(false);

  const visibleMenus = useMemo(() =>
    [...headerMenuConfig]
      .filter(item => item.visible)
      .sort((a, b) => a.order - b.order),
    [headerMenuConfig]
  );

  const t = useT('app');

  // A fresh install has no registry entry for the signed-in profile, so fall
  // back to the live user data — otherwise the switch submenu renders empty.
  const menuProfiles = useMemo<ProfileEntry[]>(() => {
    if (profiles.length > 0) return profiles;
    return [
      {
        id: activeProfileId,
        login: user?.login,
        name: user?.name ?? undefined,
        avatarUrl: user?.avatar_url,
      },
    ];
  }, [profiles, activeProfileId, user]);

  const requestRemoveProfile = async (profileId: string, displayName: string) => {
    const confirmed = await confirm(
      t('accountSwitcher.remove-account-confirm-title'),
      t('accountSwitcher.remove-account-confirm-desc', { account: displayName }),
      { type: 'warning' },
    );
    if (!confirmed) return;
    try {
      await removeProfile(profileId);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const requestLogout = async () => {
    const confirmed = await confirm(
      t('header.logout-confirmation'),
      t('header.logout-only-clears-credentials-repositories-ai-a'),
      { type: 'warning' },
    );
    if (confirmed) {
      logout();
    }
  };

  return (
    <header className="linear-header sticky top-0 z-(--app-z-header) hd-drag lg:hd-drag relative">
      <div className="app-header-inner">
        <div className="linear-header-inner flex items-center justify-between">
          {/* Logo and Title */}
          <div className="flex min-w-0 items-center space-x-3">
            <div className="app-brand-mark flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-card">
              <img 
                src="./icon.png" 
                alt="GitHub Stars Manager" 
                className="h-full w-full object-cover"
              />
            </div>
            <div className="min-w-0 hidden sm:block">
              <h1 className="app-brand-title truncate">
                GitHub Stars Manager
              </h1>
              <p className="app-brand-subtitle truncate">
                AI-powered repository management
              </p>
            </div>
            <div className="min-w-0 sm:hidden">
              <h1 className="app-brand-title truncate">
                GitHub Stars
              </h1>
            </div>
          </div>

          {/* Navigation - Desktop & Tablet (≥768px) */}
          <nav className="app-header-nav hidden items-center gap-1 hd-btns md:flex lg:hd-btns">
            {visibleMenus.map(menuItem => {
                        const meta = MENU_META[menuItem.id];
              const Icon = meta.icon;
              const label = t(`header.menu-${menuItem.id}`);
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
                aria-label={t('header.menu')}
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
                    {t(`header.menu-${menuItem.id}`)}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* User Actions */}
          <div className="app-header-actions flex items-center gap-2 sm:gap-3 hd-btns lg:hd-btns">
            {/* Theme Toggle */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setThemeMode(theme === 'light' ? 'dark' : 'light')}
                  aria-label={t('header.toggle-theme')}
                >
                  {theme === 'light' ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('header.toggle-theme')}</TooltipContent>
            </Tooltip>

            {/* User Profile */}
            {user && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="app-header-account-trigger flex items-center gap-2 rounded-full py-0.5 pl-0.5 pr-2 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={t('accountSwitcher.account-menu')}
                  >
                    <img
                      src={user.avatar_url}
                      alt={user.name || user.login}
                      className="h-8 w-8 rounded-full"
                    />
                    <span className="min-w-0 hidden truncate text-left sm:block">
                      <span className="app-header-user-name block truncate">
                        {user.name || user.login}
                      </span>
                    </span>
                    <ChevronDown className="h-4 w-4 shrink-0 opacity-70" />
                  </button>
                </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-60">
                    <DropdownMenuItem onSelect={() => setAddAccountOpen(true)}>
                      <UserPlus className="mr-2 h-4 w-4" />
                      {t('accountSwitcher.add-account')}
                    </DropdownMenuItem>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger disabled={isSwitching}>
                        <ArrowLeftRight className="mr-2 h-4 w-4" />
                        {t('accountSwitcher.switch-account')}
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="w-60">
                        {menuProfiles.map((profile) => {
                          const isCurrent = profile.id === activeProfileId;
                          const displayName = profile.login || profile.name || profile.id;
                          return (
                            <DropdownMenuItem
                              key={profile.id}
                              disabled={isSwitching || removingProfileIds.includes(profile.id)}
                              onSelect={() => {
                                if (!isCurrent) {
                                  void switchAccount(profile.id).catch((err) => {
                                    toast(err instanceof Error ? err.message : String(err), 'error');
                                  });
                                }
                              }}
                              className="flex items-center justify-between gap-2"
                            >
                              <div className="flex min-w-0 items-center gap-2">
                                {profile.avatarUrl ? (
                                  <img
                                    src={profile.avatarUrl}
                                    alt={displayName}
                                    className="h-5 w-5 shrink-0 rounded-full"
                                  />
                                ) : (
                                  <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                                    {displayName.slice(0, 1).toUpperCase()}
                                  </div>
                                )}
                                <span className="truncate text-sm">
                                  {displayName}
                                </span>
                              </div>
                              {isCurrent && (
                                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                                  <Check className="h-3 w-3" />
                                  {t('accountSwitcher.active-badge')}
                                </span>
                              )}
                            </DropdownMenuItem>
                          );
                        })}
                        {menuProfiles.some((p) => p.id !== activeProfileId) && (
                          <>
                            <DropdownMenuSeparator />
                            {menuProfiles
                              .filter((p) => p.id !== activeProfileId)
                              .map((profile) => {
                                const displayName = profile.login || profile.name || profile.id;
                                return (
                                  <DropdownMenuItem
                                    key={`remove-${profile.id}`}
                                    disabled={isSwitching || removingProfileIds.includes(profile.id)}
                                    onSelect={() => {
                                      void requestRemoveProfile(profile.id, displayName);
                                    }}
                                  >
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    <span className="truncate">
                                      {t('accountSwitcher.remove-account')}: {displayName}
                                    </span>
                                  </DropdownMenuItem>
                                );
                              })}
                          </>
                        )}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => { void requestLogout(); }}>
                      <LogOut className="mr-2 h-4 w-4" />
                      {t('header.logout')}
                    </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </div>
      <AddAccountModal
        open={addAccountOpen}
        onOpenChange={setAddAccountOpen}
        onSubmit={addAccount}
      />
    </header>
  );
};
