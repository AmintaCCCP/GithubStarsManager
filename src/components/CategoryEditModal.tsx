import { useT } from "../i18n/useT";
import { Button } from './ui/button';
import { Input } from './ui/input';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Save, X, Plus, ListPlus } from 'lucide-react';
import { Modal } from './Modal';
import { Category } from '../types';
import { useAppStore, getAllCategories } from '../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { useDialog } from '../hooks/useDialog';
import { validateCategoryName } from '../utils/categoryUtils';
import { useStarSyncActions } from '../features/settings/hooks/useStarSyncActions';
import { GITHUB_LISTS_NAME_MAX_LENGTH } from '../store/helpers/listsPushPlan';
import { CategoryGlyph } from './CategoryGlyph';

const CATEGORY_ICON_CHOICES = [
  ['folder', 'Folder'],
  ['layers', 'Layers'],
  ['brain-circuit', 'AI'],
  ['bot', 'Agent'],
  ['blocks', 'Blocks'],
  ['cable', 'MCP'],
  ['sparkles', 'Skills'],
  ['network', 'Network'],
  ['globe', 'Web'],
  ['smartphone', 'Mobile'],
  ['monitor', 'Desktop'],
  ['database', 'Database'],
  ['code', 'Code'],
  ['terminal', 'Terminal'],
  ['wrench', 'Tools'],
  ['shield', 'Security'],
  ['gamepad', 'Games'],
  ['palette', 'Design'],
  ['zap', 'Productivity'],
  ['graduation', 'Education'],
  ['book-open', 'Knowledge'],
  ['clapperboard', 'Media'],
  ['users', 'Social'],
  ['chart-no-axes-column', 'Analytics'],
  ['package', 'Package'],
  ['flask', 'Experiment'],
  ['rocket', 'Launch'],
  ['star', 'Star'],
  ['tag', 'Tag'],
  ['lock', 'Private'],
  ['search', 'Search'],
  ['file-text', 'Document'],
  ['git-branch', 'Branch'],
  ['workflow', 'Workflow'],
  ['plug', 'Integration'],
  ['cloud', 'Cloud'],
  ['cpu', 'Hardware'],
  ['timer', 'Time'],
  ['music', 'Music'],
  ['video', 'Video'],
] as const satisfies ReadonlyArray<readonly [string, string]>;

interface CategoryEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  category: Category | null;
  isCreating?: boolean;
}

export const CategoryEditModal: React.FC<CategoryEditModalProps> = ({
  isOpen,
  onClose,
  category,
  isCreating = false
}) => {
  const { addCustomCategory, updateCustomCategory, updateDefaultCategory, resetDefaultCategory, resetDefaultCategoryNameIcon, resetDefaultCategoryKeywords, defaultCategoryOverrides, language, customCategories, isListsPushRunning } = useAppStore(useShallow((state) => ({
    addCustomCategory: state.addCustomCategory,
    updateCustomCategory: state.updateCustomCategory,
    updateDefaultCategory: state.updateDefaultCategory,
    resetDefaultCategory: state.resetDefaultCategory,
    resetDefaultCategoryNameIcon: state.resetDefaultCategoryNameIcon,
    resetDefaultCategoryKeywords: state.resetDefaultCategoryKeywords,
    defaultCategoryOverrides: state.defaultCategoryOverrides,
    language: state.language,
    customCategories: state.customCategories,
    isListsPushRunning: state.listsPush.isRunning,
  })));
  const { pushCategoriesToLists } = useStarSyncActions();

  const { toast } = useDialog();
  const t = useT('app');

  const originalDefaultCategories = getAllCategories([], language, [], {});
  const isDefaultCategoryModified = category && !category.isCustom && category.id in defaultCategoryOverrides;
  const originalCategory = category && !category.isCustom ? originalDefaultCategories.find(c => c.id === category.id) : null;
  
  const effectiveCategory = React.useMemo(() => {
    if (!category || isCreating) return null;
    if (category.isCustom) {
      return customCategories.find(c => c.id === category.id) || category;
    }
    const allCategories = getAllCategories([], language, [], defaultCategoryOverrides);
    return allCategories.find(c => c.id === category.id) || category;
  }, [category, isCreating, customCategories, defaultCategoryOverrides, language]);
  
  const hasNameIconModified = category && !category.isCustom && defaultCategoryOverrides[category.id] && 
    (defaultCategoryOverrides[category.id].name !== undefined || defaultCategoryOverrides[category.id].icon !== undefined);
  const hasKeywordsModified = category && !category.isCustom && defaultCategoryOverrides[category.id] && 
    defaultCategoryOverrides[category.id].keywords !== undefined;
  
  const [formData, setFormData] = useState({
    name: '',
    icon: 'lucide:folder',
    keywords: ''
  });
  const [customIcon, setCustomIcon] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);

  useEffect(() => {
    if (category && !isCreating) {
      setFormData({
        name: category.name,
        icon: category.icon,
        keywords: category.keywords.join(', ')
      });
    } else if (isCreating) {
      setFormData({
        name: '',
        icon: 'lucide:folder',
        keywords: ''
      });
    }
  }, [category, isCreating, isOpen]);

  const handleSave = () => {
    const validation = validateCategoryName(formData.name, t);
    if (validation.error !== null) {
      toast(validation.error, 'error');
      return;
    }
    const categoryName = validation.value;

    if (isCreating) {
      const categoryData: Category = {
        id: Date.now().toString(),
        name: categoryName,
        icon: formData.icon,
        keywords: formData.keywords.split(',').map(k => k.trim()).filter(k => k),
        isCustom: true
      };
      addCustomCategory(categoryData);
    } else if (category) {
      const updates = {
        name: categoryName,
        icon: formData.icon,
        keywords: formData.keywords.split(',').map(k => k.trim()).filter(k => k),
      };
      if (category.isCustom) {
        updateCustomCategory(category.id, updates);
      } else {
        updateDefaultCategory(category.id, updates);
      }
    }

    onClose();
  };

  const hasChanges = isCreating 
    ? formData.name.trim().length > 0
    : effectiveCategory && (
        formData.name !== effectiveCategory.name ||
        formData.icon !== effectiveCategory.icon ||
        formData.keywords !== (effectiveCategory.keywords?.join(', ') || '')
      );

  // 推送的是已保存的分类：有未保存修改时禁用；先关闭弹窗再确认，避免对话框叠加
  const canPush = !isCreating && !!category;
  const handlePush = () => {
    if (!category) return;
    onClose();
    void pushCategoriesToLists([category.id]);
  };
  const isNameTooLong = formData.name.trim().length > GITHUB_LISTS_NAME_MAX_LENGTH;

  const handleIconSelect = useCallback((iconValue: string) => {
    setFormData(prev => ({ ...prev, icon: iconValue }));
    setShowCustomInput(false);
    setCustomIcon('');
  }, []);

  const iconGrid = useMemo(() => CATEGORY_ICON_CHOICES.map(([key, label]) => (
    <Button
      key={key}
      type="button"
      variant="ghost"
      aria-label={label}
      aria-pressed={formData.icon === `lucide:${key}`}
      onClick={() => handleIconSelect(`lucide:${key}`)}
      className="app-category-icon-option"
      title={label}
    >
      <CategoryGlyph icon={key} name={label} />
    </Button>
  )), [formData.icon, handleIconSelect]);

  const handleCustomIconSubmit = () => {
    if (customIcon.trim()) {
      setFormData(prev => ({ ...prev, icon: customIcon.trim() }));
      setShowCustomInput(false);
      setCustomIcon('');
    }
  };

  const handleClose = () => {
    setFormData({
      name: '',
      icon: 'lucide:folder',
      keywords: ''
    });
    setCustomIcon('');
    setShowCustomInput(false);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={isCreating ? t('categoryEditModal.add-category') : t('categoryEditModal.edit-category')}
      maxWidth="max-w-lg"
      contentClassName="app-category-editor-dialog"
    >
      <div className="app-category-editor">
        {/* Category Name */}
        <div className="app-form-field">
          <label htmlFor="category-name" className="app-form-label">
            {t('categoryEditModal.category-name')} *
          </label>
          <Input
            id="category-name"
            type="text"
            value={formData.name}
            onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
            className="ui-field w-full"
            placeholder={t('categoryEditModal.enter-category-name')}
            autoFocus
          />
          {isNameTooLong && (
            <p className="app-form-hint text-warning">
              {t('categoryEditModal.name-too-long-for-github-list', { max: GITHUB_LISTS_NAME_MAX_LENGTH })}
            </p>
          )}
        </div>

        {/* Icon Selection */}
        <div className="app-form-field">
          <label className="app-form-label">
            {t('categoryEditModal.select-icon')} 
            <span className="app-form-label-meta">
              ({CATEGORY_ICON_CHOICES.length} {t('categoryEditModal.available')})
            </span>
          </label>
          
          {/* Custom Icon Input */}
          {showCustomInput && (
            <div className="app-category-custom-icon">
              <div className="app-category-custom-icon-row">
                <Input
                  aria-label={t('categoryEditModal.custom-icon')}
                  type="text"
                  value={customIcon}
                  onChange={(e) => setCustomIcon(e.target.value)}
                  placeholder={t('categoryEditModal.enter-any-emoji')}
                  className="ui-field flex-1 text-center"
                  autoFocus
                />
                <Button
                  onClick={handleCustomIconSubmit}
                  disabled={!customIcon.trim()}
                  className="ui-button-primary disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {t('categoryEditModal.ok')}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowCustomInput(false);
                    setCustomIcon('');
                  }}
                  className="ui-button"
                >
                  {t('categoryEditModal.cancel')}
                </Button>
              </div>
              <p className="app-form-hint text-primary">
                {t('categoryEditModal.tip-you-can-enter-any-emoji-like-etc')}
              </p>
            </div>
          )}
          
          <div className="app-category-icon-grid">
            {iconGrid}
          </div>
          <div className="app-category-editor-meta">
            <span className="app-category-editor-selection whitespace-nowrap">
              {t('categoryEditModal.selected')}
              <CategoryGlyph icon={formData.icon} name={formData.name} />
            </span>
            <Button
              type="button"
              onClick={() => setShowCustomInput(true)}
              variant="ghost"
              className="app-category-custom-trigger"
            >
              <Plus aria-hidden="true" />
              {t('categoryEditModal.custom-emoji')}
            </Button>
          </div>
        </div>

        {/* Keywords */}
        <div className="app-form-field">
          <label htmlFor="category-keywords" className="app-form-label">
            {t('categoryEditModal.keywords')}
          </label>
          <Input
            id="category-keywords"
            type="text"
            value={formData.keywords}
            onChange={(e) => setFormData(prev => ({ ...prev, keywords: e.target.value }))}
            className="ui-field w-full"
            placeholder={t('categoryEditModal.comma-separated-keywords')}
          />
          <p className="app-form-hint">
            {t('categoryEditModal.used-to-automatically-match-repositories-to-this')}
          </p>
        </div>

        {/* Default Category Modified Hint */}
        {category && !category.isCustom && isDefaultCategoryModified && originalCategory && (
          <div className="app-form-notice">
            <p className="app-form-hint text-warning">
              {t('categoryEditModal.this-default-category-has-been-modified-original', { v1: originalCategory.icon, v2: originalCategory.name })}
            </p>
            <div className="app-form-inline-actions">
              <span>{t('categoryEditModal.reset')}</span>
              {hasNameIconModified && (
                <Button
                  size="sm"
                  onClick={() => {
                    resetDefaultCategoryNameIcon(category.id);
                    setFormData(prev => ({
                      ...prev,
                      name: originalCategory.name,
                      icon: originalCategory.icon
                    }));
                  }}
                  className="ui-button"
                >
                  {t('categoryEditModal.name-icon')}
                </Button>
              )}
              {hasKeywordsModified && (
                <Button
                  size="sm"
                  onClick={() => {
                    resetDefaultCategoryKeywords(category.id);
                    setFormData(prev => ({
                      ...prev,
                      keywords: originalCategory.keywords.join(', ')
                    }));
                  }}
                  className="ui-button"
                >
                  {t('categoryEditModal.keywords')}
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => {
                  resetDefaultCategory(category.id);
                  setFormData({
                    name: originalCategory.name,
                    icon: originalCategory.icon,
                    keywords: originalCategory.keywords.join(', ')
                  });
                }}
                className="ui-button text-destructive"
              >
                {t('categoryEditModal.all')}
              </Button>
            </div>
          </div>
        )}

        {category && !category.isCustom && !isDefaultCategoryModified && (
          <div className="app-form-notice">
            <p className="app-form-hint text-primary">
              {t('categoryEditModal.editing-default-category-will-override-original')}
            </p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="app-category-editor-footer">
          <div>
            {canPush && (
              <Button
                variant="outline"
                onClick={handlePush}
                disabled={!!hasChanges || isListsPushRunning}
                title={hasChanges ? t('categoryEditModal.save-changes-before-push') : undefined}
                className="ui-button"
              >
                <ListPlus aria-hidden="true" />
                <span>{t('categoryEditModal.push-to-github-list')}</span>
              </Button>
            )}
          </div>
          <div className="app-dialog-actions">
          <Button
            variant="outline"
            onClick={handleClose}
            className="ui-button"
          >
            <X aria-hidden="true" />
            <span>{t('categoryEditModal.cancel')}</span>
          </Button>
          <Button
            onClick={handleSave}
            disabled={!hasChanges}
            className="ui-button-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save aria-hidden="true" />
            <span>{t('categoryEditModal.save')}</span>
          </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
