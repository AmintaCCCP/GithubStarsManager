import { useCallback } from 'react';
import { backend } from '../../../services/backendAdapter';

export interface DebugActions {
  disableBackendDebug: () => Promise<void>;
}

export const useDebugActions = (): DebugActions => {
  const disableBackendDebug = useCallback(async () => {
    if (backend.isAvailable) {
      try {
        const secret = sessionStorage.getItem('github-stars-manager-backend-secret');
        await fetch('/api/logs/debug', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
          body: JSON.stringify({ enabled: false }),
        });
      } catch { /* Backend unreachable — same silent behavior as the component */ }
    }
  }, []);
  return { disableBackendDebug };
};
