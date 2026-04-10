import React, { useState, useEffect } from 'react';
import { Save, X, Plus, Lock, Unlock } from 'lucide-react';
import { Modal } from './Modal';
import { Repository } from '../types';
import { useAppStore, getAllCategories } from '../store/useAppStore';
import { forceSyncToBackend } from '../services/autoSync';

interface RepositoryEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  repository: Repository | null;
}

export const RepositoryEditModal: React.FC<RepositoryEditModalProps> = ({
  isOpen,
  onClose,
  repository
}) => {
  const { updateRepository, language, customCategories, hiddenDefaultCategoryIds } = useAppStore();
  
  const [formData, setFormData] = useState({
    description: '',
    tags: [] as string[],
    category: '',
    categoryLocked: false
  });
  const [newTag, setNewTag] = useState('');

  const allCategories = getAllCategories(customCategories, language, hiddenDefaultCategoryIds);

  // 获取仓库当前所属的分类
  const getCurrentCategory = (repo: Repository) => {
    // 如果有自定义分类，直接返回
    if (repo.custom_category) {
      return repo.custom_category;
    }
    
    // 否则根据AI标签或其他信息推断当前分类
    for (const category of allCategories) {
      if (category.id === 'all') continue;
      
      // 检查AI标签匹配
      if (repo.ai_tags && repo.ai_tags.length > 0) {
        const hasMatch = repo.ai_tags.some(tag => 
          category.keywords.some(keyword => 
            tag.toLowerCase().includes(keyword.toLowerCase()) ||
            keyword.toLowerCase().includes(tag.toLowerCase())
          )
        );
        if (hasMatch) {
          return category.name;
        }
      }
      
      // 检查传统匹配方式
      const repoText = [
        repo.name,
        repo.description || '',
        repo.language || '',
        ...(repo.topics || []),
        repo.ai_summary || ''
      ].join(' ').toLowerCase();
      
      const hasKeywordMatch = category.keywords.some(keyword => 
        repoText.includes(keyword.toLowerCase())
      );
      
      if (hasKeywordMatch) {
        return category.name;
      }
    }
    
    return '';
  };
  useEffect(() => {
    if (repository && isOpen) {
      const currentCategory = getCurrentCategory(repository);
      setFormData({
        description: repository.custom_description || repository.ai_summary || repository.description || '',
        tags: repository.custom_tags || repository.ai_tags || repository.topics || [],
        category: currentCategory,
        categoryLocked: !!repository.category_locked
      });
    }
  }, [repository, isOpen]);

  const handleSave = async () => {
    if (!repository) return;

    const originalCategory = getCurrentCategory(repository);
    const categoryChanged = formData.category !== originalCategory;

    const updatedRepo = {
      ...repository,
      custom_description: formData.description !== repository.description ? formData.description : undefined,
      custom_tags: formData.tags.length > 0 ? formData.tags : undefined,
      custom_category: formData.category ? formData.category : undefined,
      // 手动修改分类时，默认自动锁定；用户仍可手动取消
      category_locked: categoryChanged ? true : formData.categoryLocked,
      last_edited: new Date().toISOString()
    };
    
    updateRepository(updatedRepo);
    await forceSyncToBackend();
    onClose();
  };

  const handleClose = () => {
    setFormData({
      description: '',
      tags: [],
      category: '',
      categoryLocked: false
    });
    setNewTag('');
    onClose();
  };

  const handleAddTag = () => {
    if (newTag.trim() && !formData.tags.includes(newTag.trim())) {
      setFormData(prev => ({
        ...prev,
        tags: [...prev.tags, newTag.trim()]
      }));
      setNewTag('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setFormData(prev => ({
      ...prev,
      tags: prev.tags.filter(tag => tag !== tagToRemove)
    }));
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTag();
    }
  };

  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

  if (!repository) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={t('编辑仓库信息', 'Edit Repository Info')}
      maxWidth="max-w-2xl"
    >
      <div className="space-y-6">
        {/* Repository Info */}
        <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
          <div className="flex items-center space-x-3 mb-2">
            <img
              src={repository.owner.avatar_url}
              alt={repository.owner.login}
              className="w-8 h-8 rounded-full"
            />
            <div>
              <h4 className="font-semibold text-gray-900 dark:text-white">
                {repository.name}
              </h4>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {repository.owner.login}
              </p>
            </div>
          </div>
          {repository.description && (
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {t('原始描述:', 'Original description:')} {repository.description}
            </p>
          )}
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            {t('自定义描述', 'Custom Description')}
          </label>
          <textarea
            value={formData.description}
            onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            rows={3}
            placeholder={t('输入自定义描述...', 'Enter custom description...')}
          />
        </div>

        {/* Category */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            {t('分类', 'Category')}
          </label>
          <select
            value={formData.category}
            onChange={(e) => setFormData(prev => ({ ...prev, category: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">{t('选择分类...', 'Select category...')}</option>
            {allCategories.filter(cat => cat.id !== 'all').map(category => (
              <option key={category.id} value={category.name}>
                {category.icon} {category.name}
              </option>
            ))}
          </select>
          {formData.category && (
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {t('当前分类:', 'Current category:')} {formData.category}
            </p>
          )}

          <div className="mt-3 flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 px-3 py-2">
            <div className="flex items-center space-x-2">
              {formData.categoryLocked ? (
                <Lock className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              ) : (
                <Unlock className="w-4 h-4 text-gray-500 dark:text-gray-400" />
              )}
              <span className="text-sm text-gray-700 dark:text-gray-300">
                {t('分类锁定', 'Category Lock')}
              </span>
            </div>
            <label
              className="inline-flex items-center cursor-pointer"
              title={t(
                '开启后，同步时不会自动修改该仓库分类。手动修改分类会自动开启此开关。',
                'When enabled, sync will not auto-change this repository category. Manually changing category will enable this lock by default.'
              )}
            >
              <input
                type="checkbox"
                checked={formData.categoryLocked}
                onChange={(e) => setFormData(prev => ({ ...prev, categoryLocked: e.target.checked }))}
                className="sr-only peer"
              />
              <div className="relative w-10 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:bg-blue-600">
                <div className="absolute top-[2px] left-[2px] bg-white border-gray-300 border rounded-full h-5 w-5 transition-transform peer-checked:translate-x-full"></div>
              </div>
            </label>
          </div>
        </div>

        {/* Tags */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            {t('自定义标签', 'Custom Tags')}
          </label>
          
          {/* Existing Tags */}
          {formData.tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {formData.tags.map((tag, index) => (
                <span
                  key={index}
                  className="inline-flex items-center px-3 py-1 bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 rounded-full text-sm"
                >
                  {tag}
                  <button
                    onClick={() => handleRemoveTag(tag)}
                    className="ml-2 text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-200"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Add New Tag */}
          <div className="flex space-x-2">
            <input
              type="text"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyPress={handleKeyPress}
              className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder={t('添加标签...', 'Add tag...')}
            />
            <button
              onClick={handleAddTag}
              disabled={!newTag.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-gray-600">
          <button
            onClick={handleClose}
            className="flex items-center space-x-2 px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            <X className="w-4 h-4" />
            <span>{t('取消', 'Cancel')}</span>
          </button>
          <button
            onClick={() => void handleSave()}
            className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
          >
            <Save className="w-4 h-4" />
            <span>{t('保存', 'Save')}</span>
          </button>
        </div>
      </div>
    </Modal>
  );
};