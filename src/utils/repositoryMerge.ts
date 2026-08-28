import type { Repository } from '../types';

const LOCAL_REPOSITORY_FIELDS: Array<keyof Repository> = [
  'analysis_error',
  'has_fetched_releases',
  'last_release_fetch_time',
  'ai_summary',
  'ai_tags',
  'ai_platforms',
  'analyzed_at',
  'analysis_failed',
  'subscribed_to_releases',
  'custom_description',
  'custom_tags',
  'custom_category',
  'category_locked',
  'last_edited',
  'vector_indexed_at',
];

/**
 * Fields the repository endpoint never stores or returns (client-only state).
 * This is the projection both sync fingerprints must agree on: the pull side
 * hashes the backend payload through it, the successful-push side hashes the
 * store through it, so the next pull sees no change (Issue #304 loop-breaker).
 */
export const CLIENT_ONLY_REPOSITORY_FIELDS: ReadonlySet<keyof Repository> = new Set([
  'forks_count',
  'forks',
  'analysis_error',
  'has_fetched_releases',
  'last_release_fetch_time',
]);

/** Drop client-only fields from a repo list, projecting the shape the backend
 * actually stores/returns. Shared by the pull and push fingerprint paths so
 * the two hashes always use the same field set.
 */
export function stripLocalRepositoryFields(repos: Repository[]): Repository[] {
  return repos.map(repo => {
    const stripped: Repository = { ...repo };
    for (const field of CLIENT_ONLY_REPOSITORY_FIELDS) {
      delete (stripped as Record<keyof Repository, unknown>)[field];
    }
    return stripped;
  });
}

export function mergeRepositoriesPreservingLocalMetadata(
  incomingRepositories: Repository[],
  localRepositories: Repository[]
): Repository[] {
  const localRepositoryMap = new Map(localRepositories.map(repo => [repo.id, repo]));

  return incomingRepositories.map(incomingRepository => {
    const localRepository = localRepositoryMap.get(incomingRepository.id);
    if (!localRepository) {
      return incomingRepository;
    }

    const mergedRepository: Repository = { ...incomingRepository };

    for (const field of LOCAL_REPOSITORY_FIELDS) {
      const localValue = localRepository[field];
      if (localValue !== undefined) {
        (mergedRepository as Record<keyof Repository, unknown>)[field] = localValue;
      }
    }

    return mergedRepository;
  });
}
