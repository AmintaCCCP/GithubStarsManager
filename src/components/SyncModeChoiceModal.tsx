



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
  const optionClassName = '!h-auto min-h-[68px] w-full items-start justify-start gap-3 whitespace-normal rounded-lg border-0 bg-raised p-3.5 text-left text-foreground shadow-elev-1 transition-[background-color] duration-micro ease-out-subtle hover:bg-fill-hover hover:text-foreground hover:duration-instant';

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
        className="max-w-md rounded-xl border-0 bg-floating p-5 shadow-elev-3"
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{t('syncModeChoiceModal.choose-sync-scope')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('syncModeChoiceModal.what-should-be-synced-you-can-change-this-anytim')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2.5">
          <AlertDialogAction
            ref={firstActionRef}
            onClick={() => handleChooseSyncMode('stars')}
            className={optionClassName}
          >
            <Star className="mt-0.5 size-4 shrink-0 text-accent-text" />
            <span>
              <span className="block text-label font-medium text-foreground">{t('syncModeChoiceModal.starred-repos-only')}</span>
              <span className="mt-0.5 block text-label-sm font-normal text-secondary">
                {t('syncModeChoiceModal.sync-all-your-starred-repositories-default-same')}
              </span>
            </span>
          </AlertDialogAction>
          <AlertDialogAction
            onClick={() => handleChooseSyncMode('stars-and-lists')}
            className={optionClassName}
          >
            <ListChecks className="mt-0.5 size-4 shrink-0 text-accent-text" />
            <span>
              <span className="block text-label font-medium text-foreground">{t('syncModeChoiceModal.starred-repos-lists')}</span>
              <span className="mt-0.5 block text-label-sm font-normal text-secondary">
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
