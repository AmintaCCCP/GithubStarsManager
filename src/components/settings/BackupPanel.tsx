
import { TranslateFn } from '../../i18n/useT';
import { Button } from '../ui/button';
import React, { useState } from 'react';
import { Download, Upload, RefreshCw, Cloud, AlertCircle } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { IncludeKeysToggle } from './IncludeKeysToggle';
import { useBackupActions } from '../../features/settings/hooks/useBackupActions';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { ScrollArea } from '../ui/scroll-area';

interface BackupPanelProps {
  t: TranslateFn;
}

/**
 * WebDAV 备份/恢复面板。
 * 审计修复（C46）：恢复不再始终下载排序后最新的备份——点击恢复先列出
 * WebDAV 上可恢复的备份供用户选择（预选包含当前账号工作区的最新备份，
 * 标 ★），选中后才进入恢复确认与下载流程。
 */
export const BackupPanel: React.FC<BackupPanelProps> = ({ t }) => {
  const lastBackup = useAppStore((state) => state.lastBackup);
  const { activeConfig, isBackingUp, isRestoring, backup, restore, listBackups } = useBackupActions();
  const [isListingBackups, setIsListingBackups] = useState(false);
  const [backupSelection, setBackupSelection] = useState<{
    open: boolean;
    files: string[];
    recommended: string | null;
    selected: string | null;
  }>({ open: false, files: [], recommended: null, selected: null });
  const [listError, setListError] = useState<string | null>(null);

  const handleRestoreClick = async () => {
    setIsListingBackups(true);
    setListError(null);
    try {
      const { files, recommended } = await listBackups();
      if (files.length === 0) {
        // 无备份文件：走恢复流程给出既有的 no-backup-files-found 提示
        await restore();
        return;
      }
      setBackupSelection({
        open: true,
        files,
        recommended,
        selected: recommended ?? files[files.length - 1],
      });
    } catch (error) {
      setListError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsListingBackups(false);
    }
  };

  const confirmRestoreSelection = async () => {
    const selected = backupSelection.selected;
    setBackupSelection((current) => ({ ...current, open: false }));
    if (selected) {
      await restore(selected);
    }
  };

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

      {listError && (
        <div className="p-4 bg-destructive/10 border border-destructive/30 rounded-lg text-sm text-destructive">
          {listError}
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
            onClick={() => void handleRestoreClick()}
            disabled={isRestoring || isListingBackups || !activeConfig}
            className="h-auto w-full flex items-center justify-center space-x-2 px-4 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isRestoring || isListingBackups ? (
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

      <Dialog open={backupSelection.open} onOpenChange={(open) => setBackupSelection((current) => ({ ...current, open }))}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('backupPanel.restore-data')}</DialogTitle>
            <DialogDescription>
              {t('backupPanel.restore-data-from-webdav')}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-72 rounded-md border border-border">
            <div className="flex flex-col gap-1 p-2">
              {[...backupSelection.files].reverse().map((file) => (
                <button
                  key={file}
                  type="button"
                  onClick={() => setBackupSelection((current) => ({ ...current, selected: file }))}
                  className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                    backupSelection.selected === file
                      ? 'bg-accent text-accent-foreground'
                      : 'hover:bg-accent/60 text-foreground'
                  }`}
                >
                  <span className="block truncate">
                    {file === backupSelection.recommended ? '★ ' : ''}{file}
                  </span>
                </button>
              ))}
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setBackupSelection((current) => ({ ...current, open: false }))}
            >
              {t('useDialog.cancel')}
            </Button>
            <Button onClick={() => void confirmRestoreSelection()} disabled={!backupSelection.selected}>
              {t('backupPanel.start-restore')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
