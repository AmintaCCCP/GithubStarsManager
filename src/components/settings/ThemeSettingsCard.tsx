import type { TranslateFn } from '../../i18n/useT';
import React from 'react';
import { Check, MonitorCog, Moon, Sun } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { resolveTheme } from '../../store/selectors';
import { getThemePreset, THEME_PRESETS } from '../../constants/themePresets';
import type { ThemePresetId } from '../../constants/themePresets';
import { getThemeSwatch } from '../../lib/themePresets';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Switch } from '../ui/switch';
import {
  ACCENT_PRESETS,
  ACCENT_PRESET_NAME_KEYS,
  DEFAULT_THEME_TOKENS,
  FONT_SCALE_OPTIONS,
  hslTripletToHex,
  type ThemeRadius,
} from '../../utils/themeTokens';
import { Label } from '../ui/label';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../ui/accordion';
import { REPOSITORY_CARD_FIELD_IDS } from '../../types/repositoryCardFields';
import { isRepositoryCardFieldVisible } from '../../utils/repositoryCardFields';
import { RepositoryCardActionsSettings } from './RepositoryCardActionsSettings';
import { SettingsCard, SettingsDivider, SettingsSection } from './SettingsPrimitives';

const THEME_PRESET_LABEL_KEYS: Partial<Record<ThemePresetId, string>> = {
  default: 'themeSettingsCard.preset-default',
  catppuccin: 'themeSettingsCard.preset-catppuccin',
  dracula: 'themeSettingsCard.preset-dracula',
  ghostty: 'themeSettingsCard.preset-ghostty',
  github: 'themeSettingsCard.preset-github',
  gruvbox: 'themeSettingsCard.preset-gruvbox',
  haze: 'themeSettingsCard.preset-haze',
  'night-owl': 'themeSettingsCard.preset-night-owl',
  nord: 'themeSettingsCard.preset-nord',
  'one-dark-pro': 'themeSettingsCard.preset-one-dark-pro',
  paper: 'themeSettingsCard.preset-paper',
  pierre: 'themeSettingsCard.preset-pierre',
  'rose-pine': 'themeSettingsCard.preset-rose-pine',
  solarized: 'themeSettingsCard.preset-solarized',
  'tokyo-night': 'themeSettingsCard.preset-tokyo-night',
  vitesse: 'themeSettingsCard.preset-vitesse',
};

interface ThemeSettingsCardProps {
  t: TranslateFn;
}

export const ThemeSettingsCard: React.FC<ThemeSettingsCardProps> = ({ t }) => {
  const {
    themeMode,
    systemTheme,
    setThemeMode,
    themePresetLight,
    themePresetDark,
    setThemePresetLight,
    setThemePresetDark,
    themeTokens,
    updateThemeTokens,
    repositoryCardFields,
    setRepositoryCardField,
  } = useAppStore(useShallow((state) => ({
    themeMode: state.themeMode,
    systemTheme: state.systemTheme,
    setThemeMode: state.setThemeMode,
    themePresetLight: state.themePresetLight,
    themePresetDark: state.themePresetDark,
    setThemePresetLight: state.setThemePresetLight,
    setThemePresetDark: state.setThemePresetDark,
    themeTokens: state.themeTokens,
    updateThemeTokens: state.updateThemeTokens,
    repositoryCardFields: state.repositoryCardFields,
    setRepositoryCardField: state.setRepositoryCardField,
  })));

  const theme = resolveTheme(themeMode, systemTheme);
  const [editMode, setEditMode] = React.useState<'light' | 'dark'>(theme);
  const editPresetId = editMode === 'dark' ? themePresetDark : themePresetLight;
  const activePreset = getThemePreset(editPresetId);
  const setEditPreset = React.useCallback((preset: ThemePresetId) => {
    if (editMode === 'dark') {
      setThemePresetDark(preset);
    } else {
      setThemePresetLight(preset);
    }
  }, [editMode, setThemePresetDark, setThemePresetLight]);

  React.useEffect(() => {
    if (themeMode === 'light' || themeMode === 'dark') setEditMode(themeMode);
  }, [themeMode]);

  const presetAccentColor = hslTripletToHex(
    (editMode === 'dark' ? activePreset.darkColors : activePreset.lightColors).primary,
  ) ?? '#2563eb';

  const handlePresetGridKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"][data-theme-preset-id]'),
    );
    if (buttons.length === 0) return;
    const currentIndex = buttons.findIndex((button) => button === document.activeElement);
    let nextIndex: number;
    if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = buttons.length - 1;
    } else {
      const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
      nextIndex = currentIndex === -1
        ? 0
        : (currentIndex + (forward ? 1 : -1) + buttons.length) % buttons.length;
    }
    const nextButton = buttons[nextIndex];
    const nextPresetId = nextButton?.dataset.themePresetId;
    if (nextPresetId) {
      setEditPreset(nextPresetId as ThemePresetId);
    }
    event.preventDefault();
    nextButton?.focus();
  }, [setEditPreset]);

  const handleEditModeKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    let nextMode: 'light' | 'dark';
    if (event.key === 'Home') {
      nextMode = 'light';
    } else if (event.key === 'End') {
      nextMode = 'dark';
    } else {
      nextMode = editMode === 'light' ? 'dark' : 'light';
    }
    const nextButton = event.currentTarget.querySelector<HTMLButtonElement>(`[data-edit-mode='${nextMode}']`);
    setEditMode(nextMode);
    nextButton?.focus();
    event.preventDefault();
  }, [editMode]);

  const modeOptions = [
    { value: 'light' as const, icon: Sun, label: t('themeSettingsCard.light') },
    { value: 'dark' as const, icon: Moon, label: t('themeSettingsCard.dark') },
    { value: 'system' as const, icon: MonitorCog, label: t('themeSettingsCard.system') },
  ];

  return (
    <>
      <SettingsSection title={t('themeSettingsCard.appearance')}>
        <SettingsCard>
          <div className="px-3.5 py-3">
            <p id="theme-mode-label" className="text-label font-medium text-foreground">
              {t('themeSettingsCard.display-mode')}
            </p>
            <RadioGroup
              aria-labelledby="theme-mode-label"
              value={themeMode}
              onValueChange={(value) => setThemeMode(value as 'light' | 'dark' | 'system')}
              className="mt-2.5 grid max-w-xl grid-cols-[repeat(auto-fit,minmax(min(100%,9.5rem),1fr))] gap-2"
            >
              {modeOptions.map((opt) => {
                const Icon = opt.icon;
                const isSelected = themeMode === opt.value;
                return (
                  <Label
                    key={opt.value}
                    htmlFor={`theme-mode-${opt.value}`}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 transition-[background-color,box-shadow] duration-micro ease-out-subtle hover:duration-instant',
                      isSelected
                        ? 'bg-fill-selected shadow-elev-0'
                        : 'bg-sunken/60 shadow-elev-0 hover:bg-fill-hover',
                    )}
                  >
                    <RadioGroupItem
                      value={opt.value}
                      id={`theme-mode-${opt.value}`}
                      aria-labelledby={`theme-mode-${opt.value}-label`}
                    />
                    <Icon className={cn('size-4', isSelected ? 'text-foreground' : 'text-tertiary')} aria-hidden="true" />
                    <span
                      id={`theme-mode-${opt.value}-label`}
                      className="whitespace-nowrap text-label font-medium text-foreground"
                    >
                      {opt.label}
                    </span>
                  </Label>
                );
              })}
            </RadioGroup>
          </div>

          <SettingsDivider />

          <div className="px-3.5 py-3.5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p id="theme-preset-label" className="text-label font-medium text-foreground">
                  {t('themeSettingsCard.theme-color')}
                </p>
                <p className="mt-px text-label-sm leading-[18px] text-secondary">
                  {t('themeSettingsCard.switch-the-interface-color-scheme-instantly-chan')}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div
                  role="radiogroup"
                  aria-label={t('themeSettingsCard.color-mode-target')}
                  className="inline-flex h-control items-center gap-0.5 rounded-md bg-fill-hover p-0.5"
                  onKeyDown={handleEditModeKeyDown}
                >
                  {(['light', 'dark'] as const).map((mode) => {
                    const isTarget = editMode === mode;
                    return (
                      <button
                        key={mode}
                        type="button"
                        role="radio"
                        aria-checked={isTarget}
                        tabIndex={isTarget ? 0 : -1}
                        data-edit-mode={mode}
                        onClick={() => setEditMode(mode)}
                        className={cn(
                          'motion-press inline-flex h-control-sm items-center gap-1.5 rounded-sm px-2.5 text-label-sm font-medium transition-[background-color,color,box-shadow] duration-micro ease-out-subtle hover:duration-instant',
                          isTarget
                            ? 'bg-floating text-foreground shadow-elev-1'
                            : 'text-secondary hover:text-foreground',
                        )}
                      >
                        {mode === 'light'
                          ? <Sun className="size-3.5" aria-hidden="true" />
                          : <Moon className="size-3.5" aria-hidden="true" />}
                        {t(mode === 'light' ? 'themeSettingsCard.light' : 'themeSettingsCard.dark')}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            <p className="mt-1.5 text-label-sm text-tertiary">
              {t('themeSettingsCard.per-mode-hint')}
            </p>

            <div
              role="radiogroup"
              aria-labelledby="theme-preset-label"
              className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4"
              onKeyDown={handlePresetGridKeyDown}
            >
              {THEME_PRESETS.map((preset) => {
                const swatch = getThemeSwatch(preset, editMode === 'dark');
                const isActive = editPresetId === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    tabIndex={isActive ? 0 : -1}
                    data-theme-preset-id={preset.id}
                    onClick={() => setEditPreset(preset.id as ThemePresetId)}
                    className={cn(
                      'group relative flex flex-col items-stretch gap-2 rounded-md p-2 text-left transition-[background-color,box-shadow] duration-micro ease-out-subtle hover:duration-instant focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                      isActive
                        ? 'bg-fill-selected ring-2 ring-primary shadow-elev-1'
                        : 'bg-sunken/40 shadow-elev-0 hover:bg-fill-hover',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="relative flex h-12 w-full overflow-hidden rounded-sm p-1 shadow-elev-0"
                      style={{ background: swatch.background }}
                    >
                      {/* Miniature navigator sidebar */}
                      <span className="flex w-[26%] flex-col gap-1 pr-1 pt-1">
                        <span
                          className="h-1 w-full rounded-full opacity-35"
                          style={{ background: swatch.foreground }}
                        />
                        <span
                          className="h-1 w-3/4 rounded-full opacity-20"
                          style={{ background: swatch.foreground }}
                        />
                      </span>
                      {/* Miniature paper pane */}
                      <span
                        className="flex flex-1 flex-col justify-center gap-1 rounded-xs px-1.5 py-1"
                        style={{
                          background: swatch.card,
                          boxShadow: `0 0 0 1px color-mix(in srgb, ${swatch.foreground} 10%, transparent)`,
                        }}
                      >
                        <span
                          className="block h-1.5 w-8 rounded-full"
                          style={{ background: swatch.primary }}
                        />
                        <span
                          className="block h-1 w-10 rounded-full opacity-30"
                          style={{ background: swatch.foreground }}
                        />
                        <span
                          className="block h-1 w-6 rounded-full"
                          style={{ background: swatch.accent }}
                        />
                      </span>
                      {isActive && (
                        <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-accent-solid text-on-accent shadow-elev-1">
                          <Check className="size-2.5" strokeWidth={2.5} aria-hidden="true" />
                        </span>
                      )}
                    </span>
                    <span className="truncate px-0.5 text-label-sm font-medium text-foreground">
                      {THEME_PRESET_LABEL_KEYS[preset.id] ? t(THEME_PRESET_LABEL_KEYS[preset.id]!) : preset.labelEn}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <SettingsDivider />

          <Accordion type="single" collapsible className="px-3.5">
            <AccordionItem value="fine-tune" className="border-0">
              <AccordionTrigger className="py-3 text-label font-medium">
                {t('themeSettingsCard.fine-tune-appearance')}
              </AccordionTrigger>
              <AccordionContent className="space-y-4 pb-3.5 pt-1">
                <div>
                  <p className="mb-2 text-label font-medium text-foreground">
                    {t('themeSettingsCard.accent-color')}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      aria-pressed={themeTokens.accentColor === null}
                      onClick={() => updateThemeTokens({ accentColor: null })}
                      className={cn(
                        'h-control-sm rounded-sm px-2.5 text-label-sm font-medium transition-[background-color,color,box-shadow] duration-micro ease-out-subtle hover:duration-instant',
                        themeTokens.accentColor === null
                          ? 'bg-fill-selected text-foreground shadow-elev-0 ring-1 ring-primary/50'
                          : 'bg-sunken text-secondary shadow-elev-0 hover:bg-fill-hover hover:text-foreground',
                      )}
                    >
                      {t('themeSettingsCard.follow-the-theme-preset')}
                    </button>
                    {ACCENT_PRESETS.map((hex) => (
                      <button
                        key={hex}
                        type="button"
                        aria-label={`${t(ACCENT_PRESET_NAME_KEYS[hex])} (${hex})`}
                        aria-pressed={themeTokens.accentColor === hex}
                        onClick={() => updateThemeTokens({ accentColor: hex })}
                        className={cn(
                          'size-6 rounded-full transition-transform duration-micro hover:scale-105',
                          themeTokens.accentColor === hex
                            ? 'ring-2 ring-foreground ring-offset-2 ring-offset-raised'
                            : 'ring-1 ring-black/10 dark:ring-white/10',
                        )}
                        style={{ background: hex }}
                      />
                    ))}
                    <input
                      type="color"
                      aria-label={t('themeSettingsCard.custom-accent-color')}
                      value={themeTokens.accentColor ?? presetAccentColor}
                      onChange={(event) => updateThemeTokens({ accentColor: event.target.value })}
                      className="h-control-sm w-9 cursor-pointer rounded-sm bg-sunken p-0.5 shadow-elev-0"
                    />
                  </div>
                </div>

                <SettingsDivider />

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-label font-medium text-foreground">
                    {t('themeSettingsCard.border-radius')}
                  </span>
                  <select
                    aria-label={t('themeSettingsCard.border-radius')}
                    value={themeTokens.radius}
                    onChange={(event) => updateThemeTokens({ radius: event.target.value as ThemeRadius })}
                    className="field-surface h-control rounded-md px-2.5 text-label text-foreground"
                  >
                    <option value="default">{t('themeSettingsCard.follow-the-theme-preset')}</option>
                    <option value="none">{t('themeSettingsCard.radius-none')}</option>
                    <option value="small">{t('themeSettingsCard.radius-small')}</option>
                    <option value="medium">{t('themeSettingsCard.radius-medium')}</option>
                    <option value="large">{t('themeSettingsCard.radius-large')}</option>
                  </select>
                </div>

                <SettingsDivider />

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-label font-medium text-foreground">
                    {t('themeSettingsCard.font-scale')}
                  </span>
                  <select
                    aria-label={t('themeSettingsCard.font-scale')}
                    value={String(themeTokens.fontScale)}
                    onChange={(event) => updateThemeTokens({ fontScale: Number(event.target.value) })}
                    className="field-surface h-control rounded-md px-2.5 text-label text-foreground"
                  >
                    {FONT_SCALE_OPTIONS.map((scale) => (
                      <option key={scale} value={String(scale)}>{`${Math.round(scale * 100)}%`}</option>
                    ))}
                    {!FONT_SCALE_OPTIONS.some((scale) => scale === themeTokens.fontScale) && (
                      <option value={String(themeTokens.fontScale)}>{`${Math.round(themeTokens.fontScale * 100)}%`}</option>
                    )}
                  </select>
                </div>

                <SettingsDivider />

                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-label font-medium text-foreground">
                      {t('themeSettingsCard.reduce-motion')}
                    </p>
                    <p className="mt-px text-label-sm leading-[18px] text-secondary">
                      {t('themeSettingsCard.reduce-motion-hint')}
                    </p>
                  </div>
                  <Switch
                    aria-label={t('themeSettingsCard.reduce-motion')}
                    checked={themeTokens.animation === 'reduced'}
                    onCheckedChange={(checked) => updateThemeTokens({
                      animation: checked ? 'reduced' : 'normal',
                    })}
                  />
                </div>

                <div className="pt-1">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => updateThemeTokens({ ...DEFAULT_THEME_TOKENS })}
                  >
                    {t('themeSettingsCard.reset-appearance')}
                  </Button>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title={t('themeSettingsCard.card-fields')}
        description={t('themeSettingsCard.card-fields-hint')}
      >
        <SettingsCard className="p-3.5">
          <div className="flex flex-wrap gap-2">
            {REPOSITORY_CARD_FIELD_IDS.map((id) => {
              const visible = isRepositoryCardFieldVisible(repositoryCardFields, id);
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={visible}
                  onClick={() => setRepositoryCardField(id, !visible)}
                  className={cn(
                    'motion-press inline-flex h-control-sm items-center gap-1.5 rounded-sm px-2.5 text-label-sm font-medium transition-[background-color,color,box-shadow] duration-micro ease-out-subtle hover:duration-instant',
                    visible
                      ? 'bg-accent-tint text-accent-text shadow-elev-0'
                      : 'bg-sunken text-secondary shadow-elev-0 hover:bg-fill-hover hover:text-foreground',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'flex size-3.5 items-center justify-center rounded-xs',
                      visible
                        ? 'bg-accent-solid text-on-accent'
                        : 'border border-control text-transparent',
                    )}
                  >
                    <Check className="size-2.5" strokeWidth={2.5} />
                  </span>
                  {t(`themeSettingsCard.card-field-${id}`)}
                </button>
              );
            })}
          </div>
        </SettingsCard>
      </SettingsSection>

      <RepositoryCardActionsSettings
        title={t('themeSettingsCard.card-actions')}
        hint={t('themeSettingsCard.card-actions-hint')}
        resetLabel={t('themeSettingsCard.reset-card-actions')}
        moveUpLabel={(action) => t('menuManagementPanel.move-v1-up', { v1: action })}
        moveDownLabel={(action) => t('menuManagementPanel.move-v1-down', { v1: action })}
        visibilityLabel={(action) => t('themeSettingsCard.quick-action-visibility', { action })}
      />
    </>
  );
};
