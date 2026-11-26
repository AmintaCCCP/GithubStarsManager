



import { useT } from '../i18n/useT';
import React from 'react';
import { Search, Bot, Clock, TrendingUp } from 'lucide-react';
import { Repository } from '../types';

interface SearchResultStatsProps {
  repositories: Repository[];
  filteredRepositories: Repository[];
  searchQuery: string;
  isRealTimeSearch: boolean;
  searchTime?: number;
}

export const SearchResultStats: React.FC<SearchResultStatsProps> = ({
  repositories,
  filteredRepositories,
  searchQuery,
  isRealTimeSearch,
  searchTime
}) => {

  const t = useT('app');

  if (!searchQuery) return null;

  const totalRepos = repositories.length;
  const foundRepos = filteredRepositories.length;
  const filterRate = totalRepos > 0 ? ((foundRepos / totalRepos) * 100).toFixed(1) : '0';

  // 计算搜索结果的统计信息
  const stats = {
    languages: [...new Set(filteredRepositories.map(r => r.language).filter(Boolean))],
    avgStars: filteredRepositories.length > 0 
      ? Math.round(filteredRepositories.reduce((sum, r) => sum + r.stargazers_count, 0) / filteredRepositories.length)
      : 0,
    aiAnalyzed: filteredRepositories.filter(r => r.analyzed_at).length,
    recentlyUpdated: filteredRepositories.filter(r => {
      const updatedDate = new Date(r.pushed_at || r.updated_at);
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      return updatedDate > thirtyDaysAgo;
    }).length
  };

  return (
    <div className="mb-3 rounded-lg bg-raised p-3.5 shadow-elev-0">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {isRealTimeSearch ? (
            <div className="flex items-center gap-1.5 text-accent-text">
              <div className="size-1.5 rounded-full bg-accent-solid animate-pulse" />
              <Search className="size-3.5" />
              <span className="text-label font-medium">
                {t('searchResultStats.real-time-search-results')}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-secondary">
              <Bot className="size-3.5 text-tertiary" />
              <span className="text-label font-medium">
                {t('searchResultStats.ai-semantic-search-results')}
              </span>
            </div>
          )}
        </div>

        {searchTime && (
          <div className="flex items-center gap-1 text-label-sm text-tertiary tabular-nums">
            <Clock className="size-3" />
            <span>{searchTime.toFixed(0)}ms</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-md bg-sunken px-3 py-2">
          <div className="text-label-lg font-semibold text-foreground tabular-nums">
            {foundRepos}
          </div>
          <div className="text-label-sm text-secondary">
            {t('searchResultStats.found-repos')}
          </div>
          <div className="mt-0.5 text-label-sm text-tertiary tabular-nums">
            {filterRate}% {t('searchResultStats.match-rate')}
          </div>
        </div>

        <div className="rounded-md bg-sunken px-3 py-2">
          <div className="text-label-lg font-semibold text-foreground tabular-nums">
            {stats.languages.length}
          </div>
          <div className="text-label-sm text-secondary">
            {t('searchResultStats.languages')}
          </div>
          <div className="mt-0.5 truncate text-label-sm text-tertiary">
            {stats.languages.slice(0, 2).join(', ')}
            {stats.languages.length > 2 && '…'}
          </div>
        </div>

        <div className="rounded-md bg-sunken px-3 py-2">
          <div className="text-label-lg font-semibold text-foreground tabular-nums">
            {stats.avgStars.toLocaleString()}
          </div>
          <div className="text-label-sm text-secondary">
            {t('searchResultStats.avg-stars')}
          </div>
          <div className="mt-0.5 flex items-center gap-1 text-label-sm text-tertiary">
            <TrendingUp className="size-3" />
            <span>{t('searchResultStats.popularity')}</span>
          </div>
        </div>

        <div className="rounded-md bg-sunken px-3 py-2">
          <div className="text-label-lg font-semibold text-foreground tabular-nums">
            {stats.recentlyUpdated}
          </div>
          <div className="text-label-sm text-secondary">
            {t('searchResultStats.recent-updates')}
          </div>
          <div className="mt-0.5 text-label-sm text-tertiary">
            {t('searchResultStats.within-30-days')}
          </div>
        </div>
      </div>

      {/* 搜索查询显示 */}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-subtle pt-2.5 text-label-sm text-tertiary tabular-nums">
        <span>{t('searchResultStats.search-query')}</span>
        <code className="rounded-xs bg-sunken px-1.5 py-0.5 font-mono text-mono-ui text-foreground shadow-[inset_0_0_0_1px_var(--border-subtle)]">
          &quot;{searchQuery}&quot;
        </code>
        {stats.aiAnalyzed > 0 && (
          <>
            <span aria-hidden="true">·</span>
            <span className="text-status-green">
              {t('searchResultStats.ai-analyzed-count', { count: stats.aiAnalyzed })}
            </span>
          </>
        )}
      </div>
    </div>
  );
};