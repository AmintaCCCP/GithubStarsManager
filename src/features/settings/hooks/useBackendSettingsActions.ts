import { useCallback, useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../../store/useAppStore';
import { useDialog } from '../../../hooks/useDialog';
import { backend } from '../../../services/backendAdapter';
import { normalizeBackendUrl } from '../../../utils/backendUrl';
import { syncLocalGitHubTokenToBackend, tryRestoreAuthFromBackend } from '../../../services/autoSync';

interface UseBackendSettingsActionsOptions {
  t: (zh: string, en: string) => string;
}

type BackendStatus = 'connected' | 'disconnected' | 'checking';

export interface BackendSettingsActions {
  status: BackendStatus;
  health: { version: string; timestamp: string } | null;
  urlInput: string;
  secretInput: string;
  backendAvailable: boolean;
  isSyncingToBackend: boolean;
  isSyncingFromBackend: boolean;
  setUrlInput: (value: string) => void;
  setSecretInput: (value: string) => void;
  testConnection: () => Promise<void>;
  syncToBackend: () => Promise<void>;
  syncFromBackend: () => Promise<void>;
}

/**
 * Encapsulates manual settings-panel backend operations. Application-start auth
 * lifecycle remains outside this hook for the later lifecycle extraction work.
 */
export const useBackendSettingsActions = ({ t }: UseBackendSettingsActionsOptions): BackendSettingsActions => {
  const state = useAppStore(useShallow((store) => ({
    repositories: store.repositories,
    releases: store.releases,
    aiConfigs: store.aiConfigs,
    webdavConfigs: store.webdavConfigs,
    activeAIConfig: store.activeAIConfig,
    activeWebDAVConfig: store.activeWebDAVConfig,
    hiddenDefaultCategoryIds: store.hiddenDefaultCategoryIds,
    categoryOrder: store.categoryOrder,
    customCategories: store.customCategories,
    assetFilters: store.assetFilters,
    collapsedSidebarCategoryCount: store.collapsedSidebarCategoryCount,
    backendApiSecret: store.backendApiSecret,
    setBackendApiSecret: store.setBackendApiSecret,
    setRepositories: store.setRepositories,
    setReleases: store.setReleases,
    setAIConfigs: store.setAIConfigs,
    setWebDAVConfigs: store.setWebDAVConfigs,
    showDefaultCategory: store.showDefaultCategory,
    hideDefaultCategory: store.hideDefaultCategory,
  })));
  const { toast, confirm } = useDialog();
  const [status, setStatus] = useState<BackendStatus>('disconnected');
  const [health, setHealth] = useState<{ version: string; timestamp: string } | null>(null);
  const [isSyncingToBackend, setIsSyncingToBackend] = useState(false);
  const [isSyncingFromBackend, setIsSyncingFromBackend] = useState(false);
  const [urlInput, setUrlInput] = useState(() => backend.configuredUrl?.replace(/\/api$/, '') || '');
  const [secretInput, setSecretInput] = useState(state.backendApiSecret || '');

  const checkConnection = useCallback(async (syncToken: boolean, preferredUrl?: string) => {
    setStatus('checking');
    try {
      await backend.init(preferredUrl);
      const healthData = await backend.checkHealth();
      if (healthData) {
        setStatus('connected');
        setHealth({ version: healthData.version, timestamp: healthData.timestamp });
        if (syncToken) void syncLocalGitHubTokenToBackend();
        return true;
      }
    } catch {
      // A disconnected backend must leave the settings screen usable.
    }
    setStatus('disconnected');
    setHealth(null);
    return false;
  }, []);

  useEffect(() => {
    void checkConnection(true);
  }, [checkConnection]);

  const testConnection = useCallback(async () => {
    const trimmedUrl = urlInput.trim();
    if (trimmedUrl && !normalizeBackendUrl(trimmedUrl)) {
      toast(t(
        '后端地址无效：远程后端需使用 HTTPS，仅 localhost 可使用 HTTP',
        'Invalid backend URL: remote backends must use HTTPS; only localhost may use HTTP'
      ), 'error');
      return;
    }
    state.setBackendApiSecret(secretInput || null);
    // With an address entered, probe exactly that URL and remember it on
    // success (same storage as the login screen); empty keeps the previous
    // auto-detect behavior (remembered URL, else same-origin).
    const connected = await checkConnection(false, trimmedUrl || undefined);
    if (!connected) {
      toast(t('后端连接失败，请检查服务器状态或 API Secret 是否正确。', 'Backend connection failed. Please check the server status or whether the API Secret is correct.'), 'error');
      return;
    }
    try {
      const authOk = secretInput ? await backend.verifyAuth() : true;
      if (!authOk) throw new Error('Authentication failed');
      toast(t('后端连接成功！', 'Backend connection successful!'), 'success');
      // These are deliberate manual settings actions; app-start restoration is not moved here.
      void tryRestoreAuthFromBackend();
      void syncLocalGitHubTokenToBackend();
    } catch {
      setStatus('disconnected');
      setHealth(null);
      toast(t('后端连接失败，请检查服务器状态或 API Secret 是否正确。', 'Backend connection failed. Please check the server status or whether the API Secret is correct.'), 'error');
    }
  }, [checkConnection, secretInput, state, t, toast, urlInput]);

  const syncToBackend = useCallback(async () => {
    if (!backend.isAvailable) {
      toast(t('后端不可用', 'Backend not available'), 'error');
      return;
    }
    setIsSyncingToBackend(true);
    try {
      const results = await Promise.allSettled([
        backend.syncRepositories(state.repositories),
        backend.syncReleases(state.releases),
        backend.syncAIConfigs(state.aiConfigs),
        backend.syncWebDAVConfigs(state.webdavConfigs),
        backend.syncSettings({
          activeAIConfig: state.activeAIConfig,
          activeWebDAVConfig: state.activeWebDAVConfig,
          hiddenDefaultCategoryIds: state.hiddenDefaultCategoryIds,
          categoryOrder: state.categoryOrder,
          customCategories: state.customCategories,
          assetFilters: state.assetFilters,
          collapsedSidebarCategoryCount: state.collapsedSidebarCategoryCount,
        }),
      ]);
      const failures = results.filter((result) => result.status === 'rejected');
      const successes = results.filter((result) => result.status === 'fulfilled');
      if (failures.length) {
        console.warn('Some syncs failed:', failures.map((failure) => (failure as PromiseRejectedResult).reason));
        toast(t(`同步部分失败：${failures.length} 项失败，${successes.length} 项成功`, `Partial sync failure: ${failures.length} failed, ${successes.length} succeeded`), 'error');
      } else {
        toast(t(
          `已同步到后端：仓库 ${state.repositories.length}，发布 ${state.releases.length}，AI配置 ${state.aiConfigs.length}，WebDAV配置 ${state.webdavConfigs.length}`,
          `Synced to backend: repos ${state.repositories.length}, releases ${state.releases.length}, AI configs ${state.aiConfigs.length}, WebDAV configs ${state.webdavConfigs.length}`,
        ), 'success');
      }
    } catch (error) {
      console.error('Sync to backend failed:', error);
      toast(`${t('同步失败', 'Sync failed')}: ${(error as Error).message}`, 'error');
    } finally {
      setIsSyncingToBackend(false);
    }
  }, [state, t, toast]);

  const syncFromBackend = useCallback(async () => {
    if (!backend.isAvailable) {
      toast(t('后端不可用', 'Backend not available'), 'error');
      return;
    }
    const confirmed = await confirm(
      t('从后端同步', 'Sync from Backend'),
      t('从后端同步将覆盖本地数据，是否继续？', 'Syncing from backend will overwrite local data. Continue?'),
      { type: 'warning' },
    );
    if (!confirmed) return;
    setIsSyncingFromBackend(true);
    try {
      const [repoData, releaseData, aiConfigData, webdavConfigData, settingsData] = await Promise.all([
        backend.fetchRepositories(),
        backend.fetchReleases(),
        backend.fetchAIConfigs(),
        backend.fetchWebDAVConfigs(),
        backend.fetchSettings(),
      ]);
      state.setRepositories(repoData.repositories);
      state.setReleases(releaseData.releases);
      state.setAIConfigs(aiConfigData);
      state.setWebDAVConfigs(webdavConfigData);
      const serverHidden = Array.isArray(settingsData.hiddenDefaultCategoryIds) ? settingsData.hiddenDefaultCategoryIds : [];
      for (const categoryId of serverHidden) if (typeof categoryId === 'string') state.hideDefaultCategory(categoryId);
      for (const categoryId of state.hiddenDefaultCategoryIds) {
        if (typeof categoryId === 'string' && !serverHidden.includes(categoryId)) state.showDefaultCategory(categoryId);
      }
      toast(t(
        `已从后端同步：仓库 ${repoData.repositories.length}，发布 ${releaseData.releases.length}，AI配置 ${aiConfigData.length}，WebDAV配置 ${webdavConfigData.length}`,
        `Synced from backend: repos ${repoData.repositories.length}, releases ${releaseData.releases.length}, AI configs ${aiConfigData.length}, WebDAV configs ${webdavConfigData.length}`,
      ), 'success');
    } catch (error) {
      console.error('Sync from backend failed:', error);
      toast(`${t('同步失败', 'Sync failed')}: ${(error as Error).message}`, 'error');
    } finally {
      setIsSyncingFromBackend(false);
    }
  }, [confirm, state, t, toast]);

  return {
    status,
    health,
    urlInput,
    secretInput,
    backendAvailable: backend.isAvailable,
    isSyncingToBackend,
    isSyncingFromBackend,
    setUrlInput,
    setSecretInput,
    testConnection,
    syncToBackend,
    syncFromBackend,
  };
};
