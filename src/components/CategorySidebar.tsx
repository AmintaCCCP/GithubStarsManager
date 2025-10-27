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
  Edit3
} from 'lucide-react';
import { Repository, Category } from '../types';
import { useAppStore, getAllCategories } from '../store/useAppStore';
import { CategoryEditModal } from './CategoryEditModal';

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
    deleteCustomCategory,
    language
  } = useAppStore();

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);

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

  const handleCloseModal = () => {
    setEditModalOpen(false);
    setEditingCategory(null);
    setIsCreatingCategory(false);
  };

  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

  return (
    <>
      <div className="w-64 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 max-h-[calc(100vh-8rem)] sticky top-24 overflow-y-auto">
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
        
        <div className="space-y-1">
          {allCategories.map(category => {
            const count = getCategoryCount(category);
            const isSelected = selectedCategory === category.id;
            
            return (
              <div key={category.id} className="group">
                <button
                  onClick={() => onCategorySelect(category.id)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-left transition-colors ${
                    isSelected
                      ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  <div className="flex items-center space-x-3 min-w-0 flex-1">
                    <span className="text-base flex-shrink-0">{category.icon}</span>
                    <span className="text-sm font-medium truncate">{category.name}</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <div className={`relative text-xs px-2 py-1 rounded-full ${
                      isSelected
                        ? 'bg-blue-200 text-blue-800 dark:bg-blue-800 dark:text-blue-200'
                        : 'bg-gray-200 text-gray-600 dark:bg-gray-600 dark:text-gray-400'
                    }`}>
                      {/* Count badge - shown by default */}
                      <span className="group-hover:opacity-0 transition-opacity duration-200">
                        {count}
                      </span>
                      
                      {/* Edit button - shown on hover, only for non-"All Categories" */}
                      {category.id !== 'all' && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEditCategory(category);
                          }}
                          className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 hover:bg-black hover:bg-opacity-10 rounded-full"
                          title={t('编辑分类', 'Edit category')}
                        >
                          <Edit3 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    </div>
                </button>
              </div>
            );
          })}
        </div>
      </div>
      
      {/* Category Edit Modal */}
      <CategoryEditModal
        isOpen={editModalOpen}
        onClose={handleCloseModal}
        category={editingCategory}
        isCreating={isCreatingCategory}
      />
    </>
  );
};