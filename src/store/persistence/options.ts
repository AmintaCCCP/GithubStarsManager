
import type { PersistOptions, PersistStorage } from 'zustand/middleware';
import type { GitHubUser, Repository, SubscriptionChannel } from '../../types';
import { defaultHeaderMenuConfig, defaultReleaseSourceSettings, defaultSubscriptionChannels } from '../../types';
import { defaultRepositoryChatSettings } from '../../types/repositoryChat';
import { logger } from '../../services/logger';
import { normalizeReleaseSourceSettings } from '../../utils/releaseSources';
import { normalizeXTweetFollows } from '../../utils/xTweetFollows';
import { normalizeTelegramFollows } from '../../utils/telegramFollows';
import { normalizeExternalDiscoveryChannels } from '../../utils/discoveryFeeds';
import { accountIdKey, normalizeSavedAccounts } from '../helpers/accountWorkspace';
import type { AppStoreState } from '../types';
import {
  defaultDiscoveryChannels,
  normalizeMcpConfig,
  normalizeRepositoryChatSettings,
  normalizeVectorSearchConfig,
  normalizeVectorSearchStatus,
  PersistedAppState,
} from '../schema';
import { normalizePersistedState } from '../normalizers/persistedState';
import { useAppStore } from '../useAppStore';
import { readLegacyAuthMirrorForDesktopMigration, writeAuthMirror } from './authStorage';
import {
  hasGhAccountsBridge,
  loadGhAccountTokens,
  saveGhAccountTokens,
  type GhAccountTokenMap,
} from './ghAccountSecrets';
import { debouncedPersistStorage } from './storage';

/**
 * 记录 v18→v19 迁移阶段发起的桌面端加密凭据保存，供 onRehydrateStorage 等待
 * 落盘完成后再读取 gh-accounts.enc，避免首次升级时读取早于写入导致会话丢失。
 */
let pendingMigrationTokenSave: Promise<{ ok: boolean; tokens: GhAccountTokenMap; error?: unknown }> | null = null;

/**
 * v19 凭据迁移的落盘确认标记（审计修复）：partialize 仅在该标记为 true 时才
 * 提交剥除 PAT 的 savedAccounts——加密保存成功（或本次启动无需迁移：Web 构建
 * 剥除即设计、桌面无 Token 可迁移）后才提交干净快照；保存失败或尚未落盘确认
 * 时保留原快照中的 Token，配合 onRehydrateStorage 的迁移重试，保证未成功
 * 保存的凭据跨重启仍可重试迁入 safeStorage，而不是被首次持久化永久清除。
 * Web 构建（无桥）恒为确认态：PAT 本就不持久化，剥除即 B7/CWE-922 设计。
 */
let v19TokenSaveConfirmed = !hasGhAccountsBridge();

/**
 * 审计修复（B7/CWE-922）：持久化分片只保留 savedAccounts 的非敏感元数据
 * （accountId、user、addedAt、lastUsedAt），githubToken 一律剥除（置空串）。
 * PAT 仅存桌面端 safeStorage 加密文件（经 ghAccounts IPC），Web 构建不持久化
 * PAT——切换/恢复该账号时要求重新授权。
 */
const stripSavedAccountTokens = (
  savedAccounts: Record<string, import('../../types').SavedAccount>,
): Record<string, import('../../types').SavedAccount> => {
  let changed = false;
  const next: Record<string, import('../../types').SavedAccount> = {};
  for (const [accountId, account] of Object.entries(savedAccounts ?? {})) {
    if (!account?.githubToken) {
      next[accountId] = account;
      continue;
    }
    changed = true;
    next[accountId] = { ...account, githubToken: '' };
  }
  return changed ? next : savedAccounts;
};

/**
 * v19 凭据迁移的落盘确认重试（审计修复）：迁移保存失败时持久化快照仍携带
 * 旧 PAT（partialize 在确认前不剥除），否则未成功保存的凭据会在下一次持久化
 * 后永久丢失且迁移不会重跑。每次桌面端水化收尾时检查内存中尚存的账号凭据：
 * - 无残留 Token：迁移早已完成（或无需迁移），置确认标记恢复剥除语义；
 * - 有残留 Token：重试迁入 safeStorage，成功后置确认标记，下一次持久化
 *   提交干净快照；失败则保留快照与内存中的 Token，下次启动再次重试。
 */
const retryUnconfirmedV19TokenSave = async (): Promise<void> => {
  if (v19TokenSaveConfirmed || !hasGhAccountsBridge()) return;
  const store = useAppStore.getState();
  const tokens: GhAccountTokenMap = {};
  for (const [accountId, account] of Object.entries(store.savedAccounts ?? {})) {
    if (account?.githubToken?.trim()) tokens[accountId] = account.githubToken;
  }
  const currentAccountId = accountIdKey(store.user);
  const currentToken = typeof store.githubToken === 'string' ? store.githubToken.trim() : '';
  if (currentAccountId && currentToken && !tokens[currentAccountId]) {
    tokens[currentAccountId] = currentToken;
  }
  if (Object.keys(tokens).length === 0) {
    v19TokenSaveConfirmed = true;
    return;
  }
  try {
    // R2-B1 合并写入语义同样适用于重试：只补写确认映射中缺失/最新的条目，
    // 不覆写磁盘上其他账号的 Token。
    await saveGhAccountTokens(tokens);
    v19TokenSaveConfirmed = true;
  } catch (err) {
    logger.warn('store.hydrate', 'v19 gh-accounts migration retry failed; legacy tokens kept in persisted snapshot', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

export const appPersistenceOptions: PersistOptions<AppStoreState, PersistedAppState> = {
  name: 'github-stars-manager',
  version: 19,
  storage: debouncedPersistStorage as PersistStorage<PersistedAppState>,
partialize: (state) => ({
  // 持久化用户信息和登录标识。审计修复（B7/CWE-922）：明文 PAT 不再进入
  // 浏览器持久化分片——顶层 githubToken 与 savedAccounts[].githubToken 均剥除，
  // PAT 由桌面端 safeStorage 文件（ghAccounts IPC）承载；isAuthenticated 在
  // 水化时由 normalizePersistedState 按 user+token 重算。
  user: state.user,
  isAuthenticated: state.isAuthenticated,
  accountWorkspaces: state.accountWorkspaces,
  // 审计修复：savedAccounts 的 PAT 剥除仅在 v19 迁移落盘确认后提交——加密保存
  // 失败/未确认时保留原快照中的 Token（可重试状态），否则首次持久化会写出不含
  // PAT 的 v19 快照，重启后迁移不再重跑，未成功迁入 safeStorage 的凭据全部丢失。
  // 确认后恢复 B7/CWE-922 语义：持久化分片不含任何明文 PAT。
  savedAccounts: v19TokenSaveConfirmed ? stripSavedAccountTokens(state.savedAccounts) : state.savedAccounts,

  // 持久化仓库数据
  repositories: state.repositories,
  lastSync: state.lastSync,

  // Theme token（开发守则 §14）：声明式外观偏好
  themeTokens: state.themeTokens,

  // 持久化 Gist 数据
  gists: state.gists,
  starredGists: state.starredGists,
  gistSearchFilters: {
sortBy: state.gistSearchFilters.sortBy,
sortOrder: state.gistSearchFilters.sortOrder,
  },
  selectedGistCategory: state.selectedGistCategory,
  analyzingGistIds: Array.from(state.analyzingGistIds),

  // 持久化AI配置
  aiConfigs: state.aiConfigs,
  activeAIConfig: state.activeAIConfig,
  repositoryChatSettings: state.repositoryChatSettings,

  // 持久化Embedding配置
  embeddingConfigs: state.embeddingConfigs,
  activeEmbeddingConfig: state.activeEmbeddingConfig,

  // 持久化向量搜索配置
  vectorSearchConfig: state.vectorSearchConfig,
  // 持久化向量搜索状态（vectorCount 等，跨重启保留）
  vectorSearchStatus: state.vectorSearchStatus,

  // MCP prefs + bearer token (stable across restarts; only changes on user reset)
  mcpConfig: state.mcpConfig,

  // 持久化WebDAV配置
  webdavConfigs: state.webdavConfigs,
  activeWebDAVConfig: state.activeWebDAVConfig,
  lastBackup: state.lastBackup,

  // 持久化Release订阅、来源和已读状态
  releaseSubscriptions: Array.from(state.releaseSubscriptions),
  releaseSourceSettings: state.releaseSourceSettings,
  readReleases: Array.from(state.readReleases),
  releases: state.releases,

  // 持久化Fork数据
  forks: state.forks,
  readForks: Array.from(state.readForks),

  // 持久化自定义分类
  customCategories: state.customCategories,
  hiddenDefaultCategoryIds: state.hiddenDefaultCategoryIds,
  categoryOrder: state.categoryOrder,
  collapsedSidebarCategoryCount: state.collapsedSidebarCategoryCount,
  categoryMatchMode: state.categoryMatchMode,
  defaultCategoryOverrides: state.defaultCategoryOverrides,

  // 持久化资源过滤器
  assetFilters: state.assetFilters,
  // 卡片可见字段（开发守则 §14）
  repositoryCardFields: state.repositoryCardFields,
  repositoryCardActions: state.repositoryCardActions,
  pluginCustomIcons: state.pluginCustomIcons,

  // Trending 快照（开发守则 §7）：本地榜单历史，不参与任何远端同步
  trendingSnapshots: state.trendingSnapshots,

  // 持久化UI设置
  themeMode: state.themeMode,
  themePresetLight: state.themePresetLight,
  themePresetDark: state.themePresetDark,
  currentView: state.currentView,
  selectedCategory: state.selectedCategory,
  language: state.language,
  translationEngine: state.translationEngine,
  autoTranslateRepoDescription: state.autoTranslateRepoDescription,
  // 更新检查偏好：自动检查开关 + 用户"不再提示"的版本号
  autoUpdateCheckEnabled: state.autoUpdateCheckEnabled,
  updatePromptDismissedVersion: state.updatePromptDismissedVersion,
  isSidebarCollapsed: state.isSidebarCollapsed,
  headerMenuConfig: state.headerMenuConfig,

  // 持久化后端 API Secret（跨会话/跨标签保留，配合修复 #259）。同时保留
  // localStorage 镜像（AUTH_MIRROR_KEY）作为异步 IndexedDB 写入失败时的兜底。
  backendApiSecret: state.backendApiSecret,

  // 持久化同步范围配置（GitHub Lists 同步）
  syncMode: state.syncMode,
  syncModeConfigured: state.syncModeConfigured,
  // 持久化分类 → GitHub List 映射（跨语言稳定身份）
  categoryListIdMap: state.categoryListIdMap,

  // 持久化搜索排序设置
  searchFilters: {
sortBy: state.searchFilters.sortBy,
sortOrder: state.searchFilters.sortOrder,
  },

  // 持久化仓库页面视图设置
  repositoryViewMode: state.repositoryViewMode,
  // 持久化Release页面视图设置
  releaseViewMode: state.releaseViewMode,
  releaseShowMode: state.releaseShowMode,
  releaseLatestMode: state.releaseLatestMode,
  releaseSelectedFilters: state.releaseSelectedFilters,
  releaseSearchQuery: state.releaseSearchQuery,
  releaseExpandedRepositories: Array.from(state.releaseExpandedRepositories),
  includePreRelease: state.includePreRelease,
  includeKeysInBackup: state.includeKeysInBackup,

  // 持久化Fork页面视图设置
  forkViewMode: state.forkViewMode,
  forkSelectedFilters: state.forkSelectedFilters,
  forkSearchQuery: state.forkSearchQuery,
  forkExpandedRepositories: Array.from(state.forkExpandedRepositories),

// 持久化发现设置
discoveryChannels: state.discoveryChannels,
selectedDiscoveryChannel: state.selectedDiscoveryChannel,
// discoveryRepos 不持久化，它是极其庞大的 JSON 对象。
// 在 Electron 41/v8/macOS 上的 IDB partialize 阶段，
// 由于频繁序列化这个可能达数MB的大对象，会触发底层 JIT CHECK assertion failed (brk 0) 导致崩溃。
// 这里的会话级运行时数据都取消持久化：
// discoveryRepos
// discoveryLastRefresh
// discoveryTotalCount
// discoveryHasMore
// discoveryNextPage
discoveryPlatform: state.discoveryPlatform,
discoveryLanguage: state.discoveryLanguage,
discoverySortBy: state.discoverySortBy,
discoverySortOrder: state.discoverySortOrder,
// 仓库搜索模式（关键词/AI 语义）持久化；语义搜索的 phase 进度与空态原因是
// 会话级运行时数据（同 discoveryRepos 理由），不入白名单。
discoverySearchMode: state.discoverySearchMode,
discoverySelectedTopic: state.discoverySelectedTopic,
  weeklyOnlyCollected: state.weeklyOnlyCollected,
  xTweetFollows: state.xTweetFollows,
  // xTweetAuth 仅由桌面端 safeStorage 安全加密存储（Web 模式仅在内存），避免明文 Cookie 写入 IndexedDB/localStorage（CWE-922）。
  // 仅持久化非敏感的 xTweetAuthRevision 用于跨会话请求签名稳定性。
  xTweetAuthRevision: state.xTweetAuthRevision,
  telegramFollows: state.telegramFollows,
// 持久化完整代理配置，包含认证密码，确保重启后无需重新输入。
proxyConfig: {
  enabled: state.proxyConfig.enabled,
  type: state.proxyConfig.type,
  host: state.proxyConfig.host,
  port: state.proxyConfig.port,
  username: state.proxyConfig.username,
  password: state.proxyConfig.password,
},
// 持久化 RPC 下载配置（含密钥，确保重启后不丢失）
rpcDownloadConfig: {
  enabled: state.rpcDownloadConfig.enabled,
  host: state.rpcDownloadConfig.host,
  port: state.rpcDownloadConfig.port,
  secret: state.rpcDownloadConfig.secret,
},
routeMode: state.routeMode,
}),
migrate: (persistedState) => {
  // 版本升级适配处理
  const state = persistedState as PersistedAppState | undefined;

  if (state && !state.releaseSourceSettings) {
console.log('Migrating from old version: initializing releaseSourceSettings');
state.releaseSourceSettings = defaultReleaseSourceSettings;
  } else if (state) {
state.releaseSourceSettings = normalizeReleaseSourceSettings(state.releaseSourceSettings);
  }

  // 从旧版本升级时，确保 categoryOrder 字段存在
  if (state && !Array.isArray(state.categoryOrder)) {
console.log('Migrating from old version: initializing categoryOrder');
state.categoryOrder = [];
  }

  // 从旧版本升级时，确保 collapsedSidebarCategoryCount 字段存在
  if (state && typeof state.collapsedSidebarCategoryCount !== 'number') {
console.log('Migrating from old version: initializing collapsedSidebarCategoryCount');
state.collapsedSidebarCategoryCount = 20;
  }

  // 从旧版本升级时，确保 defaultCategoryOverrides 字段存在
  if (state && typeof state.defaultCategoryOverrides !== 'object') {
console.log('Migrating from old version: initializing defaultCategoryOverrides');
state.defaultCategoryOverrides = {};
  }

  // 从旧版本升级时，确保 vectorSearchStatus 字段存在（vectorCount 等）
  if (state) {
state.vectorSearchStatus = normalizeVectorSearchStatus(state.vectorSearchStatus);
  }

  // Additive: MCP config defaults when missing (upgrade). Old builds ignore this key on downgrade.
  if (state) {
const stateRecord = state as Record<string, unknown>;
stateRecord.mcpConfig = normalizeMcpConfig(stateRecord.mcpConfig);
  }

  // 迁移仓库数据中的旧标记
  if (state && Array.isArray(state.repositories)) {
let migratedCount = 0;
state.repositories = state.repositories.map((repo: Repository) => {
  // 将旧的 '__EMPTY__' 标记转换为空字符串（表示用户明确清空）
  if (repo.custom_description === '__EMPTY__') {
    migratedCount++;
    return { ...repo, custom_description: '' };
  }
  return repo;
});
if (migratedCount > 0) {
  console.log(`Migrated ${migratedCount} repositories: converted '__EMPTY__' to empty string`);
}
  }

  if (state && !state.selectedDiscoveryChannel) {
state.selectedDiscoveryChannel = 'trending';
  }
  if (state && (!state.discoveryChannels || !Array.isArray(state.discoveryChannels))) {
state.discoveryChannels = defaultDiscoveryChannels;
  } else if (state && Array.isArray(state.discoveryChannels)) {
const persistedChannels = state.discoveryChannels as unknown[];
state.discoveryChannels = [...defaultDiscoveryChannels.map((defaultChannel) => {
const persistedChannel = persistedChannels.find((channel) => {
  return (channel as Record<string, unknown>)?.id === defaultChannel.id;
}) as Record<string, unknown> | undefined;

if (!persistedChannel) {
  return defaultChannel;
}

return {
...defaultChannel,
enabled: persistedChannel.enabled !== false,
};
}), ...normalizeExternalDiscoveryChannels(persistedChannels)];
  }
  // 迁移订阅频道（版本 4→5：daily-dev → most-dev，新增 trending，补全 nameEn）
  const defaultChannelsMap = new Map(defaultSubscriptionChannels.map(ch => [ch.id, ch]));
  if (state && !Array.isArray(state.subscriptionChannels)) {
console.log('Migrating: initializing subscription channels');
state.subscriptionChannels = defaultSubscriptionChannels;
  } else if (state && Array.isArray(state.subscriptionChannels)) {
state.subscriptionChannels = state.subscriptionChannels.map((ch: unknown) => {
const chRecord = ch as Record<string, unknown>;
const defaultCh = defaultChannelsMap.get(chRecord.id as string);
if (chRecord.id === 'daily-dev' || chRecord.id === 'most-dev') {
  return { ...chRecord, id: 'most-dev', name: '热门开发者', nameEn: 'Top Developers', icon: '👤' } as unknown as SubscriptionChannel;
}
if (defaultCh) {
  return {
...(chRecord as Partial<SubscriptionChannel>),
name: defaultCh.name, // 始终使用中文名称
nameEn: (chRecord.nameEn as string) || defaultCh.nameEn || (chRecord.name as string) || defaultCh.nameEn,
icon: (chRecord.icon as string) || defaultCh.icon,
description: (chRecord.description as string) || defaultCh.description,
  } as unknown as SubscriptionChannel;
}
return chRecord as unknown as SubscriptionChannel;
});
// 确保 trending 频道存在（如果缺失则添加）
const hasTrending = state.subscriptionChannels.some((ch: SubscriptionChannel) => ch.id === 'trending');
if (!hasTrending) {
console.log('Migrating: adding trending channel');
state.subscriptionChannels.push({
  id: 'trending',
  name: '热门趋势',
  nameEn: 'Trending',
  icon: 'trending',
  description: 'GitHub 上近期最受关注的项目 Top 10',
  enabled: true,
} as SubscriptionChannel);
}
  }
  if (state && !state.discoveryPlatform) {
state.discoveryPlatform = 'All';
  }
  // 版本 6→7：新增 includeKeysInBackup（默认 false，安全优先）
  if (state && typeof state.includeKeysInBackup !== 'boolean') {
console.log('Migrating: initializing includeKeysInBackup to false (security first)');
state.includeKeysInBackup = false;
  }
  if (state && !state.discoveryLanguage) {
state.discoveryLanguage = 'All';
  }
  if (state && !state.discoverySortBy) {
state.discoverySortBy = 'BestMatch';
  }
  if (state && !state.discoverySortOrder) {
state.discoverySortOrder = 'Descending';
  }
  // discoveryIsLoading 不应持久化，migrate 时始终重置防止旧数据格式异常导致 spread 崩溃
  if (state) {
(state as Record<string, unknown>).discoveryIsLoading = {
'trending': false, 'hot-release': false, 'most-popular': false, 'topic': false, 'x-tweet': false, 'telegram': false, 'weekly': false, 'search': false, 'code-search': false,
};
// discoveryScrollPositions 同样不应持久化，重置以避免 stale 滚动位置
(state as Record<string, unknown>).discoveryScrollPositions = {
'trending': 0, 'hot-release': 0, 'most-popular': 0, 'topic': 0, 'x-tweet': 0, 'telegram': 0, 'weekly': 0, 'search': 0, 'code-search': 0,
};
  }

  // v14: 周刊频道过滤器偏好兜底
  if (state && typeof (state as Record<string, unknown>).weeklyOnlyCollected !== 'boolean') {
    (state as Record<string, unknown>).weeklyOnlyCollected = false;
  }

  // v16→v17: 更新检查偏好兜底（自动检查默认开启；"不再提示"版本默认为空）
  if (state) {
    const stateRecord = state as Record<string, unknown>;
    if (typeof stateRecord.autoUpdateCheckEnabled !== 'boolean') {
      stateRecord.autoUpdateCheckEnabled = true;
    }
    if (typeof stateRecord.updatePromptDismissedVersion !== 'string' || !stateRecord.updatePromptDismissedVersion) {
      stateRecord.updatePromptDismissedVersion = null;
    }
  }

  // v14→v15: X 推文频道选项兜底（关注列表默认含 geekbb）
  if (state) {
    const stateRecord = state as Record<string, unknown>;
    stateRecord.xTweetFollows = normalizeXTweetFollows(stateRecord.xTweetFollows);
    // 旧快照可能含明文 xTweetAuth：直接删除（不删除整个快照），内存态置 null；
    // 清理后的快照随下次持久化写回 IndexedDB/localStorage。
    if ('xTweetAuth' in stateRecord) delete stateRecord.xTweetAuth;
    if (typeof stateRecord.xTweetAuthRevision !== 'number' || !Number.isFinite(stateRecord.xTweetAuthRevision)) {
      stateRecord.xTweetAuthRevision = 0;
    }
    (state as Record<string, unknown>).telegramFollows = normalizeTelegramFollows(
      (state as Record<string, unknown>).telegramFollows,
    );
  }

  // v5→v6: 初始化 proxyConfig
  if (state && !(state as Record<string, unknown>).proxyConfig) {
(state as Record<string, unknown>).proxyConfig = { enabled: false, type: 'http', host: '', port: 7890 };
  }

  // 初始化 rpcDownloadConfig
  if (state && !(state as Record<string, unknown>).rpcDownloadConfig) {
(state as Record<string, unknown>).rpcDownloadConfig = { enabled: false, host: '', port: 6800 };
  }

  // v12→v13: 初始化 routeMode（纯本地偏好，缺失或非法时回退 auto，不参与后端/autoSync 同步）
  if (state) {
    const stateRecord = state as Record<string, unknown>;
    if (stateRecord.routeMode !== 'backend' && stateRecord.routeMode !== 'browser') {
      stateRecord.routeMode = 'auto';
    }
  }

  // v8→v9: 初始化 headerMenuConfig
  if (state && !Array.isArray((state as Record<string, unknown>).headerMenuConfig)) {
(state as Record<string, unknown>).headerMenuConfig = defaultHeaderMenuConfig;
  }

  // v9→v10: 初始化 backendApiSecret（旧版仅存 sessionStorage；migrate 前置为 null）
  if (state && typeof (state as Record<string, unknown>).backendApiSecret !== 'string') {
(state as Record<string, unknown>).backendApiSecret = null;
  }

  // v11→v12: 仓库问答设置只存非敏感字段；旧快照使用安全默认值。
  if (state) {
    const stateRecord = state as Record<string, unknown>;
    stateRecord.repositoryChatSettings = normalizeRepositoryChatSettings(
      stateRecord.repositoryChatSettings ?? defaultRepositoryChatSettings,
    );
  }

  // 初始化 embeddingConfigs
  if (state && !Array.isArray((state as Record<string, unknown>).embeddingConfigs)) {
(state as Record<string, unknown>).embeddingConfigs = [];
  }
  if (state && typeof (state as Record<string, unknown>).activeEmbeddingConfig !== 'string') {
(state as Record<string, unknown>).activeEmbeddingConfig = null;
  }

  // 初始化/迁移 vectorSearchConfig
  if (state) {
const stateRecord = state as Record<string, unknown>;
stateRecord.vectorSearchConfig = normalizeVectorSearchConfig(
stateRecord.vectorSearchConfig,
stateRecord.embeddingConfigs
);
stateRecord.mcpConfig = normalizeMcpConfig(stateRecord.mcpConfig);
    }

  // v15→v16: per-GitHub-id workspace snapshots so logout does not wipe local data
  if (state) {
    const stateRecord = state as Record<string, unknown>;
    if (typeof stateRecord.accountWorkspaces !== 'object'
      || stateRecord.accountWorkspaces === null
      || Array.isArray(stateRecord.accountWorkspaces)) {
      stateRecord.accountWorkspaces = {};
    }
  }

  // v17→v18: 初始化 savedAccounts，并将当前已登录账号自动回填进 savedAccounts
  if (state) {
    const stateRecord = state as Record<string, unknown>;
    const normalizedSaved = normalizeSavedAccounts(stateRecord.savedAccounts);
    const existingUser = stateRecord.user as GitHubUser | null | undefined;
    const existingToken = stateRecord.githubToken as string | null | undefined;
    const uid = accountIdKey(existingUser);
    if (uid && existingUser && typeof existingToken === 'string' && existingToken) {
      const now = new Date().toISOString();
      normalizedSaved[uid] = {
        accountId: uid,
        user: existingUser,
        githubToken: existingToken,
        addedAt: normalizedSaved[uid]?.addedAt ?? now,
        lastUsedAt: now,
      };
    }
    stateRecord.savedAccounts = normalizedSaved;
  }

  // v18→v19（审计修复 B7/CWE-922，一次性迁移）：把已持久化的明文 PAT 清出
  // 浏览器状态分片。桌面端先把剥除的 Token 立即迁入 safeStorage 加密文件
  //（gh-accounts.enc，fire-and-forget；写失败则该账号按「需重新授权」处理）；
  // Web 构建不持久化 PAT，重新授权即可恢复。partialize 此后也不再写出 Token，
  // 清理后的分片随水化后的首次持久化自然重写。
  if (state) {
    const stateRecord = state as Record<string, unknown>;
    const legacySaved = normalizeSavedAccounts(stateRecord.savedAccounts);
    const legacyUser = stateRecord.user as GitHubUser | null | undefined;
    const legacyTopToken = typeof stateRecord.githubToken === 'string' ? stateRecord.githubToken : '';
    const legacyTopAccountId = accountIdKey(legacyUser);
    const tokens: GhAccountTokenMap = {};
    for (const [accountId, account] of Object.entries(legacySaved)) {
      if (account?.githubToken?.trim()) tokens[accountId] = account.githubToken;
    }
    if (legacyTopAccountId && legacyTopToken.trim() && !tokens[legacyTopAccountId]) {
      tokens[legacyTopAccountId] = legacyTopToken;
    }
    // 一次性桌面迁移兜底：旧快照缺 Token 时从旧认证镜像核对同账号 PAT 并迁入 safeStorage，
    // 迁移成功后才清掉镜像中的明文 PAT（非桌面端不回读）。
    let migratedFromMirror: { user: GitHubUser | null; backendApiSecret: string | null } | null = null;
    if (hasGhAccountsBridge()) {
      const legacyMirror = readLegacyAuthMirrorForDesktopMigration();
      const mirrorUser = legacyMirror?.user ?? null;
      const mirrorAccountId = accountIdKey(mirrorUser);
      if (legacyMirror?.githubToken && mirrorAccountId && mirrorUser
        && (!legacyTopAccountId || mirrorAccountId === legacyTopAccountId)
        && !tokens[mirrorAccountId]) {
        tokens[mirrorAccountId] = legacyMirror.githubToken;
        migratedFromMirror = { user: mirrorUser, backendApiSecret: legacyMirror.backendApiSecret };
        // 审计修复：迁入镜像凭据时同时补录账号记录——旧快照只有 user 而缺
        // githubToken/savedAccounts 时，仅迁 Token 不建条目会让后续归一化看到
        // 顶层 PAT 已为 null 而无法补录，savedAccounts 为空导致 switchAccount
        // 无法选择该账号。用已核对身份的 mirror user 补录缺失条目（已有条目
        // 保持不变），随后按现有流程剥除账号 PAT。
        if (!legacySaved[mirrorAccountId]) {
          const now = new Date().toISOString();
          legacySaved[mirrorAccountId] = {
            accountId: mirrorAccountId,
            user: mirrorUser,
            githubToken: legacyMirror.githubToken,
            addedAt: now,
            lastUsedAt: now,
          };
        }
      }
    }
    if (Object.keys(tokens).length > 0 && hasGhAccountsBridge()) {
      // R2-B1：迁移时磁盘完整映射尚未加载，saveGhAccountTokens 自动先读后写
      // 合并更新——迁移写入的 Token 不会抹掉 gh-accounts.enc 中其他账号已有的 PAT。
      // 保存 Promise 交给 onRehydrateStorage 等待完成后再读盘，防止读早于写。
      const tokensSnapshot = { ...tokens };
      const mirrorToClear = migratedFromMirror;
      pendingMigrationTokenSave = saveGhAccountTokens(tokensSnapshot)
        .then(() => {
          // 加密保存成功：此后持久化分片才允许提交剥除 PAT 的干净快照。
          v19TokenSaveConfirmed = true;
          if (mirrorToClear) {
            writeAuthMirror({
              user: mirrorToClear.user,
              githubToken: null,
              backendApiSecret: mirrorToClear.backendApiSecret,
            });
          }
          return { ok: true as const, tokens: tokensSnapshot };
        })
        .catch((err) => ({ ok: false as const, tokens: tokensSnapshot, error: err }));
    } else {
      // 无需迁移落盘：Web 构建不持久化 PAT（剥除即设计），桌面无 Token 时
      // 剥除为空操作——直接确认，保持既有剥除语义。
      v19TokenSaveConfirmed = true;
    }
    stateRecord.githubToken = null;
    stateRecord.savedAccounts = stripSavedAccountTokens(legacySaved);
  }

  return state as PersistedAppState;
},
merge: (persistedState, currentState) => {
  const normalized = normalizePersistedState(
persistedState as PersistedAppState | undefined,
currentState as AppStoreState
  );

  logger.info('store.hydrate', 'Store rehydrated', {
isAuthenticated: normalized.isAuthenticated,
repositoriesCount: normalized.repositories?.length || 0,
gistsCount: normalized.gists?.length || 0,
lastSync: normalized.lastSync,
language: normalized.language,
webdavConfigsCount: normalized.webdavConfigs?.length || 0,
customCategoriesCount: normalized.customCategories?.length || 0,
  });

  // Keep the synchronous localStorage mirror aligned with the hydrated
  // auth state (covers restores that came from IndexedDB or the mirror).
  const merged = {
...currentState,
...normalized,
  };
  writeAuthMirror({
user: merged.user ?? null,
githubToken: typeof merged.githubToken === 'string' ? merged.githubToken : null,
backendApiSecret: typeof merged.backendApiSecret === 'string' ? merged.backendApiSecret : null,
  });

  return merged;
},
onRehydrateStorage: (state) => {
  const hydrationStart = Date.now();
  return (_rehydratedState, error) => {
const elapsedMs = Date.now() - hydrationStart;
if (error) {
  logger.errorFromError('store.hydrate', 'Store hydration failed', error, { elapsedMs });
} else {
  logger.info('store.hydrate', 'Store hydration complete', { elapsedMs });
}
// 审计修复（B7）：桌面端水化后先从 safeStorage 加密文件回填账号 Token，
// 再宣布 hydration 完成——避免 isAuthenticated 短暂为 false 导致登录页闪现。
// Web 构建（无 IPC 桥）直接完成：PAT 未持久化，按需重新授权。
// 审计修复（R2-B1）：读取失败（桥异常/主进程 error）与「磁盘上没有 Token」
// 是两回事——失败时保持「未加载」状态（saveGhAccountTokens 此后自动合并
// 写入，绝不覆写磁盘上其他账号的 PAT），只有确认加载到完整映射才回填。
const finishHydration = () => state.setHasHydrated(true);
if (error || !hasGhAccountsBridge()) {
  finishHydration();
  return;
}
const migrationSave = pendingMigrationTokenSave;
pendingMigrationTokenSave = null;
(migrationSave ?? Promise.resolve(null))
  .then(async (migrationResult) => {
    if (migrationResult && !migrationResult.ok) {
      logger.warn('store.hydrate', 'v19 gh-accounts migration save failed; restoring migrated tokens in memory', {
        error: migrationResult.error instanceof Error ? migrationResult.error.message : String(migrationResult.error),
      });
      // 显式恢复分支：迁移落盘失败时不按成功路径读盘，先把迁移出的 Token 回填到内存保持本次会话可用
      if (Object.keys(migrationResult.tokens).length > 0) {
        const { restorePersistedAccountTokens } = useAppStore.getState();
        restorePersistedAccountTokens(migrationResult.tokens);
      }
      // 迁移保存失败后立即重试一次：瞬时故障可自愈；仍失败则保留可重试状态
      //（持久化快照继续携带旧 Token，下次启动再次重试，见 retry 函数注释）。
      await retryUnconfirmedV19TokenSave();
      return;
    }
    const result = await loadGhAccountTokens();
    if (result.status === 'error') {
      logger.warn('store.hydrate', 'gh-accounts secure storage read failed; tokens not restored', {
        error: result.error,
      });
      return;
    }
    if (result.status === 'loaded' && Object.keys(result.tokens).length > 0) {
      // 惰性访问 store（模块初始化环规避，同 accountWorkspace 的做法）
      const { restorePersistedAccountTokens } = useAppStore.getState();
      restorePersistedAccountTokens(result.tokens);
    }
    // 迁移成功路径的确认标记已在保存成功的 then 中置位；本次启动无需迁移时
    // 由 retry 检查收敛（快照无 Token 即确认，仍有残留 Token 则重试迁入）。
    await retryUnconfirmedV19TokenSave();
  })
  .catch(() => undefined)
  .finally(() => finishHydration());
  };
},
};
