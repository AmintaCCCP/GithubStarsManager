export interface RepositoryRow {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  stargazers_count: number;
  language: string | null;
  created_at: string | null;
  updated_at: string | null;
  pushed_at: string | null;
  starred_at: string | null;
  owner_login: string;
  owner_avatar_url: string | null;
  topics: string;
  ai_summary: string | null;
  ai_tags: string;
  ai_platforms: string;
  analyzed_at: string | null;
  analysis_failed: number;
  custom_description: string | null;
  custom_tags: string;
  custom_category: string | null;
  category_locked: number;
  last_edited: string | null;
  subscribed_to_releases: number;
}

export interface ReleaseRow {
  id: number;
  tag_name: string;
  name: string | null;
  body: string | null;
  published_at: string | null;
  html_url: string | null;
  assets: string;
  repo_id: number;
  repo_full_name: string;
  repo_name: string;
  prerelease: number;
  draft: number;
  is_read: number;
  zipball_url: string | null;
  tarball_url: string | null;
}

export interface CategoryRow {
  id: string;
  name: string;
  description: string | null;
  icon: string;
  keywords: string;
  color: string | null;
  sort_order: number;
  is_custom: number;
}

export interface AIConfigRow {
  id: string;
  name: string;
  api_type: string;
  base_url: string;
  api_key_encrypted: string;
  model: string;
  is_active: number;
  custom_prompt: string | null;
  use_custom_prompt: number;
  concurrency: number;
  reasoning_effort: string | null;
}

export interface WebDAVConfigRow {
  id: string;
  name: string;
  url: string;
  username: string;
  password_encrypted: string;
  path: string;
  is_active: number;
}

export interface AssetFilterRow {
  id: string;
  name: string;
  description: string | null;
  keywords: string;
  platform: string | null;
  sort_order: number;
}

export interface SettingsRow {
  key: string;
  value: string | null;
}

export interface ApiResponse<T = unknown> {
  data?: T;
  error?: string;
  code?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface SyncRepositoriesRequest {
  repositories: Record<string, unknown>[];
  isFullSync?: boolean;
}

export interface SyncReleasesRequest {
  releases: Record<string, unknown>[];
}

export interface SyncAIConfigsRequest {
  configs: Array<{
    id: string;
    name: string;
    apiType?: string;
    baseUrl: string;
    apiKey: string;
    model: string;
    isActive: boolean;
    customPrompt?: string;
    useCustomPrompt?: boolean;
    concurrency?: number;
    reasoningEffort?: string;
  }>;
}

export interface SyncWebDAVConfigsRequest {
  configs: Array<{
    id: string;
    name: string;
    url: string;
    username: string;
    password: string;
    path: string;
    isActive: boolean;
  }>;
}

export interface SyncSettingsRequest {
  activeAIConfig?: string | null;
  activeWebDAVConfig?: string | null;
  hiddenDefaultCategoryIds?: string[];
  categoryOrder?: string[];
  customCategories?: unknown[];
  assetFilters?: unknown[];
  collapsedSidebarCategoryCount?: number;
  github_token?: string;
}
