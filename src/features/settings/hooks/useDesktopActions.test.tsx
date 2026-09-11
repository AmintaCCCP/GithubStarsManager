import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useDesktopActions } from './useDesktopActions';

const mocks = vi.hoisted(() => ({
  isSupported: vi.fn(),
  getPrefs: vi.fn(),
  setAutoLaunch: vi.fn(),
  setCloseToTray: vi.fn(),
  setMinimizeToTray: vi.fn(),
}));

vi.mock('../../../services/electronProxy', () => ({
  DEFAULT_DESKTOP_PREFS: { autoLaunch: false, closeToTray: true, minimizeToTray: true },
  desktopBridge: {
    isSupported: mocks.isSupported,
    getPrefs: mocks.getPrefs,
    setAutoLaunch: mocks.setAutoLaunch,
    setCloseToTray: mocks.setCloseToTray,
    setMinimizeToTray: mocks.setMinimizeToTray,
  },
}));

const t = (zh: string) => zh;

describe('useDesktopActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports unsupported on web and skips IPC', () => {
    mocks.isSupported.mockReturnValue(false);
    const { result } = renderHook(() => useDesktopActions({ t }));
    expect(result.current.supported).toBe(false);
    expect(result.current.loading).toBe(false);
    expect(result.current.prefs).toEqual({ autoLaunch: false, closeToTray: true, minimizeToTray: true });
    expect(mocks.getPrefs).not.toHaveBeenCalled();
  });

  it('loads prefs from the Electron bridge', async () => {
    mocks.isSupported.mockReturnValue(true);
    mocks.getPrefs.mockResolvedValue({ autoLaunch: true, closeToTray: false, minimizeToTray: true });
    const { result } = renderHook(() => useDesktopActions({ t }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.prefs).toEqual({ autoLaunch: true, closeToTray: false, minimizeToTray: true });
  });

  it('commits toggle results on success', async () => {
    mocks.isSupported.mockReturnValue(true);
    mocks.getPrefs.mockResolvedValue({ autoLaunch: false, closeToTray: true, minimizeToTray: true });
    mocks.setAutoLaunch.mockResolvedValue({
      success: true,
      prefs: { autoLaunch: true, closeToTray: true, minimizeToTray: true },
    });
    const { result } = renderHook(() => useDesktopActions({ t }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.toggleAutoLaunch(true);
    });
    expect(mocks.setAutoLaunch).toHaveBeenCalledWith(true);
    expect(result.current.prefs.autoLaunch).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('rolls back to confirmed prefs and surfaces the error on failure', async () => {
    mocks.isSupported.mockReturnValue(true);
    mocks.getPrefs.mockResolvedValue({ autoLaunch: false, closeToTray: true, minimizeToTray: true });
    mocks.setCloseToTray.mockResolvedValue({ success: false, error: 'OS denied' });
    const { result } = renderHook(() => useDesktopActions({ t }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.toggleCloseToTray(false);
    });
    expect(result.current.prefs.closeToTray).toBe(true);
    expect(result.current.error).toBe('OS denied');
  });

  it('drops a second toggle while an IPC write is in flight', async () => {
    mocks.isSupported.mockReturnValue(true);
    mocks.getPrefs.mockResolvedValue({ autoLaunch: false, closeToTray: true, minimizeToTray: true });
    type Prefs = { autoLaunch: boolean; closeToTray: boolean; minimizeToTray: boolean };
    let resolveFirst: ((v: { success: boolean; prefs: Prefs }) => void) | null = null;
    mocks.setAutoLaunch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const { result } = renderHook(() => useDesktopActions({ t }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    // Fire both toggles synchronously in one act: with only a render-snapshot
    // guard both would issue IPC writes; the ref lock must serialize them.
    let first: Promise<void> | undefined;
    let second: Promise<void> | undefined;
    act(() => {
      first = result.current.toggleAutoLaunch(true);
      second = result.current.toggleAutoLaunch(false);
    });
    expect(mocks.setAutoLaunch).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveFirst?.({ success: true, prefs: { autoLaunch: true, closeToTray: true, minimizeToTray: true } });
      await first;
      await second;
    });
    expect(result.current.prefs.autoLaunch).toBe(true);
  });
});
