import type { AccountWorkspace, GitHubUser, SavedAccount } from '../types';
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
    return [...localList, ...incomingList.filter(item => !existingIds.has(String(item?.id)))];
  };
  const unionIds = <T>(localIds: T[], incomingIds: T[]): T[] => Array.from(new Set([...localIds, ...incomingIds]));
  const categoryLocalIds = new Set(local.customCategories.map(item => String(item?.id)));
  return {
    ...local,
    repositories: mergeList(local.repositories, incoming.repositories),
    gists: mergeList(local.gists, incoming.gists),
    starredGists: mergeList(local.starredGists, incoming.starredGists),
    releases: mergeList(local.releases, incoming.releases),
    forks: mergeList(local.forks, incoming.forks),
    customCategories: [
      ...local.customCategories,
      ...incoming.customCategories.filter(item => !categoryLocalIds.has(String(item?.id))),
    ],
    readForks: unionIds(local.readForks, incoming.readForks),
    releaseSubscriptions: unionIds(local.releaseSubscriptions, incoming.releaseSubscriptions),
    readReleases: unionIds(local.readReleases, incoming.readReleases),
  };
};

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
 */
export const applyAccountWorkspaceForTypes = (
  workspace: AccountWorkspace,
  selectedTypes: string[],
): Partial<AccountWorkspaceRuntime> => {
  const patch: Partial<AccountWorkspaceRuntime> = {};
  if (selectedTypes.includes('repositories')) {
    patch.repositories = workspace.repositories;
    patch.lastSync = workspace.lastSync;
    patch.gists = workspace.gists;
    patch.starredGists = workspace.starredGists;
    patch.gistSearchResults = workspace.gists;
    patch.selectedGistCategory = workspace.selectedGistCategory;
    patch.searchResults = workspace.repositories;
    patch.forks = workspace.forks;
    patch.readForks = new Set(workspace.readForks);
    patch.syncMode = workspace.syncMode;
    patch.syncModeConfigured = workspace.syncModeConfigured;
  }
  if (selectedTypes.includes('releases')) {
    patch.releases = workspace.releases;
  }
  if (selectedTypes.includes('releaseSubscriptions')) {
    patch.releaseSubscriptions = new Set(workspace.releaseSubscriptions);
    patch.releaseSourceSettings = workspace.releaseSourceSettings;
    patch.readReleases = new Set(workspace.readReleases);
  }
  if (selectedTypes.includes('customCategories')) {
    patch.customCategories = workspace.customCategories;
    patch.hiddenDefaultCategoryIds = workspace.hiddenDefaultCategoryIds;
    patch.categoryOrder = workspace.categoryOrder;
    patch.defaultCategoryOverrides = workspace.defaultCategoryOverrides;
    patch.categoryListIdMap = workspace.categoryListIdMap;
  }
  return patch;
};

/**
 * replace 模式的工作区字典恢复：逐账号按所选导入数据类型「只替换已选字段」。
 * 已选类型的字段以备份值为准；未选类型的字段保留本机快照——否则
 * 「单类型导出（如仅分类）→ replace 导入」往返会把裁剪备份中的空占位
 * 整体覆盖进工作区，清空非当前账号的仓库/Gist/Fork/订阅等未选数据。
 */
export const replaceWorkspacesForSelectedTypes = (
  localWorkspaces: Record<string, AccountWorkspace>,
  backupWorkspaces: Record<string, unknown>,
  selectedTypes: string[],
): Record<string, AccountWorkspace> => {
  const normalized = normalizeAccountWorkspaces(backupWorkspaces);
  const merged = { ...localWorkspaces };
  const includeRepos = selectedTypes.includes('repositories');
  const includeReleases = selectedTypes.includes('releases');
  const includeReleaseSubs = selectedTypes.includes('releaseSubscriptions');
  const includeCategories = selectedTypes.includes('customCategories');
  for (const [accountId, incoming] of Object.entries(normalized)) {
    const local = merged[accountId] ?? emptyAccountWorkspace();
    merged[accountId] = {
      ...local,
      ...(includeRepos
        ? {
            repositories: incoming.repositories,
            lastSync: incoming.lastSync,
            gists: incoming.gists,
            starredGists: incoming.starredGists,
            selectedGistCategory: incoming.selectedGistCategory,
            forks: incoming.forks,
            readForks: incoming.readForks,
            syncMode: incoming.syncMode,
            syncModeConfigured: incoming.syncModeConfigured,
          }
        : {}),
      ...(includeReleases ? { releases: incoming.releases } : {}),
      ...(includeReleaseSubs
        ? {
            releaseSubscriptions: incoming.releaseSubscriptions,
            releaseSourceSettings: incoming.releaseSourceSettings,
            readReleases: incoming.readReleases,
          }
        : {}),
      ...(includeCategories
        ? {
            customCategories: incoming.customCategories,
            hiddenDefaultCategoryIds: incoming.hiddenDefaultCategoryIds,
            defaultCategoryOverrides: incoming.defaultCategoryOverrides,
            categoryOrder: incoming.categoryOrder,
            categoryListIdMap: incoming.categoryListIdMap,
          }
        : {}),
    } satisfies AccountWorkspace;
  }
  return merged;
};

/**
 * 合并备份工作区：更新备份中存在的账号，保留本机独有的其他账号工作区。
 * preferLive=true（备份创建）：活跃账号的实时状态优先于可能过期的快照；
 * preferLive=false（恢复）：备份内容优先，本机独有的其他账号快照保留。
 */
export const mergeBackupWorkspaces = (
  localWorkspaces: Record<string, AccountWorkspace>,
  backupWorkspaces: Record<string, unknown>,
  liveAccountId: string | null,
  liveSnapshot: AccountWorkspace | null,
  preferLive: boolean,
): Record<string, AccountWorkspace> => {
  const normalized = normalizeAccountWorkspaces(backupWorkspaces);
  const merged = { ...localWorkspaces, ...normalized };
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
