import {
  matchesRepoFilters,
  NO_LICENSE_SENTINEL,
  normalizeLicense,
  projectRepoForAgent,
  type McpRepository,
  type McpSearchFilters,
} from './repoSearch.js';

export const MCP_BATCH_LIMIT = 50;
export const VECTOR_CANDIDATE_LIMIT = 50;

export interface VectorCandidate<T extends McpRepository = McpRepository> {
  id: string;
  score: number;
  repository: T;
}

export interface FilteredVectorCandidates<T extends McpRepository = McpRepository> {
  matches: Array<VectorCandidate<T>>;
  candidateCount: number;
  filteredCount: number;
}

export function hasActiveVectorFilters(filters: McpSearchFilters): boolean {
  return Boolean(
    filters.languages?.length ||
      filters.tags?.length ||
      filters.platforms?.length ||
      filters.licenses?.length ||
      (filters.category && filters.category !== 'all') ||
      filters.minStars !== undefined ||
      filters.maxStars !== undefined ||
      filters.isAnalyzed !== undefined ||
      filters.isSubscribed !== undefined
  );
}

/**
 * Match the metadata portion of src/services/vectorSearchService.ts. The
 * backend does not have a README cache, so similarity is deliberately limited
 * to local structured fields and never performs a remote README fan-out.
 */
export function buildRepositoryEmbeddingText(repo: McpRepository): string {
  const parts: string[] = [];
  if (repo.full_name) parts.push(`Repository: ${repo.full_name}`);

  const description = repo.description || '';
  const aiSummary = repo.ai_summary || '';
  const customDescription = repo.custom_description || '';
  if (description && !aiSummary.includes(description)) {
    parts.push(`Description: ${description}`);
  }
  if (customDescription) parts.push(`About: ${customDescription}`);
  if (aiSummary) parts.push(`Summary: ${aiSummary}`);

  const topics = [
    ...new Set([...(repo.topics || []), ...(repo.ai_tags || []), ...(repo.custom_tags || [])]),
  ];
  if (topics.length) parts.push(`Topics: ${topics.join(', ')}`);
  if (repo.language) parts.push(`Language: ${repo.language}`);

  const license = normalizeLicense(repo.license);
  if (license !== NO_LICENSE_SENTINEL) parts.push(`License: ${license}`);
  return parts.join('\n');
}

export function buildBatchLookupResult<T extends McpRepository>(
  inputs: string[],
  resolve: (input: string) => T | null
): {
  requested: number;
  foundCount: number;
  notFoundCount: number;
  notFound: string[];
  items: Array<{ input: string; status: 'found' | 'not_found'; repository: Record<string, unknown> | null }>;
} {
  const items = inputs.map((input) => {
    const repository = resolve(input);
    return repository
      ? { input, status: 'found' as const, repository: projectRepoForAgent(repository) }
      : { input, status: 'not_found' as const, repository: null };
  });
  const notFound = items.filter((item) => item.status === 'not_found').map((item) => item.input);
  return {
    requested: items.length,
    foundCount: items.length - notFound.length,
    notFoundCount: notFound.length,
    notFound,
    items,
  };
}

export function filterVectorCandidates<T extends McpRepository>(
  candidates: readonly VectorCandidate<T>[],
  filters: McpSearchFilters,
  topK: number
): FilteredVectorCandidates<T> {
  const ordered = [...candidates].sort(
    (left, right) =>
      right.score - left.score || left.repository.full_name.localeCompare(right.repository.full_name)
  );
  const filtered = ordered.filter((candidate) => matchesRepoFilters(candidate.repository, filters));
  return {
    matches: filtered.slice(0, Math.max(1, topK)),
    candidateCount: ordered.length,
    filteredCount: filtered.length,
  };
}
