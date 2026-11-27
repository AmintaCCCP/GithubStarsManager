import { useT } from "../i18n/useT";
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import { Bot, ChevronDown, LayoutGrid, List, Pause, Play, SearchX, X } from 'lucide-react';
import { RepositoryCard } from './RepositoryCard';
import { SimilarViewBanner } from './SimilarViewBanner';
import { GlobalChatHistorySheet } from './GlobalChatHistorySheet';
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
    setSearchFilters,
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
    setSearchFilters: state.setSearchFilters,
    similarView: state.similarView,
    resetSimilarView: state.resetSimilarView,
    repositoryViewMode: state.repositoryViewMode,
    setRepositoryViewMode: state.setRepositoryViewMode,
  })));

  // 空状态的"清除全部筛选"出口：只重置筛选条件，保留查询词——查询词是
  // SearchBar 的本地输入状态，这里不重置以免输入框与结果列表失同步。
  const clearAllFilters = useCallback(() => {
    setSearchFilters({
      tags: [],
      languages: [],
      platforms: [],
      licenses: [],
      minStars: undefined,
      maxStars: undefined,
      isAnalyzed: undefined,
      isSubscribed: undefined,
      isEdited: undefined,
      isCategoryLocked: undefined,
      analysisFailed: undefined,
    });
  }, [setSearchFilters]);

  const hasActiveNonQueryFilters = useMemo(() => {
    // 契约测试的极简 store 只提供 query 字段；其余字段缺省时视为无筛选。
    if (!searchFilters) return false;
    return (searchFilters.languages?.length ?? 0) > 0 ||
      (searchFilters.tags?.length ?? 0) > 0 ||
      (searchFilters.platforms?.length ?? 0) > 0 ||
      (searchFilters.licenses?.length ?? 0) > 0 ||
      searchFilters.minStars !== undefined ||
      searchFilters.maxStars !== undefined ||
      searchFilters.isAnalyzed !== undefined ||
      searchFilters.isSubscribed !== undefined ||
      searchFilters.isEdited !== undefined ||
      searchFilters.isCategoryLocked !== undefined ||
      searchFilters.analysisFailed !== undefined;
  }, [searchFilters]);


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
  const selectionExitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeChatRepository, setActiveChatRepository] = useState<Repository | null>(null);
  const activeChatTriggerRef = useRef<HTMLElement | null>(null);
  // 全局问答历史（S4 入口）：抽屉 + 从历史进入单仓会话的目标会话。
  const [globalHistoryOpen, setGlobalHistoryOpen] = useState(false);
  const [globalChatSessionId, setGlobalChatSessionId] = useState<string | null>(null);

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
    // Similar results arrive pre-ranked by the vector worker's cosine score.
    // Do not let the normal list preference (stars/updated/name) overwrite that
    // relevance ordering after the card action has entered similar-view mode.
    if (similarView?.active) return categoryRepositories;
    if (searchFilters.query) return categoryRepositories;
    return sortRepositories(categoryRepositories, searchFilters.sortBy, searchFilters.sortOrder);
  }, [repositories, selectedCategory, allCategories, categoryMatchMode, searchFilters.query, searchFilters.sortBy, searchFilters.sortOrder, similarView?.active]);

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
    licenses: searchFilters.licenses,
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
    searchFilters.licenses,
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

  const t = useT('repositories');

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
    if (selectionExitTimerRef.current !== null) clearTimeout(selectionExitTimerRef.current);
    selectionExitTimerRef.current = setTimeout(() => {
      selectionExitTimerRef.current = null;
      setSelectedRepoIds(new Set());
      setShowBulkToolbar(false);
      requestAnimationFrame(() => {
        setIsExitingSelection(false);
      });
    }, 250);
  }, []);

  useEffect(() => () => {
    if (selectionExitTimerRef.current !== null) clearTimeout(selectionExitTimerRef.current);
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
    setGlobalChatSessionId(null);
    setActiveChatRepository(repository);
  }, []);

  // S4 全局入口（SearchBar「问答历史」按钮）经窗口事件打开历史抽屉。
  useEffect(() => {
    const handleOpenGlobalHistory = () => setGlobalHistoryOpen(true);
    window.addEventListener('gsm:open-global-chat-history', handleOpenGlobalHistory);
    return () => window.removeEventListener('gsm:open-global-chat-history', handleOpenGlobalHistory);
  }, []);

  const handleSelectGlobalSession = useCallback((repository: Repository, sessionId: string) => {
    const trigger = document.activeElement;
    activeChatTriggerRef.current = trigger instanceof HTMLElement ? trigger : null;
    setGlobalChatSessionId(sessionId);
    setActiveChatRepository(repository);
    setGlobalHistoryOpen(false);
  }, []);

  const handleCloseChat = useCallback(() => {
    setActiveChatRepository(null);
    setGlobalChatSessionId(null);
  }, []);

  const handleBackToGlobalHistory = useCallback(() => {
    setActiveChatRepository(null);
    setGlobalChatSessionId(null);
    setGlobalHistoryOpen(true);
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
          toast(t('repositoryList.unknown-action'), 'error');
          completed = true;
      }

      if (completed) {
        handleDeselectAll();
      }
    } catch (error) {
      console.error('Bulk action failed:', error);
      toast(t('repositoryList.bulk-action-failed'), 'error');
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
      <React.Suspense fallback={<div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim backdrop-blur-xs text-label text-secondary" role="status">{t('repositoryList.opening-repository-chat')}</div>}>
        <LazyRepositoryChatSheet
          isOpen
          repository={activeChatRepository}
          initialSessionId={globalChatSessionId}
          onBack={globalChatSessionId ? handleBackToGlobalHistory : undefined}
          onClose={handleCloseChat}
          onCloseAutoFocus={() => activeChatTriggerRef.current?.focus()}
        />
      </React.Suspense>
    </ErrorBoundary>,
    document.body,
  );

  const globalHistorySheet = (
    <GlobalChatHistorySheet
      isOpen={globalHistoryOpen}
      onClose={() => setGlobalHistoryOpen(false)}
      onSelectSession={handleSelectGlobalSession}
    />
  );

  if (filteredRepositories.length === 0) {
    const selectedCategoryObj = allCategories.find(cat => cat.id === selectedCategory);
    const categoryName = selectedCategoryObj?.name || selectedCategory;

    return (
      <>
        {similarView?.active && (
          <div className="mb-3">
            <SimilarViewBanner
              anchorRepoName={similarView.anchorRepoName}
              onReset={resetSimilarView}
              language={language}
            />
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-2 rounded-lg bg-paper px-6 py-14 text-center text-balance shadow-elev-0">
          <SearchX className="size-10 stroke-[1.5] text-tertiary" aria-hidden="true" />
          <p className="mt-1 text-label-lg font-medium text-foreground">
          {similarView?.active ? (
            t('useRepositoryCardActions.no-similar-repositories-found')
          ) : searchFilters?.query ? (
            t('repositoryList.no-repositories-found-for-v1', { v1: searchFilters.query })
          ) : selectedCategory === 'all'
            ? (t('repositoryList.no-repositories-found'))
            : (t('repositoryList.no-repositories-found-in-categoryname', { categoryName: categoryName })
              )
          }
          </p>
        {!similarView?.active && (
          <p className="max-w-sm text-label text-secondary">
            {searchFilters?.query ? (
              t('repositoryList.try-different-keywords-use-ai-search-for-semanti')
            ) : selectedCategory === 'all'
              ? (t('repositoryList.click-sync-to-load-your-starred-repositories'))
              : (t('repositoryList.switch-to-another-category-or-sync-to-load-more')
                )
            }
          </p>
        )}
        {hasActiveNonQueryFilters && (
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={clearAllFilters}
            className="mt-3"
          >
            <X className="size-3.5" />
            {t('repositoryList.clear-all-filters')}
          </Button>
        )}
        </div>
        {chatPortal}
        {globalHistorySheet}
      </>
    );
  }

  const { unanalyzedCount, analyzedCount, failedCount } = repositoryStats;

  return (
    <div className="mt-3 space-y-3">

      {/* Similar repositories view banner */}
      {similarView?.active && (
        <div className="mb-3">
          <SimilarViewBanner
            anchorRepoName={similarView.anchorRepoName}
            onReset={resetSimilarView}
            language={language}
          />
        </div>
      )}

      {/* Controls Bar */}
      <div className="ui-toolbar app-repository-controls flex flex-col gap-2.5 py-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2.5">

          {/* AI Analysis Select */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="md"
                disabled={isLoading}
                aria-label={t('repositoryList.ai-analysis-actions')}
                className="h-control w-auto min-w-28 justify-between gap-1.5 rounded-md px-2.5 text-label font-medium"
              >
                <Bot className="size-3.5 shrink-0 text-secondary" />
                {isLoading
                  ? t('repositoryList.analyzing-v1-v2', { v1: analysisProgress.current, v2: analysisProgress.total })
                  : t('repositoryList.ai-analysis')}
                <ChevronDown className="size-3.5 shrink-0 text-tertiary" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuItem onSelect={() => void handleAIAnalyze(false)}>
                {t('repositoryList.analyze-all-v1', { v1: filteredRepositories.length })}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={unanalyzedCount === 0} onSelect={() => void handleAIAnalyze(true)}>
                {t('repositoryList.analyze-unanalyzed-unanalyzedcount', { unanalyzedCount: unanalyzedCount })}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={failedCount === 0} onSelect={() => void handleAIAnalyze(false, true)}>
                {t('repositoryList.re-analyze-failed-failedcount', { failedCount: failedCount })}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Progress Bar and Controls - 移动端优化 */}
          {isLoading && analysisProgress.total > 0 && (
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-20 overflow-hidden rounded-full bg-fill-hover sm:w-28">
                <div
                  className="h-full rounded-full bg-accent-solid transition-[width] duration-300"
                  style={{ width: `${(analysisProgress.current / analysisProgress.total) * 100}%` }}
                />
              </div>
              <span className="text-label-sm text-secondary tabular-nums">
                {Math.round((analysisProgress.current / analysisProgress.total) * 100)}%
              </span>
              <Button
                variant="outline"
                size="icon-sm"
                onClick={handlePauseResume}
                className="size-control-sm rounded-sm text-secondary hover:text-foreground"
                aria-label={isPaused ? t('repositoryList.resume') : t('repositoryList.pause')}
                title={isPaused ? t('repositoryList.resume') : t('repositoryList.pause')}
              >
                {isPaused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={handleStop}
                className="h-control-sm rounded-sm px-2 text-label-sm"
              >
                {t('repositoryList.stop')}
              </Button>
            </div>
          )}

          {/* Description Toggle - Radio Style - 移动端优化 */}
          {!isLoading && (
            <div className="app-repository-display-row flex flex-wrap items-center gap-2.5">
              <span id="repository-display-content-label" className="text-label-sm text-tertiary">
                {t('repositoryList.display')}
              </span>
              <RadioGroup aria-labelledby="repository-display-content-label" value={showAISummary ? 'ai' : 'original'} onValueChange={(value) => { if (value === 'ai' && !hasAnalyzedRepos) return; setShowAISummary(value === 'ai'); }} className="app-compact-radio-group flex items-center gap-3">
                <label onClick={() => { if (hasAnalyzedRepos) setShowAISummary(true); }} className={`flex items-center gap-1.5 ${hasAnalyzedRepos ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`} title={hasAnalyzedRepos ? t('repositoryList.show-ai-generated-analysis-summary') : t('repositoryList.no-ai-analysis-content-available')}>
                  <RadioGroupItem value="ai" id="display-content-ai" aria-labelledby="display-content-ai-label" disabled={!hasAnalyzedRepos} />
                  <span id="display-content-ai-label" className={`text-label font-medium ${showAISummary ? 'text-foreground' : 'text-secondary'}`}>{t('repositoryList.ai-analysis-2')}</span>
                </label>
                <label onClick={() => setShowAISummary(false)} className="flex cursor-pointer items-center gap-1.5" title={t('repositoryList.show-repository-original-description')}>
                  <RadioGroupItem value="original" id="display-content-original" aria-labelledby="display-content-original-label" />
                  <span id="display-content-original-label" className={`text-label font-medium ${!showAISummary ? 'text-foreground' : 'text-secondary'}`}>{t('repositoryList.original')}</span>
                </label>
              </RadioGroup>
            </div>
          )}

        </div>

        {/* Statistics and view mode: the layout switch remains at the toolbar's far right. */}
        <div className={`ml-auto flex w-full flex-col items-end gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-3 ${disableCardAnimations ? 'repository-list-syncing' : ''}`}>
          <div className="app-context-row-copy text-label-sm text-tertiary tabular-nums sm:text-right">
            <div className="flex flex-wrap items-center justify-end gap-x-2.5 gap-y-1">
              <span>
                {t('repositoryList.showing-startindex-endindex-of-v3-repositories', { startIndex: startIndex, endIndex: endIndex, v3: filteredRepositories.length })}
                {repositories.length !== filteredRepositories.length && (
                  <span className="ml-1.5 text-accent-text">
                    {t('repositoryList.filtered-from-v1', { v1: repositories.length })}
                  </span>
                )}
              </span>
              {(analyzedCount > 0 || failedCount > 0 || unanalyzedCount > 0) && (
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  {analyzedCount > 0 && (
                    <span>
                      · {analyzedCount} {t('repositoryList.ai-analyzed')}
                    </span>
                  )}
                  {failedCount > 0 && (
                    <span className="text-destructive">
                      · {failedCount} {t('repositoryList.analysis-failed')}
                    </span>
                  )}
                  {unanalyzedCount > 0 && (
                    <span>
                      · {unanalyzedCount} {t('repositoryList.unanalyzed')}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {!isLoading && (
            <div className="app-segmented-control shrink-0" role="group" aria-label={t('repositoryList.repository-layout')}>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setRepositoryViewMode('grid')}
                aria-pressed={repositoryViewMode === 'grid'}
                aria-label={t('repositoryList.grid-view')}
                className="app-segmented-control-item"
                title={t('repositoryList.grid-view')}
              >
                <LayoutGrid className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setRepositoryViewMode('list')}
                aria-pressed={repositoryViewMode === 'list'}
                aria-label={t('repositoryList.list-view')}
                className="app-segmented-control-item"
                title={t('repositoryList.list-view')}
              >
                <List className="size-3.5" />
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Repository Grid with consistent card widths */}
      <div
        className={repositoryViewMode === 'list'
          ? 'app-repository-list min-h-[200px]'
          : 'app-repository-grid min-h-[200px]'}
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
      {globalHistorySheet}
    </div>
  );
};
