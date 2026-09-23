
import { useTPair, TranslateFn } from '../../i18n/useT';
import React from 'react';
import { Check, Moon, Palette, Sun } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
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
import { REPOSITORY_CARD_FIELD_IDS } from '../../types/repositoryCardFields';
import { isRepositoryCardFieldVisible } from '../../utils/repositoryCardFields';

interface ThemeSettingsCardProps {
  t: TranslateFn;
}

export const ThemeSettingsCard: React.FC<ThemeSettingsCardProps> = ({ t }) => {
  const tPair = useTPair();
  const {
    theme,
    setTheme,
    themePreset,
    setThemePreset,
    themeTokens,
    updateThemeTokens,
    repositoryCardFields,
    setRepositoryCardField,
  } = useAppStore(useShallow((state) => ({
    theme: state.theme,
    setTheme: state.setTheme,
    themePreset: state.themePreset,
    setThemePreset: state.setThemePreset,
    themeTokens: state.themeTokens,
    updateThemeTokens: state.updateThemeTokens,
    repositoryCardFields: state.repositoryCardFields,
    setRepositoryCardField: state.setRepositoryCardField,
  })));
  const isDark = theme === 'dark';
  const activePreset = getThemePreset(themePreset);
  const presetAccentColor = hslTripletToHex(
    (isDark ? activePreset.darkColors : activePreset.lightColors).primary,
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
      setThemePreset(nextPresetId as ThemePresetId);
    }
    event.preventDefault();
    nextButton?.focus();
  }, [setThemePreset]);

  return (
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
            value={theme}
            onValueChange={(value) => setTheme(value as 'light' | 'dark')}
            className="grid max-w-md grid-cols-2 gap-4"
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
          </RadioGroup>
        </div>

        <div>
          <p id="theme-preset-label" className="mb-1 text-sm font-medium text-foreground">
            {t('themeSettingsCard.theme-color')}
          </p>
          <p className="mb-3 text-xs text-muted-foreground">
            {t('themeSettingsCard.switch-the-interface-color-scheme-instantly-chan')}
          </p>
          <div
            role="radiogroup"
            aria-labelledby="theme-preset-label"
            className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6"
            onKeyDown={handlePresetGridKeyDown}
          >
            {THEME_PRESETS.map((preset) => {

              const swatch = getThemeSwatch(preset, isDark);
              const isActive = themePreset === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  tabIndex={isActive ? 0 : -1}
                  data-theme-preset-id={preset.id}
                  onClick={() => setThemePreset(preset.id as ThemePresetId)}
                  className={`group relative flex flex-col items-center gap-2 rounded-lg border p-2.5 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
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
        <div className="space-y-5 border-t border-border pt-5">
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
        </div>

        {/* 仓库卡片可见字段（开发守则 §14）：只保存声明式开关 */}
        <div className="border-t border-border pt-5">
          <p className="text-sm font-medium text-foreground">{t('themeSettingsCard.card-fields')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('themeSettingsCard.card-fields-hint')}</p>
          <div className="mt-3 space-y-2">
            {REPOSITORY_CARD_FIELD_IDS.map((id) => (
              <div key={id} className="flex items-center justify-between gap-4">
                <span className="text-sm text-foreground">{t(`themeSettingsCard.card-field-${id}`)}</span>
                <Switch
                  aria-label={t(`themeSettingsCard.card-field-${id}`)}
                  checked={isRepositoryCardFieldVisible(repositoryCardFields, id)}
                  onCheckedChange={(checked) => setRepositoryCardField(id, checked)}
                />
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
