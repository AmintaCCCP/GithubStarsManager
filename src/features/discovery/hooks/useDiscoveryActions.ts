import { useCallback, useRef, useState, type RefObject } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { DiscoveryChannelId, DiscoveryRepo } from '../../../types';
import { useAppStore } from '../../../store/useAppStore';
import { selectDiscoveryViewState } from '../../../store/selectors';
import { GitHubApiService } from '../../../services/githubApi';
import { AIService } from '../../../services/aiService';
import { AIAnalysisOptimizer } from '../../../services/aiAnalysisOptimizer';
import { discoveryAnalysisStorage } from '../../../services/discoveryAnalysisStorage';
import { buildCategoryHints, resolveCategoryAssignment } from '../../../utils/categoryUtils';
import { getAllCategories } from '../../../store/useAppStore';
import { useDialog } from '../../../hooks/useDialog';

/**
 * Owns network-backed Discovery loading and AI analysis. UI scrolling and view
 * composition remain in DiscoveryView, while stale topic response protection
 * and all service construction stay in this feature boundary.
 */
export const useDiscoveryActions = (scrollContainerRef: RefObject<HTMLDivElement | null>) => {
  const state = useAppStore(useShallow(selectDiscoveryViewState));
  const { toast } = useDialog();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const optimizerRef = useRef<AIAnalysisOptimizer | null>(null);
  const topicRequestVersionRef = useRef(0);
  const latestStateRef = useRef(state);
  latestStateRef.current = state;
  const t = useCallback((zh: string, en: string) => state.language === 'zh' ? zh : en, [state.language]);

  const refreshChannel = useCallback(async (channelId: DiscoveryChannelId, page = 1, append = false) => {
    const currentState = latestStateRef.current;
    if (!currentState.githubToken) {
      toast(t('GitHub Token 未找到，请重新登录。', 'GitHub token not found. Please login again.'), 'error');
      return;
    }
    const topicRequestVersion = channelId === 'topic' ? ++topicRequestVersionRef.current : null;
    const topicRequestSelection = channelId === 'topic'
      ? { topic: currentState.discoverySelectedTopic, platform: currentState.discoveryPlatform }
      : null;
    const isCurrentTopicRequest = () => {
      if (topicRequestVersion === null) return true;
      const current = useAppStore.getState();
      return topicRequestVersionRef.current === topicRequestVersion
        && current.discoverySelectedTopic === topicRequestSelection?.topic
        && current.discoveryPlatform === topicRequestSelection?.platform;
    };
    const ownsTopicLoading = () => topicRequestVersion === null || topicRequestVersionRef.current === topicRequestVersion;

    if (append) {
      currentState.setDiscoveryLoadingMore(channelId, true);
      currentState.setDiscoveryLoadMoreError(channelId, null);
    } else {
      currentState.setDiscoveryLoading(channelId, true);
    }
    try {
      const api = new GitHubApiService(currentState.githubToken);
      let result;
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
        default:
          result = { repos: [], hasMore: false, nextPageIndex: page + 1, totalCount: 0 };
      }
      if (!isCurrentTopicRequest()) return;
      const current = useAppStore.getState();
      const previousCount = current.discoveryRepos[channelId]?.length ?? 0;
      const currentRepos = current.discoveryRepos[channelId] || [];
      const persistedAnalyses = await discoveryAnalysisStorage.loadAllAnalyses();
      if (!isCurrentTopicRequest()) return;
      const mergedRepos = result.repos.map((newRepo: DiscoveryRepo) => {
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
      if (append) currentState.appendDiscoveryRepos(channelId, mergedRepos);
      else currentState.setDiscoveryRepos(channelId, mergedRepos);
      currentState.setDiscoveryHasMore(channelId, result.hasMore);
      currentState.setDiscoveryNextPage(channelId, result.nextPageIndex);
      if (result.totalCount !== undefined) currentState.setDiscoveryTotalCount(channelId, result.totalCount);
      currentState.setDiscoveryLastRefresh(channelId, new Date().toISOString());
      if (append && scrollContainerRef.current) {
        requestAnimationFrame(() => {
          const cards = scrollContainerRef.current?.querySelectorAll('[data-repo-index]');
          const target = cards?.[previousCount] as HTMLElement | undefined;
          target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      }
    } catch (error) {
      if (!isCurrentTopicRequest()) return;
      console.error(`Failed to refresh channel ${channelId}:`, error);
      if (append) currentState.setDiscoveryLoadMoreError(channelId, t('加载更多失败，请重试', 'Failed to load more, please retry'));
      else toast(t('获取数据失败，请检查网络连接或GitHub Token。', 'Failed to fetch data. Please check your network connection or GitHub Token.'), 'error');
    } finally {
      if (append) currentState.setDiscoveryLoadingMore(channelId, false);
      else if (ownsTopicLoading()) currentState.setDiscoveryLoading(channelId, false);
    }
  }, [scrollContainerRef, t, toast]);

  const handleAnalyzePage = useCallback(async () => {
    if (!state.githubToken) return;
    const activeConfig = state.aiConfigs.find(config => config.id === state.activeAIConfig);
    if (!activeConfig) {
      toast(t('请先在设置中配置AI服务。', 'Please configure AI service in settings first.'), 'error');
      return;
    }
    if (activeConfig.apiKeyStatus === 'decrypt_failed' || activeConfig.apiKeyStatus === 'empty' || !activeConfig.baseUrl || !activeConfig.apiKey || !activeConfig.model) {
      toast(t('AI服务配置不完整，请检查API端点、密钥和模型名称。', 'AI service configuration is incomplete. Please check the API endpoint, key, and model name.'), 'error');
      return;
    }
    const pageRepos = state.discoveryRepos[state.selectedDiscoveryChannel] || [];
    const unanalyzed = pageRepos.filter(repo => !repo.analyzed_at || repo.analysis_failed);
    if (unanalyzed.length === 0) {
      toast(t('已加载的所有项目均已完成AI分析。', 'All loaded projects have been analyzed.'), 'info');
      return;
    }

    setIsAnalyzing(true);
    const current = useAppStore.getState();
    const categories = getAllCategories(current.customCategories, current.language, current.hiddenDefaultCategoryIds, current.defaultCategoryOverrides);
    const categoryNames = [
      ...current.customCategories.map(category => category.name),
      ...(state.language === 'zh'
        ? ['全部分类', 'Web应用', '移动应用', '桌面应用', '数据库', 'AI/机器学习', '开发工具', '安全工具', '游戏', '设计工具', '效率工具', '教育学习', '社交网络', '数据分析']
        : ['All', 'Web Apps', 'Mobile Apps', 'Desktop Apps', 'Database', 'AI/ML', 'Dev Tools', 'Security Tools', 'Games', 'Design Tools', 'Productivity', 'Education', 'Social Networks', 'Data Analysis']),
    ];
    const optimizer = new AIAnalysisOptimizer({
      initialConcurrency: activeConfig.concurrency || 3,
      rateLimiter: { maxConcurrency: 0, requestsPerMinute: activeConfig.requestsPerMinute || 0 },
    });
    optimizerRef.current = optimizer;
    state.setAnalysisProgress({ current: 0, total: unanalyzed.length });
    try {
      const api = new GitHubApiService(state.githubToken);
      const service = new AIService(activeConfig, state.language);
      const readmeCache = await optimizer.prefetchReadmes(unanalyzed, api);
      if (optimizer.isAborted()) return;
      const results = await optimizer.analyzeRepositories(
        unanalyzed,
        readmeCache,
        service,
        categoryNames,
        buildCategoryHints(current.customCategories),
        (progressCurrent, total) => state.setAnalysisProgress({ current: progressCurrent, total }),
        result => {
          if (!result.repo) return;
          const analyzedAt = new Date().toISOString();
          if (result.success) {
            const updatedRepo: DiscoveryRepo = {
              ...result.repo,
              rank: 0,
              channel: state.selectedDiscoveryChannel,
              platform: state.discoveryPlatform,
              ai_summary: result.summary,
              ai_tags: result.tags,
              ai_platforms: result.platforms,
              custom_category: resolveCategoryAssignment({ ...result.repo, ai_summary: result.summary }, result.tags || [], categories),
              category_locked: !!result.repo.category_locked,
              analyzed_at: analyzedAt,
              analysis_failed: false,
              analysis_error: undefined,
            };
            state.updateDiscoveryRepo(updatedRepo);
            void discoveryAnalysisStorage.saveAnalysis(updatedRepo.id, { ai_summary: result.summary, ai_tags: result.tags, ai_platforms: result.platforms, analyzed_at: analyzedAt, analysis_failed: false, analysis_error: undefined });
          } else {
            const failedRepo: DiscoveryRepo = { ...result.repo, rank: 0, channel: state.selectedDiscoveryChannel, platform: state.discoveryPlatform, analyzed_at: analyzedAt, analysis_failed: true, analysis_error: result.error?.message || undefined };
            state.updateDiscoveryRepo(failedRepo);
            void discoveryAnalysisStorage.saveAnalysis(failedRepo.id, { analyzed_at: analyzedAt, analysis_failed: true, analysis_error: failedRepo.analysis_error });
          }
        },
      );
      const successCount = results.filter(result => result.success).length;
      const failCount = results.length - successCount;
      toast(t(`AI分析完成！成功 ${successCount} 个${failCount > 0 ? `，失败 ${failCount} 个` : ''}`, `AI analysis complete! ${successCount} succeeded${failCount > 0 ? `, ${failCount} failed` : ''}`), successCount === 0 ? 'error' : failCount > 0 ? 'info' : 'success');
    } catch (error) {
      console.error('AI analysis error:', error);
      toast(t('AI分析失败，请检查AI配置。', 'AI analysis failed. Please check your AI configuration.'), 'error');
    } finally {
      optimizerRef.current = null;
      setIsAnalyzing(false);
      state.setAnalysisProgress({ current: 0, total: 0 });
    }
  }, [state, t, toast]);

  const handleAbortAnalysis = useCallback(() => {
    optimizerRef.current?.abort();
  }, []);

  return { ...state, t, isAnalyzing, refreshChannel, handleAnalyzePage, handleAbortAnalysis };
};
