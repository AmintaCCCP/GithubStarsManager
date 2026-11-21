

import { useT } from '../i18n/useT';
import React, { useMemo, useState, useSyncExternalStore } from 'react';
import { Settings, Calendar, Search, Moon, Sun, LogOut, Compass, GitFork, FileCode2, Menu, X, ChevronDown, Check, UserPlus, Trash2, RefreshCw } from 'lucide-react';
import { Button } from './ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { useAppStore } from '../store/useAppStore';
import { resolveTheme } from '../store/selectors';
import { useShallow } from 'zustand/react/shallow';
import { useDialog } from '../hooks/useDialog';
import { HeaderMenuId, AppState, SavedAccount } from '../types';
import {
  getPendingBackendCredentialAlignVersion,
  hasPendingBackendCredentialAlign,
  subscribePendingBackendCredentialAlign,
  useAccountSwitchActions,
} from '../features/lifecycle/hooks/useAccountSwitchActions';
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
    githubToken,
    isAuthenticated,
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
    githubToken: state.githubToken,
    isAuthenticated: state.isAuthenticated,
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
  // 审计修复（B21）：仅存在多个账号时才把「退出登录」菜单化；单账号保留
  // 原独立退出入口。
  const hasMultipleAccounts = savedAccountList.length > 1;

  // 审计修复（R12）：快捷登录唯一的已保存账号时，switchToAccount 先提交本地
  // 会话；后端凭据对齐失败会保留待对齐标记并提示重试——但切换菜单仅在多账号
  // 时渲染，单账号用户无法通过选择当前账号重试。当前账号存在待对齐标记时，
  // 即使只有一个账号也在资料区旁提供重试入口（复用 handleSwitchAccount：其
  // 守卫对带待对齐标记的当前账号放行，重新走后端对齐）。
  // 审计修复（R13 finding 84）：标记是模块级集合而非 React 状态——快捷登录
  // 路径不经过 Header 的 isSwitchingMenu，对齐失败写入标记本身不触发 Header
  // 重渲染。经 features 域的最小外部订阅（版本计数 + useSyncExternalStore）
  // 让标记写入/清除立即触发本组件重算：版本变化即重渲染，重试入口不依赖
  // 拉取副作用或无关重渲染带动。订阅只负责触发重算；成员判断仍走
  // hasPendingBackendCredentialAlign 的既有语义（幂等写入不抬版本）。
  useSyncExternalStore(
    subscribePendingBackendCredentialAlign,
    getPendingBackendCredentialAlignVersion,
  );
  const currentSavedAccountEntry = currentAccountId
    ? savedAccountList.find((account) => account.accountId === currentAccountId) ?? null
    : null;
  const currentAccountNeedsAlignRetry = !!currentAccountId
    && !hasMultipleAccounts
    && hasPendingBackendCredentialAlign(currentAccountId);

  const repoCountFor = (account: SavedAccount): number => (
    account.accountId === currentAccountId
      ? repositories.length
      : accountWorkspaces[account.accountId]?.repositories.length ?? 0
  );

  // 审计修复（R2-B15）：切换失败的已知错误码映射为翻译文案；未知错误（动态
  // 消息）显示原始文本。'switch-account-failed' 暂无对应翻译键，保留原文回退。
  const switchErrorText = (error: string): string => {
    if (error === 'switch-in-progress') return t('header.switch-in-progress');
    // 审计修复：后端凭据对齐失败时本地已切换到目标账号——原样显示错误码
    // 无法告诉用户「本地已切换、后端尚未更新」，复用 AddAccountModal 的
    // 本地化提示。
    if (error === 'backend-credential-sync-failed') {
      return t('accountModal.backend-credential-sync-failed');
    }
    return error;
  };

  const handleSwitchAccount = async (account: SavedAccount) => {
    if (isSwitchingMenu) return;
    // 审计修复（B8）：仅当当前会话已认证且正在使用目标凭证时跳过切换；
    // 当前令牌缺失/破损时必须继续走 switchToAccount——switchAccount 的
    // 同账号分支会从 savedAccounts 恢复有效令牌（复用已保存凭证）。
    if (
      account.accountId === currentAccountId
      && isAuthenticated
      && !!githubToken?.trim()
      && !hasPendingBackendCredentialAlign?.(account.accountId)
    ) return;
    setIsSwitchingMenu(true);
    try {
      const result = await switchToAccount(account.accountId);
      if (!result.ok) {
        if (result.needsToken) {
          // Token 缺失（如导入脱敏备份）：弹出补全 Token 弹窗
          setReauthAccount(account);
          setAddAccountOpen(true);
        } else if (result.error) {
          toast(`${t('header.switch-account')}: ${switchErrorText(result.error)}`, 'error');
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
    // R2-B13：removeAccount 失败（切换锁被占用或备选账号后端凭据对齐失败）时按具体错误码提示。
    const result = await removeAccount(account.accountId);
    if (!result.ok) {
      toast(switchErrorText(result.error ?? 'switch-in-progress'), 'error');
    }
  };

  const handleLogout = async () => {
    // 审计修复（B9）：退出确认绑定打开确认框时的账号标识；确认后把该标识
    // 传给退出流程——期间账号已被切换时不执行退出，提示对当前账号重新发起。
    const targetAccountId = currentAccountId;
    const confirmed = await confirm(
      t('header.logout-confirmation'),
      t('header.logout-only-clears-credentials-repositories-ai-a'),
      { type: 'warning' },
    );
    if (!confirmed) return;
    const loggedOut = await logoutCurrentAccount(targetAccountId ?? undefined);
    if (!loggedOut) {
      // 测试桩可能没有 getState；生产环境恒有。区分「账号已变更」与「切换锁占用」。
      const state = useAppStore.getState?.() as { user?: { id?: number } } | undefined;
      const sessionAccountId = state?.user?.id != null ? String(state.user.id) : null;
      const sessionChanged = sessionAccountId !== targetAccountId;
      toast(sessionChanged ? t('header.logout-account-changed') : t('header.switch-in-progress'), 'error');
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
              {/* 品牌名不翻译 */}
              <img src="./icon.png" alt="GitHub Stars Manager" className="h-full w-full object-cover" /> {/* i18n-allow-literal */}
              
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

            {/* Account switcher: avatar + username + chevron dropdown (Issue #611)。
                审计修复（Issue #611 单账号保留原界面）：仅配置一个账号时不把
                资料区渲染成带箭头的切换入口——保留原头像/用户名展示，并提供
                独立的「添加账号」图标入口；配置多个账号后才显示切换菜单。 */}
            {user && !hasMultipleAccounts && (
              <>
                <div className="flex items-center space-x-2 sm:space-x-3">
                  <img
                    src={user.avatar_url}
                    alt={user.name || user.login}
                    className="w-8 h-8 rounded-full"
                  />
                  <div className="min-w-0 hidden sm:block">
                    <p className="app-header-user-name truncate">
                      {user.name || user.login}
                    </p>
                  </div>
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={openAddAccount}
                      disabled={isSwitchingMenu}
                      aria-label={t('header.add-account')}
                    >
                      <UserPlus className="h-5 w-5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t('header.add-account')}</TooltipContent>
                </Tooltip>
                {/* R12：单账号且当前账号有待对齐标记时提供后端凭据重试入口；
                    正常单账号布局不渲染此按钮。专用文案键
                    header.retry-credential-alignment。 */}
                {currentAccountNeedsAlignRetry && currentSavedAccountEntry && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => void handleSwitchAccount(currentSavedAccountEntry)}
                        disabled={isSwitchingMenu}
                        aria-label={t('header.retry-credential-alignment')}
                      >
                        <RefreshCw className="h-5 w-5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t('header.retry-credential-alignment')}</TooltipContent>
                  </Tooltip>
                )}
              </>
            )}
            {user && hasMultipleAccounts && (
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
                      <div key={account.accountId}>
                        <DropdownMenuItem
                          className="flex min-w-0 items-center gap-2"
                          disabled={isSwitchingMenu}
                          onSelect={() => void handleSwitchAccount(account)}
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
                          {isCurrent && (
                            <Check className="h-4 w-4 shrink-0 text-primary" aria-label={t('header.current-account')} />
                          )}
                        </DropdownMenuItem>
                        {!isCurrent && (
                          <DropdownMenuItem
                            className="pl-10 text-xs text-muted-foreground"
                            disabled={isSwitchingMenu}
                            onSelect={() => void handleRemoveAccount(account)}
                            // 审计修复（B10）：可访问名称包含目标账号 login，
                            // 屏幕阅读器可区分「移除哪一个账号」。
                            aria-label={t('header.remove-account-with-login', { login: account.user.login })}
                          >
                            <Trash2 className="mr-2 h-3.5 w-3.5" />
                            {t('header.remove-account')}
                          </DropdownMenuItem>
                        )}
                      </div>
                    );
                  })}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={openAddAccount}>
                    <UserPlus className="mr-2 h-4 w-4" />
                    {t('header.add-account')}
                  </DropdownMenuItem>
                  {hasMultipleAccounts && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={() => void handleLogout()}
                        className="text-destructive focus:text-destructive"
                      >
                        <LogOut className="mr-2 h-4 w-4" />
                        {t('header.logout')}
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {/* 审计修复（B21）：单账号时保留原独立退出入口（仅多账号才把退出
                登录菜单化）；单账号的「添加账号」经上方独立图标入口提供，
                多账号经下拉菜单提供。 */}
            {user && !hasMultipleAccounts && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => void handleLogout()}
                    disabled={isSwitchingMenu}
                    aria-label={t('header.logout')}
                  >
                    <LogOut className="h-5 w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('header.logout')}</TooltipContent>
              </Tooltip>
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
