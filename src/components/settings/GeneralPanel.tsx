import { TranslateFn } from '../../i18n/useT';
import React, { useState } from 'react';
import { ArrowRight, ExternalLink, Key, Mail, Monitor, Package, RefreshCw } from 'lucide-react';
import { Github, Twitter } from '../ui/brand-icons';
import { UpdateChecker } from '../UpdateChecker';
import { useAppStore } from '../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { version } from '../../../package.json';
import { PROJECT_REPO_URL } from '../../constants/project';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
import { useDesktopActions } from '../../features/settings/hooks/useDesktopActions';
import { useGitHubTokenActions } from '../../features/settings/hooks/useGitHubTokenActions';
import { GitHubTokenPermissions } from '../GitHubTokenPermissions';
import {
  SettingsCard,
  SettingsDivider,
  SettingsNotice,
  SettingsPageStack,
  SettingsRow,
  SettingsSection,
} from './SettingsPrimitives';

interface GeneralPanelProps {
  t: TranslateFn;
}

export const GeneralPanel: React.FC<GeneralPanelProps> = ({ t }) => {
  const { user, autoUpdateCheckEnabled, setAutoUpdateCheckEnabled } = useAppStore(useShallow((state) => ({
    user: state.user,
    autoUpdateCheckEnabled: state.autoUpdateCheckEnabled,
    setAutoUpdateCheckEnabled: state.setAutoUpdateCheckEnabled,
  })));
  const desktop = useDesktopActions();
  const githubToken = useGitHubTokenActions();
  const [guideOpen, setGuideOpen] = useState(false);

  return (
    <SettingsPageStack>
      <SettingsSection title={t('generalPanel.check-for-updates')}>
        <SettingsCard>
          <SettingsRow
            icon={<RefreshCw />}
            title={t('generalPanel.auto-update-check')}
            description={t('generalPanel.auto-update-check-hint')}
          >
            <Switch
              aria-label={t('generalPanel.auto-update-check')}
              checked={autoUpdateCheckEnabled}
              onCheckedChange={setAutoUpdateCheckEnabled}
            />
          </SettingsRow>
          <SettingsDivider />
          <SettingsRow
            icon={<Package />}
            title={t('generalPanel.current-version-v-version', { version })}
            description={t('generalPanel.check-if-a-new-version-is-available')}
          >
            <UpdateChecker />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title={t('generalPanel.github-token')}
        actions={(
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setGuideOpen(true)}
            className="text-secondary hover:text-foreground"
          >
            <span>{t('generalPanel.token-permission-guide')}</span>
            <ArrowRight className="size-3.5" />
          </Button>
        )}
      >
        <SettingsCard>
          <div className="flex flex-col gap-3 px-3.5 py-3">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center text-tertiary">
                <Key className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <label
                  htmlFor="settings-github-token"
                  className="block text-label font-medium text-foreground"
                >
                  GitHub Personal Access Token {/* i18n-allow-literal */}
                </label>
                <p className="mt-px text-label-sm leading-[18px] text-secondary">
                  {user?.login
                    ? t('generalPanel.account-token-hint', { login: user.login })
                    : t('generalPanel.token-hint')}
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-2 pl-7 sm:flex-row sm:items-center">
              <Input
                id="settings-github-token"
                type="password"
                autoComplete="off"
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                value={githubToken.tokenInput}
                onChange={(event) => githubToken.setTokenInput(event.target.value)}
                disabled={githubToken.isSaving}
                className="flex-1"
              />
              <Button
                type="button"
                variant="primary"
                size="lg"
                onClick={() => { void githubToken.updateToken(); }}
                disabled={githubToken.isSaving || !githubToken.tokenInput.trim()}
              >
                {githubToken.isSaving ? t('generalPanel.updating') : t('generalPanel.update-token')}
              </Button>
            </div>
          </div>
        </SettingsCard>
      </SettingsSection>

      <Dialog open={guideOpen} onOpenChange={setGuideOpen}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('generalPanel.token-permission-guide')}</DialogTitle>
          </DialogHeader>
          <GitHubTokenPermissions heading={false} />
        </DialogContent>
      </Dialog>

      {desktop.supported && (
        <SettingsSection title={t('generalPanel.desktop')}>
          <SettingsCard>
            <SettingsRow
              icon={<Monitor />}
              title={t('generalPanel.launch-at-startup')}
              description={t('generalPanel.start-the-client-automatically-after-login-off-b')}
            >
              <Switch
                aria-label={t('generalPanel.launch-at-startup')}
                checked={desktop.prefs.autoLaunch}
                disabled={desktop.loading || desktop.saving}
                onCheckedChange={(checked) => { void desktop.toggleAutoLaunch(checked); }}
              />
            </SettingsRow>
            <SettingsDivider />
            <SettingsRow
              title={t('generalPanel.minimize-to-tray-on-close')}
              description={t('generalPanel.keep-running-in-the-tray-after-closing-right-cli')}
            >
              <Switch
                aria-label={t('generalPanel.minimize-to-tray-on-close')}
                checked={desktop.prefs.closeToTray}
                disabled={desktop.loading || desktop.saving}
                onCheckedChange={(checked) => { void desktop.toggleCloseToTray(checked); }}
              />
            </SettingsRow>
            <SettingsDivider />
            <SettingsRow
              title={t('generalPanel.hide-to-tray-on-minimize')}
              description={t('generalPanel.hide-to-the-tray-when-minimizing-on-by-default')}
            >
              <Switch
                aria-label={t('generalPanel.hide-to-tray-on-minimize')}
                checked={desktop.prefs.minimizeToTray}
                disabled={desktop.loading || desktop.saving}
                onCheckedChange={(checked) => { void desktop.toggleMinimizeToTray(checked); }}
              />
            </SettingsRow>
          </SettingsCard>
          {desktop.error && (
            <SettingsNotice tone="destructive" role="alert">
              {desktop.error}
            </SettingsNotice>
          )}
        </SettingsSection>
      )}

      <SettingsSection title={t('generalPanel.contact-information')}>
        <SettingsCard>
          <SettingsRow
            icon={<Mail />}
            title={t('generalPanel.contact-information')}
            description={t('generalPanel.if-you-encounter-any-issues-or-have-suggestions')}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="md"
                onClick={() => {
                  const newWindow = window.open('https://x.com/GoodMan_Lee', '_blank', 'noopener,noreferrer');
                  if (newWindow) newWindow.opener = null;
                }}
              >
                <Twitter className="size-4" />
                <span>Twitter</span>
                <ExternalLink className="size-3.5 text-tertiary" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="md"
                onClick={() => {
                  const newWindow = window.open(PROJECT_REPO_URL, '_blank', 'noopener,noreferrer');
                  if (newWindow) newWindow.opener = null;
                }}
              >
                <Github className="size-4" />
                <span>{t('generalPanel.github')}</span>
                <ExternalLink className="size-3.5 text-tertiary" />
              </Button>
            </div>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
    </SettingsPageStack>
  );
};
