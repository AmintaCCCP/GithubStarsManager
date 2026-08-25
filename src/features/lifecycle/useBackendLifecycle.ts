import { useEffect } from 'react';
import { backend } from '../../services/backendAdapter';
import {
  startAutoSync,
  stopAutoSync,
  syncFromBackend,
  syncLocalGitHubTokenToBackend,
  tryRestoreAuthFromBackend,
} from '../../services/autoSync';
import {
  refreshMcpElectronBridge,
  startMcpElectronBridge,
  stopMcpElectronBridge,
} from '../../services/mcpElectronBridge';

/**
 * Owns application-wide backend and Electron MCP startup after Store hydration.
 * Local state remains usable whenever backend probing or remote synchronization
 * fails, and the auto-sync subscription is released on unmount.
 */
export const useBackendLifecycle = (hasHydrated: boolean): void => {
  useEffect(() => {
    return () => stopMcpElectronBridge();
  }, []);

  useEffect(() => {
    if (!hasHydrated) return;

    let unsubscribe: (() => void) | null = null;
    let cancelled = false;

    const initialize = async () => {
      try {
        await backend.init();
        if (backend.isAvailable && !cancelled) {
          // Session restoration must precede the data pull so a fresh browser
          // receives authentication state before it consumes backend records.
          await tryRestoreAuthFromBackend();
          if (!cancelled) {
            await syncLocalGitHubTokenToBackend();
          }
          if (!cancelled) {
            await syncFromBackend();
          }
          if (!cancelled) {
            unsubscribe = startAutoSync();
          }
        }
      } catch (error) {
        // Backend availability is optional. Preserve local-only application use.
        console.error('Failed to initialize backend:', error);
      } finally {
        // Resolve the Electron MCP target after a successful or failed backend
        // probe so it can choose backend MCP or the local loopback bridge.
        if (!cancelled) {
          startMcpElectronBridge();
          refreshMcpElectronBridge();
        }
      }
    };

    void initialize();

    return () => {
      cancelled = true;
      if (unsubscribe) {
        stopAutoSync(unsubscribe);
      }
    };
  }, [hasHydrated]);
};
