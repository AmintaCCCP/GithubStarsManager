
import { TranslateFn } from '../../i18n/useT';
import { GitBranch, ListChecks, Loader2, Star } from 'lucide-react';
import React from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { useStarSyncActions } from '../../features/settings/hooks/useStarSyncActions';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Label } from '../ui/label';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';

interface StarSyncPanelProps {
  t: TranslateFn;
}

export const StarSyncPanel: React.FC<StarSyncPanelProps> = ({ t }) => {
  const { syncMode, setSyncMode, setSyncModeConfigured, listsPush } = useAppStore(useShallow((state) => ({
    syncMode: state.syncMode,
    setSyncMode: state.setSyncMode,
    setSyncModeConfigured: state.setSyncModeConfigured,
    listsPush: state.listsPush,
  })));
  const { pushCategoriesToLists: handlePushCategoriesToLists } = useStarSyncActions({ t });

  const progressPercent = listsPush.total > 0 ? Math.min(100, Math.round((listsPush.done / listsPush.total) * 100)) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-3">
        <Star className="h-6 w-6 text-muted-foreground dark:text-muted-foreground" />
        <h3 className="text-lg font-semibold text-foreground dark:text-foreground">{t('starSyncPanel.star-sync')}</h3>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center space-x-3">
            <Star className="h-5 w-5 text-muted-foreground dark:text-muted-foreground" />
            <CardTitle id="star-sync-scope-heading">{t('starSyncPanel.sync-scope')}</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground dark:text-muted-foreground">{t('starSyncPanel.choose-what-the-sync-button-pulls-by-default-sta')}</p>
          <RadioGroup value={syncMode} aria-labelledby="star-sync-scope-heading" onValueChange={(value) => { setSyncMode(value as 'stars' | 'stars-and-lists'); setSyncModeConfigured(true); }} className="grid max-w-xl grid-cols-1 gap-4 sm:grid-cols-2">
            <Label htmlFor="sync-mode-stars" className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-background dark:border-border dark:hover:bg-card/[0.10]">
              <RadioGroupItem value="stars" id="sync-mode-stars" />
              <span><span className="block text-base font-medium text-foreground dark:text-foreground">{t('starSyncPanel.starred-repos-only')}</span><span className="mt-1 block text-xs font-normal text-muted-foreground dark:text-muted-foreground">{t('starSyncPanel.same-as-before')}</span></span>
            </Label>
            <Label htmlFor="sync-mode-lists" className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-background dark:border-border dark:hover:bg-card/[0.10]">
              <RadioGroupItem value="stars-and-lists" id="sync-mode-lists" />
              <span><span className="block text-base font-medium text-foreground dark:text-foreground">{t('starSyncPanel.starred-repos-lists')}</span><span className="mt-1 block text-xs font-normal text-muted-foreground dark:text-muted-foreground"><ListChecks className="mr-1 inline h-3 w-3" />{t('starSyncPanel.also-pull-github-lists-categorize-by-tags')}</span></span>
            </Label>
          </RadioGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center space-x-3">
            <GitBranch className="h-5 w-5 text-muted-foreground dark:text-muted-foreground" />
            <div><CardTitle>{t('starSyncPanel.push-categories-to-github-lists')}</CardTitle><p className="mt-1 text-sm font-normal text-muted-foreground dark:text-muted-foreground">{t('starSyncPanel.write-each-local-category-to-a-github-list-of-th')}</p></div>
          </div>
        </CardHeader>
        <CardContent>
          <Button type="button" onClick={handlePushCategoriesToLists} disabled={listsPush.isRunning} className="gap-2">
            {listsPush.isRunning ? <><Loader2 className="h-4 w-4 animate-spin" /><span>{t('starSyncPanel.pushing')}</span></> : <><ListChecks className="h-4 w-4" /><span>{t('starSyncPanel.push-categories-to-lists')}</span></>}
          </Button>
          {listsPush.isRunning && <div className="mt-4 space-y-2"><div className="flex items-center justify-between text-sm"><span className="truncate text-muted-foreground dark:text-muted-foreground">{listsPush.currentLabel || t('starSyncPanel.preparing')}</span><span className="ml-2 shrink-0 text-muted-foreground dark:text-muted-foreground">{listsPush.done}/{listsPush.total}</span></div><div className="h-2 overflow-hidden rounded-full bg-muted dark:bg-muted/40"><div className="h-full bg-primary transition-all duration-200" style={{ width: `${progressPercent}%` }} /></div></div>}
          {!listsPush.isRunning && listsPush.error && <p role="alert" className="mt-4 text-sm text-destructive">{listsPush.error}</p>}
          {!listsPush.isRunning && listsPush.message && !listsPush.error && <p className="mt-4 text-sm text-success">{listsPush.message}</p>}
        </CardContent>
      </Card>
    </div>
  );
};
