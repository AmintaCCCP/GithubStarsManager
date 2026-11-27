import { TranslateFn } from '../../i18n/useT';
import { Button } from '../ui/button';
import React from 'react';
import { Download, Upload, RefreshCw, AlertCircle, Clock } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { IncludeKeysToggle } from './IncludeKeysToggle';
import { useBackupActions } from '../../features/settings/hooks/useBackupActions';
import {
  SettingsCard,
  SettingsDivider,
  SettingsNotice,
  SettingsPageStack,
  SettingsRow,
  SettingsSection,
} from './SettingsPrimitives';

interface BackupPanelProps {
  t: TranslateFn;
}

export const BackupPanel: React.FC<BackupPanelProps> = ({ t }) => {
  const lastBackup = useAppStore((state) => state.lastBackup);
  const { activeConfig, isBackingUp, isRestoring, backup, restore } = useBackupActions();

  return (
    <SettingsPageStack>
      {!activeConfig && (
        <SettingsNotice tone="warning" icon={<AlertCircle />}>
          <p className="font-medium text-foreground">
            {t('backupPanel.please-configure-and-activate-webdav-service-fir')}
          </p>
          <p className="mt-0.5 text-secondary">
            {t('backupPanel.backup-and-restore-features-require-webdav-servi')}
          </p>
        </SettingsNotice>
      )}

      <SettingsSection title={t('backupPanel.backup-restore')}>
        <IncludeKeysToggle t={t} />
      </SettingsSection>

      <SettingsSection>
        <SettingsCard>
          {lastBackup && (
            <>
              <SettingsRow
                icon={<Clock />}
                title={t('backupPanel.last-backup')}
              >
                <span className="text-label-sm text-secondary tabular-nums">
                  {new Date(lastBackup).toLocaleString()}
                </span>
              </SettingsRow>
              <SettingsDivider />
            </>
          )}
          <SettingsRow
            icon={<Upload />}
            title={t('backupPanel.backup-data')}
            description={t('backupPanel.backup-data-to-webdav')}
          >
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={backup}
              disabled={isBackingUp || !activeConfig}
            >
              {isBackingUp ? <RefreshCw className="size-4 animate-spin" /> : <Upload className="size-4" />}
              <span>{isBackingUp ? t('backupPanel.backing-up') : t('backupPanel.start-backup')}</span>
            </Button>
          </SettingsRow>
          <SettingsDivider />
          <SettingsRow
            icon={<Download />}
            title={t('backupPanel.restore-data')}
            description={t('backupPanel.restore-data-from-webdav')}
          >
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={restore}
              disabled={isRestoring || !activeConfig}
            >
              {isRestoring ? <RefreshCw className="size-4 animate-spin" /> : <Download className="size-4" />}
              <span>{isRestoring ? t('backupPanel.restoring') : t('backupPanel.start-restore')}</span>
            </Button>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('backupPanel.backup-includes')}>
        <SettingsCard className="px-3.5 py-3">
          <ul className="space-y-1 text-label-sm text-secondary">
            <li>• {t('backupPanel.github-stars-repository-list')}</li>
            <li>• {t('backupPanel.release-information')}</li>
            <li>• {t('backupPanel.custom-categories')}</li>
            <li>• {t('backupPanel.ai-service-configurations')}</li>
            <li>• {t('backupPanel.webdav-configurations')}</li>
            <li>• {t('backupPanel.release-subscriptions-sources-read-state')}</li>
          </ul>
        </SettingsCard>
      </SettingsSection>
    </SettingsPageStack>
  );
};
