import React, { useState } from 'react';
import { Package, Plus, Trash2, Edit3, Save, X, Eye, EyeOff } from 'lucide-react';
import { useAppStore, getAllCategories } from '../../store/useAppStore';

interface CategoryPanelProps {
  t: (zh: string, en: string) => string;
}

export const CategoryPanel: React.FC<CategoryPanelProps> = ({ t }) => {
  const {
    customCategories,
    hiddenDefaultCategoryIds,
    language,
    addCustomCategory,
    deleteCustomCategory,
    hideDefaultCategory,
    showDefaultCategory,
  } = useAppStore();

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryIcon, setNewCategoryIcon] = useState('📁');
  const [editName, setEditName] = useState('');
  const [editIcon, setEditIcon] = useState('');

  const allDefaultCategories = getAllCategories([], language, []);
  const hiddenDefaultCategories = allDefaultCategories.filter(category => 
    hiddenDefaultCategoryIds.includes(category.id)
  );
  const visibleDefaultCategories = allDefaultCategories.filter(category => 
    !hiddenDefaultCategoryIds.includes(category.id)
  );

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

    const category = customCategories.find(c => c.id === editingId);
    if (category) {
      deleteCustomCategory(category.id);
      addCustomCategory({
        ...category,
        name: editName.trim(),
        icon: editIcon,
      });
    }

    setEditingId(null);
    setEditName('');
    setEditIcon('');
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
        <div>
          <h4 className="font-medium text-gray-900 dark:text-white mb-3 flex items-center">
            <Eye className="w-4 h-4 mr-2" />
            {t('自定义分类', 'Custom Categories')}
            <span className="ml-2 text-sm text-gray-500 dark:text-gray-400">
              ({customCategories.length})
            </span>
          </h4>
          {customCategories.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 py-4">
              {t('暂无自定义分类', 'No custom categories yet')}
            </p>
          ) : (
            <div className="space-y-2">
              {customCategories.map((category) => (
                <div
                  key={category.id}
                  className="flex items-center justify-between p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-600"
                >
                  {editingId === category.id ? (
                    <div className="flex-1 flex items-center space-x-3">
                      <input
                        type="text"
                        value={editIcon}
                        onChange={(e) => setEditIcon(e.target.value)}
                        className="w-16 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-center"
                        maxLength={2}
                      />
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="flex-1 px-3 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
                      />
                      <button
                        onClick={handleSaveEdit}
                        className="p-1.5 rounded bg-green-100 text-green-600 dark:bg-green-900 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-800"
                      >
                        <Save className="w-4 h-4" />
                      </button>
                      <button
                        onClick={handleCancelEdit}
                        className="p-1.5 rounded bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center space-x-3">
                        <span className="text-xl">{category.icon}</span>
                        <span className="font-medium text-gray-900 dark:text-white">
                          {category.name}
                        </span>
                      </div>
                      <div className="flex items-center space-x-1">
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
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
          <h4 className="font-medium text-gray-900 dark:text-white mb-3 flex items-center">
            <EyeOff className="w-4 h-4 mr-2" />
            {t('隐藏的默认分类', 'Hidden Default Categories')}
            <span className="ml-2 text-sm text-gray-500 dark:text-gray-400">
              ({hiddenDefaultCategories.length})
            </span>
          </h4>
          {hiddenDefaultCategories.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 py-4">
              {t('没有隐藏的默认分类', 'No hidden default categories')}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {hiddenDefaultCategories.map((category) => (
                <button
                  key={category.id}
                  onClick={() => showDefaultCategory(category.id)}
                  className="inline-flex items-center space-x-2 px-3 py-2 rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-800 transition-colors"
                >
                  <Eye className="w-4 h-4" />
                  <span>{category.icon}</span>
                  <span>{category.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
          <h4 className="font-medium text-gray-900 dark:text-white mb-3 flex items-center">
            <Eye className="w-4 h-4 mr-2" />
            {t('显示的默认分类', 'Visible Default Categories')}
            <span className="ml-2 text-sm text-gray-500 dark:text-gray-400">
              ({visibleDefaultCategories.length})
            </span>
          </h4>
          <div className="flex flex-wrap gap-2">
            {visibleDefaultCategories.map((category) => (
              <button
                key={category.id}
                onClick={() => hideDefaultCategory(category.id)}
                className="inline-flex items-center space-x-2 px-3 py-2 rounded-lg bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                <EyeOff className="w-4 h-4" />
                <span>{category.icon}</span>
                <span>{category.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
