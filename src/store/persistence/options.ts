
import type { PersistOptions, PersistStorage } from 'zustand/middleware';
import type { Repository, SubscriptionChannel } from '../../types';
import { defaultHeaderMenuConfig, defaultReleaseSourceSettings, defaultSubscriptionChannels } from '../../types';
import { defaultRepositoryChatSettings } from '../../types/repositoryChat';
import { logger } from '../../services/logger';
import { normalizeReleaseSourceSettings } from '../../utils/releaseSources';
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
import { writeAuthMirror } from './authStorage';
import { debouncedPersistStorage } from './storage';

export const appPersistenceOptions: PersistOptions<AppStoreState, PersistedAppState> = {
  name: 'github-stars-manager',
  version: 12,
  storage: debouncedPersistStorage as PersistStorage<PersistedAppState>,
partialize: (state) => ({
  // 持久化用户信息和认证状态
  user: state.user,
  githubToken: state.githubToken,
  isAuthenticated: state.isAuthenticated,

  // 持久化仓库数据
  repositories: state.repositories,
  lastSync: state.lastSync,

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

  // 持久化UI设置
  theme: state.theme,
  themePreset: state.themePreset,
  currentView: state.currentView,
  selectedCategory: state.selectedCategory,
  language: state.language,
  translationEngine: state.translationEngine,
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
discoverySelectedTopic: state.discoverySelectedTopic,
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
state.discoveryChannels = defaultDiscoveryChannels.map((defaultChannel) => {
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
});
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
'trending': false, 'hot-release': false, 'most-popular': false, 'topic': false, 'search': false,
};
// discoveryScrollPositions 同样不应持久化，重置以避免 stale 滚动位置
(state as Record<string, unknown>).discoveryScrollPositions = {
'trending': 0, 'hot-release': 0, 'most-popular': 0, 'topic': 0, 'search': 0,
};
  }

  // v5→v6: 初始化 proxyConfig
  if (state && !(state as Record<string, unknown>).proxyConfig) {
(state as Record<string, unknown>).proxyConfig = { enabled: false, type: 'http', host: '', port: 7890 };
  }

  // 初始化 rpcDownloadConfig
  if (state && !(state as Record<string, unknown>).rpcDownloadConfig) {
(state as Record<string, unknown>).rpcDownloadConfig = { enabled: false, host: '', port: 6800 };
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
state.setHasHydrated(true);
  };
},
};
