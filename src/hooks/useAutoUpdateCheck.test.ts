import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const storeState = {
    autoUpdateCheckEnabled: true,
    updatePromptDismissedVersion: null as string | null,
    setUpdateNotification: vi.fn(),
  };
  return {
    storeState,
    checkForUpdates: vi.fn(),
    useAppStore: {
      getState: () => mocks.storeState,
    },
  };
});

vi.mock('../store/useAppStore', () => ({ useAppStore: mocks.useAppStore }));
vi.mock('../services/updateService', () => ({
  UpdateService: { checkForUpdates: mocks.checkForUpdates },
}));

import { useAutoUpdateCheck } from './useAutoUpdateCheck';

const latestVersion = {
  number: '1.2.0',
  releaseDate: '2026-01-01',
  changelog: ['fix'],
  downloadUrl: 'https://example.com/download',
};

describe('useAutoUpdateCheck', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.storeState.autoUpdateCheckEnabled = true;
    mocks.storeState.updatePromptDismissedVersion = null;
    mocks.storeState.setUpdateNotification.mockClear();
    mocks.checkForUpdates.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const runCheck = async () => {
    renderHook(() => useAutoUpdateCheck());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
  };

  it('sets the update notification when a new version is available', async () => {
    mocks.checkForUpdates.mockResolvedValue({ hasUpdate: true, currentVersion: '1.0.0', latestVersion });

    await runCheck();

    expect(mocks.checkForUpdates).toHaveBeenCalledOnce();
    expect(mocks.storeState.setUpdateNotification).toHaveBeenCalledWith({
      version: '1.2.0',
      releaseDate: '2026-01-01',
      changelog: ['fix'],
      downloadUrl: 'https://example.com/download',
      dismissed: false,
    });
  });

  it('skips the startup check entirely when auto update check is disabled', async () => {
    mocks.storeState.autoUpdateCheckEnabled = false;

    await runCheck();

    expect(mocks.checkForUpdates).not.toHaveBeenCalled();
    expect(mocks.storeState.setUpdateNotification).not.toHaveBeenCalled();
  });

  it('stays silent when the latest version was dismissed with "don\'t remind again"', async () => {
    mocks.storeState.updatePromptDismissedVersion = '1.2.0';
    mocks.checkForUpdates.mockResolvedValue({ hasUpdate: true, currentVersion: '1.0.0', latestVersion });

    await runCheck();

    expect(mocks.checkForUpdates).toHaveBeenCalledOnce();
    expect(mocks.storeState.setUpdateNotification).not.toHaveBeenCalled();
  });

  it('prompts again once a newer version supersedes the dismissed one', async () => {
    mocks.storeState.updatePromptDismissedVersion = '1.1.0';
    mocks.checkForUpdates.mockResolvedValue({ hasUpdate: true, currentVersion: '1.0.0', latestVersion });

    await runCheck();

    expect(mocks.storeState.setUpdateNotification).toHaveBeenCalledWith(
      expect.objectContaining({ version: '1.2.0' }),
    );
  });

  it('does not notify when the app is already up to date', async () => {
    mocks.checkForUpdates.mockResolvedValue({ hasUpdate: false, currentVersion: '1.2.0' });

    await runCheck();

    expect(mocks.storeState.setUpdateNotification).not.toHaveBeenCalled();
  });

  it('reads the preferences at timer-fire time, not at mount time', async () => {
    // 用户在启动后 3 秒延迟内（水合完成/切换开关）关闭了自动检查：
    // 触发时必须以最新偏好为准，而不是挂载时的快照
    renderHook(() => useAutoUpdateCheck());
    mocks.storeState.autoUpdateCheckEnabled = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(mocks.checkForUpdates).not.toHaveBeenCalled();
    expect(mocks.storeState.setUpdateNotification).not.toHaveBeenCalled();
  });

  it('respects a dismissed version recorded after mount but before the check fires', async () => {
    mocks.checkForUpdates.mockResolvedValue({ hasUpdate: true, currentVersion: '1.0.0', latestVersion });
    renderHook(() => useAutoUpdateCheck());
    mocks.storeState.updatePromptDismissedVersion = '1.2.0';
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(mocks.checkForUpdates).toHaveBeenCalledOnce();
    expect(mocks.storeState.setUpdateNotification).not.toHaveBeenCalled();
  });

  it('swallows check failures without notifying', async () => {
    mocks.checkForUpdates.mockRejectedValue(new Error('network down'));

    await runCheck();

    expect(mocks.storeState.setUpdateNotification).not.toHaveBeenCalled();
  });

  it('does not notify when hasUpdate is true without a latest version', async () => {
    mocks.checkForUpdates.mockResolvedValue({ hasUpdate: true, currentVersion: '1.0.0' });

    await runCheck();

    expect(mocks.storeState.setUpdateNotification).not.toHaveBeenCalled();
  });
});
