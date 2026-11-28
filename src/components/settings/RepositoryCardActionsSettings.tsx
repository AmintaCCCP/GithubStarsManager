import React, { useMemo, useState } from 'react';
import {
  Bell,
  BookOpen,
  Bot,
  ChevronDown,
  ChevronUp,
  Edit3,
  ExternalLink,
  GripVertical,
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
import { Switch } from '../ui/switch';
import { SettingsCard, SettingsDivider, SettingsSection } from './SettingsPrimitives';

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
  dragHandleLabel: (action: string) => string;
}

export const RepositoryCardActionsSettings: React.FC<RepositoryCardActionsSettingsProps> = ({
  title,
  hint,
  resetLabel,
  moveUpLabel,
  moveDownLabel,
  visibilityLabel,
  dragHandleLabel,
}) => {
  const t = useT('repositories');
  const { actions, setActions } = useAppStore(
    useShallow((state) => ({
      actions: state.repositoryCardActions,
      setActions: state.setRepositoryCardActions,
    })),
  );
  const { actions: pluginActions } = usePluginActions('repository-card');

  // 原生 HTML5 拖拽重排（与 CategorySidebar 同一模式）：
  // - dragArmedId：按住把手后才允许该行发起拖拽，避免从开关/按钮误拖；
  // - dragActionId：当前拖拽中的行；dragOverActionId：悬停目标行（高亮提示落点）。
  const [dragArmedId, setDragArmedId] = useState<string | null>(null);
  const [dragActionId, setDragActionId] = useState<string | null>(null);
  const [dragOverActionId, setDragOverActionId] = useState<string | null>(null);

  const resetDragState = () => {
    setDragArmedId(null);
    setDragActionId(null);
    setDragOverActionId(null);
  };

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

  const handleDropAtIndex = (event: React.DragEvent<HTMLDivElement>, targetIndex: number) => {
    event.preventDefault();
    const sourceIndex = displayedActions.findIndex((entry) => entry.id === dragActionId);
    resetDragState();
    if (sourceIndex < 0 || sourceIndex === targetIndex) return;
    const reordered = [...displayedActions];
    const [moved] = reordered.splice(sourceIndex, 1);
    reordered.splice(targetIndex, 0, moved);
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
    <SettingsSection
      title={title}
      description={hint}
      actions={(
        <Button type="button" variant="outline" size="sm" onClick={handleReset}>
          {resetLabel}
        </Button>
      )}
    >
      <SettingsCard>
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
                className="size-4 shrink-0 text-tertiary"
              />
            );
            if (pluginAction?.pluginName) {
              subtitleNode = (
                <span className="ml-1.5 text-label-sm font-normal text-secondary">
                  ({pluginAction.pluginName})
                </span>
              );
            }
          } else {
            const builtinId = item.id as BuiltinRepositoryCardActionId;
            label = t(ACTION_LABEL_KEYS[builtinId]);
            const IconComp = BUILTIN_ICONS[builtinId];
            iconNode = IconComp ? (
              <IconComp className="size-4 shrink-0 text-tertiary" />
            ) : null;
          }

          const isDragging = dragActionId === item.id;
          const isDropTarget = dragActionId !== null && !isDragging && dragOverActionId === item.id;

          return (
            <React.Fragment key={item.id}>
              {index > 0 && <SettingsDivider />}
              <div
                className={`flex min-h-12 items-center gap-3 px-3.5 py-2 transition-[background-color,opacity] duration-micro ease-out-subtle hover:duration-instant ${
                  isDragging ? 'opacity-50' : ''
                } ${isDropTarget ? 'bg-fill-selected' : ''}`}
                draggable={dragArmedId === item.id}
                onDragStart={(event) => {
                  if (dragArmedId !== item.id) {
                    event.preventDefault();
                    return;
                  }
                  event.dataTransfer.setData('text/plain', item.id);
                  event.dataTransfer.effectAllowed = 'move';
                  setDragActionId(item.id);
                }}
                onDragOver={(event) => {
                  if (dragActionId === null || dragActionId === item.id) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  if (dragOverActionId !== item.id) setDragOverActionId(item.id);
                }}
                onDragLeave={() => {
                  if (dragOverActionId === item.id) setDragOverActionId(null);
                }}
                onDrop={(event) => handleDropAtIndex(event, index)}
                onDragEnd={resetDragState}
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className={`shrink-0 text-tertiary hover:text-secondary ${
                    isDragging ? 'cursor-grabbing' : 'cursor-grab'
                  }`}
                  aria-label={dragHandleLabel(label)}
                  title={dragHandleLabel(label)}
                  onPointerDown={() => setDragArmedId(item.id)}
                >
                  <GripVertical className="size-3.5" />
                </Button>
                {iconNode}
                <span className="min-w-0 flex-1 truncate text-label font-medium text-foreground">
                  {label}
                  {subtitleNode}
                </span>
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={index === 0}
                    aria-label={moveUpLabel(label)}
                    onClick={() => move(index, -1)}
                  >
                    <ChevronUp className="size-3.5 text-secondary" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={index === displayedActions.length - 1}
                    aria-label={moveDownLabel(label)}
                    onClick={() => move(index, 1)}
                  >
                    <ChevronDown className="size-3.5 text-secondary" />
                  </Button>
                </div>
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
            </React.Fragment>
          );
        })}
      </SettingsCard>
    </SettingsSection>
  );
};
