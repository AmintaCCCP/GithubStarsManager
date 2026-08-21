import React, { useState } from 'react';
import { Calendar, Download, ExternalLink, Package, RefreshCw } from 'lucide-react';
import { UpdateService, VersionInfo } from '../services/updateService';
import { useAppStore } from '../store/useAppStore';
import { useDialog } from '../hooks/useDialog';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';

interface UpdateCheckerProps {
  onUpdateAvailable?: (version: VersionInfo) => void;
}

export const UpdateChecker: React.FC<UpdateCheckerProps> = ({ onUpdateAvailable }) => {
  const { language, setUpdateNotification } = useAppStore();
  const { toast } = useDialog();
  const [isChecking, setIsChecking] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<VersionInfo | null>(null);
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

  const checkForUpdates = async (silent = false) => {
    setIsChecking(true);
    setError(null);
    try {
      const result = await UpdateService.checkForUpdates();
      if (result.hasUpdate && result.latestVersion) {
        setUpdateInfo(result.latestVersion);
        setShowUpdateDialog(true);
        onUpdateAvailable?.(result.latestVersion);
        setUpdateNotification({
          version: result.latestVersion.number,
          releaseDate: result.latestVersion.releaseDate,
          changelog: result.latestVersion.changelog,
          downloadUrl: result.latestVersion.downloadUrl,
          dismissed: false,
        });
      } else if (!silent) {
        toast(t('当前已是最新版本！', 'You are already using the latest version!'), 'info');
      }
    } catch (error) {
      const errorMessage = t('检查更新失败，请检查网络连接', 'Failed to check for updates. Please check your network connection.');
      setError(errorMessage);
      if (!silent) toast(errorMessage, 'error');
      console.error('Update check failed:', error);
    } finally {
      setIsChecking(false);
    }
  };

  const handleDownload = () => {
    if (updateInfo?.downloadUrl) {
      UpdateService.openDownloadUrl(updateInfo.downloadUrl);
      setShowUpdateDialog(false);
    }
  };

  const formatDate = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleDateString(language === 'zh' ? 'zh-CN' : 'en-US');
    } catch {
      return dateString;
    }
  };

  return (
    <>
      <Button type="button" onClick={() => checkForUpdates(false)} disabled={isChecking} className="gap-2">
        {isChecking ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        <span>{isChecking ? t('检查中...', 'Checking...') : t('检查更新', 'Check for Updates')}</span>
      </Button>

      {error && <div className="mt-2 rounded-lg border border-border bg-muted p-3 dark:border-border dark:bg-muted/40"><p className="text-sm text-muted-foreground dark:text-muted-foreground">{error}</p></div>}

      <Dialog open={showUpdateDialog} onOpenChange={setShowUpdateDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/20"><Package className="h-6 w-6 text-primary" /></div>
              <div><DialogTitle>{t('发现新版本', 'New Version Available')}</DialogTitle><DialogDescription>v{updateInfo?.number}</DialogDescription></div>
            </div>
          </DialogHeader>
          {updateInfo && <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground dark:text-muted-foreground"><Calendar className="h-4 w-4" /><span>{t('发布日期:', 'Release Date:')} {formatDate(updateInfo.releaseDate)}</span></div>
            <div>
              <h4 className="mb-2 font-medium text-foreground dark:text-foreground">{t('更新内容:', "What's New:")}</h4>
              <ul className="space-y-1">{updateInfo.changelog.map((item, index) => <li key={index} className="flex items-start gap-2 text-sm text-muted-foreground dark:text-muted-foreground"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-violet" /><span>{item}</span></li>)}</ul>
            </div>
          </div>}
          <DialogFooter>
            <Button type="button" onClick={handleDownload} className="gap-2"><ExternalLink className="h-4 w-4" /><span>{t('立即下载', 'Download Now')}</span></Button>
            <Button type="button" variant="outline" onClick={() => setShowUpdateDialog(false)}>{t('稍后提醒', 'Later')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
