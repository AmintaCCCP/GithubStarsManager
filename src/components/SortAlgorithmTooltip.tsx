import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Info, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import type { DiscoveryChannelId } from '../types';

interface SortAlgorithmTooltipProps {
  channelId: DiscoveryChannelId;
  language: 'zh' | 'en';
}

interface TooltipPosition {
  top: number;
  left: number;
  arrowLeft: number;
  placement: 'top' | 'bottom';
}

export const SortAlgorithmTooltip: React.FC<SortAlgorithmTooltipProps> = ({ channelId, language }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState<TooltipPosition | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

  const calculatePosition = useCallback(() => {
    if (!containerRef.current || !tooltipRef.current) return;

    const containerRect = containerRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    const padding = 16;
    const arrowOffset = 12;
    const gap = 8;
    
    const tooltipWidth = Math.min(380, viewportWidth - padding * 2);
    
    let left = containerRect.left + containerRect.width / 2 - tooltipWidth / 2;
    let arrowLeft = tooltipWidth / 2;
    
    if (left < padding) {
      arrowLeft = containerRect.left + containerRect.width / 2 - padding;
      left = padding;
    }
    if (left + tooltipWidth > viewportWidth - padding) {
      const overflow = left + tooltipWidth - (viewportWidth - padding);
      left = viewportWidth - padding - tooltipWidth;
      arrowLeft = tooltipWidth / 2 + overflow;
    }
    
    arrowLeft = Math.max(arrowOffset, Math.min(tooltipWidth - arrowOffset, arrowLeft));
    
    const spaceBelow = viewportHeight - containerRect.bottom - gap;
    const spaceAbove = containerRect.top - gap;
    
    let top: number;
    let placement: 'top' | 'bottom';
    
    if (spaceBelow >= tooltipRect.height || spaceBelow >= spaceAbove) {
      top = containerRect.bottom + gap;
      placement = 'bottom';
    } else {
      top = containerRect.top - tooltipRect.height - gap;
      placement = 'top';
    }
    
    setPosition({ top, left, arrowLeft, placement });
  }, []);

  useEffect(() => {
    if (isVisible) {
      requestAnimationFrame(() => {
        calculatePosition();
      });
      
      window.addEventListener('resize', calculatePosition);
      window.addEventListener('scroll', calculatePosition, true);
      
      return () => {
        window.removeEventListener('resize', calculatePosition);
        window.removeEventListener('scroll', calculatePosition, true);
      };
    }
  }, [isVisible, calculatePosition]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isVisible) {
        setIsVisible(false);
      }
    };
    
    if (isVisible) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isVisible]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (isVisible && 
          tooltipRef.current && 
          !tooltipRef.current.contains(e.target as Node) &&
          containerRef.current && 
          !containerRef.current.contains(e.target as Node)) {
        setIsVisible(false);
      }
    };
    
    if (isVisible) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isVisible]);

  const getAlgorithmInfo = (channel: DiscoveryChannelId): { title: string; description: string; highlight: string } => {
    switch (channel) {
      case 'trending':
        return {
          title: t('仓库探索', 'Repository Discovery'),
          highlight: t('🔥 发现热门项目，支持多种筛选模式', '🔥 Discover hot projects with multiple filter modes'),
          description: t(
            '【时间范围】\n• 本周热门：最近7天活跃的项目\n• 本月趋势：最近30天活跃的项目\n• 新星项目：最近30天创建的项目\n• 经典项目：经过时间检验的项目\n• 本季度：最近90天活跃的项目\n\n【筛选条件】\n• Star门槛：100 / 500 / 1K / 5K / 10K\n• 排序方式：Star数/Fork数/更新时间\n• 编程语言：支持多种语言筛选\n\n【适合场景】\n一站式发现各类热门项目，灵活筛选满足不同需求。',
            '【Time Range】\n• Weekly Hot: Active in last 7 days\n• Monthly Trending: Active in last 30 days\n• New Stars: Created in last 30 days\n• Classic: Time-tested projects\n• Quarterly: Active in last 90 days\n\n【Filters】\n• Star threshold: 100 / 500 / 1K / 5K / 10K\n• Sort by: Stars/Forks/Updated\n• Language: Multiple language support\n\n【Best for】\nOne-stop discovery of hot projects with flexible filtering.'
          ),
        };
      case 'topic':
        return {
          title: t('专题浏览', 'Topics'),
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
      case 'rss-trending':
        return {
          title: t('RSS 趋势', 'RSS Trending'),
          highlight: t('📡 第三方 RSS 源获取 GitHub Trending', '📡 Third-party RSS feed for GitHub Trending'),
          description: t(
            '【特点】\n• 数据源：GitHubTrendingRSS 第三方服务\n• 时间范围：今日 / 本周 / 本月\n• 排序方式：与 GitHub Trending 官方一致\n• 自动补全：通过 GitHub API 获取完整仓库信息\n\n【适合场景】\n获取与 GitHub 官方 Trending 页面一致的实时热门项目，数据更新更及时。',
            '【Features】\n• Source: GitHubTrendingRSS third-party service\n• Time range: Daily / Weekly / Monthly\n• Sort: Same as official GitHub Trending\n• Auto-complete: Fetch full repo info via GitHub API\n\n【Best for】\nGetting real-time trending repos consistent with GitHub official Trending page, with more timely updates.'
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

  const handleClick = () => setIsVisible(prev => !prev);

  return (
    <div className="relative inline-flex items-center" ref={containerRef}>
      <button
        onClick={handleClick}
        className="p-1 rounded-full text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
        aria-label={t('排序算法说明', 'Sorting algorithm info')}
        aria-expanded={isVisible}
      >
        <Info className="w-4 h-4" />
      </button>

      {isVisible && createPortal(
        <div 
          ref={tooltipRef}
          className="fixed z-[9999] w-[calc(100vw-2rem)] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl"
          style={{ 
            top: position?.top ?? 0,
            left: position?.left ?? 0,
            width: position ? 'calc(100vw - 2rem)' : 0,
            maxWidth: '380px',
            opacity: position ? 1 : 0,
            transition: 'opacity 0.15s ease-out',
          }}
          role="dialog"
          aria-modal="true"
        >
          {position && (
            <div 
              className="absolute w-3 h-3 bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700"
              style={{
                left: position.arrowLeft,
                top: position.placement === 'bottom' ? -6 : 'auto',
                bottom: position.placement === 'top' ? -6 : 'auto',
                transform: 'translateX(-50%) rotate(45deg)',
                borderLeftWidth: position.placement === 'bottom' ? 1 : 0,
                borderTopWidth: position.placement === 'bottom' ? 0 : 1,
                borderRightWidth: position.placement === 'bottom' ? 0 : 1,
                borderBottomWidth: position.placement === 'bottom' ? 1 : 0,
                borderStyle: 'solid',
              }}
            />
          )}
          
          <div className="relative p-4">
            <div className="flex items-start justify-between gap-2 mb-2">
              <h4 className="font-semibold text-gray-900 dark:text-white text-sm">
                {info.title}
              </h4>
              <button
                onClick={() => setIsVisible(false)}
                className="p-1 rounded-full text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors shrink-0"
                aria-label={t('关闭', 'Close')}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            {info.highlight && (
              <p className="text-sm font-medium text-blue-600 dark:text-blue-400 mb-3">
                {info.highlight}
              </p>
            )}
            <div className="text-xs text-gray-600 dark:text-gray-400 whitespace-pre-line leading-relaxed">
              {info.description}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
