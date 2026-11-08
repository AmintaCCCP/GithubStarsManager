export type BuiltinRepositoryCardActionId =
  | 'analyze'
  | 'ask'
  | 'subscribe'
  | 'edit'
  | 'releases'
  | 'docs'
  | 'github';

export type RepositoryCardActionId =
  | BuiltinRepositoryCardActionId
  | `plugin:${string}`
  | (string & {});

export interface RepositoryCardActionPreference {
  id: RepositoryCardActionId;
  /** False moves the action into the More actions menu. */
  visible: boolean;
}

export const REPOSITORY_CARD_ACTION_IDS: readonly BuiltinRepositoryCardActionId[] = [
  'analyze',
  'ask',
  'subscribe',
  'edit',
  'releases',
  'docs',
  'github',
];

export const DEFAULT_REPOSITORY_CARD_ACTIONS: RepositoryCardActionPreference[] =
  REPOSITORY_CARD_ACTION_IDS.map((id) => ({ id, visible: true }));

export const isPluginActionId = (id: string): id is `plugin:${string}` => id.startsWith('plugin:');

export const makePluginActionId = (pluginId: string, actionId: string): `plugin:${string}` =>
  `plugin:${pluginId}:${actionId}`;

export const parsePluginActionId = (id: string): { pluginId: string; actionId: string } | null => {
  if (!id.startsWith('plugin:')) return null;
  const parts = id.slice('plugin:'.length).split(':');
  if (parts.length < 2) return null;
  return {
    pluginId: parts[0],
    actionId: parts.slice(1).join(':'),
  };
};
