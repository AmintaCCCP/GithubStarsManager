import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Info } from 'lucide-react';
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
    
    const padding = 16; // 屏幕边缘留白
    const arrowOffset = 12; // 箭头距离边缘的最小距离
    const gap = 8; // 气泡与按钮的间距
    
    // 计算气泡宽度（响应式）
    const tooltipWidth = Math.min(320, viewportWidth - padding * 2); // max-w-xs = 320px
    
    // 水平居中，但确保不溢出
    let left = containerRect.left + containerRect.width / 2 - tooltipWidth / 2;
    let arrowLeft = tooltipWidth / 2;
    
    // 左边界检测
    if (left < padding) {
      arrowLeft = containerRect.left + containerRect.width / 2 - padding;
      left = padding;
    }
    // 右边界检测
    if (left + tooltipWidth > viewportWidth - padding) {
      const overflow = left + tooltipWidth - (viewportWidth - padding);
      left = viewportWidth - padding - tooltipWidth;
      arrowLeft = tooltipWidth / 2 + overflow;
    }
    
    // 确保箭头不超出气泡边界
    arrowLeft = Math.max(arrowOffset, Math.min(tooltipWidth - arrowOffset, arrowLeft));
    
    // 垂直方向：优先向下，空间不足则向上
    const spaceBelow = viewportHeight - containerRect.bottom - gap;
    const spaceAbove = containerRect.top - gap;
    
    let top: number;
    let placement: 'top' | 'bottom';
    
    if (spaceBelow >= tooltipRect.height || spaceBelow >= spaceAbove) {
      // 向下显示
      top = containerRect.bottom + gap;
      placement = 'bottom';
    } else {
      // 向上显示
      top = containerRect.top - tooltipRect.height - gap;
      placement = 'top';
    }
    
    setPosition({ top, left, arrowLeft, placement });
  }, []);

  useEffect(() => {
    if (isVisible) {
      // 使用 requestAnimationFrame 确保 DOM 已更新
      requestAnimationFrame(() => {
        calculatePosition();
      });
      
      // 监听窗口变化
      window.addEventListener('resize', calculatePosition);
      window.addEventListener('scroll', calculatePosition, true);
      
      return () => {
        window.removeEventListener('resize', calculatePosition);
        window.removeEventListener('scroll', calculatePosition, true);
      };
    }
  }, [isVisible, calculatePosition]);

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

  const handleMouseEnter = () => setIsVisible(true);
  const handleMouseLeave = () => setIsVisible(false);
  const handleClick = () => setIsVisible(prev => !prev);

  return (
    <div className="relative inline-flex items-center" ref={containerRef}>
      <button
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
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
          className="fixed z-[9999] w-[calc(100vw-2rem)] max-w-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl"
          style={{ 
            top: position?.top ?? 0,
            left: position?.left ?? 0,
            opacity: position ? 1 : 0,
            transition: 'opacity 0.15s ease-out',
          }}
          role="tooltip"
        >
          {/* Arrow */}
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
          
          <div className="relative p-3 sm:p-4">
            <h4 className="font-semibold text-gray-900 dark:text-white mb-1.5 sm:mb-2 text-sm truncate">
              {info.title}
            </h4>
            {info.highlight && (
              <p className="text-xs sm:text-sm font-medium text-blue-600 dark:text-blue-400 mb-1.5 sm:mb-2 line-clamp-2">
                {info.highlight}
              </p>
            )}
            <p className="text-[11px] sm:text-xs text-gray-600 dark:text-gray-400 whitespace-pre-line leading-relaxed max-h-48 overflow-y-auto">
              {info.description}
            </p>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
