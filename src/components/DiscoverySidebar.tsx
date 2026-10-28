import { discoveryChannelName } from '../i18n/discoveryNames';
import { useT } from "../i18n/useT";
import type { AppLanguage } from '../i18n/languages';
import React from 'react';
import { RefreshCw, Loader2, TrendingUp, Rocket, Crown, Tag, Search, Newspaper } from 'lucide-react';
import { SiX, SiTelegram } from '@icons-pack/react-simple-icons';
import type { DiscoveryChannel, DiscoveryChannelId, DiscoveryChannelIcon } from '../types';
import { Button } from './ui/button';
import { DiscoveryChannelMenu } from './DiscoveryChannelMenu';
import { ContextSidebarBody } from './ContextSidebarBody';

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
  onToggleChannel: (channel: DiscoveryChannelId) => void;
  onRefreshAll: () => void;
  totalCount: Record<DiscoveryChannelId, number>;
  isLoading: Record<DiscoveryChannelId, boolean>;
  lastRefresh: Record<DiscoveryChannelId, string | null>;
  isAnalyzing: boolean;
  language: AppLanguage;
}

export const DiscoverySidebar: React.FC<DiscoverySidebarProps> = ({
  channels,
  selectedChannel,
  onChannelSelect,
  onToggleChannel,
  onRefreshAll,
  totalCount,
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
  const sourceChannelIds = new Set<DiscoveryChannelId>(['x-tweet', 'telegram', 'weekly']);
  const isSourceChannel = (channel: DiscoveryChannel) =>
    sourceChannelIds.has(channel.id) || channel.id.startsWith('external:');
  const primaryChannels = enabledChannels.filter(channel => !isSourceChannel(channel));
  const sourceChannels = enabledChannels.filter(isSourceChannel);
  const selectedChannelDefinition = channels.find(channel => channel.id === selectedChannel);
  
  const anyLoading = isLoading && typeof isLoading === 'object' ? Object.values(isLoading).some((v): v is boolean => typeof v === 'boolean' && v) : false;

  // 全高纵向 flex：ContextSidebarBody 独立滚动，页脚经 margin-block-start: auto 固定在底部
  return (
    <div className="flex h-full min-h-0 w-full shrink-0 flex-col">
      <div className="context-sidebar-head">
        <div className="min-w-0">
          <p className="app-side-eyebrow">{t('discoverySidebar.discovery-label')}</p>
          <h3 className="app-side-title truncate">
            {t('discoverySidebar.discovery-channels')}
          </h3>
        </div>
          <div className="flex items-center gap-1 shrink-0">
            <DiscoveryChannelMenu
              channels={channels}
              language={language}
              onToggleChannel={onToggleChannel}
              triggerClassName="h-8 w-8"
            />
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
      </div>
      <ContextSidebarBody>
        {[
          { key: 'channels', label: t('discoverySidebar.channels-section'), items: primaryChannels },
          { key: 'sources', label: t('discoverySidebar.sources-section'), items: sourceChannels },
        ].map((section) => section.items.length > 0 && (
          <section key={section.key} className="app-side-section" aria-label={section.label}>
            <p className="app-section-label app-side-group-label">{section.label}</p>
            <div className="app-side-list">
              {section.items.map((channel) => {
                const isSelected = selectedChannel === channel.id;
                const ChannelIcon = discoveryChannelIconMap[channel.icon] || Crown;
                const channelLoading = isLoading && typeof isLoading === 'object' ? !!(isLoading as Record<string, unknown>)[channel.id] : false;

                return (
                  <Button
                    key={channel.id}
                    onClick={() => onChannelSelect(channel.id)}
                    variant="ghost"
                    aria-pressed={isSelected}
                    className="app-side-item justify-between text-left"
                  >
                    <span className="app-side-item-label">
                      <ChannelIcon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{discoveryChannelName(channel, language)}</span>
                    </span>
                    <span className="app-side-item-label shrink-0 justify-end">
                      {channelLoading ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : channel.id !== 'code-search' ? (
                        <span className="app-side-count">{totalCount[channel.id] ?? 0}</span>
                      ) : null}
                    </span>
                  </Button>
                );
              })}
            </div>
          </section>
        ))}
      </ContextSidebarBody>
      <div className="context-sidebar-foot">
        <div className="app-side-foot-status">
          <span className="app-status-dot" aria-hidden="true" />
          <span>
            {selectedChannelDefinition
              ? discoveryChannelName(selectedChannelDefinition, language)
              : t('discoverySidebar.discovery-label')}
          </span>
        </div>
        <div className="app-side-foot-meta">
          {selectedChannel !== 'code-search' && (
            <span>{t('discoverySidebar.channel-count', {
              count: totalCount[selectedChannel] ?? 0,
            })}</span>
          )}
          {lastRefresh[selectedChannel] && <span>{formatLastRefresh(lastRefresh[selectedChannel])}</span>}
        </div>
      </div>
    </div>
  );
};
