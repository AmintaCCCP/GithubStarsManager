import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { DiscoveryRepo, Repository } from '../../../types';
import { useAppStore, getAllCategories } from '../../../store/useAppStore';
import { analyzeRepository, createFailedAnalysisResult } from '../../../services/aiAnalysisHelper';
import { forceSyncToBackend } from '../../../services/autoSync';
import { GitHubApiService } from '../../../services/githubApi';
import { useDialog } from '../../../hooks/useDialog';
import { applyDiscoveryAnalysisFailure, applyDiscoveryAnalysisSuccess } from '../../repositories/application/discoveryRepoPatches';

export interface UseDiscoveryRepoActionsOptions {
  repo: DiscoveryRepo;
}

export interface DiscoveryRepoActions {
  analyze: (onAnalyzed?: (repo: DiscoveryRepo) => void) => Promise<void>;
  star: (onStar?: (repo: DiscoveryRepo) => void) => Promise<void>;
  executeUnstar: () => Promise<void>;
  isAnalyzing: boolean;
  isStarring: boolean;
  isStarred: boolean;
  optimisticStarred: boolean | null;
}

// 原 SubscriptionRepoCard.handleStar 的 repositoryToAdd 字面量提纯：
// 抹去发现页特有字段（键保留、值置 undefined）并补 Star 时间。
// cast 是必须的——Repository 没有 rank/channel/platform 键，运行时形状与原实现逐字一致。
export const discoveryRepoToRepository = (repo: DiscoveryRepo, starredAt: string): Repository => ({
  ...repo,
  rank: undefined,
  channel: undefined,
  platform: undefined,
  starred_at: starredAt,
} as Repository);

export const useDiscoveryRepoActions = ({ repo }: UseDiscoveryRepoActionsOptions): DiscoveryRepoActions => {
  const {
    githubToken,
    aiConfigs,
    activeAIConfig,
    language,
    customCategories,
    repositories,
    updateDiscoveryRepo,
    addRepository,
    deleteRepository,
  } = useAppStore(useShallow((state) => ({
    githubToken: state.githubToken,
    aiConfigs: state.aiConfigs,
    activeAIConfig: state.activeAIConfig,
    language: state.language,
    customCategories: state.customCategories,
    repositories: state.repositories,
    updateDiscoveryRepo: state.updateDiscoveryRepo,
    addRepository: state.addRepository,
    deleteRepository: state.deleteRepository,
  })));

  const { toast } = useDialog();

  const t = useCallback((zh: string, en: string) => language === 'zh' ? zh : en, [language]);

  const [isStarring, setIsStarring] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  // 本地乐观状态，用于立即反映Star操作结果
  const [optimisticStarred, setOptimisticStarred] = useState<boolean | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  // 检查仓库是否已在本地存在（已被Star）
  const isStarredComputed = useMemo(() => {
    return repositories.some(r => r.full_name === repo.full_name);
  }, [repositories, repo.full_name]);

  // 优先使用乐观状态，否则使用计算状态
  const isStarred = optimisticStarred !== null ? optimisticStarred : isStarredComputed;

  // 执行取消Star操作。无 confirm——取消 Star 的确认是 View 侧自定义 Modal（B8），
  // View 确认按钮负责清 unstarConfirmOpen/pendingUnstarAction 后调用本方法。
  const executeUnstar = useCallback(async () => {
    if (!githubToken) return;

    setIsStarring(true);

    try {
      const githubApi = new GitHubApiService(githubToken);
      const [owner, name] = repo.full_name.split('/');

      // 乐观更新：立即更新UI状态
      setOptimisticStarred(false);

      await githubApi.unstarRepository(owner, name);

      // 从本地删除
      const existingRepo = repositories.find(r => r.full_name === repo.full_name);
      if (existingRepo) {
        deleteRepository(existingRepo.id);
      }

      await forceSyncToBackend();

      // 操作成功，清除乐观状态
      setOptimisticStarred(null);
    } catch (error) {
      // 操作失败，回滚乐观状态
      setOptimisticStarred(null);
      console.error('Failed to unstar repository:', error);
      const errorMessage = t('取消 Star 失败，请检查网络连接或 GitHub Token 权限。', 'Failed to unstar repository. Please check your network connection or GitHub Token permissions.');
      toast(errorMessage, 'error');
    } finally {
      setIsStarring(false);
    }
  }, [githubToken, repo, repositories, deleteRepository, t, toast]);

  // 添加Star（取消Star路径由 View 确认 Modal 承担，不在本方法内）
  const star = useCallback(async (onStar?: (repo: DiscoveryRepo) => void) => {
    if (!githubToken || isStarring) return;

    setIsStarring(true);

    try {
      const githubApi = new GitHubApiService(githubToken);
      const [owner, name] = repo.full_name.split('/');

      // 乐观更新：立即更新UI状态
      setOptimisticStarred(true);

      await githubApi.starRepository(owner, name);

      addRepository(discoveryRepoToRepository(repo, new Date().toISOString()));

      if (onStar) {
        onStar(repo);
      }

      await forceSyncToBackend();

      // 操作成功，清除乐观状态
      setOptimisticStarred(null);

      toast(t('已成功添加 Star', 'Successfully starred'), 'success');
    } catch (error) {
      // 操作失败，回滚乐观状态
      setOptimisticStarred(null);
      console.error('Failed to star repository:', error);
      const errorMessage = t('Star 操作失败，请检查网络连接或 GitHub Token 权限。', 'Failed to star repository. Please check your network connection or GitHub Token permissions.');
      toast(errorMessage, 'error');
    } finally {
      setIsStarring(false);
    }
  }, [githubToken, isStarring, repo, t, toast, addRepository]);

  // 单卡 AI 分析（无 forceSync、成功无 toast、重新分析无 confirm——与 RepositoryCard 不同，勿"补齐"）
  const analyze = useCallback(async (onAnalyzed?: (repo: DiscoveryRepo) => void) => {
    if (!githubToken) {
      toast(t('GitHub Token 未找到，请重新登录。', 'GitHub token not found. Please login again.'), 'error');
      return;
    }

    const activeConfig = aiConfigs.find(c => c.id === activeAIConfig);
    if (!activeConfig) {
      toast(t('请先在设置中配置AI服务。', 'Please configure AI service in settings first.'), 'error');
      return;
    }

    if (activeConfig.apiKeyStatus === 'decrypt_failed' || activeConfig.apiKeyStatus === 'empty') {
      toast(t('AI服务的API密钥无法解密或为空，请在设置中重新输入并保存该配置。', 'The AI service API key could not be decrypted or is empty. Please re-enter and save the configuration in settings.'), 'error');
      return;
    }

    if (!activeConfig.baseUrl || !activeConfig.apiKey || !activeConfig.model) {
      toast(t('AI服务配置不完整，请检查API端点、密钥和模型名称。', 'AI service configuration is incomplete. Please check the API endpoint, key, and model name.'), 'error');
      return;
    }

    if (isAnalyzing) return;

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsAnalyzing(true);

    try {
      const allCategories = getAllCategories(customCategories, language);

      const result = await analyzeRepository({
        repository: repo,
        githubToken,
        aiConfig: activeConfig,
        language,
        categories: allCategories,
        signal: controller.signal,
      });

      if (controller.signal.aborted) return;

      const updatedRepo = applyDiscoveryAnalysisSuccess(repo, {
        summary: result.summary,
        tags: result.tags,
        platforms: result.platforms,
        analyzedAt: result.analyzed_at,
        analysisFailed: result.analysis_failed,
      });
      updateDiscoveryRepo(updatedRepo);

      if (onAnalyzed) {
        onAnalyzed(updatedRepo);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        console.error('AI analysis error:', error);
        const errorMsg = error instanceof Error && error.message
          ? error.message
          : t('AI分析失败，请检查AI配置和网络连接', 'AI analysis failed, please check AI configuration and network connection');
        const failedResult = createFailedAnalysisResult(errorMsg);
        const failedRepo = applyDiscoveryAnalysisFailure(repo, {
          analyzedAt: failedResult.analyzed_at,
          analysisFailed: failedResult.analysis_failed,
          analysisError: failedResult.analysis_error,
        });
        updateDiscoveryRepo(failedRepo);
        toast(t('AI分析失败，请检查AI配置。', 'AI analysis failed. Please check your AI configuration.'), 'error');
      }
    } finally {
      if (!controller.signal.aborted) {
        setIsAnalyzing(false);
      }
    }
  }, [githubToken, aiConfigs, activeAIConfig, language, repo, isAnalyzing, customCategories, updateDiscoveryRepo, t, toast]);

  return useMemo(() => ({
    analyze,
    star,
    executeUnstar,
    isAnalyzing,
    isStarring,
    isStarred,
    optimisticStarred,
  }), [analyze, star, executeUnstar, isAnalyzing, isStarring, isStarred, optimisticStarred]);
};
