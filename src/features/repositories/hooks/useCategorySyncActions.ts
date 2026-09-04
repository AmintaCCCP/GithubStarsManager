import { useCallback } from 'react';
import { forceSyncToBackend } from '../../../services/autoSync';

export interface CategorySyncActions {
  forceSyncToBackend: () => Promise<void>;
}

export const useCategorySyncActions = (): CategorySyncActions => {
  const sync = useCallback(() => forceSyncToBackend(), []);
  return { forceSyncToBackend: sync };
};
