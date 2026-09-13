import type {
  ProxyConfig,
  Repository,
  Category,
  EmbeddingConfig,
  McpServiceConfig,
  Release,
} from '../types';

/** Alias of persisted MCP prefs — keep identical to McpServiceConfig to avoid drift. */
export type McpLocalConfig = McpServiceConfig;

/** Secrets stay in main-process memory only (IPC snapshot); not written to disk by MCP server. */
export interface McpVectorRuntimeConfig {
  enabled: boolean;
  workerUrl: string;
  authToken: string;
  searchThreshold?: number;
  searchTopK?: number;
  embedding: Pick<
    EmbeddingConfig,
    'apiType' | 'baseUrl' | 'apiKey' | 'model' | 'dimensions'
  > | null;
}

export interface McpDataSnapshot {
  repositories: Repository[];
  customCategories: Category[];
  releases: Release[];
  vectorSearchConfig: McpVectorRuntimeConfig;
  snapshotAt: string;
}

export interface McpElectronAPI {
  setConfig: (config: McpLocalConfig) => Promise<{ success: boolean; error?: string }>;
  getConfig: () => Promise<McpLocalConfig | null>;
  pushSnapshot: (snapshot: McpDataSnapshot) => Promise<{ success: boolean }>;
  start: () => Promise<{ success: boolean; error?: string; url?: string }>;
  stop: () => Promise<{ success: boolean }>;
  getStatus: () => Promise<{ running: boolean; url?: string; error?: string }>;
}

/** Desktop client prefs: auto-launch + tray behavior (#345). Electron only. */
export interface DesktopPrefs {
  autoLaunch: boolean;
  closeToTray: boolean;
  minimizeToTray: boolean;
}

export type DesktopPrefsResult = { success: boolean; prefs?: DesktopPrefs; error?: string };

export interface DesktopElectronAPI {
  getPrefs: () => Promise<DesktopPrefs>;
  setAutoLaunch: (enabled: boolean) => Promise<DesktopPrefsResult>;
  setCloseToTray: (enabled: boolean) => Promise<DesktopPrefsResult>;
  setMinimizeToTray: (enabled: boolean) => Promise<DesktopPrefsResult>;
  show: () => Promise<{ success: boolean }>;
}

interface ElectronAPI {
  setProxy: (config: ProxyConfig) => Promise<{ success: boolean }>;
  getProxy: () => Promise<ProxyConfig>;
  testProxy: (config: ProxyConfig) => Promise<{ success: boolean; error?: string }>;
  /** X 推文频道：主进程代抓 x.com 未登录主页 HTML（绕开渲染进程 CORS） */
  xFetchTimeline?: (handle: string) => Promise<{ success: boolean; html?: string; error?: string }>;
  /** Telegram 频道：主进程代抓 t.me/s/<name> 公开预览 HTML（可选 before 游标翻历史页） */
  telegramFetchChannel?: (channel: string, before?: string) => Promise<{ success: boolean; html?: string; error?: string }>;
  desktop?: DesktopElectronAPI;
  mcp?: McpElectronAPI;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export const isElectron = (): boolean => {
  return typeof window !== 'undefined' && !!window.electronAPI;
};

export const electronProxy = {
  async setProxy(config: ProxyConfig): Promise<void> {
    if (window.electronAPI) {
      await window.electronAPI.setProxy(config);
    }
  },

  async getProxy(): Promise<ProxyConfig | null> {
    return window.electronAPI?.getProxy() ?? null;
  },

  async testProxy(config: ProxyConfig): Promise<{ success: boolean; error?: string }> {
    if (!window.electronAPI) {
      return { success: false, error: 'Not running in Electron' };
    }
    return window.electronAPI.testProxy(config);
  },
};

/** X 推文频道：经主进程抓取 x.com 未登录主页 HTML。非桌面环境返回 null。 */
export const fetchXTimelineViaDesktop = async (handle: string): Promise<string | null> => {
  if (!window.electronAPI?.xFetchTimeline) return null;
  const result = await window.electronAPI.xFetchTimeline(handle);
  if (!result.success || typeof result.html !== 'string') {
    throw new Error(result.error || 'desktop x.com fetch failed');
  }
  return result.html;
};

/** Telegram 频道：经主进程抓取 t.me/s 公开预览 HTML。非桌面环境返回 null。 */
export const fetchTelegramChannelViaDesktop = async (channel: string, before?: string): Promise<string | null> => {
  if (!window.electronAPI?.telegramFetchChannel) return null;
  const result = await window.electronAPI.telegramFetchChannel(channel, before);
  if (!result.success || typeof result.html !== 'string') {
    throw new Error(result.error || 'desktop t.me fetch failed');
  }
  return result.html;
};

/** Default prefs mirror the main-process defaults; used before IPC resolves. */
export const DEFAULT_DESKTOP_PREFS: DesktopPrefs = {
  autoLaunch: false,
  closeToTray: true,
  minimizeToTray: true,
};

/** Desktop (auto-launch + tray) bridge. No-op when not in the Electron client. */
export const desktopBridge = {
  isSupported(): boolean {
    return isElectron() && !!window.electronAPI?.desktop;
  },

  async getPrefs(): Promise<DesktopPrefs> {
    if (!window.electronAPI?.desktop) return { ...DEFAULT_DESKTOP_PREFS };
    try {
      return await window.electronAPI.desktop.getPrefs();
    } catch {
      return { ...DEFAULT_DESKTOP_PREFS };
    }
  },

  async setAutoLaunch(enabled: boolean): Promise<DesktopPrefsResult> {
    if (!window.electronAPI?.desktop) {
      return { success: false, error: 'Not running in Electron' };
    }
    return window.electronAPI.desktop.setAutoLaunch(enabled);
  },

  async setCloseToTray(enabled: boolean): Promise<DesktopPrefsResult> {
    if (!window.electronAPI?.desktop) {
      return { success: false, error: 'Not running in Electron' };
    }
    return window.electronAPI.desktop.setCloseToTray(enabled);
  },

  async setMinimizeToTray(enabled: boolean): Promise<DesktopPrefsResult> {
    if (!window.electronAPI?.desktop) {
      return { success: false, error: 'Not running in Electron' };
    }
    return window.electronAPI.desktop.setMinimizeToTray(enabled);
  },

  async show(): Promise<{ success: boolean }> {
    if (!window.electronAPI?.desktop) {
      return { success: false };
    }
    return window.electronAPI.desktop.show();
  },
};
