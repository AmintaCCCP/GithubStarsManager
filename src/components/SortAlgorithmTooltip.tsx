import React, { useState } from 'react';
import { Info } from 'lucide-react';
import type { DiscoveryChannelId } from '../types';

interface SortAlgorithmTooltipProps {
  channelId: DiscoveryChannelId;
  language: 'zh' | 'en';
}

export const SortAlgorithmTooltip: React.FC<SortAlgorithmTooltipProps> = ({ channelId, language }) => {
  const [isVisible, setIsVisible] = useState(false);

  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

  const getAlgorithmInfo = (channel: DiscoveryChannelId): { title: string; description: string; highlight: string } => {
    switch (channel) {
      case 'trending':
        return {
          title: t('热门仓库', 'Trending Repositories'),
          highlight: t('🔥 发现近期热门的新兴项目', '🔥 Discover emerging hot projects'),
          description: t(
            '【特点】\n• 时间范围：最近30天有更新\n• Star门槛：50+\n• 排序方式：按Star数降序\n\n【适合场景】\n发现近期活跃且受欢迎的新兴项目，跟踪技术热点趋势。',
            '【Features】\n• Time range: Updated in last 30 days\n• Star threshold: 50+\n• Sort by: Stars descending\n\n【Best for】\nDiscovering emerging hot projects, tracking tech trends.'
          ),
        };
      case 'hot-release':
        return {
          title: t('热门发布', 'Hot Release'),
          highlight: t('🚀 跟踪项目最新动态', '🚀 Track latest project updates'),
          description: t(
            '【特点】\n• 时间范围：最近14天有更新\n• Star门槛：10+\n• 排序方式：按更新时间降序\n\n【适合场景】\n发现最近有更新、活跃开发中的项目，可能是刚发布新版本或有重大改进。',
            '【Features】\n• Time range: Updated in last 14 days\n• Star threshold: 10+\n• Sort by: Update time descending\n\n【Best for】\nFinding actively developed projects with recent updates or new releases.'
          ),
        };
      case 'most-popular':
        return {
          title: t('最受欢迎', 'Most Popular'),
          highlight: t('⭐ 发现经典成熟项目', '⭐ Discover classic mature projects'),
          description: t(
            '【特点】\n• 时间范围：创建超过6个月，1年内有更新\n• Star门槛：1000+\n• 排序方式：按Star数降序\n\n【适合场景】\n发现经过时间考验、广受认可的经典项目，适合寻找成熟稳定的工具和框架。',
            '【Features】\n• Time range: Created 6+ months ago, updated within 1 year\n• Star threshold: 1000+\n• Sort by: Stars descending\n\n【Best for】\nFinding time-tested, widely recognized classic projects for stable tools and frameworks.'
          ),
        };
      case 'topic':
        return {
          title: t('主题探索', 'Topic Exploration'),
          highlight: t('🏷️ 按技术主题浏览', '🏷️ Browse by tech topic'),
          description: t(
            '【特点】\n• 按选定主题标签筛选\n• Star门槛：10+\n• 排序方式：按Star数降序\n\n【适合场景】\n按特定技术领域（AI、数据库、Web开发等）浏览优质项目。',
            '【Features】\n• Filter by selected topic\n• Star threshold: 10+\n• Sort by: Stars descending\n\n【Best for】\nBrowsing quality projects by specific tech domain (AI, Database, Web, etc.).'
          ),
        };
      case 'search':
        return {
          title: t('搜索', 'Search'),
          highlight: t('🔍 自定义关键词搜索', '🔍 Custom keyword search'),
          description: t(
            '【特点】\n• 支持自定义关键词搜索\n• 多种排序方式：最佳匹配、最多Star、最多Fork\n• 可结合语言和平台过滤\n\n【适合场景】\n精确搜索特定项目或技术栈相关的仓库。',
            '【Features】\n• Custom keyword search\n• Sort options: Best match, Most stars, Most forks\n• Language and platform filters\n\n【Best for】\nPrecise search for specific projects or tech stack related repos.'
          ),
        };
      default:
        return {
          title: t('排序算法', 'Sorting Algorithm'),
          highlight: '',
          description: t('按默认规则排序', 'Sorted by default rules'),
        };
    }
  };

  const info = getAlgorithmInfo(channelId);

  return (
    <div className="relative inline-flex items-center">
      <button
        onMouseEnter={() => setIsVisible(true)}
        onMouseLeave={() => setIsVisible(false)}
        onClick={() => setIsVisible(!isVisible)}
        className="p-1 rounded-full text-gray-400 dark:text-text-quaternary hover:text-brand-violet hover:bg-gray-100 dark:bg-white/[0.04] dark:hover:bg-gray-100 dark:bg-white/[0.04] transition-colors"
      >
        <Info className="w-4 h-4" />
      </button>

      {isVisible && (
        <div className="absolute top-full mt-2 left-0 sm:left-1/2 sm:-translate-x-1/2 z-[9999]" style={{ zIndex: 9999 }}>
          <div className="relative bg-white dark:bg-panel-dark border border-black/[0.06] dark:border-white/[0.04] rounded-lg shadow-xl p-4 w-[calc(100vw-2rem)] sm:w-80 max-w-[calc(100vw-2rem)]">
            {/* Arrow */}
            <div className="absolute top-0 left-4 sm:left-1/2 sm:-translate-x-1/2 -translate-y-full z-[10000]">
              <div className="w-0 h-0 border-l-8 border-l-transparent border-r-8 border-r-transparent border-b-8 border-b-black/[0.06] dark:border-b-white/[0.04]" />
              <div className="absolute left-1/2 -translate-x-1/2 top-0.5 w-0 h-0 border-l-8 border-l-transparent border-r-8 border-r-transparent border-b-8 border-b-white dark:border-b-panel-dark" />
            </div>

            <h4 className="font-semibold text-gray-900 dark:text-text-primary mb-2 text-sm">
              {info.title}
            </h4>
            {info.highlight && (
              <p className="text-sm font-medium text-brand-violet dark:text-brand-violet mb-2">
                {info.highlight}
              </p>
            )}
            <p className="text-xs text-gray-700 dark:text-text-tertiary whitespace-pre-line leading-relaxed">
              {info.description}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
