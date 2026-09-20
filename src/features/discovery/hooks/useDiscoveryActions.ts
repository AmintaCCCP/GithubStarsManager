import { useT } from "../../../i18n/useT";
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { DiscoveryChannelId, DiscoveryRepo, PaginatedDiscoveryRepositories } from '../../../types';
import { useAppStore } from '../../../store/useAppStore';
import { selectDiscoveryViewState } from '../../../store/selectors';
import { GitHubApiService } from '../../../services/githubApi';
import { syncWeeklyChannel } from '../../../services/weeklyIssuesService';
import { syncXTweetChannel } from '../../../services/xTweetService';
import { syncTelegramChannel } from '../../../services/telegramService';
import { AIService } from '../../../services/aiService';
import { AIAnalysisOptimizer } from '../../../services/aiAnalysisOptimizer';
import { discoveryAnalysisStorage } from '../../../services/discoveryAnalysisStorage';
import { buildCategoryHints, resolveCategoryAssignment } from '../../../utils/categoryUtils';
import { getAllCategories } from '../../../store/useAppStore';
import { useDialog } from '../../../hooks/useDialog';
import { useAuthSessionGeneration } from '../../../hooks/useAuthSessionGeneration';

const getChannelRequestSignature = (state: ReturnType<typeof selectDiscoveryViewState>, channelId: DiscoveryChannelId) => {
  const common = [state.githubToken, state.discoveryPlatform];
  switch (channelId) {
    case 'trending': return JSON.stringify([...common, state.trendingTimeRange]);
    case 'topic': return JSON.stringify([...common, state.discoverySelectedTopic]);
    case 'search': return JSON.stringify([...common, state.discoverySearchQuery, state.discoveryLanguage, state.discoverySortBy, state.discoverySortOrder]);
    // 周刊过滤为客户端行为，但签名纳入 weeklyOnlyCollected 以便切换过滤器时重跑入口重建切片
    case 'weekly': return JSON.stringify([...common, state.weeklyOnlyCollected]);
    // 关注列表/鉴权变化会改变抓取范围，纳入签名作废旧请求
    // （修订号区分"不同 Cookie 之间的切换"，布尔值做不到）
    case 'x-tweet': return JSON.stringify([...common, state.xTweetFollows, state.xTweetAuth !== null, state.xTweetAuthRevision]);
    case 'telegram': return JSON.stringify([...common, state.telegramFollows]);
    default: return JSON.stringify(common);
  }
};

/**
 * Owns network-backed Discovery loading and AI analysis. UI scrolling and view
 * composition remain in DiscoveryView, while stale topic response protection
 * and all service construction stay in this feature boundary.
 */
export const useDiscoveryActions = (scrollContainerRef: RefObject<HTMLDivElement | null>) => {
  const state = useAppStore(useShallow(selectDiscoveryViewState));
  const { toast } = useDialog();
  const { setAnalysisProgress } = state;
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const optimizerRef = useRef<AIAnalysisOptimizer | null>(null);
  const channelRequestVersionRef = useRef<Partial<Record<DiscoveryChannelId, number>>>({});
  const channelLoadingVersionRef = useRef<Record<string, number>>({});
  const latestStateRef = useRef(state);
  const authSessionIdentity = useAppStore(current => `${current.githubToken ?? ''}\u0000${current.user?.id ?? ''}\u0000${current.user?.login ?? ''}`);
  const { captureSession, isCurrentSession } = useAuthSessionGeneration(authSessionIdentity);
  useEffect(() => {
    latestStateRef.current = state;
  }, [state]);
  useEffect(() => {
    setIsAnalyzing(false);
    setAnalysisProgress({ current: 0, total: 0 });
    // 账号切换后旧会话的周刊/推文/频道同步进度不再属于当前页面，直接清空
    useAppStore.getState().setWeeklySyncStatus(null);
    useAppStore.getState().setXTweetSyncStatus(null);
    useAppStore.getState().setTelegramSyncStatus(null);
    return () => {
      optimizerRef.current?.abort();
      optimizerRef.current = null;
    };
  }, [authSessionIdentity, setAnalysisProgress]);
  const t = useT('discovery');
  const tRef = useRef(t);
  useEffect(() => {
    // 提交完成后同步引用，避免渲染期副作用
    tRef.current = t;
  }, [t]);

  const refreshChannel = useCallback(async (channelId: DiscoveryChannelId, page = 1, append = false) => {
    const currentState = latestStateRef.current;
    if (!currentState.githubToken) {
      toast(tRef.current('useDiscoveryActions.github-token-not-found-please-login-again'), 'error');
      return;
    }
    const requestVersion = (channelRequestVersionRef.current[channelId] ?? 0) + 1;
    channelRequestVersionRef.current[channelId] = requestVersion;
    const loadingKey = `${channelId}:${append ? 'append' : 'initial'}`;
    channelLoadingVersionRef.current[loadingKey] = requestVersion;
    const requestSession = captureSession();
    const requestSignature = getChannelRequestSignature(currentState, channelId);
    const isCurrentRequest = () => channelRequestVersionRef.current[channelId] === requestVersion
      && isCurrentSession(requestSession)
      && getChannelRequestSignature(useAppStore.getState(), channelId) === requestSignature;
    const ownsLoading = () => channelLoadingVersionRef.current[loadingKey] === requestVersion;

    if (append) {
      currentState.setDiscoveryLoadingMore(channelId, true);
      currentState.setDiscoveryLoadMoreError(channelId, null);
    } else {
      currentState.setDiscoveryLoading(channelId, true);
    }
    try {
      const api = new GitHubApiService(currentState.githubToken);
      let result: PaginatedDiscoveryRepositories;
      switch (channelId) {
        case 'trending':
          result = await api.getTrendingRepositories(currentState.discoveryPlatform, page, 20, currentState.trendingTimeRange);
          break;
        case 'hot-release':
          result = await api.getHotReleaseRepositories(currentState.discoveryPlatform, page);
          break;
        case 'most-popular':
          result = await api.getMostPopular(currentState.discoveryPlatform, page);
          break;
        case 'topic':
          result = currentState.discoverySelectedTopic
            ? await api.getTopicRepositories(currentState.discoverySelectedTopic, currentState.discoveryPlatform, page)
            : await api.getTrendingRepositories(currentState.discoveryPlatform, page);
          break;
        case 'search':
          result = currentState.discoverySearchQuery.trim()
            ? await api.searchRepositories(currentState.discoverySearchQuery, currentState.discoveryPlatform, currentState.discoveryLanguage, currentState.discoverySortBy, currentState.discoverySortOrder, page)
            : { repos: [], hasMore: false, nextPageIndex: page + 1, totalCount: 0 };
          break;
        case 'weekly':
          // 新请求开始即清掉旧状态：缓存命中时 syncWeeklyChannel 不会回调 onStatus，
          // 不清会残留上一轮的进度文案
          useAppStore.getState().setWeeklySyncStatus(null);
          result = await syncWeeklyChannel(
            api,
            page,
            currentState.weeklyOnlyCollected,
            // 只有当前请求有权写进度，避免切换账号/过滤器后旧任务覆盖新页面的状态
            (status) => {
              if (isCurrentRequest()) {
                useAppStore.getState().setWeeklySyncStatus(status);
              }
            },
          );
          break;
        case 'x-tweet':
          useAppStore.getState().setXTweetSyncStatus(null);
          result = await syncXTweetChannel(
            api,
            page,
            currentState.xTweetFollows,
            (status) => {
              if (isCurrentRequest()) {
                useAppStore.getState().setXTweetSyncStatus(status);
              }
            },
            undefined,
            currentState.xTweetAuth,
          );
          break;
        case 'telegram':
          useAppStore.getState().setTelegramSyncStatus(null);
          result = await syncTelegramChannel(
            api,
            page,
            currentState.telegramFollows,
            (status) => {
              if (isCurrentRequest()) {
                useAppStore.getState().setTelegramSyncStatus(status);
              }
            },
          );
          break;
        default:
          result = { repos: [], hasMore: false, nextPageIndex: page + 1, totalCount: 0 };
      }
      if (!isCurrentRequest()) return;
      const current = useAppStore.getState();
      const previousCount = current.discoveryRepos[channelId]?.length ?? 0;
      const currentRepos = current.discoveryRepos[channelId] || [];
      const persistedAnalyses = await discoveryAnalysisStorage.loadAllAnalyses();
      if (!isCurrentRequest()) return;
      const mergedRepos = result.repos.map((newRepo) => {
        const existing = currentRepos.find(item => item.id === newRepo.id);
        const analysis = existing?.analyzed_at ? existing : persistedAnalyses.get(newRepo.id);
        return analysis?.analyzed_at ? {
          ...newRepo,
          ai_summary: analysis.ai_summary,
          ai_tags: analysis.ai_tags,
          ai_platforms: analysis.ai_platforms,
          analyzed_at: analysis.analyzed_at,
          analysis_failed: analysis.analysis_failed,
          analysis_error: analysis.analysis_error,
        } : newRepo;
      });
      // x-tweet/telegram 每页返回累积前缀切片（服务按页整体重建窗口），加载
      // 更多时用替换语义写入，否则加深拉取新增的卡片落进已消费窗口内永远补不到
      const replacesOnAppend = channelId === 'x-tweet' || channelId === 'telegram';
      if (append && !replacesOnAppend) currentState.appendDiscoveryRepos(channelId, mergedRepos);
      else currentState.setDiscoveryRepos(channelId, mergedRepos);
      currentState.setDiscoveryHasMore(channelId, result.hasMore);
      currentState.setDiscoveryNextPage(channelId, result.nextPageIndex);
      if (result.totalCount !== undefined) currentState.setDiscoveryTotalCount(channelId, result.totalCount);
      currentState.setDiscoveryLastRefresh(channelId, new Date().toISOString());
      if (append && !replacesOnAppend && scrollContainerRef.current) {
        requestAnimationFrame(() => {
          const cards = scrollContainerRef.current?.querySelectorAll('[data-repo-index]');
          const target = cards?.[previousCount] as HTMLElement | undefined;
          target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      }
    } catch (error) {
      if (!isCurrentRequest()) return;
      console.error(`Failed to refresh channel ${channelId}:`, error);
      if (append) {
        currentState.setDiscoveryLoadMoreError(channelId, tRef.current('useDiscoveryActions.failed-to-load-more-please-retry'));
      } else {
        const errorMsg = error instanceof Error ? error.message : '';
        if (channelId === 'x-tweet') {
          toast(errorMsg ? `${tRef.current('useDiscoveryActions.failed-to-fetch-x-tweets')}: ${errorMsg}` : tRef.current('useDiscoveryActions.failed-to-fetch-x-tweets-please-check-your-netwo'), 'error');
        } else if (channelId === 'telegram') {
          toast(errorMsg ? `${tRef.current('useDiscoveryActions.failed-to-fetch-telegram-messages')}: ${errorMsg}` : tRef.current('useDiscoveryActions.failed-to-fetch-telegram-messages-please-check-y'), 'error');
        } else {
          toast(errorMsg || tRef.current('useDiscoveryActions.failed-to-fetch-data-please-check-your-network-c'), 'error');
        }
      }
    } finally {
      if (channelId === 'weekly' && isCurrentRequest()) {
        useAppStore.getState().setWeeklySyncStatus(null);
      }
      if (channelId === 'x-tweet' && isCurrentRequest()) {
        useAppStore.getState().setXTweetSyncStatus(null);
      }
      if (channelId === 'telegram' && isCurrentRequest()) {
        useAppStore.getState().setTelegramSyncStatus(null);
      }
      if (ownsLoading()) {
        if (append) currentState.setDiscoveryLoadingMore(channelId, false);
        else currentState.setDiscoveryLoading(channelId, false);
      }
    }
  }, [captureSession, isCurrentSession, scrollContainerRef, toast]);

  const handleAnalyzePage = useCallback(async () => {
    const analysisState = latestStateRef.current;
    if (!analysisState.githubToken) return;
    const activeConfig = analysisState.aiConfigs.find(config => config.id === analysisState.activeAIConfig);
    if (!activeConfig) {
      toast(t('useDiscoveryActions.please-configure-ai-service-in-settings-first'), 'error');
      return;
    }
    if (activeConfig.apiKeyStatus === 'decrypt_failed' || activeConfig.apiKeyStatus === 'empty' || !activeConfig.baseUrl || !activeConfig.apiKey || !activeConfig.model) {
      toast(t('useDiscoveryActions.ai-service-configuration-is-incomplete-please-ch'), 'error');
      return;
    }
    const pageRepos = analysisState.discoveryRepos[analysisState.selectedDiscoveryChannel] || [];
    const unanalyzed = pageRepos.filter(repo => !repo.analyzed_at || repo.analysis_failed);
    if (unanalyzed.length === 0) {
      toast(t('useDiscoveryActions.all-loaded-projects-have-been-analyzed'), 'info');
      return;
    }

    const analysisSession = captureSession();
    setIsAnalyzing(true);
    const current = useAppStore.getState();
    const categories = getAllCategories(current.customCategories, current.language, current.hiddenDefaultCategoryIds, current.defaultCategoryOverrides);
    const categoryNames = [
      ...current.customCategories.map(category => category.name),
      ...(analysisState.language === 'zh'
        ? ['全部分类', 'Web应用', '移动应用', '桌面应用', '数据库', 'AI/机器学习', '开发工具', '安全工具', '游戏', '设计工具', '效率工具', '教育学习', '社交网络', '数据分析']
        : ['All', 'Web Apps', 'Mobile Apps', 'Desktop Apps', 'Database', 'AI/ML', 'Dev Tools', 'Security Tools', 'Games', 'Design Tools', 'Productivity', 'Education', 'Social Networks', 'Data Analysis']),
    ];
    const optimizer = new AIAnalysisOptimizer({
      initialConcurrency: activeConfig.concurrency || 3,
      rateLimiter: { maxConcurrency: 0, requestsPerMinute: activeConfig.requestsPerMinute || 0 },
    });
    optimizerRef.current = optimizer;
    analysisState.setAnalysisProgress({ current: 0, total: unanalyzed.length });
    try {
      const api = new GitHubApiService(analysisState.githubToken);
      const service = new AIService(activeConfig, analysisState.language);
      const readmeCache = await optimizer.prefetchReadmes(unanalyzed, api);
      if (optimizer.isAborted() || !isCurrentSession(analysisSession)) return;
      const results = await optimizer.analyzeRepositories(
        unanalyzed,
        readmeCache,
        service,
        categoryNames,
        buildCategoryHints(current.customCategories),
        (progressCurrent, total) => {
          if (!optimizer.isAborted() && isCurrentSession(analysisSession)) {
            analysisState.setAnalysisProgress({ current: progressCurrent, total });
          }
        },
        result => {
          if (optimizer.isAborted() || !isCurrentSession(analysisSession) || !result.repo) return;
          const analyzedAt = new Date().toISOString();
          if (result.success) {
            const updatedRepo: DiscoveryRepo = {
              ...result.repo,
              rank: 0,
              channel: analysisState.selectedDiscoveryChannel,
              platform: analysisState.discoveryPlatform,
              ai_summary: result.summary,
              ai_tags: result.tags,
              ai_platforms: result.platforms,
              custom_category: resolveCategoryAssignment({ ...result.repo, ai_summary: result.summary }, result.tags || [], categories),
              category_locked: !!result.repo.category_locked,
              analyzed_at: analyzedAt,
              analysis_failed: false,
              analysis_error: undefined,
            };
            analysisState.updateDiscoveryRepo(updatedRepo);
            void discoveryAnalysisStorage.saveAnalysis(updatedRepo.id, { ai_summary: result.summary, ai_tags: result.tags, ai_platforms: result.platforms, analyzed_at: analyzedAt, analysis_failed: false, analysis_error: undefined });
          } else {
            const failedRepo: DiscoveryRepo = { ...result.repo, rank: 0, channel: analysisState.selectedDiscoveryChannel, platform: analysisState.discoveryPlatform, analyzed_at: analyzedAt, analysis_failed: true, analysis_error: result.error?.message || undefined };
            analysisState.updateDiscoveryRepo(failedRepo);
            void discoveryAnalysisStorage.saveAnalysis(failedRepo.id, { analyzed_at: analyzedAt, analysis_failed: true, analysis_error: failedRepo.analysis_error });
          }
        },
      );
      if (optimizer.isAborted() || !isCurrentSession(analysisSession)) return;
      const successCount = results.filter(result => result.success).length;
      const failCount = results.length - successCount;
      toast(t(failCount > 0 ? 'useDiscoveryActions.ai-analysis-complete-with-failures' : 'useDiscoveryActions.ai-analysis-complete', { successCount: successCount, failCount: failCount }), successCount === 0 ? 'error' : failCount > 0 ? 'info' : 'success');
    } catch (error) {
      if (optimizer.isAborted() || !isCurrentSession(analysisSession)) return;
      console.error('AI analysis error:', error);
      toast(t('useDiscoveryActions.ai-analysis-failed-please-check-your-ai-configur'), 'error');
    } finally {
      if (optimizerRef.current === optimizer) optimizerRef.current = null;
      if (isCurrentSession(analysisSession)) {
        setIsAnalyzing(false);
        analysisState.setAnalysisProgress({ current: 0, total: 0 });
      }
    }
  }, [captureSession, isCurrentSession, t, toast]);

  const handleAbortAnalysis = useCallback(() => {
    optimizerRef.current?.abort();
  }, []);

  return { ...state, t, isAnalyzing, refreshChannel, handleAnalyzePage, handleAbortAnalysis };
};
