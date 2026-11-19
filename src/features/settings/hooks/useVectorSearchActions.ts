import { useCallback, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { EmbeddingApiType } from '../../../types';
import {
  buildAccountScopedVectorId,
  EMBEDDING_FORMAT_VERSION,
  EmbeddingClient,
  indexAllRepos,
  needsReindex,
  selectIndexableRepos,
  VectorSearchService,
} from '../../../services/vectorSearchService';
import { createGitHubApiService } from '../../../services/githubApiFactory';
import { backend } from '../../../services/backendAdapter';
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
        // 仅当被测 Worker 与当前已配置的 Worker 地址一致（同一账号且同一索引）时沿用已有计数，
        // 否则清空计数（0）避免把旧 Worker 的向量计数带入新 Worker 的连接状态。
        const currentStore = useAppStore.getState();
        const normalizeUrl = (url: string | undefined): string => (url ?? '').trim().replace(/\/+$/, '');
        const sameWorkerIndex = normalizeUrl(draft.workerUrl) !== ''
          && normalizeUrl(draft.workerUrl) === normalizeUrl(currentStore.vectorSearchConfig?.workerUrl);
        const previousVectorCount = sameWorkerIndex ? (currentStore.vectorSearchStatus?.vectorCount ?? 0) : 0;
        state.setVectorSearchStatus({ connected: true, vectorCount: previousVectorCount, dimensions: result.dimensions });
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
      // R2-C24：清理删除的可验证依据——运行开始时列表不在加载/同步中，且该
      // 账号完成过至少一次同步（lastSync）。仅有「运行前后 ID 集合相等」不能
      // 证明列表完整：部分恢复/陈旧快照同样可以相等。
      const startedWithAuthoritativeList = !currentState.isLoading
        && !currentState.isSyncingStars
        && !!currentState.lastSync;
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
        // R5 审计修复（CodeRabbit 发现 2）：cleanup 的删除范围绝不能只凭本机
        // savedAccounts 数量推断——共享 Worker 索引中可能有其他设备/其他账号
        // 上传的向量（ID 为 `${accountId}:${repoId}` 前缀形态），本机账号数
        // 无法发现它们。与 Worker 的范围约定：
        // - 新版 Worker（/status 返回 accountScopedCleanup）支持 accountPrefix：
        //   只删除当前账号前缀的向量，其他设备/其他账号的向量一律保留；
        //   legacy 无前缀向量归属无法由客户端证明（共享索引可能仍有其他设备/
        //   旧客户端上传的向量），一律保留（includeLegacy=false）；
        // - 旧版 Worker 会把 keepIds 之外的全部采样向量物理删除（含其他账号），
        //   无法安全限定范围——一律跳过 cleanup：宁可保留冗余向量靠后续重建
        //   收敛，也绝不删除其他账号的数据（重新部署仓库内 Worker 即可恢复）；
        // - 未登录边缘态（jobAccountId 为 null）无法限定清理范围，同样跳过。
        if (!jobAccountId) {
          logger.warn('vectorSearch.index', 'Skip vector cleanup: no active account context to scope the deletion');
        } else {
          let accountScopedCleanup = false;
          const statusController = new AbortController();
          const abortStatus = () => statusController.abort();
          controller.signal.addEventListener('abort', abortStatus);
          const statusTimeout = setTimeout(abortStatus, 10_000);
          try {
            const status = await clients.vectorService.getStatus(statusController.signal);
            accountScopedCleanup = status.accountScopedCleanup === true;
          } catch (error) {
            if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
            logger.warn('vectorSearch.index', 'Skip vector cleanup: worker status probe failed', {
              error: error instanceof Error ? error.message : String(error),
            });
          } finally {
            clearTimeout(statusTimeout);
            controller.signal.removeEventListener('abort', abortStatus);
          }
          if (!accountScopedCleanup) {
            logger.warn('vectorSearch.index', 'Skip vector cleanup: worker does not support account-scoped deletion; redeploy the bundled cloudflare-worker to enable it');
          } else {
            // 审计修复（C49）：cleanup 的删除授权必须可证明。keepIds 不再只含
            // 「本次上传 + 排除项」——其语义是「keepIds 之外的当前账号向量全部
            // 物理删除」，本地工作区不完整（拉取中途/部分恢复/陈旧快照）或
            // 索引等待期间工作区已变化时，会把仍加星仓库的向量误删。改为：
            // - keepIds 纳入运行开始时的完整本地列表（两种 ID 形态）；
            // - 清理执行前重读实时仓库列表，仅当 ID 集合与运行开始时完全一致
            //   且运行开始/清理执行时列表都处于「已同步且无加载/同步在途」的
            //   可验证状态时才执行删除（R2-C24：相等本身不能证明完整）；
            // - 无法确认完整性/时效性时跳过删除并保留已上传结果（partial 语义，
            //   冗余向量由后续重建收敛）。
            const liveState = useAppStore.getState();
            const startRepoIds = new Set(repositories.map((repository) => String(repository.id)));
            const liveRepoIds = new Set(liveState.repositories.map((repository) => String(repository.id)));
            const listBasisValid = startedWithAuthoritativeList
              && !liveState.isLoading
              && !liveState.isSyncingStars
              && !!liveState.lastSync;
            const workspaceUnchanged = listBasisValid
              && startRepoIds.size === liveRepoIds.size
              && [...startRepoIds].every((id) => liveRepoIds.has(id))
              && liveState.repositories.length > 0;
            const cleanupKeepIds = [...new Set([
              ...repositories.map((repository) => String(repository.id)),
              ...repositories.map((repository) => buildAccountScopedVectorId(jobAccountId, repository.id)),
              ...excludedVectorIds,
              ...excludedVectorIds.map((id) => buildAccountScopedVectorId(jobAccountId, id)),
              ...result.indexedRepoIds.map((id) => buildAccountScopedVectorId(jobAccountId, id)),
            ])];
            let authoritativeSnapshotMatches = workspaceUnchanged;
            if (authoritativeSnapshotMatches && backend.isAvailable) {
              // 多设备共享后端时，本地列表未变不能证明另一设备未新增仓库：
              // 清理前必须核对后端当前账号的权威快照，核对失败或不一致则仅保留上传、跳过删除。
              try {
                const remote = await backend.fetchRepositories(jobAccountId);
                const remoteComplete = remote.repositories.length >= (remote.total ?? remote.repositories.length);
                const remoteIds = new Set(remote.repositories.map((repository) => String(repository.id)));
                authoritativeSnapshotMatches = remoteComplete
                  && remoteIds.size === liveRepoIds.size
                  && [...remoteIds].every((id) => liveRepoIds.has(id));
              } catch {
                authoritativeSnapshotMatches = false;
              }
            }
            try {
              if (onAccountChanged() || controller.signal.aborted) {
                const abortErr = new Error('Aborted');
                abortErr.name = 'AbortError';
                throw abortErr;
              }
              if (!authoritativeSnapshotMatches) {
                logger.warn('vectorSearch.index', 'Skip vector cleanup: the account workspace changed during indexing (or could not be verified against the authoritative snapshot); uploads are kept and stale vectors converge on the next rebuild', {
                  accountId: jobAccountId,
                  startCount: startRepoIds.size,
                  liveCount: liveRepoIds.size,
                });
              } else {
                const cleanup = await clients.vectorService.cleanup(cleanupKeepIds, {
                  accountPrefix: jobAccountId,
                  // 无明确归属证明时保留 legacy 向量：多设备共享同一索引时，本机
                  // 只有一个已保存账号并不能证明无前缀向量都属于它。
                  includeLegacy: false,
                  signal: controller.signal,
                });
                if (cleanup.partial) {
                  logger.warn('vectorSearch.index', 'Vector cleanup stopped before confirming completion; uploads are complete', {
                    accountId: jobAccountId,
                    deleted: cleanup.deleted,
                  });
                }
              }
            } catch (cleanupError) {
              // 上传与本地标记已完成：清理失败只记告警，绝不能把整次索引报告为
              // 0 条——保留实际上传结果，冗余向量由下次清理收敛。
              if (cleanupError instanceof Error && cleanupError.name === 'AbortError') throw cleanupError;
              logger.warn('vectorSearch.index', 'Vector cleanup failed after a successful upload', {
                accountId: jobAccountId,
                error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
              });
            }
          }
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
