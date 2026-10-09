import {
  DEFAULT_REPOSITORY_CARD_ACTIONS,
  REPOSITORY_CARD_ACTION_IDS,
  type RepositoryCardActionId,
  type RepositoryCardActionPreference,
} from '../types/repositoryCardActions';

/** Keep the saved order, discard unknown/duplicate IDs, and add new actions at the end. */
export const normalizeRepositoryCardActions = (value: unknown): RepositoryCardActionPreference[] => {
  const allowed = new Set<string>(REPOSITORY_CARD_ACTION_IDS);
  const seen = new Set<RepositoryCardActionId>();
  const result: RepositoryCardActionPreference[] = [];

  if (Array.isArray(value)) {
    for (const item of value) {
      if (!item || typeof item !== 'object') continue;
      const { id, visible } = item as Record<string, unknown>;
      if (typeof id !== 'string' || !allowed.has(id) || seen.has(id as RepositoryCardActionId)) continue;
      seen.add(id as RepositoryCardActionId);
      result.push({ id: id as RepositoryCardActionId, visible: typeof visible === 'boolean' ? visible : true });
    }
  }

  for (const item of DEFAULT_REPOSITORY_CARD_ACTIONS) {
    if (!seen.has(item.id)) result.push({ ...item });
  }
  return result;
};
