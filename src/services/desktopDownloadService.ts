/**
 * 桌面端 release 资产下载桥。
 *
 * Windows / macOS / Linux 客户端把下载交给主进程流式落盘：渲染进程只订阅进度，
 * 不再用 `fetch` + `response.blob()` 把整包聚进内存（数百 MB 的资产会因此卡死或 OOM），
 * 也因此才有进度与取消。浏览器版没有这条通道，仍走原有分支。
 */

export interface DesktopDownloadProgress {
  transferId: string;
  receivedBytes: number;
  totalBytes: number | null;
}

export interface SaveReleaseAssetRequest {
  /** 同时用作进度事件的关联键，调用方保证同一资产不会并发下载两次。 */
  transferId: string;
  url: string;
  fileName: string;
  expectedSize?: number | null;
  /** 形如 `Bearer <token>`；主进程不持有 Token，私有资产由调用方显式提供。 */
  authorization?: string;
}

export interface DesktopDownloadResult {
  success: boolean;
  canceled?: boolean;
  fileName?: string;
  filePath?: string;
  bytes?: number;
  error?: { code: string; message: string };
}

export interface DownloadsElectronAPI {
  saveReleaseAsset: (request: SaveReleaseAssetRequest) => Promise<DesktopDownloadResult>;
  cancel: (transferId: string) => Promise<{ success: boolean }>;
  /** 订阅进度，返回取消订阅函数。 */
  onProgress: (listener: (progress: DesktopDownloadProgress) => void) => () => void;
}

const getDownloadsApi = (): DownloadsElectronAPI | undefined => (
  typeof window === 'undefined' ? undefined : window.electronAPI?.downloads
);

export const desktopDownloadService = {
  /** 仅在 Electron 主机上可用；其他环境返回 false，调用方回落到浏览器分支。 */
  isAvailable(): boolean {
    return !!getDownloadsApi();
  },

  async saveReleaseAsset(request: SaveReleaseAssetRequest): Promise<DesktopDownloadResult> {
    const api = getDownloadsApi();
    if (!api) return { success: false, error: { code: 'DOWNLOAD_UNAVAILABLE', message: 'Desktop download is unavailable' } };
    return api.saveReleaseAsset(request);
  },

  async cancel(transferId: string): Promise<void> {
    await getDownloadsApi()?.cancel(transferId);
  },

  /** 订阅下载进度；桌面通道不可用时返回空清理函数。 */
  subscribe(listener: (progress: DesktopDownloadProgress) => void): () => void {
    const api = getDownloadsApi();
    if (!api) return () => {};
    return api.onProgress(listener);
  },
};
