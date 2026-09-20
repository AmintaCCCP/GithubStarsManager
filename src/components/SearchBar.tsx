



import { getIntlLocale } from '../i18n/format';
import { useT } from '../i18n/useT';
import { Input } from './ui/input';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, X, SlidersHorizontal, CheckCircle, Bell, BellOff, Bot, Edit3, Lock, Unlock, AlertCircle, ChevronDown, RefreshCw, Clock, ArrowDown, ArrowUp, History, Archive } from 'lucide-react';
import { getPlatformDisplayName, getPlatformIcon } from './platformMeta';
import { useAppStore, getAllCategories } from '../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { useSearchShortcuts } from '../hooks/useSearchShortcuts';
import { useSearchActions } from '../features/repositories/hooks/useSearchActions';
import { useDialog } from '../hooks/useDialog';
import { isRepoCustomized } from '../utils/repoUtils';
import { repositoryChatStorage } from '../services/repositoryChatStorage';
import { applyRepoFilters, performBasicTextSearch as basicTextSearch, sortRepositories } from '../utils/repoSearch';
import { NO_LICENSE_SENTINEL, normalizeLicense } from '../utils/licenseFilter';
import { NumberInput } from './ui/NumberInput';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

type SortBy = 'stars' | 'updated' | 'name' | 'starred' | 'created';

// 标签走 i18n key（searchBar.sort-<value>），这里只保留顺序。created 是本仓库新增的排序。
const sortOptions: SortBy[] = ['stars', 'updated', 'name', 'starred', 'created'];

interface SortByDropdownProps {
  value: SortBy;
  onChange: (value: SortBy) => void;
}

const SortByDropdown: React.FC<SortByDropdownProps> = ({ value, onChange }) => {
  const t = useT('app');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-2">
          <span>{t(`searchBar.sort-${value}`)}</span>
          <ChevronDown className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuRadioGroup value={value} onValueChange={(nextValue) => onChange(nextValue as SortBy)}>
          {sortOptions.map((option) => (
            <DropdownMenuRadioItem
              key={option}
              value={option}
              className={value === option ? 'bg-primary/10 text-primary dark:bg-primary/20' : undefined}
            >
              {t(`searchBar.sort-${option}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export const SearchBar: React.FC = () => {
  const {
    searchFilters,
    repositories,
    releaseSubscriptions,
    activeAIConfig,
    language,
    setSearchFilters,
    setSearchResults,
    customCategories,
    hiddenDefaultCategoryIds,
    defaultCategoryOverrides,
    lastSync,
    isSyncingStars,
  } = useAppStore(useShallow((state) => ({
    searchFilters: state.searchFilters,
    repositories: state.repositories,
    releaseSubscriptions: state.releaseSubscriptions,
    activeAIConfig: state.activeAIConfig,
    language: state.language,
    setSearchFilters: state.setSearchFilters,
    setSearchResults: state.setSearchResults,
    customCategories: state.customCategories,
    hiddenDefaultCategoryIds: state.hiddenDefaultCategoryIds,
    defaultCategoryOverrides: state.defaultCategoryOverrides,
    lastSync: state.lastSync,
    isSyncingStars: state.isSyncingStars,
  })));

  const { confirm } = useDialog();
  // 搜索动作（向量/关键词/AI 搜索、星标同步）由 hook 承担；
  // 两 ref 实体挂 hook、以 RefObject 暴露，View 的过滤 effect 原样读写。
  const {
    isSearching,
    searchPhase,
    vectorScoreMapRef,
    skipNextTextSearchRef,
    aiSearch,
    syncStars,
  } = useSearchActions();
  
  const [showFilters, setShowFilters] = useState(false);
  const [searchQuery, setSearchQuery] = useState(searchFilters.query);
  const [availableLanguages, setAvailableLanguages] = useState<string[]>([]);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [availablePlatforms, setAvailablePlatforms] = useState<string[]>([]);
  const [availableLicenses, setAvailableLicenses] = useState<string[]>([]);
  const [isRealTimeSearch, setIsRealTimeSearch] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  // S4 全局问答历史入口：徽标显示已保存会话数。
  const [globalHistoryCount, setGlobalHistoryCount] = useState(0);
  // 重叠刷新只允许最新请求提交，避免旧数量覆盖新状态。
  const globalHistoryRequestRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const refreshGlobalHistoryCount = async () => {
      const requestId = ++globalHistoryRequestRef.current;
      try {
        const sessions = await repositoryChatStorage.listRecentSessions(100);
        if (!cancelled && requestId === globalHistoryRequestRef.current) setGlobalHistoryCount(sessions.length);
      } catch {
        if (!cancelled && requestId === globalHistoryRequestRef.current) setGlobalHistoryCount(0);
      }
    };
    void refreshGlobalHistoryCount();
    // 删除会话时由历史抽屉广播；打开抽屉与窗口重获焦点时也刷新，
    // 覆盖单仓问答内新建会话导致的计数过期。
    window.addEventListener('gsm:global-chat-history-changed', refreshGlobalHistoryCount);
    window.addEventListener('gsm:open-global-chat-history', refreshGlobalHistoryCount);
    window.addEventListener('focus', refreshGlobalHistoryCount);
    return () => {
      cancelled = true;
      window.removeEventListener('gsm:global-chat-history-changed', refreshGlobalHistoryCount);
      window.removeEventListener('gsm:open-global-chat-history', refreshGlobalHistoryCount);
      window.removeEventListener('focus', refreshGlobalHistoryCount);
    };
  }, []);

  const openGlobalChatHistory = () => {
    window.dispatchEvent(new CustomEvent('gsm:open-global-chat-history'));
  };
  
  const allCategories = useMemo(() => 
    getAllCategories(customCategories, language, hiddenDefaultCategoryIds, defaultCategoryOverrides),
    [customCategories, language, hiddenDefaultCategoryIds, defaultCategoryOverrides]
  );
  
  const statusStats = useMemo(() => {
    const stats = {
      analyzed: 0,      // 已AI分析（成功）
      notAnalyzed: 0,   // 未AI分析
      failed: 0,        // 分析失败
      subscribed: 0,    // 已订阅Release
      notSubscribed: 0, // 未订阅Release
      edited: 0,        // 已编辑
      notEdited: 0,     // 未编辑
      locked: 0,        // 分类已锁定
      notLocked: 0,     // 分类未锁定
    };
    
    repositories.forEach(repo => {
      // AI分析状态统计
      if (repo.analyzed_at && repo.analysis_failed) {
        stats.failed++;
      } else if (repo.analyzed_at && !repo.analysis_failed) {
        stats.analyzed++;
      } else {
        stats.notAnalyzed++;
      }
      
      // 订阅状态统计
      if (releaseSubscriptions.has(repo.id)) {
        stats.subscribed++;
      } else {
        stats.notSubscribed++;
      }
      
      // 自定义状态统计
      if (isRepoCustomized(repo, allCategories)) {
        stats.edited++;
      } else {
        stats.notEdited++;
      }

      // 锁定状态统计
      const isCategoryLocked = !!repo.category_locked;
      if (isCategoryLocked) {
        stats.locked++;
      } else {
        stats.notLocked++;
      }
    });
    
    return stats;
  }, [repositories, releaseSubscriptions, allCategories]);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [showSearchHistory, setShowSearchHistory] = useState(false);
  const [searchSuggestions, setSearchSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchDropdownRef = useRef<HTMLDivElement>(null);
  const filterChipBaseClass = 'linear-filter-chip flex items-center space-x-2 px-3 py-1.5 text-sm';
  const filterChipActiveClass = 'is-active font-medium';
  const filterChipInactiveClass = '';
  const filterTagBaseClass = 'linear-filter-chip px-3 py-1.5 text-sm';

  useEffect(() => {
    // Extract unique languages, tags, and platforms from repositories
    const languages = [...new Set(repositories.map(r => r.language).filter(Boolean))] as string[];
    // 标签包含AI标签、GitHub topics和用户自定义标签
    const tags = [...new Set([
      ...repositories.flatMap(r => r.ai_tags || []),
      ...repositories.flatMap(r => r.topics || []),
      ...repositories.flatMap(r => r.custom_tags || [])
    ])];
    const platforms = [...new Set(repositories.flatMap(r => r.ai_platforms || []))] as string[];
    // 开源许可：归一化为 SPDX id 或 NO_LICENSE_SENTINEL，排序并把「无」项放最后
    const licenses = [...new Set(repositories.map(r => normalizeLicense(r.license)))].sort((a, b) => {
      if (a === NO_LICENSE_SENTINEL) return 1;
      if (b === NO_LICENSE_SENTINEL) return -1;
      return a.localeCompare(b);
    });

    setAvailableLanguages(languages);
    setAvailableTags(tags);
    setAvailablePlatforms(platforms);
    setAvailableLicenses(licenses);

    // Generate search suggestions from available data
    const suggestions = [
      ...languages.slice(0, 5),
      ...tags.slice(0, 10),
      ...platforms.slice(0, 5)
    ].filter(Boolean);
    setSearchSuggestions([...new Set(suggestions)]);

    // Load search history from localStorage
    const savedHistory = localStorage.getItem('github-stars-search-history');
    if (savedHistory) {
      try {
        const history = JSON.parse(savedHistory);
        setSearchHistory(Array.isArray(history) ? history.slice(0, 10) : []);
      } catch (error) {
        console.warn('Failed to load search history:', error);
      }
    }
  }, [repositories]);

  useEffect(() => {
    const performSearch = async () => {
      // Skip if vector search just set results
      if (skipNextTextSearchRef.current) {
        skipNextTextSearchRef.current = false;
        return;
      }
      // Check if vector search is still enabled
      const vsEnabled = useAppStore.getState().vectorSearchConfig.enabled;
      if (!vsEnabled) {
        vectorScoreMapRef.current = null;
      }
      if (!searchFilters.query) {
        vectorScoreMapRef.current = null;
        performBasicFilter();
      } else if (vectorScoreMapRef.current && vectorScoreMapRef.current.query === searchFilters.query && vsEnabled) {
        // Vector results exist for this exact query and vector search is enabled — re-apply filters and re-sort by score
        const { scores } = vectorScoreMapRef.current;
        const reFiltered = applyFilters(repositories.filter(r => scores.has(String(r.id))));
        const reSorted = reFiltered.sort(
          (a, b) => (scores.get(String(b.id)) ?? 0) - (scores.get(String(a.id)) ?? 0)
        );
        setSearchResults(reSorted);
      } else {
        // Query changed or vector search disabled — clear stale ref and do text search
        vectorScoreMapRef.current = null;
      }
      if (!vectorScoreMapRef.current) {
        const textResults = performBasicTextSearch(repositories, searchFilters.query);
        const finalFiltered = applyFilters(textResults);
        setSearchResults(finalFiltered);
      }
    };

    performSearch();
    // Search helpers are intentionally kept as local closures; the explicit deps below
    // cover the state they read without causing a search loop on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchFilters.languages, searchFilters.tags, searchFilters.platforms, searchFilters.licenses, searchFilters.isAnalyzed, searchFilters.isSubscribed, searchFilters.isEdited, searchFilters.isCategoryLocked, searchFilters.analysisFailed, searchFilters.minStars, searchFilters.maxStars, searchFilters.sortBy, searchFilters.sortOrder, searchFilters.query, repositories, releaseSubscriptions, allCategories]);

  // Real-time search effect for repository name matching
  useEffect(() => {
    if (searchQuery.trim() && isRealTimeSearch && !isComposing) {
      const timeoutId = setTimeout(() => {
        performRealTimeSearch(searchQuery);
      }, 300); // 300ms debounce to avoid too frequent searches

      return () => clearTimeout(timeoutId);
    } else if (!searchQuery.trim()) {
      // Reset to show all repositories when search is empty or whitespace-only
      performBasicFilter();
    }
    // Search helpers are intentionally kept as local closures; the explicit deps below
    // cover the state they read without causing a search loop on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, isRealTimeSearch, isComposing, repositories, allCategories]);

  const updateRealTimeSearchState = (value: string) => {
    setIsRealTimeSearch(Boolean(value.trim()));
  };

  // Handle composition events for IME input (Chinese/Japanese/Korean).
  // Track composition separately so the debounce pauses for preedit text without
  // relying on composition events to re-arm real-time search after typing.
  const handleCompositionStart = () => {
    setIsComposing(true);
  };

  const handleCompositionEnd = (e: React.CompositionEvent<HTMLInputElement>) => {
    setIsComposing(false);
    updateRealTimeSearchState(e.currentTarget.value);
  };

  const performRealTimeSearch = (query: string) => {
    const startTime = performance.now();
    
    if (!query.trim()) {
      performBasicFilter();
      return;
    }

    // Real-time search only matches repository names for fast response
    const normalizedQuery = query.toLowerCase();
    const filtered = repositories.filter(repo => {
      return repo.name.toLowerCase().includes(normalizedQuery) ||
             repo.full_name.toLowerCase().includes(normalizedQuery);
    });

    // Apply other filters
    const finalFiltered = applyFilters(filtered);
    setSearchResults(finalFiltered);
    
    const endTime = performance.now();
    console.log(`Real-time search completed in ${(endTime - startTime).toFixed(2)}ms`);
  };

  const performBasicFilter = () => {
    const filtered = applyFilters(repositories);
    setSearchResults(filtered);
  };

  const performBasicTextSearch = (repos: typeof repositories, query: string) =>
    basicTextSearch(repos, query);

  const applyFilters = (repos: typeof repositories) => {
    const filtered = applyRepoFilters(repos, searchFilters, {
      releaseSubscriptions,
      allCategories,
    });

    // 如果分类锁定筛选导致结果为0，自动清除该筛选条件（UI 侧副作用保留在此）
    if (searchFilters.isCategoryLocked !== undefined && filtered.length === 0) {
      const withoutLock = applyRepoFilters(
        repos,
        { ...searchFilters, isCategoryLocked: undefined },
        { releaseSubscriptions, allCategories }
      );
      if (withoutLock.length > 0) {
        console.log('分类锁定筛选导致结果为空，自动清除该筛选条件');
        setSearchFilters({ isCategoryLocked: undefined });
        return sortRepositories(
          withoutLock,
          searchFilters.sortBy,
          searchFilters.sortOrder
        );
      }
    }

    return filtered;
  };

  // View-UI 部分（实时搜索开关/历史/建议下拉与搜索历史 localStorage）留在 View，
  // 搜索编排（向量 → 关键词，含 HyDE/rerank 与降级路径）在 useSearchActions.aiSearch。
  const handleAISearch = async () => {
    if (!searchQuery.trim()) return;

    // Switch to AI search mode and trigger advanced search
    setIsRealTimeSearch(false);
    setShowSearchHistory(false);
    setShowSuggestions(false);

    // Add to search history if not empty and not already in history
    if (searchQuery.trim() && !searchHistory.includes(searchQuery.trim())) {
      const newHistory = [searchQuery.trim(), ...searchHistory.slice(0, 9)];
      setSearchHistory(newHistory);
      localStorage.setItem('github-stars-search-history', JSON.stringify(newHistory));
    }

    await aiSearch(searchQuery, applyFilters);
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    setIsRealTimeSearch(false);
    setSearchFilters({ query: '' });
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchQuery(value);

    if (!value.trim() && searchFilters.query) {
      setSearchFilters({ query: '' });
    }

    // Keep real-time search armed whenever the input has searchable text.
    // A separate composing flag pauses debounce while IME preedit text is active.
    updateRealTimeSearchState(value);

    // Show search history when input is focused and empty
    if (!value && searchHistory.length > 0) {
      setShowSearchHistory(true);
      setShowSuggestions(false);
    } else if (value && value.length >= 2) {
      // Show suggestions when user types 2+ characters
      const filteredSuggestions = searchSuggestions.filter(suggestion =>
        suggestion.toLowerCase().includes(value.toLowerCase()) && 
        suggestion.toLowerCase() !== value.toLowerCase()
      ).slice(0, 5);
      
      if (filteredSuggestions.length > 0) {
        setShowSuggestions(true);
        setShowSearchHistory(false);
      } else {
        setShowSuggestions(false);
      }
    } else {
      setShowSearchHistory(false);
      setShowSuggestions(false);
    }
  };

  const handleInputFocus = () => {
    if (!searchQuery && searchHistory.length > 0) {
      setShowSearchHistory(true);
    }
  };

  const handleInputBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    // Keyboard focus moving into the dropdown (relatedTarget) keeps it open;
    // only a genuine blur to elsewhere schedules the delayed hide that lets
    // pointer clicks on items land.
    if (e.relatedTarget instanceof Node && searchDropdownRef.current?.contains(e.relatedTarget)) {
      return;
    }
    // Delay hiding to allow clicking on history/suggestion items
    setTimeout(() => {
      setShowSearchHistory(false);
      setShowSuggestions(false);
    }, 200);
  };

  const handleHistoryItemClick = (historyQuery: string) => {
    setSearchQuery(historyQuery);
    setIsRealTimeSearch(false);
    setSearchFilters({ query: historyQuery });
    setShowSearchHistory(false);

    const textResults = performBasicTextSearch(repositories, historyQuery);
    const finalFiltered = applyFilters(textResults);
    setSearchResults(finalFiltered);
  };

  const handleSuggestionClick = (suggestion: string) => {
    setSearchQuery(suggestion);
    setIsRealTimeSearch(true);
    setShowSuggestions(false);
  };

  const clearSearchHistory = () => {
    setSearchHistory([]);
    localStorage.removeItem('github-stars-search-history');
    setShowSearchHistory(false);
  };



  const handleKeyDown = (e: React.KeyboardEvent) => {
    const dropdownOpen = showSearchHistory || showSuggestions;

    // Escape first dismisses the open dropdown without firing the global
    // "clear search" shortcut; a second Escape (dropdown closed) clears the query.
    if (e.key === 'Escape' && dropdownOpen) {
      e.preventDefault();
      e.stopPropagation();
      setShowSearchHistory(false);
      setShowSuggestions(false);
      return;
    }

    // Arrow keys move focus into and across the option buttons (roving focus).
    if (dropdownOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.nativeEvent.isComposing) {
      e.preventDefault();
      focusSearchOption(e.key === 'ArrowDown' ? 0 : -1);
    }

    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      handleAISearch();
    }
  };

  // 焦点漫游：ArrowDown/ArrowUp 在搜索历史/建议项之间移动。index 为负时从
  // 末尾开始计数，-1 即最后一项，使输入框内按 ArrowUp 直达最后一项。
  const focusSearchOption = (index: number) => {
    const options = searchDropdownRef.current?.querySelectorAll<HTMLButtonElement>('button[data-search-option]');
    if (!options || options.length === 0) return;
    const resolved = index < 0 ? options.length + index : index;
    options[Math.min(resolved, options.length - 1)]?.focus();
  };

  const handleSearchOptionKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      const options = searchDropdownRef.current?.querySelectorAll<HTMLButtonElement>('button[data-search-option]');
      if (!options || options.length === 0) return;
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      const next = (index + delta + options.length) % options.length;
      options[next]?.focus();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setShowSearchHistory(false);
      setShowSuggestions(false);
      searchInputRef.current?.focus();
    }
  };

  const handleLanguageToggle = (language: string) => {
    const newLanguages = searchFilters.languages.includes(language)
      ? searchFilters.languages.filter(l => l !== language)
      : [...searchFilters.languages, language];
    setSearchFilters({ languages: newLanguages });
  };

  const handleTagToggle = (tag: string) => {
    const newTags = searchFilters.tags.includes(tag)
      ? searchFilters.tags.filter(t => t !== tag)
      : [...searchFilters.tags, tag];
    setSearchFilters({ tags: newTags });
  };

  const handlePlatformToggle = (platform: string) => {
    const newPlatforms = searchFilters.platforms.includes(platform)
      ? searchFilters.platforms.filter(p => p !== platform)
      : [...searchFilters.platforms, platform];
    setSearchFilters({ platforms: newPlatforms });
  };

  const handleLicenseToggle = (license: string) => {
    const current = searchFilters.licenses ?? [];
    const newLicenses = current.includes(license)
      ? current.filter(l => l !== license)
      : [...current, license];
    setSearchFilters({ licenses: newLicenses });
  };

  const clearFilters = () => {
    setSearchQuery('');
    setIsRealTimeSearch(false);
    setSearchFilters({
      query: '',
      tags: [],
      languages: [],
      platforms: [],
      licenses: [],
      sortBy: 'stars',
      sortOrder: 'desc',
      minStars: undefined,
      maxStars: undefined,
      isAnalyzed: undefined,
      isSubscribed: undefined,
      isEdited: undefined,
      isCategoryLocked: undefined,
      analysisFailed: undefined,
      healthArchived: undefined,
      healthRecentActivity: undefined,
      healthHasLicense: undefined,
    });
  };

  const activeFiltersCount =
    searchFilters.languages.length +
    searchFilters.tags.length +
    searchFilters.platforms.length +
    (searchFilters.licenses?.length ?? 0) +
    (searchFilters.minStars !== undefined ? 1 : 0) +
    (searchFilters.maxStars !== undefined ? 1 : 0) +
    (searchFilters.isAnalyzed !== undefined ? 1 : 0) +
    (searchFilters.isSubscribed !== undefined ? 1 : 0) +
    (searchFilters.isEdited !== undefined ? 1 : 0) +
    (searchFilters.isCategoryLocked !== undefined ? 1 : 0) +
    (searchFilters.analysisFailed !== undefined ? 1 : 0) +
    (searchFilters.healthArchived !== undefined ? 1 : 0) +
    (searchFilters.healthRecentActivity !== undefined ? 1 : 0) +
    (searchFilters.healthHasLicense !== undefined ? 1 : 0);

  // 平台图标与显示名统一由 platformMeta 模块提供

  const t = useT('app');

  // 同步星标仓库及 list：先确认（警告会覆盖未锁定仓库的分类并加锁），再执行。
  // 'auto'/'stars-only' 入口原无确认，勿加（B8）。
  const handleStarAndListSync = async () => {

    const confirmed = await confirm(
      t('searchBar.sync-starred-repos-lists'),
      t('searchBar.sync-lists-confirm-body'),
      { type: 'warning' }
    );
    if (!confirmed) return;
    await syncStars('stars-and-lists');
  };

  const formatLastSync = (timestamp: string | null) => {
    if (!timestamp) return t('searchBar.never');
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return t('searchBar.never');
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours < 1) return t('searchBar.just-now');
    if (diffHours < 24) return t('searchBar.diffhours-h-ago', { diffHours: diffHours });
    return date.toLocaleDateString(getIntlLocale(language));
  };

  // 全局快捷键支持（Ctrl/Cmd+K、Ctrl/Cmd+Shift+F、/、Escape）
  useSearchShortcuts({
    onFocusSearch: () => {
      searchInputRef.current?.focus();
      if (!searchQuery && searchHistory.length > 0) {
        setShowSearchHistory(true);
      }
    },
    onClearSearch: () => {
      handleClearSearch();
      searchInputRef.current?.focus();
    },
    onToggleFilters: () => {
      setShowFilters(prev => !prev);
    },
  });

  return (
    <TooltipProvider>
      <div className="ui-toolbar p-4 sm:p-5 mb-5">
      {/* Search Input */}
      <div className="relative z-40 mb-4">
        <div className="flex min-w-0 items-center gap-2">
          <div className="relative min-w-0 flex-1">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground dark:text-muted-foreground/70 w-5 h-5" />
        <Input
          ref={searchInputRef}
          type="text"
          aria-label={t('searchBar.search-repositories')}
          aria-expanded={showSearchHistory || showSuggestions}
          aria-controls={showSearchHistory ? 'search-history-dropdown' : showSuggestions ? 'search-suggestions-dropdown' : undefined}
          placeholder={t('searchBar.type-keywords-for-real-time-search-or-use-ai-sea')}
          value={searchQuery}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={handleInputFocus}
          onBlur={handleInputBlur}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          className="h-10 w-full pl-10 pr-3"
        />

        {/* Search History Dropdown */}
        {showSearchHistory && searchHistory.length > 0 && (
          <div
            id="search-history-dropdown"
            ref={searchDropdownRef}
            className="absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded-md border border-border bg-popover text-popover-foreground shadow-md"
          >
            <div className="p-2 border-b border-border/60 dark:border-border/60 flex items-center justify-between">
              <span className="text-sm font-medium text-foreground dark:text-muted-foreground">
                {t('searchBar.search-history')}
              </span>
              <Button
                type="button"
                variant="ghost"
                onClick={clearSearchHistory}
                className="text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                {t('searchBar.clear')}
              </Button>
            </div>
            {searchHistory.map((historyQuery, index) => (
              <Button
                type="button"
                variant="ghost"
                key={index}
                data-search-option
                onClick={() => handleHistoryItemClick(historyQuery)}
                onKeyDown={(e) => handleSearchOptionKeyDown(e, index)}
                className="flex w-full items-center justify-start space-x-2 px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent"
              >
                <Search className="w-4 h-4 text-muted-foreground dark:text-muted-foreground/70" />
                <span className="truncate">{historyQuery}</span>
              </Button>
            ))}
          </div>
        )}

        {/* Search Suggestions Dropdown */}
        {showSuggestions && (
          <div
            id="search-suggestions-dropdown"
            ref={searchDropdownRef}
            className="absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded-md border border-border bg-popover text-popover-foreground shadow-md"
          >
            <div className="p-2 border-b border-border/60 dark:border-border/60">
              <span className="text-sm font-medium text-foreground dark:text-muted-foreground">
                {t('searchBar.search-suggestions')}
              </span>
            </div>
            {searchSuggestions
              .filter(suggestion =>
                suggestion.toLowerCase().includes(searchQuery.toLowerCase()) &&
                suggestion.toLowerCase() !== searchQuery.toLowerCase()
              )
              .slice(0, 5)
              .map((suggestion, index) => (
                <Button
                  type="button"
                  variant="ghost"
                  key={index}
                  data-search-option
                  onClick={() => handleSuggestionClick(suggestion)}
                  onKeyDown={(e) => handleSearchOptionKeyDown(e, index)}
                  className="flex w-full items-center justify-start space-x-2 px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent"
                >
                  <div className="w-4 h-4 flex items-center justify-center">
                    <div className="w-2 h-2 bg-muted dark:bg-muted/40 rounded-full"></div>
                  </div>
                  <span className="truncate">{suggestion}</span>
                </Button>
              ))}
          </div>
        )}
          </div>
          <div className="relative flex shrink-0 items-center gap-1 sm:gap-2">
          {searchQuery && (
            <Button
              type="button"
              variant="ghost"
              onClick={handleClearSearch}
              aria-label={t('searchBar.clear-search')}
              size="icon"
              className="h-8 w-8 text-muted-foreground"
              title={t('searchBar.clear-search')}
            >
              <X className="w-4 h-4" />
            </Button>
          )}
          <Button
            onClick={handleAISearch}
            variant="default"
            aria-label={isSearching ? t('searchBar.ai-searching') : t('searchBar.ai-search')}
            disabled={isSearching || !searchQuery.trim()}
            className="flex shrink-0 items-center sm:px-4"
            title={activeAIConfig
              ? t('searchBar.use-configured-ai-service-for-semantic-search-an')
              : t('searchBar.use-local-intelligent-ranking-algorithm-for-sear')}
          >
            <Bot className="w-4 h-4" />
            <span className="hidden sm:inline">{isSearching ? t('searchBar.ai-searching') : t('searchBar.ai-search')}</span>
          </Button>
          {isSearching && searchPhase && (
            <span className="max-w-[12rem] truncate text-xs text-muted-foreground dark:text-muted-foreground animate-pulse whitespace-nowrap">
              {searchPhase}
            </span>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t('searchBar.about-ai-search')}
                className="h-8 w-8 shrink-0 text-muted-foreground"
              >
                <AlertCircle className="h-4 w-4" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="end" className="w-80 max-w-xs whitespace-normal break-words text-left">
              <p className="mb-1 font-medium">{t('searchBar.about-ai-search-2')}</p>
              <p className="leading-relaxed text-primary-foreground/80">
                {activeAIConfig ? t('searchBar.ai-semantic-search-mode-uses-configured-ai-servi') : t('searchBar.fallback-mode-basic-text-search-with-default-sor')}
              </p>
            </TooltipContent>
          </Tooltip>
          </div>
        </div>
      </div>

      {/* Search Status Indicator */}
      {searchQuery && (
        <div className="mb-4 flex items-center justify-between text-sm">
          <div className="flex items-center space-x-2">
            {isRealTimeSearch ? (
              <div className="flex items-center space-x-2 text-primary dark:text-primary">
                <div className="w-2 h-2 bg-primary rounded-full animate-pulse"></div>
                <span>{t('searchBar.real-time-search-mode-matching-repository-names')}</span>
              </div>
            ) : searchFilters.query ? (
              <div className="flex items-center space-x-2 text-muted-foreground dark:text-muted-foreground ">
                <Bot className="w-4 h-4" />
                <span>{t('searchBar.ai-semantic-search-mode-intelligent-matching-and')}</span>
              </div>
            ) : null}
          </div>
          {isRealTimeSearch && (
            <div className="text-muted-foreground dark:text-muted-foreground">
              {t('searchBar.press-enter-or-click-ai-search-for-deep-search')}
            </div>
          )}
        </div>
      )}

      {/* Filter Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <Button
            variant="ghost"
            aria-expanded={showFilters}
            aria-controls="advanced-filters-panel"
            onClick={() => setShowFilters(!showFilters)}
            className={`linear-filter-toggle flex items-center space-x-2 px-3 py-2 text-sm ${
              showFilters || activeFiltersCount > 0 ? 'is-active' : ''
            }`}
          >
            <SlidersHorizontal className="w-4 h-4" />
            <span>{t('searchBar.filters')}</span>
            {activeFiltersCount > 0 && (
              <span className="bg-primary text-primary-foreground rounded-full px-2 py-0.5 text-xs">
                {activeFiltersCount}
              </span>
            )}
          </Button>

          <Button
            type="button"
            variant="ghost"
            onClick={openGlobalChatHistory}
            className="linear-filter-toggle flex items-center space-x-2 px-3 py-2 text-sm"
            aria-label={t('searchBar.chat-history')}
            title={t('searchBar.view-chat-history-across-repositories')}
          >
            <History className="w-4 h-4" aria-hidden="true" />
            <span>{t('searchBar.chat-history')}</span>
            {globalHistoryCount > 0 && (
              <span className="bg-primary text-primary-foreground rounded-full px-2 py-0.5 text-xs">
                {globalHistoryCount > 99 ? '99+' : globalHistoryCount}
              </span>
            )}
          </Button>

          {activeFiltersCount > 0 && (
            <Button
              variant="ghost"
              onClick={clearFilters}
              className="flex items-center space-x-1 px-3 py-2 text-sm text-muted-foreground dark:text-muted-foreground hover:text-foreground dark:hover:text-muted-foreground transition-colors"
            >
              <X className="w-4 h-4" />
              <span>{t('searchBar.clear-all')}</span>
            </Button>
          )}

        </div>

        {/* Sort Controls + Sync Button */}
        <div className="flex items-center gap-2 relative z-30">
          <SortByDropdown
            value={searchFilters.sortBy}
            onChange={(value) => setSearchFilters({ sortBy: value as 'stars' | 'updated' | 'name' | 'starred' })}
          />
          <Button
            onClick={() => setSearchFilters({
              sortOrder: searchFilters.sortOrder === 'desc' ? 'asc' : 'desc'
            })}
            variant="ghost"
            aria-label={searchFilters.sortOrder === 'desc' ? t('searchBar.sort-descending') : t('searchBar.sort-ascending')}
            className="ui-button px-3 py-2 text-sm"
          >
            {searchFilters.sortOrder === 'desc' ? <ArrowDown className="w-4 h-4" aria-hidden="true" /> : <ArrowUp className="w-4 h-4" aria-hidden="true" />}
          </Button>

          {/* Sync Button */}
          <div className="flex items-center gap-2 ml-1">
            <DropdownMenu>
              <div className="flex items-center">
                <div className="ui-button-primary inline-flex items-stretch overflow-hidden">
                  <Button
                    type="button"
                    onClick={() => { void syncStars(); }}
                    disabled={isSyncingStars}
                    className="inline-flex items-center gap-1.5 rounded-none border-0 bg-transparent px-3 py-2 text-inherit shadow-none hover:bg-primary/90 disabled:opacity-50"
                    title={t('searchBar.sync-starred-repositories')}
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isSyncingStars ? 'animate-spin' : ''}`} />
                    <span className="whitespace-nowrap">{t('searchBar.sync')}</span>
                  </Button>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      disabled={isSyncingStars}
                      aria-label={t('searchBar.more-sync-options')}
                      className="group inline-flex items-center rounded-none border-0 bg-transparent px-1.5 py-2 text-inherit shadow-none hover:bg-primary/90 disabled:opacity-50"
                      title={t('searchBar.more-sync-options')}
                    >
                      <ChevronDown className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180" />
                    </Button>
                  </DropdownMenuTrigger>
                </div>
              </div>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuItem
                  disabled={isSyncingStars}
                  onSelect={() => { void syncStars('stars-only'); }}
                  className="justify-start text-sm"
                >
                  <span className="whitespace-nowrap">{t('searchBar.sync-starred-repos-only')}</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={isSyncingStars}
                  onSelect={() => { void handleStarAndListSync(); }}
                  className="justify-start text-sm"
                >
                  <span className="whitespace-nowrap">{t('searchBar.sync-starred-repos-lists')}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t('searchBar.last-synced')}
                  className="h-8 w-8 shrink-0 text-muted-foreground"
                >
                  <Clock className="h-4 w-4" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="end" className="whitespace-nowrap">
                <p className="font-medium">{t('searchBar.last-synced')}</p>
                <p className="mt-1 text-primary-foreground/80">{formatLastSync(lastSync)}</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>

      {/* Advanced Filters */}
      {showFilters && (
        <div id="advanced-filters-panel" className="mt-5 pt-5 border-t ui-divider space-y-5">
          {/* Status Filters */}
          <div>
            <h4 className="text-sm font-medium text-foreground dark:text-foreground mb-3">
              {t('searchBar.status-filters')}
            </h4>
            <div className="flex flex-wrap gap-2">
              {/* 已AI分析 - 仅在存在已分析仓库或当前已选择时显示，且与"分析失败"互斥 */}
              {(statusStats.analyzed > 0 || searchFilters.isAnalyzed === true) && searchFilters.analysisFailed !== true && (
                <Button
                  onClick={() => setSearchFilters({ 
                    isAnalyzed: searchFilters.isAnalyzed === true ? undefined : true 
                  })}
                  aria-pressed={searchFilters.isAnalyzed === true}
                  title={t('searchBar.show-repositories-with-ai-analysis-completed')}
                  variant="ghost"
                  className={`${filterChipBaseClass} ${
                    searchFilters.isAnalyzed === true
                      ? filterChipActiveClass
                      : filterChipInactiveClass
                  }`}
                >
                  <CheckCircle className="w-4 h-4" />
                  <span>{t('searchBar.ai-analyzed')}</span>
                  <span className="text-xs opacity-70">({statusStats.analyzed})</span>
                </Button>
              )}
              {/* 未AI分析 - 仅在存在未分析仓库时显示 */}
              {statusStats.notAnalyzed > 0 && (
                <Button
                  onClick={() => setSearchFilters({ 
                    isAnalyzed: searchFilters.isAnalyzed === false ? undefined : false 
                  })}
                  aria-pressed={searchFilters.isAnalyzed === false}
                  title={t('searchBar.show-repositories-without-ai-analysis')}
                  variant="ghost"
                  className={`${filterChipBaseClass} ${
                    searchFilters.isAnalyzed === false
                      ? filterChipActiveClass
                      : filterChipInactiveClass
                  }`}
                >
                  <X className="w-4 h-4" />
                  <span>{t('searchBar.not-analyzed')}</span>
                  <span className="text-xs opacity-70">({statusStats.notAnalyzed})</span>
                </Button>
              )}
              {/* 分析失败 - 仅在存在失败仓库或当前已选择时显示，且与"已AI分析"互斥 */}
              {(statusStats.failed > 0 || searchFilters.analysisFailed === true) && searchFilters.isAnalyzed !== true && (
                <Button
                  onClick={() => setSearchFilters({ 
                    analysisFailed: searchFilters.analysisFailed === true ? undefined : true 
                  })}
                  aria-pressed={searchFilters.analysisFailed === true}
                  title={t('searchBar.show-repositories-with-failed-ai-analysis')}
                  variant="ghost"
                  className={`${filterChipBaseClass} ${
                    searchFilters.analysisFailed === true
                      ? filterChipActiveClass
                      : filterChipInactiveClass
                  }`}
                >
                  <AlertCircle className="w-4 h-4" />
                  <span>{t('searchBar.analysis-failed')}</span>
                  <span className="text-xs opacity-70">({statusStats.failed})</span>
                </Button>
              )}
              {/* 已订阅Release - 仅在存在已订阅仓库或当前已选择时显示 */}
              {(statusStats.subscribed > 0 || searchFilters.isSubscribed === true) && (
                <Button
                  onClick={() => setSearchFilters({ 
                    isSubscribed: searchFilters.isSubscribed === true ? undefined : true 
                  })}
                  aria-pressed={searchFilters.isSubscribed === true}
                  title={t('searchBar.show-repositories-subscribed-to-release-notifica')}
                  variant="ghost"
                  className={`${filterChipBaseClass} ${
                    searchFilters.isSubscribed === true
                      ? filterChipActiveClass
                      : filterChipInactiveClass
                  }`}
                >
                  <Bell className="w-4 h-4" />
                  <span>{t('searchBar.subscribed-to-releases')}</span>
                  <span className="text-xs opacity-70">({statusStats.subscribed})</span>
                </Button>
              )}
              {/* 未订阅Release - 仅在存在未订阅仓库时显示 */}
              {statusStats.notSubscribed > 0 && (
                <Button
                  onClick={() => setSearchFilters({ 
                    isSubscribed: searchFilters.isSubscribed === false ? undefined : false 
                  })}
                  aria-pressed={searchFilters.isSubscribed === false}
                  title={t('searchBar.show-repositories-not-subscribed-to-releases')}
                  variant="ghost"
                  className={`${filterChipBaseClass} ${
                    searchFilters.isSubscribed === false
                      ? filterChipActiveClass
                      : filterChipInactiveClass
                  }`}
                >
                  <BellOff className="w-4 h-4" />
                  <span>{t('searchBar.not-subscribed-to-releases')}</span>
                  <span className="text-xs opacity-70">({statusStats.notSubscribed})</span>
                </Button>
              )}
              {/* 已自定义 - 仅在存在已自定义仓库或当前已选择时显示 */}
              {(statusStats.edited > 0 || searchFilters.isEdited === true) && (
                <Button
                  onClick={() => setSearchFilters({
                    isEdited: searchFilters.isEdited === true ? undefined : true
                  })}
                  aria-pressed={searchFilters.isEdited === true}
                  title={t('searchBar.show-customized-repositories-including-custom-de')}
                  variant="ghost"
                  className={`${filterChipBaseClass} ${
                    searchFilters.isEdited === true
                      ? filterChipActiveClass
                      : filterChipInactiveClass
                  }`}
                >
                  <Edit3 className="w-4 h-4" />
                  <span>{t('searchBar.customized')}</span>
                  <span className="text-xs opacity-70">({statusStats.edited})</span>
                </Button>
              )}
              {/* 分类已锁定 - 仅在存在已锁定仓库或当前已选择时显示 */}
              {(statusStats.locked > 0 || searchFilters.isCategoryLocked === true) && (
                <Button
                  onClick={() => setSearchFilters({
                    isCategoryLocked: searchFilters.isCategoryLocked === true ? undefined : true
                  })}
                  aria-pressed={searchFilters.isCategoryLocked === true}
                  title={t('searchBar.show-repositories-with-locked-category-won-t-aut')}
                  variant="ghost"
                  className={`${filterChipBaseClass} ${
                    searchFilters.isCategoryLocked === true
                      ? filterChipActiveClass
                      : filterChipInactiveClass
                  }`}
                >
                  <Lock className="w-4 h-4" />
                  <span>{t('searchBar.category-locked')}</span>
                  <span className="text-xs opacity-70">({statusStats.locked})</span>
                </Button>
              )}
              {/* 分类未锁定 - 仅在存在未锁定仓库或当前已选择时显示 */}
              {(statusStats.notLocked > 0 || searchFilters.isCategoryLocked === false) && (
                <Button
                  onClick={() => setSearchFilters({
                    isCategoryLocked: searchFilters.isCategoryLocked === false ? undefined : false
                  })}
                  aria-pressed={searchFilters.isCategoryLocked === false}
                  title={t('searchBar.show-repositories-with-unlocked-category-may-be')}
                  variant="ghost"
                  className={`${filterChipBaseClass} ${
                    searchFilters.isCategoryLocked === false
                      ? filterChipActiveClass
                      : filterChipInactiveClass
                  }`}
                >
                  <Unlock className="w-4 h-4" />
                  <span>{t('searchBar.category-unlocked')}</span>
                  <span className="text-xs opacity-70">({statusStats.notLocked})</span>
                </Button>
              )}
            </div>
          </div>

          {/* Languages */}
          {availableLanguages.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-foreground dark:text-foreground mb-3">
                {t('searchBar.programming-languages')}
              </h4>
              <div className="flex flex-wrap gap-2">
                {availableLanguages.slice(0, 12).map(language => (
                  <Button
                    key={language}
                    onClick={() => handleLanguageToggle(language)}
                    aria-pressed={searchFilters.languages.includes(language)}
                    variant="ghost"
                    className={`${filterTagBaseClass} ${
                      searchFilters.languages.includes(language)
                        ? filterChipActiveClass
                        : filterChipInactiveClass
                    }`}
                  >
                    {language}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Platforms */}
          {availablePlatforms.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-foreground dark:text-foreground mb-3">
                {t('searchBar.supported-platforms')}
              </h4>
              <div className="flex flex-wrap gap-2">
                {availablePlatforms.map(platform => (
                  <Button
                    key={platform}
                    onClick={() => handlePlatformToggle(platform)}
                    aria-pressed={searchFilters.platforms.includes(platform)}
                    variant="ghost"
                  className={`${filterChipBaseClass} ${
                      searchFilters.platforms.includes(platform)
                        ? filterChipActiveClass
                        : filterChipInactiveClass
                    }`}
                  >
                    {React.createElement(getPlatformIcon(platform), { className: "w-4 h-4" })}
                    <span>{getPlatformDisplayName(platform)}</span>
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Licenses */}
          {availableLicenses.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-foreground dark:text-foreground mb-3">
                {t('searchBar.license')}
              </h4>
              <div className="flex flex-wrap gap-2">
                {availableLicenses.map(license => (
                  <Button
                    key={license}
                    onClick={() => handleLicenseToggle(license)}
                    aria-pressed={(searchFilters.licenses ?? []).includes(license)}
                    variant="ghost"
                    className={`${filterTagBaseClass} ${
                      (searchFilters.licenses ?? []).includes(license)
                        ? filterChipActiveClass
                        : filterChipInactiveClass
                    }`}
                  >
                    {license === NO_LICENSE_SENTINEL
                      ? t('searchBar.no-license')
                      : license}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Tags */}
          {availableTags.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-foreground dark:text-foreground mb-3">
                {t('searchBar.tags')}
              </h4>
              <div className="flex flex-wrap gap-2">
                {availableTags.slice(0, 15).map(tag => (
                  <Button
                    key={tag}
                    onClick={() => handleTagToggle(tag)}
                    aria-pressed={searchFilters.tags.includes(tag)}
                    variant="ghost"
                    className={`${filterTagBaseClass} ${
                      searchFilters.tags.includes(tag)
                        ? filterChipActiveClass
                        : filterChipInactiveClass
                    }`}
                  >
                    {tag}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Star Range */}
          <div>
            <h4 className="text-sm font-medium text-foreground dark:text-foreground mb-3">
              {t('searchBar.star-count-range')}
            </h4>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:space-x-4 sm:gap-4">
              <div className="flex items-center space-x-2">
                <label htmlFor="minimum-stars" className="text-sm text-muted-foreground dark:text-muted-foreground">
                  {t('searchBar.min')}
                </label>
                <NumberInput
                  id="minimum-stars"
                  value={searchFilters.minStars}
                  onChange={(v) => setSearchFilters({ minStars: v })}
                  min={0}
                  step={1}
                  placeholder="0"
                  allowUndefined
                  className="w-24 text-sm py-1.5 dark:bg-muted/40"
                />
              </div>
              <div className="flex items-center space-x-2">
                <label htmlFor="maximum-stars" className="text-sm text-muted-foreground dark:text-muted-foreground">
                  {t('searchBar.max')}
                </label>
                <NumberInput
                  id="maximum-stars"
                  value={searchFilters.maxStars}
                  onChange={(v) => setSearchFilters({ maxStars: v })}
                  min={0}
                  step={1}
                  placeholder="∞"
                  allowUndefined
                  className="w-24 text-sm py-1.5 dark:bg-muted/40"
                />
              </div>
            </div>
            {searchFilters.minStars !== undefined && searchFilters.maxStars !== undefined && searchFilters.minStars > searchFilters.maxStars && (
              <p className="text-xs text-destructive mt-1.5 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                {t('searchBar.min-cannot-be-greater-than-max')}
              </p>
            )}
            <div className="flex flex-wrap gap-1.5 mt-2">
              {[
                { label: '1K', value: 1000 },
                { label: '5K', value: 5000 },
                { label: '10K', value: 10000 },
                { label: '50K', value: 50000 },
                { label: '100K', value: 100000 },
              ].map((preset) => (
                <Button
                  key={preset.label}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSearchFilters({ minStars: preset.value })}
                  className="h-7 rounded px-2 text-xs text-muted-foreground transition-colors hover:bg-accent"
                >
                  ≥{preset.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Repository Health 客观事实过滤（见 src/utils/repositoryHealth.ts）。
              这里刻意不放「健康 / 不健康」之类主观筛选，只按可验证事实过滤。 */}
          <div>
            <h4 className="text-sm font-medium text-foreground dark:text-foreground mb-3">
              {t('searchBar.repository-health-facts')}
            </h4>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => setSearchFilters({
                  healthArchived: searchFilters.healthArchived === true ? undefined : true,
                })}
                aria-pressed={searchFilters.healthArchived === true}
                title={t('searchBar.show-only-archived-repositories')}
                variant="ghost"
                className={`${filterChipBaseClass} ${
                  searchFilters.healthArchived === true ? filterChipActiveClass : filterChipInactiveClass
                }`}
              >
                <Archive className="w-4 h-4" />
                <span>{t('searchBar.archived')}</span>
              </Button>
              <Button
                onClick={() => setSearchFilters({
                  healthRecentActivity: searchFilters.healthRecentActivity === true ? undefined : true,
                })}
                aria-pressed={searchFilters.healthRecentActivity === true}
                title={t('searchBar.show-only-repositories-pushed-within-the-last-12')}
                variant="ghost"
                className={`${filterChipBaseClass} ${
                  searchFilters.healthRecentActivity === true ? filterChipActiveClass : filterChipInactiveClass
                }`}
              >
                <Clock className="w-4 h-4" />
                <span>{t('searchBar.pushed-in-12-months')}</span>
              </Button>
              <Button
                onClick={() => setSearchFilters({
                  healthHasLicense: searchFilters.healthHasLicense === false ? undefined : false,
                })}
                aria-pressed={searchFilters.healthHasLicense === false}
                title={t('searchBar.show-only-repositories-without-a-declared-licens')}
                variant="ghost"
                className={`${filterChipBaseClass} ${
                  searchFilters.healthHasLicense === false ? filterChipActiveClass : filterChipInactiveClass
                }`}
              >
                <AlertCircle className="w-4 h-4" />
                <span>{t('searchBar.no-declared-license')}</span>
              </Button>
            </div>
          </div>
        </div>
      )}


      </div>
    </TooltipProvider>
  );
};
