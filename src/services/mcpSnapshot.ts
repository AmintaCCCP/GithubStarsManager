import type { AppState } from '../types';
import type { McpDataSnapshot } from './electronProxy';

export type McpSnapshotState = Pick<
  AppState,
  | 'repositories'
  | 'customCategories'
  | 'releases'
  | 'vectorSearchConfig'
  | 'embeddingConfigs'
  | 'activeEmbeddingConfig'
>;

export function buildMcpDataSnapshot(
  state: McpSnapshotState,
  snapshotAt: string
): McpDataSnapshot {
  const vectorSearchConfig = state.vectorSearchConfig;
  const embedding =
    state.embeddingConfigs.find((config) => config.id === vectorSearchConfig.embeddingConfigId) ||
    state.embeddingConfigs.find((config) => config.id === state.activeEmbeddingConfig) ||
    null;

  return {
    repositories: state.repositories,
    customCategories: state.customCategories,
    releases: state.releases,
    vectorSearchConfig: {
      enabled: !!vectorSearchConfig.enabled,
      workerUrl: vectorSearchConfig.workerUrl || '',
      authToken: vectorSearchConfig.authToken || '',
      searchThreshold: vectorSearchConfig.searchThreshold,
      searchTopK: vectorSearchConfig.searchTopK,
      embedding: embedding
        ? {
            apiType: embedding.apiType,
            baseUrl: embedding.baseUrl || '',
            apiKey: embedding.apiKey || '',
            model: embedding.model || '',
            dimensions: embedding.dimensions,
          }
        : null,
    },
    snapshotAt,
  };
}
