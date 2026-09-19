



import { useT } from '../i18n/useT';
import { ListChecks, Star } from 'lucide-react';
import React, { useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';

/**
 * 首次登录 / 首次使用 GitHub Lists 同步时，选择同步范围。
 * 必须渲染在已认证的组件树内（例如 App 的已登录 shell），
 * 不能在 LoginScreen 里触发——因为 setUser 后 LoginScreen 会被卸载，弹窗无法显示。
 *
 * 该弹窗是阻塞式（blocking）模态：必须完成选择，不可关闭、不可点背景跳过。
 */
export const SyncModeChoiceModal: React.FC = () => {
  const syncModeConfigured = useAppStore((state) => state.syncModeConfigured);
  const setSyncMode = useAppStore((state) => state.setSyncMode);
  const setSyncModeConfigured = useAppStore((state) => state.setSyncModeConfigured);

  const t = useT('app');
  const isOpen = !syncModeConfigured;
  const firstActionRef = useRef<HTMLButtonElement>(null);
  const optionClassName = 'h-auto w-full justify-start gap-3 whitespace-normal rounded-xl border border-border bg-card p-4 text-left text-foreground shadow-none hover:border-primary/40 hover:bg-card dark:border-border dark:bg-muted/40 dark:text-foreground dark:hover:bg-accent';

  const handleChooseSyncMode = (mode: 'stars' | 'stars-and-lists') => {
    setSyncMode(mode);
    setSyncModeConfigured(true);
  };

  return (
    <AlertDialog open={isOpen} onOpenChange={() => undefined}>
      <AlertDialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          firstActionRef.current?.focus();
        }}
        onEscapeKeyDown={(event) => event.preventDefault()}
        className="max-w-md p-6 sm:p-7"
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{t('syncModeChoiceModal.choose-sync-scope')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('syncModeChoiceModal.what-should-be-synced-you-can-change-this-anytim')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-3">
          <AlertDialogAction
            ref={firstActionRef}
            onClick={() => handleChooseSyncMode('stars')}
            className={optionClassName}
          >
            <Star className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <span>
              <span className="block font-medium">{t('syncModeChoiceModal.starred-repos-only')}</span>
              <span className="mt-1 block text-xs font-normal text-muted-foreground dark:text-muted-foreground">
                {t('syncModeChoiceModal.sync-all-your-starred-repositories-default-same')}
              </span>
            </span>
          </AlertDialogAction>
          <AlertDialogAction
            onClick={() => handleChooseSyncMode('stars-and-lists')}
            className={optionClassName}
          >
            <ListChecks className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <span>
              <span className="block font-medium">{t('syncModeChoiceModal.starred-repos-lists')}</span>
              <span className="mt-1 block text-xs font-normal text-muted-foreground dark:text-muted-foreground">
                {t('syncModeChoiceModal.also-fetch-your-lists-and-categorize-by-tags-unl')}
              </span>
            </span>
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default SyncModeChoiceModal;
