import { useEffect } from 'react';
import { UpdateService } from '../services/updateService';
import { useAppStore } from '../store/useAppStore';

// 用于应用启动时自动检查更新的 Hook
// 用户可在 设置-通用-检查更新 关闭自动检查；对某版本点过"不再提示"后，
// 该版本仍为最新时不再提示，出新版本后自动恢复提示。
export const useAutoUpdateCheck = () => {
  useEffect(() => {
    const checkUpdatesOnStartup = async () => {
      // 触发时再读取：持久化水合（IndexedDB 异步）此时已完成，拿到的是真实偏好
      const { autoUpdateCheckEnabled, updatePromptDismissedVersion, setUpdateNotification } =
        useAppStore.getState();

      // 用户关闭了自动检查更新
      if (!autoUpdateCheckEnabled) return;

      try {
        const result = await UpdateService.checkForUpdates();
        if (result.hasUpdate && result.latestVersion) {
          // 该版本已被用户"不再提示"；最新版再次变化（出更新版本）后正常提示
          if (result.latestVersion.number === updatePromptDismissedVersion) return;

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
  }, []);
};
