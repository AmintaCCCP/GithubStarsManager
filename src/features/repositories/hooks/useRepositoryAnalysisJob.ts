import { useT } from "../../../i18n/useT";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Category, Repository } from '../../../types';
import { useAppStore } from '../../../store/useAppStore';
import {
  getAccountSessionGeneration,
  isCurrentAccountSession,
  peekCurrentAccountId,
} from '../../../store/helpers/accountWorkspace';
import { useDialog } from '../../../hooks/useDialog';
import { AIAnalysisOptimizer, type AnalysisResult } from '../../../services/aiAnalysisOptimizer';
import { registerActiveAnalysisJobAbort } from './analysisJobRegistry';
import { AIService } from '../../../services/aiService';
import { createGitHubApiService } from '../../../services/githubApiFactory';
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
  } = useAppStore(useShallow((state) => ({
    githubToken: state.githubToken,
    aiConfigs: state.aiConfigs,
    activeAIConfig: state.activeAIConfig,
    language: state.language,
    updateRepository: state.updateRepository,
    setLoading: state.setLoading,
    setAnalysisProgress: state.setAnalysisProgress,
  })));

  const { toast, confirm } = useDialog();
  const optimizerRef = useRef<AIAnalysisOptimizer | null>(null);
  const isRunningRef = useRef(false);
  const isPausedRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const mountedRef = useRef(true);
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  const t = useT('repositories');

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

  // 释放当前任务（卸载 / 切号 / 后端恢复前中止共用，R12 finding 6）：
  // 中止优化器并复位本实例的运行标志，避免暂停中的旧任务残留 isRunning。
  const releaseActiveJob = useCallback(() => {
    optimizerRef.current?.abort();
    optimizerRef.current = null;
    isRunningRef.current = false;
    isPausedRef.current = false;
    stopRequestedRef.current = false;
    if (mountedRef.current) {
      setIsPaused(false);
      setIsRunning(false);
      setLoading(false);
      setAnalysisProgress({ current: 0, total: 0 });
      setProgress({ current: 0, total: 0 });
    }
  }, [setAnalysisProgress, setLoading]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      optimizerRef.current?.abort();
      optimizerRef.current = null;
      isRunningRef.current = false;
      isPausedRef.current = false;
      stopRequestedRef.current = false;
      setLoading(false);
      setAnalysisProgress({ current: 0, total: 0 });
    };
  }, [setAnalysisProgress, setLoading]);

  // R12 finding 6：候选后端恢复流程在提交候选连接前调用本登记表中止所有
  // 挂载中的分析任务——旧连接上的 README/仓库标识绝不能被发往候选后端。
  useEffect(() => registerActiveAnalysisJobAbort(releaseActiveJob), [releaseActiveJob]);

  // R2-C18：账号/凭据变化时主动释放旧优化器。切号后旧任务可能停在暂停/等待
  // 状态（不再收到 onResult），isRunningRef 残留 true 会阻塞新账号任务——不能
  // 等后续回调或用户手动恢复。订阅在切换的 Store 写入中同步触发（早于新账号
  // 启动任务），因此只清理旧任务，不影响新账号任务。
  useEffect(() => {
    // 测试桩（store 被整体 mock）可能没有 subscribe：保持旧契约，不监听切号。
    if (typeof useAppStore.subscribe !== 'function') return;
    let lastAccountId = peekCurrentAccountId();
    let lastGeneration = getAccountSessionGeneration();
    return useAppStore.subscribe(() => {
      const accountId = peekCurrentAccountId();
      const generation = getAccountSessionGeneration();
      if (accountId === lastAccountId && generation === lastGeneration) return;
      lastAccountId = accountId;
      lastGeneration = generation;
      // 审计修复：切号时立即复位 hook 返回的运行状态与进度——否则新账号
      // 在旧任务退出并执行 finally 之前会短暂看到 A 的 isRunning/progress。
      // finally 的会话检查保持不变：旧任务仍不得清掉 B 随后启动的任务状态。
      releaseActiveJob();
    });
  }, [releaseActiveJob]);

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
    const targetOptimizer = optimizerRef.current;
    if (!isRunningRef.current || !targetOptimizer) return false;

    const confirmed = await confirm(
      t('useRepositoryAnalysisJob.stop-ai-analysis'),
      t('useRepositoryAnalysisJob.are-you-sure-you-want-to-stop-ai-analysis-analyz'),
      { type: 'warning' },
    );
    if (!confirmed || !isRunningRef.current || optimizerRef.current !== targetOptimizer) return false;

    stopRequestedRef.current = true;
    targetOptimizer.abort();
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
    if (isRunningRef.current) {
      // 审计修复（C33）：运行锁被占用时给出明确提示而非静默 return false——
      // 典型场景是切号后旧任务尚未结束（清理路径会中止并复位运行状态），
      // 新账号立即重试即可启动。
      // R13 finding 69：占用运行锁的也可能是同账号的在途分析任务——提示应
      // 指向「分析任务正在运行」，让用户等待或停止当前任务，而非误报切号。
      toast(t('useRepositoryAnalysisJob.analysis-task-already-running'), 'error');
      return false;
    }

    if (!githubToken) {
      toast(t('useRepositoryAnalysisJob.github-token-not-found-please-login-again'), 'error');
      return false;
    }

    const activeConfig = aiConfigs.find((config) => config.id === activeAIConfig);
    if (!activeConfig) {
      toast(t('useRepositoryAnalysisJob.please-configure-ai-service-in-settings-first'), 'error');
      return false;
    }

    if (scope !== 'selected' && (activeConfig.apiKeyStatus === 'decrypt_failed' || activeConfig.apiKeyStatus === 'empty')) {
      toast(t('useRepositoryAnalysisJob.the-ai-service-api-key-could-not-be-decrypted-or'), 'error');
      return false;
    }

    if (scope !== 'selected' && (!activeConfig.baseUrl || !activeConfig.apiKey || !activeConfig.model)) {
      toast(t('useRepositoryAnalysisJob.ai-service-configuration-is-incomplete-please-ch'), 'error');
      return false;
    }

    if (repositories.length === 0) {
      const message = scope === 'failed'
        ? t('useRepositoryAnalysisJob.no-failed-repositories-to-re-analyze')
        : scope === 'unanalyzed'
          ? t('useRepositoryAnalysisJob.all-repositories-have-been-analyzed')
          : t('useRepositoryAnalysisJob.no-repositories-to-analyze');
      toast(message, 'info');
      return false;
    }

    const actionText = scope === 'failed'
      ? (t('useRepositoryAnalysisJob.failed'))
      : scope === 'unanalyzed'
        ? (t('useRepositoryAnalysisJob.unanalyzed'))
        : (t('useRepositoryAnalysisJob.all'));
    const confirmationMessage = scope === 'selected'
      ? (t('useRepositoryAnalysisJob.will-analyze-v1-repositories-with-ai-this-may-ta', { v1: repositories.length }))
      : (t('useRepositoryAnalysisJob.will-analyze-v1-actiontext-repositories-with-ai', { v1: repositories.length, actionText: actionText }));

    // 确认弹窗等待期间可能切号：在任何副作用（优化器/加载态/provider）之前
    // 捕获账号与会话代次，确认后立即复核。
    const jobAccountId = peekCurrentAccountId();
    const jobGeneration = getAccountSessionGeneration();
    const confirmed = await confirm(
      t('useRepositoryAnalysisJob.ai-analysis-confirmation'),
      confirmationMessage,
      { type: 'warning' },
    );
    if (!confirmed) return false;
    if (!isCurrentAccountSession(jobAccountId, jobGeneration)) return false;

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
      const githubApi = createGitHubApiService(githubToken);
      const aiService = new AIService(activeConfig, language);
      const categoryNames = allCategories.filter((category) => category.id !== 'all').map((category) => category.name);
      const aiCategoryHints = buildCategoryHints(allCategories);
      const onResult = (result: AnalysisResult) => {
        if (!mountedRef.current || optimizerRef.current !== optimizer) return;

        // 账号已切换：丢弃本条结果并中止后续分析队列，绝不写入新账号的活跃列表
        if (!isCurrentAccountSession(jobAccountId, jobGeneration)) {
          stopRequestedRef.current = true;
          // 审计修复（C33）：唤醒 + 中止——暂停等待中的优化器必须先 resume
          // 再 abort（abort 本身也会退出 waitWhilePaused 循环，resume 确保等待
          // 立即结束且不留下 paused 残留），否则旧任务可能卡在暂停等待，
          // isRunningRef 无法复位，新账号无法立即 run()。
          optimizer.resume();
          optimizer.abort();
          return;
        }

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
          // 切号后不得写入共享进度状态（旧任务的进度不能覆盖新账号视图）。
          if (!isCurrentAccountSession(jobAccountId, jobGeneration)) return;
          setAnalysisProgress({ current, total });
          setProgress({ current, total });
          console.log(`AI Analysis Progress: ${current}/${total}, Concurrency: ${currentConcurrency}`);
        },
        onResult,
      );

      const stats = optimizer.getStats();
      console.log('AI Analysis Stats:', stats);
      // 任务已被释放（后端恢复、卸载）或账号已切换（含 A→B→A）：不得同步或提示完成。
      if (optimizerRef.current !== optimizer || !isCurrentAccountSession(jobAccountId, jobGeneration)) return false;
      // R13 审计修复：推送失败（返回 false，未传 reportFailures 时不抛错）不得
      // 报告完整成功——分析结果已写入本地，仅单独提示后端同步未完成。
      let backendSynced = true;
      if (syncOnComplete) {
        backendSynced = await forceSyncToBackend();
      }
      if (optimizerRef.current !== optimizer || !isCurrentAccountSession(jobAccountId, jobGeneration)) return false;
      if (!backendSynced) {
        toast(t('app:repositorySlice.push-failed'), 'warning');
        return false;
      }

      if (scope === 'selected') {
        toast(
          t('useRepositoryAnalysisJob.successfully-analyzed-successcount-repositories', { successCount: successCount, failedCount: failedCount, v3: stats.averageResponseTime }),
          failedCount > 0 ? 'error' : 'success',
        );
      } else {
        toast(
          stopRequestedRef.current
            ? (t('useRepositoryAnalysisJob.ai-analysis-stopped-success-successcount-failed', { successCount: successCount, failedCount: failedCount }))
            : (t('useRepositoryAnalysisJob.ai-analysis-completed-success-successcount-faile', { successCount: successCount, failedCount: failedCount, v3: stats.averageResponseTime })),
          'success',
        );
      }
      return true;
    } catch (error) {
      console.error(scope === 'selected' ? 'Bulk AI analysis failed:' : 'AI analysis failed:', error);
      if (optimizerRef.current !== optimizer || !isCurrentAccountSession(jobAccountId, jobGeneration)) return false;
      toast(
        scope === 'selected'
          ? (t('useRepositoryAnalysisJob.bulk-ai-analysis-failed'))
          : (t('useRepositoryAnalysisJob.ai-analysis-failed-please-check-ai-configuration')),
        'error',
      );
      return false;
    } finally {
      // 审计修复（C32）：任务自身引用始终释放（仅当仍指向该任务）；共享状态
      // （loading/进度）只在任务仍持有优化器且归属当前会话时清理——切号或卸载
      // 释放后共享状态归新任务/新会话，旧任务不得清掉新任务的状态。
      const ownsActiveJob = optimizerRef.current === optimizer;
      if (ownsActiveJob) {
        optimizerRef.current = null;
        isRunningRef.current = false;
        stopRequestedRef.current = false;
      }
      if (ownsActiveJob && isCurrentAccountSession(jobAccountId, jobGeneration)) {
        resetVisibleState();
      } else if (mountedRef.current && !isRunningRef.current) {
        setIsRunning(false);
        isPausedRef.current = false;
        setIsPaused(false);
        setProgress({ current: 0, total: 0 });
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
