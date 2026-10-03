/**
 * 插件市场（自助插件源）的客户端桥。
 *
 * 源管理、目录遍历与安装都在主进程完成；渲染进程只拿到已经校验过的结构。
 * 只有桌面端有这条通道，Web 形态返回 false，界面据此隐藏市场入口。
 */

import type {
  MarketplaceInstallRequest,
  MarketplaceMutationResult,
  MarketplaceState,
  PluginError,
} from '../plugins/types';

export interface MarketplaceElectronAPI {
  getState: () => Promise<MarketplaceState>;
  addSource: (input: { url: string; name?: string }) => Promise<MarketplaceMutationResult>;
  updateSource: (input: { id: string; url?: string; name?: string }) => Promise<MarketplaceMutationResult>;
  removeSource: (input: { id: string }) => Promise<MarketplaceMutationResult>;
  refresh: (options?: { sourceId?: string }) => Promise<MarketplaceMutationResult>;
  install: (request: MarketplaceInstallRequest) => Promise<
    { success: true; pluginId: string; permissionsChanged?: boolean } | { success: false; error: PluginError }
  >;
}

const unavailableError = () => ({
  success: false as const,
  error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'The plugin marketplace is only available in the desktop app' },
});

const getApi = (): MarketplaceElectronAPI | undefined => (
  typeof window === 'undefined' ? undefined : window.electronAPI?.plugins?.marketplace as MarketplaceElectronAPI | undefined
);

export const pluginMarketplaceService = {
  isAvailable(): boolean {
    return !!getApi();
  },

  async getState(): Promise<MarketplaceState> {
    const api = getApi();
    if (!api) return { sources: [], entries: [] };
    return api.getState();
  },

  async addSource(input: { url: string; name?: string }): Promise<MarketplaceMutationResult> {
    const api = getApi();
    if (!api) return unavailableError();
    return api.addSource(input);
  },

  async updateSource(input: { id: string; url?: string; name?: string }): Promise<MarketplaceMutationResult> {
    const api = getApi();
    if (!api) return unavailableError();
    return api.updateSource(input);
  },

  async removeSource(input: { id: string }): Promise<MarketplaceMutationResult> {
    const api = getApi();
    if (!api) return unavailableError();
    return api.removeSource(input);
  },

  async refresh(options?: { sourceId?: string }): Promise<MarketplaceMutationResult> {
    const api = getApi();
    if (!api) return unavailableError();
    return api.refresh(options);
  },

  async install(request: MarketplaceInstallRequest) {
    const api = getApi();
    if (!api) return unavailableError();
    return api.install(request);
  },
};
