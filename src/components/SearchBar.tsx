import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, X, SlidersHorizontal, Monitor, Smartphone, Globe, Terminal, Package, CheckCircle, Bell, BellOff, Apple, Bot, Edit3, Lock, Unlock, AlertCircle } from 'lucide-react';
import { useAppStore, getAllCategories } from '../store/useAppStore';
import { AIService } from '../services/aiService';
import { Repository } from '../types';
import { useSearchShortcuts } from '../hooks/useSearchShortcuts';
import { getAICategory, getDefaultCategory } from '../utils/categoryUtils';
import { NumberInput } from './ui/NumberInput';


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
    customCategories,
    hiddenDefaultCategoryIds,
    defaultCategoryOverrides,
  } = useAppStore();
  
  const [showFilters, setShowFilters] = useState(false);
  const [searchQuery, setSearchQuery] = useState(searchFilters.query);
  const [isSearching, setIsSearching] = useState(false);
  const [availableLanguages, setAvailableLanguages] = useState<string[]>([]);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [availablePlatforms, setAvailablePlatforms] = useState<string[]>([]);
  const [isRealTimeSearch, setIsRealTimeSearch] = useState(false);
  
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
      
      // 自定义状态统计 - 与编辑页面逻辑一致
      // 描述：有自定义描述标记（包括明确清空），且内容与AI/原始不同
      const hasCustomDesc = repo.custom_description !== undefined;
      const repoDesc = (repo.description || '').trim();
      const aiDesc = (repo.ai_summary || '').trim();
      const customDesc = (repo.custom_description || '').trim();
      const isDescEdited = hasCustomDesc &&
        (customDesc === '' || (customDesc !== repoDesc && customDesc !== aiDesc));

      // 标签：有自定义标签标记（包括明确清空），且内容与AI/Topics不同
      const hasCustomTags = repo.custom_tags !== undefined;
      const aiTags = repo.ai_tags || [];
      const topics = repo.topics || [];
      const customTags = repo.custom_tags || [];
      const isTagsEdited = hasCustomTags &&
        (customTags.length === 0 || (
          JSON.stringify([...customTags].sort()) !== JSON.stringify([...aiTags].sort()) &&
          JSON.stringify([...customTags].sort()) !== JSON.stringify([...topics].sort())
        ));

      // 分类：有自定义分类标记（包括明确清空），且与AI/默认不一致
      const aiCat = getAICategory(repo, allCategories);
      const defaultCat = getDefaultCategory(repo, allCategories);
      const customCat = repo.custom_category;
      const isCategoryEdited = customCat !== undefined &&
        (customCat === '' || (customCat !== aiCat && customCat !== defaultCat));

      // 任意一个为true则视为已编辑（注意：分类锁定不算编辑）
      const isCustomized = isDescEdited || isTagsEdited || isCategoryEdited;
      if (isCustomized) {
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
    const performSearch = async () => {
      if (!searchFilters.query) {
        performBasicFilter();
      } else {
        const textResults = performBasicTextSearch(repositories, searchFilters.query);
        const finalFiltered = applyFilters(textResults, allCategories);
        setSearchResults(finalFiltered);
      }
    };

    performSearch();
  }, [searchFilters.languages, searchFilters.tags, searchFilters.platforms, searchFilters.isAnalyzed, searchFilters.isSubscribed, searchFilters.isEdited, searchFilters.isCategoryLocked, searchFilters.analysisFailed, searchFilters.minStars, searchFilters.maxStars, searchFilters.sortBy, searchFilters.sortOrder, searchFilters.query, repositories, releaseSubscriptions, allCategories]);

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
  }, [searchQuery, isRealTimeSearch, repositories, allCategories]);

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
    const finalFiltered = applyFilters(filtered, allCategories);
    setSearchResults(finalFiltered);
    
    const endTime = performance.now();
    console.log(`Real-time search completed in ${(endTime - startTime).toFixed(2)}ms`);
  };

  const performBasicFilter = () => {
    const filtered = applyFilters(repositories, allCategories);
    setSearchResults(filtered);
  };

  const performBasicTextSearch = (repos: typeof repositories, query: string) => {
    const normalizedQuery = query.toLowerCase();
    
    return repos.filter(repo => {
      const searchableText = [
        repo.name,
        repo.full_name,
        repo.description || '',
        repo.custom_description || '',
        repo.language || '',
        ...(repo.topics || []),
        repo.ai_summary || '',
        ...(repo.ai_tags || []),
        ...(repo.ai_platforms || []),
        ...(repo.custom_tags || []),
      ].join(' ').toLowerCase();
      
      const queryWords = normalizedQuery.split(/\s+/);
      return queryWords.every(word => searchableText.includes(word));
    });
  };

  const applyFilters = (repos: typeof repositories, categories: typeof allCategories) => {
    let filtered = repos;

    // Language filter
    if (searchFilters.languages.length > 0) {
      filtered = filtered.filter(repo => 
        repo.language && searchFilters.languages.includes(repo.language)
      );
    }

    // Tag filter - 包含AI标签、GitHub topics和用户自定义标签
    if (searchFilters.tags.length > 0) {
      filtered = filtered.filter(repo => {
        const repoTags = [
          ...(repo.ai_tags || []),
          ...(repo.topics || []),
          ...(repo.custom_tags || [])
        ];
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

    // AI analyzed filter - 与 analysisFailed 互斥
    if (searchFilters.isAnalyzed !== undefined && searchFilters.analysisFailed === undefined) {
      filtered = filtered.filter(repo => 
        searchFilters.isAnalyzed ? (!!repo.analyzed_at && !repo.analysis_failed) : !repo.analyzed_at
      );
    }

    // Release subscription filter
    if (searchFilters.isSubscribed !== undefined) {
      filtered = filtered.filter(repo => 
        searchFilters.isSubscribed ? releaseSubscriptions.has(repo.id) : !releaseSubscriptions.has(repo.id)
      );
    }

    // 自定义筛选 - 与编辑页面逻辑一致
    if (searchFilters.isEdited !== undefined) {
      filtered = filtered.filter(repo => {
        const hasCustomDesc = repo.custom_description !== undefined;
        const repoDesc = (repo.description || '').trim();
        const aiDesc = (repo.ai_summary || '').trim();
        const customDesc = (repo.custom_description || '').trim();
        const isDescEdited = hasCustomDesc &&
          (customDesc === '' || (customDesc !== repoDesc && customDesc !== aiDesc));

        const hasCustomTags = repo.custom_tags !== undefined;
        const aiTags = repo.ai_tags || [];
        const topics = repo.topics || [];
        const customTags = repo.custom_tags || [];
        const isTagsEdited = hasCustomTags &&
          (customTags.length === 0 || (
            JSON.stringify([...customTags].sort()) !== JSON.stringify([...aiTags].sort()) &&
            JSON.stringify([...customTags].sort()) !== JSON.stringify([...topics].sort())
          ));

        // 分类：有自定义分类标记（包括明确清空），且与AI/默认不一致
        const aiCat = getAICategory(repo, allCategories);
        const defaultCat = getDefaultCategory(repo, allCategories);
        const customCat = repo.custom_category;
        const isCategoryEdited = customCat !== undefined &&
          (customCat === '' || (customCat !== aiCat && customCat !== defaultCat));

        const isRepoCustomized = isDescEdited || isTagsEdited || isCategoryEdited;
        return searchFilters.isEdited ? isRepoCustomized : !isRepoCustomized;
      });
    }

    // Category locked filter - 检查分类是否被锁定
    if (searchFilters.isCategoryLocked !== undefined) {
      filtered = filtered.filter(repo => {
        const isLocked = !!repo.category_locked;
        return searchFilters.isCategoryLocked ? isLocked : !isLocked;
      });
    }

    // Analysis failed filter - 检查分析是否失败（需要有分析记录且标记为失败），与 isAnalyzed 互斥
    if (searchFilters.analysisFailed !== undefined && searchFilters.isAnalyzed === undefined) {
      filtered = filtered.filter(repo => {
        const hasFailed = !!(repo.analyzed_at && repo.analysis_failed);
        return searchFilters.analysisFailed ? hasFailed : !hasFailed;
      });
    }

    // Star count filter
    if (searchFilters.minStars !== undefined) {
      filtered = filtered.filter(repo => repo.stargazers_count >= searchFilters.minStars!);
    }
    if (searchFilters.maxStars !== undefined) {
      filtered = filtered.filter(repo => repo.stargazers_count <= searchFilters.maxStars!);
    }

    // Sort
    const getSortValue = (repo: Repository): number | string => {
      switch (searchFilters.sortBy) {
        case 'stars':
          return repo.stargazers_count;
        case 'updated':
          return new Date(repo.pushed_at || repo.updated_at).getTime();
        case 'name':
          return repo.name.toLowerCase();
        case 'starred':
          return repo.starred_at ? new Date(repo.starred_at).getTime() : 0;
        default:
          return new Date(repo.pushed_at || repo.updated_at).getTime();
      }
    };

    filtered.sort((a, b) => {
      const aValue = getSortValue(a);
      const bValue = getSortValue(b);
      if (aValue < bValue) return searchFilters.sortOrder === 'desc' ? 1 : -1;
      if (aValue > bValue) return searchFilters.sortOrder === 'desc' ? -1 : 1;
      return 0;
    });

    // 如果分类锁定筛选导致结果为0，自动清除该筛选条件
    if (searchFilters.isCategoryLocked !== undefined && filtered.length === 0) {
      // 检查是否是分类锁定筛选导致的结果为空
      const filteredWithoutCategoryLock = repos.filter(repo => {
        // 复制当前的筛选条件，但排除分类锁定
        let tempFiltered = true;

        // Language filter
        if (searchFilters.languages.length > 0) {
          tempFiltered = tempFiltered && !!(repo.language && searchFilters.languages.includes(repo.language));
        }

        // Tag filter
        if (searchFilters.tags.length > 0) {
          const repoTags = [...(repo.ai_tags || []), ...(repo.topics || []), ...(repo.custom_tags || [])];
          tempFiltered = tempFiltered && searchFilters.tags.some(tag => repoTags.includes(tag));
        }

        // Platform filter
        if (searchFilters.platforms.length > 0) {
          const repoPlatforms = repo.ai_platforms || [];
          tempFiltered = tempFiltered && searchFilters.platforms.some(platform => repoPlatforms.includes(platform));
        }

        // AI analyzed filter
        if (searchFilters.isAnalyzed !== undefined && searchFilters.analysisFailed === undefined) {
          tempFiltered = tempFiltered && (searchFilters.isAnalyzed ? (!!repo.analyzed_at && !repo.analysis_failed) : !repo.analyzed_at);
        }

        // Release subscription filter
        if (searchFilters.isSubscribed !== undefined) {
          tempFiltered = tempFiltered && (searchFilters.isSubscribed ? releaseSubscriptions.has(repo.id) : !releaseSubscriptions.has(repo.id));
        }

        // Edited filter
        if (searchFilters.isEdited !== undefined) {
          const hasCustomDesc = repo.custom_description !== undefined;
          const repoDesc = (repo.description || '').trim();
          const aiDesc = (repo.ai_summary || '').trim();
          const customDesc = (repo.custom_description || '').trim();
          const isDescEdited = hasCustomDesc &&
            (customDesc === '' || (customDesc !== repoDesc && customDesc !== aiDesc));
          const hasCustomTags = repo.custom_tags !== undefined;
          const aiTags = repo.ai_tags || [];
          const topics = repo.topics || [];
          const customTags = repo.custom_tags || [];
          const isTagsEdited = hasCustomTags &&
            (customTags.length === 0 || (
              JSON.stringify([...customTags].sort()) !== JSON.stringify([...aiTags].sort()) &&
              JSON.stringify([...customTags].sort()) !== JSON.stringify([...topics].sort())
            ));
          // 分类：有自定义分类标记（包括明确清空），且与AI/默认不一致
          const aiCat = getAICategory(repo, allCategories);
          const defaultCat = getDefaultCategory(repo, allCategories);
          const customCat = repo.custom_category;
          const isCategoryEdited = customCat !== undefined &&
            (customCat === '' || (customCat !== aiCat && customCat !== defaultCat));
          const isRepoCustomized = isDescEdited || isTagsEdited || isCategoryEdited;
          tempFiltered = tempFiltered && (searchFilters.isEdited ? isRepoCustomized : !isRepoCustomized);
        }

        // Analysis failed filter
        if (searchFilters.analysisFailed !== undefined && searchFilters.isAnalyzed === undefined) {
          const hasFailed = !!(repo.analyzed_at && repo.analysis_failed);
          tempFiltered = tempFiltered && (searchFilters.analysisFailed ? hasFailed : !hasFailed);
        }

        // Star count filter
        if (searchFilters.minStars !== undefined) {
          tempFiltered = tempFiltered && repo.stargazers_count >= searchFilters.minStars;
        }
        if (searchFilters.maxStars !== undefined) {
          tempFiltered = tempFiltered && repo.stargazers_count <= searchFilters.maxStars;
        }

        return tempFiltered;
      });

      // 如果去掉分类锁定筛选后有结果，说明是分类锁定导致的结果为空，自动清除
      if (filteredWithoutCategoryLock.length > 0) {
        console.log('分类锁定筛选导致结果为空，自动清除该筛选条件');
        setSearchFilters({ isCategoryLocked: undefined });
        // 返回去掉分类锁定筛选的结果
        return filteredWithoutCategoryLock.sort((a, b) => {
          const aValue = getSortValue(a);
          const bValue = getSortValue(b);
          if (aValue < bValue) return searchFilters.sortOrder === 'desc' ? 1 : -1;
          if (aValue > bValue) return searchFilters.sortOrder === 'desc' ? -1 : 1;
          return 0;
        });
      }
    }

    return filtered;
  };

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
    
    // Trigger AI search immediately
    setIsSearching(true);
    console.log('🔍 Starting AI search for query:', searchQuery);
    
    try {
      let filtered = repositories;
      
      const activeConfig = aiConfigs.find(config => config.id === activeAIConfig);
      console.log('🤖 AI Config found:', !!activeConfig, 'Active AI Config ID:', activeAIConfig);
      console.log('📋 Available AI Configs:', aiConfigs.length);
      console.log('🔧 AI Configs:', aiConfigs.map(c => ({ id: c.id, name: c.name, hasApiKey: !!c.apiKey })));
      
      if (activeConfig) {
        try {
          console.log('🚀 Calling AI service...');
          const aiService = new AIService(activeConfig, language);
          
          // 先尝试AI搜索
          const aiResults = await aiService.searchRepositoriesWithReranking(filtered, searchQuery);
          console.log('✅ AI search completed, results:', aiResults.length);
          
          filtered = aiResults;
        } catch (error) {
          console.warn('❌ AI search failed, falling back to basic search:', error);
          filtered = performBasicTextSearch(filtered, searchQuery);
          console.log('🔄 Basic search fallback results:', filtered.length);
        }
      } else {
        console.log('⚠️ No AI config found, using basic text search');
        // Basic text search if no AI config
        filtered = performBasicTextSearch(filtered, searchQuery);
        console.log('📝 Basic search results:', filtered.length);
      }
      
      // Apply other filters and update results
      const finalFiltered = applyFilters(filtered, allCategories);
      console.log('🎯 Final filtered results:', finalFiltered.length);
      console.log('📋 Final filtered repositories:', finalFiltered.map(r => r.name));
      setSearchResults(finalFiltered);
      
      // Update search filters to mark that AI search was performed
      setSearchFilters({ query: searchQuery });
    } catch (error) {
      console.error('💥 Search failed:', error);
    } finally {
      setIsSearching(false);
    }
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

    const textResults = performBasicTextSearch(repositories, historyQuery);
    const finalFiltered = applyFilters(textResults, allCategories);
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
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
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
      isEdited: undefined,
      isCategoryLocked: undefined,
      analysisFailed: undefined,
    });
  };

  const activeFiltersCount =
    searchFilters.languages.length +
    searchFilters.tags.length +
    searchFilters.platforms.length +
    (searchFilters.minStars !== undefined ? 1 : 0) +
    (searchFilters.maxStars !== undefined ? 1 : 0) +
    (searchFilters.isAnalyzed !== undefined ? 1 : 0) +
    (searchFilters.isSubscribed !== undefined ? 1 : 0) +
    (searchFilters.isEdited !== undefined ? 1 : 0) +
    (searchFilters.isCategoryLocked !== undefined ? 1 : 0) +
    (searchFilters.analysisFailed !== undefined ? 1 : 0);

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
    <div className="bg-white dark:bg-panel-dark rounded-xl border border-black/[0.06] dark:border-white/[0.04] p-4 sm:p-6 mb-6">
      {/* Search Input */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-text-quaternary w-5 h-5" />
        <input
          ref={searchInputRef}
          type="text"
          placeholder={t(
            "输入关键词实时搜索，或使用AI搜索进行语义理解",
            "Type keywords for real-time search, or use AI search for semantic understanding"
          )}
          value={searchQuery}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={handleInputFocus}
          onBlur={handleInputBlur}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          className="w-full pl-10 pr-24 sm:pr-40 py-3 border border-black/[0.06] dark:border-white/[0.04] rounded-lg focus:ring-2 focus:ring-brand-violet focus:border-transparent bg-white dark:bg-white/[0.04] text-gray-900 dark:text-text-primary placeholder-gray-500 dark:placeholder-gray-400"
        />

        {/* Search History Dropdown */}
        {showSearchHistory && searchHistory.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-panel-dark border border-black/[0.06] dark:border-white/[0.04] rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto">
            <div className="p-2 border-b border-black/[0.04] dark:border-white/[0.04] flex items-center justify-between">
              <span className="text-sm font-medium text-gray-900 dark:text-text-secondary">
                {t('搜索历史', 'Search History')}
              </span>
              <button
                onClick={clearSearchHistory}
                className="text-xs text-gray-500 dark:text-text-tertiary hover:text-gray-700 dark:text-text-secondary dark:hover:text-gray-700 dark:text-text-secondary transition-colors"
              >
                {t('清除', 'Clear')}
              </button>
            </div>
            {searchHistory.map((historyQuery, index) => (
              <button
                key={index}
                onClick={() => handleHistoryItemClick(historyQuery)}
                className="w-full px-3 py-2 text-left text-sm text-gray-900 dark:text-text-secondary hover:bg-light-bg dark:hover:bg-white/10 transition-colors flex items-center space-x-2"
              >
                <Search className="w-4 h-4 text-gray-400 dark:text-text-quaternary" />
                <span className="truncate">{historyQuery}</span>
              </button>
            ))}
          </div>
        )}

        {/* Search Suggestions Dropdown */}
        {showSuggestions && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-panel-dark border border-black/[0.06] dark:border-white/[0.04] rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto">
            <div className="p-2 border-b border-black/[0.04] dark:border-white/[0.04]">
              <span className="text-sm font-medium text-gray-900 dark:text-text-secondary">
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
                  className="w-full px-3 py-2 text-left text-sm text-gray-900 dark:text-text-secondary hover:bg-light-bg dark:hover:bg-white/10 transition-colors flex items-center space-x-2"
                >
                  <div className="w-4 h-4 flex items-center justify-center">
                    <div className="w-2 h-2 bg-gray-100 dark:bg-white/[0.04] rounded-full"></div>
                  </div>
                  <span className="truncate">{suggestion}</span>
                </button>
              ))}
          </div>
        )}
        <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex items-center space-x-1 sm:space-x-2">
          {searchQuery && (
            <button
              onClick={handleClearSearch}
              className="p-1.5 text-gray-400 dark:text-text-quaternary hover:text-gray-700 dark:text-text-secondary dark:hover:text-gray-300 transition-colors"
              title={t('清除搜索', 'Clear search')}
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={handleAISearch}
            disabled={isSearching}
            className="flex items-center space-x-1 px-2.5 sm:px-4 py-1.5 bg-brand-indigo text-white rounded-lg hover:bg-brand-hover transition-colors text-sm font-medium disabled:opacity-50"
            title={activeAIConfig 
              ? t('使用配置的AI服务进行语义搜索和重排序', 'Use configured AI service for semantic search and reranking')
              : t('使用本地智能排序算法进行搜索', 'Use local intelligent ranking algorithm for search')}
          >
            <Bot className="w-4 h-4" />
            <span className="hidden sm:inline">{isSearching ? t('AI搜索中...', 'AI Searching...') : t('AI搜索', 'AI Search')}</span>
          </button>
          <div className="group relative">
            <AlertCircle className="w-4 h-4 text-gray-400 dark:text-text-quaternary cursor-help" />
            <div className="absolute right-0 top-full mt-2 w-64 p-3 bg-gray-800 text-white text-xs rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
              <p className="font-medium mb-1">{t('关于AI搜索', 'About AI Search')}</p>
              <p className="text-gray-300">
                {activeAIConfig
                  ? t(
                      '已配置AI服务时，将调用AI进行语义搜索和智能重排序。未配置时使用本地算法根据仓库名称、描述、标签等多维度进行匹配和排序。',
                      'When AI service is configured, it will be called for semantic search and intelligent reranking. Otherwise, local algorithms are used to match and rank based on repository name, description, tags, and other dimensions.'
                    )
                  : t(
                      '此功能使用本地算法进行智能排序。配置AI服务后可启用语义搜索功能，获得更精准的搜索结果。',
                      'This feature uses local algorithms for intelligent ranking. Configure an AI service to enable semantic search for more accurate results.'
                    )}
              </p>
              <div className="absolute bottom-full right-2 w-2 h-2 bg-gray-800 transform rotate-45"></div>
            </div>
          </div>
        </div>
      </div>

      {/* Search Status Indicator */}
      {searchQuery && (
        <div className="mb-4 flex items-center justify-between text-sm">
          <div className="flex items-center space-x-2">
            {isRealTimeSearch ? (
              <div className="flex items-center space-x-2 text-brand-violet dark:text-brand-violet">
                <div className="w-2 h-2 bg-brand-violet rounded-full animate-pulse"></div>
                <span>{t('实时搜索模式 - 匹配仓库名称', 'Real-time search mode - matching repository names')}</span>
              </div>
            ) : searchFilters.query ? (
              <div className="flex items-center space-x-2 text-gray-700 dark:text-text-secondary ">
                <Bot className="w-4 h-4" />
                <span>{t('AI语义搜索模式 - 智能匹配和排序', 'AI semantic search mode - intelligent matching and ranking')}</span>
              </div>
            ) : null}
          </div>
          {isRealTimeSearch && (
            <div className="text-gray-500 dark:text-text-tertiary">
              {t('按回车键或点击AI搜索进行深度搜索', 'Press Enter or click AI Search for deep search')}
            </div>
          )}
        </div>
      )}

      {/* Filter Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-colors ${
              showFilters || activeFiltersCount > 0
                ? 'bg-brand-indigo/20 text-gray-700 dark:text-text-secondary dark:bg-brand-indigo/20 '
                : 'bg-white border border-black/[0.06] text-gray-700 dark:bg-white/[0.04] dark:border-white/[0.04] dark:text-text-secondary hover:bg-gray-50 hover:text-gray-900 dark:hover:bg-white/[0.08] dark:hover:text-text-primary'
            }`}
          >
            <SlidersHorizontal className="w-4 h-4" />
            <span>{t('过滤器', 'Filters')}</span>
            {activeFiltersCount > 0 && (
              <span className="bg-brand-indigo text-white rounded-full px-2 py-0.5 text-xs">
                {activeFiltersCount}
              </span>
            )}
          </button>

          {activeFiltersCount > 0 && (
            <button
              onClick={clearFilters}
              className="flex items-center space-x-1 px-3 py-2 text-sm text-gray-700 dark:text-text-tertiary hover:text-gray-900 dark:hover:text-gray-200 transition-colors"
            >
              <X className="w-4 h-4" />
              <span>{t('清除全部', 'Clear all')}</span>
            </button>
          )}

        </div>

        {/* Sort Controls */}
        <div className="flex items-center gap-2 overflow-x-auto">
          <select
            value={searchFilters.sortBy}
            onChange={(e) => setSearchFilters({ 
              sortBy: e.target.value as 'stars' | 'updated' | 'name' | 'starred'
            })}
            className="px-3 py-2 border border-black/[0.06] dark:border-white/[0.04] rounded-lg bg-white dark:bg-white/[0.04] text-gray-900 dark:text-text-primary text-sm"
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
            className="px-3 py-2 border border-black/[0.06] dark:border-white/[0.04] rounded-lg bg-white dark:bg-white/[0.04] text-gray-900 dark:text-text-primary text-sm hover:bg-light-bg dark:hover:bg-gray-600 transition-colors"
          >
            {searchFilters.sortOrder === 'desc' ? '↓' : '↑'}
          </button>
        </div>
      </div>

      {/* Advanced Filters */}
      {showFilters && (
        <div className="mt-6 pt-6 border-t border-black/[0.06] dark:border-white/[0.04] space-y-6">
          {/* Status Filters */}
          <div>
            <h4 className="text-sm font-medium text-gray-900 dark:text-text-primary mb-3">
              {t('状态过滤', 'Status Filters')}
            </h4>
            <div className="flex flex-wrap gap-2">
              {/* 已AI分析 - 仅在存在已分析仓库或当前已选择时显示，且与"分析失败"互斥 */}
              {(statusStats.analyzed > 0 || searchFilters.isAnalyzed === true) && searchFilters.analysisFailed !== true && (
                <button
                  onClick={() => setSearchFilters({ 
                    isAnalyzed: searchFilters.isAnalyzed === true ? undefined : true 
                  })}
                  title={t('显示已完成AI分析的仓库', 'Show repositories with AI analysis completed')}
                  className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    searchFilters.isAnalyzed === true
                      ? 'bg-gray-900 border border-transparent text-white dark:bg-white/[0.12] dark:text-white font-medium shadow-sm'
                      : 'bg-white border border-black/[0.06] text-gray-700 dark:bg-white/[0.04] dark:border-white/[0.04] dark:text-text-secondary hover:bg-gray-50 hover:text-gray-900 dark:hover:bg-white/[0.08] dark:hover:text-text-primary'
                  }`}
                >
                  <CheckCircle className="w-4 h-4" />
                  <span>{t('已AI分析', 'AI Analyzed')}</span>
                  <span className="text-xs opacity-70">({statusStats.analyzed})</span>
                </button>
              )}
              {/* 未AI分析 - 仅在存在未分析仓库时显示 */}
              {statusStats.notAnalyzed > 0 && (
                <button
                  onClick={() => setSearchFilters({ 
                    isAnalyzed: searchFilters.isAnalyzed === false ? undefined : false 
                  })}
                  title={t('显示尚未进行AI分析的仓库', 'Show repositories without AI analysis')}
                  className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    searchFilters.isAnalyzed === false
                      ? 'bg-gray-900 border border-transparent text-white dark:bg-white/[0.12] dark:text-white font-medium shadow-sm'
                      : 'bg-white border border-black/[0.06] text-gray-700 dark:bg-white/[0.04] dark:border-white/[0.04] dark:text-text-secondary hover:bg-gray-50 hover:text-gray-900 dark:hover:bg-white/[0.08] dark:hover:text-text-primary'
                  }`}
                >
                  <X className="w-4 h-4" />
                  <span>{t('未AI分析', 'Not Analyzed')}</span>
                  <span className="text-xs opacity-70">({statusStats.notAnalyzed})</span>
                </button>
              )}
              {/* 分析失败 - 仅在存在失败仓库或当前已选择时显示，且与"已AI分析"互斥 */}
              {(statusStats.failed > 0 || searchFilters.analysisFailed === true) && searchFilters.isAnalyzed !== true && (
                <button
                  onClick={() => setSearchFilters({ 
                    analysisFailed: searchFilters.analysisFailed === true ? undefined : true 
                  })}
                  title={t('显示AI分析失败的仓库', 'Show repositories with failed AI analysis')}
                  className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    searchFilters.analysisFailed === true
                      ? 'bg-gray-900 border border-transparent text-white dark:bg-white/[0.12] dark:text-white font-medium shadow-sm'
                      : 'bg-white border border-black/[0.06] text-gray-700 dark:bg-white/[0.04] dark:border-white/[0.04] dark:text-text-secondary hover:bg-gray-50 hover:text-gray-900 dark:hover:bg-white/[0.08] dark:hover:text-text-primary'
                  }`}
                >
                  <AlertCircle className="w-4 h-4" />
                  <span>{t('分析失败', 'Analysis Failed')}</span>
                  <span className="text-xs opacity-70">({statusStats.failed})</span>
                </button>
              )}
              {/* 已订阅Release - 仅在存在已订阅仓库或当前已选择时显示 */}
              {(statusStats.subscribed > 0 || searchFilters.isSubscribed === true) && (
                <button
                  onClick={() => setSearchFilters({ 
                    isSubscribed: searchFilters.isSubscribed === true ? undefined : true 
                  })}
                  title={t('显示已订阅Release通知的仓库', 'Show repositories subscribed to release notifications')}
                  className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    searchFilters.isSubscribed === true
                      ? 'bg-brand-indigo/20 text-gray-700 dark:text-text-secondary dark:bg-brand-indigo/20 '
                      : 'bg-white border border-black/[0.06] text-gray-700 dark:bg-white/[0.04] dark:border-white/[0.04] dark:text-text-secondary hover:bg-gray-50 hover:text-gray-900 dark:hover:bg-white/[0.08] dark:hover:text-text-primary'
                  }`}
                >
                  <Bell className="w-4 h-4" />
                  <span>{t('已订阅Release', 'Subscribed to Releases')}</span>
                  <span className="text-xs opacity-70">({statusStats.subscribed})</span>
                </button>
              )}
              {/* 未订阅Release - 仅在存在未订阅仓库时显示 */}
              {statusStats.notSubscribed > 0 && (
                <button
                  onClick={() => setSearchFilters({ 
                    isSubscribed: searchFilters.isSubscribed === false ? undefined : false 
                  })}
                  title={t('显示未订阅Release通知的仓库', 'Show repositories not subscribed to releases')}
                  className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    searchFilters.isSubscribed === false
                      ? 'bg-gray-900 border border-transparent text-white dark:bg-white/[0.12] dark:text-white font-medium shadow-sm'
                      : 'bg-white border border-black/[0.06] text-gray-700 dark:bg-white/[0.04] dark:border-white/[0.04] dark:text-text-secondary hover:bg-gray-50 hover:text-gray-900 dark:hover:bg-white/[0.08] dark:hover:text-text-primary'
                  }`}
                >
                  <BellOff className="w-4 h-4" />
                  <span>{t('未订阅Release', 'Not Subscribed to Releases')}</span>
                  <span className="text-xs opacity-70">({statusStats.notSubscribed})</span>
                </button>
              )}
              {/* 已自定义 - 仅在存在已自定义仓库或当前已选择时显示 */}
              {(statusStats.edited > 0 || searchFilters.isEdited === true) && (
                <button
                  onClick={() => setSearchFilters({
                    isEdited: searchFilters.isEdited === true ? undefined : true
                  })}
                  title={t('显示已自定义的仓库（包括自定义描述、标签、分类）', 'Show customized repositories (including custom description, tags, category)')}
                  className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    searchFilters.isEdited === true
                      ? 'bg-gray-900 border border-transparent text-white dark:bg-white/[0.12] dark:text-white font-medium shadow-sm'
                      : 'bg-white border border-black/[0.06] text-gray-700 dark:bg-white/[0.04] dark:border-white/[0.04] dark:text-text-secondary hover:bg-gray-50 hover:text-gray-900 dark:hover:bg-white/[0.08] dark:hover:text-text-primary'
                  }`}
                >
                  <Edit3 className="w-4 h-4" />
                  <span>{t('已自定义', 'Customized')}</span>
                  <span className="text-xs opacity-70">({statusStats.edited})</span>
                </button>
              )}
              {/* 分类已锁定 - 仅在存在已锁定仓库或当前已选择时显示 */}
              {(statusStats.locked > 0 || searchFilters.isCategoryLocked === true) && (
                <button
                  onClick={() => setSearchFilters({
                    isCategoryLocked: searchFilters.isCategoryLocked === true ? undefined : true
                  })}
                  title={t('显示分类已锁定的仓库（同步时不会自动更改分类）', 'Show repositories with locked category (won\'t auto-change during sync)')}
                  className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    searchFilters.isCategoryLocked === true
                      ? 'bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-300'
                      : 'bg-white border border-black/[0.06] text-gray-700 dark:bg-white/[0.04] dark:border-white/[0.04] dark:text-text-secondary hover:bg-gray-50 hover:text-gray-900 dark:hover:bg-white/[0.08] dark:hover:text-text-primary'
                  }`}
                >
                  <Lock className="w-4 h-4" />
                  <span>{t('分类已锁定', 'Category Locked')}</span>
                  <span className="text-xs opacity-70">({statusStats.locked})</span>
                </button>
              )}
              {/* 分类未锁定 - 仅在存在未锁定仓库或当前已选择时显示 */}
              {(statusStats.notLocked > 0 || searchFilters.isCategoryLocked === false) && (
                <button
                  onClick={() => setSearchFilters({
                    isCategoryLocked: searchFilters.isCategoryLocked === false ? undefined : false
                  })}
                  title={t('显示分类未锁定的仓库（同步时可能会被自动更改分类）', 'Show repositories with unlocked category (may be auto-changed during sync)')}
                  className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    searchFilters.isCategoryLocked === false
                      ? 'bg-gray-900 border border-transparent text-white dark:bg-white/[0.12] dark:text-white font-medium shadow-sm'
                      : 'bg-white border border-black/[0.06] text-gray-700 dark:bg-white/[0.04] dark:border-white/[0.04] dark:text-text-secondary hover:bg-gray-50 hover:text-gray-900 dark:hover:bg-white/[0.08] dark:hover:text-text-primary'
                  }`}
                >
                  <Unlock className="w-4 h-4" />
                  <span>{t('分类未锁定', 'Category Unlocked')}</span>
                  <span className="text-xs opacity-70">({statusStats.notLocked})</span>
                </button>
              )}
            </div>
          </div>

          {/* Languages */}
          {availableLanguages.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-gray-900 dark:text-text-primary mb-3">
                {t('编程语言', 'Programming Languages')}
              </h4>
              <div className="flex flex-wrap gap-2">
                {availableLanguages.slice(0, 12).map(language => (
                  <button
                    key={language}
                    onClick={() => handleLanguageToggle(language)}
                    className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                      searchFilters.languages.includes(language)
                        ? 'bg-brand-indigo/20 text-gray-700 dark:text-text-secondary dark:bg-brand-indigo/20 '
                        : 'bg-white border border-black/[0.06] text-gray-700 dark:bg-white/[0.04] dark:border-white/[0.04] dark:text-text-secondary hover:bg-gray-50 hover:text-gray-900 dark:hover:bg-white/[0.08] dark:hover:text-text-primary'
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
              <h4 className="text-sm font-medium text-gray-900 dark:text-text-primary mb-3">
                {t('支持平台', 'Supported Platforms')}
              </h4>
              <div className="flex flex-wrap gap-2">
                {availablePlatforms.map(platform => (
                  <button
                    key={platform}
                    onClick={() => handlePlatformToggle(platform)}
                    className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                      searchFilters.platforms.includes(platform)
                        ? 'bg-gray-900 border border-transparent text-white dark:bg-white/[0.12] dark:text-white font-medium shadow-sm'
                        : 'bg-white border border-black/[0.06] text-gray-700 dark:bg-white/[0.04] dark:border-white/[0.04] dark:text-text-secondary hover:bg-gray-50 hover:text-gray-900 dark:hover:bg-white/[0.08] dark:hover:text-text-primary'
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
              <h4 className="text-sm font-medium text-gray-900 dark:text-text-primary mb-3">
                {t('标签', 'Tags')}
              </h4>
              <div className="flex flex-wrap gap-2">
                {availableTags.slice(0, 15).map(tag => (
                  <button
                    key={tag}
                    onClick={() => handleTagToggle(tag)}
                    className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                      searchFilters.tags.includes(tag)
                        ? 'bg-gray-900 border border-transparent text-white dark:bg-white/[0.12] dark:text-white font-medium shadow-sm'
                        : 'bg-white border border-black/[0.06] text-gray-700 dark:bg-white/[0.04] dark:border-white/[0.04] dark:text-text-secondary hover:bg-gray-50 hover:text-gray-900 dark:hover:bg-white/[0.08] dark:hover:text-text-primary'
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
            <h4 className="text-sm font-medium text-gray-900 dark:text-text-primary mb-3">
              {t('Star数量范围', 'Star Count Range')}
            </h4>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:space-x-4 sm:gap-4">
              <div className="flex items-center space-x-2">
                <label className="text-sm text-gray-700 dark:text-text-tertiary">
                  {t('最小:', 'Min:')}
                </label>
                <NumberInput
                  value={searchFilters.minStars}
                  onChange={(v) => setSearchFilters({ minStars: v })}
                  min={0}
                  step={1}
                  placeholder="0"
                  allowUndefined
                  className="w-24 text-sm py-1.5 dark:bg-white/[0.04]"
                />
              </div>
              <div className="flex items-center space-x-2">
                <label className="text-sm text-gray-700 dark:text-text-tertiary">
                  {t('最大:', 'Max:')}
                </label>
                <NumberInput
                  value={searchFilters.maxStars}
                  onChange={(v) => setSearchFilters({ maxStars: v })}
                  min={0}
                  step={1}
                  placeholder="∞"
                  allowUndefined
                  className="w-24 text-sm py-1.5 dark:bg-white/[0.04]"
                />
              </div>
            </div>
            {searchFilters.minStars !== undefined && searchFilters.maxStars !== undefined && searchFilters.minStars > searchFilters.maxStars && (
              <p className="text-xs text-red-500 dark:text-red-400 mt-1.5 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                {t('最小值不能大于最大值', 'Min cannot be greater than max')}
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
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setSearchFilters({ minStars: preset.value })}
                  className="px-2 py-0.5 text-xs rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  ≥{preset.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}


    </div>
  );
};
