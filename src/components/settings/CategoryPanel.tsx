import React, { useState, useMemo, useRef, useCallback } from 'react';
import { Package, Plus, Trash2, Edit3, Save, X, Eye, EyeOff, GripVertical, ArrowUp, ArrowDown, ArrowUpToLine, ArrowDownToLine, LayoutGrid } from 'lucide-react';
import { useAppStore, getAllCategories, sortCategoriesByOrder } from '../../store/useAppStore';

interface CategoryPanelProps {
  t: (zh: string, en: string) => string;
}

export const CategoryPanel: React.FC<CategoryPanelProps> = ({ t }) => {
  const {
    customCategories,
    hiddenDefaultCategoryIds,
    categoryOrder,
    collapsedSidebarCategoryCount,
    language,
    addCustomCategory,
    deleteCustomCategory,
    updateCustomCategory,
    hideDefaultCategory,
    showDefaultCategory,
    setCategoryOrder,
    setCollapsedSidebarCategoryCount,
  } = useAppStore();

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryIcon, setNewCategoryIcon] = useState('📁');
  const [editName, setEditName] = useState('');
  const [editIcon, setEditIcon] = useState('');
  const [isReordering, setIsReordering] = useState(false);

  // 拖拽排序状态
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const dragItemIndex = useRef<number | null>(null);

  const allDefaultCategories = getAllCategories([], language, []);
  const hiddenDefaultCategories = allDefaultCategories.filter(category =>
    hiddenDefaultCategoryIds.includes(category.id)
  );

  // 获取所有可见分类（用于排序）
  const allVisibleCategories = useMemo(() => {
    const categories = getAllCategories(customCategories, language, hiddenDefaultCategoryIds);
    return sortCategoriesByOrder(categories, categoryOrder);
  }, [customCategories, language, hiddenDefaultCategoryIds, categoryOrder]);

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
      keywords: [],
    };

    addCustomCategory(newCategory);
    setNewCategoryName('');
    setNewCategoryIcon('📁');
    setShowAddForm(false);
  };

  const handleStartEdit = (category: { id: string; name: string; icon: string }) => {
    setEditingId(category.id);
    setEditName(category.name);
    setEditIcon(category.icon);
  };

  const handleSaveEdit = () => {
    if (!editName.trim()) {
      alert(t('分类名称不能为空', 'Category name cannot be empty'));
      return;
    }

    if (editingId) {
      updateCustomCategory(editingId, {
        name: editName.trim(),
        icon: editIcon,
      });
      setEditingId(null);
      setEditName('');
      setEditIcon('');
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditIcon('');
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
          <Package className="w-6 h-6 text-amber-600 dark:text-amber-400" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {t('分类管理', 'Category Management')}
          </h3>
        </div>
        <button
          onClick={() => setShowAddForm(true)}
          className="flex items-center space-x-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>{t('添加分类', 'Add Category')}</span>
        </button>
      </div>

      {/* 折叠侧边栏显示设置 */}
      <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <LayoutGrid className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <div>
              <h4 className="font-medium text-gray-900 dark:text-white">
                {t('折叠侧边栏显示设置', 'Collapsed Sidebar Display')}
              </h4>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t('设置折叠状态下显示的分类个数', 'Set the number of categories to display when collapsed')}
              </p>
              <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                {t(
                  '提示：折叠侧边栏仅影响显示，所有分类仍可在展开状态下查看。只显示分类顺序前N个分类。',
                  'Tip: The collapsed sidebar only affects display; all categories remain accessible when expanded. Only the first N categories in the order are displayed.'
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <input
              type="number"
              min="1"
              value={collapsedSidebarCategoryCount}
              onChange={(e) => {
                const inputValue = e.target.value;
                if (inputValue === '') return;
                const value = parseInt(inputValue);
                if (!isNaN(value) && value >= 1) {
                  setCollapsedSidebarCategoryCount(value);
                }
              }}
              onBlur={(e) => {
                const value = parseInt(e.target.value);
                if (isNaN(value) || value < 1) {
                  setCollapsedSidebarCategoryCount(1);
                }
              }}
              className="w-20 px-3 py-1.5 text-center border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="≥1"
            />
            <span className="text-sm text-gray-500 dark:text-gray-400">
            </span>
          </div>
        </div>
      </div>

      {showAddForm && (
        <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600">
          <h4 className="font-medium text-gray-900 dark:text-white mb-4">
            {t('添加自定义分类', 'Add Custom Category')}
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('分类名称', 'Category Name')} *
              </label>
              <input
                type="text"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                placeholder={t('例如: 我的项目', 'e.g., My Projects')}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('图标', 'Icon')}
              </label>
              <input
                type="text"
                value={newCategoryIcon}
                onChange={(e) => setNewCategoryIcon(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                placeholder="📁"
                maxLength={2}
              />
            </div>
          </div>
          <div className="flex space-x-3">
            <button
              onClick={handleAddCategory}
              className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              <Save className="w-4 h-4" />
              <span>{t('保存', 'Save')}</span>
            </button>
            <button
              onClick={() => {
                setShowAddForm(false);
                setNewCategoryName('');
                setNewCategoryIcon('📁');
              }}
              className="flex items-center space-x-2 px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors"
            >
              <X className="w-4 h-4" />
              <span>{t('取消', 'Cancel')}</span>
            </button>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {/* 分类排序区域 */}
        <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-medium text-gray-900 dark:text-white flex items-center">
              <GripVertical className="w-4 h-4 mr-2" />
              {t('分类排序', 'Category Order')}
              <span className="ml-2 text-sm text-gray-500 dark:text-gray-400">
                ({allVisibleCategories.length})
              </span>
            </h4>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setIsReordering(!isReordering)}
                className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  isReordering
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                    : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                {isReordering ? t('完成', 'Done') : t('调整顺序', 'Reorder')}
              </button>
              {categoryOrder.length > 0 && (
                <button
                  onClick={handleResetOrder}
                  className="px-3 py-1.5 rounded-lg text-sm bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                >
                  {t('重置', 'Reset')}
                </button>
              )}
            </div>
          </div>

          {isReordering && (
            <div className="mb-3 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
              <p className="text-sm text-yellow-800 dark:text-yellow-300">
                {t('提示：拖拽分类可快速调整顺序，或使用按钮进行置顶/置底操作', 'Tip: Drag categories to quickly reorder, or use buttons to move to top/bottom')}
              </p>
            </div>
          )}

          {allVisibleCategories.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 py-4">
              {t('暂无可见分类', 'No visible categories')}
            </p>
          ) : (
            <div className="space-y-1">
              {allVisibleCategories.map((category, index) => (
                <div
                  key={category.id}
                  draggable={isReordering}
                  onDragStart={(e) => handleDragStart(e, index, category.id)}
                  onDragEnd={handleDragEnd}
                  onDragOver={(e) => handleDragOver(e, category.id)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, index)}
                  className={`flex items-center justify-between p-3 rounded-lg border transition-all ${
                    category.isCustom
                      ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
                      : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600'
                  } ${draggingId === category.id ? 'opacity-50' : ''} ${
                    dragOverId === category.id && draggingId !== category.id
                      ? 'border-blue-400 dark:border-blue-500 ring-2 ring-blue-200 dark:ring-blue-800 transform scale-[1.02]'
                      : ''
                  } ${isReordering ? 'cursor-move' : ''}`}
                >
                  <div className="flex items-center space-x-3">
                    {isReordering && (
                      <GripVertical className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                    )}
                    <span className="text-xl">{category.icon}</span>
                    <span className="font-medium text-gray-900 dark:text-white">
                      {category.name}
                    </span>
                    {category.isCustom && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300">
                        {t('自定义', 'Custom')}
                      </span>
                    )}
                  </div>

                  {isReordering ? (
                    <div className="flex items-center space-x-1">
                      <button
                        onClick={() => handleMoveToTop(index)}
                        disabled={index === 0}
                        className="p-1.5 rounded bg-purple-100 text-purple-600 dark:bg-purple-900 dark:text-purple-400 hover:bg-purple-200 dark:hover:bg-purple-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        title={t('置顶', 'Move to top')}
                      >
                        <ArrowUpToLine className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleMoveCategory(index, 'up')}
                        disabled={index === 0}
                        className="p-1.5 rounded bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        title={t('上移', 'Move up')}
                      >
                        <ArrowUp className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleMoveCategory(index, 'down')}
                        disabled={index === allVisibleCategories.length - 1}
                        className="p-1.5 rounded bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        title={t('下移', 'Move down')}
                      >
                        <ArrowDown className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleMoveToBottom(index)}
                        disabled={index === allVisibleCategories.length - 1}
                        className="p-1.5 rounded bg-purple-100 text-purple-600 dark:bg-purple-900 dark:text-purple-400 hover:bg-purple-200 dark:hover:bg-purple-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
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
                            className="p-1.5 rounded bg-orange-100 text-orange-600 dark:bg-orange-900 dark:text-orange-400 hover:bg-orange-200 dark:hover:bg-orange-800"
                            title={t('编辑', 'Edit')}
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteCategory(category.id)}
                            className="p-1.5 rounded bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-800"
                            title={t('删除', 'Delete')}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => hideDefaultCategory(category.id)}
                          className="p-1.5 rounded bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600"
                          title={t('隐藏', 'Hide')}
                        >
                          <EyeOff className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 编辑模态框 */}
        {editingId && (
          <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
            <h4 className="font-medium text-gray-900 dark:text-white mb-3">
              {t('编辑分类', 'Edit Category')}
            </h4>
            <div className="flex items-center space-x-3">
              <input
                type="text"
                value={editIcon}
                onChange={(e) => setEditIcon(e.target.value)}
                className="w-16 px-2 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-center text-lg"
                maxLength={2}
                placeholder="📁"
              />
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800"
                placeholder={t('分类名称', 'Category name')}
              />
              <button
                onClick={handleSaveEdit}
                className="p-2 rounded-lg bg-green-100 text-green-600 dark:bg-green-900 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-800"
                title={t('保存', 'Save')}
              >
                <Save className="w-5 h-5" />
              </button>
              <button
                onClick={handleCancelEdit}
                className="p-2 rounded-lg bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600"
                title={t('取消', 'Cancel')}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}

        {/* 隐藏的默认分类 */}
        {hiddenDefaultCategories.length > 0 && (
          <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
            <h4 className="font-medium text-gray-900 dark:text-white mb-3 flex items-center">
              <EyeOff className="w-4 h-4 mr-2" />
              {t('隐藏的默认分类', 'Hidden Default Categories')}
              <span className="ml-2 text-sm text-gray-500 dark:text-gray-400">
                ({hiddenDefaultCategories.length})
              </span>
            </h4>
            <div className="flex flex-wrap gap-2">
              {hiddenDefaultCategories.map((category) => (
                <button
                  key={category.id}
                  onClick={() => showDefaultCategory(category.id)}
                  className="inline-flex items-center space-x-2 px-3 py-2 rounded-lg bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                >
                  <Eye className="w-4 h-4" />
                  <span>{category.icon}</span>
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
