import { TranslateFn } from '../../i18n/useT';
import { Button } from '../ui/button';
import React, { useState, useRef, useCallback, useMemo } from 'react';
import {
  Search,
  FileCode2,
  Calendar,
  GitFork,
  Compass,
  Settings,
  GripVertical,
  ChevronUp,
  ChevronDown,
  Info,
  Lock,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { Switch } from '../ui/switch';
import { HeaderMenuId } from '../../types';
import { cn } from '../../lib/utils';
import {
  SettingsCard,
  SettingsDivider,
  SettingsNotice,
  SettingsPageStack,
  SettingsSection,
} from './SettingsPrimitives';

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
    [headerMenuConfig],
  );

  const handleToggle = useCallback((id: HeaderMenuId) => {
    const meta = MENU_META[id];
    if (!meta.canHide) return;
    const newConfig = headerMenuConfig.map((item) =>
      item.id === id ? { ...item, visible: !item.visible } : item,
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
    <SettingsPageStack>
      <SettingsNotice tone="neutral" icon={<Info />}>
        {t('menuManagementPanel.toggle-menu-visibility-and-drag-to-reorder-repos')}
      </SettingsNotice>

      <SettingsSection title={t('menuManagementPanel.menu-management')}>
        <SettingsCard>
          {sortedConfig.map((item, index) => {
            const meta = MENU_META[item.id];
            const Icon = meta.icon;
            const isDragging = dragIndex === index;
            const isDragOver = dragOverIndex === index;

            return (
              <React.Fragment key={item.id}>
                {index > 0 && <SettingsDivider />}
                <div
                  draggable
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDrop={(e) => handleDrop(e, index)}
                  onDragEnd={handleDragEnd}
                  className={cn(
                    'flex min-h-12 cursor-grab items-center gap-3 px-3.5 py-2 select-none transition-[background-color,opacity] duration-micro ease-out-subtle hover:bg-fill-hover hover:duration-instant active:cursor-grabbing',
                    isDragging && 'bg-fill-selected opacity-50',
                    isDragOver && !isDragging && 'bg-accent-tint',
                  )}
                >
                  <GripVertical className="size-4 shrink-0 text-tertiary" />
                  <Icon className="size-4 shrink-0 text-tertiary" />
                  <span className="flex min-w-0 flex-1 items-center gap-1.5 text-label font-medium text-foreground">
                    <span className="truncate">{t(`header.menu-${item.id}`)}</span>
                    {!meta.canHide && (
                      <span
                        className="shrink-0 text-tertiary"
                        title={t('menuManagementPanel.always-visible')}
                      >
                        <Lock className="size-3.5" aria-hidden="true" />
                      </span>
                    )}
                  </span>

                  <div className="flex shrink-0 items-center gap-0.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => handleMoveUp(index)}
                      disabled={index === 0}
                      title={t('menuManagementPanel.move-up')}
                      aria-label={t('menuManagementPanel.move-v1-up', { v1: meta.labelZh })}
                    >
                      <ChevronUp className="size-3.5 text-secondary" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => handleMoveDown(index)}
                      disabled={index === sortedConfig.length - 1}
                      title={t('menuManagementPanel.move-down')}
                      aria-label={t('menuManagementPanel.move-v1-down', { v1: meta.labelZh })}
                    >
                      <ChevronDown className="size-3.5 text-secondary" />
                    </Button>
                  </div>

                  <Switch
                    checked={item.visible}
                    onCheckedChange={() => handleToggle(item.id)}
                    disabled={!meta.canHide}
                    title={!meta.canHide ? t('menuManagementPanel.this-menu-cannot-be-hidden') : undefined}
                    aria-label={t('menuManagementPanel.toggle-v1-visibility', { v1: meta.labelZh })}
                  />
                </div>
              </React.Fragment>
            );
          })}
        </SettingsCard>
      </SettingsSection>
    </SettingsPageStack>
  );
};
