import React from 'react';
import { Search, Bot, Clock, TrendingUp } from 'lucide-react';
import { Repository } from '../types';
import { useAppStore } from '../store/useAppStore';

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
  const { language } = useAppStore();

  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

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
    <div className="bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/10 dark:to-purple-900/10 rounded-lg border border-black/[0.06] dark:border-white/[0.04] dark:border-black/[0.06] dark:border-white/[0.04] p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2">
          {isRealTimeSearch ? (
            <div className="flex items-center space-x-2 text-brand-violet dark:text-brand-violet">
              <div className="w-2 h-2 bg-brand-violet rounded-full animate-pulse"></div>
              <Search className="w-4 h-4" />
              <span className="font-medium text-sm">
                {t('实时搜索结果', 'Real-time Search Results')}
              </span>
            </div>
          ) : (
            <div className="flex items-center space-x-2 text-gray-700 dark:text-text-secondary ">
              <Bot className="w-4 h-4" />
              <span className="font-medium text-sm">
                {t('AI语义搜索结果', 'AI Semantic Search Results')}
              </span>
            </div>
          )}
        </div>
        
        {searchTime && (
          <div className="flex items-center space-x-1 text-xs text-gray-500 dark:text-text-tertiary">
            <Clock className="w-3 h-3" />
            <span>{searchTime.toFixed(0)}ms</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div className="text-center">
          <div className="text-lg font-semibold text-gray-900 dark:text-text-primary">
            {foundRepos}
          </div>
          <div className="text-gray-700 dark:text-text-tertiary">
            {t('找到仓库', 'Found Repos')}
          </div>
          <div className="text-xs text-gray-500 dark:text-text-tertiary">
            {filterRate}% {t('匹配率', 'Match Rate')}
          </div>
        </div>

        <div className="text-center">
          <div className="text-lg font-semibold text-gray-900 dark:text-text-primary">
            {stats.languages.length}
          </div>
          <div className="text-gray-700 dark:text-text-tertiary">
            {t('编程语言', 'Languages')}
          </div>
          <div className="text-xs text-gray-500 dark:text-text-tertiary">
            {stats.languages.slice(0, 2).join(', ')}
            {stats.languages.length > 2 && '...'}
          </div>
        </div>

        <div className="text-center">
          <div className="text-lg font-semibold text-gray-900 dark:text-text-primary">
            {stats.avgStars.toLocaleString()}
          </div>
          <div className="text-gray-700 dark:text-text-tertiary">
            {t('平均星标', 'Avg Stars')}
          </div>
          <div className="text-xs text-gray-500 dark:text-text-tertiary">
            <TrendingUp className="w-3 h-3 inline mr-1" />
            {t('热度指标', 'Popularity')}
          </div>
        </div>

        <div className="text-center">
          <div className="text-lg font-semibold text-gray-900 dark:text-text-primary">
            {stats.recentlyUpdated}
          </div>
          <div className="text-gray-700 dark:text-text-tertiary">
            {t('近期更新', 'Recent Updates')}
          </div>
          <div className="text-xs text-gray-500 dark:text-text-tertiary">
            {t('30天内', 'Within 30 days')}
          </div>
        </div>
      </div>

      {/* 搜索查询显示 */}
      <div className="mt-3 pt-3 border-t border-black/[0.06] dark:border-white/[0.04] dark:border-black/[0.06] dark:border-white/[0.04]">
        <div className="flex items-center space-x-2 text-sm">
          <span className="text-gray-700 dark:text-text-tertiary">
            {t('搜索查询:', 'Search Query:')}
          </span>
          <code className="bg-white dark:bg-panel-dark px-2 py-1 rounded border text-gray-900 dark:text-text-primary font-mono">
            "{searchQuery}"
          </code>
          {stats.aiAnalyzed > 0 && (
            <span className="text-xs text-status-emerald ml-2">
              {stats.aiAnalyzed} {t('个已AI分析', 'AI analyzed')}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};