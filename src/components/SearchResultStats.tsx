



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
    <div className="bg-gradient-to-r from-accent/70 to-background dark:from-accent/30 dark:to-background rounded-lg border border-border p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2">
          {isRealTimeSearch ? (
            <div className="flex items-center space-x-2 text-primary dark:text-primary">
              <div className="w-2 h-2 bg-primary rounded-full animate-pulse"></div>
              <Search className="w-4 h-4" />
              <span className="font-medium text-sm">
                {t('searchResultStats.real-time-search-results')}
              </span>
            </div>
          ) : (
            <div className="flex items-center space-x-2 text-muted-foreground dark:text-muted-foreground ">
              <Bot className="w-4 h-4" />
              <span className="font-medium text-sm">
                {t('searchResultStats.ai-semantic-search-results')}
              </span>
            </div>
          )}
        </div>
        
        {searchTime && (
          <div className="flex items-center space-x-1 text-xs text-muted-foreground dark:text-muted-foreground">
            <Clock className="w-3 h-3" />
            <span>{searchTime.toFixed(0)}ms</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div className="text-center">
          <div className="text-lg font-semibold text-foreground dark:text-foreground">
            {foundRepos}
          </div>
          <div className="text-muted-foreground dark:text-muted-foreground">
            {t('searchResultStats.found-repos')}
          </div>
          <div className="text-xs text-muted-foreground dark:text-muted-foreground">
            {filterRate}% {t('searchResultStats.match-rate')}
          </div>
        </div>

        <div className="text-center">
          <div className="text-lg font-semibold text-foreground dark:text-foreground">
            {stats.languages.length}
          </div>
          <div className="text-muted-foreground dark:text-muted-foreground">
            {t('searchResultStats.languages')}
          </div>
          <div className="text-xs text-muted-foreground dark:text-muted-foreground">
            {stats.languages.slice(0, 2).join(', ')}
            {stats.languages.length > 2 && '…'}
          </div>
        </div>

        <div className="text-center">
          <div className="text-lg font-semibold text-foreground dark:text-foreground">
            {stats.avgStars.toLocaleString()}
          </div>
          <div className="text-muted-foreground dark:text-muted-foreground">
            {t('searchResultStats.avg-stars')}
          </div>
          <div className="text-xs text-muted-foreground dark:text-muted-foreground">
            <TrendingUp className="w-3 h-3 inline mr-1" />
            {t('searchResultStats.popularity')}
          </div>
        </div>

        <div className="text-center">
          <div className="text-lg font-semibold text-foreground dark:text-foreground">
            {stats.recentlyUpdated}
          </div>
          <div className="text-muted-foreground dark:text-muted-foreground">
            {t('searchResultStats.recent-updates')}
          </div>
          <div className="text-xs text-muted-foreground dark:text-muted-foreground">
            {t('searchResultStats.within-30-days')}
          </div>
        </div>
      </div>

      {/* 搜索查询显示 */}
      <div className="mt-3 pt-3 border-t border-border">
        <div className="flex items-center space-x-2 text-sm">
          <span className="text-muted-foreground dark:text-muted-foreground">
            {t('searchResultStats.search-query')}
          </span>
          <code className="bg-card dark:bg-card px-2 py-1 rounded border text-foreground dark:text-foreground font-mono">
            "{searchQuery}"
          </code>
          {stats.aiAnalyzed > 0 && (
            <span className="ml-2 text-xs text-success">
              {t('searchResultStats.ai-analyzed-count', { count: stats.aiAnalyzed })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};