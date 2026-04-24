import React, { useState } from 'react';
import { Download, RefreshCw, ExternalLink, Calendar, Package } from 'lucide-react';
import { UpdateService, VersionInfo } from '../services/updateService';
import { useAppStore } from '../store/useAppStore';

interface UpdateCheckerProps {
  onUpdateAvailable?: (version: VersionInfo) => void;
}

export const UpdateChecker: React.FC<UpdateCheckerProps> = ({ onUpdateAvailable }) => {
  const { language, setUpdateNotification } = useAppStore();
  const [isChecking, setIsChecking] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<VersionInfo | null>(null);
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

  const checkForUpdates = async (silent = false) => {
    setIsChecking(true);
    setError(null);
    
    try {
      const result = await UpdateService.checkForUpdates();
      
      if (result.hasUpdate && result.latestVersion) {
        setUpdateInfo(result.latestVersion);
        setShowUpdateDialog(true);
        onUpdateAvailable?.(result.latestVersion);
        
        // 设置全局更新通知
        setUpdateNotification({
          version: result.latestVersion.number,
          releaseDate: result.latestVersion.releaseDate,
          changelog: result.latestVersion.changelog,
          downloadUrl: result.latestVersion.downloadUrl,
          dismissed: false
        });
      } else if (!silent) {
        // 只在手动检查时显示"已是最新版本"的消息
        alert(t('当前已是最新版本！', 'You are already using the latest version!'));
      }
    } catch (error) {
      const errorMessage = t('检查更新失败，请检查网络连接', 'Failed to check for updates. Please check your network connection.');
      setError(errorMessage);
      if (!silent) {
        alert(errorMessage);
      }
      console.error('Update check failed:', error);
    } finally {
      setIsChecking(false);
    }
  };

  const handleDownload = () => {
    if (updateInfo?.downloadUrl) {
      UpdateService.openDownloadUrl(updateInfo.downloadUrl);
      setShowUpdateDialog(false);
    }
  };

  const formatDate = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleDateString(language === 'zh' ? 'zh-CN' : 'en-US');
    } catch {
      return dateString;
    }
  };

  return (
    <>
      {/* 检查更新按钮 */}
      <button
        onClick={() => checkForUpdates(false)}
        disabled={isChecking}
        className="flex items-center space-x-2 px-4 py-2 bg-brand-indigo text-white rounded-lg hover:bg-brand-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isChecking ? (
          <RefreshCw className="w-4 h-4 animate-spin" />
        ) : (
          <Download className="w-4 h-4" />
        )}
        <span>
          {isChecking 
            ? t('检查中...', 'Checking...') 
            : t('检查更新', 'Check for Updates')
          }
        </span>
      </button>

      {/* 错误提示 */}
      {error && (
        <div className="mt-2 p-3 bg-gray-100 dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.04] dark:border-black/[0.06] dark:border-white/[0.04] rounded-lg">
          <p className="text-sm text-gray-700 dark:text-text-secondary ">{error}</p>
        </div>
      )}

      {/* 更新对话框 */}
      {showUpdateDialog && updateInfo && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-panel-dark rounded-xl shadow-xl max-w-md w-full max-h-[80vh] overflow-y-auto">
            <div className="p-6">
              {/* 标题 */}
              <div className="flex items-center space-x-3 mb-4">
                <div className="w-12 h-12 bg-brand-indigo/20 dark:bg-brand-indigo/20 rounded-full flex items-center justify-center">
                  <Package className="w-6 h-6 text-brand-violet dark:text-brand-violet" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-text-primary">
                    {t('发现新版本', 'New Version Available')}
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-text-tertiary">
                    v{updateInfo.number}
                  </p>
                </div>
              </div>

              {/* 版本信息 */}
              <div className="mb-4">
                <div className="flex items-center space-x-2 text-sm text-gray-700 dark:text-text-tertiary mb-3">
                  <Calendar className="w-4 h-4" />
                  <span>{t('发布日期:', 'Release Date:')} {formatDate(updateInfo.releaseDate)}</span>
                </div>

                {/* 更新日志 */}
                <div className="mb-4">
                  <h4 className="font-medium text-gray-900 dark:text-text-primary mb-2">
                    {t('更新内容:', 'What\'s New:')}
                  </h4>
                  <ul className="space-y-1">
                    {updateInfo.changelog.map((item, index) => (
                      <li key={index} className="text-sm text-gray-700 dark:text-text-tertiary flex items-start space-x-2">
                        <span className="w-1.5 h-1.5 bg-brand-violet rounded-full mt-2 flex-shrink-0"></span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* 按钮 */}
              <div className="flex space-x-3">
                <button
                  onClick={handleDownload}
                  className="flex-1 flex items-center justify-center space-x-2 px-4 py-2 bg-brand-indigo text-white rounded-lg hover:bg-brand-hover transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                  <span>{t('立即下载', 'Download Now')}</span>
                </button>
                <button
                  onClick={() => setShowUpdateDialog(false)}
                  className="px-4 py-2 bg-gray-200 dark:bg-white/[0.04] text-gray-900 dark:text-text-secondary rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                >
                  {t('稍后提醒', 'Later')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

// 用于应用启动时自动检查更新的Hook
export const useAutoUpdateCheck = () => {
  const { setUpdateNotification } = useAppStore();
  
  React.useEffect(() => {
    const checkUpdatesOnStartup = async () => {
      try {
        const result = await UpdateService.checkForUpdates();
        if (result.hasUpdate && result.latestVersion) {
          console.log('New version available:', result.latestVersion.number);
          
          // 设置全局更新通知
          setUpdateNotification({
            version: result.latestVersion.number,
            releaseDate: result.latestVersion.releaseDate,
            changelog: result.latestVersion.changelog,
            downloadUrl: result.latestVersion.downloadUrl,
            dismissed: false
          });
        }
      } catch (error) {
        console.error('Startup update check failed:', error);
      }
    };

    // 延迟3秒后检查更新，避免影响应用启动速度
    const timer = setTimeout(checkUpdatesOnStartup, 3000);
    return () => clearTimeout(timer);
  }, [setUpdateNotification]);
};