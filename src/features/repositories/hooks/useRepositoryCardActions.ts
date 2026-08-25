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
        language === 'zh'
          ? 'GitHub token 未找到，请重新登录。'
          : 'GitHub token not found. Please login again.',
        'error',
      );
      return;
    }

    const activeConfig = aiConfigs.find((config) => config.id === activeAIConfig);
    if (!activeConfig) {
      toast(
        language === 'zh'
          ? '请先在设置中配置AI服务。'
          : 'Please configure AI service in settings first.',
        'error',
      );
      return;
    }

    if (activeConfig.apiKeyStatus === 'decrypt_failed' || activeConfig.apiKeyStatus === 'empty') {
      toast(
        language === 'zh'
          ? 'AI服务的API密钥无法解密或为空，请在设置中重新输入并保存该配置。'
          : 'The AI service API key could not be decrypted or is empty. Please re-enter and save the configuration in settings.',
        'error',
      );
      return;
    }

    if (!activeConfig.baseUrl || !activeConfig.apiKey || !activeConfig.model) {
      toast(
        language === 'zh'
          ? 'AI服务配置不完整，请检查API端点、密钥和模型名称。'
          : 'AI service configuration is incomplete. Please check the API endpoint, key, and model name.',
        'error',
      );
      return;
    }

    if (repository.analyzed_at) {
      const confirmMessage = language === 'zh'
        ? `此仓库已于 ${new Date(repository.analyzed_at).toLocaleString()} 进行过AI分析。\n\n是否要重新分析？这将覆盖现有的分析结果。`
        : `This repository was analyzed on ${new Date(repository.analyzed_at).toLocaleString()}.\n\nDo you want to re-analyze? This will overwrite the existing analysis results.`;

      if (!await confirm(
        language === 'zh' ? '重新分析确认' : 'Re-analyze Confirmation',
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
          ? (language === 'zh' ? 'AI重新分析完成！' : 'AI re-analysis completed!')
          : (language === 'zh' ? 'AI分析完成！' : 'AI analysis completed!'),
        'success',
      );
    } catch (error) {
      if (!controller.signal.aborted) {
        console.error('AI analysis failed:', error);

        const errorMessage = error instanceof Error && error.message
          ? error.message
          : (language === 'zh'
            ? 'AI分析失败，请检查AI配置和网络连接'
            : 'AI analysis failed, please check AI configuration and network connection');
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
          language === 'zh'
            ? 'AI分析失败，请检查AI配置和网络连接。'
            : 'AI analysis failed. Please check AI configuration and network connection.',
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
    updateRepository,
  ]);

  const findSimilar = useCallback(async () => {
    if (isFindingSimilar) return;
    if (!vectorSearchAvailable) {
      toast(
        language === 'zh'
          ? '向量搜索未就绪：请先在设置中开启向量搜索并完成索引。'
          : 'Vector search is not ready. Please enable vector search and build the index in settings first.',
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
      const similar = await findSimilarRepositories(repository, {
        embeddingClient,
        vectorService,
        allRepos: repositories,
        topK: vectorSearchConfig.searchTopK ?? 30,
        threshold: vectorSearchConfig.searchThreshold ?? 0.35,
      });

      enterSimilarView(similar, repository);

      if (similar.length === 0) {
        toast(language === 'zh' ? '未找到相似的仓库。' : 'No similar repositories found.', 'info');
      }
    } catch (error) {
      console.error('Find similar repositories failed:', error);
      const errorMessage = error instanceof Error && error.message
        ? error.message
        : (language === 'zh'
          ? '查找相似仓库失败，请检查向量搜索配置。'
          : 'Failed to find similar repositories. Please check vector search configuration.');
      toast(errorMessage, 'error');
    } finally {
      setIsFindingSimilar(false);
    }
  }, [
    activeEmbeddingConfig,
    embeddingConfigs,
    enterSimilarView,
    isFindingSimilar,
    language,
    repositories,
    repository,
    toast,
    vectorSearchAvailable,
    vectorSearchConfig,
  ]);

  const toggleReleaseSubscription = useCallback(() => {
    toggleStoreReleaseSubscription(repoId);
  }, [repoId, toggleStoreReleaseSubscription]);

  const unstar = useCallback(async () => {
    if (!githubToken) {
      toast(
        language === 'zh'
          ? '未找到 GitHub Token，请重新登录。'
          : 'GitHub token not found. Please login again.',
        'error',
      );
      return;
    }

    const confirmMessage = language === 'zh'
      ? `确定要取消 Star "${repository.full_name}" 吗？\n\n这将会从您的 GitHub 收藏中移除该仓库。`
      : `Are you sure you want to unstar "${repository.full_name}"?\n\nThis will remove the repository from your GitHub stars.`;

    if (!await confirm(
      language === 'zh' ? '取消Star确认' : 'Unstar Confirmation',
      confirmMessage,
      {
        type: 'danger',
        confirmText: language === 'zh' ? '取消Star' : 'Unstar',
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
      toast(language === 'zh' ? '已成功取消 Star' : 'Successfully unstarred', 'success');
    } catch (error) {
      console.error('Failed to unstar repository:', error);
      toast(
        language === 'zh'
          ? '取消 Star 失败，请检查网络连接或重新登录。'
          : 'Failed to unstar repository. Please check your network connection or login again.',
        'error',
      );
    } finally {
      setIsUnstarring(false);
    }
  }, [confirm, deleteRepository, githubToken, language, repository, toast]);

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
