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
  const language = useAppStore((state) => state.language);
  const syncModeConfigured = useAppStore((state) => state.syncModeConfigured);
  const setSyncMode = useAppStore((state) => state.setSyncMode);
  const setSyncModeConfigured = useAppStore((state) => state.setSyncModeConfigured);

  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
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
          <AlertDialogTitle>{t('选择同步范围', 'Choose sync scope')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('您希望同步哪些数据？此选择可在设置中随时切换。', 'What should be synced? You can change this anytime in Settings.')}
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
              <span className="block font-medium">{t('仅同步星标仓库', 'Starred repos only')}</span>
              <span className="mt-1 block text-xs font-normal text-muted-foreground dark:text-muted-foreground">
                {t('同步你的全部星标仓库（默认，与以前行为一致）。', 'Sync all your starred repositories (default, same as before).')}
              </span>
            </span>
          </AlertDialogAction>
          <AlertDialogAction
            onClick={() => handleChooseSyncMode('stars-and-lists')}
            className={optionClassName}
          >
            <ListChecks className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <span>
              <span className="block font-medium">{t('同步星标仓库及 list', 'Starred repos & lists')}</span>
              <span className="mt-1 block text-xs font-normal text-muted-foreground dark:text-muted-foreground">
                {t('除星标仓库外，还将拉取你的 Lists（星标列表）并按标签归类；未锁定分类的仓库会被自动锁定。', 'Also fetch your Lists and categorize by tags; unlocked repos will be auto-locked.')}
              </span>
            </span>
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default SyncModeChoiceModal;
