import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus,
  Edit3,
  Trash2,
  EyeOff,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Category, Repository } from '../types';
import { useAppStore, getAllCategories, sortCategoriesByOrder } from '../store/useAppStore';
import { CategoryEditModal } from './CategoryEditModal';
import { forceSyncToBackend } from '../services/autoSync';

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
    categoryOrder,
    collapsedSidebarCategoryCount,
    deleteCustomCategory,
    hideDefaultCategory,
    language,
    updateRepository,
    isSidebarCollapsed,
    setSidebarCollapsed,
  } = useAppStore();

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [dragOverCategoryId, setDragOverCategoryId] = useState<string | null>(null);
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

  // 监听侧栏状态变化，同步更新文字显示状态
  useEffect(() => {
    if (isSidebarCollapsed) {
      setShowText(false);
    } else {
      // 清除之前的定时器
      if (showTextTimerRef.current) {
        clearTimeout(showTextTimerRef.current);
      }
      // 侧栏展开时，延迟显示文字
      showTextTimerRef.current = setTimeout(() => setShowText(true), 200);
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
      toggleSidebarTimerRef.current = setTimeout(() => setShowText(true), 200); // 200ms 后显示文字，配合动效
    } else {
      // 折叠侧栏：先隐藏文字，再折叠
      setShowText(false);
      toggleSidebarTimerRef.current = setTimeout(() => setSidebarCollapsed(true), 150); // 150ms 后折叠，文字先消失
    }
  }, [isSidebarCollapsed, setSidebarCollapsed]);

  // 组件卸载时清理定时器
  useEffect(() => {
    return () => {
      if (toggleSidebarTimerRef.current) {
        clearTimeout(toggleSidebarTimerRef.current);
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
    const categories = getAllCategories(customCategories, language, hiddenDefaultCategoryIds);
    return sortCategoriesByOrder(categories, categoryOrder);
  }, [customCategories, language, hiddenDefaultCategoryIds, categoryOrder]);

  const repositoryMap = useMemo(() => new Map(repositories.map(repo => [String(repo.id), repo])), [repositories]);

  const getCategoryCount = (category: Category) => {
    if (category.id === 'all') return repositories.length;

    return repositories.filter(repo => {
      if (repo.custom_category === category.name) {
        return true;
      }

      if (repo.ai_tags && repo.ai_tags.length > 0) {
        return repo.ai_tags.some(tag =>
          category.keywords.some(keyword =>
            tag.toLowerCase().includes(keyword.toLowerCase()) ||
            keyword.toLowerCase().includes(tag.toLowerCase())
          )
        );
      }

      const repoText = [
        repo.name,
        repo.description || '',
        repo.language || '',
        ...(repo.topics || []),
        repo.ai_summary || ''
      ].join(' ').toLowerCase();

      return category.keywords.some(keyword =>
        repoText.includes(keyword.toLowerCase())
      );
    }).length;
  };

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
    const confirmed = confirm(
      t(
        `确定删除自定义分类"${category.name}"吗？\n\n仓库会保留，Star 不会取消，只会清空它们的手动分类归属。`,
        `Delete custom category "${category.name}"?\n\nRepositories will stay starred. Only their manual category assignment will be cleared.`
      )
    );

    if (!confirmed) return;

    deleteCustomCategory(category.id);
    try {
      await forceSyncToBackend();
    } catch (error) {
      // Revert local change on failure
      alert(t('删除分类失败，请检查后端连接。', 'Failed to delete category. Please check backend connection.'));
    }
  };

  const handleHideDefaultCategory = async (category: Category) => {
    const confirmed = confirm(
      t(
        `隐藏默认分类"${category.name}"？\n\n这不会删除任何仓库，只是在左侧隐藏这个预设分类。`,
        `Hide default category "${category.name}"?\n\nThis will not delete any repositories. It only hides this built-in category from the sidebar.`
      )
    );

    if (!confirmed) return;

    hideDefaultCategory(category.id);
    try {
      await forceSyncToBackend();
    } catch (error) {
      // Revert local change on failure
      showDefaultCategory(category.id);
      alert(t('隐藏分类失败，请检查后端连接。', 'Failed to hide category. Please check backend connection.'));
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
    alert(
      language === 'zh'
        ? `同步到后端失败，已恢复分类更改。`
        : `Failed to sync to backend. Category change has been reverted.`
    );
  };

  const handleDropOnCategory = async (event: React.DragEvent<HTMLDivElement>, category: Category) => {
    event.preventDefault();
    setDragOverCategoryId(null);

    if (category.id === 'all') return;

    const repoId = event.dataTransfer.getData('application/x-gsm-repository-id');
    const repository = repositoryMap.get(repoId);
    if (!repository) return;

    const originalRepo = { ...repository };

    const nextRepo = {
      ...repository,
      custom_category: category.name,
      category_locked: true,
      last_edited: new Date().toISOString(),
    };

    updateRepository(nextRepo);

    try {
      await forceSyncToBackend();
    } catch (error) {
      handleSyncError(originalRepo);
    }
  };

  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

  return (
    <>
      {/* 移动端：始终显示完整侧栏 */}
      {isMobile ? (
        <div className="w-full bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3 sm:p-4 overflow-hidden">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              {t('应用分类', 'Categories')}
            </h3>
            <button
              onClick={handleAddCategory}
              className="p-1.5 rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors"
              title={t('添加分类', 'Add Category')}
              aria-label={t('添加分类', 'Add Category')}
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1">
            {allCategories.map(category => {
              const count = getCategoryCount(category);
              const isSelected = selectedCategory === category.id;
              const isDragTarget = dragOverCategoryId === category.id;

              return (
                <div
                  key={category.id}
                  className="group shrink-0"
                  onDragOver={(event) => {
                    if (category.id === 'all') return;
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
                  <button
                    onClick={() => onCategorySelect(category.id)}
                    className={`relative flex min-w-[140px] items-center justify-between px-3 py-2.5 rounded-lg text-left transition-colors ${
                      isSelected
                        ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                        : isDragTarget
                          ? 'bg-green-100 text-green-700 ring-2 ring-green-400 dark:bg-green-900 dark:text-green-300'
                          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                    title={category.id !== 'all' ? category.name + " — " + t('可将仓库卡片拖到这里快速改分类', 'Drag repository cards here to quickly change category') : undefined}
                    aria-pressed={isSelected}
                    aria-current={isSelected ? 'page' : undefined}
                  >
                    <div className="flex items-center space-x-3 min-w-0 flex-1">
                      <span className="text-base flex-shrink-0">{category.icon}</span>
                      <span className="text-sm font-medium truncate">{category.name}</span>
                    </div>
                    <span
                      className={`text-xs px-2 py-1 rounded-full shrink-0 ${
                        isSelected
                          ? 'bg-blue-200 text-blue-800 dark:bg-blue-800 dark:text-blue-200'
                          : isDragTarget
                            ? 'bg-green-200 text-green-800 dark:bg-green-800 dark:text-green-200'
                            : 'bg-gray-200 text-gray-600 dark:bg-gray-600 dark:text-gray-400'
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* 桌面端：可折叠侧栏 - sticky定位，滚动时保持可见 */
        <div className="relative flex shrink-0 lg:sticky lg:top-24 lg:self-start">
          {/* 侧栏容器 */}
          <div
            className={`relative bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden transition-all duration-300 ease-in-out ${
              isSidebarCollapsed
                ? 'w-14 p-2'
                : 'w-64 p-4'
            }`}
            style={{
              maxHeight: isSidebarCollapsed ? 'auto' : 'calc(100vh - 8rem)',
            }}
          >
            {/* 折叠状态：简洁视图 */}
            {isSidebarCollapsed ? (
              <div className="flex flex-col items-center space-y-3">
                {/* 展开按钮 - 放在折叠状态的顶部 */}
                <button
                  onClick={toggleSidebar}
                  className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  title={t('展开侧栏 (Ctrl/Cmd+B)', 'Expand Sidebar (Ctrl/Cmd+B)')}
                  aria-label={t('展开侧栏', 'Expand Sidebar')}
                  aria-expanded="false"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>

                <div className="w-full h-px bg-gray-200 dark:bg-gray-700" />

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
                      return (
                        <div
                          key={category.id}
                          className="group relative"
                          onDragOver={(event) => {
                            if (category.id === 'all') return;
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
                          <button
                            onClick={() => onCategorySelect(category.id)}
                            className={`w-8 h-8 flex items-center justify-center rounded-lg text-lg transition-all duration-200 ${
                              isSelected
                                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 ring-2 ring-blue-400'
                                : isDragTarget
                                  ? 'bg-green-100 text-green-700 ring-2 ring-green-400 dark:bg-green-900 dark:text-green-300'
                                  : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                            }`}
                            title={category.id !== 'all' ? category.name + " — " + t('可将仓库卡片拖到这里快速改分类', 'Drag repository cards here to quickly change category') : category.name}
                            aria-label={category.name}
                          >
                            {category.icon}
                          </button>
                        </div>
                      );
                    });
                  })()}
                </div>

                {/* 添加分类按钮 */}
                <button
                  onClick={handleAddCategory}
                  className="w-8 h-8 flex items-center justify-center rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors"
                  title={t('添加分类', 'Add Category')}
                  aria-label={t('添加分类', 'Add Category')}
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            ) : (
              /* 展开状态：完整视图 */
              <div>
                {/* 头部 - 包含折叠按钮 */}
                <div className="flex items-center justify-between mb-4">
                  <h3
                    className={`text-lg font-semibold text-gray-900 dark:text-white transition-opacity duration-200 ${
                      showText ? 'opacity-100' : 'opacity-0'
                    }`}
                  >
                    {t('应用分类', 'Categories')}
                  </h3>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={handleAddCategory}
                      className="p-1.5 rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors"
                      title={t('添加分类', 'Add Category')}
                      aria-label={t('添加分类', 'Add Category')}
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                    {/* 折叠按钮 - 放在标题栏右侧 */}
                    <button
                      onClick={toggleSidebar}
                      className="p-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      title={t('折叠侧栏 (Ctrl/Cmd+B)', 'Collapse Sidebar (Ctrl/Cmd+B)')}
                      aria-label={t('折叠侧栏', 'Collapse Sidebar')}
                      aria-expanded="true"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* 分类列表 */}
                <div className="space-y-1 lg:overflow-y-auto lg:max-h-[calc(100vh-12rem)]">
                  {allCategories.map(category => {
                    const count = getCategoryCount(category);
                    const isSelected = selectedCategory === category.id;
                    const isDragTarget = dragOverCategoryId === category.id;

                    return (
                      <div
                        key={category.id}
                        className="group relative"
                        onDragOver={(event) => {
                          if (category.id === 'all') return;
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
                        <button
                          onClick={() => onCategorySelect(category.id)}
                          className={`flex w-full items-center justify-between px-3 py-2.5 rounded-lg text-left transition-colors ${
                            isSelected
                              ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                              : isDragTarget
                                ? 'bg-green-100 text-green-700 ring-2 ring-green-400 dark:bg-green-900 dark:text-green-300'
                                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                          }`}
                          title={category.id !== 'all' ? category.name + " — " + t('可将仓库卡片拖到这里快速改分类', 'Drag repository cards here to quickly change category') : undefined}
                        >
                          <div className="flex items-center space-x-3 min-w-0 flex-1">
                            <span className="text-base flex-shrink-0">{category.icon}</span>
                            <span
                              className={`text-sm font-medium truncate transition-opacity duration-200 ${
                                showText ? 'opacity-100' : 'opacity-0'
                              }`}
                            >
                              {category.name}
                            </span>
                          </div>

                          {/* 数字 badge - 正常状态显示，hover/focus-within 时隐藏 */}
                          <span
                            className={`text-xs px-2 py-1 rounded-full shrink-0 transition-opacity duration-200 ${
                              isSelected
                                ? 'bg-blue-200 text-blue-800 dark:bg-blue-800 dark:text-blue-200'
                                : isDragTarget
                                  ? 'bg-green-200 text-green-800 dark:bg-green-800 dark:text-green-200'
                                  : 'bg-gray-200 text-gray-600 dark:bg-gray-600 dark:text-gray-400'
                            } ${showText ? 'opacity-100' : 'opacity-0'} group-hover:opacity-0 group-focus-within:opacity-0`}
                          >
                            {count}
                          </span>
                        </button>

                        {/* 操作按钮 - 绝对定位，hover/focus-within 时显示，不占位 */}
                        {category.id !== 'all' && (
                          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity pointer-events-none group-hover:pointer-events-auto group-focus-within:pointer-events-auto">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEditCategory(category);
                              }}
                              className="p-1 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600"
                              title={t('编辑分类', 'Edit category')}
                              aria-label={t('编辑分类', 'Edit category')}
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            {category.isCustom ? (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleDeleteCategory(category);
                                }}
                                className="p-1 rounded-md text-red-500 hover:bg-red-100 dark:hover:bg-red-900/40"
                                title={t('删除分类', 'Delete category')}
                                aria-label={t('删除分类', 'Delete category')}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            ) : (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleHideDefaultCategory(category);
                                }}
                                className="p-1 rounded-md text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-600"
                                title={t('隐藏默认分类', 'Hide default category')}
                                aria-label={t('隐藏默认分类', 'Hide default category')}
                              >
                                <EyeOff className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
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
