import { useT } from "../i18n/useT";
import { Button } from './ui/button';
import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus,
  PencilLine,
  Trash2,
  EyeOff,
  Undo2,
  BellRing,
  Sparkles,
  CheckCircle2,
  Layers3,
} from 'lucide-react';
import { Category, Repository } from '../types';
import { useAppStore, getAllCategories, sortCategoriesByOrder } from '../store/useAppStore';
import { useRepositoryDragStore } from '../store/useRepositoryDragStore';
import { useShallow } from 'zustand/react/shallow';
import { CategoryEditModal } from './CategoryEditModal';
import { useCategorySyncActions } from '../features/repositories/hooks/useCategorySyncActions';
import { cancelActiveAiSearch } from '../features/repositories/hooks/useSearchActions';
import { getAICategory, getDefaultCategory, computeCustomCategory, matchesCategory } from '../utils/categoryUtils';
import { useDialog } from '../hooks/useDialog';
import { CategoryGlyph } from './CategoryGlyph';
import { ContextSidebarBody } from './ContextSidebarBody';

interface CategorySidebarProps {
  repositories: Repository[];
  selectedCategory: string;
  onCategorySelect: (category: string) => void;
}

export const CategorySidebar: React.FC<CategorySidebarProps> = ({
  repositories,
  selectedCategory,
  onCategorySelect
}) => {
  const {
    customCategories,
    hiddenDefaultCategoryIds,
    defaultCategoryOverrides,
    categoryOrder,
    categoryMatchMode,
    deleteCustomCategory,
    hideDefaultCategory,
    showDefaultCategory,
    language,
    updateRepository,
    releaseSubscriptions,
    searchFilters,
    setSearchFilters,
    lastSync,
    isSyncingStars,
  } = useAppStore(useShallow((state) => ({
    customCategories: state.customCategories,
    hiddenDefaultCategoryIds: state.hiddenDefaultCategoryIds,
    defaultCategoryOverrides: state.defaultCategoryOverrides,
    categoryOrder: state.categoryOrder,
    categoryMatchMode: state.categoryMatchMode,
    deleteCustomCategory: state.deleteCustomCategory,
    hideDefaultCategory: state.hideDefaultCategory,
    showDefaultCategory: state.showDefaultCategory,
    language: state.language,
    updateRepository: state.updateRepository,
    releaseSubscriptions: state.releaseSubscriptions,
    searchFilters: state.searchFilters,
    setSearchFilters: state.setSearchFilters,
    lastSync: state.lastSync,
    isSyncingStars: state.isSyncingStars,
  })));

  const { toast, confirm } = useDialog();
  const { forceSyncToBackend } = useCategorySyncActions();
  const t = useT('app');
  // 仓库卡片拖拽中：驱动「全部分类」变为「取消分类」热区提示
  const isRepoDragging = useRepositoryDragStore((state) => state.isDragging);

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  // 分类同步进行中/失败时，footer 不显示「已同步」：lastSync 只反映星标同步，
  // 分类变更是否落库需要单独跟踪，避免同步失败后状态文案失真
  const [isSyncingCategories, setIsSyncingCategories] = useState(false);
  const [hasCategorySyncFailure, setHasCategorySyncFailure] = useState(false);

  const syncCategories = async () => {
    setIsSyncingCategories(true);
    try {
      await forceSyncToBackend({ reportFailures: true });
      setHasCategorySyncFailure(false);
    } catch (error) {
      setHasCategorySyncFailure(true);
      throw error;
    } finally {
      setIsSyncingCategories(false);
    }
  };
  const [dragOverCategoryId, setDragOverCategoryId] = useState<string | null>(null);
  // 用于防止拖拽后触发点击的标志
  const justDroppedRef = useRef(false);
  const dropTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // isMobile 初始值从 window.innerWidth 同步获取（SSR安全）
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 1024;
  });
  // 分类列表滚动容器的 ref
  const categoryListRef = useRef<HTMLDivElement>(null);
  // 滚动条显示定时器 ref
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isScrolling, setIsScrolling] = useState(false);

  // 检测屏幕尺寸
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 1024);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // 处理分类列表滚动事件
  const handleCategoryScroll = useCallback(() => {
    setIsScrolling(true);
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }
    // 滚动停止 1 秒后隐藏滚动条
    scrollTimeoutRef.current = setTimeout(() => {
      setIsScrolling(false);
    }, 1000);
  }, []);

  // 组件卸载时清理定时器
  useEffect(() => {
    return () => {
      if (dropTimeoutRef.current) {
        clearTimeout(dropTimeoutRef.current);
      }
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  const allCategories = useMemo(() => {
    const categories = getAllCategories(customCategories, language, hiddenDefaultCategoryIds, defaultCategoryOverrides);
    return sortCategoriesByOrder(categories, categoryOrder);
  }, [customCategories, language, hiddenDefaultCategoryIds, defaultCategoryOverrides, categoryOrder]);

  const repositoryMap = useMemo(() => new Map(repositories.map(repo => [String(repo.id), repo])), [repositories]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    counts.set('all', repositories.length);
    
    for (const category of allCategories) {
      if (category.id === 'all') continue;
      const count = repositories.filter(repo => matchesCategory(repo, category, categoryMatchMode)).length;
      counts.set(category.id, count);
    }
    return counts;
  }, [repositories, allCategories, categoryMatchMode]);

  const subscribedRepoCount = useMemo(
    () => repositories.filter((repo) => releaseSubscriptions?.has(repo.id)).length,
    [repositories, releaseSubscriptions],
  );

  const needsReviewCount = useMemo(
    () => repositories.filter((repo) => !repo.analyzed_at).length,
    [repositories],
  );

  const navigableCategories = useMemo(
    () => allCategories.filter((category) => category.id !== 'all'),
    [allCategories],
  );

  const activeQuickAccess = searchFilters?.isSubscribed === true
    ? 'subscribed'
    : searchFilters?.isAnalyzed === false
      ? 'needs-review'
      : selectedCategory === 'all' &&
          !searchFilters?.query &&
          !searchFilters?.isSubscribed &&
          searchFilters?.isAnalyzed === undefined &&
          searchFilters?.analysisFailed === undefined
        ? 'all'
        : null;

  const getCategoryCount = useCallback((category: Category) => {
    return categoryCounts.get(category.id) ?? 0;
  }, [categoryCounts]);

  const handleAddCategory = () => {
    setIsCreatingCategory(true);
    setEditingCategory(null);
    setEditModalOpen(true);
  };

  const handleEditCategory = (category: Category) => {
    setIsCreatingCategory(false);
    setEditingCategory(category);
    setEditModalOpen(true);
  };

  const handleDeleteCategory = async (category: Category) => {
    const confirmed = await confirm(
      t('categorySidebar.delete-category-confirmation'),
      t('categorySidebar.delete-custom-category-v1-repositories-will-stay', { v1: category.name }),
      { type: 'danger', confirmText: t('categorySidebar.delete') }
    );

    if (!confirmed) return;

    deleteCustomCategory(category.id);
    try {
      await syncCategories();
    } catch {
      toast(t('categorySidebar.failed-to-delete-category-please-check-backend-c'), 'error');
    }
  };

  const handleHideDefaultCategory = async (category: Category) => {
    const confirmed = await confirm(
      t('categorySidebar.hide-category-confirmation'),
      t('categorySidebar.hide-default-category-v1-this-will-not-delete-an', { v1: category.name }),
      { type: 'warning' }
    );

    if (!confirmed) return;

    hideDefaultCategory(category.id);
    try {
      await syncCategories();
    } catch {
      showDefaultCategory(category.id);
      toast(t('categorySidebar.failed-to-hide-category-please-check-backend-con'), 'error');
    }
  };

  const handleCloseModal = () => {
    setEditModalOpen(false);
    setEditingCategory(null);
    setIsCreatingCategory(false);
  };

  const handleSyncError = (originalRepo: Repository) => {
    updateRepository(originalRepo);
    setDragOverCategoryId(null);
    toast(
      t('categorySidebar.sync-failed-reverted'),
      'error'
    );
  };

  const handleDropOnCategory = async (event: React.DragEvent<HTMLElement>, category: Category) => {
    event.preventDefault();
    setDragOverCategoryId(null);

    // 设置标志防止拖拽后触发点击
    justDroppedRef.current = true;
    if (dropTimeoutRef.current) {
      clearTimeout(dropTimeoutRef.current);
    }
    dropTimeoutRef.current = setTimeout(() => {
      justDroppedRef.current = false;
    }, 300);

    // drop 先于 dragend 派发；若当前正处于某分类视图，源卡片即将因分类变更
    // 从列表卸载，其 React dragend 将丢失，这里显式复位拖拽状态（issue #353）
    useRepositoryDragStore.getState().endDrag();

    const repoId = event.dataTransfer.getData('application/x-gsm-repository-id');
    const repository = repositoryMap.get(repoId);
    if (!repository) return;

    const allCategoriesList = getAllCategories(customCategories, language, hiddenDefaultCategoryIds, defaultCategoryOverrides);

    // 拖到「全部分类」= 取消分类：显式清空（''），与编辑弹窗清空分类的结果一致；
    // resolveCategoryAssignment 会保留显式清空，后续 AI 重新分析不会重新归类
    if (category.id === 'all') {
      // 已显式清空过的仓库无需再写
      if (repository.custom_category === '') return;
      // 无锁定分类且 AI/默认分类均未命中时，仓库本就无归属：
      // 写入 '' 会被 resolveCategoryAssignment 永久保留，阻止后续 AI 重新归类，故 no-op
      const hasAssignedCategory = !!repository.custom_category ||
        !!(getAICategory(repository, allCategoriesList) || getDefaultCategory(repository, allCategoriesList));
      if (!hasAssignedCategory) return;

      const originalRepo = { ...repository };
      const nextRepo = {
        ...repository,
        custom_category: '',
        category_locked: false,
        last_edited: new Date().toISOString(),
      };
      updateRepository(nextRepo);

      try {
        await syncCategories();
      } catch {
        handleSyncError(originalRepo);
      }
      return;
    }

    const originalRepo = { ...repository };

    const aiCat = getAICategory(repository, allCategoriesList);
    const defaultCat = getDefaultCategory(repository, allCategoriesList);

    // 使用通用函数计算应该保存的自定义分类值
    // 如果拖拽的分类与AI/默认一致，则清除自定义标记
    const customCategoryValue = computeCustomCategory(category.name, aiCat, defaultCat);

    const nextRepo = {
      ...repository,
      custom_category: customCategoryValue,
      category_locked: customCategoryValue !== undefined && customCategoryValue !== '',
      last_edited: new Date().toISOString(),
    };

    updateRepository(nextRepo);

    try {
      await syncCategories();
    } catch {
      handleSyncError(originalRepo);
    }
  };

  // 处理分类点击，防止拖拽后立即触发
  const handleCategoryClick = (categoryId: string) => {
    if (justDroppedRef.current) {
      return;
    }
    setSearchFilters?.({
      isSubscribed: undefined,
      isAnalyzed: undefined,
      analysisFailed: undefined,
    });
    onCategorySelect(categoryId);
  };

  const handleQuickAccess = (mode: 'all' | 'subscribed' | 'needs-review') => {
    // 快速访问会清空搜索条件：先中止在途 AI 搜索，
    // 防止旧搜索完成后写回过期结果并恢复旧查询词
    cancelActiveAiSearch();
    const resetFilters = {
      query: '',
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
      healthArchived: undefined,
      healthRecentActivity: undefined,
      healthHasLicense: undefined,
    };
    if (mode === 'all') {
      setSearchFilters?.(resetFilters);
      onCategorySelect('all');
      return;
    }
    setSearchFilters?.({
      ...resetFilters,
      ...(mode === 'subscribed'
        ? { isSubscribed: true }
        : { isAnalyzed: false }),
    });
    onCategorySelect('all');
  };

  return (
    <aside data-context-sidebar="repositories" aria-label={t('categorySidebar.categories')} className="w-full lg:w-auto lg:self-stretch">
      {/* 移动端：始终显示完整侧栏 */}
      {isMobile ? (
        <section aria-label={t('categorySidebar.categories')} className="context-sidebar-section">
          <div className="app-side-section">
            <p className="app-section-label app-side-group-label text-label-sm font-medium text-tertiary">
              {t('categorySidebar.quick-access')}
            </p>
            <div className="app-side-list">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleQuickAccess('all')}
                aria-pressed={activeQuickAccess === 'all'}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragOverCategoryId('all');
                }}
                onDragLeave={() => {
                  if (dragOverCategoryId === 'all') setDragOverCategoryId(null);
                }}
                onDrop={(event) => {
                  const allCategory = allCategories.find((category) => category.id === 'all');
                  if (allCategory) void handleDropOnCategory(event, allCategory);
                }}
                title={isRepoDragging ? t('categorySidebar.drop-here-to-remove-category') : undefined}
                className={`app-side-item !h-row-sidebar !rounded-sm !font-normal justify-between text-left ${
                  isRepoDragging
                    ? '!bg-warning-tint !text-warning'
                    : activeQuickAccess === 'all'
                      ? '!bg-fill-selected !text-foreground'
                      : 'text-secondary hover:bg-fill-hover hover:text-foreground'
                }`}
              >
                <span className="app-side-item-label">
                  {isRepoDragging ? <Undo2 className="size-4" /> : <Layers3 className="size-4" />}
                  <span>{isRepoDragging ? t('categorySidebar.uncategorize') : t('categorySidebar.all-repositories')}</span>
                </span>
                {repositories.length > 0 && (
                  <span className="app-side-count tabular-nums">{repositories.length}</span>
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleQuickAccess('subscribed')}
                aria-pressed={activeQuickAccess === 'subscribed'}
                className={`app-side-item !h-row-sidebar !rounded-sm !font-normal justify-between text-left ${
                  activeQuickAccess === 'subscribed'
                    ? '!bg-fill-selected !text-foreground'
                    : 'text-secondary hover:bg-fill-hover hover:text-foreground'
                }`}
              >
                <span className="app-side-item-label">
                  <BellRing className="size-4" />
                  <span>{t('searchBar.subscribed-to-releases')}</span>
                </span>
                {subscribedRepoCount > 0 && (
                  <span className="app-side-count tabular-nums">{subscribedRepoCount}</span>
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleQuickAccess('needs-review')}
                aria-pressed={activeQuickAccess === 'needs-review'}
                className={`app-side-item !h-row-sidebar !rounded-sm !font-normal justify-between text-left ${
                  activeQuickAccess === 'needs-review'
                    ? '!bg-fill-selected !text-foreground'
                    : 'text-secondary hover:bg-fill-hover hover:text-foreground'
                }`}
              >
                <span className="app-side-item-label">
                  <Sparkles className="size-4" />
                  <span>{t('categorySidebar.needs-review')}</span>
                </span>
                {needsReviewCount > 0 && (
                  <span className="app-side-count tabular-nums">{needsReviewCount}</span>
                )}
              </Button>
            </div>
          </div>

          <div className="mx-2 my-1 h-px bg-separator" />

          <div className="app-side-section">
            <div className="app-collection-row">
              <div className="flex items-center gap-2">
                <h2 className="app-section-label text-label-sm font-medium text-tertiary">
                  {t('categorySidebar.categories')}
                </h2>
                {navigableCategories.length > 0 && (
                  <span className="app-side-count shrink-0 tabular-nums">
                    {navigableCategories.length}
                  </span>
                )}
              </div>
              <Button
                variant="ghost"
                onClick={handleAddCategory}
                size="icon"
                className="linear-icon-button size-control-sm rounded-sm text-tertiary hover:bg-fill-hover hover:text-foreground"
                title={t('categorySidebar.add-category')}
                aria-label={t('categorySidebar.add-category')}
              >
                <Plus className="size-3.5" />
              </Button>
            </div>

            <div className="app-category-strip">
              {navigableCategories.map(category => {
                const count = getCategoryCount(category);
                const isSelected = selectedCategory === category.id;
                const isDragTarget = dragOverCategoryId === category.id;

                return (
                  <div
                    key={category.id}
                    className="group shrink-0"
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDragOverCategoryId(category.id);
                    }}
                    onDragLeave={() => {
                      if (dragOverCategoryId === category.id) {
                        setDragOverCategoryId(null);
                      }
                    }}
                    onDrop={(event) => handleDropOnCategory(event, category)}
                  >
                    <Button
                      variant="ghost"
                      onClick={() => handleCategoryClick(category.id)}
                      size="sm"
                      className={`app-side-item app-category-pill relative !h-row-sidebar !rounded-sm !font-normal justify-between text-left ${
                        isDragTarget
                          ? '!bg-success-tint !text-status-green ring-1 ring-status-green/30'
                          : isSelected
                            ? '!bg-fill-selected !text-foreground'
                            : 'text-secondary hover:bg-fill-hover hover:text-foreground'
                      }`}
                      title={t('categorySidebar.drag-hint', { name: category.name })}
                      aria-pressed={isSelected}
                      aria-current={isSelected ? 'page' : undefined}
                    >
                      <span className="app-side-item-label">
                        <CategoryGlyph
                          icon={category.icon}
                          name={category.name}
                          categoryId={category.id}
                        />
                        <span className="truncate">{category.name}</span>
                      </span>
                      {(count > 0 || isDragTarget) && (
                        <span
                          className={`app-side-count shrink-0 tabular-nums ${
                            isDragTarget ? '!text-status-green' : ''
                          }`}
                        >
                          {count}
                        </span>
                      )}
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      ) : (
        <div className="app-category-sidebar-shell relative flex shrink-0">
          <div className="linear-sidebar relative w-(--app-sidebar-width) overflow-visible">
            <div className="context-sidebar-head !min-h-[44px] !px-gutter !pt-3 !pb-1.5">
              <h2 className="app-side-title !text-label-lg !font-semibold">
                {t('categorySidebar.categories')}
              </h2>
            </div>

            <ContextSidebarBody>
              <section className="app-side-section !pt-1" aria-label={t('categorySidebar.quick-access')}>
                <p className="app-section-label app-side-group-label text-label-sm font-medium text-tertiary">
                  {t('categorySidebar.quick-access')}
                </p>
                <div className="app-side-list">
                  <Button
                    variant="ghost"
                    onClick={() => handleQuickAccess('all')}
                    aria-pressed={activeQuickAccess === 'all'}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDragOverCategoryId('all');
                    }}
                    onDragLeave={() => {
                      if (dragOverCategoryId === 'all') setDragOverCategoryId(null);
                    }}
                    onDrop={(event) => {
                      const allCategory = allCategories.find((category) => category.id === 'all');
                      if (allCategory) void handleDropOnCategory(event, allCategory);
                    }}
                    className={`app-side-item !h-row-sidebar !rounded-sm !font-normal justify-between ${
                      isRepoDragging
                        ? '!bg-warning-tint !text-warning'
                        : activeQuickAccess === 'all'
                          ? '!bg-fill-selected !text-foreground'
                          : 'text-secondary hover:bg-fill-hover hover:text-foreground'
                    }`}
                    title={isRepoDragging ? t('categorySidebar.drop-here-to-remove-category') : undefined}
                  >
                    <span className="app-side-item-label">
                      {isRepoDragging ? <Undo2 className="size-4" /> : <Layers3 className="size-4" />}
                      <span>{isRepoDragging ? t('categorySidebar.uncategorize') : t('categorySidebar.all-repositories')}</span>
                    </span>
                    {repositories.length > 0 && (
                      <span className="app-side-count tabular-nums">{repositories.length}</span>
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => handleQuickAccess('subscribed')}
                    aria-pressed={activeQuickAccess === 'subscribed'}
                    className={`app-side-item !h-row-sidebar !rounded-sm !font-normal justify-between ${
                      activeQuickAccess === 'subscribed'
                        ? '!bg-fill-selected !text-foreground'
                        : 'text-secondary hover:bg-fill-hover hover:text-foreground'
                    }`}
                  >
                    <span className="app-side-item-label">
                      <BellRing className="size-4" />
                      <span>{t('searchBar.subscribed-to-releases')}</span>
                    </span>
                    {subscribedRepoCount > 0 && (
                      <span className="app-side-count tabular-nums">{subscribedRepoCount}</span>
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => handleQuickAccess('needs-review')}
                    aria-pressed={activeQuickAccess === 'needs-review'}
                    className={`app-side-item !h-row-sidebar !rounded-sm !font-normal justify-between ${
                      activeQuickAccess === 'needs-review'
                        ? '!bg-fill-selected !text-foreground'
                        : 'text-secondary hover:bg-fill-hover hover:text-foreground'
                    }`}
                  >
                    <span className="app-side-item-label">
                      <Sparkles className="size-4" />
                      <span>{t('categorySidebar.needs-review')}</span>
                    </span>
                    {needsReviewCount > 0 && (
                      <span className="app-side-count tabular-nums">{needsReviewCount}</span>
                    )}
                  </Button>
                </div>
              </section>

              <div className="mx-2 my-1 h-px bg-separator" />

              <section className="app-side-section !mt-1" aria-label={t('categorySidebar.category-group')}>
                <div className="app-collection-row">
                  <div className="flex items-center gap-1.5">
                    <span className="app-section-label text-label-sm font-medium text-tertiary">
                      {t('categorySidebar.category-group')}
                    </span>
                    {navigableCategories.length > 0 && (
                      <span className="app-side-count shrink-0 tabular-nums">{navigableCategories.length}</span>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    onClick={handleAddCategory}
                    size="icon"
                    className="linear-icon-button size-control-sm rounded-sm text-tertiary hover:bg-fill-hover hover:text-foreground"
                    title={t('categorySidebar.add-category')}
                    aria-label={t('categorySidebar.add-category')}
                  >
                    <Plus className="size-3.5" />
                  </Button>
                </div>

                <div
                  ref={categoryListRef}
                  onScroll={handleCategoryScroll}
                  className={`min-w-0 overflow-visible category-scrollbar ${isScrolling ? 'is-scrolling' : ''}`}
                >
                  <div className="app-side-list">
                    {navigableCategories.map((category) => {
                      const count = getCategoryCount(category);
                      const isSelected = selectedCategory === category.id;
                      const isDragTarget = dragOverCategoryId === category.id;

                      return (
                        <div
                          key={category.id}
                          className="group relative"
                          onDragOver={(event) => {
                            event.preventDefault();
                            setDragOverCategoryId(category.id);
                          }}
                          onDragLeave={() => {
                            if (dragOverCategoryId === category.id) {
                              setDragOverCategoryId(null);
                            }
                          }}
                          onDrop={(event) => handleDropOnCategory(event, category)}
                        >
                          <Button
                            variant="ghost"
                            onClick={() => handleCategoryClick(category.id)}
                            aria-pressed={isSelected}
                            size="sm"
                            className={`app-side-item flex w-full !h-row-sidebar !rounded-sm !font-normal items-center justify-between pr-2 text-left ${
                              isDragTarget
                                ? '!bg-success-tint !text-status-green ring-1 ring-status-green/30'
                                : isSelected
                                  ? '!bg-fill-selected !text-foreground'
                                  : 'text-secondary hover:bg-fill-hover hover:text-foreground'
                            }`}
                            title={t('categorySidebar.drag-hint', { name: category.name })}
                          >
                            <span className="app-side-item-label">
                              <CategoryGlyph
                                icon={category.icon}
                                name={category.name}
                                categoryId={category.id}
                              />
                              <span className="truncate">{category.name}</span>
                            </span>
                            {(count > 0 || isDragTarget) && (
                              <span
                                className={`app-side-count ml-auto flex shrink-0 justify-center tabular-nums transition-opacity duration-micro ease-out-subtle group-hover:opacity-0 group-focus-within:opacity-0 ${
                                  isDragTarget ? '!text-status-green' : ''
                                }`}
                              >
                                {count}
                              </span>
                            )}
                          </Button>

                          <div className="pointer-events-none absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity duration-micro ease-out-subtle group-hover:pointer-events-auto group-hover:opacity-100 group-hover:duration-instant group-focus-within:pointer-events-auto group-focus-within:opacity-100">
                            <Button
                              variant="ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEditCategory(category);
                              }}
                              size="icon"
                              className="linear-icon-button app-side-action-button"
                              title={t('categorySidebar.edit-category')}
                              aria-label={t('categorySidebar.edit-category')}
                            >
                              <PencilLine />
                            </Button>
                            {category.isCustom ? (
                              <Button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleDeleteCategory(category);
                                }}
                                variant="ghost"
                                size="icon"
                                className="linear-icon-button app-side-action-button"
                                title={t('categorySidebar.delete-category')}
                                aria-label={t('categorySidebar.delete-category')}
                              >
                                <Trash2 />
                              </Button>
                            ) : (
                              <Button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleHideDefaultCategory(category);
                                }}
                                variant="ghost"
                                size="icon"
                                className="linear-icon-button app-side-action-button"
                                title={t('categorySidebar.hide-default-category')}
                                aria-label={t('categorySidebar.hide-default-category')}
                              >
                                <EyeOff />
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </section>
            </ContextSidebarBody>
            <div className="context-sidebar-foot border-t border-subtle px-gutter py-2.5">
              {lastSync && !isSyncingStars && !isSyncingCategories && !hasCategorySyncFailure && (
                <div className="app-side-foot-status">
                  <span className="app-status-dot" aria-hidden="true" />
                  <span>{t('categorySidebar.synced')}</span>
                </div>
              )}
              <div className="app-side-foot-meta">
                <span>{t('categorySidebar.repository-count', { count: repositories.length })}</span>
                {lastSync && !isSyncingStars && !isSyncingCategories && !hasCategorySyncFailure && <CheckCircle2 className="size-3.5" aria-hidden="true" />}
              </div>
            </div>
          </div>
        </div>
      )}

      <CategoryEditModal
        isOpen={editModalOpen}
        onClose={handleCloseModal}
        category={editingCategory}
        isCreating={isCreatingCategory}
      />
    </aside>
  );
};
