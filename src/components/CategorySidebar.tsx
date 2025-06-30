import React, { useState } from 'react';
import { 
  Folder, 
  Code, 
  Globe, 
  Smartphone, 
  Database, 
  Shield, 
  Gamepad2, 
  Palette, 
  Bot, 
  Wrench,
  BookOpen,
  Zap,
  Users,
  BarChart3,
  Plus,
  Edit3,
  Trash2,
  Save,
  X
} from 'lucide-react';
import { Repository, Category } from '../types';
import { useAppStore, getAllCategories } from '../store/useAppStore';

interface CategorySidebarProps {
  repositories: Repository[];
  selectedCategory: string;
  onCategorySelect: (category: string) => void;
}

const iconMap: Record<string, React.ComponentType<any>> = {
  Folder,
  Code,
  Globe,
  Smartphone,
  Database,
  Shield,
  Gamepad2,
  Palette,
  Bot,
  Wrench,
  BookOpen,
  Zap,
  Users,
  BarChart3,
  Plus
};

export const CategorySidebar: React.FC<CategorySidebarProps> = ({
  repositories,
  selectedCategory,
  onCategorySelect
}) => {
  const {
    customCategories,
    addCustomCategory,
    updateCustomCategory,
    deleteCustomCategory,
    language
  } = useAppStore();

  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [renamingCategoryId, setRenamingCategoryId] = useState<string | null>(null);
  const [newCategory, setNewCategory] = useState({
    name: '',
    icon: 'Folder',
    keywords: ''
  });
  const [renameValue, setRenameValue] = useState('');

  const allCategories = getAllCategories(customCategories, language);

  // Calculate repository count for each category
  const getCategoryCount = (category: Category) => {
    if (category.id === 'all') return repositories.length;
    
    return repositories.filter(repo => {
      // Check custom category first
      if (repo.custom_category === category.name) {
        return true;
      }
      
      // 优先使用AI标签进行匹配
      if (repo.ai_tags && repo.ai_tags.length > 0) {
        return repo.ai_tags.some(tag => 
          category.keywords.some(keyword => 
            tag.toLowerCase().includes(keyword.toLowerCase()) ||
            keyword.toLowerCase().includes(tag.toLowerCase())
          )
        );
      }
      
      // 如果没有AI标签，使用传统方式匹配
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

  const handleSaveCategory = () => {
    if (!newCategory.name.trim()) {
      alert(language === 'zh' ? '请输入分类名称' : 'Please enter category name');
      return;
    }

    const category: Category = {
      id: Date.now().toString(),
      name: newCategory.name.trim(),
      icon: newCategory.icon,
      keywords: newCategory.keywords.split(',').map(k => k.trim()).filter(k => k),
      isCustom: true
    };

    addCustomCategory(category);
    setNewCategory({ name: '', icon: 'Folder', keywords: '' });
    setIsAddingCategory(false);
  };

  const handleUpdateCategory = (categoryId: string) => {
    if (!newCategory.name.trim()) {
      alert(language === 'zh' ? '请输入分类名称' : 'Please enter category name');
      return;
    }

    updateCustomCategory(categoryId, {
      name: newCategory.name.trim(),
      icon: newCategory.icon,
      keywords: newCategory.keywords.split(',').map(k => k.trim()).filter(k => k)
    });

    setNewCategory({ name: '', icon: 'Folder', keywords: '' });
    setEditingCategoryId(null);
  };

  const handleEditCategory = (category: Category) => {
    setNewCategory({
      name: category.name,
      icon: category.icon,
      keywords: category.keywords.join(', ')
    });
    setEditingCategoryId(category.id);
  };

  const handleStartRename = (category: Category) => {
    setRenameValue(category.name);
    setRenamingCategoryId(category.id);
  };

  const handleSaveRename = (categoryId: string) => {
    if (!renameValue.trim()) {
      alert(language === 'zh' ? '请输入分类名称' : 'Please enter category name');
      return;
    }

    const category = allCategories.find(cat => cat.id === categoryId);
    if (category) {
      if (category.isCustom) {
        // Update custom category
        updateCustomCategory(categoryId, { name: renameValue.trim() });
      } else {
        // Convert default category to custom category with new name
        const newCustomCategory: Category = {
          id: Date.now().toString(),
          name: renameValue.trim(),
          icon: category.icon,
          keywords: category.keywords,
          isCustom: true
        };
        addCustomCategory(newCustomCategory);
      }
    }

    setRenameValue('');
    setRenamingCategoryId(null);
  };

  const handleCancelRename = () => {
    setRenameValue('');
    setRenamingCategoryId(null);
  };

  const handleDeleteCategory = (categoryId: string) => {
    const category = allCategories.find(cat => cat.id === categoryId);
    if (!category) return;

    const count = getCategoryCount(category);
    if (count > 0) {
      alert(language === 'zh' 
        ? `无法删除分类"${category.name}"，因为其中还有 ${count} 个仓库。`
        : `Cannot delete category "${category.name}" because it contains ${count} repositories.`
      );
      return;
    }

    const confirmMessage = language === 'zh'
      ? `确定要删除分类"${category.name}"吗？`
      : `Are you sure you want to delete category "${category.name}"?`;
    
    if (confirm(confirmMessage)) {
      if (category.isCustom) {
        deleteCustomCategory(categoryId);
      } else {
        // For default categories, we can't actually delete them, but we can hide them
        // by creating a "deleted" marker in custom categories
        // For now, we'll just show a message that default categories can't be deleted
        alert(language === 'zh'
          ? '默认分类无法删除，但可以重命名。'
          : 'Default categories cannot be deleted, but can be renamed.'
        );
      }
    }
  };

  const handleCancelEdit = () => {
    setNewCategory({ name: '', icon: 'Folder', keywords: '' });
    setIsAddingCategory(false);
    setEditingCategoryId(null);
  };

  const canDeleteCategory = (category: Category) => {
    const count = getCategoryCount(category);
    return count === 0 && category.id !== 'all'; // Can't delete "All Categories"
  };

  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

  return (
    <div className="w-64 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 h-fit sticky top-24">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          {t('应用分类', 'Categories')}
        </h3>
        <button
          onClick={() => setIsAddingCategory(true)}
          className="p-1.5 rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors"
          title={t('添加分类', 'Add Category')}
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Add/Edit Category Form */}
      {(isAddingCategory || editingCategoryId) && (
        <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600">
          <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
            {editingCategoryId ? t('编辑分类', 'Edit Category') : t('添加分类', 'Add Category')}
          </h4>
          
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('名称', 'Name')}
              </label>
              <input
                type="text"
                value={newCategory.name}
                onChange={(e) => setNewCategory(prev => ({ ...prev, name: e.target.value }))}
                className="w-full px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm"
                placeholder={t('分类名称', 'Category name')}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('图标', 'Icon')}
              </label>
              <select
                value={newCategory.icon}
                onChange={(e) => setNewCategory(prev => ({ ...prev, icon: e.target.value }))}
                className="w-full px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm"
              >
                {Object.keys(iconMap).map(iconName => (
                  <option key={iconName} value={iconName}>{iconName}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('关键词', 'Keywords')}
              </label>
              <input
                type="text"
                value={newCategory.keywords}
                onChange={(e) => setNewCategory(prev => ({ ...prev, keywords: e.target.value }))}
                className="w-full px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm"
                placeholder={t('用逗号分隔', 'Comma separated')}
              />
            </div>

            <div className="flex space-x-2">
              <button
                onClick={() => editingCategoryId ? handleUpdateCategory(editingCategoryId) : handleSaveCategory()}
                className="flex items-center space-x-1 px-2 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700 transition-colors"
              >
                <Save className="w-3 h-3" />
                <span>{t('保存', 'Save')}</span>
              </button>
              <button
                onClick={handleCancelEdit}
                className="flex items-center space-x-1 px-2 py-1 bg-gray-500 text-white rounded text-xs hover:bg-gray-600 transition-colors"
              >
                <X className="w-3 h-3" />
                <span>{t('取消', 'Cancel')}</span>
              </button>
            </div>
          </div>
        </div>
      )}
      
      <div className="space-y-1">
        {allCategories.map(category => {
          const count = getCategoryCount(category);
          const Icon = iconMap[category.icon] || Folder;
          const isSelected = selectedCategory === category.id;
          const isRenaming = renamingCategoryId === category.id;
          const canDelete = canDeleteCategory(category);
          
          return (
            <div key={category.id} className="group">
              {isRenaming ? (
                // Rename mode
                <div className="flex items-center space-x-2 px-3 py-2.5">
                  <Icon className="w-4 h-4 flex-shrink-0 text-gray-500" />
                  <input
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        handleSaveRename(category.id);
                      } else if (e.key === 'Escape') {
                        handleCancelRename();
                      }
                    }}
                    className="flex-1 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm"
                    autoFocus
                  />
                  <button
                    onClick={() => handleSaveRename(category.id)}
                    className="p-1 rounded text-green-600 hover:bg-green-100 dark:hover:bg-green-900"
                    title={t('保存', 'Save')}
                  >
                    <Save className="w-3 h-3" />
                  </button>
                  <button
                    onClick={handleCancelRename}
                    className="p-1 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                    title={t('取消', 'Cancel')}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                // Normal mode
                <button
                  onClick={() => onCategorySelect(category.id)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-left transition-colors ${
                    isSelected
                      ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  <div className="flex items-center space-x-3 min-w-0 flex-1">
                    <Icon className="w-4 h-4 flex-shrink-0" />
                    <span className="text-sm font-medium truncate">{category.name}</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      isSelected
                        ? 'bg-blue-200 text-blue-800 dark:bg-blue-800 dark:text-blue-200'
                        : 'bg-gray-200 text-gray-600 dark:bg-gray-600 dark:text-gray-400'
                    }`}>
                      {count}
                    </span>
                    {/* Show action buttons on hover for all categories except "All Categories" */}
                    {category.id !== 'all' && (
                      <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleStartRename(category);
                          }}
                          className="p-1 rounded text-gray-500 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400"
                          title={t('重命名', 'Rename')}
                        >
                          <Edit3 className="w-3 h-3" />
                        </button>
                        {category.isCustom && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEditCategory(category);
                            }}
                            className="p-1 rounded text-gray-500 hover:text-orange-600 dark:text-gray-400 dark:hover:text-orange-400"
                            title={t('编辑', 'Edit')}
                          >
                            <Wrench className="w-3 h-3" />
                          </button>
                        )}
                        {canDelete && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteCategory(category.id);
                            }}
                            className="p-1 rounded text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400"
                            title={t('删除', 'Delete')}
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};