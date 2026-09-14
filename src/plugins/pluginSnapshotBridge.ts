import { useAppStore } from '../store/useAppStore';
import { isElectron } from '../services/electronProxy';
import { logger } from '../services/logger';
import { pluginClient } from './pluginClient';

let started = false;
let unsubscribe: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let chain: Promise<void> = Promise.resolve();

function schedule(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    const state = useAppStore.getState();
    chain = chain.then(async () => {
      const result = await pluginClient.pushSnapshot({
        repositories: state.repositories,
        releases: state.releases,
      });
      if (!result.success) throw new Error(result.error.message);
    }).catch((error) => {
      logger.warn('plugins.snapshot', 'Failed to update the plugin Host data snapshot', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, 300);
}

export function startPluginSnapshotBridge(): void {
  if (started || !isElectron() || !window.electronAPI?.plugins) return;
  started = true;
  schedule();
  unsubscribe = useAppStore.subscribe((state, previous) => {
    if (state.repositories !== previous.repositories || state.releases !== previous.releases) schedule();
  });
}

export function stopPluginSnapshotBridge(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  unsubscribe?.();
  unsubscribe = null;
  started = false;
}
