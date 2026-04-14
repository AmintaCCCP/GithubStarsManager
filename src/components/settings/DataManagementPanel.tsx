import React, { useState, useCallback } from 'react';
import {
  Trash2,
  AlertTriangle,
  Database,
  Github,
  Tag,
  Bot,
  Cloud,
  FolderTree,
  CheckCircle,
  XCircle,
  Loader2,
  FileWarning,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { indexedDBStorage } from '../../services/indexedDbStorage';

interface DataManagementPanelProps {
  t: (zh: string, en: string) => string;
}

type DeleteOperation =
  | 'repositories'
  | 'releases'
  | 'aiConfigs'
  | 'webdavConfigs'
  | 'categorySettings'
  | 'all';

interface DeleteConfirmation {
  type: DeleteOperation | null;
  isOpen: boolean;
  githubUsernameInput: string;
}

interface OperationLog {
  id: string;
  operation: string;
  timestamp: string;
  success: boolean;
  details?: string;
}

export const DataManagementPanel: React.FC<DataManagementPanelProps> = ({ t }) => {
  const {
    user,
    repositories,
    releases,
    aiConfigs,
    webdavConfigs,
    customCategories,
    setRepositories,
    setReleases,
    logout,
  } = useAppStore();

  const [confirmation, setConfirmation] = useState<DeleteConfirmation>({
    type: null,
    isOpen: false,
    githubUsernameInput: '',
  });
  const [isDeleting, setIsDeleting] = useState(false);
  const [operationLogs, setOperationLogs] = useState<OperationLog[]>([]);
  const [showSuccessMessage, setShowSuccessMessage] = useState<string | null>(null);
  const [showErrorMessage, setShowErrorMessage] = useState<string | null>(null);

  const addLog = useCallback((operation: string, success: boolean, details?: string) => {
    const newLog: OperationLog = {
      id: Date.now().toString(),
      operation,
      timestamp: new Date().toLocaleString(),
      success,
      details,
    };
    setOperationLogs((prev) => [newLog, ...prev].slice(0, 50));
  }, []);

  const showSuccess = useCallback((message: string) => {
    setShowSuccessMessage(message);
    setTimeout(() => setShowSuccessMessage(null), 3000);
  }, []);

  const showError = useCallback((message: string) => {
    setShowErrorMessage(message);
    setTimeout(() => setShowErrorMessage(null), 5000);
  }, []);

  const clearAllStorage = async () => {
    // App-owned localStorage keys and prefixes
    const APP_LOCALSTORAGE_KEYS = [
      'github-stars-search-history',
      'lastSearchTime',
    ];
    const APP_LOCALSTORAGE_PREFIXES = [
      'github-stars-manager',
      'zustand',
    ];

    // Clear localStorage - only remove app-owned keys
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        const isExactMatch = APP_LOCALSTORAGE_KEYS.includes(key);
        const isPrefixMatch = APP_LOCALSTORAGE_PREFIXES.some(prefix => key.startsWith(prefix));
        if (isExactMatch || isPrefixMatch) {
          keysToRemove.push(key);
        }
      }
    }
    keysToRemove.forEach((key) => localStorage.removeItem(key));

    // App-owned sessionStorage keys
    const APP_SESSIONSTORAGE_KEYS = [
      'github-stars-manager-backend-secret',
    ];

    // Clear sessionStorage - only remove app-owned keys
    APP_SESSIONSTORAGE_KEYS.forEach((key) => sessionStorage.removeItem(key));

    // Clear IndexedDB - only remove the specific database used by this app
    try {
      await indexedDBStorage.removeItem('github-stars-manager');
    } catch (error) {
      console.error('Failed to clear IndexedDB', error);
      throw new Error('IndexedDB clear failed');
    }
  };

  const deleteRepositories = async () => {
    try {
      setRepositories([]);
      addLog(t('删除GitHub Stars仓库数据', 'Delete GitHub Stars repositories'), true);
      showSuccess(t('GitHub Stars仓库数据已删除', 'GitHub Stars repositories deleted'));
    } catch (error) {
      addLog(
        t('删除GitHub Stars仓库数据', 'Delete GitHub Stars repositories'),
        false,
        String(error)
      );
      showError(t('删除失败，请重试', 'Delete failed, please try again'));
      throw error;
    }
  };

  const deleteReleases = async () => {
    try {
      setReleases([]);
      addLog(t('删除Release发布信息数据', 'Delete Release information'), true);
      showSuccess(t('Release发布信息数据已删除', 'Release information deleted'));
    } catch (error) {
      addLog(
        t('删除Release发布信息数据', 'Delete Release information'),
        false,
        String(error)
      );
      showError(t('删除失败，请重试', 'Delete failed, please try again'));
      throw error;
    }
  };

  const deleteAIConfigs = async () => {
    try {
      const store = useAppStore.getState();
      store.setAIConfigs([]);
      store.setActiveAIConfig(null);
      addLog(t('删除AI服务配置数据', 'Delete AI service configurations'), true);
      showSuccess(t('AI服务配置数据已删除', 'AI service configurations deleted'));
    } catch (error) {
      addLog(
        t('删除AI服务配置数据', 'Delete AI service configurations'),
        false,
        String(error)
      );
      showError(t('删除失败，请重试', 'Delete failed, please try again'));
      throw error;
    }
  };

  const deleteWebDAVConfigs = async () => {
    try {
      const store = useAppStore.getState();
      store.setWebDAVConfigs([]);
      store.setActiveWebDAVConfig(null);
      addLog(t('删除WebDAV配置数据', 'Delete WebDAV configurations'), true);
      showSuccess(t('WebDAV配置数据已删除', 'WebDAV configurations deleted'));
    } catch (error) {
      addLog(
        t('删除WebDAV配置数据', 'Delete WebDAV configurations'),
        false,
        String(error)
      );
      showError(t('删除失败，请重试', 'Delete failed, please try again'));
      throw error;
    }
  };

  const deleteCategorySettings = async () => {
    try {
      const store = useAppStore.getState();
      // Reset category-related state
      store.customCategories.forEach((cat) => {
        store.deleteCustomCategory(cat.id);
      });
      // Clear hidden default categories
      useAppStore.setState({ hiddenDefaultCategoryIds: [] });
      addLog(t('删除分类显示设置数据', 'Delete category display settings'), true);
      showSuccess(t('分类显示设置数据已删除', 'Category display settings deleted'));
    } catch (error) {
      addLog(
        t('删除分类显示设置数据', 'Delete category display settings'),
        false,
        String(error)
      );
      showError(t('删除失败，请重试', 'Delete failed, please try again'));
      throw error;
    }
  };

  const deleteAllData = async () => {
    try {
      // Perform logout which clears most data
      logout();
      // Clear all storage
      await clearAllStorage();
      addLog(t('删除所有数据', 'Delete all data'), true);
      showSuccess(t('所有数据已删除，应用将重新加载', 'All data deleted, app will reload'));
      // Reload page after a short delay
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } catch (error) {
      addLog(t('删除所有数据', 'Delete all data'), false, String(error));
      showError(t('删除失败，请重试', 'Delete failed, please try again'));
      throw error;
    }
  };

  const handleDelete = async () => {
    if (!confirmation.type) return;

    // Verify GitHub username for "delete all" operation
    if (confirmation.type === 'all') {
      if (!user || confirmation.githubUsernameInput !== user.login) {
        showError(t('GitHub用户名验证失败', 'GitHub username verification failed'));
        return;
      }
    }

    setIsDeleting(true);
    try {
      switch (confirmation.type) {
        case 'repositories':
          await deleteRepositories();
          break;
        case 'releases':
          await deleteReleases();
          break;
        case 'aiConfigs':
          await deleteAIConfigs();
          break;
        case 'webdavConfigs':
          await deleteWebDAVConfigs();
          break;
        case 'categorySettings':
          await deleteCategorySettings();
          break;
        case 'all':
          await deleteAllData();
          break;
      }
      setConfirmation({ type: null, isOpen: false, githubUsernameInput: '' });
    } catch {
      // Error already handled in individual delete functions
    } finally {
      setIsDeleting(false);
    }
  };

  const openConfirmation = (type: DeleteOperation) => {
    setConfirmation({
      type,
      isOpen: true,
      githubUsernameInput: '',
    });
  };

  const closeConfirmation = () => {
    setConfirmation({ type: null, isOpen: false, githubUsernameInput: '' });
  };

  const getDeleteDescription = (type: DeleteOperation): string => {
    switch (type) {
      case 'repositories':
        return t(
          '这将删除所有GitHub Stars仓库列表数据，包括仓库信息、AI分析结果和自定义标签。此操作不可恢复。',
          'This will delete all GitHub Stars repository data, including repository info, AI analysis results, and custom tags. This action cannot be undone.'
        );
      case 'releases':
        return t(
          '这将删除所有Release发布信息数据，包括发布说明和资源文件信息。此操作不可恢复。',
          'This will delete all Release information data, including release notes and asset information. This action cannot be undone.'
        );
      case 'aiConfigs':
        return t(
          '这将删除所有AI服务配置数据，包括API密钥和模型设置。此操作不可恢复。',
          'This will delete all AI service configuration data, including API keys and model settings. This action cannot be undone.'
        );
      case 'webdavConfigs':
        return t(
          '这将删除所有WebDAV配置数据，包括服务器地址和认证信息。此操作不可恢复。',
          'This will delete all WebDAV configuration data, including server addresses and authentication info. This action cannot be undone.'
        );
      case 'categorySettings':
        return t(
          '这将删除所有自定义分类和分类显示设置。此操作不可恢复。',
          'This will delete all custom categories and category display settings. This action cannot be undone.'
        );
      case 'all':
        return t(
          '这将删除所有应用程序数据，包括所有用户数据、GitHub令牌、配置文件等。此操作将重置应用程序到初始状态，不可恢复！',
          'This will delete ALL application data, including all user data, GitHub tokens, configuration files, etc. This will reset the application to its initial state and cannot be undone!'
        );
      default:
        return '';
    }
  };

  const getDeleteTitle = (type: DeleteOperation): string => {
    switch (type) {
      case 'repositories':
        return t('删除GitHub Stars仓库数据', 'Delete GitHub Stars Repositories');
      case 'releases':
        return t('删除Release发布信息数据', 'Delete Release Information');
      case 'aiConfigs':
        return t('删除AI服务配置数据', 'Delete AI Service Configurations');
      case 'webdavConfigs':
        return t('删除WebDAV配置数据', 'Delete WebDAV Configurations');
      case 'categorySettings':
        return t('删除分类显示设置数据', 'Delete Category Display Settings');
      case 'all':
        return t('删除所有数据', 'Delete All Data');
      default:
        return '';
    }
  };

  const dataStats = [
    {
      key: 'repositories',
      label: t('GitHub Stars仓库', 'GitHub Stars Repositories'),
      count: repositories.length,
      icon: <Github className="w-5 h-5" />,
      color: 'text-blue-600 dark:text-blue-400',
      bgColor: 'bg-blue-50 dark:bg-blue-900/20',
    },
    {
      key: 'releases',
      label: t('Release发布信息', 'Release Information'),
      count: releases.length,
      icon: <Tag className="w-5 h-5" />,
      color: 'text-green-600 dark:text-green-400',
      bgColor: 'bg-green-50 dark:bg-green-900/20',
    },
    {
      key: 'aiConfigs',
      label: t('AI服务配置', 'AI Service Configurations'),
      count: aiConfigs.length,
      icon: <Bot className="w-5 h-5" />,
      color: 'text-purple-600 dark:text-purple-400',
      bgColor: 'bg-purple-50 dark:bg-purple-900/20',
    },
    {
      key: 'webdavConfigs',
      label: t('WebDAV配置', 'WebDAV Configurations'),
      count: webdavConfigs.length,
      icon: <Cloud className="w-5 h-5" />,
      color: 'text-cyan-600 dark:text-cyan-400',
      bgColor: 'bg-cyan-50 dark:bg-cyan-900/20',
    },
    {
      key: 'categorySettings',
      label: t('自定义分类', 'Custom Categories'),
      count: customCategories.length,
      icon: <FolderTree className="w-5 h-5" />,
      color: 'text-orange-600 dark:text-orange-400',
      bgColor: 'bg-orange-50 dark:bg-orange-900/20',
    },
  ];

  return (
    <div className="space-y-8">
      {/* Success Message */}
      {showSuccessMessage && (
        <div className="fixed top-4 right-4 z-50 flex items-center space-x-2 px-4 py-3 bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200 rounded-lg shadow-lg animate-in slide-in-from-top-2">
          <CheckCircle className="w-5 h-5" />
          <span>{showSuccessMessage}</span>
        </div>
      )}

      {/* Error Message */}
      {showErrorMessage && (
        <div className="fixed top-4 right-4 z-50 flex items-center space-x-2 px-4 py-3 bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200 rounded-lg shadow-lg animate-in slide-in-from-top-2">
          <XCircle className="w-5 h-5" />
          <span>{showErrorMessage}</span>
        </div>
      )}

      {/* Data Statistics */}
      <section>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
          <Database className="w-5 h-5 mr-2 text-blue-600 dark:text-blue-400" />
          {t('数据概览', 'Data Overview')}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {dataStats.map((stat) => (
            <div
              key={stat.key}
              className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className={`p-2 rounded-lg ${stat.bgColor} ${stat.color}`}>
                    {stat.icon}
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">{stat.label}</p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">
                      {stat.count}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Selective Data Deletion */}
      <section>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
          <Trash2 className="w-5 h-5 mr-2 text-orange-600 dark:text-orange-400" />
          {t('选择性删除数据', 'Selective Data Deletion')}
        </h3>
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {dataStats.map((stat) => (
              <div
                key={stat.key}
                className="flex items-center justify-between px-4 py-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
              >
                <div className="flex items-center space-x-3">
                  <div className={`p-2 rounded-lg ${stat.bgColor} ${stat.color}`}>
                    {stat.icon}
                  </div>
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">{stat.label}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {stat.count} {t('条记录', 'records')}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => openConfirmation(stat.key as DeleteOperation)}
                  disabled={stat.count === 0}
                  className="flex items-center space-x-2 px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>{t('删除', 'Delete')}</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Delete All Data */}
      <section>
        <h3 className="text-lg font-semibold text-red-600 dark:text-red-400 mb-4 flex items-center">
          <AlertTriangle className="w-5 h-5 mr-2" />
          {t('危险区域', 'Danger Zone')}
        </h3>
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6">
          <div className="flex items-start space-x-4">
            <div className="p-3 bg-red-100 dark:bg-red-800 rounded-lg">
              <FileWarning className="w-6 h-6 text-red-600 dark:text-red-400" />
            </div>
            <div className="flex-1">
              <h4 className="text-lg font-semibold text-red-900 dark:text-red-100">
                {t('删除所有数据', 'Delete All Data')}
              </h4>
              <p className="mt-2 text-red-700 dark:text-red-300">
                {t(
                  '此操作将永久删除所有应用程序数据，包括所有用户数据、GitHub令牌、配置文件等。应用程序将重置为初始状态。此操作不可恢复！',
                  'This will permanently delete ALL application data, including all user data, GitHub tokens, configuration files, etc. The application will be reset to its initial state. This action cannot be undone!'
                )}
              </p>
              <button
                onClick={() => openConfirmation('all')}
                className="mt-4 px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg transition-colors flex items-center space-x-2"
              >
                <Trash2 className="w-5 h-5" />
                <span>{t('删除所有数据', 'Delete All Data')}</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Operation Logs */}
      {operationLogs.length > 0 && (
        <section>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            {t('操作日志', 'Operation Logs')}
          </h3>
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="max-h-64 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-700 sticky top-0">
                  <tr>
                    <th className="px-4 py-2 text-left text-gray-600 dark:text-gray-300">
                      {t('时间', 'Time')}
                    </th>
                    <th className="px-4 py-2 text-left text-gray-600 dark:text-gray-300">
                      {t('操作', 'Operation')}
                    </th>
                    <th className="px-4 py-2 text-left text-gray-600 dark:text-gray-300">
                      {t('状态', 'Status')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {operationLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-4 py-2 text-gray-500 dark:text-gray-400">
                        {log.timestamp}
                      </td>
                      <td className="px-4 py-2 text-gray-900 dark:text-white">{log.operation}</td>
                      <td className="px-4 py-2">
                        {log.success ? (
                          <span className="inline-flex items-center px-2 py-1 text-xs font-medium text-green-700 dark:text-green-300 bg-green-100 dark:bg-green-900/30 rounded-full">
                            <CheckCircle className="w-3 h-3 mr-1" />
                            {t('成功', 'Success')}
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-1 text-xs font-medium text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/30 rounded-full">
                            <XCircle className="w-3 h-3 mr-1" />
                            {t('失败', 'Failed')}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* Confirmation Modal */}
      {confirmation.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md bg-white dark:bg-gray-800 rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-6 py-4 bg-red-50 dark:bg-red-900/20 border-b border-red-100 dark:border-red-800">
              <div className="flex items-center space-x-3">
                <AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-400" />
                <h3 className="text-lg font-semibold text-red-900 dark:text-red-100">
                  {getDeleteTitle(confirmation.type!)}
                </h3>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <div className="flex items-start space-x-3 text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 p-4 rounded-lg">
                <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <p className="text-sm">{getDeleteDescription(confirmation.type!)}</p>
              </div>

              {/* GitHub Username Verification for "Delete All" */}
              {confirmation.type === 'all' && user && (
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t(
                      '请输入您的GitHub用户名以确认此操作：',
                      'Please enter your GitHub username to confirm this action:'
                    )}
                    <span className="ml-2 font-mono text-blue-600 dark:text-blue-400">
                      {user.login}
                    </span>
                  </label>
                  <input
                    type="text"
                    value={confirmation.githubUsernameInput}
                    onChange={(e) =>
                      setConfirmation((prev) => ({
                        ...prev,
                        githubUsernameInput: e.target.value,
                      }))
                    }
                    placeholder={t('输入GitHub用户名', 'Enter GitHub username')}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 dark:bg-gray-700 dark:text-white"
                  />
                </div>
              )}

              <div className="flex space-x-3 pt-4">
                <button
                  onClick={closeConfirmation}
                  disabled={isDeleting}
                  className="flex-1 px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors disabled:opacity-50"
                >
                  {t('取消', 'Cancel')}
                </button>
                <button
                  onClick={handleDelete}
                  disabled={
                    isDeleting ||
                    (confirmation.type === 'all' &&
                      confirmation.githubUsernameInput !== user?.login)
                  }
                  className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
                >
                  {isDeleting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>{t('删除中...', 'Deleting...')}</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-4 h-4" />
                      <span>{t('确认删除', 'Confirm Delete')}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
