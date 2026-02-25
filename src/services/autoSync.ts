import { backend } from './backendAdapter';
import { useAppStore } from '../store/useAppStore';

// Prevent sync loops: when we pull data FROM backend and update store,
// the store subscription would trigger a push TO backend. This flag blocks that.
let _isSyncingFromBackend = false;
let _isSyncingFromBackendActive = false;

// Track store subscription for cleanup on restart
let _storeUnsubscribe: (() => void) | null = null;

// Prevent overlapping pushes to backend
let _isPushingToBackend = false;

// Debounce timer for push-to-backend
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;

// Polling timer for pull-from-backend
let _pollTimer: ReturnType<typeof setInterval> | null = null;

// Polling interval in milliseconds
const POLL_INTERVAL = 5000;

// Last known backend data fingerprints — skip store update if unchanged
let _lastHash = {
  repos: '',
  releases: '',
  ai: '',
  webdav: '',
  settings: '',
};

function quickHash(data: unknown): string {
  return JSON.stringify(data);
}

/**
 * Pull all data from backend and update local store.
 * Backend-first strategy: backend data overwrites local data.
 * Silent: errors logged to console only.
 */
export async function syncFromBackend(): Promise<void> {
  if (!backend.isAvailable || _isSyncingFromBackendActive) return;

  _isSyncingFromBackendActive = true;

  try {
    const [reposResult, releasesResult, aiResult, webdavResult, settingsResult] = await Promise.allSettled([
      backend.fetchRepositories(),
      backend.fetchReleases(),
      backend.fetchAIConfigs(),
      backend.fetchWebDAVConfigs(),
      backend.fetchSettings(),
    ]);

    const changed = { repos: false, releases: false, ai: false, webdav: false, settings: false };

    // Compare each result against last known hash — only update if backend data actually changed
    if (reposResult.status === 'fulfilled') {
      const hash = quickHash(reposResult.value.repositories);
      if (hash !== _lastHash.repos) {
        _lastHash.repos = hash;
        changed.repos = true;
      }
    }

    if (releasesResult.status === 'fulfilled') {
      const hash = quickHash(releasesResult.value.releases);
      if (hash !== _lastHash.releases) {
        _lastHash.releases = hash;
        changed.releases = true;
      }
    }

    if (aiResult.status === 'fulfilled') {
      const hash = quickHash(aiResult.value);
      if (hash !== _lastHash.ai) {
        _lastHash.ai = hash;
        changed.ai = true;
      }
    }

    if (webdavResult.status === 'fulfilled') {
      const hash = quickHash(webdavResult.value);
      if (hash !== _lastHash.webdav) {
        _lastHash.webdav = hash;
        changed.webdav = true;
      }
    }

    if (settingsResult.status === 'fulfilled') {
      const hash = quickHash(settingsResult.value);
      if (hash !== _lastHash.settings) {
        _lastHash.settings = hash;
        changed.settings = true;
      }
    }

    // Only update store if backend data actually changed
    if (!Object.values(changed).some(Boolean)) return;

    _isSyncingFromBackend = true;
    const state = useAppStore.getState();

    if (changed.repos && reposResult.status === 'fulfilled') {
      state.setRepositories(reposResult.value.repositories);
    }
    if (changed.releases && releasesResult.status === 'fulfilled') {
      state.setReleases(releasesResult.value.releases);
    }
    if (changed.ai && aiResult.status === 'fulfilled') {
      state.setAIConfigs(aiResult.value);
    }
    if (changed.webdav && webdavResult.status === 'fulfilled') {
      state.setWebDAVConfigs(webdavResult.value);
    }
    // Sync active selections from settings
    if (changed.settings && settingsResult.status === 'fulfilled') {
      const settings = settingsResult.value;
      if (typeof settings.activeAIConfig === 'string' || settings.activeAIConfig === null) {
        state.setActiveAIConfig(settings.activeAIConfig as string | null);
      }
      if (typeof settings.activeWebDAVConfig === 'string' || settings.activeWebDAVConfig === null) {
        state.setActiveWebDAVConfig(settings.activeWebDAVConfig as string | null);
      }
    }

    console.log('✅ Synced from backend (data changed)');
  } catch (err) {
    console.error('Failed to sync from backend:', err);
  } finally {
    _isSyncingFromBackend = false;
    _isSyncingFromBackendActive = false;
  }
}

/**
 * Push current local state to backend.
 * Silent: errors logged to console only.
 */
export async function syncToBackend(): Promise<void> {
  if (!backend.isAvailable) return;
  if (_isSyncingFromBackend) return;
  if (_isPushingToBackend) return;

  _isPushingToBackend = true;
  try {
    const state = useAppStore.getState();

    const results = await Promise.allSettled([
      backend.syncRepositories(state.repositories),
      backend.syncReleases(state.releases),
      backend.syncAIConfigs(state.aiConfigs),
      backend.syncWebDAVConfigs(state.webdavConfigs),
      backend.syncSettings({
        activeAIConfig: state.activeAIConfig,
        activeWebDAVConfig: state.activeWebDAVConfig,
      }),
    ]);
    const [reposSync, releasesSync, aiSync, webdavSync, settingsSync] = results;

    const failures = results.filter(r => r.status === 'rejected');
    if (failures.length > 0) {
      console.warn(`⚠️ Synced to backend with ${failures.length} error(s):`, failures.map(f => (f as PromiseRejectedResult).reason));
    } else {
      console.log('✅ Synced to backend');
    }

    // Only update _lastHash for successfully synced slices
    if (reposSync.status === 'fulfilled') _lastHash.repos = quickHash(state.repositories);
    if (releasesSync.status === 'fulfilled') _lastHash.releases = quickHash(state.releases);
    if (aiSync.status === 'fulfilled') _lastHash.ai = quickHash(state.aiConfigs);
    if (webdavSync.status === 'fulfilled') _lastHash.webdav = quickHash(state.webdavConfigs);
    if (settingsSync.status === 'fulfilled') {
      _lastHash.settings = quickHash({
        activeAIConfig: state.activeAIConfig,
        activeWebDAVConfig: state.activeWebDAVConfig,
      });
    }
  } catch (err) {
    console.error('Failed to sync to backend:', err);
  } finally {
    _isPushingToBackend = false;
  }
}

/**
 * Subscribe to Zustand store changes and auto-push to backend with 2s debounce.
 * Returns an unsubscribe function for cleanup.
 */
export function startAutoSync(): () => void {
  // Guard: if already running, stop previous instance first
  if (_storeUnsubscribe) {
    _storeUnsubscribe();
    _storeUnsubscribe = null;
  }
  if (_pollTimer) {
    clearInterval(_pollTimer);
    _pollTimer = null;
  }
  if (_debounceTimer) {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
  }
  // 1. Subscribe to local changes → push to backend (2s debounce)
  const unsubscribe = useAppStore.subscribe((state, prevState) => {
    if (_isSyncingFromBackend) return;

    const changed =
      state.repositories !== prevState.repositories ||
      state.releases !== prevState.releases ||
      state.aiConfigs !== prevState.aiConfigs ||
      state.webdavConfigs !== prevState.webdavConfigs ||
      state.activeAIConfig !== prevState.activeAIConfig ||
      state.activeWebDAVConfig !== prevState.activeWebDAVConfig;

    if (!changed) return;

    // Debounce: wait 2s after last change before pushing
    if (_debounceTimer) {
      clearTimeout(_debounceTimer);
    }
    _debounceTimer = setTimeout(() => {
      syncToBackend();
    }, 2000);
  });
  _storeUnsubscribe = unsubscribe;

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
  if (_storeUnsubscribe) {
    _storeUnsubscribe();
    _storeUnsubscribe = null;
  } else {
    unsubscribe();
  }
  console.log('🔄 Auto-sync stopped');
}
