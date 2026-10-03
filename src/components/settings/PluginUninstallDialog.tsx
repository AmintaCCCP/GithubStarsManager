import React from 'react';
import type { TranslateFn } from '../../i18n/useT';
import type { InstalledPlugin } from '../../plugins/types';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';

interface PluginUninstallDialogProps {
  /** 卸载目标；null 时不渲染。 */
  target: InstalledPlugin | null;
  t: TranslateFn;
  onClose: () => void;
  /** removePluginData 表示是否连同插件的存储数据与日志一起删除。 */
  onUninstall: (removePluginData: boolean) => void;
}

/**
 * 插件卸载确认弹窗：本地插件与插件市场共用。
 * 三个出口——取消、保留数据卸载、连同数据卸载。
 */
export const PluginUninstallDialog: React.FC<PluginUninstallDialogProps> = ({ target, t, onClose, onUninstall }) => (
  <AlertDialog open={target !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>
          {t('pluginSettingsPanel.uninstall-v1', { v1: target?.manifest.name ?? '' })}
        </AlertDialogTitle>
        <AlertDialogDescription className="whitespace-pre-wrap break-all">
          {t('pluginSettingsPanel.the-installed-plugin-directory-is-deleted-choose')}
          {target ? `\n\n${target.manifest.id}` : ''}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>{t('pluginSettingsPanel.cancel')}</AlertDialogCancel>
        <AlertDialogAction onClick={() => onUninstall(false)}>
          {t('pluginSettingsPanel.uninstall-keep-data')}
        </AlertDialogAction>
        <AlertDialogAction
          className="bg-destructive hover:bg-destructive/90"
          onClick={() => onUninstall(true)}
        >
          {t('pluginSettingsPanel.uninstall-and-delete-data')}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);
