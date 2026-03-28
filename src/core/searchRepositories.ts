import { Repository } from '../types';
import { SearchOptions, SearchResult } from './snapshotTypes';

const normalize = (value: string | null | undefined): string => (value || '').toLowerCase().trim();

const repoText = (repo: Repository): string => {
  return [
    repo.name,
    repo.full_name,
    repo.description,
    repo.language,
    repo.ai_summary,
    ...(repo.topics || []),
    ...(repo.ai_tags || []),
    ...(repo.custom_tags || []),
    ...(repo.ai_platforms || []),
    repo.custom_description,
    repo.custom_category,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
};

const scoreRepository = (repo: Repository, queryWords: string[]): number => {
  const text = repoText(repo);
  const name = normalize(repo.name);
  const fullName = normalize(repo.full_name);
  let score = 0;

  for (const word of queryWords) {
    if (name === word) score += 10;
    if (name.includes(word)) score += 6;
    if (fullName.includes(word)) score += 5;
    if (text.includes(word)) score += 2;
  }

  return score;
};

export function searchRepositories(repositories: Repository[], options: SearchOptions): SearchResult {
  const query = normalize(options.query || '');
  const limit = Math.max(1, options.limit || 20);

  if (!query) {
    const sliced = repositories.slice(0, limit);
    return { repositories: sliced, total: repositories.length, query };
  }

  const queryWords = query.split(/\s+/).filter(Boolean);

  const matched = repositories
    .map((repo) => ({ repo, score: scoreRepository(repo, queryWords) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.repo.stargazers_count - a.repo.stargazers_count)
    .slice(0, limit)
    .map((item) => item.repo);

  return {
    repositories: matched,
    total: matched.length,
    query,
  };
}
