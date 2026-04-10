import React, { useMemo, useState } from 'react';
import {
  Plus,
  Edit3,
  Trash2,
  EyeOff,
} from 'lucide-react';
import { Category, Repository } from '../types';
import { useAppStore, getAllCategories } from '../store/useAppStore';
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
    deleteCustomCategory,
    hideDefaultCategory,
    language,
    updateRepository,
  } = useAppStore();

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [dragOverCategoryId, setDragOverCategoryId] = useState<string | null>(null);

  const allCategories = getAllCategories(customCategories, language, hiddenDefaultCategoryIds);
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
        `确定删除自定义分类“${category.name}”吗？\n\n仓库会保留，Star 不会取消，只会清空它们的手动分类归属。`,
        `Delete custom category "${category.name}"?\n\nRepositories will stay starred. Only their manual category assignment will be cleared.`
      )
    );

    if (!confirmed) return;

    deleteCustomCategory(category.id);
    await forceSyncToBackend();
  };

  const handleHideDefaultCategory = async (category: Category) => {
    const confirmed = confirm(
      t(
        `隐藏默认分类“${category.name}”？\n\n这不会删除任何仓库，只是在左侧隐藏这个预设分类。`,
        `Hide default category "${category.name}"?\n\nThis will not delete any repositories. It only hides this built-in category from the sidebar.`
      )
    );

    if (!confirmed) return;

    hideDefaultCategory(category.id);
    await forceSyncToBackend();
  };

  const handleCloseModal = () => {
    setEditModalOpen(false);
    setEditingCategory(null);
    setIsCreatingCategory(false);
  };

  const handleDropOnCategory = async (event: React.DragEvent<HTMLButtonElement>, category: Category) => {
    event.preventDefault();
    setDragOverCategoryId(null);

    if (category.id === 'all') return;

    const repoId = event.dataTransfer.getData('application/x-gsm-repository-id');
    const repository = repositoryMap.get(repoId);
    if (!repository) return;

    const nextRepo = {
      ...repository,
      custom_category: category.name,
      category_locked: true,
      last_edited: new Date().toISOString(),
    };

    updateRepository(nextRepo);
    await forceSyncToBackend();
  };

  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

  return (
    <>
      <div className="w-full lg:w-64 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3 sm:p-4 lg:max-h-[calc(100vh-8rem)] lg:sticky lg:top-24 overflow-hidden lg:overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {t('应用分类', 'Categories')}
          </h3>
          <button
            onClick={handleAddCategory}
            className="p-1.5 rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors"
            title={t('添加分类', 'Add Category')}
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1 lg:block lg:space-y-1 lg:overflow-visible">
          {allCategories.map(category => {
            const count = getCategoryCount(category);
            const isSelected = selectedCategory === category.id;
            const isDragTarget = dragOverCategoryId === category.id;

            return (
              <div key={category.id} className="group shrink-0 lg:shrink">
                <button
                  onClick={() => onCategorySelect(category.id)}
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
                  className={`flex min-w-[140px] items-center justify-between px-3 py-2.5 rounded-lg text-left transition-colors lg:w-full ${
                    isSelected
                      ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                      : isDragTarget
                        ? 'bg-green-100 text-green-700 ring-2 ring-green-400 dark:bg-green-900 dark:text-green-300'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                  title={category.id !== 'all' ? t('可将仓库卡片拖到这里快速改分类', 'Drag repository cards here to quickly change category') : undefined}
                >
                  <div className="flex items-center space-x-3 min-w-0 flex-1">
                    <span className="text-base flex-shrink-0">{category.icon}</span>
                    <span className="text-sm font-medium truncate">{category.name}</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <div className={`relative text-xs px-2 py-1 rounded-full ${
                      isSelected
                        ? 'bg-blue-200 text-blue-800 dark:bg-blue-800 dark:text-blue-200'
                        : isDragTarget
                          ? 'bg-green-200 text-green-800 dark:bg-green-800 dark:text-green-200'
                          : 'bg-gray-200 text-gray-600 dark:bg-gray-600 dark:text-gray-400'
                    }`}>
                      <span>{count}</span>
                    </div>

                    {category.id !== 'all' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEditCategory(category);
                        }}
                        className="p-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-gray-200 dark:hover:bg-gray-600"
                        title={t('编辑分类', 'Edit category')}
                      >
                        <Edit3 className="w-3 h-3" />
                      </button>
                    )}

                    {category.id !== 'all' && category.isCustom && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDeleteCategory(category);
                        }}
                        className="p-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity text-red-500 hover:bg-red-100 dark:hover:bg-red-900/40"
                        title={t('删除分类', 'Delete category')}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}

                    {category.id !== 'all' && !category.isCustom && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleHideDefaultCategory(category);
                        }}
                        className="p-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-600"
                        title={t('隐藏默认分类', 'Hide default category')}
                      >
                        <EyeOff className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <CategoryEditModal
        isOpen={editModalOpen}
        onClose={handleCloseModal}
        category={editingCategory}
        isCreating={isCreatingCategory}
      />
    </>
  );
};
