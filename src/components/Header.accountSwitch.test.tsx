import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  removeAccount: vi.fn(),
  logoutCurrentAccount: vi.fn(),
  addAccountWithToken: vi.fn(),
  addAccountFromBackend: vi.fn(),
}));

vi.mock('../hooks/useDialog', () => ({
  useDialog: () => ({ toast: mocks.toast, confirm: mocks.confirm }),
}));

vi.mock('../features/lifecycle/hooks/useAccountSwitchActions', () => ({
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
  mocks.confirm.mockResolvedValue(true);
  mocks.switchToAccount.mockResolvedValue({ ok: true });
  vi.mocked(useAppStore).mockImplementation(((
    selector?: (state: typeof baseState) => unknown,
  ) => (selector ? selector(baseState) : baseState)) as typeof useAppStore);
});

describe('Header account switcher', () => {
  it('renders the dropdown trigger with avatar and username', async () => {
    baseState.savedAccounts = { '1': savedAccount('1', userA, 'ghp_a') };
    const { unmount } = render(<Header />);

    const trigger = screen.getByRole('button', { name: 'header.switch-account' });
    expect(trigger).toBeTruthy();
    // 触发器包含头像与用户名
    expect(screen.getByAltText('Alice')).toBeTruthy();

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
    // 当前账号有勾选标识（aria-label），非当前账号有移除按钮
    expect(screen.getByLabelText('header.current-account')).toBeTruthy();
    expect(screen.getAllByLabelText('header.remove-account')).toHaveLength(1);
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

  it('opens AddAccountModal from the add-account item without logging out', async () => {
    baseState.savedAccounts = { '1': savedAccount('1', userA, 'ghp_a') };
    const { unmount } = render(<Header />);

    await userEvent.click(screen.getByRole('button', { name: 'header.switch-account' }));
    fireEvent.click(screen.getByText('header.add-account'));

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
    fireEvent.click(screen.getByLabelText('header.remove-account'));

    await waitFor(() => {
      expect(mocks.confirm).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(mocks.removeAccount).toHaveBeenCalledWith('2');
    });
    unmount();
  });

  it('logs out through the destructive item after confirmation', async () => {
    baseState.savedAccounts = { '1': savedAccount('1', userA, 'ghp_a') };
    const { unmount } = render(<Header />);

    await userEvent.click(screen.getByRole('button', { name: 'header.switch-account' }));
    fireEvent.click(screen.getByText('header.logout'));

    await waitFor(() => {
      expect(mocks.confirm).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(mocks.logoutCurrentAccount).toHaveBeenCalled();
    });
    unmount();
  });

  it('renders the AddAccountModal action buttons and submits the entered PAT', async () => {
    // 审计修复回归：Modal 只在 scrollable=true 时渲染 footer——不启用则
    // 确认/取消按钮根本不渲染，用户填写凭据后无法提交
    baseState.savedAccounts = { '1': savedAccount('1', userA, 'ghp_a') };
    mocks.addAccountWithToken.mockResolvedValue({ ok: true });
    const { unmount } = render(<Header />);

    await userEvent.click(screen.getByRole('button', { name: 'header.switch-account' }));
    fireEvent.click(screen.getByText('header.add-account'));

    const confirmButton = await screen.findByRole('button', { name: 'app:accountModal.confirm' });
    expect(screen.getByRole('button', { name: 'app:accountModal.cancel' })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('app:accountModal.token-label'), {
      target: { value: 'ghp_new_token' },
    });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(mocks.addAccountWithToken).toHaveBeenCalledWith('ghp_new_token');
    });
    unmount();
  });
});
