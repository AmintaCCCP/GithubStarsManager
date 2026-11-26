import { getIntlLocale } from '../i18n/format';
import { useT } from "../i18n/useT";
import { Calendar, Download, Package, X } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { useUpdateActions } from '../features/settings/hooks/useUpdateActions';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

export const UpdateNotificationBanner: React.FC = () => {
  const { updateNotification, dismissUpdateNotification, language } = useAppStore(useShallow((state) => ({
    updateNotification: state.updateNotification,
    dismissUpdateNotification: state.dismissUpdateNotification,
    language: state.language,
  })));
  const t = useT('app');
  const { openDownloadUrl } = useUpdateActions();

  if (!updateNotification || updateNotification.dismissed) return null;

  const handleDownload = () => {
    openDownloadUrl(updateNotification.downloadUrl);
    dismissUpdateNotification();
  };

  const formatDate = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleDateString(getIntlLocale(language));
    } catch {
      return dateString;
    }
  };

  return (
    <div className="border-b border-subtle bg-paper px-3 py-2 sm:px-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-accent-tint text-accent-text">
            <Package className="size-4" />
          </div>
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
            <h4 className="truncate text-label font-medium text-foreground">
              {t('updateNotificationBanner.new-version-available')} v{updateNotification.version}
            </h4>
            <div className="flex items-center gap-1 text-label-sm text-tertiary tabular-nums">
              <Calendar className="size-3 shrink-0" />
              <span>{formatDate(updateNotification.releaseDate)}</span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button type="button" variant="primary" size="sm" onClick={handleDownload}>
            <Download className="size-3.5" />
            <span>{t('updateNotificationBanner.download')}</span>
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={dismissUpdateNotification}
                aria-label={t('updateNotificationBanner.close')}
                className="text-secondary hover:text-foreground"
              >
                <X className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('updateNotificationBanner.close')}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
};
