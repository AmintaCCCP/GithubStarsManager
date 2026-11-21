import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Header } from './Header';
import { useAppStore } from '../store/useAppStore';
import type { SavedAccount } from '../types';

vi.mock('../store/useAppStore', () => ({
  useAppStore: vi.fn(),
}));

vi.mock('../store/selectors', () => ({
  resolveTheme: () => 'dark' as const,
}));

vi.mock('./ui/tooltip', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ui/tooltip')>();
  // 测试环境无 TooltipProvider 包裹：用透传占位替换，仅保留结构
  const Passthrough = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  return {
    ...actual,
    Tooltip: Passthrough,
    TooltipTrigger: Passthrough,
    TooltipContent: Passthrough,
  };
});

vi.mock('../i18n/useT', () => ({
  useT: () => (key: string, params?: Record<string, unknown>) => {
    if (!params) return key;
    const suffix = Object.values(params).join('|');
    return suffix ? `${key}[${suffix}]` : key;
  },
}));

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  confirm: vi.fn(),
  switchToAccount: vi.fn(),
  removeAccount: vi.fn(async (): Promise<{ ok: boolean; error?: string }> => ({ ok: true })),
  logoutCurrentAccount: vi.fn(async () => true),
  addAccountWithToken: vi.fn(),
  addAccountFromBackend: vi.fn(),
  // R12：Header 在渲染期读取当前账号的待对齐标记（单账号重试入口）——
  // 默认无标记，待对齐用例可改写返回值
  hasPendingBackendCredentialAlign: vi.fn((): boolean => false),
  // R13 finding 84：对齐标记订阅桩——版本计数与监听器由用例直接驱动，
  // 验证「无其他 Store 订阅字段变化时重试入口仍出现」
  pendingAlignListeners: [] as (() => void)[],
  pendingAlignVersion: 0,
}));

vi.mock('../hooks/useDialog', () => ({
  useDialog: () => ({ toast: mocks.toast, confirm: mocks.confirm }),
}));

vi.mock('../features/lifecycle/hooks/useAccountSwitchActions', () => ({
  hasPendingBackendCredentialAlign: mocks.hasPendingBackendCredentialAlign,
  // R13 finding 84 接缝：Header 以 useSyncExternalStore 订阅对齐标记版本——
  // mock 工厂必须提供订阅入口与 getSnapshot，否则模块替换后 Header 挂载即挂
  subscribePendingBackendCredentialAlign: vi.fn((listener: () => void) => {
    mocks.pendingAlignListeners.push(listener);
    return () => {
      const index = mocks.pendingAlignListeners.indexOf(listener);
      if (index >= 0) mocks.pendingAlignListeners.splice(index, 1);
    };
  }),
  getPendingBackendCredentialAlignVersion: vi.fn(() => mocks.pendingAlignVersion),
  useAccountSwitchActions: () => ({
    isSwitching: false,
    switchToAccount: mocks.switchToAccount,
    addAccountWithToken: mocks.addAccountWithToken,
    addAccountFromBackend: mocks.addAccountFromBackend,
    removeAccount: mocks.removeAccount,
    logoutCurrentAccount: mocks.logoutCurrentAccount,
  }),
}));

const userA = { id: 1, login: 'alice', name: 'Alice', avatar_url: 'https://x/a.png', email: null };
const userB = { id: 2, login: 'bob', name: 'Bob', avatar_url: 'https://x/b.png', email: null };

const savedAccount = (id: string, user: typeof userA, token: string): SavedAccount => ({
  accountId: id,
  user,
  githubToken: token,
  addedAt: '2026-01-01T00:00:00.000Z',
  lastUsedAt: '2026-01-01T00:00:00.000Z',
});

const baseState = {
  user: userA as typeof userA | null,
  isAuthenticated: false as boolean,
  githubToken: null as string | null,
  themeMode: 'dark' as const,
  systemTheme: 'dark' as const,
  currentView: 'repositories' as const,
  headerMenuConfig: [
    { id: 'repositories' as const, visible: true, order: 0 },
    { id: 'settings' as const, visible: true, order: 1 },
  ],
  savedAccounts: {} as Record<string, SavedAccount>,
  accountWorkspaces: {} as Record<string, { repositories: unknown[] }>,
  repositories: [] as unknown[],
  setThemeMode: vi.fn(),
  setCurrentView: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  baseState.user = userA;
  baseState.isAuthenticated = false;
  baseState.githubToken = null;
  mocks.confirm.mockResolvedValue(true);
  mocks.switchToAccount.mockResolvedValue({ ok: true });
  mocks.logoutCurrentAccount.mockResolvedValue(true);
  mocks.hasPendingBackendCredentialAlign.mockReturnValue(false);
  mocks.pendingAlignListeners.length = 0;
  mocks.pendingAlignVersion = 0;
  vi.mocked(useAppStore).mockImplementation(((
    selector?: (state: typeof baseState) => unknown,
  ) => (selector ? selector(baseState) : baseState)) as typeof useAppStore);
  (useAppStore as unknown as { getState: () => typeof baseState }).getState = () => baseState;
});

describe('Header account switcher', () => {
  it('keeps the plain profile area and a standalone add-account entry for a single account (Issue #611)', async () => {
    baseState.savedAccounts = { '1': savedAccount('1', userA, 'ghp_a') };
    const { unmount } = render(<Header />);

    // 单账号：资料区不是切换入口——没有带箭头的 trigger 按钮
    expect(screen.queryByRole('button', { name: 'header.switch-account' })).not.toBeInTheDocument();
    // 原头像与用户名展示保留
    expect(screen.getByAltText('Alice')).toBeTruthy();
    expect(screen.getByText('Alice')).toBeTruthy();
    // 独立的「添加账号」图标入口
    expect(screen.getByRole('button', { name: 'header.add-account' })).toBeTruthy();
    unmount();
  });

  // R12：单账号快捷登录后端凭据对齐失败时，hook 保留待对齐标记——切换菜单
  // 不渲染（单账号），用户必须有重试入口。当前账号带待对齐标记时提供重试
  // 按钮，复用 handleSwitchAccount 重新走后端对齐（文案键
  // header.retry-credential-alignment 已在 10 个 locale 落地）。
  it('shows a credential-alignment retry entry for a single account with a pending align marker (R12)', async () => {
    baseState.savedAccounts = { '1': savedAccount('1', userA, 'ghp_a') };
    // 审计修复（R13 finding 79）：用例必须进入已认证账号的早退分支——设置
    // isAuthenticated 与非空顶层 githubToken 后，handleSwitchAccount 的同账号
    // 早退守卫只剩待对齐标记例外：只有标记确实允许当前账号重试时点击才会
    // 调用 switchToAccount。
    baseState.isAuthenticated = true;
    baseState.githubToken = 'ghp_a';
    mocks.hasPendingBackendCredentialAlign.mockReturnValue(true);
    const { unmount } = render(<Header />);

    const retryButton = screen.getByRole('button', { name: 'header.retry-credential-alignment' });
    fireEvent.click(retryButton);
    await waitFor(() => {
      expect(mocks.switchToAccount).toHaveBeenCalledWith('1');
    });
    unmount();
  });

  it('hides the credential-alignment retry entry for a single account without a pending align marker (R12)', () => {
    baseState.savedAccounts = { '1': savedAccount('1', userA, 'ghp_a') };
    const { unmount } = render(<Header />);

    expect(screen.queryByRole('button', { name: 'header.retry-credential-alignment' })).not.toBeInTheDocument();
    unmount();
  });

  // R13 finding 84：快捷登录的对齐失败不经过 Header 的 isSwitchingMenu，也不
  // 改变任何 Store 订阅字段——重试入口必须由对齐标记的版本订阅触发重算后出现，
  // 不得依赖拉取结果的副作用或无关重渲染带动。
  it('shows the credential-alignment retry entry after alignment fails without any store-subscribed field change (R13 finding 84)', async () => {
    baseState.savedAccounts = { '1': savedAccount('1', userA, 'ghp_a') };
    baseState.isAuthenticated = true;
    baseState.githubToken = 'ghp_a';
    const { unmount } = render(<Header />);

    // 对齐尚未失败：单账号不显示重试入口（当前账号无待对齐标记）
    expect(screen.queryByRole('button', { name: 'header.retry-credential-alignment' })).not.toBeInTheDocument();

    // 模拟对齐失败：标记写入抬升版本并通知订阅者；Store 订阅字段（baseState）
    // 零变化，也没有任何 rerender 触发
    act(() => {
      mocks.hasPendingBackendCredentialAlign.mockReturnValue(true);
      mocks.pendingAlignVersion += 1;
      for (const listener of [...mocks.pendingAlignListeners]) listener();
    });

    expect(screen.getByRole('button', { name: 'header.retry-credential-alignment' })).toBeTruthy();
    // 重试入口仍复用 handleSwitchAccount 重新走后端对齐
    fireEvent.click(screen.getByRole('button', { name: 'header.retry-credential-alignment' }));
    await waitFor(() => {
      expect(mocks.switchToAccount).toHaveBeenCalledWith('1');
    });
    unmount();
  });

  it('renders the dropdown trigger with avatar and username when multiple accounts exist', async () => {
    baseState.savedAccounts = {
      '1': savedAccount('1', userA, 'ghp_a'),
      '2': savedAccount('2', userB, 'ghp_b'),
    };
    const { unmount } = render(<Header />);

    const trigger = screen.getByRole('button', { name: 'header.switch-account' });
    expect(trigger).toBeTruthy();
    // 审计修复（R15 finding 25）：头像与用户名必须位于切换按钮内部——用
    // within(trigger) 限定断言范围（页面级 getAllByAltText 拦不住元素被移出
    // 按钮的回归，且未覆盖按钮内用户名）
    expect(within(trigger).getByAltText('Alice')).toBeTruthy();
    expect(within(trigger).getByText('Alice')).toBeTruthy();

    await userEvent.click(trigger);
    expect(screen.getByText('header.switch-account')).toBeTruthy();
    unmount();
  });

  it('lists saved accounts with repo count and the current check mark', async () => {
    baseState.savedAccounts = {
      '1': savedAccount('1', userA, 'ghp_a'),
      '2': savedAccount('2', userB, 'ghp_b'),
    };
    baseState.accountWorkspaces = { '2': { repositories: [1, 2, 3] } };
    const { unmount } = render(<Header />);

    await userEvent.click(screen.getByRole('button', { name: 'header.switch-account' }));
    // 当前账号的缓存仓库数来自顶层 repositories
    expect(screen.getByText(/@alice . header\.account-repo-count\[0\]/)).toBeTruthy();
    // 其他账号的仓库数来自其工作区缓存
    expect(screen.getByText(/@bob . header\.account-repo-count\[3\]/)).toBeTruthy();
    // 当前账号有勾选标识（aria-label），非当前账号有可键盘访问的移除菜单项
    expect(screen.getByLabelText('header.current-account')).toBeTruthy();
    expect(screen.getAllByText('header.remove-account')).toHaveLength(1);
    unmount();
  });

  it('switches account on click and toasts the result', async () => {
    baseState.savedAccounts = {
      '1': savedAccount('1', userA, 'ghp_a'),
      '2': savedAccount('2', userB, 'ghp_b'),
    };
    const { unmount } = render(<Header />);

    await userEvent.click(screen.getByRole('button', { name: 'header.switch-account' }));
    const bobRow = await screen.findByText(/@bob . header\.account-repo-count/);
    fireEvent.click(bobRow);

    await waitFor(() => {
      expect(mocks.switchToAccount).toHaveBeenCalledWith('2');
    });
    await waitFor(() => {
      expect(mocks.toast).toHaveBeenCalledWith('header.account-switched[bob]', 'success');
    });
    unmount();
  });

  it('opens AddAccountModal from the standalone add-account entry without logging out (single account)', async () => {
    baseState.savedAccounts = { '1': savedAccount('1', userA, 'ghp_a') };
    const { unmount } = render(<Header />);

    fireEvent.click(screen.getByRole('button', { name: 'header.add-account' }));

    // 弹窗标题出现，且未触发登出
    expect(screen.getByText(/accountModal\.title/)).toBeTruthy();
    expect(mocks.logoutCurrentAccount).not.toHaveBeenCalled();
    unmount();
  });

  it('opens AddAccountModal prefilled with the account when its token is missing', async () => {
    baseState.savedAccounts = {
      '1': savedAccount('1', userA, 'ghp_a'),
      '2': savedAccount('2', userB, ''),
    };
    mocks.switchToAccount.mockResolvedValue({ ok: false, needsToken: true });
    const { unmount } = render(<Header />);

    await userEvent.click(screen.getByRole('button', { name: 'header.switch-account' }));
    const bobRow = await screen.findByText(/@bob . header\.account-repo-count/);
    fireEvent.click(bobRow);

    await waitFor(() => {
      expect(mocks.switchToAccount).toHaveBeenCalledWith('2');
    });
    // 补全 Token 弹窗出现，并预填 bob 的 reauth 提示
    await waitFor(() => {
      expect(screen.getByText(/accountModal\.title/)).toBeTruthy();
    });
    expect(screen.getByText(/accountModal\.reauth-hint\[bob\]/)).toBeTruthy();
    unmount();
  });

  it('removes a non-active account after confirmation', async () => {
    baseState.savedAccounts = {
      '1': savedAccount('1', userA, 'ghp_a'),
      '2': savedAccount('2', userB, 'ghp_b'),
    };
    const { unmount } = render(<Header />);

    await userEvent.click(screen.getByRole('button', { name: 'header.switch-account' }));
    fireEvent.click(screen.getByText('header.remove-account'));

    await waitFor(() => {
      expect(mocks.confirm).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(mocks.removeAccount).toHaveBeenCalledWith('2');
    });
    unmount();
  });

  it('shows a wait-and-retry toast when removeAccount is rejected by the switch lock (R2-B13)', async () => {
    baseState.savedAccounts = {
      '1': savedAccount('1', userA, 'ghp_a'),
      '2': savedAccount('2', userB, 'ghp_b'),
    };
    mocks.removeAccount.mockResolvedValueOnce({ ok: false, error: 'switch-in-progress' });
    const { unmount } = render(<Header />);

    await userEvent.click(screen.getByRole('button', { name: 'header.switch-account' }));
    fireEvent.click(screen.getByText('header.remove-account'));

    await waitFor(() => {
      expect(mocks.toast).toHaveBeenCalledWith('header.switch-in-progress', 'error');
    });
    unmount();
  });

  it('localizes backend-credential-sync-failed switch failures via the accountModal translation', async () => {
    baseState.savedAccounts = {
      '1': savedAccount('1', userA, 'ghp_a'),
      '2': savedAccount('2', userB, 'ghp_b'),
    };
    mocks.switchToAccount.mockResolvedValueOnce({ ok: false, error: 'backend-credential-sync-failed' });
    const { unmount } = render(<Header />);

    await userEvent.click(screen.getByRole('button', { name: 'header.switch-account' }));
    fireEvent.click(await screen.findByText(/@bob . header\.account-repo-count/));

    // 审计修复：错误码不再原样显示——复用 AddAccountModal 的本地化提示
    await waitFor(() => {
      expect(mocks.toast).toHaveBeenCalledWith(
        'header.switch-account: accountModal.backend-credential-sync-failed',
        'error',
      );
    });
    unmount();
  });

  it('logs out via the standalone icon button when only one account exists (B21)', async () => {
    baseState.savedAccounts = { '1': savedAccount('1', userA, 'ghp_a') };
    const { unmount } = render(<Header />);

    // 单账号：退出登录保留原独立图标入口，资料区不是下拉触发器
    expect(screen.getByRole('button', { name: 'header.logout' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'header.switch-account' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'header.logout' }));

    await waitFor(() => {
      expect(mocks.confirm).toHaveBeenCalled();
    });
    // 审计修复（B9）：退出确认绑定打开确认框时的账号标识
    await waitFor(() => {
      expect(mocks.logoutCurrentAccount).toHaveBeenCalledWith('1');
    });
    expect(mocks.toast).not.toHaveBeenCalled();
    unmount();
  });

  it('passes original account id and shows logout-account-changed when account switches during logout confirm', async () => {
    baseState.savedAccounts = { '1': savedAccount('1', userA, 'ghp_a') };
    let resolveConfirm!: (value: boolean) => void;
    mocks.confirm.mockImplementationOnce(
      () => new Promise<boolean>((resolve) => {
        resolveConfirm = resolve;
      }),
    );
    mocks.logoutCurrentAccount.mockResolvedValueOnce(false);
    const { rerender, unmount } = render(<Header />);

    await userEvent.click(screen.getByRole('button', { name: 'header.logout' }));
    await waitFor(() => {
      expect(mocks.confirm).toHaveBeenCalledTimes(1);
    });

    // 确认框待决期间当前账号从 1 切换为 2
    baseState.user = userB;
    baseState.savedAccounts = {
      '1': savedAccount('1', userA, 'ghp_a'),
      '2': savedAccount('2', userB, 'ghp_b'),
    };
    rerender(<Header />);

    resolveConfirm(true);

    await waitFor(() => {
      expect(mocks.logoutCurrentAccount).toHaveBeenCalledWith('1');
    });
    await waitFor(() => {
      expect(mocks.toast).toHaveBeenCalledWith('header.logout-account-changed', 'error');
    });
    unmount();
  });

  it('logs out through the destructive menu item when multiple accounts exist', async () => {
    baseState.savedAccounts = {
      '1': savedAccount('1', userA, 'ghp_a'),
      '2': savedAccount('2', userB, 'ghp_b'),
    };
    const { unmount } = render(<Header />);

    await userEvent.click(screen.getByRole('button', { name: 'header.switch-account' }));
    fireEvent.click(screen.getByText('header.logout'));

    await waitFor(() => {
      expect(mocks.confirm).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(mocks.logoutCurrentAccount).toHaveBeenCalledWith('1');
    });
    expect(mocks.toast).not.toHaveBeenCalled();
    unmount();
  });

  it('renders the AddAccountModal action buttons and submits the entered PAT', async () => {
    // 审计修复回归：Modal 只在 scrollable=true 时渲染 footer——不启用则
    // 确认/取消按钮根本不渲染，用户填写凭据后无法提交
    baseState.savedAccounts = { '1': savedAccount('1', userA, 'ghp_a') };
    mocks.addAccountWithToken.mockResolvedValue({ ok: true });
    const { unmount } = render(<Header />);

    fireEvent.click(screen.getByRole('button', { name: 'header.add-account' }));

    const confirmButton = await screen.findByRole('button', { name: 'app:accountModal.confirm' });
    expect(screen.getByRole('button', { name: 'app:accountModal.cancel' })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('app:accountModal.token-label'), {
      target: { value: 'ghp_new_token' },
    });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(mocks.addAccountWithToken).toHaveBeenCalledWith('ghp_new_token', undefined);
    });
    unmount();
  });
});
