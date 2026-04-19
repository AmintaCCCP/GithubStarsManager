import React, { useMemo } from 'react';
import { ExternalLink, Bot, Star, Users, BookOpen } from 'lucide-react';
import type { SubscriptionDev } from '../types';
import { useAppStore } from '../store/useAppStore';

interface SubscriptionDevCardProps {
  dev: SubscriptionDev;
}

export const SubscriptionDevCard: React.FC<SubscriptionDevCardProps> = ({ dev }) => {
  const language = useAppStore(state => state.language);
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

  const formatNumber = (num: number | undefined | null) => {
    if (num == null) return '0';
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const rankBadgeClass = useMemo(() => {
    if (dev.rank === 1) return 'bg-yellow-400 text-yellow-900 dark:bg-yellow-500 dark:text-yellow-900';
    if (dev.rank === 2) return 'bg-gray-300 text-gray-700 dark:bg-gray-400 dark:text-gray-800';
    if (dev.rank === 3) return 'bg-amber-600 text-white dark:bg-amber-700 dark:text-white';
    return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300';
  }, [dev.rank]);

  const platformIconMap = useMemo(() => ({
    mac: '🍎', macos: '🍎', ios: '🍎', windows: '🪟', win: '🪟',
    linux: '🐧', android: '📱', web: '🌐', cli: '⌨️', docker: '🐳',
  }), []);

  const getPlatformEmoji = (platform: string) => {
    return platformIconMap[platform.toLowerCase() as keyof typeof platformIconMap] || '💻';
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 hover:shadow-lg transition-shadow duration-200 hover:border-blue-300 dark:hover:border-blue-600">
      <div className="flex items-start gap-4">
        {/* Rank badge */}
        <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg ${rankBadgeClass}`}>
          {dev.rank}
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          {/* Developer info */}
          <div className="flex items-center gap-3 mb-3">
            <img
              src={dev.avatar_url}
              alt={dev.login}
              className="w-10 h-10 rounded-full"
            />
            <div className="min-w-0">
              <a
                href={dev.html_url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-gray-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 flex items-center gap-1.5"
              >
                {dev.name || dev.login}
                <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" />
              </a>
              <p className="text-sm text-gray-500 dark:text-gray-400">@{dev.login}</p>
            </div>
          </div>

          {/* Bio */}
          {dev.bio && (
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3 line-clamp-2">
              {dev.bio}
            </p>
          )}

          {/* Stats */}
          <div className="flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400 mb-4">
            <div className="flex items-center gap-1">
              <Users className="w-4 h-4" />
              <span>{formatNumber(dev.followers)} {t('关注者', 'followers')}</span>
            </div>
            <div className="flex items-center gap-1">
              <BookOpen className="w-4 h-4" />
              <span>{dev.public_repos} {t('个仓库', 'repos')}</span>
            </div>
          </div>

          {/* Top repository */}
          {dev.topRepo && (
            <div className="bg-gray-50 dark:bg-gray-750 dark:bg-gray-900/40 rounded-lg p-3 border border-gray-200 dark:border-gray-600">
              <div className="flex items-center gap-2 mb-1.5">
                <Star className="w-3.5 h-3.5 text-yellow-500" />
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  {t('最热项目', 'Top Repository')}
                </span>
              </div>
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 mb-1">
                    <img
                      src={dev.topRepo.owner.avatar_url}
                      alt={dev.topRepo.owner.login}
                      className="w-4 h-4 rounded-full"
                    />
                    <a
                      href={dev.topRepo.html_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-sm text-gray-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 truncate"
                    >
                      {dev.topRepo.full_name}
                    </a>
                    <a
                      href={dev.topRepo.html_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-shrink-0 text-gray-400 hover:text-blue-500"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  {dev.topRepo.description && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mb-2">
                      {dev.topRepo.description}
                    </p>
                  )}

                  {/* AI Summary for top repo */}
                  {dev.topRepo.ai_summary && (
                    <div className="flex items-start gap-1.5 mb-2">
                      <Bot className="w-3.5 h-3.5 text-purple-500 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-purple-600 dark:text-purple-400 line-clamp-2">
                        {dev.topRepo.ai_summary}
                      </p>
                    </div>
                  )}

                  {/* Tags for top repo */}
                  {((dev.topRepo.ai_tags && dev.topRepo.ai_tags.length > 0) || (dev.topRepo.topics && dev.topRepo.topics.length > 0)) && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {(dev.topRepo.ai_tags || dev.topRepo.topics || []).slice(0, 5).map((tag: string) => (
                        <span
                          key={tag}
                          className="px-1.5 py-0.5 rounded text-xs font-medium bg-blue-50/50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Platform icons for top repo */}
                  {dev.topRepo.ai_platforms && dev.topRepo.ai_platforms.length > 0 && (
                    <div className="flex items-center gap-1 mb-2">
                      {dev.topRepo.ai_platforms.slice(0, 5).map((platform: string) => (
                        <span key={platform} className="text-xs" title={platform}>
                          {getPlatformEmoji(platform)}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                    {dev.topRepo.language && (
                      <div className="flex items-center gap-1">
                        <div className="w-2.5 h-2.5 rounded-full bg-blue-400" />
                        <span>{dev.topRepo.language}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-1">
                      <Star className="w-3.5 h-3.5" />
                      <span>{formatNumber(dev.topRepo.stargazers_count)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {!dev.topRepo && (
            <div className="text-sm text-gray-400 dark:text-gray-500 italic">
              {t('暂无热门项目', 'No top repository available')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};