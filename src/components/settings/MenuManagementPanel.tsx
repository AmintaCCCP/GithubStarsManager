
import { TranslateFn } from '../../i18n/useT';
import { Button } from '../ui/button';
import React, { useState, useRef, useCallback, useMemo } from 'react';
import {
  Layout,
  Search,
  FileCode2,
  Calendar,
  GitFork,
  Compass,
  Package,
  Settings,
  GripVertical,
  ChevronUp,
  ChevronDown,
  Info,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { Switch } from '../ui/switch';
import { HeaderMenuId } from '../../types';

interface MenuManagementPanelProps {
  t: TranslateFn;
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
  subscription: { icon: Compass, labelZh: '发现', labelEn: 'Discover', canHide: true },
  // 我的应用（开发守则 §3）：与其它功能视图一样允许隐藏
  apps: { icon: Package, labelZh: '我的应用', labelEn: 'My Apps', canHide: true },
  settings: { icon: Settings, labelZh: '设置', labelEn: 'Settings', canHide: false },
};

export const MenuManagementPanel: React.FC<MenuManagementPanelProps> = ({ t }) => {
  const { headerMenuConfig, setHeaderMenuConfig } = useAppStore(useShallow((state) => ({
    headerMenuConfig: state.headerMenuConfig,
    setHeaderMenuConfig: state.setHeaderMenuConfig,
  })));
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
        <Layout className="w-6 h-6 text-muted-foreground dark:text-muted-foreground" />
        <h3 className="text-lg font-semibold text-foreground dark:text-foreground">
          {t('menuManagementPanel.menu-management')}
        </h3>
      </div>

      {/* Info note */}
      <div className="flex items-start gap-3 rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>
          {t('menuManagementPanel.toggle-menu-visibility-and-drag-to-reorder-repos')}
        </p>
      </div>

      {/* Menu list */}
      <div className="p-6 bg-card dark:bg-card rounded-xl border border-border dark:border-border">
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
                    ? 'opacity-50 border-primary/30 bg-primary/5'
                    : isDragOver
                      ? 'border-primary/50 bg-primary/5 scale-[1.01]'
                      : 'border-border dark:border-border hover:bg-background dark:hover:bg-card/[0.03]'
                }`}
              >
                {/* Drag handle */}
                <GripVertical className="w-4 h-4 text-muted-foreground dark:text-muted-foreground flex-shrink-0" />

                {/* Menu icon + label + lock */}
                <Icon className="w-5 h-5 text-muted-foreground dark:text-muted-foreground flex-shrink-0" />
                <span className="flex-1 flex items-center gap-1.5 text-sm font-medium text-foreground dark:text-foreground">
                  <span>{t(`header.menu-${item.id}`)}</span>
                  {!meta.canHide && (
                    <span className="text-muted-foreground dark:text-muted-foreground flex-shrink-0" title={t('menuManagementPanel.always-visible')}>
                      <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                      </svg>
                    </span>
                  )}
                </span>

                {/* Order arrows */}
                <div className="flex flex-col flex-shrink-0">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => handleMoveUp(index)}
                    disabled={index === 0}
                    className="h-5 w-5 rounded p-0.5 hover:bg-accent dark:hover:bg-accent disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
                    title={t('menuManagementPanel.move-up')}
                    aria-label={t('menuManagementPanel.move-v1-up', { v1: meta.labelZh })}
                  >
                    <ChevronUp className="w-3.5 h-3.5 text-muted-foreground dark:text-muted-foreground" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => handleMoveDown(index)}
                    disabled={index === sortedConfig.length - 1}
                    className="h-5 w-5 rounded p-0.5 hover:bg-accent dark:hover:bg-accent disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
                    title={t('menuManagementPanel.move-down')}
                    aria-label={t('menuManagementPanel.move-v1-down', { v1: meta.labelZh })}
                  >
                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground dark:text-muted-foreground" />
                  </Button>
                </div>

                {/* Toggle switch */}
                <Switch
                  checked={item.visible}
                  onCheckedChange={() => handleToggle(item.id)}
                  disabled={!meta.canHide}
                  title={!meta.canHide ? t('menuManagementPanel.this-menu-cannot-be-hidden') : undefined}
                  aria-label={t('menuManagementPanel.toggle-v1-visibility', { v1: meta.labelZh })}
                  className="shrink-0"
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
