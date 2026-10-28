



import { useT } from '../i18n/useT';
import React, { useState, useMemo } from 'react';
import { Plus, PencilLine, Trash2, Filter, X, Package } from 'lucide-react';
import { SiAndroid, SiApple, SiLinux } from '@icons-pack/react-simple-icons';
import { SiWindows } from './SiWindows';
import { useAppStore } from '../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { FilterModal } from './FilterModal';
import { AssetFilter } from '../types';
import { useDialog } from '../hooks/useDialog';
import { Button } from './ui/button';

// 图标映射。
// 存量数据里持久化的是 lucide 图标名（见 store/schema.ts PRESET_FILTER_ICONS），
// 渲染时按名 remap 到 Simple Icons 品牌字形；'Package'（源码预设）沿用 lucide。
const ICON_MAP: Record<string, React.ElementType> = {
  Monitor: SiWindows,
  Apple: SiApple,
  Smartphone: SiAndroid,
  Terminal: SiLinux,
  Package,
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
  const { assetFilters, addAssetFilter, updateAssetFilter, deleteAssetFilter } = useAppStore(useShallow((state) => ({
    assetFilters: state.assetFilters,
    addAssetFilter: state.addAssetFilter,
    updateAssetFilter: state.updateAssetFilter,
    deleteAssetFilter: state.deleteAssetFilter,
    language: state.language,
  })));

  const { confirm } = useDialog();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingFilter, setEditingFilter] = useState<AssetFilter | undefined>();

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
      t('assetFilterManager.delete-filter'),
      t('assetFilterManager.are-you-sure-you-want-to-delete-this-filter'),
      { type: 'danger', confirmText: t('assetFilterManager.delete') }
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

  const t = useT('app');

  return (
    <div className="app-side-filter-manager">
      <div className="app-collection-row">
        <div className="flex min-w-0 items-center gap-2">
          <p className="app-section-label">{t('assetFilterManager.filters')}</p>
          {selectedFilters.length > 0 && (
            <span className="app-side-count">{selectedFilters.length}</span>
          )}
        </div>
        <div className="app-side-filter-toolbar">
          {selectedFilters.length > 0 && (
            <Button
              variant="ghost"
              onClick={onClearFilters}
              className="linear-icon-button app-side-action-button"
              title={t('assetFilterManager.clear-all-filters')}
              type="button"
              aria-label={t('assetFilterManager.clear-all-filters')}
            >
              <X aria-hidden="true" />
            </Button>
          )}
          <Button
            onClick={handleCreateFilter}
            variant="ghost"
            className="linear-icon-button app-side-action-button"
            title={t('assetFilterManager.new-filter')}
            type="button"
            aria-label={t('assetFilterManager.new-filter')}
          >
            <Plus aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div id="asset-filter-panel" className="app-side-list app-side-filter-list">
        {[...presetFilters, ...customFilters].map((filter) => {
          const Icon = filter.icon ? ICON_MAP[filter.icon] : Filter;
          const isSelected = selectedFilters.includes(filter.id);
          return (
            <div key={filter.id} className="app-side-filter-row">
              <Button
                variant="ghost"
                onClick={() => onFilterToggle(filter.id)}
                className="app-side-item justify-between"
                title={filter.keywords.join(', ')}
                type="button"
                aria-pressed={isSelected}
              >
                <span className="app-side-item-label">
                  {Icon && <Icon aria-hidden="true" />}
                  <span className="truncate">{filter.name}</span>
                </span>
              </Button>
              <div className="app-side-row-actions">
                <Button
                  variant="ghost"
                  onClick={() => handleEditFilter(filter)}
                  className="linear-icon-button app-side-action-button"
                  title={t('assetFilterManager.edit')}
                  type="button"
                  aria-label={`${t('assetFilterManager.edit')} ${filter.name}`}
                >
                  <PencilLine aria-hidden="true" />
                </Button>
                {!filter.isPreset && (
                  <Button
                    variant="ghost"
                    onClick={() => void handleDeleteFilter(filter.id)}
                    className="linear-icon-button app-side-action-button text-destructive"
                    title={t('assetFilterManager.delete')}
                    type="button"
                    aria-label={`${t('assetFilterManager.delete')} ${filter.name}`}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                )}
              </div>
            </div>
          );
        })}

        {presetFilters.length === 0 && customFilters.length === 0 && (
          <p className="app-side-empty">
            {t('assetFilterManager.no-filters-click-new-to-create')}
          </p>
        )}
      </div>

      <p className="app-side-filter-note">{t('assetFilterManager.filter-scope-note')}</p>

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
