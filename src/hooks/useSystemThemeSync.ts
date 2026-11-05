import { useEffect } from 'react';
import type { ThemeMode } from '../types';
import { useAppStore } from '../store/useAppStore';

/**
 * 跟随系统模式下订阅操作系统的深浅变化并写入 store；其余模式不订阅。
 */
export function useSystemThemeSync(themeMode: ThemeMode): void {
  useEffect(() => {
    if (themeMode !== 'system' || typeof window.matchMedia !== 'function') return;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const applySystemTheme = () => {
      useAppStore.getState().setSystemTheme(mediaQuery.matches ? 'dark' : 'light');
    };
    applySystemTheme();
    // legacy 目标包含 Safari >= 12，Safari 13.1 之前的 MediaQueryList 只有
    // addListener/removeListener，需按可用性回退，避免进入 ErrorBoundary。
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', applySystemTheme);
      return () => mediaQuery.removeEventListener('change', applySystemTheme);
    }
    mediaQuery.addListener(applySystemTheme);
    return () => mediaQuery.removeListener(applySystemTheme);
  }, [themeMode]);
}
