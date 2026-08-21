import React, { useState, useMemo } from 'react';
import { Plus, Edit3, Trash2, Filter, ChevronDown, ChevronUp, X, Monitor, Apple, Smartphone, Package, Terminal } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { FilterModal } from './FilterModal';
import { AssetFilter } from '../types';
import { useDialog } from '../hooks/useDialog';
import { Button } from './ui/button';

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

  const { confirm } = useDialog();

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

  const handleDeleteFilter = async (filterId: string) => {
    const confirmed = await confirm(
      t('删除过滤器', 'Delete Filter'),
      language === 'zh' ? '确定要删除这个过滤器吗？' : 'Are you sure you want to delete this filter?',
      { type: 'danger', confirmText: t('删除', 'Delete') }
    );

    if (!confirmed) return;

    deleteAssetFilter(filterId);
    if (selectedFilters.includes(filterId)) {
      onFilterToggle(filterId);
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

  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

  return (
    <div className="space-y-3">
      {/* Compact Header with Toggle */}
      <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center space-x-2 px-3 py-2 bg-muted dark:bg-muted/40 rounded-lg hover:bg-accent dark:hover:bg-accent transition-all group"
          title={isExpanded ? t('收起过滤器', 'Collapse filters') : t('展开过滤器', 'Expand filters')}
          aria-expanded={isExpanded}
          aria-controls="asset-filter-panel"
        >
          <Filter className={`w-4 h-4 text-muted-foreground dark:text-muted-foreground transition-transform ${
            isExpanded ? 'text-primary dark:text-primary' : ''
          }`} aria-hidden="true" />
          <span className="text-sm font-medium text-foreground dark:text-muted-foreground">
            {t('过滤器', 'Filters')}
          </span>
          {selectedFilters.length > 0 && (
            <span className="px-2 py-0.5 bg-primary text-primary-foreground text-xs rounded-full">
              {selectedFilters.length}
            </span>
          )}
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground dark:text-muted-foreground" aria-hidden="true" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground dark:text-muted-foreground" aria-hidden="true" />
          )}
        </Button>

        <div className="flex items-center space-x-2">
          {selectedFilters.length > 0 && (
            <Button
              variant="ghost"
              onClick={onClearFilters}
              className="flex items-center space-x-1 px-2 py-1.5 text-xs text-muted-foreground dark:text-muted-foreground hover:bg-muted dark:hover:bg-accent rounded-lg transition-colors"
              title={t('清除所有筛选', 'Clear all filters')}
              type="button"
              aria-label={t('清除所有筛选', 'Clear all filters')}
            >
              <X className="w-3 h-3" aria-hidden="true" />
              <span className="hidden sm:inline">{t('清除所有筛选', 'Clear all filters')}</span>
            </Button>
          )}
          <Button
            onClick={handleCreateFilter}
            className="flex items-center space-x-1 px-3 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors text-sm"
            title={t('新建过滤器', 'New Filter')}
            type="button"
            aria-label={t('新建过滤器', 'New Filter')}
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            <span className="hidden sm:inline">{t('新建', 'New')}</span>
          </Button>
        </div>
      </div>

      {/* Expandable Content */}
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-in-out"
        style={{ gridTemplateRows: isExpanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden min-h-0">
          <div id="asset-filter-panel" className="space-y-3">
          {/* Preset Filters */}
          {presetFilters.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground dark:text-muted-foreground mb-2">
                {t('预设筛选器', 'Preset Filters')}
              </p>
              <div className="flex flex-wrap gap-2">
                {presetFilters.map(preset => {
                  const Icon = preset.icon ? ICON_MAP[preset.icon] : Filter;
                  const isSelected = selectedFilters.includes(preset.id);
                  return (
                    <div
                      key={preset.id}
                      className={`group flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border text-xs transition-colors ${
                        isSelected
                          ? 'bg-gray-900 border-transparent text-white dark:bg-white/[0.12] dark:border-white/[0.2] dark:text-white font-medium'
                          : 'bg-white border-border text-muted-foreground dark:bg-muted/40 dark:border-border dark:text-muted-foreground hover:bg-accent hover:text-foreground dark:hover:bg-accent dark:hover:text-foreground'
                      }`}
                    >
                      <Button
                        variant="ghost"
                        onClick={() => handlePresetToggle(preset.id)}
                        className="flex items-center space-x-1.5"
                        title={preset.keywords.join(', ')}
                        type="button"
                        aria-pressed={isSelected}
                      >
                        {Icon && <Icon className="w-3.5 h-3.5" aria-hidden="true" />}
                        <span>{preset.name}</span>
                      </Button>

                      <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity ml-1">
                        <Button
                          variant="ghost"
                          onClick={() => handleEditFilter(preset)}
                          className="p-0.5 rounded hover:bg-white/20 dark:hover:bg-accent transition-colors"
                          title={t('编辑', 'Edit')}
                          type="button"
                          aria-label={t('编辑', 'Edit')}
                        >
                          <Edit3 className="w-3 h-3" aria-hidden="true" />
                        </Button>
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
              <p className="text-xs text-muted-foreground dark:text-muted-foreground mb-2">
                {t('自定义筛选器', 'Custom Filters')}
              </p>
              <div className="flex flex-wrap gap-2">
                {customFilters.map(filter => (
                  <div
                    key={filter.id}
                    className={`group flex items-center space-x-2 px-3 py-2 rounded-lg border transition-colors ${
                      selectedFilters.includes(filter.id)
                        ? 'bg-gray-900 border-transparent text-white dark:bg-white/[0.12] dark:border-white/[0.2] dark:text-white font-medium'
                        : 'bg-muted border-border text-foreground dark:bg-muted/40 dark:border-border dark:text-muted-foreground hover:bg-accent dark:hover:bg-accent'
                    }`}
                  >
                    <Button
                      variant="ghost"
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
                    </Button>
                    
                    <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        onClick={() => handleEditFilter(filter)}
                        className="p-1 rounded hover:bg-accent dark:hover:bg-accent transition-colors"
                        title={t('编辑', 'Edit')}
                        type="button"
                        aria-label={t('编辑', 'Edit')}
                      >
                        <Edit3 className="w-3 h-3" aria-hidden="true" />
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={() => handleDeleteFilter(filter.id)}
                        className="p-1 rounded transition-colors"
                        title={t('删除', 'Delete')}
                        type="button"
                        aria-label={t('删除', 'Delete')}
                      >
                        <Trash2 className="w-3 h-3" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {presetFilters.length === 0 && customFilters.length === 0 && (
            <div className="text-center py-4 bg-background dark:bg-card rounded-lg border-2 border-dashed border-border dark:border-border">
              <p className="text-xs text-muted-foreground dark:text-muted-foreground">
                {t('暂无过滤器，点击"新建"创建', 'No filters, click "New" to create')}
              </p>
            </div>
          )}

          </div>
        </div>
      </div>

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