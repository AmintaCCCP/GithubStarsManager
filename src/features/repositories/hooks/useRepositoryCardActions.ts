
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
    setAnalyzingRepository(repoId, false);
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
    const requestToken = analyzeRequestTokenRef.current + 1;
    analyzeRequestTokenRef.current = requestToken;

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
      // 分析标记清理按请求身份（R2-C19）：本请求仍是该卡片最新请求时清除，
      // 即使会话已失效（同账号换凭据/切号）也必须清掉旧代次自己的忙标记，
      // 否则 isAnalyzing 永久为 true；已有新请求接管时绝不清除其标记。
      if (analyzeRequestTokenRef.current === requestToken) {
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
                // 单账号老用户免重建索引，直接兼容存量旧向量；多账号时启用严格隔离。
                allowLegacyUnscoped: !isMultiAccount,
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
      }
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) return;
      if (!isCurrentAccountSession(requestAccountId, requestGeneration)) return;
      console.error('Find similar repositories failed:', error);
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
        if (startedAccountId && typeof useAppStore.setState === 'function') {
          const unstarredRepoId = repository.id;
          const parkedAccountId: string = startedAccountId;
          if (isCurrentAccount(startedAccountId)) {
            withAccountSwitchGuardSync(() => {
              useAppStore.setState((state) => ({
                repositories: state.repositories.filter((r) => r.id !== unstarredRepoId),
                releases: state.releases.filter((rel) => rel.repository.id !== unstarredRepoId),
              }));
            });
          }
          withAccountSwitchGuardSync(() => {
            useAppStore.setState((state) => {
              const parked = state.accountWorkspaces[parkedAccountId];
              if (!parked) return state;
              return {
                accountWorkspaces: {
                  ...state.accountWorkspaces,
                  [parkedAccountId]: {
                    ...parked,
                    repositories: parked.repositories.filter((r) => r.id !== unstarredRepoId),
                    releases: parked.releases.filter((rel) => rel.repository.id !== unstarredRepoId),
                  },
                },
              };
            });
          });
        }
        if (startedAccountId) {
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
