import { Key } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { Switch } from '../ui/switch';

interface IncludeKeysToggleProps {
  t: (zh: string, en: string) => string;
}

export const IncludeKeysToggle: React.FC<IncludeKeysToggleProps> = ({ t }) => {
  const { includeKeysInBackup, setIncludeKeysInBackup } = useAppStore();
  const label = t('备份/导出时包含密钥', 'Include keys in backup/export');

  return (
    <div className="rounded-lg border border-border bg-background p-4 dark:border-border dark:bg-muted/40">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <Key className="h-5 w-5 text-muted-foreground dark:text-muted-foreground" />
          <div>
            <h4 className="font-medium text-foreground dark:text-foreground">{label}</h4>
            <p className="text-sm text-muted-foreground dark:text-muted-foreground">{t('包含 AI 配置、WebDAV、代理、远程下载和后端服务器的密钥', 'Includes keys for AI configs, WebDAV, proxy, remote download, and backend server')}</p>
          </div>
        </div>
        <Switch checked={includeKeysInBackup} onCheckedChange={setIncludeKeysInBackup} aria-label={label} />
      </div>
    </div>
  );
};
