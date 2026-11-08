import {
  DEFAULT_REPOSITORY_CARD_ACTIONS,
  REPOSITORY_CARD_ACTION_IDS,
  isPluginActionId,
  makePluginActionId,
  type RepositoryCardActionId,
  type RepositoryCardActionPreference,
} from '../types/repositoryCardActions';

/** Keep the saved order, discard unknown/duplicate IDs, and add new actions at the end. */
export const normalizeRepositoryCardActions = (
  value: unknown,
  activePluginActions?: Array<{ pluginId: string; id: string }>,
): RepositoryCardActionPreference[] => {
  const allowed = new Set<string>(REPOSITORY_CARD_ACTION_IDS);
  const activePluginIds = activePluginActions
    ? new Set<string>(activePluginActions.map((a) => makePluginActionId(a.pluginId, a.id)))
    : null;
  const seen = new Set<string>();
  const result: RepositoryCardActionPreference[] = [];

  if (Array.isArray(value)) {
    for (const item of value) {
      if (!item || typeof item !== 'object') continue;
      const { id, visible } = item as Record<string, unknown>;
      if (typeof id !== 'string' || seen.has(id)) continue;

      const isBuiltin = allowed.has(id);
      const isPlugin = isPluginActionId(id);
      if (!isBuiltin && !isPlugin) continue;

      // When activePluginActions is supplied, filter out plugin actions that are not currently active
      if (isPlugin && activePluginIds && !activePluginIds.has(id)) {
        continue;
      }

      seen.add(id);
      result.push({
        id: id as RepositoryCardActionId,
        visible: typeof visible === 'boolean' ? visible : isBuiltin,
      });
    }
  }

  for (const item of DEFAULT_REPOSITORY_CARD_ACTIONS) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      result.push({ ...item });
    }
  }

  if (activePluginActions) {
    for (const pluginAction of activePluginActions) {
      const id = makePluginActionId(pluginAction.pluginId, pluginAction.id);
      if (!seen.has(id)) {
        seen.add(id);
        result.push({ id, visible: false });
      }
    }
  }

  return result;
};
