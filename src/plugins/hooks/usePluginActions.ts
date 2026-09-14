import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { Repository } from '../../types';
import { pluginClient } from '../pluginClient';
import { pluginRegistry } from '../pluginRegistry';
import type { PluginPlacement, RegisteredPluginAction, RunPluginActionResult } from '../types';

export function usePluginActions(placement: PluginPlacement) {
  const snapshot = useSyncExternalStore(
    pluginRegistry.subscribe,
    pluginRegistry.getSnapshot,
    pluginRegistry.getSnapshot
  );

  useEffect(() => {
    if (pluginClient.isSupported()) void pluginRegistry.ensureLoaded();
  }, []);

  const actions = useMemo<RegisteredPluginAction[]>(() =>
    snapshot.plugins.flatMap((plugin) => {
      if (!plugin.enabled || plugin.status !== 'active') return [];
      return (plugin.manifest.contributes.repositoryActions || [])
        .filter((action) => action.placement === placement)
        .map((action) => ({
          ...action,
          pluginId: plugin.manifest.id,
          pluginName: plugin.manifest.name,
        }));
    }), [placement, snapshot.plugins]);

  return {
    actions,
    runAction(
      action: Pick<RegisteredPluginAction, 'pluginId' | 'id'>,
      repositories: Repository[]
    ): Promise<RunPluginActionResult> {
      return pluginClient.runAction({
        pluginId: action.pluginId,
        actionId: action.id,
        repositories,
      });
    },
  };
}
