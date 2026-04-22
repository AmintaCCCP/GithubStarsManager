import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { 
  RefreshCw, 
  TrendingUp, 
  Bot, 
  Loader2, 
  Star, 
  Rocket, 
  Tag, 
  Search,
  Filter,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Monitor,
  Apple,
  Terminal,
  Smartphone,
  Globe
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { GitHubApiService } from '../services/githubApi';
import { AIService } from '../services/aiService';
import { AIAnalysisOptimizer } from '../services/aiAnalysisOptimizer';
import { DiscoverySidebar } from './DiscoverySidebar';
import { SubscriptionRepoCard } from './SubscriptionRepoCard';
import { SortAlgorithmTooltip } from './SortAlgorithmTooltip';
import type { 
  DiscoveryChannelId, 
  DiscoveryRepo, 
  DiscoveryPlatform, 
  ProgrammingLanguage,
  SortBy,
  SortOrder,
  TopicCategory 
} from '../types';

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
        <span className="hidden sm:inline">{language === 'zh' ? selectedPlatform?.name : selectedPlatform?.nameEn}</span>
        <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-lg py-1 z-50">
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

// Pagination Component
interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  language: 'zh' | 'en';
}

const Pagination: React.FC<PaginationProps> = ({ currentPage, totalPages, onPageChange, language }) => {
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  const [inputPage, setInputPage] = useState<string>(currentPage.toString());
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 同步外部页码变化到输入框
  useEffect(() => {
    if (!isEditing) {
      setInputPage(currentPage.toString());
    }
  }, [currentPage, isEditing]);

  // 聚焦输入框
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
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
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    // 只允许数字
    if (value === '' || /^\d*$/.test(value)) {
      setInputPage(value);
    }
  };

  const handleInputSubmit = () => {
    const pageNum = parseInt(inputPage, 10);
    if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= totalPages) {
      onPageChange(pageNum);
    } else {
      // 无效输入，重置为当前页
      setInputPage(currentPage.toString());
    }
    setIsEditing(false);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleInputSubmit();
    } else if (e.key === 'Escape') {
      setInputPage(currentPage.toString());
      setIsEditing(false);
    }
  };

  const handleInputBlur = () => {
    handleInputSubmit();
  };

  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-center gap-2 py-4 flex-wrap">
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
        className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
        {t('上一页', 'Prev')}
      </button>

      <div className="flex items-center gap-1">
        {getPageNumbers().map((page, index) => (
          <React.Fragment key={index}>
            {page === '...' ? (
              <span className="px-2 text-gray-400">...</span>
            ) : (
              <button
                onClick={() => onPageChange(page as number)}
                className={`min-w-[36px] px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  currentPage === page
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                {page}
              </button>
            )}
          </React.Fragment>
        ))}
      </div>

      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {t('下一页', 'Next')}
        <ChevronRight className="w-4 h-4" />
      </button>

      {/* 可编辑页码跳转 */}
      <div className="flex items-center gap-2 ml-2 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
        <span className="text-sm text-gray-500 dark:text-gray-400">{t('跳转到', 'Go to')}</span>
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={inputPage}
            onChange={handleInputChange}
            onKeyDown={handleInputKeyDown}
            onBlur={handleInputBlur}
            className="w-12 px-2 py-1 text-sm text-center border border-blue-500 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white dark:border-blue-400"
          />
        ) : (
          <button
            onClick={() => setIsEditing(true)}
            className="w-12 px-2 py-1 text-sm text-center bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded hover:border-blue-500 dark:hover:border-blue-400 transition-colors dark:text-white"
            title={t('点击编辑页码', 'Click to edit page')}
          >
            {currentPage}
          </button>
        )}
        <span className="text-sm text-gray-500 dark:text-gray-400">/ {totalPages}</span>
      </div>
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
    discoveryNextPage,
    setDiscoveryNextPage,
    discoveryTotalCount,
    setDiscoveryTotalCount,
    discoveryScrollPositions,
    setDiscoveryScrollPosition,
    appendDiscoveryRepos,
  } = useAppStore();

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisOptimizer, setAnalysisOptimizer] = useState<AIAnalysisOptimizer | null>(null);
  const [searchInput, setSearchInput] = useState(discoverySearchQuery);
  
  // 当前页码状态（从1开始）
  const [currentPage, setCurrentPage] = useState(1);

  // 滚动容器引用
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // 工具栏显示状态
  const [isToolbarVisible, setIsToolbarVisible] = useState(true);
  const lastScrollY = useRef(0);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const t = useCallback((zh: string, en: string) => language === 'zh' ? zh : en, [language]);

  const ITEMS_PER_PAGE = 20;

  // 获取当前频道的所有仓库
  const allRepos = useMemo(
    () => (discoveryRepos && discoveryRepos[selectedDiscoveryChannel]) || [],
    [discoveryRepos, selectedDiscoveryChannel]
  );

  // 从 store 获取当前频道的总数量
  const currentTotalCount = discoveryTotalCount?.[selectedDiscoveryChannel] ?? 0;

  // 计算总页数（基于 API 返回的总数量，而不是已加载的数据长度）
  const totalPages = useMemo(() => {
    return Math.ceil(currentTotalCount / ITEMS_PER_PAGE);
  }, [currentTotalCount]);

  // 获取当前页显示的仓库
  const currentPageRepos = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    return allRepos.slice(startIndex, endIndex);
  }, [allRepos, currentPage]);

  const currentLastRefresh = discoveryLastRefresh?.[selectedDiscoveryChannel] ?? null;
  const currentIsLoading = discoveryIsLoading?.[selectedDiscoveryChannel] ?? false;
  const currentHasMore = discoveryHasMore?.[selectedDiscoveryChannel] ?? false;
  const currentNextPage = discoveryNextPage?.[selectedDiscoveryChannel] ?? 1;

  // 切换频道时重置页码并恢复滚动位置
  useEffect(() => {
    setCurrentPage(1);
    // 恢复当前频道的滚动位置
    if (scrollContainerRef.current) {
      const savedPosition = discoveryScrollPositions[selectedDiscoveryChannel] || 0;
      scrollContainerRef.current.scrollTop = savedPosition;
    }
  }, [selectedDiscoveryChannel, discoveryScrollPositions]);

  // 主题改变时刷新数据
  useEffect(() => {
    if (selectedDiscoveryChannel === 'topic' && discoverySelectedTopic) {
      refreshChannel('topic', 1, false);
    }
  }, [discoverySelectedTopic, selectedDiscoveryChannel]);

  const refreshChannel = useCallback(async (channelId: DiscoveryChannelId, page: number = 1, append: boolean = false) => {
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
            result = { repos: [], hasMore: false, nextPageIndex: page + 1, totalCount: 0 };
          }
          break;
        default:
          result = { repos: [], hasMore: false, nextPageIndex: page + 1, totalCount: 0 };
      }

      // 合并AI分析结果（如果仓库之前被分析过）
      const mergedRepos = result.repos.map((newRepo: DiscoveryRepo) => {
        const existingRepo = allRepos.find(r => r.id === newRepo.id);
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
    } catch (error) {
      console.error(`Failed to refresh channel ${channelId}:`, error);
      alert(t('获取数据失败，请检查网络连接或GitHub Token。', 'Failed to fetch data. Please check your network connection or GitHub Token.'));
    } finally {
      setDiscoveryLoading(channelId, false);
    }
  }, [githubToken, t, setDiscoveryLoading, setDiscoveryRepos, setDiscoveryLastRefresh, discoveryPlatform, discoveryLanguage, discoverySortBy, discoverySortOrder, discoverySearchQuery, discoverySelectedTopic, setDiscoveryHasMore, setDiscoveryNextPage, setDiscoveryTotalCount, appendDiscoveryRepos, allRepos]);

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

    // 保存当前频道的滚动位置
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
            const updatedRepo: DiscoveryRepo = {
              ...result.repo,
              rank: 0,
              channel: selectedDiscoveryChannel,
              platform: discoveryPlatform,
              ai_summary: result.summary,
              ai_tags: result.tags,
              ai_platforms: result.platforms,
              analyzed_at: new Date().toISOString(),
              analysis_failed: false,
            };
            updateDiscoveryRepo(updatedRepo);
          } else if (!result.success && result.repo) {
            const failedRepo: DiscoveryRepo = {
              ...result.repo,
              rank: 0,
              channel: selectedDiscoveryChannel,
              platform: discoveryPlatform,
              analyzed_at: new Date().toISOString(),
              analysis_failed: true,
            };
            updateDiscoveryRepo(failedRepo);
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

  const handlePauseAnalysis = useCallback(() => {
    analysisOptimizer?.pause();
  }, [analysisOptimizer]);

  const handleResumeAnalysis = useCallback(() => {
    analysisOptimizer?.resume();
  }, [analysisOptimizer]);

  const handleAbortAnalysis = useCallback(() => {
    analysisOptimizer?.abort();
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
    setCurrentPage(page);
    
    // 如果目标页的数据还没有加载，先加载数据
    const requiredItems = page * ITEMS_PER_PAGE;
    if (allRepos.length < requiredItems && currentHasMore && !currentIsLoading) {
      refreshChannel(selectedDiscoveryChannel, currentNextPage, true);
    }
  }, [allRepos.length, currentHasMore, currentIsLoading, currentNextPage, refreshChannel, selectedDiscoveryChannel]);

  const refreshAll = useCallback(async () => {
    const enabledChannels = discoveryChannels.filter(ch => ch.enabled);
    for (const channel of enabledChannels) {
      await refreshChannel(channel.id, 1, false);
    }
  }, [discoveryChannels, refreshChannel]);

  const mobileChannels = useMemo(() => {
    return discoveryChannels
      .filter(ch => ch.enabled)
      .map(ch => {
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
  }, [discoveryChannels]);

  return (
    <div className="h-full flex flex-col">
      {/* Mobile Tab Navigation */}
      <MobileTabNav
        channels={mobileChannels}
        selectedChannel={selectedDiscoveryChannel}
        onChannelSelect={(channel) => {
          // 保存当前频道的滚动位置
          if (scrollContainerRef.current) {
            setDiscoveryScrollPosition(selectedDiscoveryChannel, scrollContainerRef.current.scrollTop);
          }
          setSelectedDiscoveryChannel(channel);
          setCurrentPage(1);
        }}
        language={language}
      />

      <div className="flex flex-col gap-4 lg:flex-row lg:gap-6 flex-1 min-h-0">
        <div className="hidden lg:block w-full lg:w-64 shrink-0 lg:sticky lg:top-4 lg:self-start">
          <DiscoverySidebar
            channels={discoveryChannels}
            selectedChannel={selectedDiscoveryChannel}
            onChannelSelect={(channel) => {
              // 保存当前频道的滚动位置
              if (scrollContainerRef.current) {
                setDiscoveryScrollPosition(selectedDiscoveryChannel, scrollContainerRef.current.scrollTop);
              }
              setSelectedDiscoveryChannel(channel);
              setCurrentPage(1);
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
            <div className="flex items-center justify-between bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-4">
              <div className="flex items-center gap-3">
                <TrendingUp className="w-5 h-5 text-blue-500" />
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {discoveryChannels.find(ch => ch.id === selectedDiscoveryChannel)?.icon}{' '}
                  {language === 'zh'
                    ? discoveryChannels.find(ch => ch.id === selectedDiscoveryChannel)?.name
                    : discoveryChannels.find(ch => ch.id === selectedDiscoveryChannel)?.nameEn}
                </h2>
                {/* Sort Algorithm Tooltip */}
                <SortAlgorithmTooltip 
                  channelId={selectedDiscoveryChannel} 
                  language={language} 
                />
                {currentLastRefresh && (
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    {t('更新于', 'Updated')} {formatLastRefresh(currentLastRefresh)}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {selectedDiscoveryChannel === 'topic' && (
                  <select
                    value={discoverySelectedTopic || ''}
                    onChange={(e) => setDiscoverySelectedTopic(e.target.value as TopicCategory | null)}
                    className="px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="">{t('选择主题', 'Select Topic')}</option>
                    <option value="ai">{t('人工智能', 'AI')}</option>
                    <option value="ml">{t('机器学习', 'Machine Learning')}</option>
                    <option value="database">{t('数据库', 'Database')}</option>
                    <option value="web">{t('Web开发', 'Web Development')}</option>
                    <option value="mobile">{t('移动开发', 'Mobile Development')}</option>
                    <option value="devtools">{t('开发工具', 'DevTools')}</option>
                    <option value="security">{t('安全', 'Security')}</option>
                    <option value="game">{t('游戏', 'Game')}</option>
                  </select>
                )}
                <PlatformFilter 
                  platform={discoveryPlatform} 
                  onPlatformChange={setDiscoveryPlatform} 
                  language={language}
                />
                {isAnalyzingThisChannel && (
                  <div className="flex items-center gap-2 mr-2">
                    <div className="w-48 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                      <div
                        className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                        style={{
                          width: analysisProgress.total > 0
                            ? `${(analysisProgress.current / analysisProgress.total) * 100}%`
                            : '0%',
                        }}
                      />
                    </div>
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      {analysisProgress.current}/{analysisProgress.total}
                    </span>
                    {analysisOptimizer && !analysisOptimizer.isPaused() && (
                      <button
                        onClick={handlePauseAnalysis}
                        className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                        title={t('暂停', 'Pause')}
                      >
                        <Loader2 className="w-4 h-4 animate-spin" />
                      </button>
                    )}
                    {analysisOptimizer && analysisOptimizer.isPaused() && (
                      <button
                        onClick={handleResumeAnalysis}
                        className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                        title={t('继续', 'Resume')}
                      >
                        <RefreshCw className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={handleAbortAnalysis}
                      className="p-1 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30"
                      title={t('停止', 'Stop')}
                    >
                      ✕
                    </button>
                  </div>
                )}
                <button
                  onClick={handleAnalyzePage}
                  disabled={isAnalyzing || currentIsLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title={t('AI分析当前页', 'Analyze current page with AI')}
                >
                  <Bot className="w-4 h-4" />
                  {t('AI分析本页', 'AI Analyze Page')}
                </button>
                <button
                  onClick={() => refreshChannel(selectedDiscoveryChannel, 1, false)}
                  disabled={currentIsLoading || isAnalyzing}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <RefreshCw className={`w-4 h-4 ${currentIsLoading ? 'animate-spin' : ''}`} />
                  {t('刷新', 'Refresh')}
                </button>
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
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    placeholder={t('搜索仓库...', 'Search repositories...')}
                    className="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <button
                    onClick={handleSearch}
                    disabled={!searchInput.trim() || currentIsLoading}
                    className="px-4 py-2 rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Search className="w-4 h-4" />
                  </button>
                </div>
                
                <div className="flex flex-wrap gap-2">
                  <select
                    value={discoveryLanguage}
                    onChange={(e) => setDiscoveryLanguage(e.target.value as ProgrammingLanguage)}
                    className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
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
                    className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="BestMatch">{t('最佳匹配', 'Best Match')}</option>
                    <option value="MostStars">{t('最多Star', 'Most Stars')}</option>
                    <option value="MostForks">{t('最多Fork', 'Most Forks')}</option>
                  </select>
                  
                  <select
                    value={discoverySortOrder}
                    onChange={(e) => setDiscoverySortOrder(e.target.value as SortOrder)}
                    className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="Descending">{t('降序', 'Descending')}</option>
                    <option value="Ascending">{t('升序', 'Ascending')}</option>
                  </select>
                  
                  <select
                    value={discoveryPlatform}
                    onChange={(e) => setDiscoveryPlatform(e.target.value as DiscoveryPlatform)}
                    className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="All">{t('所有平台', 'All Platforms')}</option>
                    <option value="iOS">iOS</option>
                    <option value="Android">Android</option>
                    <option value="Web">Web</option>
                    <option value="Desktop">Desktop</option>
                    <option value="CrossPlatform">{t('跨平台', 'Cross Platform')}</option>
                  </select>
                </div>
              </div>
            )}

            {currentIsLoading && allRepos.length === 0 && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-blue-500 mr-2" />
                <span className="text-gray-500 dark:text-gray-400">
                  {t('加载中...', 'Loading...')}
                </span>
              </div>
            )}

            {!currentIsLoading && allRepos.length === 0 && (
              <div className="text-center py-12">
                <TrendingUp className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                <p className="text-gray-500 dark:text-gray-400 mb-2">
                  {t('暂无数据，点击刷新按钮获取排行', 'No data yet. Click refresh to fetch rankings.')}
                </p>
              </div>
            )}

            <div className="space-y-4">
              {currentPageRepos.map(repo => (
                <SubscriptionRepoCard key={repo.id} repo={repo} />
              ))}
            </div>

            {/* Page Info */}
            {allRepos.length > 0 && (
              <div className="flex items-center justify-between py-3 px-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg text-sm text-gray-600 dark:text-gray-400">
                <span>
                  {t('共', 'Total')} {allRepos.length} {t('个项目', 'items')}，
                  {t('第', 'Page')} {currentPage}/{totalPages} {t('页', 'pages')}
                </span>
                {currentHasMore && (
                  <span className="text-blue-500">
                    {t('还有更多数据可加载', 'More data available')}
                  </span>
                )}
              </div>
            )}

            {/* Pagination */}
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={handlePageChange}
              language={language}
            />

            {/* Load More Button */}
            {currentHasMore && (
              <div className="flex justify-center py-2">
                <button
                  onClick={() => refreshChannel(selectedDiscoveryChannel, currentNextPage, true)}
                  disabled={currentIsLoading}
                  className="px-6 py-2 rounded-lg bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {currentIsLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                      {t('加载中...', 'Loading...')}
                    </>
                  ) : (
                    t('加载更多数据', 'Load More Data')
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

DiscoveryView.displayName = 'DiscoveryView';
