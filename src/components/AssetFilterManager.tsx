import React, { useState } from 'react';
import { Plus, Edit3, Trash2, Filter } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { FilterModal } from './FilterModal';
import { AssetFilter } from '../types';

interface AssetFilterManagerProps {
  selectedFilters: string[];
  onFilterToggle: (filterId: string) => void;
  onClearFilters: () => void;
}

export const AssetFilterManager: React.FC<AssetFilterManagerProps> = ({
  selectedFilters,
  onFilterToggle,
  onClearFilters
}) => {
  const { assetFilters, addAssetFilter, updateAssetFilter, deleteAssetFilter, language } = useAppStore();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingFilter, setEditingFilter] = useState<AssetFilter | undefined>();

  const handleCreateFilter = () => {
    setEditingFilter(undefined);
    setIsModalOpen(true);
  };

  const handleEditFilter = (filter: AssetFilter) => {
    setEditingFilter(filter);
    setIsModalOpen(true);
  };

  const handleDeleteFilter = (filterId: string) => {
    if (confirm(language === 'zh' ? '确定要删除这个过滤器吗？' : 'Are you sure you want to delete this filter?')) {
      deleteAssetFilter(filterId);
      // Remove from selected filters if it was selected
      if (selectedFilters.includes(filterId)) {
        onFilterToggle(filterId);
      }
    }
  };

  const handleSaveFilter = (filter: AssetFilter) => {
    if (editingFilter) {
      updateAssetFilter(filter.id, filter);
    } else {
      addAssetFilter(filter);
    }
  };

  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Filter className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white">
            {t('自定义过滤器', 'Custom Filters')}
          </h3>
        </div>
        <button
          onClick={handleCreateFilter}
          className="flex items-center space-x-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
        >
          <Plus className="w-4 h-4" />
          <span>{t('新建过滤器', 'New Filter')}</span>
        </button>
      </div>

      {/* Filters List */}
      {assetFilters.length > 0 ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {assetFilters.map(filter => (
              <div
                key={filter.id}
                className={`group flex items-center space-x-2 px-3 py-2 rounded-lg border transition-colors ${
                  selectedFilters.includes(filter.id)
                    ? 'bg-blue-100 border-blue-300 text-blue-700 dark:bg-blue-900 dark:border-blue-700 dark:text-blue-300'
                    : 'bg-gray-100 border-gray-300 text-gray-700 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                <button
                  onClick={() => onFilterToggle(filter.id)}
                  className="flex items-center space-x-2 flex-1"
                >
                  <span className="font-medium">{filter.name}</span>
                  <span className="text-xs opacity-75">
                    ({filter.keywords.join(', ')})
                  </span>
                </button>
                
                <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => handleEditFilter(filter)}
                    className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                    title={t('编辑', 'Edit')}
                  >
                    <Edit3 className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => handleDeleteFilter(filter.id)}
                    className="p-1 rounded hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900 dark:hover:text-red-400 transition-colors"
                    title={t('删除', 'Delete')}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {selectedFilters.length > 0 && (
            <div className="flex items-center justify-between pt-2 border-t border-gray-200 dark:border-gray-700">
              <span className="text-sm text-gray-600 dark:text-gray-400">
                {t(`已选择 ${selectedFilters.length} 个过滤器`, `${selectedFilters.length} filters selected`)}
              </span>
              <button
                onClick={onClearFilters}
                className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
              >
                {t('清除选择', 'Clear Selection')}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-8 bg-gray-50 dark:bg-gray-800 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600">
          <Filter className="w-12 h-12 text-gray-400 dark:text-gray-600 mx-auto mb-3" />
          <h4 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            {t('暂无自定义过滤器', 'No Custom Filters')}
          </h4>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            {t('创建过滤器来快速筛选特定类型的文件', 'Create filters to quickly find specific types of files')}
          </p>
          <button
            onClick={handleCreateFilter}
            className="inline-flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>{t('创建第一个过滤器', 'Create First Filter')}</span>
          </button>
        </div>
      )}

      {/* Filter Modal */}
      <FilterModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        filter={editingFilter}
        onSave={handleSaveFilter}
      />
    </div>
  );
};