import { Button } from './ui/button';
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
  Monitor,
  Apple,
  Terminal,
  Smartphone,
  Globe,
  X,
  Calendar
} from 'lucide-react';
import { useAppStore, getAllCategories } from '../store/useAppStore';
import { GitHubApiService } from '../services/githubApi';
import { AIService } from '../services/aiService';
import { AIAnalysisOptimizer } from '../services/aiAnalysisOptimizer';
import { resolveCategoryAssignment, buildCategoryHints } from '../utils/categoryUtils';
import { discoveryAnalysisStorage } from '../services/discoveryAnalysisStorage';
import { DiscoverySidebar } from './DiscoverySidebar';
import { SubscriptionRepoCard } from './SubscriptionRepoCard';
import { SortAlgorithmTooltip } from './SortAlgorithmTooltip';
import { ScrollToBottom } from './ScrollToBottom';
import { useDialog } from '../hooks/useDialog';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import type {
  DiscoveryChannelId,
  DiscoveryChannelIcon,
  DiscoveryRepo,
  DiscoveryPlatform,
  ProgrammingLanguage,
  SortBy,
  SortOrder,
  TopicCategory,
  TrendingTimeRange
} from '../types';

const discoveryChannelIconMap: Record<DiscoveryChannelIcon, React.ReactNode> = {
  trending: <TrendingUp className="w-4 h-4 text-muted-foreground dark:text-muted-foreground" />,
  rocket: <Rocket className="w-4 h-4 text-muted-foreground dark:text-muted-foreground" />,
  star: <Crown className="w-4 h-4 text-muted-foreground dark:text-muted-foreground" />,
  tag: <Tag className="w-4 h-4 text-muted-foreground dark:text-muted-foreground" />,
  search: <Search className="w-4 h-4 text-muted-foreground dark:text-muted-foreground" />,
};

const discoveryChannelStyleMap: Record<DiscoveryChannelIcon, { gradient: string; shadow: string; largeIcon: React.ReactNode }> = {
  trending: {
    gradient: 'from-gray-200 to-gray-300 dark:from-gray-600 dark:to-gray-700',
    shadow: 'shadow-black/[0.08]',
    largeIcon: <TrendingUp className="w-9 h-9 text-muted-foreground dark:text-white" />,
  },
  rocket: {
    gradient: 'from-gray-200 to-gray-300 dark:from-gray-600 dark:to-gray-700',
    shadow: 'shadow-black/[0.08]',
    largeIcon: <Rocket className="w-9 h-9 text-muted-foreground dark:text-white" />,
  },
  star: {
    gradient: 'from-gray-200 to-gray-300 dark:from-gray-600 dark:to-gray-700',
    shadow: 'shadow-black/[0.08]',
    largeIcon: <Crown className="w-9 h-9 text-muted-foreground dark:text-white" />,
  },
  tag: {
    gradient: 'from-gray-200 to-gray-300 dark:from-gray-600 dark:to-gray-700',
    shadow: 'shadow-black/[0.08]',
    largeIcon: <Tag className="w-9 h-9 text-muted-foreground dark:text-white" />,
  },
  search: {
    gradient: 'from-gray-200 to-gray-300 dark:from-gray-600 dark:to-gray-700',
    shadow: 'shadow-black/[0.08]',
    largeIcon: <Search className="w-9 h-9 text-muted-foreground dark:text-white" />,
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
      className="relative w-full border-b border-border dark:border-border bg-background/95 dark:bg-card/95 backdrop-blur-sm lg:hidden"
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
          <Button
            key={channel.id}
            ref={(el) => {
              if (el) tabRefs.current.set(channel.id, el);
            }}
            onClick={() => onChannelSelect(channel.id)}
            variant="ghost"
            role="tab"
            aria-selected={selectedChannel === channel.id}
            className={`
              relative flex-shrink-0 px-4 py-2 rounded-lg text-sm font-medium snap-start
              transition-all duration-200 ease-out
              focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
              ${selectedChannel === channel.id
                ? 'text-muted-foreground dark:text-muted-foreground '
                : 'text-muted-foreground dark:text-muted-foreground hover:text-foreground dark:hover:text-gray-200 hover:bg-muted dark:hover:bg-accent'
              }
            `}
          >
            <span className="flex items-center gap-1.5 whitespace-nowrap">
              {channel.icon}
              {language === 'zh' ? channel.name : channel.nameEn}
            </span>
          </Button>
        ))}
      </div>
      
      {/* Active indicator */}
      <div
        className="absolute bottom-0 h-0.5 bg-primary rounded-full transition-transform duration-200 ease-out will-change-transform"
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
      <Button
        onClick={() => setIsOpen(!isOpen)}
        variant="ghost"
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-muted text-foreground dark:bg-muted/40 dark:text-muted-foreground hover:bg-accent dark:hover:bg-accent transition-colors"
      >
        <Filter className="w-4 h-4" />
        <span className="hidden xl:inline">{language === 'zh' ? selectedPlatform?.name : selectedPlatform?.nameEn}</span>
        <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </Button>

      {isOpen && (
        <div className="absolute left-0 sm:left-auto sm:right-0 mt-2 w-48 sm:w-48 bg-white dark:bg-card rounded-xl border border-border dark:border-border shadow-lg py-1 z-50 max-w-[calc(100vw-2rem)]">
          {platforms.map((p) => (
            <Button
              key={p.id}
              onClick={() => {
                onPlatformChange(p.id);
                setIsOpen(false);
              }}
              variant="ghost"
              className={`flex w-full items-center gap-2 px-4 py-2 text-sm transition-colors ${
                platform === p.id
                  ? 'bg-primary/15 text-primary dark:bg-primary/20 dark:text-primary-foreground'
                  : 'text-foreground dark:text-muted-foreground hover:bg-background dark:hover:bg-accent'
              }`}
            >
              {p.icon}
              {language === 'zh' ? p.name : p.nameEn}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
};

interface CustomSelectOption {
  value: string;
  label: string;
  icon?: React.ReactNode;
}

interface CustomSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: CustomSelectOption[];
  className?: string;
  dropdownClassName?: string;
}

const CustomSelect: React.FC<CustomSelectProps> = ({
  value,
  onChange,
  options,
  className = '',
  dropdownClassName = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find(o => o.value === value);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      <Button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        variant="outline"
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-white dark:bg-muted/40 border border-border dark:border-border text-foreground dark:text-muted-foreground hover:bg-accent dark:hover:bg-accent transition-colors ${className}`}
      >
        {selectedOption?.icon && <span className="w-4 h-4">{selectedOption.icon}</span>}
        <span>{selectedOption?.label}</span>
        <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </Button>

      {isOpen && (
        <div className={`absolute left-0 sm:left-auto sm:right-0 mt-2 w-48 sm:w-48 bg-white dark:bg-card rounded-xl border border-border dark:border-border shadow-lg py-1 z-50 max-w-[calc(100vw-2rem)] ${dropdownClassName}`}>
          {options.map((option) => (
            <Button
              key={option.value}
              type="button"
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
              variant="ghost"
              className={`flex w-full items-center gap-2 px-4 py-2 text-sm transition-colors ${
                value === option.value
                  ? 'bg-primary/15 text-primary dark:bg-primary/20 dark:text-primary-foreground'
                  : 'text-foreground dark:text-muted-foreground hover:bg-background dark:hover:bg-accent'
              }`}
            >
              {option.icon && <span className="w-4 h-4">{option.icon}</span>}
              {option.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
};

interface LoadMoreButtonProps {
  onLoadMore: () => void;
  isLoading: boolean;
  hasMore: boolean;
  totalCount: number;
  language: 'zh' | 'en';
}

const LoadMoreButton: React.FC<LoadMoreButtonProps> = ({
  onLoadMore,
  isLoading,
  hasMore,
  totalCount,
  language
}) => {
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

  if (!hasMore) {
    return (
      <div className="flex flex-col items-center gap-2 py-8">
        <div className="flex items-center gap-2 text-muted-foreground dark:text-muted-foreground">
          <div className="w-8 h-px bg-gray-300 dark:bg-muted/40" />
          <span className="text-sm">{t('已加载全部', 'All loaded')}</span>
          <div className="w-8 h-px bg-gray-300 dark:bg-muted/40" />
        </div>
        <span className="text-xs text-muted-foreground dark:text-muted-foreground">
          {t(`共 ${totalCount} 个项目`, `Total ${totalCount} items`)}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-stretch pt-2 pb-6">
      <Button
        onClick={onLoadMore}
        disabled={isLoading}
        className="w-full py-3.5 rounded-xl font-medium bg-muted dark:bg-muted/20 border border-border dark:border-border hover:bg-accent dark:hover:bg-accent text-foreground dark:text-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200 flex items-center justify-center gap-2"
      >
        {isLoading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin text-primary" />
            <span>{t('加载中...', 'Loading...')}</span>
          </>
        ) : (
          <>
            <RefreshCw className="w-4 h-4 text-muted-foreground dark:text-muted-foreground" />
            <span>{t('加载更多', 'Load More')}</span>
          </>
        )}
      </Button>
    </div>
  );
};


interface DataStatsProps {
  currentCount: number;
  totalCount: number;
  language: 'zh' | 'en';
}

const DataStats: React.FC<DataStatsProps> = ({ currentCount, totalCount, language }) => {
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground dark:text-muted-foreground">
      <div className="w-1.5 h-1.5 rounded-full bg-primary" />
      <span>
        {t('共', 'Total')} <strong className="text-foreground dark:text-foreground">{currentCount}</strong> {t('个项目', 'items')}
        {totalCount > 0 && currentCount < totalCount && (
          <span className="text-muted-foreground dark:text-muted-foreground">
            {' '}{t('（总计', '(total')} {totalCount} {t('个）', 'items)')}
          </span>
        )}
      </span>
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
    discoveryIsLoadingMore,
    discoveryLoadMoreError,
    selectedDiscoveryChannel,
    setSelectedDiscoveryChannel,
    setDiscoveryLoading,
    setDiscoveryLoadingMore,
    setDiscoveryLoadMoreError,
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
    setDiscoveryScrollPosition,
    appendDiscoveryRepos,
    trendingTimeRange,
    setTrendingTimeRange,
  } = useAppStore();

  const { toast } = useDialog();

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisOptimizer, setAnalysisOptimizer] = useState<AIAnalysisOptimizer | null>(null);
  const [, setAnalysisState] = useState<{ paused: boolean; aborted: boolean }>({ paused: false, aborted: false });
  const [searchInput, setSearchInput] = useState(discoverySearchQuery);
  
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  // 工具栏显示状态
  const [isToolbarVisible, setIsToolbarVisible] = useState(true);
  const lastScrollY = useRef(0);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 用于在频道切换时直接读取最新滚动位置，避免订阅整个 map 导致 effect 重跑
  const discoveryScrollPositionsRef = useRef<Record<string, number>>({});
  // 用于记录最近一次自动拉取的频道，防止空频道无限循环拉取
  const autoFetchChannelRef = useRef<string | null>(null);

  const t = useCallback((zh: string, en: string) => language === 'zh' ? zh : en, [language]);
  const isDesktopSafeMode = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return window.location.protocol === 'file:' || navigator.userAgent.includes('Electron');
  }, []);
  const safeDiscoveryChannels = useMemo(
    () => Array.isArray(discoveryChannels) ? discoveryChannels.filter(Boolean) : [],
    [discoveryChannels]
  );

  // 获取当前频道的所有仓库
  const allRepos = useMemo(
    () => (discoveryRepos && discoveryRepos[selectedDiscoveryChannel]) || [],
    [discoveryRepos, selectedDiscoveryChannel]
  );

  // 从 store 获取当前频道的总数量
  const currentTotalCount = discoveryTotalCount?.[selectedDiscoveryChannel] ?? 0;

  const currentLastRefresh = discoveryLastRefresh?.[selectedDiscoveryChannel] ?? null;
  const currentIsLoading = discoveryIsLoading?.[selectedDiscoveryChannel] ?? false;
  const currentIsLoadingMore = discoveryIsLoadingMore?.[selectedDiscoveryChannel] ?? false;
  const currentLoadMoreError = discoveryLoadMoreError?.[selectedDiscoveryChannel] ?? null;
  const currentChannel = safeDiscoveryChannels.find(ch => ch.id === selectedDiscoveryChannel);
  const currentChannelIcon = currentChannel?.icon || 'trending';
  const currentChannelStyle = discoveryChannelStyleMap[currentChannelIcon] || discoveryChannelStyleMap.trending;
  const currentChannelIconNode = discoveryChannelIconMap[currentChannelIcon] || discoveryChannelIconMap.trending;



  const refreshChannel = useCallback(async (channelId: DiscoveryChannelId, page: number = 1, append: boolean = false) => {
    if (!githubToken) {
      toast(t('GitHub Token 未找到，请重新登录。', 'GitHub token not found. Please login again.'), 'error');
      return;
    }

    if (append) {
      setDiscoveryLoadingMore(channelId, true);
      setDiscoveryLoadMoreError(channelId, null);
    } else {
      setDiscoveryLoading(channelId, true);
    }
    try {
      const githubApi = new GitHubApiService(githubToken);
      let result;

      switch (channelId) {
        case 'trending':
          result = await githubApi.getTrendingRepositories(discoveryPlatform, page, 20, trendingTimeRange);
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

      const prevCount = useAppStore.getState().discoveryRepos[channelId]?.length ?? 0;

      const currentAllRepos = useAppStore.getState().discoveryRepos[channelId] || [];
      const persistedAnalyses = await discoveryAnalysisStorage.loadAllAnalyses();
      const mergedRepos = result.repos.map((newRepo: DiscoveryRepo) => {
        const existingRepo = currentAllRepos.find((r: DiscoveryRepo) => r.id === newRepo.id);
        if (existingRepo && existingRepo.analyzed_at) {
          return {
            ...newRepo,
            ai_summary: existingRepo.ai_summary,
            ai_tags: existingRepo.ai_tags,
            ai_platforms: existingRepo.ai_platforms,
            analyzed_at: existingRepo.analyzed_at,
            analysis_failed: existingRepo.analysis_failed,
            analysis_error: existingRepo.analysis_error,
          };
        }
        const persisted = persistedAnalyses.get(newRepo.id);
        if (persisted && persisted.analyzed_at) {
          return {
            ...newRepo,
            ai_summary: persisted.ai_summary,
            ai_tags: persisted.ai_tags,
            ai_platforms: persisted.ai_platforms,
            analyzed_at: persisted.analyzed_at,
            analysis_failed: persisted.analysis_failed,
            analysis_error: persisted.analysis_error,
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
      if (result.totalCount !== undefined) {
        setDiscoveryTotalCount(channelId, result.totalCount);
      }
      setDiscoveryLastRefresh(channelId, new Date().toISOString());

      if (append && scrollContainerRef.current) {
        requestAnimationFrame(() => {
          if (!scrollContainerRef.current) return;
          const repoCards = scrollContainerRef.current.querySelectorAll('[data-repo-index]');
          const targetCard = repoCards[prevCount] as HTMLElement | undefined;
          if (targetCard) {
            targetCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        });
      }
    } catch (error) {
      console.error(`Failed to refresh channel ${channelId}:`, error);
      if (append) {
        setDiscoveryLoadMoreError(channelId, t('加载更多失败，请重试', 'Failed to load more, please retry'));
      } else {
        toast(t('获取数据失败，请检查网络连接或GitHub Token。', 'Failed to fetch data. Please check your network connection or GitHub Token.'), 'error');
      }
    } finally {
      if (append) {
        setDiscoveryLoadingMore(channelId, false);
      } else {
        setDiscoveryLoading(channelId, false);
      }
    }
  }, [githubToken, t, toast, setDiscoveryLoading, setDiscoveryLoadingMore, setDiscoveryLoadMoreError, setDiscoveryRepos, setDiscoveryLastRefresh, discoveryPlatform, discoveryLanguage, discoverySortBy, discoverySortOrder, discoverySearchQuery, discoverySelectedTopic, setDiscoveryHasMore, setDiscoveryNextPage, setDiscoveryTotalCount, appendDiscoveryRepos, trendingTimeRange]);

  // 切换频道时恢复滚动位置，并自动加载空数据
  useEffect(() => {
    // 恢复当前频道的滚动位置（从 ref 读取最新值，避免订阅整个 map）
    const savedPosition = discoveryScrollPositionsRef.current[selectedDiscoveryChannel] || 0;
    window.scrollTo({ top: savedPosition, behavior: 'auto' });
    
    // 取消持久化后，首次打开或切换到空频道时自动加载
    const hasRepos = useAppStore.getState().discoveryRepos[selectedDiscoveryChannel]?.length > 0;
    const isLoading = useAppStore.getState().discoveryIsLoading[selectedDiscoveryChannel];
    if (!hasRepos && !isLoading && autoFetchChannelRef.current !== selectedDiscoveryChannel) {
      autoFetchChannelRef.current = selectedDiscoveryChannel;
      refreshChannel(selectedDiscoveryChannel, 1, false);
    }
  }, [selectedDiscoveryChannel, refreshChannel]);

  // 趋势时间范围改变时刷新数据
  useEffect(() => {
    if (selectedDiscoveryChannel === 'trending' && trendingTimeRange) {
      refreshChannel('trending', 1, false);
    }
  }, [trendingTimeRange, selectedDiscoveryChannel, refreshChannel]);

  // 主题改变时刷新数据
  useEffect(() => {
    if (selectedDiscoveryChannel === 'topic') {
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

  // 处理滚动事件：保存滚动位置、控制工具栏显示、控制侧栏固定
  const handleScroll = useCallback(() => {
    // 获取页面滚动位置（支持window滚动和元素滚动）
    const currentScrollY = window.scrollY || window.pageYOffset || 0;

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
  }, []);

  // 监听 window 滚动事件
  useEffect(() => {
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, [handleScroll]);

  const handleAnalyzePage = useCallback(async () => {
    if (!githubToken) return;

    const activeConfig = aiConfigs.find(c => c.id === activeAIConfig);
    if (!activeConfig) {
      toast(t('请先在设置中配置AI服务。', 'Please configure AI service in settings first.'), 'error');
      return;
    }

    if (activeConfig.apiKeyStatus === 'decrypt_failed' || activeConfig.apiKeyStatus === 'empty') {
      toast(t('AI服务的API密钥无法解密或为空，请在设置中重新输入并保存该配置。', 'The AI service API key could not be decrypted or is empty. Please re-enter and save the configuration in settings.'), 'error');
      return;
    }

    if (!activeConfig.baseUrl || !activeConfig.apiKey || !activeConfig.model) {
      toast(t('AI服务配置不完整，请检查API端点、密钥和模型名称。', 'AI service configuration is incomplete. Please check the API endpoint, key, and model name.'), 'error');
      return;
    }

    const pageRepos = allRepos;

    if (pageRepos.length === 0) {
      toast(t('当前没有项目。', 'No projects available.'), 'error');
      return;
    }

    const unanalyzed = pageRepos.filter(
      (r: DiscoveryRepo) => !r.analyzed_at || r.analysis_failed
    );

    if (unanalyzed.length === 0) {
      toast(t('已加载的所有项目均已完成AI分析。', 'All loaded projects have been analyzed.'), 'info');
      return;
    }

    setIsAnalyzing(true);
    setAnalysisState({ paused: false, aborted: false });
    const storeState = useAppStore.getState();
    const allCategoriesForResolution = getAllCategories(
      storeState.customCategories,
      storeState.language,
      storeState.hiddenDefaultCategoryIds,
      storeState.defaultCategoryOverrides
    );
    const allCategoryNames = storeState
      .customCategories.map(c => c.name);
    const categoryNames = [
      ...allCategoryNames,
      ...(language === 'zh'
        ? ['全部分类', 'Web应用', '移动应用', '桌面应用', '数据库', 'AI/机器学习', '开发工具', '安全工具', '游戏', '设计工具', '效率工具', '教育学习', '社交网络', '数据分析']
        : ['All', 'Web Apps', 'Mobile Apps', 'Desktop Apps', 'Database', 'AI/ML', 'Dev Tools', 'Security Tools', 'Games', 'Design Tools', 'Productivity', 'Education', 'Social Networks', 'Data Analysis']),
    ];
    const aiCategoryHints = buildCategoryHints(storeState.customCategories);

    const githubApi = new GitHubApiService(githubToken);
    const aiService = new AIService(activeConfig, language);
    const optimizer = new AIAnalysisOptimizer({
      initialConcurrency: activeConfig.concurrency || 3,
      rateLimiter: {
        maxConcurrency: 0,
        requestsPerMinute: activeConfig.requestsPerMinute || 0,
      },
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
        aiCategoryHints,
        (current: number, total: number) => {
          setAnalysisProgress({ current, total });
        },
        (result) => {
          if (result.success && result.repo) {
            const resolvedCategory = resolveCategoryAssignment(
              { ...result.repo, ai_summary: result.summary },
              result.tags || [],
              allCategoriesForResolution
            );

            const wasCategoryLocked = !!result.repo.category_locked;

            const updatedRepo: DiscoveryRepo = {
              ...result.repo,
              rank: 0,
              channel: selectedDiscoveryChannel,
              platform: discoveryPlatform,
              ai_summary: result.summary,
              ai_tags: result.tags,
              ai_platforms: result.platforms,
              custom_category: resolvedCategory,
              category_locked: wasCategoryLocked,
              analyzed_at: new Date().toISOString(),
              analysis_failed: false,
              analysis_error: undefined,
            };
            updateDiscoveryRepo(updatedRepo);
            discoveryAnalysisStorage.saveAnalysis(updatedRepo.id, {
              ai_summary: result.summary,
              ai_tags: result.tags,
              ai_platforms: result.platforms,
              analyzed_at: updatedRepo.analyzed_at,
              analysis_failed: false,
              analysis_error: undefined,
            });
          } else if (!result.success && result.repo) {
            const failedRepo: DiscoveryRepo = {
              ...result.repo,
              rank: 0,
              channel: selectedDiscoveryChannel,
              platform: discoveryPlatform,
              analyzed_at: new Date().toISOString(),
              analysis_failed: true,
              analysis_error: result.error?.message || undefined,
            };
            updateDiscoveryRepo(failedRepo);
            discoveryAnalysisStorage.saveAnalysis(failedRepo.id, {
              analyzed_at: failedRepo.analyzed_at,
              analysis_failed: true,
              analysis_error: failedRepo.analysis_error,
            });
          }
        }
      );

      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;
      toast(
        t(
          `AI分析完成！成功 ${successCount} 个${failCount > 0 ? `，失败 ${failCount} 个` : ''}`,
          `AI analysis complete! ${successCount} succeeded${failCount > 0 ? `, ${failCount} failed` : ''}`
        ),
        successCount === 0 ? 'error' : failCount > 0 ? 'info' : 'success'
      );
    } catch (err) {
      console.error('AI analysis error:', err);
      toast(t('AI分析失败，请检查AI配置。', 'AI analysis failed. Please check your AI configuration.'), 'error');
    } finally {
      setIsAnalyzing(false);
      setAnalysisOptimizer(null);
      setAnalysisProgress({ current: 0, total: 0 });
    }
  }, [githubToken, aiConfigs, activeAIConfig, language, allRepos, t, toast, updateDiscoveryRepo, setAnalysisProgress, selectedDiscoveryChannel, discoveryPlatform]);



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

  const handleLoadMore = useCallback(async () => {
    if (!discoveryHasMore[selectedDiscoveryChannel]) {
      return;
    }
    
    if (currentIsLoading) {
      return;
    }
    
    const nextPage = discoveryNextPage[selectedDiscoveryChannel];
    if (!nextPage) {
      return;
    }
    
    await refreshChannel(selectedDiscoveryChannel, nextPage, true);
  }, [
    discoveryHasMore,
    discoveryNextPage,
    selectedDiscoveryChannel,
    currentIsLoading,
    refreshChannel
  ]);

  const refreshAll = useCallback(async () => {
    const enabledChannels = safeDiscoveryChannels.filter(ch => ch.enabled);
    for (const channel of enabledChannels) {
      await refreshChannel(channel.id, 1, false);
    }
  }, [safeDiscoveryChannels, refreshChannel]);

  const mobileChannels = useMemo(() => {
    return safeDiscoveryChannels
      .filter(ch => ch.enabled)
      .map(ch => ({
        ...ch,
        icon: discoveryChannelIconMap[ch.icon] || <Crown className="w-4 h-4" />,
      }));
  }, [safeDiscoveryChannels]);

  return (
    <div className="flex flex-col">
      {/* Mobile Tab Navigation */}
      <MobileTabNav
        channels={mobileChannels}
        selectedChannel={selectedDiscoveryChannel}
        onChannelSelect={(channel) => {
          if (channel === selectedDiscoveryChannel) {
            return;
          }
          const scrollTop = window.scrollY;
          discoveryScrollPositionsRef.current[selectedDiscoveryChannel] = scrollTop;
          setDiscoveryScrollPosition(selectedDiscoveryChannel, scrollTop);
          setSelectedDiscoveryChannel(channel);
        }}
        language={language}
      />

      <div
        className="flex flex-col gap-4 lg:flex-row lg:gap-6 flex-1 min-h-0 min-w-0 items-start"
      >
        <div
          ref={sidebarRef}
          className="hidden lg:block w-64 shrink-0 sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto overflow-x-hidden"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          <DiscoverySidebar
            channels={safeDiscoveryChannels}
            selectedChannel={selectedDiscoveryChannel}
            onChannelSelect={(channel) => {
              if (channel === selectedDiscoveryChannel) {
                return;
              }
              const scrollTop = window.scrollY;
              discoveryScrollPositionsRef.current[selectedDiscoveryChannel] = scrollTop;
              setDiscoveryScrollPosition(selectedDiscoveryChannel, scrollTop);
              setSelectedDiscoveryChannel(channel);
            }}
            onRefreshAll={refreshAll}
            isLoading={discoveryIsLoading}
            lastRefresh={discoveryLastRefresh}
            isAnalyzing={isAnalyzing}
            language={language}
          />
        </div>

        <div className="flex-1 flex flex-col min-h-0 min-w-0 relative">
          {/* 顶部工具栏 - 随滚动显示/隐藏 */}
          <div 
            className={`flex-shrink-0 transition-transform duration-300 ease-in-out z-10 ${
              isToolbarVisible ? 'translate-y-0' : '-translate-y-full opacity-0 pointer-events-none'
            }`}
          >
            <div className="ui-toolbar p-3.5 sm:p-4 mb-4">
              {/* 第一行：标题和刷新按钮 */}
              <div className="flex items-center justify-between gap-2 mb-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${currentChannelStyle.gradient} flex items-center justify-center shadow-md ${currentChannelStyle.shadow}`}>
                    {currentChannelIconNode}
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-base sm:text-lg font-bold text-foreground dark:text-foreground truncate leading-tight">
                      {language === 'zh'
                        ? currentChannel?.name
                        : currentChannel?.nameEn}
                    </h2>
                    {currentLastRefresh && (
                      <p className="hidden sm:block text-[11px] text-muted-foreground dark:text-muted-foreground">
                        {t('更新于', 'Updated')} {formatLastRefresh(currentLastRefresh)}
                      </p>
                    )}
                  </div>
                </div>
                <div className="relative group/refresh shrink-0">
                  <Button
                    onClick={() => refreshChannel(selectedDiscoveryChannel, 1, false)}
                    disabled={currentIsLoading || isAnalyzing}
                    className="linear-icon-button p-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    title={t('刷新', 'Refresh')}
                  >
                    <RefreshCw className={`w-4 h-4 ${currentIsLoading ? 'animate-spin' : ''}`} />
                  </Button>
                  {selectedDiscoveryChannel === 'hot-release' && (
                    <div className="absolute top-full mt-2 right-0 z-50 opacity-0 group-hover/refresh:opacity-100 translate-y-1 group-hover/refresh:translate-y-0 transition-all duration-200 pointer-events-none">
                      <div className="bg-gray-900 dark:bg-muted/40 text-white text-xs rounded-lg px-3 py-2 whitespace-nowrap shadow-lg">
                        {t('每次刷新都能看到不一样的内容', 'Each refresh shows different content')}
                      </div>
                      <div className="absolute -top-1 right-3 w-2 h-2 bg-gray-900 dark:bg-muted/40 rotate-45" />
                    </div>
                  )}
                </div>
              </div>
              
              {/* 第二行：筛选和操作按钮 */}
              <div className="flex items-center gap-2 flex-wrap">
                {selectedDiscoveryChannel === 'trending' && (
            <div className="flex items-center gap-1.5">
              <Calendar className="w-4 h-4 text-muted-foreground dark:text-muted-foreground" />
              <Select value={trendingTimeRange} onValueChange={(value) => setTrendingTimeRange(value as TrendingTimeRange)}>
                <SelectTrigger className="ui-field h-9 w-auto min-w-28 px-3 py-1.5 text-sm font-medium text-foreground dark:text-foreground"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">{t('今日', 'Today')}</SelectItem>
                  <SelectItem value="weekly">{t('本周', 'This Week')}</SelectItem>
                  <SelectItem value="monthly">{t('本月', 'This Month')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        {selectedDiscoveryChannel === 'topic' && (
                  <Select value={discoverySelectedTopic || 'all'} onValueChange={(value) => setDiscoverySelectedTopic(value === 'all' ? null : value as TopicCategory)}>
                    <SelectTrigger className="ui-field h-9 w-auto min-w-28 px-3 py-1.5 text-sm font-medium text-foreground dark:text-foreground"><SelectValue placeholder={t('主题', 'Topic')} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t('主题', 'Topic')}</SelectItem>
                      <SelectItem value="ai">{t('人工智能', 'AI')}</SelectItem>
                      <SelectItem value="ml">{t('机器学习', 'ML')}</SelectItem>
                      <SelectItem value="database">{t('数据库', 'DB')}</SelectItem>
                      <SelectItem value="web">{t('Web开发', 'Web')}</SelectItem>
                      <SelectItem value="mobile">{t('移动开发', 'Mobile')}</SelectItem>
                      <SelectItem value="devtools">{t('开发工具', 'DevTools')}</SelectItem>
                      <SelectItem value="security">{t('安全', 'Security')}</SelectItem>
                      <SelectItem value="game">{t('游戏', 'Game')}</SelectItem>
                    </SelectContent>
                  </Select>
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
                        <div className="px-2 py-1.5 rounded-lg bg-muted dark:bg-muted/40 text-muted-foreground dark:text-muted-foreground flex items-center gap-1.5 overflow-hidden">
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
                      <Button
                        onClick={handleAbortAnalysis}
                        className="p-1.5 rounded-lg bg-muted dark:bg-muted/40 text-muted-foreground dark:text-muted-foreground hover:bg-accent dark:hover:bg-accent transition-colors"
                        title={t('停止', 'Stop')}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  ) : (
                    <Button
                      onClick={handleAnalyzePage}
                      disabled={isAnalyzing || currentIsLoading}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-muted dark:bg-muted/40 text-muted-foreground dark:text-muted-foreground hover:bg-accent dark:hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title={t('AI分析', 'Analyze with AI')}
                    >
                      <Bot className="w-4 h-4" />
                      <span className="hidden sm:inline">{t('AI分析', 'AI Analyze')}</span>
                    </Button>
                  )}
                  <DataStats
                    currentCount={allRepos.length}
                    totalCount={currentTotalCount}
                    language={language}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* 内容区域 */}
          <div 
            ref={scrollContainerRef}
            className={`flex-1 overflow-y-auto space-y-4 pr-2 ${isDesktopSafeMode ? 'bg-white dark:bg-card' : ''}`}
          >
            {selectedDiscoveryChannel === 'search' && (
              <div className={isDesktopSafeMode
                ? 'ui-toolbar p-4 space-y-4'
                : 'ui-toolbar p-5 space-y-4'}>
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="flex-1 relative">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground dark:text-muted-foreground" />
                    <Input
                      type="text"
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                      placeholder={t('搜索仓库...', 'Search repositories...')}
                      className="ui-field h-auto w-full py-2.5 pl-10 pr-4 text-foreground dark:text-foreground" />
                  </div>
                  <Button
                    onClick={handleSearch}
                    disabled={!searchInput.trim() || currentIsLoading}
                    className={isDesktopSafeMode
                      ? 'ui-button-primary px-5 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 font-medium'
                      : 'ui-button-primary px-5 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 font-medium'}
                  >
                    <Search className="w-4 h-4" />
                    <span className="hidden sm:inline">{t('搜索', 'Search')}</span>
                  </Button>
                </div>
                
                <div className="flex flex-wrap gap-2.5">
                  <Select value={discoveryLanguage} onValueChange={(value) => setDiscoveryLanguage(value as ProgrammingLanguage)}>
                    <SelectTrigger className="ui-field h-9 w-auto min-w-32 px-3 py-1.5 text-sm font-medium text-foreground dark:text-foreground"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="All">{t('所有语言', 'All Languages')}</SelectItem>
                      <SelectItem value="JavaScript">JavaScript</SelectItem>
                      <SelectItem value="TypeScript">TypeScript</SelectItem>
                      <SelectItem value="Python">Python</SelectItem>
                      <SelectItem value="Java">Java</SelectItem>
                      <SelectItem value="Kotlin">Kotlin</SelectItem>
                      <SelectItem value="Go">Go</SelectItem>
                      <SelectItem value="Rust">Rust</SelectItem>
                      <SelectItem value="CSharp">C#</SelectItem>
                      <SelectItem value="CPlusPlus">C++</SelectItem>
                      <SelectItem value="C">C</SelectItem>
                      <SelectItem value="Swift">Swift</SelectItem>
                      <SelectItem value="Dart">Dart</SelectItem>
                      <SelectItem value="Ruby">Ruby</SelectItem>
                      <SelectItem value="PHP">PHP</SelectItem>
                    </SelectContent>
                  </Select>
                  
                  <CustomSelect
                    value={discoverySortBy}
                    onChange={(value) => setDiscoverySortBy(value as SortBy)}
                    options={[
                      { value: 'BestMatch', label: t('最佳匹配', 'Best Match') },
                      { value: 'MostStars', label: t('最多Star', 'Most Stars') },
                      { value: 'MostForks', label: t('最多Fork', 'Most Forks') },
                    ]}
                  />

                  <CustomSelect
                    value={discoverySortOrder}
                    onChange={(value) => setDiscoverySortOrder(value as SortOrder)}
                    options={[
                      { value: 'Descending', label: t('降序', 'Descending') },
                      { value: 'Ascending', label: t('升序', 'Ascending') },
                    ]}
                  />
                </div>
              </div>
            )}

            {currentIsLoading && allRepos.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 gap-4">
                <div className="relative">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-100 to-indigo-100 dark:from-blue-900/30 dark:to-indigo-900/30 flex items-center justify-center">
                    <Loader2 className="w-7 h-7 animate-spin text-primary" />
                  </div>
                  <div className="absolute -top-1 -right-1 w-4 h-4 bg-green-6000 rounded-full animate-ping opacity-75" />
                </div>
                <div className="text-center space-y-1.5">
                  <p className="text-foreground dark:text-muted-foreground font-medium text-sm">
                    {t('正在获取数据...', 'Fetching data...')}
                  </p>
                  <p className="text-xs text-muted-foreground dark:text-muted-foreground">
                    {t('GitHub API 响应中', 'Waiting for GitHub API response')}
                  </p>
                </div>
              </div>
            )}

            {!currentIsLoading && allRepos.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 gap-5 text-center">
                {selectedDiscoveryChannel === 'search' ? (
                  <>
                    {isDesktopSafeMode ? (
                      <div className="w-16 h-16 rounded-2xl bg-muted dark:bg-card flex items-center justify-center text-muted-foreground dark:text-muted-foreground border border-border dark:border-border">
                        {currentChannelIconNode}
                      </div>
                    ) : (
                      <div className={`w-20 h-20 rounded-3xl bg-gradient-to-br ${currentChannelStyle.gradient} flex items-center justify-center shadow-md ${currentChannelStyle.shadow}`}>
                        {currentChannelStyle.largeIcon}
                      </div>
                    )}
                    <div className="space-y-2 max-w-xs">
                      <p className="text-muted-foreground dark:text-muted-foreground font-medium text-base">
                        {t('搜索发现', 'Search & Discover')}
                      </p>
                      <p className="text-sm text-muted-foreground dark:text-muted-foreground leading-relaxed">
                        {t('输入关键字搜索 GitHub 仓库', 'Enter keywords to search GitHub repositories')}
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    {isDesktopSafeMode ? (
                      <div className="w-16 h-16 rounded-2xl bg-muted dark:bg-card flex items-center justify-center text-muted-foreground dark:text-muted-foreground border border-border dark:border-border">
                        {currentChannelIconNode}
                      </div>
                    ) : (
                      <div className={`w-20 h-20 rounded-3xl bg-gradient-to-br ${currentChannelStyle.gradient} flex items-center justify-center shadow-md ${currentChannelStyle.shadow}`}>
                        {currentChannelStyle.largeIcon}
                      </div>
                    )}
                    <div className="space-y-2 max-w-xs">
                      <p className="text-muted-foreground dark:text-muted-foreground font-medium text-base">
                        {t('暂无数据', 'No data yet')}
                      </p>
                      <p className="text-sm text-muted-foreground dark:text-muted-foreground leading-relaxed">
                        {t('点击刷新按钮获取最新排行数据', 'Click refresh to fetch latest rankings')}
                      </p>
                    </div>
                    <Button
                      variant="default"
                      onClick={() => refreshChannel(selectedDiscoveryChannel, 1, false)}
                      disabled={currentIsLoading}
                      className={isDesktopSafeMode
                        ? 'flex items-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90'
                        : 'flex items-center gap-2 rounded-xl bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90'}
                    >
                      <RefreshCw className="w-4 h-4" />
                      {t('立即刷新', 'Refresh Now')}
                    </Button>
                  </>
                )}
              </div>
            )}

            {allRepos.length > 0 && (
              <div className={isDesktopSafeMode ? 'space-y-3' : 'space-y-4'}>
                {allRepos.map((repo, index) => (
                  <div key={repo.id} data-repo-index={index}>
                    <SubscriptionRepoCard repo={repo} desktopSafeMode={isDesktopSafeMode} />
                  </div>
                ))}
              </div>
            )}

            {currentIsLoadingMore && (
              <div className="flex items-center justify-center py-6 gap-3">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground dark:text-muted-foreground">{t('正在加载更多...', 'Loading more...')}</span>
              </div>
            )}

            {currentLoadMoreError && (
              <div className="flex flex-col items-center gap-3 py-4">
                <div className="flex items-center gap-2 text-muted-foreground dark:text-muted-foreground ">
                  <X className="w-4 h-4" />
                  <span className="text-sm">{currentLoadMoreError}</span>
                </div>
                <Button
                  onClick={() => {
                    const nextPage = discoveryNextPage[selectedDiscoveryChannel];
                    if (nextPage) {
                      refreshChannel(selectedDiscoveryChannel, nextPage, true);
                    }
                  }}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-muted dark:bg-muted/40 text-muted-foreground dark:text-muted-foreground hover:bg-accent dark:hover:bg-accent transition-colors flex items-center gap-2"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  {t('重试', 'Retry')}
                </Button>
              </div>
            )}

            {/* Page Info */}
            {!currentIsLoading && allRepos.length > 0 && (
              <div className={isDesktopSafeMode
                ? 'flex items-center justify-between py-3.5 px-5 bg-background dark:bg-card rounded-lg border border-border dark:border-border text-sm'
                : 'flex items-center justify-between py-3.5 px-5 bg-gradient-to-r from-gray-50 to-slate-50 dark:from-gray-800/60 dark:to-slate-800/40 rounded-xl border border-black/[0.04] dark:border-border/50 text-sm'}>
                <div className="flex items-center gap-2 text-muted-foreground dark:text-muted-foreground">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                  <span>
                    {t('共', 'Total')} <strong className="text-foreground dark:text-foreground">{allRepos.length}</strong> {t('个项目', 'items')}
                  </span>
                </div>

              </div>
            )}

            {/* Load More Button */}
            {!currentIsLoading && !currentIsLoadingMore && allRepos.length > 0 && (
              <LoadMoreButton
                onLoadMore={handleLoadMore}
                isLoading={false}
                hasMore={discoveryHasMore[selectedDiscoveryChannel] ?? false}
                totalCount={currentTotalCount}
                language={language}
              />
            )}


          </div>

          {/* 滚动到底部按钮 */}
          <ScrollToBottom scrollContainerRef={scrollContainerRef} />
        </div>
      </div>
    </div>
  );
});

DiscoveryView.displayName = 'DiscoveryView';
