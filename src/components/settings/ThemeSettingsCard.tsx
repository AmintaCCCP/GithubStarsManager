import React from 'react';
import { Check, Moon, Palette, Sun } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { THEME_PRESETS } from '../../constants/themePresets';
import type { ThemePresetId } from '../../constants/themePresets';
import { getThemeSwatch } from '../../lib/themePresets';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Label } from '../ui/label';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';

interface ThemeSettingsCardProps {
  t: (zh: string, en: string) => string;
}

export const ThemeSettingsCard: React.FC<ThemeSettingsCardProps> = ({ t }) => {
  const { theme, setTheme, themePreset, setThemePreset } = useAppStore();
  const isDark = theme === 'dark';

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center space-x-3">
          <Palette className="h-5 w-5 text-muted-foreground" />
          <CardTitle>{t('外观设置', 'Appearance')}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <p id="theme-mode-label" className="mb-3 text-sm font-medium text-foreground">
            {t('显示模式', 'Display Mode')}
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
                {t('浅色', 'Light')}
              </span>
            </Label>
            <Label
              htmlFor="theme-mode-dark"
              className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-background dark:border-border dark:hover:bg-card/[0.10]"
            >
              <RadioGroupItem value="dark" id="theme-mode-dark" aria-labelledby="theme-mode-dark-label" />
              <Moon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <span id="theme-mode-dark-label" className="text-base font-medium text-foreground">
                {t('深色', 'Dark')}
              </span>
            </Label>
          </RadioGroup>
        </div>

        <div>
          <p id="theme-preset-label" className="mb-1 text-sm font-medium text-foreground">
            {t('主题配色', 'Theme Color')}
          </p>
          <p className="mb-3 text-xs text-muted-foreground">
            {t('一键切换界面配色，立即生效并自动保存。', 'Switch the interface color scheme instantly; changes apply and persist automatically.')}
          </p>
          <div role="radiogroup" aria-labelledby="theme-preset-label" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {THEME_PRESETS.map((preset) => {
              const swatch = getThemeSwatch(preset, isDark);
              const isActive = themePreset === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
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
                    {t(preset.labelZh, preset.labelEn)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
