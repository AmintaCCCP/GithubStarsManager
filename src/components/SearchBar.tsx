import React, { useState, useEffect } from 'react';
import { Search, Filter, X, SlidersHorizontal, Monitor, Smartphone, Globe, Terminal, Package, CheckCircle, Bell, BellOff } from 'lucide-react';
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
  }, [repositories]);

  useEffect(() => {
    // Perform search when filters change (except query)
    const performSearch = async () => {
      if (searchFilters.query && !isSearching) {
        setIsSearching(true);
        await performAdvancedSearch();
        setIsSearching(false);
      } else if (!searchFilters.query) {
        performBasicFilter();
      }
    };

    performSearch();
  }, [searchFilters, repositories, releaseSubscriptions]);

  const performAdvancedSearch = async () => {
    let filtered = repositories;

    // AI-powered natural language search
    if (searchFilters.query) {
      const activeConfig = aiConfigs.find(config => config.id === activeAIConfig);
      if (activeConfig) {
        try {
          const aiService = new AIService(activeConfig, language);
          filtered = await aiService.searchRepositories(filtered, searchFilters.query);
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

  const handleSearch = () => {
    setSearchFilters({ query: searchQuery });
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    setSearchFilters({ query: '' });
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
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
    const iconMap: Record<string, string> = {
      mac: 'fab fa-apple',
      macos: 'fab fa-apple',
      windows: 'fab fa-windows',
      win: 'fab fa-windows',
      linux: 'fab fa-linux',
      ios: 'fab fa-apple',
      android: 'fab fa-android',
      web: 'fas fa-globe',
      cli: 'fas fa-terminal',
      docker: 'fab fa-docker',
    };
    return iconMap[platform.toLowerCase()] || 'fas fa-desktop';
  };

  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 mb-6">
      {/* Search Input */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
        <input
          type="text"
          placeholder={t(
            "使用自然语言搜索仓库 (例如: '查找所有笔记应用')",
            "Search repositories with natural language (e.g., 'find all note-taking apps')"
          )}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyPress={handleKeyPress}
          className="w-full pl-10 pr-32 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
        />
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
            onClick={handleSearch}
            disabled={isSearching}
            className="px-4 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm font-medium disabled:opacity-50"
          >
            {isSearching ? t('搜索中...', 'Searching...') : t('搜索', 'Search')}
          </button>
        </div>
      </div>

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
              sortBy: e.target.value as 'stars' | 'updated' | 'name' | 'created' 
            })}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
          >
            <option value="stars">{t('按星标排序', 'Sort by Stars')}</option>
            <option value="updated">{t('按更新排序', 'Sort by Updated')}</option>
            <option value="name">{t('按名称排序', 'Sort by Name')}</option>
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
                    <i className={`${getPlatformIcon(platform)} w-4 h-4`}></i>
                    <span>{platform}</span>
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