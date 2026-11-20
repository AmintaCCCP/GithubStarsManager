import type {
  AccountWorkspace,
  Category,
  ForkRepo,
  Gist,
  GistCategoryId,
  GitHubUser,
  Release,
  ReleaseSourceSettings,
  Repository,
  SavedAccount,
  SyncMode,
} from '../../types';
import { defaultReleaseSourceSettings } from '../../types';
import { normalizeReleaseSourceSettings } from '../../utils/releaseSources';
import { useAppStore } from '../useAppStore';

export type { AccountWorkspace };

export interface AccountWorkspaceRuntime {
  repositories: Repository[];
  lastSync: string | null;
  gists: Gist[];
  starredGists: Gist[];
  gistSearchResults: Gist[];
  selectedGistCategory: GistCategoryId;
  searchResults: Repository[];
  similarView: null;
  analyzingGistIds: Set<string>;
  analyzingRepositoryIds: Set<number>;
  releases: Release[];
  releaseSubscriptions: Set<number>;
  releaseSourceSettings: ReleaseSourceSettings;
  readReleases: Set<number>;
  forks: ForkRepo[];
  readForks: Set<number>;
  customCategories: Category[];
  hiddenDefaultCategoryIds: string[];
  categoryOrder: string[];
  defaultCategoryOverrides: Record<string, Partial<Category>>;
  categoryListIdMap: Record<string, string>;
  syncMode: SyncMode;
  syncModeConfigured: boolean;
}

export interface AccountWorkspaceSource {
  repositories: Repository[];
  lastSync: string | null;
  gists: Gist[];
  starredGists: Gist[];
  selectedGistCategory: GistCategoryId;
  releases: Release[];
  releaseSubscriptions: Set<number>;
  releaseSourceSettings: ReleaseSourceSettings;
  readReleases: Set<number>;
  forks: ForkRepo[];
  readForks: Set<number>;
  customCategories: Category[];
  hiddenDefaultCategoryIds: string[];
  categoryOrder: string[];
  defaultCategoryOverrides: Record<string, Partial<Category>>;
  categoryListIdMap: Record<string, string>;
  syncMode: SyncMode;
  syncModeConfigured: boolean;
}

const numberSetToArray = (value: Set<number> | unknown): number[] => (
  value instanceof Set
    ? Array.from(value)
    : Array.isArray(value)
      ? value.filter((item): item is number => typeof item === 'number')
      : []
);

export const shouldPreserveExisting = <T>(
  incoming: T[] | undefined,
  existing: T[],
  allowEmpty = false,
): boolean => incoming !== undefined && incoming.length === 0 && existing.length > 0 && !allowEmpty;

export const accountIdKey = (user: Pick<GitHubUser, 'id'> | number | null | undefined): string | null => {
  const id = typeof user === 'number' ? user : user?.id;
  return typeof id === 'number' && Number.isFinite(id) ? String(id) : null;
};

/**
 * 带引用保留的类型过滤：过滤后长度不变说明所有元素都通过校验且顺序一致
 * （filter 只会按序保留子集），此时直接返回原数组引用。
 * 分片持久化按字段引用判脏——规整化若总是重建数组，每次启动都会把
 * accountWorkspaces 分片误判为已变更而全量重写。
 */
const filterPreservingRef = <T>(value: unknown, predicate: (item: unknown) => item is T): T[] => {
  if (!Array.isArray(value)) return [];
  const filtered = value.filter(predicate);
  return filtered.length === value.length ? (value as T[]) : filtered;
};

export const normalizeAccountWorkspaces = (value: unknown): Record<string, AccountWorkspace> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const empty = emptyAccountWorkspace();
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([key, workspace]) => {
      if (!key || !workspace || typeof workspace !== 'object' || Array.isArray(workspace)) return [];
      const record = workspace as Record<string, unknown>;
      return [[key, {
        ...empty,
        repositories: Array.isArray(record.repositories) ? record.repositories : [],
        lastSync: typeof record.lastSync === 'string' ? record.lastSync : null,
        gists: Array.isArray(record.gists) ? record.gists : [],
        starredGists: Array.isArray(record.starredGists) ? record.starredGists : [],
        selectedGistCategory: record.selectedGistCategory === 'starred' || record.selectedGistCategory === 'mine'
          ? record.selectedGistCategory
          : 'all',
        releases: Array.isArray(record.releases) ? record.releases : [],
        releaseSubscriptions: filterPreservingRef(
          record.releaseSubscriptions,
          (item): item is number => typeof item === 'number',
        ),
        releaseSourceSettings: normalizeReleaseSourceSettings(record.releaseSourceSettings),
        readReleases: filterPreservingRef(
          record.readReleases,
          (item): item is number => typeof item === 'number',
        ),
        forks: Array.isArray(record.forks) ? record.forks : [],
        readForks: filterPreservingRef(
          record.readForks,
          (item): item is number => typeof item === 'number',
        ),
        customCategories: Array.isArray(record.customCategories) ? record.customCategories : [],
        hiddenDefaultCategoryIds: filterPreservingRef(
          record.hiddenDefaultCategoryIds,
          (item): item is string => typeof item === 'string',
        ),
        categoryOrder: filterPreservingRef(
          record.categoryOrder,
          (item): item is string => typeof item === 'string',
        ),
        defaultCategoryOverrides: record.defaultCategoryOverrides && typeof record.defaultCategoryOverrides === 'object'
          && !Array.isArray(record.defaultCategoryOverrides)
          ? record.defaultCategoryOverrides as AccountWorkspace['defaultCategoryOverrides']
          : {},
        categoryListIdMap: record.categoryListIdMap && typeof record.categoryListIdMap === 'object'
          && !Array.isArray(record.categoryListIdMap)
          ? Object.fromEntries(
              Object.entries(record.categoryListIdMap).filter(
                ([mapKey, mapValue]) => typeof mapKey === 'string' && typeof mapValue === 'string',
              ),
            )
          : {},
        syncMode: record.syncMode === 'stars-and-lists' ? 'stars-and-lists' : 'stars',
        syncModeConfigured: record.syncModeConfigured === true,
      }]];
    }),
  );
};

export const emptyAccountWorkspace = (): AccountWorkspace => ({
  repositories: [],
  lastSync: null,
  gists: [],
  starredGists: [],
  selectedGistCategory: 'all',
  releases: [],
  releaseSubscriptions: [],
  releaseSourceSettings: defaultReleaseSourceSettings,
  readReleases: [],
  forks: [],
  readForks: [],
  customCategories: [],
  hiddenDefaultCategoryIds: [],
  categoryOrder: [],
  defaultCategoryOverrides: {},
  categoryListIdMap: {},
  syncMode: 'stars',
  syncModeConfigured: false,
});

export const captureAccountWorkspace = (state: AccountWorkspaceSource): AccountWorkspace => ({
  repositories: state.repositories,
  lastSync: state.lastSync,
  gists: state.gists,
  starredGists: state.starredGists,
  selectedGistCategory: state.selectedGistCategory,
  releases: state.releases,
  releaseSubscriptions: numberSetToArray(state.releaseSubscriptions),
  releaseSourceSettings: state.releaseSourceSettings,
  readReleases: numberSetToArray(state.readReleases),
  forks: state.forks,
  readForks: numberSetToArray(state.readForks),
  customCategories: state.customCategories,
  hiddenDefaultCategoryIds: state.hiddenDefaultCategoryIds,
  categoryOrder: state.categoryOrder,
  defaultCategoryOverrides: state.defaultCategoryOverrides,
  categoryListIdMap: state.categoryListIdMap,
  syncMode: state.syncMode,
  syncModeConfigured: state.syncModeConfigured,
});

export const applyAccountWorkspace = (workspace: AccountWorkspace | undefined): AccountWorkspaceRuntime => {
  const snapshot = workspace ?? emptyAccountWorkspace();
  return {
    repositories: snapshot.repositories,
    lastSync: snapshot.lastSync,
    gists: snapshot.gists,
    starredGists: snapshot.starredGists,
    gistSearchResults: snapshot.gists,
    selectedGistCategory: snapshot.selectedGistCategory,
    searchResults: snapshot.repositories,
    similarView: null,
    analyzingGistIds: new Set<string>(),
    analyzingRepositoryIds: new Set<number>(),
    releases: snapshot.releases,
    releaseSubscriptions: new Set(snapshot.releaseSubscriptions),
    releaseSourceSettings: snapshot.releaseSourceSettings,
    readReleases: new Set(snapshot.readReleases),
    forks: snapshot.forks,
    readForks: new Set(snapshot.readForks),
    customCategories: snapshot.customCategories,
    hiddenDefaultCategoryIds: snapshot.hiddenDefaultCategoryIds,
    categoryOrder: snapshot.categoryOrder,
    defaultCategoryOverrides: snapshot.defaultCategoryOverrides,
    categoryListIdMap: snapshot.categoryListIdMap,
    syncMode: snapshot.syncMode,
    syncModeConfigured: snapshot.syncModeConfigured,
  };
};

export type WorkspaceDataCandidate = Partial<AccountWorkspaceSource | AccountWorkspace>;

/**
 * Predicate checking whether a workspace (live or parked snapshot) holds any
 * persisted user content or user-defined category configuration.
 * Excludes syncMode alone, adhering to the account-switching contract.
 */
export const workspaceHasData = (workspace: WorkspaceDataCandidate | null | undefined): boolean => {
  if (!workspace) return false;
  return (
    (workspace.repositories?.length ?? 0) > 0
    || (workspace.gists?.length ?? 0) > 0
    || (workspace.starredGists?.length ?? 0) > 0
    || (workspace.releases?.length ?? 0) > 0
    || (workspace.forks?.length ?? 0) > 0
    || (workspace.customCategories?.length ?? 0) > 0
    || (workspace.categoryOrder?.length ?? 0) > 0
    || (workspace.hiddenDefaultCategoryIds?.length ?? 0) > 0
    || Object.keys(workspace.defaultCategoryOverrides ?? {}).length > 0
    || Object.keys(workspace.categoryListIdMap ?? {}).length > 0
  );
};

const DEFAULT_RELEASE_SOURCE_SETTINGS_KEY = JSON.stringify(
  normalizeReleaseSourceSettings(defaultReleaseSourceSettings),
);

/**
 * 统一「工作区是否有可保留数据」判定（第 12 轮审计 ISSUE-1 修复）。
 *
 * workspaceHasData 只覆盖列表类内容（仓库/Gist/发布/复刻/分类）；发行版订阅、
 * 已读状态（readReleases/readForks）与用户自定义的发行版来源设置同样是分片里
 * 的持久化数据。登录页的覆盖确认、`setUser` 的顶层数据保留路径（
 * switchAccountWorkspace）与失败回滚的快照恢复必须共用这一判定——否则仅含
 * 这些数据的无主缓存会被判为空工作区并静默清空（「保留本地」形同丢弃）。
 * syncMode 单独存在仍视为空工作区（账号切换契约不变）。
 */
export const workspaceHasRetainableData = (
  workspace: WorkspaceDataCandidate | null | undefined,
): boolean => {
  if (!workspace) return false;
  if (workspaceHasData(workspace)) return true;
  const countOf = (value: Set<number> | number[] | undefined): number => (
    value instanceof Set ? value.size : value?.length ?? 0
  );
  if (countOf(workspace.releaseSubscriptions) > 0) return true;
  if (countOf(workspace.readReleases) > 0) return true;
  if (countOf(workspace.readForks) > 0) return true;
  return JSON.stringify(normalizeReleaseSourceSettings(workspace.releaseSourceSettings ?? null))
    !== DEFAULT_RELEASE_SOURCE_SETTINGS_KEY;
};

export const switchAccountWorkspace = (
  current: AccountWorkspaceSource & { accountWorkspaces: Record<string, AccountWorkspace> },
  previousAccountId: string | null,
  nextAccountId: string,
  options: { forceLoadTarget?: boolean } = {},
): { accountWorkspaces: Record<string, AccountWorkspace>; workspace: AccountWorkspaceRuntime | null } => {
  const accountWorkspaces = { ...current.accountWorkspaces };
  if (previousAccountId && previousAccountId !== nextAccountId) {
    accountWorkspaces[previousAccountId] = captureAccountWorkspace(current);
  }
  if (previousAccountId === nextAccountId) {
    return { accountWorkspaces, workspace: null };
  }
  // Logged-out login: keep live lists if they already hold retainable data
  // (backend restore wrote first, or the user explicitly chose「保留本地」for an
  // unowned legacy cache). ISSUE-1（第 12 轮）：判定必须与登录页共用
  // workspaceHasRetainableData——仅含发行版订阅/已读/来源设置的工作区同样
  // 不能被 applyAccountWorkspace(undefined) 清空。Direct switchAccount passes
  // forceLoadTarget=true so it never inherits leftover top-level data.
  if (!options.forceLoadTarget && !previousAccountId && workspaceHasRetainableData(current)) {
    return { accountWorkspaces, workspace: null };
  }
  return {
    accountWorkspaces,
    workspace: applyAccountWorkspace(accountWorkspaces[nextAccountId]),
  };
};

/**
 * 规整化持久化/导入来源的 savedAccounts 映射（Issue #611）。
 * 校验每项包含合法 user（id 为正整数、login 非空字符串、avatar_url 为字符串）
 * 与 githubToken（字符串）；键统一为 GitHub 数值 ID 字符串。
 * 保持引用稳定：规整化前后内容一致的条目沿用原对象，整体一致时返回原引用，
 * 避免 hydration 后每次都重建映射触发无意义的订阅通知。
 */
export const normalizeSavedAccounts = (value: unknown): Record<string, SavedAccount> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  let changed = false;
  const result: Record<string, SavedAccount> = {};
  for (const [key, entry] of Object.entries(source)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      changed = true;
      continue;
    }
    const record = entry as Record<string, unknown>;
    const user = record.user as GitHubUser | null | undefined;
    const userId = user && typeof user === 'object' && !Array.isArray(user) ? user.id : undefined;
    const validUser = !!user
      && typeof userId === 'number'
      && Number.isInteger(userId)
      && userId > 0
      && typeof user.login === 'string'
      && user.login.length > 0
      && typeof user.avatar_url === 'string';
    // 审计修复（B7）：持久化分片只保留 savedAccounts 非敏感元数据（githubToken
    // 被剥为空串）——缺 Token 字段的条目按「需重新授权」的元数据条目保留，
    // 不再整条丢弃；恢复会话时经桌面端安全存储或重新授权回填凭证。
    const githubToken = typeof record.githubToken === 'string' ? record.githubToken : '';
    if (!validUser) {
      changed = true;
      continue;
    }
    const accountId = String(userId);
    // 审计修复（B6）：按 user.id 归一的规范键已存在时，非规范别名条目
    // （如 "042" 指向 id 42）一律忽略——别名不得覆盖规范条目的凭证。
    // 行为约定（已同步 HANDOFF-B-TO-C.md 供导入路径对齐）：保留规范条目、
    // 丢弃别名条目，不抛错。
    if (key !== accountId && result[accountId]) {
      changed = true;
      continue;
    }
    const addedAt = typeof record.addedAt === 'string' && record.addedAt ? record.addedAt : '';
    const lastUsedAt = typeof record.lastUsedAt === 'string' && record.lastUsedAt ? record.lastUsedAt : '';
    const stable = key === accountId
      && record.accountId === accountId
      && addedAt !== ''
      && lastUsedAt !== ''
      && (record.user as unknown) === (user as unknown)
      && record.githubToken === githubToken;
    if (stable) {
      result[accountId] = entry as SavedAccount;
      continue;
    }
    changed = true;
    const now = new Date().toISOString();
    result[accountId] = {
      accountId,
      user,
      githubToken,
      addedAt: addedAt || now,
      lastUsedAt: lastUsedAt || addedAt || now,
    };
  }
  return changed ? result : (source as Record<string, SavedAccount>);
};

/**
 * 在已登录态准备拉取另一账号的外部数据（后端恢复 / 添加账号）前，
 * 将当前账号的完整工作区快照归档进 accountWorkspaces，防止后续
 * syncBackendData 把新账号数据写进顶层后、setUser 把被污染的顶层
 * 状态作为当前账号快照再次写入（R2 数据覆盖漏洞）。
 * 返回归档后的 accountWorkspaces 与重置后的顶层运行时工作区。
 */
export const parkCurrentAccountWorkspace = (
  current: AccountWorkspaceSource & { accountWorkspaces: Record<string, AccountWorkspace> },
  previousAccountId: string,
): { accountWorkspaces: Record<string, AccountWorkspace>; workspace: AccountWorkspaceRuntime } => ({
  accountWorkspaces: {
    ...current.accountWorkspaces,
    [previousAccountId]: captureAccountWorkspace(current),
  },
  workspace: applyAccountWorkspace(undefined),
});

/**
 * 读取当前活跃账号 ID（函数体内访问 useAppStore，规避模块初始化环）。
 * 测试桩兼容：单元测试可能把 store 模块整体 mock 成无 getState 的选择器函数，
 * 此时返回 null（配合 isCurrentAccount 的放行语义，不影响旧测试）。
 */
export const peekCurrentAccountId = (): string | null => {
  try {
    const store = useAppStore as unknown as { getState?: () => { user: GitHubUser | null } };
    if (typeof store.getState !== 'function') return null;
    return accountIdKey(store.getState()?.user ?? null);
  } catch {
    return null;
  }
};

/**
 * 会话代次校验（模块 3 主防线辅助）：判断给定账号是否仍是当前活跃账号。
 * 供异步批量写路径在写入前调用，不一致时丢弃或归档结果，杜绝跨账号写穿。
 * 仅当 store 真实可用（生产环境恒成立）且账号不一致时返回 false；
 * 测试桩环境（store 被整体 mock、无 getState）默认放行，保持旧测试契约。
 */
export const isCurrentAccount = (expectedAccountId: string | null): boolean => {
  try {
    const store = useAppStore as unknown as { getState?: () => { user: GitHubUser | null } };
    if (typeof store.getState !== 'function') return true;
    return accountIdKey(store.getState()?.user ?? null) === expectedAccountId;
  } catch {
    return true;
  }
};

/**
 * 会话代次（Issue #611 审计修复）：仅比较账号 ID 无法识别「切出后又切回
 * 同一账号」——旧请求结算时账号又变回 A，仍会把过期结果写进 A 的当前工作区。
 * 切换 / 登出 / 替换会话时递增；异步任务开始时捕获代次，提交结果前一并校验。
 */
let _accountSessionGeneration = 0;

export const getAccountSessionGeneration = (): number => _accountSessionGeneration;

export const bumpAccountSessionGeneration = (): number => {
  _accountSessionGeneration += 1;
  return _accountSessionGeneration;
};

export const isCurrentAccountSession = (
  expectedAccountId: string | null,
  expectedGeneration: number,
): boolean => expectedGeneration === _accountSessionGeneration && isCurrentAccount(expectedAccountId);

