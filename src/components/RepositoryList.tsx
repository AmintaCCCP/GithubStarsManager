import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import { Bot, ChevronDown, LayoutGrid, List, Pause, Play } from 'lucide-react';
import { RepositoryCard } from './RepositoryCard';
import { SimilarViewBanner } from './SimilarViewBanner';
import { BulkActionToolbar } from './BulkActionToolbar';
import { BulkCategorizeModal } from './BulkCategorizeModal';
import { BulkRestoreModal, RestoreConfig } from './BulkRestoreModal';
import { ErrorBoundary } from './ErrorBoundary';

import { Repository } from '../types';
import { useAppStore, getAllCategories } from '../store/useAppStore';
import { matchesCategory } from '../utils/categoryUtils';
import { sortRepositories } from '../utils/repoSearch';
import { useRepositoryAnalysisJob } from '../features/repositories/hooks/useRepositoryAnalysisJob';
import { useBulkRepositoryActions } from '../features/repositories/hooks/useBulkRepositoryActions';
import { useDialog } from '../hooks/useDialog';
import { Button } from './ui/button';
import { RadioGroup, RadioGroupItem } from './ui/radio-group';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu';

const LazyRepositoryChatSheet = React.lazy(() =>
  import('./RepositoryChatSheet').then((module) => ({ default: module.default }))
);

interface RepositoryListProps {
  repositories: Repository[];
  selectedCategory: string;
}

export const RepositoryList: React.FC<RepositoryListProps> = ({
  repositories,
  selectedCategory
}) => {
  const {
    language,
    customCategories,
    hiddenDefaultCategoryIds,
    defaultCategoryOverrides,
    categoryMatchMode,
    searchFilters,
    similarView,
    resetSimilarView,
    repositoryViewMode,
    setRepositoryViewMode,
  } = useAppStore(useShallow((state) => ({
    language: state.language,
    customCategories: state.customCategories,
    hiddenDefaultCategoryIds: state.hiddenDefaultCategoryIds,
    defaultCategoryOverrides: state.defaultCategoryOverrides,
    categoryMatchMode: state.categoryMatchMode,
    searchFilters: state.searchFilters,
    similarView: state.similarView,
    resetSimilarView: state.resetSimilarView,
    repositoryViewMode: state.repositoryViewMode,
    setRepositoryViewMode: state.setRepositoryViewMode,
  })));


  const { toast } = useDialog();

  const [showAISummary, setShowAISummary] = useState(true);
  const [disableCardAnimations, setDisableCardAnimations] = useState(false);
  const previousCategoryRef = useRef(selectedCategory);
  const savedScrollYRef = useRef<number | null>(null);
  const restoreScrollFrameRef = useRef<number | null>(null);
  

  // 批量选择状态
  const [selectedRepoIds, setSelectedRepoIds] = useState<Set<number>>(new Set());
  const [showBulkToolbar, setShowBulkToolbar] = useState(false);
  const [showCategorizeModal, setShowCategorizeModal] = useState(false);
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [isExitingSelection, setIsExitingSelection] = useState(false);
  const [activeChatRepository, setActiveChatRepository] = useState<Repository | null>(null);
  const activeChatTriggerRef = useRef<HTMLElement | null>(null);

  const allCategories = useMemo(
    () => getAllCategories(customCategories, language, hiddenDefaultCategoryIds, defaultCategoryOverrides),
    [customCategories, language, hiddenDefaultCategoryIds, defaultCategoryOverrides]
  );
  const analysisJob = useRepositoryAnalysisJob({ allCategories });
  const bulkActions = useBulkRepositoryActions({ allCategories });
  const isLoading = analysisJob.isRunning;
  const { isPaused, progress: analysisProgress } = analysisJob;

  useEffect(() => {
    try {
      const pending = JSON.parse(sessionStorage.getItem('gsm:repository-chat-return') || 'null') as { repoId?: unknown } | null;
      if (typeof pending?.repoId !== 'number') return;
      const targetRepository = repositories.find((repository) => repository.id === pending.repoId);
      if (targetRepository) setActiveChatRepository(targetRepository);
    } catch {
      sessionStorage.removeItem('gsm:repository-chat-return');
    }
  }, [repositories]);

  const filteredRepositories = useMemo(() => {
    const categoryRepositories = selectedCategory === 'all'
      ? repositories
      : (() => {
        const selectedCategoryObj = allCategories.find(cat => cat.id === selectedCategory);
        return selectedCategoryObj
          ? repositories.filter(repo => matchesCategory(repo, selectedCategoryObj, categoryMatchMode))
          : [];
      })();
    return sortRepositories(categoryRepositories, searchFilters.sortBy, searchFilters.sortOrder);
  }, [repositories, selectedCategory, allCategories, categoryMatchMode, searchFilters.sortBy, searchFilters.sortOrder]);

  // 根据当前筛选的仓库中是否有AI分析内容来动态设置默认显示模式
  const hasAnalyzedRepos = useMemo(() => 
    filteredRepositories.some(repo => repo.analyzed_at && !repo.analysis_failed),
    [filteredRepositories]
  );
  
  // 当切换分类时，如果目标分类没有AI分析的仓库，自动切换到原始描述
  // 注意：不要在搜索/过滤过程中触发，否则会误关用户的显示偏好
  const prevHasAnalyzedRef = useRef(hasAnalyzedRepos);
  const prevCategoryRefForAI = useRef(selectedCategory);
  useEffect(() => {
    const categoryChanged = prevCategoryRefForAI.current !== selectedCategory;
    prevCategoryRefForAI.current = selectedCategory;
    prevHasAnalyzedRef.current = hasAnalyzedRepos;

    if (categoryChanged && !hasAnalyzedRepos && showAISummary) {
      setShowAISummary(false);
    }
  }, [hasAnalyzedRepos, selectedCategory, showAISummary]);

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

  const filterResetKey = useMemo(() => ({
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

  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

  const handleAIAnalyze = (analyzeUnanalyzedOnly: boolean = false, analyzeFailedOnly: boolean = false) => {
    const scope = analyzeFailedOnly ? 'failed' : analyzeUnanalyzedOnly ? 'unanalyzed' : 'all';
    const targetRepositories = analyzeFailedOnly
      ? filteredRepositories.filter((repository) => repository.analysis_failed)
      : analyzeUnanalyzedOnly
        ? filteredRepositories.filter((repository) => !repository.analyzed_at)
        : filteredRepositories;

    return analysisJob.run({
      repositories: targetRepositories,
      scope,
      syncOnComplete: false,
    });
  };

  const handlePauseResume = () => {
    if (isPaused) {
      analysisJob.resume();
      return;
    }
    analysisJob.pause();
  };

  const handleStop = () => analysisJob.requestStop();

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

  const handleAskRepository = useCallback((repository: Repository) => {
    const trigger = document.activeElement;
    activeChatTriggerRef.current = trigger instanceof HTMLElement ? trigger : null;
    setActiveChatRepository(repository);
  }, []);

  const handleBulkAction = async (action: string, selectedRepositories: Repository[]) => {
    try {
      let completed = false;
      switch (action) {
        case 'unstar':
          completed = await bulkActions.unstar(selectedRepositories);
          break;
        case 'categorize':
          setShowCategorizeModal(true);
          return;
        case 'restore':
          setShowRestoreModal(true);
          return;
        case 'ai-summary':
          completed = await analysisJob.run({
            repositories: selectedRepositories,
            scope: 'selected',
            syncOnComplete: true,
          });
          break;
        case 'subscribe':
          completed = await bulkActions.subscribe(selectedRepositories);
          break;
        case 'unsubscribe':
          completed = await bulkActions.unsubscribe(selectedRepositories);
          break;
        case 'lock-category':
          completed = await bulkActions.lockCategory(selectedRepositories);
          break;
        case 'unlock-category':
          completed = await bulkActions.unlockCategory(selectedRepositories);
          break;
        default:
          toast(language === 'zh' ? '未知操作' : 'Unknown action', 'error');
          completed = true;
      }

      if (completed) {
        handleDeselectAll();
      }
    } catch (error) {
      console.error('Bulk action failed:', error);
      toast(language === 'zh' ? '批量操作失败' : 'Bulk action failed', 'error');
    }
  };

  const handleBulkCategorize = async (categoryName: string) => {
    const selectedRepositories = filteredRepositories.filter((repository) => selectedRepoIds.has(repository.id));
    if (await bulkActions.categorize(selectedRepositories, categoryName)) {
      handleDeselectAll();
    }
  };

  const handleBulkRestore = async (config: RestoreConfig) => {
    const selectedRepositories = repositories.filter((repository) => selectedRepoIds.has(repository.id));
    if (await bulkActions.restore(selectedRepositories, config)) {
      handleDeselectAll();
    }
  };

  const chatPortal = activeChatRepository && createPortal(
    <ErrorBoundary>
      <React.Suspense fallback={<div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 text-sm text-muted-foreground" role="status">{t('正在打开仓库问答…', 'Opening repository chat…')}</div>}>
        <LazyRepositoryChatSheet
          isOpen
          repository={activeChatRepository}
          onClose={() => setActiveChatRepository(null)}
          onCloseAutoFocus={() => activeChatTriggerRef.current?.focus()}
        />
      </React.Suspense>
    </ErrorBoundary>,
    document.body,
  );

  if (filteredRepositories.length === 0) {
    const selectedCategoryObj = allCategories.find(cat => cat.id === selectedCategory);
    const categoryName = selectedCategoryObj?.name || selectedCategory;
    
    return (
      <>
        <div className="text-center py-12">
          <p className="text-muted-foreground dark:text-muted-foreground mb-4">
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
          <div className="text-sm text-muted-foreground dark:text-muted-foreground">
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
        {chatPortal}
      </>
    );
  }

  const { unanalyzedCount, analyzedCount, failedCount } = repositoryStats;

  return (
    <div className="space-y-5">

      {/* Similar repositories view banner */}
      {similarView?.active && (
        <SimilarViewBanner
          anchorRepoName={similarView.anchorRepoName}
          onReset={resetSimilarView}
          language={language}
        />
      )}

      {/* Controls Bar */}
      <div className="ui-toolbar flex flex-col sm:flex-row sm:items-center sm:justify-between p-3 sm:p-4 gap-3 sm:gap-0">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">

          {/* AI Analysis Select */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                disabled={isLoading}
                aria-label={t('AI 分析操作', 'AI analysis actions')}
                className="ui-field h-9 w-auto min-w-32 justify-between gap-2 px-3 py-1 text-sm font-medium"
              >
                <Bot className="h-4 w-4 shrink-0" />
                {isLoading
                  ? t(`分析中... (${analysisProgress.current}/${analysisProgress.total})`, `Analyzing... (${analysisProgress.current}/${analysisProgress.total})`)
                  : t('AI分析', 'AI Analysis')}
                <ChevronDown className="h-4 w-4 shrink-0 opacity-70" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuItem onSelect={() => void handleAIAnalyze(false)}>
                {t(`分析全部（${filteredRepositories.length}）`, `Analyze All (${filteredRepositories.length})`)}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={unanalyzedCount === 0} onSelect={() => void handleAIAnalyze(true)}>
                {t(`分析未分析的（${unanalyzedCount}）`, `Analyze Unanalyzed (${unanalyzedCount})`)}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={failedCount === 0} onSelect={() => void handleAIAnalyze(false, true)}>
                {t(`重新分析失败的（${failedCount}）`, `Re-analyze Failed (${failedCount})`)}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Progress Bar and Controls - 移动端优化 */}
          {isLoading && analysisProgress.total > 0 && (
            <div className="flex items-center space-x-2 sm:space-x-3">
              <div className="w-20 sm:w-32 bg-accent dark:bg-accent rounded-full h-2">
                <div
                  className="bg-primary dark:bg-primary h-2 rounded-full transition-all duration-300"
                  style={{ width: `${(analysisProgress.current / analysisProgress.total) * 100}%` }}
                ></div>
              </div>
              <span className="text-xs sm:text-sm text-muted-foreground dark:text-muted-foreground">
                {Math.round((analysisProgress.current / analysisProgress.total) * 100)}%
              </span>
              <Button
                variant="ghost"
                size="icon"
                onClick={handlePauseResume}
                className="h-7 w-7 p-0 rounded-lg bg-muted text-muted-foreground dark:bg-warning/20 dark:text-warning hover:bg-accent dark:hover:bg-warning/30 transition-colors"
                aria-label={isPaused ? t('继续', 'Resume') : t('暂停', 'Pause')}
                title={isPaused ? t('继续', 'Resume') : t('暂停', 'Pause')}
              >
                {isPaused ? <Play className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> : <Pause className="w-3.5 h-3.5 sm:w-4 sm:h-4" />}
              </Button>
              <Button
                variant="ghost"
                onClick={handleStop}
                className="h-7 px-2 sm:px-3 py-1 rounded-lg bg-muted text-muted-foreground dark:bg-destructive/20 dark:text-destructive hover:bg-accent dark:hover:bg-destructive/30 transition-colors text-xs sm:text-sm"
              >
                {t('停止', 'Stop')}
              </Button>
            </div>
          )}

          {/* Description Toggle - Radio Style - 移动端优化 */}
          {!isLoading && (
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
              <span id="repository-display-content-label" className="text-xs sm:text-sm text-muted-foreground dark:text-muted-foreground">
                {t('显示内容:', 'Display:')}
              </span>
              <RadioGroup aria-labelledby="repository-display-content-label" value={showAISummary ? 'ai' : 'original'} onValueChange={(value) => { if (value === 'ai' && !hasAnalyzedRepos) return; setShowAISummary(value === 'ai'); }} className="flex items-center space-x-3 sm:space-x-4">
                <label onClick={() => { if (hasAnalyzedRepos) setShowAISummary(true); }} className={`flex items-center space-x-1.5 sm:space-x-2 ${hasAnalyzedRepos ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`} title={hasAnalyzedRepos ? t('显示AI生成的分析总结', 'Show AI-generated analysis summary') : t('当前没有AI分析内容', 'No AI analysis content available')}>
                  <RadioGroupItem value="ai" id="display-content-ai" aria-labelledby="display-content-ai-label" disabled={!hasAnalyzedRepos} />
                  <span id="display-content-ai-label" className="text-xs font-medium text-foreground dark:text-muted-foreground sm:text-sm">{t('AI分析内容', 'AI Analysis')}</span>
                </label>
                <label onClick={() => setShowAISummary(false)} className="flex cursor-pointer items-center space-x-1.5 sm:space-x-2" title={t('显示仓库原始描述', 'Show repository original description')}>
                  <RadioGroupItem value="original" id="display-content-original" aria-labelledby="display-content-original-label" />
                  <span id="display-content-original-label" className="text-xs font-medium text-foreground dark:text-muted-foreground sm:text-sm">{t('原始描述', 'Original')}</span>
                </label>
              </RadioGroup>
            </div>
          )}

        </div>

        {/* Statistics and view mode: the layout switch remains at the toolbar's far right. */}
        <div className={`ml-auto flex w-full flex-col items-end gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-3 ${disableCardAnimations ? 'repository-list-syncing' : ''}`}>
          <div className="text-xs text-muted-foreground dark:text-muted-foreground mt-0.5 sm:text-right">
            <div className="flex items-center justify-between">
              <div>
                {t(
                  `第 ${startIndex}-${endIndex} / 共 ${filteredRepositories.length} 个仓库`,
                  `Showing ${startIndex}-${endIndex} of ${filteredRepositories.length} repositories`
                )}
                {repositories.length !== filteredRepositories.length && (
                  <span className="ml-2 text-primary dark:text-primary">
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

          {!isLoading && (
            <div className="flex shrink-0 items-center gap-1 rounded-lg border border-border bg-muted p-0.5 dark:border-border dark:bg-muted/40" role="group" aria-label={t('仓库布局', 'Repository layout')}>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setRepositoryViewMode('grid')}
                aria-pressed={repositoryViewMode === 'grid'}
                aria-label={t('多列卡片', 'Grid view')}
                className={`flex h-7 w-8 items-center justify-center rounded-md p-0 transition-colors ${repositoryViewMode === 'grid' ? 'bg-accent text-accent-foreground shadow-sm' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'}`}
                title={t('多列卡片', 'Grid view')}
              >
                <LayoutGrid className="w-4 h-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setRepositoryViewMode('list')}
                aria-pressed={repositoryViewMode === 'list'}
                aria-label={t('单列列表', 'List view')}
                className={`flex h-7 w-8 items-center justify-center rounded-md p-0 transition-colors ${repositoryViewMode === 'list' ? 'bg-accent text-accent-foreground shadow-sm' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'}`}
                title={t('单列列表', 'List view')}
              >
                <List className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Repository Grid with consistent card widths */}
      <div
        className={repositoryViewMode === 'list'
          ? 'space-y-2 min-h-[200px]'
          : 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 min-h-[200px]'}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        {visibleRepositories.map(repo => (
          <RepositoryCard
            key={repo.id}
            repository={repo}
            showAISummary={showAISummary}
            searchQuery={searchFilters.query}
            isSelected={selectedRepoIds.has(repo.id)}
            onSelect={handleSelectRepo}
            selectionMode={showBulkToolbar}
            isExitingSelection={isExitingSelection}
            allCategories={allCategories}
            viewMode={repositoryViewMode}
            onAskRepository={handleAskRepository}
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

      {chatPortal}
    </div>
  );
};
