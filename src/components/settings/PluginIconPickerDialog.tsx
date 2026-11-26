import React, { useEffect, useMemo, useState } from 'react';
import { RotateCcw, Search as SearchIcon } from 'lucide-react';
import type { TranslateFn } from '../../i18n/useT';
import type { InstalledPlugin } from '../../plugins/types';
import {
  PLUGIN_ICON_CHOICES,
  PluginIcon,
  getPluginIconLabel,
  normalizePluginIconKey,
} from '../../plugins/pluginIcons';
import { useAppStore } from '../../store/useAppStore';
import { cn } from '../../lib/utils';
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
  const language = useAppStore((state) => state.language);

  const pluginId = target?.manifest.id;
  const currentIconKey = pluginId ? customIcons[pluginId] : undefined;
  const normalizedCurrent = normalizePluginIconKey(currentIconKey);

  const defaultChoice = PLUGIN_ICON_CHOICES[0];
  const currentChoice = currentIconKey
    ? (PLUGIN_ICON_CHOICES.find((choice) => choice.key === normalizedCurrent) ?? defaultChoice)
    : null;
  const selectedIconKey = currentChoice?.key ?? null;
  const previewIconLabel = currentChoice
    ? getPluginIconLabel(currentChoice, language)
    : t('pluginSettingsPanel.default-icon');

  const filteredIcons = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return PLUGIN_ICON_CHOICES;
    return PLUGIN_ICON_CHOICES.filter(
      (choice) =>
        choice.key.toLowerCase().includes(query) ||
        Object.values(choice.labels).some((label) => label.toLowerCase().includes(query)) ||
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
      <div className="space-y-3.5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-tertiary" />
            <Input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('pluginSettingsPanel.search-icons')}
              className="pl-8"
              autoFocus
            />
          </div>
          {currentIconKey && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleReset}
              className="shrink-0"
            >
              <RotateCcw className="size-3.5" />
              <span>{t('pluginSettingsPanel.reset-icon')}</span>
            </Button>
          )}
        </div>

        <div className="flex items-center gap-2.5 rounded-md bg-sunken px-3 py-2 text-label shadow-elev-0">
          <span className="text-label-sm text-secondary">{t('pluginSettingsPanel.select-icon')}:</span>
          <div className="flex items-center gap-2 font-medium text-foreground">
            <PluginIcon pluginId={pluginId} className="size-4 text-accent-text" />
            <span>{previewIconLabel}</span>
          </div>
        </div>

        <div className="grid max-h-[360px] grid-cols-4 gap-2 overflow-y-auto p-0.5 sm:grid-cols-6 md:grid-cols-7">
          {filteredIcons.map((choice) => {
            const isSelected = selectedIconKey === choice.key;
            const IconComp = choice.icon;
            const choiceLabel = getPluginIconLabel(choice, language);
            const choiceTitle = language === 'en' ? choiceLabel : `${choiceLabel} (${choice.labels.en})`;
            return (
              <button
                key={choice.key}
                type="button"
                aria-pressed={isSelected}
                onClick={() => handleSelect(choice.key)}
                title={choiceTitle}
                aria-label={choiceTitle}
                className={cn(
                  'motion-press flex min-h-[64px] flex-col items-center justify-center gap-1.5 rounded-md p-1.5 text-center transition-[background-color,color,box-shadow] duration-micro ease-out-subtle hover:duration-instant',
                  isSelected
                    ? 'bg-accent-tint text-accent-text shadow-elev-0 ring-1 ring-primary'
                    : 'bg-sunken/60 text-foreground shadow-elev-0 hover:bg-fill-hover',
                )}
              >
                <IconComp className="size-4 shrink-0" />
                <span className="w-full break-words text-caption leading-tight text-secondary">
                  {choiceLabel}
                </span>
              </button>
            );
          })}
        </div>

        {filteredIcons.length === 0 && (
          <div className="py-8 text-center text-label-sm text-secondary">
            {t('pluginSettingsPanel.no-icons-found')}
          </div>
        )}
      </div>
    </Modal>
  );
};
