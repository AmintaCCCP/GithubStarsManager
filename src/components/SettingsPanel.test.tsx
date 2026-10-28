import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { SettingsPanel } from './SettingsPanel';
import { isElectron } from '../services/electronProxy';
import { useAppStore } from '../store/useAppStore';

vi.mock('../services/electronProxy', () => ({
  isElectron: vi.fn(() => false),
}));

const hookState = vi.hoisted(() => ({
  backendAvailable: false,
  unindexedRepoCount: 0,
}));

vi.mock('../features/settings/hooks/useBackendAvailability', () => ({
  useBackendAvailability: () => hookState.backendAvailable,
}));

vi.mock('../features/settings/hooks/useVectorSearchActions', () => ({
  useVectorSearchActions: () => ({ unindexedRepoCount: hookState.unindexedRepoCount }),
}));

vi.mock('../store/useAppStore', () => ({
  useAppStore: vi.fn(),
}));

vi.mock('./settings', () => ({
  AppearancePanel: () => <div data-testid="AppearancePanel-content" />,
  GeneralPanel: () => <div data-testid="GeneralPanel-content" />,
  AIConfigPanel: () => <div data-testid="AIConfigPanel-content" />,
  WebDAVPanel: () => <div data-testid="WebDAVPanel-content" />,
  BackupPanel: () => <div data-testid="BackupPanel-content" />,
  BackendPanel: () => <div data-testid="BackendPanel-content" />,
  CategoryPanel: () => <div data-testid="CategoryPanel-content" />,
  DataManagementPanel: () => <div data-testid="DataManagementPanel-content" />,
  NetworkPanel: () => <div data-testid="NetworkPanel-content" />,
  DiagnosticLogsPanel: () => <div data-testid="DiagnosticLogsPanel-content" />,
  MenuManagementPanel: () => <div data-testid="MenuManagementPanel-content" />,
  StarSyncPanel: () => <div data-testid="StarSyncPanel-content" />,
  VectorSearchSettings: () => <div data-testid="VectorSearchSettings-content" />,
  McpSettingsPanel: () => <div data-testid="McpSettingsPanel-content" />,
  PluginSettingsPanel: () => <div data-testid="PluginSettingsPanel-content" />,
}));

vi.mock('./ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div data-testid="dialog-portal">{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const storeState = {
  language: 'zh' as const,
  setCurrentView: vi.fn(),
};

const mockUseAppStore = vi.mocked(useAppStore);
const mockIsElectron = vi.mocked(isElectron);

const getSidebar = () => document.querySelector<HTMLElement>('[data-context-sidebar="settings"]');

const expectSidebarTabs = (
  present: string[],
  absent: string[] = [],
) => {
  const sidebar = getSidebar();
  expect(sidebar).not.toBeNull();
  for (const id of present) {
    expect(
      within(sidebar as HTMLElement).getByRole('tab', { name: new RegExp(id) })
    ).toBeTruthy();
  }
  for (const id of absent) {
    expect(
      within(sidebar as HTMLElement).queryByRole('tab', { name: new RegExp(id) })
    ).toBeNull();
  }
};

beforeEach(() => {
  vi.clearAllMocks();
  if (typeof Element.prototype.scrollTo !== 'function') {
    Element.prototype.scrollTo = vi.fn();
  }
  hookState.backendAvailable = false;
  hookState.unindexedRepoCount = 0;
  mockIsElectron.mockReturnValue(false);
  sessionStorage.clear();
  mockUseAppStore.mockImplementation(((selector?: (state: typeof storeState) => unknown) => (
    selector ? selector(storeState) : storeState
  )) as typeof useAppStore);
});

afterEach(() => {
  sessionStorage.clear();
});

describe('SettingsPanel context sidebar ownership', () => {
  it('独立页面模式：唯一 settings 上下文侧栏，纯 SPA 不含 network/plugins/mcp，无仓库分类', () => {
    render(<SettingsPanel isOpen />);

    expect(document.querySelectorAll('[data-context-sidebar="settings"]')).toHaveLength(1);

    const sidebar = getSidebar() as HTMLElement;
    const tablist = within(sidebar).getByRole('tablist', { name: '设置标签页' });
    expect(within(tablist).getAllByRole('tab')).toHaveLength(12);
    expectSidebarTabs(['通用', '外观', '分类管理']);
    expectSidebarTabs([], ['网络设置', '插件管理', 'MCP服务']);

    // 仓库分类导航不允许串入设置页
    expect(screen.queryByText('仓库分类')).toBeNull();
    expect(screen.queryByText('添加分类')).toBeNull();
  });

  it('Modal 模式：不渲染 data-context-sidebar，只有设置标签页', () => {
    render(<SettingsPanel isOpen isModal onClose={vi.fn()} />);

    expect(document.querySelectorAll('[data-context-sidebar="settings"]')).toHaveLength(0);
    expect(screen.getAllByRole('tablist', { name: '设置标签页' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('tab', { name: '通用' }).length).toBeGreaterThan(0);
    expect(screen.queryByText('仓库分类')).toBeNull();
  });

  it('切到 category Tab 后分类管理面板正常显示', async () => {
    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    render(<SettingsPanel isOpen />);

    const sidebar = getSidebar() as HTMLElement;
    fireEvent.click(within(sidebar).getByRole('tab', { name: '分类管理' }));

    await waitFor(() => {
      expect(screen.getByTestId('CategoryPanel-content')).toBeTruthy();
    });
    expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    expect(screen.getByRole('tabpanel', { name: '分类管理' })).toBeTruthy();
    scrollToSpy.mockRestore();
  });

  it('Modal 切换 Tab 不改变文档滚动位置', async () => {
    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    render(<SettingsPanel isOpen isModal onClose={vi.fn()} />);

    const desktopTablist = screen.getAllByRole('tablist', { name: '设置标签页' })[0];
    fireEvent.click(within(desktopTablist).getByRole('tab', { name: '分类管理' }));

    await waitFor(() => {
      expect(screen.getByTestId('CategoryPanel-content')).toBeTruthy();
    });
    expect(scrollToSpy).not.toHaveBeenCalled();
    scrollToSpy.mockRestore();
  });
});

describe('SettingsPanel conditional tabs matrix (7.7)', () => {
  it('纯 SPA：network/plugins/mcp 全部隐藏', () => {
    render(<SettingsPanel isOpen />);
    expectSidebarTabs([], ['网络设置', '插件管理', 'MCP服务']);
  });

  it('backend-only：network/mcp 显示，plugins 隐藏', () => {
    hookState.backendAvailable = true;
    render(<SettingsPanel isOpen />);
    expectSidebarTabs(['网络设置', 'MCP服务'], ['插件管理']);
  });

  it('Electron：network/plugins/mcp 全部显示', () => {
    mockIsElectron.mockReturnValue(true);
    render(<SettingsPanel isOpen />);
    expectSidebarTabs(['网络设置', '插件管理', 'MCP服务']);
  });
});

describe('SettingsPanel pending tab and event navigation', () => {
  it('sessionStorage pending tab 在挂载时立即生效', () => {
    sessionStorage.setItem('gsm:pending-settings-tab', 'data');

    render(<SettingsPanel isOpen />);

    expect(screen.getByTestId('DataManagementPanel-content')).toBeTruthy();
    expect(sessionStorage.getItem('gsm:pending-settings-tab')).toBeNull();
  });

  it('gsm:navigate-to-settings-tab 事件继续生效', async () => {
    render(<SettingsPanel isOpen />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent('gsm:navigate-to-settings-tab', {
          detail: { tab: 'vectorSearch' },
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId('VectorSearchSettings-content')).toBeTruthy();
    });
  });
});
