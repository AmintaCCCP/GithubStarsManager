import { useCallback, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { EmbeddingApiType } from '../../../types';
import {
  EMBEDDING_FORMAT_VERSION,
  EmbeddingClient,
  indexAllRepos,
  needsReindex,
  selectIndexableRepos,
  VectorSearchService,
} from '../../../services/vectorSearchService';
import { createGitHubApiService } from '../../../services/githubApiFactory';
import { logger } from '../../../services/logger';
import { LEGACY_EMBEDDING_FORMAT_VERSION, isKnownEmbeddingFormatVersion, useAppStore } from '../../../store/useAppStore';
import { isCurrentAccount, peekCurrentAccountId } from '../../../store/helpers/accountWorkspace';
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
  unindexedRepoCount: number;
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

  const formatVersionChanged = useMemo(() => {
    const storedVersion = isKnownEmbeddingFormatVersion(state.vectorSearchConfig.embeddingFormatVersion)
      ? state.vectorSearchConfig.embeddingFormatVersion
      : LEGACY_EMBEDDING_FORMAT_VERSION;
    return storedVersion < EMBEDDING_FORMAT_VERSION;
  }, [state.vectorSearchConfig.embeddingFormatVersion]);

  const { incrementalTargetCount, unindexedRepoCount } = useMemo(() => {
    // 与 selectIndexableRepos 的顺序一致：先按增量谓词筛选，再按 id 去重，
    // 否则同 id 首条无需重建时会漏计第二条待索引记录。mode=null 表示全量目标，
    // 只做分析状态过滤（对应 formatVersionChanged 时的增量目标）。
    const countAfter = (mode: boolean | null): number => {
      const seen = new Set<number>();
      let count = 0;
      for (const repository of state.repositories) {
        if (!repository.analyzed_at || repository.analysis_failed) continue;
        if (mode !== null && !needsReindex(repository, mode)) continue;
        if (seen.has(repository.id)) continue;
        seen.add(repository.id);
        count += 1;
      }
      return count;
    };
    return {
      incrementalTargetCount: formatVersionChanged ? countAfter(null) : countAfter(false),
      unindexedRepoCount: state.vectorSearchConfig.enabled ? countAfter(formatVersionChanged) : 0,
    };
  }, [formatVersionChanged, state.repositories, state.vectorSearchConfig.enabled]);

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
    const githubApi = state.githubToken ? createGitHubApiService(state.githubToken) : null;
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
    // 账号代次校验（Issue #611）：索引可达分钟级；切号后中止任务并停止打戳
    const jobAccountId = peekCurrentAccountId();
    const onAccountChanged = (): boolean => {
      if (!isCurrentAccount(jobAccountId)) {
        controller.abort();
        return true;
      }
      return false;
    };
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
      // 标记必须来自实际上传的副本：与 indexAllRepos 共用同一候选选择规则
      // （分析/增量过滤 + 按 id 首条去重），避免重复 id 时标记与向量元数据错位。
      const uploadCandidates = selectIndexableRepos(repositories, { incremental, formatVersion: currentFormatVersion, currentFormatVersion: EMBEDDING_FORMAT_VERSION });
      const licenseById = new Map<number, string | null>();
      for (const repository of uploadCandidates) {
        if (!licenseById.has(repository.id)) licenseById.set(repository.id, repository.license ?? null);
      }
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
        onProgress: (progress) => {
          // 切号后立即中止：进度状态写入的是共享的 vectorIndexingState，绝不能串号
          if (onAccountChanged()) return;
          state.setVectorIndexingState({ phase: progress.phase, phaseDone: progress.done, phaseTotal: progress.total });
        },
        signal: controller.signal,
        readmeFetcher: clients.readmeFetcher,
        indexMode: draft.indexMode,
        readmeMaxChars: draft.readmeMaxChars,
        incremental,
        ...(incremental ? { formatVersion: currentFormatVersion, currentFormatVersion: EMBEDDING_FORMAT_VERSION } : {}),
        onRepoIndexed: (id) => {
          // 切号后立即中止：打戳写入的是当前活跃账号的元数据，绝不能串号
          if (onAccountChanged()) return;
          stamped.push(id);
          if (stamped.length % 32 === 0) state.updateRepositoriesMetadata(stamped.splice(0).map(stamp));
        },
      });
      if (stamped.length && !onAccountChanged()) state.updateRepositoriesMetadata(stamped.map(stamp));
      if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (!incremental && result.errors === 0) {
        // 多账号共享同一向量索引（Issue #611 审计修复）：向量服务配置
        //（worker_url/auth_token）保存在全局行 vector_search_configs，不属于
        // ACCOUNT_SCOPED_SETTING_KEYS，且向量 ID 无账号前缀；/cleanup 会把
        // keepIds 之外的全部匹配向量从共享 VECTORIZE 索引中删除。因此多账号
        // 存在时执行 cleanup 会物理删除其他账号的向量。在实现按账号隔离
        //（独立命名空间或账号前缀的向量 ID + Worker 按账号过滤删除）之前，
        // 多账号共享索引时必须跳过 cleanup：宁可保留冗余向量靠后续重建收敛，
        // 也绝不删除其他账号的数据。
        const sharedIndexAcrossAccounts = Object.keys(useAppStore.getState().savedAccounts ?? {}).length > 1;
        if (sharedIndexAcrossAccounts) {
          logger.warn('vectorSearch.index', 'Skip vector cleanup: the vector index is shared across multiple accounts');
        } else {
          const cleanupKeepIds = [...new Set([...result.indexedRepoIds.map(String), ...excludedVectorIds])];
          await clients.vectorService.cleanup(cleanupKeepIds, controller.signal);
        }
      }
      // cleanup 等待期间可能切号（stamped 为空时上方 onAccountChanged 不会触发）：
      // 共享状态写入前同时校验账号与取消信号，旧账号任务不得更新新账号的
      // 索引状态/向量状态/格式版本
      if (onAccountChanged() || controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      state.setVectorIndexingState({ result, isIndexing: false, phase: null });
      const previousCount = useAppStore.getState().vectorSearchStatus?.vectorCount ?? 0;
      state.setVectorSearchStatus({
        connected: true,
        vectorCount: incremental
          ? previousCount + result.indexedRepoIds.filter((id) => newlyIndexed.has(id)).length
            : result.indexed + excludedVectorIdSet.size,
        dimensions: draft.dimensions,
        lastSyncAt: new Date().toISOString(),
      });
      const hasExcludedLegacyVector = currentFormatVersion < EMBEDDING_FORMAT_VERSION && excludedVectorIds.length > 0;
      if (result.errors === 0 && !hasExcludedLegacyVector) {
        state.setVectorSearchConfig({ embeddingFormatVersion: EMBEDDING_FORMAT_VERSION });
      }
    } catch (reason) {
      // 切号后旧任务的收尾状态不得写入当前账号：包括 isIndexing=false，
      // 否则会覆盖新账号已启动任务的运行状态
      if (!isCurrentAccount(jobAccountId)) return;
      const isCancelled = controller.signal.aborted
        || (reason instanceof Error && (reason.name === 'AbortError' || reason.message === 'Aborted'));
      if (isCancelled) {
        state.setVectorIndexingState({ isIndexing: false, phase: null, result: null });
      } else {
        const repositories = useAppStore.getState().repositories;
        const indexable = selectIndexableRepos(repositories, { incremental, formatVersion: currentFormatVersion, currentFormatVersion: EMBEDDING_FORMAT_VERSION }).length;
        state.setVectorIndexingState({
          isIndexing: false,
          phase: null,
          result: { indexed: 0, skipped: repositories.length - indexable, errors: indexable, error: reason instanceof Error ? reason.message : String(reason) },
        });
      }
    } finally {
      // 仅当当前保存的中止控制器仍属于本任务时才清空：切号后新账号可能已
      // 启动自己的索引任务，无条件置 null 会让新任务的中止操作失效
      setAbortController((current) => (current === controller ? null : current));
    }
  }, [createClients, state]);

  const rebuildIndex = useCallback((draft: VectorIndexDraft) => runIndex(draft, false), [runIndex]);
  const incrementalIndex = useCallback((draft: VectorIndexDraft) => runIndex(draft, true), [runIndex]);
  const abortIndexing = useCallback(() => abortController?.abort(), [abortController]);

  return {
    testingEmbedding, embeddingTestResult, testingWorker, workerTestResult,
    incrementalTargetCount, unindexedRepoCount, testEmbedding, testWorker, rebuildIndex, incrementalIndex, abortIndexing,
  };
};
