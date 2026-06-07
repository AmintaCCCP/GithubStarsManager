import React from 'react';
import { Key } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';

interface IncludeKeysToggleProps {
  t: (zh: string, en: string) => string;
}

export const IncludeKeysToggle: React.FC<IncludeKeysToggleProps> = ({ t }) => {
  const { includeKeysInBackup, setIncludeKeysInBackup } = useAppStore();

  return (
    <div className="p-4 bg-light-bg dark:bg-white/[0.04] rounded-lg border border-black/[0.06] dark:border-white/[0.04]">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Key className="w-5 h-5 text-gray-700 dark:text-text-secondary" />
          <div>
            <h4 className="font-medium text-gray-900 dark:text-text-primary">
              {t('备份/导出时包含密钥', 'Include keys in backup/export')}
            </h4>
            <p className="text-sm text-gray-500 dark:text-text-tertiary">
              {t(
                '包含 AI 配置、WebDAV、代理、远程下载和后端服务器的密钥',
                'Includes keys for AI configs, WebDAV, proxy, remote download, and backend server'
              )}
            </p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={includeKeysInBackup}
          aria-label={t('备份/导出时包含密钥', 'Include keys in backup/export')}
          onClick={() => setIncludeKeysInBackup(!includeKeysInBackup)}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
            includeKeysInBackup ? 'bg-brand-indigo' : 'bg-gray-300 dark:bg-gray-600'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
              includeKeysInBackup ? 'translate-x-[18px]' : 'translate-x-[2px]'
            }`}
          />
        </button>
      </div>
    </div>
  );
};
