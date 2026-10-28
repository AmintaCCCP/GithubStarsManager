import { useCallback } from 'react';
import { forceSyncToBackend } from '../../../services/autoSync';

export interface CategorySyncActions {
  forceSyncToBackend: (options?: { reportFailures?: boolean }) => Promise<void>;
}

export const useCategorySyncActions = (): CategorySyncActions => {
  const sync = useCallback(
    (options?: { reportFailures?: boolean }) => forceSyncToBackend(options),
    [],
  );
  return { forceSyncToBackend: sync };
};
