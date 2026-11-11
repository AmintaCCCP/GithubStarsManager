import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 更新弹窗交互（feat/update-check-controls）：
 * "不再提示"只记录版本号并清掉横幅通知，不得误触下载/关闭之外的副作用。
 */
const mocks = vi.hoisted(() => {
  const state: Record<string, unknown> = {};
  const useAppStore = (selector?: (s: Record<string, unknown>) => unknown) =>
    selector ? selector(state) : state;
  return {
    state,
    useAppStore,
    checkForUpdates: vi.fn(),
    openDownloadUrl: vi.fn(),
    toast: vi.fn(),
  };
});

vi.mock('../store/useAppStore', () => ({ useAppStore: mocks.useAppStore }));
vi.mock('../features/settings/hooks/useUpdateActions', () => ({
  useUpdateActions: () => ({
    checkForUpdates: mocks.checkForUpdates,
    openDownloadUrl: mocks.openDownloadUrl,
  }),
}));
vi.mock('../hooks/useDialog', () => ({ useDialog: () => ({ toast: mocks.toast }) }));

import { makeT } from '../i18n/useT';
import { UpdateChecker } from './UpdateChecker';

const t = makeT('zh', 'app');

const latestVersion = {
  number: '1.2.0',
  releaseDate: '2026-01-01',
  changelog: ['修复若干问题'],
  downloadUrl: 'https://example.com/download',
};

const openUpdateDialog = async () => {
  const user = userEvent.setup();
  render(<UpdateChecker />);
  await user.click(screen.getByRole('button', { name: t('updateChecker.check-for-updates') }));
  await screen.findByRole('dialog');
  return user;
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mocks.state, {
    language: 'zh',
    setUpdateNotification: vi.fn(),
    setUpdatePromptDismissedVersion: vi.fn(),
  });
  mocks.checkForUpdates.mockResolvedValue({ hasUpdate: true, currentVersion: '1.0.0', latestVersion });
});

describe('UpdateChecker', () => {
  it('shows the update dialog with the latest version after a manual check', async () => {
    await openUpdateDialog();

    expect(within(screen.getByRole('dialog')).getByText('v1.2.0')).toBeTruthy();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('records the dismissed version, clears the banner notification and closes the dialog', async () => {
    const user = await openUpdateDialog();

    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: t('updateChecker.dont-remind-again') }));

    expect(mocks.state.setUpdatePromptDismissedVersion).toHaveBeenCalledWith('1.2.0');
    expect(mocks.state.setUpdateNotification).toHaveBeenCalledWith(null);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes without recording anything when choosing "Later"', async () => {
    const user = await openUpdateDialog();

    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: t('updateChecker.later') }));

    expect(mocks.state.setUpdatePromptDismissedVersion).not.toHaveBeenCalled();
    // 检查到更新时组件会同步横幅通知（既有行为）；"稍后提醒"不得清除它
    expect(mocks.state.setUpdateNotification).not.toHaveBeenCalledWith(null);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('toasts "already latest" when no update is available', async () => {
    mocks.checkForUpdates.mockResolvedValue({ hasUpdate: false, currentVersion: '1.2.0' });
    const user = userEvent.setup();
    render(<UpdateChecker />);
    await user.click(screen.getByRole('button', { name: t('updateChecker.check-for-updates') }));

    expect(mocks.toast).toHaveBeenCalledWith(t('updateChecker.you-are-already-using-the-latest-version'), 'info');
  });
});
