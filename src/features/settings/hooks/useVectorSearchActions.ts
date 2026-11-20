import { useCallback, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { EmbeddingApiType } from '../../../types';
import {
  EMBEDDING_FORMAT_VERSION,
  EmbeddingClient,
  indexAllRepos,
  isAccountScopeMigrationDone,
  needsReindex,
  selectIndexableRepos,
  VectorSearchService,
} from '../../../services/vectorSearchService';
import { createGitHubApiService } from '../../../services/githubApiFactory';
import { logger } from '../../../services/logger';
import { LEGACY_EMBEDDING_FORMAT_VERSION, isKnownEmbeddingFormatVersion, useAppStore } from '../../../store/useAppStore';
import {
  getAccountSessionGeneration,
  isCurrentAccountSession,
  peekCurrentAccountId,
} from '../../../store/helpers/accountWorkspace';
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
  const workerTestRunRef = useRef(0);
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
    // 同一时刻只认最新一次连接测试：旧测试的结果/忙碌复位不得覆盖新测试。
    const runId = ++workerTestRunRef.current;
    setTestingWorker(true);
    setWorkerTestResult(null);
    // 账号代次校验（审计修复）：连接测试等待期间切号后，发起账号 A 的连接
    // 状态/向量数量/维度不得写入当前账号 B 的共享 vectorSearchStatus
    //（runIndex 对同类写入已有账号保护，testWorker 补齐同一约束）。
    const startedAccountId = peekCurrentAccountId();
    const startedGeneration = getAccountSessionGeneration();
    try {
      const result = await new VectorSearchService(draft).testConnection();
      if (workerTestRunRef.current !== runId) return;
      setWorkerTestResult(result);
      if (result.success && isCurrentAccountSession(startedAccountId, startedGeneration)) {
        // 审计修复（C50）：连接测试不把 Worker 全局总向量数写入 vectorSearchStatus.vectorCount；
        // 测试未保存的新 Worker 地址时只写 workerTestResult，绝不覆盖当前已配置 Worker 的共享状态；
        // 仅当被测地址与当前配置一致时更新连接状态与维度并保留已有账号计数。
        const currentStore = useAppStore.getState();
        const normalizeUrl = (url: string | undefined): string => (url ?? '').trim().replace(/\/+$/, '');
        // 审计修复：URL 相同还不足以代表已保存配置可用——若已保存令牌失效而
        // 用户用尚未保存的新令牌测试成功，仅凭 URL 匹配会把仍使用旧令牌的配置
        // 标成 connected（实际搜索继续用旧令牌并失败）。被测令牌与已保存令牌
        // 一致时才更新已保存配置的连接状态；草稿测试结果仍独立显示。
        const sameWorkerIndex = normalizeUrl(draft.workerUrl) !== ''
          && normalizeUrl(draft.workerUrl) === normalizeUrl(currentStore.vectorSearchConfig?.workerUrl)
          && (draft.authToken ?? '') === (currentStore.vectorSearchConfig?.authToken ?? '');
        if (sameWorkerIndex) {
          const previousVectorCount = currentStore.vectorSearchStatus?.vectorCount ?? 0;
          state.setVectorSearchStatus({ connected: true, vectorCount: previousVectorCount, dimensions: result.dimensions });
        }
      }
    } catch (reason) {
      if (workerTestRunRef.current !== runId) return;
      setWorkerTestResult({ success: false, vectorCount: 0, dimensions: 0, error: reason instanceof Error ? reason.message : String(reason) });
    } finally {
      if (workerTestRunRef.current === runId) setTestingWorker(false);
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

  // 索引任务身份（审计修复）：仅靠账号 ID 判定任务过期在 A→B→A 切回后会重新
  // 匹配，旧任务得以通过检查并把共享状态（isIndexing/result/向量状态/格式版本）
  // 覆盖到新任务头上。每次 runIndex 注册唯一任务身份；启动新任务前先取消在途
  // 旧任务；所有共享状态写入前同时校验任务身份与账号代次。
  const indexJobRef = useRef<{ id: number; controller: AbortController } | null>(null);

  const runIndex = useCallback(async (draft: VectorIndexDraft, incremental: boolean) => {
    const clients = createClients(draft);
    if (!clients) return;
    // 启动新任务前取消仍在途的旧任务：其身份随即失效，后续收尾写入全部跳过
    //（被新任务取代的旧任务不得重置新任务刚置位的 isIndexing 运行状态）
    indexJobRef.current?.controller.abort();
    const jobId = (indexJobRef.current?.id ?? 0) + 1;
    const controller = new AbortController();
    indexJobRef.current = { id: jobId, controller };
    setAbortController(controller);
    state.setVectorIndexingState({ isIndexing: true, phase: null, phaseDone: 0, phaseTotal: 0, result: null });
    let currentFormatVersion = LEGACY_EMBEDDING_FORMAT_VERSION;
    // 账号代次校验（Issue #611）：索引可达分钟级；同时保存账号 ID 与会话代次，
    // 确保 A→B→A 切回且未启动新任务时旧任务也会在检查点中止且不写入共享状态。
    const jobAccountId = peekCurrentAccountId();
    const jobGeneration = getAccountSessionGeneration();
    const isCurrentJob = (): boolean => (
      indexJobRef.current?.id === jobId && indexJobRef.current.controller === controller
    );
    const onAccountChanged = (): boolean => {
      if (!isCurrentJob() || !isCurrentAccountSession(jobAccountId, jobGeneration)) {
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
      // 标记必须来自实际上传的副本（R12 审计修复）：indexAllRepos 在「该账号
      // 尚未完成当前 Worker 的账号范围迁移」时会忽略增量过滤、全量补写带前缀
      // 向量——打戳候选必须复现同一判定，否则被补写的仓库会用空许可证打戳，
      // 下一次增量索引因许可证不一致再次选中它。
      const workerId = typeof clients.vectorService.workerId === 'string' && clients.vectorService.workerId
        ? clients.vectorService.workerId
        : null;
      const accountScopeMigrationPending = incremental
        && !!jobAccountId
        && !isAccountScopeMigrationDone(jobAccountId, workerId);
      const uploadCandidates = selectIndexableRepos(repositories, {
        incremental: incremental && !accountScopeMigrationPending,
        formatVersion: currentFormatVersion,
        currentFormatVersion: EMBEDDING_FORMAT_VERSION,
      });
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
      // 账号隔离（R4 审计修复）：向量 ID 以发起账号为前缀、metadata 记录归属
      // 账号——多账号共享同一 VECTORIZE 索引时按 `accountId:repoId` 区分副本，
      // 避免同仓库互相覆盖向量与 metadata（ai_tags/license 串号）。未登录
      // 边缘态（jobAccountId 为 null）退回 legacy 无前缀 ID。
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
        accountId: jobAccountId,
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
        // 第 12 轮审计（CodeRabbit Major ×2）：破坏性 cleanup 在客户端无法证明安全，
        // 一律跳过删除并保留已上传结果。
        // 1) 同一 GitHub 账号可能在多台设备上共用同一 Worker 而不同步到本后端：
        //    后端快照只能证明「本后端」的仓库列表，不能证明该账号在该索引中的
        //    全部写入来源——按 keepIds 扫除会删掉另一台设备上传的向量（账号前缀
        //    只能隔离不同账号，隔离不了同账号的独立写入）。
        // 2) 快照核对与 Worker 采样删除之间存在 await 间隔，且 Worker 没有可验证
        //    的版本条件（revision/expectedRevision 仅后端提供），核对之后同步并
        //    上传的向量仍可能被采样删除。
        // 冗余向量不会污染搜索结果（hydrateMatches 只水合本地仍存在的仓库），
        // 仅占用索引空间；待 Worker 提供可验证的版本条件后再恢复删除。
        logger.warn('vectorSearch.index', 'Skip vector cleanup: destructive deletion cannot prove coverage of every writer of this account in the shared index (and the worker has no version condition); uploads are kept', {
          accountId: jobAccountId,
          indexed: result.indexed,
        });
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
      // 否则会覆盖新账号已启动任务的运行状态。被新任务取代的旧任务
      //（身份已失效）同样跳过全部收尾写入
      if (!isCurrentJob() || !isCurrentAccountSession(jobAccountId, jobGeneration)) return;
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
