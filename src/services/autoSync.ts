import { backend, isValidBackendRestoreAccount } from './backendAdapter';
import { useAppStore } from '../store/useAppStore';
import { accountIdKey } from '../store/helpers/accountWorkspace';
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

// 冻结窗口标记（R4 审计修复）：withAccountSwitchFrozen 覆盖的候选后端恢复
// 窗口内，连接可能指向候选后端——真实编辑不得走会话级待推通道（守卫退出
// 会立即推送），改记入窗口缓冲按归属账号归档。
let _isAccountSwitchFrozen = false;

// 冻结窗口内的真实编辑缓冲（R4 审计修复）：记录编辑发生时的活跃账号
// （GitHub 数值 ID 字符串）。窗口退出时按恢复结果分流：恢复失败（回滚原
// 后端）→ 调用方在复原连接后立即补推；恢复成功（切到新后端）→ 并入
// _pendingSyncAccounts，下次进入该账号先补推再拉取。窗口内绝不推送。
let _frozenWindowEditAccounts = new Set<string>();

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
    // R5 审计修复（发现1）：本地真空且后端分区未观察时，pushToBackend 会
    // 拒绝空列表 isFullSync 推送并保留待推标记——编辑交给放行后的对齐拉取
    // 合并流程补推，而不是以空快照覆盖目标账号分区。
    if (_hasPendingLocalChanges && !_isSyncingFromBackendActive) {
      void syncToBackend();
    }
  }
}

/**
 * Frozen variant for windows where the backend connection itself is in flux
 * (candidate backend init / auth restore for addAccountFromBackend). Holds the
 * switch guard for the whole window, so edits made while the connection may
 * point at the candidate backend are never flushed at guard exit — pushing the
 * (not yet archived) old account's workspace, or an empty one, at the candidate
 * backend would clobber that backend's account partitions.
 *
 * R4 审计修复——窗口内的真实编辑不再被静默丢弃，也不再用全程簿记标记压制：
 * guardSync 覆盖的簿记写入（工作区替换、身份提交）仍由其自带标记抑制；
 * 窗口内其余 store 写入视为真实用户编辑，记入窗口缓冲（
 * _frozenWindowEditAccounts，按编辑时的活跃账号归属）。窗口退出时把缓冲
 * 并入 _pendingSyncAccounts（不在此处推送——连接此刻可能仍指向候选后端）：
 * - 恢复成功（已切到新后端）：标记保留，下次进入该账号先补推再拉取；
 * - 恢复失败（回滚原后端）：调用方在复原连接后按 hasPendingAccountSync
 *   立即补推到原后端的正确分区。
 * 无真实编辑时缓冲为空、零标记，整个窗口保持零推送。
 */
export async function withAccountSwitchFrozen<T>(fn: () => Promise<T>): Promise<T> {
  const previousSwitching = _isSwitchingAccount;
  const previousBookkeeping = _isAccountSwitchBookkeeping;
  const previousFrozen = _isAccountSwitchFrozen;
  const previousBuffer = _frozenWindowEditAccounts;
  // 嵌套窗口共享最外层缓冲：只有最外层窗口退出时做缓冲分流
  const isOutermostWindow = !previousFrozen;
  _isSwitchingAccount = true;
  _isAccountSwitchFrozen = true;
  // 冻结窗口内不再全程置簿记标记：guardSync 覆盖的簿记写入自带标记并自行
  // 恢复；窗口内其余写入由此被订阅器视为真实编辑进入窗口缓冲
  _isAccountSwitchBookkeeping = false;
  if (isOutermostWindow) {
    _frozenWindowEditAccounts = new Set();
  }
  try {
    return await fn();
  } finally {
    _isSwitchingAccount = previousSwitching;
    _isAccountSwitchBookkeeping = previousBookkeeping;
    _isAccountSwitchFrozen = previousFrozen;
    if (isOutermostWindow) {
      const bufferedAccounts = _frozenWindowEditAccounts;
      _frozenWindowEditAccounts = previousBuffer;
      for (const accountId of bufferedAccounts) {
        markPendingAccountSync(accountId);
      }
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
    // R5 审计修复（发现1）：簿记写入完成后重新观察本地仓库列表。切换换入的
    // 工作区若自带非空仓库快照，该账号立即获得空推送豁免（推的是该账号自己的
    // 完整数据）；真空会话保持受限，直到对齐拉取观察过后端分区。
    // 测试桩兼容：单元测试可能把 store 模块整体 mock 成无 getState 的选择器
    // 函数（与 accountIdKey/peekCurrentAccountId 的放行语义一致），此时跳过
    // 观察，保持旧测试契约。
    try {
      const store = useAppStore as unknown as { getState?: () => { user: Parameters<typeof accountIdKey>[0]; repositories: unknown[] } };
      if (typeof store.getState === 'function') {
        const swapped = store.getState();
        if (Array.isArray(swapped.repositories) && swapped.repositories.length > 0) {
          markAccountSeenNonEmptyRepos(accountIdKey(swapped.user));
        }
      }
    } catch {
      // 桩环境观察失败不阻断簿记流程
    }
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

// 账号对齐观察集（R5 审计修复，CodeRabbit 发现 1）：服务端 PUT /repositories
// 以 isFullSync:true 收到空列表时会物理删除该账号分区的全部仓库与 release。
// 切换到本地无快照的账号（本地真空）时列表为空，而后端分区可能已有其他设备
// 写入的数据——对齐窗口内的任何空列表全量推送都是致命覆盖。
//
// 两个集合记录「当前对齐会话」（自最近一次 resetSyncHashes 起的工作区会话）
// 内按账号累积的观察事实，用于区分两种语义：
// - 本地真空 + 后端事实未知（两个集合都没有该账号）→ 空列表推送必须拒绝，
//   待对齐拉取合并后端数据后再由正常流程补推（待推编辑保留）；
// - 本地列表曾非空（用户真的清空了所有仓库）或后端分区已被成功拉取观察过
//   → 空列表推送代表本地真实状态，照常放行。
// 集合随 resetSyncHashes 清零：logout / 切换 / 归档开启新对齐会话时，
// 新活跃账号必须重新取得豁免，绝不能继承上一会话的观察结论。
const _accountsSeenNonEmptyRepos = new Set<string>();
const _accountsObservedBackendRepos = new Set<string>();
// 上次成功推送的仓库 ID 基线（按账号、跨重启持久化）：对账时据此区分
// 「本地显式删除」与「远端新增」，绝不把用户删除过的仓库合并回来。
// 键含后端 URL：X 上的基线不能用来推断 Y 上「被删除」的仓库。
// shortcut: 升级前只有账号键的旧基线不匹配，首次对账按「无基线」多拉一次远端；下次成功推送即重建。
const PUSHED_REPO_IDS_KEY = 'gsm.pushedRepoIds';

const loadPushedRepoIds = (): Map<string, Set<number>> => {
  try {
    const raw = localStorage.getItem(PUSHED_REPO_IDS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    const result = new Map<string, Set<number>>();
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [accountId, ids] of Object.entries(parsed as Record<string, unknown>)) {
        if (!Array.isArray(ids)) continue;
        result.set(accountId, new Set(ids.filter((id): id is number => Number.isInteger(id))));
      }
    }
    return result;
  } catch {
    return new Map();
  }
};

const persistPushedRepoIds = (): void => {
  try {
    localStorage.setItem(
      PUSHED_REPO_IDS_KEY,
      JSON.stringify(Object.fromEntries([..._lastPushedRepoIds].map(([id, ids]) => [id, [...ids]]))),
    );
  } catch {
    // 存储不可用时退化为会话内基线
  }
};

const _lastPushedRepoIds = loadPushedRepoIds();

/** 基线键：同一账号在不同后端上的分区是不同数据，必须分别记录。 */
function pushedRepoBaselineKey(accountId: string): string | null {
  const backendUrl = backend.backendUrl ?? '';
  // 无后端上下文（本地模式/未连接）时没有可证明的推送基线。
  return backendUrl ? `${backendUrl}|${accountId}` : null;
}

// 推送失败后的退避重试（只在账号仍匹配时重试一次链）。
let _pushRetryTimer: ReturnType<typeof setTimeout> | null = null;
let _pushRetryDelay = 2000;
const PUSH_RETRY_MAX_DELAY = 60_000;

/** 记录某账号在本对齐会话内本地仓库列表曾非空（空列表全量推送豁免依据）。 */
function markAccountSeenNonEmptyRepos(accountId: string | null | undefined): void {
  if (!accountId) return;
  _accountsSeenNonEmptyRepos.add(accountId);
}

/** 记录某账号在本对齐会话内已完成一次成功的后端仓库拉取（分区事实已观察）。 */
function markAccountBackendReposObserved(accountId: string | null | undefined): void {
  if (!accountId) return;
  _accountsObservedBackendRepos.add(accountId);
}

/**
 * 当前状态下是否允许推送空仓库快照（isFullSync）。
 * 列表非空时恒真（推的不是空快照）；列表为空时仅在以下情形放行：
 * - 本会话内该账号的本地列表曾非空（用户主动清空全部仓库）；
 * - 本会话内已成功拉取过该账号的后端仓库（分区事实已被观察）。
 * 无活跃账号上下文（user 为 null，请求头缺失、服务端回退 active_account_id
 * 分区）时一律拒绝——空快照写错分区比不推送更危险。
 */
function canPushEmptyRepositorySnapshot(): boolean {
  const state = useAppStore.getState();
  if (state.repositories.length > 0) return true;
  const accountId = accountIdKey(state.user);
  if (!accountId) return false;
  return _accountsSeenNonEmptyRepos.has(accountId) || _accountsObservedBackendRepos.has(accountId);
}

/**
 * 当前是否处于「本地真空且后端事实未知」的未对齐会话。
 * 仅用于放宽非强制拉取的待推早退：此状态下待推保护（跳过拉取防止陈旧快照
 * 覆盖未推修改）会让对齐拉取永远无法发生，空列表推送又已被拒绝——死锁。
 * 放行后拉取走「待推合并」分支（autoSync.doSync 内 _hasPendingLocalChanges
 * 分支）：只把后端新到仓库并入本地、绝不覆盖本地数据，随后排空待推队列。
 * 无活跃账号时返回 false（放宽会让无账号头请求合并错误分区）。
 */
function isUnalignedVacuumAccountSession(): boolean {
  const state = useAppStore.getState();
  if (state.repositories.length !== 0) return false;
  const accountId = accountIdKey(state.user);
  if (!accountId) return false;
  return !_accountsSeenNonEmptyRepos.has(accountId) && !_accountsObservedBackendRepos.has(accountId);
}

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
// 该集合必须跨重启保留（审计修复）：离线编辑后切走、重启再切回时，内存标记
// 丢失会让普通拉取直接用后端旧快照覆盖未同步修改。
const PENDING_SYNC_ACCOUNTS_KEY = 'gsm.pendingSyncAccounts';

// 值 = 产生待推状态的后端 URL（'' 表示旧版记录/未知）。待推修改只属于
// 原后端：切到不同后端时绝不能把原工作区推过去。
const loadPendingSyncAccounts = (): Map<string, string> => {
  try {
    const raw = localStorage.getItem(PENDING_SYNC_ACCOUNTS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    const entries = new Map<string, string>();
    if (!Array.isArray(parsed)) return entries;
    for (const item of parsed) {
      if (typeof item === 'string') entries.set(item, '');
      else if (Array.isArray(item) && typeof item[0] === 'string') {
        entries.set(item[0], typeof item[1] === 'string' ? item[1] : '');
      }
    }
    return entries;
  } catch {
    return new Map();
  }
};

const persistPendingSyncAccounts = (): void => {
  try {
    localStorage.setItem(PENDING_SYNC_ACCOUNTS_KEY, JSON.stringify([..._pendingSyncAccounts]));
  } catch {
    // 存储不可用（隐私模式/配额）时退化为会话内标记
  }
};

const _pendingSyncAccounts = loadPendingSyncAccounts();

/** 记录账号级待推状态（补推成功前必须保留，跨重启持久化）。 */
export function markPendingAccountSync(accountId: string): void {
  const backendUrl = backend.backendUrl ?? '';
  if (_pendingSyncAccounts.get(accountId) === backendUrl) return;
  _pendingSyncAccounts.set(accountId, backendUrl);
  persistPendingSyncAccounts();
}

/** 补推确认成功后清除账号级待推标记（失败时保留，重启后仍会补推）。 */
export function clearPendingAccountSync(accountId: string | null | undefined): void {
  if (!accountId || !_pendingSyncAccounts.delete(accountId)) return;
  persistPendingSyncAccounts();
}

/**
 * 是否存在指定账号尚未补推的本地修改（冲刷失败遗留）。
 */
export function hasPendingAccountSync(accountId: string | null | undefined): boolean {
  if (!accountId || !_pendingSyncAccounts.has(accountId)) return false;
  const pendingBackend = _pendingSyncAccounts.get(accountId) ?? '';
  // 旧版记录没有绑定后端：沿用旧语义，避免升级后丢失待推保护。
  return !pendingBackend || pendingBackend === (backend.backendUrl ?? '');
}

/**
 * 连接回滚后，把冻结窗口内产生的待推标记重新绑定到恢复后的后端。
 * 回滚意味着这些编辑属于原账号的原后端，绝不能在候选后端上补推。
 */
export function rebindPendingAccountSyncToCurrentBackend(accountId: string | null | undefined): void {
  if (!accountId || !_pendingSyncAccounts.has(accountId)) return;
  const backendUrl = backend.backendUrl ?? '';
  if (_pendingSyncAccounts.get(accountId) === backendUrl) return;
  _pendingSyncAccounts.set(accountId, backendUrl);
  persistPendingSyncAccounts();
}

/**
 * 消费指定账号的未同步标记：切回该账号并完成补推协调前调用。
 * 返回是否存在遗留待推状态（存在则调用方必须先 syncToBackend 再拉取）。
 */
export function consumePendingAccountSync(accountId: string | null | undefined): boolean {
  if (!accountId || !hasPendingAccountSync(accountId)) return false;
  _pendingSyncAccounts.delete(accountId);
  persistPendingSyncAccounts();
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
  // 本次调用是否观察到一次实际成功的推送（审计修复）：只有观察到成功推送，
  // 才允许清除该账号的待推标记——推送循环被跳过（会话标志为空）或失败时，
  // 账号级未推修改仍未落盘，标记必须保留。
  let flushPushSucceeded = false;
  if (_debounceTimer) {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
  }
  if (backend.isAvailable) {
    let attempts = 0;
    while ((_hasPendingLocalChanges || _pushPromise) && attempts < SWITCH_FLUSH_MAX_ATTEMPTS) {
      attempts += 1;
      try {
        // 记录本次冲刷是否观察到成功推送（审计修复）：会话级标志在冲刷失败后
        // 已被统一清零，下一次调用会因标志为空而完全跳过推送循环——此时
        // 「标志为空」不能证明该账号的未推修改已落盘，绝不能据此删除账号级
        // 待推标记。
        if (await syncToBackend()) {
          flushPushSucceeded = true;
        }
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
      markPendingAccountSync(previousAccountId);
    }
    logger.warn('sync.switch', 'Backend flush incomplete before account switch; pending edits stay bound to the previous account partition', {
      accountId: previousAccountId ?? null,
      pendingLocalChanges: _hasPendingLocalChanges,
    });
  } else if (previousAccountId && flushPushSucceeded) {
    // 仅在本次调用观察到实际成功的推送后才清除标记（审计修复）：推送循环被
    // 跳过（上一次失败冲刷已把会话标志清零）时标志为空不代表补推成功，
    // 误删会让非强制拉取用后端旧快照覆盖未推送的本地修改
    clearPendingAccountSync(previousAccountId);
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
 *
 * 同时清空账号对齐观察集（R5 审计修复）：logout / 切换 / 归档 / 部分登录
 * 回滚都会调用本函数开启新的对齐会话——新活跃账号在完成一次成功拉取或
 * 换入非空工作区之前，绝不继承上一会话的空推送豁免。
 */
export function resetSyncHashes(): void {
  _lastHash.repos = '';
  _lastHash.releases = '';
  _lastHash.ai = '';
  _lastHash.webdav = '';
  _lastHash.embedding = '';
  _lastHash.vectorSearch = '';
  _lastHash.settings = '';
  _accountsSeenNonEmptyRepos.clear();
  _accountsObservedBackendRepos.clear();
  if (_pushRetryTimer) {
    clearTimeout(_pushRetryTimer);
    _pushRetryTimer = null;
  }
  _pushRetryDelay = 2000;
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
 * 应用后端 settings 分片（拉取与待推合并分支共用同一套规则）。
 * `protectLocal` 用于待推分支：本地非空而后端为空的字段保留本地值，
 * 既不让本机空值覆盖后端配置，也不回滚拉取窗口内的本地编辑。
 */
function applyBackendSettings(settings: Record<string, unknown>, protectLocal = false): void {
  const state = useAppStore.getState();
  const keepLocal = (backendValue: unknown, localValue: unknown): boolean => (
    protectLocal && (backendValue === null || backendValue === undefined) && localValue != null
  );
  if ((typeof settings.activeAIConfig === 'string' || settings.activeAIConfig === null)
    && !keepLocal(settings.activeAIConfig, state.activeAIConfig)) {
    state.setActiveAIConfig(settings.activeAIConfig as string | null);
  }
  if ((typeof settings.activeWebDAVConfig === 'string' || settings.activeWebDAVConfig === null)
    && !keepLocal(settings.activeWebDAVConfig, state.activeWebDAVConfig)) {
    state.setActiveWebDAVConfig(settings.activeWebDAVConfig as string | null);
  }
  if ((typeof settings.activeEmbeddingConfig === 'string' || settings.activeEmbeddingConfig === null)
    && !keepLocal(settings.activeEmbeddingConfig, state.activeEmbeddingConfig)) {
    state.setActiveEmbeddingConfig(settings.activeEmbeddingConfig as string | null);
  }
  if (Array.isArray(settings.hiddenDefaultCategoryIds)) {
    const skipEmpty = protectLocal
      && settings.hiddenDefaultCategoryIds.length === 0
      && (state.hiddenDefaultCategoryIds ?? []).length > 0;
    if (!skipEmpty) {
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
  }
  if (Array.isArray(settings.categoryOrder)) {
    if (!(protectLocal && settings.categoryOrder.length === 0 && state.categoryOrder.length > 0)) {
      useAppStore.setState({ categoryOrder: settings.categoryOrder.filter((id): id is string => typeof id === 'string') });
    }
  }
  if (Array.isArray(settings.customCategories)) {
    if (!(protectLocal && settings.customCategories.length === 0 && state.customCategories.length > 0)) {
      useAppStore.setState({ customCategories: settings.customCategories });
    }
  }
  if (Array.isArray(settings.assetFilters)) {
    if (!(protectLocal && settings.assetFilters.length === 0 && Object.keys(state.assetFilters ?? {}).length > 0)) {
      useAppStore.setState({ assetFilters: normalizeAssetFilters(settings.assetFilters) });
    }
  }
  if (
    settings.defaultCategoryOverrides !== null
    && typeof settings.defaultCategoryOverrides === 'object'
    && !Array.isArray(settings.defaultCategoryOverrides)
  ) {
    const backendOverrides = settings.defaultCategoryOverrides as Record<string, unknown>;
    if (!(protectLocal && Object.keys(backendOverrides).length === 0 && Object.keys(state.defaultCategoryOverrides ?? {}).length > 0)) {
      useAppStore.setState({
        defaultCategoryOverrides: settings.defaultCategoryOverrides as typeof state.defaultCategoryOverrides,
      });
    }
  }
  if (settings.releaseSourceSettings && typeof settings.releaseSourceSettings === 'object'
    && !(protectLocal
      && Object.keys(settings.releaseSourceSettings as object).length === 0
      && Object.keys(state.releaseSourceSettings ?? {}).length > 0)) {
    state.setReleaseSourceSettings(settings.releaseSourceSettings as typeof state.releaseSourceSettings);
  }
  if (typeof settings.collapsedSidebarCategoryCount === 'number' && settings.collapsedSidebarCategoryCount >= 1) {
    useAppStore.setState({ collapsedSidebarCategoryCount: settings.collapsedSidebarCategoryCount });
  }
}

/**
 * Pull all data from backend and update local store.
 * Backend-first strategy: backend data overwrites local data.
 * Silent: errors logged to console only.
 */
export async function syncFromBackend(options: { force?: boolean } = {}): Promise<void> {
  if (!backend.isAvailable) return;
  const activeAccountId = accountIdKey(useAppStore.getState().user);
  // 无活跃账号（登录页/归档窗口）时请求头缺失，服务端会回退全局
  // active_account_id——拉回来的可能是任意账号的分区，写入顶层后会被下一次
  // 快捷登录当成目标账号的工作区（串号）。登录流程都是先 setUser 再拉取。
  // 强制拉取是调用方显式发起的恢复（调用方负责先落登录态），保持原有契约。
  if (!activeAccountId && !options.force) return;
  if (!options.force && (
    _isSyncingFromBackendActive ||
    _isPushingToBackend ||
    // R5 审计修复（发现1）：待推早退会阻止对齐拉取——「本地真空 + 后端事实
    // 未知」时空列表推送已被拒绝，若拉取再被待推标志卡住，对齐永远无法完成
    // （死锁）。此状态下放行拉取：doSync 的待推分支只并入后端新到仓库、
    // 绝不用后端快照覆盖本地数据，随后排空待推队列完成安全补推。
    (_hasPendingLocalChanges && !isUnalignedVacuumAccountSession()) ||
    _debounceTimer
  )) {
    return;
  }
  // 重启后仍带待推标记的账号：走 doSync 的待推合并分支（只并入远端新到
  // 仓库、绝不覆盖本地），随后补推——避免普通拉取用后端旧快照覆盖未同步修改。
  if (hasPendingAccountSync(activeAccountId)) {
    _hasPendingLocalChanges = true;
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
    const stateBeforeFetch = useAppStore.getState();
    const repositoriesBeforeFetch = stateBeforeFetch.repositories;
    // 请求头在 fetch 调用时从 Store 读取：先取快照，fulfilled 后归属到同一账号。
    const fetchedAccountId = accountIdKey(stateBeforeFetch.user);
    const [reposResult, releasesResult, aiResult, webdavResult, embeddingResult, vectorSearchResult, settingsResult] = await Promise.allSettled([
      backend.fetchRepositories(),
      backend.fetchReleases(),
      backend.fetchAIConfigs(),
      backend.fetchWebDAVConfigs(),
      backend.fetchEmbeddingConfigs(),
      backend.fetchVectorSearchConfig(),
      backend.fetchSettings(),
    ]);

    // R5 审计修复（发现1）：仓库拉取成功即视为该账号的后端分区事实已被观察
    // ——此后本地（哪怕仍为空）与后端对齐，空列表全量推送不再有清空风险。
    // 必须在待推分支 return 之前记录，待推分支的排空推送依赖该豁免。
    if (reposResult.status === 'fulfilled') {
      markAccountBackendReposObserved(fetchedAccountId);
    }

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
      // 待推分支只跳过仓库快照，但设置同样来自后端：不应用就会用本地空值
      // （如 customCategories）覆盖后端已有配置。
      if (settingsResult.status === 'fulfilled') {
        applyBackendSettings(settingsResult.value, true);
        _lastHash.settings = quickHash(settingsResult.value);
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
      applyBackendSettings(settingsResult.value);
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
    // 清除标记必须归属本次推送的账号：推送期间若会话已切走，不能误清新账号
    // 的待推状态。
    const pushAccountId = accountIdKey(useAppStore.getState().user);
    let succeeded = await pushToBackend();
    // Requests and edits arriving after the snapshot need a fresh push.
    // Failed writes stay pending for retry without an automatic retry loop.
    while (_hasPendingPush || (succeeded && _hasPendingLocalChanges)) {
      succeeded = await pushToBackend();
    }
    // 只有确认最新状态已全部落盘才清除账号级待推标记：推送期间的新编辑
    // 会在循环里再推一次，最后一轮失败时标记必须保留。
    if (succeeded && !_hasPendingLocalChanges && !_hasPendingPush) {
      clearPendingAccountSync(pushAccountId);
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
 * 破坏性全量推送前的非破坏性对账（Issue #611 审计修复）：
 * 本会话尚未观察过该账号的后端分区时，先把远端仓库并入本地再推送。否则
 * 陈旧（但非空）快照的 isFullSync 会删除其他设备在该分区新增的仓库与 release。
 * 拉取失败时无法确认分区事实，放弃本次推送并保留待推状态。
 */
async function reconcileBeforeDestructivePush(accountId: string): Promise<boolean> {
  if (_accountsObservedBackendRepos.has(accountId)) return true;
  try {
    const remote = await backend.fetchRepositories();
    // 分页截断的响应不是完整快照：据此推送会物理删除未读到的远端仓库。
    if (remote.repositories.length < (remote.total ?? remote.repositories.length)) {
      logger.warn('sync.pushToBackend', 'Deferred destructive push: backend repository snapshot is incomplete', {
        accountId,
        fetched: remote.repositories.length,
        total: remote.total,
      });
      return false;
    }
    markAccountBackendReposObserved(accountId);
    const local = useAppStore.getState().repositories;
    const localIds = new Set(local.map((repo) => repo.id));
    // 上次成功推送后本地消失的仓库 = 用户显式删除，不得因远端仍有而复活。
    const baselineKey = pushedRepoBaselineKey(accountId);
    const deletedLocally = baselineKey ? _lastPushedRepoIds.get(baselineKey) : undefined;
    const arrived = remote.repositories.filter((repo) => (
      !localIds.has(repo.id) && !deletedLocally?.has(repo.id)
    ));
    if (arrived.length > 0) {
      useAppStore.getState().setRepositories([...local, ...arrived]);
    }
    return true;
  } catch (err) {
    logger.warn('sync.pushToBackend', 'Deferred destructive push: backend partition could not be observed', {
      accountId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * 推送失败/被推迟时按账号退避重试，避免轮询被待推标志永久卡死。
 * 账号或后端连接已变化时放弃重试（绝不把旧目标的数据推到新目标）。
 */
export function schedulePendingAccountSyncRetry(accountId: string): void {
  if (_pushRetryTimer) return;
  const delay = _pushRetryDelay;
  _pushRetryDelay = Math.min(_pushRetryDelay * 2, PUSH_RETRY_MAX_DELAY);
  const expectedBackend = backend.backendUrl ?? '';
  _pushRetryTimer = setTimeout(() => {
    _pushRetryTimer = null;
    if (accountIdKey(useAppStore.getState().user) !== accountId) return;
    if ((backend.backendUrl ?? '') !== expectedBackend) return;
    _hasPendingLocalChanges = true;
    void syncToBackend();
  }, delay);
}

/**
 * Push one snapshot of the current store slices to the backend.
 * Reports per-slice write failures through the returned flag instead of
 * throwing; local edits made while the snapshot is in flight stay pending
 * for the next push.
 */
async function pushToBackend(): Promise<boolean> {
  // R5 审计修复（发现1，CodeRabbit Major/Heavy lift）：本地真空且该账号的
  // 后端分区尚未被观察（本会话既没有成功的仓库拉取、本地列表也从未非空）时，
  // 绝不能发送空列表 isFullSync 快照——服务端会物理删除该账号分区的全部
  // 仓库与 release。典型场景：切换到本地无快照的账号后，对齐拉取被窗口内
  // 的用户编辑（待推标志）跳过，守卫退出冲塑以空快照 isFullSync 推送。
  // 处理：跳过本次推送并保留待推标记，待对齐拉取（已放行待推早退）合并
  // 后端数据后由正常流程补推。清空 _hasPendingPush 防止 pushLatest 的
  // 重试循环在拒绝状态下自旋；待推编辑由 _hasPendingLocalChanges 承载。
  if (!canPushEmptyRepositorySnapshot()) {
    const blockedAccountId = accountIdKey(useAppStore.getState().user);
    _hasPendingPush = false;
    _hasPendingLocalChanges = true;
    logger.warn('sync.pushToBackend', 'Refused to push an empty full-sync snapshot before backend alignment; pending edits stay queued for the post-alignment push', {
      accountId: blockedAccountId,
      seenNonEmpty: blockedAccountId ? _accountsSeenNonEmptyRepos.has(blockedAccountId) : false,
      backendObserved: blockedAccountId ? _accountsObservedBackendRepos.has(blockedAccountId) : false,
    });
    return false;
  }
  _isPushingToBackend = true;
  _hasPendingPush = false;
  _hasPendingLocalChanges = false;
  setRepositorySyncVisualState(true);
  const pushStartTime = Date.now();
  try {
    const pushAccountId = accountIdKey(useAppStore.getState().user);
    // 无活跃账号时请求头缺失，服务端会回退全局 active_account_id——绝不能把
    // 无归属会话的列表写进任意分区；分区未被观察时也不允许破坏性全量推送。
    if (!pushAccountId || !(await reconcileBeforeDestructivePush(pushAccountId))) {
      _hasPendingPush = false;
      _hasPendingLocalChanges = true;
      if (pushAccountId) schedulePendingAccountSyncRetry(pushAccountId);
      return false;
    }
    const state = useAppStore.getState();
    // 仓库分片未变化（例如只改了设置）时不要发送 isFullSync 全量快照：
    // 陈旧快照会删除其他设备在该分区新增的仓库。
    const reposHash = repositoryPayloadHash(state.repositories);
    const reposUnchanged = reposHash === _lastHash.repos;
    const skipped = Symbol('skipped');

    const results = await Promise.allSettled([
      reposUnchanged ? Promise.resolve(skipped) : backend.syncRepositories(state.repositories),
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
      _pushRetryDelay = 2000;
    }

    // Only update _lastHash for successfully synced slices.
    // Hash the raw pushed payload (local-only fields like vector_indexed_at are
    // never stored by the backend), so the next pull compares against the same
    // projection and doesn't re-apply setRepositories after a push.
    if (reposSync.status === 'fulfilled' && reposSync.value !== skipped) {
      _lastHash.repos = reposHash;
      const baselineKey = pushedRepoBaselineKey(pushAccountId);
      if (baselineKey) {
        _lastPushedRepoIds.set(baselineKey, new Set(state.repositories.map((repo) => repo.id)));
        persistPushedRepoIds();
      }
    }
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
export async function forceSyncToBackend(options: { reportFailures?: boolean } = {}): Promise<boolean> {
  if (_debounceTimer) {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
  }
  _hasPendingLocalChanges = true;
  const pushed = await syncToBackend();
  if (!pushed && options.reportFailures) {
    throw new Error('Failed to sync to backend');
  }
  return pushed;
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
    // R5 审计修复（发现1）：无论处于何种静音窗口，只要活跃账号的本地仓库
    // 列表非空就记入对齐观察集——这是区分「本地真空」与「用户在会话中主动
    // 清空全部仓库」的唯一依据，绝不能因守卫静音提前返回而漏记。
    if (state.repositories.length > 0) {
      markAccountSeenNonEmptyRepos(accountIdKey(state.user));
    }
    if (_isSyncingFromBackend || _isSwitchingAccount) {
      // 切换守卫窗口内的真实用户编辑（如对齐拉取期间调整 categoryOrder）不能
      // 静默丢弃：记为待推，守卫释放后立即补推。切换簿记（guardSync 覆盖的
      // 工作区替换）与拉取应用阶段（_isSyncingFromBackend）的变化不记录。
      if (_isSwitchingAccount && !_isSyncingFromBackend && !_isAccountSwitchBookkeeping) {
        if (_isAccountSwitchFrozen) {
          // 冻结窗口（候选后端恢复，R4 审计修复）：真实编辑只记入窗口缓冲并
          // 按编辑时的活跃账号归属——绝不置会话级待推（守卫退出会立即推送，
          // 而此时连接可能指向候选后端，旧账号工作区绝不能外发）。窗口退出
          // 时按恢复结果分流（见 withAccountSwitchFrozen）。归属取写入后
          // 状态的 user：归档（park）前的编辑归属本机旧账号——正是发起恢复、
          // 需要补推的账号。
          const editUserId = state.user?.id;
          if (typeof editUserId === 'number' && Number.isFinite(editUserId)) {
            _frozenWindowEditAccounts.add(String(editUserId));
          }
        } else {
          _hasPendingLocalChanges = true;
        }
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
  if (_pushRetryTimer) {
    clearTimeout(_pushRetryTimer);
    _pushRetryTimer = null;
  }
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
