import { backend, normalizeBackendRestoreAccount } from './backendAdapter';
import { useAppStore } from '../store/useAppStore';
import { accountIdKey, getAccountSessionGeneration, isCurrentAccountSession, isSavedAccountRemovedInSession } from '../store/helpers/accountWorkspace';
import { mergeRepositoriesPreservingLocalMetadata, stripLocalRepositoryFields } from '../utils/repositoryMerge';
import { normalizeAssetFilters } from '../utils/assetFilters';
import { createGitHubApiService } from './githubApiFactory';
import { logger } from './logger';
import type { Repository } from '../types';
import type { AppStoreState } from '../store/types';

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

// 冻结窗口栈（第 13 轮引用计数 + 第 14 轮 [15] 改进）：每个活跃窗口持有自己的
// 缓冲并入栈；订阅器写入栈顶窗口的缓冲，退出按窗口身份移除并把缓冲指向仍
// 活跃的最新窗口——并发窗口退出顺序交错时，等待中窗口的后续编辑仍进入其
// 自身缓冲（旧实现按进入前引用还原，编辑会落进已失效缓冲并在退出时丢失）。
interface FrozenWindowBuffers {
  editAccounts: Set<string>;
  dirtySettingKeys: Map<string, Set<string>>;
  dirtySettingValues: Map<string, Record<string, unknown>>;
  dirtySettingVersions: Map<string, Map<string, number>>;
  originBackendUrl: string;
  /** 窗口进入时的重置代次：清空全部数据后退出绝不持久化旧窗口的编辑（[23]）。 */
  resetGeneration: number;
}
const _frozenWindowStack: FrozenWindowBuffers[] = [];
// 第 15 轮审计修复 [19]：_isSwitchingAccount 的统一持有者计数——异步切换守卫
// 与冻结窗口都可能持有该标志，二者交错进出时保存/还原会把仍活动持有者的状态
// 破坏（最后退出者恢复自己进入时的旧值，标志在无活动窗口/守卫时卡死，自动
// 拉取持续暂停）。标志始终重算自当前持有者集合：最后一个持有者退出才复位。
let _activeSwitchGuards = 0;
// 第一个持有者进入前的簿记状态（最后一个持有者退出时恢复）。
let _preHoldersBookkeeping = false;
// 冻结缓冲的阶段前引用（仅缓冲本身；切换/簿记标志由统一重算管理）。
let _preFrozenEditAccounts: Set<string> = new Set<string>();
let _preFrozenDirtySettingKeys: Map<string, Set<string>> = new Map();
let _preFrozenDirtySettingValues: Map<string, Record<string, unknown>> = new Map();
let _preFrozenDirtySettingVersions: Map<string, Map<string, number>> = new Map();

/**
 * 第 15 轮审计修复 [19]：按当前持有者集合重算切换/簿记标志——
 * - 有任一持有者（切换守卫或冻结窗口）→ _isSwitchingAccount = true；
 * - 冻结窗口仍活跃 → 簿记标记保持 false（窗口捕获模式，真实编辑进入缓冲）；
 * - 仅剩切换守卫或全部退出 → 恢复第一个持有者进入前的簿记状态。
 */
function recomputeSwitchHoldingFlags(): void {
  _isSwitchingAccount = _activeSwitchGuards > 0 || _frozenWindowStack.length > 0;
  _isAccountSwitchBookkeeping = _frozenWindowStack.length > 0 ? false : _preHoldersBookkeeping;
}

// 冻结窗口内的真实编辑缓冲（R4 审计修复）：记录编辑发生时的活跃账号
// （GitHub 数值 ID 字符串）。窗口退出时按恢复结果分流：恢复失败（回滚原
// 后端）→ 调用方在复原连接后立即补推；恢复成功（切到新后端）→ 并入
// _pendingSyncAccounts，下次进入该账号先补推再拉取。窗口内绝不推送。
// 第 13 轮审计修复：并发/嵌套窗口各自持有独立缓冲；第 14 轮 [15]：指向
// 栈顶（仍活跃的最新窗口）而非进入前引用。
let _frozenWindowEditAccounts = new Set<string>();

// 冻结窗口内的设置脏键缓冲（审计修复 C4）：按编辑发生时的活跃账号记录窗口内
// 修改过的设置键。窗口退出时随 markPendingAccountSync 的 dirtySettingKeys
// 一起按 (accountId, backendUrl) 持久化，重启后拉取仍能保留这些本地编辑值。
let _frozenWindowDirtySettingKeys = new Map<string, Set<string>>();

// 冻结窗口内的设置待推「值」缓冲（R12 跨域修复，finding 3）：同账号从 X 恢复
// 到 Y 时，X 后端分区尚待推送的设置编辑只记录脏键会丢失值——Y 的拉取会覆盖
// 本地工作区的 categoryOrder 等字段，切回 X 时脏键仍在但原值已无法恢复。
// 这里在编辑发生的瞬间按账号保存每个脏键的新值；窗口退出时随 (accountId,
// backendUrl) 一起持久化，重试该后端时写回工作区并随推送发送。
let _frozenWindowDirtySettingValues = new Map<string, Record<string, unknown>>();

// 冻结窗口内的设置待推「值」编辑版本缓冲（第 14 轮审计修复 [12]）：窗口退出
// 顺序不代表编辑顺序——外层窗口晚于内层退出时，其捕获的陈旧值不得覆盖内层
// 稍后保存的新值。编辑瞬间记录单调递增版本，合并时只接受版本更新的值。
let _frozenWindowDirtySettingVersions = new Map<string, Map<string, number>>();
let _frozenEditVersionSeq = 0;

/**
 * Wrap an account switch sequence so the Store subscription treats all state
 * changes inside as switch bookkeeping, not as local edits to push.
 * Saves and restores the previous flag so nesting stays safe, and drains the
 * pending edits recorded inside the window right after releasing it so the
 * alignment-window edits are pushed under the (now active) account's header.
 */
export async function withAccountSwitchGuard<T>(fn: () => Promise<T>): Promise<T> {
  // 第 15 轮审计修复 [19]：守卫与冻结窗口统一持有者计数——交错进出时不再按
  // 各自进入前的旧值还原（会把仍活动持有者的状态破坏并卡死切换标志）。
  if (_activeSwitchGuards === 0 && _frozenWindowStack.length === 0) {
    _preHoldersBookkeeping = _isAccountSwitchBookkeeping;
  }
  _activeSwitchGuards += 1;
  _isSwitchingAccount = true;
  try {
    return await fn();
  } finally {
    _activeSwitchGuards -= 1;
    recomputeSwitchHoldingFlags();
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
export async function withAccountSwitchFrozen<T>(
  fn: () => Promise<T>,
  originBackendUrl: string = backend.backendUrl ?? '',
): Promise<T> {
  // 第 14 轮审计修复 [19]：整个冻结阶段开始前捕获切换/簿记状态与缓冲引用——
  // 最后一个窗口退出时恢复该状态，而不是最后进入窗口自己看到的值。
  // 第 15 轮审计修复 [19]：切换/簿记标志改由持有者计数统一重算（与切换守卫
  // 共享），此处只捕获缓冲的阶段前引用与簿记前值。
  if (_frozenWindowStack.length === 0) {
    _preHoldersBookkeeping = _isAccountSwitchBookkeeping;
    _preFrozenEditAccounts = _frozenWindowEditAccounts;
    _preFrozenDirtySettingKeys = _frozenWindowDirtySettingKeys;
    _preFrozenDirtySettingValues = _frozenWindowDirtySettingValues;
    _preFrozenDirtySettingVersions = _frozenWindowDirtySettingVersions;
  }
  const window: FrozenWindowBuffers = {
    editAccounts: new Set<string>(),
    dirtySettingKeys: new Map<string, Set<string>>(),
    dirtySettingValues: new Map<string, Record<string, unknown>>(),
    dirtySettingVersions: new Map<string, Map<string, number>>(),
    originBackendUrl,
    resetGeneration: _resetGeneration,
  };
  _frozenWindowStack.push(window);
  _frozenWindowEditAccounts = window.editAccounts;
  _frozenWindowDirtySettingKeys = window.dirtySettingKeys;
  _frozenWindowDirtySettingValues = window.dirtySettingValues;
  _frozenWindowDirtySettingVersions = window.dirtySettingVersions;
  _isSwitchingAccount = true;
  _isAccountSwitchFrozen = true;
  // 冻结窗口内不再全程置簿记标记：guardSync 覆盖的簿记写入自带标记并自行
  // 恢复；窗口内其余写入由此被订阅器视为真实编辑进入窗口缓冲
  _isAccountSwitchBookkeeping = false;
  try {
    return await fn();
  } finally {
    // 第 14 轮审计修复 [15]：按窗口身份移除已退出的窗口，编辑缓冲切换到仍
    // 活跃的最新窗口——并发窗口退出顺序交错时（X 先进先出、Y 等待中），Y 的
    // 后续编辑仍进入其自身缓冲并在退出时持久化，绝不落入已失效缓冲丢失。
    const windowIndex = _frozenWindowStack.indexOf(window);
    if (windowIndex >= 0) _frozenWindowStack.splice(windowIndex, 1);
    const activeTop = _frozenWindowStack[_frozenWindowStack.length - 1];
    if (activeTop) {
      _frozenWindowEditAccounts = activeTop.editAccounts;
      _frozenWindowDirtySettingKeys = activeTop.dirtySettingKeys;
      _frozenWindowDirtySettingValues = activeTop.dirtySettingValues;
      _frozenWindowDirtySettingVersions = activeTop.dirtySettingVersions;
    } else {
      _frozenWindowEditAccounts = _preFrozenEditAccounts;
      _frozenWindowDirtySettingKeys = _preFrozenDirtySettingKeys;
      _frozenWindowDirtySettingValues = _preFrozenDirtySettingValues;
      _frozenWindowDirtySettingVersions = _preFrozenDirtySettingVersions;
    }
    // 第 14 轮审计修复 [19]：仍有窗口时保持切换状态；最后一个窗口退出时恢复
    // 整个冻结阶段开始前的状态（而非该窗口自己进入时看到的 previousSwitching
    // ——它可能是内层窗口置位的 true，会让轮询在无窗口时持续跳过自动拉取）。
    // 第 15 轮审计修复 [19]：切换/簿记标志由持有者计数统一重算——仍有守卫时
    // 保持切换状态，全部持有者退出才复位（守卫与冻结窗口交错退出不再卡死标志）。
    const frozenWindowsRemain = _frozenWindowStack.length > 0;
    _isAccountSwitchFrozen = frozenWindowsRemain;
    recomputeSwitchHoldingFlags();
    // 第 14 轮审计修复 [23]：清空全部数据（_resetGeneration 递增）发生在窗口
    // 生命周期内时，退出绝不把旧窗口的编辑写回磁盘——重置后恢复刚删除的
    // 待推记录会让旧数据复活。窗口本身始终释放；仅代次一致时保存编辑。
    if (_resetGeneration === window.resetGeneration) {
      for (const accountId of window.editAccounts) {
        // 审计修复（C4）：窗口内编辑过的设置脏键随待推标记一起持久化，
        // 恢复失败/成功分流后拉取合并仍能保留这些本地编辑值。
        // R12 finding 3：脏键对应的「值」也一起持久化——同账号切到另一后端后
        // 目标后端的拉取会覆盖本地工作区，只有保存值才能在重试原后端时恢复。
        // 第 14 轮审计修复 [12]：值快照带编辑版本——合并只接受版本更新的值。
        const windowVersions = window.dirtySettingVersions.get(accountId);
        markPendingAccountSync(accountId, window.originBackendUrl, {
          dirtySettingKeys: [...(window.dirtySettingKeys.get(accountId) ?? [])],
          dirtySettingValues: window.dirtySettingValues.get(accountId),
          ...(windowVersions ? { dirtySettingVersions: Object.fromEntries(windowVersions) } : {}),
        });
      }
    }
  }
}

/**
 * 第 15 轮审计修复 [19]（探测互斥接缝）：是否有任一异步切换守卫或冻结窗口
 * 持有切换标志。设置页连接探测（features 域 useBackendSettingsActions）可据此
 * 在账号切换进行中拒绝发起新探测，避免探测的连接提交与切换流程的会话/连接
 * 变更并发交错；探测自身已包裹冻结窗口，标志在其退出后由持有者计数复位。
 */
export function isAccountSwitchInProgress(): boolean {
  return _isSwitchingAccount;
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
  _pendingForceVerify = false;
}

// Track store subscription for cleanup on restart
let _storeUnsubscribe: (() => void) | null = null;

// Prevent overlapping pushes to backend
let _isPushingToBackend = false;
// R12 跨域修复（finding 1）：推送结果按「推送链路」绑定，而不是模块级可变变量。
// 复用进行中的推送是设计（串行/去重），但结果必须随被等待的 promise 一起返回，
// 任何调用方都不能读取被另一次推送覆盖的共享失败状态。
interface PushAttemptOutcome {
  /** 本次推送是否真正发出了写入请求；false = 提前返回（未尝试写入）。 */
  attempted: boolean;
  /** 本次推送实际失败的分片名（最后一次尝试）。 */
  failedShards: string[];
  /** 第 15 轮审计修复 [18]：推送发起时捕获的待推记录版本与本次发送的设置值。 */
  recordRevision?: number;
  sentSettingValues?: Record<string, unknown>;
}
interface SyncPushResult extends PushAttemptOutcome {
  pushed: boolean;
}
let _pushPromise: Promise<SyncPushResult> | null = null;
// Queue a push if one is requested while a pull is in-flight
let _hasPendingPush = false;
// Force-verify repository and settings shards on manual "Sync to backend"
let _pendingForceVerify = false;
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
// R2-C4 语义拆分：v2 基线只记录「上次推送时本地实际持有的仓库 ID」。
// 旧版把 push 载荷（含为对齐远端而保留的远端 ID）整体写入基线，下次推送会把
// 仅远端存在的仓库当作本地删除并物理删除。旧键数据不再读取（宁可多拉一次
// 远端合并，也绝不把远端新增误判为本地删除）。
const PUSHED_REPO_IDS_KEY = 'gsm.pushedRepoIdsV2';
const LEGACY_PUSHED_REPO_IDS_KEY = 'gsm.pushedRepoIds';

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

/**
 * R2-C3：已确认取消 Star、但后端尚未确认删除的仓库 ID（按 后端+账号 持久化）。
 * 切号期间发起的 unstar 即使发起账号没有任何推送基线，也必须阻止切回后的
 * 拉取合并把仓库复活、推送合并把它重新写回；只有成功 PUT（后端确认删除）
 * 后才清除。
 */
const PENDING_REPO_DELETIONS_KEY = 'gsm.pendingRepoDeletions';

const loadPendingRepoDeletions = (): Map<string, Set<number>> => {
  try {
    const raw = localStorage.getItem(PENDING_REPO_DELETIONS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    const result = new Map<string, Set<number>>();
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [key, ids] of Object.entries(parsed as Record<string, unknown>)) {
        if (!Array.isArray(ids)) continue;
        const set = new Set(ids.filter((id): id is number => Number.isInteger(id)));
        if (set.size > 0) result.set(key, set);
      }
    }
    return result;
  } catch {
    return new Map();
  }
};

const _pendingRepoDeletions = loadPendingRepoDeletions();

const persistPendingRepoDeletions = (): void => {
  try {
    localStorage.setItem(
      PENDING_REPO_DELETIONS_KEY,
      JSON.stringify(Object.fromEntries([..._pendingRepoDeletions].map(([id, ids]) => [id, [...ids]]))),
    );
  } catch {
    // 存储不可用时退化为会话内记录
  }
};

/**
 * 登记「已确认取消 Star，等待后端确认删除」的仓库 ID（R2-C3）。
 * 发起账号与后端显式传入（切号路径必须归属发起时上下文，绝不能落到新账号）。
 * 无后端上下文时无需登记（本地模式没有共享分区）。
 */
export function markPendingRepositoryDeletion(
  accountId: string | null | undefined,
  repoId: number,
  targetBackendUrl = backend.backendUrl ?? '',
): void {
  if (!accountId || !targetBackendUrl || !Number.isInteger(repoId)) return;
  const key = `${targetBackendUrl}|${accountId}`;
  let ids = _pendingRepoDeletions.get(key);
  if (!ids) {
    ids = new Set<number>();
    _pendingRepoDeletions.set(key, ids);
  }
  if (ids.has(repoId)) return;
  ids.add(repoId);
  persistPendingRepoDeletions();
}

/** 当前 (账号, 当前后端) 的待确认删除集合；无后端上下文时返回 undefined。 */
function pendingDeletedRepoIds(accountId: string | null | undefined): Set<number> | undefined {
  if (!accountId) return undefined;
  const key = pushedRepoBaselineKey(accountId);
  return key ? _pendingRepoDeletions.get(key) : undefined;
}

function clearPendingRepositoryDeletions(
  accountId: string,
  backendUrl: string,
  confirmedIds?: ReadonlySet<number> | null,
): void {
  const key = `${backendUrl}|${accountId}`;
  const existing = _pendingRepoDeletions.get(key);
  if (!existing) return;
  if (!confirmedIds) {
    _pendingRepoDeletions.delete(key);
    persistPendingRepoDeletions();
    return;
  }
  let changed = false;
  for (const id of confirmedIds) {
    if (existing.delete(id)) changed = true;
  }
  if (existing.size === 0) {
    _pendingRepoDeletions.delete(key);
    changed = true;
  }
  if (changed) persistPendingRepoDeletions();
}

// 推送失败后的退避重试（只在账号仍匹配时重试一次链）。
let _pushRetryTimer: ReturnType<typeof setTimeout> | null = null;
let _pushRetryDelay = 2000;
let _syncGeneration = 0;
let _lastReposHashKey = '';
const _sessionDeletedRepoIds = new Map<string, Set<number>>();
const _dirtySettingKeys = new Set<string>();
// R2-C2：设置脏键的编辑版本。每次键被重新编辑时递增；推送成功只清除版本
// 仍等于请求构造时快照的键——旧请求（categoryOrder=v1）的迟到成功响应
// 绝不能清掉请求发出后产生的新编辑（v2）的脏键保护。
let _dirtySettingVersionSeq = 0;
const _dirtySettingKeyVersions = new Map<string, number>();

function markDirtySettingKeys(keys: Iterable<string>): void {
  for (const key of keys) {
    _dirtySettingKeys.add(key);
    _dirtySettingVersionSeq += 1;
    _dirtySettingKeyVersions.set(key, _dirtySettingVersionSeq);
  }
}

/** 构造设置请求时记录各脏键对应的编辑版本（R2-C2）。 */
function snapshotDirtySettingVersions(): Map<string, number> {
  const snapshot = new Map<string, number>();
  for (const key of _dirtySettingKeys) {
    snapshot.set(key, _dirtySettingKeyVersions.get(key) ?? 0);
  }
  return snapshot;
}

// R2-C6：设置读取失败（settingsResult 被拒绝）或尚未读取成功的 (后端, 账号)
// 集合。读取失败后推送绝不能发送未加载的本地字段（新建工作区的空
// customCategories 等会覆盖后端已有分类）；此时只发送本次明确编辑过的脏键。
const _settingsUnavailableKeys = new Set<string>();
const _settingsLoadedKeys = new Set<string>();
function settingsLoadedKey(accountId: string, backendUrl: string): string {
  return `${backendUrl}|${accountId}`;
}
function markSettingsLoaded(accountId: string | null | undefined, backendUrl: string): void {
  if (!accountId) return;
  const key = settingsLoadedKey(accountId, backendUrl);
  _settingsUnavailableKeys.delete(key);
  _settingsLoadedKeys.add(key);
}
function markSettingsUnavailable(accountId: string | null | undefined, backendUrl: string): void {
  if (!accountId) return;
  const key = settingsLoadedKey(accountId, backendUrl);
  _settingsUnavailableKeys.add(key);
  _settingsLoadedKeys.delete(key);
}

// 审计修复（PR #612）：AI 配置分片的「已对齐」标记，键格式与设置一致但集合独立。
// 当前 (账号, 后端) 尚未成功读取过 AI 配置时，本地空数组不代表「无配置」——
// 此时推送 syncAIConfigs([]) 会触发服务端 bulk PUT 先清空后插入，物理删除该
// 分区的全部 AI 配置。未对齐时空列表必须跳过写入，等待拉取对齐后按真实状态推送。
const _aiConfigsLoadedKeys = new Set<string>();
function markAIConfigsLoaded(accountId: string | null | undefined, backendUrl: string): void {
  if (!accountId) return;
  _aiConfigsLoadedKeys.add(settingsLoadedKey(accountId, backendUrl));
}
// 第 13 轮审计修复 [49]：WebDAV 配置分片与 AI 配置相同的「已对齐」标记——
// 服务端 PUT /configs/webdav/bulk 对空数组先 DELETE 全表再插入零行，本地
// webdavConfigs 为空且该 (账号, 后端) 尚未成功读取过配置时，发送空列表会
// 清空后端的全部 WebDAV 配置。未对齐时空列表必须跳过写入。
const _webdavConfigsLoadedKeys = new Set<string>();
function markWebDAVConfigsLoaded(accountId: string | null | undefined, backendUrl: string): void {
  if (!accountId) return;
  _webdavConfigsLoadedKeys.add(settingsLoadedKey(accountId, backendUrl));
}
const PUSH_RETRY_MAX_DELAY = 60_000;

// 推送分片名（审计修复 C41）：按 Promise.allSettled 的分片顺序命名，失败分片
// 经 forceSyncToBackend 的 reportFailures 错误暴露给调用方，使其能按分片判断
// 是否需要回滚（仓库与设置已成功时不因 AI 配置分片失败回滚本地变更）。
const PUSH_SHARD_NAMES = [
  'repositories',
  'releases',
  'aiConfigs',
  'webdavConfigs',
  'embeddingConfigs',
  'vectorSearch',
  'settings',
] as const;

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
// （第 13 轮跨域接缝：doSync 返回分片成败探针，等待方只关心完成，类型放宽为 unknown）
let _syncPromise: Promise<unknown> | null = null;

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
// 第 13 轮审计修复 [42]：遗留旧格式（字符串条目）待推记录的「一次性评估」标记。
// 首次加载时若无法确认原后端（无持久化 URL），遗留记录保持未归属并写入本标记；
// 之后即使用户连接了其他后端并重启（persistedUrl 变为该后端），这些记录也绝
// 不绑定到新后端（「绝不会自动补推到新后端」的约定在重启后仍然成立）。
const LEGACY_PENDING_SYNC_EVALUATED_KEY = 'gsm.pendingSyncLegacyEvaluated';
// 第 15 轮审计修复 [17]：遗留待推记录的迁移来源 URL——必须在绑定记录之前
// 先固化。记录写回因配额失败时该来源键仍然保留，下次启动按它绑定原后端，
// 绝不用「下次启动时的 persistedUrl」猜测归属（用户可能已连接另一个后端，
// 猜测会把原后端的待推编辑发送到新后端）。
const PENDING_SYNC_MIGRATION_SOURCE_KEY = 'gsm.pendingSyncMigrationSource';

function pendingSyncCompositeKey(accountId: string, backendUrl: string): string {
  return `${backendUrl}\n${accountId}`;
}

// 值 = 产生待推状态的 { accountId, backendUrl, dirtySettingKeys? }（'' 表示旧版
// 记录/未知）。按 backendUrl + accountId 共同建索引，避免不同后端的待推记录
// 互相覆盖。dirtySettingKeys（审计修复 C4）：按 (accountId, backendUrl) 保存
// 待推设置的脏键，重启后恢复——拉取时保留本地已编辑值、未编辑字段仍从后端
// 合并；对应设置写入成功后才清除。
const SETTING_DIRTY_KEYS = [
  'activeAIConfig',
  'activeWebDAVConfig',
  'activeEmbeddingConfig',
  'hiddenDefaultCategoryIds',
  'categoryOrder',
  'customCategories',
  'assetFilters',
  'defaultCategoryOverrides',
  'releaseSourceSettings',
  'collapsedSidebarCategoryCount',
] as const;

/**
 * 待推设置的键→值快照（R12 跨域修复，finding 3）：按 (accountId, backendUrl)
 * 归属。脏键只说明「哪些字段本地编辑过」，值才是重试该后端时应当发送的内容——
 * 同账号切到另一后端后，目标后端的拉取会用其数据覆盖本地工作区，只有持久化
 * 的值才能在切回原后端时恢复这次编辑。
 */
type PendingSettingValues = Record<string, unknown>;

function isSettingDirtyKey(value: unknown): value is typeof SETTING_DIRTY_KEYS[number] {
  return typeof value === 'string' && (SETTING_DIRTY_KEYS as readonly string[]).includes(value);
}

/** 校验持久化/合并来源的设置值快照：仅保留白名单键与可序列化的定义值。 */
function normalizePendingSettingValues(value: unknown): PendingSettingValues | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const values: PendingSettingValues = {};
  for (const [key, settingValue] of Object.entries(value)) {
    if (!isSettingDirtyKey(key) || settingValue === undefined) continue;
    values[key] = settingValue;
  }
  return Object.keys(values).length > 0 ? values : undefined;
}

interface PendingSyncAccountRecord {
  accountId: string;
  backendUrl: string;
  dirtySettingKeys?: string[];
  /** 待推设置的键→值快照（finding 3），与 dirtySettingKeys 同步维护。 */
  dirtySettingValues?: PendingSettingValues;
}

/**
 * 待推记录的持久化格式：`[accountId, backendUrl, dirtySettingKeys?, values?]`。
 * 保持旧格式（2/3 元组）可读；没有值的记录绝不写空对象，避免无谓放大快照。
 */
function serializePendingSyncRecord(entry: PendingSyncAccountRecord): unknown[] {
  const dirtySettingKeys = entry.dirtySettingKeys ?? [];
  const dirtySettingValues = normalizePendingSettingValues(entry.dirtySettingValues);
  if (dirtySettingKeys.length === 0 && !dirtySettingValues) {
    return [entry.accountId, entry.backendUrl];
  }
  if (!dirtySettingValues) {
    return [entry.accountId, entry.backendUrl, dirtySettingKeys];
  }
  return [entry.accountId, entry.backendUrl, dirtySettingKeys, dirtySettingValues];
}

const loadPendingSyncAccounts = (): Map<string, PendingSyncAccountRecord> => {
  try {
    const raw = localStorage.getItem(PENDING_SYNC_ACCOUNTS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    const entries = new Map<string, PendingSyncAccountRecord>();
    if (!Array.isArray(parsed)) return entries;
    for (const item of parsed) {
      if (typeof item === 'string') {
        entries.set(pendingSyncCompositeKey(item, ''), { accountId: item, backendUrl: '' });
      } else if (Array.isArray(item) && typeof item[0] === 'string') {
        const backendUrl = typeof item[1] === 'string' ? item[1] : '';
        // 三元组格式（C4）：[accountId, backendUrl, dirtySettingKeys[]]
        // 四元组格式（R12 finding 3）：[..., dirtySettingKeys[], dirtySettingValues{}]
        const rawDirtyKeys = Array.isArray(item[2]) ? item[2] : [];
        const dirtySettingKeys = rawDirtyKeys.filter((key): key is typeof SETTING_DIRTY_KEYS[number] => (
          (SETTING_DIRTY_KEYS as readonly string[]).includes(key as string)
        ));
        const dirtySettingValues = normalizePendingSettingValues(item[3]);
        entries.set(
          pendingSyncCompositeKey(item[0], backendUrl),
          {
            accountId: item[0],
            backendUrl,
            ...(dirtySettingKeys.length > 0 ? { dirtySettingKeys } : {}),
            ...(dirtySettingValues ? { dirtySettingValues } : {}),
          },
        );
      }
    }
    // 旧版待推记录迁移（审计修复）：旧格式 [accountId] 加载为 backendUrl ''
    // 的记录，复合键查找永远匹配不到已连接后端——重新连接原后端后普通拉取
    // 不会先补推，后端旧值可能覆盖未推修改。迁移前只存在单一后端连接，其
    // 持久化 URL（登录页预填与 init 探测共用）即原后端：能确认时把记录一次性
    // 绑定到该 URL 并立即写回持久化（避免之后切换后端时被重复绑定到新连接）。
    // 无法确认时保留原样：空 URL 记录不会被 hasPendingAccountSync 关联到任何
    // 新后端，也绝不会自动补推到新后端（restorePendingSettingDirtyKeys 仍按
    // 原有迁移语义恢复其脏键保护，只影响拉取合并的保留方向，不产生写入）。
    let migrationBackendUrl: string | null = null;
    // 第 15 轮审计修复 [17]：迁移来源必须可验证——优先使用上次启动已固化的
    // 来源 URL；只有从未固化过来源时才考虑本次启动的 persistedUrl，并在绑定
    // 之前先把它固化为来源（写入失败则不绑定，保留未归属状态）。
    let migrationSourcePersisted = false;
    try {
      const storedSource = window.localStorage.getItem(PENDING_SYNC_MIGRATION_SOURCE_KEY);
      if (typeof storedSource === 'string' && storedSource) {
        migrationBackendUrl = storedSource;
        migrationSourcePersisted = true;
      }
    } catch {
      // 存储不可用：按未固化来源处理
    }
    if (!migrationBackendUrl) {
      try {
        const persisted = backend.persistedUrl;
        migrationBackendUrl = typeof persisted === 'string' && persisted ? persisted : null;
      } catch {
        migrationBackendUrl = null;
      }
    }
    // 第 13 轮审计修复 [42]：空 URL（未归属）记录只在「能确认原后端」的首次
    // 加载中绑定持久化 URL（原单一后端迁移语义）。若本次启动已无法确认（无
    // 持久化 URL），立即写入一次性评估标记——已评估后，任何保持未归属的记录
    // 都绝不因后续保存的其他后端 URL 绑定到该后端（无论旧格式字符串条目还是
    // 新格式空 URL 记录，「绝不会自动补推到新后端」在重启后仍然成立；绑定会
    // 让 hasPendingAccountSync 命中并把本地修改当作新后端的待推内容）。标记
    // 写入失败（存储不可用）时退化为旧行为：本次启动仍不绑定，只损失跨重启
    // 保护。
    let unboundKeepEvaluated = false;
    try {
      unboundKeepEvaluated = window.localStorage.getItem(LEGACY_PENDING_SYNC_EVALUATED_KEY) === '1';
    } catch {
      unboundKeepEvaluated = false;
    }
    const canRebindUnboundRecords = !unboundKeepEvaluated;
    let rebound = false;
    // 第 15 轮审计修复 [17]：绑定前先固化迁移来源——来源写不进去就保持未归属
    //（宁可不迁移，也不能让重启后的 URL 猜测把旧记录绑到另一个后端）。
    if (
      migrationBackendUrl
      && canRebindUnboundRecords
      && [...entries.values()].some((entry) => entry.backendUrl === '')
      && !migrationSourcePersisted
    ) {
      try {
        window.localStorage.setItem(PENDING_SYNC_MIGRATION_SOURCE_KEY, migrationBackendUrl);
        migrationSourcePersisted = true;
      } catch {
        // 无法固化来源：本次启动保持未归属，绝不按下次启动的 URL 猜测归属
        migrationBackendUrl = null;
      }
    }
    if (migrationBackendUrl) {
      for (const [key, entry] of [...entries]) {
        if (entry.backendUrl !== '') continue;
        // 已评估过且当时无法确认原后端：保持未归属，绝不绑定到之后持久化的
        // 其他后端 URL。
        if (!canRebindUnboundRecords) continue;
        entries.delete(key);
        // 审计员补充（Round 11）：目标复合键上可能已有同账号的新格式记录——
        // 旧格式记录尚未迁移的会话里，同一账号在同一后端又产生了失败补推记录。
        // 直接覆盖会丢掉已有记录的 dirtySettingKeys（拉取合并的本地编辑保护），
        // 必须按并集合并后再写回。
        const targetKey = pendingSyncCompositeKey(entry.accountId, migrationBackendUrl);
        const existingAtTarget = entries.get(targetKey);
        const mergedDirtyKeys = Array.from(new Set([
          ...(existingAtTarget?.dirtySettingKeys ?? []),
          ...(entry.dirtySettingKeys ?? []),
        ]));
        const mergedDirtyValues = {
          ...normalizePendingSettingValues(existingAtTarget?.dirtySettingValues),
          ...normalizePendingSettingValues(entry.dirtySettingValues),
        };
        const mergedValues = normalizePendingSettingValues(mergedDirtyValues);
        entries.set(targetKey, {
          accountId: entry.accountId,
          backendUrl: migrationBackendUrl,
          ...(mergedDirtyKeys.length > 0 ? { dirtySettingKeys: mergedDirtyKeys } : {}),
          ...(mergedValues ? { dirtySettingValues: mergedValues } : {}),
        });
        rebound = true;
      }
      if (rebound) {
        let writeBackOk = false;
        try {
          localStorage.setItem(
            PENDING_SYNC_ACCOUNTS_KEY,
            JSON.stringify([...entries.values()].map(serializePendingSyncRecord)),
          );
          writeBackOk = true;
        } catch {
          // 存储不可用时忽略：本次会话内绑定仍然生效，下次启动重试迁移
        }
        // 第 14 轮审计修复 [20]：原后端已知时，迁移写回成功后才记录评估完成
        // ——写回失败（如配额不足）不记录，重启后仍会重试迁移，遗留记录的自
        // 动恢复不因标记提前写入而永久丢失。
        if (writeBackOk && !unboundKeepEvaluated) {
          try {
            window.localStorage.setItem(LEGACY_PENDING_SYNC_EVALUATED_KEY, '1');
          } catch {
            // 存储不可用：下次启动重试评估（迁移写回已成功，重试为幂等空操作）
          }
        }
        // 第 15 轮审计修复 [17]：记录已带着目标 URL 落盘，迁移来源不再需要；
        // 写回失败时保留来源键，下次启动按原后端重试（绝不用新连接的 URL）。
        if (writeBackOk) {
          try {
            window.localStorage.removeItem(PENDING_SYNC_MIGRATION_SOURCE_KEY);
          } catch {
            // 存储不可用：来源键残留只会让下次启动做幂等重绑
          }
        }
      } else if (!unboundKeepEvaluated) {
        // 原后端已知且无需迁移（无空 URL 记录）：评估即完成。
        try {
          window.localStorage.setItem(LEGACY_PENDING_SYNC_EVALUATED_KEY, '1');
        } catch {
          // 存储不可用：下次启动重试评估
        }
        // 第 15 轮审计修复 [17]：没有待绑定的未归属记录，来源键（可能因上次
        // 写回成功但清除失败而残留）一并清理。
        try {
          window.localStorage.removeItem(PENDING_SYNC_MIGRATION_SOURCE_KEY);
        } catch {
          // 存储不可用：残留来源键不影响后续启动
        }
      }
    } else if (!unboundKeepEvaluated) {
      // 第 14 轮审计修复 [20]：URL 未知时仍立即锁定未归属状态——遗留记录在
      // 本次启动保持未归属，绝不因之后持久化的其他后端 URL 绑定到该后端。
      try {
        window.localStorage.setItem(LEGACY_PENDING_SYNC_EVALUATED_KEY, '1');
      } catch {
        // 存储不可用：保持旧绑定语义（下次启动重试评估）
      }
    }
    return entries;
  } catch {
    return new Map();
  }
};

const persistPendingSyncAccounts = (): void => {
  try {
    localStorage.setItem(
      PENDING_SYNC_ACCOUNTS_KEY,
      JSON.stringify([..._pendingSyncAccounts.values()].map(serializePendingSyncRecord)),
    );
  } catch {
    // 存储不可用（隐私模式/配额）时退化为会话内标记
  }
};

const _pendingSyncAccounts = loadPendingSyncAccounts();

// 待推设置「值」的字段级编辑版本（第 14 轮审计修复 [12]，仅内存）：按复合键
// → 字段 → 版本记录。窗口退出顺序不代表编辑顺序——并发/嵌套窗口中同一账号
// 同一字段可能被多个窗口先后捕获，合并时只接受版本更新（或首次记录）的值，
// 外层窗口晚退出时其陈旧值不得覆盖内层窗口稍后保存的新值。不随记录持久化：
// 重启后不存在「退出顺序交错」问题，未携带版本的合并一律接受。
const pendingSettingValueVersions = new Map<string, Map<string, number>>();

// 第 15 轮审计修复 [18]：待推记录的写入版本（仅内存）——任何对某 (账号, 后端)
// 记录的持久化变更（mark/clear/字段确认）都会抬升版本。推送发起时捕获版本，
// 确认时版本已变说明请求在途期间记录被更新（例如冻结窗口保存了新值 v2），
// 此时只清除本次请求实际确认且值未被更新的字段，绝不按请求启动时的快照
// 删除持久记录中的新值或整条记录。
const pendingSyncRecordRevisions = new Map<string, number>();
let _pendingSyncRecordRevisionSeq = 0;

function bumpPendingSyncRecordRevision(key: string): void {
  _pendingSyncRecordRevisionSeq += 1;
  pendingSyncRecordRevisions.set(key, _pendingSyncRecordRevisionSeq);
}

function getPendingSyncRecordRevision(key: string): number {
  return pendingSyncRecordRevisions.get(key) ?? 0;
}

/**
 * 记录账号级待推状态（补推成功前必须保留，跨重启持久化）。
 * dirtySettingKeys（C4）：待推设置的脏键随标记一起按 (accountId, backendUrl)
 * 持久化，重启后由 restorePendingSettingDirtyKeys 恢复进会话脏键集合。
 * dirtySettingValues（R12 finding 3）：同一批脏键的值快照；同账号切换后端时
 * 目标后端的拉取不得让这些待推值丢失，重试原后端时按此快照恢复。
 * dirtySettingVersions（第 14 轮 [12]）：值快照的字段级编辑版本——合并时只
 * 接受版本更新的值，确保合并顺序由编辑先后决定而非窗口退出顺序。
 */
export function markPendingAccountSync(
  accountId: string,
  targetBackendUrl = backend.backendUrl ?? '',
  options?: {
    dirtySettingKeys?: string[];
    dirtySettingValues?: PendingSettingValues;
    dirtySettingVersions?: Record<string, number>;
  },
): void {
  const key = pendingSyncCompositeKey(accountId, targetBackendUrl);
  const dirtySettingKeys = options?.dirtySettingKeys?.filter(
    (key): key is typeof SETTING_DIRTY_KEYS[number] => (SETTING_DIRTY_KEYS as readonly string[]).includes(key),
  );
  const incomingValues = normalizePendingSettingValues(options?.dirtySettingValues);
  const incomingVersions = options?.dirtySettingVersions ?? {};
  // 第 14 轮审计修复 [12]：按版本过滤 incoming 值——仅接受版本更新（或首次
  // 记录/未携带版本）的字段，陈旧窗口的值绝不覆盖更新编辑的值。
  const acceptedValues: PendingSettingValues = {};
  for (const [fieldKey, fieldValue] of Object.entries(incomingValues ?? {})) {
    const storedVersion = pendingSettingValueVersions.get(key)?.get(fieldKey);
    const incomingVersion = incomingVersions[fieldKey];
    if (storedVersion !== undefined
      && incomingVersion !== undefined
      && incomingVersion < storedVersion) {
      continue;
    }
    acceptedValues[fieldKey] = fieldValue;
    if (incomingVersion !== undefined) {
      const fieldVersions = pendingSettingValueVersions.get(key) ?? new Map<string, number>();
      fieldVersions.set(fieldKey, incomingVersion);
      pendingSettingValueVersions.set(key, fieldVersions);
    }
  }
  const existing = _pendingSyncAccounts.get(key);
  if (existing) {
    // 已有记录：合并脏键（并集），绝不丢失先前窗口记录的编辑字段
    const mergedDirty = new Set([...(existing.dirtySettingKeys ?? []), ...(dirtySettingKeys ?? [])]);
    const nextDirty = dirtySettingKeys
      ? [...mergedDirty]
      : existing.dirtySettingKeys;
    // 值快照按「同一键后写覆盖先写」合并（已按编辑版本过滤 incoming）：
    // 同一字段的多次编辑以版本最新者为准；未提供新值时保留既有快照。
    const mergedValues = {
      ...normalizePendingSettingValues(existing.dirtySettingValues),
      ...acceptedValues,
    };
    const nextValues = normalizePendingSettingValues(mergedValues);
    _pendingSyncAccounts.set(key, {
      ...existing,
      ...(nextDirty && nextDirty.length > 0 ? { dirtySettingKeys: nextDirty } : {}),
      ...(nextValues ? { dirtySettingValues: nextValues } : {}),
    });
    bumpPendingSyncRecordRevision(key);
    persistPendingSyncAccounts();
    return;
  }
  _pendingSyncAccounts.set(key, {
    accountId,
    backendUrl: targetBackendUrl,
    ...(dirtySettingKeys && dirtySettingKeys.length > 0 ? { dirtySettingKeys } : {}),
    ...(normalizePendingSettingValues(acceptedValues)
      ? { dirtySettingValues: normalizePendingSettingValues(acceptedValues) }
      : {}),
  });
  bumpPendingSyncRecordRevision(key);
  persistPendingSyncAccounts();
}

/** 补推确认成功后清除指定后端+账号的待推标记（失败时保留，重启后仍会补推）。 */
export function clearPendingAccountSync(
  accountId: string | null | undefined,
  targetBackendUrl = backend.backendUrl ?? '',
  expectedRecordRevision?: number,
): void {
  if (!accountId) return;
  // 第 14 轮审计修复 [21]：成功推送只清除与已确认目标精确匹配的待推记录——
  // 来源未知（backendUrl ''）的记录不因某一次后端的推送成功而删除：该成功
  // 不能证明未知来源的编辑已送达（其脏键也不再恢复为当前后端的出站项，见
  // restorePendingSettingDirtyKeys）。未归属记录保留到显式处理或清空全部数据。
  const exactKey = pendingSyncCompositeKey(accountId, targetBackendUrl);
  // 第 15 轮审计修复 [18]：整条记录确认同样核对请求启动时捕获的记录版本——
  // 推送在途期间记录被更新（冻结窗口保存了新值）时，本次成功只证明旧值已
  // 送达，绝不能删除整条记录把新值一并丢弃。
  if (expectedRecordRevision !== undefined
    && getPendingSyncRecordRevision(exactKey) !== expectedRecordRevision) {
    return;
  }
  // 仍有未确认的脏键（例如请求在途期间冻结窗口保存、字段确认按值保留的键）：
  // 推送确认路径必须保留整条记录，等待下一次推送送达这些字段。显式消费
  //（consumePendingAccountSync / 切换冲刷）不传版本，仍按调用方意图清除。
  const existing = _pendingSyncAccounts.get(exactKey);
  if (expectedRecordRevision !== undefined
    && existing?.dirtySettingKeys && existing.dirtySettingKeys.length > 0) {
    return;
  }
  if (_pendingSyncAccounts.delete(exactKey)) {
    pendingSettingValueVersions.delete(exactKey);
    bumpPendingSyncRecordRevision(exactKey);
    persistPendingSyncAccounts();
  }
}

/**
 * 待推设置写入成功后清除该 (账号, 后端) 记录中的脏键（审计修复 C4/R2-C2）：
 * 后端已确认接收最新设置值，重启后的拉取无需再保护这些字段。仅清除本次
 * 请求确实携带、且之后未被重新编辑（版本仍匹配）的键——请求在途期间的新
 * 编辑必须继续保留在持久化记录中。
 */
function clearPendingSettingDirtyKeys(
  accountId: string,
  targetBackendUrl: string,
  pushedVersions: ReadonlyMap<string, number>,
  options?: {
    /** 请求启动时捕获的记录版本（第 15 轮 [18]）。 */
    recordRevision?: number;
    /** 本次请求实际发送的设置值快照——记录版本变化时用于判定字段是否被更新。 */
    sentValues?: Readonly<Record<string, unknown>>;
  },
): void {
  const key = pendingSyncCompositeKey(accountId, targetBackendUrl);
  const existing = _pendingSyncAccounts.get(key);
  if (!existing?.dirtySettingKeys) return;
  // 第 15 轮审计修复 [18]：请求在途期间记录被更新（例如冻结窗口保存了 v2）
  // 时，`_dirtySettingKeyVersions` 未必感知（冻结窗口用独立版本表），单靠
  // 版本比较会删除记录中的新值。此时改为按值判定：只有持久记录中的值仍等于
  // 本次实际发送的值（说明没有更新的编辑）才清除该键。
  const recordRevisionChanged = options?.recordRevision !== undefined
    && getPendingSyncRecordRevision(key) !== options.recordRevision;
  const remainingDirty = existing.dirtySettingKeys.filter((dirtyKey) => {
    const pushedVersion = pushedVersions.get(dirtyKey);
    // 未在本次请求中携带的键无法确认已写入，保留保护。
    if (pushedVersion === undefined) return true;
    if (recordRevisionChanged) {
      const persistedValue = existing.dirtySettingValues?.[dirtyKey];
      // 记录没有该字段的值快照：无法证明未被更新，保留保护。
      if (persistedValue === undefined) return true;
      const sentValue = options?.sentValues?.[dirtyKey];
      return JSON.stringify(persistedValue) !== JSON.stringify(sentValue);
    }
    return _dirtySettingKeyVersions.get(dirtyKey) !== pushedVersion;
  });
  const remainingSet = new Set(remainingDirty);
  const remainingValues = Object.fromEntries(
    Object.entries(normalizePendingSettingValues(existing.dirtySettingValues) ?? {})
      .filter(([dirtyKey]) => remainingSet.has(dirtyKey)),
  );
  _pendingSyncAccounts.set(key, {
    accountId,
    backendUrl: targetBackendUrl,
    ...(remainingDirty.length > 0 ? { dirtySettingKeys: remainingDirty } : {}),
    ...(Object.keys(remainingValues).length > 0 ? { dirtySettingValues: remainingValues } : {}),
  });
  bumpPendingSyncRecordRevision(key);
  persistPendingSyncAccounts();
}

/**
 * 把持久化的待推脏键恢复进会话脏键集合（审计修复 C4）：重启后带待推标记的
 * 账号走拉取合并分支时，已编辑字段经 protectLocal 保留本地值，未编辑字段
 * 仍从后端合并。
 */
function restorePendingSettingDirtyKeys(accountId: string): void {
  const currentBackend = backend.backendUrl ?? '';
  for (const entry of [..._pendingSyncAccounts.values()]) {
    if (entry.accountId !== accountId || !entry.dirtySettingKeys) continue;
    // 第 14 轮审计修复 [22]：只恢复与当前后端精确匹配的记录——来源未知
    //（backendUrl ''）记录的脏键不得登记为当前后端的出站待推项：该编辑从未
    // 归属于当前后端，恢复会让设置推送把当前工作区值写到该后端。未归属记录
    // 保持待推语义，由显式处理或清空全部数据清理。
    if (entry.backendUrl !== currentBackend) continue;
    // 恢复即视为一次「保护寄存器」写入：分配新版本，旧请求的成功响应无法
    // 凭旧版本清除这些键（R2-C2）。
    markDirtySettingKeys(entry.dirtySettingKeys);
  }
}

/**
 * 把归属于指定 (账号, 后端) 的待推设置「值」写回工作区（R12 finding 3）。
 *
 * 同账号从 X 切到 Y 后，Y 的拉取会把 categoryOrder 等字段覆盖成 Y 的值；
 * 切回 X 时只有持久化的值快照能恢复用户当时的编辑。保护规则：
 * - 只处理该 (账号, 后端) 精确匹配的记录（旧版 backendUrl '' 记录没有值）；
 * - 本会话已重新编辑过的键（`_dirtySettingKeys` 命中）保留实时值——用户
 *   更晚的编辑优先，绝不用旧快照覆盖；
 * - 静音订阅器，恢复动作本身不得被记成新的本地编辑或触发额外推送。
 */
function restorePendingSettingValues(accountId: string, targetBackendUrl: string): void {
  const entry = _pendingSyncAccounts.get(pendingSyncCompositeKey(accountId, targetBackendUrl));
  const savedValues = normalizePendingSettingValues(entry?.dirtySettingValues);
  if (!savedValues) return;
  const patch: Record<string, unknown> = {};
  for (const key of SETTING_DIRTY_KEYS) {
    if (!(key in savedValues)) continue;
    if (_dirtySettingKeys.has(key)) continue;
    patch[key] = savedValues[key];
  }
  if (Object.keys(patch).length === 0) return;
  muteSubscriberWrites(() => {
    useAppStore.setState(patch as Partial<AppStoreState>);
  });
}

/**
 * R12 finding 3（hooks 消费入口）：把当前后端的待推设置值恢复到工作区。
 * 在应用目标后端数据（对齐拉取/补推）前调用，确保本地工作区代表该后端的
 * 待推编辑，而不是被另一后端覆盖后的值。
 */
export function restorePendingSettingValuesForCurrentBackend(
  accountId: string | null | undefined,
): void {
  if (!accountId) return;
  restorePendingSettingValues(accountId, backend.backendUrl ?? '');
}

/**
 * 是否存在指定账号尚未补推的本地修改（冲刷失败遗留）。
 * 键语义（审计修复 C1）：按 (accountId, backendUrl) 复合键归属——X 后端上的
 * 待推记录绝不触发对 Y 后端的补推。
 */
export function hasPendingAccountSync(accountId: string | null | undefined): boolean {
  if (!accountId) return false;
  const currentBackend = backend.backendUrl ?? '';
  return _pendingSyncAccounts.has(pendingSyncCompositeKey(accountId, currentBackend));
}

/**
 * 连接回滚后，把本次恢复窗口产生的待推标记重新绑定到恢复后的后端。
 * 审计修复（C1）：只处理 originBackendUrl（恢复窗口原后端）上登记的记录——
 * 其他后端已有的待推记录归属各自分区，绝不能被本次回滚改绑到当前 backendUrl
 * （会把编辑推到错误后端）。冻结窗口（withAccountSwitchFrozen）产生的记录
 * 已按窗口入口后端登记；确需重绑的恢复路径必须显式传入窗口原后端 URL。
 */
export function rebindPendingAccountSyncToCurrentBackend(
  accountId: string | null | undefined,
  originBackendUrl: string,
): void {
  if (!accountId) return;
  const backendUrl = backend.backendUrl ?? '';
  if (originBackendUrl === backendUrl) return;
  const key = pendingSyncCompositeKey(accountId, originBackendUrl);
  const existing = _pendingSyncAccounts.get(key);
  if (!existing) return;
  _pendingSyncAccounts.delete(key);
  // R2-C1：目标后端可能已有同账号的待推记录——重绑必须合并两边的脏键
  //（并集），复用 markPendingAccountSync 的合并语义，绝不覆盖目标记录的
  // 已编辑键保护。目标不存在时按来源记录（含全部脏键）原样迁移。
  markPendingAccountSync(accountId, backendUrl, {
    dirtySettingKeys: existing.dirtySettingKeys,
    // R12 finding 3：值快照随记录一起迁移到恢复后的后端，补推时才能发送
    // 原始编辑值而不是被候选后端拉取覆盖后的工作区值。
    dirtySettingValues: existing.dirtySettingValues,
  });
}

/**
 * 消费指定账号的未同步标记：切回该账号并完成补推协调前调用。
 * 返回是否存在遗留待推状态（存在则调用方必须先 syncToBackend 再拉取）。
 */
export function consumePendingAccountSync(accountId: string | null | undefined): boolean {
  if (!accountId || !hasPendingAccountSync(accountId)) return false;
  clearPendingAccountSync(accountId);
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
      // 审计修复（C4）：待推设置的脏键随标记一起按 (accountId, backendUrl)
      // 持久化，重启后拉取合并分支据此保留本地已编辑值。
      // R12 finding 3：除脏键外一并保存值快照——若新会话切到另一后端，其拉取
      // 会覆盖本地工作区；只有保存的值能在回到原后端时恢复这些待推编辑。
      const pendingTargetBackendUrl = backend.backendUrl ?? '';
      const pendingState = useAppStore.getState() as unknown as Record<string, unknown>;
      const pendingValues: PendingSettingValues = {};
      for (const dirtyKey of _dirtySettingKeys) {
        if (!isSettingDirtyKey(dirtyKey)) continue;
        const value = pendingState[dirtyKey];
        if (value === undefined) continue;
        pendingValues[dirtyKey] = value;
      }
      markPendingAccountSync(previousAccountId, pendingTargetBackendUrl, {
        dirtySettingKeys: [..._dirtySettingKeys],
        dirtySettingValues: pendingValues,
      });
      // 这些脏键已随待推记录持久化（值也一并保存）。本会话的脏键集合必须
      // 同步清空：否则同账号换后端返回后，restorePendingSettingValues 会因
      // 「本会话曾编辑」的旧标记跳过恢复，把目标后端覆盖后的值推回原后端。
      // 记录仍在——重新进入该 (账号, 后端) 时 restorePendingSettingDirtyKeys
      // 会重新登记保护。
      for (const dirtyKey of _dirtySettingKeys) {
        _dirtySettingKeyVersions.delete(dirtyKey);
      }
      _dirtySettingKeys.clear();
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

// 自动拉取暂停标记（审计修复 B14/HANDOFF-B-TO-C）：排空在途拉取期间暂停
// 新的自动拉取，防止排空过程中轮询又启动新的拉取。
let _autoPullsPaused = false;

/**
 * 暂停新的自动拉取，并等待该账号全部在途后端拉取结束（B14，见
 * HANDOFF-B-TO-C.md）。resolve 后保证不会再有该账号的拉取结果写入顶层
 * 工作区：在途拉取已全部排空，迟到的结果由 C8 的「提交前校验会话代次」
 * 兜底丢弃。accountId 为 null（无活跃账号）时至少暂停排空期间的新拉取。
 */
export async function drainInFlightBackendPulls(accountId: string | null): Promise<void> {
  void accountId;
  _autoPullsPaused = true;
  try {
    while (_syncPromise) {
      try {
        await _syncPromise;
      } catch {
        // 排空等待方继续；失败语义由 C8 的会话校验兜底
      }
    }
  } finally {
    _autoPullsPaused = false;
  }
}

/**
 * 清空全部数据流程的待推状态清理入口（审计修复 C51）：同时清除
 * gsm.pendingSyncAccounts / gsm.pushedRepoIds 的持久化与内存记录、会话删除
 * 集合，并取消在途退避重试与待推防抖。「清空全部数据」若只清空 savedAccounts，
 * 账号级待推标记会残留并在重启后触发对已清空分区的补推。
 */
let _resetGeneration = 0;

export function clearPendingSyncState(): void {
  _resetGeneration += 1;
  _pendingSyncAccounts.clear();
  try {
    localStorage.removeItem(PENDING_SYNC_ACCOUNTS_KEY);
  } catch {
    // 存储不可用时忽略
  }
  _lastPushedRepoIds.clear();
  _sessionDeletedRepoIds.clear();
  _pendingRepoDeletions.clear();
  _dirtySettingKeys.clear();
  _dirtySettingKeyVersions.clear();
  // 第 14 轮审计修复 [12]：待推记录连同其值版本一并清除（清空全部数据后不得
  // 有陈旧版本残留阻挡后续窗口编辑的值合并）。
  pendingSettingValueVersions.clear();
  // 第 15 轮审计修复 [18]：记录写入版本随记录一起清除（在途推送的完成回调
  // 由 [15] 的重置代次门控拦截，不会再用旧版本做确认判定）。
  pendingSyncRecordRevisions.clear();
  _settingsUnavailableKeys.clear();
  _settingsLoadedKeys.clear();
  _aiConfigsLoadedKeys.clear();
  // 第 14 轮审计修复 [13]：WebDAV 配置分片与 AI 相同——新对齐会话必须重新
  // 读取后端 WebDAV 配置后才能推送空列表。
  _webdavConfigsLoadedKeys.clear();
  try {
    localStorage.removeItem(PUSHED_REPO_IDS_KEY);
    localStorage.removeItem(LEGACY_PUSHED_REPO_IDS_KEY);
    localStorage.removeItem(PENDING_REPO_DELETIONS_KEY);
  } catch {
    // 存储不可用时忽略
  }
  if (_pushRetryTimer) {
    clearTimeout(_pushRetryTimer);
    _pushRetryTimer = null;
  }
  _pushRetryDelay = 2000;
  _hasPendingLocalChanges = false;
  _hasPendingPush = false;
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
  _lastReposHashKey = '';
  _lastHash.releases = '';
  _lastHash.ai = '';
  _lastHash.webdav = '';
  _lastHash.embedding = '';
  _lastHash.vectorSearch = '';
  _lastHash.settings = '';
  _dirtySettingKeys.clear();
  _dirtySettingKeyVersions.clear();
  // R2-C6：新对齐会话必须重新从后端读取设置，旧会话的「已加载」结论不继承。
  _settingsUnavailableKeys.clear();
  _settingsLoadedKeys.clear();
  // AI 配置分片同理：新对齐会话必须重新读取后端 AI 配置后才能推送空列表。
  _aiConfigsLoadedKeys.clear();
  // 第 14 轮审计修复 [13]：WebDAV 配置分片同理——曾读取过空列表而强制拉取
  // 失败时，旧标记仍会让后续设置编辑触发未对齐空列表的 bulk PUT，清空远端
  // 其他设备添加的配置。
  _webdavConfigsLoadedKeys.clear();
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

  // 审计修复（B1，HANDOFF-B-TO-C.md 第 1 项）：启动时捕获「空会话」的会话
  // 代次——自动恢复只允许提交到启动时的同一个空会话；GitHub 身份校验等待
  // 期间任何登录/切换都会递增代次，A→B→A 也不会误通过。
  const expectedGeneration = getAccountSessionGeneration();

  _isRestoringAuth = true;
  try {
    // 第 13 轮审计修复 [34]：恢复请求前记录连接代次——请求地址在
    // backend.restoreAuth() 中同步读取，记录必须位于该调用之前。连接切换只
    // 递增 connectionGeneration（会话代次不变），等待 GitHub 身份校验期间
    // 后端从 X 切到 Y 后，旧连接 X 的凭据不得提交进当前会话（否则
    // syncLocalGitHubTokenToBackend 可能把 X 的 Token 发送到 Y）。
    const expectedConnectionGeneration = backend.connectionGeneration;
    const restored = await backend.restoreAuth();
    if (!restored?.github_token) return false;

    // 直连校验待恢复的 token 本身再采纳其身份；走代理时服务端用的是库里
    // 当前 token，校验的就不是即将写入本地的这份凭据了。
    const githubApi = createGitHubApiService(restored.github_token, { direct: true });
    const user = await githubApi.getCurrentUser();

    // 审计修复（B1）：最后一次 await（GitHub 身份校验）之后、任何 set* 之前
    // 复核自动恢复仍拥有启动时的同一个空会话：账号 ID 为 null（无登录）且
    // 代次等于启动时捕获值。旧实现把复核放在身份校验之前，等待期间用户手动
    // 登录的话，恢复流程会把后端 Token/用户写到新会话上。
    // 第 13 轮审计修复 [34]：同时复核连接代次——X→Y→X 时代次递增两次，
    // 比较仍会失败，此时恢复返回 false，不提交凭据。
    const snapshot = useAppStore.getState();
    if (snapshot.user || snapshot.githubToken) return false;
    if (!isCurrentAccountSession(null, expectedGeneration)) return false;
    if (backend.connectionGeneration !== expectedConnectionGeneration) return false;

    // 审计修复（B1）：凭证提交为一次原子更新——同步守卫内连续写入
    // githubToken/user/isAuthenticated 并以已验证身份 upsert savedAccounts
    //（与 useAccountSwitchActions.addAccountFromBackend 的提交写法一致），
    // 绝不在两个 set* 之间留下可被其他会话写入穿插的窗口；恢复 Token 与
    // 已验证 user 均为本函数局部已校验值，不从可能已变化的会话回读。
    withAccountSwitchGuardSync(() => {
      useAppStore.getState().setGitHubToken(restored.github_token);
      useAppStore.getState().setUser(user);
    });
    // 多账号恢复（Issue #611）：后端保存的所有账号一次性登记进 savedAccounts，
    // 让登录页/下拉菜单能直接列出并一键切换。R2-C12：user:null 的条目用其分区
    // PAT 向 GitHub /user 核对归属后补齐完整身份，核对失败/不一致则拒绝。
    if (Array.isArray(restored.accounts)) {
      // 记录恢复任务发起时的会话代次与重置代次：等待 GitHub 身份查询期间若用户登出、
      // 切号或清空数据，立即中止登记，避免重新保存已删除的账号和 PAT。
      // 第 13 轮审计修复 [34]：账号登记循环在每次异步 normalize 后写入前比较
      // 连接代次——连接切换后不得继续登记旧连接的账号。
      const restoreSessionGen = getAccountSessionGeneration();
      const restoreResetGen = _resetGeneration;
      const restoreConnectionGen = backend.connectionGeneration;
      const { upsertSavedAccount } = useAppStore.getState();
      for (const account of restored.accounts) {
        const normalizedAccount = await normalizeBackendRestoreAccount(account);
        if (
          _resetGeneration !== restoreResetGen
          || getAccountSessionGeneration() !== restoreSessionGen
          || backend.connectionGeneration !== restoreConnectionGen
          || !useAppStore.getState().isAuthenticated
        ) {
          break;
        }
        if (!normalizedAccount) continue;
        // 第 15 轮审计修复 [11]：await 期间用户移除了该账号时绝不写回——
        // removeSavedAccount 的非当前账号分支不推进会话代次，仅靠上方代次
        // 检查拦不住（组件域 LoginScreen 的登记循环同款处理）。
        if (isSavedAccountRemovedInSession(accountIdKey(normalizedAccount.user) ?? '')) {
          continue;
        }
        upsertSavedAccount(normalizedAccount.user, normalizedAccount.githubToken);
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
 * 以同步作用域静音本机编辑订阅（第 12 轮审计修复）：远端数据/设置应用到
 * Store 的写入不得被订阅器记为本机编辑——否则订阅器会把后端分类等写回记为
 * 本机脏键，旧回包经补推可覆盖其他设备的更新。zustand 订阅器同步触发，
 * try/finally 作用域即覆盖全部写入。
 */
function muteSubscriberWrites<T>(fn: () => T): T {
  const previous = _isSyncingFromBackend;
  _isSyncingFromBackend = true;
  try {
    return fn();
  } finally {
    _isSyncingFromBackend = previous;
  }
}

/**
 * 应用后端 settings 分片（拉取与待推合并分支共用同一套规则）的静音版：
 * 待推合并分支在订阅器活跃状态下调用，必须经 muteSubscriberWrites 包裹；
 * 拉取应用分支已处于 _isSyncingFromBackend 作用域内，直接调用原函数。
 * `protectLocal` 用于待推分支：本地非空而后端为空的字段保留本地值，
 * 既不让本机空值覆盖后端配置，也不回滚拉取窗口内的本地编辑。
 */
function applyBackendSettings(settings: Record<string, unknown>, protectLocal = false): void {
  const state = useAppStore.getState();
  const hasKey = (key: string): boolean => Object.prototype.hasOwnProperty.call(settings, key);
  const isDirty = (key: string): boolean => protectLocal && _dirtySettingKeys.has(key);
  // 脏字段继续保留本地值；未编辑字段遇到后端显式返回的 null / [] 时应用后端值，
  // 仅当字段缺失（未提供/undefined）时不推断为清空。
  const keepLocal = (key: string, backendValue: unknown, localValue: unknown): boolean => (
    isDirty(key) || (protectLocal && (!hasKey(key) || backendValue === undefined) && localValue != null)
  );
  if (!isDirty('activeAIConfig')
    && (typeof settings.activeAIConfig === 'string' || settings.activeAIConfig === null)
    && !keepLocal('activeAIConfig', settings.activeAIConfig, state.activeAIConfig)) {
    state.setActiveAIConfig(settings.activeAIConfig as string | null);
  }
  if (!isDirty('activeWebDAVConfig')
    && (typeof settings.activeWebDAVConfig === 'string' || settings.activeWebDAVConfig === null)
    && !keepLocal('activeWebDAVConfig', settings.activeWebDAVConfig, state.activeWebDAVConfig)) {
    state.setActiveWebDAVConfig(settings.activeWebDAVConfig as string | null);
  }
  if (!isDirty('activeEmbeddingConfig')
    && (typeof settings.activeEmbeddingConfig === 'string' || settings.activeEmbeddingConfig === null)
    && !keepLocal('activeEmbeddingConfig', settings.activeEmbeddingConfig, state.activeEmbeddingConfig)) {
    state.setActiveEmbeddingConfig(settings.activeEmbeddingConfig as string | null);
  }
  if (!isDirty('hiddenDefaultCategoryIds') && Array.isArray(settings.hiddenDefaultCategoryIds)) {
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
  if (!isDirty('categoryOrder') && Array.isArray(settings.categoryOrder)) {
    useAppStore.setState({ categoryOrder: settings.categoryOrder.filter((id): id is string => typeof id === 'string') });
  }
  if (!isDirty('customCategories') && Array.isArray(settings.customCategories)) {
    useAppStore.setState({ customCategories: settings.customCategories });
  }
  if (!isDirty('assetFilters') && Array.isArray(settings.assetFilters)) {
    useAppStore.setState({ assetFilters: normalizeAssetFilters(settings.assetFilters) });
  }
  if (
    !isDirty('defaultCategoryOverrides')
    && settings.defaultCategoryOverrides !== null
    && typeof settings.defaultCategoryOverrides === 'object'
    && !Array.isArray(settings.defaultCategoryOverrides)
  ) {
    useAppStore.setState({
      defaultCategoryOverrides: settings.defaultCategoryOverrides as typeof state.defaultCategoryOverrides,
    });
  }
  if (!isDirty('releaseSourceSettings')
    && settings.releaseSourceSettings && typeof settings.releaseSourceSettings === 'object') {
    state.setReleaseSourceSettings(settings.releaseSourceSettings as typeof state.releaseSourceSettings);
  }
  if (!isDirty('collapsedSidebarCategoryCount')
    && typeof settings.collapsedSidebarCategoryCount === 'number'
    && settings.collapsedSidebarCategoryCount >= 1) {
    useAppStore.setState({ collapsedSidebarCategoryCount: settings.collapsedSidebarCategoryCount });
  }
}

/** applyBackendSettings 的静音版：订阅器不把应用后端设置产生的写入记为本机编辑。 */
function applyBackendSettingsMuted(settings: Record<string, unknown>, protectLocal = false): void {
  muteSubscriberWrites(() => applyBackendSettings(settings, protectLocal));
}

/**
 * Pull all data from backend and update local store.
 * Backend-first strategy: backend data overwrites local data.
 * Silent: errors logged to console only.
 *
 * options.targetAccountId（审计修复 B13，见 HANDOFF-B-TO-C.md）：登录页显式
 * 账号恢复。提供时本次拉取的全部后端请求以 X-GitHub-Account-Id: targetAccountId
 * 构造请求头（不依赖 Store 的当前 user——登录流程归档旧账号后 user 为 null）；
 * 拉取结果的会话守卫按 (targetAccountId, 拉取开始时捕获的会话代次) 校验，
 * 不一致时丢弃结果，绝不写入无主顶层。
 */
/**
 * syncFromBackend 的分片成败探针（第 13 轮跨域接缝，components 域 [36]）：
 * 登录恢复流程（LoginScreen 经 useLoginActions.syncBackendData 透传）据此在
 * settings/releases 分片读取失败时回退目标账号的原归档字段。
 * shards 各键 = 该分片本次 HTTP 读取是否成功（fulfilled）；null = 拉取未执行、
 * 结果被丢弃（会话/后端在拉取期间变化）或失败，调用方应按「未知」处理并回退。
 */
export interface SyncFromBackendPullResult {
  shards: {
    repositories: boolean;
    releases: boolean;
    aiConfigs: boolean;
    webdavConfigs: boolean;
    embeddingConfigs: boolean;
    vectorSearch: boolean;
    settings: boolean;
  };
}

export async function syncFromBackend(options: {
  force?: boolean;
  throwOnRepoFailure?: boolean;
  targetAccountId?: string;
} = {}): Promise<SyncFromBackendPullResult | null> {
  if (!backend.isAvailable) return null;
  const activeAccountId = accountIdKey(useAppStore.getState().user);
  // 无活跃账号（登录页/归档窗口）时请求头缺失，服务端会回退全局
  // active_account_id——拉回来的可能是任意账号的分区，写入顶层后会被下一次
  // 快捷登录当成目标账号的工作区（串号）。登录流程都是先 setUser 再拉取；
  // 显式账号恢复（targetAccountId）以已验证账号 ID 固定请求头，无需提前
  // 落登录态。强制拉取是调用方显式发起的恢复（调用方负责先落登录态），保持原有契约。
  if (!activeAccountId && !options.force && !options.targetAccountId) return null;
  if (!options.force && (
    _autoPullsPaused ||
    _isSyncingFromBackendActive ||
    _isPushingToBackend ||
    // R5 审计修复（发现1）：待推早退会阻止对齐拉取——「本地真空 + 后端事实
    // 未知」时空列表推送已被拒绝，若拉取再被待推标志卡住，对齐永远无法完成
    // （死锁）。此状态下放行拉取：doSync 的待推分支只并入后端新到仓库、
    // 绝不用后端快照覆盖本地数据，随后排空待推队列完成安全补推。
    (_hasPendingLocalChanges && !isUnalignedVacuumAccountSession()) ||
    _debounceTimer
  )) {
    return null;
  }
  // 重启后仍带待推标记的账号：走 doSync 的待推合并分支（只并入远端新到
  // 仓库、绝不覆盖本地），随后补推——避免普通拉取用后端旧快照覆盖未同步修改。
  // 审计修复（C4）：持久化的待推设置脏键一并恢复进会话脏键集合，使拉取
  // 保留本地已编辑值、未编辑字段仍从后端合并。
  if (activeAccountId && hasPendingAccountSync(activeAccountId)) {
    _hasPendingLocalChanges = true;
    // R12 finding 3：先把归属于当前后端的待推设置值写回工作区，再恢复脏键
    // 保护——否则拉取合并保留的是被另一后端覆盖后的本地值，而不是用户当时
    // 编辑的值。
    restorePendingSettingValues(activeAccountId, backend.backendUrl ?? '');
    restorePendingSettingDirtyKeys(activeAccountId);
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
  if (_isSyncingFromBackendActive) return null;

  _isSyncingFromBackendActive = true;

  const doSync = async (): Promise<SyncFromBackendPullResult | null> => {
  const startTime = Date.now();
  // 审计修复（C8）：发起时捕获会话代次，提交结果前与账号 ID、后端 URL 一并
  // 校验——拉取等待期间切号/切后端后，旧会话的拉取结果绝不写入新会话。
  const startedGeneration = getAccountSessionGeneration();
  // 仓库分片失败需要在 strict 模式下穿透 doSync 的通用 catch 向上传播（C5）
  let repoFetchFailure: Error | null = null;
  try {
    const stateBeforeFetch = useAppStore.getState();
    const repositoriesBeforeFetch = stateBeforeFetch.repositories;
    // 请求头在 fetch 调用时从 Store 读取：先取快照，fulfilled 后归属到同一账号与后端。
    // 显式账号恢复（B13）：请求头固定为 targetAccountId，不依赖 Store 当前 user。
    const fetchedAccountId = options.targetAccountId ?? accountIdKey(stateBeforeFetch.user);
    const fetchedBackendUrl = backend.backendUrl ?? '';
    const explicitAccountId = options.targetAccountId ?? undefined;
    const [reposResult, releasesResult, aiResult, webdavResult, embeddingResult, vectorSearchResult, settingsResult] = await Promise.allSettled([
      backend.fetchRepositories(explicitAccountId),
      backend.fetchReleases(explicitAccountId),
      backend.fetchAIConfigs(explicitAccountId),
      backend.fetchWebDAVConfigs(explicitAccountId),
      backend.fetchEmbeddingConfigs(explicitAccountId),
      backend.fetchVectorSearchConfig(explicitAccountId),
      backend.fetchSettings(explicitAccountId),
    ]);
    // 第 13 轮跨域接缝（components 域 [36]）：分片读取成败随返回值暴露。
    const shards: SyncFromBackendPullResult['shards'] = {
      repositories: reposResult.status === 'fulfilled',
      releases: releasesResult.status === 'fulfilled',
      aiConfigs: aiResult.status === 'fulfilled',
      webdavConfigs: webdavResult.status === 'fulfilled',
      embeddingConfigs: embeddingResult.status === 'fulfilled',
      vectorSearch: vectorSearchResult.status === 'fulfilled',
      settings: settingsResult.status === 'fulfilled',
    };

    if ((backend.backendUrl ?? '') !== fetchedBackendUrl) {
      if (options.throwOnRepoFailure) {
        repoFetchFailure = new Error('Backend connection changed during pull');
        throw repoFetchFailure;
      }
      return null;
    }

    // 审计修复（C8）：提交结果（更新 Store、同步哈希、待推状态）前同时校验
    // 账号 ID、会话代次与后端 URL；任一不匹配丢弃结果。显式账号恢复按
    // (targetAccountId, 代次) 校验；当调用方要求严格结果（throwOnRepoFailure）
    // 时必须显式抛错并写入 repoFetchFailure，防止登录恢复流程在拉取被丢弃后继续提交目标账号身份与 PAT。
    if (options.targetAccountId) {
      if (getAccountSessionGeneration() !== startedGeneration) {
        logger.warn('sync.pullFromBackend', 'Discarded target-account pull: session generation changed during fetch', {
          targetAccountId: options.targetAccountId,
        });
        if (options.throwOnRepoFailure) {
          repoFetchFailure = new Error('Target-account pull discarded: session changed during fetch');
          throw repoFetchFailure;
        }
        return null;
      }
    } else {
      const currentAccountId = accountIdKey(useAppStore.getState().user);
      if (currentAccountId !== fetchedAccountId || getAccountSessionGeneration() !== startedGeneration) {
        logger.warn('sync.pullFromBackend', 'Discarded stale pull: session changed during fetch', {
          fetchedAccountId: fetchedAccountId ?? null,
          currentAccountId: currentAccountId ?? null,
        });
        if (options.throwOnRepoFailure) {
          repoFetchFailure = new Error('Pull discarded: session changed during fetch');
          throw repoFetchFailure;
        }
        return null;
      }
    }

    if (options.throwOnRepoFailure && reposResult.status !== 'fulfilled') {
      repoFetchFailure = reposResult.reason instanceof Error
        ? reposResult.reason
        : new Error('Failed to fetch repositories from backend');
      throw repoFetchFailure;
    }

    const reposComplete = reposResult.status === 'fulfilled'
      && reposResult.value.repositories.length >= (reposResult.value.total ?? reposResult.value.repositories.length);

    // R5 审计修复（发现1）：仓库拉取完整且成功即视为该账号的后端分区事实已被观察
    // ——截断响应绝不能授权破坏性全量推送。
    if (reposComplete) {
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
      if (reposComplete) {
        const repositoriesNow = useAppStore.getState().repositories;
        const knownBeforeFetch = new Set(repositoriesBeforeFetch.map(repo => repo.id));
        const knownNow = new Set(repositoriesNow.map(repo => repo.id));
        const baselineKey = fetchedAccountId ? pushedRepoBaselineKey(fetchedAccountId) : null;
        const deletedBaseline = baselineKey ? _lastPushedRepoIds.get(baselineKey) : undefined;
        const sessionDeleted = baselineKey ? _sessionDeletedRepoIds.get(baselineKey) : undefined;
        // R2-C3：已确认取消 Star、等待后端确认删除的仓库同样不得合并回来。
        const pendingDeleted = fetchedAccountId ? pendingDeletedRepoIds(fetchedAccountId) : undefined;
        const arrivedRemotely = reposResult.value.repositories.filter(repo =>
          !knownBeforeFetch.has(repo.id)
          && !knownNow.has(repo.id)
          && !deletedBaseline?.has(repo.id)
          && !sessionDeleted?.has(repo.id)
          && !pendingDeleted?.has(repo.id)
        );
        if (arrivedRemotely.length > 0) {
          useAppStore.getState().setRepositories([...repositoriesNow, ...arrivedRemotely]);
        }
        // A completed fetch — an empty list included — proves the store is
        // complete against the server, so its queued push is safe to drain.
        _hasPendingPush = true;
      } else if (fetchedAccountId) {
        // 恢复持久待推标记后若仓库拉取失败/不完整，安排退避重试，避免后续轮询被永久跳过。
        schedulePendingAccountSyncRetry(fetchedAccountId);
      }
      // 待推分支只跳过仓库快照，但设置同样来自后端：不应用就会用本地空值
      // （如 customCategories）覆盖后端已有配置；已编辑字段通过 protectLocal 保留。
      // 第 12 轮审计修复：应用远端设置必须以同步作用域静音本机编辑订阅——
      // 否则订阅器会把后端分类写回记为本机脏键，旧回包经补推可覆盖其他设备
      // 的更新。保留既有本机脏键与后续补推行为。
      if (settingsResult.status === 'fulfilled') {
        applyBackendSettingsMuted(settingsResult.value, true);
        _lastHash.settings = quickHash(settingsResult.value);
        markSettingsLoaded(fetchedAccountId, fetchedBackendUrl);
      } else {
        // R2-C6：设置读取失败——后续推送只允许携带明确编辑过的键。
        markSettingsUnavailable(fetchedAccountId, fetchedBackendUrl);
      }
      // 待推分支同样记录 AI 配置的读取结论：读取成功后该 (账号, 后端) 的
      // 空列表推送才被允许（未读取成功时空列表不得清空后端 AI 配置）。
      // 第 12 轮审计修复：读取成功 ≠ 本机状态已对齐——本机列表为空而后端返回
      // 非空配置时，先在静音作用域内应用后端列表再标记已读取；否则后续补推会
      // 把未对齐的空列表当作已对齐状态发送，清空后端的 AI 配置。本机已有配置
      // （可能是用户编辑状态）时保持原语义。
      if (aiResult.status === 'fulfilled') {
        const backendAiConfigs = aiResult.value;
        if (useAppStore.getState().aiConfigs.length === 0 && backendAiConfigs.length > 0) {
          muteSubscriberWrites(() => {
            useAppStore.getState().setAIConfigs(backendAiConfigs);
          });
        }
        markAIConfigsLoaded(fetchedAccountId, fetchedBackendUrl);
      }
      // 第 13 轮审计修复 [49]：待推分支同样记录 WebDAV 配置的读取结论（与
      // AI 配置相同语义）——本地为空而后端返回非空配置时先在静音作用域内
      // 应用，否则后续待推补推会把未对齐的空列表发给 bulk PUT，清空后端的
      // WebDAV 配置。
      if (webdavResult.status === 'fulfilled') {
        const backendWebdavConfigs = webdavResult.value;
        if (useAppStore.getState().webdavConfigs.length === 0 && backendWebdavConfigs.length > 0) {
          muteSubscriberWrites(() => {
            useAppStore.getState().setWebDAVConfigs(backendWebdavConfigs);
          });
        }
        markWebDAVConfigsLoaded(fetchedAccountId, fetchedBackendUrl);
      }
      return { shards };
    }

    const changed = {
      repos: false, releases: false, ai: false, webdav: false,
      embedding: false, vectorSearch: false, settings: false,
    };

    // Compute hashes for each slice — only mark changed if hash differs
    const hashes: Record<string, string> = {};
    const currentReposHashKey = `${fetchedBackendUrl}|${fetchedAccountId ?? ''}`;
    if (reposComplete) {
      const hash = repositoryPayloadHash(reposResult.value.repositories);
      if (options.force || hash !== _lastHash.repos || currentReposHashKey !== _lastReposHashKey) {
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
      markSettingsLoaded(fetchedAccountId, fetchedBackendUrl);
      const hash = quickHash(settingsResult.value);
      if (options.force || hash !== _lastHash.settings) {
        hashes.settings = hash;
        changed.settings = true;
      }
    } else {
      // R2-C6：设置读取失败——后续推送只允许携带明确编辑过的键。
      markSettingsUnavailable(fetchedAccountId, fetchedBackendUrl);
    }
    // AI 配置读取成功即视为该 (账号, 后端) 已对齐：之后的推送允许按本地
    // 真实状态（含空列表）写入；读取失败/未读取时空列表推送被跳过。
    if (aiResult.status === 'fulfilled') {
      markAIConfigsLoaded(fetchedAccountId, fetchedBackendUrl);
    }
    // 第 13 轮审计修复 [49]：WebDAV 配置读取成功同样标记已对齐。
    if (webdavResult.status === 'fulfilled') {
      markWebDAVConfigsLoaded(fetchedAccountId, fetchedBackendUrl);
    }

    // Only update store if backend data actually changed
    if (!Object.values(changed).some(Boolean)) {
      _isSyncingFromBackendActive = false;
      return { shards };
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
      // R2-C3：已确认取消 Star、等待后端确认删除的仓库不得被拉取合并复活
      //（本地已重新加星时以本地为准）。过滤掉的条目排一次推送，让后端确认删除。
      const pendingDeleted = fetchedAccountId ? pendingDeletedRepoIds(fetchedAccountId) : undefined;
      const applyBaselineKey = fetchedAccountId ? pushedRepoBaselineKey(fetchedAccountId) : null;
      const applySessionDeleted = applyBaselineKey ? _sessionDeletedRepoIds.get(applyBaselineKey) : undefined;
      const localIdsNow = new Set(localRepos.map(repo => repo.id));
      const backendReposForApply = pendingDeleted && pendingDeleted.size > 0
        ? backendRepos.filter(repo => !pendingDeleted.has(repo.id) || localIdsNow.has(repo.id))
        : backendRepos;
      const pendingDeletionFiltered = backendReposForApply.length !== backendRepos.length;
      if (pendingDeletionFiltered) _hasPendingPush = true;
      // Empty backend payloads never wipe local analysis during background
      // polling. A forced login restore must apply the backend copy, including
      // an empty list, because the user explicitly asked to restore from it.
      if (!options.force && backendReposForApply.length === 0 && localRepos.length > 0) {
        _hasPendingPush = true;
      } else {
        const merged = options.force
          ? backendReposForApply
          : mergeRepositoriesPreservingLocalMetadata(backendReposForApply, localRepos);
        state.setRepositories(merged, options.force ? { allowEmpty: true } : undefined);
        // 第 14 轮审计修复 [24]：拉取静音应用远端快照后，推送基线中「本地与
        // 本次应用列表都不含、且不存在未确认本地删除记录」的仓库是远端造成的
        // 移除——从基线摘除，避免之后本机新增其他仓库的全量 PUT 依据陈旧基线
        // 把另一台设备重新添加的仓库当作本地删除物理删除。本地删除有独立的
        // _sessionDeletedRepoIds / pendingRepoDeletions 记录，基线摘除只影响
        // 「本地消失」的归因，不影响删除确认流程。
        const applyBaseline = applyBaselineKey ? _lastPushedRepoIds.get(applyBaselineKey) : undefined;
        if (applyBaseline) {
          const mergedIds = new Set(merged.map(repo => repo.id));
          const appliedIds = new Set(backendReposForApply.map(repo => repo.id));
          let baselineChanged = false;
          for (const id of [...applyBaseline]) {
            if (mergedIds.has(id) || appliedIds.has(id)) continue;
            if (applySessionDeleted?.has(id) || pendingDeleted?.has(id)) continue;
            applyBaseline.delete(id);
            baselineChanged = true;
          }
          if (baselineChanged) persistPushedRepoIds();
        }
        // Commit the RAW backend hash, not the merged one. The merge preserves
        // local-only metadata (e.g. vector_indexed_at) the backend never stores,
        // so hashing `merged` here made the next poll's backend hash differ
        // forever — re-applying setRepositories every poll cycle.
        _lastHash.repos = hashes.repos;
        _lastReposHashKey = currentReposHashKey;
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
    return { shards };
  } catch (err) {
    logger.errorFromError('sync.pullFromBackend', 'Failed to sync from backend', err, { durationMs: Date.now() - startTime });
    // 审计修复（C5）：strict 模式（throwOnRepoFailure）下仓库分片错误必须向上
    // 传播（syncFromBackend 的 Promise 拒绝，finally 清理保持不变），调用方才能
    // 感知恢复失败并停留在登录页；非严格模式（后台轮询）仍只记录不抛出。
    if (repoFetchFailure) throw repoFetchFailure;
    return null;
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
    return await currentPromise;
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
export async function syncToBackend(options: { forceVerify?: boolean } = {}): Promise<boolean> {
  return (await syncToBackendWithResult(options)).pushed;
}

/**
 * R12 跨域修复（finding 1）：按调用返回本次等待的推送结果。
 *
 * - 本次调用发起推送：结果对象由本次 `pushLatest` 链独占持有并随 promise
 *   返回，其他调用无法覆盖；
 * - 本次调用复用进行中的 `_pushPromise`（串行/去重是设计语义）：得到的是
 *   该推送链的结果；本次调用会先置 `_hasPendingPush`，推送循环在返回前会把
 *   最新本地状态再推一次，因此最终结果覆盖本次调用的编辑。
 *
 * 任何路径都不再读写模块级共享的失败分片变量。
 */
async function syncToBackendWithResult(
  options: { forceVerify?: boolean } = {},
): Promise<SyncPushResult> {
  if (_isAccountSwitchFrozen) {
    const id = accountIdKey(useAppStore.getState().user);
    if (id) _frozenWindowEditAccounts.add(id);
    return { pushed: false, attempted: false, failedShards: [] };
  }
  // 后端不可用时本次写入从未发生：显式校验推送（forceVerify）不得报告成功，
  // 必须作为「未尝试写入」返回失败；普通后台同步保持静默跳过（返回 true）。
  if (!backend.isAvailable) {
    return { pushed: !options.forceVerify, attempted: false, failedShards: [] };
  }
  if (options.forceVerify) {
    _pendingForceVerify = true;
  }
  if (_isSyncingFromBackendActive) {
    _hasPendingPush = true;
    await waitForInFlightSync();
    return syncToBackendWithResult(options);
  }
  if (_pushPromise) {
    _hasPendingPush = true;
    return _pushPromise;
  }

  const pushLatest = async (): Promise<SyncPushResult> => {
    // 清除标记必须归属本次推送的账号与后端：推送期间若会话或后端已切走，
    // 不能误清其他目标的待推状态。
    const pushAccountId = accountIdKey(useAppStore.getState().user);
    const pushBackendUrl = backend.backendUrl ?? '';
    let forceVerify = _pendingForceVerify;
    _pendingForceVerify = false;
    // 本次推送链独占的分片结果：每次 pushToBackend 尝试都会重置它，
    // 最终值即最后一次尝试的结果（与旧模块变量的「最后尝试胜出」语义一致）。
    const outcome: PushAttemptOutcome = { attempted: false, failedShards: [] };
    let succeeded = await pushToBackend({ forceVerify }, outcome);
    // Requests and edits arriving after the snapshot need a fresh push.
    // Failed writes stay pending for retry without an automatic retry loop.
    while (_hasPendingPush || (succeeded && _hasPendingLocalChanges)) {
      if (_isAccountSwitchFrozen) {
        // 第 14 轮审计修复 [17]：冻结中断推送循环——排队中的 forceVerify 未
        // 执行时，严格调用方绝不能沿用普通推送的成功结果（手动同步会误报
        // 「同步完成」）。校验保持排队，解冻后的下一次推送链会执行它。
        if (_pendingForceVerify) succeeded = false;
        break;
      }
      forceVerify = _pendingForceVerify;
      _pendingForceVerify = false;
      succeeded = await pushToBackend({ forceVerify }, outcome);
    }
    // 只有确认最新状态已全部落盘且未切换目标才清除账号级待推标记：推送期间的
    // 新编辑会在循环里再推一次，最后一轮失败时标记必须保留。
    if (
      succeeded
      && !_hasPendingLocalChanges
      && !_hasPendingPush
      && (backend.backendUrl ?? '') === pushBackendUrl
    ) {
      // 第 15 轮审计修复 [18]：整条记录确认核对最后一轮推送启动时捕获的记录
      // 版本——在途期间被冻结窗口更新过的记录必须保留（新值尚未送达）。
      clearPendingAccountSync(pushAccountId, pushBackendUrl, outcome.recordRevision);
    }
    return {
      pushed: succeeded,
      attempted: outcome.attempted,
      failedShards: [...outcome.failedShards],
    };
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
 * 仓库全量推送（跨端契约 A20x，Issue #612；审计修复 C2）：
 * `_accountsObservedBackendRepos` 的历史观察绝不能授权后续全量删除——仓库
 * 内容变化后的全量推送先 GET 服务端当前快照（记录响应中的 revision），以
 * 「服务端当前状态 ∪ 本地修改 − 本地明确删除」生成载荷，PUT 带
 * expectedRevision；409 SNAPSHOT_CONFLICT 时重新 GET→合并→重试（有界），
 * 全程保留本地明确删除集合；重试耗尽则抛出，由 pushToBackend 保留待推状态
 * 并报告失败。无内容变化的推送在 pushToBackend 中被跳过（现有行为）；
 * 服务端无新增仓库时载荷与本地快照一致（纯追加场景行为不变）。
 */
const SNAPSHOT_CONFLICT_MAX_ATTEMPTS = 3;

function isSnapshotConflictError(error: unknown): boolean {
  const e = error as { statusCode?: number; code?: string } | null;
  return !!e && (e.statusCode === 409 || e.code === 'SNAPSHOT_CONFLICT');
}

async function syncRepositoriesWithServerMerge(localRepos: Repository[], accountId: string): Promise<string> {
  let lastConflictError: unknown = null;
  let effectiveLocalRepos = localRepos;
  const pushSessionGeneration = getAccountSessionGeneration();
  const pushResetGeneration = _resetGeneration;
  // 第 12 轮审计修复：推送发起时的凭据身份——同账号凭据替换（setGitHubToken
  // 不递增会话代次）必须使旧载荷失效，代次校验单独覆盖不到这一路径。
  const pushToken = useAppStore.getState().githubToken ?? '';
  for (let attempt = 1; attempt <= SNAPSHOT_CONFLICT_MAX_ATTEMPTS; attempt += 1) {
    // 审计修复：每次 GET 之前固定目标后端地址，GET 与 PUT 校验使用同一值。
    // 若 GET 期间连接从 X 切到 Y，PUT 携带固定的 X——syncRepositories 发现
    // 与当前连接不一致会在写入前抛错，绝不让 X 的合并快照覆盖 Y 的分区。
    const targetBackendUrl = backend.backendUrl ?? '';
    // 第 13 轮审计修复 [107]：分页读取显式固定目标账号分区（accountId 在作用
    // 域内）——缺省时请求头缺失会让服务端逐页回退全局 active_account_id，
    // 两页之间活跃账号切换可能拼接两个分区的结果。
    const remote = await backend.fetchRepositories(accountId);
    // 分页截断/不完整的响应不是完整快照：据此推送会物理删除未读到的远端仓库。
    if (remote.repositories.length < (remote.total ?? remote.repositories.length)) {
      logger.warn('sync.pushToBackend', 'Deferred full push: backend repository snapshot is incomplete', {
        accountId,
        fetched: remote.repositories.length,
        total: remote.total,
      });
      throw new Error('Incomplete backend repository snapshot');
    }
    markAccountBackendReposObserved(accountId);
    // 第 14 轮审计修复 [16]：每次对账前重新验证本地仓库快照——SNAPSHOT_CONFLICT
    // 重试沿用发起时的旧载荷会把等待期间用户重新加星/新增的仓库排除在 PUT 之外
    //（远端仍在的仓库被当作本地删除物理删除，且删除时清理的发行记录无法保证
    // 恢复）。快照已变化时放弃旧载荷，以当前快照重新对账。
    const currentLocalRepos = useAppStore.getState().repositories;
    if (currentLocalRepos !== effectiveLocalRepos) effectiveLocalRepos = currentLocalRepos;
    const localIds = new Set(effectiveLocalRepos.map((repo) => repo.id));
    // 上次成功推送后本地消失的仓库 + 本会话内本地删除的仓库 = 用户显式删除，
    // 即使尚无历史基线，也不得因远端仍有而复活。
    const baselineKey = pushedRepoBaselineKey(accountId);
    const deletedBaseline = baselineKey ? _lastPushedRepoIds.get(baselineKey) : undefined;
    const sessionDeleted = baselineKey ? _sessionDeletedRepoIds.get(baselineKey) : undefined;
    // R2-C3：后端确认前的显式删除记录同样从服务端保留集合中排除——即使
    // 发起账号没有任何推送基线（切号期间确认的 unstar）。
    const pendingDeleted = pendingDeletedRepoIds(accountId);
    // 快照本次 PUT 实际处理的删除集合，成功后仅清除这批已确认删除，保留请求在途新增的删除记录
    const confirmedSessionDeleted = sessionDeleted ? new Set(sessionDeleted) : null;
    // 本次 PUT 没有待删项时必须传空集合而不是 null/undefined：null 会让
    // clearPendingRepositoryDeletions 清空整个待删集合，把 PUT 发出后新增的
    // 删除记录一并抹掉（补推前应用重启会让后端快照复活已删仓库）。
    const confirmedPendingDeleted = new Set(pendingDeleted ?? []);
    const remoteById = new Map(remote.repositories.map((repo) => [repo.id, repo]));
    // 合并同一仓库时保留远端更新更晚的用户编辑字段，避免未编辑的旧本地副本覆盖另一设备的更新
    const mergedLocalRepos = effectiveLocalRepos.map((localRepo) => {
      const remoteRepo = remoteById.get(localRepo.id);
      if (!remoteRepo) return localRepo;
      const remoteEditedNewer = Boolean(remoteRepo.last_edited)
        && (!localRepo.last_edited || remoteRepo.last_edited! > localRepo.last_edited);
      if (!remoteEditedNewer) return localRepo;
      return {
        ...localRepo,
        custom_description: remoteRepo.custom_description,
        custom_tags: remoteRepo.custom_tags,
        custom_category: remoteRepo.custom_category,
        category_locked: remoteRepo.category_locked,
        description_display: remoteRepo.description_display,
        tags_display: remoteRepo.tags_display,
        last_edited: remoteRepo.last_edited,
      };
    });
    const serverKept = remote.repositories.filter((repo) => (
      !localIds.has(repo.id)
      && !deletedBaseline?.has(repo.id)
      && !sessionDeleted?.has(repo.id)
      && !pendingDeleted?.has(repo.id)
    ));
    const payload = [...mergedLocalRepos, ...serverKept];
    // 第 12 轮审计修复：GET 快照与全量 PUT 之间重新校验会话——切号/切代次/
    // 同账号凭据替换都使旧载荷失效，校验失败时抛错保留待推状态，绝不发送
    // PUT。连接校验（目标地址 vs 当前连接）由 backend.syncRepositories 在
    // 写入前兜底（原注释的「连接变化后在写入前失败」此前只对后端地址成立）。
    const sessionValidBeforePut = _resetGeneration === pushResetGeneration
      && getAccountSessionGeneration() === pushSessionGeneration
      && accountIdKey(useAppStore.getState().user) === accountId
      && (useAppStore.getState().githubToken ?? '') === pushToken;
    if (!sessionValidBeforePut) {
      throw new Error('Repository push aborted: account session changed between snapshot fetch and write');
    }
    try {
      await backend.syncRepositories(payload, {
        expectedRevision: remote.revision ?? null,
        ...(targetBackendUrl ? { backendUrl: targetBackendUrl } : {}),
        ...(accountId ? { accountId } : {}),
      });
      // 推送成功：写入已推送基线前校验会话代次与重置代次——若期间发生清空全部数据
      // 或切换账号，绝不用旧 localIds 重建 gsm.pushedRepoIdsV2。
      const sessionStillValid = _resetGeneration === pushResetGeneration
        && getAccountSessionGeneration() === pushSessionGeneration
        && accountIdKey(useAppStore.getState().user) === accountId;
      if (sessionStillValid) {
        if (baselineKey) {
          _lastPushedRepoIds.set(baselineKey, new Set(localIds));
          const liveSessionDeleted = _sessionDeletedRepoIds.get(baselineKey);
          if (liveSessionDeleted && confirmedSessionDeleted) {
            for (const id of confirmedSessionDeleted) liveSessionDeleted.delete(id);
            if (liveSessionDeleted.size === 0) _sessionDeletedRepoIds.delete(baselineKey);
          }
          persistPushedRepoIds();
        }
        clearPendingRepositoryDeletions(accountId, targetBackendUrl, confirmedPendingDeleted);
      }
      // 第 15 轮审计修复 [16]：返回本次成功 PUT 对应的本地快照指纹——不能
      // 用推送发起时的快照（GET 等待期间新增的仓库已随 PUT 写入）或合并载荷
      //（含仅远端仓库）作为去重基线，否则 PUT 等待期间的本地删除会被误判
      //「已同步」而漏写。
      return repositoryPayloadHash(effectiveLocalRepos);
    } catch (err) {
      if (!isSnapshotConflictError(err) || attempt === SNAPSHOT_CONFLICT_MAX_ATTEMPTS) {
        throw err;
      }
      lastConflictError = err;
      logger.warn('sync.pushToBackend', 'Full push conflicted with the server snapshot; re-fetching and retrying', {
        accountId,
        attempt,
        maxAttempts: SNAPSHOT_CONFLICT_MAX_ATTEMPTS,
      });
    }
  }
  // 重试耗尽：不推送、保留待推状态（pushToBackend 据失败返回值/异常上报）
  throw lastConflictError instanceof Error
    ? lastConflictError
    : new Error('Repository full sync failed after snapshot conflict retries');
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
  const expectedGeneration = _syncGeneration;
  _pushRetryTimer = setTimeout(() => {
    _pushRetryTimer = null;
    if (_syncGeneration !== expectedGeneration) return;
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
async function pushToBackend(
  options: { forceVerify?: boolean } = {},
  // R2-C5/C41 + R12 finding 1：失败分片信息归属于本次推送尝试。结果对象由
  // 调用链（pushLatest）独占持有，绝不写入模块级共享变量——任何提前返回
  //（空工作区未对齐、无活跃账号、后端已切换）都表示「未尝试写入」，在入口
  // 重置本次尝试的分片列表即可，不会影响其他调用的结果。
  outcome: PushAttemptOutcome = { attempted: false, failedShards: [] },
): Promise<boolean> {
  outcome.attempted = false;
  outcome.failedShards = [];
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
  const pushGeneration = _syncGeneration;
  // 第 15 轮审计修复 [15]：发起推送时捕获重置代次——清空全部数据（递增
  // _resetGeneration）发生在推送在途期间时，旧请求的完成回调只结算给发起它
  // 的调用方，绝不写回全局指纹、待推标志或重试计时器（否则清空后的状态被
  // 旧请求复活，或污染新会话的去重基线）。
  const pushResetGeneration = _resetGeneration;
  const pushStartTime = Date.now();
  try {
    // 等一个微任务再取快照（与旧版对账 await 的时序等价）：同一宏任务内、
    // push 发起之后的本地编辑也应包含在本次推送中。
    await Promise.resolve();
    const pushAccountId = accountIdKey(useAppStore.getState().user);
    const pushBackendUrl = backend.backendUrl ?? '';
    // 无活跃账号时请求头缺失，服务端会回退全局 active_account_id——绝不能把
    // 无归属会话的列表写进任意分区。
    if (!pushAccountId) {
      _hasPendingPush = false;
      _hasPendingLocalChanges = true;
      return false;
    }
    if ((backend.backendUrl ?? '') !== pushBackendUrl) {
      _hasPendingLocalChanges = true;
      return false;
    }
    // R12 finding 3：重试有待推记录的后端时，先把归属于该 (账号, 后端) 的
    // 待推设置值写回工作区，再取快照构造载荷——否则发送的是另一后端覆盖后
    // 的值，用户在原后端的编辑会永久丢失。
    if (pushAccountId) restorePendingSettingValues(pushAccountId, pushBackendUrl);
    // 第 14 轮审计修复 [18]：先恢复冻结窗口持久化的待推脏键，再构造设置载荷
    // ——customCategories 只在脏键命中时随完整载荷发送（[51]），恢复顺序颠倒
    // 会让恢复的字段被排除在载荷外，而写入成功的确认逻辑按版本快照清除待推
    // 记录，会把未发送字段当作已写入，冻结窗口的编辑永久丢失。恢复键分配新
    // 版本（R2-C2），随后捕获的版本快照覆盖它们，确认逻辑只清除实际发送的键。
    if (pushAccountId && hasPendingAccountSync(pushAccountId)) {
      restorePendingSettingDirtyKeys(pushAccountId);
    }
    const state = useAppStore.getState();
    const forceVerify = options.forceVerify === true;
    // 仓库分片未变化（例如只改了设置）时不要发送 isFullSync 全量快照：
    // 陈旧快照会删除其他设备在该分区新增的仓库。
    // 手动「同步到后端」(forceVerify) 必须强制对账推送，防止后端重置后误报成功。
    const reposHash = repositoryPayloadHash(state.repositories);
    const currentReposHashKey = `${pushBackendUrl}|${pushAccountId}`;
    const reposUnchanged = !forceVerify && reposHash === _lastHash.repos && currentReposHashKey === _lastReposHashKey;
    const skipped = Symbol('skipped');

    const fullSettingsPayload = {
      activeAIConfig: state.activeAIConfig,
      activeWebDAVConfig: state.activeWebDAVConfig,
      activeEmbeddingConfig: state.activeEmbeddingConfig,
      hiddenDefaultCategoryIds: state.hiddenDefaultCategoryIds,
      categoryOrder: state.categoryOrder,
      // 第 13 轮审计修复 [51]：customCategories 是账号级跨设备键，服务端
      // PUT /api/settings 对其 INSERT OR REPLACE 且无版本校验——完整载荷会把
      // 本机此前拉取到的旧值写回后端，覆盖其他设备在拉取之后保存的新值
      // （待推补推可能比拉取晚得多）。只有本机明确编辑过（脏键命中）时才随
      // 完整载荷发送；未编辑时省略该键，服务端保留现有值。
      ...(_dirtySettingKeys.has('customCategories') ? { customCategories: state.customCategories } : {}),
      assetFilters: state.assetFilters,
      defaultCategoryOverrides: state.defaultCategoryOverrides,
      releaseSourceSettings: state.releaseSourceSettings,
      collapsedSidebarCategoryCount: state.collapsedSidebarCategoryCount,
    };
    // R2-C6：按 (账号, 后端) 正向记录成功加载状态；首次成功读取前先恢复持久化脏键，
    // 仅发送明确编辑过的字段，避免把本地默认值（如空 customCategories）作为完整快照推送。
    // （脏键恢复已前移到载荷构造之前，见第 14 轮审计修复 [18]。）
    // R2-C2：在构造设置请求的同一时刻记录脏键版本快照——必须先恢复持久化脏键
    //（恢复会为这些键分配新版本）再捕获版本，否则恢复键与快照版本不匹配，
    // 本次 PUT 已确认的值会被保留为待推，重试可能把旧值重新发送到后端。
    const dirtySettingVersionsAtPush = snapshotDirtySettingVersions();
    const targetSettingsKey = settingsLoadedKey(pushAccountId, pushBackendUrl);
    // 当前 (账号, 后端) 尚未成功读取过设置（含读取失败）时一律按不可用处理：
    // 只发送显式编辑过的脏键，没有脏键就跳过设置写入——从未读取成功的本地
    // 默认值（如空 customCategories）绝不能作为完整快照推送覆盖后端配置。
    const settingsUnavailable = _settingsUnavailableKeys.has(targetSettingsKey)
      || !_settingsLoadedKeys.has(targetSettingsKey);
    const settingsPayload = settingsUnavailable
      ? Object.fromEntries(
          Object.entries(fullSettingsPayload).filter(([key]) => _dirtySettingKeys.has(key)),
        )
      : fullSettingsPayload;
    const settingsSkipped = settingsUnavailable && Object.keys(settingsPayload).length === 0;
    // 第 15 轮审计修复 [18]：捕获请求启动时的待推记录版本与本次发送的设置值
    // ——成功确认据此判断请求在途期间记录是否被更新（例如冻结窗口保存了新值）。
    outcome.recordRevision = getPendingSyncRecordRevision(
      pendingSyncCompositeKey(pushAccountId, pushBackendUrl),
    );
    outcome.sentSettingValues = settingsPayload as Record<string, unknown>;
    // 第 12 轮审计修复：手动同步（forceVerify）在设置分片尚未对齐时不得把
    // 「仅写入脏键子集」报告为完整成功——其余设置既未校验也未写入。部分写入
    // 本身保留（安全：只含本机明确编辑过的键），但结果按未完成上报：手动调用
    // 方（设置页）不会误报「同步完成」，与无脏键时拒绝并报错的既有行为一致
    //（设置未对齐的手动同步一律不报告完整成功），也绝不为获得成功结果发送
    // 未对齐的默认值。
    const settingsManualUnverified = forceVerify && settingsUnavailable;
    // 审计修复（PR #612）：当前 (账号, 后端) 尚未成功读取过 AI 配置时，本地空
    // 数组不代表「无配置」——跳过写入，防止 bulk PUT 清空该分区的全部 AI 配置。
    // 列表非空或已对齐时按原语义推送。
    const aiConfigsAligned = _aiConfigsLoadedKeys.has(settingsLoadedKey(pushAccountId, pushBackendUrl));
    const aiSkipped = !aiConfigsAligned && state.aiConfigs.length === 0;
    if (aiSkipped) {
      logger.warn('sync.pushToBackend', 'Skipped AI configs push: local list is empty and backend configs have not been read yet', {
        accountId: pushAccountId,
        backendUrl: pushBackendUrl,
      });
    }
    // 第 13 轮审计修复 [49]：WebDAV 配置与 AI 配置相同的对齐门控——本地为空
    // 且该 (账号, 后端) 尚未成功读取过配置时跳过推送，防止待推补推以空列表
    // 覆盖（服务端 bulk PUT 先 DELETE 全表再插入零行）远端已有配置。
    const webdavConfigsAligned = _webdavConfigsLoadedKeys.has(settingsLoadedKey(pushAccountId, pushBackendUrl));
    const webdavSkipped = !webdavConfigsAligned && state.webdavConfigs.length === 0;
    if (webdavSkipped) {
      logger.warn('sync.pushToBackend', 'Skipped WebDAV configs push: local list is empty and backend configs have not been read yet', {
        accountId: pushAccountId,
        backendUrl: pushBackendUrl,
      });
    }
    // 第 14 轮审计修复 [14]：forceVerify 模式下，因 AI/WebDAV 配置读取失败而
    // 安全跳过的配置分片视为未验证——skipped 是已兑现结果，不报告会让设置页
    // 把「未校验」显示为「同步成功」。自动推送保留现有保护（跳过不视为失败）。
    const aiManualUnverified = forceVerify && aiSkipped;
    const webdavManualUnverified = forceVerify && webdavSkipped;
    const manualUnverifiedShards = [
      ...(settingsManualUnverified ? ['settings' as const] : []),
      ...(aiManualUnverified ? ['aiConfigs' as const] : []),
      ...(webdavManualUnverified ? ['webdavConfigs' as const] : []),
    ];

    // 从这里开始本次推送确实发出了写入尝试（R2-C5）。
    outcome.attempted = true;
    const results = await Promise.allSettled([
      // 跨端契约 A20x（审计修复 C2）：内容变化的全量推送经服务端快照合并
      // （GET → 服务端状态 ∪ 本地修改 − 本地明确删除 → PUT expectedRevision →
      // 409 有界重试），绝不再以「本会话曾观察过远端」授权全量删除。
      reposUnchanged ? Promise.resolve(skipped) : syncRepositoriesWithServerMerge(state.repositories, pushAccountId),
      backend.syncReleases(state.releases),
      aiSkipped ? Promise.resolve(skipped) : backend.syncAIConfigs(state.aiConfigs),
      webdavSkipped ? Promise.resolve(skipped) : backend.syncWebDAVConfigs(state.webdavConfigs),
      backend.syncEmbeddingConfigs(state.embeddingConfigs),
      backend.syncVectorSearchConfig(state.vectorSearchConfig),
      settingsSkipped
        ? (forceVerify
          ? Promise.reject(new Error('Settings not yet aligned with backend'))
          : Promise.resolve(skipped))
        : backend.syncSettings(settingsPayload),
    ]);
    const [reposSync, releasesSync, aiSync, webdavSync, embeddingSync, vectorSearchSync, settingsSync] = results;

    // 第 15 轮审计修复 [15]：推送在途期间清空了全部数据——结果只结算给旧
    // 调用方（含失败分片信息），不更新任何全局状态：待推标志/重试计时器已由
    // clearPendingSyncState 清空，指纹基线属于被清空前的会话，写回会让排队
    // 推送误判「已同步」。
    if (_resetGeneration !== pushResetGeneration) {
      outcome.failedShards = results.flatMap((result, index) => (
        result.status === 'rejected' ? [PUSH_SHARD_NAMES[index]] : []
      ));
      for (const shard of manualUnverifiedShards) {
        if (!outcome.failedShards.includes(shard)) {
          outcome.failedShards = [...outcome.failedShards, shard];
        }
      }
      return results.every(result => result.status === 'fulfilled') && manualUnverifiedShards.length === 0;
    }

    const failures = results.filter(r => r.status === 'rejected');
    if (failures.length > 0) {
      // 记录失败分片名（审计修复 C41）：forceSyncToBackend(reportFailures) 抛错时
      // 附带给调用方，用于按分片判断是否回滚本地乐观变更。
      outcome.failedShards = results.flatMap((result, index) => (
        result.status === 'rejected' ? [PUSH_SHARD_NAMES[index]] : []
      ));
      for (const shard of manualUnverifiedShards) {
        if (!outcome.failedShards.includes(shard)) {
          outcome.failedShards = [...outcome.failedShards, shard];
        }
      }
      logger.warn('sync.pushToBackend', `Synced to backend with ${failures.length} error(s)`, { failureCount: failures.length, durationMs: Date.now() - pushStartTime });
      _hasPendingLocalChanges = true;
      // 审计修复（C3）：部分分片失败（如仓库 PUT 成功但设置 PUT 失败）时安排
      // 退避重试——pushLatest 的 while 循环在整体失败（succeeded=false）时退出，
      // 没有重试调度会让失败分片永远不再自动送达。已成功分片的确认状态由
      // 各分片的哈希/基线提交保留，重试不会重复处理已确认分片。
      if (_syncGeneration === pushGeneration) {
        schedulePendingAccountSyncRetry(pushAccountId);
      }
    } else if (manualUnverifiedShards.length > 0) {
      // 第 12 轮审计修复：所有已发分片成功但设置未对齐——按未完成上报（含
      // 分片名供调用方诊断），保留待推状态等待设置对齐后的完整写入。
      // 第 13 轮审计修复 [48]：不再置 _hasPendingLocalChanges——该标志表示
      // 「还有编辑未写入」，会拦截下一次普通拉取；而本次已确认写入的脏键在
      // 上方被清理，没有编辑却拦截拉取会让设置永远无法自动对齐（死锁）。
      // 已确认写入的部分安全保留；轮询的下一次普通拉取重新读取设置完成对齐
      //（markSettingsLoaded），请求在途期间的新编辑仍由脏键保护在读取时保留。
      // 第 14 轮审计修复 [14]：AI/WebDAV 因未对齐而跳过的分片同样按未验证
      // 上报（自动推送不受影响，保留对未对齐空列表的保护）。
      logger.warn('sync.pushToBackend', 'Manual sync finished with unverified shards; skipped shards are not yet aligned with the backend', {
        accountId: pushAccountId,
        backendUrl: pushBackendUrl,
        unverifiedShards: [...manualUnverifiedShards],
        durationMs: Date.now() - pushStartTime,
      });
      outcome.failedShards = [...outcome.failedShards, ...manualUnverifiedShards];
    } else {
      logger.info('sync.pushToBackend', 'Synced to backend', { durationMs: Date.now() - pushStartTime });
      _pushRetryDelay = 2000;
    }

    // Only update _lastHash for successfully synced slices.
    // Hash the raw pushed payload (local-only fields like vector_indexed_at are
    // never stored by the backend), so the next pull compares against the same
    // projection and doesn't re-apply setRepositories after a push.
    // （推送基线与会话删除集合由 syncRepositoriesWithServerMerge 在成功时按
    // 实际写入载荷提交——合并保留下来的远端仓库也在基线内。）
    if (reposSync.status === 'fulfilled' && reposSync.value !== skipped) {
      // 第 15 轮审计修复 [16]：使用对账函数返回的「成功 PUT 对应的本地快照
      // 指纹」——推送发起时捕获的 reposHash 已因等待期间的本地增删而过期。
      _lastHash.repos = reposSync.value;
      _lastReposHashKey = currentReposHashKey;
    }
    if (releasesSync.status === 'fulfilled') _lastHash.releases = quickHash(state.releases);
    // 跳过的 AI 分片未发生写入：不得把本地（空）哈希记为已同步基线，否则
    // 下次拉取的对账会误判「后端已与本地一致」。
    if (aiSync.status === 'fulfilled' && aiSync.value !== skipped) _lastHash.ai = quickHash(state.aiConfigs);
    // 第 13 轮审计修复 [49]：跳过的 WebDAV 分片未发生写入，与 AI 分片相同——
    // 不得把本地（空）哈希记为已同步基线，否则下次拉取的对账会误判「后端已
    // 与本地一致」。
    if (webdavSync.status === 'fulfilled' && webdavSync.value !== skipped) _lastHash.webdav = quickHash(state.webdavConfigs);
    if (embeddingSync.status === 'fulfilled') _lastHash.embedding = quickHash(state.embeddingConfigs);
    if (vectorSearchSync.status === 'fulfilled') _lastHash.vectorSearch = vectorSearchFingerprint(state.vectorSearchConfig);
    if (settingsSync.status === 'fulfilled' && settingsSync.value !== skipped) {
      // 审计修复（C4）：先基于仍保留在 _dirtySettingKeyVersions 中的编辑版本更新持久化记录，
      // 再按 pushedVersion 匹配清除内存版本，保留请求在途期间产生的新版本。
      clearPendingSettingDirtyKeys(pushAccountId, pushBackendUrl, dirtySettingVersionsAtPush, {
        recordRevision: outcome.recordRevision,
        sentValues: outcome.sentSettingValues,
      });
      // 第 15 轮审计修复 [18]：字段确认本身是记录的一次合法写入——同步抬高
      // 本次推送的版本基线，否则随后的整条记录确认会把自己的写入误判为
      // 「并发更新」而永远保留记录。
      outcome.recordRevision = getPendingSyncRecordRevision(
        pendingSyncCompositeKey(pushAccountId, pushBackendUrl),
      );
      for (const [dirtyKey, pushedVersion] of dirtySettingVersionsAtPush) {
        if ((_dirtySettingKeyVersions.get(dirtyKey) ?? 0) !== pushedVersion) continue;
        _dirtySettingKeys.delete(dirtyKey);
        _dirtySettingKeyVersions.delete(dirtyKey);
      }
      // 只有完整设置载荷写入成功才把「已推送快照」记为已同步；部分载荷
      // （R2-C6 读取失败场景的脏键子集）不能代表其余字段已与后端一致。
      if (!settingsUnavailable) {
        _lastHash.settings = quickHash(fullSettingsPayload);
      }
    }
    // 第 12 轮审计修复：手动同步在设置未对齐时不得报告完整成功（部分脏键
    // 写入已完成，但其余设置未校验未写入）。第 14 轮审计修复 [14]：因未对齐
    // 而跳过的 AI/WebDAV 分片在 forceVerify 下同样不报告完整成功。
    return failures.length === 0 && manualUnverifiedShards.length === 0;
  } catch (err) {
    logger.errorFromError('sync.pushToBackend', 'Failed to sync to backend', err, { durationMs: Date.now() - pushStartTime });
    // 第 15 轮审计修复 [15]：清空数据后的旧请求失败不得复活待推标志。
    if (_resetGeneration === pushResetGeneration) {
      _hasPendingLocalChanges = true;
    }
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
export async function forceSyncToBackend(options: { reportFailures?: boolean; forceVerify?: boolean } = {}): Promise<boolean> {
  if (_debounceTimer) {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
  }
  _hasPendingLocalChanges = true;
  // R12 跨域修复（finding 1）：分片结果随本次调用返回，不再读取模块级共享
  // 变量。本次调用或复用的推送链若因冻结窗口/不可用后端提前返回（未尝试
  // 写入），结果为 attempted=false 且 failedShards 为空，绝不混入其他推送。
  const result = await syncToBackendWithResult({ forceVerify: options.forceVerify });
  if (!result.pushed && options.reportFailures) {
    // 审计修复（C41/R2-C5）：附带本次推送实际失败的分片名与「是否尝试写入」。
    // 提前返回（未尝试写入）时 failedShards 必为空数组，调用方据 pushAttempted
    // 区分「未执行」与「关键分片成功但辅助分片失败」，仅在确认尝试过写入后
    // 才按辅助分片失败跳过回滚。
    const error = new Error('Failed to sync to backend') as Error & {
      failedShards?: string[];
      pushAttempted?: boolean;
    };
    error.failedShards = [...result.failedShards];
    error.pushAttempted = result.attempted;
    throw error;
  }
  return result.pushed;
}

/**
 * 比较设置字段快照，返回本次变化过的设置键（审计修复 C4/C6 共用）：
 * 正常路径、普通切换守卫窗口与冻结窗口的设置编辑都必须记录脏键——
 * 守卫释放后的补推与重启后的拉取合并据此区分「本地已编辑」与「后端值」。
 */
function collectDirtySettingKeys(next: Record<string, unknown>, prev: Record<string, unknown>): string[] {
  const dirty: string[] = [];
  for (const key of SETTING_DIRTY_KEYS) {
    if (next[key] !== prev[key]) dirty.push(key);
  }
  return dirty;
}

/**
 * Subscribe to Zustand store changes and auto-push to backend with 2s debounce.
 * Returns an unsubscribe function for cleanup.
 */
export function startAutoSync(): () => void {
  _syncGeneration += 1;
  // 审计修复（C7）：新一代启动时清掉旧代次的退避重试计时器并重置退避状态，
  // 否则旧计时器回调因代次不匹配直接返回，而新代次的
  // schedulePendingAccountSyncRetry 又被 _pushRetryTimer 占位拦住——
  // 新一代对账失败后永远排不上自己的重试。
  if (_pushRetryTimer) {
    clearTimeout(_pushRetryTimer);
    _pushRetryTimer = null;
  }
  _pushRetryDelay = 2000;
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
        // 审计修复（C6/C4）：窗口内的真实设置编辑与正常路径走同一套脏键记录
        // 逻辑（继续排除工作区回放与后端拉取应用）——否则守卫释放后的补推
        // 不带设置分片，重启后的拉取也无法区分本地已编辑字段。
        const dirtySettingKeys = collectDirtySettingKeys(
          state as unknown as Record<string, unknown>,
          prevState as unknown as Record<string, unknown>,
        );
        if (_isAccountSwitchFrozen) {
          // 冻结窗口（候选后端恢复，R4 审计修复）：真实编辑只记入窗口缓冲并
          // 按编辑时的活跃账号归属——绝不置会话级待推（守卫退出会立即推送，
          // 而此时连接可能指向候选后端，旧账号工作区绝不能外发）。窗口退出
          // 时按恢复结果分流（见 withAccountSwitchFrozen）。归属取写入后
          // 状态的 user：归档（park）前的编辑归属本机旧账号——正是发起恢复、
          // 需要补推的账号。
          const editUserId = state.user?.id;
          if (typeof editUserId === 'number' && Number.isFinite(editUserId)) {
            const editAccountId = String(editUserId);
            _frozenWindowEditAccounts.add(editAccountId);
            if (dirtySettingKeys.length > 0) {
              const windowKeys = _frozenWindowDirtySettingKeys.get(editAccountId)
                ?? new Set<string>();
              // R12 finding 3：同时保存编辑后的值。窗口退出后目标后端（Y）的
              // 拉取会覆盖本地工作区，仅记录脏键无法在切回原后端（X）时恢复
              // 用户当时的设置内容。
              const windowValues = _frozenWindowDirtySettingValues.get(editAccountId) ?? {};
              // 第 14 轮审计修复 [12]：同时记录本次编辑的字段版本——窗口退出
              // 顺序不代表编辑顺序，合并时只接受版本更新的值（外层窗口晚于
              // 内层退出时，陈旧值不得覆盖内层稍后保存的新值）。
              const windowVersions = _frozenWindowDirtySettingVersions.get(editAccountId)
                ?? new Map<string, number>();
              _frozenEditVersionSeq += 1;
              const editVersion = _frozenEditVersionSeq;
              const editState = state as unknown as Record<string, unknown>;
              for (const key of dirtySettingKeys) {
                windowKeys.add(key);
                // 同一键在窗口内多次编辑时保留最后一次写入的值。
                if (editState[key] !== undefined) windowValues[key] = editState[key];
                windowVersions.set(key, editVersion);
              }
              _frozenWindowDirtySettingKeys.set(editAccountId, windowKeys);
              _frozenWindowDirtySettingValues.set(editAccountId, windowValues);
              _frozenWindowDirtySettingVersions.set(editAccountId, windowVersions);
            }
          }
        } else {
          markDirtySettingKeys(dirtySettingKeys);
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

    // 同一账号下本地明确删除的仓库（即使尚无历史基线），在对齐合并时绝不复活。
    const activeId = accountIdKey(state.user);
    if (activeId && activeId === accountIdKey(prevState.user) && state.repositories !== prevState.repositories) {
      const nextIds = new Set(state.repositories.map((r) => r.id));
      const baselineKey = pushedRepoBaselineKey(activeId);
      if (baselineKey) {
        let pendingChanged = false;
        let pendingSet = _pendingRepoDeletions.get(baselineKey);
        for (const prevRepo of prevState.repositories) {
          if (!nextIds.has(prevRepo.id)) {
            let deletedSet = _sessionDeletedRepoIds.get(baselineKey);
            if (!deletedSet) {
              deletedSet = new Set();
              _sessionDeletedRepoIds.set(baselineKey, deletedSet);
            }
            deletedSet.add(prevRepo.id);
            // R2-C3：同账号删除同样持久化登记（跨重启仍有依据），后端确认
            // 推送成功后清除。
            if (!pendingSet) {
              pendingSet = new Set<number>();
              _pendingRepoDeletions.set(baselineKey, pendingSet);
            }
            if (!pendingSet.has(prevRepo.id)) {
              pendingSet.add(prevRepo.id);
              pendingChanged = true;
            }
          }
        }
        if (pendingChanged) persistPendingRepoDeletions();
      }
    }
    // R2-C2：正常路径的脏键同样复用 SETTING_DIRTY_KEYS 清单并带编辑版本记录，迟到成功响应无法误清。
    const dirtySettingKeys = collectDirtySettingKeys(
      state as unknown as Record<string, unknown>,
      prevState as unknown as Record<string, unknown>,
    );
    markDirtySettingKeys(dirtySettingKeys);

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
  _syncGeneration += 1;
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
