/**
 * Long-lived Electron MCP lifecycle bridge.
 * Keeps local MCP start/stop + data snapshots in sync for the whole app session,
 * not only while the MCP settings panel is mounted.
 */
import { useAppStore } from '../store/useAppStore';
import { normalizeMcpHost } from '../utils/mcpHost';
import { isElectron } from './electronProxy';
import { backend } from './backendAdapter';
import { logger } from './logger';

let started = false;
let unsub: (() => void) | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
/** Serialize setConfig → pushSnapshot → start/stop so concurrent store updates don't race. */
let chain: Promise<void> = Promise.resolve();

function clearDebounce(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

function enqueue(task: () => Promise<void>): void {
  chain = chain.then(task).catch((err) => {
    logger.warn('mcp.bridge', 'Electron MCP lifecycle step failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

async function pushLifecycle(): Promise<void> {
  if (!isElectron() || !window.electronAPI?.mcp) return;
  const api = window.electronAPI.mcp;

  // When backend is available, agents should use backend /mcp; stop local server.
  if (backend.isAvailable) {
    try {
      await api.stop();
    } catch (err) {
      logger.warn('mcp.bridge', 'Failed to stop local MCP (backend mode)', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  const state = useAppStore.getState();
  const { mcpConfig } = state;
  const host = normalizeMcpHost(mcpConfig.host);

  try {
    await api.setConfig({
      enabled: mcpConfig.enabled,
      host,
      port: mcpConfig.port,
      token: mcpConfig.token,
    });

    if (!mcpConfig.enabled) {
      await api.stop();
      return;
    }

    await api.pushSnapshot({
      repositories: state.repositories,
      customCategories: state.customCategories,
      vectorSearchConfig: {
        enabled: state.vectorSearchConfig.enabled,
        workerUrl: state.vectorSearchConfig.workerUrl,
        embeddingConfigId: state.vectorSearchConfig.embeddingConfigId,
      },
      snapshotAt: new Date().toISOString(),
    });
    const startResult = await api.start();
    if (startResult && startResult.success === false) {
      logger.warn('mcp.bridge', 'MCP start returned failure', {
        error: startResult.error,
      });
    }
  } catch (err) {
    logger.warn('mcp.bridge', 'Electron MCP lifecycle failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function schedulePush(): void {
  clearDebounce();
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    enqueue(() => pushLifecycle());
  }, 300);
}

/**
 * Subscribe once for the app session. Safe to call repeatedly.
 * Prefer calling after backend.init() so backend.isAvailable is accurate.
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
    enqueue(async () => {
      try {
        await window.electronAPI!.mcp!.stop();
      } catch {
        /* ignore */
      }
    });
  }
  started = false;
}

/** Re-evaluate local vs backend after backend.init completes. */
export function refreshMcpElectronBridge(): void {
  if (!started) {
    startMcpElectronBridge();
    return;
  }
  schedulePush();
}
