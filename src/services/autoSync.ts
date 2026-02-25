import { backend } from './backendAdapter';
import { useAppStore } from '../store/useAppStore';

// Prevent sync loops: when we pull data FROM backend and update store,
// the store subscription would trigger a push TO backend. This flag blocks that.
let _isSyncingFromBackend = false;

// Debounce timer for push-to-backend
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;

// Polling timer for pull-from-backend
let _pollTimer: ReturnType<typeof setInterval> | null = null;

// Polling interval in milliseconds
const POLL_INTERVAL = 5000;

/**
 * Pull all data from backend and update local store.
 * Backend-first strategy: backend data overwrites local data.
 * Silent: errors logged to console only.
 */
export async function syncFromBackend(): Promise<void> {
  if (!backend.isAvailable) return;

  try {
    const [reposResult, releasesResult, aiResult, webdavResult] = await Promise.allSettled([
      backend.fetchRepositories(),
      backend.fetchReleases(),
      backend.fetchAIConfigs(),
      backend.fetchWebDAVConfigs(),
    ]);

    _isSyncingFromBackend = true;

    const state = useAppStore.getState();

    if (reposResult.status === 'fulfilled' && reposResult.value.repositories.length > 0) {
      state.setRepositories(reposResult.value.repositories);
    }

    if (releasesResult.status === 'fulfilled' && releasesResult.value.releases.length > 0) {
      state.setReleases(releasesResult.value.releases);
    }

    if (aiResult.status === 'fulfilled' && aiResult.value.length > 0) {
      state.setAIConfigs(aiResult.value);
    }

    if (webdavResult.status === 'fulfilled' && webdavResult.value.length > 0) {
      state.setWebDAVConfigs(webdavResult.value);
    }

    console.log('✅ Synced from backend');
  } catch (err) {
    console.error('Failed to sync from backend:', err);
  } finally {
    _isSyncingFromBackend = false;
  }
}

/**
 * Push current local state to backend.
 * Silent: errors logged to console only.
 */
export async function syncToBackend(): Promise<void> {
  if (!backend.isAvailable) return;
  if (_isSyncingFromBackend) return;

  try {
    const state = useAppStore.getState();

    await Promise.allSettled([
      backend.syncRepositories(state.repositories),
      backend.syncReleases(state.releases),
      backend.syncAIConfigs(state.aiConfigs),
      backend.syncWebDAVConfigs(state.webdavConfigs),
    ]);

    console.log('✅ Synced to backend');
  } catch (err) {
    console.error('Failed to sync to backend:', err);
  }
}

/**
 * Subscribe to Zustand store changes and auto-push to backend with 2s debounce.
 * Returns an unsubscribe function for cleanup.
 */
export function startAutoSync(): () => void {
  // 1. Subscribe to local changes → push to backend (2s debounce)
  const unsubscribe = useAppStore.subscribe((state, prevState) => {
    if (_isSyncingFromBackend) return;

    const changed =
      state.repositories !== prevState.repositories ||
      state.releases !== prevState.releases ||
      state.aiConfigs !== prevState.aiConfigs ||
      state.webdavConfigs !== prevState.webdavConfigs;

    if (!changed) return;

    // Debounce: wait 2s after last change before pushing
    if (_debounceTimer) {
      clearTimeout(_debounceTimer);
    }
    _debounceTimer = setTimeout(() => {
      syncToBackend();
    }, 2000);
  });

  // 2. Poll backend every 5s → pull fresh data for cross-device sync
  _pollTimer = setInterval(() => {
    syncFromBackend();
  }, POLL_INTERVAL);

  console.log('🔄 Auto-sync started (push debounce: 2s, poll: 5s)');
  return unsubscribe;
}

/**
 * Stop auto-sync: clear debounce timer and unsubscribe from store.
 */
export function stopAutoSync(unsubscribe: () => void): void {
  if (_debounceTimer) {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
  }
  if (_pollTimer) {
    clearInterval(_pollTimer);
    _pollTimer = null;
  }
  unsubscribe();
  console.log('🔄 Auto-sync stopped');
}
