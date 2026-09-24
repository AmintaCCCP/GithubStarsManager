/**
 * 社区插件注册表的客户端桥（开发守则 §17 / §18）。
 *
 * 主进程负责取回并逐条校验注册表；渲染进程只拿到"已经校验过的结构"。这里**不下载插件包**：
 * 安装必须先在客户端校验 sha256，属于下一步，单独实现。
 */

export interface PluginRegistryEntry {
  id: string;
  version: string;
  apiVersion: string;
  source: string;
  releaseUrl: string;
  sha256: string;
  permissions: string[];
  networkTargets: string[];
  dataUsage: string;
  review: { status: 'approved'; date: string; commit: string };
}

export interface PluginRemovalEntry {
  id: string;
  versions: string[];
  reason: string;
  date: string;
  action: 'revoke' | 'block';
}

export interface PluginRegistry {
  fetchedAt: string;
  plugins: Array<{ id: string; versions: PluginRegistryEntry[] }>;
  removed: PluginRemovalEntry[];
  /** 被丢弃的条目及原因——界面可以提示"注册表里有 N 条记录没通过校验"。 */
  rejected: Array<{ index?: number; code: string; message: string }>;
  /** 两个文件里有一个没取到时的原因。 */
  error: { code: string; message: string } | null;
}

export type PluginRegistryLoadResult =
  | { success: true; registry: PluginRegistry }
  | { success: false; error: { code: string; message: string } };

interface PluginRegistryElectronAPI {
  load: () => Promise<PluginRegistryLoadResult>;
}

const getApi = (): PluginRegistryElectronAPI | undefined => (
  typeof window === 'undefined' ? undefined : window.electronAPI?.plugins?.registry
);

export const pluginRegistryService = {
  /** 只有桌面端有这条通道；Web 形态返回 false，界面据此隐藏社区区块。 */
  isAvailable(): boolean {
    return !!getApi();
  },

  async load(): Promise<PluginRegistryLoadResult> {
    const api = getApi();
    if (!api) {
      return { success: false, error: { code: 'REGISTRY_UNAVAILABLE', message: 'Plugin registry is only available in the desktop client' } };
    }
    return api.load();
  },
};
