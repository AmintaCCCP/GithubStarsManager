import React, { useState, useEffect } from 'react';
import { Clock, RotateCw, AlertCircle, CheckCircle2 } from 'lucide-react';
import { backend } from '../../services/backendAdapter';
import { useAppStore } from '../../store/useAppStore';
import { useDialog } from '../../hooks/useDialog';

interface AutoBackupPanelProps {
  t: (zh: string, en: string) => string;
}

export const AutoBackupPanel: React.FC<AutoBackupPanelProps> = ({ t }) => {
  const { webdavConfigs, activeWebDAVConfig } = useAppStore();
  const { toast } = useDialog();

  const [enabled, setEnabled] = useState(false);
  const [intervalHours, setIntervalHours] = useState(24);
  const [retentionCount, setRetentionCount] = useState(30);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [triggering, setTriggering] = useState(false);

  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [nextBackup, setNextBackup] = useState<string | null>(null);
  const [activeConfigName, setActiveConfigName] = useState<string | null>(null);

  const activeConfig = webdavConfigs.find(c => c.id === activeWebDAVConfig);

  useEffect(() => {
    loadSettings();
    loadStatus();
  }, []);

  const loadSettings = async () => {
    try {
      if (!backend.isAvailable) { setLoading(false); return; }
      const settings = await backend.fetchBackupSettings();
      setEnabled(settings.auto_backup_enabled);
      setIntervalHours(settings.auto_backup_interval_hours);
      setRetentionCount(settings.auto_backup_retention_count);
    } catch {
      // silent fail
    } finally {
      setLoading(false);
    }
  };

  const loadStatus = async () => {
    try {
      if (!backend.isAvailable) return;
      const status = await backend.fetchBackupStatus();
      setLastBackup(status.lastBackupTime);
      setNextBackup(status.nextScheduledTime);
      setActiveConfigName(status.activeConfigName);
    } catch {
      // silent fail
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await backend.updateBackupSettings({
        auto_backup_enabled: enabled,
        auto_backup_interval_hours: intervalHours,
        auto_backup_retention_count: retentionCount,
      });
      await loadStatus();
      toast(
        t('自动备份设置已保存', 'Auto backup settings saved'),
        'success'
      );
    } catch (err) {
      toast(
        t(`保存失败: ${err instanceof Error ? err.message : '未知错误'}`, `Failed to save: ${err instanceof Error ? err.message : 'Unknown error'}`),
        'error'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleTrigger = async () => {
    setTriggering(true);
    try {
      const result = await backend.triggerBackup();
      if (result.success) {
        toast(
          t(`备份成功: ${result.message}`, `Backup successful: ${result.message}`),
          'success'
        );
      } else {
        toast(
          t(`备份失败: ${result.message}`, `Backup failed: ${result.message}`),
          'error'
        );
      }
      await loadStatus();
    } catch (err) {
      toast(
        t(`触发备份失败: ${err instanceof Error ? err.message : '未知错误'}`, `Trigger backup failed: ${err instanceof Error ? err.message : 'Unknown error'}`),
        'error'
      );
    } finally {
      setTriggering(false);
    }
  };

  const formatTime = (iso: string | null): string => {
    if (!iso) return t('暂无', 'None');
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  };

  if (loading) {
    return (
      <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
        <div className="animate-pulse h-4 w-32 bg-gray-300 dark:bg-gray-600 rounded" />
      </div>
    );
  }

  const noActiveConfig = !activeConfig;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Clock className="w-5 h-5 text-gray-600 dark:text-gray-400" />
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t('自动备份', 'Auto Backup')}
        </h3>
      </div>

      {noActiveConfig && (
        <div className="flex items-start gap-2 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg text-sm text-yellow-800 dark:text-yellow-200">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{t(
            '请先在 WebDAV 设置中激活一个配置以启用自动备份。',
            'Please activate a WebDAV configuration first to enable auto backup.'
          )}</span>
        </div>
      )}

      {/* Enable toggle */}
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('启用自动备份', 'Enable Auto Backup')}
        </label>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          disabled={noActiveConfig}
          onClick={() => setEnabled(!enabled)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
            noActiveConfig ? 'opacity-50 cursor-not-allowed' : ''
          } ${enabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'}`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              enabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* Interval */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t('备份间隔（小时）', 'Backup Interval (Hours)')}
        </label>
        <input
          type="number"
          min={1}
          max={720}
          value={intervalHours}
          onChange={(e) => setIntervalHours(Math.max(1, Math.min(720, parseInt(e.target.value) || 24)))}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {t('范围: 1-720 小时 (最多30天)', 'Range: 1-720 hours (up to 30 days)')}
        </p>
      </div>

      {/* Retention */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t('保留最近份数', 'Retention Count')}
        </label>
        <input
          type="number"
          min={0}
          max={365}
          value={retentionCount}
          onChange={(e) => setRetentionCount(Math.max(0, Math.min(365, parseInt(e.target.value) || 0)))}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {t('0 = 不限制, 最大 365 份', '0 = unlimited, max 365')}
        </p>
      </div>

      {/* Save button */}
      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex items-center justify-center gap-2"
      >
        <RotateCw className={`w-4 h-4 ${saving ? 'animate-spin' : ''}`} />
        {saving ? t('保存中...', 'Saving...') : t('保存设置', 'Save Settings')}
      </button>

      {/* Status */}
      <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg space-y-2 text-sm">
        <div className="flex items-center gap-2">
          {enabled ? (
            <CheckCircle2 className="w-4 h-4 text-green-500" />
          ) : (
            <AlertCircle className="w-4 h-4 text-gray-400" />
          )}
          <span className="text-gray-600 dark:text-gray-400">
            {t('状态', 'Status')}: {enabled ? t('已启用', 'Enabled') : t('已禁用', 'Disabled')}
          </span>
        </div>
        {activeConfigName && (
          <div className="text-gray-600 dark:text-gray-400">
            {t('活跃配置', 'Active Config')}: {activeConfigName}
          </div>
        )}
        <div className="text-gray-600 dark:text-gray-400">
          {t('上次备份', 'Last Backup')}: {formatTime(lastBackup)}
        </div>
        {enabled && nextBackup && (
          <div className="text-gray-600 dark:text-gray-400">
            {t('下次备份', 'Next Backup')}: {formatTime(nextBackup)}
          </div>
        )}
      </div>

      {/* Trigger button */}
      <button
        onClick={handleTrigger}
        disabled={triggering || !activeConfig}
        className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed text-gray-700 dark:text-gray-300 rounded-lg transition-colors flex items-center justify-center gap-2"
      >
        <RotateCw className={`w-4 h-4 ${triggering ? 'animate-spin' : ''}`} />
        {triggering ? t('备份中...', 'Backing up...') : t('立即备份', 'Backup Now')}
      </button>
    </div>
  );
};
