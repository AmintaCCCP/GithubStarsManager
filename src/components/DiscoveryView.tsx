import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { 
  RefreshCw, 
  TrendingUp, 
  Bot, 
  Loader2, 
  Rocket, 
  Tag, 
  Search,
  Crown,
  Filter,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Monitor,
  Apple,
  Terminal,
  Smartphone,
  Globe,
  X
} from 'lucide-react';
import { useAppStore, useAppStoreRaw } from '../store/useAppStore';
import { GitHubApiService } from '../services/githubApi';
import { AIService } from '../services/aiService';
import { AIAnalysisOptimizer } from '../services/aiAnalysisOptimizer';
import { DiscoverySidebar } from './DiscoverySidebar';
import { SubscriptionRepoCard } from './SubscriptionRepoCard';
import { SortAlgorithmTooltip } from './SortAlgorithmTooltip';
import { ScrollToBottom } from './ScrollToBottom';
import type {
  DiscoveryChannelId,
  DiscoveryChannelIcon,
  DiscoveryRepo,
  DiscoveryPlatform,
  ProgrammingLanguage,
  SortBy,
  SortOrder,
  TopicCategory
} from '../types';
import { ITEMS_PER_PAGE } from '../utils/pagination';

const discoveryChannelIconMap: Record<DiscoveryChannelIcon, React.ReactNode> = {
  trending: <TrendingUp className="w-4 h-4" />,
  rocket: <Rocket className="w-4 h-4" />,
  star: <Crown className="w-4 h-4" />,
  tag: <Tag className="w-4 h-4" />,
  search: <Search className="w-4 h-4" />,
};

const discoveryChannelStyleMap: Record<DiscoveryChannelIcon, { gradient: string; shadow: string; largeIcon: React.ReactNode }> = {
  trending: {
    gradient: 'from-blue-500 to-indigo-600',
    shadow: 'shadow-blue-500/25',
    largeIcon: <TrendingUp className="w-9 h-9 text-white" />,
  },
  rocket: {
    gradient: 'from-orange-500 to-red-600',
    shadow: 'shadow-orange-500/25',
    largeIcon: <Rocket className="w-9 h-9 text-white" />,
  },
  star: {
    gradient: 'from-amber-400 to-yellow-600',
    shadow: 'shadow-amber-500/25',
    largeIcon: <Crown className="w-9 h-9 text-white" />,
  },
  tag: {
    gradient: 'from-emerald-500 to-teal-600',
    shadow: 'shadow-emerald-500/25',
    largeIcon: <Tag className="w-9 h-9 text-white" />,
  },
  search: {
    gradient: 'from-violet-500 to-purple-600',
    shadow: 'shadow-violet-500/25',
    largeIcon: <Search className="w-9 h-9 text-white" />,
  },
};

interface MobileTabNavProps {
  channels: { id: DiscoveryChannelId; name: string; nameEn: string; icon: React.ReactNode }[];
  selectedChannel: DiscoveryChannelId;
  onChannelSelect: (channel: DiscoveryChannelId) => void;
  language: 'zh' | 'en';
}

const MobileTabNav: React.FC<MobileTabNavProps> = ({ 
  channels, 
  selectedChannel, 
  onChannelSelect,
  language 
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Map<DiscoveryChannelId, HTMLButtonElement>>(new Map());
  const [indicatorStyle, setIndicatorStyle] = useState({ translateX: 0, width: 0 });
  const isScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);

  const updateIndicator = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }

    rafRef.current = requestAnimationFrame(() => {
      const activeButton = tabRefs.current.get(selectedChannel);
      if (activeButton && scrollContainerRef.current) {
        const container = scrollContainerRef.current;
        const translateX = activeButton.offsetLeft - container.scrollLeft;
        const width = activeButton.offsetWidth;

        setIndicatorStyle({ translateX, width });
      }
    });
  }, [selectedChannel]);

  const scrollToActiveTab = useCallback(() => {
    const activeButton = tabRefs.current.get(selectedChannel);
    if (activeButton && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const scrollLeft = activeButton.offsetLeft - (container.offsetWidth / 2) + (activeButton.offsetWidth / 2);
      
      container.scrollTo({
        left: Math.max(0, scrollLeft),
        behavior: 'smooth',
      });
    }
  }, [selectedChannel]);

  useEffect(() => {
    updateIndicator();
  }, [updateIndicator]);

  useEffect(() => {
    scrollToActiveTab();
    const timer = setTimeout(() => {
      updateIndicator();
    }, 350);
    return () => clearTimeout(timer);
  }, [selectedChannel, scrollToActiveTab, updateIndicator]);

  const handleScroll = useCallback(() => {
    if (!isScrollingRef.current) {
      isScrollingRef.current = true;
    }
    
    updateIndicator();

    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }
    
    scrollTimeoutRef.current = setTimeout(() => {
      isScrollingRef.current = false;
    }, 150);
  }, [updateIndicator]);

  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  return (
    <div 
      className="relative w-full border-b border-gray-200 dark:border-gray-700 bg-gray-50/95 dark:bg-gray-800/95 backdrop-blur-sm lg:hidden"
    >
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        role="tablist"
        className="flex overflow-x-auto scrollbar-hide py-2 px-2 gap-1 snap-x snap-mandatory"
        style={{
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {channels.map((channel) => (
          <button
            key={channel.id}
            ref={(el) => {
              if (el) tabRefs.current.set(channel.id, el);
            }}
            onClick={() => onChannelSelect(channel.id)}
            role="tab"
            aria-selected={selectedChannel === channel.id}
            className={`
              relative flex-shrink-0 px-4 py-2 rounded-lg text-sm font-medium snap-start
              transition-all duration-200 ease-out
              focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2
              ${selectedChannel === channel.id
                ? 'text-blue-700 dark:text-blue-300'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
              }
            `}
          >
            <span className="flex items-center gap-1.5 whitespace-nowrap">
              {channel.icon}
              {language === 'zh' ? channel.name : channel.nameEn}
            </span>
          </button>
        ))}
      </div>
      
      {/* Active indicator */}
      <div
        className="absolute bottom-0 h-0.5 bg-blue-500 rounded-full transition-transform duration-200 ease-out will-change-transform"
        style={{
          width: indicatorStyle.width,
          transform: `translateX(${indicatorStyle.translateX}px)`,
        }}
      />
    </div>
  );
};

interface PlatformFilterProps {
  platform: DiscoveryPlatform;
  onPlatformChange: (platform: DiscoveryPlatform) => void;
  language: 'zh' | 'en';
}

const PlatformFilter: React.FC<PlatformFilterProps> = ({ platform, onPlatformChange, language }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const platforms: { id: DiscoveryPlatform; name: string; nameEn: string; icon: React.ReactNode }[] = [
    { id: 'All', name: '全部平台', nameEn: 'All Platforms', icon: <Globe className="w-4 h-4" /> },
    { id: 'Android', name: 'Android', nameEn: 'Android', icon: <Smartphone className="w-4 h-4" /> },
    { id: 'Macos', name: 'macOS', nameEn: 'macOS', icon: <Apple className="w-4 h-4" /> },
    { id: 'Windows', name: 'Windows', nameEn: 'Windows', icon: <Monitor className="w-4 h-4" /> },
    { id: 'Linux', name: 'Linux', nameEn: 'Linux', icon: <Terminal className="w-4 h-4" /> },
  ];

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedPlatform = platforms.find(p => p.id === platform);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
      >
        <Filter className="w-4 h-4" />
        <span className="hidden xl:inline">{language === 'zh' ? selectedPlatform?.name : selectedPlatform?.nameEn}</span>
        <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute left-0 sm:left-auto sm:right-0 mt-2 w-48 max-w-[calc(100vw-2rem)] bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-lg py-1 z-50">
          {platforms.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                onPlatformChange(p.id);
                setIsOpen(false);
              }}
              className={`flex w-full items-center gap-2 px-4 py-2 text-sm transition-colors ${
                platform === p.id
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              {p.icon}
              {language === 'zh' ? p.name : p.nameEn}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// 重构后的 Pagination Component - 完整版本
interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  language: 'zh' | 'en';
  isLoading?: boolean;
}

const Pagination: React.FC<PaginationProps> = ({ 
  currentPage, 
  totalPages, 
  onPageChange, 
  language,
  isLoading = false 
}) => {
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  const [inputPage, setInputPage] = useState<string>(String(currentPage));
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 同步外部页码变化到输入框
  useEffect(() => {
    if (!isEditing) {
      setInputPage(String(currentPage));
      setError(null);
    }
  }, [currentPage, isEditing]);

  // 聚焦输入框
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  // 生成页码数组，包含省略号逻辑
  const getPageNumbers = useCallback(() => {
    if (totalPages <= 0) return [];
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }

    const pages: (number | '...')[] = [];
    const delta = 2;

    for (let i = 1; i <= totalPages; i++) {
      if (
        i === 1 ||
        i === totalPages ||
        (i >= currentPage - delta && i <= currentPage + delta)
      ) {
        pages.push(i);
      } else if (pages[pages.length - 1] !== '...') {
        pages.push('...');
      }
    }

    return pages;
  }, [currentPage, totalPages]);

  // 输入框内容变化处理
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === '' || /^\d*$/.test(value)) {
      setInputPage(value);
      setError(null);
    }
  }, []);

  // 提交页码跳转
  const handleInputSubmit = useCallback(() => {
    const pageNum = parseInt(inputPage, 10);
    
    if (isNaN(pageNum)) {
      setError(t('请输入有效页码', 'Please enter a valid page number'));
      setInputPage(String(currentPage));
    } else if (pageNum < 1) {
      setError(t('页码不能小于1', 'Page number cannot be less than 1'));
      setInputPage('1');
    } else if (pageNum > totalPages) {
      setError(t('页码不能超过总页数', 'Page number cannot exceed total pages'));
      setInputPage(String(totalPages));
    } else {
      console.log(`[Pagination] Jump to page: ${pageNum}`);
      onPageChange(pageNum);
    }
    setIsEditing(false);
  }, [inputPage, currentPage, totalPages, onPageChange, t]);

  // 键盘事件处理
  const handleInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleInputSubmit();
    } else if (e.key === 'Escape') {
      setInputPage(String(currentPage));
      setError(null);
      setIsEditing(false);
    }
  }, [handleInputSubmit, currentPage]);

  // 失焦事件处理
  const handleInputBlur = useCallback(() => {
    handleInputSubmit();
  }, [handleInputSubmit]);

  // 处理页码按钮点击
  const handlePageButtonClick = useCallback((page: number) => {
    if (page < 1 || page > totalPages || page === currentPage) {
      return;
    }
    console.log(`[Pagination] Page button clicked: ${page}`);
    onPageChange(page);
  }, [currentPage, totalPages, onPageChange]);

  // 处理上一页点击
  const handlePreviousClick = useCallback(() => {
    if (currentPage > 1) {
      console.log(`[Pagination] Previous page: ${currentPage - 1}`);
      onPageChange(currentPage - 1);
    }
  }, [currentPage, onPageChange]);

  // 处理下一页点击
  const handleNextClick = useCallback(() => {
    if (currentPage < totalPages) {
      console.log(`[Pagination] Next page: ${currentPage + 1}`);
      onPageChange(currentPage + 1);
    }
  }, [currentPage, totalPages, onPageChange]);

  // 边界条件处理：总页数为0或负数时不显示
  if (!totalPages || totalPages <= 0) {
    return null;
  }

  // 只有一页时不显示分页器
  if (totalPages === 1) {
    return null;
  }

  const pageNumbers = getPageNumbers();

  return (
    <div className="flex flex-col items-center gap-2 py-4">
      {/* 错误提示 */}
      {error && (
        <div className="text-xs text-red-500 dark:text-red-400 px-2 py-1 bg-red-50 dark:bg-red-900/20 rounded">
          {error}
        </div>
      )}
      
      <div className="flex items-center justify-center gap-2 flex-wrap">
        {/* 上一页按钮 */}
        <button
          onClick={handlePreviousClick}
          disabled={currentPage === 1 || isLoading}
          className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title={t('上一页', 'Previous Page')}
        >
          <ChevronLeft className="w-4 h-4" />
          {t('上一页', 'Prev')}
        </button>

        {/* 页码按钮组 */}
        <div className="flex items-center gap-1">
          {pageNumbers.map((page, index) => (
            <React.Fragment key={`page-${index}`}>
              {page === '...' ? (
                <span className="px-2 text-gray-400 dark:text-gray-500 select-none" aria-hidden="true">
                  ...
                </span>
              ) : (
                <button
                  onClick={() => handlePageButtonClick(page as number)}
                  disabled={page === currentPage || isLoading}
                  className={`min-w-[36px] px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    currentPage === page
                      ? 'bg-blue-500 text-white shadow-md'
                      : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:cursor-not-allowed'
                  }`}
                  aria-current={currentPage === page ? 'page' : undefined}
                >
                  {page}
                </button>
              )}
            </React.Fragment>
          ))}
        </div>

        {/* 下一页按钮 */}
        <button
          onClick={handleNextClick}
          disabled={currentPage === totalPages || isLoading}
          className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title={t('下一页', 'Next Page')}
        >
          {t('下一页', 'Next')}
          <ChevronRight className="w-4 h-4" />
        </button>

        {/* 快速跳转区域 */}
        <div className="flex items-center gap-2 ml-2 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
          <span className="text-sm text-gray-500 dark:text-gray-400">{t('跳转到', 'Go to')}</span>
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={inputPage}
              onChange={handleInputChange}
              onKeyDown={handleInputKeyDown}
              onBlur={handleInputBlur}
              className="w-14 px-2 py-1 text-sm text-center border-2 border-blue-500 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white dark:border-blue-400"
              aria-label={t('输入页码', 'Enter page number')}
            />
          ) : (
            <button
              onClick={() => setIsEditing(true)}
              className="w-14 px-2 py-1 text-sm text-center bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded hover:border-blue-500 dark:hover:border-blue-400 transition-colors dark:text-white"
              title={t('点击编辑页码', 'Click to edit page')}
            >
              {currentPage}
            </button>
          )}
          <span className="text-sm text-gray-500 dark:text-gray-400">/ {totalPages}</span>
        </div>
      </div>

      {/* 加载状态指示 */}
      {isLoading && (
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          {t('加载中...', 'Loading...')}
        </div>
      )}
    </div>
  );
};

// 重构后的 CompactPagination Component
interface CompactPaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  language: 'zh' | 'en';
  totalCount: number;
  isLoading?: boolean;
}

const CompactPagination: React.FC<CompactPaginationProps> = ({ 
  currentPage, 
  totalPages, 
  onPageChange, 
  language,
  totalCount,
  isLoading = false 
}) => {
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  const [inputPage, setInputPage] = useState<string>(String(currentPage));
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 同步外部页码变化到输入框
  useEffect(() => {
    if (!isEditing) {
      setInputPage(String(currentPage));
      setError(null);
    }
  }, [currentPage, isEditing]);

  // 聚焦输入框
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  // 输入框内容变化处理
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === '' || /^\d*$/.test(value)) {
      setInputPage(value);
      setError(null);
    }
  }, []);

  // 提交页码跳转
  const handleInputSubmit = useCallback(() => {
    const pageNum = parseInt(inputPage, 10);
    
    if (isNaN(pageNum)) {
      setError(t('无效页码', 'Invalid'));
      setInputPage(String(currentPage));
    } else if (pageNum < 1) {
      setError(t('最小为1', 'Min 1'));
      setInputPage('1');
    } else if (pageNum > totalPages) {
      setError(t('超出范围', 'Out of range'));
      setInputPage(String(totalPages));
    } else {
      console.log(`[CompactPagination] Jump to page: ${pageNum}`);
      onPageChange(pageNum);
    }
    setIsEditing(false);
  }, [inputPage, currentPage, totalPages, onPageChange, t]);

  // 键盘事件处理
  const handleInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleInputSubmit();
    } else if (e.key === 'Escape') {
      setInputPage(String(currentPage));
      setError(null);
      setIsEditing(false);
    }
  }, [handleInputSubmit, currentPage]);

  // 失焦事件处理
  const handleInputBlur = useCallback(() => {
    handleInputSubmit();
  }, [handleInputSubmit]);

  // 处理上一页点击
  const handlePreviousClick = useCallback(() => {
    if (currentPage > 1 && !isLoading) {
      console.log(`[CompactPagination] Previous: ${currentPage - 1}`);
      onPageChange(currentPage - 1);
    }
  }, [currentPage, onPageChange, isLoading]);

  // 处理下一页点击
  const handleNextClick = useCallback(() => {
    if (currentPage < totalPages && !isLoading) {
      console.log(`[CompactPagination] Next: ${currentPage + 1}`);
      onPageChange(currentPage + 1);
    }
  }, [currentPage, totalPages, onPageChange, isLoading]);

  // 边界条件处理
  if (!totalPages || totalPages <= 0) {
    return null;
  }

  if (totalPages === 1) {
    return null;
  }

  return (
    <div className="flex flex-col items-center gap-1">
      {/* 错误提示 */}
      {error && (
        <div className="text-xs text-red-500 dark:text-red-400">
          {error}
        </div>
      )}
      
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
        {/* 上一页按钮 */}
        <button
          onClick={handlePreviousClick}
          disabled={currentPage === 1 || isLoading}
          className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title={t('上一页', 'Previous')}
        >
          <ChevronLeft className="w-4 h-4 text-gray-600 dark:text-gray-400" />
        </button>
        
        {/* 总数显示 */}
        <span className="hidden xl:inline text-xs text-gray-500 dark:text-gray-400">
          {t('共', 'Total')} {totalCount}
        </span>
        
        {/* 页码显示/编辑 */}
        <div className="flex items-center gap-1">
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={inputPage}
              onChange={handleInputChange}
              onKeyDown={handleInputKeyDown}
              onBlur={handleInputBlur}
              className="w-10 px-1.5 py-0.5 text-xs text-center border-2 border-blue-500 rounded focus:outline-none dark:bg-gray-700 dark:text-white"
              aria-label={t('输入页码', 'Enter page')}
            />
          ) : (
            <button
              onClick={() => setIsEditing(true)}
              disabled={isLoading}
              className="w-10 px-1.5 py-0.5 text-xs text-center bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded hover:border-blue-500 transition-colors dark:text-white disabled:cursor-not-allowed"
              title={t('点击跳转', 'Click to jump')}
            >
              {currentPage}
            </button>
          )}
          <span className="text-xs text-gray-500 dark:text-gray-400">/ {totalPages}</span>
        </div>
        
        {/* 下一页按钮 */}
        <button
          onClick={handleNextClick}
          disabled={currentPage === totalPages || isLoading}
          className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title={t('下一页', 'Next')}
        >
          <ChevronRight className="w-4 h-4 text-gray-600 dark:text-gray-400" />
        </button>
      </div>

      {/* 加载状态 */}
      {isLoading && (
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {t('加载中...', 'Loading...')}
        </div>
      )}
    </div>
  );
};

export const DiscoveryView: React.FC = React.memo(() => {
  const {
    githubToken,
    language,
    discoveryChannels,
    discoveryRepos,
    discoveryLastRefresh,
    discoveryIsLoading,
    selectedDiscoveryChannel,
    setSelectedDiscoveryChannel,
    setDiscoveryLoading,
    setDiscoveryRepos,
    setDiscoveryLastRefresh,
    updateDiscoveryRepo,
    aiConfigs,
    activeAIConfig,
    analysisProgress,
    setAnalysisProgress,
    discoveryPlatform,
    setDiscoveryPlatform,
    discoveryLanguage,
    setDiscoveryLanguage,
    discoverySortBy,
    setDiscoverySortBy,
    discoverySortOrder,
    setDiscoverySortOrder,
    discoverySearchQuery,
    setDiscoverySearchQuery,
    discoverySelectedTopic,
    setDiscoverySelectedTopic,
    discoveryHasMore,
    setDiscoveryHasMore,
    setDiscoveryNextPage,
    discoveryTotalCount,
    setDiscoveryTotalCount,
    discoveryCurrentPage,
    setDiscoveryCurrentPage,
    setDiscoveryScrollPosition,
    appendDiscoveryRepos,
  } = useAppStore();

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisOptimizer, setAnalysisOptimizer] = useState<AIAnalysisOptimizer | null>(null);
  const [, setAnalysisState] = useState<{ paused: boolean; aborted: boolean }>({ paused: false, aborted: false });
  const [searchInput, setSearchInput] = useState(discoverySearchQuery);
  
  // 使用 store 中的当前页码
  const currentPage = discoveryCurrentPage[selectedDiscoveryChannel] || 1;

  // 滚动容器引用
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // 工具栏显示状态
  const [isToolbarVisible, setIsToolbarVisible] = useState(true);
  const lastScrollY = useRef(0);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 用于在频道切换时直接读取最新滚动位置，避免订阅整个 map 导致 effect 重跑
  const discoveryScrollPositionsRef = useRef<Record<string, number>>({});
  // 用于跳过滚动位置保存的标志
  const skipScrollSaveRef = useRef(false);

  const t = useCallback((zh: string, en: string) => language === 'zh' ? zh : en, [language]);

  // 获取当前频道的所有仓库
  const allRepos = useMemo(
    () => (discoveryRepos && discoveryRepos[selectedDiscoveryChannel]) || [],
    [discoveryRepos, selectedDiscoveryChannel]
  );

  // 从 store 获取当前频道的总数量
  const currentTotalCount = discoveryTotalCount?.[selectedDiscoveryChannel] ?? 0;

  const totalPages = useMemo(() => {
    // 如果有总数，使用总数计算
    if (currentTotalCount > 0) {
      return Math.max(1, Math.ceil(currentTotalCount / ITEMS_PER_PAGE));
    }
    // 如果有数据但没有总数，至少有1页
    if (allRepos.length > 0) {
      return Math.max(1, Math.ceil(allRepos.length / ITEMS_PER_PAGE));
    }
    // 数据为空时，返回0表示无数据
    return 0;
  }, [currentTotalCount, allRepos.length]);

  // 获取当前页显示的仓库
  // 服务端分页模式：allRepos 就是当前页的数据，不需要切片
  const currentPageRepos = useMemo(() => {
    console.log(`[Discovery] Current page repos: ${allRepos.length} items, page ${currentPage}/${totalPages || '?'}`);
    return allRepos;
  }, [allRepos, currentPage, totalPages]);

  const currentLastRefresh = discoveryLastRefresh?.[selectedDiscoveryChannel] ?? null;
  const currentIsLoading = discoveryIsLoading?.[selectedDiscoveryChannel] ?? false;
  const currentHasMore = discoveryHasMore?.[selectedDiscoveryChannel] ?? false;
  const currentChannelIcon = discoveryChannels.find(ch => ch.id === selectedDiscoveryChannel)?.icon || 'trending';
  const currentChannelStyle = discoveryChannelStyleMap[currentChannelIcon] || discoveryChannelStyleMap.trending;
  const currentChannelIconNode = discoveryChannelIconMap[currentChannelIcon] || discoveryChannelIconMap.trending;

  // 切换频道时重置页码并恢复滚动位置（只依赖 selectedDiscoveryChannel，不订阅 discoveryScrollPositions）
  useEffect(() => {
    console.log(`[Discovery] Channel changed to ${selectedDiscoveryChannel}, resetting page to 1`);
    setDiscoveryCurrentPage(selectedDiscoveryChannel, 1);
    // 恢复当前频道的滚动位置（从 ref 读取最新值，避免订阅整个 map）
    if (scrollContainerRef.current) {
      const savedPosition = discoveryScrollPositionsRef.current[selectedDiscoveryChannel] || 0;
      scrollContainerRef.current.scrollTop = savedPosition;
    }
  }, [selectedDiscoveryChannel, setDiscoveryCurrentPage]);

  const refreshChannel = useCallback(async (channelId: DiscoveryChannelId, page: number = 1, append: boolean = false) => {
    console.log(`[Discovery] Refreshing channel ${channelId}, page: ${page}, append: ${append}`);
    
    if (!githubToken) {
      alert(t('GitHub Token 未找到，请重新登录。', 'GitHub token not found. Please login again.'));
      return;
    }

    setDiscoveryLoading(channelId, true);
    try {
      const githubApi = new GitHubApiService(githubToken);
      let result;

      switch (channelId) {
        case 'trending':
          result = await githubApi.getTrendingRepositories(discoveryPlatform, page);
          break;
        case 'hot-release':
          result = await githubApi.getHotReleaseRepositories(discoveryPlatform, page);
          break;
        case 'most-popular':
          result = await githubApi.getMostPopular(discoveryPlatform, page);
          break;
        case 'topic':
          if (discoverySelectedTopic) {
            result = await githubApi.getTopicRepositories(discoverySelectedTopic, discoveryPlatform, page);
          } else {
            result = await githubApi.getTrendingRepositories(discoveryPlatform, page);
          }
          break;
        case 'search':
          if (discoverySearchQuery.trim()) {
            result = await githubApi.searchRepositories(
              discoverySearchQuery,
              discoveryPlatform,
              discoveryLanguage,
              discoverySortBy,
              discoverySortOrder,
              page
            );
          } else {
            result = { repos: [], hasMore: false, nextPageIndex: 2, totalCount: 0 };
          }
          break;
        default:
          result = { repos: [], hasMore: false, nextPageIndex: 2, totalCount: 0 };
      }

      console.log(`[Discovery] Received ${result.repos.length} repos, hasMore: ${result.hasMore}, totalCount: ${result.totalCount}`);

      // 合并AI分析结果（如果仓库之前被分析过）
      // 使用 getState 获取最新状态，避免闭包问题
      const currentState = useAppStoreRaw();
      const currentRepos = currentState.discoveryRepos[channelId] || [];
      const mergedRepos = result.repos.map((newRepo: DiscoveryRepo) => {
        const existingRepo = currentRepos.find(r => r.id === newRepo.id);
        if (existingRepo && existingRepo.analyzed_at) {
          return {
            ...newRepo,
            ai_summary: existingRepo.ai_summary,
            ai_tags: existingRepo.ai_tags,
            ai_platforms: existingRepo.ai_platforms,
            analyzed_at: existingRepo.analyzed_at,
            analysis_failed: existingRepo.analysis_failed,
          };
        }
        return newRepo;
      });

      if (append) {
        appendDiscoveryRepos(channelId, mergedRepos);
      } else {
        setDiscoveryRepos(channelId, mergedRepos);
      }
      setDiscoveryHasMore(channelId, result.hasMore);
      setDiscoveryNextPage(channelId, result.nextPageIndex);
      // 保存总数量用于计算总页数
      if (result.totalCount !== undefined) {
        setDiscoveryTotalCount(channelId, result.totalCount);
      }
      setDiscoveryLastRefresh(channelId, new Date().toISOString());
      
      console.log(`[Discovery] Channel ${channelId} refreshed successfully`);
    } catch (error) {
      console.error(`[Discovery] Failed to refresh channel ${channelId}:`, error);
      alert(t('获取数据失败，请检查网络连接或GitHub Token。', 'Failed to fetch data. Please check your network connection or GitHub Token.'));
    } finally {
      setDiscoveryLoading(channelId, false);
    }
  }, [githubToken, t, setDiscoveryLoading, setDiscoveryRepos, setDiscoveryLastRefresh, discoveryPlatform, discoveryLanguage, discoverySortBy, discoverySortOrder, discoverySearchQuery, discoverySelectedTopic, setDiscoveryHasMore, setDiscoveryNextPage, setDiscoveryTotalCount, appendDiscoveryRepos]);

  // 主题改变时刷新数据
  useEffect(() => {
    if (selectedDiscoveryChannel === 'topic' && discoverySelectedTopic) {
      refreshChannel('topic', 1, false);
    }
  }, [discoverySelectedTopic, selectedDiscoveryChannel, refreshChannel]);

  const formatLastRefresh = useCallback((timestamp: string | null) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / (1000 * 60));
    if (diffMin < 1) return t('刚刚', 'Just now');
    if (diffMin < 60) return t(`${diffMin}分钟前`, `${diffMin}m ago`);
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return t(`${diffHours}小时前`, `${diffHours}h ago`);
    return date.toLocaleDateString();
  }, [t]);

  // 处理滚动事件：保存滚动位置并控制工具栏显示
  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current) return;

    const currentScrollY = scrollContainerRef.current.scrollTop;

    // 如果设置了跳过标志，只更新工具栏状态，不保存滚动位置
    if (skipScrollSaveRef.current) {
      if (currentScrollY < 50 || currentScrollY < lastScrollY.current) {
        setIsToolbarVisible(true);
      } else if (currentScrollY > lastScrollY.current + 10) {
        setIsToolbarVisible(false);
      }
      lastScrollY.current = currentScrollY;
      return;
    }

    // 同时更新 ref 和 state，保证频道切换 effect 读取到最新值，且 UI 仍保持响应
    discoveryScrollPositionsRef.current[selectedDiscoveryChannel] = currentScrollY;
    setDiscoveryScrollPosition(selectedDiscoveryChannel, currentScrollY);

    // 控制工具栏显示/隐藏
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }

    // 向上滚动或接近顶部时显示工具栏，向下滚动时隐藏
    if (currentScrollY < 50 || currentScrollY < lastScrollY.current) {
      setIsToolbarVisible(true);
    } else if (currentScrollY > lastScrollY.current + 10) {
      setIsToolbarVisible(false);
    }

    lastScrollY.current = currentScrollY;

    // 滚动停止后重新显示工具栏
    scrollTimeoutRef.current = setTimeout(() => {
      setIsToolbarVisible(true);
    }, 1500);
  }, [selectedDiscoveryChannel, setDiscoveryScrollPosition]);

  // 清理滚动定时器
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  const handleAnalyzePage = useCallback(async () => {
    if (!githubToken) return;

    const activeConfig = aiConfigs.find(c => c.id === activeAIConfig);
    if (!activeConfig) {
      alert(t('请先在设置中配置AI服务。', 'Please configure AI service in settings first.'));
      return;
    }

    // 获取当前页的20个项目
    const pageRepos = currentPageRepos;
    
    if (pageRepos.length === 0) {
      alert(t('当前页面没有项目。', 'No projects on current page.'));
      return;
    }

    const unanalyzed = pageRepos.filter(
      (r: DiscoveryRepo) => !r.analyzed_at || r.analysis_failed
    );
    
    if (unanalyzed.length === 0) {
      alert(t('当前页面所有项目已完成AI分析。', 'All projects on current page have been analyzed.'));
      return;
    }

    setIsAnalyzing(true);
    setAnalysisState({ paused: false, aborted: false });
    const allCategories = useAppStore
      .getState()
      .customCategories.map(c => c.name);
    const categoryNames = [
      ...allCategories,
      '全部分类', 'Web应用', '移动应用', '桌面应用', '数据库',
      'AI/机器学习', '开发工具', '安全工具', '游戏', '设计工具',
      '效率工具', '教育学习', '社交网络', '数据分析',
    ];

    const githubApi = new GitHubApiService(githubToken);
    const aiService = new AIService(activeConfig, language);
    const optimizer = new AIAnalysisOptimizer({
      initialConcurrency: activeConfig.concurrency || 3,
    });
    setAnalysisOptimizer(optimizer);

    setAnalysisProgress({ current: 0, total: unanalyzed.length });

    try {
      const readmeCache = await optimizer.prefetchReadmes(unanalyzed, githubApi);
      if (optimizer.isAborted()) return;

      const results = await optimizer.analyzeRepositories(
        unanalyzed,
        readmeCache,
        aiService,
        categoryNames,
        (current: number, total: number) => {
          setAnalysisProgress({ current, total });
        },
        (result) => {
          if (result.success && result.repo) {
            const originalRepo = pageRepos.find(r => r.id === result.repo!.id);
            if (originalRepo) {
              const updatedRepo: DiscoveryRepo = {
                ...originalRepo,
                ai_summary: result.summary,
                ai_tags: result.tags,
                ai_platforms: result.platforms,
                analyzed_at: new Date().toISOString(),
                analysis_failed: false,
              };
              updateDiscoveryRepo(updatedRepo);
            }
          } else if (!result.success && result.repo) {
            const originalRepo = pageRepos.find(r => r.id === result.repo!.id);
            if (originalRepo) {
              const failedRepo: DiscoveryRepo = {
                ...originalRepo,
                analyzed_at: new Date().toISOString(),
                analysis_failed: true,
              };
              updateDiscoveryRepo(failedRepo);
            }
          }
        }
      );

      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;
      alert(
        t(
          `AI分析完成！成功 ${successCount} 个${failCount > 0 ? `，失败 ${failCount} 个` : ''}`,
          `AI analysis complete! ${successCount} succeeded${failCount > 0 ? `, ${failCount} failed` : ''}`
        )
      );
    } catch (err) {
      console.error('AI analysis error:', err);
      alert(t('AI分析失败，请检查AI配置。', 'AI analysis failed. Please check your AI configuration.'));
    } finally {
      setIsAnalyzing(false);
      setAnalysisOptimizer(null);
      setAnalysisProgress({ current: 0, total: 0 });
    }
  }, [githubToken, aiConfigs, activeAIConfig, language, currentPageRepos, t, updateDiscoveryRepo, setAnalysisProgress]);



  const handleAbortAnalysis = useCallback(() => {
    analysisOptimizer?.abort();
    setAnalysisState(prev => ({ ...prev, aborted: true }));
  }, [analysisOptimizer]);

  const isAnalyzingThisChannel = isAnalyzing && (
    analysisProgress.total > 0
  );

  const handleSearch = useCallback(() => {
    if (selectedDiscoveryChannel === 'search') {
      setDiscoverySearchQuery(searchInput);
      refreshChannel('search', 1, false);
    }
  }, [selectedDiscoveryChannel, searchInput, setDiscoverySearchQuery, refreshChannel]);

  const handlePageChange = useCallback((page: number) => {
    console.log(`[Discovery] Page change requested: ${selectedDiscoveryChannel} -> page ${page}`);

    const validPage = Math.max(1, page);

    if (validPage === currentPage) {
      console.log(`[Discovery] Same page, skipping`);
      return;
    }

    setDiscoveryCurrentPage(selectedDiscoveryChannel, validPage);

    if (currentIsLoading) {
      console.log(`[Discovery] Currently loading, page will refresh after current load`);
      return;
    }

    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
    window.scrollTo(0, 0);
    discoveryScrollPositionsRef.current[selectedDiscoveryChannel] = 0;
    setDiscoveryScrollPosition(selectedDiscoveryChannel, 0);
    setIsToolbarVisible(true);

    console.log(`[Discovery] Triggering refresh for page ${validPage}`);
    refreshChannel(selectedDiscoveryChannel, validPage, false);
  }, [currentPage, currentIsLoading, selectedDiscoveryChannel, setDiscoveryCurrentPage, refreshChannel, setDiscoveryScrollPosition]);

  const refreshAll = useCallback(async () => {
    const enabledChannels = discoveryChannels.filter(ch => ch.enabled);
    for (const channel of enabledChannels) {
      await refreshChannel(channel.id, 1, false);
    }
  }, [discoveryChannels, refreshChannel]);

  const mobileChannels = useMemo(() => {
    return discoveryChannels
      .filter(ch => ch.enabled)
      .map(ch => ({
        ...ch,
        icon: discoveryChannelIconMap[ch.icon] || <Crown className="w-4 h-4" />,
      }));
  }, [discoveryChannels]);

  return (
    <div className="h-full flex flex-col">
      {/* Mobile Tab Navigation */}
      <MobileTabNav
        channels={mobileChannels}
        selectedChannel={selectedDiscoveryChannel}
        onChannelSelect={(channel) => {
          // 保存当前频道的滚动位置到 ref 和 state
          if (scrollContainerRef.current) {
            const scrollTop = scrollContainerRef.current.scrollTop;
            discoveryScrollPositionsRef.current[selectedDiscoveryChannel] = scrollTop;
            setDiscoveryScrollPosition(selectedDiscoveryChannel, scrollTop);
          }
          setSelectedDiscoveryChannel(channel);
          setDiscoveryCurrentPage(channel, 1);
        }}
        language={language}
      />

      <div className="flex flex-col gap-4 lg:flex-row lg:gap-6 flex-1 min-h-0">
        <div className="hidden lg:block w-full lg:w-64 shrink-0 lg:sticky lg:top-4 lg:self-start">
          <DiscoverySidebar
            channels={discoveryChannels}
            selectedChannel={selectedDiscoveryChannel}
            onChannelSelect={(channel) => {
              // 保存当前频道的滚动位置到 ref 和 state
              if (scrollContainerRef.current) {
                const scrollTop = scrollContainerRef.current.scrollTop;
                discoveryScrollPositionsRef.current[selectedDiscoveryChannel] = scrollTop;
                setDiscoveryScrollPosition(selectedDiscoveryChannel, scrollTop);
              }
              setSelectedDiscoveryChannel(channel);
              setDiscoveryCurrentPage(channel, 1);
            }}
            onRefreshAll={refreshAll}
            isLoading={discoveryIsLoading}
            lastRefresh={discoveryLastRefresh}
            isAnalyzing={isAnalyzing}
            language={language}
          />
        </div>

        <div className="flex-1 flex flex-col min-h-0 relative">
          {/* 顶部工具栏 - 随滚动显示/隐藏 */}
          <div 
            className={`flex-shrink-0 transition-transform duration-300 ease-in-out z-10 ${
              isToolbarVisible ? 'translate-y-0' : '-translate-y-full opacity-0 pointer-events-none'
            }`}
          >
            <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl rounded-2xl border border-gray-200/60 dark:border-gray-700/60 p-3.5 sm:p-4 mb-4 shadow-sm shadow-gray-200/50 dark:shadow-gray-900/20">
              {/* 第一行：标题和刷新按钮 */}
              <div className="flex items-center justify-between gap-2 mb-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${currentChannelStyle.gradient} flex items-center justify-center shadow-md ${currentChannelStyle.shadow}`}>
                    {currentChannelIconNode}
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-base sm:text-lg font-bold text-gray-900 dark:text-white truncate leading-tight">
                      {language === 'zh'
                        ? discoveryChannels.find(ch => ch.id === selectedDiscoveryChannel)?.name
                        : discoveryChannels.find(ch => ch.id === selectedDiscoveryChannel)?.nameEn}
                    </h2>
                    {currentLastRefresh && (
                      <p className="text-[11px] text-gray-400 dark:text-gray-500 hidden sm:block">
                        {t('更新于', 'Updated')} {formatLastRefresh(currentLastRefresh)}
                      </p>
                    )}
                  </div>
                </div>
                <div className="relative group/refresh shrink-0">
                  <button
                    onClick={() => refreshChannel(selectedDiscoveryChannel, 1, false)}
                    disabled={currentIsLoading || isAnalyzing}
                    className="p-2 rounded-xl bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-blue-100 dark:hover:bg-blue-900/40 hover:text-blue-600 dark:hover:text-blue-400 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                    title={t('刷新', 'Refresh')}
                  >
                    <RefreshCw className={`w-4 h-4 ${currentIsLoading ? 'animate-spin' : ''}`} />
                  </button>
                  {selectedDiscoveryChannel === 'hot-release' && (
                    <div className="absolute top-full mt-2 right-0 z-50 opacity-0 group-hover/refresh:opacity-100 translate-y-1 group-hover/refresh:translate-y-0 transition-all duration-200 pointer-events-none">
                      <div className="bg-gray-900 dark:bg-gray-700 text-white text-xs rounded-lg px-3 py-2 whitespace-nowrap shadow-lg">
                        {t('每次刷新都能看到不一样的内容', 'Each refresh shows different content')}
                      </div>
                      <div className="absolute -top-1 right-3 w-2 h-2 bg-gray-900 dark:bg-gray-700 rotate-45" />
                    </div>
                  )}
                </div>
              </div>
              
              {/* 第二行：筛选和操作按钮 */}
              <div className="flex items-center gap-2 flex-wrap">
                {selectedDiscoveryChannel === 'topic' && (
                  <select
                    value={discoverySelectedTopic || ''}
                    onChange={(e) => setDiscoverySelectedTopic(e.target.value as TopicCategory | null)}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-gray-100/80 text-gray-700 dark:bg-gray-700/80 dark:text-gray-300 border border-gray-200 dark:border-gray-600 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                  >
                    <option value="">{t('主题', 'Topic')}</option>
                    <option value="ai">{t('人工智能', 'AI')}</option>
                    <option value="ml">{t('机器学习', 'ML')}</option>
                    <option value="database">{t('数据库', 'DB')}</option>
                    <option value="web">{t('Web开发', 'Web')}</option>
                    <option value="mobile">{t('移动开发', 'Mobile')}</option>
                    <option value="devtools">{t('开发工具', 'DevTools')}</option>
                    <option value="security">{t('安全', 'Security')}</option>
                    <option value="game">{t('游戏', 'Game')}</option>
                  </select>
                )}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <PlatformFilter 
                    platform={discoveryPlatform} 
                    onPlatformChange={setDiscoveryPlatform} 
                    language={language}
                  />
                  <SortAlgorithmTooltip 
                    channelId={selectedDiscoveryChannel} 
                    language={language} 
                  />
                  {isAnalyzingThisChannel ? (
                    <div className="flex items-center gap-1">
                      <div className="relative">
                        <div className="px-2 py-1.5 rounded-lg bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300 flex items-center gap-1.5 overflow-hidden">
                          <div 
                            className="absolute left-0 top-0 h-full bg-gradient-to-r from-purple-300/70 via-purple-400/70 to-purple-300/70 dark:from-purple-700/70 dark:via-purple-600/70 dark:to-purple-700/70 transition-all duration-400 ease-out"
                            style={{
                              width: analysisProgress.total > 0
                                ? `${Math.min((analysisProgress.current / analysisProgress.total) * 100, 100)}%`
                                : '0%',
                            }}
                          />
                          <div className="relative flex items-center gap-1.5 z-10">
                            <Bot className="w-4 h-4" />
                            <span className="text-xs font-medium">
                              {analysisProgress.current}/{analysisProgress.total}
                            </span>
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={handleAbortAnalysis}
                        className="p-1.5 rounded-lg bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-800 transition-colors"
                        title={t('停止', 'Stop')}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={handleAnalyzePage}
                      disabled={isAnalyzing || currentIsLoading}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title={t('AI分析当前页', 'Analyze current page with AI')}
                    >
                      <Bot className="w-4 h-4" />
                      <span className="hidden sm:inline">{t('AI分析', 'AI Analyze')}</span>
                    </button>
                  )}
                  <CompactPagination
                    currentPage={currentPage}
                    totalPages={totalPages}
                    onPageChange={handlePageChange}
                    language={language}
                    totalCount={currentTotalCount || allRepos.length}
                    isLoading={currentIsLoading}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* 可滚动内容区域 */}
          <div 
            ref={scrollContainerRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto space-y-4 pr-2"
          >
            {selectedDiscoveryChannel === 'search' && (
              <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl rounded-2xl border border-gray-200/60 dark:border-gray-700/60 p-5 space-y-4 shadow-sm shadow-gray-200/50 dark:shadow-gray-900/20">
                <div className="flex gap-3">
                  <div className="flex-1 relative">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
                    <input
                      type="text"
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                      placeholder={t('搜索仓库...', 'Search repositories...')}
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/80 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all placeholder:text-gray-400 dark:placeholder:text-gray-500"
                    />
                  </div>
                  <button
                    onClick={handleSearch}
                    disabled={!searchInput.trim() || currentIsLoading}
                    className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 text-white hover:from-blue-600 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-blue-500/25 hover:shadow-lg hover:shadow-blue-500/30 transition-all duration-200 flex items-center gap-2 font-medium"
                  >
                    <Search className="w-4 h-4" />
                    <span className="hidden sm:inline">{t('搜索', 'Search')}</span>
                  </button>
                </div>
                
                <div className="flex flex-wrap gap-2.5">
                  <select
                    value={discoveryLanguage}
                    onChange={(e) => setDiscoveryLanguage(e.target.value as ProgrammingLanguage)}
                    className="px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-600 bg-white/80 dark:bg-gray-700/80 text-gray-700 dark:text-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                  >
                    <option value="All">{t('所有语言', 'All Languages')}</option>
                    <option value="JavaScript">JavaScript</option>
                    <option value="TypeScript">TypeScript</option>
                    <option value="Python">Python</option>
                    <option value="Java">Java</option>
                    <option value="Kotlin">Kotlin</option>
                    <option value="Go">Go</option>
                    <option value="Rust">Rust</option>
                    <option value="CSharp">C#</option>
                    <option value="CPlusPlus">C++</option>
                    <option value="C">C</option>
                    <option value="Swift">Swift</option>
                    <option value="Dart">Dart</option>
                    <option value="Ruby">Ruby</option>
                    <option value="PHP">PHP</option>
                  </select>
                  
                  <select
                    value={discoverySortBy}
                    onChange={(e) => setDiscoverySortBy(e.target.value as SortBy)}
                    className="px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-600 bg-white/80 dark:bg-gray-700/80 text-gray-700 dark:text-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                  >
                    <option value="BestMatch">{t('最佳匹配', 'Best Match')}</option>
                    <option value="MostStars">{t('最多Star', 'Most Stars')}</option>
                    <option value="MostForks">{t('最多Fork', 'Most Forks')}</option>
                  </select>
                  
                  <select
                    value={discoverySortOrder}
                    onChange={(e) => setDiscoverySortOrder(e.target.value as SortOrder)}
                    className="px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-600 bg-white/80 dark:bg-gray-700/80 text-gray-700 dark:text-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                  >
                    <option value="Descending">{t('降序', 'Descending')}</option>
                    <option value="Ascending">{t('升序', 'Ascending')}</option>
                  </select>
                  
                  <select
                    value={discoveryPlatform}
                    onChange={(e) => setDiscoveryPlatform(e.target.value as DiscoveryPlatform)}
                    className="px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-600 bg-white/80 dark:bg-gray-700/80 text-gray-700 dark:text-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                  >
                    <option value="All">{t('所有平台', 'All Platforms')}</option>
                    <option value="Android">Android</option>
                    <option value="Macos">macOS</option>
                    <option value="Windows">Windows</option>
                    <option value="Linux">Linux</option>
                  </select>
                </div>
              </div>
            )}

            {currentIsLoading && allRepos.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 gap-4">
                <div className="relative">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-100 to-indigo-100 dark:from-blue-900/30 dark:to-indigo-900/30 flex items-center justify-center">
                    <Loader2 className="w-7 h-7 animate-spin text-blue-500" />
                  </div>
                  <div className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 rounded-full animate-ping opacity-75" />
                </div>
                <div className="text-center space-y-1.5">
                  <p className="text-gray-700 dark:text-gray-300 font-medium text-sm">
                    {t('正在获取数据...', 'Fetching data...')}
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500">
                    {t('GitHub API 响应中', 'Waiting for GitHub API response')}
                  </p>
                </div>
              </div>
            )}

            {!currentIsLoading && allRepos.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 gap-5 text-center">
                <div className={`w-20 h-20 rounded-3xl bg-gradient-to-br ${currentChannelStyle.gradient} flex items-center justify-center shadow-md ${currentChannelStyle.shadow}`}>
                  {currentChannelStyle.largeIcon}
                </div>
                <div className="space-y-2 max-w-xs">
                  <p className="text-gray-600 dark:text-gray-400 font-medium text-base">
                    {t('暂无数据', 'No data yet')}
                  </p>
                  <p className="text-sm text-gray-400 dark:text-gray-500 leading-relaxed">
                    {t('点击刷新按钮获取最新排行数据', 'Click refresh to fetch latest rankings')}
                  </p>
                </div>
                <button
                  onClick={() => refreshChannel(selectedDiscoveryChannel, 1, false)}
                  disabled={currentIsLoading}
                  className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 text-white hover:from-blue-600 hover:to-indigo-700 shadow-md shadow-blue-500/25 hover:shadow-lg transition-all duration-200 flex items-center gap-2 text-sm font-medium"
                >
                  <RefreshCw className={`w-4 h-4 ${currentIsLoading ? 'animate-spin' : ''}`} />
                  {currentIsLoading ? t('加载中...', 'Loading...') : t('立即刷新', 'Refresh Now')}
                </button>
              </div>
            )}

            <div className="space-y-4">
              {currentPageRepos.map(repo => (
                <SubscriptionRepoCard key={repo.id} repo={repo} />
              ))}
            </div>

            {/* Page Info */}
            {allRepos.length > 0 && (
              <div className="flex items-center justify-between py-3.5 px-5 bg-gradient-to-r from-gray-50 to-slate-50 dark:from-gray-800/60 dark:to-slate-800/40 rounded-xl border border-gray-100 dark:border-gray-700/50 text-sm">
                <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                  <span>
                    {t('共', 'Total')} <strong className="text-gray-900 dark:text-white">{currentTotalCount || allRepos.length}</strong> {t('个项目', 'items')}
                    {totalPages > 1 && (
                      <> · {t('第', 'Page')} <strong>{currentPage}/{totalPages}</strong> {t('页', 'pages')}</>
                    )}
                  </span>
                </div>
                {currentHasMore && (
                  <div className="flex items-center gap-1.5 text-blue-500 text-xs font-medium bg-blue-50 dark:bg-blue-900/20 px-2.5 py-1 rounded-lg">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                    {t('还有更多', 'More available')}
                  </div>
                )}
              </div>
            )}

            {/* Pagination */}
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={handlePageChange}
              language={language}
              isLoading={currentIsLoading}
            />
          </div>

          {/* 滚动到底部按钮 */}
          <ScrollToBottom scrollContainerRef={scrollContainerRef} />
        </div>
      </div>
    </div>
  );
});

DiscoveryView.displayName = 'DiscoveryView';
