
import { TranslateFn } from '../../i18n/useT';
import { Button } from '../ui/button';
import React from 'react';
import { Download, Upload, RefreshCw, Cloud, AlertCircle } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { IncludeKeysToggle } from './IncludeKeysToggle';
import { useBackupActions } from '../../features/settings/hooks/useBackupActions';

interface BackupPanelProps {
  t: TranslateFn;
}

export const BackupPanel: React.FC<BackupPanelProps> = ({ t }) => {
  const lastBackup = useAppStore((state) => state.lastBackup);
  const { activeConfig, isBackingUp, isRestoring, backup, restore } = useBackupActions({ t });

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-3">
        <Cloud className="w-6 h-6 text-muted-foreground dark:text-muted-foreground" />
        <h3 className="text-lg font-semibold text-foreground dark:text-foreground">
          {t('backupPanel.backup-restore')}
        </h3>
      </div>

      {!activeConfig && (
        <div className="p-4 bg-muted dark:bg-muted/40 rounded-lg border border-border dark:border-border">
          <div className="flex items-start space-x-3">
            <AlertCircle className="w-5 h-5 text-muted-foreground dark:text-muted-foreground mt-0.5" />
            <div>
              <p className="text-sm text-muted-foreground dark:text-muted-foreground ">
                {t('backupPanel.please-configure-and-activate-webdav-service-fir')}
              </p>
              <p className="text-xs text-muted-foreground dark:text-muted-foreground mt-1">
                {t('backupPanel.backup-and-restore-features-require-webdav-servi')}
              </p>
            </div>
          </div>
        </div>
      )}

      {lastBackup && (
        <div className="p-4 bg-muted dark:bg-muted/40 rounded-lg">
          <p className="text-sm text-muted-foreground dark:text-muted-foreground ">
            <span className="font-medium">{t('backupPanel.last-backup')}</span>{' '}
            {new Date(lastBackup).toLocaleString()}
          </p>
        </div>
      )}

      <IncludeKeysToggle t={t} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-6 bg-background dark:bg-muted/40 rounded-lg border border-border dark:border-border">
          <div className="flex items-center space-x-3 mb-4">
            <Upload className="w-8 h-8 text-muted-foreground dark:text-muted-foreground" />
            <div>
              <h4 className="font-medium text-foreground dark:text-foreground">
                {t('backupPanel.backup-data')}
              </h4>
              <p className="text-sm text-muted-foreground dark:text-muted-foreground">
                {t('backupPanel.backup-data-to-webdav')}
              </p>
            </div>
          </div>
          <Button
            onClick={backup}
            disabled={isBackingUp || !activeConfig}
            className="h-auto w-full flex items-center justify-center space-x-2 px-4 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isBackingUp ? (
              <RefreshCw className="w-5 h-5 animate-spin" />
            ) : (
              <Upload className="w-5 h-5" />
            )}
            <span>{isBackingUp ? t('backupPanel.backing-up') : t('backupPanel.start-backup')}</span>
          </Button>
        </div>

        <div className="p-6 bg-background dark:bg-muted/40 rounded-lg border border-border dark:border-border">
          <div className="flex items-center space-x-3 mb-4">
            <Download className="w-8 h-8 text-muted-foreground dark:text-muted-foreground" />
            <div>
              <h4 className="font-medium text-foreground dark:text-foreground">
                {t('backupPanel.restore-data')}
              </h4>
              <p className="text-sm text-muted-foreground dark:text-muted-foreground">
                {t('backupPanel.restore-data-from-webdav')}
              </p>
            </div>
          </div>
          <Button
            onClick={restore}
            disabled={isRestoring || !activeConfig}
            className="h-auto w-full flex items-center justify-center space-x-2 px-4 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isRestoring ? (
              <RefreshCw className="w-5 h-5 animate-spin" />
            ) : (
              <Download className="w-5 h-5" />
            )}
            <span>{isRestoring ? t('backupPanel.restoring') : t('backupPanel.start-restore')}</span>
          </Button>
        </div>
      </div>

      <div className="p-4 bg-background dark:bg-muted/40 rounded-lg">
        <h4 className="font-medium text-foreground dark:text-foreground mb-2">
          {t('backupPanel.backup-includes')}
        </h4>
        <ul className="text-sm text-muted-foreground dark:text-muted-foreground space-y-1">
          <li>• {t('backupPanel.github-stars-repository-list')}</li>
          <li>• {t('backupPanel.release-information')}</li>
          <li>• {t('backupPanel.custom-categories')}</li>
          <li>• {t('backupPanel.ai-service-configurations')}</li>
          <li>• {t('backupPanel.webdav-configurations')}</li>
          <li>• {t('backupPanel.release-subscriptions-sources-read-state')}</li>
        </ul>
      </div>
    </div>
  );
};
