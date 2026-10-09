import React from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useT } from '../../i18n/useT';
import { useAppStore } from '../../store/useAppStore';
import { DEFAULT_REPOSITORY_CARD_ACTIONS, type RepositoryCardActionId } from '../../types/repositoryCardActions';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Switch } from '../ui/switch';

const ACTION_LABEL_KEYS: Record<RepositoryCardActionId, string> = {
  analyze: 'repositoryCard.analyze-with-ai-2',
  ask: 'repositoryCard.ask-this-repository',
  subscribe: 'repositoryCard.subscribe-to-releases',
  edit: 'repositoryCard.edit-repository-info',
  releases: 'repositoryCard.view-releases',
  docs: 'repositoryCard.view-on-deepwiki',
  github: 'repositoryCard.view-on-github',
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
  title, hint, resetLabel, moveUpLabel, moveDownLabel, visibilityLabel,
}) => {
  const t = useT('repositories');
  const { actions, setActions } = useAppStore(useShallow((state) => ({
    actions: state.repositoryCardActions,
    setActions: state.setRepositoryCardActions,
  })));

  const move = (index: number, delta: -1 | 1) => {
    const reordered = [...actions];
    const [item] = reordered.splice(index, 1);
    reordered.splice(index + delta, 0, item);
    setActions(reordered);
  };

  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">{hint}</p>
        <div className="space-y-2">
          {actions.map((item, index) => {
            const label = t(ACTION_LABEL_KEYS[item.id]);
            return (
              <div key={item.id} className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7"
                  disabled={index === 0} aria-label={moveUpLabel(label)} onClick={() => move(index, -1)}>
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7"
                  disabled={index === actions.length - 1} aria-label={moveDownLabel(label)} onClick={() => move(index, 1)}>
                  <ChevronDown className="h-4 w-4" />
                </Button>
                <Switch checked={item.visible} aria-label={visibilityLabel(label)}
                  onCheckedChange={(visible) => setActions(actions.map((entry) =>
                    entry.id === item.id ? { ...entry, visible } : entry))} />
              </div>
            );
          })}
        </div>
        <Button type="button" variant="outline" size="sm"
          onClick={() => setActions(DEFAULT_REPOSITORY_CARD_ACTIONS.map((item) => ({ ...item })))}>
          {resetLabel}
        </Button>
      </CardContent>
    </Card>
  );
};
