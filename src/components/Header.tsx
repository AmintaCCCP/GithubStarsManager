



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
import { isElectron } from '../services/electronProxy';
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

  const needsStoplightClearance = useMemo(() => {
    if (typeof window === 'undefined' || !isElectron()) return false;
    const isMac = /mac/i.test(navigator.platform || navigator.userAgent);
    const hasInsetTitlebar = document.documentElement.dataset.titlebar === 'hidden-inset'
      || document.documentElement.dataset.titlebar === 'hiddenInset';
    return isMac && hasInsetTitlebar;
  }, []);

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
    <header className="linear-header titlebar-drag-region hd-drag sticky top-0 z-(--app-z-header) !h-[44px] !min-h-[44px] border-b border-subtle bg-navigator">
      <div className="h-full w-full px-3 sm:px-4">
        <div
          className={`flex h-full items-center justify-between gap-3 ${
            needsStoplightClearance ? 'pl-[76px]' : ''
          }`}
        >
          {/* Logo and Title */}
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-paper shadow-elev-0">
              <img
                src="./icon.png"
                alt="GitHub Stars Manager" // i18n-allow-literal
                className="h-full w-full object-cover"
              />
            </div>
            <div className="min-w-0 hidden sm:block">
              <h1 className="truncate text-label font-semibold tracking-[-0.011em] text-foreground">
                GitHub Stars Manager
              </h1>
            </div>
            <div className="min-w-0 sm:hidden">
              <h1 className="truncate text-label font-semibold tracking-[-0.011em] text-foreground">
                GitHub Stars
              </h1>
            </div>
          </div>

          {/* Navigation - Desktop & Tablet (≥768px) */}
          <nav
            aria-label={t('header.menu')}
            className="titlebar-no-drag hd-btns hidden items-center gap-1 md:inline-flex"
          >
            {visibleMenus.map(menuItem => {
              const meta = MENU_META[menuItem.id];
              const Icon = meta.icon;
              const label = t(`header.menu-${menuItem.id}`);
              const isActive = currentView === menuItem.id;
              return (
                <button
                  key={menuItem.id}
                  type="button"
                  onClick={() => setCurrentView(menuItem.id as AppState['currentView'])}
                  aria-pressed={isActive}
                  title={label}
                  aria-label={label}
                  className={`motion-press inline-flex h-7 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-label font-medium select-none outline-none transition-colors duration-micro ease-out-subtle focus-visible:ring-2 focus-visible:ring-ring/50 ${
                    isActive
                      ? 'bg-fill-selected text-foreground'
                      : 'text-secondary hover:bg-fill-hover hover:text-foreground'
                  }`}
                >
                  <Icon className={`size-3.5 shrink-0 ${isActive ? 'text-foreground' : 'text-tertiary'}`} />
                  <span className="hidden xl:inline">{label}</span>
                </button>
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
                className="titlebar-no-drag hd-btns size-control text-secondary hover:bg-fill-hover hover:text-foreground md:hidden"
                aria-label={t('header.menu')}
              >
                {mobileMenuOpen ? <X className="size-4" /> : <Menu className="size-4" />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52 md:hidden">
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
                    className={isActive ? 'bg-fill-selected text-foreground' : undefined}
                  >
                    <Icon className="mr-2 size-4" />
                    {t(`header.menu-${menuItem.id}`)}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* User Actions */}
          <div className="titlebar-no-drag hd-btns flex items-center gap-1">
            {/* Theme Toggle */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setThemeMode(theme === 'light' ? 'dark' : 'light')}
                  aria-label={t('header.toggle-theme')}
                  className="size-control rounded-md text-secondary hover:bg-fill-hover hover:text-foreground"
                >
                  {theme === 'light' ? <Moon className="size-4" /> : <Sun className="size-4" />}
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
                    className="motion-press inline-flex h-control min-w-0 items-center gap-1.5 rounded-md pl-1 pr-1.5 text-label font-medium text-secondary hover:bg-fill-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 data-[state=open]:bg-fill-hover data-[state=open]:text-foreground"
                    aria-label={t('accountSwitcher.account-menu')}
                  >
                    <img
                      src={user.avatar_url}
                      alt={user.name || user.login}
                      className="size-5 shrink-0 rounded-sm shadow-elev-0"
                    />
                    <span className="hidden min-w-0 max-w-[9rem] truncate text-left text-label-sm font-medium text-foreground sm:block">
                      {user.name || user.login}
                    </span>
                    <ChevronDown className="size-3.5 shrink-0 text-tertiary" />
                  </button>
                </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-60">
                    <DropdownMenuItem onSelect={() => setAddAccountOpen(true)}>
                      <UserPlus className="mr-2 size-4" />
                      {t('accountSwitcher.add-account')}
                    </DropdownMenuItem>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger disabled={isSwitching}>
                        <ArrowLeftRight className="mr-2 size-4" />
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
                                    className="size-5 shrink-0 rounded-sm shadow-elev-0"
                                  />
                                ) : (
                                  <div className="flex size-5 shrink-0 items-center justify-center rounded-sm bg-fill-hover text-caption font-medium text-secondary">
                                    {displayName.slice(0, 1).toUpperCase()}
                                  </div>
                                )}
                                <span className="truncate text-label">
                                  {displayName}
                                </span>
                              </div>
                              {isCurrent && (
                                <span className="inline-flex shrink-0 items-center gap-1 rounded-xs bg-accent-tint px-1.5 py-0.5 text-caption font-medium text-accent-text">
                                  <Check className="size-3" />
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
                                    <Trash2 className="mr-2 size-4" />
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
                      <LogOut className="mr-2 size-4" />
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
