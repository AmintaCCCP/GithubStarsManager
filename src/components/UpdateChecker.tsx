import { getIntlLocale } from '../i18n/format';
import { useT } from '../i18n/useT';
import React, { useState } from 'react';
import { Calendar, Download, ExternalLink, Package, RefreshCw } from 'lucide-react';
import { useUpdateActions, type VersionInfo } from '../features/settings/hooks/useUpdateActions';
import { useAppStore } from '../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { useDialog } from '../hooks/useDialog';
import { useScrollbarFlash } from '../hooks/useScrollbarFlash';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';

interface UpdateCheckerProps {
  onUpdateAvailable?: (version: VersionInfo) => void;
}

export const UpdateChecker: React.FC<UpdateCheckerProps> = ({ onUpdateAvailable }) => {
  const { language, setUpdateNotification, setUpdatePromptDismissedVersion } = useAppStore(useShallow((state) => ({
    language: state.language,
    setUpdateNotification: state.setUpdateNotification,
    setUpdatePromptDismissedVersion: state.setUpdatePromptDismissedVersion,
  })));
  const { toast } = useDialog();
  const { checkForUpdates: checkForUpdatesRemote, openDownloadUrl } = useUpdateActions();
  const [isChecking, setIsChecking] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<VersionInfo | null>(null);
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { isScrolling: isChangelogScrolling, handleScroll: handleChangelogScroll } = useScrollbarFlash(showUpdateDialog);

  const t = useT('app');

  const checkForUpdates = async (silent = false) => {
    setIsChecking(true);
    setError(null);
    try {
      const result = await checkForUpdatesRemote();
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
        toast(t('updateChecker.you-are-already-using-the-latest-version'), 'info');
      }
    } catch (err) {
      const errorMessage = t('updateChecker.failed-to-check-for-updates-please-check-your-ne');
      setError(errorMessage);
      if (!silent) toast(errorMessage, 'error');
      console.error('Update check failed:', err);
    } finally {
      setIsChecking(false);
    }
  };

  const handleDownload = () => {
    if (updateInfo?.downloadUrl) {
      openDownloadUrl(updateInfo.downloadUrl);
      setShowUpdateDialog(false);
    }
  };

  const handleDontRemind = () => {
    if (updateInfo) {
      setUpdatePromptDismissedVersion(updateInfo.number);
      setUpdateNotification(null);
    }
    setShowUpdateDialog(false);
  };

  const formatDate = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleDateString(getIntlLocale(language));
    } catch {
      return dateString;
    }
  };

  return (
    <>
      <div className="flex flex-col items-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="md"
          onClick={() => checkForUpdates(false)}
          disabled={isChecking}
        >
          {isChecking ? <RefreshCw className="size-4 animate-spin" /> : <Download className="size-4" />}
          <span>{isChecking ? t('updateChecker.checking') : t('updateChecker.check-for-updates')}</span>
        </Button>

        {error && (
          <div role="alert" className="rounded-md bg-destructive-tint px-3 py-2 text-label-sm text-destructive">
            {error}
          </div>
        )}
      </div>

      <Dialog open={showUpdateDialog} onOpenChange={setShowUpdateDialog}>
        <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col gap-0 overflow-hidden p-0" closeLabel={t('updateChecker.close')}>
          <DialogHeader className="shrink-0 space-y-2.5 border-b border-subtle px-6 py-5 pr-12">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-accent-tint text-accent-text">
                <Package className="size-5" />
              </div>
              <div>
                <DialogTitle>{t('updateChecker.new-version-available')}</DialogTitle>
                <DialogDescription className="tabular-nums">v{updateInfo?.number}</DialogDescription>
              </div>
            </div>
            {updateInfo && (
              <div className="flex items-center gap-2 text-label-sm text-secondary">
                <Calendar className="size-3.5 text-tertiary" />
                <span>{t('updateChecker.release-date')} {formatDate(updateInfo.releaseDate)}</span>
              </div>
            )}
          </DialogHeader>
          {updateInfo && (
            <div
              className={cn('min-h-0 flex-1 overflow-y-auto px-6 py-5 scrollbar-on-scroll', isChangelogScrolling && 'scrolling')}
              onScroll={handleChangelogScroll}
              tabIndex={0}
              role="region"
              aria-label={t('updateChecker.what-s-new')}
            >
              <h4 className="mb-2.5 text-label font-medium text-foreground">{t('updateChecker.what-s-new')}</h4>
              <ul className="space-y-1.5">
                {updateInfo.changelog.map((item, index) => (
                  <li key={index} className="flex items-start gap-2.5 text-label text-secondary">
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-accent-solid" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <DialogFooter className="shrink-0 border-t border-subtle px-6 py-3.5">
            <Button type="button" variant="ghost" onClick={handleDontRemind}>
              {t('updateChecker.dont-remind-again')}
            </Button>
            <Button type="button" variant="outline" onClick={() => setShowUpdateDialog(false)}>
              {t('updateChecker.later')}
            </Button>
            <Button type="button" variant="primary" onClick={handleDownload}>
              <ExternalLink className="size-4" />
              <span>{t('updateChecker.download-now')}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
