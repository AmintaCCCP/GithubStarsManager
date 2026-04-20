import React, { useState, useCallback, useMemo } from 'react';
import { RefreshCw, TrendingUp, Bot, Loader2 } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { GitHubApiService } from '../services/githubApi';
import { AIService } from '../services/aiService';
import { AIAnalysisOptimizer } from '../services/aiAnalysisOptimizer';
import { backend } from '../services/backendAdapter';
import { resolveCategoryAssignment } from '../utils/categoryUtils';
import { SubscriptionSidebar } from './SubscriptionSidebar';
import { SubscriptionRepoCard } from './SubscriptionRepoCard';
import { SubscriptionDevCard } from './SubscriptionDevCard';
import type { SubscriptionChannelId, SubscriptionRepo, SubscriptionDev, Repository } from '../types';

export const SubscriptionView: React.FC = React.memo(() => {
  const {
    githubToken,
    language,
    subscriptionChannels,
    subscriptionRepos,
    subscriptionDevs,
    subscriptionLastRefresh,
    subscriptionIsLoading,
    selectedSubscriptionChannel,
    setSelectedSubscriptionChannel,
    setSubscriptionLoading,
    setSubscriptionRepos,
    setSubscriptionDevs,
    setSubscriptionLastRefresh,
    updateSubscriptionRepo,
    updateSubscriptionDev,
    aiConfigs,
    activeAIConfig,
    analysisProgress,
    setAnalysisProgress,
  } = useAppStore();

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisOptimizer, setAnalysisOptimizer] = useState<AIAnalysisOptimizer | null>(null);

  const t = useCallback((zh: string, en: string) => language === 'zh' ? zh : en, [language]);

  const normalizedChannel = (selectedSubscriptionChannel === 'daily-dev' ? 'most-dev' : selectedSubscriptionChannel) as SubscriptionChannelId;

  const currentRepos = useMemo(
    () => (subscriptionRepos && subscriptionRepos[normalizedChannel]) || [],
    [subscriptionRepos, normalizedChannel]
  );

  const currentLastRefresh = subscriptionLastRefresh?.[normalizedChannel] ?? null;
  const currentIsLoading = subscriptionIsLoading?.[normalizedChannel] ?? false;

  const refreshChannel = useCallback(async (channelId: SubscriptionChannelId) => {
    if (!githubToken) {
      alert(t('GitHub Token 未找到，请重新登录。', 'GitHub token not found. Please login again.'));
      return;
    }

    const normalizedId = channelId === 'daily-dev' ? 'most-dev' : channelId;
    setSubscriptionLoading(normalizedId, true);
    try {
      const githubApi = new GitHubApiService(githubToken);
      if (normalizedId === 'most-stars') { const repos = await githubApi.searchMostStars(10); setSubscriptionRepos('most-stars', repos); } else if (normalizedId === 'most-forks') { const repos = await githubApi.searchMostForks(10); setSubscriptionRepos('most-forks', repos); } else if (normalizedId === 'most-dev') { const devs = await githubApi.searchDailyDevs(10); setSubscriptionDevs(devs); } else if (normalizedId === 'trending') { const repos = await githubApi.searchTrending(25); setSubscriptionRepos('trending', repos); }
      setSubscriptionLastRefresh(normalizedId, new Date().toISOString());
    } catch (err) {
      console.error(`Failed to refresh subscription channel ${channelId}:`, err);
      alert(t(`刷新失败，请检查网络连接。错误：${err instanceof Error ? err.message : String(err)}`, `Failed to refresh: ${err instanceof Error ? err.message : String(err)}`));
    } finally {
      setSubscriptionLoading(normalizedId, false);
    }
  }, [githubToken, t, setSubscriptionLoading, setSubscriptionRepos, setSubscriptionDevs, setSubscriptionLastRefresh]);

  const refreshAll = useCallback(async () => {
    const enabledChannels = subscriptionChannels.filter(ch => ch.enabled);
    for (const channel of enabledChannels) {
      await refreshChannel(channel.id);
    }
  }, [subscriptionChannels, refreshChannel]);

  const formatLastRefresh = useCallback((timestamp: string | null) => {
    if (!timestamp) return t('从未刷新', 'Never');
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / (1000 * 60));
    if (diffMin < 1) return t('刚刚', 'Just now');
    if (diffMin < 60) return t(`${diffMin}分钟前`, `${diffMin}m ago`);
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return t(`${diffHours}小时前`, `${diffHours}h ago`);
    return date.toLocaleDateString();
  }, [t]);

  const handleAnalyzeChannel = useCallback(async (channelId: SubscriptionChannelId) => {
    if (!githubToken) return;

    const activeConfig = aiConfigs.find(c => c.id === activeAIConfig);
    if (!activeConfig) {
      alert(t('请先在设置中配置AI服务。', 'Please configure AI service in settings first.'));
      return;
    }

    let targets: SubscriptionRepo[] = [];
    const normalizedId = channelId === 'daily-dev' ? 'most-dev' : channelId;
    if (normalizedId === 'most-dev') {
      targets = (subscriptionDevs || [])
        .filter((d: SubscriptionDev) => d.topRepo)
        .map((d: SubscriptionDev) => d.topRepo!);
    } else {
      targets = subscriptionRepos[channelId] || [];
    }

    const unanalyzed = targets.filter(
      (r: SubscriptionRepo) => !r.analyzed_at || r.analysis_failed
    );
    if (unanalyzed.length === 0) {
      alert(t('此频道所有项目已完成AI分析。', 'All projects in this channel have been analyzed.'));
      return;
    }

    setIsAnalyzing(true);
    const allCategories = useAppStore
      .getState()
      .customCategories.map(c => c.name);
    const categoryNames = [
      ...allCategories,
      '全部分类', 'Web应用', '移动应用', '桌面应用', '数据库',
      'AI/机器学习', '开发工具', '安全工具', '游戏', '设计工具',
      '效率工具', '教育学习', '社交网络', '数据分析',
    ];

    const githubApi = new GitHubApiService(githubToken);
    const aiService = new AIService(activeConfig, language);
    const optimizer = new AIAnalysisOptimizer({
      initialConcurrency: activeConfig.concurrency || 3,
    });
    setAnalysisOptimizer(optimizer);

    setAnalysisProgress({ current: 0, total: unanalyzed.length });

    try {
      const readmeCache = await optimizer.prefetchReadmes(unanalyzed, githubApi);
      if (optimizer.isAborted()) return;

      const results = await optimizer.analyzeRepositories(
        unanalyzed,
        readmeCache,
        aiService,
        categoryNames,
        (current: number, total: number) => {
          setAnalysisProgress({ current, total });
        },
        (result) => {
          if (result.success && result.repo) {
            const updatedRepo: SubscriptionRepo = {
              ...result.repo,
              ai_summary: result.summary,
              ai_tags: result.tags,
              ai_platforms: result.platforms,
              analyzed_at: new Date().toISOString(),
              analysis_failed: false,
            };

            if (channelId === 'most-dev') {
              const dev = subscriptionDevs.find(
                (d: SubscriptionDev) => d.topRepo && d.topRepo.id === updatedRepo.id
              );
              if (dev) {
                updateSubscriptionDev({
                  ...dev,
                  topRepo: updatedRepo,
                });
              }
            } else {
              updateSubscriptionRepo(updatedRepo);
            }
          } else if (!result.success && result.repo) {
            const failedRepo: SubscriptionRepo = {
              ...result.repo,
              analyzed_at: new Date().toISOString(),
              analysis_failed: true,
            };
            if (channelId === 'most-dev') {
              const dev = subscriptionDevs.find(
                (d: SubscriptionDev) => d.topRepo && d.topRepo.id === failedRepo.id
              );
              if (dev) {
                updateSubscriptionDev({
                  ...dev,
                  topRepo: failedRepo,
                });
              }
            } else {
              updateSubscriptionRepo(failedRepo);
            }
          }
        }
      );

      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;
      alert(
        t(
          `AI分析完成！成功 ${successCount} 个${failCount > 0 ? `，失败 ${failCount} 个` : ''}`,
          `AI analysis complete! ${successCount} succeeded${failCount > 0 ? `, ${failCount} failed` : ''}`
        )
      );
    } catch (err) {
      console.error('AI analysis error:', err);
      alert(t('AI分析失败，请检查AI配置。', 'AI analysis failed. Please check your AI configuration.'));
    } finally {
      setIsAnalyzing(false);
      setAnalysisOptimizer(null);
      setAnalysisProgress({ current: 0, total: 0 });
    }
  }, [githubToken, aiConfigs, activeAIConfig, language, subscriptionRepos, subscriptionDevs, t, updateSubscriptionRepo, updateSubscriptionDev, setAnalysisProgress]);

  const handlePauseAnalysis = useCallback(() => {
    analysisOptimizer?.pause();
  }, [analysisOptimizer]);

  const handleResumeAnalysis = useCallback(() => {
    analysisOptimizer?.resume();
  }, [analysisOptimizer]);

  const handleAbortAnalysis = useCallback(() => {
    analysisOptimizer?.abort();
  }, [analysisOptimizer]);

  const isAnalyzingThisChannel = isAnalyzing && (
    analysisProgress.total > 0
  );

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
      <SubscriptionSidebar
        channels={subscriptionChannels}
        selectedChannel={selectedSubscriptionChannel}
        onChannelSelect={setSelectedSubscriptionChannel}
        onRefreshAll={refreshAll}
        isLoading={subscriptionIsLoading}
        lastRefresh={subscriptionLastRefresh}
        isAnalyzing={isAnalyzing}
      />

      <div className="flex-1 space-y-4">
        {/* Toolbar */}
        <div className="flex items-center justify-between bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-3">
            <TrendingUp className="w-5 h-5 text-blue-500" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              {subscriptionChannels.find(ch => ch.id === normalizedChannel)?.icon}{' '}
              {language === 'zh'
                ? subscriptionChannels.find(ch => ch.id === normalizedChannel)?.name
                : subscriptionChannels.find(ch => ch.id === normalizedChannel)?.nameEn}
            </h2>
            {currentLastRefresh && (
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {t('更新于', 'Updated')} {formatLastRefresh(currentLastRefresh)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isAnalyzingThisChannel && (
              <div className="flex items-center gap-2 mr-2">
                <div className="w-48 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                  <div
                    className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                    style={{
                      width: analysisProgress.total > 0
                        ? `${(analysisProgress.current / analysisProgress.total) * 100}%`
                        : '0%',
                    }}
                  />
                </div>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {analysisProgress.current}/{analysisProgress.total}
                </span>
                {analysisOptimizer && !analysisOptimizer.isPaused() && (
                  <button
                    onClick={handlePauseAnalysis}
                    className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                    title={t('暂停', 'Pause')}
                  >
                    <Loader2 className="w-4 h-4 animate-spin" />
                  </button>
                )}
                {analysisOptimizer && analysisOptimizer.isPaused() && (
                  <button
                    onClick={handleResumeAnalysis}
                    className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                    title={t('继续', 'Resume')}
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={handleAbortAnalysis}
                  className="p-1 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30"
                  title={t('停止', 'Stop')}
                >
                  ✕
                </button>
              </div>
            )}
            <button
              onClick={() => handleAnalyzeChannel(normalizedChannel)}
              disabled={isAnalyzing || currentIsLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title={t('AI分析此频道', 'Analyze this channel with AI')}
            >
              <Bot className="w-4 h-4" />
              {t('AI分析', 'AI Analyze')}
            </button>
            <button
              onClick={() => refreshChannel(normalizedChannel)}
              disabled={currentIsLoading || isAnalyzing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`w-4 h-4 ${currentIsLoading ? 'animate-spin' : ''}`} />
              {t('刷新', 'Refresh')}
            </button>
          </div>
        </div>

        {/* Content */}
        {currentIsLoading && currentRepos.length === 0 && normalizedChannel !== 'most-dev' && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-blue-500 mr-2" />
            <span className="text-gray-500 dark:text-gray-400">
              {t('加载中...', 'Loading...')}
            </span>
          </div>
        )}

        {currentIsLoading && subscriptionDevs.length === 0 && normalizedChannel === 'most-dev' && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-blue-500 mr-2" />
            <span className="text-gray-500 dark:text-gray-400">
              {t('加载中...', 'Loading...')}
            </span>
          </div>
        )}

        {!currentIsLoading && currentRepos.length === 0 && normalizedChannel !== 'most-dev' && (
          <div className="text-center py-12">
            <TrendingUp className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-gray-500 dark:text-gray-400 mb-2">
              {t('暂无数据，点击刷新按钮获取排行', 'No data yet. Click refresh to fetch rankings.')}
            </p>
          </div>
        )}

        {!currentIsLoading && subscriptionDevs.length === 0 && normalizedChannel === 'most-dev' && (
          <div className="text-center py-12">
            <TrendingUp className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-gray-500 dark:text-gray-400 mb-2">
              {t('暂无数据，点击刷新按钮获取排行', 'No data yet. Click refresh to fetch rankings.')}
            </p>
          </div>
        )}

        {normalizedChannel === 'most-dev' ? (
          <div className="space-y-4">
            {subscriptionDevs.map(dev => (
              <SubscriptionDevCard key={dev.login} dev={dev} />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {currentRepos.map(repo => (
              <SubscriptionRepoCard key={repo.id} repo={repo} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

SubscriptionView.displayName = 'SubscriptionView';