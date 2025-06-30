export interface Repository {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  stargazers_count: number;
  language: string | null;
  updated_at: string;
  pushed_at: string;
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
  // Release subscription
  subscribed_to_releases?: boolean;
  // Manual editing fields
  custom_description?: string;
  custom_tags?: string[];
  custom_category?: string;
  last_edited?: string;
}

export interface Release {
  id: number;
  tag_name: string;
  name: string;
  body: string;
  published_at: string;
  html_url: string;
  repository: {
    id: number;
    full_name: string;
    name: string;
  };
  // Read status
  is_read?: boolean;
}

export interface GitHubUser {
  id: number;
  login: string;
  name: string;
  avatar_url: string;
  email: string | null;
}

export interface AIConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  isActive: boolean;
}

export interface WebDAVConfig {
  id: string;
  name: string;
  url: string;
  username: string;
  password: string;
  path: string;
  isActive: boolean;
}

export interface SearchFilters {
  query: string;
  tags: string[];
  languages: string[];
  platforms: string[]; // 新增：平台过滤
  sortBy: 'stars' | 'updated' | 'name' | 'created';
  sortOrder: 'desc' | 'asc';
  minStars?: number;
  maxStars?: number;
  isAnalyzed?: boolean; // 新增：是否已AI分析
  isSubscribed?: boolean; // 新增：是否订阅Release
}

export interface Category {
  id: string;
  name: string;
  icon: string;
  keywords: string[];
  isCustom?: boolean;
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
  
  // UI
  theme: 'light' | 'dark';
  currentView: 'repositories' | 'releases' | 'settings';
  language: 'zh' | 'en';
}