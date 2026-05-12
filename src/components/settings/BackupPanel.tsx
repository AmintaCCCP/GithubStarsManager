import React, { useState, useEffect } from 'react';
import { Download, Upload, RefreshCw, Cloud, AlertCircle, Clock, CheckCircle2, RotateCw } from 'lucide-react';
import { AIConfig, WebDAVConfig } from '../../types';
import { useAppStore } from '../../store/useAppStore';
import { WebDAVService } from '../../services/webdavService';
import { backend } from '../../services/backendAdapter';
import { useDialog } from '../../hooks/useDialog';

interface BackupPanelProps {
  t: (zh: string, en: string) => string;
}

export const BackupPanel: React.FC<BackupPanelProps> = ({ t }) => {
  const {
    repositories,
    releases,
    customCategories,
    hiddenDefaultCategoryIds,
    aiConfigs,
    webdavConfigs,
    activeWebDAVConfig,
    lastBackup,
    setLastBackup,
    setRepositories,
    setReleases,
    addCustomCategory,
    deleteCustomCategory,
    hideDefaultCategory,
    showDefaultCategory,
    addAIConfig,
    updateAIConfig,
    deleteAIConfig,
    addWebDAVConfig,
    updateWebDAVConfig,
    deleteWebDAVConfig,
  } = useAppStore();

  const { toast, confirm } = useDialog();

  const activeConfig = webdavConfigs.find(config => config.id === activeWebDAVConfig);
  const noActiveConfig = !activeConfig;

  // ─── 自动备份状态 ───
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [intervalHours, setIntervalHours] = useState(24);
  const [retentionCount, setRetentionCount] = useState(30);
  const [autoLoading, setAutoLoading] = useState(true);
  const [autoSaving, setAutoSaving] = useState(false);

  // 上次/下次备份（从后端状态获取）
  const [backendLastBackup, setBackendLastBackup] = useState<string | null>(null);
  const [nextBackup, setNextBackup] = useState<string | null>(null);
  const [activeConfigName, setActiveConfigName] = useState<string | null>(null);

  // ─── 手动操作状态 ───
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [backupFiles, setBackupFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>('');
  const [loadingFiles, setLoadingFiles] = useState(false);

  // ─── 加载自动备份设置和状态 ───
  useEffect(() => {
    loadAutoSettings();
    loadAutoStatus();
  }, []);

  const loadAutoSettings = async () => {
    try {
      if (!backend.isAvailable) { setAutoLoading(false); return; }
      const settings = await backend.fetchBackupSettings();
      setAutoEnabled(settings.auto_backup_enabled);
      setIntervalHours(settings.auto_backup_interval_hours);
      setRetentionCount(settings.auto_backup_retention_count);
    } catch {
      // silent
    } finally {
      setAutoLoading(false);
    }
  };

  const loadAutoStatus = async () => {
    try {
      if (!backend.isAvailable) return;
      const status = await backend.fetchBackupStatus();
      setBackendLastBackup(status.lastBackupTime);
      setNextBackup(status.nextScheduledTime);
      setActiveConfigName(status.activeConfigName);
    } catch {
      // silent
    }
  };

  const saveAutoSettings = async () => {
    if (!backend.isAvailable) {
      toast(t('后端服务不可用，无法保存设置', 'Backend not available, cannot save settings'), 'error');
      return;
    }
    setAutoSaving(true);
    try {
      await backend.updateBackupSettings({
        auto_backup_enabled: autoEnabled,
        auto_backup_interval_hours: intervalHours,
        auto_backup_retention_count: retentionCount,
      });
      await loadAutoStatus();
      toast(t('自动备份设置已保存', 'Auto backup settings saved'), 'success');
    } catch (err) {
      toast(
        t(`保存失败: ${err instanceof Error ? err.message : '未知错误'}`, `Failed to save: ${err instanceof Error ? err.message : 'Unknown error'}`),
        'error'
      );
    } finally {
      setAutoSaving(false);
    }
  };

  const triggerBackup = async () => {
    setIsBackingUp(true);
    try {
      // 优先使用后端触发（含保留策略清理）
      if (backend.isAvailable) {
        const result = await backend.triggerBackup();
        if (result.success) {
          setLastBackup(new Date().toISOString());
          await loadAutoStatus();
          toast(t(`备份成功: ${result.message}`, `Backup successful: ${result.message}`), 'success');
        } else {
          toast(t(`备份失败: ${result.message}`, `Backup failed: ${result.message}`), 'error');
        }
        return;
      }

      // 回退：前端直传 WebDAV
      if (!activeConfig) {
        toast(t('请先配置并激活WebDAV服务。', 'Please configure and activate WebDAV service first.'), 'error');
        return;
      }
      const webdavService = new WebDAVService(activeConfig);
      const backupData = {
        repositories,
        releases,
        customCategories,
        hiddenDefaultCategoryIds,
        aiConfigs: aiConfigs.map(config => ({ ...config, apiKey: config.apiKey ? '***' : '' })),
        webdavConfigs: webdavConfigs.map(config => ({ ...config, password: config.password ? '***' : '' })),
        exportedAt: new Date().toISOString(),
        version: '1.0'
      };
      const filename = `github-stars-backup-${new Date().toISOString().split('T')[0]}.json`;
      const success = await webdavService.uploadFile(filename, JSON.stringify(backupData, null, 2));
      if (success) {
        setLastBackup(new Date().toISOString());
        toast(t('数据备份成功！', 'Data backup successful!'), 'success');
      } else {
        toast(t('数据备份失败！', 'Data backup failed!'), 'error');
      }
    } catch (error) {
      console.error('Backup failed:', error);
      toast(`${t('备份失败', 'Backup failed')}: ${(error as Error).message}`, 'error');
    } finally {
      setIsBackingUp(false);
    }
  };

  // ─── 加载备份文件列表 ───
  const loadBackupFiles = async () => {
    if (!activeConfig) {
      toast(t('请先配置并激活WebDAV服务。', 'Please configure and activate WebDAV service first.'), 'error');
      return;
    }
    setLoadingFiles(true);
    try {
      const webdavService = new WebDAVService(activeConfig);
      const files = await webdavService.listFiles();
      const backupFiles = files
        .filter(file => file.startsWith('github-stars-backup-') && file.endsWith('.json'))
        .sort()
        .reverse();
      setBackupFiles(backupFiles);
      if (backupFiles.length > 0 && !selectedFile) {
        setSelectedFile(backupFiles[0]);
      }
    } catch (error) {
      toast(`${t('获取备份列表失败', 'Failed to load backup list')}: ${(error as Error).message}`, 'error');
    } finally {
      setLoadingFiles(false);
    }
  };

  // ─── 恢复 ───
  const handleRestore = async () => {
    if (!activeConfig) {
      toast(t('请先配置并激活WebDAV服务。', 'Please configure and activate WebDAV service first.'), 'error');
      return;
    }
    if (!selectedFile) {
      toast(t('请先选择一个备份文件。', 'Please select a backup file first.'), 'error');
      return;
    }

    const confirmed = await confirm(
      t('恢复数据', 'Restore Data'),
      t(`将从 ${selectedFile} 恢复数据，当前所有数据将被覆盖，是否继续？`, `Will restore data from ${selectedFile}. All current data will be overwritten. Continue?`),
      { type: 'warning' }
    );
    if (!confirmed) return;

    setIsRestoring(true);
    try {
      const webdavService = new WebDAVService(activeConfig);
      const backupContent = await webdavService.downloadFile(selectedFile);

      if (!backupContent) {
        toast(t('备份文件内容为空，无法恢复。', 'Backup file is empty, cannot restore.'), 'error');
        return;
      }

      const backupData = JSON.parse(backupContent);

      if (Array.isArray(backupData.repositories)) {
        setRepositories(backupData.repositories);
      }
      if (Array.isArray(backupData.releases)) {
        setReleases(backupData.releases);
      }

      // 分类
      const currentCategories = useAppStore.getState().customCategories;
      if (Array.isArray(currentCategories)) {
        for (const cat of currentCategories) {
          if (cat && cat.id) deleteCustomCategory(cat.id);
        }
      }
      if (Array.isArray(backupData.customCategories)) {
        for (const cat of backupData.customCategories) {
          if (cat && cat.id && cat.name) addCustomCategory({ ...cat, isCustom: true });
        }
      }
      const currentHidden = useAppStore.getState().hiddenDefaultCategoryIds;
      if (Array.isArray(currentHidden)) {
        for (const categoryId of currentHidden) {
          if (typeof categoryId === 'string') showDefaultCategory(categoryId);
        }
      }
      if (Array.isArray(backupData.hiddenDefaultCategoryIds)) {
        for (const categoryId of backupData.hiddenDefaultCategoryIds) {
          if (typeof categoryId === 'string') hideDefaultCategory(categoryId);
        }
      }

      // AI 配置
      if (Array.isArray(backupData.aiConfigs)) {
        const latestAIConfigs = useAppStore.getState().aiConfigs;
        const currentMap = new Map(latestAIConfigs.map((c: AIConfig) => [c.id, c]));
        const backupIdSet = new Set((backupData.aiConfigs as AIConfig[]).map(cfg => cfg.id).filter(Boolean));
        for (const [id] of currentMap) {
          if (!backupIdSet.has(id)) deleteAIConfig(id);
        }
        for (const cfg of backupData.aiConfigs as AIConfig[]) {
          if (!cfg || !cfg.id) continue;
          const existing = currentMap.get(cfg.id);
          if (existing) {
            updateAIConfig(cfg.id, {
              name: cfg.name, apiType: cfg.apiType, baseUrl: cfg.baseUrl,
              model: cfg.model, customPrompt: cfg.customPrompt,
              useCustomPrompt: cfg.useCustomPrompt, concurrency: cfg.concurrency,
              reasoningEffort: cfg.reasoningEffort,
              apiKey: cfg.apiKey || existing.apiKey, isActive: existing.isActive,
            });
          } else {
            addAIConfig({ ...cfg, apiKey: cfg.apiKey || '', isActive: cfg.isActive });
          }
        }
      }

      // WebDAV 配置
      if (Array.isArray(backupData.webdavConfigs)) {
        const latestWebDAVConfigs = useAppStore.getState().webdavConfigs;
        const currentMap = new Map(latestWebDAVConfigs.map((c: WebDAVConfig) => [c.id, c]));
        const backupIdSet = new Set((backupData.webdavConfigs as WebDAVConfig[]).map(cfg => cfg.id).filter(Boolean));
        for (const [id] of currentMap) {
          if (!backupIdSet.has(id)) deleteWebDAVConfig(id);
        }
        for (const cfg of backupData.webdavConfigs as WebDAVConfig[]) {
          if (!cfg || !cfg.id) continue;
          const existing = currentMap.get(cfg.id);
          if (existing) {
            updateWebDAVConfig(cfg.id, {
              name: cfg.name, url: cfg.url, username: cfg.username,
              path: cfg.path, password: cfg.password || existing.password,
              isActive: existing.isActive,
            });
          } else {
            addWebDAVConfig({ ...cfg, password: cfg.password || '', isActive: false });
          }
        }
      }

      toast(t(
        `已从 ${selectedFile} 恢复数据：仓库 ${backupData.repositories?.length ?? 0}，发布 ${backupData.releases?.length ?? 0}，自定义分类 ${backupData.customCategories?.length ?? 0}。`,
        `Restored from ${selectedFile}: repositories ${backupData.repositories?.length ?? 0}, releases ${backupData.releases?.length ?? 0}, custom categories ${backupData.customCategories?.length ?? 0}.`
      ), 'success');
    } catch (error) {
      console.error('Restore failed:', error);
      toast(`${t('恢复失败', 'Restore failed')}: ${(error as Error).message}`, 'error');
    } finally {
      setIsRestoring(false);
    }
  };

  const formatTime = (iso: string | null): string => {
    if (!iso) return t('暂无', 'None');
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  };

  // ─── 渲染 ───

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-3">
        <Cloud className="w-6 h-6 text-gray-700 dark:text-text-secondary" />
        <h3 className="text-lg font-semibold text-gray-900 dark:text-text-primary">
          {t('备份与恢复', 'Backup & Restore')}
        </h3>
      </div>

      {/* 无活跃配置警告 */}
      {noActiveConfig && (
        <div className="flex items-start gap-2 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg text-sm text-yellow-800 dark:text-yellow-200">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{t(
            '请先在 WebDAV 设置中激活一个配置以使用备份功能。',
            'Please activate a WebDAV configuration first to use backup features.'
          )}</span>
        </div>
      )}

      {/* ─── 自动备份设置 ─── */}
      <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg space-y-4">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          <h4 className="font-medium text-gray-900 dark:text-gray-100">
            {t('自动备份', 'Auto Backup')}
          </h4>
        </div>

        {autoLoading ? (
          <div className="animate-pulse h-4 w-32 bg-gray-300 dark:bg-gray-600 rounded" />
        ) : (
          <>
            {/* 启用开关 */}
            <div className="flex items-center justify-between">
              <label id="auto-backup-label" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('启用自动备份', 'Enable Auto Backup')}
              </label>
              <button
                type="button"
                role="switch"
                aria-checked={autoEnabled}
                aria-labelledby="auto-backup-label"
                disabled={noActiveConfig && !autoEnabled}
                onClick={() => setAutoEnabled(!autoEnabled)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                  noActiveConfig && !autoEnabled ? 'opacity-50 cursor-not-allowed' : ''
                } ${autoEnabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  autoEnabled ? 'translate-x-6' : 'translate-x-1'
                }`} />
              </button>
            </div>

            {autoEnabled && (
              <>
                {/* 间隔 */}
                <div>
                  <label htmlFor="auto-backup-interval" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('备份间隔（小时）', 'Backup Interval (Hours)')}
                  </label>
                  <input
                    id="auto-backup-interval"
                    type="number"
                    min={1} max={720}
                    value={intervalHours}
                    onChange={(e) => setIntervalHours(Math.max(1, Math.min(720, parseInt(e.target.value) || 24)))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {t('范围: 1-720 小时 (最多30天)', 'Range: 1-720 hours (up to 30 days)')}
                  </p>
                </div>

                {/* 保留份数 */}
                <div>
                  <label htmlFor="auto-backup-retention" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('保留最近份数', 'Retention Count')}
                  </label>
                  <input
                    id="auto-backup-retention"
                    type="number"
                    min={0} max={365}
                    value={retentionCount}
                    onChange={(e) => setRetentionCount(Math.max(0, Math.min(365, parseInt(e.target.value) || 0)))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {t('0 = 不限制, 最大 365 份', '0 = unlimited, max 365')}
                  </p>
                </div>
              </>
            )}

            {/* 保存 */}
            <button
              onClick={saveAutoSettings}
              disabled={autoSaving}
              className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <RotateCw className={`w-4 h-4 ${autoSaving ? 'animate-spin' : ''}`} />
              {autoSaving ? t('保存中...', 'Saving...') : t('保存设置', 'Save Settings')}
            </button>

            {/* 状态信息 */}
            <div className="p-3 bg-white dark:bg-gray-700 rounded-lg space-y-2 text-sm">
              <div className="flex items-center gap-2">
                {autoEnabled ? (
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-gray-400" />
                )}
                <span className="text-gray-600 dark:text-gray-400">
                  {t('状态', 'Status')}: {autoEnabled ? t('已启用', 'Enabled') : t('已禁用', 'Disabled')}
                </span>
              </div>
              {activeConfigName && (
                <div className="text-gray-600 dark:text-gray-400">
                  {t('活跃配置', 'Active Config')}: {activeConfigName}
                </div>
              )}
              <div className="text-gray-600 dark:text-gray-400">
                {t('上次备份', 'Last Backup')}: {formatTime(
                  backendLastBackup && lastBackup
                    ? (new Date(backendLastBackup) > new Date(lastBackup) ? backendLastBackup : lastBackup)
                    : (backendLastBackup || lastBackup)
                )}
              </div>
              {autoEnabled && nextBackup && (
                <div className="text-gray-600 dark:text-gray-400">
                  {t('下次备份', 'Next Backup')}: {formatTime(nextBackup)}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ─── 手动操作 ─── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 立即备份 */}
        <div className="p-6 bg-light-bg dark:bg-white/[0.04] rounded-lg border border-black/[0.06] dark:border-white/[0.04]">
          <div className="flex items-center space-x-3 mb-4">
            <Upload className="w-8 h-8 text-gray-700 dark:text-text-secondary" />
            <div>
              <h4 className="font-medium text-gray-900 dark:text-text-primary">
                {t('立即备份', 'Backup Now')}
              </h4>
              <p className="text-sm text-gray-500 dark:text-text-tertiary">
                {t('立即创建一份备份', 'Create a backup immediately')}
              </p>
            </div>
          </div>
          <button
            onClick={triggerBackup}
            disabled={isBackingUp || noActiveConfig}
            className="w-full flex items-center justify-center space-x-2 px-4 py-3 bg-brand-indigo text-white rounded-lg hover:bg-brand-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isBackingUp ? (
              <RefreshCw className="w-5 h-5 animate-spin" />
            ) : (
              <Upload className="w-5 h-5" />
            )}
            <span>{isBackingUp ? t('备份中...', 'Backing up...') : t('开始备份', 'Start Backup')}</span>
          </button>
        </div>

        {/* 恢复数据 */}
        <div className="p-6 bg-light-bg dark:bg-white/[0.04] rounded-lg border border-black/[0.06] dark:border-white/[0.04]">
          <div className="flex items-center space-x-3 mb-4">
            <Download className="w-8 h-8 text-gray-700 dark:text-text-secondary" />
            <div>
              <h4 className="font-medium text-gray-900 dark:text-text-primary">
                {t('恢复数据', 'Restore Data')}
              </h4>
              <p className="text-sm text-gray-500 dark:text-text-tertiary">
                {t('选择备份文件恢复', 'Select a backup file to restore')}
              </p>
            </div>
          </div>

          {/* 备份文件列表 */}
          {backupFiles.length > 0 ? (
            <div className="mb-3">
              <select
                id="backup-file-select"
                value={selectedFile}
                onChange={(e) => setSelectedFile(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {backupFiles.map(file => (
                  <option key={file} value={file}>{file}</option>
                ))}
              </select>
            </div>
          ) : (
            <p className="text-sm text-gray-500 dark:text-text-tertiary mb-3">
              {t('点击下方按钮加载备份文件列表', 'Click the button below to load backup files')}
            </p>
          )}

          <div className="flex gap-2">
            <button
              onClick={loadBackupFiles}
              disabled={loadingFiles || noActiveConfig}
              className="flex-1 flex items-center justify-center space-x-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loadingFiles ? 'animate-spin' : ''}`} />
              <span>{loadingFiles ? t('加载中...', 'Loading...') : t('刷新列表', 'Refresh List')}</span>
            </button>
            <button
              onClick={handleRestore}
              disabled={isRestoring || !selectedFile || noActiveConfig}
              className="flex-1 flex items-center justify-center space-x-2 px-4 py-2 bg-brand-indigo text-white rounded-lg hover:bg-brand-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isRestoring ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              <span className="text-sm">{isRestoring ? t('恢复中...', 'Restoring...') : t('恢复选中', 'Restore Selected')}</span>
            </button>
          </div>
        </div>
      </div>

      {/* ─── 备份内容说明 ─── */}
      <div className="p-4 bg-light-bg dark:bg-white/[0.04] rounded-lg">
        <h4 className="font-medium text-gray-900 dark:text-text-primary mb-2">
          {t('备份内容包括：', 'Backup includes:')}
        </h4>
        <ul className="text-sm text-gray-700 dark:text-text-tertiary space-y-1">
          <li>• {t('GitHub Stars 仓库列表', 'GitHub Stars repository list')}</li>
          <li>• {t('Release 发布信息', 'Release information')}</li>
          <li>• {t('自定义分类', 'Custom categories')}</li>
          <li>• {t('AI 服务配置', 'AI service configurations')}</li>
          <li>• {t('WebDAV 配置', 'WebDAV configurations')}</li>
        </ul>
      </div>
    </div>
  );
};
