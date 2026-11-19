import type { AccountWorkspace, GitHubUser, Repository, SavedAccount } from '../types';
import {
  accountIdKey,
  captureAccountWorkspace,
  emptyAccountWorkspace,
  normalizeAccountWorkspaces,
  type AccountWorkspaceRuntime,
  type AccountWorkspaceSource,
} from '../store/helpers/accountWorkspace';

/**
 * 多账号备份/恢复的共享纯函数（Issue #611 模块 5）。
 * 数据治理面板（本地 JSON）与 WebDAV 备份共用同一套工作区快照、
 * Token 脱敏与跨账号合并语义，避免两套实现漂移。
 */

export const BACKUP_MASKED_SECRET = '***';

export const isRealBackupSecret = (value: unknown): value is string => (
  typeof value === 'string' && value.length > 0 && value !== BACKUP_MASKED_SECRET
);

/**
 * 单条备份仓库记录的最小结构校验（审计修复 C47）：
 * id（有限数字）、name/full_name（非空字符串）、owner.login（非空字符串）。
 * null / 非对象 / 缺失关键字段一律拒绝。
 */
const isValidBackupRepository = (item: unknown): item is Repository => {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
  const repo = item as Partial<Repository>;
  return (
    typeof repo.id === 'number'
    && Number.isFinite(repo.id)
    && typeof repo.name === 'string'
    && repo.name.length > 0
    && typeof repo.full_name === 'string'
    && repo.full_name.length > 0
    && typeof repo.owner?.login === 'string'
    && repo.owner.login.length > 0
  );
};

/**
 * 备份/恢复路径在首次写入 store 前对 repositories 的逐项校验（审计修复 C47）。
 * 返回值语义：
 * - undefined：备份未提供该字段（保持既有「缺失字段保留本机值」的回退语义）；
 * - Repository[]（可为空数组，显式 [] 仍表示清空）：校验通过的列表；
 * - null：字段存在但含无效条目——调用方必须整体拒绝该工作区，绝不保存
 *   部分有效数据。
 */
export const validateBackupRepositories = (
  value: unknown,
): Repository[] | null | undefined => {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) return null;
  const validated: Repository[] = [];
  for (const item of value) {
    if (!isValidBackupRepository(item)) return null;
    validated.push(item);
  }
  return validated;
};


/**
 * 构造完整工作区字典：合并已停用账号快照与当前活跃账号的实时状态。
 * 活跃账号快照一律在导出时刻即时合成（captureAccountWorkspace），
 * 不预存副本，避免双份驻留且即刻过期。
 */
export const buildFullWorkspaces = (
  state: AccountWorkspaceSource & { user: GitHubUser | null; accountWorkspaces: Record<string, AccountWorkspace> },
): Record<string, AccountWorkspace> => {
  const currentAccountId = accountIdKey(state.user);
  return {
    ...state.accountWorkspaces,
    ...(currentAccountId ? { [currentAccountId]: captureAccountWorkspace(state) } : {}),
  };
};

/** 按 includeKeysInBackup 决定 savedAccounts 的 Token 是明文还是脱敏掩码。 */
export const maskSavedAccountsForBackup = (
  savedAccounts: Record<string, SavedAccount>,
  includeKeys: boolean,
): Record<string, SavedAccount> => (
  Object.fromEntries(
    Object.entries(savedAccounts).map(([id, account]) => [
      id,
      includeKeys
        ? account
        : { ...account, githubToken: account.githubToken ? BACKUP_MASKED_SECRET : '' },
    ]),
  )
);

/**
 * 工作区数组按条目 id 去重合并（merge 模式）：
 * 本地已有条目保留，仅追加本地没有的新条目。
 * 订阅/已读集合字段（readForks、releaseSubscriptions、readReleases）按并集
 * 合并：保留本机状态并恢复备份条目，避免备份中的条目虽然恢复、
 * 其已读/订阅状态却丢失。
 */
export const mergeWorkspacesById = (
  local: AccountWorkspace,
  incoming: AccountWorkspace,
): AccountWorkspace => {
  const mergeList = <T extends { id: unknown }>(localList: T[], incomingList: T[]): T[] => {
    const existingIds = new Set(localList.map(item => String(item?.id)));
    const added: T[] = [];
    for (const item of incomingList) {
      const id = String(item?.id);
      if (existingIds.has(id)) continue;
      existingIds.add(id);
      added.push(item);
    }
    return [...localList, ...added];
  };
  const unionIds = <T>(localIds: T[], incomingIds: T[]): T[] => Array.from(new Set([...localIds, ...incomingIds]));
  return {
    ...local,
    repositories: mergeList(local.repositories, incoming.repositories),
    gists: mergeList(local.gists, incoming.gists),
    starredGists: mergeList(local.starredGists, incoming.starredGists),
    releases: mergeList(local.releases, incoming.releases),
    forks: mergeList(local.forks, incoming.forks),
    customCategories: mergeList(local.customCategories, incoming.customCategories),
    readForks: unionIds(local.readForks, incoming.readForks),
    releaseSubscriptions: unionIds(local.releaseSubscriptions, incoming.releaseSubscriptions),
    readReleases: unionIds(local.readReleases, incoming.readReleases),
  };
};

/**
 * 分类显示/映射设置合并（R5 审计修复，CodeRabbit 发现 3）：
 * mergeWorkspacesById 只合并列表与 ID 集合（其余字段取本机基座），恢复/归档
 * 的 merge 分支若不显式合并这些字段，备份当前账号工作区新增的分类显示设置
 * 会被整段丢弃。规则与导入面板的分类合并分支一致：
 * - hiddenDefaultCategoryIds / categoryOrder：并集（保留本机 + 恢复备份新增）；
 * - defaultCategoryOverrides / categoryListIdMap：按键合并，备份同键覆盖本机。
 * 返回值展开进合并结果即可，调用方不得再用本机基座的同名字段覆盖。
 */
export const mergeWorkspaceCategorySettings = (
  local: AccountWorkspace,
  incoming: Partial<Pick<AccountWorkspace, 'hiddenDefaultCategoryIds' | 'defaultCategoryOverrides' | 'categoryOrder' | 'categoryListIdMap'>>,
): Pick<AccountWorkspace, 'hiddenDefaultCategoryIds' | 'defaultCategoryOverrides' | 'categoryOrder' | 'categoryListIdMap'> => ({
  hiddenDefaultCategoryIds: Array.from(new Set([
    ...local.hiddenDefaultCategoryIds,
    ...(incoming.hiddenDefaultCategoryIds ?? []),
  ])),
  defaultCategoryOverrides: {
    ...local.defaultCategoryOverrides,
    ...(incoming.defaultCategoryOverrides ?? {}),
  },
  categoryOrder: Array.from(new Set([
    ...local.categoryOrder,
    ...(incoming.categoryOrder ?? []),
  ])),
  categoryListIdMap: {
    ...local.categoryListIdMap,
    ...(incoming.categoryListIdMap ?? {}),
  },
});

/**
 * 按导出数据类型选择裁剪工作区字段（导出隐私边界）。
 * 未选择的数据类型在工作区中以空默认值占位，绝不把未勾选类型的
 * 其他账号仓库/Release/Gist/Fork 等数据写入导出 JSON。
 */
export const trimWorkspacesForSelectedTypes = (
  workspaces: Record<string, AccountWorkspace>,
  selectedTypes: string[],
): Record<string, AccountWorkspace> => {
  const includeRepos = selectedTypes.includes('repositories');
  const includeReleases = selectedTypes.includes('releases');
  const includeReleaseSubs = selectedTypes.includes('releaseSubscriptions');
  const includeCategories = selectedTypes.includes('customCategories');
  const empty = emptyAccountWorkspace();
  return Object.fromEntries(
    Object.entries(workspaces).map(([accountId, workspace]) => [
      accountId,
      {
        ...empty,
        ...(includeRepos
          ? {
              repositories: workspace.repositories,
              lastSync: workspace.lastSync,
              gists: workspace.gists,
              starredGists: workspace.starredGists,
              selectedGistCategory: workspace.selectedGistCategory,
              forks: workspace.forks,
              readForks: workspace.readForks,
              syncMode: workspace.syncMode,
              syncModeConfigured: workspace.syncModeConfigured,
            }
          : {}),
        ...(includeReleases ? { releases: workspace.releases } : {}),
        ...(includeReleaseSubs
          ? {
              releaseSubscriptions: workspace.releaseSubscriptions,
              releaseSourceSettings: workspace.releaseSourceSettings,
              readReleases: workspace.readReleases,
            }
          : {}),
        ...(includeCategories
          ? {
              customCategories: workspace.customCategories,
              hiddenDefaultCategoryIds: workspace.hiddenDefaultCategoryIds,
              defaultCategoryOverrides: workspace.defaultCategoryOverrides,
              categoryOrder: workspace.categoryOrder,
              categoryListIdMap: workspace.categoryListIdMap,
            }
          : {}),
      } satisfies AccountWorkspace,
    ]),
  );
};

/**
 * 按导入数据类型选择应用工作区（applyAccountWorkspace 的类型过滤版）。
 * 仅返回所选类型对应的工作区字段补丁，未选择的类型不影响当前状态。
 * 导入面板以备份实际包含的数据类型解析 selectedTypes，因此裁剪备份
 * 中的空字段不会回滚当前实时数据。
 *
 * rawFields（审计修复 C57）：提供原始备份工作区对象时按字段级区分
 * 「未导出字段」与「导出为空」——原始备份缺失的字段不进入补丁（保留
 * 实时值），显式 [] 清空语义保留；缺省时保持旧行为（所选类型的全部
 * 字段都来自备份）。
 */
export const applyAccountWorkspaceForTypes = (
  workspace: AccountWorkspace,
  selectedTypes: string[],
  rawFields?: Record<string, unknown>,
): Partial<AccountWorkspaceRuntime> => {
  const rawHas = (key: string): boolean => !rawFields || Object.prototype.hasOwnProperty.call(rawFields, key);
  const patch: Partial<AccountWorkspaceRuntime> = {};
  if (selectedTypes.includes('repositories')) {
    if (rawHas('repositories')) {
      patch.repositories = workspace.repositories;
      patch.searchResults = workspace.repositories;
    }
    if (rawHas('lastSync')) patch.lastSync = workspace.lastSync;
    if (rawHas('gists')) {
      patch.gists = workspace.gists;
      patch.gistSearchResults = workspace.gists;
    }
    if (rawHas('starredGists')) patch.starredGists = workspace.starredGists;
    if (rawHas('selectedGistCategory')) patch.selectedGistCategory = workspace.selectedGistCategory;
    if (rawHas('forks')) patch.forks = workspace.forks;
    if (rawHas('readForks')) patch.readForks = new Set(workspace.readForks);
    if (rawHas('syncMode')) patch.syncMode = workspace.syncMode;
    if (rawHas('syncModeConfigured')) patch.syncModeConfigured = workspace.syncModeConfigured;
  }
  if (selectedTypes.includes('releases') && rawHas('releases')) {
    patch.releases = workspace.releases;
  }
  if (selectedTypes.includes('releaseSubscriptions')) {
    if (rawHas('releaseSubscriptions')) patch.releaseSubscriptions = new Set(workspace.releaseSubscriptions);
    if (rawHas('releaseSourceSettings')) patch.releaseSourceSettings = workspace.releaseSourceSettings;
    if (rawHas('readReleases')) patch.readReleases = new Set(workspace.readReleases);
  }
  if (selectedTypes.includes('customCategories')) {
    if (rawHas('customCategories')) patch.customCategories = workspace.customCategories;
    if (rawHas('hiddenDefaultCategoryIds')) patch.hiddenDefaultCategoryIds = workspace.hiddenDefaultCategoryIds;
    if (rawHas('categoryOrder')) patch.categoryOrder = workspace.categoryOrder;
    if (rawHas('defaultCategoryOverrides')) patch.defaultCategoryOverrides = workspace.defaultCategoryOverrides;
    if (rawHas('categoryListIdMap')) patch.categoryListIdMap = workspace.categoryListIdMap;
  }
  return patch;
};

/**
 * replace 模式的工作区字典恢复：逐账号按所选导入数据类型「只替换已选字段」。
 * 已选类型的字段以备份值为准；未选类型的字段保留本机快照——否则
 * 「单类型导出（如仅分类）→ replace 导入」往返会把裁剪备份中的空占位
 * 整体覆盖进工作区，清空非当前账号的仓库/Gist/Fork/订阅等未选数据。
 *
 * 审计修复（C57）：替换补丁依据原始备份中实际存在且有效的字段生成——
 * normalizeAccountWorkspaces 的空默认值无法区分「未导出字段」与「导出为空」，
 * 缺失字段必须保留本机值、显式 [] 才清空。该补丁同时用于更新目标账号快照
 * 与当前账号实时应用（面板侧经 applyAccountWorkspaceForTypes 的 rawFields）。
 */
const isPlainObject = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const applyValidatedWorkspaceFields = (
  local: AccountWorkspace,
  rawAccount: Record<string, unknown>,
  incoming: AccountWorkspace,
  selectedTypes: string[],
): AccountWorkspace => {
  const rawHas = (key: string): boolean => Object.prototype.hasOwnProperty.call(rawAccount, key);
  const rawIsArray = (key: string): boolean => rawHas(key) && Array.isArray(rawAccount[key]);
  const rawIsObject = (key: string): boolean => rawHas(key) && isPlainObject(rawAccount[key]);
  const includeRepos = selectedTypes.includes('repositories');
  const includeReleases = selectedTypes.includes('releases');
  const includeReleaseSubs = selectedTypes.includes('releaseSubscriptions');
  const includeCategories = selectedTypes.includes('customCategories');
  // R2-C7：写入 repositories 前逐项校验原始备份值——缺失/null 视为未提供
  //（保留本机值），非数组或含无效条目的数组整体不写入，绝不用损坏数据
  // 覆盖本机仓库列表；显式 [] 仍是有效的清空语义。
  const validatedRepositories = includeRepos && rawHas('repositories')
    ? validateBackupRepositories(rawAccount.repositories)
    : undefined;
  return {
    ...local,
    ...(Array.isArray(validatedRepositories) ? { repositories: validatedRepositories } : {}),
    ...(includeRepos && rawHas('lastSync') && (rawAccount.lastSync === null || typeof rawAccount.lastSync === 'string')
      ? { lastSync: incoming.lastSync }
      : {}),
    ...(includeRepos && rawIsArray('gists') ? { gists: incoming.gists } : {}),
    ...(includeRepos && rawIsArray('starredGists') ? { starredGists: incoming.starredGists } : {}),
    ...(includeRepos && rawHas('selectedGistCategory') && typeof rawAccount.selectedGistCategory === 'string'
      ? { selectedGistCategory: incoming.selectedGistCategory }
      : {}),
    ...(includeRepos && rawIsArray('forks') ? { forks: incoming.forks } : {}),
    ...(includeRepos && rawIsArray('readForks') ? { readForks: incoming.readForks } : {}),
    ...(includeRepos && rawHas('syncMode') && (rawAccount.syncMode === 'auto' || rawAccount.syncMode === 'manual')
      ? { syncMode: incoming.syncMode }
      : {}),
    ...(includeRepos && rawHas('syncModeConfigured') && typeof rawAccount.syncModeConfigured === 'boolean'
      ? { syncModeConfigured: incoming.syncModeConfigured }
      : {}),
    ...(includeReleases && rawIsArray('releases') ? { releases: incoming.releases } : {}),
    ...(includeReleaseSubs && rawIsArray('releaseSubscriptions') ? { releaseSubscriptions: incoming.releaseSubscriptions } : {}),
    ...(includeReleaseSubs && rawIsObject('releaseSourceSettings') ? { releaseSourceSettings: incoming.releaseSourceSettings } : {}),
    ...(includeReleaseSubs && rawIsArray('readReleases') ? { readReleases: incoming.readReleases } : {}),
    ...(includeCategories && rawIsArray('customCategories') ? { customCategories: incoming.customCategories } : {}),
    ...(includeCategories && rawIsArray('hiddenDefaultCategoryIds') ? { hiddenDefaultCategoryIds: incoming.hiddenDefaultCategoryIds } : {}),
    ...(includeCategories && rawIsObject('defaultCategoryOverrides') ? { defaultCategoryOverrides: incoming.defaultCategoryOverrides } : {}),
    ...(includeCategories && rawIsArray('categoryOrder') ? { categoryOrder: incoming.categoryOrder } : {}),
    ...(includeCategories && rawIsObject('categoryListIdMap') ? { categoryListIdMap: incoming.categoryListIdMap } : {}),
  } satisfies AccountWorkspace;
};

export const replaceWorkspacesForSelectedTypes = (
  localWorkspaces: Record<string, AccountWorkspace>,
  backupWorkspaces: Record<string, unknown>,
  selectedTypes: string[],
): Record<string, AccountWorkspace> => {
  const raw = (backupWorkspaces && typeof backupWorkspaces === 'object' && !Array.isArray(backupWorkspaces)
    ? backupWorkspaces
    : {}) as Record<string, Record<string, unknown> | undefined>;
  const normalized = normalizeAccountWorkspaces(backupWorkspaces);
  const merged = { ...localWorkspaces };
  for (const [accountId, incoming] of Object.entries(normalized)) {
    const rawAccount = raw[accountId] ?? {};
    const local = merged[accountId] ?? emptyAccountWorkspace();
    merged[accountId] = applyValidatedWorkspaceFields(local, rawAccount, incoming, selectedTypes);
  }
  return merged;
};

const ALL_WORKSPACE_BACKUP_TYPES = ['repositories', 'releases', 'releaseSubscriptions', 'customCategories'];

/**
 * 合并备份工作区：更新备份中存在的账号，保留本机独有的其他账号工作区。
 * preferLive=true（备份创建）：活跃账号的实时状态优先于可能过期的快照；
 * preferLive=false（恢复）：按备份中实际提供的有效字段覆盖对应账号（未提供的字段保留本机值，
 * 显式 [] 仍清空），本机独有的其他账号快照保留。
 */
export const mergeBackupWorkspaces = (
  localWorkspaces: Record<string, AccountWorkspace>,
  backupWorkspaces: Record<string, unknown>,
  liveAccountId: string | null,
  liveSnapshot: AccountWorkspace | null,
  preferLive: boolean,
): Record<string, AccountWorkspace> => {
  const raw = (backupWorkspaces && typeof backupWorkspaces === 'object' && !Array.isArray(backupWorkspaces)
    ? backupWorkspaces
    : {}) as Record<string, Record<string, unknown> | undefined>;
  const normalized = normalizeAccountWorkspaces(backupWorkspaces);
  const merged: Record<string, AccountWorkspace> = { ...localWorkspaces };
  for (const [accountId, incoming] of Object.entries(normalized)) {
    const existing = merged[accountId];
    if (!existing) {
      merged[accountId] = incoming;
    } else {
      merged[accountId] = applyValidatedWorkspaceFields(
        existing,
        raw[accountId] ?? {},
        incoming,
        ALL_WORKSPACE_BACKUP_TYPES,
      );
    }
  }
  if (preferLive && liveAccountId && liveSnapshot) {
    merged[liveAccountId] = liveSnapshot;
  }
  return merged;
};

/** 检测备份载荷中是否存在脱敏掩码（提示用户部分密钥未包含）。 */
export const hasMaskedBackupSecrets = (
  data: {
    aiConfigs?: Array<{ apiKey?: unknown }>;
    webdavConfigs?: Array<{ password?: unknown }>;
    proxyConfig?: { password?: unknown };
    rpcDownloadConfig?: { secret?: unknown };
    backendApiSecret?: unknown;
    savedAccounts?: Record<string, SavedAccount>;
  },
): boolean => (
  !!(
    data.aiConfigs?.some(config => config.apiKey === BACKUP_MASKED_SECRET)
    || data.webdavConfigs?.some(config => config.password === BACKUP_MASKED_SECRET)
    || data.proxyConfig?.password === BACKUP_MASKED_SECRET
    || data.rpcDownloadConfig?.secret === BACKUP_MASKED_SECRET
    || data.backendApiSecret === BACKUP_MASKED_SECRET
    || Object.values(data.savedAccounts ?? {}).some(account => account?.githubToken === BACKUP_MASKED_SECRET)
  )
);
