
import { TranslateFn } from '../../i18n/useT';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import React, { useState, useMemo, useRef, useCallback } from 'react';
import { Plus, Trash2, Edit3, Save, X, Eye, EyeOff, GripVertical, ArrowUp, ArrowDown, ArrowUpToLine, ArrowDownToLine } from 'lucide-react';
import { useAppStore, getAllCategories, sortCategoriesByOrder } from '../../store/useAppStore';
import { useDialog } from '../../hooks/useDialog';
import { validateCategoryName } from '../../utils/categoryUtils';
import { CategoryGlyph } from '../CategoryGlyph';
import { Badge } from '../ui/badge';
import { cn } from '../../lib/utils';
import {
  SettingsCard,
  SettingsDivider,
  SettingsNotice,
  SettingsPageStack,
  SettingsSection,
} from './SettingsPrimitives';

interface CategoryPanelProps {
  t: TranslateFn;
}

export const CategoryPanel: React.FC<CategoryPanelProps> = ({ t }) => {
  const customCategories = useAppStore(state => state.customCategories);
  const hiddenDefaultCategoryIds = useAppStore(state => state.hiddenDefaultCategoryIds);
  const defaultCategoryOverrides = useAppStore(state => state.defaultCategoryOverrides);
  const categoryOrder = useAppStore(state => state.categoryOrder);
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
    const validation = validateCategoryName(newCategoryName, t);
    if (validation.error !== null) {
      toast(validation.error, 'error');
      return;
    }
    const categoryName = validation.value;

    const newCategory = {
      id: `custom-${Date.now()}`,
      name: categoryName,
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
    const validation = validateCategoryName(editName, t, 'categoryUtils.empty-category-name');
    if (validation.error !== null) {
      toast(validation.error, 'error');
      return;
    }
    const categoryName = validation.value;

    if (editingId) {
      const isDefault = allDefaultCategories.some(c => c.id === editingId);
      if (isDefault) {
        updateDefaultCategory(editingId, {
          name: categoryName,
          icon: editIcon,
          keywords: editKeywords.split(',').map(k => k.trim()).filter(k => k),
        });
      } else {
        updateCustomCategory(editingId, {
          name: categoryName,
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
      t('categoryPanel.delete-custom-category'),
      t('categoryPanel.this-action-cannot-be-undone'),
      { type: 'danger', confirmText: t('categoryPanel.delete') }
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
      t('categoryPanel.reset-category-order'),
      t('categoryPanel.this-will-restore-the-default-order'),
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
    <SettingsPageStack>
      <SettingsSection
        title={t('categoryPanel.repository-categorization')}
        titleId="category-match-mode-label"
        description={t('categoryPanel.choose-how-repositories-are-assigned-to-categori')}
      >
        <SettingsCard>
          <RadioGroup
            aria-labelledby="category-match-mode-label"
            value={categoryMatchMode}
            onValueChange={(value) => setCategoryMatchMode(value as 'effective' | 'legacy')}
            className="gap-0"
          >
            <label
              htmlFor="category-match-effective"
              className={cn(
                'flex cursor-pointer items-start gap-3 px-3.5 py-2.5 transition-[background-color] duration-micro ease-out-subtle hover:bg-fill-hover hover:duration-instant',
                categoryMatchMode === 'effective' && 'bg-fill-selected/50',
              )}
            >
              <RadioGroupItem value="effective" id="category-match-effective" aria-labelledby="category-match-effective-label" className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <span id="category-match-effective-label" className="block text-label font-medium text-foreground">
                  {t('categoryPanel.match-by-tags-shown-on-cards-recommended')}
                </span>
                <span className="mt-px block text-label-sm leading-[18px] text-secondary">
                  {t('categoryPanel.repositories-are-grouped-by-the-tags-actually-sh')}
                </span>
              </div>
            </label>
            <SettingsDivider />
            <label
              htmlFor="category-match-legacy"
              className={cn(
                'flex cursor-pointer items-start gap-3 px-3.5 py-2.5 transition-[background-color] duration-micro ease-out-subtle hover:bg-fill-hover hover:duration-instant',
                categoryMatchMode === 'legacy' && 'bg-fill-selected/50',
              )}
            >
              <RadioGroupItem value="legacy" id="category-match-legacy" aria-labelledby="category-match-legacy-label" className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <span id="category-match-legacy-label" className="block text-label font-medium text-foreground">
                  {t('categoryPanel.match-by-ai-generated-tags-only-legacy')}
                </span>
                <span className="mt-px block text-label-sm leading-[18px] text-secondary">
                  {t('categoryPanel.uses-the-legacy-logic-that-categorizes-only-by-a')}
                </span>
              </div>
            </label>
          </RadioGroup>
        </SettingsCard>
      </SettingsSection>

      {showAddForm && (
        <SettingsSection title={t('categoryPanel.add-custom-category')}>
          <SettingsCard className="space-y-4 p-3.5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label htmlFor="category-panel-new-name" className="mb-1.5 block text-label font-medium text-foreground">
                  {t('categoryPanel.category-name')} *
                </label>
                <Input
                  id="category-panel-new-name"
                  type="text"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder={t('categoryPanel.e-g-my-projects')}
                />
              </div>
              <div>
                <label htmlFor="category-panel-new-icon" className="mb-1.5 block text-label font-medium text-foreground">
                  {t('categoryPanel.icon')}
                </label>
                <Input
                  id="category-panel-new-icon"
                  type="text"
                  value={newCategoryIcon}
                  onChange={(e) => {
                    const value = e.target.value;
                    const graphemeCount = Array.from(value).length;
                    if (graphemeCount <= 2) {
                      setNewCategoryIcon(value);
                    }
                  }}
                  placeholder="📁"
                />
              </div>
            </div>
            <div>
              <label htmlFor="category-panel-new-keywords" className="mb-1.5 block text-label font-medium text-foreground">
                {t('categoryPanel.keywords')}
              </label>
              <Input
                id="category-panel-new-keywords"
                type="text"
                value={newCategoryKeywords}
                onChange={(e) => setNewCategoryKeywords(e.target.value)}
                placeholder={t('categoryPanel.comma-separated-keywords')}
              />
              <p className="mt-1.5 text-label-sm text-secondary">
                {t('categoryPanel.used-to-automatically-match-repositories-to-this')}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="primary"
                size="md"
                onClick={handleAddCategory}
                disabled={!newCategoryName.trim()}
              >
                <Save className="size-4" />
                <span>{t('categoryPanel.save')}</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                size="md"
                onClick={() => {
                  setShowAddForm(false);
                  setNewCategoryName('');
                  setNewCategoryIcon('📁');
                  setNewCategoryKeywords('');
                }}
              >
                <X className="size-4" />
                <span>{t('categoryPanel.cancel')}</span>
              </Button>
            </div>
          </SettingsCard>
        </SettingsSection>
      )}

      <SettingsSection
        title={(
          <span className="inline-flex items-center gap-1.5">
            <span>{t('categoryPanel.category-order')}</span>
            <span className="tabular-nums text-tertiary">({allVisibleCategories.length})</span>
          </span>
        )}
        actions={(
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant={isReordering ? 'primary' : 'outline'}
              size="sm"
              onClick={() => setIsReordering(!isReordering)}
            >
              {isReordering ? t('categoryPanel.done') : t('categoryPanel.reorder')}
            </Button>
            {categoryOrder.length > 0 && (
              <Button type="button" variant="outline" size="sm" onClick={handleResetOrder}>
                {t('categoryPanel.reset')}
              </Button>
            )}
            <Button type="button" variant="primary" size="sm" onClick={() => setShowAddForm(true)}>
              <Plus className="size-3.5" />
              <span>{t('categoryPanel.add-category')}</span>
            </Button>
          </div>
        )}
      >
        {isReordering && (
          <SettingsNotice tone="neutral" icon={<GripVertical />}>
            {t('categoryPanel.tip-drag-categories-to-quickly-reorder-or-use-bu')}
          </SettingsNotice>
        )}

        {allVisibleCategories.length === 0 ? (
          <SettingsCard className="px-4 py-8 text-center text-label-sm text-secondary">
            {t('categoryPanel.no-visible-categories')}
          </SettingsCard>
        ) : (
          <SettingsCard>
            {allVisibleCategories.map((category, index) => {
              const isEditing = editingId === category.id;
              const isDefault = !category.isCustom;
              const isModified = isDefaultCategoryModified(category.id);
              const originalCategory = originalDefaultCategories.find((c) => c.id === category.id);

              const hasChanges = isEditing && (
                editName !== category.name ||
                editIcon !== category.icon ||
                editKeywords !== (category.keywords?.join(', ') || '')
              );

              return (
                <React.Fragment key={category.id}>
                  {index > 0 && <SettingsDivider />}
                  <div
                    draggable={isReordering && !isEditing}
                    onDragStart={(e) => handleDragStart(e, index, category.id)}
                    onDragEnd={handleDragEnd}
                    onDragOver={(e) => handleDragOver(e, category.id)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, index)}
                    className={cn(
                      'flex flex-col px-3.5 py-2.5 transition-[background-color,opacity] duration-micro ease-out-subtle',
                      !isEditing && 'hover:bg-fill-hover hover:duration-instant',
                      isEditing && 'bg-fill-selected/40',
                      draggingId === category.id && 'opacity-50',
                      dragOverId === category.id && draggingId !== category.id && 'bg-accent-tint',
                      isReordering && !isEditing && 'cursor-move',
                    )}
                  >
                    {isEditing ? (
                      <div className="space-y-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-label font-medium text-foreground">
                            {t('categoryPanel.edit-category')}
                          </span>
                          {isDefault && (
                            <Badge variant="secondary">{t('categoryPanel.default-category')}</Badge>
                          )}
                        </div>

                        {isDefault && isModified && originalCategory && (
                          <SettingsNotice tone="neutral">
                            {t('categoryPanel.modified-original-v1-v2', { v1: originalCategory.icon, v2: originalCategory.name })}
                          </SettingsNotice>
                        )}

                        <div className="flex items-center gap-2">
                          <Input
                            type="text"
                            aria-label={t('categoryPanel.edit-category-icon')}
                            value={editIcon}
                            onChange={(e) => {
                              const value = e.target.value;
                              const graphemeCount = Array.from(value).length;
                              // CategoryEditModal 生成的 lucide:xxx 图标超过 2 字素，
                              // 放行该前缀使这类图标值仍可局部编辑
                              if (graphemeCount <= 2 || value.startsWith('lucide:')) {
                                setEditIcon(value);
                              }
                            }}
                            className="w-16 text-center"
                            placeholder="📁"
                          />
                          <Input
                            type="text"
                            aria-label={t('categoryPanel.edit-category-name')}
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="flex-1"
                            placeholder={t('categoryPanel.category-name-2')}
                          />
                        </div>

                        <div className="flex items-center gap-2">
                          <Input
                            type="text"
                            aria-label={t('categoryPanel.edit-category-keywords')}
                            value={editKeywords}
                            onChange={(e) => setEditKeywords(e.target.value)}
                            className="flex-1"
                            placeholder={t('categoryPanel.keywords-comma-separated')}
                          />
                          <Button
                            type="button"
                            variant="primary"
                            size="icon"
                            onClick={handleSaveEdit}
                            disabled={!hasChanges}
                            aria-label={t('categoryPanel.save')}
                            title={t('categoryPanel.save')}
                          >
                            <Save className="size-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={handleCancelEdit}
                            aria-label={t('categoryPanel.cancel')}
                            title={t('categoryPanel.cancel')}
                          >
                            <X className="size-4" />
                          </Button>
                        </div>

                        {isDefault && isModified && (
                          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                            <span className="text-label-sm text-tertiary">{t('categoryPanel.reset-2')}</span>
                            {hasNameIconModified(category.id) && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  resetDefaultCategoryNameIcon(category.id);
                                  if (originalCategory) {
                                    setEditName(originalCategory.name);
                                    setEditIcon(originalCategory.icon);
                                  }
                                }}
                              >
                                {t('categoryPanel.name-icon')}
                              </Button>
                            )}
                            {hasKeywordsModified(category.id) && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  resetDefaultCategoryKeywords(category.id);
                                  if (originalCategory) {
                                    setEditKeywords(originalCategory.keywords?.join(', ') || '');
                                  }
                                }}
                              >
                                {t('categoryPanel.keywords')}
                              </Button>
                            )}
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => handleResetDefault(category.id, originalCategory)}
                            >
                              {t('categoryPanel.all')}
                            </Button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex min-h-8 items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2.5">
                          {isReordering && (
                            <GripVertical className="size-4 shrink-0 text-tertiary" />
                          )}
                          <CategoryGlyph
                            icon={category.icon}
                            name={category.name}
                            categoryId={category.id}
                            className="app-settings-category-glyph"
                          />
                          <span className="truncate text-label font-medium text-foreground">
                            {category.name}
                          </span>
                          {category.isCustom && (
                            <Badge variant="secondary">{t('categoryPanel.custom')}</Badge>
                          )}
                          {!category.isCustom && isModified && (
                            <Badge variant="secondary">{t('categoryPanel.modified')}</Badge>
                          )}
                        </div>

                        {isReordering ? (
                          <div className="flex shrink-0 items-center gap-0.5">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => handleMoveToTop(index)}
                              disabled={index === 0}
                              aria-label={t('categoryPanel.move-to-top')}
                              title={t('categoryPanel.move-to-top')}
                            >
                              <ArrowUpToLine className="size-3.5 text-secondary" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => handleMoveCategory(index, 'up')}
                              disabled={index === 0}
                              aria-label={t('categoryPanel.move-up')}
                              title={t('categoryPanel.move-up')}
                            >
                              <ArrowUp className="size-3.5 text-secondary" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => handleMoveCategory(index, 'down')}
                              disabled={index === allVisibleCategories.length - 1}
                              aria-label={t('categoryPanel.move-down')}
                              title={t('categoryPanel.move-down')}
                            >
                              <ArrowDown className="size-3.5 text-secondary" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => handleMoveToBottom(index)}
                              disabled={index === allVisibleCategories.length - 1}
                              aria-label={t('categoryPanel.move-to-bottom')}
                              title={t('categoryPanel.move-to-bottom')}
                            >
                              <ArrowDownToLine className="size-3.5 text-secondary" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex shrink-0 items-center gap-0.5">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => handleStartEdit(category)}
                              aria-label={t('categoryPanel.edit')}
                              title={t('categoryPanel.edit')}
                            >
                              <Edit3 className="size-3.5 text-secondary" />
                            </Button>
                            {category.isCustom ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => handleDeleteCategory(category.id)}
                                aria-label={t('categoryPanel.delete')}
                                title={t('categoryPanel.delete')}
                                className="text-destructive hover:bg-destructive-tint hover:text-destructive"
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            ) : (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => hideDefaultCategory(category.id)}
                                aria-label={t('categoryPanel.hide')}
                                title={t('categoryPanel.hide')}
                              >
                                <EyeOff className="size-3.5 text-secondary" />
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </React.Fragment>
              );
            })}
          </SettingsCard>
        )}
      </SettingsSection>

      {hiddenDefaultCategories.length > 0 && (
        <SettingsSection
          title={(
            <span className="inline-flex items-center gap-1.5">
              <span>{t('categoryPanel.hidden-default-categories')}</span>
              <span className="tabular-nums text-tertiary">({hiddenDefaultCategories.length})</span>
            </span>
          )}
        >
          <SettingsCard className="p-3.5">
            <div className="flex flex-wrap gap-2">
              {hiddenDefaultCategories.map((category) => (
                <Button
                  key={category.id}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => showDefaultCategory(category.id)}
                >
                  <Eye className="size-3.5 text-tertiary" />
                  <CategoryGlyph
                    icon={category.icon}
                    name={category.name}
                    categoryId={category.id}
                    className="app-settings-category-glyph"
                  />
                  <span>{category.name}</span>
                </Button>
              ))}
            </div>
          </SettingsCard>
        </SettingsSection>
      )}
    </SettingsPageStack>
  );
};
