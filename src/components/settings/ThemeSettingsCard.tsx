
import { useTPair, TranslateFn } from '../../i18n/useT';
import React from 'react';
import { Check, MonitorCog, Moon, Palette, Sun } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { resolveTheme } from '../../store/selectors';
import { getThemePreset, THEME_PRESETS } from '../../constants/themePresets';
import type { ThemePresetId } from '../../constants/themePresets';
import { getThemeSwatch } from '../../lib/themePresets';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
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

interface ThemeSettingsCardProps {
  t: TranslateFn;
}

export const ThemeSettingsCard: React.FC<ThemeSettingsCardProps> = ({ t }) => {
  const tPair = useTPair();
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
  // 预设按深浅分别记忆；编辑目标用本地状态，默认落在当前实际模式上，
  // 避免跟随系统时预设选择随系统翻动而漂移。
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
  const presetAccentColor = hslTripletToHex(
    (editMode === 'dark' ? activePreset.darkColors : activePreset.lightColors).primary,
  ) ?? '#2563eb';

  // Roving tabindex: arrow keys move focus across preset options; selection
  // stays on click/Enter (Space) as with any button.
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

  return (
    <>
    <Card>
      <CardHeader>
        <div className="flex items-center space-x-3">
          <Palette className="h-5 w-5 text-muted-foreground" />
          <CardTitle>{t('themeSettingsCard.appearance')}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <p id="theme-mode-label" className="mb-3 text-sm font-medium text-foreground">
            {t('themeSettingsCard.display-mode')}
          </p>
          <RadioGroup
            aria-labelledby="theme-mode-label"
            value={themeMode}
            onValueChange={(value) => {
              setThemeMode(value as 'light' | 'dark' | 'system');
              // 显式选定深/浅时，配色编辑目标同步跟随，避免网格高亮另一模式的预设。
              if (value === 'light' || value === 'dark') setEditMode(value);
            }}
            className="grid max-w-md grid-cols-3 gap-4"
          >
            <Label
              htmlFor="theme-mode-light"
              className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-background dark:border-border dark:hover:bg-card/[0.10]"
            >
              <RadioGroupItem value="light" id="theme-mode-light" aria-labelledby="theme-mode-light-label" />
              <Sun className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <span id="theme-mode-light-label" className="text-base font-medium text-foreground">
                {t('themeSettingsCard.light')}
              </span>
            </Label>
            <Label
              htmlFor="theme-mode-dark"
              className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-background dark:border-border dark:hover:bg-card/[0.10]"
            >
              <RadioGroupItem value="dark" id="theme-mode-dark" aria-labelledby="theme-mode-dark-label" />
              <Moon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <span id="theme-mode-dark-label" className="text-base font-medium text-foreground">
                {t('themeSettingsCard.dark')}
              </span>
            </Label>
            <Label
              htmlFor="theme-mode-system"
              className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-background dark:border-border dark:hover:bg-card/[0.10]"
            >
              <RadioGroupItem value="system" id="theme-mode-system" aria-labelledby="theme-mode-system-label" />
              <MonitorCog className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <span id="theme-mode-system-label" className="text-base font-medium text-foreground">
                {t('themeSettingsCard.system')}
              </span>
            </Label>
          </RadioGroup>
        </div>

        <div>
          <p id="theme-preset-label" className="mb-1 text-sm font-medium text-foreground">
            {t('themeSettingsCard.theme-color')}
          </p>
          <p className="mb-3 text-xs text-muted-foreground">
            {t('themeSettingsCard.switch-the-interface-color-scheme-instantly-chan')}
          </p>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <div
              role="radiogroup"
              aria-label={t('themeSettingsCard.color-mode-target')}
              className="inline-flex overflow-hidden rounded-lg border border-border"
            >
              {(['light', 'dark'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={editMode === mode}
                  onClick={() => setEditMode(mode)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors ${
                    editMode === mode
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-background dark:hover:bg-card/[0.10]'
                  }`}
                >
                  {mode === 'light'
                    ? <Sun className="h-3.5 w-3.5" aria-hidden="true" />
                    : <Moon className="h-3.5 w-3.5" aria-hidden="true" />}
                  {t(mode === 'light' ? 'themeSettingsCard.light' : 'themeSettingsCard.dark')}
                </button>
              ))}
            </div>
            <span className="text-xs text-muted-foreground">{t('themeSettingsCard.per-mode-hint')}</span>
          </div>
          <div
            role="radiogroup"
            aria-labelledby="theme-preset-label"
            className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6"
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
                  className={`group relative flex flex-col items-center gap-2 rounded-lg border p-2.5 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ui-focus-ring) focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                    isActive
                      ? 'border-primary ring-2 ring-primary/30'
                      : 'border-border hover:border-primary/40'
                  }`}
                >
                  {isActive && (
                    <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Check className="h-3 w-3" aria-hidden="true" />
                    </span>
                  )}
                  <span
                    aria-hidden="true"
                    className="flex h-12 w-full items-end overflow-hidden rounded-md border border-border/60"
                    style={{ background: swatch.background }}
                  >
                    <span
                      className="m-1 h-7 flex-1 rounded-sm border"
                      style={{ background: swatch.card, borderColor: `hsl(var(--border))` }}
                    >
                      <span className="mx-auto mt-1 block h-1.5 w-8 rounded-full" style={{ background: swatch.primary }} />
                      <span className="mx-auto mt-1 block h-1.5 w-5 rounded-full" style={{ background: swatch.accent }} />
                    </span>
                  </span>
                  <span className="line-clamp-1 text-xs font-medium text-foreground">
                    {tPair(preset.labelZh, preset.labelEn)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Theme token（开发守则 §14）：强调色 / 圆角 / 字号 / 动效，全部落到 <html>
            的 CSS 变量与 data 属性上，恢复默认即删掉内联值让预设重新生效。 */}
        <Accordion type="single" collapsible className="border-t border-border">
          <AccordionItem value="fine-tune" className="border-0">
            <AccordionTrigger>{t('themeSettingsCard.fine-tune-appearance')}</AccordionTrigger>
            <AccordionContent className="space-y-5">
          <div>
            <p className="mb-2 text-sm font-medium text-foreground">{t('themeSettingsCard.accent-color')}</p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                aria-pressed={themeTokens.accentColor === null}
                onClick={() => updateThemeTokens({ accentColor: null })}
                className={`rounded-md border px-2.5 py-1 text-xs ${
                  themeTokens.accentColor === null ? 'border-primary text-foreground' : 'border-border text-muted-foreground'
                }`}
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
                  className={`h-7 w-7 rounded-full border-2 ${
                    themeTokens.accentColor === hex ? 'border-foreground' : 'border-transparent'
                  }`}
                  style={{ background: hex }}
                />
              ))}
              <input
                type="color"
                aria-label={t('themeSettingsCard.custom-accent-color')}
                value={themeTokens.accentColor ?? presetAccentColor}
                onChange={(event) => updateThemeTokens({ accentColor: event.target.value })}
                className="h-7 w-10 cursor-pointer rounded border border-border bg-transparent"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm font-medium text-foreground">{t('themeSettingsCard.border-radius')}</span>
            <select
              aria-label={t('themeSettingsCard.border-radius')}
              value={themeTokens.radius}
              onChange={(event) => updateThemeTokens({ radius: event.target.value as ThemeRadius })}
              className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
            >
              <option value="default">{t('themeSettingsCard.follow-the-theme-preset')}</option>
              <option value="none">{t('themeSettingsCard.radius-none')}</option>
              <option value="small">{t('themeSettingsCard.radius-small')}</option>
              <option value="medium">{t('themeSettingsCard.radius-medium')}</option>
              <option value="large">{t('themeSettingsCard.radius-large')}</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm font-medium text-foreground">{t('themeSettingsCard.font-scale')}</span>
            <select
              aria-label={t('themeSettingsCard.font-scale')}
              value={String(themeTokens.fontScale)}
              onChange={(event) => updateThemeTokens({ fontScale: Number(event.target.value) })}
              className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
            >
              {FONT_SCALE_OPTIONS.map((scale) => (
                <option key={scale} value={String(scale)}>{`${Math.round(scale * 100)}%`}</option>
              ))}
              {!FONT_SCALE_OPTIONS.some((scale) => scale === themeTokens.fontScale) && (
                <option value={String(themeTokens.fontScale)}>{`${Math.round(themeTokens.fontScale * 100)}%`}</option>
              )}
            </select>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-foreground">{t('themeSettingsCard.reduce-motion')}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t('themeSettingsCard.reduce-motion-hint')}</p>
            </div>
            <Switch
              aria-label={t('themeSettingsCard.reduce-motion')}
              checked={themeTokens.animation === 'reduced'}
              onCheckedChange={(checked) => updateThemeTokens({
                animation: checked ? 'reduced' : 'normal',
              })}
            />
          </div>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => updateThemeTokens({ ...DEFAULT_THEME_TOKENS })}
          >
            {t('themeSettingsCard.reset-appearance')}
          </Button>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
    <Card>
      <CardHeader>
        <CardTitle>{t('themeSettingsCard.card-fields')}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-muted-foreground">{t('themeSettingsCard.card-fields-hint')}</p>
        <div className="flex flex-wrap gap-2">
          {REPOSITORY_CARD_FIELD_IDS.map((id) => {
            const visible = isRepositoryCardFieldVisible(repositoryCardFields, id);
            return (
              <Button
                key={id}
                type="button"
                variant="outline"
                size="sm"
                aria-pressed={visible}
                onClick={() => setRepositoryCardField(id, !visible)}
                className={visible ? 'border-primary bg-primary/10 text-primary hover:bg-primary/15' : ''}
              >
                <span
                  aria-hidden="true"
                  className={visible
                    ? 'flex h-4 w-4 items-center justify-center rounded-sm bg-primary text-primary-foreground'
                    : 'flex h-4 w-4 items-center justify-center rounded-sm border border-border text-transparent'}
                >
                  <Check className="h-3 w-3" />
                </span>
                {t(`themeSettingsCard.card-field-${id}`)}
              </Button>
            );
          })}
        </div>
      </CardContent>
    </Card>
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
