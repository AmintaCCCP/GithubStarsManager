import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Bot, ChevronDown, Pause, Play } from 'lucide-react';
import { RepositoryCard } from './RepositoryCard';
import { BulkActionToolbar } from './BulkActionToolbar';
import { BulkCategorizeModal } from './BulkCategorizeModal';
import { BulkRestoreModal, RestoreConfig } from './BulkRestoreModal';

import { Repository } from '../types';
import { useAppStore, getAllCategories } from '../store/useAppStore';
import { GitHubApiService } from '../services/githubApi';
import { AIService } from '../services/aiService';
import { AIAnalysisOptimizer, AnalysisResult } from '../services/aiAnalysisOptimizer';
import { resolveCategoryAssignment, getAICategory, getDefaultCategory, computeCustomCategory } from '../utils/categoryUtils';
import { forceSyncToBackend } from '../services/autoSync';

interface RepositoryListProps {
  repositories: Repository[];
  selectedCategory: string;
}

export const RepositoryList: React.FC<RepositoryListProps> = ({ 
  repositories, 
  selectedCategory 
}) => {
  const {
    githubToken,
    aiConfigs,
    activeAIConfig,
    isLoading,
    setLoading,
    updateRepository,
    deleteRepository,
    language,
    customCategories,
    hiddenDefaultCategoryIds,
    defaultCategoryOverrides,
    analysisProgress,
    setAnalysisProgress,
    searchFilters,
    toggleReleaseSubscription,
    batchUnsubscribeReleases,
    releaseSubscriptions
  } = useAppStore();

  const [showAISummary, setShowAISummary] = useState(true);
  const [showDropdown, setShowDropdown] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [disableCardAnimations, setDisableCardAnimations] = useState(false);
  const previousCategoryRef = useRef(selectedCategory);
  const savedScrollYRef = useRef<number | null>(null);
  const restoreScrollFrameRef = useRef<number | null>(null);
  
  // 使用 useRef 来管理停止状态，确保在异步操作中能正确访问最新值
  const shouldStopRef = useRef(false);
  const isAnalyzingRef = useRef(false);
  const optimizerRef = useRef<AIAnalysisOptimizer | null>(null);

  // 批量选择状态
  const [selectedRepoIds, setSelectedRepoIds] = useState<Set<number>>(new Set());
  const [showBulkToolbar, setShowBulkToolbar] = useState(false);
  const [showCategorizeModal, setShowCategorizeModal] = useState(false);
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [isExitingSelection, setIsExitingSelection] = useState(false);

  const allCategories = useMemo(
    () => getAllCategories(customCategories, language, hiddenDefaultCategoryIds, defaultCategoryOverrides),
    [customCategories, language, hiddenDefaultCategoryIds, defaultCategoryOverrides]
  );

  const filteredRepositories = useMemo(() => {
    if (selectedCategory === 'all') return repositories;
    
    const selectedCategoryObj = allCategories.find(cat => cat.id === selectedCategory);
    if (!selectedCategoryObj) return [];

    return repositories.filter(repo => {
      if (repo.custom_category !== undefined) {
        if (repo.custom_category === '') {
          return false;
        }
        return repo.custom_category === selectedCategoryObj.name;
      }
      
      // 如果没有自定义分类，使用AI标签和关键词匹配
      // 优先使用AI标签进行匹配
      if (repo.ai_tags && repo.ai_tags.length > 0) {
        return repo.ai_tags.some(tag => 
          selectedCategoryObj.keywords.some(keyword => 
            tag.toLowerCase().includes(keyword.toLowerCase()) ||
            keyword.toLowerCase().includes(tag.toLowerCase())
          )
        );
      }
      
      // 如果没有AI标签，使用传统方式匹配
      const repoText = [
        repo.name,
        repo.description || '',
        repo.language || '',
        ...(repo.topics || []),
        repo.ai_summary || ''
      ].join(' ').toLowerCase();
      
      return selectedCategoryObj.keywords.some(keyword => 
        repoText.includes(keyword.toLowerCase())
      );
    });
  }, [repositories, selectedCategory, allCategories]);

  // 根据当前筛选的仓库中是否有AI分析内容来动态设置默认显示模式
  const hasAnalyzedRepos = useMemo(() => 
    filteredRepositories.some(repo => repo.analyzed_at && !repo.analysis_failed),
    [filteredRepositories]
  );
  
  // 当筛选的仓库变化时，如果没有AI分析的仓库，自动切换到原始描述
  useEffect(() => {
    if (!hasAnalyzedRepos && showAISummary) {
      setShowAISummary(false);
    }
  }, [hasAnalyzedRepos]);

  // Infinite scroll (瀑布流按需加载)
  const LOAD_BATCH = 50;
  const [visibleCount, setVisibleCount] = useState(LOAD_BATCH);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const startIndex = filteredRepositories.length === 0 ? 0 : 1;
  const endIndex = Math.min(visibleCount, filteredRepositories.length);
  const visibleRepositories = filteredRepositories.slice(0, visibleCount);

  // 派生选中的仓库数组，统一用于计数与传递
  const selectedRepositories = useMemo(() =>
    filteredRepositories.filter(repo => selectedRepoIds.has(repo.id)),
    [filteredRepositories, selectedRepoIds]
  );

  // 使用 useMemo 缓存统计计数，避免每次渲染重新计算
  const repositoryStats = useMemo(() => {
    let unanalyzedCount = 0;
    let analyzedCount = 0;
    let failedCount = 0;

    for (const repo of filteredRepositories) {
      if (repo.analysis_failed) {
        failedCount++;
      } else if (repo.analyzed_at) {
        analyzedCount++;
      } else {
        unanalyzedCount++;
      }
    }

    return { unanalyzedCount, analyzedCount, failedCount };
  }, [filteredRepositories]);

  const filterResetKey = useMemo(() => JSON.stringify({
    selectedCategory,
    query: searchFilters.query,
    languages: searchFilters.languages,
    tags: searchFilters.tags,
    platforms: searchFilters.platforms,
    sortBy: searchFilters.sortBy,
    sortOrder: searchFilters.sortOrder,
    minStars: searchFilters.minStars,
    maxStars: searchFilters.maxStars,
    isAnalyzed: searchFilters.isAnalyzed,
    isSubscribed: searchFilters.isSubscribed,
    isEdited: searchFilters.isEdited,
    isCategoryLocked: searchFilters.isCategoryLocked,
    analysisFailed: searchFilters.analysisFailed,
  }), [
    selectedCategory,
    searchFilters.query,
    searchFilters.languages,
    searchFilters.tags,
    searchFilters.platforms,
    searchFilters.sortBy,
    searchFilters.sortOrder,
    searchFilters.minStars,
    searchFilters.maxStars,
    searchFilters.isAnalyzed,
    searchFilters.isSubscribed,
    searchFilters.isEdited,
    searchFilters.isCategoryLocked,
    searchFilters.analysisFailed,
  ]);

  // Reset visible count only when filter context changes.
  useEffect(() => {
    setVisibleCount(LOAD_BATCH);
  }, [filterResetKey]);

  useEffect(() => {
    if (previousCategoryRef.current !== selectedCategory) {
      window.scrollTo({ top: 0, behavior: 'auto' });
      previousCategoryRef.current = selectedCategory;
    }
  }, [selectedCategory]);

  // Clamp visible count when result set becomes smaller, but do not collapse
  // back to the initial batch during backend sync refreshes.
  useEffect(() => {
    setVisibleCount((count) => {
      if (filteredRepositories.length === 0) return LOAD_BATCH;
      return Math.min(count, filteredRepositories.length);
    });
  }, [filteredRepositories.length]);

  // IntersectionObserver to load more on demand
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting) {
          setVisibleCount((count) => {
            if (count >= filteredRepositories.length) return count;
            return Math.min(count + LOAD_BATCH, filteredRepositories.length);
          });
        }
      },
      { root: null, rootMargin: '200px', threshold: 0 }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [filteredRepositories.length]);

  useEffect(() => {
    const handleSyncVisualState = (event: Event) => {
      const customEvent = event as CustomEvent<{ isSyncing?: boolean }>;
      const isSyncing = !!customEvent.detail?.isSyncing;
      setDisableCardAnimations(isSyncing);

      if (isSyncing) {
        savedScrollYRef.current = window.scrollY;
        if (restoreScrollFrameRef.current !== null) {
          cancelAnimationFrame(restoreScrollFrameRef.current);
          restoreScrollFrameRef.current = null;
        }
        return;
      }

      const targetScrollY = savedScrollYRef.current;
      if (targetScrollY === null) return;

      restoreScrollFrameRef.current = window.requestAnimationFrame(() => {
        restoreScrollFrameRef.current = window.requestAnimationFrame(() => {
          window.scrollTo({ top: targetScrollY, behavior: 'auto' });
          restoreScrollFrameRef.current = null;
          savedScrollYRef.current = null;
        });
      });
    };

    window.addEventListener('gsm:repository-sync-visual-state', handleSyncVisualState as EventListener);
    return () => {
      if (restoreScrollFrameRef.current !== null) {
        cancelAnimationFrame(restoreScrollFrameRef.current);
      }
      window.removeEventListener('gsm:repository-sync-visual-state', handleSyncVisualState as EventListener);
    };
  }, []);

  const handleAIAnalyze = async (analyzeUnanalyzedOnly: boolean = false, analyzeFailedOnly: boolean = false) => {
    if (!githubToken) {
      alert(language === 'zh' ? 'GitHub token 未找到，请重新登录。' : 'GitHub token not found. Please login again.');
      return;
    }

    const activeConfig = aiConfigs.find(config => config.id === activeAIConfig);
    if (!activeConfig) {
      alert(language === 'zh' ? '请先在设置中配置AI服务。' : 'Please configure AI service in settings first.');
      return;
    }

    if (activeConfig.apiKeyStatus === 'decrypt_failed') {
      alert(language === 'zh' ? 'AI服务的API密钥无法解密，请在设置中重新输入并保存该配置。' : 'The AI service API key could not be decrypted. Please re-enter and save the configuration in settings.');
      return;
    }

    if (!activeConfig.baseUrl || !activeConfig.apiKey || !activeConfig.model) {
      alert(language === 'zh' ? 'AI服务配置不完整，请检查API端点、密钥和模型名称。' : 'AI service configuration is incomplete. Please check the API endpoint, key, and model name.');
      return;
    }

    const targetRepos = analyzeFailedOnly
      ? filteredRepositories.filter(repo => repo.analysis_failed)
      : analyzeUnanalyzedOnly 
        ? filteredRepositories.filter(repo => !repo.analyzed_at)
        : filteredRepositories;

    if (targetRepos.length === 0) {
      const message = analyzeFailedOnly
        ? (language === 'zh' ? '没有分析失败的仓库！' : 'No failed repositories to re-analyze!')
        : analyzeUnanalyzedOnly
          ? (language === 'zh' ? '所有仓库都已经分析过了！' : 'All repositories have been analyzed!')
          : (language === 'zh' ? '没有可分析的仓库！' : 'No repositories to analyze!');
      alert(message);
      return;
    }

    const actionText = analyzeFailedOnly
      ? (language === 'zh' ? '失败' : 'failed')
      : analyzeUnanalyzedOnly 
        ? (language === 'zh' ? '未分析' : 'unanalyzed')
        : (language === 'zh' ? '全部' : 'all');
    
    const confirmMessage = language === 'zh'
      ? `将对 ${targetRepos.length} 个${actionText}仓库进行AI分析，这可能需要几分钟时间。是否继续？`
      : `Will analyze ${targetRepos.length} ${actionText} repositories with AI. This may take several minutes. Continue?`;
    
    const confirmed = confirm(confirmMessage);
    if (!confirmed) return;

    // 重置状态
    shouldStopRef.current = false;
    isAnalyzingRef.current = true;
    setLoading(true);
    setAnalysisProgress({ current: 0, total: targetRepos.length });
    setShowDropdown(false);
    setIsPaused(false);

    // 创建优化器实例并保存到 ref
    optimizerRef.current = new AIAnalysisOptimizer({
      initialConcurrency: activeConfig.concurrency || 3,
      maxConcurrency: 10,
      minConcurrency: 1,
      targetResponseTime: 5000,
      batchDelayMs: 100,
      maxRetries: 3,
      retryDelayBaseMs: 1000,
      enableAdaptiveConcurrency: true,
    });

    try {
      const githubApi = new GitHubApiService(githubToken);
      const aiService = new AIService(activeConfig, language);
      const categoryNames = allCategories.filter(cat => cat.id !== 'all').map(cat => cat.name);

      let successCount = 0;
      let failedCount = 0;

      const handleResult = (result: AnalysisResult) => {
        if (result.success) {
          const resolvedCategory = resolveCategoryAssignment(
            result.repo,
            result.tags || [],
            allCategories
          );

          const wasCategoryLocked = !!result.repo.category_locked;

          updateRepository({
            ...result.repo,
            ai_summary: result.summary,
            ai_tags: result.tags,
            ai_platforms: result.platforms,
            custom_category: resolvedCategory,
            category_locked: wasCategoryLocked,
            analyzed_at: new Date().toISOString(),
            analysis_failed: false,
          });
          successCount++;
        } else {
          updateRepository({
            ...result.repo,
            analyzed_at: new Date().toISOString(),
            analysis_failed: true,
          });
          failedCount++;
        }
      };

      setAnalysisProgress({ current: 0, total: targetRepos.length });

      await optimizerRef.current!.analyzeRepositoriesPipelined(
        targetRepos,
        githubApi,
        aiService,
        categoryNames,
        (completed, total, currentConcurrency) => {
          setAnalysisProgress({ current: completed, total });
          console.log(`AI Analysis Progress: ${completed}/${total}, Concurrency: ${currentConcurrency}`);
        },
        handleResult
      );

      const stats = optimizerRef.current!.getStats();
      console.log('AI Analysis Stats:', stats);

      const completionMessage = shouldStopRef.current
        ? (language === 'zh'
            ? `AI分析已停止！成功: ${successCount}, 失败: ${failedCount}`
            : `AI analysis stopped! Success: ${successCount}, Failed: ${failedCount}`)
        : (language === 'zh'
            ? `AI分析完成！成功: ${successCount}, 失败: ${failedCount} (平均响应: ${stats.averageResponseTime}ms)`
            : `AI analysis completed! Success: ${successCount}, Failed: ${failedCount} (avg: ${stats.averageResponseTime}ms)`);

      alert(completionMessage);
    } catch (error) {
      console.error('AI analysis failed:', error);
      const errorMessage = language === 'zh'
        ? 'AI分析失败，请检查AI配置和网络连接。'
        : 'AI analysis failed. Please check AI configuration and network connection.';
      alert(errorMessage);
    } finally {
      // 清理状态
      optimizerRef.current = null;
      isAnalyzingRef.current = false;
      shouldStopRef.current = false;
      setLoading(false);
      setAnalysisProgress({ current: 0, total: 0 });
      setIsPaused(false);
    }
  };

  const handlePauseResume = () => {
    if (!isAnalyzingRef.current) return;
    const newPausedState = !isPaused;
    setIsPaused(newPausedState);

    // 控制优化器的暂停/恢复
    if (optimizerRef.current) {
      if (newPausedState) {
        optimizerRef.current.pause();
        console.log('Analysis paused');
      } else {
        optimizerRef.current.resume();
        console.log('Analysis resumed');
      }
    }
  };

  const handleStop = () => {
    if (!isAnalyzingRef.current) return;

    const confirmMessage = language === 'zh'
      ? '确定要停止 AI 分析吗？已分析的结果将会保存。'
      : 'Are you sure you want to stop AI analysis? Analyzed results will be saved.';

    if (confirm(confirmMessage)) {
      shouldStopRef.current = true;
      // 中止优化器
      if (optimizerRef.current) {
        optimizerRef.current.abort();
      }
      setIsPaused(false);
      console.log('Stop requested by user');
    }
  };

  // 批量操作处理函数
  // 使用 useCallback 优化事件处理函数
  const handleSelectRepo = useCallback((id: number) => {
    setSelectedRepoIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
    // 使用 requestAnimationFrame 延迟显示工具栏，避免布局抖动
    requestAnimationFrame(() => {
      setSelectedRepoIds(current => {
        setShowBulkToolbar(current.size > 0);
        return current;
      });
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    const allIds = new Set(filteredRepositories.map(repo => repo.id));
    setSelectedRepoIds(allIds);
    setShowBulkToolbar(true);
  }, [filteredRepositories]);

  const handleDeselectAll = useCallback(() => {
    setIsExitingSelection(true);
    setTimeout(() => {
      setSelectedRepoIds(new Set());
      setShowBulkToolbar(false);
      requestAnimationFrame(() => {
        setIsExitingSelection(false);
      });
    }, 250);
  }, []);

  const handleBulkRestore = useCallback(async (config: RestoreConfig) => {
    const selectedRepos = repositories.filter(repo => selectedRepoIds.has(repo.id));
    if (selectedRepos.length === 0) return;

    let successCount = 0;
    const failedRepos: string[] = [];

    for (const repo of selectedRepos) {
      try {
        const updatedRepo = { ...repo };

        if (config.description.enabled) {
          updatedRepo.custom_description = undefined;
          if (config.description.target === 'original') {
            updatedRepo.ai_summary = undefined;
            updatedRepo.analyzed_at = undefined;
            updatedRepo.analysis_failed = undefined;
          }
        }

        if (config.tags.enabled) {
          updatedRepo.custom_tags = undefined;
          if (config.tags.target === 'original') {
            updatedRepo.ai_tags = undefined;
            updatedRepo.ai_platforms = undefined;
            updatedRepo.analyzed_at = undefined;
            updatedRepo.analysis_failed = undefined;
          }
        }

        if (config.category.enabled) {
          updatedRepo.custom_category = undefined;
          updatedRepo.category_locked = false;
          if (config.category.target === 'original') {
            updatedRepo.ai_tags = undefined;
            updatedRepo.ai_platforms = undefined;
            updatedRepo.analyzed_at = undefined;
            updatedRepo.analysis_failed = undefined;
          }
        }

        const hasChanges = updatedRepo.custom_description !== repo.custom_description ||
          updatedRepo.custom_tags !== repo.custom_tags ||
          updatedRepo.custom_category !== repo.custom_category ||
          updatedRepo.category_locked !== repo.category_locked ||
          updatedRepo.ai_summary !== repo.ai_summary ||
          updatedRepo.ai_tags !== repo.ai_tags ||
          updatedRepo.ai_platforms !== repo.ai_platforms ||
          updatedRepo.analyzed_at !== repo.analyzed_at ||
          updatedRepo.analysis_failed !== repo.analysis_failed;

        if (hasChanges) {
          updatedRepo.last_edited = new Date().toISOString();
          updateRepository(updatedRepo);
        }
        successCount++;
      } catch (error) {
        console.error(`Failed to restore ${repo.full_name}:`, error);
        failedRepos.push(repo.full_name);
      }
    }

    await forceSyncToBackend();

    const skipMsg = failedRepos.length > 0
      ? (language === 'zh'
        ? `\n\n失败 (${failedRepos.length} 个):\n${failedRepos.join('\n')}`
        : `\n\nFailed (${failedRepos.length}):\n${failedRepos.join('\n')}`)
      : '';

    alert(language === 'zh'
      ? `成功还原 ${successCount} 个仓库${skipMsg}`
      : `Successfully restored ${successCount} repositories${skipMsg}`
    );
  }, [repositories, selectedRepoIds, updateRepository, language]);

  // 处理单击空白处 - 触发回到顶部按钮跳跃动画
  const handleClick = useCallback((e: React.MouseEvent) => {
    // 检查点击的是否是空白区域（不是卡片或其他元素）
    if (showBulkToolbar && e.target === e.currentTarget) {
      // 触发自定义事件，让回到顶部按钮跳跃两下
      window.dispatchEvent(new CustomEvent('gsm:back-to-top-bounce'));
    }
  }, [showBulkToolbar]);

  // 处理双击空白处退出多选模式
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    // 检查点击的是否是空白区域（不是卡片或其他元素）
    if (showBulkToolbar && e.target === e.currentTarget) {
      handleDeselectAll();
    }
  }, [showBulkToolbar, handleDeselectAll]);

  const handleBulkAction = async (action: string, repos: Repository[]) => {
    try {
      switch (action) {
        case 'unstar': {
          if (!githubToken) {
            alert(language === 'zh' ? 'GitHub token 未找到，请重新登录。' : 'GitHub token not found. Please login again.');
            return;
          }

          const confirmMessage = language === 'zh'
            ? `确定要取消 ${repos.length} 个仓库的 Star 吗？此操作不可撤销！`
            : `Are you sure you want to unstar ${repos.length} repositories? This action cannot be undone!`;

          if (!confirm(confirmMessage)) return;

          const githubApi = new GitHubApiService(githubToken);
          const successIds: number[] = [];

          for (const repo of repos) {
            try {
              const [owner, name] = repo.full_name.split('/');
              await githubApi.unstarRepository(owner, name);
              successIds.push(repo.id);
            } catch (error) {
              console.error(`Failed to unstar ${repo.full_name}:`, error);
            }
          }

          // 仅删除成功 unstar 的仓库
          for (const repoId of successIds) {
            deleteRepository(repoId);
          }

          await forceSyncToBackend();
          alert(language === 'zh'
            ? `成功取消 ${successIds.length} 个仓库的 Star`
            : `Successfully unstarred ${successIds.length} repositories`
          );
          break;
        }

        case 'categorize': {
          setShowCategorizeModal(true);
          return;
        }

        case 'restore': {
          setShowRestoreModal(true);
          return;
        }

        case 'ai-summary': {
          if (!githubToken) {
            alert(language === 'zh' ? 'GitHub token 未找到，请重新登录。' : 'GitHub token not found. Please login again.');
            return;
          }

          const confirmMessage = language === 'zh'
            ? `将对 ${repos.length} 个仓库进行 AI 分析，这可能需要几分钟时间。是否继续？`
            : `Will analyze ${repos.length} repositories with AI. This may take several minutes. Continue?`;

          if (!confirm(confirmMessage)) return;

          const activeConfig = aiConfigs.find(config => config.id === activeAIConfig);
          if (!activeConfig) {
            alert(language === 'zh' ? '请先在设置中配置 AI 服务。' : 'Please configure AI service in settings first.');
            return;
          }

          // 设置加载状态
          setLoading(true);
          isAnalyzingRef.current = true;
          setAnalysisProgress({ current: 0, total: repos.length });

          // 创建优化器实例并保存到 ref
          optimizerRef.current = new AIAnalysisOptimizer({
            initialConcurrency: activeConfig.concurrency || 3,
            maxConcurrency: 10,
            minConcurrency: 1,
            targetResponseTime: 5000,
            batchDelayMs: 100,
            maxRetries: 3,
            retryDelayBaseMs: 1000,
            enableAdaptiveConcurrency: true,
          });

          try {
            const githubApi = new GitHubApiService(githubToken);
            const aiService = new AIService(activeConfig, language);
            const categoryNames = allCategories.filter(cat => cat.id !== 'all').map(cat => cat.name);

            let successCount = 0;
            let failedCount = 0;

            const handleResult = (result: AnalysisResult) => {
              if (result.success) {
                const resolvedCategory = resolveCategoryAssignment(
                  result.repo,
                  result.tags || [],
                  allCategories
                );

                const wasCategoryLocked = !!result.repo.category_locked;
                const shouldKeepLocked = wasCategoryLocked && resolvedCategory !== undefined && resolvedCategory !== '';

                updateRepository({
                  ...result.repo,
                  ai_summary: result.summary,
                  ai_tags: result.tags,
                  ai_platforms: result.platforms,
                  custom_category: resolvedCategory,
                  category_locked: shouldKeepLocked || wasCategoryLocked,
                  analyzed_at: new Date().toISOString(),
                  analysis_failed: false,
                });
                successCount++;
              } else {
                updateRepository({
                  ...result.repo,
                  analyzed_at: new Date().toISOString(),
                  analysis_failed: true,
                });
                failedCount++;
              }
            };

            setAnalysisProgress({ current: 0, total: repos.length });

            await optimizerRef.current!.analyzeRepositoriesPipelined(
              repos,
              githubApi,
              aiService,
              categoryNames,
              (completed, total, currentConcurrency) => {
                setAnalysisProgress({ current: completed, total });
                console.log(`Bulk AI Analysis Progress: ${completed}/${total}, Concurrency: ${currentConcurrency}`);
              },
              handleResult
            );

            const stats = optimizerRef.current!.getStats();
            console.log('Bulk AI Analysis Stats:', stats);

            await forceSyncToBackend();
            alert(language === 'zh'
              ? `成功分析 ${successCount} 个仓库，失败 ${failedCount} 个 (平均响应: ${stats.averageResponseTime}ms)`
              : `Successfully analyzed ${successCount} repositories, ${failedCount} failed (avg: ${stats.averageResponseTime}ms)`
            );
          } catch (error) {
            console.error('Bulk AI analysis failed:', error);
            alert(language === 'zh' ? '批量AI分析失败' : 'Bulk AI analysis failed');
          } finally {
            // 确保状态重置
            optimizerRef.current = null;
            isAnalyzingRef.current = false;
            shouldStopRef.current = false;
            setLoading(false);
            setAnalysisProgress({ current: 0, total: 0 });
          }
          break;
        }

        case 'subscribe': {
          let successCount = 0;

          for (const repo of repos) {
            try {
              // 显式设置订阅为 true，避免误取消已订阅仓库
              const updatedRepo = { ...repo, subscribed_to_releases: true };
              updateRepository(updatedRepo);
              // 只在未订阅时才调用 toggle，避免误取消
              if (!releaseSubscriptions.has(repo.id)) {
                toggleReleaseSubscription(repo.id);
              }
              successCount++;
            } catch (error) {
              console.error(`Failed to subscribe ${repo.full_name}:`, error);
            }
          }

          await forceSyncToBackend();
          alert(language === 'zh'
            ? `成功订阅 ${successCount} 个仓库的版本发布`
            : `Successfully subscribed to ${successCount} repositories releases`
          );
          break;
        }

        case 'unsubscribe': {
          const subscribedRepos = repos.filter(repo => releaseSubscriptions.has(repo.id));
          
          if (subscribedRepos.length === 0) {
            alert(language === 'zh'
              ? '选中的仓库中没有被订阅的'
              : 'None of the selected repositories are subscribed'
            );
            return;
          }

          // 批量取消订阅
          const repoIds = subscribedRepos.map(repo => repo.id);
          batchUnsubscribeReleases(repoIds);

          // 更新仓库的 subscribed_to_releases 字段，记录失败项
          const failedRepos: string[] = [];
          for (const repo of subscribedRepos) {
            try {
              const updatedRepo = { ...repo, subscribed_to_releases: false };
              updateRepository(updatedRepo);
            } catch (error) {
              console.error(`Failed to update repository ${repo.full_name}:`, error);
              failedRepos.push(repo.full_name);
            }
          }

          await forceSyncToBackend();

          // 汇总结果显示
          const successCount = subscribedRepos.length - failedRepos.length;
          if (failedRepos.length > 0) {
            alert(language === 'zh'
              ? `成功取消 ${successCount} 个仓库的版本发布订阅\n\n失败 (${failedRepos.length} 个):\n${failedRepos.join('\n')}`
              : `Successfully unsubscribed ${successCount} repositories from releases\n\nFailed (${failedRepos.length}):\n${failedRepos.join('\n')}`
            );
          } else {
            alert(language === 'zh'
              ? `成功取消 ${successCount} 个仓库的版本发布订阅`
              : `Successfully unsubscribed ${successCount} repositories from releases`
            );
          }
          break;
        }

        case 'lock-category': {
          let successCount = 0;
          let skippedCount = 0;
          const failedRepos: string[] = [];

          for (const repo of repos) {
            try {
              // 只有有自定义分类的仓库才能锁定，锁定不改变自定义状态
              if (repo.custom_category && repo.custom_category !== '') {
                updateRepository({
                  ...repo,
                  category_locked: true,
                  last_edited: new Date().toISOString()
                });
                successCount++;
              } else {
                skippedCount++;
              }
            } catch (error) {
              console.error(`Failed to lock category for ${repo.full_name}:`, error);
              failedRepos.push(repo.full_name);
            }
          }

          await forceSyncToBackend();
          const skipMsg = skippedCount > 0
            ? (language === 'zh' ? `\n\n跳过 ${skippedCount} 个没有自定义分类的仓库` : `\n\nSkipped ${skippedCount} repositories without custom category`)
            : '';
          if (failedRepos.length > 0) {
            alert(language === 'zh'
              ? `成功锁定 ${successCount} 个仓库的分类\n\n失败 (${failedRepos.length} 个):\n${failedRepos.join('\n')}${skipMsg}`
              : `Successfully locked categories for ${successCount} repositories\n\nFailed (${failedRepos.length}):\n${failedRepos.join('\n')}${skipMsg}`
            );
          } else {
            alert(language === 'zh'
              ? `成功锁定 ${successCount} 个仓库的分类${skipMsg}`
              : `Successfully locked categories for ${successCount} repositories${skipMsg}`
            );
          }
          break;
        }

        case 'unlock-category': {
          let successCount = 0;
          const failedRepos: string[] = [];

          for (const repo of repos) {
            try {
              updateRepository({
                ...repo,
                category_locked: false,
                last_edited: new Date().toISOString()
              });
              successCount++;
            } catch (error) {
              console.error(`Failed to unlock category for ${repo.full_name}:`, error);
              failedRepos.push(repo.full_name);
            }
          }

          await forceSyncToBackend();
          if (failedRepos.length > 0) {
            alert(language === 'zh'
              ? `成功解锁 ${successCount} 个仓库的分类\n\n失败 (${failedRepos.length} 个):\n${failedRepos.join('\n')}`
              : `Successfully unlocked categories for ${successCount} repositories\n\nFailed (${failedRepos.length}):\n${failedRepos.join('\n')}`
            );
          } else {
            alert(language === 'zh'
              ? `成功解锁 ${successCount} 个仓库的分类`
              : `Successfully unlocked categories for ${successCount} repositories`
            );
          }
          break;
        }

        default:
          alert(language === 'zh' ? '未知操作' : 'Unknown action');
      }

      // 清除选择
      handleDeselectAll();
    } catch (error) {
      console.error('Bulk action failed:', error);
      alert(language === 'zh' ? '批量操作失败' : 'Bulk action failed');
    }
  };

  const handleBulkCategorize = async (categoryName: string) => {
    const selectedRepos = filteredRepositories.filter(repo =>
      selectedRepoIds.has(repo.id)
    );

    const failedRepos: string[] = [];

    for (const repo of selectedRepos) {
      try {
        // 获取所有分类用于计算AI和默认分类
        const allCategoriesList = getAllCategories(customCategories, language, hiddenDefaultCategoryIds, defaultCategoryOverrides);
        const aiCat = getAICategory(repo, allCategoriesList);
        const defaultCat = getDefaultCategory(repo, allCategoriesList);

        // 使用通用函数计算应该保存的自定义分类值
        // 如果设置的分类与AI/默认一致，则清除自定义标记
        const customCategoryValue = computeCustomCategory(categoryName, aiCat, defaultCat);

        updateRepository({
          ...repo,
          custom_category: customCategoryValue,
          category_locked: customCategoryValue !== undefined && customCategoryValue !== '',
          last_edited: new Date().toISOString()
        });
      } catch (error) {
        console.error(`Failed to categorize ${repo.full_name}:`, error);
        failedRepos.push(repo.full_name);
      }
    }

    await forceSyncToBackend();

    // 汇总结果显示
    const successCount = selectedRepos.length - failedRepos.length;
    if (failedRepos.length > 0) {
      alert(language === 'zh'
        ? `成功为 ${successCount} 个仓库设置分类：${categoryName}\n\n失败 (${failedRepos.length} 个):\n${failedRepos.join('\n')}`
        : `Successfully categorized ${successCount} repositories as: ${categoryName}\n\nFailed (${failedRepos.length}):\n${failedRepos.join('\n')}`
      );
    } else {
      alert(language === 'zh'
        ? `成功为 ${successCount} 个仓库设置分类：${categoryName}`
        : `Successfully categorized ${successCount} repositories as: ${categoryName}`
      );
    }

    handleDeselectAll();
  };

  if (filteredRepositories.length === 0) {
    const selectedCategoryObj = allCategories.find(cat => cat.id === selectedCategory);
    const categoryName = selectedCategoryObj?.name || selectedCategory;
    
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 dark:text-text-tertiary mb-4">
          {searchFilters.query ? (
            language === 'zh' 
              ? `未找到与"${searchFilters.query}"相关的仓库。`
              : `No repositories found for "${searchFilters.query}".`
          ) : selectedCategory === 'all' 
            ? (language === 'zh' ? '未找到仓库。点击同步加载您的星标仓库。' : 'No repositories found. Click sync to load your starred repositories.')
            : (language === 'zh' 
                ? `在"${categoryName}"分类中未找到仓库。`
                : `No repositories found in "${categoryName}" category.`
              )
          }
        </p>
        {searchFilters.query && (
          <div className="text-sm text-gray-400 dark:text-text-tertiary">
            <p className="mb-2">
              {language === 'zh' ? '搜索建议：' : 'Search suggestions:'}
            </p>
            <ul className="space-y-1">
              <li>• {language === 'zh' ? '尝试使用不同的关键词' : 'Try different keywords'}</li>
              <li>• {language === 'zh' ? '使用AI搜索进行语义匹配' : 'Use AI search for semantic matching'}</li>
              <li>• {language === 'zh' ? '检查拼写或尝试英文/中文关键词' : 'Check spelling or try English/Chinese keywords'}</li>
            </ul>
          </div>
        )}
      </div>
    );
  }

  const { unanalyzedCount, analyzedCount, failedCount } = repositoryStats;

  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

  return (
    <div className="space-y-6">


      {/* AI Analysis Controls - 移动端优化布局 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between bg-white dark:bg-panel-dark rounded-xl border border-black/[0.06] dark:border-white/[0.04] p-3 sm:p-4 gap-3 sm:gap-0">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
          {/* AI Analysis Dropdown Button */}
          <div className="relative">
            <button
              onClick={() => setShowDropdown(!showDropdown)}
              disabled={isLoading}
              className="flex items-center space-x-1 sm:space-x-2 px-3 sm:px-4 py-1.5 sm:py-2 bg-gray-100 dark:bg-white/[0.04] text-gray-700 dark:text-text-secondary dark:bg-brand-indigo/20 dark:text-brand-violet rounded-lg hover:bg-gray-100 dark:bg-white/[0.04] dark:hover:bg-brand-indigo/30 transition-colors disabled:opacity-50 text-sm font-medium"
            >
              <Bot className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span className="whitespace-nowrap">
                {isLoading
                  ? t(`分析中... (${analysisProgress.current}/${analysisProgress.total})`, `Analyzing... (${analysisProgress.current}/${analysisProgress.total})`)
                  : t('AI分析', 'AI Analysis')
                }
              </span>
              <ChevronDown className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </button>

            {/* Dropdown Menu */}
            {showDropdown && !isLoading && (
              <div className="absolute top-full left-0 mt-2 w-56 bg-white dark:bg-panel-dark border border-black/[0.06] dark:border-white/[0.04] rounded-lg shadow-dialog z-10">
                <button
                  onClick={() => handleAIAnalyze(false)}
                  className="w-full px-4 py-3 text-left hover:bg-light-bg dark:hover:bg-white/5 transition-colors border-b border-black/[0.04] dark:border-white/[0.04]"
                >
                  <div className="text-sm font-medium text-gray-900 dark:text-text-primary">
                    {t('分析全部', 'Analyze All')}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-text-tertiary mt-0.5">
                    {t(`分析 ${filteredRepositories.length} 个仓库`, `Analyze ${filteredRepositories.length} repositories`)}
                  </div>
                </button>
                <button
                  onClick={() => handleAIAnalyze(true)}
                  disabled={unanalyzedCount === 0}
                  className="w-full px-4 py-3 text-left hover:bg-light-bg dark:hover:bg-white/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed border-b border-black/[0.04] dark:border-white/[0.04]"
                >
                  <div className="text-sm font-medium text-gray-900 dark:text-text-primary">
                    {t('分析未分析的', 'Analyze Unanalyzed')}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-text-tertiary mt-0.5">
                    {t(`分析 ${unanalyzedCount} 个未分析仓库`, `Analyze ${unanalyzedCount} unanalyzed repositories`)}
                  </div>
                </button>
                <button
                  onClick={() => handleAIAnalyze(false, true)}
                  disabled={failedCount === 0}
                  className="w-full px-4 py-3 text-left hover:bg-light-bg dark:hover:bg-white/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="text-sm font-medium text-gray-900 dark:text-text-primary">
                    {t('重新分析失败的', 'Re-analyze Failed')}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-text-tertiary mt-0.5">
                    {t(`重新分析 ${failedCount} 个失败仓库`, `Re-analyze ${failedCount} failed repositories`)}
                  </div>
                </button>
              </div>
            )}
          </div>

          {/* Progress Bar and Controls - 移动端优化 */}
          {isLoading && analysisProgress.total > 0 && (
            <div className="flex items-center space-x-2 sm:space-x-3">
              <div className="w-20 sm:w-32 bg-gray-200 dark:bg-white/10 rounded-full h-2">
                <div
                  className="bg-gray-100 dark:bg-white/[0.04] h-2 rounded-full transition-all duration-300"
                  style={{ width: `${(analysisProgress.current / analysisProgress.total) * 100}%` }}
                ></div>
              </div>
              <span className="text-xs sm:text-sm text-gray-700 dark:text-text-tertiary">
                {Math.round((analysisProgress.current / analysisProgress.total) * 100)}%
              </span>
              <button
                onClick={handlePauseResume}
                className="p-1 sm:p-1.5 rounded-lg bg-gray-100 dark:bg-white/[0.04] text-gray-700 dark:text-text-secondary dark:bg-status-amber/20 dark:text-status-amber hover:bg-gray-100 dark:bg-white/[0.04] dark:hover:bg-status-amber/30 transition-colors"
                title={isPaused ? t('继续', 'Resume') : t('暂停', 'Pause')}
              >
                {isPaused ? <Play className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> : <Pause className="w-3.5 h-3.5 sm:w-4 sm:h-4" />}
              </button>
              <button
                onClick={handleStop}
                className="px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg bg-gray-100 dark:bg-white/[0.04] text-gray-700 dark:text-text-secondary dark:bg-status-red/20 dark:text-status-red hover:bg-gray-100 dark:bg-white/[0.04] dark:hover:bg-status-red/30 transition-colors text-xs sm:text-sm"
              >
                {t('停止', 'Stop')}
              </button>
            </div>
          )}

          {/* Description Toggle - Radio Style - 移动端优化 */}
          {!isLoading && (
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
              <span className="text-xs sm:text-sm text-gray-700 dark:text-text-tertiary">
                {t('显示内容:', 'Display:')}
              </span>
              <div className="flex items-center space-x-3 sm:space-x-4">
                <label 
                  className={`flex items-center space-x-1.5 sm:space-x-2 ${hasAnalyzedRepos ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}
                  title={hasAnalyzedRepos ? t('显示AI生成的分析总结', 'Show AI-generated analysis summary') : t('当前没有AI分析内容', 'No AI analysis content available')}
                >
                  <input
                    type="radio"
                    name="displayContent"
                    checked={showAISummary}
                    onChange={() => hasAnalyzedRepos && setShowAISummary(true)}
                    disabled={!hasAnalyzedRepos}
                    className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-brand-violet bg-light-surfaceborder-black/[0.06] focus:ring-brand-violet dark:focus:ring-brand-violet dark:ring-offset-marketing-black focus:ring-2 dark:bg-white/5 dark:border-white/20 disabled:opacity-50"
                  />
                  <span className="text-xs sm:text-sm font-medium text-gray-900 dark:text-text-secondary">
                    {t('AI分析内容', 'AI Analysis')}
                  </span>
                </label>
                <label 
                  className="flex items-center space-x-1.5 sm:space-x-2 cursor-pointer"
                  title={t('显示仓库原始描述', 'Show repository original description')}
                >
                  <input
                    type="radio"
                    name="displayContent"
                    checked={!showAISummary}
                    onChange={() => setShowAISummary(false)}
                    className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-brand-violet bg-light-surfaceborder-black/[0.06] focus:ring-brand-violet dark:focus:ring-brand-violet dark:ring-offset-marketing-black focus:ring-2 dark:bg-white/5 dark:border-white/20"
                  />
                  <span className="text-xs sm:text-sm font-medium text-gray-900 dark:text-text-secondary">
                    {t('原始描述', 'Original')}
                  </span>
                </label>
              </div>
            </div>
          )}
        </div>

        {/* Statistics */}
        <div className={disableCardAnimations ? 'repository-list-syncing' : undefined}>
          <div className="text-xs text-gray-500 dark:text-text-tertiary mt-0.5">
            <div className="flex items-center justify-between">
              <div>
                {t(
                  `第 ${startIndex}-${endIndex} / 共 ${filteredRepositories.length} 个仓库`,
                  `Showing ${startIndex}-${endIndex} of ${filteredRepositories.length} repositories`
                )}
                {repositories.length !== filteredRepositories.length && (
                  <span className="ml-2 text-brand-violet dark:text-brand-violet">
                    {t(`(从 ${repositories.length} 个中筛选)`, `(filtered from ${repositories.length})`)}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {analyzedCount > 0 && (
                  <span className="text-xs sm:text-sm">
                    • {analyzedCount} {t('个已AI分析', 'AI analyzed')}
                  </span>
                )}
                {failedCount > 0 && (
                  <span className="text-xs sm:text-sm">
                    • {failedCount} {t('个分析失败', 'analysis failed')}
                  </span>
                )}
                {unanalyzedCount > 0 && (
                  <span className="text-xs sm:text-sm">
                    • {unanalyzedCount} {t('个未分析', 'unanalyzed')}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Repository Grid with consistent card widths */}
      <div
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 min-h-[200px]"
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        {visibleRepositories.map(repo => (
          <RepositoryCard
            key={repo.id}
            repository={repo}
            showAISummary={showAISummary}
            searchQuery={useAppStore.getState().searchFilters.query}
            isSelected={selectedRepoIds.has(repo.id)}
            onSelect={handleSelectRepo}
            selectionMode={showBulkToolbar}
            isExitingSelection={isExitingSelection}
            allCategories={allCategories}
          />
        ))}
      </div>

      {/* Sentinel for on-demand loading */}
      {visibleCount < filteredRepositories.length && (
        <div ref={sentinelRef} className="h-8" />
      )}

      {/* Bulk Action Toolbar */}
      {showBulkToolbar && (
        <BulkActionToolbar
          selectedCount={selectedRepoIds.size}
          repositories={selectedRepositories}
          onSelectAll={handleSelectAll}
          onDeselectAll={handleDeselectAll}
          onBulkAction={handleBulkAction}
          onClose={() => {
            setIsExitingSelection(true);
            setTimeout(() => {
              setShowBulkToolbar(false);
              setSelectedRepoIds(new Set());
              requestAnimationFrame(() => {
                setIsExitingSelection(false);
              });
            }, 250);
          }}
        />
      )}

      {/* Bulk Categorize Modal */}
      <BulkCategorizeModal
        isOpen={showCategorizeModal}
        onClose={() => setShowCategorizeModal(false)}
        repositories={selectedRepositories}
        onCategorize={handleBulkCategorize}
      />

      <BulkRestoreModal
        isOpen={showRestoreModal}
        onClose={() => setShowRestoreModal(false)}
        repositories={selectedRepositories}
        onRestore={handleBulkRestore}
      />
    </div>
  );
};
