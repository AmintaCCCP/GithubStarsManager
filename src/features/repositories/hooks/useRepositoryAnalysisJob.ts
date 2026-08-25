import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { shallow } from 'zustand/shallow';
import type { Category, Repository } from '../../../types';
import { useAppStore } from '../../../store/useAppStore';
import { useDialog } from '../../../hooks/useDialog';
import { AIAnalysisOptimizer, type AnalysisResult } from '../../../services/aiAnalysisOptimizer';
import { AIService } from '../../../services/aiService';
import { GitHubApiService } from '../../../services/githubApi';
import { forceSyncToBackend } from '../../../services/autoSync';
import { buildCategoryHints, resolveCategoryAssignment } from '../../../utils/categoryUtils';
import { applyAnalysisFailure, applyAnalysisSuccess } from '../application/repositoryPatches';

export type RepositoryAnalysisScope = 'all' | 'unanalyzed' | 'failed' | 'selected';

interface UseRepositoryAnalysisJobOptions {
  allCategories: Category[];
}

interface RunRepositoryAnalysisOptions {
  repositories: Repository[];
  scope: RepositoryAnalysisScope;
  syncOnComplete: boolean;
}

export interface RepositoryAnalysisJob {
  run: (options: RunRepositoryAnalysisOptions) => Promise<boolean>;
  pause: () => void;
  resume: () => void;
  requestStop: () => Promise<boolean>;
  isRunning: boolean;
  isPaused: boolean;
  progress: { current: number; total: number };
}

const createOptimizer = (concurrency?: number, requestsPerMinute?: number) => new AIAnalysisOptimizer({
  initialConcurrency: concurrency || 3,
  maxConcurrency: 10,
  minConcurrency: 1,
  targetResponseTime: 5000,
  batchDelayMs: 100,
  maxRetries: 3,
  retryDelayBaseMs: 1000,
  enableAdaptiveConcurrency: true,
  rateLimiter: {
    maxConcurrency: 0,
    requestsPerMinute: requestsPerMinute || 0,
  },
});

/**
 * Owns the lifecycle of one RepositoryList batch-analysis job. The hook keeps
 * the optimizer instance in a ref so pause, resume, stop, and unmount cleanup
 * always affect the active job without putting a mutable job in the store.
 */
export const useRepositoryAnalysisJob = ({
  allCategories,
}: UseRepositoryAnalysisJobOptions): RepositoryAnalysisJob => {
  const {
    githubToken,
    aiConfigs,
    activeAIConfig,
    language,
    updateRepository,
    setLoading,
    setAnalysisProgress,
  } = useAppStore(
    useCallback((state) => ({
      githubToken: state.githubToken,
      aiConfigs: state.aiConfigs,
      activeAIConfig: state.activeAIConfig,
      language: state.language,
      updateRepository: state.updateRepository,
      setLoading: state.setLoading,
      setAnalysisProgress: state.setAnalysisProgress,
    }), []),
    shallow,
  );
  const { toast, confirm } = useDialog();
  const optimizerRef = useRef<AIAnalysisOptimizer | null>(null);
  const isRunningRef = useRef(false);
  const isPausedRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const mountedRef = useRef(true);
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  const t = useCallback((zh: string, en: string) => language === 'zh' ? zh : en, [language]);

  const resetVisibleState = useCallback(() => {
    setLoading(false);
    setAnalysisProgress({ current: 0, total: 0 });
    if (mountedRef.current) {
      setIsRunning(false);
      isPausedRef.current = false;
      setIsPaused(false);
      setProgress({ current: 0, total: 0 });
    }
  }, [setAnalysisProgress, setLoading]);

  useEffect(() => () => {
    mountedRef.current = false;
    optimizerRef.current?.abort();
    optimizerRef.current = null;
    isRunningRef.current = false;
    isPausedRef.current = false;
    stopRequestedRef.current = false;
    setLoading(false);
    setAnalysisProgress({ current: 0, total: 0 });
  }, [setAnalysisProgress, setLoading]);

  const pause = useCallback(() => {
    const optimizer = optimizerRef.current;
    if (!isRunningRef.current || !optimizer || isPausedRef.current) return;
    optimizer.pause();
    isPausedRef.current = true;
    setIsPaused(true);
    console.log('Analysis paused');
  }, []);

  const resume = useCallback(() => {
    const optimizer = optimizerRef.current;
    if (!isRunningRef.current || !optimizer || !isPausedRef.current) return;
    optimizer.resume();
    isPausedRef.current = false;
    setIsPaused(false);
    console.log('Analysis resumed');
  }, []);

  const requestStop = useCallback(async () => {
    if (!isRunningRef.current) return false;

    const confirmed = await confirm(
      t('停止AI分析', 'Stop AI Analysis'),
      t('确定要停止 AI 分析吗？已分析的结果将会保存。', 'Are you sure you want to stop AI analysis? Analyzed results will be saved.'),
      { type: 'warning' },
    );
    if (!confirmed || !isRunningRef.current) return false;

    stopRequestedRef.current = true;
    optimizerRef.current?.abort();
    isPausedRef.current = false;
    if (mountedRef.current) {
      setIsPaused(false);
    }
    console.log('Stop requested by user');
    return true;
  }, [confirm, t]);

  const run = useCallback(async ({
    repositories,
    scope,
    syncOnComplete,
  }: RunRepositoryAnalysisOptions) => {
    if (isRunningRef.current) return false;

    if (!githubToken) {
      toast(language === 'zh' ? 'GitHub token 未找到，请重新登录。' : 'GitHub token not found. Please login again.', 'error');
      return false;
    }

    const activeConfig = aiConfigs.find((config) => config.id === activeAIConfig);
    if (!activeConfig) {
      toast(language === 'zh' ? '请先在设置中配置AI服务。' : 'Please configure AI service in settings first.', 'error');
      return false;
    }

    if (scope !== 'selected' && (activeConfig.apiKeyStatus === 'decrypt_failed' || activeConfig.apiKeyStatus === 'empty')) {
      toast(language === 'zh' ? 'AI服务的API密钥无法解密或为空，请在设置中重新输入并保存该配置。' : 'The AI service API key could not be decrypted or is empty. Please re-enter and save the configuration in settings.', 'error');
      return false;
    }

    if (scope !== 'selected' && (!activeConfig.baseUrl || !activeConfig.apiKey || !activeConfig.model)) {
      toast(language === 'zh' ? 'AI服务配置不完整，请检查API端点、密钥和模型名称。' : 'AI service configuration is incomplete. Please check the API endpoint, key, and model name.', 'error');
      return false;
    }

    if (repositories.length === 0) {
      const message = scope === 'failed'
        ? t('没有分析失败的仓库！', 'No failed repositories to re-analyze!')
        : scope === 'unanalyzed'
          ? t('所有仓库都已经分析过了！', 'All repositories have been analyzed!')
          : t('没有可分析的仓库！', 'No repositories to analyze!');
      toast(message, 'info');
      return false;
    }

    const actionText = scope === 'failed'
      ? (language === 'zh' ? '失败' : 'failed')
      : scope === 'unanalyzed'
        ? (language === 'zh' ? '未分析' : 'unanalyzed')
        : (language === 'zh' ? '全部' : 'all');
    const confirmationMessage = scope === 'selected'
      ? (language === 'zh'
        ? `将对 ${repositories.length} 个仓库进行 AI 分析，这可能需要几分钟时间。是否继续？`
        : `Will analyze ${repositories.length} repositories with AI. This may take several minutes. Continue?`)
      : (language === 'zh'
        ? `将对 ${repositories.length} 个${actionText}仓库进行AI分析，这可能需要几分钟时间。是否继续？`
        : `Will analyze ${repositories.length} ${actionText} repositories with AI. This may take several minutes. Continue?`);

    const confirmed = await confirm(
      t('AI分析确认', 'AI Analysis Confirmation'),
      confirmationMessage,
      { type: 'warning' },
    );
    if (!confirmed) return false;

    const optimizer = createOptimizer(activeConfig.concurrency, activeConfig.requestsPerMinute);
    optimizerRef.current = optimizer;
    stopRequestedRef.current = false;
    isPausedRef.current = false;
    isRunningRef.current = true;
    setLoading(true);
    setAnalysisProgress({ current: 0, total: repositories.length });
    if (mountedRef.current) {
      setIsRunning(true);
      setIsPaused(false);
      setProgress({ current: 0, total: repositories.length });
    }

    let successCount = 0;
    let failedCount = 0;

    try {
      const githubApi = new GitHubApiService(githubToken);
      const aiService = new AIService(activeConfig, language);
      const categoryNames = allCategories.filter((category) => category.id !== 'all').map((category) => category.name);
      const aiCategoryHints = buildCategoryHints(allCategories);
      const onResult = (result: AnalysisResult) => {
        if (!mountedRef.current || optimizerRef.current !== optimizer) return;

        if (result.success) {
          const resolvedCategory = resolveCategoryAssignment(
            { ...result.repo, ai_summary: result.summary },
            result.tags || [],
            allCategories,
          );
          const wasCategoryLocked = !!result.repo.category_locked;
          updateRepository(applyAnalysisSuccess(result.repo, {
            summary: result.summary,
            tags: result.tags,
            platforms: result.platforms,
            category: resolvedCategory,
            categoryLocked: wasCategoryLocked,
            analyzedAt: new Date().toISOString(),
          }));
          successCount += 1;
          return;
        }

        updateRepository(applyAnalysisFailure(result.repo, {
          analyzedAt: new Date().toISOString(),
          error: result.error?.message || undefined,
        }));
        failedCount += 1;
      };

      await optimizer.analyzeRepositoriesPipelined(
        repositories,
        githubApi,
        aiService,
        categoryNames,
        aiCategoryHints,
        (current, total, currentConcurrency) => {
          if (!mountedRef.current || optimizerRef.current !== optimizer) return;
          setAnalysisProgress({ current, total });
          setProgress({ current, total });
          console.log(`AI Analysis Progress: ${current}/${total}, Concurrency: ${currentConcurrency}`);
        },
        onResult,
      );

      const stats = optimizer.getStats();
      console.log('AI Analysis Stats:', stats);
      if (syncOnComplete) {
        await forceSyncToBackend();
      }

      if (scope === 'selected') {
        toast(
          language === 'zh'
            ? `成功分析 ${successCount} 个仓库，失败 ${failedCount} 个 (平均响应: ${stats.averageResponseTime}ms)`
            : `Successfully analyzed ${successCount} repositories, ${failedCount} failed (avg: ${stats.averageResponseTime}ms)`,
          failedCount > 0 ? 'error' : 'success',
        );
      } else {
        toast(
          stopRequestedRef.current
            ? (language === 'zh'
              ? `AI分析已停止！成功: ${successCount}, 失败: ${failedCount}`
              : `AI analysis stopped! Success: ${successCount}, Failed: ${failedCount}`)
            : (language === 'zh'
              ? `AI分析完成！成功: ${successCount}, 失败: ${failedCount} (平均响应: ${stats.averageResponseTime}ms)`
              : `AI analysis completed! Success: ${successCount}, Failed: ${failedCount} (avg: ${stats.averageResponseTime}ms)`),
          'success',
        );
      }
      return true;
    } catch (error) {
      console.error(scope === 'selected' ? 'Bulk AI analysis failed:' : 'AI analysis failed:', error);
      toast(
        scope === 'selected'
          ? (language === 'zh' ? '批量AI分析失败' : 'Bulk AI analysis failed')
          : (language === 'zh' ? 'AI分析失败，请检查AI配置和网络连接。' : 'AI analysis failed. Please check AI configuration and network connection.'),
        'error',
      );
      return false;
    } finally {
      if (optimizerRef.current === optimizer) {
        optimizerRef.current = null;
        isRunningRef.current = false;
        stopRequestedRef.current = false;
        resetVisibleState();
      }
    }
  }, [aiConfigs, activeAIConfig, allCategories, confirm, githubToken, language, resetVisibleState, setAnalysisProgress, setLoading, t, toast, updateRepository]);

  return useMemo(() => ({
    run,
    pause,
    resume,
    requestStop,
    isRunning,
    isPaused,
    progress,
  }), [isPaused, isRunning, pause, progress, requestStop, resume, run]);
};
