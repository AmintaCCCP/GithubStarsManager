import React, { useState } from 'react';
import { Download, Upload, RefreshCw, Cloud, AlertCircle } from 'lucide-react';
import { AIConfig, WebDAVConfig } from '../../types';
import { useAppStore } from '../../store/useAppStore';
import { WebDAVService } from '../../services/webdavService';

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

  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  const activeConfig = webdavConfigs.find(config => config.id === activeWebDAVConfig);

  const handleBackup = async () => {
    if (!activeConfig) {
      alert(t('请先配置并激活WebDAV服务。', 'Please configure and activate WebDAV service first.'));
      return;
    }

    setIsBackingUp(true);
    try {
      const webdavService = new WebDAVService(activeConfig);
      
      const backupData = {
        repositories,
        releases,
        customCategories,
        hiddenDefaultCategoryIds,
        aiConfigs: aiConfigs.map(config => ({
          ...config,
          apiKey: config.apiKey ? '***' : ''
        })),
        webdavConfigs: webdavConfigs.map(config => ({
          ...config,
          password: config.password ? '***' : ''
        })),
        exportedAt: new Date().toISOString(),
        version: '1.0'
      };

      const filename = `github-stars-backup-${new Date().toISOString().split('T')[0]}.json`;
      const success = await webdavService.uploadFile(filename, JSON.stringify(backupData, null, 2));

      if (success) {
        setLastBackup(new Date().toISOString());
        alert(t('数据备份成功！', 'Data backup successful!'));
      } else {
        console.error('Backup failed: uploadFile returned falsy');
        alert(t('数据备份失败！', 'Data backup failed!'));
      }
    } catch (error) {
      console.error('Backup failed:', error);
      alert(`${t('备份失败', 'Backup failed')}: ${(error as Error).message}`);
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleRestore = async () => {
    if (!activeConfig) {
      alert(t('请先配置并激活WebDAV服务。', 'Please configure and activate WebDAV service first.'));
      return;
    }

    const confirmMessage = t(
      '恢复数据将覆盖当前所有数据，是否继续？',
      'Restoring data will overwrite all current data. Continue?'
    );
    
    if (!confirm(confirmMessage)) return;

    setIsRestoring(true);
    try {
      const webdavService = new WebDAVService(activeConfig);
      const files = await webdavService.listFiles();
      
      const backupFiles = files.filter(file => file.startsWith('github-stars-backup-'));
      if (backupFiles.length === 0) {
        alert(t('未找到备份文件。', 'No backup files found.'));
        return;
      }

      const latestBackup = backupFiles.sort().reverse()[0];
      const backupContent = await webdavService.downloadFile(latestBackup);
      
      if (!backupContent) {
        setIsRestoring(false);
        alert(t('备份文件内容为空，无法恢复。', 'Backup file is empty, cannot restore.'));
        return;
      }
      
      try {
        const backupData = JSON.parse(backupContent);

        if (Array.isArray(backupData.repositories)) {
          setRepositories(backupData.repositories);
        }
        if (Array.isArray(backupData.releases)) {
          setReleases(backupData.releases);
        }

        try {
          // 先获取当前所有自定义分类并删除
          const currentCategories = useAppStore.getState().customCategories;
          if (Array.isArray(currentCategories)) {
            for (const cat of currentCategories) {
              if (cat && cat.id) {
                deleteCustomCategory(cat.id);
              }
            }
          }
          // 添加备份中的分类
          if (Array.isArray(backupData.customCategories)) {
            for (const cat of backupData.customCategories) {
              if (cat && cat.id && cat.name) {
                addCustomCategory({ ...cat, isCustom: true });
              }
            }
          }
          // 在 restore 回调中，先获取最新状态
          const currentHidden = useAppStore.getState().hiddenDefaultCategoryIds;
          // 显示当前隐藏的分类（恢复前它们被隐藏，需要显示）
          if (Array.isArray(currentHidden)) {
            for (const categoryId of currentHidden) {
              if (typeof categoryId === 'string') {
                showDefaultCategory(categoryId);
              }
            }
          }
          // 再隐藏备份数据中标记为隐藏的分类
          if (Array.isArray(backupData.hiddenDefaultCategoryIds)) {
            for (const categoryId of backupData.hiddenDefaultCategoryIds) {
              if (typeof categoryId === 'string') {
                hideDefaultCategory(categoryId);
              }
            }
          }
        } catch (e) {
          console.warn('恢复自定义分类时发生问题：', e);
        }

        try {
          if (Array.isArray(backupData.aiConfigs)) {
            const latestAIConfigs = useAppStore.getState().aiConfigs;
            const currentMap = new Map(latestAIConfigs.map((c: AIConfig) => [c.id, c]));
            const backupIdSet = new Set((backupData.aiConfigs as AIConfig[]).map(cfg => cfg.id).filter(Boolean));
            for (const [id] of currentMap) {
              if (!backupIdSet.has(id)) {
                deleteAIConfig(id);
              }
            }
            for (const cfg of backupData.aiConfigs as AIConfig[]) {
              if (!cfg || !cfg.id) continue;
              const existing = currentMap.get(cfg.id);
              if (existing) {
                updateAIConfig(cfg.id, {
                  name: cfg.name,
                  apiType: cfg.apiType,
                  baseUrl: cfg.baseUrl,
                  model: cfg.model,
                  customPrompt: cfg.customPrompt,
                  useCustomPrompt: cfg.useCustomPrompt,
                  concurrency: cfg.concurrency,
                  reasoningEffort: cfg.reasoningEffort,
                  apiKey: cfg.apiKey || existing.apiKey,
                  isActive: existing.isActive,
                });
              } else {
                addAIConfig({
                  ...cfg,
                  apiKey: cfg.apiKey || '',
                  isActive: cfg.isActive,
                });
              }
            }
          }
        } catch (e) {
          console.warn('恢复 AI 配置时发生问题：', e);
        }

        try {
          if (Array.isArray(backupData.webdavConfigs)) {
            const latestWebDAVConfigs = useAppStore.getState().webdavConfigs;
            const currentMap = new Map(latestWebDAVConfigs.map((c: WebDAVConfig) => [c.id, c]));
            const backupIdSet = new Set((backupData.webdavConfigs as WebDAVConfig[]).map(cfg => cfg.id).filter(Boolean));
            for (const [id] of currentMap) {
              if (!backupIdSet.has(id)) {
                deleteWebDAVConfig(id);
              }
            }
            for (const cfg of backupData.webdavConfigs as WebDAVConfig[]) {
              if (!cfg || !cfg.id) continue;
              const existing = currentMap.get(cfg.id);
              if (existing) {
                updateWebDAVConfig(cfg.id, {
                  name: cfg.name,
                  url: cfg.url,
                  username: cfg.username,
                  path: cfg.path,
                  password: cfg.password || existing.password,
                  isActive: existing.isActive,
                });
              } else {
                addWebDAVConfig({
                  ...cfg,
                  password: cfg.password || '',
                  isActive: false,
                });
              }
            }
          }
        } catch (e) {
          console.warn('恢复 WebDAV 配置时发生问题：', e);
        }

        alert(t(
          `已从备份恢复数据：仓库 ${backupData.repositories?.length ?? 0}，发布 ${backupData.releases?.length ?? 0}，自定义分类 ${backupData.customCategories?.length ?? 0}。`,
          `Data restored from backup: repositories ${backupData.repositories?.length ?? 0}, releases ${backupData.releases?.length ?? 0}, custom categories ${backupData.customCategories?.length ?? 0}.`
        ));
      } catch (error) {
        console.error('Restore failed:', error);
        alert(`${t('恢复失败', 'Restore failed')}: ${(error as Error).message}`);
      }
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-3">
        <Cloud className="w-6 h-6 text-status-emerald " />
        <h3 className="text-lg font-semibold text-gray-900 dark:text-text-primary">
          {t('备份与恢复', 'Backup & Restore')}
        </h3>
      </div>

      {!activeConfig && (
        <div className="p-4 bg-light-surface dark:bg-white/[0.04] rounded-lg border border-black/[0.06] dark:border-white/[0.04] dark:border-black/[0.06] dark:border-white/[0.04]">
          <div className="flex items-start space-x-3">
            <AlertCircle className="w-5 h-5 text-gray-700 dark:text-text-secondary mt-0.5" />
            <div>
              <p className="text-sm text-gray-700 dark:text-text-secondary ">
                {t('请先配置并激活WebDAV服务', 'Please configure and activate WebDAV service first')}
              </p>
              <p className="text-xs text-gray-700 dark:text-text-secondary mt-1">
                {t('备份和恢复功能需要WebDAV服务支持', 'Backup and restore features require WebDAV service')}
              </p>
            </div>
          </div>
        </div>
      )}

      {lastBackup && (
        <div className="p-4 bg-light-surface dark:bg-white/[0.04] rounded-lg">
          <p className="text-sm text-gray-700 dark:text-text-secondary ">
            <span className="font-medium">{t('上次备份:', 'Last backup:')}</span>{' '}
            {new Date(lastBackup).toLocaleString()}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-6 bg-light-bg dark:bg-white/[0.04] rounded-lg border border-black/[0.06] dark:border-white/[0.04]">
          <div className="flex items-center space-x-3 mb-4">
            <Upload className="w-8 h-8 text-status-emerald " />
            <div>
              <h4 className="font-medium text-gray-900 dark:text-text-primary">
                {t('备份数据', 'Backup Data')}
              </h4>
              <p className="text-sm text-gray-500 dark:text-text-tertiary">
                {t('将数据备份到WebDAV', 'Backup data to WebDAV')}
              </p>
            </div>
          </div>
          <button
            onClick={handleBackup}
            disabled={isBackingUp || !activeConfig}
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

        <div className="p-6 bg-light-bg dark:bg-white/[0.04] rounded-lg border border-black/[0.06] dark:border-white/[0.04]">
          <div className="flex items-center space-x-3 mb-4">
            <Download className="w-8 h-8 text-brand-violet dark:text-brand-violet" />
            <div>
              <h4 className="font-medium text-gray-900 dark:text-text-primary">
                {t('恢复数据', 'Restore Data')}
              </h4>
              <p className="text-sm text-gray-500 dark:text-text-tertiary">
                {t('从WebDAV恢复数据', 'Restore data from WebDAV')}
              </p>
            </div>
          </div>
          <button
            onClick={handleRestore}
            disabled={isRestoring || !activeConfig}
            className="w-full flex items-center justify-center space-x-2 px-4 py-3 bg-brand-indigo text-white rounded-lg hover:bg-brand-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isRestoring ? (
              <RefreshCw className="w-5 h-5 animate-spin" />
            ) : (
              <Download className="w-5 h-5" />
            )}
            <span>{isRestoring ? t('恢复中...', 'Restoring...') : t('开始恢复', 'Start Restore')}</span>
          </button>
        </div>
      </div>

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
