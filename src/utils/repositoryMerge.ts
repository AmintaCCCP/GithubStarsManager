import type { Repository } from '../types';

const LOCAL_REPOSITORY_FIELDS: Array<keyof Repository> = [
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

/** Drop the local-only fields from a repo list — the projection the backend
 * actually stores. Used to hash the push payload so the next pull compares
 * against the same raw shape (same class of loop-breaker as the pull path).
 */
export function stripLocalRepositoryFields(repos: Repository[]): Repository[] {
  return repos.map(repo => {
    const stripped: Repository = { ...repo };
    for (const field of LOCAL_REPOSITORY_FIELDS) {
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
