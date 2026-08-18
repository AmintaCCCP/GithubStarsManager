import { backend } from './backendAdapter';
import { useAppStore } from '../store/useAppStore';
import { mergeRepositoriesPreservingLocalMetadata } from '../utils/repositoryMerge';
import { GitHubApiService } from './githubApi';
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
  settings: '',
};

function quickHash(data: unknown): string {
  return JSON.stringify(data);
}

/** Canonical fingerprint for the vector search config.
 *
 * The backend GET payload and the store config have different key sets/order
 * (backend adds authTokenStatus/status/lastSyncAt, the store always carries
 * embeddingFormatVersion). A naive quickHash over each raw side therefore never
 * matches, which kept the poll→push loop running forever. Fingerprinting only the
 * shared, meaningful fields makes both sides converge after one round-trip.
 */
export function vectorSearchFingerprint(config: unknown): string {
  const c = (config ?? {}) as Record<string, unknown>;
  return quickHash({
    enabled: !!c.enabled,
    workerUrl: c.workerUrl ?? '',
    authToken: c.authToken ?? '',
    embeddingConfigId: c.embeddingConfigId ?? '',
    indexMode: c.indexMode ?? 'readme',
    readmeMaxChars: c.readmeMaxChars ?? 6000,
    searchThreshold: c.searchThreshold ?? 0.35,
    searchTopK: c.searchTopK ?? 30,
    enableHyDE: c.enableHyDE ?? true,
    enableReranking: c.enableReranking ?? true,
    embeddingFormatVersion: c.embeddingFormatVersion ?? null,
  });
}

/**
 * Decide whether a fresh/empty backend must NOT overwrite a locally configured
 * vector search. Mirrors the repositories bootstrap guard: on the first-ever sync
 * in this session, an empty backend (nothing stored) must not wipe a working local
 * config — otherwise the local worker/embedding setup is lost and the follow-up
 * push then persists the wiped (empty) config to the backend. When true, the
 * caller keeps the local config and pushes it up instead.
 */
export function shouldPreserveLocalVectorSearch(
  backendConfig: unknown,
  localConfig: unknown,
  isFirstSync: boolean
): boolean {
  if (!isFirstSync) return false;
  const b = (backendConfig ?? {}) as Record<string, unknown>;
  const l = (localConfig ?? {}) as Record<string, unknown>;
  const backendEmpty = !b.enabled && !b.workerUrl && !b.embeddingConfigId;
  const localConfigured = !!(l.enabled || l.workerUrl || l.embeddingConfigId);
  return backendEmpty && localConfigured;
}

/**
 * True when the backend's stored vector-search authToken is unusable (empty or
 * failed to decrypt) but the local client has a working token to preserve. The
 * caller must then queue a repair push: during a pull the store subscription is
 * suppressed, so without it the preserved token would never reach the backend,
 * the stored fingerprint (with the local token) would never match the backend's
 * empty token, and the poll→push loop would run forever.
 */
export function shouldQueueVectorSearchRepairPush(backendConfig: unknown, localConfig: unknown): boolean {
  const b = (backendConfig ?? {}) as Record<string, unknown>;
  const l = (localConfig ?? {}) as Record<string, unknown>;
  const backendTokenUnusable = b.authTokenStatus === 'decrypt_failed' || !b.authToken;
  return backendTokenUnusable && !!l.authToken;
}

function setRepositorySyncVisualState(isSyncing: boolean): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('gsm:repository-sync-visual-state', { detail: { isSyncing } }));
}

let _isRestoringAuth = false;

/**
 * Cross-browser/device session recovery (Issue #259).
 *
 * Only runs on a genuine bootstrap: no local session AND the client already
 * holds the backend API_SECRET (so it can authenticate). It NEVER overwrites an
 * existing local session — existing users' credentials and data are untouched.
 *
 * Bootstrap guard: the caller must have configured backendApiSecret once in
 * this browser (BackendPanel). With that, the backend hands back the GitHub
 * token it stores, and we re-validate it against the GitHub API before logging in.
 */
export async function tryRestoreAuthFromBackend(): Promise<boolean> {
  if (!backend.isAvailable || _isRestoringAuth) return false;

  const state = useAppStore.getState();

  // Never clobber an existing session (single-account safety guard).
  if (state.user && state.githubToken) return false;

  // Without an authenticated backend we have nothing to restore from.
  if (!state.backendApiSecret) return false;

  _isRestoringAuth = true;
  try {
    const restored = await backend.restoreAuth();
    if (!restored?.github_token) return false;

    // Re-check right before applying: the user may have logged in meanwhile.
    const latest = useAppStore.getState();
    if (latest.user || latest.githubToken) return false;

    const githubApi = new GitHubApiService(restored.github_token);
    const user = await githubApi.getCurrentUser();

    useAppStore.getState().setGitHubToken(restored.github_token);
    useAppStore.getState().setUser(user);
    logger.info('sync.restoreAuth', 'Restored session from backend', { login: user.login });
    return true;
  } catch (err) {
    logger.warn('sync.restoreAuth', 'Failed to restore session from backend', { error: err instanceof Error ? err.message : String(err) });
    return false;
  } finally {
    _isRestoringAuth = false;
  }
}

/**
 * Repair the backend copy of an already authenticated local GitHub token.
 *
 * Lists GraphQL requests use the backend proxy, which reads the encrypted token
 * from backend settings instead of receiving the frontend token. Existing local
 * sessions can therefore have a working token while the backend copy is absent
 * (for example, when the backend was enabled after login or a previous settings
 * sync failed). Keep this repair separate from session restoration so it never
 * overwrites the local account with backend auth data.
 */
export async function syncLocalGitHubTokenToBackend(): Promise<boolean> {
  if (!backend.isAvailable) return false;

  const { githubToken } = useAppStore.getState();
  if (!githubToken) return false;

  try {
    await backend.syncSettings({ github_token: githubToken });
    logger.info('sync.githubToken', 'Synchronized local GitHub token to backend');
    return true;
  } catch (err) {
    logger.warn('sync.githubToken', 'Failed to synchronize local GitHub token to backend', {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
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
    const [reposResult, releasesResult, aiResult, webdavResult, embeddingResult, vectorSearchResult, settingsResult] = await Promise.allSettled([
      backend.fetchRepositories(),
      backend.fetchReleases(),
      backend.fetchAIConfigs(),
      backend.fetchWebDAVConfigs(),
      backend.fetchEmbeddingConfigs(),
      backend.fetchVectorSearchConfig(),
      backend.fetchSettings(),
    ]);

    const changed = { repos: false, releases: false, ai: false, webdav: false, embedding: false, vectorSearch: false, settings: false };

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
      const hash = vectorSearchFingerprint(vectorSearchResult.value);
      if (hash !== _lastHash.vectorSearch) {
        changed.vectorSearch = true;
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
      const localConfig = state.vectorSearchConfig;
      // Bootstrap guard (mirrors repositories): a fresh/empty backend must not
      // wipe a locally-configured vector search — keep local and push it up.
      if (shouldPreserveLocalVectorSearch(backendConfig, localConfig, _lastHash.vectorSearch === '')) {
        _hasPendingPush = true;
      } else {
        // Preserve local authToken if backend returned empty or decrypt_failed,
        // and queue a repair push so the backend is re-synced with it. Without
        // the push the preserved token stays local-only and the poll loop keeps
        // re-detecting the backend/effective fingerprint mismatch.
        if (shouldQueueVectorSearchRepairPush(backendConfig, localConfig)) {
          logger.warn('sync.decryptFailed', 'Backend decrypt_failed for vector search authToken, preserving local value');
          backendConfig.authToken = localConfig.authToken;
          _hasPendingPush = true;
        }
        state.setVectorSearchConfig(backendConfig);
        // Fingerprint the effective store config (after merge/normalization) so it
        // matches the push fingerprint in syncToBackend(); hashing the raw backend
        // payload instead would leave the two sides forever unequal.
        _lastHash.vectorSearch = vectorSearchFingerprint(useAppStore.getState().vectorSearchConfig);
      }
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
    const [reposSync, releasesSync, aiSync, webdavSync, embeddingSync, vectorSearchSync, settingsSync] = results;

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
    if (vectorSearchSync.status === 'fulfilled') _lastHash.vectorSearch = vectorSearchFingerprint(state.vectorSearchConfig);
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
