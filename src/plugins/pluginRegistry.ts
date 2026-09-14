import { pluginClient } from './pluginClient';
import type { PluginListResult, PluginOperationResult } from './types';

const EMPTY_SNAPSHOT: PluginListResult = { plugins: [], invalidPlugins: [] };
let snapshot = EMPTY_SNAPSHOT;
let loaded = false;
let loading: Promise<PluginListResult> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

async function refresh(): Promise<PluginListResult> {
  loading = pluginClient.list().then((result) => {
    snapshot = result;
    loaded = true;
    emit();
    return result;
  }).finally(() => {
    loading = null;
  });
  return loading;
}

async function mutate(operation: () => Promise<PluginOperationResult>): Promise<PluginOperationResult> {
  const result = await operation();
  await refresh();
  return result;
}

export const pluginRegistry = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): PluginListResult {
    return snapshot;
  },
  ensureLoaded(): Promise<PluginListResult> {
    if (loaded) return Promise.resolve(snapshot);
    return loading || refresh();
  },
  refresh,
  async installFromDirectory() {
    const result = await pluginClient.installFromDirectory();
    await refresh();
    return result;
  },
  enable(pluginId: string, permissions: string[]): Promise<PluginOperationResult> {
    return mutate(() => pluginClient.enable(pluginId, permissions));
  },
  disable(pluginId: string): Promise<PluginOperationResult> {
    return mutate(() => pluginClient.disable(pluginId));
  },
  uninstall(pluginId: string): Promise<PluginOperationResult> {
    return mutate(() => pluginClient.uninstall(pluginId));
  },
  resetForTests() {
    snapshot = EMPTY_SNAPSHOT;
    loaded = false;
    loading = null;
    emit();
  },
};
