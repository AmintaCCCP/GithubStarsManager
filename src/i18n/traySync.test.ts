import { beforeEach, describe, expect, it, vi } from 'vitest';
import { changeAppLanguage } from './index';
import { desktopBridge } from '../services/electronProxy';

describe('changeAppLanguage desktop tray sync (#601)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('notifies desktopBridge.setLanguage when supported in desktop client', async () => {
    vi.spyOn(desktopBridge, 'isSupported').mockReturnValue(true);
    const setLanguageSpy = vi.spyOn(desktopBridge, 'setLanguage').mockResolvedValue({ success: true });

    await changeAppLanguage('ja');

    expect(setLanguageSpy).toHaveBeenCalledWith('ja');
  });

  it('skips desktopBridge when not running in desktop client', async () => {
    vi.spyOn(desktopBridge, 'isSupported').mockReturnValue(false);
    const setLanguageSpy = vi.spyOn(desktopBridge, 'setLanguage').mockResolvedValue({ success: true });

    await changeAppLanguage('zh-TW');

    expect(setLanguageSpy).not.toHaveBeenCalled();
  });

  it('desktopBridge.setLanguage handles non-electron environment safely', async () => {
    // window.electronAPI is undefined in standard test environment
    const result = await desktopBridge.setLanguage('en');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Not running in Electron');
  });

  it('desktopBridge.setLanguage calls window.electronAPI.desktop.setLanguage when present', async () => {
    const mockSetLanguage = vi.fn().mockResolvedValue({ success: true, prefs: { language: 'de' } });
    (window as unknown as { electronAPI: { desktop: { setLanguage: typeof mockSetLanguage } } }).electronAPI = {
      desktop: { setLanguage: mockSetLanguage },
    };

    const result = await desktopBridge.setLanguage('de');
    expect(mockSetLanguage).toHaveBeenCalledWith('de');
    expect(result.success).toBe(true);

    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });
});
