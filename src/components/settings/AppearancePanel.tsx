import { TranslateFn } from '../../i18n/useT';
import React from 'react';
import { Globe, Palette } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { APP_LANGUAGES, type AppLanguage } from '../../i18n/languages';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Label } from '../ui/label';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { ThemeSettingsCard } from './ThemeSettingsCard';

interface AppearancePanelProps {
  t: TranslateFn;
}

export const AppearancePanel: React.FC<AppearancePanelProps> = ({ t }) => {
  const { language, setLanguage } = useAppStore(useShallow((state) => ({
    language: state.language,
    setLanguage: state.setLanguage,
  })));

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-3">
        <Palette className="h-6 w-6 text-muted-foreground dark:text-muted-foreground" />
        <h3 className="text-lg font-semibold text-foreground dark:text-foreground">{t('settingsPanel.appearance')}</h3>
      </div>

      <ThemeSettingsCard t={t} />

      <Card>
        <CardHeader>
          <div className="flex items-center space-x-3">
            <Globe className="h-5 w-5 text-muted-foreground dark:text-muted-foreground" />
            <CardTitle id="language-settings-title">{t('generalPanel.language-settings')}</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <RadioGroup
            aria-labelledby="language-settings-title"
            value={language}
            onValueChange={(value) => setLanguage(value as AppLanguage)}
            className="grid w-full grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-3"
          >
            {APP_LANGUAGES.map((definition) => (
              <Label
                key={definition.code}
                htmlFor={`language-${definition.code}`}
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-background dark:border-border dark:hover:bg-card/[0.10]"
              >
                <RadioGroupItem value={definition.code} id={`language-${definition.code}`} aria-labelledby={`language-${definition.code}-label`} />
                <span className="min-w-0">
                  <span id={`language-${definition.code}-label`} className="block truncate text-sm font-medium text-foreground dark:text-foreground">
                    {definition.nativeName}
                  </span>
                  <span className="mt-1 block truncate text-xs font-normal text-muted-foreground dark:text-muted-foreground">
                    {definition.englishName}
                  </span>
                </span>
              </Label>
            ))}
          </RadioGroup>
        </CardContent>
      </Card>
    </div>
  );
};