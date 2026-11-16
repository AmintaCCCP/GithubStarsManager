

import { useT } from '../i18n/useT';
import React, { useMemo, useState } from 'react';
import { Settings, Calendar, Search, Moon, Sun, LogOut, Compass, GitFork, FileCode2, Menu, X, ChevronDown, Check, UserPlus, Trash2 } from 'lucide-react';
import { Button } from './ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { useAppStore } from '../store/useAppStore';
import { resolveTheme } from '../store/selectors';
import { useShallow } from 'zustand/react/shallow';
import { useDialog } from '../hooks/useDialog';
import { HeaderMenuId, AppState, SavedAccount } from '../types';
import { useAccountSwitchActions } from '../features/lifecycle/hooks/useAccountSwitchActions';
import { AddAccountModal } from './AddAccountModal';

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
    savedAccounts,
    accountWorkspaces,
    repositories,
    setThemeMode,
    setCurrentView,
  } = useAppStore(useShallow((state) => ({
    user: state.user,
    themeMode: state.themeMode,
    systemTheme: state.systemTheme,
    currentView: state.currentView,
    headerMenuConfig: state.headerMenuConfig,
    savedAccounts: state.savedAccounts,
    accountWorkspaces: state.accountWorkspaces,
    repositories: state.repositories,
    setThemeMode: state.setThemeMode,
    setCurrentView: state.setCurrentView,
  })));
  const { switchToAccount, removeAccount, logoutCurrentAccount } = useAccountSwitchActions();
  const theme = resolveTheme(themeMode, systemTheme);

  const { confirm, toast } = useDialog();
  const t = useT('app');

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [addAccountOpen, setAddAccountOpen] = useState(false);
  const [reauthAccount, setReauthAccount] = useState<SavedAccount | null>(null);
  const [isSwitchingMenu, setIsSwitchingMenu] = useState(false);

  const visibleMenus = useMemo(() =>
    [...headerMenuConfig]
      .filter(item => item.visible)
      .sort((a, b) => a.order - b.order),
    [headerMenuConfig]
  );

  const currentAccountId = user?.id != null ? String(user.id) : null;
  // 已保存账号列表：lastUsedAt 倒序（当前活跃账号置顶）
  const savedAccountList = useMemo(() => Object.values(savedAccounts ?? {})
    .filter(account => !!account?.user)
    .sort((a, b) => (a.lastUsedAt < b.lastUsedAt ? 1 : a.lastUsedAt > b.lastUsedAt ? -1 : 0)), [savedAccounts]);

  const repoCountFor = (account: SavedAccount): number => (
    account.accountId === currentAccountId
      ? repositories.length
      : accountWorkspaces[account.accountId]?.repositories.length ?? 0
  );

  const handleSwitchAccount = async (account: SavedAccount) => {
    if (isSwitchingMenu) return;
    if (account.accountId === currentAccountId) return;
    setIsSwitchingMenu(true);
    try {
      const result = await switchToAccount(account.accountId);
      if (!result.ok) {
        if (result.needsToken) {
          // Token 缺失（如导入脱敏备份）：弹出补全 Token 弹窗
          setReauthAccount(account);
          setAddAccountOpen(true);
        } else if (result.error) {
          toast(`${t('header.switch-account')}: ${result.error}`, 'error');
        }
        return;
      }
      toast(t('header.account-switched', { login: account.user.login }), 'success');
    } finally {
      setIsSwitchingMenu(false);
    }
  };

  const handleRemoveAccount = async (account: SavedAccount) => {
    const confirmed = await confirm(
      t('header.remove-account-confirm-title'),
      t('header.remove-account-confirm-desc'),
      { type: 'warning' },
    );
    if (!confirmed) return;
    await removeAccount(account.accountId);
  };

  const handleLogout = async () => {
    const confirmed = await confirm(
      t('header.logout-confirmation'),
      t('header.logout-only-clears-credentials-repositories-ai-a'),
      { type: 'warning' },
    );
    if (confirmed) {
      await logoutCurrentAccount();
    }
  };

  const openAddAccount = () => {
    setReauthAccount(null);
    setAddAccountOpen(true);
  };

  return (
    <header className="linear-header sticky top-0 z-(--app-z-header) hd-drag lg:hd-drag relative">
      <div className="app-header-inner">
        <div className="linear-header-inner flex items-center justify-between">
          {/* Logo and Title */}
          <div className="flex min-w-0 items-center space-x-3">
            <div className="app-brand-mark flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-card">
              {/* i18n-allow-literal: 产品名（品牌名不翻译） */}
              <img src="./icon.png" alt="GitHub Stars Manager" className="h-full w-full object-cover" />
            </div>
            <div className="min-w-0 hidden sm:block">
              <h1 className="app-brand-title truncate">
                GitHub Stars Manager {/* i18n-allow-literal: 产品名 */}
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

            {/* Account switcher: avatar + username + chevron dropdown (Issue #611) */}
            {user && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                    aria-label={t('header.switch-account')}
                    disabled={isSwitchingMenu}
                  >
                    <img
                      src={user.avatar_url}
                      alt={user.name || user.login}
                      className="h-7 w-7 rounded-full"
                    />
                    <span className="min-w-0 hidden text-sm font-medium sm:block">
                      <span className="truncate">{user.name || user.login}</span>
                    </span>
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuLabel>{t('header.switch-account')}</DropdownMenuLabel>
                  {savedAccountList.map((account) => {
                    const isCurrent = account.accountId === currentAccountId;
                    const count = repoCountFor(account);
                    return (
                      <div
                        key={account.accountId}
                        className="group/account flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent focus-visible:bg-accent"
                      >
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:opacity-50"
                          disabled={isSwitchingMenu}
                          onClick={() => void handleSwitchAccount(account)}
                        >
                          <img
                            src={account.user.avatar_url}
                            alt={account.user.name || account.user.login}
                            className="h-6 w-6 shrink-0 rounded-full"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{account.user.name || account.user.login}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              @{account.user.login} · {t('header.account-repo-count', { count })}
                            </span>
                          </span>
                        </button>
                        {isCurrent ? (
                          <Check className="h-4 w-4 shrink-0 text-primary" aria-label={t('header.current-account')} />
                        ) : (
                          <button
                            type="button"
                            className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover/account:opacity-100"
                            aria-label={t('header.remove-account')}
                            disabled={isSwitchingMenu}
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleRemoveAccount(account);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={openAddAccount}>
                    <UserPlus className="mr-2 h-4 w-4" />
                    {t('header.add-account')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => void handleLogout()}
                    className="text-destructive focus:text-destructive"
                  >
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
        isOpen={addAccountOpen}
        onClose={() => { setAddAccountOpen(false); setReauthAccount(null); }}
        reauthAccount={reauthAccount}
      />
    </header>
  );
};
