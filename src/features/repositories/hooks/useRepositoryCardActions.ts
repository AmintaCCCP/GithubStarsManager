
import { useT } from '../../../i18n/useT';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Category, Repository } from '../../../types';
import { useAppStore } from '../../../store/useAppStore';
import {
  getAccountSessionGeneration,
  isCurrentAccount,
  isCurrentAccountSession,
  peekCurrentAccountId,
} from '../../../store/helpers/accountWorkspace';
import { useDialog } from '../../../hooks/useDialog';
import { AIService, isAbortError } from '../../../services/aiService';
import { CrossEncoderReranker } from '../../../services/crossEncoderReranker';
import { runSimilarRepositoryPipeline } from '../../../services/similarRepositoryPipeline';
import { EmbeddingClient, VectorSearchService } from '../../../services/vectorSearchService';
import { analyzeRepository, createFailedAnalysisResult } from '../../../services/aiAnalysisHelper';
import { forceSyncToBackend, markPendingAccountSync, markPendingRepositoryDeletion, withAccountSwitchGuardSync } from '../../../services/autoSync';
import { backend } from '../../../services/backendAdapter';
import { createGitHubApiService } from '../../../services/githubApiFactory';
import { logger } from '../../../services/logger';
import { applyAnalysisFailure, applyAnalysisSuccess } from '../application/repositoryPatches';

interface UseRepositoryCardActionsOptions {
  repository: Repository;
  allCategories: Category[];
}

export interface RepositoryCardActions {
  analyze: () => Promise<void>;
  findSimilar: () => Promise<void>;
  unstar: () => Promise<void>;
  toggleReleaseSubscription: () => void;
  isSubscribed: boolean;
  isAnalyzing: boolean;
  isFindingSimilar: boolean;
  isUnstarring: boolean;
  vectorSearchAvailable: boolean;
}

/**
 * Encapsulates RepositoryCard's domain operations while leaving card-local UI
 * state, layout, keyboard handling, and drag behaviour in the view component.
 */
// 跨卡片实例共享的分析忙标记所有者表：同仓库 ID 在不同账号的卡片实例间
// 共享 store.analyzingRepositoryIds，仅当当前请求仍是该 repoId 的所有者时
// 才允许清除共享忙标记，避免账号 A 的旧请求清掉账号 B 的进行中标记。
let nextAnalyzeRequestOwnerId = 0;
const analyzingRepoMarkerOwners = new Map<number, number>();

export const useRepositoryCardActions = ({
  repository,
  allCategories,
}: UseRepositoryCardActionsOptions): RepositoryCardActions => {
  const t = useT('repositories');
  const repoId = repository.id;
  const isSubscribed = useAppStore(
    useCallback((state) => state.releaseSubscriptions.has(repoId), [repoId]),
  );
  const isStoreAnalyzing = useAppStore(
    useCallback((state) => state.analyzingRepositoryIds.has(repoId), [repoId]),
  );
  const {
    githubToken,
    activeAIConfig,
    setAnalyzingRepository,
    language,
    updateRepository,
    deleteRepository,
    vectorSearchConfig,
    vectorSearchStatus,
    embeddingConfigs,
    activeEmbeddingConfig,
    repositories,
    enterSimilarView,
    aiConfigs,
    toggleReleaseSubscription: toggleStoreReleaseSubscription,
  } = useAppStore(
    useShallow(
      useCallback(
        (state) => ({
          githubToken: state.githubToken,
          activeAIConfig: state.activeAIConfig,
          setAnalyzingRepository: state.setAnalyzingRepository,
          language: state.language,
          updateRepository: state.updateRepository,
          deleteRepository: state.deleteRepository,
          vectorSearchConfig: state.vectorSearchConfig,
          vectorSearchStatus: state.vectorSearchStatus,
          embeddingConfigs: state.embeddingConfigs,
          activeEmbeddingConfig: state.activeEmbeddingConfig,
          repositories: state.repositories,
          enterSimilarView: state.enterSimilarView,
          aiConfigs: state.aiConfigs,
          toggleReleaseSubscription: state.toggleReleaseSubscription,
        }),
        [],
      ),
    ),
  );
  const { toast, confirm } = useDialog();
  const abortControllerRef = useRef<AbortController | null>(null);
  const similarityAbortRef = useRef<AbortController | null>(null);
  // R2-C19：分析请求身份。只有仍是最新请求时才允许清除 store 忙标记，避免
  // 旧请求的结算清掉新请求的标记（也允许会话失效时清理旧代次自己的标记）。
  const analyzeRequestTokenRef = useRef(0);
  const [isLocallyAnalyzing, setIsLocallyAnalyzing] = useState(false);
  const [isFindingSimilar, setIsFindingSimilar] = useState(false);
  const [isUnstarring, setIsUnstarring] = useState(false);

  useEffect(() => () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    similarityAbortRef.current?.abort();
    similarityAbortRef.current = null;
    const ownerToken = analyzeRequestTokenRef.current;
    const currentOwner = analyzingRepoMarkerOwners.get(repoId);
    if (currentOwner === undefined || (ownerToken !== 0 && currentOwner === ownerToken)) {
      if (ownerToken !== 0 && currentOwner === ownerToken) {
        analyzingRepoMarkerOwners.delete(repoId);
      }
      setAnalyzingRepository(repoId, false);
    }
  }, [repoId, setAnalyzingRepository]);

  const vectorSearchAvailable = useMemo(() => {
    const activeConfig = embeddingConfigs.find((config) => config.id === activeEmbeddingConfig);
    const configComplete = !!activeConfig
      && !!activeConfig.baseUrl
      && !!activeConfig.model
      && (activeConfig.apiType === 'ollama' || !!activeConfig.apiKey);

    return (
      vectorSearchConfig.enabled
      && !!vectorSearchStatus?.connected
      && (vectorSearchStatus?.vectorCount ?? 0) > 0
      && configComplete
      && !!vectorSearchConfig.workerUrl
      && !!vectorSearchConfig.authToken
    );
  }, [embeddingConfigs, activeEmbeddingConfig, vectorSearchConfig, vectorSearchStatus]);

  const analyze = useCallback(async () => {
    if (!githubToken) {
      toast(
        t('useRepositoryCardActions.github-token-not-found-please-login-again'),
        'error',
      );
      return;
    }

    const activeConfig = aiConfigs.find((config) => config.id === activeAIConfig);
    if (!activeConfig) {
      toast(
        t('useRepositoryCardActions.please-configure-ai-service-in-settings-first'),
        'error',
      );
      return;
    }

    if (activeConfig.apiKeyStatus === 'decrypt_failed' || activeConfig.apiKeyStatus === 'empty') {
      toast(
        t('useRepositoryCardActions.the-ai-service-api-key-could-not-be-decrypted-or'),
        'error',
      );
      return;
    }

    if (!activeConfig.baseUrl || !activeConfig.apiKey || !activeConfig.model) {
      toast(
        t('useRepositoryCardActions.ai-service-configuration-is-incomplete-please-ch'),
        'error',
      );
      return;
    }

    // 账号代次校验（Issue #611 审计修复）：确认框与分析请求之前保存账号 ID，
    // 确认后与提交前用保存值复核；请求完成后再读取当前账号会让检查恒通过
    const startedAccountId = peekCurrentAccountId();
    // A→B→A：账号 ID 与确认前相同，只有会话代次能识别这次切号。
    const startedGeneration = getAccountSessionGeneration();

    if (repository.analyzed_at) {
      const confirmMessage = t('useRepositoryCardActions.this-repository-was-analyzed-on-v1-do-you-want-t', { v1: new Date(repository.analyzed_at).toLocaleString() });

      if (!await confirm(
        t('useRepositoryCardActions.re-analyze-confirmation'),
        confirmMessage,
        { type: 'warning' },
      )) {
        return;
      }
      if (!isCurrentAccountSession(startedAccountId, startedGeneration)) return;
    }

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const requestToken = ++nextAnalyzeRequestOwnerId;
    analyzeRequestTokenRef.current = requestToken;
    analyzingRepoMarkerOwners.set(repoId, requestToken);

    const analysisStartedAt = performance.now();
    setIsLocallyAnalyzing(true);
    requestAnimationFrame(() => {
      logger.info('ai.performance', 'Repository card AI spinner painted', {
        repoId,
        fullName: repository.full_name,
        elapsedMs: Math.round(performance.now() - analysisStartedAt),
      });
    });
    setAnalyzingRepository(repoId, true);

    try {
      const result = await analyzeRepository({
        repository,
        githubToken,
        aiConfig: activeConfig,
        language,
        categories: allCategories,
        onProgress: (status) => {
          logger.info('ai.performance', 'Repository card AI analysis step', {
            repoId,
            fullName: repository.full_name,
            status,
            elapsedMs: Math.round(performance.now() - analysisStartedAt),
          });
        },
        signal: controller.signal,
      });
      logger.info('ai.performance', 'Repository card AI request completed', {
        repoId,
        fullName: repository.full_name,
        elapsedMs: Math.round(performance.now() - analysisStartedAt),
      });

      if (controller.signal.aborted) return;
      // 账号代次校验（Issue #611）：AI 分析耗时期间切号后，结果绝不写进新账号
      if (!isCurrentAccountSession(startedAccountId, startedGeneration)) return;

      const updatedRepo = applyAnalysisSuccess(repository, {
        summary: result.summary,
        tags: result.tags,
        platforms: result.platforms,
        category: result.custom_category,
        categoryLocked: result.category_locked,
        analyzedAt: result.analyzed_at,
      });

      const updateStartedAt = performance.now();
      updateRepository(updatedRepo);
      logger.info('ai.performance', 'Repository card AI result stored', {
        repoId,
        fullName: repository.full_name,
        updateMs: Math.round(performance.now() - updateStartedAt),
        elapsedMs: Math.round(performance.now() - analysisStartedAt),
      });

      toast(
        repository.analyzed_at
          ? (t('useRepositoryCardActions.ai-re-analysis-completed'))
          : (t('useRepositoryCardActions.ai-analysis-completed')),
        'success',
      );
    } catch (error) {
      if (!controller.signal.aborted && !isCurrentAccountSession(startedAccountId, startedGeneration)) {
        return;
      }
      if (!controller.signal.aborted) {
        console.error('AI analysis failed:', error);

        const errorMessage = error instanceof Error && error.message
          ? error.message
          : (t('useRepositoryCardActions.ai-analysis-failed-please-check-ai-configuration'));
        const failedResult = createFailedAnalysisResult(errorMessage);
        const failedRepo = applyAnalysisFailure(repository, {
          analyzedAt: failedResult.analyzed_at,
          error: failedResult.analysis_error,
        });

        const updateStartedAt = performance.now();
        updateRepository(failedRepo);
        logger.info('ai.performance', 'Repository card AI failure stored', {
          repoId,
          fullName: repository.full_name,
          updateMs: Math.round(performance.now() - updateStartedAt),
          elapsedMs: Math.round(performance.now() - analysisStartedAt),
        });

        toast(
          t('useRepositoryCardActions.ai-analysis-failed-please-check-ai-configuration-2'),
          'error',
        );
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
        setIsLocallyAnalyzing(false);
      }
      // 分析标记清理按跨实例共享所有者（R2-C19）：本请求仍是该卡片且仍是该
      // repoId 的共享标记所有者时才清除，避免账号 A 的旧请求清掉账号 B 正在
      // 分析同一 repoId 时设置的共享忙标记。
      if (
        analyzeRequestTokenRef.current === requestToken
        && analyzingRepoMarkerOwners.get(repoId) === requestToken
      ) {
        analyzingRepoMarkerOwners.delete(repoId);
        setAnalyzingRepository(repoId, false);
      }
    }
  }, [
    activeAIConfig,
    aiConfigs,
    allCategories,
    confirm,
    githubToken,
    language,
    repoId,
    repository,
    setAnalyzingRepository,
    toast,
    updateRepository, t]);

  const findSimilar = useCallback(async () => {
    if (isFindingSimilar) return;
    if (!vectorSearchAvailable) {
      toast(
        t('useRepositoryCardActions.vector-search-is-not-ready-please-enable-vector'),
        'error',
      );
      return;
    }

    const activeConfig = embeddingConfigs.find((config) => config.id === activeEmbeddingConfig);
    if (!activeConfig) return;

    similarityAbortRef.current?.abort();
    const controller = new AbortController();
    similarityAbortRef.current = controller;
    // 账号代次校验（Issue #611）：相似搜索等待期间切号后，结果绝不写入新账号
    // 的全局相似视图（与分析流程同一账号代次边界）
    const requestAccountId = peekCurrentAccountId();
    const requestGeneration = getAccountSessionGeneration();
    setIsFindingSimilar(true);
    try {
      const embeddingClient = new EmbeddingClient({
        ...activeConfig,
        apiType: activeConfig.apiType,
        baseUrl: activeConfig.baseUrl,
        apiKey: activeConfig.apiKey,
        model: activeConfig.model,
        dimensions: activeConfig.dimensions,
      });
      const vectorService = new VectorSearchService({
        workerUrl: vectorSearchConfig.workerUrl,
        authToken: vectorSearchConfig.authToken,
      });
      // Indexing enriches documents with README text in readme mode. Mirror that
      // source representation for card-level similarity without changing SearchBar.
      const githubApi = githubToken ? createGitHubApiService(githubToken) : null;
      const readmeFetcher = githubApi
        ? (owner: string, repo: string, signal?: AbortSignal) => githubApi.getRepositoryReadme(owner, repo, signal)
        : undefined;
      const aiConfig = aiConfigs.find((config) => config.id === activeAIConfig);
      const aiService = aiConfig
        && aiConfig.apiKeyStatus !== 'decrypt_failed'
        && aiConfig.apiKeyStatus !== 'empty'
        && aiConfig.baseUrl
        && aiConfig.apiKey
        && aiConfig.model
        ? new AIService(aiConfig, language)
        : null;
      const result = await runSimilarRepositoryPipeline({
        source: repository,
        repositories,
        vectorConfig: vectorSearchConfig,
        embeddingClient,
        embeddingConfig: activeConfig,
        vectorService,
        aiService,
        crossEncoder: new CrossEncoderReranker(activeConfig),
        readmeFetcher,
        signal: controller.signal,
        // 账号隔离范围（R4 审计修复）：多账号共享同一向量索引时按归属账号
        // 过滤命中，防止他账号向量经同一仓库 ID 串入当前账号的相似视图
        ...(requestAccountId
          ? (() => {
            const isMultiAccount = Object.keys(useAppStore.getState().savedAccounts ?? {}).length > 1;
            return {
              accountIdScope: {
                accountId: requestAccountId,
                multiAccount: isMultiAccount,
                // 审计修复（R5）：本机保存的账号数量无法证明共享索引中无前缀
                // legacy 向量的归属（与 useSearchActions 同一约束）。归属未经
                // 独立确认时一律拒绝无归属 legacy 向量，保留严格范围与本地
                // 召回；单账号兼容由格式版本升级触发的完整重建收敛。
                allowLegacyUnscoped: false,
              },
            };
          })()
          : {}),
      });
      if (
        controller.signal.aborted
        || similarityAbortRef.current !== controller
        || !isCurrentAccountSession(requestAccountId, requestGeneration)
      ) {
        throw new DOMException('Similar search superseded', 'AbortError');
      }

      enterSimilarView(result.repositories, repository);

      if (result.repositories.length === 0) {
        toast(t('useRepositoryCardActions.no-similar-repositories-found'), 'info');
      } else if (result.diagnostics.denseIndexUnavailableReasonCode) {
        // 交接项 3（R12）：稠密索引不可用时管道仍会返回词法/结构化召回的非空
        // 结果——但结果可能不完整，必须明确提示用户。提示按稳定原因代码本地化
        // （services 域提供 4 个代码与 10 locale 文案）；英文诊断文本仅作日志。
        toast(
          t(`useRepositoryCardActions.dense-index-unavailable-reason-${result.diagnostics.denseIndexUnavailableReasonCode}`),
          'warning',
        );
      } else if (result.diagnostics.denseIndexUnavailableReason) {
        // 代码缺失回退（旧管道/第三方管道）：保留既有英文诊断提示
        toast(
          t('useRepositoryCardActions.similar-results-may-be-incomplete-the-dens', { v1: result.diagnostics.denseIndexUnavailableReason }),
          'warning',
        );
      }
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) return;
      if (!isCurrentAccountSession(requestAccountId, requestGeneration)) return;
      console.error('Find similar repositories failed:', error);
      // R13 finding 74：索引未就绪且无本地候选的错误携带稳定原因代码
      //（similarRepositoryPipeline 抛出的 Error 扩展属性
      // denseIndexUnavailableReasonCode）——按代码渲染本地化提示，不再把
      // 英文诊断文本直接展示给用户；非索引类错误无代码，保持既有回退文案。
      const reasonCode = (error as { denseIndexUnavailableReasonCode?: unknown } | null)
        ?.denseIndexUnavailableReasonCode;
      if (typeof reasonCode === 'string' && reasonCode.length > 0) {
        toast(t(`useRepositoryCardActions.dense-index-unavailable-reason-${reasonCode}`), 'error');
        return;
      }
      const errorMessage = error instanceof Error && error.message
        ? error.message
        : (t('useRepositoryCardActions.failed-to-find-similar-repositories-please-check'));
      toast(errorMessage, 'error');
    } finally {
      if (similarityAbortRef.current === controller) {
        similarityAbortRef.current = null;
        setIsFindingSimilar(false);
      }
    }
  }, [
    activeAIConfig,
    activeEmbeddingConfig,
    aiConfigs,
    embeddingConfigs,
    enterSimilarView,
    githubToken,
    isFindingSimilar,
    language,
    repositories,
    repository,
    toast,
    vectorSearchAvailable,
    vectorSearchConfig, t]);

  const toggleReleaseSubscription = useCallback(() => {
    toggleStoreReleaseSubscription(repoId);
  }, [repoId, toggleStoreReleaseSubscription]);

  const unstar = useCallback(async () => {
    if (!githubToken) {
      toast(
        t('useRepositoryCardActions.github-token-not-found-please-login-again-2'),
        'error',
      );
      return;
    }

    // 账号代次校验（Issue #611 审计修复）：确认框等待期间可能切号——账号 ID
    // 在确认框之前保存，确认后与远端请求完成后分别复核，绝不删除切号后
    // 当前工作区中同 ID 的仓库并同步该删除。
    const startedAccountId = peekCurrentAccountId();
    const startedGeneration = getAccountSessionGeneration();
    // 审计修复（C29）：发起时保存目标后端地址，供切号完成路径登记 (账号, 后端)
    // 待补推删除标记。
    const startedBackendUrl = backend.backendUrl ?? '';
    // 审计修复（R12，CodeRabbit Major）：记录发起时该仓库的星标时间——迟到的
    // 取消星标响应据此区分「原始记录仍在」与「切号期间重新加星的同 ID 记录」
    //（重新加星路径都会刷新 starred_at），后者必须保留且不登记删除。
    const startedStarredAt = repository.starred_at;

    const confirmMessage = t('useRepositoryCardActions.are-you-sure-you-want-to-unstar-v1-this-will-rem', { v1: repository.full_name });

    if (!await confirm(
      t('useRepositoryCardActions.unstar-confirmation'),
      confirmMessage,
      {
        type: 'danger',
        confirmText: t('useRepositoryCardActions.unstar'),
      },
    )) {
      return;
    }
    if (!isCurrentAccountSession(startedAccountId, startedGeneration)) return;

    setIsUnstarring(true);
    try {
      const githubApi = createGitHubApiService(githubToken);
      const [owner, repo] = repository.full_name.split('/');
      await githubApi.unstarRepository(owner, repo);
      // 远端取消星标已按发起账号完成；账号已切换时跳过当前账号的本地删除与
      // 同步，但必须为发起账号保留删除状态（审计修复 C29）：发起账号已重新
      // 激活 → 在其当前实时工作区应用删除；仍停放 → 更新其归档快照（列表与
      // release 归档一致）；同时登记发起账号 (账号, 后端) 的待同步删除标记，
      // 切回后先补推删除再拉取，保证该仓库不再显示为已 Star。
      if (!isCurrentAccountSession(startedAccountId, startedGeneration)) {
        const unstarredRepoId = repository.id;
        const reconcileState = typeof useAppStore.getState === 'function' ? useAppStore.getState() : null;
        // 只有发起账号仍是当前账号时，实时列表才属于它——切到 B 后实时列表
        // 是 B 的工作区，同 ID 仓库与 A 无关，绝不能据此判定「重新加星」。
        const liveRecord = isCurrentAccount(startedAccountId)
          ? reconcileState?.repositories.find((r) => r.id === unstarredRepoId)
          : undefined;
        const parkedRecord = startedAccountId
          ? reconcileState?.accountWorkspaces?.[startedAccountId]?.repositories.find((r) => r.id === unstarredRepoId)
          : undefined;
        // R12：同 ID 记录在等待期间被重新加星（starred_at 已刷新）时保留它，
        // 绝不按旧响应删除，也不登记待删除（GitHub 上仍为已加星）。
        // 若原记录缺少 starred_at 而当前记录补上了时间戳，无法区分「星标同步
        // 补齐旧时间」与「真实重新加星」：向 GitHub 核对当前星标状态后再决定。
        const matchingRecords = [liveRecord, parkedRecord].filter((record): record is Repository => Boolean(record));
        let restarred = false;
        if (startedStarredAt !== undefined) {
          restarred = matchingRecords.some((record) => (record.starred_at ?? undefined) !== startedStarredAt);
        } else if (matchingRecords.some((record) => record.starred_at !== undefined)) {
          if (typeof githubApi.isRepositoryStarred === 'function') {
            try {
              restarred = await githubApi.isRepositoryStarred(owner, repo);
            } catch {
              // 无法确认未加星时保守保留记录，避免误删可能已重新加星的仓库
              restarred = true;
            }
          } else {
            restarred = true;
          }
        }
        if (!restarred && startedAccountId && typeof useAppStore.setState === 'function') {
          const parkedAccountId: string = startedAccountId;
          if (isCurrentAccount(startedAccountId)) {
            withAccountSwitchGuardSync(() => {
              useAppStore.setState((state) => {
                // R12：与 deleteRepository 同一清理规则——移除已删除仓库的订阅，
                // 并清掉剩余 Release 已不包含的已读 ID。
                const remainingReleaseIds = new Set(
                  state.releases.filter((rel) => rel.repository.id !== unstarredRepoId).map((rel) => rel.id),
                );
                const nextSubscriptions = new Set(state.releaseSubscriptions ?? []);
                nextSubscriptions.delete(unstarredRepoId);
                return {
                  repositories: state.repositories.filter((r) => r.id !== unstarredRepoId),
                  // 审计修复：搜索激活时视图直接渲染 searchResults——取消星标的
                  // 仓库必须与正常 deleteRepository 路径一样从结果中过滤掉。
                  searchResults: state.searchResults.filter((r) => r.id !== unstarredRepoId),
                  releases: state.releases.filter((rel) => rel.repository.id !== unstarredRepoId),
                  releaseSubscriptions: nextSubscriptions,
                  readReleases: new Set(
                    Array.from(state.readReleases ?? []).filter((releaseId) => remainingReleaseIds.has(releaseId)),
                  ),
                };
              });
            });
          }
          withAccountSwitchGuardSync(() => {
            useAppStore.setState((state) => {
              const parked = state.accountWorkspaces[parkedAccountId];
              if (!parked) return state;
              const remainingReleaseIds = new Set(
                parked.releases.filter((rel) => rel.repository.id !== unstarredRepoId).map((rel) => rel.id),
              );
              const nextSubscriptions = new Set(parked.releaseSubscriptions ?? []);
              nextSubscriptions.delete(unstarredRepoId);
              return {
                accountWorkspaces: {
                  ...state.accountWorkspaces,
                  [parkedAccountId]: {
                    ...parked,
                    repositories: parked.repositories.filter((r) => r.id !== unstarredRepoId),
                    releases: parked.releases.filter((rel) => rel.repository.id !== unstarredRepoId),
                    releaseSubscriptions: Array.from(nextSubscriptions),
                    readReleases: Array.from(parked.readReleases ?? []).filter((releaseId) => remainingReleaseIds.has(releaseId)),
                  },
                },
              };
            });
          });
        }
        if (startedAccountId && !restarred) {
          // R2-C3：即使发起账号没有任何推送基线，也要按 (账号, 发起时后端)
          // 持久化登记已确认的删除，切回后的拉取/推送合并据此排除该仓库。
          markPendingRepositoryDeletion(startedAccountId, repository.id, startedBackendUrl);
          markPendingAccountSync(startedAccountId, startedBackendUrl);
        }
        return;
      }
      deleteRepository(repository.id);
      await forceSyncToBackend();
      // 同步也是一次等待：切号后旧会话的提示不应出现在新账号。
      if (isCurrentAccountSession(startedAccountId, startedGeneration)) {
        toast(t('useRepositoryCardActions.successfully-unstarred'), 'success');
      }
    } catch (error) {
      console.error('Failed to unstar repository:', error);
      // 审计修复（C30）：失败提示绑定发起会话——会话已切则跳过提示。
      if (isCurrentAccountSession(startedAccountId, startedGeneration)) {
        toast(
          t('useRepositoryCardActions.failed-to-unstar-repository-please-check-your-ne'),
          'error',
        );
      }
    } finally {
      setIsUnstarring(false);
    }
  }, [confirm, deleteRepository, githubToken, repository, toast, t]);

  return useMemo(() => ({
    analyze,
    findSimilar,
    unstar,
    toggleReleaseSubscription,
    isSubscribed,
    isAnalyzing: isLocallyAnalyzing || isStoreAnalyzing,
    isFindingSimilar,
    isUnstarring,
    vectorSearchAvailable,
  }), [
    analyze,
    findSimilar,
    isFindingSimilar,
    isLocallyAnalyzing,
    isStoreAnalyzing,
    isSubscribed,
    isUnstarring,
    toggleReleaseSubscription,
    unstar,
    vectorSearchAvailable,
  ]);
};
