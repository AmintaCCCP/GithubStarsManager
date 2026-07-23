/**
 * Pure repo search helpers for MCP (mirrors src/utils/repoSearch.ts).
 * Kept server-local to avoid coupling the Express package to the Vite app tree.
 */

export interface McpRepository {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  stargazers_count: number;
  language: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  pushed_at?: string | null;
  starred_at?: string | null;
  topics: string[];
  ai_summary?: string | null;
  ai_tags?: string[];
  ai_platforms?: string[];
  analyzed_at?: string | null;
  analysis_failed?: boolean;
  custom_description?: string | null;
  custom_tags?: string[];
  custom_category?: string | null;
  category_locked?: boolean;
  subscribed_to_releases?: boolean;
  owner?: { login: string; avatar_url?: string };
}

export interface McpSearchFilters {
  query?: string;
  tags?: string[];
  languages?: string[];
  platforms?: string[];
  sortBy?: 'stars' | 'updated' | 'name' | 'starred';
  sortOrder?: 'desc' | 'asc';
  minStars?: number;
  maxStars?: number;
  isAnalyzed?: boolean;
  isSubscribed?: boolean;
  isCategoryLocked?: boolean;
  analysisFailed?: boolean;
  category?: string;
  limit?: number;
  offset?: number;
}

export function performBasicTextSearch<T extends McpRepository>(repos: T[], query: string): T[] {
  const normalizedQuery = query.toLowerCase().trim();
  if (!normalizedQuery) return repos;
  const queryWords = normalizedQuery.split(/\s+/).filter(Boolean);

  return repos.filter((repo) => {
    const searchableText = [
      repo.name,
      repo.full_name,
      repo.description || '',
      repo.custom_description || '',
      repo.language || '',
      ...(repo.topics || []),
      repo.ai_summary || '',
      ...(repo.ai_tags || []),
      ...(repo.ai_platforms || []),
      ...(repo.custom_tags || []),
      repo.custom_category || '',
    ]
      .join(' ')
      .toLowerCase();
    return queryWords.every((word) => searchableText.includes(word));
  });
}

function getSortValue(repo: McpRepository, sortBy: McpSearchFilters['sortBy']): number | string {
  switch (sortBy) {
    case 'stars':
      return repo.stargazers_count ?? 0;
    case 'updated':
      return new Date(repo.pushed_at || repo.updated_at || 0).getTime();
    case 'name':
      return repo.name.toLowerCase();
    case 'starred':
      return repo.starred_at ? new Date(repo.starred_at).getTime() : 0;
    default:
      return new Date(repo.pushed_at || repo.updated_at || 0).getTime();
  }
}

export function applyRepoFilters<T extends McpRepository>(
  repos: T[],
  filters: McpSearchFilters
): T[] {
  let filtered: T[] = repos;

  if (filters.languages?.length) {
    filtered = filtered.filter((r) => r.language && filters.languages!.includes(r.language));
  }
  if (filters.tags?.length) {
    filtered = filtered.filter((r) => {
      const tags = [...(r.ai_tags || []), ...(r.topics || []), ...(r.custom_tags || [])];
      return filters.tags!.some((t) => tags.includes(t));
    });
  }
  if (filters.platforms?.length) {
    filtered = filtered.filter((r) => {
      const platforms = r.ai_platforms || [];
      return filters.platforms!.some((p) => platforms.includes(p));
    });
  }
  if (filters.isAnalyzed !== undefined && filters.analysisFailed === undefined) {
    filtered = filtered.filter((r) =>
      filters.isAnalyzed ? !!r.analyzed_at && !r.analysis_failed : !r.analyzed_at
    );
  }
  if (filters.isSubscribed !== undefined) {
    filtered = filtered.filter((r) =>
      filters.isSubscribed ? !!r.subscribed_to_releases : !r.subscribed_to_releases
    );
  }
  if (filters.isCategoryLocked !== undefined) {
    filtered = filtered.filter((r) =>
      filters.isCategoryLocked ? !!r.category_locked : !r.category_locked
    );
  }
  if (filters.analysisFailed !== undefined && filters.isAnalyzed === undefined) {
    filtered = filtered.filter((r) => {
      const hasFailed = !!(r.analyzed_at && r.analysis_failed);
      return filters.analysisFailed ? hasFailed : !hasFailed;
    });
  }
  if (filters.minStars !== undefined) {
    filtered = filtered.filter((r) => (r.stargazers_count ?? 0) >= filters.minStars!);
  }
  if (filters.maxStars !== undefined) {
    filtered = filtered.filter((r) => (r.stargazers_count ?? 0) <= filters.maxStars!);
  }
  if (filters.category && filters.category !== 'all') {
    filtered = filtered.filter((r) => r.custom_category === filters.category);
  }

  const sortBy = filters.sortBy ?? 'stars';
  const sortOrder = filters.sortOrder ?? 'desc';
  const sorted = [...filtered];
  sorted.sort((a, b) => {
    const aValue = getSortValue(a, sortBy);
    const bValue = getSortValue(b, sortBy);
    if (aValue < bValue) return sortOrder === 'desc' ? 1 : -1;
    if (aValue > bValue) return sortOrder === 'desc' ? -1 : 1;
    return 0;
  });
  return sorted;
}

export function searchRepositories<T extends McpRepository>(
  repos: T[],
  filters: McpSearchFilters
): { items: T[]; total: number } {
  let result = repos;
  if (filters.query?.trim()) {
    result = performBasicTextSearch(result, filters.query);
  }
  result = applyRepoFilters(result, filters);
  const total = result.length;
  const offset = Math.max(0, filters.offset ?? 0);
  const limit = Math.min(100, Math.max(1, filters.limit ?? 20));
  return { items: result.slice(offset, offset + limit), total };
}

export function projectRepoForAgent(
  repo: McpRepository,
  opts: { summaryMaxChars?: number } = {}
): Record<string, unknown> {
  const max = opts.summaryMaxChars ?? 400;
  const summary = repo.ai_summary || repo.custom_description || repo.description || null;
  const truncated =
    typeof summary === 'string' && summary.length > max ? `${summary.slice(0, max)}…` : summary;

  return {
    id: repo.id,
    full_name: repo.full_name,
    name: repo.name,
    html_url: repo.html_url,
    description: repo.description,
    language: repo.language,
    stargazers_count: repo.stargazers_count,
    topics: repo.topics ?? [],
    ai_summary: truncated,
    ai_tags: repo.ai_tags ?? [],
    ai_platforms: repo.ai_platforms ?? [],
    custom_description: repo.custom_description,
    custom_tags: repo.custom_tags,
    custom_category: repo.custom_category,
    analyzed_at: repo.analyzed_at,
    subscribed_to_releases: !!repo.subscribed_to_releases,
    starred_at: repo.starred_at,
    updated_at: repo.updated_at,
    pushed_at: repo.pushed_at,
  };
}
