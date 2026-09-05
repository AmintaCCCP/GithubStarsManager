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
  t: (zh: string, en: string) => string;
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
        <h3 className="text-lg font-semibold text-foreground dark:text-foreground">{t('星标同步', 'Star Sync')}</h3>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center space-x-3">
            <Star className="h-5 w-5 text-muted-foreground dark:text-muted-foreground" />
            <CardTitle id="star-sync-scope-heading">{t('同步范围', 'Sync Scope')}</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground dark:text-muted-foreground">{t('选择同步按钮默认拉取的数据范围：仅星标仓库，或星标仓库及 GitHub Lists。', 'Choose what the sync button pulls by default: starred repos only, or starred repos plus GitHub Lists.')}</p>
          <RadioGroup value={syncMode} aria-labelledby="star-sync-scope-heading" onValueChange={(value) => { setSyncMode(value as 'stars' | 'stars-and-lists'); setSyncModeConfigured(true); }} className="grid max-w-xl grid-cols-1 gap-4 sm:grid-cols-2">
            <Label htmlFor="sync-mode-stars" className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-background dark:border-border dark:hover:bg-card/[0.10]">
              <RadioGroupItem value="stars" id="sync-mode-stars" />
              <span><span className="block text-base font-medium text-foreground dark:text-foreground">{t('仅同步星标仓库', 'Starred repos only')}</span><span className="mt-1 block text-xs font-normal text-muted-foreground dark:text-muted-foreground">{t('与以前行为一致', 'Same as before')}</span></span>
            </Label>
            <Label htmlFor="sync-mode-lists" className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-background dark:border-border dark:hover:bg-card/[0.10]">
              <RadioGroupItem value="stars-and-lists" id="sync-mode-lists" />
              <span><span className="block text-base font-medium text-foreground dark:text-foreground">{t('同步星标仓库及 list', 'Starred repos & lists')}</span><span className="mt-1 block text-xs font-normal text-muted-foreground dark:text-muted-foreground"><ListChecks className="mr-1 inline h-3 w-3" />{t('拉取 GitHub Lists 并按标签归类', 'Also pull GitHub Lists & categorize by tags')}</span></span>
            </Label>
          </RadioGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center space-x-3">
            <GitBranch className="h-5 w-5 text-muted-foreground dark:text-muted-foreground" />
            <div><CardTitle>{t('同步仓库分类到 GitHub list', 'Push categories to GitHub lists')}</CardTitle><p className="mt-1 text-sm font-normal text-muted-foreground dark:text-muted-foreground">{t('将每个本地分类写回为同名 GitHub List。同名 list 将被覆盖，无同名 list 则新建。', 'Write each local category to a GitHub List of the same name. Same-name lists are overwritten, missing lists are created.')}</p></div>
          </div>
        </CardHeader>
        <CardContent>
          <Button type="button" onClick={handlePushCategoriesToLists} disabled={listsPush.isRunning} className="gap-2">
            {listsPush.isRunning ? <><Loader2 className="h-4 w-4 animate-spin" /><span>{t('同步中…', 'Pushing…')}</span></> : <><ListChecks className="h-4 w-4" /><span>{t('同步仓库分类到 GitHub list', 'Push categories to lists')}</span></>}
          </Button>
          {listsPush.isRunning && <div className="mt-4 space-y-2"><div className="flex items-center justify-between text-sm"><span className="truncate text-muted-foreground dark:text-muted-foreground">{listsPush.currentLabel || t('准备中…', 'Preparing…')}</span><span className="ml-2 shrink-0 text-muted-foreground dark:text-muted-foreground">{listsPush.done}/{listsPush.total}</span></div><div className="h-2 overflow-hidden rounded-full bg-muted dark:bg-muted/40"><div className="h-full bg-primary transition-all duration-200" style={{ width: `${progressPercent}%` }} /></div></div>}
          {!listsPush.isRunning && listsPush.error && <p role="alert" className="mt-4 text-sm text-destructive">{listsPush.error}</p>}
          {!listsPush.isRunning && listsPush.message && !listsPush.error && <p className="mt-4 text-sm text-success">{listsPush.message}</p>}
        </CardContent>
      </Card>
    </div>
  );
};
