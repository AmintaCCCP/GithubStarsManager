
import type {
  AppState,
  AssetFilter,
  Category,
  DiscoveryChannel,
  GistSearchFilters,
  HeaderMenuId,
  ProxyConfig,
  RpcDownloadConfig,
  McpServiceConfig,
  SearchFilters,
  VectorSearchConfig,
  VectorSearchStatus,
  RepositoryChatSettings,
} from '../types';
import { defaultRepositoryChatAgentBudget, defaultRepositoryChatSettings } from '../types/repositoryChat';
import { EMBEDDING_FORMAT_VERSION } from '../services/vectorSearchService';
import { MCP_DEFAULT_HOST, MCP_DEFAULT_PORT, normalizeMcpHost } from '../utils/mcpHost';
import { PRESET_FILTERS } from '../constants/presetFilters';

export const REQUIRED_HEADER_MENU_IDS: ReadonlySet<HeaderMenuId> = new Set(['repositories', 'settings']);

export const initialSearchFilters: SearchFilters = {
  query: '',
  tags: [],
  languages: [],
  platforms: [],
  licenses: [],
  sortBy: 'stars',
  sortOrder: 'desc',
  isAnalyzed: undefined,
  isSubscribed: undefined,
  isEdited: undefined,
  isCategoryLocked: undefined,
  analysisFailed: undefined,
};

export const initialGistSearchFilters: GistSearchFilters = {
  query: '',
  sortBy: 'updated',
  sortOrder: 'desc',
  isAnalyzed: undefined,
};

export type PersistedAppState = Partial<
  Omit<Pick<
    AppState,
    | 'user'
    | 'githubToken'
    | 'isAuthenticated'
    | 'backendApiSecret'
    | 'repositories'
    | 'gists'
    | 'starredGists'
    | 'gistSearchFilters'
    | 'gistSearchResults'
    | 'selectedGistCategory'
    | 'lastSync'
    | 'aiConfigs'
    | 'activeAIConfig'
    | 'repositoryChatSettings'
    | 'embeddingConfigs'
    | 'activeEmbeddingConfig'
    | 'vectorSearchConfig'
    | 'vectorSearchStatus'
    | 'webdavConfigs'
    | 'activeWebDAVConfig'
    | 'lastBackup'
    | 'releases'
    | 'releaseSourceSettings'
    | 'customCategories'
    | 'hiddenDefaultCategoryIds'
    | 'defaultCategoryOverrides'
    | 'categoryOrder'
    | 'collapsedSidebarCategoryCount'
    | 'categoryMatchMode'
    | 'assetFilters'
    | 'theme'
    | 'themePreset'
    | 'currentView'
    | 'selectedCategory'
    | 'language'
    | 'translationEngine'
    | 'searchFilters'
    | 'isSidebarCollapsed'
    | 'repositoryViewMode'
    | 'forks'
    | 'forkViewMode'
    | 'forkSelectedFilters'
    | 'forkSearchQuery'
    | 'forkExpandedRepositories'
    | 'releaseViewMode'
    | 'releaseShowMode'
    | 'releaseLatestMode'
    | 'releaseSelectedFilters'
    | 'releaseSearchQuery'
    | 'includePreRelease'
    | 'includeKeysInBackup'
    | 'discoveryChannels'
    | 'discoveryRepos'
    | 'discoveryLastRefresh'
    | 'discoveryTotalCount'
    | 'discoveryHasMore'
    | 'discoveryNextPage'
    | 'selectedDiscoveryChannel'
    | 'discoveryPlatform'
    | 'discoveryLanguage'
    | 'discoverySortBy'
    | 'discoverySortOrder'
    | 'discoverySelectedTopic'
    | 'proxyConfig'
    | 'rpcDownloadConfig'
    | 'routeMode'
    | 'subscriptionRepos'
    | 'subscriptionLastRefresh'
    | 'subscriptionIsLoading'
    | 'subscriptionChannels'
    | 'headerMenuConfig'
    | 'mcpConfig'
    | 'syncMode'
    | 'syncModeConfigured'
    | 'categoryListIdMap'
  >, 'gistSearchFilters' | 'searchFilters' | 'releaseExpandedRepositories' | 'forkExpandedRepositories'>> & {
  gistSearchFilters?: Pick<GistSearchFilters, 'sortBy' | 'sortOrder'>;
  searchFilters?: Pick<SearchFilters, 'sortBy' | 'sortOrder'>;
  proxyConfig?: ProxyConfig;
  rpcDownloadConfig?: RpcDownloadConfig;
  releaseSubscriptions?: unknown;
  readReleases?: unknown;
  readForks?: unknown;
  analyzingGistIds?: unknown;
  releaseExpandedRepositories?: unknown;
  forkExpandedRepositories?: unknown;
};

export const normalizeRepositoryChatSettings = (value: unknown): RepositoryChatSettings => {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const retainSessionDays = typeof record.retainSessionDays === 'number' && Number.isFinite(record.retainSessionDays)
    ? Math.min(365, Math.max(1, Math.round(record.retainSessionDays)))
    : defaultRepositoryChatSettings.retainSessionDays;
  const legacyMaxToolsPerTurn = typeof record.maxToolsPerTurn === 'number' && Number.isFinite(record.maxToolsPerTurn)
    ? Math.min(48, Math.max(1, Math.round(record.maxToolsPerTurn)))
    : defaultRepositoryChatSettings.maxToolsPerTurn;
  const rawBudget = record.agentBudget && typeof record.agentBudget === 'object' && !Array.isArray(record.agentBudget)
    ? record.agentBudget as Record<string, unknown>
    : {};
  const inRange = (value: unknown, fallback: number, min: number, max: number): number => (
    typeof value === 'number' && Number.isFinite(value)
      ? Math.min(max, Math.max(min, Math.round(value)))
      : fallback
  );
  const maxToolCalls = inRange(rawBudget.maxToolCalls, legacyMaxToolsPerTurn, 1, 48);
  const maxReadFiles = inRange(rawBudget.maxReadFiles, defaultRepositoryChatAgentBudget.maxReadFiles, 1, 16);
  const agentBudget = {
    maxTurns: inRange(rawBudget.maxTurns, defaultRepositoryChatAgentBudget.maxTurns, 1, 8),
    maxToolCalls,
    maxReadFiles,
    maxCodeReads: Math.min(maxReadFiles, inRange(rawBudget.maxCodeReads, defaultRepositoryChatAgentBudget.maxCodeReads, 0, 12)),
    maxNoProgressRounds: inRange(rawBudget.maxNoProgressRounds, defaultRepositoryChatAgentBudget.maxNoProgressRounds, 1, 4),
    maxDurationMs: inRange(rawBudget.maxDurationMs, defaultRepositoryChatAgentBudget.maxDurationMs, 15_000, 300_000),
  };
  const taskDepth = record.taskDepth === 'quick' || record.taskDepth === 'deep' || record.taskDepth === 'unlimited'
    ? record.taskDepth
    : 'default';
  return {
    enabled: record.enabled !== false,
    chatConfigId: typeof record.chatConfigId === 'string' ? record.chatConfigId : null,
    streamingMode: record.streamingMode === 'off' ? 'off' : 'auto',
    taskDepth,
    enableWebTools: record.enableWebTools === true,
    enableAgentToolLoop: record.enableAgentToolLoop === true,
    retainSessionDays,
    maxToolsPerTurn: maxToolCalls,
    agentBudget,
  };
};

export const normalizeNumberSet = (value: unknown): Set<number> => {
  if (value instanceof Set) {
    return new Set(Array.from(value).filter((item): item is number => typeof item === 'number'));
  }

  if (Array.isArray(value)) {
    return new Set(value.filter((item): item is number => typeof item === 'number'));
  }

  return new Set<number>();
};

// 新安装/重置配置的默认：已是最新格式版本，避免首次增量索引被误判为需要全量重建
export const defaultVectorSearchConfig: VectorSearchConfig = {
  enabled: false,
  workerUrl: '',
  authToken: '',
  embeddingConfigId: '',
  indexMode: 'readme',
  readmeMaxChars: 6000,
  searchThreshold: 0.35,
  searchTopK: 30,
  enableHyDE: true,
  enableReranking: true,
  embeddingFormatVersion: EMBEDDING_FORMAT_VERSION,
};

export const defaultVectorSearchStatus: VectorSearchStatus = {
  connected: false,
  vectorCount: 0,
  dimensions: 0,
};

export const normalizeVectorSearchStatus = (raw: unknown): VectorSearchStatus => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...defaultVectorSearchStatus };
  }

  const status = raw as Record<string, unknown>;
  const vectorCount = typeof status.vectorCount === 'number'
    && Number.isInteger(status.vectorCount)
    && status.vectorCount >= 0
    ? status.vectorCount
    : defaultVectorSearchStatus.vectorCount;
  const dimensions = typeof status.dimensions === 'number'
    && Number.isInteger(status.dimensions)
    && status.dimensions >= 0
    ? status.dimensions
    : defaultVectorSearchStatus.dimensions;

  return {
    connected: status.connected === true,
    vectorCount,
    dimensions,
    ...(typeof status.lastSyncAt === 'string' && Number.isFinite(Date.parse(status.lastSyncAt))
      ? { lastSyncAt: status.lastSyncAt }
      : {}),
    ...(typeof status.error === 'string' ? { error: status.error } : {}),
  };
};

export const defaultMcpConfig: McpServiceConfig = {
  enabled: false,
  host: MCP_DEFAULT_HOST,
  port: MCP_DEFAULT_PORT,
  token: '',
};

export const normalizeMcpConfig = (raw: unknown): McpServiceConfig => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...defaultMcpConfig };
  }
  const config = raw as Record<string, unknown>;
  const port =
    typeof config.port === 'number' && Number.isInteger(config.port) && config.port >= 1 && config.port <= 65535
      ? config.port
      : defaultMcpConfig.port;
  return {
    enabled: config.enabled === true,
    host: normalizeMcpHost(config.host),
    port,
    token: typeof config.token === 'string' ? config.token : '',
  };
};

// 持久化历史配置缺失 embeddingFormatVersion 时的回退版本：旧值为 1，确保旧用户触发一次重建
export const LEGACY_EMBEDDING_FORMAT_VERSION = 1;

export const isKnownEmbeddingFormatVersion = (value: unknown): value is number => (
  typeof value === 'number'
  && Number.isInteger(value)
  && value >= LEGACY_EMBEDDING_FORMAT_VERSION
  && value <= EMBEDDING_FORMAT_VERSION
);

export const normalizeVectorSearchConfig = (
  raw: unknown,
  embeddingConfigs: unknown
): VectorSearchConfig => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...defaultVectorSearchConfig };
  }

  const config = raw as Record<string, unknown>;
  const configId = typeof config.embeddingConfigId === 'string' ? config.embeddingConfigId : '';
  // 仅在确实存在 embeddingConfigId 时才查找 embedding 配置，避免每次 hydration 都遍历 embeddingConfigs
  const hasValidConfig = configId
    ? (Array.isArray(embeddingConfigs)
        ? embeddingConfigs.some((cfg) => cfg && typeof cfg === 'object' && (cfg as { id?: unknown }).id === configId)
        : false)
    : false;
  const searchThreshold = typeof config.searchThreshold === 'number' && Number.isFinite(config.searchThreshold) && config.searchThreshold >= 0 && config.searchThreshold <= 1
    ? config.searchThreshold
    : defaultVectorSearchConfig.searchThreshold;
  const searchTopK = typeof config.searchTopK === 'number' && Number.isInteger(config.searchTopK) && config.searchTopK >= 5 && config.searchTopK <= 50
    ? config.searchTopK
    : defaultVectorSearchConfig.searchTopK;
  // 持久化的 embeddingFormatVersion 缺失或越界时一律回落到 legacy 版本 1，触发一次全量重建；
  // 不使用 defaultVectorSearchConfig.embeddingFormatVersion（= 最新版），否则旧用户会跳过重建
  const embeddingFormatVersion = isKnownEmbeddingFormatVersion(config.embeddingFormatVersion)
    ? config.embeddingFormatVersion
    : LEGACY_EMBEDDING_FORMAT_VERSION;

  return {
    ...defaultVectorSearchConfig,
    enabled: config.enabled === true && hasValidConfig,
    workerUrl: typeof config.workerUrl === 'string' ? config.workerUrl : defaultVectorSearchConfig.workerUrl,
    authToken: typeof config.authToken === 'string' ? config.authToken : defaultVectorSearchConfig.authToken,
    embeddingConfigId: hasValidConfig ? configId : defaultVectorSearchConfig.embeddingConfigId,
    indexMode: config.indexMode === 'description' ? 'description' : 'readme',
    readmeMaxChars: typeof config.readmeMaxChars === 'number' && config.readmeMaxChars > 0
      ? config.readmeMaxChars
      : defaultVectorSearchConfig.readmeMaxChars,
    searchThreshold,
    searchTopK,
    enableHyDE: typeof config.enableHyDE === 'boolean'
      ? config.enableHyDE
      : defaultVectorSearchConfig.enableHyDE,
    enableReranking: typeof config.enableReranking === 'boolean'
      ? config.enableReranking
      : defaultVectorSearchConfig.enableReranking,
    embeddingFormatVersion,
  };
};

export const mergeVectorSearchConfig = (
  current: VectorSearchConfig,
  patch: Partial<VectorSearchConfig>
): VectorSearchConfig => {
  const currentVersion = isKnownEmbeddingFormatVersion(current.embeddingFormatVersion)
    ? current.embeddingFormatVersion
    : EMBEDDING_FORMAT_VERSION;
  const patchVersion = patch.embeddingFormatVersion;
  const embeddingFormatVersion = isKnownEmbeddingFormatVersion(patchVersion)
    ? Math.max(currentVersion, patchVersion)
    : currentVersion;

  return {
    ...current,
    ...patch,
    embeddingFormatVersion,
  };
};


export const defaultCategories: Category[] = [
  {
    id: 'all',
    name: '全部分类',
    icon: '📁',
    keywords: []
  },
  {
    id: 'web',
    name: 'Web应用',
    icon: '🌐',
    keywords: ['web应用', 'web', 'website', 'frontend', 'react', 'vue', 'angular']
  },
  {
    id: 'mobile',
    name: '移动应用',
    icon: '📱',
    keywords: ['移动应用', 'mobile', 'android', 'ios', 'flutter', 'react-native']
  },
  {
    id: 'desktop',
    name: '桌面应用',
    icon: '💻',
    keywords: ['桌面应用', 'desktop', 'electron', 'gui', 'qt', 'gtk']
  },
  {
    id: 'database',
    name: '数据库',
    icon: '🗄️',
    keywords: ['数据库', 'database', 'sql', 'nosql', 'mongodb', 'mysql', 'postgresql']
  },
  {
    id: 'ai',
    name: 'AI/机器学习',
    icon: '🤖',
    keywords: ['ai工具', 'ai', 'ml', 'machine learning', 'deep learning', 'neural']
  },
  {
    id: 'devtools',
    name: '开发工具',
    icon: '🔧',
    keywords: ['开发工具', 'tool', 'cli', 'build', 'deploy', 'debug', 'test', 'automation']
  },
  {
    id: 'security',
    name: '安全工具',
    icon: '🛡️',
    keywords: ['安全工具', 'security', 'encryption', 'auth', 'vulnerability']
  },
  {
    id: 'game',
    name: '游戏',
    icon: '🎮',
    keywords: ['游戏', 'game', 'gaming', 'unity', 'unreal', 'godot']
  },
  {
    id: 'design',
    name: '设计工具',
    icon: '🎨',
    keywords: ['设计工具', 'design', 'ui', 'ux', 'graphics', 'image']
  },
  {
    id: 'productivity',
    name: '效率工具',
    icon: '⚡',
    keywords: ['效率工具', 'productivity', 'note', 'todo', 'calendar', 'task']
  },
  {
    id: 'education',
    name: '教育学习',
    icon: '📚',
    keywords: ['教育学习', 'education', 'learning', 'tutorial', 'course']
  },
  {
    id: 'social',
    name: '社交网络',
    icon: '👥',
    keywords: ['社交网络', 'social', 'chat', 'messaging', 'communication']
  },
  {
    id: 'analytics',
    name: '数据分析',
    icon: '📊',
    keywords: ['数据分析', 'analytics', 'data', 'visualization', 'chart']
  }
];

// 预设筛选器图标映射
const PRESET_FILTER_ICONS: Record<string, string> = {
  'preset-windows': 'Monitor',
  'preset-macos': 'Apple',
  'preset-linux': 'Terminal',
  'preset-android': 'Smartphone',
  'preset-source': 'Package',
};

// 默认预设筛选器
export const defaultPresetFilters: AssetFilter[] = PRESET_FILTERS.map(pf => ({
  ...pf,
  isPreset: true,
  icon: PRESET_FILTER_ICONS[pf.id] || 'Package',
}));

export const defaultDiscoveryChannels: DiscoveryChannel[] = [
  {
    id: 'trending',
    name: '趋势',
    nameEn: 'Trending',
    icon: 'trending',
    description: 'GitHub 趋势仓库，支持今日/本周/本月筛选',
    enabled: true,
  },
  {
    id: 'hot-release',
    name: '热门发布',
    nameEn: 'Hot Release',
    icon: 'rocket',
    description: '最近14天内活跃更新的仓库',
    enabled: true,
  },
  {
    id: 'most-popular',
    name: '最受欢迎',
    nameEn: 'Most Popular',
    icon: 'star',
    description: '星标数超过1000的稳定热门仓库',
    enabled: true,
  },
  {
    id: 'topic',
    name: '主题探索',
    nameEn: 'Topic',
    icon: 'tag',
    description: '按主题分类浏览仓库',
    enabled: true,
  },
  {
    id: 'search',
    name: '搜索发现',
    nameEn: 'Search',
    icon: 'search',
    description: '自定义搜索发现新项目',
    enabled: true,
  },
];
