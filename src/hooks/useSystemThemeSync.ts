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
    mediaQuery.addEventListener('change', applySystemTheme);
    return () => mediaQuery.removeEventListener('change', applySystemTheme);
  }, [themeMode]);
}
