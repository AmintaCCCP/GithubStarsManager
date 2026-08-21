import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import React, { useState, useMemo, useRef, useCallback } from 'react';
import { Package, Plus, Trash2, Edit3, Save, X, Eye, EyeOff, GripVertical, ArrowUp, ArrowDown, ArrowUpToLine, ArrowDownToLine, LayoutGrid } from 'lucide-react';
import { useAppStore, getAllCategories, sortCategoriesByOrder } from '../../store/useAppStore';
import { StepperInput } from '../ui/StepperInput';
import { useDialog } from '../../hooks/useDialog';

interface CategoryPanelProps {
  t: (zh: string, en: string) => string;
}

export const CategoryPanel: React.FC<CategoryPanelProps> = ({ t }) => {
  const customCategories = useAppStore(state => state.customCategories);
  const hiddenDefaultCategoryIds = useAppStore(state => state.hiddenDefaultCategoryIds);
  const defaultCategoryOverrides = useAppStore(state => state.defaultCategoryOverrides);
  const categoryOrder = useAppStore(state => state.categoryOrder);
  const collapsedSidebarCategoryCount = useAppStore(state => state.collapsedSidebarCategoryCount);
  const categoryMatchMode = useAppStore(state => state.categoryMatchMode);
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
  const setCategoryMatchMode = useAppStore(state => state.setCategoryMatchMode);

  const { toast, confirm } = useDialog();

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
      toast(t('请输入分类名称', 'Please enter category name'), 'error');
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
      toast(t('分类名称不能为空', 'Category name cannot be empty'), 'error');
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

  const handleDeleteCategory = async (categoryId: string) => {
    const confirmed = await confirm(
      t('确定要删除这个自定义分类吗？', 'Delete Custom Category?'),
      t('此操作无法撤销。', 'This action cannot be undone.'),
      { type: 'danger', confirmText: t('删除', 'Delete') }
    );
    if (confirmed) {
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
  const handleResetOrder = async () => {
    const confirmed = await confirm(
      t('确定要重置分类排序吗？', 'Reset Category Order?'),
      t('这将恢复默认顺序。', 'This will restore the default order.'),
      { type: 'warning' }
    );
    if (confirmed) {
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
          <Package className="w-6 h-6 text-muted-foreground dark:text-muted-foreground " />
          <h3 className="text-lg font-semibold text-foreground dark:text-foreground">
            {t('分类管理', 'Category Management')}
          </h3>
        </div>
        <Button
          onClick={() => setShowAddForm(true)}
          className="flex items-center space-x-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>{t('添加分类', 'Add Category')}</span>
        </Button>
      </div>

      {/* 折叠侧边栏显示设置 */}
      <div className="p-4 bg-muted dark:bg-muted/40 rounded-lg border border-border dark:border-border dark:border-border dark:border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <LayoutGrid className="w-5 h-5 text-muted-foreground dark:text-muted-foreground" />
            <div>
              <h4 className="font-medium text-foreground dark:text-foreground">
                {t('折叠侧边栏显示设置', 'Collapsed Sidebar Display')}
              </h4>
              <p className="text-sm text-muted-foreground dark:text-muted-foreground">
                {t('设置折叠状态下显示的分类个数', 'Set the number of categories to display when collapsed')}
              </p>
              <p className="text-xs text-muted-foreground dark:text-muted-foreground mt-1">
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

      {/* 分类匹配模式设置 */}
      <div className="p-4 bg-muted dark:bg-muted/40 rounded-lg border border-border dark:border-border">
        <div className="flex items-center space-x-3 mb-2">
          <LayoutGrid className="w-5 h-5 text-muted-foreground dark:text-muted-foreground" />
          <h4 className="font-medium text-foreground dark:text-foreground">
            {t('仓库归类方式', 'Repository Categorization')}
          </h4>
        </div>
        <p className="text-sm text-muted-foreground dark:text-muted-foreground mb-3">
          {t(
            '选择仓库如何被归入侧边栏的分类中。切换后侧边栏的仓库数量会相应变化。你手动设置的分类归属始终保留，不会被 AI 分析覆盖。',
            'Choose how repositories are assigned to categories in the sidebar. Switching will update the category counts. Categories you assign manually are always kept and will not be overridden by AI analysis.'
          )}
        </p>
        <RadioGroup value={categoryMatchMode} onValueChange={(value) => setCategoryMatchMode(value as 'effective' | 'legacy')} className="space-y-3">
          <label className="flex cursor-pointer items-start space-x-3">
            <RadioGroupItem value="effective" id="category-match-effective" className="mt-1" />
            <div>
              <span className="block text-sm font-medium text-foreground dark:text-foreground">
                {t('按卡片显示的分类标签归类（推荐）', 'Match by tags shown on cards (Recommended)')}
              </span>
              <span className="block text-xs text-muted-foreground dark:text-muted-foreground mt-0.5">
                {t(
                  '仓库会按卡片上实际看到的标签进入分类；你编辑的自定义标签优先。',
                  'Repositories are grouped by the tags actually shown on their cards; your custom tags take priority.'
                )}
              </span>
            </div>
          </label>
          <label className="flex cursor-pointer items-start space-x-3">
            <RadioGroupItem value="legacy" id="category-match-legacy" className="mt-1" />
            <div>
              <span className="block text-sm font-medium text-foreground dark:text-foreground">
                {t('仅按 AI 生成标签归类（旧版）', 'Match by AI-generated tags only (Legacy)')}
              </span>
              <span className="block text-xs text-muted-foreground dark:text-muted-foreground mt-0.5">
                {t(
                  '使用早期版本逻辑，仅根据 AI 生成的标签归类，适合习惯旧版分类方式的用户。',
                  'Uses the legacy logic that categorizes only by AI-generated tags, for users who prefer the old behavior.'
                )}
              </span>
            </div>
          </label>
        </RadioGroup>
      </div>

      {showAddForm && (
        <div className="p-4 bg-background dark:bg-muted/40 rounded-lg border border-border dark:border-border">
          <h4 className="font-medium text-foreground dark:text-foreground mb-4">
            {t('添加自定义分类', 'Add Custom Category')}
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-foreground dark:text-muted-foreground mb-1">
                {t('分类名称', 'Category Name')} *
              </label>
              <Input
                type="text"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                className="w-full px-3 py-2 border border-border dark:border-border rounded-lg bg-white dark:bg-card text-foreground dark:text-foreground focus:ring-2 focus:ring-ring focus:border-transparent focus:outline-none"
                placeholder={t('例如: 我的项目', 'e.g., My Projects')}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground dark:text-muted-foreground mb-1">
                {t('图标', 'Icon')}
              </label>
              <Input
                type="text"
                value={newCategoryIcon}
                onChange={(e) => {
                  const value = e.target.value;
                  const graphemeCount = Array.from(value).length;
                  if (graphemeCount <= 2) {
                    setNewCategoryIcon(value);
                  }
                }}
                className="w-full px-3 py-2 border border-border dark:border-border rounded-lg bg-white dark:bg-card text-foreground dark:text-foreground focus:ring-2 focus:ring-ring focus:border-transparent focus:outline-none"
                placeholder="📁"
              />
            </div>
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-foreground dark:text-muted-foreground mb-1">
              {t('关键词', 'Keywords')}
            </label>
            <Input
              type="text"
              value={newCategoryKeywords}
              onChange={(e) => setNewCategoryKeywords(e.target.value)}
              className="w-full px-3 py-2 border border-border dark:border-border rounded-lg bg-white dark:bg-card text-foreground dark:text-foreground focus:ring-2 focus:ring-ring focus:border-transparent focus:outline-none"
              placeholder={t('用逗号分隔关键词', 'Comma-separated keywords')}
            />
            <p className="text-xs text-muted-foreground dark:text-muted-foreground mt-1">
              {t('用于自动匹配仓库到此分类', 'Used to automatically match repositories to this category')}
            </p>
          </div>
          <div className="flex space-x-3">
            <Button
              onClick={handleAddCategory}
              disabled={!newCategoryName.trim()}
              className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-colors ${newCategoryName.trim() ? 'bg-primary text-primary-foreground hover:bg-accent dark:bg-muted/40' : 'bg-gray-300 text-muted-foreground dark:bg-accent dark:text-muted-foreground cursor-not-allowed'}`}
            >
              <Save className="w-4 h-4" />
              <span>{t('保存', 'Save')}</span>
            </Button>
            <Button
              onClick={() => {
                setShowAddForm(false);
                setNewCategoryName('');
                setNewCategoryIcon('📁');
                setNewCategoryKeywords('');
              }}
              className="flex items-center space-x-2 px-4 py-2 bg-muted hover:bg-accent dark:bg-muted/40 dark:hover:bg-accent text-foreground dark:text-foreground rounded-lg border border-border dark:border-border transition-colors"
            >
              <X className="w-4 h-4" />
              <span>{t('取消', 'Cancel')}</span>
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {/* 分类排序区域 */}
        <div className="border-t border-border dark:border-border pt-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-medium text-foreground dark:text-foreground flex items-center">
              <GripVertical className="w-4 h-4 mr-2" />
              {t('分类排序', 'Category Order')}
              <span className="ml-2 text-sm text-muted-foreground dark:text-muted-foreground">
                ({allVisibleCategories.length})
              </span>
            </h4>
            <div className="flex items-center space-x-2">
              <Button
                onClick={() => setIsReordering(!isReordering)}
                className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  isReordering
                    ? 'bg-muted text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground'
                    : 'bg-mutedtext-foreground dark:bg-muted/40 dark:text-muted-foreground hover:bg-accent dark:hover:bg-accent'
                }`}
              >
                {isReordering ? t('完成', 'Done') : t('调整顺序', 'Reorder')}
              </Button>
              {categoryOrder.length > 0 && (
                <Button
                  onClick={handleResetOrder}
                  className="px-3 py-1.5 rounded-lg text-sm bg-mutedtext-foreground dark:bg-muted/40 dark:text-muted-foreground hover:bg-accent dark:hover:bg-accent transition-colors"
                >
                  {t('重置', 'Reset')}
                </Button>
              )}
            </div>
          </div>

          {isReordering && (
            <div className="mb-3 p-3 bg-muted dark:bg-muted/40 rounded-lg border border-border dark:border-border dark:border-border dark:border-border">
              <p className="text-sm text-muted-foreground dark:text-muted-foreground ">
                {t('提示：拖拽分类可快速调整顺序，或使用按钮进行置顶/置底操作', 'Tip: Drag categories to quickly reorder, or use buttons to move to top/bottom')}
              </p>
            </div>
          )}

          {allVisibleCategories.length === 0 ? (
            <p className="text-sm text-muted-foreground dark:text-muted-foreground py-4">
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
                      ? 'bg-muted dark:bg-muted/40 border-border dark:border-border dark:border-border dark:border-border'
                      : 'bg-white dark:bg-card border-border dark:border-border'
                  } ${isEditing ? 'ring-2 ring-blue-400 dark:ring-ring' : ''} ${
                    draggingId === category.id ? 'opacity-50' : ''
                  } ${
                    dragOverId === category.id && draggingId !== category.id
                      ? 'border-border dark:border-border dark:border-primary ring-2 ring-blue-200 dark:ring-blue-800 transform scale-[1.02]'
                      : ''
                  } ${isReordering && !isEditing ? 'cursor-move' : ''}`}
                >
                  {isEditing ? (
                    <>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-foreground dark:text-muted-foreground">
                          {t('编辑分类', 'Edit Category')}
                        </span>
                        {isDefault && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-accent text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground">
                            {t('默认分类', 'Default Category')}
                          </span>
                        )}
                      </div>
                      
                      {isDefault && isModified && originalCategory && (
                        <div className="mb-2 p-2 bg-muted dark:bg-muted/40 rounded border border-border dark:border-border dark:border-border dark:border-border">
                          <p className="text-xs text-muted-foreground dark:text-muted-foreground ">
                            {t(
                              `已修改。原始值：${originalCategory.icon} ${originalCategory.name}`,
                              `Modified. Original: ${originalCategory.icon} ${originalCategory.name}`
                            )}
                          </p>
                        </div>
                      )}
                      
                      <div className="space-y-2">
                        <div className="flex items-center space-x-2">
                          <Input
                            type="text"
                            value={editIcon}
                            onChange={(e) => {
                              const value = e.target.value;
                              const graphemeCount = Array.from(value).length;
                              if (graphemeCount <= 2) {
                                setEditIcon(value);
                              }
                            }}
                            className="w-14 px-2 py-1.5 border border-border dark:border-border rounded bg-white dark:bg-muted/40 text-center text-lg text-foreground dark:text-foreground focus:ring-2 focus:ring-ring focus:border-transparent focus:outline-none"
                            placeholder="📁"
                          />
                          <Input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="flex-1 px-2 py-1.5 border border-border dark:border-border rounded bg-white dark:bg-muted/40 text-sm text-foreground dark:text-foreground focus:ring-2 focus:ring-ring focus:border-transparent focus:outline-none"
                            placeholder={t('分类名称', 'Category name')}
                          />
                        </div>
                        <div className="flex items-center space-x-2">
                          <Input
                            type="text"
                            value={editKeywords}
                            onChange={(e) => setEditKeywords(e.target.value)}
                            className="flex-1 px-2 py-1.5 border border-border dark:border-border rounded bg-white dark:bg-muted/40 text-sm text-foreground dark:text-foreground focus:ring-2 focus:ring-ring focus:border-transparent focus:outline-none"
                            placeholder={t('关键词（逗号分隔）', 'Keywords (comma separated)')}
                          />
                          <Button
                            onClick={handleSaveEdit}
                            disabled={!hasChanges}
                            className={`p-1.5 rounded ${hasChanges ? 'bg-gray-900 text-white hover:bg-gray-800 dark:bg-accent dark:hover:bg-white/[0.12] dark:text-muted-foreground' : 'bg-muted text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground cursor-not-allowed'}`}
                            title={t('保存', 'Save')}
                          >
                            <Save className="w-4 h-4" />
                          </Button>
                          <Button
                            onClick={handleCancelEdit}
                            className="p-1.5 rounded bg-mutedtext-muted-foreground dark:bg-muted/40 dark:text-muted-foreground hover:bg-accent dark:hover:bg-accent"
                            title={t('取消', 'Cancel')}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                        {isDefault && isModified && (
                          <div className="flex items-center space-x-2 pt-1">
                            <span className="text-xs text-muted-foreground dark:text-muted-foreground">{t('还原:', 'Reset:')}</span>
                            {hasNameIconModified(category.id) && (
                              <Button
                                onClick={() => {
                                  resetDefaultCategoryNameIcon(category.id);
                                  if (originalCategory) {
                                    setEditName(originalCategory.name);
                                    setEditIcon(originalCategory.icon);
                                  }
                                }}
                                className="text-xs px-2 py-1 rounded bg-muted text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground hover:bg-accent hover:text-foreground dark:hover:bg-accent dark:hover:text-foreground"
                              >
                                {t('名字/图标', 'Name/Icon')}
                              </Button>
                            )}
                            {hasKeywordsModified(category.id) && (
                              <Button
                                onClick={() => {
                                  resetDefaultCategoryKeywords(category.id);
                                  if (originalCategory) {
                                    setEditKeywords(originalCategory.keywords?.join(', ') || '');
                                  }
                                }}
                                className="text-xs px-2 py-1 rounded bg-muted text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground hover:bg-accent hover:text-foreground dark:hover:bg-accent dark:hover:text-foreground"
                              >
                                {t('关键词', 'Keywords')}
                              </Button>
                            )}
                            <Button
                              onClick={() => handleResetDefault(category.id, originalCategory)}
                              className="text-xs px-2 py-1 rounded bg-muted text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground hover:bg-accent hover:text-foreground dark:hover:bg-accent dark:hover:text-foreground"
                            >
                              {t('全部', 'All')}
                            </Button>
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        {isReordering && (
                          <GripVertical className="w-4 h-4 text-muted-foreground dark:text-muted-foreground" />
                        )}
                        <span className="text-base w-6 text-center inline-block">{category.icon}</span>
                        <span className="text-sm font-medium text-foreground dark:text-foreground">
                          {category.name}
                        </span>
                        {category.isCustom && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground">
                            {t('自定义', 'Custom')}
                          </span>
                        )}
                        {!category.isCustom && isModified && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground">
                            {t('已修改', 'Modified')}
                          </span>
                        )}
                      </div>

                      {isReordering ? (
                        <div className="flex items-center space-x-1">
                          <Button
                            onClick={() => handleMoveToTop(index)}
                            disabled={index === 0}
                            className="p-1.5 rounded bg-muted text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground hover:bg-accent hover:text-foreground dark:hover:bg-accent dark:hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            title={t('置顶', 'Move to top')}
                          >
                            <ArrowUpToLine className="w-4 h-4" />
                          </Button>
                          <Button
                            onClick={() => handleMoveCategory(index, 'up')}
                            disabled={index === 0}
                            className="p-1.5 rounded bg-mutedtext-muted-foreground dark:bg-muted/40 dark:text-muted-foreground hover:bg-accent dark:hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            title={t('上移', 'Move up')}
                          >
                            <ArrowUp className="w-4 h-4" />
                          </Button>
                          <Button
                            onClick={() => handleMoveCategory(index, 'down')}
                            disabled={index === allVisibleCategories.length - 1}
                            className="p-1.5 rounded bg-mutedtext-muted-foreground dark:bg-muted/40 dark:text-muted-foreground hover:bg-accent dark:hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            title={t('下移', 'Move down')}
                          >
                            <ArrowDown className="w-4 h-4" />
                          </Button>
                          <Button
                            onClick={() => handleMoveToBottom(index)}
                            disabled={index === allVisibleCategories.length - 1}
                            className="p-1.5 rounded bg-muted text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground hover:bg-accent hover:text-foreground dark:hover:bg-accent dark:hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            title={t('置底', 'Move to bottom')}
                          >
                            <ArrowDownToLine className="w-4 h-4" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center space-x-1">
                          {category.isCustom ? (
                            <>
                              <Button
                                onClick={() => handleStartEdit(category)}
                                className="p-1.5 rounded bg-muted text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground hover:bg-accent hover:text-foreground dark:hover:bg-accent dark:hover:text-foreground"
                                title={t('编辑', 'Edit')}
                              >
                                <Edit3 className="w-4 h-4" />
                              </Button>
                              <Button
                                onClick={() => handleDeleteCategory(category.id)}
                                className="p-1.5 rounded bg-muted text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground hover:bg-accent hover:text-foreground dark:hover:bg-accent dark:hover:text-foreground"
                                title={t('删除', 'Delete')}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                onClick={() => handleStartEdit(category)}
                                className="p-1.5 rounded bg-muted text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground hover:bg-accent hover:text-foreground dark:hover:bg-accent dark:hover:text-foreground"
                                title={t('编辑', 'Edit')}
                              >
                                <Edit3 className="w-4 h-4" />
                              </Button>
                              <Button
                                onClick={() => hideDefaultCategory(category.id)}
                                className="p-1.5 rounded bg-mutedtext-muted-foreground dark:bg-muted/40 dark:text-muted-foreground hover:bg-accent dark:hover:bg-accent"
                                title={t('隐藏', 'Hide')}
                              >
                                <EyeOff className="w-4 h-4" />
                              </Button>
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
          <div className="border-t border-border dark:border-border pt-4">
            <h4 className="font-medium text-foreground dark:text-foreground mb-3 flex items-center">
              <EyeOff className="w-4 h-4 mr-2" />
              {t('隐藏的默认分类', 'Hidden Default Categories')}
              <span className="ml-2 text-sm text-muted-foreground dark:text-muted-foreground">
                ({hiddenDefaultCategories.length})
              </span>
            </h4>
            <div className="flex flex-wrap gap-2">
              {hiddenDefaultCategories.map((category) => (
                <Button
                  key={category.id}
                  onClick={() => showDefaultCategory(category.id)}
                  className="inline-flex items-center space-x-2 px-3 py-2 rounded-lg bg-mutedtext-foreground dark:bg-muted/40 dark:text-muted-foreground hover:bg-accent dark:hover:bg-accent transition-colors"
                >
                  <Eye className="w-4 h-4" />
                  <span className="w-5 text-center inline-block">{category.icon}</span>
                  <span>{category.name}</span>
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
