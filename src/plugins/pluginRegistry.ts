import { pluginClient } from './pluginClient';
import type { PluginListResult, PluginOperationResult } from './types';

const EMPTY_SNAPSHOT: PluginListResult = { plugins: [], invalidPlugins: [] };
let snapshot = EMPTY_SNAPSHOT;
let loaded = false;
let loading: Promise<PluginListResult> | null = null;
let refreshVersion = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

async function refresh(): Promise<PluginListResult> {
  const version = ++refreshVersion;
  const request = pluginClient.list().then((result) => {
    if (version === refreshVersion) {
      snapshot = result;
      loaded = true;
      emit();
    }
    return result;
  }).finally(() => {
    if (loading === request) loading = null;
  });
  loading = request;
  return request;
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
    refreshVersion += 1;
    emit();
  },
};
