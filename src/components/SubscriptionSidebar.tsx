import React from 'react';
import { RefreshCw, Star, GitFork, User, Flame } from 'lucide-react';
import type { SubscriptionChannel, SubscriptionChannelId } from '../types';
import { useAppStore } from '../store/useAppStore';

interface SubscriptionSidebarProps {
  channels: SubscriptionChannel[];
  selectedChannel: SubscriptionChannelId;
  onChannelSelect: (channel: SubscriptionChannelId) => void;
  onRefreshAll: () => void;
  isLoading: Record<SubscriptionChannelId, boolean>;
  lastRefresh: Record<SubscriptionChannelId, string | null>;
  isAnalyzing: boolean;
}

export const SubscriptionSidebar: React.FC<SubscriptionSidebarProps> = ({
  channels,
  selectedChannel,
  onChannelSelect,
  onRefreshAll,
  isLoading,
  lastRefresh,
  isAnalyzing,
}) => {
  const language = useAppStore(state => state.language);
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
    // 将Emoji图标替换为Lucide React图标
    let icon: React.ReactNode;
    switch (ch.id) {
      case 'most-stars':
        icon = <Star className="w-4 h-4" />;
        break;
      case 'most-forks':
        icon = <GitFork className="w-4 h-4" />;
        break;
      case 'most-dev':
      case 'daily-dev':
        icon = <User className="w-4 h-4" />;
        break;
      case 'trending':
        icon = <Flame className="w-4 h-4" />;
        break;
      default:
        icon = <Star className="w-4 h-4" />;
    }
    
    return ch.id === 'daily-dev' 
      ? { ...ch, id: 'most-dev' as const, name: 'Most DEV', nameEn: 'Most DEV', icon } 
      : { ...ch, icon };
  });
  const anyLoading = isLoading && typeof isLoading === 'object' ? Object.values(isLoading).some((v): v is boolean => typeof v === 'boolean' && v) : false;

  return (
    <div className="w-full lg:w-64 shrink-0">
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {t('订阅频道', 'Channels')}
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
            const isLoadingNorm = isLoading && typeof isLoading === 'object' && isLoading['daily-dev'] !== undefined ? { ...isLoading, 'most-dev': isLoading['most-dev'] ?? isLoading['daily-dev'] } : isLoading;
    const channelLoading = isLoadingNorm && typeof isLoadingNorm === 'object' ? !!(isLoadingNorm as Record<string, unknown>)[channel.id === 'daily-dev' ? 'most-dev' : channel.id] : false;

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
                <div className="flex items-center space-x-3 min-w-0 flex-1">
                  <span className="w-4 h-4 flex-shrink-0">{channel.icon}</span>
                  <div className="min-w-0">
                    <span className="text-sm font-medium truncate block">
                      {language === 'zh' ? channel.name : channel.nameEn}
                    </span>
                    {(lastRefresh && typeof lastRefresh === 'object' && (lastRefresh as Record<string, unknown>)[channel.id === 'daily-dev' ? 'most-dev' : channel.id]) ? (
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        {formatLastRefresh((lastRefresh as Record<string, string | null>)[channel.id === 'daily-dev' ? 'most-dev' : channel.id])}
                      </span>
                    ) : null}
                  </div>
                </div>
                {channelLoading && (
                  <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                )}
              </button>
            );
          })}
        </div>

        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
          <p className="text-xs text-gray-400 dark:text-gray-500">
            {t('点击刷新获取最新排行数据', 'Click refresh to fetch latest ranking data')}
          </p>
        </div>
      </div>
    </div>
  );
};