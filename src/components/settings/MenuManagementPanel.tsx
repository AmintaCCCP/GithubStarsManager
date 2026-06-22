import React, { useState, useRef, useCallback, useMemo } from 'react';
import {
  Layout,
  Search,
  FileCode2,
  Calendar,
  GitFork,
  TrendingUp,
  Settings,
  GripVertical,
  ChevronUp,
  ChevronDown,
  Info,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { HeaderMenuId } from '../../types';

interface MenuManagementPanelProps {
  t: (zh: string, en: string) => string;
}

const MENU_META: Record<HeaderMenuId, {
  icon: React.ComponentType<{ className?: string }>;
  labelZh: string;
  labelEn: string;
  canHide: boolean;
}> = {
  repositories: { icon: Search, labelZh: '仓库', labelEn: 'Repositories', canHide: false },
  gists: { icon: FileCode2, labelZh: 'Gist', labelEn: 'Gist', canHide: true },
  releases: { icon: Calendar, labelZh: '发布', labelEn: 'Releases', canHide: true },
  forks: { icon: GitFork, labelZh: '复刻', labelEn: 'Forks', canHide: true },
  subscription: { icon: TrendingUp, labelZh: '趋势', labelEn: 'Trending', canHide: true },
  settings: { icon: Settings, labelZh: '设置', labelEn: 'Settings', canHide: false },
};

export const MenuManagementPanel: React.FC<MenuManagementPanelProps> = ({ t }) => {
  const { headerMenuConfig, setHeaderMenuConfig } = useAppStore();
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragNodeRef = useRef<HTMLDivElement | null>(null);

  const sortedConfig = useMemo(
    () => [...headerMenuConfig].sort((a, b) => a.order - b.order),
    [headerMenuConfig]
  );

  const handleToggle = useCallback((id: HeaderMenuId) => {
    const meta = MENU_META[id];
    if (!meta.canHide) return;
    const newConfig = headerMenuConfig.map(item =>
      item.id === id ? { ...item, visible: !item.visible } : item
    );
    setHeaderMenuConfig(newConfig);
  }, [headerMenuConfig, setHeaderMenuConfig]);

  const reorder = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    const reordered = [...sortedConfig];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    const newConfig = reordered.map((item, idx) => ({ ...item, order: idx }));
    setHeaderMenuConfig(newConfig);
  }, [sortedConfig, setHeaderMenuConfig]);

  const handleMoveUp = (index: number) => {
    if (index > 0) reorder(index, index - 1);
  };

  const handleMoveDown = (index: number) => {
    if (index < sortedConfig.length - 1) reorder(index, index + 1);
  };

  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    setDragIndex(index);
    dragNodeRef.current = e.currentTarget as HTMLDivElement;
    e.dataTransfer.effectAllowed = 'move';
    // Required for Firefox
    e.dataTransfer.setData('text/plain', String(index));
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    if (dragIndex !== null && dragIndex !== toIndex) {
      reorder(dragIndex, toIndex);
    }
    setDragIndex(null);
    setDragOverIndex(null);
    dragNodeRef.current = null;
  }, [dragIndex, reorder]);

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
    setDragOverIndex(null);
    dragNodeRef.current = null;
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-3">
        <Layout className="w-6 h-6 text-gray-700 dark:text-text-secondary" />
        <h3 className="text-lg font-semibold text-gray-900 dark:text-text-primary">
          {t('菜单管理', 'Menu Management')}
        </h3>
      </div>

      {/* Info note */}
      <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/30">
        <Info className="w-4 h-4 text-blue-500 dark:text-blue-400 mt-0.5 flex-shrink-0" />
        <p className="text-sm text-blue-700 dark:text-blue-300">
          {t(
            '通过开关控制顶栏菜单的显示与隐藏，拖拽或点击箭头调整顺序。「仓库」和「设置」为必显菜单，不可关闭。',
            'Toggle menu visibility and drag to reorder. "Repositories" and "Settings" are always visible and cannot be hidden.'
          )}
        </p>
      </div>

      {/* Menu list */}
      <div className="p-6 bg-white dark:bg-panel-dark rounded-xl border border-black/[0.06] dark:border-white/[0.04]">
        <div className="space-y-2">
          {sortedConfig.map((item, index) => {
            const meta = MENU_META[item.id];
            const Icon = meta.icon;
            const isDragging = dragIndex === index;
            const isDragOver = dragOverIndex === index;

            return (
              <div
                key={item.id}
                draggable
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDrop={(e) => handleDrop(e, index)}
                onDragEnd={handleDragEnd}
                className={`flex items-center gap-3 p-3 rounded-lg border transition-all cursor-grab active:cursor-grabbing select-none ${
                  isDragging
                    ? 'opacity-50 border-brand-violet/30 bg-brand-violet/5'
                    : isDragOver
                      ? 'border-brand-violet/50 bg-brand-violet/5 scale-[1.01]'
                      : 'border-black/[0.06] dark:border-white/[0.04] hover:bg-light-bg dark:hover:bg-white/[0.03]'
                }`}
              >
                {/* Drag handle */}
                <GripVertical className="w-4 h-4 text-gray-400 dark:text-text-tertiary flex-shrink-0" />

                {/* Menu icon + label + lock */}
                <Icon className="w-5 h-5 text-gray-600 dark:text-text-secondary flex-shrink-0" />
                <span className="flex-1 flex items-center gap-1.5 text-sm font-medium text-gray-900 dark:text-text-primary">
                  <span>{t(meta.labelZh, meta.labelEn)}</span>
                  {!meta.canHide && (
                    <span className="text-gray-400 dark:text-text-tertiary flex-shrink-0" title={t('必显', 'Always visible')}>
                      <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                      </svg>
                    </span>
                  )}
                </span>

                {/* Order arrows */}
                <div className="flex flex-col flex-shrink-0">
                  <button
                    onClick={() => handleMoveUp(index)}
                    disabled={index === 0}
                    className="p-0.5 rounded hover:bg-gray-100 dark:hover:bg-white/10 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
                    title={t('上移', 'Move up')}
                  >
                    <ChevronUp className="w-3.5 h-3.5 text-gray-500 dark:text-text-tertiary" />
                  </button>
                  <button
                    onClick={() => handleMoveDown(index)}
                    disabled={index === sortedConfig.length - 1}
                    className="p-0.5 rounded hover:bg-gray-100 dark:hover:bg-white/10 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
                    title={t('下移', 'Move down')}
                  >
                    <ChevronDown className="w-3.5 h-3.5 text-gray-500 dark:text-text-tertiary" />
                  </button>
                </div>

                {/* Toggle switch */}
                <button
                  onClick={() => handleToggle(item.id)}
                  disabled={!meta.canHide}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-brand-violet focus:ring-offset-2 dark:focus:ring-offset-gray-800 ${
                    !meta.canHide
                      ? 'bg-brand-violet cursor-not-allowed opacity-75'
                      : item.visible
                        ? 'bg-brand-violet'
                        : 'bg-gray-200 dark:bg-white/10'
                  }`}
                  title={!meta.canHide ? t('此菜单不可关闭', 'This menu cannot be hidden') : undefined}
                  role="switch"
                  aria-checked={item.visible}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      item.visible ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
