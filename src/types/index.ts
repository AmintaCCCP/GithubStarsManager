export interface Repository {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  stargazers_count: number;
  forks_count: number;
  forks: number;
  language: string | null;
  created_at: string;
  updated_at: string;
  pushed_at: string;
  starred_at?: string;
  owner: {
    login: string;
    avatar_url: string;
  };
  topics: string[];
  ai_summary?: string;
  ai_tags?: string[];
  ai_platforms?: string[];
  analyzed_at?: string;
  analysis_failed?: boolean;
  analysis_error?: string;
  subscribed_to_releases?: boolean;
  custom_description?: string;
  custom_tags?: string[];
  custom_category?: string;
  category_locked?: boolean;
  last_edited?: string;
  vector_indexed_at?: string;  // ISO timestamp of last successful vector indexing
  last_release_fetch_time?: string;  // ISO timestamp, for incremental sync
  has_fetched_releases?: boolean;   // whether this repo has been synced for releases
}

export interface ReleaseAsset {
  id: number;
  name: string;
  size: number;
  download_count: number;
  browser_download_url: string;
  content_type: string;
  created_at: string;
  updated_at: string;
}

export interface Release {
  id: number;
  tag_name: string;
  name: string | null;
  body: string | null;
  published_at: string;
  html_url: string;
  assets: ReleaseAsset[];
  zipball_url?: string;
  tarball_url?: string;
  prerelease?: boolean;
  repository: {
    id: number;
    full_name: string;
    name: string;
  };
  is_read?: boolean;
}

export type ReleaseSourceId = 'starred-release-subscription' | 'watch-custom-release' | 'custom-release';

export interface CustomReleaseRepository {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  owner: {
    login: string;
    avatar_url: string;
  };
  has_fetched_releases?: boolean;
  last_release_fetch_time?: string;
  source_added_at?: string;
  release_hidden?: boolean;
}

export interface ReleaseSourceSettings {
  enabledSourceIds: ReleaseSourceId[];
  watchCustomReleaseRepos: CustomReleaseRepository[];
  customReleaseRepos: CustomReleaseRepository[];
}

export const defaultReleaseSourceSettings: ReleaseSourceSettings = {
  enabledSourceIds: ['starred-release-subscription'],
  watchCustomReleaseRepos: [],
  customReleaseRepos: [],
};

// Fork types
export interface GitHubOrganization {
  id: number;
  login: string;
  avatar_url: string;
  description: string | null;
  html_url: string;
}

export interface ForkRepo {
  id: number;
  name: string;
  fork: boolean;
  full_name: string;
  description: string | null;
  html_url: string;
  stargazers_count: number;
  forks_count: number;
  forks: number;
  language: string | null;
  created_at: string;
  updated_at: string;
  pushed_at: string;
  default_branch: string;
  owner: {
    login: string;
    avatar_url: string;
  };
  source: {
    id: number;
    full_name: string;
    name: string;
    description: string | null;
    html_url: string;
    stargazers_count: number;
    forks_count: number;
    updated_at: string;
    owner: {
      login: string;
      avatar_url: string;
    };
  };
  parent?: {
    id: number;
    full_name: string;
    name: string;
    html_url: string;
  };
  has_unread?: boolean;
  upstream_updated_at?: string; // last time we checked/fetched upstream updates
}

export interface WorkflowDefinition {
  id: number;
  name: string;
  path: string; // workflow file path, e.g. ".github/workflows/ci.yml"
  state: string; // "active" | "disabled" | "warning"
  created_at: string;
  updated_at: string;
  url: string;
  html_url: string;
  badge_url: string;
}

export interface GitHubUser {
  id: number;
  login: string;
  name: string;
  avatar_url: string;
  email: string | null;
}

export interface GistFile {
  filename: string;
  type: string | null;
  language: string | null;
  raw_url?: string;
  size: number;
  truncated?: boolean;
  content?: string;
}

export interface Gist {
  id: string;
  description: string | null;
  public: boolean;
  html_url: string;
  created_at: string;
  updated_at: string;
  comments: number;
  owner: {
    login: string;
    avatar_url: string;
    html_url?: string;
  } | null;
  files: Record<string, GistFile>;
  starred?: boolean;
  ai_summary?: string;
  analyzed_at?: string;
  analysis_failed?: boolean;
  analysis_error?: string;
  last_edited?: string;
}

export type GistCategoryId = 'all' | 'starred' | 'mine';

export interface GistSearchFilters {
  query: string;
  sortBy: 'updated' | 'created' | 'name' | 'files';
  sortOrder: 'desc' | 'asc';
  isAnalyzed?: boolean;
}

export type AIApiType = 'openai' | 'openai-responses' | 'claude' | 'gemini' | 'deepseek' | 'mimo' | 'openai-compatible';

// Embedding 提供商类型
export type EmbeddingApiType = 'openai' | 'openai-compatible' | 'gemini' | 'cohere' | 'ollama' | 'siliconflow';

// Embedding 配置（结构与 AIConfig/WebDAVConfig 平行）
export interface EmbeddingConfig {
  id: string;
  name: string;
  apiType: EmbeddingApiType;
  baseUrl: string;
  apiKey: string;
  model: string;
  dimensions: number;
  isActive: boolean;
  apiKeyStatus?: SecretStatus;
}

// 索引内容模式
export type VectorIndexMode = 'description' | 'readme';

// 向量搜索整体配置（持久化 + 同步，不含运行时状态）
export interface VectorSearchConfig {
  enabled: boolean;
  workerUrl: string;
  authToken: string;
  embeddingConfigId: string;
  indexMode: VectorIndexMode;
  readmeMaxChars: number;  // README 截取字符数，默认 6000
  // 搜索参数（可选，有默认值）
  searchThreshold?: number;   // 相似度阈值，默认 0.35
  searchTopK?: number;        // 返回结果数，默认 30
  enableHyDE?: boolean;       // 是否启用 HyDE 查询预处理，默认 true
  enableReranking?: boolean;  // 是否启用 LLM 语义重排序，默认 true
  // 嵌入文本格式版本，buildEmbeddingText 格式变化时递增
  embeddingFormatVersion?: number;
}

export interface VectorSearchStatus {
  connected: boolean;
  vectorCount: number;
  dimensions: number;
  lastSyncAt?: string;
  error?: string;
}

export interface VectorIndexingState {
  isIndexing: boolean;
  phase: 'readme' | 'embedding' | 'uploading' | null;
  phaseDone: number;
  phaseTotal: number;
  result: { indexed: number; skipped: number; errors: number; error?: string } | null;
}

// 相似仓库视图状态：进入"查找相似仓库"后保存当前上下文，重置时恢复
export interface SimilarViewState {
  active: boolean;
  anchorRepoFullName: string;   // 当前锚点仓库 full_name（横幅展示）
  anchorRepoName: string;        // 锚点仓库名
  similarResults: Repository[];  // 相似结果，渲染用
  originalSearchResults: Repository[]; // 进入前的 searchResults 快照，重置恢复用
}
export type AIReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh';
export type MiMoPlan = 'api' | 'token-plan';

export type SecretStatus = 'ok' | 'empty' | 'decrypt_failed';

export interface AIConfig {
  id: string;
  name: string;
  apiType?: AIApiType; // API 格式/兼容协议（默认 openai）
  baseUrl: string;
  apiKey: string;
  model: string;
  isActive: boolean;
  customPrompt?: string; // 自定义提示词
  useCustomPrompt?: boolean; // 是否使用自定义提示词
  concurrency?: number; // AI分析并发数，默认为1
  reasoningEffort?: AIReasoningEffort; // OpenAI GPT-5/Responses 可选 reasoning 强度
  mimoPlan?: MiMoPlan; // MiMo 渠道：api（按量付费）或 token-plan（订阅制）
  apiKeyStatus?: SecretStatus;
}

export interface WebDAVConfig {
  id: string;
  name: string;
  url: string;
  username: string;
  password: string;
  path: string;
  isActive: boolean;
  passwordStatus?: SecretStatus;
}

export type ProxyType = 'http' | 'socks5';

export interface ProxyConfig {
  enabled: boolean;
  type: ProxyType;
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export interface RpcDownloadConfig {
  enabled: boolean;
  host: string;
  port: number;
  secret?: string;
}

export interface SearchFilters {
  query: string;
  tags: string[];
  languages: string[];
  platforms: string[]; // 新增：平台过滤
  sortBy: 'stars' | 'updated' | 'name' | 'starred';
  sortOrder: 'desc' | 'asc';
  minStars?: number;
  maxStars?: number;
  isAnalyzed?: boolean; // 新增：是否已AI分析
  isSubscribed?: boolean; // 新增：是否订阅Release
  isEdited?: boolean; // 新增：是否已编辑
  isCategoryLocked?: boolean; // 新增：分类是否已锁定
  analysisFailed?: boolean; // 新增：分析是否失败
}

export interface Category {
  id: string;
  name: string;
  icon: string;
  keywords: string[];
  isCustom?: boolean;
  isHidden?: boolean;
}

export interface AssetFilter {
  id: string;
  name: string;
  keywords: string[];
  isPreset?: boolean;
  icon?: string;
}

export type HeaderMenuId = 'repositories' | 'gists' | 'releases' | 'forks' | 'subscription' | 'settings';

export interface HeaderMenuItem {
  id: HeaderMenuId;
  visible: boolean;
  order: number;
}

export const defaultHeaderMenuConfig: HeaderMenuItem[] = [
  { id: 'repositories', visible: true, order: 0 },
  { id: 'gists', visible: true, order: 1 },
  { id: 'releases', visible: true, order: 2 },
  { id: 'forks', visible: true, order: 3 },
  { id: 'subscription', visible: true, order: 4 },
  { id: 'settings', visible: true, order: 5 },
];

export interface AppState {
  // Auth
  user: GitHubUser | null;
  githubToken: string | null;
  isAuthenticated: boolean;
  hasHydrated: boolean;
  
  // Repositories
  repositories: Repository[];
  isLoading: boolean;
  isSyncingStars: boolean;
  lastSync: string | null;
  analyzingRepositoryIds: Set<number>;

  // Gists
  gists: Gist[];
  starredGists: Gist[];
  gistSearchFilters: GistSearchFilters;
  gistSearchResults: Gist[];
  selectedGistCategory: GistCategoryId;
  analyzingGistIds: Set<string>;
  
  // AI
  aiConfigs: AIConfig[];
  activeAIConfig: string | null;

  // Embedding
  embeddingConfigs: EmbeddingConfig[];
  activeEmbeddingConfig: string | null;

  // Vector Search
  vectorSearchConfig: VectorSearchConfig;
  vectorSearchStatus?: VectorSearchStatus;
  vectorIndexingState: VectorIndexingState;

  // Similar repositories view (triggered by "查找相似仓库")
  similarView: SimilarViewState | null;

  // WebDAV
  webdavConfigs: WebDAVConfig[];
  activeWebDAVConfig: string | null;
  lastBackup: string | null;
  
  // Search
  searchFilters: SearchFilters;
  searchResults: Repository[];
  
  // Releases
  releases: Release[];
  releaseSubscriptions: Set<number>;
  releaseSourceSettings: ReleaseSourceSettings;
  readReleases: Set<number>; // 新增：已读Release
  
  // Categories
  customCategories: Category[]; // 新增：自定义分类
  hiddenDefaultCategoryIds: string[];
  defaultCategoryOverrides: Record<string, Partial<Category>>;
  categoryOrder: string[]; // 新增：分类排序顺序
  collapsedSidebarCategoryCount: number; // 新增：折叠状态下显示的分类个数
  
  // Asset Filters
  assetFilters: AssetFilter[]; // 新增：资源过滤器
  
  // UI
  theme: 'light' | 'dark';
  currentView: 'repositories' | 'gists' | 'releases' | 'forks' | 'settings' | 'subscription';
  selectedCategory: string;
  language: 'zh' | 'en';
  isSidebarCollapsed: boolean;
  readmeModalOpen: boolean;
  headerMenuConfig: HeaderMenuItem[];
  
  // Update
  updateNotification: UpdateNotification | null;

  // Analysis Progress
  analysisProgress: AnalysisProgress

  // Backend
  backendApiSecret: string | null;

  // Network Proxy
  proxyConfig: ProxyConfig;
  rpcDownloadConfig: RpcDownloadConfig;

  // Fork Timeline View
  forks: ForkRepo[];
  readForks: Set<number>;

  // Fork Timeline View State
  forkViewMode: 'timeline' | 'repository';
  forkSelectedFilters: string[];
  forkSearchQuery: string;
  forkExpandedRepositories: Set<number>;
  forkIsRefreshing: boolean;

  // Release Timeline View
  releaseViewMode: 'timeline' | 'repository';
  releaseShowMode: 'all' | 'unread';
  releaseLatestMode: 'all' | 'latest';
  releaseSelectedFilters: string[];
  releaseSearchQuery: string;
  releaseExpandedRepositories: Set<number>;
  releaseIsRefreshing: boolean;
  includePreRelease: boolean;  // whether to include pre-release in refresh

  // Backup/Export key inclusion preference
  includeKeysInBackup: boolean;

  // Discovery
  discoveryChannels: DiscoveryChannel[];
  discoveryRepos: Record<DiscoveryChannelId, DiscoveryRepo[]>;
  discoveryLastRefresh: Record<DiscoveryChannelId, string | null>;
  discoveryIsLoading: Record<DiscoveryChannelId, boolean>;
  discoveryIsLoadingMore: Record<DiscoveryChannelId, boolean>;
  discoveryLoadMoreError: Record<DiscoveryChannelId, string | null>;
  selectedDiscoveryChannel: DiscoveryChannelId;
  discoveryPlatform: DiscoveryPlatform;
  discoveryLanguage: ProgrammingLanguage;
  discoverySortBy: SortBy;
  discoverySortOrder: SortOrder;
  discoverySearchQuery: string;
  discoverySelectedTopic: TopicCategory | null;
  discoveryHasMore: Record<DiscoveryChannelId, boolean>;
  discoveryNextPage: Record<DiscoveryChannelId, number>;
  discoveryTotalCount: Record<DiscoveryChannelId, number>;
  discoveryScrollPositions: Record<DiscoveryChannelId, number>;
  trendingTimeRange: TrendingTimeRange;

  // Subscription
  subscriptionRepos: Record<string, SubscriptionRepo[]>;
  subscriptionLastRefresh: Record<string, string | null>;
  subscriptionIsLoading: Record<string, boolean>;
  subscriptionChannels: SubscriptionChannel[];
}

export interface UpdateNotification {
  version: string;
  releaseDate: string;
  changelog: string[];
  downloadUrl: string;
  dismissed: boolean;
}

export interface AnalysisProgress {
  current: number;
  total: number;
}

export type DiscoveryPlatform = 'All' | 'Android' | 'Macos' | 'Windows' | 'Linux';

export type ProgrammingLanguage = 
  | 'All' 
  | 'Kotlin' 
  | 'Java' 
  | 'JavaScript' 
  | 'TypeScript' 
  | 'Python' 
  | 'Swift' 
  | 'Rust' 
  | 'Go' 
  | 'CSharp' 
  | 'CPlusPlus' 
  | 'C' 
  | 'Dart' 
  | 'Ruby' 
  | 'PHP';

export type SortBy = 'BestMatch' | 'MostStars' | 'MostForks';

export type SortOrder = 'Descending' | 'Ascending';

export type DiscoveryChannelId = 'trending' | 'hot-release' | 'most-popular' | 'topic' | 'search';

export type DiscoveryChannelIcon = 'trending' | 'rocket' | 'star' | 'tag' | 'search';

export interface DiscoveryChannel {
  id: DiscoveryChannelId;
  name: string;
  nameEn: string;
  icon: DiscoveryChannelIcon;
  description: string;
  enabled: boolean;
}

export interface PaginatedDiscoveryRepositories {
  repos: DiscoveryRepo[];
  hasMore: boolean;
  nextPageIndex: number;
  totalCount?: number;
}

export interface DiscoveryRepo extends Repository {
  rank: number;
  channel: DiscoveryChannelId;
  platform: DiscoveryPlatform;
}

export type TrendingTimeRange = 'daily' | 'weekly' | 'monthly';

export type TopicCategory = 
  | 'ai' 
  | 'ml' 
  | 'database' 
  | 'web' 
  | 'mobile' 
  | 'devtools' 
  | 'security' 
  | 'game';

export interface TopicInfo {
  id: TopicCategory;
  name: string;
  nameEn: string;
  keywords: string;
}

// Subscription related types
export interface SubscriptionRepo extends Repository {
  rank: number;
  channel: 'most-stars' | 'most-forks' | 'most-dev' | 'trending';
}

export interface SubscriptionDev {
  rank: number;
  login: string;
  avatar_url: string;
  html_url: string;
  name: string | null;
  bio: string | null;
  public_repos: number;
  followers: number;
  topRepo: SubscriptionRepo | null;
}

// GitHub API response types
export interface GitHubSearchUserResponse {
  items: Array<{
    login: string;
    avatar_url: string;
    html_url: string;
  }>;
}

export interface GitHubUserDetail {
  login: string;
  avatar_url: string;
  html_url: string;
  name: string | null;
  bio: string | null;
  public_repos: number;
  followers: number;
}

// Subscription channel types
export interface SubscriptionChannel {
  id: string;
  name: string;
  nameEn: string;
  icon: string;
  description: string;
  enabled: boolean;
}

export const defaultSubscriptionChannels: SubscriptionChannel[] = [
  {
    id: 'most-stars',
    name: '最多星标',
    nameEn: 'Most Stars',
    icon: '⭐',
    description: 'GitHub 上星标数最多的项目 Top 10',
    enabled: true,
  },
  {
    id: 'most-forks',
    name: '最多复刻',
    nameEn: 'Most Forks',
    icon: '🍴',
    description: 'GitHub 上复刻数最多的项目 Top 10',
    enabled: true,
  },
  {
    id: 'most-dev',
    name: '热门开发者',
    nameEn: 'Top Developers',
    icon: '👤',
    description: 'GitHub 上最受关注的开发者 Top 10',
    enabled: true,
  },
  {
    id: 'trending',
    name: '热门趋势',
    nameEn: 'Trending',
    icon: '🔥',
    description: 'GitHub 上近期最受关注的项目 Top 10',
    enabled: true,
  },
];
