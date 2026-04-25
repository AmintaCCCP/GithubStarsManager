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
  subscribed_to_releases?: boolean;
  custom_description?: string;
  custom_tags?: string[];
  custom_category?: string;
  category_locked?: boolean;
  last_edited?: string;
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
  repository: {
    id: number;
    full_name: string;
    name: string;
  };
  is_read?: boolean;
}

export interface GitHubUser {
  id: number;
  login: string;
  name: string;
  avatar_url: string;
  email: string | null;
}

export type AIApiType = 'openai' | 'openai-responses' | 'claude' | 'gemini' | 'openai-compatible';
export type AIReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh';

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

export interface AppState {
  // Auth
  user: GitHubUser | null;
  githubToken: string | null;
  isAuthenticated: boolean;
  
  // Repositories
  repositories: Repository[];
  isLoading: boolean;
  lastSync: string | null;
  analyzingRepositoryIds: Set<number>;
  
  // AI
  aiConfigs: AIConfig[];
  activeAIConfig: string | null;
  
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
  currentView: 'repositories' | 'releases' | 'settings' | 'subscription';
  selectedCategory: string;
  language: 'zh' | 'en';
  isSidebarCollapsed: boolean;
  readmeModalOpen: boolean;
  
  // Update
  updateNotification: UpdateNotification | null;

  // Analysis Progress
  analysisProgress: AnalysisProgress

  // Backend
  backendApiSecret: string | null;

  // Release Timeline View
  releaseViewMode: 'timeline' | 'repository';
  releaseSelectedFilters: string[];
  releaseSearchQuery: string;
  releaseExpandedRepositories: Set<number>;
  releaseIsRefreshing: boolean;

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
