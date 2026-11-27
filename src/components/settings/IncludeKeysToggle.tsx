import { TranslateFn } from '../../i18n/useT';
import { Key, ShieldAlert } from 'lucide-react';
import type { FC } from 'react';
import { useId } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { Switch } from '../ui/switch';
import { SettingsCard, SettingsDivider, SettingsRow } from './SettingsPrimitives';

interface IncludeKeysToggleProps {
  t: TranslateFn;
}

export const IncludeKeysToggle: FC<IncludeKeysToggleProps> = ({ t }) => {
  const { includeKeysInBackup, setIncludeKeysInBackup } = useAppStore(useShallow((state) => ({
    includeKeysInBackup: state.includeKeysInBackup,
    setIncludeKeysInBackup: state.setIncludeKeysInBackup,
  })));
  const label = t('includeKeysToggle.include-keys-in-backup-export');
  // 每实例稳定的 id（本组件在备份面板与数据管理面板各渲染一份，不能写死同一个 id）。
  const warningId = useId();

  return (
    <SettingsCard>
      <SettingsRow
        icon={<Key />}
        title={label}
        description={t('includeKeysToggle.includes-keys-for-ai-configs-webdav-proxy-remote')}
      >
        <Switch
          checked={includeKeysInBackup}
          onCheckedChange={setIncludeKeysInBackup}
          aria-label={label}
          aria-describedby={includeKeysInBackup ? warningId : undefined}
        />
      </SettingsRow>
      {/* 实时通知区域必须常驻挂载：若随开关条件卸载，读屏会漏播状态变化；改为在固定节点内切换内容。
        刻意不用 role="status"（裸 aria-live="polite" 播报行为一致）：.github/ui-preview/shoot.mjs
        把 main.app-main 内的 [role="status"] 视为未完成的 Suspense Loading 帧，会判截图就绪失败。 */}
      <div aria-live="polite">
        {includeKeysInBackup && (
          <>
            <SettingsDivider />
            <p
              id={warningId}
              className="flex items-start gap-2.5 bg-warning-tint px-3.5 py-2.5 text-label-sm leading-[18px] text-foreground"
            >
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
              <span>{t('includeKeysToggle.warning-backup-file-contains-plaintext-keys')}</span>
            </p>
          </>
        )}
      </div>
    </SettingsCard>
  );
};
