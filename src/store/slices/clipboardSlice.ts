import type { AppActions, AppStoreSlice } from '../types';

/**
 * 剪贴板 GitHub 链接识别（开发守则 §11）。
 *
 * 这里只有一个开关：识别本身由 `useClipboardGitHubDetection` 在前台 focus 时触发，
 * 不在这层做任何读取或缓存。
 */
export const createClipboardSlice: AppStoreSlice<Pick<AppActions,
  | 'setClipboardDetectionEnabled'
>> = (set) => ({
  setClipboardDetectionEnabled: (enabled) => set({ clipboardDetectionEnabled: enabled }),
});
