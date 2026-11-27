import { TranslateFn } from '../../i18n/useT';
import React from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { APP_LANGUAGES, type AppLanguage } from '../../i18n/languages';
import { cn } from '../../lib/utils';
import { Label } from '../ui/label';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { ThemeSettingsCard } from './ThemeSettingsCard';
import { SettingsCard, SettingsPageStack, SettingsSection } from './SettingsPrimitives';

interface AppearancePanelProps {
  t: TranslateFn;
}

export const AppearancePanel: React.FC<AppearancePanelProps> = ({ t }) => {
  const { language, setLanguage } = useAppStore(useShallow((state) => ({
    language: state.language,
    setLanguage: state.setLanguage,
  })));

  return (
    <SettingsPageStack>
      <ThemeSettingsCard t={t} />

      <SettingsSection
        title={t('generalPanel.language-settings')}
        titleId="language-settings-title"
      >
        <SettingsCard className="p-3.5">
          <RadioGroup
            aria-labelledby="language-settings-title"
            value={language}
            onValueChange={(value) => setLanguage(value as AppLanguage)}
            className="grid w-full grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-2"
          >
            {APP_LANGUAGES.map((definition) => {
              const isSelected = language === definition.code;
              return (
                <Label
                  key={definition.code}
                  htmlFor={`language-${definition.code}`}
                  className={cn(
                    'flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 transition-[background-color,box-shadow] duration-micro ease-out-subtle hover:duration-instant',
                    isSelected
                      ? 'bg-fill-selected shadow-elev-0'
                      : 'bg-sunken/60 shadow-elev-0 hover:bg-fill-hover',
                  )}
                >
                  <RadioGroupItem
                    value={definition.code}
                    id={`language-${definition.code}`}
                    aria-labelledby={`language-${definition.code}-label`}
                  />
                  <span className="min-w-0">
                    <span
                      id={`language-${definition.code}-label`}
                      className="block truncate text-label font-medium text-foreground"
                    >
                      {definition.nativeName}
                    </span>
                    <span className="mt-px block truncate text-label-sm font-normal text-secondary">
                      {definition.englishName}
                    </span>
                  </span>
                </Label>
              );
            })}
          </RadioGroup>
        </SettingsCard>
      </SettingsSection>
    </SettingsPageStack>
  );
};
