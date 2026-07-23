import type { Category, Repository, SearchFilters } from '../types';
import { isRepoCustomized } from './repoUtils';

/** Partial filters used by MCP and UI search (all fields optional except when provided). */
export type RepoSearchFilterInput = Partial<SearchFilters> & {
  category?: string;
  limit?: number;
  offset?: number;
};

export function performBasicTextSearch<T extends Repository>(repos: T[], query: string): T[] {
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

function getSortValue(repo: Repository, sortBy: SearchFilters['sortBy']): number | string {
  switch (sortBy) {
    case 'stars':
      return repo.stargazers_count;
    case 'updated':
      return new Date(repo.pushed_at || repo.updated_at).getTime();
    case 'name':
      return repo.name.toLowerCase();
    case 'starred':
      return repo.starred_at ? new Date(repo.starred_at).getTime() : 0;
    default:
      return new Date(repo.pushed_at || repo.updated_at).getTime();
  }
}

export function sortRepositories<T extends Repository>(
  repos: T[],
  sortBy: SearchFilters['sortBy'] = 'stars',
  sortOrder: SearchFilters['sortOrder'] = 'desc'
): T[] {
  const sorted = [...repos];
  sorted.sort((a, b) => {
    const aValue = getSortValue(a, sortBy);
    const bValue = getSortValue(b, sortBy);
    if (aValue < bValue) return sortOrder === 'desc' ? 1 : -1;
    if (aValue > bValue) return sortOrder === 'desc' ? -1 : 1;
    return 0;
  });
  return sorted;
}

export interface ApplyFiltersOptions {
  releaseSubscriptions?: Set<number> | number[];
  allCategories?: Category[];
  /** When true, skip isEdited filter that needs categories */
  skipEditedFilter?: boolean;
}

/**
 * Apply facet filters and sort. Does NOT auto-clear category-lock UI state
 * (that side effect stays in SearchBar).
 */
export function applyRepoFilters<T extends Repository>(
  repos: T[],
  searchFilters: Partial<SearchFilters>,
  options: ApplyFiltersOptions = {}
): T[] {
  let filtered: T[] = repos;
  const releaseSubscriptions = options.releaseSubscriptions
    ? options.releaseSubscriptions instanceof Set
      ? options.releaseSubscriptions
      : new Set(options.releaseSubscriptions)
    : new Set<number>();
  const allCategories = options.allCategories ?? [];

  const languages = searchFilters.languages ?? [];
  if (languages.length > 0) {
    filtered = filtered.filter(
      (repo) => repo.language && languages.includes(repo.language)
    );
  }

  const tags = searchFilters.tags ?? [];
  if (tags.length > 0) {
    filtered = filtered.filter((repo) => {
      const repoTags = [
        ...(repo.ai_tags || []),
        ...(repo.topics || []),
        ...(repo.custom_tags || []),
      ];
      return tags.some((tag) => repoTags.includes(tag));
    });
  }

  const platforms = searchFilters.platforms ?? [];
  if (platforms.length > 0) {
    filtered = filtered.filter((repo) => {
      const repoPlatforms = repo.ai_platforms || [];
      return platforms.some((platform) => repoPlatforms.includes(platform));
    });
  }

  if (searchFilters.isAnalyzed !== undefined && searchFilters.analysisFailed === undefined) {
    filtered = filtered.filter((repo) =>
      searchFilters.isAnalyzed
        ? !!repo.analyzed_at && !repo.analysis_failed
        : !repo.analyzed_at
    );
  }

  if (searchFilters.isSubscribed !== undefined) {
    filtered = filtered.filter((repo) =>
      searchFilters.isSubscribed
        ? releaseSubscriptions.has(repo.id)
        : !releaseSubscriptions.has(repo.id)
    );
  }

  if (searchFilters.isEdited !== undefined && !options.skipEditedFilter) {
    filtered = filtered.filter((repo) => {
      const customized = isRepoCustomized(repo, allCategories);
      return searchFilters.isEdited ? customized : !customized;
    });
  }

  if (searchFilters.isCategoryLocked !== undefined) {
    filtered = filtered.filter((repo) => {
      const isLocked = !!repo.category_locked;
      return searchFilters.isCategoryLocked ? isLocked : !isLocked;
    });
  }

  if (searchFilters.analysisFailed !== undefined && searchFilters.isAnalyzed === undefined) {
    filtered = filtered.filter((repo) => {
      const hasFailed = !!(repo.analyzed_at && repo.analysis_failed);
      return searchFilters.analysisFailed ? hasFailed : !hasFailed;
    });
  }

  if (searchFilters.minStars !== undefined) {
    filtered = filtered.filter((repo) => repo.stargazers_count >= searchFilters.minStars!);
  }
  if (searchFilters.maxStars !== undefined) {
    filtered = filtered.filter((repo) => repo.stargazers_count <= searchFilters.maxStars!);
  }

  const sortBy = searchFilters.sortBy ?? 'stars';
  const sortOrder = searchFilters.sortOrder ?? 'desc';
  return sortRepositories(filtered, sortBy, sortOrder);
}

/** Full text search + filters + optional category + pagination for MCP/API use. */
export function searchRepositories<T extends Repository>(
  repos: T[],
  input: RepoSearchFilterInput,
  options: ApplyFiltersOptions = {}
): { items: T[]; total: number } {
  let result = repos;

  if (input.query?.trim()) {
    result = performBasicTextSearch(result, input.query);
  }

  if (input.category && input.category !== 'all') {
    const cat = input.category;
    result = result.filter((repo) => {
      const custom = repo.custom_category;
      if (custom) return custom === cat;
      // loose match on custom_category only when no AI category resolution available
      return false;
    });
  }

  result = applyRepoFilters(result, input, options);

  const total = result.length;
  const offset = Math.max(0, input.offset ?? 0);
  const limit = Math.min(100, Math.max(1, input.limit ?? 20));
  const items = result.slice(offset, offset + limit);
  return { items, total };
}

/** Compact projection for agent context economy. */
export function projectRepoForAgent(
  repo: Repository,
  opts: { summaryMaxChars?: number } = {}
): Record<string, unknown> {
  const max = opts.summaryMaxChars ?? 400;
  const summary = repo.ai_summary || repo.custom_description || repo.description || null;
  const truncated =
    typeof summary === 'string' && summary.length > max
      ? `${summary.slice(0, max)}…`
      : summary;

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
