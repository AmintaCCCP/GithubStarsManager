import React, { useState, useEffect } from 'react';
import { Server, TestTube, RefreshCw, Upload, Download, CheckCircle, AlertCircle } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { backend } from '../../services/backendAdapter';

interface BackendPanelProps {
  t: (zh: string, en: string) => string;
}

export const BackendPanel: React.FC<BackendPanelProps> = ({ t }) => {
  const {
    repositories,
    releases,
    aiConfigs,
    webdavConfigs,
    hiddenDefaultCategoryIds,
    backendApiSecret,
    setBackendApiSecret,
    setRepositories,
    setReleases,
    setAIConfigs,
    setWebDAVConfigs,
    showDefaultCategory,
    hideDefaultCategory,
  } = useAppStore();

  const [status, setStatus] = useState<'connected' | 'disconnected' | 'checking'>('disconnected');
  const [health, setHealth] = useState<{ version: string; timestamp: string } | null>(null);
  const [isSyncingToBackend, setIsSyncingToBackend] = useState(false);
  const [isSyncingFromBackend, setIsSyncingFromBackend] = useState(false);
  const [secretInput, setSecretInput] = useState(backendApiSecret || '');

  useEffect(() => {
    const checkBackend = async () => {
      setStatus('checking');
      try {
        await backend.init();
        const healthData = await backend.checkHealth();
        if (healthData) {
          setStatus('connected');
          setHealth({ version: healthData.version, timestamp: healthData.timestamp });
        } else {
          setStatus('disconnected');
          setHealth(null);
        }
      } catch {
        setStatus('disconnected');
        setHealth(null);
      }
    };
    checkBackend();
  }, []);

  const handleTestConnection = async () => {
    setStatus('checking');
    setBackendApiSecret(secretInput || null);
    try {
      await backend.init();
      const healthData = await backend.checkHealth();
      const authOk = secretInput ? await backend.verifyAuth() : true;
      if (healthData && authOk) {
        setStatus('connected');
        setHealth({ version: healthData.version, timestamp: healthData.timestamp });
        alert(t('后端连接成功！', 'Backend connection successful!'));
      } else {
        setStatus('disconnected');
        setHealth(null);
        alert(t(
          '后端连接失败，请检查服务器状态或 API Secret 是否正确。',
          'Backend connection failed. Please check the server status or whether the API Secret is correct.'
        ));
      }
    } catch {
      setStatus('disconnected');
      setHealth(null);
      alert(t(
        '后端连接失败，请检查服务器状态或 API Secret 是否正确。',
        'Backend connection failed. Please check the server status or whether the API Secret is correct.'
      ));
    }
  };

  const handleSyncToBackend = async () => {
    if (!backend.isAvailable) {
      alert(t('后端不可用', 'Backend not available'));
      return;
    }
    setIsSyncingToBackend(true);
    try {
      await backend.syncRepositories(repositories);
      await backend.syncReleases(releases);
      await backend.syncAIConfigs(aiConfigs);
      await backend.syncWebDAVConfigs(webdavConfigs);
      await backend.syncSettings({ hiddenDefaultCategoryIds });
      alert(t(
        `已同步到后端：仓库 ${repositories.length}，发布 ${releases.length}，AI配置 ${aiConfigs.length}，WebDAV配置 ${webdavConfigs.length}`,
        `Synced to backend: repos ${repositories.length}, releases ${releases.length}, AI configs ${aiConfigs.length}, WebDAV configs ${webdavConfigs.length}`
      ));
    } catch (error) {
      console.error('Sync to backend failed:', error);
      alert(`${t('同步失败', 'Sync failed')}: ${(error as Error).message}`);
    } finally {
      setIsSyncingToBackend(false);
    }
  };

  const handleSyncFromBackend = async () => {
    if (!backend.isAvailable) {
      alert(t('后端不可用', 'Backend not available'));
      return;
    }
    
    if (!confirm(t(
      '从后端同步将覆盖本地数据，是否继续？',
      'Syncing from backend will overwrite local data. Continue?'
    ))) return;

    setIsSyncingFromBackend(true);
    try {
      const repoData = await backend.fetchRepositories();
      const releaseData = await backend.fetchReleases();
      const aiConfigData = await backend.fetchAIConfigs();
      const webdavConfigData = await backend.fetchWebDAVConfigs();
      const settingsData = await backend.fetchSettings();
      
      // Always apply backend snapshot to state (empty array allowed)
      setRepositories(repoData.repositories);
      setReleases(releaseData.releases);
      setAIConfigs(aiConfigData);
      setWebDAVConfigs(webdavConfigData);
      // 从服务端数据中隐藏所有应隐藏的分类
      if (Array.isArray(settingsData.hiddenDefaultCategoryIds)) {
        for (const categoryId of settingsData.hiddenDefaultCategoryIds) {
          if (typeof categoryId === 'string') hideDefaultCategory(categoryId);
        }
      }
      // 显示本地隐藏列表中但服务端没有隐藏的分类（即本地手动显示的）
      if (Array.isArray(hiddenDefaultCategoryIds)) {
        const hiddenIdsFromServer = Array.isArray(settingsData.hiddenDefaultCategoryIds) 
          ? settingsData.hiddenDefaultCategoryIds 
          : [];
        for (const categoryId of hiddenDefaultCategoryIds) {
          if (typeof categoryId === 'string' && !hiddenIdsFromServer.includes(categoryId)) {
            showDefaultCategory(categoryId);
          }
        }
      }
      
      alert(t(
        `已从后端同步：仓库 ${repoData.repositories.length}，发布 ${releaseData.releases.length}，AI配置 ${aiConfigData.length}，WebDAV配置 ${webdavConfigData.length}`,
        `Synced from backend: repos ${repoData.repositories.length}, releases ${releaseData.releases.length}, AI configs ${aiConfigData.length}, WebDAV configs ${webdavConfigData.length}`
      ));
    } catch (error) {
      console.error('Sync from backend failed:', error);
      alert(`${t('同步失败', 'Sync failed')}: ${(error as Error).message}`);
    } finally {
      setIsSyncingFromBackend(false);
    }
  };

  const getStatusIcon = () => {
    switch (status) {
      case 'connected':
        return <CheckCircle className="w-5 h-5 text-gray-700 dark:text-text-secondary" />;
      case 'checking':
        return <RefreshCw className="w-5 h-5 text-gray-700 dark:text-text-secondary animate-spin" />;
      default:
        return <AlertCircle className="w-5 h-5 text-gray-700 dark:text-text-secondary" />;
    }
  };

  const getStatusText = () => {
    switch (status) {
      case 'connected':
        return t('已连接', 'Connected');
      case 'checking':
        return t('检查中...', 'Checking...');
      default:
        return t('未连接', 'Not Connected');
    }
  };

  const getStatusClass = () => {
    switch (status) {
      case 'connected':
        return 'bg-status-emerald text-status-emerald ';
      case 'checking':
        return 'bg-gray-100 text-gray-700 dark:bg-white/[0.04] dark:text-text-secondary';
      default:
        return 'bg-gray-100 text-gray-700 dark:bg-white/[0.04] dark:text-text-secondary';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Server className="w-6 h-6 text-gray-700 dark:text-text-secondary " />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-text-primary">
            {t('后端服务器', 'Backend Server')}
          </h3>
        </div>
        <span className={`inline-flex items-center space-x-2 px-3 py-1 rounded-full text-sm font-medium ${getStatusClass()}`}>
          {getStatusIcon()}
          <span>{getStatusText()}</span>
        </span>
      </div>

      {health && (
        <div className="p-4 bg-status-emerald rounded-lg border border-black/[0.06] dark:border-white/[0.04] dark:border-black/[0.06] dark:border-white/[0.04]">
          <div className="flex items-center space-x-2 mb-2">
            <CheckCircle className="w-5 h-5 text-status-emerald " />
            <span className="font-medium text-status-emerald ">
              {t('连接正常', 'Connection OK')}
            </span>
          </div>
          <p className="text-sm text-status-emerald ">
            {t('版本', 'Version')}: {health.version}
          </p>
        </div>
      )}

      <div className="p-4 bg-light-bg dark:bg-white/[0.04] rounded-lg border border-black/[0.06] dark:border-white/[0.04]">
        <label className="block text-sm font-medium text-gray-900 dark:text-text-secondary mb-2">
          {t('API 密钥', 'API Secret')}
        </label>
        <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-3">
          <input
            type="password"
            value={secretInput}
            onChange={(e) => setSecretInput(e.target.value)}
            className="flex-1 px-3 py-2 border border-black/[0.06] dark:border-white/[0.04] rounded-lg bg-white dark:bg-panel-dark text-gray-900 dark:text-text-primary"
            placeholder={t('输入后端 API_SECRET（可选）', 'Enter backend API_SECRET (optional)')}
          />
          <button
            onClick={handleTestConnection}
            disabled={status === 'checking'}
            className="flex items-center justify-center space-x-2 px-4 py-2 bg-gray-100 dark:bg-white/[0.04] text-white rounded-lg hover:bg-gray-100 dark:bg-white/[0.04] transition-colors disabled:opacity-50"
          >
            {status === 'checking' ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <TestTube className="w-4 h-4" />
            )}
            <span>{t('测试连接', 'Test Connection')}</span>
          </button>
        </div>
        <p className="text-xs text-gray-500 dark:text-text-tertiary mt-2">
          {t(
            '如果后端设置了 API_SECRET 环境变量，在此输入相同的值。未设置则留空。',
            'If the backend has API_SECRET env var set, enter the same value here. Leave empty if not set.'
          )}
        </p>
      </div>

      {backend.isAvailable && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-6 bg-light-bg dark:bg-white/[0.04] rounded-lg border border-black/[0.06] dark:border-white/[0.04]">
            <div className="flex items-center space-x-3 mb-4">
              <Upload className="w-8 h-8 text-status-emerald " />
              <div>
                <h4 className="font-medium text-gray-900 dark:text-text-primary">
                  {t('同步到后端', 'Sync to Backend')}
                </h4>
                <p className="text-sm text-gray-500 dark:text-text-tertiary">
                  {t('将本地数据上传到后端', 'Upload local data to backend')}
                </p>
              </div>
            </div>
            <button
              onClick={handleSyncToBackend}
              disabled={isSyncingToBackend}
              className="w-full flex items-center justify-center space-x-2 px-4 py-3 bg-brand-indigo text-white rounded-lg hover:bg-brand-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSyncingToBackend ? (
                <RefreshCw className="w-5 h-5 animate-spin" />
              ) : (
                <Upload className="w-5 h-5" />
              )}
              <span>{isSyncingToBackend ? t('同步中...', 'Syncing...') : t('开始同步', 'Start Sync')}</span>
            </button>
          </div>

          <div className="p-6 bg-light-bg dark:bg-white/[0.04] rounded-lg border border-black/[0.06] dark:border-white/[0.04]">
            <div className="flex items-center space-x-3 mb-4">
              <Download className="w-8 h-8 text-brand-violet dark:text-brand-violet" />
              <div>
                <h4 className="font-medium text-gray-900 dark:text-text-primary">
                  {t('从后端同步', 'Sync from Backend')}
                </h4>
                <p className="text-sm text-gray-500 dark:text-text-tertiary">
                  {t('从后端下载数据到本地', 'Download data from backend to local')}
                </p>
              </div>
            </div>
            <button
              onClick={handleSyncFromBackend}
              disabled={isSyncingFromBackend}
              className="w-full flex items-center justify-center space-x-2 px-4 py-3 bg-brand-indigo text-white rounded-lg hover:bg-brand-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSyncingFromBackend ? (
                <RefreshCw className="w-5 h-5 animate-spin" />
              ) : (
                <Download className="w-5 h-5" />
              )}
              <span>{isSyncingFromBackend ? t('同步中...', 'Syncing...') : t('开始同步', 'Start Sync')}</span>
            </button>
          </div>
        </div>
      )}

      <div className="p-4 bg-light-bg dark:bg-white/[0.04] rounded-lg">
        <h4 className="font-medium text-gray-900 dark:text-text-primary mb-2">
          {t('同步内容包括：', 'Sync includes:')}
        </h4>
        <ul className="text-sm text-gray-700 dark:text-text-tertiary space-y-1">
          <li>• {t('GitHub Stars 仓库列表', 'GitHub Stars repository list')}</li>
          <li>• {t('Release 发布信息', 'Release information')}</li>
          <li>• {t('AI 服务配置', 'AI service configurations')}</li>
          <li>• {t('WebDAV 配置', 'WebDAV configurations')}</li>
          <li>• {t('分类显示设置', 'Category visibility settings')}</li>
        </ul>
      </div>
    </div>
  );
};
