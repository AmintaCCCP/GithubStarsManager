export interface Repository {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  stargazers_count: number;
  language: string | null;
  created_at: string;
  updated_at: string;
  pushed_at: string;
  starred_at?: string; // 新增：加入星标的时间
  owner: {
    login: string;
    avatar_url: string;
  };
  topics: string[];
  // AI generated fields
  ai_summary?: string;
  ai_tags?: string[];
  ai_platforms?: string[]; // 新增：支持的平台类型
  analyzed_at?: string;
  analysis_failed?: boolean; // 新增：AI分析是否失败
  // Release subscription
  subscribed_to_releases?: boolean;
  // Manual editing fields
  custom_description?: string;
  custom_tags?: string[];
  custom_category?: string;
  category_locked?: boolean; // 是否锁定分类（锁定后同步不自动改分类）
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

export type AIApiType = 'openai' | 'openai-responses' | 'claude' | 'gemini';
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

  // Subscription
  subscriptionChannels: SubscriptionChannel[];
  subscriptionRepos: Record<SubscriptionChannelId, SubscriptionRepo[]>;
  subscriptionDevs: SubscriptionDev[];
  subscriptionLastRefresh: Record<SubscriptionChannelId, string | null>;
  subscriptionIsLoading: Record<SubscriptionChannelId, boolean>;
  selectedSubscriptionChannel: SubscriptionChannelId;
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

export type SubscriptionChannelId = 'most-stars' | 'most-forks' | 'most-dev' | 'trending';

export interface SubscriptionChannel {
  id: SubscriptionChannelId;
  name: string;
  nameEn: string;
  icon: string;
  description: string;
  enabled: boolean;
}

export interface SubscriptionRepo extends Repository {
  rank: number;
  channel: SubscriptionChannelId;
  forks?: number;
  forks_count?: number;
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
