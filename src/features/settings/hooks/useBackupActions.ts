import { useCallback, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { AIConfig, WebDAVConfig } from '../../../types';
import { useAppStore } from '../../../store/useAppStore';
import { useDialog } from '../../../hooks/useDialog';
import { WebDAVService } from '../../../services/webdavService';

interface UseBackupActionsOptions {
  t: (zh: string, en: string) => string;
}

export interface BackupActions {
  activeConfig: WebDAVConfig | undefined;
  isBackingUp: boolean;
  isRestoring: boolean;
  backup: () => Promise<void>;
  restore: () => Promise<void>;
}

/**
 * Owns WebDAV backup and restore orchestration. The payload deliberately keeps
 * the existing key-masking rules, including proxy password and RPC secret.
 */
export const useBackupActions = ({ t }: UseBackupActionsOptions): BackupActions => {
  const state = useAppStore(useShallow((store) => ({
    repositories: store.repositories,
    releases: store.releases,
    customCategories: store.customCategories,
    hiddenDefaultCategoryIds: store.hiddenDefaultCategoryIds,
    aiConfigs: store.aiConfigs,
    webdavConfigs: store.webdavConfigs,
    activeWebDAVConfig: store.activeWebDAVConfig,
    proxyConfig: store.proxyConfig,
    rpcDownloadConfig: store.rpcDownloadConfig,
    backendApiSecret: store.backendApiSecret,
    includeKeysInBackup: store.includeKeysInBackup,
    setLastBackup: store.setLastBackup,
    setRepositories: store.setRepositories,
    setReleases: store.setReleases,
    addCustomCategory: store.addCustomCategory,
    deleteCustomCategory: store.deleteCustomCategory,
    hideDefaultCategory: store.hideDefaultCategory,
    showDefaultCategory: store.showDefaultCategory,
    addAIConfig: store.addAIConfig,
    updateAIConfig: store.updateAIConfig,
    deleteAIConfig: store.deleteAIConfig,
    addWebDAVConfig: store.addWebDAVConfig,
    updateWebDAVConfig: store.updateWebDAVConfig,
    deleteWebDAVConfig: store.deleteWebDAVConfig,
    setProxyConfig: store.setProxyConfig,
    setRpcDownloadConfig: store.setRpcDownloadConfig,
    setBackendApiSecret: store.setBackendApiSecret,
    setReleaseSourceSettings: store.setReleaseSourceSettings,
  })));
  const { toast, confirm } = useDialog();
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const activeConfig = useMemo(
    () => state.webdavConfigs.find((config) => config.id === state.activeWebDAVConfig),
    [state.activeWebDAVConfig, state.webdavConfigs],
  );

  const backup = useCallback(async () => {
    if (!activeConfig) {
      toast(t('请先配置并激活WebDAV服务。', 'Please configure and activate WebDAV service first.'), 'error');
      return;
    }
    setIsBackingUp(true);
    try {
      const backupData = {
        repositories: state.repositories,
        releases: state.releases,
        customCategories: state.customCategories,
        hiddenDefaultCategoryIds: state.hiddenDefaultCategoryIds,
        aiConfigs: state.aiConfigs.map((config) => ({
          ...config,
          apiKey: state.includeKeysInBackup ? config.apiKey : (config.apiKey ? '***' : ''),
        })),
        webdavConfigs: state.webdavConfigs.map((config) => ({
          ...config,
          password: state.includeKeysInBackup ? config.password : (config.password ? '***' : ''),
        })),
        proxyConfig: {
          ...state.proxyConfig,
          password: state.includeKeysInBackup ? state.proxyConfig.password : (state.proxyConfig.password ? '***' : ''),
        },
        rpcDownloadConfig: {
          ...state.rpcDownloadConfig,
          secret: state.includeKeysInBackup ? state.rpcDownloadConfig.secret : (state.rpcDownloadConfig.secret ? '***' : ''),
        },
        backendApiSecret: state.includeKeysInBackup ? state.backendApiSecret : (state.backendApiSecret ? '***' : null),
        releaseSubscriptions: Array.from(useAppStore.getState().releaseSubscriptions),
        releaseSourceSettings: useAppStore.getState().releaseSourceSettings,
        readReleases: Array.from(useAppStore.getState().readReleases),
        includeKeysInBackup: state.includeKeysInBackup,
        exportedAt: new Date().toISOString(),
        version: '1.1',
      };
      const filename = `github-stars-backup-${new Date().toISOString().split('T')[0]}.json`;
      const success = await new WebDAVService(activeConfig).uploadFile(filename, JSON.stringify(backupData, null, 2));
      if (success) {
        state.setLastBackup(new Date().toISOString());
        toast(t('数据备份成功！', 'Data backup successful!'), 'success');
      } else {
        console.error('Backup failed: uploadFile returned falsy');
        toast(t('数据备份失败！', 'Data backup failed!'), 'error');
      }
    } catch (error) {
      console.error('Backup failed:', error);
      toast(`${t('备份失败', 'Backup failed')}: ${(error as Error).message}`, 'error');
    } finally {
      setIsBackingUp(false);
    }
  }, [activeConfig, state, t, toast]);

  const restore = useCallback(async () => {
    if (!activeConfig) {
      toast(t('请先配置并激活WebDAV服务。', 'Please configure and activate WebDAV service first.'), 'error');
      return;
    }
    const confirmed = await confirm(
      t('恢复数据', 'Restore Data'),
      t('恢复数据将覆盖当前所有数据，是否继续？', 'Restoring data will overwrite all current data. Continue?'),
      { type: 'warning' },
    );
    if (!confirmed) return;

    setIsRestoring(true);
    try {
      const service = new WebDAVService(activeConfig);
      const files = await service.listFiles();
      const backupFiles = files.filter((file) => file.startsWith('github-stars-backup-'));
      if (backupFiles.length === 0) {
        toast(t('未找到备份文件。', 'No backup files found.'), 'error');
        return;
      }
      const content = await service.downloadFile(backupFiles.sort().reverse()[0]);
      if (!content) {
        toast(t('备份文件内容为空，无法恢复。', 'Backup file is empty, cannot restore.'), 'error');
        return;
      }
      const backupData = JSON.parse(content) as Record<string, unknown>;
      const backupIncludedKeys = backupData.includeKeysInBackup ?? true;
      if (Array.isArray(backupData.repositories)) state.setRepositories(backupData.repositories as typeof state.repositories);
      if (Array.isArray(backupData.releases)) state.setReleases(backupData.releases as typeof state.releases);

      try {
        if (Array.isArray(backupData.releaseSubscriptions)) {
          const values = backupData.releaseSubscriptions.filter((id): id is number => typeof id === 'number');
          useAppStore.setState({ releaseSubscriptions: new Set(values) });
        }
        if (backupData.releaseSourceSettings) state.setReleaseSourceSettings(backupData.releaseSourceSettings as Parameters<typeof state.setReleaseSourceSettings>[0]);
        if (Array.isArray(backupData.readReleases)) {
          const values = backupData.readReleases.filter((id): id is number => typeof id === 'number');
          useAppStore.setState({ readReleases: new Set(values) });
        }
      } catch (error) {
        console.warn('恢复 Release 订阅与已读状态时发生问题：', error);
      }

      try {
        for (const category of useAppStore.getState().customCategories) {
          if (category?.id) state.deleteCustomCategory(category.id);
        }
        if (Array.isArray(backupData.customCategories)) {
          for (const category of backupData.customCategories) {
            if (category && typeof category === 'object' && 'id' in category && 'name' in category) {
              state.addCustomCategory({ ...(category as Parameters<typeof state.addCustomCategory>[0]), isCustom: true });
            }
          }
        }
        for (const categoryId of useAppStore.getState().hiddenDefaultCategoryIds) {
          if (typeof categoryId === 'string') state.showDefaultCategory(categoryId);
        }
        if (Array.isArray(backupData.hiddenDefaultCategoryIds)) {
          for (const categoryId of backupData.hiddenDefaultCategoryIds) {
            if (typeof categoryId === 'string') state.hideDefaultCategory(categoryId);
          }
        }
      } catch (error) {
        console.warn('恢复自定义分类时发生问题：', error);
      }

      try {
        if (Array.isArray(backupData.aiConfigs)) {
          const currentMap = new Map(useAppStore.getState().aiConfigs.map((config: AIConfig) => [config.id, config]));
          const backupConfigs = backupData.aiConfigs as AIConfig[];
          const backupIds = new Set(backupConfigs.map((config) => config?.id).filter(Boolean));
          for (const [id] of currentMap) if (!backupIds.has(id)) state.deleteAIConfig(id);
          for (const config of backupConfigs) {
            if (!config?.id) continue;
            const existing = currentMap.get(config.id);
            const apiKey = backupIncludedKeys && config.apiKey && config.apiKey !== '***' ? config.apiKey : existing?.apiKey ?? '';
            if (existing) {
              state.updateAIConfig(config.id, { ...config, apiKey, isActive: existing.isActive });
            } else {
              state.addAIConfig({ ...config, apiKey, isActive: config.isActive });
            }
          }
        }
      } catch (error) {
        console.warn('恢复 AI 配置时发生问题：', error);
      }

      try {
        if (Array.isArray(backupData.webdavConfigs)) {
          const currentMap = new Map(useAppStore.getState().webdavConfigs.map((config: WebDAVConfig) => [config.id, config]));
          const backupConfigs = backupData.webdavConfigs as WebDAVConfig[];
          const backupIds = new Set(backupConfigs.map((config) => config?.id).filter(Boolean));
          for (const [id] of currentMap) if (!backupIds.has(id)) state.deleteWebDAVConfig(id);
          for (const config of backupConfigs) {
            if (!config?.id) continue;
            const existing = currentMap.get(config.id);
            const password = backupIncludedKeys && config.password && config.password !== '***' ? config.password : existing?.password ?? '';
            if (existing) {
              state.updateWebDAVConfig(config.id, { ...config, password, isActive: existing.isActive });
            } else {
              state.addWebDAVConfig({ ...config, password, isActive: false });
            }
          }
        }
      } catch (error) {
        console.warn('恢复 WebDAV 配置时发生问题：', error);
      }

      try {
        if (backupData.proxyConfig && typeof backupData.proxyConfig === 'object') {
          const backupConfig = backupData.proxyConfig as typeof state.proxyConfig;
          state.setProxyConfig({
            ...backupConfig,
            password: backupIncludedKeys && backupConfig.password && backupConfig.password !== '***' ? backupConfig.password : useAppStore.getState().proxyConfig.password,
          });
        }
      } catch (error) {
        console.warn('恢复代理配置时发生问题：', error);
      }
      try {
        if (backupData.rpcDownloadConfig && typeof backupData.rpcDownloadConfig === 'object') {
          const backupConfig = backupData.rpcDownloadConfig as typeof state.rpcDownloadConfig;
          state.setRpcDownloadConfig({
            ...backupConfig,
            secret: backupIncludedKeys && backupConfig.secret && backupConfig.secret !== '***' ? backupConfig.secret : useAppStore.getState().rpcDownloadConfig.secret,
          });
        }
      } catch (error) {
        console.warn('恢复远程下载配置时发生问题：', error);
      }
      try {
        if (backupIncludedKeys && backupData.backendApiSecret !== undefined && backupData.backendApiSecret !== '***') {
          state.setBackendApiSecret(typeof backupData.backendApiSecret === 'string' ? backupData.backendApiSecret : null);
        }
      } catch (error) {
        console.warn('恢复后端 API 密钥时发生问题：', error);
      }
      toast(t(
        `已从备份恢复数据：仓库 ${(backupData.repositories as unknown[] | undefined)?.length ?? 0}，发布 ${(backupData.releases as unknown[] | undefined)?.length ?? 0}，自定义分类 ${(backupData.customCategories as unknown[] | undefined)?.length ?? 0}。`,
        `Data restored from backup: repositories ${(backupData.repositories as unknown[] | undefined)?.length ?? 0}, releases ${(backupData.releases as unknown[] | undefined)?.length ?? 0}, custom categories ${(backupData.customCategories as unknown[] | undefined)?.length ?? 0}.`,
      ), 'success');
    } catch (error) {
      console.error('Restore failed:', error);
      toast(`${t('恢复失败', 'Restore failed')}: ${(error as Error).message}`, 'error');
    } finally {
      setIsRestoring(false);
    }
  }, [activeConfig, confirm, state, t, toast]);

  return { activeConfig, isBackingUp, isRestoring, backup, restore };
};
