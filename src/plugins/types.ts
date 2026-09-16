import type { Release, Repository } from '../types';

export type PluginPlacement = 'repository-card' | 'bulk-toolbar';

export interface PluginRepositoryAction {
  id: string;
  title: string;
  icon?: string;
  placement: PluginPlacement;
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
