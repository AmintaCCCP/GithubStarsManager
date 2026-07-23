/**
 * Long-lived Electron MCP lifecycle bridge.
 * Keeps local MCP start/stop + data snapshots in sync for the whole app session,
 * not only while the MCP settings panel is mounted.
 */
import { useAppStore } from '../store/useAppStore';
import { isElectron } from './electronProxy';
import { backend } from './backendAdapter';

let started = false;
let unsub: (() => void) | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function clearDebounce(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

function pushLifecycle(): void {
  if (!isElectron() || !window.electronAPI?.mcp) return;
  // When backend is available, agents should use backend /mcp; stop local server.
  if (backend.isAvailable) {
    void window.electronAPI.mcp.stop();
    return;
  }

  const state = useAppStore.getState();
  const { mcpConfig } = state;
  const host =
    !mcpConfig.host || mcpConfig.host === '0.0.0.0' || mcpConfig.host === '::'
      ? '127.0.0.1'
      : mcpConfig.host;

  const api = window.electronAPI.mcp;
  void api.setConfig({
    enabled: mcpConfig.enabled,
    host,
    port: mcpConfig.port,
    token: mcpConfig.token,
  });

  if (!mcpConfig.enabled) {
    void api.stop();
    return;
  }

  void api.pushSnapshot({
    repositories: state.repositories,
    customCategories: state.customCategories,
    vectorSearchConfig: {
      enabled: state.vectorSearchConfig.enabled,
      workerUrl: state.vectorSearchConfig.workerUrl,
      embeddingConfigId: state.vectorSearchConfig.embeddingConfigId,
    },
    snapshotAt: new Date().toISOString(),
  });
  void api.start();
}

function schedulePush(): void {
  clearDebounce();
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    pushLifecycle();
  }, 300);
}

/**
 * Subscribe once for the app session. Safe to call repeatedly.
 */
export function startMcpElectronBridge(): void {
  if (started || typeof window === 'undefined') return;
  if (!isElectron() || !window.electronAPI?.mcp) return;
  started = true;

  // Initial sync
  schedulePush();

  unsub = useAppStore.subscribe((state, prev) => {
    const cfgChanged =
      state.mcpConfig.enabled !== prev.mcpConfig.enabled ||
      state.mcpConfig.host !== prev.mcpConfig.host ||
      state.mcpConfig.port !== prev.mcpConfig.port ||
      state.mcpConfig.token !== prev.mcpConfig.token;
    const dataChanged =
      state.repositories !== prev.repositories ||
      state.customCategories !== prev.customCategories ||
      state.vectorSearchConfig !== prev.vectorSearchConfig;

    if (cfgChanged || dataChanged) {
      schedulePush();
    }
  });
}

export function stopMcpElectronBridge(): void {
  clearDebounce();
  if (unsub) {
    unsub();
    unsub = null;
  }
  if (isElectron() && window.electronAPI?.mcp) {
    void window.electronAPI.mcp.stop();
  }
  started = false;
}
