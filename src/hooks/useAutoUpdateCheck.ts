import { useEffect } from 'react';
import { UpdateService } from '../services/updateService';
import { useAppStore } from '../store/useAppStore';

// 用于应用启动时自动检查更新的 Hook
export const useAutoUpdateCheck = () => {
  const { setUpdateNotification } = useAppStore();

  useEffect(() => {
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
            dismissed: false,
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
