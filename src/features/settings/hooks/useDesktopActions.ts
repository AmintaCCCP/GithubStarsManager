import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_DESKTOP_PREFS,
  desktopBridge,
  type DesktopPrefs,
} from '../../../services/electronProxy';

interface UseDesktopActionsOptions {
  t: (zh: string, en: string) => string;
}

export interface DesktopActions {
  supported: boolean;
  prefs: DesktopPrefs;
  loading: boolean;
  saving: boolean;
  error: string | null;
  toggleAutoLaunch: (enabled: boolean) => Promise<void>;
  toggleCloseToTray: (enabled: boolean) => Promise<void>;
  toggleMinimizeToTray: (enabled: boolean) => Promise<void>;
}

/**
 * Owns the desktop-client settings (auto-launch + tray, #345).
 * Web builds report `supported: false` and the caller hides the section.
 * Optimistic toggles roll back to the last confirmed prefs on IPC failure.
 */
export const useDesktopActions = ({ t }: UseDesktopActionsOptions): DesktopActions => {
  const supported = desktopBridge.isSupported();
  const [prefs, setPrefs] = useState<DesktopPrefs>({ ...DEFAULT_DESKTOP_PREFS });
  const [loading, setLoading] = useState(supported);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    setLoading(true);
    desktopBridge
      .getPrefs()
      .then((loaded) => {
        if (!cancelled) setPrefs(loaded);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : t('加载失败', 'Load failed'));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [supported, t]);

  const runToggle = useCallback(
    async (patch: Partial<DesktopPrefs>, apply: (enabled: boolean) => Promise<{ success: boolean; prefs?: DesktopPrefs; error?: string }>, enabled: boolean) => {
      // Serialize IPC writes: a second toggle while one is in flight is dropped,
      // otherwise optimistic states can interleave and the wrong value wins.
      if (saving) return;
      const previous = prefs;
      setPrefs((current) => ({ ...current, ...patch }));
      setError(null);
      setSaving(true);
      try {
        const result = await apply(enabled);
        if (result.success && result.prefs) {
          setPrefs(result.prefs);
        } else {
          setPrefs(previous);
          setError(result.error || t('保存失败', 'Save failed'));
        }
      } catch (reason: unknown) {
        setPrefs(previous);
        setError(reason instanceof Error ? reason.message : t('保存失败', 'Save failed'));
      } finally {
        setSaving(false);
      }
    },
    [prefs, saving, t],
  );

  const toggleAutoLaunch = useCallback(
    (enabled: boolean) => runToggle({ autoLaunch: enabled }, (v) => desktopBridge.setAutoLaunch(v), enabled),
    [runToggle],
  );

  const toggleCloseToTray = useCallback(
    (enabled: boolean) => runToggle({ closeToTray: enabled }, (v) => desktopBridge.setCloseToTray(v), enabled),
    [runToggle],
  );

  const toggleMinimizeToTray = useCallback(
    (enabled: boolean) => runToggle({ minimizeToTray: enabled }, (v) => desktopBridge.setMinimizeToTray(v), enabled),
    [runToggle],
  );

  return { supported, prefs, loading, saving, error, toggleAutoLaunch, toggleCloseToTray, toggleMinimizeToTray };
};
