import React, { useState, useMemo, useRef, useCallback } from 'react';
import { Package, Plus, Trash2, Edit3, Save, X, Eye, EyeOff, GripVertical, ArrowUp, ArrowDown, ArrowUpToLine, ArrowDownToLine, LayoutGrid } from 'lucide-react';
import { useAppStore, getAllCategories, sortCategoriesByOrder } from '../../store/useAppStore';
import { StepperInput } from '../ui/StepperInput';

interface CategoryPanelProps {
  t: (zh: string, en: string) => string;
}

export const CategoryPanel: React.FC<CategoryPanelProps> = ({ t }) => {
  const customCategories = useAppStore(state => state.customCategories);
  const hiddenDefaultCategoryIds = useAppStore(state => state.hiddenDefaultCategoryIds);
  const defaultCategoryOverrides = useAppStore(state => state.defaultCategoryOverrides);
  const categoryOrder = useAppStore(state => state.categoryOrder);
  const collapsedSidebarCategoryCount = useAppStore(state => state.collapsedSidebarCategoryCount);
  const language = useAppStore(state => state.language);
  const addCustomCategory = useAppStore(state => state.addCustomCategory);
  const deleteCustomCategory = useAppStore(state => state.deleteCustomCategory);
  const updateCustomCategory = useAppStore(state => state.updateCustomCategory);
  const updateDefaultCategory = useAppStore(state => state.updateDefaultCategory);
  const resetDefaultCategory = useAppStore(state => state.resetDefaultCategory);
  const resetDefaultCategoryNameIcon = useAppStore(state => state.resetDefaultCategoryNameIcon);
  const resetDefaultCategoryKeywords = useAppStore(state => state.resetDefaultCategoryKeywords);
  const hideDefaultCategory = useAppStore(state => state.hideDefaultCategory);
  const showDefaultCategory = useAppStore(state => state.showDefaultCategory);
  const setCategoryOrder = useAppStore(state => state.setCategoryOrder);
  const setCollapsedSidebarCategoryCount = useAppStore(state => state.setCollapsedSidebarCategoryCount);

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryIcon, setNewCategoryIcon] = useState('📁');
  const [newCategoryKeywords, setNewCategoryKeywords] = useState('');
  const [editName, setEditName] = useState('');
  const [editIcon, setEditIcon] = useState('');
  const [editKeywords, setEditKeywords] = useState('');
  const [isReordering, setIsReordering] = useState(false);

  // 拖拽排序状态
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const dragItemIndex = useRef<number | null>(null);

  const allDefaultCategories = getAllCategories([], language, [], defaultCategoryOverrides);
  const originalDefaultCategories = getAllCategories([], language, [], {});
  const hiddenDefaultCategories = allDefaultCategories.filter(category =>
    hiddenDefaultCategoryIds.includes(category.id)
  );

  const isDefaultCategoryModified = (categoryId: string): boolean => {
    return categoryId in defaultCategoryOverrides;
  };

  const hasNameIconModified = (categoryId: string): boolean => {
    const override = defaultCategoryOverrides[categoryId];
    return !!(override && (override.name !== undefined || override.icon !== undefined));
  };

  const hasKeywordsModified = (categoryId: string): boolean => {
    const override = defaultCategoryOverrides[categoryId];
    return !!(override && override.keywords !== undefined);
  };

  const allVisibleCategories = useMemo(() => {
    const categories = getAllCategories(customCategories, language, hiddenDefaultCategoryIds, defaultCategoryOverrides);
    return sortCategoriesByOrder(categories, categoryOrder);
  }, [customCategories, language, hiddenDefaultCategoryIds, defaultCategoryOverrides, categoryOrder]);

  const handleAddCategory = () => {
    if (!newCategoryName.trim()) {
      alert(t('请输入分类名称', 'Please enter category name'));
      return;
    }

    const newCategory = {
      id: `custom-${Date.now()}`,
      name: newCategoryName.trim(),
      icon: newCategoryIcon,
      isCustom: true,
      keywords: newCategoryKeywords.split(',').map(k => k.trim()).filter(k => k),
    };

    addCustomCategory(newCategory);
    setNewCategoryName('');
    setNewCategoryIcon('📁');
    setNewCategoryKeywords('');
    setShowAddForm(false);
  };

  const handleStartEdit = (category: { id: string; name: string; icon: string; keywords?: string[] }) => {
    setEditingId(category.id);
    setEditName(category.name);
    setEditIcon(category.icon);
    setEditKeywords(category.keywords?.join(', ') || '');
  };

  const handleSaveEdit = () => {
    if (!editName.trim()) {
      alert(t('分类名称不能为空', 'Category name cannot be empty'));
      return;
    }

    if (editingId) {
      const isDefault = allDefaultCategories.some(c => c.id === editingId);
      if (isDefault) {
        updateDefaultCategory(editingId, {
          name: editName.trim(),
          icon: editIcon,
          keywords: editKeywords.split(',').map(k => k.trim()).filter(k => k),
        });
      } else {
        updateCustomCategory(editingId, {
          name: editName.trim(),
          icon: editIcon,
          keywords: editKeywords.split(',').map(k => k.trim()).filter(k => k),
        });
      }
      setEditingId(null);
      setEditName('');
      setEditIcon('');
      setEditKeywords('');
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditIcon('');
    setEditKeywords('');
  };

  const handleResetDefault = (categoryId: string, originalCategory: { name: string; icon: string; keywords?: string[] } | undefined) => {
    resetDefaultCategory(categoryId);
      if (originalCategory) {
      setEditName(originalCategory.name);
      setEditIcon(originalCategory.icon);
      setEditKeywords(originalCategory.keywords?.join(', ') || '');
    }
    setEditingId(null);
    setEditName('');
    setEditIcon('');
    setEditKeywords('');
  };

  const handleDeleteCategory = (categoryId: string) => {
    if (confirm(t('确定要删除这个自定义分类吗？', 'Are you sure you want to delete this custom category?'))) {
      deleteCustomCategory(categoryId);
    }
  };

  // 处理分类排序 - 上下移动
  const handleMoveCategory = (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= allVisibleCategories.length) return;

    // Compute new visible sequence and merge into existing categoryOrder preserving hidden IDs
    const visibleIds = allVisibleCategories.map(c => c.id);
    const [movedId] = visibleIds.splice(index, 1);
    visibleIds.splice(newIndex, 0, movedId);
    const hiddenIds = categoryOrder.filter(id => !visibleIds.includes(id));
    setCategoryOrder([...visibleIds, ...hiddenIds]);
  };

  // 快速置顶
  const handleMoveToTop = (index: number) => {
    if (index === 0) return;
    const visibleIds = allVisibleCategories.map(c => c.id);
    const [movedId] = visibleIds.splice(index, 1);
    visibleIds.unshift(movedId);
    const hiddenIds = categoryOrder.filter(id => !visibleIds.includes(id));
    setCategoryOrder([...visibleIds, ...hiddenIds]);
  };

  // 快速置底
  const handleMoveToBottom = (index: number) => {
    if (index === allVisibleCategories.length - 1) return;
    const visibleIds = allVisibleCategories.map(c => c.id);
    const [movedId] = visibleIds.splice(index, 1);
    visibleIds.push(movedId);
    const hiddenIds = categoryOrder.filter(id => !visibleIds.includes(id));
    setCategoryOrder([...visibleIds, ...hiddenIds]);
  };

  // 重置分类排序
  const handleResetOrder = () => {
    if (confirm(t('确定要重置分类排序吗？这将恢复默认顺序。', 'Are you sure you want to reset category order? This will restore the default order.'))) {
      setCategoryOrder([]);
    }
  };

  // 拖拽开始
  const handleDragStart = useCallback((e: React.DragEvent, index: number, categoryId: string) => {
    dragItemIndex.current = index;
    setDraggingId(categoryId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', categoryId);
    // 设置拖拽时的透明度
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '0.5';
    }
  }, []);

  // 拖拽结束
  const handleDragEnd = useCallback((e: React.DragEvent) => {
    setDraggingId(null);
    setDragOverId(null);
    dragItemIndex.current = null;
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '1';
    }
  }, []);

  // 拖拽经过
  const handleDragOver = useCallback((e: React.DragEvent, categoryId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverId(categoryId);
  }, []);

  // 拖拽离开
  const handleDragLeave = useCallback(() => {
    setDragOverId(null);
  }, []);

  // 放置
  const handleDrop = useCallback((e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    setDragOverId(null);

    if (dragItemIndex.current === null || dragItemIndex.current === dropIndex) return;

    const state = useAppStore.getState();
    const currentCategories = getAllCategories(state.customCategories, state.language, state.hiddenDefaultCategoryIds);
    const currentVisible = sortCategoriesByOrder(currentCategories, state.categoryOrder);
    const visibleIds = currentVisible.map(c => c.id);
    const [movedId] = visibleIds.splice(dragItemIndex.current, 1);
    visibleIds.splice(dropIndex, 0, movedId);
    const hiddenIds = state.categoryOrder.filter(id => !visibleIds.includes(id));
    setCategoryOrder([...visibleIds, ...hiddenIds]);
    dragItemIndex.current = null;
    setDraggingId(null);
  }, [setCategoryOrder]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Package className="w-6 h-6 text-gray-700 dark:text-text-secondary " />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-text-primary">
            {t('分类管理', 'Category Management')}
          </h3>
        </div>
        <button
          onClick={() => setShowAddForm(true)}
          className="flex items-center space-x-2 px-4 py-2 bg-brand-indigo text-white rounded-lg hover:bg-brand-hover transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>{t('添加分类', 'Add Category')}</span>
        </button>
      </div>

      {/* 折叠侧边栏显示设置 */}
      <div className="p-4 bg-light-surface dark:bg-white/[0.04] rounded-lg border border-black/[0.06] dark:border-white/[0.04] dark:border-black/[0.06] dark:border-white/[0.04]">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <LayoutGrid className="w-5 h-5 text-brand-violet dark:text-brand-violet" />
            <div>
              <h4 className="font-medium text-gray-900 dark:text-text-primary">
                {t('折叠侧边栏显示设置', 'Collapsed Sidebar Display')}
              </h4>
              <p className="text-sm text-gray-500 dark:text-text-tertiary">
                {t('设置折叠状态下显示的分类个数', 'Set the number of categories to display when collapsed')}
              </p>
              <p className="text-xs text-brand-violet dark:text-brand-violet mt-1">
                {t(
                  '提示：折叠侧边栏仅影响显示，所有分类仍可在展开状态下查看。只显示分类顺序前N个分类。',
                  'Tip: The collapsed sidebar only affects display; all categories remain accessible when expanded. Only the first N categories in the order are displayed.'
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <StepperInput
              value={collapsedSidebarCategoryCount}
              onChange={setCollapsedSidebarCategoryCount}
              min={1}
              step={1}
            />
          </div>
        </div>
      </div>

      {showAddForm && (
        <div className="p-4 bg-light-bg dark:bg-white/[0.04] rounded-lg border border-black/[0.06] dark:border-white/[0.04]">
          <h4 className="font-medium text-gray-900 dark:text-text-primary mb-4">
            {t('添加自定义分类', 'Add Custom Category')}
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-900 dark:text-text-secondary mb-1">
                {t('分类名称', 'Category Name')} *
              </label>
              <input
                type="text"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                className="w-full px-3 py-2 border border-black/[0.06] dark:border-white/[0.04] rounded-lg bg-white dark:bg-panel-dark text-gray-900 dark:text-text-primary"
                placeholder={t('例如: 我的项目', 'e.g., My Projects')}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-900 dark:text-text-secondary mb-1">
                {t('图标', 'Icon')}
              </label>
              <input
                type="text"
                value={newCategoryIcon}
                onChange={(e) => {
                  const value = e.target.value;
                  const graphemeCount = Array.from(value).length;
                  if (graphemeCount <= 2) {
                    setNewCategoryIcon(value);
                  }
                }}
                className="w-full px-3 py-2 border border-black/[0.06] dark:border-white/[0.04] rounded-lg bg-white dark:bg-panel-dark text-gray-900 dark:text-text-primary"
                placeholder="📁"
              />
            </div>
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-900 dark:text-text-secondary mb-1">
              {t('关键词', 'Keywords')}
            </label>
            <input
              type="text"
              value={newCategoryKeywords}
              onChange={(e) => setNewCategoryKeywords(e.target.value)}
              className="w-full px-3 py-2 border border-black/[0.06] dark:border-white/[0.04] rounded-lg bg-white dark:bg-panel-dark text-gray-900 dark:text-text-primary"
              placeholder={t('用逗号分隔关键词', 'Comma-separated keywords')}
            />
            <p className="text-xs text-gray-500 dark:text-text-tertiary mt-1">
              {t('用于自动匹配仓库到此分类', 'Used to automatically match repositories to this category')}
            </p>
          </div>
          <div className="flex space-x-3">
            <button
              onClick={handleAddCategory}
              disabled={!newCategoryName.trim()}
              className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-colors ${newCategoryName.trim() ? 'bg-brand-indigo text-white hover:bg-gray-100 dark:bg-white/[0.04]' : 'bg-gray-300 text-gray-500 dark:bg-gray-600 dark:text-text-tertiary cursor-not-allowed'}`}
            >
              <Save className="w-4 h-4" />
              <span>{t('保存', 'Save')}</span>
            </button>
            <button
              onClick={() => {
                setShowAddForm(false);
                setNewCategoryName('');
                setNewCategoryIcon('📁');
                setNewCategoryKeywords('');
              }}
              className="flex items-center space-x-2 px-4 py-2 bg-light-surface hover:bg-gray-200 dark:bg-white/[0.04] dark:hover:bg-white/[0.08] text-gray-900 dark:text-text-primary rounded-lg border border-black/[0.06] dark:border-white/[0.04] transition-colors"
            >
              <X className="w-4 h-4" />
              <span>{t('取消', 'Cancel')}</span>
            </button>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {/* 分类排序区域 */}
        <div className="border-t border-black/[0.06] dark:border-white/[0.04] pt-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-medium text-gray-900 dark:text-text-primary flex items-center">
              <GripVertical className="w-4 h-4 mr-2" />
              {t('分类排序', 'Category Order')}
              <span className="ml-2 text-sm text-gray-500 dark:text-text-tertiary">
                ({allVisibleCategories.length})
              </span>
            </h4>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setIsReordering(!isReordering)}
                className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  isReordering
                    ? 'bg-gray-100 text-gray-700 dark:bg-white/[0.04] dark:text-text-secondary'
                    : 'bg-light-surfacetext-gray-900 dark:bg-white/[0.04] dark:text-text-secondary hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                {isReordering ? t('完成', 'Done') : t('调整顺序', 'Reorder')}
              </button>
              {categoryOrder.length > 0 && (
                <button
                  onClick={handleResetOrder}
                  className="px-3 py-1.5 rounded-lg text-sm bg-light-surfacetext-gray-900 dark:bg-white/[0.04] dark:text-text-secondary hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                >
                  {t('重置', 'Reset')}
                </button>
              )}
            </div>
          </div>

          {isReordering && (
            <div className="mb-3 p-3 bg-light-surface dark:bg-white/[0.04] rounded-lg border border-black/[0.06] dark:border-white/[0.04] dark:border-black/[0.06] dark:border-white/[0.04]">
              <p className="text-sm text-gray-700 dark:text-text-secondary ">
                {t('提示：拖拽分类可快速调整顺序，或使用按钮进行置顶/置底操作', 'Tip: Drag categories to quickly reorder, or use buttons to move to top/bottom')}
              </p>
            </div>
          )}

          {allVisibleCategories.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-text-tertiary py-4">
              {t('暂无可见分类', 'No visible categories')}
            </p>
          ) : (
            <div className="space-y-2">
              {allVisibleCategories.map((category, index) => {
                const isEditing = editingId === category.id;
                const isDefault = !category.isCustom;
                const isModified = isDefaultCategoryModified(category.id);
                const originalCategory = originalDefaultCategories.find(c => c.id === category.id);
                
                const hasChanges = isEditing && (
                  editName !== category.name ||
                  editIcon !== category.icon ||
                  editKeywords !== (category.keywords?.join(', ') || '')
                );
                
                return (
                <div
                  key={category.id}
                  draggable={isReordering && !isEditing}
                  onDragStart={(e) => handleDragStart(e, index, category.id)}
                  onDragEnd={handleDragEnd}
                  onDragOver={(e) => handleDragOver(e, category.id)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, index)}
                  className={`flex flex-col p-3 rounded-lg border transition-all ${
                    category.isCustom
                      ? 'bg-light-surface dark:bg-white/[0.04] border-black/[0.06] dark:border-white/[0.04] dark:border-black/[0.06] dark:border-white/[0.04]'
                      : 'bg-white dark:bg-panel-dark border-black/[0.06] dark:border-white/[0.04]'
                  } ${isEditing ? 'ring-2 ring-blue-400 dark:ring-brand-violet' : ''} ${
                    draggingId === category.id ? 'opacity-50' : ''
                  } ${
                    dragOverId === category.id && draggingId !== category.id
                      ? 'border-black/[0.06] dark:border-white/[0.04] dark:border-brand-violet ring-2 ring-blue-200 dark:ring-blue-800 transform scale-[1.02]'
                      : ''
                  } ${isReordering && !isEditing ? 'cursor-move' : ''}`}
                >
                  {isEditing ? (
                    <>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-gray-900 dark:text-text-secondary">
                          {t('编辑分类', 'Edit Category')}
                        </span>
                        {isDefault && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-200 text-gray-700 dark:bg-white/[0.04] dark:text-text-tertiary">
                            {t('默认分类', 'Default Category')}
                          </span>
                        )}
                      </div>
                      
                      {isDefault && isModified && originalCategory && (
                        <div className="mb-2 p-2 bg-light-surface dark:bg-white/[0.04] rounded border border-black/[0.06] dark:border-white/[0.04] dark:border-black/[0.06] dark:border-white/[0.04]">
                          <p className="text-xs text-gray-700 dark:text-text-secondary ">
                            {t(
                              `已修改。原始值：${originalCategory.icon} ${originalCategory.name}`,
                              `Modified. Original: ${originalCategory.icon} ${originalCategory.name}`
                            )}
                          </p>
                        </div>
                      )}
                      
                      <div className="space-y-2">
                        <div className="flex items-center space-x-2">
                          <input
                            type="text"
                            value={editIcon}
                            onChange={(e) => {
                              const value = e.target.value;
                              const graphemeCount = Array.from(value).length;
                              if (graphemeCount <= 2) {
                                setEditIcon(value);
                              }
                            }}
                            className="w-14 px-2 py-1.5 border border-black/[0.06] dark:border-white/[0.04] rounded bg-white dark:bg-white/[0.04] text-center text-lg text-gray-900 dark:text-text-primary"
                            placeholder="📁"
                          />
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="flex-1 px-2 py-1.5 border border-black/[0.06] dark:border-white/[0.04] rounded bg-white dark:bg-white/[0.04] text-sm text-gray-900 dark:text-text-primary"
                            placeholder={t('分类名称', 'Category name')}
                          />
                        </div>
                        <div className="flex items-center space-x-2">
                          <input
                            type="text"
                            value={editKeywords}
                            onChange={(e) => setEditKeywords(e.target.value)}
                            className="flex-1 px-2 py-1.5 border border-black/[0.06] dark:border-white/[0.04] rounded bg-white dark:bg-white/[0.04] text-sm text-gray-900 dark:text-text-primary"
                            placeholder={t('关键词（逗号分隔）', 'Keywords (comma separated)')}
                          />
                          <button
                            onClick={handleSaveEdit}
                            disabled={!hasChanges}
                            className={`p-1.5 rounded ${hasChanges ? 'bg-status-emerald text-status-emerald hover:bg-gray-100 dark:bg-white/[0.04] dark:hover:bg-gray-100 dark:bg-white/[0.04]' : 'bg-light-surfacetext-gray-400 dark:bg-white/[0.04] dark:text-text-tertiarycursor-not-allowed'}`}
                            title={t('保存', 'Save')}
                          >
                            <Save className="w-4 h-4" />
                          </button>
                          <button
                            onClick={handleCancelEdit}
                            className="p-1.5 rounded bg-light-surfacetext-gray-700 dark:bg-white/[0.04] dark:text-text-tertiary hover:bg-gray-200 dark:hover:bg-gray-600"
                            title={t('取消', 'Cancel')}
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                        {isDefault && isModified && (
                          <div className="flex items-center space-x-2 pt-1">
                            <span className="text-xs text-gray-500 dark:text-text-tertiary">{t('还原:', 'Reset:')}</span>
                            {hasNameIconModified(category.id) && (
                              <button
                                onClick={() => {
                                  resetDefaultCategoryNameIcon(category.id);
                                  if (originalCategory) {
                                    setEditName(originalCategory.name);
                                    setEditIcon(originalCategory.icon);
                                  }
                                }}
                                className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-700 dark:bg-white/[0.04] dark:text-text-secondary hover:bg-gray-200 hover:text-gray-900 dark:hover:bg-white/[0.08] dark:hover:text-text-primary"
                              >
                                {t('名字/图标', 'Name/Icon')}
                              </button>
                            )}
                            {hasKeywordsModified(category.id) && (
                              <button
                                onClick={() => {
                                  resetDefaultCategoryKeywords(category.id);
                                  if (originalCategory) {
                                    setEditKeywords(originalCategory.keywords?.join(', ') || '');
                                  }
                                }}
                                className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-700 dark:bg-white/[0.04] dark:text-text-secondary hover:bg-gray-200 hover:text-gray-900 dark:hover:bg-white/[0.08] dark:hover:text-text-primary"
                              >
                                {t('关键词', 'Keywords')}
                              </button>
                            )}
                            <button
                              onClick={() => handleResetDefault(category.id, originalCategory)}
                              className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-700 dark:bg-white/[0.04] dark:text-text-secondary hover:bg-gray-200 hover:text-gray-900 dark:hover:bg-white/[0.08] dark:hover:text-text-primary"
                            >
                              {t('全部', 'All')}
                            </button>
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        {isReordering && (
                          <GripVertical className="w-4 h-4 text-gray-400 dark:text-text-tertiary" />
                        )}
                        <span className="text-base w-6 text-center inline-block">{category.icon}</span>
                        <span className="text-sm font-medium text-gray-900 dark:text-text-primary">
                          {category.name}
                        </span>
                        {category.isCustom && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 dark:bg-white/[0.04] dark:text-text-secondary">
                            {t('自定义', 'Custom')}
                          </span>
                        )}
                        {!category.isCustom && isModified && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 dark:bg-white/[0.04] dark:text-text-secondary">
                            {t('已修改', 'Modified')}
                          </span>
                        )}
                      </div>

                      {isReordering ? (
                        <div className="flex items-center space-x-1">
                          <button
                            onClick={() => handleMoveToTop(index)}
                            disabled={index === 0}
                            className="p-1.5 rounded bg-gray-100 text-gray-700 dark:bg-white/[0.04] dark:text-text-secondary hover:bg-gray-200 hover:text-gray-900 dark:hover:bg-white/[0.08] dark:hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            title={t('置顶', 'Move to top')}
                          >
                            <ArrowUpToLine className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleMoveCategory(index, 'up')}
                            disabled={index === 0}
                            className="p-1.5 rounded bg-light-surfacetext-gray-700 dark:bg-white/[0.04] dark:text-text-tertiary hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            title={t('上移', 'Move up')}
                          >
                            <ArrowUp className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleMoveCategory(index, 'down')}
                            disabled={index === allVisibleCategories.length - 1}
                            className="p-1.5 rounded bg-light-surfacetext-gray-700 dark:bg-white/[0.04] dark:text-text-tertiary hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            title={t('下移', 'Move down')}
                          >
                            <ArrowDown className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleMoveToBottom(index)}
                            disabled={index === allVisibleCategories.length - 1}
                            className="p-1.5 rounded bg-gray-100 text-gray-700 dark:bg-white/[0.04] dark:text-text-secondary hover:bg-gray-200 hover:text-gray-900 dark:hover:bg-white/[0.08] dark:hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            title={t('置底', 'Move to bottom')}
                          >
                            <ArrowDownToLine className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center space-x-1">
                          {category.isCustom ? (
                            <>
                              <button
                                onClick={() => handleStartEdit(category)}
                                className="p-1.5 rounded bg-gray-100 text-gray-700 dark:bg-white/[0.04] dark:text-text-secondary hover:bg-gray-200 hover:text-gray-900 dark:hover:bg-white/[0.08] dark:hover:text-text-primary"
                                title={t('编辑', 'Edit')}
                              >
                                <Edit3 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDeleteCategory(category.id)}
                                className="p-1.5 rounded bg-gray-100 text-gray-700 dark:bg-white/[0.04] dark:text-text-secondary hover:bg-gray-200 hover:text-gray-900 dark:hover:bg-white/[0.08] dark:hover:text-text-primary"
                                title={t('删除', 'Delete')}
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => handleStartEdit(category)}
                                className="p-1.5 rounded bg-gray-100 text-gray-700 dark:bg-white/[0.04] dark:text-text-secondary hover:bg-gray-200 hover:text-gray-900 dark:hover:bg-white/[0.08] dark:hover:text-text-primary"
                                title={t('编辑', 'Edit')}
                              >
                                <Edit3 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => hideDefaultCategory(category.id)}
                                className="p-1.5 rounded bg-light-surfacetext-gray-700 dark:bg-white/[0.04] dark:text-text-tertiary hover:bg-gray-200 dark:hover:bg-gray-600"
                                title={t('隐藏', 'Hide')}
                              >
                                <EyeOff className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );})}
            </div>
          )}
        </div>

        {/* 隐藏的默认分类 */}
        {hiddenDefaultCategories.length > 0 && (
          <div className="border-t border-black/[0.06] dark:border-white/[0.04] pt-4">
            <h4 className="font-medium text-gray-900 dark:text-text-primary mb-3 flex items-center">
              <EyeOff className="w-4 h-4 mr-2" />
              {t('隐藏的默认分类', 'Hidden Default Categories')}
              <span className="ml-2 text-sm text-gray-500 dark:text-text-tertiary">
                ({hiddenDefaultCategories.length})
              </span>
            </h4>
            <div className="flex flex-wrap gap-2">
              {hiddenDefaultCategories.map((category) => (
                <button
                  key={category.id}
                  onClick={() => showDefaultCategory(category.id)}
                  className="inline-flex items-center space-x-2 px-3 py-2 rounded-lg bg-light-surfacetext-gray-900 dark:bg-white/[0.04] dark:text-text-secondary hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                >
                  <Eye className="w-4 h-4" />
                  <span className="w-5 text-center inline-block">{category.icon}</span>
                  <span>{category.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
