import { TranslateFn } from '../../i18n/useT';
import { GitBranch, ListChecks, ListPlus, Loader2 } from 'lucide-react';
import React, { useState } from 'react';
import { useAppStore, getAllCategories } from '../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { useStarSyncActions } from '../../features/settings/hooks/useStarSyncActions';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { PushCategoriesModal } from './PushCategoriesModal';
import {
  SettingsCard,
  SettingsDivider,
  SettingsNotice,
  SettingsPageStack,
  SettingsRow,
  SettingsSection,
} from './SettingsPrimitives';

interface StarSyncPanelProps {
  t: TranslateFn;
}

export const StarSyncPanel: React.FC<StarSyncPanelProps> = ({ t }) => {
  const { syncMode, setSyncMode, setSyncModeConfigured, listsPush, customCategories, hiddenDefaultCategoryIds, defaultCategoryOverrides, language } = useAppStore(useShallow((state) => ({
    syncMode: state.syncMode,
    setSyncMode: state.setSyncMode,
    setSyncModeConfigured: state.setSyncModeConfigured,
    listsPush: state.listsPush,
    customCategories: state.customCategories,
    hiddenDefaultCategoryIds: state.hiddenDefaultCategoryIds,
    defaultCategoryOverrides: state.defaultCategoryOverrides,
    language: state.language,
  })));
  const { pushCategoriesToLists: handlePushCategoriesToLists } = useStarSyncActions();
  const [isPushModalOpen, setIsPushModalOpen] = useState(false);
  const categories = getAllCategories(customCategories, language, hiddenDefaultCategoryIds, defaultCategoryOverrides).filter((c) => c.id !== 'all');

  const progressPercent = listsPush.total > 0 ? Math.min(100, Math.round((listsPush.done / listsPush.total) * 100)) : 0;

  return (
    <SettingsPageStack>
      <SettingsSection
        title={t('starSyncPanel.sync-scope')}
        titleId="star-sync-scope-heading"
        description={t('starSyncPanel.choose-what-the-sync-button-pulls-by-default-sta')}
      >
        <SettingsCard className="p-3.5">
          <RadioGroup
            value={syncMode}
            aria-labelledby="star-sync-scope-heading"
            onValueChange={(value) => {
              setSyncMode(value as 'stars' | 'stars-and-lists');
              setSyncModeConfigured(true);
            }}
            className="grid grid-cols-1 gap-2.5 sm:grid-cols-2"
          >
            <Label
              htmlFor="sync-mode-stars"
              className={cn(
                'flex cursor-pointer items-start gap-2.5 rounded-md p-3 transition-[background-color,box-shadow] duration-micro ease-out-subtle hover:duration-instant',
                syncMode === 'stars'
                  ? 'bg-fill-selected shadow-elev-0'
                  : 'bg-sunken/60 shadow-elev-0 hover:bg-fill-hover',
              )}
            >
              <RadioGroupItem value="stars" id="sync-mode-stars" className="mt-0.5" />
              <span className="min-w-0">
                <span className="block text-label font-medium text-foreground">
                  {t('starSyncPanel.starred-repos-only')}
                </span>
                <span className="mt-0.5 block text-label-sm font-normal leading-[18px] text-secondary">
                  {t('starSyncPanel.same-as-before')}
                </span>
              </span>
            </Label>
            <Label
              htmlFor="sync-mode-lists"
              className={cn(
                'flex cursor-pointer items-start gap-2.5 rounded-md p-3 transition-[background-color,box-shadow] duration-micro ease-out-subtle hover:duration-instant',
                syncMode === 'stars-and-lists'
                  ? 'bg-fill-selected shadow-elev-0'
                  : 'bg-sunken/60 shadow-elev-0 hover:bg-fill-hover',
              )}
            >
              <RadioGroupItem value="stars-and-lists" id="sync-mode-lists" className="mt-0.5" />
              <span className="min-w-0">
                <span className="block text-label font-medium text-foreground">
                  {t('starSyncPanel.starred-repos-lists')}
                </span>
                <span className="mt-0.5 block text-label-sm font-normal leading-[18px] text-secondary">
                  <ListChecks className="mr-1 inline size-3.5 text-tertiary" />
                  {t('starSyncPanel.also-pull-github-lists-categorize-by-tags')}
                </span>
              </span>
            </Label>
          </RadioGroup>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('starSyncPanel.push-categories-to-github-lists')}>
        <SettingsCard>
          <SettingsRow
            icon={<GitBranch />}
            title={t('starSyncPanel.push-categories-to-github-lists')}
            description={t('starSyncPanel.write-each-local-category-to-a-github-list-of-th')}
            align="start"
          />
          <SettingsDivider />
          <div className="flex flex-wrap items-center gap-2 px-3.5 py-3">
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={() => void handlePushCategoriesToLists()}
              disabled={listsPush.isRunning}
            >
              {listsPush.isRunning
                ? <><Loader2 className="size-4 animate-spin" /><span>{t('starSyncPanel.pushing')}</span></>
                : <><ListChecks className="size-4" /><span>{t('starSyncPanel.push-categories-to-lists')}</span></>}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={() => setIsPushModalOpen(true)}
              disabled={listsPush.isRunning}
            >
              <ListPlus className="size-4" />
              <span>{t('starSyncPanel.push-selected-categories')}</span>
            </Button>
          </div>
          {listsPush.isRunning && (
            <>
              <SettingsDivider />
              <div className="space-y-2 px-3.5 py-3">
                <div className="flex items-center justify-between text-label-sm">
                  <span className="truncate text-secondary">
                    {listsPush.currentLabel || t('starSyncPanel.preparing')}
                  </span>
                  <span className="ml-2 shrink-0 text-tertiary tabular-nums">
                    {listsPush.done}/{listsPush.total}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-fill-hover">
                  <div
                    className="h-full w-full origin-left bg-accent-solid transition-transform duration-200"
                    style={{ transform: `scaleX(${progressPercent / 100})` }}
                  />
                </div>
              </div>
            </>
          )}
        </SettingsCard>

        {!listsPush.isRunning && listsPush.error && (
          <SettingsNotice tone="destructive" role="alert" className="whitespace-pre-line">
            {listsPush.error}
          </SettingsNotice>
        )}
        {!listsPush.isRunning && listsPush.message && !listsPush.error && (
          <SettingsNotice tone="success">
            {listsPush.message}
          </SettingsNotice>
        )}

        <PushCategoriesModal
          isOpen={isPushModalOpen}
          onClose={() => setIsPushModalOpen(false)}
          categories={categories}
          onConfirm={(ids) => {
            setIsPushModalOpen(false);
            void handlePushCategoriesToLists(ids);
          }}
        />
      </SettingsSection>
    </SettingsPageStack>
  );
};
