
import { TranslateFn } from '../../i18n/useT';
import React from 'react';
import { ExternalLink, Github, Globe, Key, Mail, Monitor, Package, Clock, Twitter } from 'lucide-react';
import { UpdateChecker } from '../UpdateChecker';
import { useAppStore } from '../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { version } from '../../../package.json';
import { PROJECT_REPO_URL } from '../../constants/project';
import { APP_LANGUAGES, type AppLanguage } from '../../i18n/languages';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { Switch } from '../ui/switch';
import { ThemeSettingsCard } from './ThemeSettingsCard';
import { useDesktopActions } from '../../features/settings/hooks/useDesktopActions';
import { useGitHubTokenActions } from '../../features/settings/hooks/useGitHubTokenActions';

interface GeneralPanelProps {
  t: TranslateFn;
}

export const GeneralPanel: React.FC<GeneralPanelProps> = ({ t }) => {
  const {
    language,
    setLanguage,
    user,
    recentlyViewedEnabled,
    setRecentlyViewedEnabled,
    recentlyViewedCount,
    clearRecentlyViewed,
  } = useAppStore(useShallow((state) => ({
    language: state.language,
    setLanguage: state.setLanguage,
    user: state.user,
    recentlyViewedEnabled: state.recentlyViewedEnabled,
    setRecentlyViewedEnabled: state.setRecentlyViewedEnabled,
    recentlyViewedCount: state.recentlyViewed.length,
    clearRecentlyViewed: state.clearRecentlyViewed,
  })));
  const desktop = useDesktopActions({ t });
  const githubToken = useGitHubTokenActions({ t });

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-3">
        <Package className="h-6 w-6 text-muted-foreground dark:text-muted-foreground" />
        <h3 className="text-lg font-semibold text-foreground dark:text-foreground">{t('generalPanel.general-settings')}</h3>
      </div>

      <ThemeSettingsCard t={t} />

      <Card>
        <CardHeader>
          <div className="flex items-center space-x-3">
            <Key className="h-5 w-5 text-muted-foreground dark:text-muted-foreground" />
            <CardTitle>{t('generalPanel.github-token')}</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground dark:text-muted-foreground">
            {user?.login
              ? t('generalPanel.account-token-hint', { login: user.login })
              : t('generalPanel.token-hint')}
          </p>
          <div className="space-y-2">
            <Label htmlFor="settings-github-token">GitHub Personal Access Token</Label>
            <Input
              id="settings-github-token"
              type="password"
              autoComplete="off"
              placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
              value={githubToken.tokenInput}
              onChange={(event) => githubToken.setTokenInput(event.target.value)}
              disabled={githubToken.isSaving}
            />
          </div>
          <Button type="button" onClick={() => { void githubToken.updateToken(); }} disabled={githubToken.isSaving || !githubToken.tokenInput.trim()}>
            {githubToken.isSaving ? t('generalPanel.updating') : t('generalPanel.update-token')}
          </Button>
        </CardContent>
      </Card>

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

      {desktop.supported && (
        <Card>
          <CardHeader>
            <div className="flex items-center space-x-3">
              <Monitor className="h-5 w-5 text-muted-foreground dark:text-muted-foreground" />
              <CardTitle>{t('generalPanel.desktop')}</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-foreground dark:text-foreground">{t('generalPanel.launch-at-startup')}</p>
                <p className="mt-1 text-xs text-muted-foreground dark:text-muted-foreground">{t('generalPanel.start-the-client-automatically-after-login-off-b')}</p>
              </div>
              <Switch
                aria-label={t('generalPanel.launch-at-startup')}
                checked={desktop.prefs.autoLaunch}
                disabled={desktop.loading || desktop.saving}
                onCheckedChange={(checked) => { void desktop.toggleAutoLaunch(checked); }}
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-foreground dark:text-foreground">{t('generalPanel.minimize-to-tray-on-close')}</p>
                <p className="mt-1 text-xs text-muted-foreground dark:text-muted-foreground">{t('generalPanel.keep-running-in-the-tray-after-closing-right-cli')}</p>
              </div>
              <Switch
                aria-label={t('generalPanel.minimize-to-tray-on-close')}
                checked={desktop.prefs.closeToTray}
                disabled={desktop.loading || desktop.saving}
                onCheckedChange={(checked) => { void desktop.toggleCloseToTray(checked); }}
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-foreground dark:text-foreground">{t('generalPanel.hide-to-tray-on-minimize')}</p>
                <p className="mt-1 text-xs text-muted-foreground dark:text-muted-foreground">{t('generalPanel.hide-to-the-tray-when-minimizing-on-by-default')}</p>
              </div>
              <Switch
                aria-label={t('generalPanel.hide-to-tray-on-minimize')}
                checked={desktop.prefs.minimizeToTray}
                disabled={desktop.loading || desktop.saving}
                onCheckedChange={(checked) => { void desktop.toggleMinimizeToTray(checked); }}
              />
            </div>
            {desktop.error && (
              <p role="alert" className="text-xs text-destructive dark:text-destructive">{desktop.error}</p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center space-x-3">
            <Clock className="h-5 w-5 text-muted-foreground dark:text-muted-foreground" />
            <CardTitle>{t('generalPanel.recently-viewed')}</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-foreground dark:text-foreground">{t('generalPanel.record-recently-viewed')}</p>
              <p className="mt-1 text-xs text-muted-foreground dark:text-muted-foreground">{t('generalPanel.recently-viewed-hint')}</p>
            </div>
            <Switch
              aria-label={t('generalPanel.record-recently-viewed')}
              checked={recentlyViewedEnabled}
              onCheckedChange={setRecentlyViewedEnabled}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs text-muted-foreground dark:text-muted-foreground">
              {t('generalPanel.recently-viewed-count-kept-locally', { count: recentlyViewedCount })}
            </p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={recentlyViewedCount === 0}
              onClick={clearRecentlyViewed}
            >
              {t('generalPanel.clear-recently-viewed')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center space-x-3">
            <Package className="h-5 w-5 text-muted-foreground dark:text-muted-foreground" />
            <CardTitle>{t('generalPanel.check-for-updates')}</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <div>
            <p className="mb-1 text-sm text-muted-foreground dark:text-muted-foreground">{t('generalPanel.current-version-v-version', { version: version })}</p>
            <p className="text-xs text-muted-foreground dark:text-muted-foreground">{t('generalPanel.check-if-a-new-version-is-available')}</p>
          </div>
          <UpdateChecker />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center space-x-3">
            <Mail className="h-5 w-5 text-muted-foreground dark:text-muted-foreground" />
            <CardTitle>{t('generalPanel.contact-information')}</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground dark:text-muted-foreground">{t('generalPanel.if-you-encounter-any-issues-or-have-suggestions')}</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button type="button" onClick={() => { const newWindow = window.open('https://x.com/GoodMan_Lee', '_blank', 'noopener,noreferrer'); if (newWindow) newWindow.opener = null; }} className="gap-2">
              <Twitter className="h-5 w-5" />
              <span>Twitter</span>
              <ExternalLink className="h-4 w-4" />
            </Button>
            <Button type="button" variant="outline" onClick={() => { const newWindow = window.open(PROJECT_REPO_URL, '_blank', 'noopener,noreferrer'); if (newWindow) newWindow.opener = null; }} className="gap-2">
              <Github className="h-5 w-5" />
              <span>{t('generalPanel.github')}</span>
              <ExternalLink className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
