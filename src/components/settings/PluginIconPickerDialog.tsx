import React, { useEffect, useMemo, useState } from 'react';
import { RotateCcw, Search as SearchIcon } from 'lucide-react';
import type { TranslateFn } from '../../i18n/useT';
import type { InstalledPlugin } from '../../plugins/types';
import {
  PLUGIN_ICON_CHOICES,
  PluginIcon,
  normalizePluginIconKey,
} from '../../plugins/pluginIcons';
import { useAppStore } from '../../store/useAppStore';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Modal } from '../Modal';

interface PluginIconPickerDialogProps {
  target: InstalledPlugin | null;
  t: TranslateFn;
  onClose: () => void;
}

export const PluginIconPickerDialog: React.FC<PluginIconPickerDialogProps> = ({
  target,
  t,
  onClose,
}) => {
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (target) {
      setSearch('');
    }
  }, [target]);

  const customIcons = useAppStore((state) => state.pluginCustomIcons);
  const setPluginCustomIcon = useAppStore((state) => state.setPluginCustomIcon);

  const pluginId = target?.manifest.id;
  const currentIconKey = pluginId ? customIcons[pluginId] : undefined;
  const normalizedCurrent = normalizePluginIconKey(currentIconKey);

  const filteredIcons = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return PLUGIN_ICON_CHOICES;
    return PLUGIN_ICON_CHOICES.filter(
      (choice) =>
        choice.key.toLowerCase().includes(query) ||
        choice.label.toLowerCase().includes(query) ||
        choice.labelZh.toLowerCase().includes(query) ||
        choice.keywords.toLowerCase().includes(query),
    );
  }, [search]);

  if (!target) return null;

  const handleSelect = (key: string) => {
    if (!pluginId) return;
    setPluginCustomIcon(pluginId, key);
    onClose();
  };

  const handleReset = () => {
    if (!pluginId) return;
    setPluginCustomIcon(pluginId, null);
    onClose();
  };

  return (
    <Modal
      isOpen={target !== null}
      onClose={onClose}
      title={t('pluginSettingsPanel.customize-icon-title', { name: target.manifest.name })}
      maxWidth="max-w-xl"
      scrollable
    >
      <div className="space-y-4">
        {/* Search & Actions Bar */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('pluginSettingsPanel.search-icons')}
              className="pl-9"
              autoFocus
            />
          </div>
          {currentIconKey && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleReset}
              className="shrink-0 text-xs"
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              {t('pluginSettingsPanel.reset-icon')}
            </Button>
          )}
        </div>

        {/* Current Icon Preview */}
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
          <span className="text-xs text-muted-foreground">{t('pluginSettingsPanel.select-icon')}:</span>
          <div className="flex items-center gap-2 font-medium">
            <PluginIcon pluginId={pluginId} className="h-4 w-4 text-primary" />
            <span>{currentIconKey || 'plug (default)'}</span>
          </div>
        </div>

        {/* Icon Grid */}
        <div className="grid max-h-[360px] grid-cols-4 gap-2 overflow-y-auto p-1 sm:grid-cols-6 md:grid-cols-7">
          {filteredIcons.map((choice) => {
            const isSelected = normalizedCurrent === choice.key || (!normalizedCurrent && choice.key === 'plug');
            const IconComp = choice.icon;
            return (
              <button
                key={choice.key}
                type="button"
                onClick={() => handleSelect(choice.key)}
                title={`${choice.labelZh} (${choice.label})`}
                aria-label={`${choice.labelZh} (${choice.label})`}
                className={`flex flex-col items-center justify-center gap-1.5 rounded-lg border p-2 text-center transition-all hover:bg-accent hover:text-accent-foreground ${
                  isSelected
                    ? 'border-primary bg-primary/10 text-primary shadow-xs'
                    : 'border-border/60 bg-card text-foreground'
                }`}
              >
                <IconComp className="h-5 w-5 shrink-0" />
                <span className="w-full truncate text-[11px] leading-tight text-muted-foreground">
                  {choice.labelZh.split(' ')[0]}
                </span>
              </button>
            );
          })}
        </div>

        {filteredIcons.length === 0 && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {t('pluginSettingsPanel.no-icons-found')}
          </div>
        )}
      </div>
    </Modal>
  );
};
