import { useCallback } from 'react';
import { backend } from '../../../services/backendAdapter';
import { getProfileHeader } from '../../../services/profileStorage';
import { readSessionBackendSecret } from '../../../store/persistence/authStorage';

export interface DebugActions {
  disableBackendDebug: () => Promise<void>;
}

export const useDebugActions = (): DebugActions => {
  const disableBackendDebug = useCallback(async () => {
    if (backend.isAvailable) {
      try {
        const secret = readSessionBackendSecret();
        await fetch('/api/logs/debug', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${secret}`,
            ...getProfileHeader(),
          },
          body: JSON.stringify({ enabled: false }),
        });
      } catch { /* Backend unreachable — same silent behavior as the component */ }
    }
  }, []);
  return { disableBackendDebug };
};
