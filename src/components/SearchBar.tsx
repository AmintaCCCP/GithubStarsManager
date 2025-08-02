import React, { useState, useEffect, useRef } from 'react';
import { Search, Filter, X, SlidersHorizontal, Monitor, Smartphone, Globe, Terminal, Package, CheckCircle, Bell, BellOff, Apple, Bot } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { AIService } from '../services/aiService';

export const SearchBar: React.FC = () => {
  const {
    searchFilters,
    repositories,
    releaseSubscriptions,
    aiConfigs,
    activeAIConfig,
    language,
    setSearchFilters,
    setSearchResults,
  } = useAppStore();
  
  const [showFilters, setShowFilters] = useState(false);
  const [searchQuery, setSearchQuery] = useState(searchFilters.query);
  const [isSearching, setIsSearching] = useState(false);
  const [availableLanguages, setAvailableLanguages] = useState<string[]>([]);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [availablePlatforms, setAvailablePlatforms] = useState<string[]>([]);
  const [isRealTimeSearch, setIsRealTimeSearch] = useState(false);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [showSearchHistory, setShowSearchHistory] = useState(false);
  const [searchSuggestions, setSearchSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Extract unique languages, tags, and platforms from repositories
    const languages = [...new Set(repositories.map(r => r.language).filter(Boolean))];
    const tags = [...new Set([
      ...repositories.flatMap(r => r.ai_tags || []),
      ...repositories.flatMap(r => r.topics || [])
    ])];
    const platforms = [...new Set(repositories.flatMap(r => r.ai_platforms || []))];
    
    setAvailableLanguages(languages);
    setAvailableTags(tags);
    setAvailablePlatforms(platforms);

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
    // Perform search when filters change (except query)
    const performSearch = async () => {
      if (searchFilters.query && !isSearching && !isRealTimeSearch) {
        setIsSearching(true);
        await performAdvancedSearch();
        setIsSearching(false);
      } else if (!searchFilters.query) {
        performBasicFilter();
      }
    };

    performSearch();
  }, [searchFilters, repositories, releaseSubscriptions]);

  // Real-time search effect for repository name matching
  useEffect(() => {
    if (searchQuery && isRealTimeSearch) {
      const timeoutId = setTimeout(() => {
        performRealTimeSearch(searchQuery);
      }, 300); // 300ms debounce to avoid too frequent searches

      return () => clearTimeout(timeoutId);
    } else if (!searchQuery) {
      // Reset to show all repositories when search is empty
      performBasicFilter();
    }
  }, [searchQuery, isRealTimeSearch, repositories]);

  // Handle composition events for better IME support (Chinese input)
  const handleCompositionStart = () => {
    // Pause real-time search during IME composition
    setIsRealTimeSearch(false);
  };

  const handleCompositionEnd = (e: React.CompositionEvent<HTMLInputElement>) => {
    // Resume real-time search after IME composition ends
    const value = e.currentTarget.value;
    if (value) {
      setIsRealTimeSearch(true);
    }
  };

  const performRealTimeSearch = (query: string) => {
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
  };

  const performAdvancedSearch = async () => {
    let filtered = repositories;

    // AI-powered natural language search with semantic understanding and re-ranking
    if (searchFilters.query) {
      const activeConfig = aiConfigs.find(config => config.id === activeAIConfig);
      if (activeConfig) {
        try {
          const aiService = new AIService(activeConfig, language);
          // Use enhanced AI search with semantic understanding and relevance scoring
          filtered = await aiService.searchRepositoriesWithReranking(filtered, searchFilters.query);
        } catch (error) {
          console.warn('AI search failed, falling back to basic search:', error);
          // Fallback to basic text search
          filtered = performBasicTextSearch(filtered, searchFilters.query);
        }
      } else {
        // Basic text search if no AI config
        filtered = performBasicTextSearch(filtered, searchFilters.query);
      }
    }

    // Apply other filters
    filtered = applyFilters(filtered);
    setSearchResults(filtered);
  };

  const performBasicFilter = () => {
    const filtered = applyFilters(repositories);
    setSearchResults(filtered);
  };

  const performBasicTextSearch = (repos: typeof repositories, query: string) => {
    const normalizedQuery = query.toLowerCase();
    
    return repos.filter(repo => {
      const searchableText = [
        repo.name,
        repo.full_name,
        repo.description || '',
        repo.language || '',
        ...(repo.topics || []),
        repo.ai_summary || '',
        ...(repo.ai_tags || []),
        ...(repo.ai_platforms || []),
      ].join(' ').toLowerCase();
      
      // Split query into words and check if all words are present
      const queryWords = normalizedQuery.split(/\s+/);
      return queryWords.every(word => searchableText.includes(word));
    });
  };

  const applyFilters = (repos: typeof repositories) => {
    let filtered = repos;

    // Language filter
    if (searchFilters.languages.length > 0) {
      filtered = filtered.filter(repo => 
        repo.language && searchFilters.languages.includes(repo.language)
      );
    }

    // Tag filter
    if (searchFilters.tags.length > 0) {
      filtered = filtered.filter(repo => {
        const repoTags = [...(repo.ai_tags || []), ...(repo.topics || [])];
        return searchFilters.tags.some(tag => repoTags.includes(tag));
      });
    }

    // Platform filter
    if (searchFilters.platforms.length > 0) {
      filtered = filtered.filter(repo => {
        const repoPlatforms = repo.ai_platforms || [];
        return searchFilters.platforms.some(platform => repoPlatforms.includes(platform));
      });
    }

    // AI analyzed filter
    if (searchFilters.isAnalyzed !== undefined) {
      filtered = filtered.filter(repo => 
        searchFilters.isAnalyzed ? !!repo.analyzed_at : !repo.analyzed_at
      );
    }

    // Release subscription filter
    if (searchFilters.isSubscribed !== undefined) {
      filtered = filtered.filter(repo => 
        searchFilters.isSubscribed ? releaseSubscriptions.has(repo.id) : !releaseSubscriptions.has(repo.id)
      );
    }

    // Star count filter
    if (searchFilters.minStars !== undefined) {
      filtered = filtered.filter(repo => repo.stargazers_count >= searchFilters.minStars!);
    }
    if (searchFilters.maxStars !== undefined) {
      filtered = filtered.filter(repo => repo.stargazers_count <= searchFilters.maxStars!);
    }

    // Sort
    filtered.sort((a, b) => {
      let aValue: any, bValue: any;
      
      switch (searchFilters.sortBy) {
        case 'stars':
          aValue = a.stargazers_count;
          bValue = b.stargazers_count;
          break;
        case 'updated':
          aValue = new Date(a.updated_at).getTime();
          bValue = new Date(b.updated_at).getTime();
          break;
        case 'name':
          aValue = a.name.toLowerCase();
          bValue = b.name.toLowerCase();
          break;
        case 'starred':
          aValue = a.starred_at ? new Date(a.starred_at).getTime() : 0;
          bValue = b.starred_at ? new Date(b.starred_at).getTime() : 0;
          break;
        default:
          aValue = new Date(a.updated_at).getTime();
          bValue = new Date(b.updated_at).getTime();
      }

      if (searchFilters.sortOrder === 'desc') {
        return bValue > aValue ? 1 : -1;
      } else {
        return aValue > bValue ? 1 : -1;
      }
    });

    return filtered;
  };

  const handleAISearch = () => {
    // Switch to AI search mode and trigger advanced search
    setIsRealTimeSearch(false);
    setSearchFilters({ query: searchQuery });
    
    // Add to search history if not empty and not already in history
    if (searchQuery.trim() && !searchHistory.includes(searchQuery.trim())) {
      const newHistory = [searchQuery.trim(), ...searchHistory.slice(0, 9)];
      setSearchHistory(newHistory);
      localStorage.setItem('github-stars-search-history', JSON.stringify(newHistory));
    }
    
    setShowSearchHistory(false);
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    setIsRealTimeSearch(false);
    setSearchFilters({ query: '' });
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchQuery(value);
    
    // Enable real-time search mode when user starts typing
    if (value && !isRealTimeSearch) {
      setIsRealTimeSearch(true);
    } else if (!value && isRealTimeSearch) {
      setIsRealTimeSearch(false);
    }

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

  const handleInputBlur = () => {
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

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleAISearch();
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

  const clearFilters = () => {
    setSearchQuery('');
    setIsRealTimeSearch(false);
    setSearchFilters({
      query: '',
      tags: [],
      languages: [],
      platforms: [],
      sortBy: 'stars',
      sortOrder: 'desc',
      minStars: undefined,
      maxStars: undefined,
      isAnalyzed: undefined,
      isSubscribed: undefined,
    });
  };

  const activeFiltersCount = 
    searchFilters.languages.length + 
    searchFilters.tags.length + 
    searchFilters.platforms.length +
    (searchFilters.minStars !== undefined ? 1 : 0) +
    (searchFilters.maxStars !== undefined ? 1 : 0) +
    (searchFilters.isAnalyzed !== undefined ? 1 : 0) +
    (searchFilters.isSubscribed !== undefined ? 1 : 0);

  const getPlatformIcon = (platform: string) => {
    const platformLower = platform.toLowerCase();
    
    switch (platformLower) {
      case 'mac':
      case 'macos':
      case 'ios':
        return Apple;
      case 'windows':
      case 'win':
        return Monitor;
      case 'linux':
        return Terminal;
      case 'android':
        return Smartphone;
      case 'web':
        return Globe;
      case 'cli':
        return Terminal;
      case 'docker':
        return Package;
      default:
        return Monitor;
    }
  };

  const getPlatformDisplayName = (platform: string) => {
    const platformLower = platform.toLowerCase();
    const nameMap: Record<string, string> = {
      mac: 'macOS',
      macos: 'macOS',
      windows: 'Windows',
      win: 'Windows',
      linux: 'Linux',
      ios: 'iOS',
      android: 'Android',
      web: 'Web',
      cli: 'CLI',
      docker: 'Docker',
    };
    return nameMap[platformLower] || platform;
  };

  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 mb-6">
      {/* Search Input */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
        <input
          ref={searchInputRef}
          type="text"
          placeholder={t(
            "输入关键词实时搜索，或使用AI搜索进行语义理解",
            "Type keywords for real-time search, or use AI search for semantic understanding"
          )}
          value={searchQuery}
          onChange={handleInputChange}
          onKeyPress={handleKeyPress}
          onFocus={handleInputFocus}
          onBlur={handleInputBlur}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          className="w-full pl-10 pr-40 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
        />

        {/* Search History Dropdown */}
        {showSearchHistory && searchHistory.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto">
            <div className="p-2 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('搜索历史', 'Search History')}
              </span>
              <button
                onClick={clearSearchHistory}
                className="text-xs text-gray-500 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
              >
                {t('清除', 'Clear')}
              </button>
            </div>
            {searchHistory.map((historyQuery, index) => (
              <button
                key={index}
                onClick={() => handleHistoryItemClick(historyQuery)}
                className="w-full px-3 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center space-x-2"
              >
                <Search className="w-4 h-4 text-gray-400" />
                <span className="truncate">{historyQuery}</span>
              </button>
            ))}
          </div>
        )}

        {/* Search Suggestions Dropdown */}
        {showSuggestions && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto">
            <div className="p-2 border-b border-gray-100 dark:border-gray-700">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('搜索建议', 'Search Suggestions')}
              </span>
            </div>
            {searchSuggestions
              .filter(suggestion =>
                suggestion.toLowerCase().includes(searchQuery.toLowerCase()) && 
                suggestion.toLowerCase() !== searchQuery.toLowerCase()
              )
              .slice(0, 5)
              .map((suggestion, index) => (
                <button
                  key={index}
                  onClick={() => handleSuggestionClick(suggestion)}
                  className="w-full px-3 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center space-x-2"
                >
                  <div className="w-4 h-4 flex items-center justify-center">
                    <div className="w-2 h-2 bg-blue-400 rounded-full"></div>
                  </div>
                  <span className="truncate">{suggestion}</span>
                </button>
              ))}
          </div>
        )}
        <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex items-center space-x-2">
          {searchQuery && (
            <button
              onClick={handleClearSearch}
              className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              title={t('清除搜索', 'Clear search')}
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={handleAISearch}
            disabled={isSearching}
            className="flex items-center space-x-1 px-4 py-1.5 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors text-sm font-medium disabled:opacity-50"
            title={t('使用AI进行语义搜索和智能排序', 'Use AI for semantic search and intelligent ranking')}
          >
            <Bot className="w-4 h-4" />
            <span>{isSearching ? t('AI搜索中...', 'AI Searching...') : t('AI搜索', 'AI Search')}</span>
          </button>
        </div>
      </div>

      {/* Search Status Indicator */}
      {searchQuery && (
        <div className="mb-4 flex items-center justify-between text-sm">
          <div className="flex items-center space-x-2">
            {isRealTimeSearch ? (
              <div className="flex items-center space-x-2 text-blue-600 dark:text-blue-400">
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                <span>{t('实时搜索模式 - 匹配仓库名称', 'Real-time search mode - matching repository names')}</span>
              </div>
            ) : searchFilters.query ? (
              <div className="flex items-center space-x-2 text-purple-600 dark:text-purple-400">
                <Bot className="w-4 h-4" />
                <span>{t('AI语义搜索模式 - 智能匹配和排序', 'AI semantic search mode - intelligent matching and ranking')}</span>
              </div>
            ) : null}
          </div>
          {isRealTimeSearch && (
            <div className="text-gray-500 dark:text-gray-400">
              {t('按回车键或点击AI搜索进行深度搜索', 'Press Enter or click AI Search for deep search')}
            </div>
          )}
        </div>
      )}

      {/* Filter Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-colors ${
              showFilters || activeFiltersCount > 0
                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            <SlidersHorizontal className="w-4 h-4" />
            <span>{t('过滤器', 'Filters')}</span>
            {activeFiltersCount > 0 && (
              <span className="bg-blue-600 text-white rounded-full px-2 py-0.5 text-xs">
                {activeFiltersCount}
              </span>
            )}
          </button>

          {activeFiltersCount > 0 && (
            <button
              onClick={clearFilters}
              className="flex items-center space-x-1 px-3 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
            >
              <X className="w-4 h-4" />
              <span>{t('清除全部', 'Clear all')}</span>
            </button>
          )}
        </div>

        {/* Sort Controls */}
        <div className="flex items-center space-x-3">
          <select
            value={searchFilters.sortBy}
            onChange={(e) => setSearchFilters({ 
              sortBy: e.target.value as 'stars' | 'updated' | 'name' | 'starred'
            })}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
          >
            <option value="stars">{t('按星标排序', 'Sort by Stars')}</option>
            <option value="updated">{t('按更新排序', 'Sort by Updated')}</option>
            <option value="name">{t('按名称排序', 'Sort by Name')}</option>
            <option value="starred">{t('按加星时间排序', 'Sort by Starred Time')}</option>
          </select>
          <button
            onClick={() => setSearchFilters({ 
              sortOrder: searchFilters.sortOrder === 'desc' ? 'asc' : 'desc' 
            })}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
          >
            {searchFilters.sortOrder === 'desc' ? '↓' : '↑'}
          </button>
        </div>
      </div>

      {/* Advanced Filters */}
      {showFilters && (
        <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700 space-y-6">
          {/* Status Filters */}
          <div>
            <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
              {t('状态过滤', 'Status Filters')}
            </h4>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setSearchFilters({ 
                  isAnalyzed: searchFilters.isAnalyzed === true ? undefined : true 
                })}
                className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  searchFilters.isAnalyzed === true
                    ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                    : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                <CheckCircle className="w-4 h-4" />
                <span>{t('已AI分析', 'AI Analyzed')}</span>
              </button>
              <button
                onClick={() => setSearchFilters({ 
                  isAnalyzed: searchFilters.isAnalyzed === false ? undefined : false 
                })}
                className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  searchFilters.isAnalyzed === false
                    ? 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300'
                    : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                <X className="w-4 h-4" />
                <span>{t('未AI分析', 'Not Analyzed')}</span>
              </button>
              <button
                onClick={() => setSearchFilters({ 
                  isSubscribed: searchFilters.isSubscribed === true ? undefined : true 
                })}
                className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  searchFilters.isSubscribed === true
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                    : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                <Bell className="w-4 h-4" />
                <span>{t('已订阅Release', 'Subscribed to Releases')}</span>
              </button>
              <button
                onClick={() => setSearchFilters({ 
                  isSubscribed: searchFilters.isSubscribed === false ? undefined : false 
                })}
                className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  searchFilters.isSubscribed === false
                    ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'
                    : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                <BellOff className="w-4 h-4" />
                <span>{t('未订阅Release', 'Not Subscribed to Releases')}</span>
              </button>
            </div>
          </div>

          {/* Languages */}
          {availableLanguages.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
                {t('编程语言', 'Programming Languages')}
              </h4>
              <div className="flex flex-wrap gap-2">
                {availableLanguages.slice(0, 12).map(language => (
                  <button
                    key={language}
                    onClick={() => handleLanguageToggle(language)}
                    className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                      searchFilters.languages.includes(language)
                        ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                        : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                  >
                    {language}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Platforms */}
          {availablePlatforms.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
                {t('支持平台', 'Supported Platforms')}
              </h4>
              <div className="flex flex-wrap gap-2">
                {availablePlatforms.map(platform => (
                  <button
                    key={platform}
                    onClick={() => handlePlatformToggle(platform)}
                    className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                      searchFilters.platforms.includes(platform)
                        ? 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300'
                        : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                  >
                    {React.createElement(getPlatformIcon(platform), { className: "w-4 h-4" })}
                    <span>{getPlatformDisplayName(platform)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Tags */}
          {availableTags.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
                {t('标签', 'Tags')}
              </h4>
              <div className="flex flex-wrap gap-2">
                {availableTags.slice(0, 15).map(tag => (
                  <button
                    key={tag}
                    onClick={() => handleTagToggle(tag)}
                    className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                      searchFilters.tags.includes(tag)
                        ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                        : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Star Range */}
          <div>
            <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
              {t('Star数量范围', 'Star Count Range')}
            </h4>
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <label className="text-sm text-gray-600 dark:text-gray-400">
                  {t('最小:', 'Min:')}
                </label>
                <input
                  type="number"
                  placeholder="0"
                  value={searchFilters.minStars || ''}
                  onChange={(e) => setSearchFilters({ 
                    minStars: e.target.value ? parseInt(e.target.value) : undefined 
                  })}
                  className="w-24 px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                />
              </div>
              <div className="flex items-center space-x-2">
                <label className="text-sm text-gray-600 dark:text-gray-400">
                  {t('最大:', 'Max:')}
                </label>
                <input
                  type="number"
                  placeholder="∞"
                  value={searchFilters.maxStars || ''}
                  onChange={(e) => setSearchFilters({ 
                    maxStars: e.target.value ? parseInt(e.target.value) : undefined 
                  })}
                  className="w-24 px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};