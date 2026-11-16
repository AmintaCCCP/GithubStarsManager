import type { AccountWorkspace, GitHubUser, SavedAccount } from '../types';
import {
  accountIdKey,
  captureAccountWorkspace,
  normalizeAccountWorkspaces,
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
 */
export const mergeWorkspacesById = (
  local: AccountWorkspace,
  incoming: AccountWorkspace,
): AccountWorkspace => {
  const mergeList = <T extends { id: unknown }>(localList: T[], incomingList: T[]): T[] => {
    const existingIds = new Set(localList.map(item => String(item?.id)));
    return [...localList, ...incomingList.filter(item => !existingIds.has(String(item?.id)))];
  };
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
  };
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
