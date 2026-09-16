import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { Release, Repository } from '../../types';
import { pluginClient } from '../pluginClient';
import { pluginRegistry } from '../pluginRegistry';
import type { RegisteredReleaseProcessor } from '../types';

export function useReleaseProcessors() {
  const snapshot = useSyncExternalStore(
    pluginRegistry.subscribe,
    pluginRegistry.getSnapshot,
    pluginRegistry.getSnapshot
  );

  useEffect(() => {
    if (pluginClient.isSupported()) void pluginRegistry.ensureLoaded();
  }, []);

  const processors = useMemo<RegisteredReleaseProcessor[]>(() => snapshot.plugins.flatMap((plugin) => {
    if (!plugin.enabled || plugin.status !== 'active') return [];
    return (plugin.manifest.contributes.releaseProcessors || []).map((processor) => ({
      ...processor,
      pluginId: plugin.manifest.id,
      pluginName: plugin.manifest.name,
      canDownload: plugin.manifest.permissions.includes('downloads:create'),
    }));
  }), [snapshot.plugins]);

  return {
    processors,
    runProcessor(processor: RegisteredReleaseProcessor, release: Release, repository?: Repository) {
      return pluginClient.runReleaseProcessor({
        pluginId: processor.pluginId,
        processorId: processor.id,
        release,
        ...(repository ? { repository } : {}),
      });
    },
    download(processor: RegisteredReleaseProcessor, releaseId: number, assetId: number) {
      return pluginClient.downloadReleaseAsset({ pluginId: processor.pluginId, releaseId, assetId });
    },
  };
}
