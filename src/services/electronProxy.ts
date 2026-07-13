import type { ProxyConfig } from '../types';

interface ElectronAPI {
  setProxy: (config: ProxyConfig) => Promise<{ success: boolean }>;
  getProxy: () => Promise<ProxyConfig>;
  testProxy: (config: ProxyConfig) => Promise<{ success: boolean; error?: string }>;
  // MCP 服务（桌面端，可选；仅在 Electron 主进程内置 MCP 时存在）
  startMcp?: (cfg: { port: number; token: string }) => Promise<{ success: boolean }>;
  stopMcp?: () => Promise<void>;
  pushMcpSnapshot?: (snapshot: unknown) => Promise<void>;
  mcpSemanticSearch?: (query: string, topK: number) => Promise<Array<{ fullName: string; score: number }>>;
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
