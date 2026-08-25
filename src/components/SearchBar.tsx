import { Input } from './ui/input';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, X, SlidersHorizontal, Monitor, Smartphone, Globe, Terminal, Package, CheckCircle, Bell, BellOff, Apple, Bot, Edit3, Lock, Unlock, AlertCircle, ChevronDown, RefreshCw, Clock } from 'lucide-react';
import { useAppStore, getAllCategories } from '../store/useAppStore';
import { AIService } from '../services/aiService';
import { EmbeddingClient, VectorSearchService } from '../services/vectorSearchService';
import { GitHubApiService } from '../services/githubApi';
import { createGitHubListsApiService } from '../services/githubApiFactory';
import { forceSyncToBackend } from '../services/autoSync';
import { useSearchShortcuts } from '../hooks/useSearchShortcuts';
import { useDialog } from '../hooks/useDialog';
import { isRepoCustomized } from '../utils/repoUtils';
import { isReservedCategoryName } from '../utils/categoryUtils';
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
import type { Repository } from '../types';

type SortBy = 'stars' | 'updated' | 'name' | 'starred';

const sortOptions: { value: SortBy; labelZh: string; labelEn: string }[] = [
  { value: 'stars', labelZh: '按星标排序', labelEn: 'Sort by Stars' },
  { value: 'updated', labelZh: '按更新排序', labelEn: 'Sort by Updated' },
  { value: 'name', labelZh: '按名称排序', labelEn: 'Sort by Name' },
  { value: 'starred', labelZh: '按加星时间排序', labelEn: 'Sort by Starred Time' },
];

interface SortByDropdownProps {
  value: SortBy;
  onChange: (value: SortBy) => void;
  t: (zh: string, en: string) => string;
}

const SortByDropdown: React.FC<SortByDropdownProps> = ({ value, onChange, t }) => {
  const selected = sortOptions.find(o => o.value === value);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-2">
          <span>{t(selected?.labelZh ?? '', selected?.labelEn ?? '')}</span>
          <ChevronDown className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuRadioGroup value={value} onValueChange={(nextValue) => onChange(nextValue as SortBy)}>
          {sortOptions.map((option) => (
            <DropdownMenuRadioItem
              key={option.value}
              value={option.value}
              className={value === option.value ? 'bg-primary/10 text-primary dark:bg-primary/20' : undefined}
            >
              {t(option.labelZh, option.labelEn)}
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
    aiConfigs,
    activeAIConfig,
    language,
    setSearchFilters,
    setSearchResults,
    customCategories,
    hiddenDefaultCategoryIds,
    defaultCategoryOverrides,
    githubToken,
    lastSync,
    setRepositories,
    setLastSync,
    isSyncingStars,
    setSyncingStars,
    syncMode,
    user,
    addCustomCategory,
  } = useAppStore();

  const { toast, confirm } = useDialog();
  
  const [showFilters, setShowFilters] = useState(false);
  const [searchQuery, setSearchQuery] = useState(searchFilters.query);
  const [isSearching, setIsSearching] = useState(false);
  const [availableLanguages, setAvailableLanguages] = useState<string[]>([]);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [availablePlatforms, setAvailablePlatforms] = useState<string[]>([]);
  const [availableLicenses, setAvailableLicenses] = useState<string[]>([]);
  const [isRealTimeSearch, setIsRealTimeSearch] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  
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
  const skipNextTextSearchRef = useRef(false);
  const vectorScoreMapRef = useRef<{ query: string; scores: Map<string, number> } | null>(null);
  const [searchPhase, setSearchPhase] = useState<string | null>(null);
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
    setSearchPhase(null);
    vectorScoreMapRef.current = null;
    console.log('🔍 Starting AI search for query:', searchQuery);

    try {
      let filtered = repositories;

      // ====== 向量搜索分支 ======
      const vsConfig = useAppStore.getState().vectorSearchConfig;
      const embConfigs = useAppStore.getState().embeddingConfigs;
      const activeEmbConfig = embConfigs.find(c => c.id === vsConfig?.embeddingConfigId);

      if (vsConfig?.enabled && vsConfig?.workerUrl && activeEmbConfig) {
        try {
          const embeddingClient = new EmbeddingClient(activeEmbConfig);
          const vectorService = new VectorSearchService(vsConfig);

          // 1. HyDE 查询预处理：用 LLM 生成理想仓库描述再嵌入（可选，5 秒超时降级）
          let embeddingQuery = searchQuery;
          const hydeConfig = aiConfigs.find(config => config.id === activeAIConfig);
          if (vsConfig.enableHyDE !== false && hydeConfig) {
            const hydeAbort = new AbortController();
            let hydeTimer: ReturnType<typeof setTimeout> | null = null;
            try {
              setSearchPhase(t('AI 分析查询...', 'AI analyzing query...'));
              const hydeService = new AIService(hydeConfig, language);
              embeddingQuery = await Promise.race([
                hydeService.generateHyDEQuery(searchQuery, hydeAbort.signal).catch(() => searchQuery),
                new Promise<string>((resolve) => {
                  hydeTimer = setTimeout(() => {
                    hydeAbort.abort();
                    resolve(searchQuery);
                  }, 5000);
                }),
              ]);
              if (embeddingQuery !== searchQuery) {
                console.log('🔮 HyDE generated:', embeddingQuery.slice(0, 100));
              }
            } catch (hydeError) {
              console.warn('HyDE failed, using raw query:', hydeError);
              embeddingQuery = searchQuery;
            } finally {
              if (hydeTimer) clearTimeout(hydeTimer);
            }
          }

          // 2. 前端调用 Embedding API 生成查询向量
          setSearchPhase(t('生成查询向量...', 'Generating query vector...'));
          const queryVectors = await embeddingClient.embed([embeddingQuery], 'query');
          if (queryVectors && queryVectors.length > 0) {
            // 2. 前端将查询向量发送到 Worker
            setSearchPhase(t('检索向量库...', 'Searching vector index...'));
            const vectorResults = await vectorService.query(queryVectors[0], {
              topK: vsConfig.searchTopK ?? 30,
              threshold: vsConfig.searchThreshold ?? 0.35,
            });

            if (vectorResults.length > 0) {
              // 3. 轻量关键词加分：精确匹配的字段给予分数微调
              const queryLower = searchQuery.toLowerCase();
              const boostedResults = vectorResults.map(r => {
                let bonus = 0;
                const name = (r.metadata?.full_name || '').toLowerCase();
                const desc = (r.metadata?.description || '').toLowerCase();
                const tags = (r.metadata?.tags || []).map(tag => tag.toLowerCase());
                if (name.includes(queryLower)) bonus += 0.05;
                if (desc.includes(queryLower)) bonus += 0.03;
                if (tags.some(tag => tag.includes(queryLower))) bonus += 0.02;
                return { ...r, score: r.score + bonus };
              });

              // 4. 从本地仓库数据中取出匹配结果，按相似度排序
              const scoreMap = new Map(boostedResults.map(r => [r.id, r.score]));
              const scoredRepos = filtered
                .filter(repo => scoreMap.has(String(repo.id)))
                .map(repo => ({
                  repo,
                  score: scoreMap.get(String(repo.id)) || 0,
                }))
                .sort((a, b) => b.score - a.score)
                .map(item => item.repo);

              if (scoredRepos.length > 0) {
                // 4. AI 语义重排序：用 LLM 对向量搜索结果做真正的语义排序
                let reranked = scoredRepos;
                let rerankSucceeded = false;
                const rerankConfig = aiConfigs.find(config => config.id === activeAIConfig);
                if (rerankConfig && vsConfig.enableReranking !== false) {
                  try {
                    setSearchPhase(t('AI 语义重排序...', 'AI semantic reranking...'));
                    const rerankService = new AIService(rerankConfig, language);
                    reranked = await rerankService.searchRepositoriesWithSemanticReranking(scoredRepos, searchQuery);
                    rerankSucceeded = true;
                    console.log('🤖 AI semantically reranked results:', reranked.length);
                  } catch (rerankError) {
                    console.warn('AI semantic reranking failed, using vector order:', rerankError);
                  }
                }

                // 保存 LLM 重排序顺序，applyFilters 可能按 UI 排序覆盖它
                const rerankOrder = rerankSucceeded
                  ? new Map(reranked.map((repo, index) => [String(repo.id), index]))
                  : null;
                const finalFiltered = applyFilters([...reranked]);
                if (rerankOrder) {
                  // 恢复 LLM 语义排序顺序
                  finalFiltered.sort((a, b) =>
                    (rerankOrder.get(String(a.id)) ?? Number.MAX_SAFE_INTEGER)
                    - (rerankOrder.get(String(b.id)) ?? Number.MAX_SAFE_INTEGER)
                  );
                } else {
                  finalFiltered.sort((a, b) => (scoreMap.get(String(b.id)) ?? 0) - (scoreMap.get(String(a.id)) ?? 0));
                }
                console.log('🎯 Vector search results:', finalFiltered.length);
                vectorScoreMapRef.current = { query: searchQuery, scores: scoreMap };
                skipNextTextSearchRef.current = true;
                setSearchResults(finalFiltered);
                setSearchFilters({ query: searchQuery });
                return;
              }
            }
          }
          // 向量搜索无结果 → 继续走关键词搜索
          console.log('⚠️ Vector search returned no results, falling back to keyword search');
        } catch (vectorError) {
          console.warn('❌ Vector search failed, falling back to keyword search:', vectorError);
        }
      }
      // ====== 向量搜索分支结束 ======

      const activeConfig = aiConfigs.find(config => config.id === activeAIConfig);
      console.log('🤖 AI Config found:', !!activeConfig, 'Active AI Config ID:', activeAIConfig);
      console.log('📋 Available AI Configs:', aiConfigs.length);
      console.log('🔧 AI Configs:', aiConfigs.map(c => ({ id: c.id, name: c.name, hasApiKey: !!c.apiKey })));

      if (activeConfig) {
        try {
          console.log('🚀 Calling AI service...');
          setSearchPhase(t('AI 语义分析...', 'AI semantic analysis...'));
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
      const finalFiltered = applyFilters(filtered);
      console.log('🎯 Final filtered results:', finalFiltered.length);
      console.log('📋 Final filtered repositories:', finalFiltered.map(r => r.name));
      setSearchResults(finalFiltered);
      
      // Update search filters to mark that AI search was performed
      setSearchFilters({ query: searchQuery });
    } catch (error) {
      console.error('💥 Search failed:', error);
    } finally {
      setIsSearching(false);
      setSearchPhase(null);
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

  const handleStarSync = async (mode: 'auto' | 'stars-only' | 'stars-and-lists' = 'auto') => {
    if (!githubToken) {
      toast(t('GitHub token 未找到，请重新登录。', 'GitHub token not found. Please login again.'), 'error');
      return;
    }

    setSyncingStars(true);
    try {
      const githubApi = new GitHubApiService(githubToken);
      const newRepositories = await githubApi.getAllStarredRepositories();

      const storeRepos = useAppStore.getState().repositories;
      const existingRepoMap = new Map(storeRepos.map(repo => [repo.id, repo]));
      const mergedRepositories = newRepositories.map(newRepo => {
        const existing = existingRepoMap.get(newRepo.id);
        if (existing) {
          return {
            ...existing,
            name: newRepo.name,
            full_name: newRepo.full_name,
            description: newRepo.description,
            html_url: newRepo.html_url,
            stargazers_count: newRepo.stargazers_count,
            forks_count: newRepo.forks_count,
            forks: newRepo.forks,
            language: newRepo.language,
            updated_at: newRepo.updated_at,
            pushed_at: newRepo.pushed_at,
            starred_at: newRepo.starred_at,
            owner: newRepo.owner,
            topics: newRepo.topics,
            // 回填历史仓库缺失的 license 字段（GitHub 源元数据，跟随 newRepo）
            license: newRepo.license ?? null,
          };
        }
        return newRepo;
      });

      // 解析本次同步范围：
      // - 'auto'：跟随持久化配置 syncMode
      // - 'stars-only'：强制仅星标（忽略 syncMode，供下拉菜单显式选择）
      // - 'stars-and-lists'：强制星标及 list（供下拉菜单显式选择）
      const syncLists = mode === 'stars-and-lists' || (mode === 'auto' && syncMode === 'stars-and-lists');
      let finalRepositories = mergedRepositories;

      if (syncLists) {
        const listRepoMap = new Map(finalRepositories.map(repo => [repo.full_name.toLowerCase(), repo]));
        const appliedTagsCount: Record<string, number> = {};
        try {
          const listsApi = createGitHubListsApiService(githubToken);
          const login = user?.login;
          if (!login) {
            throw new Error(t('无法获取 GitHub 用户名，请重新登录。', 'Failed to get GitHub username. Please login again.'));
          }
          const lists = await listsApi.getUserLists(login);

          // 构造"list 名(小写) → 本地分类"的映射，避免每次循环重复查询。
          // 值使用本地分类的原始名称（保留其大小写），而非 list 名：
          // 锁定分类的筛选用精确相等比较，若直接存 GitHub 侧的大小写，
          // 仓库会从分类结果中消失（如 list 名为 "web apps" 而分类为 "Web Apps"）。
          const categoryByLowerName = new Map(
            allCategories
              .filter(c => c.id !== 'all' && !isReservedCategoryName(c.name))
              .map(c => [c.name.toLowerCase(), c.name])
          );

          // 为云端存在、但本地无同名分类的 list 自动创建自定义分类。
          // 修复"GitHub list 有很多新分类但本地从没拉到过"——原逻辑只贴 custom_tags
          // 标签，不建分类，导致左侧分类树永远只有历史分类。
          // 用每 list 递增的下标做 id 后缀，避免同一毫秒内多个 list 撞 id。
          let createdCategoriesCount = 0;
          lists.forEach((list, idx) => {
            const lower = list.name.toLowerCase();
            if (isReservedCategoryName(list.name) || categoryByLowerName.has(lower)) return;
            const newCategory = {
              id: `custom-sync-${Date.now()}-${idx}`,
              name: list.name,
              icon: ' 📋',
              isCustom: true,
              keywords: [],
            };
            addCustomCategory(newCategory);
            // 纳入本次运行使用的映射，使后续 listMatchesCategory 命中、可设分类并加锁
            categoryByLowerName.set(lower, list.name);
            createdCategoriesCount++;
          });

          // DEC-4：只判定锁定状态。
          // 区分"本次同步开始前已存在"的锁定与"本次运行中新产生"的锁定：
          // - 预存在的锁定：不覆盖其分类与锁定，但仍追加本次命中的 list 名为
          //   custom_tags（修复 #273：否则一旦仓库被锁过，之后云端 list 的任何
          //   变化都被跳过，导致"无法将云端 list 拉取到本地"）。
          // - 本次运行中被前面的 list 刚锁定：保留已分配的分类/锁定，继续追加后续 list 的标签
          const preExistingLocked = new Set(
            finalRepositories
              .filter(r => r.category_locked)
              .map(r => r.full_name.toLowerCase())
          );

          for (const list of lists) {
            let appliedCount = 0;
            for (const fullName of list.items) {
              const key = fullName.toLowerCase();
              const repo = listRepoMap.get(key);
              if (!repo) continue;

              const customTags = repo.custom_tags ? [...repo.custom_tags] : [];
              if (!customTags.includes(list.name)) {
                customTags.push(list.name);
              }

              // 预存在锁定：不覆盖其分类与锁定，仅追加 list 名为标签，让云端
              // list 关系仍能反映到本地（修复 #273）。
              if (preExistingLocked.has(key)) {
                // 仅当标签确有变化才写回，避免无谓的 last_edited 抖动
                if (customTags.length !== (repo.custom_tags?.length ?? 0)) {
                  listRepoMap.set(key, { ...repo, custom_tags: customTags });
                }
                appliedCount++;
                continue;
              }

              // 本次运行中刚被锁定的仓库：保留已分配的分类与锁定，仅追加标签
              if (repo.category_locked) {
                listRepoMap.set(key, { ...repo, custom_tags: customTags });
                appliedCount++;
                continue;
              }

              // 若 list 名对应某个本地分类：设置分类并加锁；否则仅加标签（多分类靠标签匹配）
              const listMatchesCategory = categoryByLowerName.has(list.name.toLowerCase());
              const updatedRepo: Repository = listMatchesCategory
                ? {
                    ...repo,
                    custom_tags: customTags,
                    custom_category: categoryByLowerName.get(list.name.toLowerCase()),
                    category_locked: true,
                    last_edited: new Date().toISOString(),
                  }
                : {
                    ...repo,
                    custom_tags: customTags,
                  };

              listRepoMap.set(key, updatedRepo);
              appliedCount++;
            }
            if (appliedCount > 0) {
              appliedTagsCount[list.name] = appliedCount;
            }
          }

          finalRepositories = finalRepositories.map(repo =>
            listRepoMap.get(repo.full_name.toLowerCase()) || repo
          );

          if (Object.keys(appliedTagsCount).length > 0) {
            const appliedTotal = Object.values(appliedTagsCount).reduce((a, b) => a + b, 0);
            const listSummary = Object.entries(appliedTagsCount)
              .map(([name, count]) => `${name}(${count})`)
              .join('、');
            const createdHint = createdCategoriesCount > 0
              ? t(
                  `（新建 ${createdCategoriesCount} 个分类）`,
                  ` (${createdCategoriesCount} new categor${createdCategoriesCount > 1 ? 'ies' : 'y'} created)`
                )
              : '';
            toast(t(
              `已同步 ${lists.length} 个 list，并应用到 ${appliedTotal} 个未锁定仓库：${listSummary}${createdHint}`,
              `Synced ${lists.length} lists, applied to ${appliedTotal} unlocked repositories: ${listSummary}${createdHint}`
            ), 'info');
          } else if (createdCategoriesCount > 0) {
            // 命中数为 0，但本次新建了分类（云端 list 与本地无交集但仍有其名分类）
            toast(t(
              `已同步 ${lists.length} 个 list（新建 ${createdCategoriesCount} 个分类）。`,
              `Synced ${lists.length} lists (${createdCategoriesCount} new categor${createdCategoriesCount > 1 ? 'ies' : 'y'} created).`
            ), 'info');
          }
        } catch (listError) {
          console.error('List sync failed:', listError);
          toast(t(
            'List 同步失败，星标仓库已同步。请稍后重试，或检查 GitHub Token 权限（需 user scope）。',
            'List sync failed, starred repositories were synced. Retry later, or check the GitHub Token has the user scope.'
          ), 'error');
          // 不中断：星标同步结果仍然生效
        }
      }

      const existingRepoIds = new Set(storeRepos.map(repo => repo.id));
      const newRepoCount = newRepositories.filter(repo => !existingRepoIds.has(repo.id)).length;

      setRepositories(finalRepositories);
      await forceSyncToBackend();
      
      setLastSync(new Date().toISOString());

      if (newRepoCount > 0) {
        toast(t(`同步完成！发现 ${newRepoCount} 个新仓库。`, `Sync completed! Found ${newRepoCount} new repositories.`), 'success');
      } else {
        toast(t('同步完成！所有仓库都是最新的。', 'Sync completed! All repositories are up to date.'), 'info');
      }

    } catch (error) {
      console.error('Sync failed:', error);
      if (error instanceof Error && error.message.includes('token')) {
        toast(t('GitHub token 已过期或无效，请重新登录。', 'GitHub token has expired or is invalid. Please login again.'), 'error');
      } else {
        toast(t('同步失败，请检查网络连接或稍后重试。', 'Sync failed. Please check your network connection or try again later.'), 'error');
      }
    } finally {
      setSyncingStars(false);
    }
  };

  const formatLastSync = (timestamp: string | null) => {
    if (!timestamp) return t('从未同步', 'Never');
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return t('从未同步', 'Never');
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours < 1) return t('刚刚', 'Just now');
    if (diffHours < 24) return t(`${diffHours}小时前`, `${diffHours}h ago`);
    return date.toLocaleDateString(language === 'zh' ? 'zh-CN' : 'en-US');
  };

  // 同步星标仓库及 list：先确认（警告会覆盖未锁定仓库的分类并加锁），再执行
  const handleStarAndListSync = async () => {
    const confirmed = await confirm(
      t('同步星标仓库及 list', 'Sync starred repos & lists'),
      t(
        '将拉取你的 GitHub Lists（星标列表）并应用到本地仓库：\n\n' +
        '· 每个 list 名会作为标签添加到对应仓库（一个仓库可属于多个 list/分类）\n' +
        '· 未锁定分类的仓库将应用 list 对应的分类并默认锁定\n' +
        '· 已锁定分类的仓库保持不变\n\n确定继续吗？',
        'This will fetch your GitHub Lists and apply them to local repositories:\n\n' +
        '· Each list name is added as a tag (a repo can belong to multiple lists/categories)\n' +
        '· Unlocked repos get the list category applied and locked\n' +
        '· Locked repos are left unchanged\n\nContinue?'
      ),
      { type: 'warning' }
    );
    if (!confirmed) return;
    await handleStarSync('stars-and-lists');
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
          aria-label={t('搜索仓库', 'Search repositories')}
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
          className="h-10 w-full pl-10 pr-3"
        />

        {/* Search History Dropdown */}
        {showSearchHistory && searchHistory.length > 0 && (
          <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded-md border border-border bg-popover text-popover-foreground shadow-md">
            <div className="p-2 border-b border-border/60 dark:border-border flex items-center justify-between">
              <span className="text-sm font-medium text-foreground dark:text-muted-foreground">
                {t('搜索历史', 'Search History')}
              </span>
              <Button
                type="button"
                variant="ghost"
                onClick={clearSearchHistory}
                className="text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                {t('清除', 'Clear')}
              </Button>
            </div>
            {searchHistory.map((historyQuery, index) => (
              <Button
                type="button"
                variant="ghost"
                key={index}
                onClick={() => handleHistoryItemClick(historyQuery)}
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
          <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded-md border border-border bg-popover text-popover-foreground shadow-md">
            <div className="p-2 border-b border-border/60 dark:border-border">
              <span className="text-sm font-medium text-foreground dark:text-muted-foreground">
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
                <Button
                  type="button"
                  variant="ghost"
                  key={index}
                  onClick={() => handleSuggestionClick(suggestion)}
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
              aria-label={t('清除搜索', 'Clear search')}
              size="icon"
              className="h-8 w-8 text-muted-foreground"
              title={t('清除搜索', 'Clear search')}
            >
              <X className="w-4 h-4" />
            </Button>
          )}
          <Button
            onClick={handleAISearch}
            variant="default"
            aria-label={isSearching ? t('AI搜索中...', 'AI Searching...') : t('AI搜索', 'AI Search')}
            disabled={isSearching || !searchQuery.trim()}
            className="flex shrink-0 items-center sm:px-4"
            title={activeAIConfig
              ? t('使用配置的AI服务进行语义搜索和重排序', 'Use configured AI service for semantic search and reranking')
              : t('使用本地智能排序算法进行搜索', 'Use local intelligent ranking algorithm for search')}
          >
            <Bot className="w-4 h-4" />
            <span className="hidden sm:inline">{isSearching ? t('AI搜索中...', 'AI Searching...') : t('AI搜索', 'AI Search')}</span>
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
                aria-label={t('关于 AI 搜索', 'About AI Search')}
                className="h-8 w-8 shrink-0 text-muted-foreground"
              >
                <AlertCircle className="h-4 w-4" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="end" className="w-80 max-w-xs whitespace-normal break-words text-left">
              <p className="mb-1 font-medium">{t('关于AI搜索', 'About AI Search')}</p>
              <p className="leading-relaxed text-primary-foreground/80">
                {activeAIConfig ? t(
                  'AI语义搜索模式：使用配置的AI服务进行智能语义理解和重排序。AI将分析查询意图，理解上下文关系，并提供语义相关的搜索结果。支持自然语言查询和概念匹配。',
                  'AI semantic search mode: Uses configured AI service for intelligent semantic understanding and reranking. AI analyzes query intent, understands context, and provides semantically relevant search results. Supports natural language queries and concept matching.'
                ) : t(
                  '回退模式：基础文本搜索与默认排序。当未配置AI服务时，系统将使用基础文本匹配进行搜索（支持名称、描述、标签、语言等字段），并应用标准的排序和过滤控制。此为轻量级搜索方案，无语义理解能力。',
                  'Fallback mode: Basic text search with default sorting. When no AI service is configured, the system uses basic text matching for search (supports name, description, tags, language, etc.) and applies standard sort and filter controls. This is a lightweight search solution without semantic understanding capabilities.'
                )}
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
                <span>{t('实时搜索模式 - 匹配仓库名称', 'Real-time search mode - matching repository names')}</span>
              </div>
            ) : searchFilters.query ? (
              <div className="flex items-center space-x-2 text-muted-foreground dark:text-muted-foreground ">
                <Bot className="w-4 h-4" />
                <span>{t('AI语义搜索模式 - 智能匹配和排序', 'AI semantic search mode - intelligent matching and ranking')}</span>
              </div>
            ) : null}
          </div>
          {isRealTimeSearch && (
            <div className="text-muted-foreground dark:text-muted-foreground">
              {t('按回车键或点击AI搜索进行深度搜索', 'Press Enter or click AI Search for deep search')}
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
            <span>{t('过滤器', 'Filters')}</span>
            {activeFiltersCount > 0 && (
              <span className="bg-primary text-primary-foreground rounded-full px-2 py-0.5 text-xs">
                {activeFiltersCount}
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
              <span>{t('清除全部', 'Clear all')}</span>
            </Button>
          )}

        </div>

        {/* Sort Controls + Sync Button */}
        <div className="flex items-center gap-2 relative z-30">
          <SortByDropdown
            value={searchFilters.sortBy}
            onChange={(value) => setSearchFilters({ sortBy: value as 'stars' | 'updated' | 'name' | 'starred' })}
            t={t}
          />
          <Button
            onClick={() => setSearchFilters({
              sortOrder: searchFilters.sortOrder === 'desc' ? 'asc' : 'desc'
            })}
            variant="ghost"
            aria-label={searchFilters.sortOrder === 'desc' ? t('按降序排列', 'Sort descending') : t('按升序排列', 'Sort ascending')}
            className="ui-button px-3 py-2 text-sm"
          >
            {searchFilters.sortOrder === 'desc' ? '↓' : '↑'}
          </Button>

          {/* Sync Button */}
          <div className="flex items-center gap-2 ml-1">
            <DropdownMenu>
              <div className="flex items-center">
                <div className="ui-button-primary inline-flex items-stretch overflow-hidden">
                  <Button
                    type="button"
                    onClick={() => { void handleStarSync(); }}
                    disabled={isSyncingStars}
                    className="inline-flex items-center gap-1.5 rounded-none border-0 bg-transparent px-3 py-2 text-inherit shadow-none hover:bg-primary/90 disabled:opacity-50"
                    title={t('同步星标仓库列表', 'Sync starred repositories')}
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isSyncingStars ? 'animate-spin' : ''}`} />
                    <span className="whitespace-nowrap">{t('同步', 'Sync')}</span>
                  </Button>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      disabled={isSyncingStars}
                      aria-label={t('更多同步选项', 'More sync options')}
                      className="group inline-flex items-center rounded-none border-0 bg-transparent px-1.5 py-2 text-inherit shadow-none hover:bg-primary/90 disabled:opacity-50"
                      title={t('更多同步选项', 'More sync options')}
                    >
                      <ChevronDown className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180" />
                    </Button>
                  </DropdownMenuTrigger>
                </div>
              </div>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuItem
                  disabled={isSyncingStars}
                  onSelect={() => { void handleStarSync('stars-only'); }}
                  className="justify-start text-sm"
                >
                  <span className="whitespace-nowrap">{t('只同步星标仓库', 'Sync starred repos only')}</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={isSyncingStars}
                  onSelect={() => { void handleStarAndListSync(); }}
                  className="justify-start text-sm"
                >
                  <span className="whitespace-nowrap">{t('同步星标仓库及 list', 'Sync starred repos & lists')}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t('最近更新时间', 'Last synced')}
                  className="h-8 w-8 shrink-0 text-muted-foreground"
                >
                  <Clock className="h-4 w-4" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="end" className="whitespace-nowrap">
                <p className="font-medium">{t('最近更新时间', 'Last synced')}</p>
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
              {t('状态过滤', 'Status Filters')}
            </h4>
            <div className="flex flex-wrap gap-2">
              {/* 已AI分析 - 仅在存在已分析仓库或当前已选择时显示，且与"分析失败"互斥 */}
              {(statusStats.analyzed > 0 || searchFilters.isAnalyzed === true) && searchFilters.analysisFailed !== true && (
                <Button
                  onClick={() => setSearchFilters({ 
                    isAnalyzed: searchFilters.isAnalyzed === true ? undefined : true 
                  })}
                  aria-pressed={searchFilters.isAnalyzed === true}
                  title={t('显示已完成AI分析的仓库', 'Show repositories with AI analysis completed')}
                  variant="ghost"
                  className={`${filterChipBaseClass} ${
                    searchFilters.isAnalyzed === true
                      ? filterChipActiveClass
                      : filterChipInactiveClass
                  }`}
                >
                  <CheckCircle className="w-4 h-4" />
                  <span>{t('已AI分析', 'AI Analyzed')}</span>
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
                  title={t('显示尚未进行AI分析的仓库', 'Show repositories without AI analysis')}
                  variant="ghost"
                  className={`${filterChipBaseClass} ${
                    searchFilters.isAnalyzed === false
                      ? filterChipActiveClass
                      : filterChipInactiveClass
                  }`}
                >
                  <X className="w-4 h-4" />
                  <span>{t('未AI分析', 'Not Analyzed')}</span>
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
                  title={t('显示AI分析失败的仓库', 'Show repositories with failed AI analysis')}
                  variant="ghost"
                  className={`${filterChipBaseClass} ${
                    searchFilters.analysisFailed === true
                      ? filterChipActiveClass
                      : filterChipInactiveClass
                  }`}
                >
                  <AlertCircle className="w-4 h-4" />
                  <span>{t('分析失败', 'Analysis Failed')}</span>
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
                  title={t('显示已订阅Release通知的仓库', 'Show repositories subscribed to release notifications')}
                  variant="ghost"
                  className={`${filterChipBaseClass} ${
                    searchFilters.isSubscribed === true
                      ? filterChipActiveClass
                      : filterChipInactiveClass
                  }`}
                >
                  <Bell className="w-4 h-4" />
                  <span>{t('已订阅Release', 'Subscribed to Releases')}</span>
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
                  title={t('显示未订阅Release通知的仓库', 'Show repositories not subscribed to releases')}
                  variant="ghost"
                  className={`${filterChipBaseClass} ${
                    searchFilters.isSubscribed === false
                      ? filterChipActiveClass
                      : filterChipInactiveClass
                  }`}
                >
                  <BellOff className="w-4 h-4" />
                  <span>{t('未订阅Release', 'Not Subscribed to Releases')}</span>
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
                  title={t('显示已自定义的仓库（包括自定义描述、标签、分类）', 'Show customized repositories (including custom description, tags, category)')}
                  variant="ghost"
                  className={`${filterChipBaseClass} ${
                    searchFilters.isEdited === true
                      ? filterChipActiveClass
                      : filterChipInactiveClass
                  }`}
                >
                  <Edit3 className="w-4 h-4" />
                  <span>{t('已自定义', 'Customized')}</span>
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
                  title={t('显示分类已锁定的仓库（同步时不会自动更改分类）', 'Show repositories with locked category (won\'t auto-change during sync)')}
                  variant="ghost"
                  className={`${filterChipBaseClass} ${
                    searchFilters.isCategoryLocked === true
                      ? filterChipActiveClass
                      : filterChipInactiveClass
                  }`}
                >
                  <Lock className="w-4 h-4" />
                  <span>{t('分类已锁定', 'Category Locked')}</span>
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
                  title={t('显示分类未锁定的仓库（同步时可能会被自动更改分类）', 'Show repositories with unlocked category (may be auto-changed during sync)')}
                  variant="ghost"
                  className={`${filterChipBaseClass} ${
                    searchFilters.isCategoryLocked === false
                      ? filterChipActiveClass
                      : filterChipInactiveClass
                  }`}
                >
                  <Unlock className="w-4 h-4" />
                  <span>{t('分类未锁定', 'Category Unlocked')}</span>
                  <span className="text-xs opacity-70">({statusStats.notLocked})</span>
                </Button>
              )}
            </div>
          </div>

          {/* Languages */}
          {availableLanguages.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-foreground dark:text-foreground mb-3">
                {t('编程语言', 'Programming Languages')}
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
                {t('支持平台', 'Supported Platforms')}
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
                {t('开源许可', 'License')}
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
                      ? t('无/未声明 license', 'No license')
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
                {t('标签', 'Tags')}
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
              {t('Star数量范围', 'Star Count Range')}
            </h4>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:space-x-4 sm:gap-4">
              <div className="flex items-center space-x-2">
                <label htmlFor="minimum-stars" className="text-sm text-muted-foreground dark:text-muted-foreground">
                  {t('最小:', 'Min:')}
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
                  {t('最大:', 'Max:')}
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
        </div>
      )}


      </div>
    </TooltipProvider>
  );
};
