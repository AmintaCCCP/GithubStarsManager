import React, { useMemo } from 'react';
import {
  Bell,
  BookOpen,
  Bot,
  ChevronDown,
  ChevronUp,
  Edit3,
  ExternalLink,
  MessageSquareText,
  PackageOpen,
  type LucideIcon,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useT } from '../../i18n/useT';
import { usePluginActions } from '../../plugins/hooks/usePluginActions';
import { PluginIcon } from '../../plugins/pluginIcons';
import type { RegisteredPluginAction } from '../../plugins/types';
import { useAppStore } from '../../store/useAppStore';
import {
  DEFAULT_REPOSITORY_CARD_ACTIONS,
  isPluginActionId,
  makePluginActionId,
  type BuiltinRepositoryCardActionId,
  type RepositoryCardActionPreference,
} from '../../types/repositoryCardActions';
import { normalizeRepositoryCardActions } from '../../utils/repositoryCardActions';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Switch } from '../ui/switch';

const ACTION_LABEL_KEYS: Record<BuiltinRepositoryCardActionId, string> = {
  analyze: 'repositoryCard.analyze-with-ai-2',
  ask: 'repositoryCard.ask-this-repository',
  subscribe: 'repositoryCard.subscribe-to-releases',
  edit: 'repositoryCard.edit-repository-info',
  releases: 'repositoryCard.view-releases',
  docs: 'repositoryCard.view-on-deepwiki',
  github: 'repositoryCard.view-on-github',
};

const BUILTIN_ICONS: Record<BuiltinRepositoryCardActionId, LucideIcon> = {
  analyze: Bot,
  ask: MessageSquareText,
  subscribe: Bell,
  edit: Edit3,
  releases: PackageOpen,
  docs: BookOpen,
  github: ExternalLink,
};

interface RepositoryCardActionsSettingsProps {
  title: string;
  hint: string;
  resetLabel: string;
  moveUpLabel: (action: string) => string;
  moveDownLabel: (action: string) => string;
  visibilityLabel: (action: string) => string;
}

export const RepositoryCardActionsSettings: React.FC<RepositoryCardActionsSettingsProps> = ({
  title,
  hint,
  resetLabel,
  moveUpLabel,
  moveDownLabel,
  visibilityLabel,
}) => {
  const t = useT('repositories');
  const { actions, setActions } = useAppStore(
    useShallow((state) => ({
      actions: state.repositoryCardActions,
      setActions: state.setRepositoryCardActions,
    })),
  );
  const { actions: pluginActions } = usePluginActions('repository-card');

  const pluginActionMap = useMemo(() => {
    const map = new Map<string, RegisteredPluginAction>();
    for (const action of pluginActions) {
      map.set(makePluginActionId(action.pluginId, action.id), action);
    }
    return map;
  }, [pluginActions]);

  const displayedActions = useMemo(
    () => normalizeRepositoryCardActions(actions, pluginActions),
    [actions, pluginActions],
  );

  const saveWithInactive = (next: typeof displayedActions) => {
    const nextMap = new Map(next.map((a) => [a.id, a]));
    const nextRemaining = [...next];
    const result: RepositoryCardActionPreference[] = [];

    for (const saved of actions) {
      if (nextMap.has(saved.id)) {
        if (nextRemaining.length > 0) {
          result.push(nextRemaining.shift()!);
        }
      } else {
        result.push(saved);
      }
    }

    while (nextRemaining.length > 0) {
      result.push(nextRemaining.shift()!);
    }

    setActions(result);
  };

  const move = (index: number, delta: -1 | 1) => {
    const reordered = [...displayedActions];
    const [item] = reordered.splice(index, 1);
    reordered.splice(index + delta, 0, item);
    saveWithInactive(reordered);
  };

  const handleReset = () => {
    if (pluginActions.length === 0) {
      setActions(DEFAULT_REPOSITORY_CARD_ACTIONS.map((item) => ({ ...item })));
      return;
    }
    const resetList = [
      ...DEFAULT_REPOSITORY_CARD_ACTIONS.map((item) => ({ ...item })),
      ...pluginActions.map((action) => ({
        id: makePluginActionId(action.pluginId, action.id),
        visible: false,
      })),
    ];
    setActions(resetList);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">{hint}</p>
        <div className="space-y-2">
          {displayedActions.map((item, index) => {
            const isPlugin = isPluginActionId(item.id);
            let label = '';
            let iconNode: React.ReactNode = null;
            let subtitleNode: React.ReactNode = null;

            if (isPlugin) {
              const pluginAction = pluginActionMap.get(item.id);
              label = pluginAction?.title || item.id;
              iconNode = (
                <PluginIcon
                  pluginId={pluginAction?.pluginId}
                  icon={pluginAction?.icon}
                  className="h-4 w-4 shrink-0 text-muted-foreground"
                />
              );
              if (pluginAction?.pluginName) {
                subtitleNode = (
                  <span className="ml-2 text-xs text-muted-foreground">
                    ({pluginAction.pluginName})
                  </span>
                );
              }
            } else {
              const builtinId = item.id as BuiltinRepositoryCardActionId;
              label = t(ACTION_LABEL_KEYS[builtinId]);
              const IconComp = BUILTIN_ICONS[builtinId];
              iconNode = IconComp ? (
                <IconComp className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : null;
            }

            return (
              <div
                key={item.id}
                className="flex items-center gap-2 rounded-md border border-border px-3 py-2"
              >
                {iconNode}
                <span className="min-w-0 flex-1 truncate text-sm">
                  {label}
                  {subtitleNode}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  disabled={index === 0}
                  aria-label={moveUpLabel(label)}
                  onClick={() => move(index, -1)}
                >
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  disabled={index === displayedActions.length - 1}
                  aria-label={moveDownLabel(label)}
                  onClick={() => move(index, 1)}
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
                <Switch
                  checked={item.visible}
                  aria-label={visibilityLabel(label)}
                  onCheckedChange={(visible) =>
                    saveWithInactive(
                      displayedActions.map((entry) =>
                        entry.id === item.id ? { ...entry, visible } : entry,
                      ),
                    )
                  }
                />
              </div>
            );
          })}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleReset}
        >
          {resetLabel}
        </Button>
      </CardContent>
    </Card>
  );
};
