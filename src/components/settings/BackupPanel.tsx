import { Button } from '../ui/button';
import React from 'react';
import { Download, Upload, RefreshCw, Cloud, AlertCircle } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { IncludeKeysToggle } from './IncludeKeysToggle';
import { useBackupActions } from '../../features/settings/hooks/useBackupActions';

interface BackupPanelProps {
  t: (zh: string, en: string) => string;
}

export const BackupPanel: React.FC<BackupPanelProps> = ({ t }) => {
  const lastBackup = useAppStore((state) => state.lastBackup);
  const { activeConfig, isBackingUp, isRestoring, backup, restore } = useBackupActions({ t });

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-3">
        <Cloud className="w-6 h-6 text-muted-foreground dark:text-muted-foreground" />
        <h3 className="text-lg font-semibold text-foreground dark:text-foreground">
          {t('备份与恢复', 'Backup & Restore')}
        </h3>
      </div>

      {!activeConfig && (
        <div className="p-4 bg-muted dark:bg-muted/40 rounded-lg border border-border dark:border-border">
          <div className="flex items-start space-x-3">
            <AlertCircle className="w-5 h-5 text-muted-foreground dark:text-muted-foreground mt-0.5" />
            <div>
              <p className="text-sm text-muted-foreground dark:text-muted-foreground ">
                {t('请先配置并激活WebDAV服务', 'Please configure and activate WebDAV service first')}
              </p>
              <p className="text-xs text-muted-foreground dark:text-muted-foreground mt-1">
                {t('备份和恢复功能需要WebDAV服务支持', 'Backup and restore features require WebDAV service')}
              </p>
            </div>
          </div>
        </div>
      )}

      {lastBackup && (
        <div className="p-4 bg-muted dark:bg-muted/40 rounded-lg">
          <p className="text-sm text-muted-foreground dark:text-muted-foreground ">
            <span className="font-medium">{t('上次备份:', 'Last backup:')}</span>{' '}
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
                {t('备份数据', 'Backup Data')}
              </h4>
              <p className="text-sm text-muted-foreground dark:text-muted-foreground">
                {t('将数据备份到WebDAV', 'Backup data to WebDAV')}
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
            <span>{isBackingUp ? t('备份中…', 'Backing up…') : t('开始备份', 'Start Backup')}</span>
          </Button>
        </div>

        <div className="p-6 bg-background dark:bg-muted/40 rounded-lg border border-border dark:border-border">
          <div className="flex items-center space-x-3 mb-4">
            <Download className="w-8 h-8 text-muted-foreground dark:text-muted-foreground" />
            <div>
              <h4 className="font-medium text-foreground dark:text-foreground">
                {t('恢复数据', 'Restore Data')}
              </h4>
              <p className="text-sm text-muted-foreground dark:text-muted-foreground">
                {t('从WebDAV恢复数据', 'Restore data from WebDAV')}
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
            <span>{isRestoring ? t('恢复中…', 'Restoring…') : t('开始恢复', 'Start Restore')}</span>
          </Button>
        </div>
      </div>

      <div className="p-4 bg-background dark:bg-muted/40 rounded-lg">
        <h4 className="font-medium text-foreground dark:text-foreground mb-2">
          {t('备份内容包括：', 'Backup includes:')}
        </h4>
        <ul className="text-sm text-muted-foreground dark:text-muted-foreground space-y-1">
          <li>• {t('GitHub Stars 仓库列表', 'GitHub Stars repository list')}</li>
          <li>• {t('Release 发布信息', 'Release information')}</li>
          <li>• {t('自定义分类', 'Custom categories')}</li>
          <li>• {t('AI 服务配置', 'AI service configurations')}</li>
          <li>• {t('WebDAV 配置', 'WebDAV configurations')}</li>
          <li>• {t('Release 订阅、来源与已读状态', 'Release subscriptions, sources & read state')}</li>
        </ul>
      </div>
    </div>
  );
};
