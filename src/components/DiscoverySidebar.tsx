import { discoveryChannelName } from '../i18n/discoveryNames';
import { useT } from "../i18n/useT";
import type { AppLanguage } from '../i18n/languages';
import React from 'react';
import { RefreshCw, Loader2, TrendingUp, Rocket, Crown, Tag, Search, Newspaper } from 'lucide-react';
import { SiX, SiTelegram } from '@icons-pack/react-simple-icons';
import type { DiscoveryChannel, DiscoveryChannelId, DiscoveryChannelIcon } from '../types';
import { Button } from './ui/button';

const discoveryChannelIconMap: Record<DiscoveryChannelIcon, React.ComponentType<{ className?: string }>> = {
  trending: TrendingUp,
  rocket: Rocket,
  star: Crown,
  tag: Tag,
  tweet: SiX,
  telegram: SiTelegram,
  weekly: Newspaper,
  search: Search,
};

interface DiscoverySidebarProps {
  channels: DiscoveryChannel[];
  selectedChannel: DiscoveryChannelId;
  onChannelSelect: (channel: DiscoveryChannelId) => void;
  onRefreshAll: () => void;
  isLoading: Record<DiscoveryChannelId, boolean>;
  lastRefresh: Record<DiscoveryChannelId, string | null>;
  isAnalyzing: boolean;
  language: AppLanguage;
}

export const DiscoverySidebar: React.FC<DiscoverySidebarProps> = ({
  channels,
  selectedChannel,
  onChannelSelect,
  onRefreshAll,
  isLoading,
  lastRefresh,
  isAnalyzing,
  language,
}) => {
  const t = useT('discovery');

  const formatLastRefresh = (timestamp: string | null | undefined) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / (1000 * 60));
    if (diffMin < 1) return t('discoverySidebar.just-now');
    if (diffMin < 60) return t('app:discoverySidebar.minutes-ago', { count: diffMin });
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return t('app:discoverySidebar.hours-ago', { count: diffHours });
    return date.toLocaleDateString();
  };

  const enabledChannels = (channels || []).filter(ch => ch.enabled);
  
  const anyLoading = isLoading && typeof isLoading === 'object' ? Object.values(isLoading).some((v): v is boolean => typeof v === 'boolean' && v) : false;

  return (
    <div className="w-full lg:w-64 shrink-0">
      <div className="bg-card dark:bg-card rounded-xl border border-border dark:border-border p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-foreground dark:text-foreground">
            {t('discoverySidebar.discovery-channels')}
          </h3>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onRefreshAll}
            disabled={anyLoading || isAnalyzing}
            aria-label={t('discoverySidebar.refresh-all')}
            title={t('discoverySidebar.refresh-all')}
            className="h-8 w-8"
          >
            <RefreshCw className={`w-4 h-4 ${anyLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        <div className="space-y-1">
          {enabledChannels.map((channel) => {
            const isSelected = selectedChannel === channel.id;
            const ChannelIcon = discoveryChannelIconMap[channel.icon] || Crown;
            const channelLoading = isLoading && typeof isLoading === 'object' ? !!(isLoading as Record<string, unknown>)[channel.id] : false;

            return (
              <Button
                key={channel.id}
                onClick={() => onChannelSelect(channel.id)}
                variant="ghost"
                aria-pressed={isSelected}
                className={`flex w-full items-center justify-between px-3 py-2 rounded-lg text-left transition-all duration-200 ${
                  isSelected
                    ? 'bg-accent text-accent-foreground font-medium'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <ChannelIcon className="w-4 h-4" />
                  <span className="font-medium text-sm">
                    {discoveryChannelName(channel, language)}
                  </span>
                </span>
                <span className="flex items-center gap-2.5">
                  {channelLoading && (
                    <Loader2 className="w-3 h-3 animate-spin text-primary" />
                  )}
                  {(lastRefresh && typeof lastRefresh === 'object' && (lastRefresh as Record<string, unknown>)[channel.id]) ? (
                    <span className="text-xs text-muted-foreground dark:text-muted-foreground">
                      {formatLastRefresh((lastRefresh as Record<string, string | null>)[channel.id])}
                    </span>
                  ) : null}
                </span>
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
