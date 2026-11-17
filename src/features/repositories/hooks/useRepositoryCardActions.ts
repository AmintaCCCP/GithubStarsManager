
import { useT } from '../../../i18n/useT';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Category, Repository } from '../../../types';
import { useAppStore } from '../../../store/useAppStore';
import { isCurrentAccount, peekCurrentAccountId } from '../../../store/helpers/accountWorkspace';
import { useDialog } from '../../../hooks/useDialog';
import { AIService, isAbortError } from '../../../services/aiService';
import { CrossEncoderReranker } from '../../../services/crossEncoderReranker';
import { runSimilarRepositoryPipeline } from '../../../services/similarRepositoryPipeline';
import { EmbeddingClient, VectorSearchService } from '../../../services/vectorSearchService';
import { analyzeRepository, createFailedAnalysisResult } from '../../../services/aiAnalysisHelper';
import { forceSyncToBackend } from '../../../services/autoSync';
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

    if (repository.analyzed_at) {
      const confirmMessage = t('useRepositoryCardActions.this-repository-was-analyzed-on-v1-do-you-want-t', { v1: new Date(repository.analyzed_at).toLocaleString() });

      if (!await confirm(
        t('useRepositoryCardActions.re-analyze-confirmation'),
        confirmMessage,
        { type: 'warning' },
      )) {
        return;
      }
      if (!isCurrentAccount(startedAccountId)) return;
    }

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

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
      if (!isCurrentAccount(startedAccountId)) return;

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
      if (!controller.signal.aborted && !isCurrentAccount(startedAccountId)) {
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
      // 分析标记清理只作用于发起账号仍是当前账号的工作区：切号后清理会误清
      // 新账号同 ID 仓库的分析标记（发起账号的标记不入工作区快照，无需额外清理）
      if (!controller.signal.aborted && isCurrentAccount(startedAccountId)) {
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
      });
      if (
        controller.signal.aborted
        || similarityAbortRef.current !== controller
        || !isCurrentAccount(requestAccountId)
      ) {
        throw new DOMException('Similar search superseded', 'AbortError');
      }

      enterSimilarView(result.repositories, repository);

      if (result.repositories.length === 0) {
        toast(t('useRepositoryCardActions.no-similar-repositories-found'), 'info');
      }
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) return;
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
    if (!isCurrentAccount(startedAccountId)) return;

    setIsUnstarring(true);
    try {
      const githubApi = createGitHubApiService(githubToken);
      const [owner, repo] = repository.full_name.split('/');
      await githubApi.unstarRepository(owner, repo);
      // 远端取消星标已按发起账号完成；账号已切换时跳过本地删除与同步，
      // 避免删除新账号工作区中的同 ID 仓库（原账号记录留待下次同步收敛）
      if (!isCurrentAccount(startedAccountId)) return;
      deleteRepository(repository.id);
      await forceSyncToBackend();
      toast(t('useRepositoryCardActions.successfully-unstarred'), 'success');
    } catch (error) {
      console.error('Failed to unstar repository:', error);
      toast(
        t('useRepositoryCardActions.failed-to-unstar-repository-please-check-your-ne'),
        'error',
      );
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
