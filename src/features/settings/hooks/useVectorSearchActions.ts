import { useCallback, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { EmbeddingApiType } from '../../../types';
import {
  EMBEDDING_FORMAT_VERSION,
  EmbeddingClient,
  indexAllRepos,
  needsReindex,
  VectorSearchService,
} from '../../../services/vectorSearchService';
import { GitHubApiService } from '../../../services/githubApi';
import { LEGACY_EMBEDDING_FORMAT_VERSION, isKnownEmbeddingFormatVersion, useAppStore } from '../../../store/useAppStore';
import { normalizeLicense } from '../../../utils/licenseFilter';

export interface EmbeddingDraft {
  apiType: EmbeddingApiType;
  baseUrl: string;
  apiKey: string;
  model: string;
  dimensions: number;
}

export interface VectorWorkerDraft {
  workerUrl: string;
  authToken: string;
}

export interface VectorIndexDraft extends EmbeddingDraft, VectorWorkerDraft {
  indexMode: 'description' | 'readme';
  readmeMaxChars: number;
}

export interface VectorSearchActions {
  testingEmbedding: boolean;
  embeddingTestResult: { success: boolean; dimensions: number; error?: string } | null;
  testingWorker: boolean;
  workerTestResult: { success: boolean; vectorCount: number; dimensions: number; error?: string } | null;
  incrementalTargetCount: number;
  testEmbedding: (draft: EmbeddingDraft) => Promise<void>;
  testWorker: (draft: VectorWorkerDraft) => Promise<void>;
  rebuildIndex: (draft: VectorIndexDraft) => Promise<void>;
  incrementalIndex: (draft: VectorIndexDraft) => Promise<void>;
  abortIndexing: () => void;
}

/**
 * Owns all vector service integration while retaining the store's persisted
 * embedding-format metadata and per-repository indexing stamps unchanged.
 */
export const useVectorSearchActions = (): VectorSearchActions => {
  const state = useAppStore(useShallow((store) => ({
    embeddingConfigs: store.embeddingConfigs,
    activeEmbeddingConfig: store.activeEmbeddingConfig,
    vectorSearchConfig: store.vectorSearchConfig,
    repositories: store.repositories,
    githubToken: store.githubToken,
    setVectorSearchStatus: store.setVectorSearchStatus,
    setVectorIndexingState: store.setVectorIndexingState,
    setVectorSearchConfig: store.setVectorSearchConfig,
    updateRepositoriesMetadata: store.updateRepositoriesMetadata,
  })));
  const [testingEmbedding, setTestingEmbedding] = useState(false);
  const [embeddingTestResult, setEmbeddingTestResult] = useState<{ success: boolean; dimensions: number; error?: string } | null>(null);
  const [testingWorker, setTestingWorker] = useState(false);
  const [workerTestResult, setWorkerTestResult] = useState<{ success: boolean; vectorCount: number; dimensions: number; error?: string } | null>(null);
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const activeConfig = useMemo(
    () => state.embeddingConfigs.find((config) => config.id === state.activeEmbeddingConfig),
    [state.activeEmbeddingConfig, state.embeddingConfigs],
  );

  const incrementalTargetCount = useMemo(() => {
    const indexable = state.repositories.filter((repository) => repository.analyzed_at && !repository.analysis_failed).length;
    const unindexed = state.repositories.filter((repository) => repository.analyzed_at && !repository.analysis_failed && needsReindex(repository, false)).length;
    const storedVersion = isKnownEmbeddingFormatVersion(state.vectorSearchConfig.embeddingFormatVersion)
      ? state.vectorSearchConfig.embeddingFormatVersion
      : LEGACY_EMBEDDING_FORMAT_VERSION;
    return storedVersion < EMBEDDING_FORMAT_VERSION ? indexable : unindexed;
  }, [state.repositories, state.vectorSearchConfig.embeddingFormatVersion]);

  const testEmbedding = useCallback(async (draft: EmbeddingDraft) => {
    setTestingEmbedding(true);
    setEmbeddingTestResult(null);
    try {
      const result = await new EmbeddingClient({ id: 'test', name: 'test', ...draft, isActive: true }).testConnection();
      setEmbeddingTestResult(result);
    } catch (reason) {
      setEmbeddingTestResult({ success: false, dimensions: 0, error: reason instanceof Error ? reason.message : String(reason) });
    } finally {
      setTestingEmbedding(false);
    }
  }, []);

  const testWorker = useCallback(async (draft: VectorWorkerDraft) => {
    setTestingWorker(true);
    setWorkerTestResult(null);
    try {
      const result = await new VectorSearchService(draft).testConnection();
      setWorkerTestResult(result);
      if (result.success) {
        state.setVectorSearchStatus({ connected: true, vectorCount: result.vectorCount, dimensions: result.dimensions });
      }
    } catch (reason) {
      setWorkerTestResult({ success: false, vectorCount: 0, dimensions: 0, error: reason instanceof Error ? reason.message : String(reason) });
    } finally {
      setTestingWorker(false);
    }
  }, [state]);

  const createClients = useCallback((draft: VectorIndexDraft) => {
    if (!activeConfig) return null;
    const embeddingClient = new EmbeddingClient({ ...activeConfig, ...draft, isActive: activeConfig.isActive });
    const vectorService = new VectorSearchService({ workerUrl: draft.workerUrl, authToken: draft.authToken });
    const githubApi = state.githubToken ? new GitHubApiService(state.githubToken) : null;
    const readmeFetcher = githubApi
      ? (owner: string, repository: string, signal?: AbortSignal) => githubApi.getRepositoryReadme(owner, repository, signal)
      : undefined;
    return { embeddingClient, vectorService, readmeFetcher };
  }, [activeConfig, state.githubToken]);

  const runIndex = useCallback(async (draft: VectorIndexDraft, incremental: boolean) => {
    const clients = createClients(draft);
    if (!clients) return;
    const controller = new AbortController();
    setAbortController(controller);
    state.setVectorIndexingState({ isIndexing: true, phase: null, phaseDone: 0, phaseTotal: 0, result: null });
    let currentFormatVersion = LEGACY_EMBEDDING_FORMAT_VERSION;
    try {
      const currentState = useAppStore.getState();
      const repositories = currentState.repositories;
      const excludedVectorIds = repositories
        .filter((repository) => Boolean(repository.vector_indexed_at) && (!repository.analyzed_at || repository.analysis_failed))
        .map((repository) => String(repository.id));
      const excludedVectorIdSet = new Set(excludedVectorIds);
      currentFormatVersion = isKnownEmbeddingFormatVersion(currentState.vectorSearchConfig.embeddingFormatVersion)
        ? currentState.vectorSearchConfig.embeddingFormatVersion
        : LEGACY_EMBEDDING_FORMAT_VERSION;
      const now = new Date().toISOString();
      const licenseById = new Map(repositories.map((repository) => [repository.id, repository.license ?? null]));
      const stamp = (id: number) => ({ id, patch: { vector_indexed_at: now, vector_indexed_license: normalizeLicense(licenseById.get(id) ?? null) } });
      const newlyIndexed = new Set(repositories.filter((repository) => !repository.vector_indexed_at).map((repository) => repository.id));
      if (!incremental) {
        state.updateRepositoriesMetadata(repositories.filter((repository) => (
          repository.vector_indexed_at && !excludedVectorIdSet.has(String(repository.id))
        )).map((repository) => ({
          id: repository.id,
          patch: { vector_indexed_at: undefined, vector_indexed_license: undefined },
        })));
      }
      const stamped: number[] = [];
      const result = await indexAllRepos(repositories, clients.embeddingClient, clients.vectorService, {
        onProgress: (progress) => state.setVectorIndexingState({ phase: progress.phase, phaseDone: progress.done, phaseTotal: progress.total }),
        signal: controller.signal,
        readmeFetcher: clients.readmeFetcher,
        indexMode: draft.indexMode,
        readmeMaxChars: draft.readmeMaxChars,
        incremental,
        ...(incremental ? { formatVersion: currentFormatVersion, currentFormatVersion: EMBEDDING_FORMAT_VERSION } : {}),
        onRepoIndexed: (id) => {
          stamped.push(id);
          if (stamped.length % 32 === 0) state.updateRepositoriesMetadata(stamped.splice(0).map(stamp));
        },
      });
      if (stamped.length) state.updateRepositoriesMetadata(stamped.map(stamp));
      if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (!incremental && result.errors === 0) {
        const cleanupKeepIds = [...new Set([...result.indexedRepoIds.map(String), ...excludedVectorIds])];
        await clients.vectorService.cleanup(cleanupKeepIds, controller.signal);
      }
      if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      state.setVectorIndexingState({ result, isIndexing: false, phase: null });
      const previousCount = useAppStore.getState().vectorSearchStatus?.vectorCount ?? 0;
      state.setVectorSearchStatus({
        connected: true,
        vectorCount: incremental
          ? previousCount + result.indexedRepoIds.filter((id) => newlyIndexed.has(id)).length
          : result.indexed + excludedVectorIds.length,
        dimensions: draft.dimensions,
        lastSyncAt: new Date().toISOString(),
      });
      const hasExcludedLegacyVector = currentFormatVersion < EMBEDDING_FORMAT_VERSION && excludedVectorIds.length > 0;
      if (result.errors === 0 && !hasExcludedLegacyVector) {
        state.setVectorSearchConfig({ embeddingFormatVersion: EMBEDDING_FORMAT_VERSION });
      }
    } catch (reason) {
      const isCancelled = controller.signal.aborted
        || (reason instanceof Error && (reason.name === 'AbortError' || reason.message === 'Aborted'));
      if (isCancelled) {
        state.setVectorIndexingState({ isIndexing: false, phase: null, result: null });
      } else {
        const repositories = useAppStore.getState().repositories;
        const indexable = repositories.filter((repository) => repository.analyzed_at && !repository.analysis_failed && (!incremental || needsReindex(repository, currentFormatVersion < EMBEDDING_FORMAT_VERSION))).length;
        state.setVectorIndexingState({
          isIndexing: false,
          phase: null,
          result: { indexed: 0, skipped: repositories.length - indexable, errors: indexable, error: reason instanceof Error ? reason.message : String(reason) },
        });
      }
    } finally {
      setAbortController(null);
    }
  }, [createClients, state]);

  const rebuildIndex = useCallback((draft: VectorIndexDraft) => runIndex(draft, false), [runIndex]);
  const incrementalIndex = useCallback((draft: VectorIndexDraft) => runIndex(draft, true), [runIndex]);
  const abortIndexing = useCallback(() => abortController?.abort(), [abortController]);

  return {
    testingEmbedding, embeddingTestResult, testingWorker, workerTestResult,
    incrementalTargetCount, testEmbedding, testWorker, rebuildIndex, incrementalIndex, abortIndexing,
  };
};
