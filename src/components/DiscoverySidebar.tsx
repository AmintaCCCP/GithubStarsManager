import React from 'react';
import { RefreshCw, Star, Rocket, Tag, Search, TrendingUp } from 'lucide-react';
import type { DiscoveryChannel, DiscoveryChannelId } from '../types';
import { Loader2 } from 'lucide-react';

interface DiscoverySidebarProps {
  channels: DiscoveryChannel[];
  selectedChannel: DiscoveryChannelId;
  onChannelSelect: (channel: DiscoveryChannelId) => void;
  onRefreshAll: () => void;
  isLoading: Record<DiscoveryChannelId, boolean>;
  lastRefresh: Record<DiscoveryChannelId, string | null>;
  isAnalyzing: boolean;
  language: 'zh' | 'en';
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
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

  const formatLastRefresh = (timestamp: string | null | undefined) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / (1000 * 60));
    if (diffMin < 1) return t('刚刚', 'Just now');
    if (diffMin < 60) return `${diffMin}${t('分钟前', 'm ago')}`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}${t('小时前', 'h ago')}`;
    return date.toLocaleDateString();
  };

  const enabledChannels = (channels || []).filter(ch => ch.enabled).map(ch => {
    let icon: React.ReactNode;
    switch (ch.id) {
      case 'trending':
        icon = <TrendingUp className="w-4 h-4" />;
        break;
      case 'hot-release':
        icon = <Rocket className="w-4 h-4" />;
        break;
      case 'most-popular':
        icon = <Star className="w-4 h-4" />;
        break;
      case 'topic':
        icon = <Tag className="w-4 h-4" />;
        break;
      case 'search':
        icon = <Search className="w-4 h-4" />;
        break;
      default:
        icon = <Star className="w-4 h-4" />;
    }
    
    return { ...ch, icon };
  });
  
  const anyLoading = isLoading && typeof isLoading === 'object' ? Object.values(isLoading).some((v): v is boolean => typeof v === 'boolean' && v) : false;

  return (
    <div className="w-full lg:w-64 shrink-0">
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {t('发现频道', 'Discovery Channels')}
          </h3>
          <button
            onClick={onRefreshAll}
            disabled={anyLoading || isAnalyzing}
            className="p-1.5 rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title={t('刷新全部', 'Refresh All')}
          >
            <RefreshCw className={`w-4 h-4 ${anyLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="space-y-1">
          {enabledChannels.map((channel) => {
            const isSelected = selectedChannel === channel.id;
            const channelLoading = isLoading && typeof isLoading === 'object' ? !!(isLoading as Record<string, unknown>)[channel.id] : false;

            return (
              <button
                key={channel.id}
                onClick={() => onChannelSelect(channel.id)}
                className={`flex w-full items-center justify-between px-3 py-2.5 rounded-lg text-left transition-all duration-200 ${
                  isSelected
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                <div className="flex items-center gap-2">
                  {channel.icon}
                  <span className="font-medium text-sm">
                    {language === 'zh' ? channel.name : channel.nameEn}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {channelLoading && (
                    <Loader2 className="w-3 h-3 animate-spin text-blue-500" />
                  )}
                  {(lastRefresh && typeof lastRefresh === 'object' && (lastRefresh as Record<string, unknown>)[channel.id]) ? (
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {formatLastRefresh((lastRefresh as Record<string, string | null>)[channel.id])}
                    </span>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
