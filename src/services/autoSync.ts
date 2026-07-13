import { backend } from './backendAdapter';
import { useAppStore } from '../store/useAppStore';
import { mergeRepositoriesPreservingLocalMetadata } from '../utils/repositoryMerge';
import { logger } from './logger';

// Prevent sync loops: when we pull data FROM backend and update store,
// the store subscription would trigger a push TO backend. This flag blocks that.
let _isSyncingFromBackend = false;
let _isSyncingFromBackendActive = false;

// Track store subscription for cleanup on restart
let _storeUnsubscribe: (() => void) | null = null;

// Prevent overlapping pushes to backend
let _isPushingToBackend = false;
// Queue a push if one is requested while a pull is in-flight
let _hasPendingPush = false;
// Track unsynced local edits so backend polling does not overwrite them.
let _hasPendingLocalChanges = false;

// Debounce timer for push-to-backend
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;

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
  embedding: '',
  vectorSearch: '',
  mcp: '',
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
  if (
    !backend.isAvailable ||
    _isSyncingFromBackendActive ||
    _isPushingToBackend ||
    _hasPendingLocalChanges ||
    _debounceTimer
  ) {
    return;
  }

  _isSyncingFromBackendActive = true;

  const startTime = Date.now();
  try {
    const [reposResult, releasesResult, aiResult, webdavResult, embeddingResult, vectorSearchResult, mcpResult, settingsResult] = await Promise.allSettled([
      backend.fetchRepositories(),
      backend.fetchReleases(),
      backend.fetchAIConfigs(),
      backend.fetchWebDAVConfigs(),
      backend.fetchEmbeddingConfigs(),
      backend.fetchVectorSearchConfig(),
      backend.fetchMcpConfig(),
      backend.fetchSettings(),
    ]);

    const changed = { repos: false, releases: false, ai: false, webdav: false, embedding: false, vectorSearch: false, mcp: false, settings: false };

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

    if (embeddingResult.status === 'fulfilled') {
      const hash = quickHash(embeddingResult.value);
      if (hash !== _lastHash.embedding) {
        hashes.embedding = hash;
        changed.embedding = true;
      }
    }

    if (vectorSearchResult.status === 'fulfilled') {
      const hash = quickHash(vectorSearchResult.value);
      if (hash !== _lastHash.vectorSearch) {
        hashes.vectorSearch = hash;
        changed.vectorSearch = true;
      }
    }

    if (mcpResult.status === 'fulfilled') {
      const hash = quickHash(mcpResult.value);
      if (hash !== _lastHash.mcp) {
        hashes.mcp = hash;
        changed.mcp = true;
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

    _isSyncingFromBackend = true;
    if (changed.repos || changed.releases) {
      setRepositorySyncVisualState(true);
    }
    const state = useAppStore.getState();

    // Update store then commit hash — hash only changes if setter succeeds
    if (changed.repos && reposResult.status === 'fulfilled') {
      const backendRepos = reposResult.value.repositories;
      const localRepos = state.repositories;
      // Distinguish first-ever sync (bootstrap) from an authoritative empty backend.
      // On bootstrap the hash is still '' — preserve local cache and push it to backend.
      // On subsequent syncs, accept the backend state even if empty (e.g. user cleared
      // stars from another device).
      const isBootstrapEmpty =
        backendRepos.length === 0 && localRepos.length > 0 && _lastHash.repos === '';
      if (isBootstrapEmpty) {
        _hasPendingPush = true;
      } else {
        const merged = mergeRepositoriesPreservingLocalMetadata(backendRepos, localRepos);
        state.setRepositories(merged);
        _lastHash.repos = quickHash(merged);
      }
    }
    if (changed.releases && releasesResult.status === 'fulfilled') {
      state.setReleases(releasesResult.value.releases);
      _lastHash.releases = hashes.releases;
    }
    if (changed.ai && aiResult.status === 'fulfilled') {
      // Filter out configs with decrypt_failed status — preserve local apiKey values
      // to prevent backend decryption failures from overwriting valid local data.
      const backendConfigs = aiResult.value;
      const localConfigs = state.aiConfigs;
      const mergedConfigs = backendConfigs.map(bc => {
        if (bc.apiKeyStatus === 'decrypt_failed' || !bc.apiKey) {
          const local = localConfigs.find(lc => lc.id === bc.id);
          if (local && local.apiKey) {
            logger.warn('sync.decryptFailed', `Backend decrypt_failed for AI config "${bc.name}", preserving local apiKey`);
            return { ...bc, apiKey: local.apiKey, apiKeyStatus: 'ok' as const };
          }
        }
        return bc;
      });
      state.setAIConfigs(mergedConfigs);
      // Store raw backend hash so change detection compares against the same payload.
      // Using mergedConfigs would cause a mismatch and re-trigger on every poll.
      _lastHash.ai = hashes.ai;
    }
    if (changed.webdav && webdavResult.status === 'fulfilled') {
      // Filter out configs with decrypt_failed status — preserve local password values
      // to prevent backend decryption failures from overwriting valid local data.
      const backendConfigs = webdavResult.value;
      const localConfigs = state.webdavConfigs;
      const mergedConfigs = backendConfigs.map(bc => {
        if (bc.passwordStatus === 'decrypt_failed' || !bc.password) {
          const local = localConfigs.find(lc => lc.id === bc.id);
          if (local && local.password) {
            logger.warn('sync.decryptFailed', `Backend decrypt_failed for WebDAV config "${bc.name}", preserving local password`);
            return { ...bc, password: local.password, passwordStatus: 'ok' as const };
          }
        }
        return bc;
      });
      state.setWebDAVConfigs(mergedConfigs);
      // Store raw backend hash for consistent change detection
      _lastHash.webdav = hashes.webdav;
    }
    if (changed.embedding && embeddingResult.status === 'fulfilled') {
      const backendConfigs = embeddingResult.value;
      const localConfigs = state.embeddingConfigs;
      const mergedConfigs = backendConfigs.map(bc => {
        if (bc.apiKeyStatus === 'decrypt_failed' || !bc.apiKey) {
          const local = localConfigs.find(lc => lc.id === bc.id);
          if (local && local.apiKey) {
            logger.warn('sync.decryptFailed', `Backend decrypt_failed for embedding config "${bc.name}", preserving local apiKey`);
            return { ...bc, apiKey: local.apiKey, apiKeyStatus: 'ok' as const };
          }
        }
        return bc;
      });
      state.setEmbeddingConfigs(mergedConfigs);
      _lastHash.embedding = hashes.embedding;
    }
    if (changed.vectorSearch && vectorSearchResult.status === 'fulfilled') {
      const backendConfig = vectorSearchResult.value;
      // Preserve local authToken if backend returned empty or decrypt_failed
      const localConfig = state.vectorSearchConfig;
      if ((backendConfig as Record<string, unknown>).authTokenStatus === 'decrypt_failed' || !backendConfig.authToken) {
        if (localConfig.authToken) {
          logger.warn('sync.decryptFailed', 'Backend decrypt_failed for vector search authToken, preserving local value');
          backendConfig.authToken = localConfig.authToken;
        }
      }
      state.setVectorSearchConfig(backendConfig);
      _lastHash.vectorSearch = hashes.vectorSearch;
    }
    if (changed.mcp && mcpResult.status === 'fulfilled') {
      const backendMcp = mcpResult.value;
      const localMcp = state.mcpConfig;
      // Preserve local token when the backend returns a masked/empty value or a
      // decrypt failure, so a sync never overwrites a valid local token.
      if ((backendMcp as Record<string, unknown>).tokenStatus === 'decrypt_failed' || !backendMcp.token) {
        if (localMcp.token) {
          logger.warn('sync.decryptFailed', 'Backend decrypt_failed/empty for MCP token, preserving local value');
          (backendMcp as Record<string, unknown>).token = localMcp.token;
        }
      }
      state.setMcpConfig(backendMcp);
      _lastHash.mcp = hashes.mcp;
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
      if (typeof settings.activeEmbeddingConfig === 'string' || settings.activeEmbeddingConfig === null) {
        state.setActiveEmbeddingConfig(settings.activeEmbeddingConfig as string | null);
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
      if (settings.releaseSourceSettings && typeof settings.releaseSourceSettings === 'object') {
        state.setReleaseSourceSettings(settings.releaseSourceSettings as typeof state.releaseSourceSettings);
      }
      if (typeof settings.collapsedSidebarCategoryCount === 'number' && settings.collapsedSidebarCategoryCount >= 1) {
        useAppStore.setState({ collapsedSidebarCategoryCount: settings.collapsedSidebarCategoryCount });
      }
      _lastHash.settings = hashes.settings;
    }

    logger.info('sync.pullFromBackend', 'Synced from backend (data changed)', { ...changed, durationMs: Date.now() - startTime });
  } catch (err) {
    logger.errorFromError('sync.pullFromBackend', 'Failed to sync from backend', err, { durationMs: Date.now() - startTime });
  } finally {
    setRepositorySyncVisualState(false);
    _isSyncingFromBackend = false;
    _isSyncingFromBackendActive = false;
    // Drain pending push that was queued during pull
    if (_hasPendingPush) {
      _hasPendingPush = false;
      void syncToBackend();
    }
  }
}

/**
 * Push current local state to backend.
 * Silent: errors logged to console only.
 */
export async function syncToBackend(): Promise<void> {
  if (!backend.isAvailable) return;
  // If a pull is in-flight, queue this push for after pull completes
  if (_isSyncingFromBackendActive) {
    _hasPendingPush = true;
    return;
  }
  if (_isSyncingFromBackend) return;
  if (_isPushingToBackend) return;

  _isPushingToBackend = true;
  _hasPendingPush = false;
  setRepositorySyncVisualState(true);
  const pushStartTime = Date.now();
  try {
    const state = useAppStore.getState();

    const results = await Promise.allSettled([
      backend.syncRepositories(state.repositories),
      backend.syncReleases(state.releases),
      backend.syncAIConfigs(state.aiConfigs),
      backend.syncWebDAVConfigs(state.webdavConfigs),
      backend.syncEmbeddingConfigs(state.embeddingConfigs),
      backend.syncVectorSearchConfig(state.vectorSearchConfig),
      backend.syncMcpConfig(state.mcpConfig),
      backend.syncSettings({
        activeAIConfig: state.activeAIConfig,
        activeWebDAVConfig: state.activeWebDAVConfig,
        activeEmbeddingConfig: state.activeEmbeddingConfig,
        hiddenDefaultCategoryIds: state.hiddenDefaultCategoryIds,
        categoryOrder: state.categoryOrder,
        customCategories: state.customCategories,
        assetFilters: state.assetFilters,
        releaseSourceSettings: state.releaseSourceSettings,
        collapsedSidebarCategoryCount: state.collapsedSidebarCategoryCount,
      }),
    ]);
    const [reposSync, releasesSync, aiSync, webdavSync, embeddingSync, vectorSearchSync, mcpSync, settingsSync] = results;

    const failures = results.filter(r => r.status === 'rejected');
    if (failures.length > 0) {
      logger.warn('sync.pushToBackend', `Synced to backend with ${failures.length} error(s)`, { failureCount: failures.length, durationMs: Date.now() - pushStartTime });
      _hasPendingLocalChanges = true;
    } else {
      logger.info('sync.pushToBackend', 'Synced to backend', { durationMs: Date.now() - pushStartTime });
      _hasPendingLocalChanges = false;
    }

    // Only update _lastHash for successfully synced slices
    if (reposSync.status === 'fulfilled') _lastHash.repos = quickHash(state.repositories);
    if (releasesSync.status === 'fulfilled') _lastHash.releases = quickHash(state.releases);
    if (aiSync.status === 'fulfilled') _lastHash.ai = quickHash(state.aiConfigs);
    if (webdavSync.status === 'fulfilled') _lastHash.webdav = quickHash(state.webdavConfigs);
    if (embeddingSync.status === 'fulfilled') _lastHash.embedding = quickHash(state.embeddingConfigs);
    if (vectorSearchSync.status === 'fulfilled') _lastHash.vectorSearch = quickHash(state.vectorSearchConfig);
    if (mcpSync.status === 'fulfilled') _lastHash.mcp = quickHash(state.mcpConfig);
    if (settingsSync.status === 'fulfilled') {
      _lastHash.settings = quickHash({
        activeAIConfig: state.activeAIConfig,
        activeWebDAVConfig: state.activeWebDAVConfig,
        activeEmbeddingConfig: state.activeEmbeddingConfig,
        hiddenDefaultCategoryIds: state.hiddenDefaultCategoryIds,
        categoryOrder: state.categoryOrder,
        customCategories: state.customCategories,
        assetFilters: state.assetFilters,
        releaseSourceSettings: state.releaseSourceSettings,
        collapsedSidebarCategoryCount: state.collapsedSidebarCategoryCount,
      });
    }
  } catch (err) {
    logger.errorFromError('sync.pushToBackend', 'Failed to sync to backend', err, { durationMs: Date.now() - pushStartTime });
  } finally {
    setRepositorySyncVisualState(false);
    _isPushingToBackend = false;
  }
}

/**
 * Immediately push current local state to backend.
 * Used for destructive/high-priority operations such as unstar/delete.
 */
export async function forceSyncToBackend(): Promise<void> {
  if (_debounceTimer) {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
  }
  _hasPendingLocalChanges = true;
  await syncToBackend();
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
  // Reset in-flight state flags to prevent permanent sync blocking
  _isSyncingFromBackend = false;
  _isPushingToBackend = false;
  _isSyncingFromBackendActive = false;
  _hasPendingPush = false;
  _hasPendingLocalChanges = false;
  // 1. Subscribe to local changes → push to backend (2s debounce)
  const unsubscribe = useAppStore.subscribe((state, prevState) => {
    if (_isSyncingFromBackend) return;

    const changed =
      state.repositories !== prevState.repositories ||
      state.releases !== prevState.releases ||
      state.aiConfigs !== prevState.aiConfigs ||
      state.webdavConfigs !== prevState.webdavConfigs ||
      state.embeddingConfigs !== prevState.embeddingConfigs ||
      state.vectorSearchConfig !== prevState.vectorSearchConfig ||
      state.activeAIConfig !== prevState.activeAIConfig ||
      state.activeWebDAVConfig !== prevState.activeWebDAVConfig ||
      state.activeEmbeddingConfig !== prevState.activeEmbeddingConfig ||
      state.hiddenDefaultCategoryIds !== prevState.hiddenDefaultCategoryIds ||
      state.categoryOrder !== prevState.categoryOrder ||
      state.customCategories !== prevState.customCategories ||
      state.assetFilters !== prevState.assetFilters ||
      state.releaseSourceSettings !== prevState.releaseSourceSettings ||
      state.collapsedSidebarCategoryCount !== prevState.collapsedSidebarCategoryCount;

    if (!changed) return;

    _hasPendingLocalChanges = true;

    // Debounce: wait 2s after last change before pushing
    if (_debounceTimer) {
      clearTimeout(_debounceTimer);
    }
    _debounceTimer = setTimeout(() => {
      _debounceTimer = null;
      void syncToBackend();
    }, 2000);
  });
  _storeUnsubscribe = unsubscribe;

  // 2. Poll backend every 5s → pull fresh data for cross-device sync
  _pollTimer = setInterval(() => {
    syncFromBackend();
  }, POLL_INTERVAL);

  logger.info('sync.start', 'Auto-sync started (push debounce: 2s, poll: 5s)');
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
  // Reset in-flight state flags
  _isPushingToBackend = false;
  _isSyncingFromBackendActive = false;
  _isSyncingFromBackend = false;
  _hasPendingPush = false;
  _hasPendingLocalChanges = false;
  logger.info('sync.stop', 'Auto-sync stopped');
}
