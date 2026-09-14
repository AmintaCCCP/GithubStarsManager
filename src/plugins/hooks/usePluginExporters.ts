import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { Repository } from '../../types';
import { pluginClient } from '../pluginClient';
import { pluginRegistry } from '../pluginRegistry';

export function usePluginExporters() {
  const snapshot = useSyncExternalStore(
    pluginRegistry.subscribe,
    pluginRegistry.getSnapshot,
    pluginRegistry.getSnapshot
  );

  useEffect(() => {
    if (pluginClient.isSupported()) void pluginRegistry.ensureLoaded();
  }, []);

  const exporters = useMemo(() => snapshot.plugins.flatMap((plugin) => {
    if (!plugin.enabled || plugin.status !== 'active') return [];
    return (plugin.manifest.contributes.exporters || []).map((exporter) => ({
      ...exporter,
      pluginId: plugin.manifest.id,
      pluginName: plugin.manifest.name,
    }));
  }), [snapshot.plugins]);

  return {
    exporters,
    runExporter(exporter: (typeof exporters)[number], repositories: Repository[]) {
      return pluginClient.runExporter({
        pluginId: exporter.pluginId,
        exporterId: exporter.id,
        repositories,
      });
    },
  };
}
