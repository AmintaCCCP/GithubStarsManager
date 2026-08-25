import { useCallback, useEffect, useState } from 'react';
import type { LogEntry, LogLevel } from '../../../services/logger';
import { backend } from '../../../services/backendAdapter';

interface UseDiagnosticBackendActionsOptions {
  selectedScope: 'all' | 'frontend' | 'backend';
}

interface BackendLogsResponse {
  logs: LogEntry[];
  total: number;
}

const getHeaders = (): HeadersInit => ({
  Authorization: `Bearer ${sessionStorage.getItem('github-stars-manager-backend-secret')}`,
});

/** Encapsulates optional backend diagnostics so the panel remains usable offline. */
export const useDiagnosticBackendActions = ({ selectedScope }: UseDiagnosticBackendActionsOptions) => {
  const [backendDebug, setBackendDebug] = useState(false);
  const [backendEntries, setBackendEntries] = useState<LogEntry[]>([]);
  const [backendLogCount, setBackendLogCount] = useState(0);
  const backendAvailable = backend.isAvailable;

  const fetchLogs = useCallback(async (level?: LogLevel): Promise<BackendLogsResponse | null> => {
    if (!backendAvailable) return null;
    try {
      const query = level ? `?limit=2000&level=${level}` : '?limit=2000';
      const response = await fetch(`/api/logs${query}`, { headers: getHeaders() });
      if (!response.ok) return null;
      const raw = await response.json();
      const logs = Array.isArray(raw) ? raw as LogEntry[] : [];
      const header = response.headers.get('X-Log-Count');
      return { logs, total: header ? parseInt(header, 10) || 0 : logs.length };
    } catch {
      return null;
    }
  }, [backendAvailable]);

  useEffect(() => {
    if (!backendAvailable) return;
    const fetchDebugState = async () => {
      try {
        const response = await fetch('/api/logs/debug', { headers: getHeaders() });
        if (!response.ok) return;
        const data = await response.json() as { debugMode?: boolean };
        setBackendDebug(Boolean(data.debugMode));
        sessionStorage.setItem('gsm:backend-debug', String(Boolean(data.debugMode)));
      } catch {
        // Diagnostics cannot make settings unavailable when the backend drops.
      }
    };
    void fetchDebugState();
  }, [backendAvailable]);

  const refresh = useCallback(async () => {
    const result = await fetchLogs();
    if (backendAvailable && result) {
      setBackendEntries(result.logs);
      setBackendLogCount(result.total);
    }
    return result?.logs ?? [];
  }, [backendAvailable, fetchLogs]);

  useEffect(() => {
    if (selectedScope === 'frontend') {
      setBackendEntries([]);
      setBackendLogCount(0);
      return;
    }
    if (!backendAvailable) return;
    void refresh();
    const interval = setInterval(() => { void refresh(); }, 10_000);
    return () => clearInterval(interval);
  }, [backendAvailable, refresh, selectedScope]);

  const toggleDebug = useCallback(async () => {
    const next = !backendDebug;
    try {
      const response = await fetch('/api/logs/debug', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getHeaders() },
        body: JSON.stringify({ enabled: next }),
      });
      if (!response.ok) return;
      const data = await response.json() as { debugMode?: boolean };
      setBackendDebug(Boolean(data.debugMode));
      sessionStorage.setItem('gsm:backend-debug', String(Boolean(data.debugMode)));
    } catch {
      // Best effort; frontend log controls remain available.
    }
  }, [backendDebug]);

  const clear = useCallback(async () => {
    if (!backendAvailable) return;
    try {
      await fetch('/api/logs', { method: 'DELETE', headers: getHeaders() });
      setBackendEntries([]);
      setBackendLogCount(0);
    } catch {
      // Best effort.
    }
  }, [backendAvailable]);

  return {
    backendAvailable,
    backendUrl: backend.backendUrl || '',
    backendDebug,
    backendEntries,
    backendLogCount,
    refresh,
    toggleDebug,
    clear,
    fetchLogs,
  };
};
