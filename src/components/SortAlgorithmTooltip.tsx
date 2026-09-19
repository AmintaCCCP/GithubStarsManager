



import { useT } from '../i18n/useT';
import type { AppLanguage } from '../i18n/languages';
import React from 'react';
import { Info } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { DiscoveryChannelId } from '../types';
import { Button } from './ui/button';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

interface SortAlgorithmTooltipProps {
  channelId: DiscoveryChannelId;
  language: AppLanguage;
}

export const SortAlgorithmTooltip: React.FC<SortAlgorithmTooltipProps> = ({ channelId }) => {
  const t = useT('app');

  const getAlgorithmInfo = (channel: DiscoveryChannelId): { title: string; description: string; highlight: string } => {
    switch (channel) {
      case 'trending':
        return {
          title: t('sortAlgorithmTooltip.trending-repositories'),
          highlight: t('sortAlgorithmTooltip.discover-emerging-hot-projects'),
          description: t('sortAlgorithmTooltip.features-time-range-updated-in-last-30-days-star'),
        };
      case 'hot-release':
        return {
          title: t('sortAlgorithmTooltip.hot-release'),
          highlight: t('sortAlgorithmTooltip.track-latest-project-updates'),
          description: t('sortAlgorithmTooltip.features-time-range-updated-in-last-14-days-star'),
        };
      case 'most-popular':
        return {
          title: t('sortAlgorithmTooltip.most-popular'),
          highlight: t('sortAlgorithmTooltip.discover-classic-mature-projects'),
          description: t('sortAlgorithmTooltip.features-time-range-created-6-months-ago-updated'),
        };
      case 'topic':
        return {
          title: t('sortAlgorithmTooltip.topic-exploration'),
          highlight: t('sortAlgorithmTooltip.browse-by-tech-topic'),
          description: t('sortAlgorithmTooltip.features-filter-by-selected-topic-star-threshold'),
        };
      case 'search':
        return {
          title: t('sortAlgorithmTooltip.search'),
          highlight: t('sortAlgorithmTooltip.custom-keyword-search'),
          description: t('sortAlgorithmTooltip.features-custom-keyword-search-sort-options-best'),
        };
      case 'weekly':
        return {
          title: t('sortAlgorithmTooltip.ruanyifeng-weekly'),
          highlight: t('sortAlgorithmTooltip.open-source-picks-from-the-weekly'),
          description: t('sortAlgorithmTooltip.features-source-open-source-submission-issues-of'),
        };
      case 'x-tweet':
        return {
          title: t('sortAlgorithmTooltip.x-tweets'),
          highlight: t('sortAlgorithmTooltip.open-source-projects-shared-by-followed-accounts'),
          description: t('sortAlgorithmTooltip.features-source-repo-links-shared-in-followed-ac'),
        };
      case 'telegram':
        return {
          title: t('sortAlgorithmTooltip.telegram-channels'),
          highlight: t('sortAlgorithmTooltip.open-source-projects-shared-by-followed-channels'),
          description: t('sortAlgorithmTooltip.features-source-repo-links-shared-in-followed-ch'),
        };
      case 'code-search':
        return {
          title: t('sortAlgorithmTooltip.code-search'),
          highlight: t('sortAlgorithmTooltip.full-text-code-search-across-public-repos'),
          description: t('sortAlgorithmTooltip.features-fuzzy-whole-word-regexp-modes-optional'),
        };
      default:
        return {
          title: t('sortAlgorithmTooltip.sorting-algorithm'),
          highlight: '',
          description: t('sortAlgorithmTooltip.sorted-by-default-rules'),
        };
    }
  };

  const info = getAlgorithmInfo(channelId);
  const [open, setOpen] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);

  const cancelClose = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const scheduleClose = () => {
    cancelClose();
    closeTimerRef.current = setTimeout(() => setOpen(false), 120);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        cancelClose();
        setOpen(nextOpen);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6 rounded-full text-muted-foreground dark:text-muted-foreground/70"
          aria-label={info.title}
          onMouseEnter={() => { cancelClose(); setOpen(true); }}
          onMouseLeave={scheduleClose}
        >
          <Info className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="w-[calc(100vw_-_2rem)] max-w-sm whitespace-pre-line bg-popover p-4 text-left text-popover-foreground"
      >
        <h4 className="mb-2 text-sm font-semibold">{info.title}</h4>
        {info.highlight && <p className="mb-2 text-sm font-medium text-primary">{info.highlight}</p>}
        <p className="text-xs leading-relaxed">{info.description}</p>
      </PopoverContent>
    </Popover>
  );
};
