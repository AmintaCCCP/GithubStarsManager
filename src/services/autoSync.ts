import { backend, isValidBackendRestoreAccount } from './backendAdapter';
import { useAppStore } from '../store/useAppStore';
import { mergeRepositoriesPreservingLocalMetadata, stripLocalRepositoryFields } from '../utils/repositoryMerge';
import { normalizeAssetFilters } from '../utils/assetFilters';
import { createGitHubApiService } from './githubApiFactory';
import { logger } from './logger';
import type { Repository } from '../types';

// Prevent sync loops: when we pull data FROM backend and update store,
// the store subscription would trigger a push TO backend. This flag blocks that.
let _isSyncingFromBackend = false;
let _isSyncingFromBackendActive = false;

// Account switch guard (Issue #611): while switching accounts the store
// workspace changes (repositories reference swap etc.) must NOT be mistaken
// for local edits and pushed under the new account's partition.
let _isSwitchingAccount = false;

// 切换簿记标记（Issue #611 审计修复）：withAccountSwitchGuardSync 覆盖的
// 同步工作区替换（switchAccount / logout / park）属于切换簿记；异步守卫
// 覆盖窗口内的其余 store 变化才是对齐窗口里的真实用户编辑。订阅器据此区分
// 「簿记不记录」与「窗口内编辑必须记为待推」，否则对齐窗口内的
// categoryOrder 编辑会被静默丢弃（数据丢失）。
let _isAccountSwitchBookkeeping = false;

/**
 * Wrap an account switch sequence so the Store subscription treats all state
 * changes inside as switch bookkeeping, not as local edits to push.
 * Saves and restores the previous flag so nesting stays safe, and drains the
 * pending edits recorded inside the window right after releasing it so the
 * alignment-window edits are pushed under the (now active) account's header.
 */
export async function withAccountSwitchGuard<T>(fn: () => Promise<T>): Promise<T> {
  const previous = _isSwitchingAccount;
  const previousBookkeeping = _isAccountSwitchBookkeeping;
  _isSwitchingAccount = true;
  try {
    return await fn();
  } finally {
    _isSwitchingAccount = previous;
    _isAccountSwitchBookkeeping = previousBookkeeping;
    // 对齐窗口内被静音的用户编辑：守卫释放后立即补推，绝不能静默丢弃。
    //（拉取应用阶段写入的 _hasPendingPush 已由 syncFromBackend 的 finally 排空，
    // 这里只需处理订阅器记录的窗口内本地编辑。）
    if (_hasPendingLocalChanges && !_isSyncingFromBackendActive) {
      void syncToBackend();
    }
  }
}

/**
 * Synchronous variant for store actions that swap workspaces inside a single
 * `set()` (switchAccount / logout / parkCurrentAccountForRestore). Saves and
 * restores the previous flag so nesting inside the async guard stays safe.
 * Without it the workspace swap fires the subscription and schedules an
 * isFullSync push of the stale snapshot under the NEXT account's header.
 */
export function withAccountSwitchGuardSync<T>(fn: () => T): T {
  const previous = _isSwitchingAccount;
  const previousBookkeeping = _isAccountSwitchBookkeeping;
  _isSwitchingAccount = true;
  _isAccountSwitchBookkeeping = true;
  try {
    return fn();
  } finally {
    _isSwitchingAccount = previous;
    _isAccountSwitchBookkeeping = previousBookkeeping;
  }
}

/**
 * Cancel a scheduled debounced push and clear pending flags (Issue #611).
 * Account switches / logout / park replace the whole workspace: pending-push
 * semantics from the old session must never fire afterwards, or the 2s
 * isFullSync push would write the stale (possibly empty) snapshot into the
 * wrong backend partition under the new (or absent) account header.
 */
export function cancelPendingAccountSwitchPush(): void {
  if (_debounceTimer) {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
  }
  _hasPendingLocalChanges = false;
  _hasPendingPush = false;
}

// Track store subscription for cleanup on restart
let _storeUnsubscribe: (() => void) | null = null;

// Prevent overlapping pushes to backend
let _isPushingToBackend = false;
let _pushPromise: Promise<boolean> | null = null;
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

// Track the current sync-from-backend promise so force sync can wait
let _syncPromise: Promise<void> | null = null;

/**
 * Wait for any current syncFromBackend pull to finish.
 */
export async function waitForInFlightSync(): Promise<void> {
  while (_syncPromise) {
    try {
      await _syncPromise;
    } catch {
      // swallow error so waiting callers continue
    }
  }
}

const SWITCH_FLUSH_MAX_ATTEMPTS = 3;

// 账号级未同步状态（Issue #611 审计修复）：切换前冲刷失败时，旧账号的未推
// 修改保留在其本地工作区，并记录到该集合。模块级待推标志是会话全局状态，
// 绝不能带进新账号会话；切回该账号时由 consumePendingAccountSync 消费，
// 先补推本地工作区再拉取后端，防止非强制拉取用后端旧快照覆盖未推修改。
const _pendingSyncAccounts = new Set<string>();

/**
 * 是否存在指定账号尚未补推的本地修改（冲刷失败遗留）。
 */
export function hasPendingAccountSync(accountId: string | null | undefined): boolean {
  return !!accountId && _pendingSyncAccounts.has(accountId);
}

/**
 * 消费指定账号的未同步标记：切回该账号并完成补推协调前调用。
 * 返回是否存在遗留待推状态（存在则调用方必须先 syncToBackend 再拉取）。
 */
export function consumePendingAccountSync(accountId: string | null | undefined): boolean {
  if (!accountId || !_pendingSyncAccounts.has(accountId)) return false;
  _pendingSyncAccounts.delete(accountId);
  return true;
}

/**
 * 账号切换前置冲刷（Issue #611，解决 R3/R4 的推送半程）：
 * 在旧账号上下文（请求头仍是 previousAccountId）下把未决的防抖推送全部
 * 落入后端旧账号分区，再等待在途拉取与在途推送结束。冲刷必须排空推送通道——
 * `waitForInFlightSync()` 只等待拉取 `_syncPromise`；拉取的 finally 可能
 * 启动新的 `syncToBackend()`，所以排空之后还要继续等待推送通道排空。
 *
 * 冲刷失败语义（审计修复）：不再无条件清除待推标志后继续切换——失败时把
 * 未推修改按账号记录（_pendingSyncAccounts），切回该账号后先补推再拉取；
 * 模块级标志仍统一清零，旧账号的待推语义绝不带进新账号会话。
 */
export async function prepareForAccountSwitch(previousAccountId?: string | null): Promise<void> {
  // previousAccountId 保留在签名中以表达「冲刷发生在旧账号上下文」的语义；
  // 请求头由 Store 当前登录用户自动推导，无需在此显式传递。
  void previousAccountId;
  if (_debounceTimer) {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
  }
  if (backend.isAvailable) {
    let attempts = 0;
    while ((_hasPendingLocalChanges || _pushPromise) && attempts < SWITCH_FLUSH_MAX_ATTEMPTS) {
      attempts += 1;
      try {
        await syncToBackend();
      } catch (err) {
        logger.warn('sync.switch', 'Flush attempt failed before account switch', {
          error: err instanceof Error ? err.message : String(err),
          attempt: attempts,
        });
        break;
      }
    }
  }
  // 等待在途拉取结束，避免旧账号的拉取结果写进新账号的活跃工作区
  await waitForInFlightSync();
  // 拉取的 finally 可能启动了新的推送（旧账号上下文）：继续排空推送通道，
  // 直到旧账号的拉取与推送回调都不会再修改新会话的同步状态
  while (_pushPromise) {
    try {
      await _pushPromise;
    } catch {
      // 冲刷失败语义由待推标志承载，等待方继续排空
    }
  }
  // 排空完成后残留的待推标志 = 冲刷未完成：按账号保留未同步状态，
  // 模块级标志仍统一清零（绝不把旧账号的待推语义带进新账号会话）
  if (_hasPendingLocalChanges) {
    if (previousAccountId) {
      _pendingSyncAccounts.add(previousAccountId);
    }
    logger.warn('sync.switch', 'Backend flush incomplete before account switch; pending edits stay bound to the previous account partition', {
      accountId: previousAccountId ?? null,
      pendingLocalChanges: _hasPendingLocalChanges,
    });
  } else if (previousAccountId) {
    _pendingSyncAccounts.delete(previousAccountId);
  }
  _hasPendingPush = false;
  _hasPendingLocalChanges = false;
  if (_debounceTimer) {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
  }
}

// Drain and clean up any in-flight sync before switching backend URL.
// The hook must drain the PUSH channel too: a push still in flight for the
// old backend URL must complete before `backend.init()` commits the new URL,
// otherwise a follow-up push would send the old account's data to the new
// backend (headers are read from the store at request construction time).
if (typeof backend.registerBeforeInitHook === 'function') {
  backend.registerBeforeInitHook(async () => {
    await waitForInFlightSync();
    while (_pushPromise) {
      try {
        await _pushPromise;
      } catch {
        // swallow so init can proceed
      }
    }
    _hasPendingPush = false;
    _hasPendingLocalChanges = false;
    if (_debounceTimer) {
      clearTimeout(_debounceTimer);
      _debounceTimer = null;
    }
  });
}

/**
 * Reset all sync fingerprints. Must be called on logout so that the next
 * force sync (e.g. backend login restore) applies every shard regardless of
 * whether the backend data has changed since the last session.
 */
export function resetSyncHashes(): void {
  _lastHash.repos = '';
  _lastHash.releases = '';
  _lastHash.ai = '';
  _lastHash.webdav = '';
  _lastHash.embedding = '';
  _lastHash.vectorSearch = '';
  _lastHash.settings = '';
}

function quickHash(data: unknown): string {
  return JSON.stringify(data);
}

/**
 * The repository endpoint does not round-trip client-only fields. Keep them
 * out of sync fingerprints while still sending the unchanged store value.
 * Uses the same field set as stripLocalRepositoryFields so the pull and push
 * fingerprints always project the identical shape (Issue #304 loop-breaker).
 */
export function repositoryPayloadHash(repositories: Repository[]): string {
  return quickHash(stripLocalRepositoryFields(repositories));
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

    // 直连校验待恢复的 token 本身再采纳其身份；走代理时服务端用的是库里
    // 当前 token，校验的就不是即将写入本地的这份凭据了。
    const githubApi = createGitHubApiService(restored.github_token, { direct: true });
    const user = await githubApi.getCurrentUser();

    useAppStore.getState().setGitHubToken(restored.github_token);
    useAppStore.getState().setUser(user);
    // 多账号恢复（Issue #611）：后端保存的所有账号一次性登记进 savedAccounts，
    // 让登录页/下拉菜单能直接列出并一键切换。仅接受带有效 Token 与合法 user 的条目
    //（过滤规则与登录页 handleBackendConnect / addAccountFromBackend 共用同一校验函数）。
    if (Array.isArray(restored.accounts)) {
      const { upsertSavedAccount } = useAppStore.getState();
      for (const account of restored.accounts) {
        if (!isValidBackendRestoreAccount(account)) continue;
        upsertSavedAccount(account.user, account.githubToken);
      }
    }
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
const LOCAL_TOKEN_SYNC_TIMEOUT_MS = 5000;

export async function syncLocalGitHubTokenToBackend(
  timeoutMs = LOCAL_TOKEN_SYNC_TIMEOUT_MS,
): Promise<boolean> {
  if (!backend.isAvailable) return false;

  const { githubToken } = useAppStore.getState();
  if (!githubToken) return false;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    await backend.syncSettings({ github_token: githubToken }, controller.signal);
    logger.info('sync.githubToken', 'Synchronized local GitHub token to backend');
    return true;
  } catch (err) {
    logger.warn('sync.githubToken', 'Failed to synchronize local GitHub token to backend', {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Pull all data from backend and update local store.
 * Backend-first strategy: backend data overwrites local data.
 * Silent: errors logged to console only.
 */
export async function syncFromBackend(options: { force?: boolean } = {}): Promise<void> {
  if (!backend.isAvailable) return;
  if (!options.force && (
    _isSyncingFromBackendActive ||
    _isPushingToBackend ||
    _hasPendingLocalChanges ||
    _debounceTimer
  )) {
    return;
  }
  if (options.force) {
    if (_debounceTimer) {
      clearTimeout(_debounceTimer);
      _debounceTimer = null;
    }
    _hasPendingLocalChanges = false;
    _hasPendingPush = false;
    // Wait for any in-flight pull to finish before starting a forced one,
    // so the old pull's results are fully committed and we don't race.
    await waitForInFlightSync();
    // Reset fingerprints so every shard is applied regardless of prior hash.
    resetSyncHashes();
  }
  if (_isSyncingFromBackendActive) return;

  _isSyncingFromBackendActive = true;

  const doSync = async () => {
  const startTime = Date.now();
  try {
    const repositoriesBeforeFetch = useAppStore.getState().repositories;
    const [reposResult, releasesResult, aiResult, webdavResult, embeddingResult, vectorSearchResult, settingsResult] = await Promise.allSettled([
      backend.fetchRepositories(),
      backend.fetchReleases(),
      backend.fetchAIConfigs(),
      backend.fetchWebDAVConfigs(),
      backend.fetchEmbeddingConfigs(),
      backend.fetchVectorSearchConfig(),
      backend.fetchSettings(),
    ]);

    // Local edits made during the fetch must be pushed before applying the
    // stale snapshot. The fetched repositories still matter: the queued full
    // push would otherwise delete remotely arrived repositories missing from
    // its request, so merge those into the store first. A fetched repository
    // counts as arrived only when it was absent before the pull started —
    // otherwise it was deleted locally during the fetch and must stay
    // deleted — and is still absent from the store now.
    if (_hasPendingLocalChanges) {
      if (reposResult.status === 'fulfilled') {
        const repositoriesNow = useAppStore.getState().repositories;
        const knownBeforeFetch = new Set(repositoriesBeforeFetch.map(repo => repo.id));
        const knownNow = new Set(repositoriesNow.map(repo => repo.id));
        const arrivedRemotely = reposResult.value.repositories.filter(repo =>
          !knownBeforeFetch.has(repo.id) && !knownNow.has(repo.id)
        );
        if (arrivedRemotely.length > 0) {
          useAppStore.getState().setRepositories([...repositoriesNow, ...arrivedRemotely]);
        }
        // A completed fetch — an empty list included — proves the store is
        // complete against the server, so its queued push is safe to drain.
        _hasPendingPush = true;
      }
      // A failed repositories fetch leaves the remote state unknown: the pull
      // must not trigger a push of an unverified list, which would delete
      // remotely arrived repositories. Pending local edits still sync through
      // their own change-driven push once the backend is reachable.
      return;
    }

    const changed = {
      repos: false, releases: false, ai: false, webdav: false,
      embedding: false, vectorSearch: false, settings: false,
    };

    // Compute hashes for each slice — only mark changed if hash differs
    const hashes: Record<string, string> = {};
    if (reposResult.status === 'fulfilled') {
      const hash = repositoryPayloadHash(reposResult.value.repositories);
      if (options.force || hash !== _lastHash.repos) {
        hashes.repos = hash;
        changed.repos = true;
      }
    }

    if (releasesResult.status === 'fulfilled') {
      const hash = quickHash(releasesResult.value.releases);
      if (options.force || hash !== _lastHash.releases) {
        hashes.releases = hash;
        changed.releases = true;
      }
    }

    if (aiResult.status === 'fulfilled') {
      const hash = quickHash(aiResult.value);
      if (options.force || hash !== _lastHash.ai) {
        hashes.ai = hash;
        changed.ai = true;
      }
    }

    if (webdavResult.status === 'fulfilled') {
      const hash = quickHash(webdavResult.value);
      if (options.force || hash !== _lastHash.webdav) {
        hashes.webdav = hash;
        changed.webdav = true;
      }
    }

    if (embeddingResult.status === 'fulfilled') {
      const hash = quickHash(embeddingResult.value);
      if (options.force || hash !== _lastHash.embedding) {
        hashes.embedding = hash;
        changed.embedding = true;
      }
    }

    if (vectorSearchResult.status === 'fulfilled') {
      const hash = vectorSearchFingerprint(vectorSearchResult.value);
      if (options.force || hash !== _lastHash.vectorSearch) {
        changed.vectorSearch = true;
      }
    }

    if (settingsResult.status === 'fulfilled') {
      const hash = quickHash(settingsResult.value);
      if (options.force || hash !== _lastHash.settings) {
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
      // Empty backend payloads never wipe local analysis during background
      // polling. A forced login restore must apply the backend copy, including
      // an empty list, because the user explicitly asked to restore from it.
      if (!options.force && backendRepos.length === 0 && localRepos.length > 0) {
        _hasPendingPush = true;
      } else {
        const merged = options.force
          ? backendRepos
          : mergeRepositoriesPreservingLocalMetadata(backendRepos, localRepos);
        state.setRepositories(merged, options.force ? { allowEmpty: true } : undefined);
        // Commit the RAW backend hash, not the merged one. The merge preserves
        // local-only metadata (e.g. vector_indexed_at) the backend never stores,
        // so hashing `merged` here made the next poll's backend hash differ
        // forever — re-applying setRepositories every poll cycle.
        _lastHash.repos = hashes.repos;
      }
    }
    if (changed.releases && releasesResult.status === 'fulfilled') {
      const backendReleases = releasesResult.value.releases;
      if (!options.force && backendReleases.length === 0 && state.releases.length > 0) {
        _hasPendingPush = true;
      } else {
        state.setReleases(backendReleases, options.force ? { allowEmpty: true } : undefined);
        _lastHash.releases = hashes.releases;
      }
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
        useAppStore.setState({ assetFilters: normalizeAssetFilters(settings.assetFilters) });
      }
      if (
        settings.defaultCategoryOverrides !== null
        && typeof settings.defaultCategoryOverrides === 'object'
        && !Array.isArray(settings.defaultCategoryOverrides)
      ) {
        useAppStore.setState({
          defaultCategoryOverrides: settings.defaultCategoryOverrides as typeof state.defaultCategoryOverrides,
        });
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
  }; // end doSync

  const currentPromise = doSync();
  _syncPromise = currentPromise;
  try {
    await currentPromise;
  } finally {
    if (_syncPromise === currentPromise) {
      _syncPromise = null;
    }
  }
}

/**
 * Push current local state to backend.
 * Silent: errors are logged and reported as false, not thrown.
 * Queued callers wait for a push containing the latest local state.
 */
export async function syncToBackend(): Promise<boolean> {
  if (!backend.isAvailable) return true;
  if (_isSyncingFromBackendActive) {
    _hasPendingPush = true;
    await waitForInFlightSync();
    return syncToBackend();
  }
  if (_pushPromise) {
    _hasPendingPush = true;
    return _pushPromise;
  }

  const pushLatest = async (): Promise<boolean> => {
    let succeeded = await pushToBackend();
    // Requests and edits arriving after the snapshot need a fresh push.
    // Failed writes stay pending for retry without an automatic retry loop.
    while (_hasPendingPush || (succeeded && _hasPendingLocalChanges)) {
      succeeded = await pushToBackend();
    }
    return succeeded;
  };
  const currentPromise = pushLatest();
  _pushPromise = currentPromise;
  try {
    return await currentPromise;
  } finally {
    if (_pushPromise === currentPromise) _pushPromise = null;
  }
}

/**
 * Push one snapshot of the current store slices to the backend.
 * Reports per-slice write failures through the returned flag instead of
 * throwing; local edits made while the snapshot is in flight stay pending
 * for the next push.
 */
async function pushToBackend(): Promise<boolean> {
  _isPushingToBackend = true;
  _hasPendingPush = false;
  _hasPendingLocalChanges = false;
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
        defaultCategoryOverrides: state.defaultCategoryOverrides,
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
    }

    // Only update _lastHash for successfully synced slices.
    // Hash the raw pushed payload (local-only fields like vector_indexed_at are
    // never stored by the backend), so the next pull compares against the same
    // projection and doesn't re-apply setRepositories after a push.
    if (reposSync.status === 'fulfilled') _lastHash.repos = quickHash(stripLocalRepositoryFields(state.repositories));
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
        defaultCategoryOverrides: state.defaultCategoryOverrides,
        releaseSourceSettings: state.releaseSourceSettings,
        collapsedSidebarCategoryCount: state.collapsedSidebarCategoryCount,
      });
    }
    return failures.length === 0;
  } catch (err) {
    logger.errorFromError('sync.pushToBackend', 'Failed to sync to backend', err, { durationMs: Date.now() - pushStartTime });
    _hasPendingLocalChanges = true;
    return false;
  } finally {
    setRepositorySyncVisualState(false);
    _isPushingToBackend = false;
  }
}

/**
 * Immediately push current local state to backend.
 * Used for destructive/high-priority operations such as unstar/delete.
 * Silent by default: failures are logged and left pending for the next push,
 * the contract every pre-existing caller was written against. Pass
 * `reportFailures` to reject instead, so a caller can surface an explicit
 * synchronization warning (e.g. the batch star import dialog).
 */
export async function forceSyncToBackend(options: { reportFailures?: boolean } = {}): Promise<void> {
  if (_debounceTimer) {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
  }
  _hasPendingLocalChanges = true;
  if (!await syncToBackend() && options.reportFailures) {
    throw new Error('Failed to sync to backend');
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
  // Reset in-flight state flags to prevent permanent sync blocking,
  // but preserve pull activity if an actual pull Promise is currently executing.
  if (!_syncPromise) {
    _isSyncingFromBackend = false;
    _isSyncingFromBackendActive = false;
  }
  _isPushingToBackend = false;
  _hasPendingPush = false;
  _hasPendingLocalChanges = false;
  // 1. Subscribe to local changes → push to backend (2s debounce)
  const unsubscribe = useAppStore.subscribe((state, prevState) => {
    if (_isSyncingFromBackend || _isSwitchingAccount) {
      // 切换守卫窗口内的真实用户编辑（如对齐拉取期间调整 categoryOrder）不能
      // 静默丢弃：记为待推，守卫释放后立即补推。切换簿记（guardSync 覆盖的
      // 工作区替换）与拉取应用阶段（_isSyncingFromBackend）的变化不记录。
      if (_isSwitchingAccount && !_isSyncingFromBackend && !_isAccountSwitchBookkeeping) {
        _hasPendingLocalChanges = true;
      }
      return;
    }

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
      state.defaultCategoryOverrides !== prevState.defaultCategoryOverrides ||
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
    // 切换期间拉取由 switchToAccount 编排，轮询暂停避免半程拉取串号
    if (_isSwitchingAccount) return;
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
  // Reset in-flight state flags, preserving active pull if running
  _isPushingToBackend = false;
  if (!_syncPromise) {
    _isSyncingFromBackendActive = false;
    _isSyncingFromBackend = false;
  }
  _hasPendingPush = false;
  _hasPendingLocalChanges = false;
  logger.info('sync.stop', 'Auto-sync stopped');
}
