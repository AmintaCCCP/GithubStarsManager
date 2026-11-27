import React, { useState, useEffect, useCallback } from 'react';
import { logger } from '../services/logger';
import { useDebugActions } from '../features/settings/hooks/useDebugActions';
import { useAppStore } from '../store/useAppStore';
import { Button } from './ui/button';

/**
 * Global debug mode indicator — fixed bottom-right corner.
 * Reads debug state from sessionStorage; visible across all pages.
 * Click to disable all debug modes and navigate to diagnostic logs.
 */
export const DebugModeIndicator: React.FC = () => {
  const [frontendDebug, setFrontendDebug] = useState(() => sessionStorage.getItem('gsm:frontend-debug') === 'true');
  const [backendDebug, setBackendDebug] = useState(() => sessionStorage.getItem('gsm:backend-debug') === 'true');
  const setCurrentView = useAppStore(s => s.setCurrentView);
  const { disableBackendDebug } = useDebugActions();

  // Sync with sessionStorage changes (e.g. from DiagnosticLogsPanel)
  useEffect(() => {
    const check = () => {
      setFrontendDebug(sessionStorage.getItem('gsm:frontend-debug') === 'true');
      setBackendDebug(sessionStorage.getItem('gsm:backend-debug') === 'true');
    };
    // Also listen for storage events from other tabs
    window.addEventListener('storage', check);
    // Poll for changes (sessionStorage doesn't fire storage events in same tab)
    const interval = setInterval(check, 2000);
    return () => {
      window.removeEventListener('storage', check);
      clearInterval(interval);
    };
  }, []);

  const handleClick = useCallback(async () => {
    // Disable frontend debug
    logger.setLevel('info');
    sessionStorage.setItem('gsm:frontend-debug', 'false');
    setFrontendDebug(false);

    // Disable backend debug
    await disableBackendDebug();
    sessionStorage.setItem('gsm:backend-debug', 'false');
    setBackendDebug(false);

    // Navigate to settings → logs tab
    // Store in sessionStorage BEFORE switching view so the new SettingsPanel
    // instance can pick it up after remount (event may fire before listener is ready)
    sessionStorage.setItem('gsm:pending-settings-tab', 'logs');
    setCurrentView('settings');
    // Also dispatch event as a backup for same-instance navigation
    window.dispatchEvent(new CustomEvent('gsm:navigate-to-settings-tab', { detail: { tab: 'logs' } }));
  }, [setCurrentView, disableBackendDebug]);

  if (!frontendDebug && !backendDebug) return null;

  return (
    <Button
      type="button"
      variant="ghost"
      onClick={handleClick}
      className="fixed bottom-4 right-4 z-50 h-control gap-1.5 rounded-md bg-floating px-2.5 text-label-sm font-medium text-foreground shadow-elev-2 hover:bg-fill-hover"
      title="Click to disable debug mode and open logs / 点击关闭调试并打开日志"
    >
      <span className="size-1.5 rounded-full bg-status-green animate-pulse" />
      <span>DEBUG</span>
      {frontendDebug && <span className="text-caption text-tertiary">FE</span>}
      {backendDebug && <span className="text-caption text-tertiary">BE</span>}
    </Button>
  );
};
