import React, { useState, useEffect, useCallback } from 'react';
import { logger } from '../services/logger';
import { backend } from '../services/backendAdapter';
import { useAppStore } from '../store/useAppStore';

/**
 * Global debug mode indicator — fixed bottom-right corner.
 * Reads debug state from sessionStorage; visible across all pages.
 * Click to disable all debug modes and navigate to diagnostic logs.
 */
export const DebugModeIndicator: React.FC = () => {
  const [frontendDebug, setFrontendDebug] = useState(() => sessionStorage.getItem('gsm:frontend-debug') === 'true');
  const [backendDebug, setBackendDebug] = useState(() => sessionStorage.getItem('gsm:backend-debug') === 'true');
  const setCurrentView = useAppStore(s => s.setCurrentView);

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
    if (backend.isAvailable) {
      try {
        const secret = sessionStorage.getItem('github-stars-manager-backend-secret');
        await fetch('/api/logs/debug', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
          body: JSON.stringify({ enabled: false }),
        });
      } catch { /* Backend unreachable */ }
    }
    sessionStorage.setItem('gsm:backend-debug', 'false');
    setBackendDebug(false);

    // Navigate to settings → logs tab
    setCurrentView('settings');
    // Notify SettingsPanel to switch to logs tab
    window.dispatchEvent(new CustomEvent('gsm:navigate-to-settings-tab', { detail: { tab: 'logs' } }));
  }, [setCurrentView]);

  if (!frontendDebug && !backendDebug) return null;

  return (
    <button
      onClick={handleClick}
      className="fixed bottom-6 right-6 z-50 flex items-center space-x-2 px-3 py-2 bg-green-500 text-white rounded-full shadow-lg hover:bg-green-600 transition-colors text-sm font-medium cursor-pointer"
      title="Click to disable debug mode and open logs / 点击关闭调试并打开日志"
    >
      <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
      <span>DEBUG</span>
      {frontendDebug && <span className="text-xs opacity-80">FE</span>}
      {backendDebug && <span className="text-xs opacity-80">BE</span>}
    </button>
  );
};
