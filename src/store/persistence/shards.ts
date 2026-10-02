
/**
 * 分片持久化布局（开发守则 §7 性能守则）。
 *
 * 历史版本把整个 partialize 结果序列化成单个 IndexedDB 键，任何状态变更
 * （包括开关一个弹窗）都要重新 stringify 并重写全部数据（实测可达 ~144MB，
 * 单次 stringify ~130ms + 写入 ~270ms，持续阻塞主线程）。
 *
 * 分片原则：
 * - 体积大、变更低频的重数据（repositories/gists/releases/forks/账号工作区/
 *   trending 快照）各自独立分片，只在内容真正变化（引用判脏）时重写；
 * - 体积小、变更高频的偏好与视图状态集中到 core 分片，单次重写仅几 KB；
 * - partialize 未来新增的键由 resolveShardForField 兜底归入 core，保证
 *   任何持久化字段都不会因遗漏分片映射而丢失。
 *
 * ── 硬性契约 ────────────────────────────────────────────────────────────
 * 1. 不可变更新：分片按「字段引用」判脏的前提是持久化字段永远不可变更新。
 *    对 repositories/gists/releases/forks/accountWorkspaces/trendingSnapshots
 *    的任何原地修改（push/sort/索引赋值）都会因引用未变而静默不落盘。
 *    新代码必须使用不可变更新（这是 zustand 生态的既有约定）。
 * 2. 格式版本：递增 PERSISTENCE_SHARD_FORMAT 时必须同步提供
 *    readPersistedSnapshot 的旧格式迁移分支；仅改常量会让旧分片不可读，
 *    且 legacy 单键快照在首次迁移后已退役——结果是空启动后覆盖全部数据。
 * ───────────────────────────────────────────────────────────────────────
 */

export const PERSISTENCE_SHARD_FORMAT = 1;

export type PersistenceShardName =
  | 'core'
  | 'repositories'
  | 'gists'
  | 'releases'
  | 'forks'
  | 'accountWorkspaces'
  | 'trendingSnapshots';

export const PERSISTENCE_SHARD_NAMES: readonly PersistenceShardName[] = [
  'core',
  'repositories',
  'gists',
  'releases',
  'forks',
  'accountWorkspaces',
  'trendingSnapshots',
];

export const PERSISTENCE_SHARD_FIELDS: Record<PersistenceShardName, readonly string[]> = {
  // 体积小、变更高频的偏好/视图/配置状态；单次 stringify+写入仅几 KB。
  core: [
    'user',
    'githubToken',
    'isAuthenticated',
    'themeTokens',
    'gistSearchFilters',
    'selectedGistCategory',
    'analyzingGistIds',
    'aiConfigs',
    'activeAIConfig',
    'repositoryChatSettings',
    'embeddingConfigs',
    'activeEmbeddingConfig',
    'vectorSearchConfig',
    'vectorSearchStatus',
    'mcpConfig',
    'webdavConfigs',
    'activeWebDAVConfig',
    'lastBackup',
    'releaseSubscriptions',
    'releaseSourceSettings',
    'readReleases',
    'readForks',
    'customCategories',
    'hiddenDefaultCategoryIds',
    'categoryOrder',
    'collapsedSidebarCategoryCount',
    'categoryMatchMode',
    'defaultCategoryOverrides',
    'assetFilters',
    'repositoryCardFields',
    'lastSync',
    'theme',
    'themePreset',
    'currentView',
    'selectedCategory',
    'language',
    'translationEngine',
    'autoTranslateRepoDescription',
    'isSidebarCollapsed',
    'headerMenuConfig',
    'backendApiSecret',
    'syncMode',
    'syncModeConfigured',
    'categoryListIdMap',
    'searchFilters',
    'repositoryViewMode',
    'releaseViewMode',
    'releaseShowMode',
    'releaseLatestMode',
    'releaseSelectedFilters',
    'releaseSearchQuery',
    'releaseExpandedRepositories',
    'includePreRelease',
    'includeKeysInBackup',
    'forkViewMode',
    'forkSelectedFilters',
    'forkSearchQuery',
    'forkExpandedRepositories',
    'discoveryChannels',
    'selectedDiscoveryChannel',
    'discoveryPlatform',
    'discoveryLanguage',
    'discoverySortBy',
    'discoverySortOrder',
    'discoverySelectedTopic',
    'weeklyOnlyCollected',
    'xTweetFollows',
    'xTweetAuthRevision',
    'telegramFollows',
    'proxyConfig',
    'rpcDownloadConfig',
    'routeMode',
  ],
  // 以下为体积大、变更低频的重数据分片：仅在对应数组引用变化时重写。
  repositories: ['repositories'],
  gists: ['gists', 'starredGists'],
  releases: ['releases'],
  forks: ['forks'],
  // 登出时每账号快照一份完整数据，可能成为最大分片；按账号逐项判脏（见
  // accountWorkspacesUnchanged）避免 hydration 规整化产生的新对象引用触发全量重写。
  accountWorkspaces: ['accountWorkspaces'],
  trendingSnapshots: ['trendingSnapshots'],
};

const FIELD_TO_SHARD = new Map<string, PersistenceShardName>();
for (const [shard, fields] of Object.entries(PERSISTENCE_SHARD_FIELDS)) {
  for (const field of fields) {
    if (FIELD_TO_SHARD.has(field)) {
      throw new Error(`[persistence] field "${field}" is assigned to more than one shard`);
    }
    FIELD_TO_SHARD.set(field, shard as PersistenceShardName);
  }
}

/** 未知字段兜底归入 core，保证新增持久化字段不会因遗漏映射而丢失。 */
export const resolveShardForField = (field: string): PersistenceShardName =>
  FIELD_TO_SHARD.get(field) ?? 'core';

export const shardKeyFor = (name: string, shard: PersistenceShardName): string =>
  `${name}#shard:${shard}`;

export const metaKeyFor = (name: string): string => `${name}#meta`;

/** 分片清单，写入 meta 键；读取时以它为准拼装完整快照。 */
export interface ShardMeta {
  format: number;
  version: number;
  shards: PersistenceShardName[];
  savedAt: string;
}

/** 单个分片的持久化载荷。 */
export interface ShardPayload {
  format: number;
  version: number;
  state: Record<string, unknown>;
}

/** 按 partialize 输出构建每个分片的字段视图（保留原引用，不拷贝）。 */
export const buildShardViews = (
  state: Record<string, unknown>,
): Record<PersistenceShardName, Record<string, unknown>> => {
  const views = {} as Record<PersistenceShardName, Record<string, unknown>>;
  for (const shard of PERSISTENCE_SHARD_NAMES) {
    views[shard] = {};
  }
  for (const [field, value] of Object.entries(state)) {
    views[resolveShardForField(field)][field] = value;
  }
  return views;
};

// 账号工作区：重数组按引用比较；规整化会重建的小对象按内容比较，
// 避免 hydration 后的新引用被误判为真实变更。
// 维护约定：AccountWorkspace 的每个字段必须恰好出现在其中一个列表里
// （storage.test.ts 有覆盖断言），否则新字段的内容变化会被判脏逻辑漏掉。
export const WORKSPACE_REFERENCE_FIELDS = [
  'repositories',
  'gists',
  'starredGists',
  'releases',
  'forks',
  'customCategories',
  'categoryOrder',
  'readReleases',
  'readForks',
  'releaseSubscriptions',
  'hiddenDefaultCategoryIds',
] as const;

export const WORKSPACE_VALUE_FIELDS = [
  'lastSync',
  'selectedGistCategory',
  'releaseSourceSettings',
  'defaultCategoryOverrides',
  'categoryListIdMap',
  'syncMode',
  'syncModeConfigured',
] as const;

const smallValueEqual = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
};

const accountWorkspacesUnchanged = (prev: unknown, next: unknown): boolean => {
  if (Object.is(prev, next)) return true;
  if (!prev || !next || typeof prev !== 'object' || typeof next !== 'object') return false;
  if (Array.isArray(prev) || Array.isArray(next)) return false;
  const prevRecord = prev as Record<string, unknown>;
  const nextRecord = next as Record<string, unknown>;
  const prevKeys = Object.keys(prevRecord);
  if (prevKeys.length !== Object.keys(nextRecord).length) return false;
  for (const accountId of prevKeys) {
    if (!Object.prototype.hasOwnProperty.call(nextRecord, accountId)) return false;
    const prevWorkspace = prevRecord[accountId];
    const nextWorkspace = nextRecord[accountId];
    if (Object.is(prevWorkspace, nextWorkspace)) continue;
    if (!prevWorkspace || !nextWorkspace
      || typeof prevWorkspace !== 'object' || typeof nextWorkspace !== 'object') {
      return false;
    }
    const a = prevWorkspace as Record<string, unknown>;
    const b = nextWorkspace as Record<string, unknown>;
    // 未知字段数量不一致视为已变更，避免漏写历史快照里的额外字段。
    if (Object.keys(a).length !== Object.keys(b).length) return false;
    for (const field of WORKSPACE_REFERENCE_FIELDS) {
      if (!Object.is(a[field], b[field])) return false;
    }
    for (const field of WORKSPACE_VALUE_FIELDS) {
      if (!smallValueEqual(a[field], b[field])) return false;
    }
  }
  return true;
};

/**
 * 找出相对上次成功写入发生变化的分片。
 *
 * - 重数据分片按字段引用判脏（zustand 不可变更新保证未变字段引用不变）；
 * - core 分片按内容判脏：partialize 每次调用都会重建若干小对象/数组
 *   （searchFilters、proxyConfig、Array.from(Set) 等），按引用会让 core
 *   恒判脏；core 体积只有几 KB，JSON 内容比较成本可忽略。
 */
export const findDirtyShards = (
  views: Record<PersistenceShardName, Record<string, unknown>>,
  lastWritten: Record<PersistenceShardName, Record<string, unknown>> | null,
): PersistenceShardName[] => {
  if (!lastWritten) return [...PERSISTENCE_SHARD_NAMES];
  return PERSISTENCE_SHARD_NAMES.filter((shard) => {
    const next = views[shard];
    const prev = lastWritten[shard];
    if (!prev) return true;
    const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
    for (const key of keys) {
      if (shard === 'accountWorkspaces' && key === 'accountWorkspaces') {
        if (!accountWorkspacesUnchanged(prev[key], next[key])) return true;
        continue;
      }
      if (shard === 'core') {
        if (!smallValueEqual(prev[key], next[key])) return true;
        continue;
      }
      if (!Object.is(prev[key], next[key])) return true;
    }
    return false;
  });
};
