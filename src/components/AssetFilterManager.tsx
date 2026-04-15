import React, { useState, useMemo } from 'react';
import { Plus, Edit3, Trash2, Filter, ChevronDown, ChevronUp, X, Monitor, Apple, Smartphone, Package, Terminal, RotateCcw } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { FilterModal } from './FilterModal';
import { AssetFilter } from '../types';
import { PRESET_FILTERS } from '../constants/presetFilters';

// 图标映射
const ICON_MAP: Record<string, React.ElementType> = {
  Monitor,
  Apple,
  Smartphone,
  Package,
  Terminal,
};

// 图标名称映射（基于 PRESET_FILTERS 的 id）
const PRESET_ICON_MAP: Record<string, string> = {
  'preset-windows': 'Monitor',
  'preset-macos': 'Apple',
  'preset-linux': 'Terminal',
  'preset-android': 'Smartphone',
  'preset-source': 'Package',
};

// 默认预设筛选器（用于重置）
const DEFAULT_PRESET_FILTERS: AssetFilter[] = PRESET_FILTERS.map(pf => ({
  ...pf,
  isPreset: true,
  icon: PRESET_ICON_MAP[pf.id],
}));

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
  const [isExpanded, setIsExpanded] = useState(false);

  // 归一化 assetFilters：匹配预设标识的项设为 isPreset=true
  const normalizedFilters = useMemo(() => assetFilters.map(f => {
    const isPresetId = PRESET_ICON_MAP[f.id] !== undefined;
    if (isPresetId && !f.isPreset) {
      return { ...f, isPreset: true };
    }
    return f;
  }), [assetFilters]);

  // 分离预设筛选器和自定义筛选器
  const presetFilters = normalizedFilters.filter(f => f.isPreset);
  const customFilters = normalizedFilters.filter(f => !f.isPreset);

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

  const handlePresetToggle = (presetId: string) => {
    onFilterToggle(presetId);
  };

  const handleResetPresets = () => {
    if (confirm(language === 'zh' ? '确定要重置所有预设筛选器吗？这将恢复默认设置。' : 'Are you sure you want to reset all preset filters? This will restore default settings.')) {
      // 保存完整状态快照以便回滚（使用深拷贝确保状态独立）
      const previousFilters = assetFilters.map(f => ({ ...f }));
      const previousSelected = [...selectedFilters];
      const addedFilterIds: string[] = [];
      
      try {
        // 删除所有现有的预设筛选器
        presetFilters.forEach(filter => {
          if (assetFilters.find(f => f.id === filter.id)) {
            deleteAssetFilter(filter.id);
          }
          if (selectedFilters.includes(filter.id)) {
            onFilterToggle(filter.id);
          }
        });
        // 添加默认预设筛选器
        DEFAULT_PRESET_FILTERS.forEach(filter => {
          if (!assetFilters.find(f => f.id === filter.id)) {
            addAssetFilter(filter);
            addedFilterIds.push(filter.id);
          }
        });
      } catch (error) {
        // 回滚到之前的状态
        console.error('Failed to reset presets:', error);
        
        // 1. 移除新添加的筛选器
        addedFilterIds.forEach(id => {
          if (assetFilters.find(f => f.id === id)) {
            deleteAssetFilter(id);
          }
        });
        
        // 2. 恢复之前的筛选器（包括被删除的）
        previousFilters.forEach(filter => {
          if (!assetFilters.find(f => f.id === filter.id)) {
            addAssetFilter(filter);
          }
        });
        
        // 3. 完全恢复之前的选择状态（先清除所有，再恢复）
        // 清除当前所有选择
        [...selectedFilters].forEach(id => {
          onFilterToggle(id);
        });
        // 恢复之前的选择
        previousSelected.forEach(id => {
          onFilterToggle(id);
        });
        
        alert(language === 'zh' ? '重置预设筛选器失败，已恢复之前的状态。' : 'Failed to reset preset filters. Previous state has been restored.');
      }
    }
  };

  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

  return (
    <div className="space-y-3">
      {/* Compact Header with Toggle */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center space-x-2 px-3 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-all group"
          title={isExpanded ? t('收起过滤器', 'Collapse filters') : t('展开过滤器', 'Expand filters')}
          type="button"
          aria-expanded={isExpanded}
          aria-controls="asset-filter-panel"
        >
          <Filter className={`w-4 h-4 text-gray-600 dark:text-gray-400 transition-transform ${
            isExpanded ? 'text-blue-600 dark:text-blue-400' : ''
          }`} aria-hidden="true" />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('过滤器', 'Filters')}
          </span>
          {selectedFilters.length > 0 && (
            <span className="px-2 py-0.5 bg-blue-600 text-white text-xs rounded-full">
              {selectedFilters.length}
            </span>
          )}
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-gray-500" aria-hidden="true" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-500" aria-hidden="true" />
          )}
        </button>

        <div className="flex items-center space-x-2">
          {selectedFilters.length > 0 && (
            <button
              onClick={onClearFilters}
              className="flex items-center space-x-1 px-2 py-1.5 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              title={t('清除所有筛选', 'Clear all filters')}
              type="button"
              aria-label={t('清除所有筛选', 'Clear all filters')}
            >
              <X className="w-3 h-3" aria-hidden="true" />
              <span className="hidden sm:inline">{t('清除', 'Clear')}</span>
            </button>
          )}
          <button
            onClick={handleCreateFilter}
            className="flex items-center space-x-1 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
            title={t('新建过滤器', 'New Filter')}
            type="button"
            aria-label={t('新建过滤器', 'New Filter')}
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            <span className="hidden sm:inline">{t('新建', 'New')}</span>
          </button>
        </div>
      </div>

      {/* Expandable Content */}
      {isExpanded && (
        <div id="asset-filter-panel" className="animate-fade-in space-y-3">
          {/* Preset Filters */}
          {presetFilters.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t('预设筛选器', 'Preset Filters')}
                </p>
                <button
                  onClick={handleResetPresets}
                  className="flex items-center space-x-1 text-xs text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                  title={t('重置预设筛选器', 'Reset preset filters')}
                  type="button"
                  aria-label={t('重置预设筛选器', 'Reset preset filters')}
                >
                  <RotateCcw className="w-3 h-3" aria-hidden="true" />
                  <span>{t('重置', 'Reset')}</span>
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {presetFilters.map(preset => {
                  const Icon = preset.icon ? ICON_MAP[preset.icon] : Filter;
                  const isSelected = selectedFilters.includes(preset.id);
                  return (
                    <div
                      key={preset.id}
                      className={`group flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border text-xs transition-colors ${
                        isSelected
                          ? 'bg-indigo-100 border-indigo-300 text-indigo-700 dark:bg-indigo-900 dark:border-indigo-700 dark:text-indigo-300'
                          : 'bg-gray-50 border-gray-200 text-gray-600 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                      }`}
                    >
                      <button
                        onClick={() => handlePresetToggle(preset.id)}
                        className="flex items-center space-x-1.5"
                        title={preset.keywords.join(', ')}
                        type="button"
                        aria-pressed={isSelected}
                      >
                        {Icon && <Icon className="w-3.5 h-3.5" aria-hidden="true" />}
                        <span>{preset.name}</span>
                      </button>

                      <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity ml-1">
                        <button
                          onClick={() => handleEditFilter(preset)}
                          className="p-0.5 rounded hover:bg-indigo-200 dark:hover:bg-indigo-800 transition-colors"
                          title={t('编辑', 'Edit')}
                          type="button"
                          aria-label={t('编辑', 'Edit')}
                        >
                          <Edit3 className="w-3 h-3" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Custom Filters */}
          {customFilters.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                {t('自定义筛选器', 'Custom Filters')}
              </p>
              <div className="flex flex-wrap gap-2">
                {customFilters.map(filter => (
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
                      aria-pressed={selectedFilters.includes(filter.id)}
                      aria-label={`${filter.name} (${filter.keywords.join(', ')})`}
                      title={`${filter.name} (${filter.keywords.join(', ')})`}
                      type="button"
                    >
                      <span className="font-medium text-sm">{filter.name}</span>
                      <span className="text-xs opacity-75 hidden lg:inline">
                        ({filter.keywords.join(', ')})
                      </span>
                    </button>
                    
                    <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleEditFilter(filter)}
                        className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                        title={t('编辑', 'Edit')}
                        type="button"
                        aria-label={t('编辑', 'Edit')}
                      >
                        <Edit3 className="w-3 h-3" aria-hidden="true" />
                      </button>
                      <button
                        onClick={() => handleDeleteFilter(filter.id)}
                        className="p-1 rounded hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900 dark:hover:text-red-400 transition-colors"
                        title={t('删除', 'Delete')}
                        type="button"
                        aria-label={t('删除', 'Delete')}
                      >
                        <Trash2 className="w-3 h-3" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {presetFilters.length === 0 && customFilters.length === 0 && (
            <div className="text-center py-4 bg-gray-50 dark:bg-gray-800 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t('暂无过滤器，点击"新建"创建', 'No filters, click "New" to create')}
              </p>
            </div>
          )}

          {selectedFilters.length > 0 && (
            <div className="flex items-center justify-between pt-2 border-t border-gray-200 dark:border-gray-700">
              <span className="text-xs text-gray-600 dark:text-gray-400">
                {t(`已选择 ${selectedFilters.length} 个过滤器`, `${selectedFilters.length} filters selected`)}
              </span>
              <button
                onClick={onClearFilters}
                className="text-xs text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
                type="button"
                aria-label={t('清除选择', 'Clear Selection')}
              >
                {t('清除选择', 'Clear Selection')}
              </button>
            </div>
          )}
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