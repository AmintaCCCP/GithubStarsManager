import type { Release, Repository } from '../types';

export type PluginPlacement = 'repository-card' | 'bulk-toolbar';

export interface PluginRepositoryAction {
  id: string;
  title: string;
  icon?: string;
  placement: PluginPlacement;
  /** V1.4：指向本插件 contributes.pages 的页面 id。点击动作时宿主在弹窗中打开该页面，而非运行 Worker。 */
  opensPage?: string;
}

export interface PluginManifest {
  manifestVersion: number;
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  apiVersion: string;
  main?: string;
  permissions: string[];
  contributes: {
    repositoryActions?: PluginRepositoryAction[];
    repositoryProcessors?: Array<{ id: string; title: string }>;
    releaseProcessors?: Array<{ id: string; title: string }>;
    exporters?: Array<{ id: string; title: string; fileExtension: string; mimeType: string }>;
    pages?: Array<{ id: string; title: string; entry: string }>;
  };
}

export interface PluginError {
  code: string;
  message: string;
  at?: string;
}

export interface InstalledPlugin {
  directoryName: string;
  manifest: PluginManifest;
  enabled: boolean;
  status: 'disabled' | 'active' | 'error';
  grantedPermissions: string[];
  lastError?: PluginError;
}

export interface InvalidPlugin {
  directoryName: string;
  code: string;
  message: string;
}

export interface PluginListResult {
  plugins: InstalledPlugin[];
  invalidPlugins: InvalidPlugin[];
}

export type PluginOperationResult =
  | { success: true; dataRemoved?: boolean }
  | { success: false; error: PluginError };

/** 插件市场的一个自助插件源：GitHub 仓库目录。 */
export interface PluginSource {
  id: string;
  url: string;
  name?: string;
  addedAt: string;
}

/** 源目录里探测到的一个插件（manifest 已在主进程通过完整校验）。 */
export interface MarketplacePluginEntry {
  directoryName: string;
  manifest: PluginManifest;
}

export interface MarketplaceSourceEntry {
  source: PluginSource;
  status: 'ok' | 'error' | 'pending';
  plugins: MarketplacePluginEntry[];
  warnings: string[];
  error: PluginError | null;
  fetchedAt: string | null;
}

export interface MarketplaceState {
  sources: PluginSource[];
  entries: MarketplaceSourceEntry[];
}

export type MarketplaceMutationResult =
  | { success: true; state: MarketplaceState }
  | { success: false; error: PluginError };

export interface MarketplaceInstallRequest {
  sourceId: string;
  directoryName: string;
  /** 用户在界面上看到的插件身份：主进程校验下载到的 manifest 与之一致。 */
  expectedPluginId: string;
  expectedVersion: string;
  /** 更新场景：由主进程原子替换（失败自动回滚），并恢复/停用启用状态。 */
  replace?: boolean;
}

export type PluginActionResult =
  | { type: 'text'; content: string; suggestedAction?: 'copy' | 'save' }
  | { type: 'open-external'; url: string }
  | { type: 'notice'; level: 'info' | 'warning' | 'error'; message: string };

export type RunPluginActionResult =
  | { success: true; result: PluginActionResult }
  | { success: false; error: PluginError };

export interface RunPluginActionRequest {
  pluginId: string;
  actionId: string;
  repositories: Repository[];
}

export interface ElectronPluginAPI {
  list: () => Promise<PluginListResult>;
  installFromDirectory: () => Promise<({ success: true; pluginId: string } | { success: false; canceled?: boolean; error?: PluginError })>;
  enable: (pluginId: string, grantedPermissions: string[]) => Promise<PluginOperationResult>;
  disable: (pluginId: string) => Promise<PluginOperationResult>;
  uninstall: (pluginId: string, removePluginData?: boolean) => Promise<PluginOperationResult>;
  runAction: (request: RunPluginActionRequest) => Promise<RunPluginActionResult>;
  runProcessor: (request: {
    pluginId: string;
    processorId: string;
    repositories: Repository[];
  }) => Promise<{ success: true; result: { repositories: Array<{ id: number; summary?: string; tags?: string[]; category?: string }> } } | { success: false; error: PluginError }>;
  pushSnapshot: (snapshot: { repositories: Repository[]; releases: Release[] }) => Promise<PluginOperationResult & { counts?: { repositories: number; releases: number } }>;
  runReleaseProcessor: (request: {
    pluginId: string;
    processorId: string;
    repository?: Repository;
    release: Release;
  }) => Promise<{ success: true; result: PluginReleaseRecommendation } | { success: false; error: PluginError }>;
  downloadReleaseAsset: (request: {
    pluginId: string;
    releaseId: number;
    assetId: number;
  }) => Promise<({ success: true; fileName: string; bytes: number } | { success: false; canceled?: boolean; error?: PluginError })>;
  runExporter: (request: {
    pluginId: string;
    exporterId: string;
    repositories: Repository[];
  }) => Promise<{ success: true; result: { content: string; fileName: string; mimeType: string } } | { success: false; error: PluginError }>;
  getPage: (pluginId: string, pageId: string) => Promise<{ success: true; url: string } | { success: false; error: PluginError }>;
  requestPageCapability: (request: {
    pluginId: string;
    pageId: string;
    method: string;
    args: Record<string, unknown>;
  }) => Promise<{ success: true; value: unknown } | { success: false; error: PluginError }>;
  getSearchEndpoint: () => Promise<{ endpoint: string | null }>;
  configureWebSearch: (endpoint: string | null) => Promise<PluginOperationResult>;
  searchWeb: (request: { pluginId: string; pageId: string; args: { query: string; limit?: number } }) =>
    Promise<{ success: true; value: Array<{ title: string; url: string; snippet: string }> } | { success: false; error: PluginError }>;
  marketplace: {
    getState: () => Promise<MarketplaceState>;
    addSource: (input: { url: string; name?: string }) => Promise<MarketplaceMutationResult>;
    updateSource: (input: { id: string; url?: string; name?: string }) => Promise<MarketplaceMutationResult>;
    removeSource: (input: { id: string }) => Promise<MarketplaceMutationResult>;
    refresh: (options?: { sourceId?: string }) => Promise<MarketplaceMutationResult>;
    install: (request: MarketplaceInstallRequest) => Promise<
      { success: true; pluginId: string; permissionsChanged?: boolean; keptEnabled?: boolean } | { success: false; error: PluginError }
    >;
  };
}

export interface RegisteredPluginAction extends PluginRepositoryAction {
  pluginId: string;
  pluginName: string;
}

export interface PluginReleaseRecommendation {
  recommendedAssetId: number;
  confidence: number;
  reason: string;
}

export interface RegisteredReleaseProcessor {
  id: string;
  title: string;
  pluginId: string;
  pluginName: string;
  canDownload: boolean;
}
