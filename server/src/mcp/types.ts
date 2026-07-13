export interface McpRepoSummary {
  fullName: string;
  name: string;
  description: string | null;
  htmlUrl: string;
  stars: number;
  language: string | null;
  topics: string[];
  customTags: string[];
  aiTags: string[];
  platforms: string[];
  category: string | null;
  updatedAt: string | null;
  analyzed: boolean;
}

export interface McpRepoComment {
  fullName: string;
  customDescription: string | null;
  notes: string | null;
}

export interface McpRepoDetail extends McpRepoSummary {
  customDescription: string | null;
  aiSummary: string | null;
  notes: string | null;
  readmeSnippet: string | null;
  starredAt: string | null;
  vectorIndexedAt: string | null;
}

export interface McpReleaseSummary {
  repoFullName: string;
  repoName: string;
  tagName: string;
  name: string | null;
  publishedAt: string | null;
  htmlUrl: string;
  prerelease: boolean;
  isRead: boolean;
}

export interface McpStat {
  totalRepositories: number;
  analyzedCount: number;
  byLanguage: Record<string, number>;
  byCategory: Record<string, number>;
  topTags: Array<{ tag: string; count: number }>;
}

export interface McpListFilter {
  query?: string;
  tags?: string[];
  languages?: string[];
  categories?: string[];
  minStars?: number;
  maxStars?: number;
  isAnalyzed?: boolean;
  sortBy?: 'stars' | 'updated' | 'name' | 'starred';
  sortOrder?: 'desc' | 'asc';
  limit?: number;
  offset?: number;
}

export interface McpDataProvider {
  listRepositories(filter: McpListFilter): Promise<McpRepoSummary[]>;
  getRepository(fullName: string): Promise<McpRepoDetail | null>;
  getRepositoryComments(fullName: string): Promise<McpRepoComment | null>;
  semanticSearch(query: string, topK: number): Promise<Array<{ fullName: string; score: number }>>;
  listCategories(): Promise<Array<{ id: string; name: string; count: number }>>;
  listTags(): Promise<Array<{ tag: string; count: number }>>;
  listReleases(since: string | null, limit: number): Promise<McpReleaseSummary[]>;
  getStats(): Promise<McpStat>;
  isVectorSearchEnabled(): Promise<boolean>;
}
