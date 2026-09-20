import { useT } from "../i18n/useT";
import { Button } from './ui/button';
import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus,
  Edit3,
  Trash2,
  EyeOff,
  ChevronLeft,
  ChevronRight,
  Undo2,
} from 'lucide-react';
import { Category, Repository } from '../types';
import { useAppStore, getAllCategories, sortCategoriesByOrder } from '../store/useAppStore';
import { useRepositoryDragStore } from '../store/useRepositoryDragStore';
import { useShallow } from 'zustand/react/shallow';
import { CategoryEditModal } from './CategoryEditModal';
import { useCategorySyncActions } from '../features/repositories/hooks/useCategorySyncActions';
import { getAICategory, getDefaultCategory, computeCustomCategory, matchesCategory } from '../utils/categoryUtils';
import { useDialog } from '../hooks/useDialog';

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
    collapsedSidebarCategoryCount,
    categoryMatchMode,
    deleteCustomCategory,
    hideDefaultCategory,
    showDefaultCategory,
    language,
    updateRepository,
    isSidebarCollapsed,
    setSidebarCollapsed,
  } = useAppStore(useShallow((state) => ({
    customCategories: state.customCategories,
    hiddenDefaultCategoryIds: state.hiddenDefaultCategoryIds,
    defaultCategoryOverrides: state.defaultCategoryOverrides,
    categoryOrder: state.categoryOrder,
    collapsedSidebarCategoryCount: state.collapsedSidebarCategoryCount,
    categoryMatchMode: state.categoryMatchMode,
    deleteCustomCategory: state.deleteCustomCategory,
    hideDefaultCategory: state.hideDefaultCategory,
    showDefaultCategory: state.showDefaultCategory,
    language: state.language,
    updateRepository: state.updateRepository,
    isSidebarCollapsed: state.isSidebarCollapsed,
    setSidebarCollapsed: state.setSidebarCollapsed,
  })));

  const { toast, confirm } = useDialog();
  const { forceSyncToBackend } = useCategorySyncActions();
  const t = useT('app');
  // 仓库卡片拖拽中：驱动「全部分类」变为「取消分类」热区提示
  const isRepoDragging = useRepositoryDragStore((state) => state.isDragging);

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [dragOverCategoryId, setDragOverCategoryId] = useState<string | null>(null);
  // 用于防止拖拽后触发点击的标志
  const justDroppedRef = useRef(false);
  const dropTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // isMobile 初始值从 window.innerWidth 同步获取（SSR安全）
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 1024;
  });
  // 控制文字显示的状态：等侧栏展开动效完成后再显示文字
  const [showText, setShowText] = useState(!isSidebarCollapsed);

  // 用于存储 showText 定时器的 ref
  const showTextTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 用于存储 toggleSidebar 定时器的 ref
  const toggleSidebarTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 分类列表滚动容器的 ref
  const categoryListRef = useRef<HTMLDivElement>(null);
  // 滚动条显示定时器 ref
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isScrolling, setIsScrolling] = useState(false);

  // 监听侧栏状态变化，同步更新文字显示状态
  useEffect(() => {
    if (isSidebarCollapsed) {
      setShowText(false);
    } else {
      // 清除之前的定时器
      if (showTextTimerRef.current) {
        clearTimeout(showTextTimerRef.current);
      }
      // 侧栏展开时，延迟显示文字，使用更短的延迟让体验更流畅
      showTextTimerRef.current = setTimeout(() => setShowText(true), 150);
    }
    return () => {
      if (showTextTimerRef.current) {
        clearTimeout(showTextTimerRef.current);
      }
    };
  }, [isSidebarCollapsed]);

  // 检测屏幕尺寸
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 1024);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // 切换侧栏折叠状态
  const toggleSidebar = useCallback(() => {
    // 清除之前的定时器
    if (toggleSidebarTimerRef.current) {
      clearTimeout(toggleSidebarTimerRef.current);
    }
    if (isSidebarCollapsed) {
      // 展开侧栏：先展开，再显示文字
      setSidebarCollapsed(false);
      toggleSidebarTimerRef.current = setTimeout(() => setShowText(true), 150); // 150ms 后显示文字，配合动效
    } else {
      // 折叠侧栏：先隐藏文字，再折叠
      setShowText(false);
      toggleSidebarTimerRef.current = setTimeout(() => setSidebarCollapsed(true), 120); // 120ms 后折叠，文字先消失
    }
  }, [isSidebarCollapsed, setSidebarCollapsed]);

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
      if (toggleSidebarTimerRef.current) {
        clearTimeout(toggleSidebarTimerRef.current);
      }
      if (dropTimeoutRef.current) {
        clearTimeout(dropTimeoutRef.current);
      }
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  // 键盘快捷键支持 (Ctrl/Cmd + B)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null;
      const isEditable = active?.tagName === 'INPUT' ||
                         active?.tagName === 'TEXTAREA' ||
                         active?.isContentEditable ||
                         active?.getAttribute('role') === 'textbox';
      if (isEditable) return;

      // 移动端时键盘快捷键不执行折叠切换，避免修改持久化状态
      if (isMobile) return;

      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleSidebar, isMobile]);

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
      await forceSyncToBackend();
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
      await forceSyncToBackend();
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

  const handleDropOnCategory = async (event: React.DragEvent<HTMLDivElement>, category: Category) => {
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
        await forceSyncToBackend();
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
      await forceSyncToBackend();
    } catch {
      handleSyncError(originalRepo);
    }
  };

  // 处理分类点击，防止拖拽后立即触发
  const handleCategoryClick = (categoryId: string) => {
    if (justDroppedRef.current) {
      return;
    }
    onCategorySelect(categoryId);
  };

  return (
    <>
      {/* 移动端：始终显示完整侧栏 */}
      {isMobile ? (
        <div className="w-full overflow-hidden rounded-md border border-border bg-card p-3 sm:p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-card-foreground">
              {t('categorySidebar.categories')}
            </h2>
            <Button
              variant="ghost"
              onClick={handleAddCategory}
              size="icon"
              className="h-8 w-8"
              title={t('categorySidebar.add-category')}
              aria-label={t('categorySidebar.add-category')}
            >
              <Plus className="w-4 h-4" />
            </Button>
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1">
            {allCategories.map(category => {
              const count = getCategoryCount(category);
              const isSelected = selectedCategory === category.id;
              const isDragTarget = dragOverCategoryId === category.id;
              // 拖拽仓库时「全部分类」变为「取消分类」拖放热区
              const isUncategorizeHotspot = category.id === 'all' && isRepoDragging;

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
                    className={`relative flex min-w-[140px] items-center justify-between rounded-md text-left transition-colors ${
                      isDragTarget
                        ? isUncategorizeHotspot
                          ? 'bg-warning/10 text-warning ring-1 ring-warning/40'
                          : 'bg-success/10 text-success ring-1 ring-success/40'
                        : isUncategorizeHotspot
                          ? 'border border-dashed border-warning/50 bg-warning/5 text-warning'
                          : isSelected
                            ? 'bg-accent text-accent-foreground font-medium'
                            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                    }`}
                    title={category.id !== 'all' ? t('categorySidebar.drag-hint', { name: category.name }) : (isUncategorizeHotspot ? t('categorySidebar.drop-here-to-remove-category') : undefined)}
                    aria-pressed={isSelected}
                    aria-current={isSelected ? 'page' : undefined}
                  >
                    <div className="flex items-center space-x-3 min-w-0 flex-1">
                      <span className="text-base flex-shrink-0">
                        {isUncategorizeHotspot ? <Undo2 className="h-4 w-4" /> : category.icon}
                      </span>
                      <span className="text-sm font-medium truncate">
                        {isUncategorizeHotspot ? t('categorySidebar.uncategorize') : category.name}
                      </span>
                    </div>
                    <span
                      className={`shrink-0 rounded-md px-2 py-0.5 text-xs ${
                        isDragTarget
                          ? isUncategorizeHotspot
                            ? 'bg-warning/10 text-warning'
                            : 'bg-success/10 text-success'
                          : isUncategorizeHotspot
                            ? 'bg-warning/10 text-warning'
                            : isSelected
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {count}
                    </span>
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* 桌面端：可折叠侧栏 - sticky定位，滚动时保持可见 */
        <div className="relative flex shrink-0 lg:sticky lg:top-16 lg:self-start z-10">
          {/* 侧栏容器 */}
          <div
              className={`linear-sidebar relative overflow-visible transition-all duration-200 ease-out ${
              isSidebarCollapsed
                ? 'w-14 p-2'
                : 'w-64 p-4'
            }`}
            style={{
              maxHeight: isSidebarCollapsed ? 'calc(100vh - 8rem)' : 'calc(100vh - 8rem)',
              transitionProperty: 'width, padding, max-height',
            }}
          >
            {/* 折叠状态：简洁视图 */}
            {isSidebarCollapsed ? (
              <div className="flex flex-col items-center space-y-3 max-h-[calc(100vh-12rem)] overflow-y-auto scrollbar-hide">
                {/* 展开按钮 - 放在折叠状态的顶部 */}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={toggleSidebar}
                  className="linear-icon-button w-8 h-8 flex items-center justify-center transition-colors duration-200"
                  title={t('categorySidebar.expand-sidebar-ctrl-cmd-b')}
                  aria-label={t('categorySidebar.expand-sidebar')}
                  aria-expanded="false"
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>

                <div className="h-px w-full bg-border" />

                {/* 折叠状态下的分类图标列表 */}
                <div className="flex flex-col items-center space-y-2">
                  {(() => {
                    // 确保选中分类在显示列表中
                    const selectedIndex = allCategories.findIndex(c => c.id === selectedCategory);
                    const isSelectedHidden = selectedIndex >= collapsedSidebarCategoryCount;
                    let displayCategories = allCategories.slice(0, collapsedSidebarCategoryCount);
                    if (isSelectedHidden && selectedIndex !== -1) {
                      // 用选中分类替换最后一个
                      displayCategories = [...allCategories.slice(0, collapsedSidebarCategoryCount - 1), allCategories[selectedIndex]];
                    }
                    return displayCategories.map((category) => {
                      const isSelected = selectedCategory === category.id;
                      const isDragTarget = dragOverCategoryId === category.id;
                      const isUncategorizeHotspot = category.id === 'all' && isRepoDragging;
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
                            size="icon"
                            className={`h-8 w-8 rounded-md text-lg transition-all duration-200 ${
                              isDragTarget
                                ? isUncategorizeHotspot
                                  ? 'bg-warning/10 text-warning outline outline-dashed outline-1 outline-warning/50'
                                  : 'bg-success/10 text-success ring-1 ring-success/40'
                                : isUncategorizeHotspot
                                  ? 'text-warning outline outline-dashed outline-1 outline-warning/50'
                                  : isSelected
                                    ? 'bg-accent text-accent-foreground font-medium'
                                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                            }`}
                            title={category.id !== 'all' ? t('categorySidebar.drag-hint', { name: category.name }) : (isUncategorizeHotspot ? t('categorySidebar.uncategorize-drop-here-to-remove-category') : category.name)}
                            aria-label={isUncategorizeHotspot ? t('categorySidebar.uncategorize') : category.name}
                          >
                            {isUncategorizeHotspot ? <Undo2 className="h-4 w-4" /> : category.icon}
                          </Button>
                        </div>
                      );
                    });
                  })()}
                </div>

                {/* 添加分类按钮 */}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleAddCategory}
                  className="linear-icon-button w-8 h-8 flex items-center justify-center"
                  title={t('categorySidebar.add-category')}
                  aria-label={t('categorySidebar.add-category')}
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              /* 展开状态：完整视图 */
              <div>
                {/* 头部 - 包含折叠按钮 */}
                <div className="flex items-center justify-between mb-4">
                  <h2
                      className={`text-base font-semibold text-card-foreground transition-all duration-200 ease-out ${
                      showText ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-2'
                    }`}
                  >
                    {t('categorySidebar.categories')}
                  </h2>
                  <div className="flex items-center gap-1 pr-3">
                    <Button
                      variant="ghost"
                      onClick={handleAddCategory}
                      size="icon"
              className="h-8 w-8"
                      title={t('categorySidebar.add-category')}
                      aria-label={t('categorySidebar.add-category')}
                    >
                      <Plus className="w-4 h-4" />
                    </Button>
                    {/* 折叠按钮 - 放在标题栏右侧 */}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={toggleSidebar}
                      className="h-8 w-8 rounded-md bg-muted text-muted-foreground transition-colors duration-200"
                      title={t('categorySidebar.collapse-sidebar-ctrl-cmd-b')}
                      aria-label={t('categorySidebar.collapse-sidebar')}
                      aria-expanded="true"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                {/* 分类列表 */}
                <div
                  ref={categoryListRef}
                  onScroll={handleCategoryScroll}
                  className={`-mr-4 max-h-[calc(100vh-12rem)] min-w-0 overflow-y-auto category-scrollbar ${isScrolling ? 'is-scrolling' : ''}`}
                >
                  <div className="space-y-1 pr-3">
                  {allCategories.map((category, index) => {
                    const count = getCategoryCount(category);
                    const isSelected = selectedCategory === category.id;
                    const isDragTarget = dragOverCategoryId === category.id;
                    // 拖拽仓库时「全部分类」变为「取消分类」拖放热区
                    const isUncategorizeHotspot = category.id === 'all' && isRepoDragging;

                    return (
                      <div
                        key={category.id}
                        className="group relative"
                        style={{
                          transitionDelay: showText ? `${Math.min(index * 30, 300)}ms` : '0ms',
                        }}
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
                          className={`flex h-9 w-full items-center justify-between rounded-md text-left transition-[color,background-color,border-color,opacity,transform] duration-200 ease-out pr-3 ${
                            isDragTarget
                              ? isUncategorizeHotspot
                                ? 'bg-warning/10 text-warning ring-1 ring-warning/40'
                                : 'bg-success/10 text-success ring-1 ring-success/40'
                              : isUncategorizeHotspot
                                ? 'border border-dashed border-warning/50 bg-warning/5 text-warning'
                                : isSelected
                                  ? 'bg-accent text-accent-foreground font-medium'
                                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                          } ${showText ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-3'}`}
                          title={category.id !== 'all' ? t('categorySidebar.drag-hint', { name: category.name }) : (isUncategorizeHotspot ? t('categorySidebar.uncategorize-drop-here-to-remove-category') : undefined)}
                        >
                          <div className="flex items-center space-x-3 min-w-0 flex-1">
                            <span className="text-base flex-shrink-0">
                              {isUncategorizeHotspot ? <Undo2 className="h-4 w-4" /> : category.icon}
                            </span>
                            <span
                              className={`text-sm font-medium truncate transition-[opacity,transform] duration-200 ease-out ${
                                showText ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-2'
                              }`}
                            >
                              {isUncategorizeHotspot ? t('categorySidebar.uncategorize') : category.name}
                            </span>
                          </div>

                          {/* 数字 badge - 正常状态显示，hover/focus-within 时隐藏 */}
                          <span
                              className={`ml-auto flex min-w-8 shrink-0 justify-center rounded-md px-2 py-0.5 text-xs transition-[color,background-color,border-color,opacity,transform] duration-200 ease-out ${
                              isDragTarget
                                ? isUncategorizeHotspot
                                  ? 'bg-warning/20 text-warning'
                                  : 'bg-success/20 text-success'
                                : isUncategorizeHotspot
                                  ? 'bg-warning/20 text-warning'
                                  : isSelected
                                    ? 'bg-primary text-primary-foreground'
                                    : 'bg-muted text-muted-foreground'
                            } ${showText ? 'opacity-100 scale-100' : 'opacity-0 scale-75'} group-hover:opacity-0 group-focus-within:opacity-0`}
                          >
                            {count}
                          </span>
                        </Button>

                        {/* 操作按钮 - 绝对定位，hover/focus-within 时显示，不占位 */}
                        {category.id !== 'all' && (
                          <div className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity pointer-events-none group-hover:pointer-events-auto group-focus-within:pointer-events-auto">
                            <Button
                              variant="ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEditCategory(category);
                              }}
                              size="icon"
                              className="h-7 w-7"
                              title={t('categorySidebar.edit-category')}
                              aria-label={t('categorySidebar.edit-category')}
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </Button>
                            {category.isCustom ? (
                              <Button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleDeleteCategory(category);
                                }}
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground"
                                title={t('categorySidebar.delete-category')}
                                aria-label={t('categorySidebar.delete-category')}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            ) : (
                              <Button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleHideDefaultCategory(category);
                                }}
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground"
                                title={t('categorySidebar.hide-default-category')}
                                aria-label={t('categorySidebar.hide-default-category')}
                              >
                                <EyeOff className="w-3.5 h-3.5" />
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <CategoryEditModal
        isOpen={editModalOpen}
        onClose={handleCloseModal}
        category={editingCategory}
        isCreating={isCreatingCategory}
      />
    </>
  );
};
