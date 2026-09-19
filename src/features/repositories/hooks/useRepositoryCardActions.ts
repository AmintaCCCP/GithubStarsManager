
import { useT } from '../../../i18n/useT';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { shallow } from 'zustand/shallow';
import type { Category, Repository } from '../../../types';
import { useAppStore } from '../../../store/useAppStore';
import { useDialog } from '../../../hooks/useDialog';
import { EmbeddingClient, VectorSearchService, findSimilarRepositories } from '../../../services/vectorSearchService';
import { analyzeRepository, createFailedAnalysisResult } from '../../../services/aiAnalysisHelper';
import { forceSyncToBackend } from '../../../services/autoSync';
import { GitHubApiService } from '../../../services/githubApi';
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
    shallow,
  );
  const { toast, confirm } = useDialog();
  const abortControllerRef = useRef<AbortController | null>(null);
  const [isLocallyAnalyzing, setIsLocallyAnalyzing] = useState(false);
  const [isFindingSimilar, setIsFindingSimilar] = useState(false);
  const [isUnstarring, setIsUnstarring] = useState(false);

  useEffect(() => () => {
    abortControllerRef.current?.abort();
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

    if (repository.analyzed_at) {
      const confirmMessage = t('useRepositoryCardActions.this-repository-was-analyzed-on-v1-do-you-want-t', { v1: new Date(repository.analyzed_at).toLocaleString() });

      if (!await confirm(
        t('useRepositoryCardActions.re-analyze-confirmation'),
        confirmMessage,
        { type: 'warning' },
      )) {
        return;
      }
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
      setIsLocallyAnalyzing(false);
      if (!controller.signal.aborted) {
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
      const githubApi = githubToken ? new GitHubApiService(githubToken) : null;
      const readmeFetcher = githubApi
        ? (owner: string, repo: string, signal?: AbortSignal) => githubApi.getRepositoryReadme(owner, repo, signal)
        : undefined;
      const similar = await findSimilarRepositories(repository, {
        embeddingClient,
        vectorService,
        allRepos: repositories,
        topK: vectorSearchConfig.searchTopK ?? 30,
        threshold: vectorSearchConfig.searchThreshold ?? 0.35,
        readmeFetcher,
        indexMode: vectorSearchConfig.indexMode,
        readmeMaxChars: vectorSearchConfig.readmeMaxChars,
      });

      enterSimilarView(similar, repository);

      if (similar.length === 0) {
        toast(t('useRepositoryCardActions.no-similar-repositories-found'), 'info');
      }
    } catch (error) {
      console.error('Find similar repositories failed:', error);
      const errorMessage = error instanceof Error && error.message
        ? error.message
        : (t('useRepositoryCardActions.failed-to-find-similar-repositories-please-check'));
      toast(errorMessage, 'error');
    } finally {
      setIsFindingSimilar(false);
    }
  }, [
    activeEmbeddingConfig,
    embeddingConfigs,
    enterSimilarView,
    githubToken,
    isFindingSimilar,
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

    setIsUnstarring(true);
    try {
      const githubApi = new GitHubApiService(githubToken);
      const [owner, repo] = repository.full_name.split('/');
      await githubApi.unstarRepository(owner, repo);
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
