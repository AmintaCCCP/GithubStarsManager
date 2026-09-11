import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Desktop section (#345) lives in Settings-General and must only appear in
 * the Electron client. Web builds (no bridge) hide it entirely.
 */
const mocks = vi.hoisted(() => {
  const state: Record<string, unknown> = {};
  const useAppStore = (selector?: (s: Record<string, unknown>) => unknown) =>
    selector ? selector(state) : state;
  return {
    state,
    useAppStore,
    isSupported: vi.fn(),
    getPrefs: vi.fn(),
  };
});

vi.mock('../../store/useAppStore', () => ({ useAppStore: mocks.useAppStore }));
vi.mock('../../services/electronProxy', () => ({
  DEFAULT_DESKTOP_PREFS: { autoLaunch: false, closeToTray: true, minimizeToTray: true },
  desktopBridge: {
    isSupported: mocks.isSupported,
    getPrefs: mocks.getPrefs,
    setAutoLaunch: vi.fn(),
    setCloseToTray: vi.fn(),
    setMinimizeToTray: vi.fn(),
  },
}));
vi.mock('../UpdateChecker', () => ({ UpdateChecker: () => null }));
vi.mock('./ThemeSettingsCard', () => ({ ThemeSettingsCard: () => null }));

import { GeneralPanel } from './GeneralPanel';

const t = (zh: string) => zh;

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mocks.state, { language: 'zh', setLanguage: vi.fn() });
});

describe('GeneralPanel desktop section', () => {
  it('hides the desktop section on web (no Electron bridge)', () => {
    mocks.isSupported.mockReturnValue(false);
    render(<GeneralPanel t={t} />);
    expect(screen.queryByText('桌面选项')).toBeNull();
    expect(screen.queryByLabelText('开机自动启动')).toBeNull();
  });

  it('shows auto-launch and tray toggles in the Electron client', async () => {
    mocks.isSupported.mockReturnValue(true);
    mocks.getPrefs.mockResolvedValue({ autoLaunch: false, closeToTray: true, minimizeToTray: true });
    render(<GeneralPanel t={t} />);
    expect(await screen.findByText('桌面选项')).toBeTruthy();
    expect(screen.getByLabelText('开机自动启动')).toBeTruthy();
    expect(screen.getByLabelText('关闭时最小化到托盘')).toBeTruthy();
    expect(screen.getByLabelText('最小化时隐藏到托盘')).toBeTruthy();
  });
});
