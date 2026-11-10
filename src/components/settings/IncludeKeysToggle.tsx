
import { TranslateFn } from '../../i18n/useT';
import { Key, ShieldAlert } from 'lucide-react';
import type { FC } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { Switch } from '../ui/switch';

interface IncludeKeysToggleProps {
  t: TranslateFn;
}

export const IncludeKeysToggle: FC<IncludeKeysToggleProps> = ({ t }) => {
  const { includeKeysInBackup, setIncludeKeysInBackup } = useAppStore(useShallow((state) => ({
    includeKeysInBackup: state.includeKeysInBackup,
    setIncludeKeysInBackup: state.setIncludeKeysInBackup,
  })));
  const label = t('includeKeysToggle.include-keys-in-backup-export');

  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <Key className="h-4 w-4 text-muted-foreground" />
          <div>
            <h4 className="text-sm font-medium text-foreground">{label}</h4>
            <p className="text-sm text-muted-foreground">{t('includeKeysToggle.includes-keys-for-ai-configs-webdav-proxy-remote')}</p>
          </div>
        </div>
        <Switch checked={includeKeysInBackup} onCheckedChange={setIncludeKeysInBackup} aria-label={label} />
      </div>
      {includeKeysInBackup && (
        <p className="mt-3 flex items-start gap-1.5 text-sm text-amber-600 dark:text-amber-500">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{t('includeKeysToggle.warning-backup-file-contains-plaintext-keys')}</span>
        </p>
      )}
    </div>
  );
};
