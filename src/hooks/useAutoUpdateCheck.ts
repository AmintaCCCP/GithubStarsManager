import { useEffect } from 'react';
import { UpdateService } from '../services/updateService';
import { useAppStore } from '../store/useAppStore';

// 用于应用启动时自动检查更新的 Hook
// 用户可在 设置-通用-检查更新 关闭自动检查；对某版本点过"不再提示"后，
// 该版本仍为最新时不再提示，出新版本后自动恢复提示。
export const useAutoUpdateCheck = () => {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe: (() => void) | undefined;

    const checkUpdatesOnStartup = async () => {
      // 定时器在水合完成后才启动，触发时读取到的已是真实持久化偏好
      if (!useAppStore.getState().autoUpdateCheckEnabled) return;

      try {
        const result = await UpdateService.checkForUpdates();
        // 请求在途期间偏好可能已变化（用户手动"不再提示"该版本，或直接关闭了
        // 自动检查）：落地前以最新偏好为准，避免覆盖用户刚做出的选择
        const { autoUpdateCheckEnabled, updatePromptDismissedVersion, setUpdateNotification } =
          useAppStore.getState();
        if (!autoUpdateCheckEnabled) return;

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

    // 水合前 store 里是默认偏好，不能据此替用户做"检查/不检查"的决定：
    // 必须等 hasHydrated 后再启动检查定时器。
    const scheduleCheck = () => {
      // 延迟3秒后检查更新，避免影响应用启动速度
      timer = setTimeout(checkUpdatesOnStartup, 3000);
    };

    if (useAppStore.getState().hasHydrated) {
      scheduleCheck();
    } else {
      unsubscribe = useAppStore.subscribe((state) => {
        if (!state.hasHydrated) return;
        unsubscribe?.();
        unsubscribe = undefined;
        scheduleCheck();
      });
    }

    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe?.();
    };
  }, []);
};
