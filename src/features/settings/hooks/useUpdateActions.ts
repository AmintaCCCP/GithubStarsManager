import { useCallback } from 'react';
import { UpdateService } from '../../../services/updateService';
import type { UpdateCheckResult, VersionInfo } from '../../../services/updateService';

export type { UpdateCheckResult, VersionInfo };

export interface UpdateActions {
  checkForUpdates: () => Promise<UpdateCheckResult>;
  openDownloadUrl: (url: string) => void;
}

export const useUpdateActions = (): UpdateActions => {
  const checkForUpdates = useCallback(() => UpdateService.checkForUpdates(), []);
  const openDownloadUrl = useCallback((url: string) => UpdateService.openDownloadUrl(url), []);
  return { checkForUpdates, openDownloadUrl };
};
