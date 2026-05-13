import { backend } from './backendAdapter';
import { useAppStore } from '../store/useAppStore';

// Prevent concurrent syncs: when we're pulling data FROM backend, don't start another pull.
let _isSyncingFromBackendActive = false;

// Polling timer for pull-from-backend
let _pollTimer: ReturnType<typeof setInterval> | null = null;

// Polling interval in milliseconds
const POLL_INTERVAL = 5000;

// Last known backend data fingerprints — skip store update if unchanged
const _lastHash = {
  repos: '',
  releases: '',
  ai: '',
  webdav: '',
  settings: '',
};

function quickHash(data: unknown): string {
  return JSON.stringify(data);
}

function setRepositorySyncVisualState(isSyncing: boolean): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('gsm:repository-sync-visual-state', { detail: { isSyncing } }));
}

/**
 * Pull all data from backend and update local store.
 * Backend-first strategy: backend data overwrites local data.
 * Silent: errors logged to console only.
 */
export async function syncFromBackend(): Promise<void> {
  if (!backend.isAvailable || _isSyncingFromBackendActive) {
    return;
  }

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

    // Compute hashes for each slice — only mark changed if hash differs
    const hashes: Record<string, string> = {};
    if (reposResult.status === 'fulfilled') {
      const hash = quickHash(reposResult.value.repositories);
      if (hash !== _lastHash.repos) {
        hashes.repos = hash;
        changed.repos = true;
      }
    }

    if (releasesResult.status === 'fulfilled') {
      const hash = quickHash(releasesResult.value.releases);
      if (hash !== _lastHash.releases) {
        hashes.releases = hash;
        changed.releases = true;
      }
    }

    if (aiResult.status === 'fulfilled') {
      const hash = quickHash(aiResult.value);
      if (hash !== _lastHash.ai) {
        hashes.ai = hash;
        changed.ai = true;
      }
    }

    if (webdavResult.status === 'fulfilled') {
      const hash = quickHash(webdavResult.value);
      if (hash !== _lastHash.webdav) {
        hashes.webdav = hash;
        changed.webdav = true;
      }
    }

    if (settingsResult.status === 'fulfilled') {
      const hash = quickHash(settingsResult.value);
      if (hash !== _lastHash.settings) {
        hashes.settings = hash;
        changed.settings = true;
      }
    }

    // Only update store if backend data actually changed
    if (!Object.values(changed).some(Boolean)) {
      _isSyncingFromBackendActive = false;
      return;
    }

    if (changed.repos || changed.releases) {
      setRepositorySyncVisualState(true);
    }
    const state = useAppStore.getState();

    // Update store then commit hash — hash only changes if setter succeeds
    if (changed.repos && reposResult.status === 'fulfilled') {
      state.setRepositories(reposResult.value.repositories);
      _lastHash.repos = hashes.repos;
    }
    if (changed.releases && releasesResult.status === 'fulfilled') {
      state.setReleases(releasesResult.value.releases);
      // Merge backend is_read into local readReleases Set
      const backendReadIds = releasesResult.value.releases
        .filter((r: { is_read?: boolean; id: number }) => r.is_read)
        .map((r: { is_read?: boolean; id: number }) => r.id);
      if (backendReadIds.length > 0) {
        const latestReadReleases = useAppStore.getState().readReleases;
        const merged = new Set([...latestReadReleases, ...backendReadIds]);
        useAppStore.setState({ readReleases: merged });
      }
      _lastHash.releases = hashes.releases;
    }
    if (changed.ai && aiResult.status === 'fulfilled') {
      state.setAIConfigs(aiResult.value);
      _lastHash.ai = hashes.ai;
    }
    if (changed.webdav && webdavResult.status === 'fulfilled') {
      state.setWebDAVConfigs(webdavResult.value);
      _lastHash.webdav = hashes.webdav;
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
      if (Array.isArray(settings.hiddenDefaultCategoryIds)) {
        const nextHiddenIds = settings.hiddenDefaultCategoryIds.filter((id): id is string => typeof id === 'string');
        const currentHiddenIds = state.hiddenDefaultCategoryIds || [];
        for (const id of currentHiddenIds) {
          if (!nextHiddenIds.includes(id)) {
            state.showDefaultCategory(id);
          }
        }
        for (const id of nextHiddenIds) {
          if (!currentHiddenIds.includes(id)) {
            state.hideDefaultCategory(id);
          }
        }
      }
      if (Array.isArray(settings.categoryOrder)) {
        useAppStore.setState({ categoryOrder: settings.categoryOrder.filter((id: unknown): id is string => typeof id === 'string') });
      }
      if (Array.isArray(settings.customCategories)) {
        useAppStore.setState({ customCategories: settings.customCategories });
      }
      if (Array.isArray(settings.assetFilters)) {
        useAppStore.setState({ assetFilters: settings.assetFilters });
      }
      if (typeof settings.collapsedSidebarCategoryCount === 'number' && settings.collapsedSidebarCategoryCount >= 1) {
        useAppStore.setState({ collapsedSidebarCategoryCount: settings.collapsedSidebarCategoryCount });
      }
      _lastHash.settings = hashes.settings;
    }

    console.log('✅ Synced from backend (data changed)');
  } catch (err) {
    console.error('Failed to sync from backend:', err);
  } finally {
    setRepositorySyncVisualState(false);
    _isSyncingFromBackendActive = false;
  }
}

/**
 * Start polling backend for cross-device data sync.
 * Returns an unsubscribe function for cleanup.
 */
export function startAutoSync(): () => void {
  if (_pollTimer) {
    clearInterval(_pollTimer);
    _pollTimer = null;
  }
  _isSyncingFromBackendActive = false;

  // Poll backend every 5s for cross-device sync
  _pollTimer = setInterval(() => {
    syncFromBackend();
  }, POLL_INTERVAL);

  console.log('🔄 Auto-sync started (poll: 5s)');
  return stopAutoSync;
}

/**
 * Stop auto-sync polling.
 */
export function stopAutoSync(): void {
  if (_pollTimer) {
    clearInterval(_pollTimer);
    _pollTimer = null;
  }
  _isSyncingFromBackendActive = false;
  console.log('🔄 Auto-sync stopped');
}
