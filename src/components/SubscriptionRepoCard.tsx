import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Star, ExternalLink, Bot, GitFork, Monitor, Smartphone, Globe, Terminal, Package, Sparkles, BookOpen, AlertTriangle } from 'lucide-react';
import type { DiscoveryRepo } from '../types';
import { useAppStore, getAllCategories } from '../store/useAppStore';
import { analyzeRepository, createFailedAnalysisResult } from '../services/aiAnalysisHelper';
import { forceSyncToBackend } from '../services/autoSync';
import { GitHubApiService } from '../services/githubApi';
import { ReadmeModal } from './ReadmeModal';
import { Modal } from './Modal';

interface SubscriptionRepoCardProps {
  repo: DiscoveryRepo;
  onStar?: (repo: DiscoveryRepo) => void;
  onAnalyze?: (repo: DiscoveryRepo) => void;
  desktopSafeMode?: boolean;
}

export const SubscriptionRepoCard: React.FC<SubscriptionRepoCardProps> = ({ repo, onStar, onAnalyze, desktopSafeMode = false }) => {
  const language = useAppStore(state => state.language);
  const githubToken = useAppStore(state => state.githubToken);
  const aiConfigs = useAppStore(state => state.aiConfigs);
  const activeAIConfig = useAppStore(state => state.activeAIConfig);
  const customCategories = useAppStore(state => state.customCategories);
  const updateDiscoveryRepo = useAppStore(state => state.updateDiscoveryRepo);
  const repositories = useAppStore(state => state.repositories);
  const addRepository = useAppStore(state => state.addRepository);
  const deleteRepository = useAppStore(state => state.deleteRepository);
  
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

  const [isStarring, setIsStarring] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [readmeModalOpen, setReadmeModalOpen] = useState(false);
  // 本地乐观状态，用于立即反映Star操作结果
  const [optimisticStarred, setOptimisticStarred] = useState<boolean | null>(null);
  // 取消Star确认对话框状态
  const [unstarConfirmOpen, setUnstarConfirmOpen] = useState(false);
  const [pendingUnstarAction, setPendingUnstarAction] = useState<(() => void) | null>(null);

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

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const languageColors = useMemo(() => ({
    JavaScript: '#f1e05a', TypeScript: '#3178c6', Python: '#3572A5',
    Java: '#b07219', 'C++': '#f34b7d', C: '#555555', 'C#': '#239120',
    Go: '#00ADD8', Rust: '#dea584', PHP: '#4F5D95', Ruby: '#701516',
    Swift: '#fa7343', Kotlin: '#A97BFF', Dart: '#00B4AB',
    Shell: '#89e051', HTML: '#e34c26', CSS: '#1572B6',
  }), []);

  const getLanguageColor = (lang: string | null) => {
    return languageColors[lang as keyof typeof languageColors] || '#6b7280';
  };

  const rankBadgeClass = useMemo(() => {
    if (repo.rank === 1) return 'bg-gray-100 dark:bg-white/[0.04] text-gray-700 dark:text-text-secondary ';
    if (repo.rank === 2) return 'bg-gray-300 text-gray-900 dark:bg-gray-400 dark:text-text-primary';
    if (repo.rank === 3) return 'bg-gray-100 dark:bg-white/[0.04] text-white dark:text-text-primary';
    return 'bg-light-surface text-gray-700 dark:bg-white/[0.04] dark:text-text-secondary';
  }, [repo.rank]);

  const platformIconMap = useMemo(() => ({
    mac: <Monitor className="w-3 h-3" />, 
    macos: <Monitor className="w-3 h-3" />, 
    ios: <Smartphone className="w-3 h-3" />, 
    windows: <Monitor className="w-3 h-3" />, 
    win: <Monitor className="w-3 h-3" />,
    linux: <Monitor className="w-3 h-3" />, 
    android: <Smartphone className="w-3 h-3" />, 
    web: <Globe className="w-3 h-3" />, 
    cli: <Terminal className="w-3 h-3" />, 
    docker: <Package className="w-3 h-3" />,
  }), []);

  const getPlatformIcon = (platform: string) => {
    return platformIconMap[platform.toLowerCase() as keyof typeof platformIconMap] || <Monitor className="w-3 h-3" />;
  };

  // 执行取消Star操作
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
      alert(errorMessage);
    } finally {
      setIsStarring(false);
      setPendingUnstarAction(null);
    }
  }, [githubToken, repo, repositories, deleteRepository, t]);

  // 处理添加/取消Star
  const handleStar = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!githubToken || isStarring) return;

    if (isStarred) {
      // 取消Star - 显示自定义确认对话框
      setPendingUnstarAction(() => executeUnstar);
      setUnstarConfirmOpen(true);
      return;
    }
    
    // 添加Star
    setIsStarring(true);
    
    try {
      const githubApi = new GitHubApiService(githubToken);
      const [owner, name] = repo.full_name.split('/');
      
      // 乐观更新：立即更新UI状态
      setOptimisticStarred(true);
      
      await githubApi.starRepository(owner, name);
      
      // 将DiscoveryRepo转换为Repository并添加到本地，保留AI分析结果
      const repositoryToAdd = {
        ...repo,
        // 移除Discovery/Subscription特有的字段
        rank: undefined,
        channel: undefined,
        platform: undefined,
        // 添加Star时间
        starred_at: new Date().toISOString(),
      };
      
      addRepository(repositoryToAdd);
      
      if (onStar) {
        onStar(repo);
      }
      
      await forceSyncToBackend();
      
      // 操作成功，清除乐观状态
      setOptimisticStarred(null);
      
      alert(t('已成功添加 Star', 'Successfully starred'));
    } catch (error) {
      // 操作失败，回滚乐观状态
      setOptimisticStarred(null);
      console.error('Failed to star repository:', error);
      const errorMessage = t('Star 操作失败，请检查网络连接或 GitHub Token 权限。', 'Failed to star repository. Please check your network connection or GitHub Token permissions.');
      alert(errorMessage);
    } finally {
      setIsStarring(false);
    }
  }, [githubToken, isStarring, repo, onStar, t, isStarred, addRepository, executeUnstar]);

  // 处理在ZRead打开
  const handleOpenInZRead = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const zreadUrl = `https://zread.ai/${repo.full_name}`;
    window.open(zreadUrl, '_blank');
  }, [repo.full_name]);

  // 处理单个项目AI分析
  const handleAnalyze = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (!githubToken) {
      alert(t('GitHub Token 未找到，请重新登录。', 'GitHub token not found. Please login again.'));
      return;
    }

    const activeConfig = aiConfigs.find(c => c.id === activeAIConfig);
    if (!activeConfig) {
      alert(t('请先在设置中配置AI服务。', 'Please configure AI service in settings first.'));
      return;
    }

    if (activeConfig.apiKeyStatus === 'decrypt_failed') {
      alert(t('AI服务的API密钥无法解密，请在设置中重新输入并保存该配置。', 'The AI service API key could not be decrypted. Please re-enter and save the configuration in settings.'));
      return;
    }

    if (!activeConfig.baseUrl || !activeConfig.apiKey || !activeConfig.model) {
      alert(t('AI服务配置不完整，请检查API端点、密钥和模型名称。', 'AI service configuration is incomplete. Please check the API endpoint, key, and model name.'));
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

      const updatedRepo: DiscoveryRepo = {
        ...repo,
        ai_summary: result.summary,
        ai_tags: result.tags,
        ai_platforms: result.platforms,
        analyzed_at: result.analyzed_at,
        analysis_failed: result.analysis_failed,
      };
      updateDiscoveryRepo(updatedRepo);
      
      if (onAnalyze) {
        onAnalyze(updatedRepo);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        console.error('AI analysis error:', error);
        const failedResult = createFailedAnalysisResult();
        const failedRepo: DiscoveryRepo = {
          ...repo,
          analyzed_at: failedResult.analyzed_at,
          analysis_failed: failedResult.analysis_failed,
        };
        updateDiscoveryRepo(failedRepo);
        alert(t('AI分析失败，请检查AI配置。', 'AI analysis failed. Please check your AI configuration.'));
      }
    } finally {
      if (!controller.signal.aborted) {
        setIsAnalyzing(false);
      }
    }
  }, [githubToken, aiConfigs, activeAIConfig, language, repo, isAnalyzing, customCategories, updateDiscoveryRepo, onAnalyze, t]);

  // 判断是否已分析
  const isAnalyzed = !!repo.analyzed_at && !repo.analysis_failed;
  const isFailed = !!repo.analysis_failed;

  // 点击卡片打开 README
  const handleCardClick = useCallback(() => {
    setReadmeModalOpen(true);
  }, []);

  const cardTitle = repo.full_name || `${repo.owner?.login || ''}/${repo.name || ''}`;

  return (
    <>
    <div 
      onClick={handleCardClick}
      className={`bg-white dark:bg-panel-dark border border-black/[0.06] dark:border-white/[0.04] p-5 transition-all duration-200 ${
        desktopSafeMode
          ? 'rounded-lg hover:shadow-md hover:border-black/[0.06] dark:border-white/[0.04] dark:hover:border-black/[0.06] dark:border-white/[0.04] hover:-translate-y-0.5 cursor-pointer'
          : 'rounded-xl hover:shadow-lg hover:border-black/[0.06] dark:border-white/[0.04] dark:hover:border-black/[0.06] dark:border-white/[0.04] hover:-translate-y-0.5 cursor-pointer'
      }`}
      style={{ userSelect: 'none' }}
      onCopy={(e) => e.preventDefault()}
      onCut={(e) => e.preventDefault()}
      onSelect={(e) => e.preventDefault()}
    >
      <div className="flex items-start gap-3 sm:gap-4">
        {/* Rank badge */}
        <div className={`flex-shrink-0 w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center font-bold text-sm sm:text-lg ${rankBadgeClass}`}>
          {repo.rank}
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="flex items-center gap-2 min-w-0">
              {!desktopSafeMode && repo.owner?.avatar_url && (
                <img
                  src={repo.owner.avatar_url}
                  alt={repo.owner.login}
                  className="w-6 h-6 rounded-full flex-shrink-0"
                />
              )}
              <span className="font-semibold text-gray-900 dark:text-text-primary truncate">
                {cardTitle}
              </span>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
              {/* AI Analyze button */}
              <button
                onClick={handleAnalyze}
                disabled={!githubToken || isAnalyzing}
                className={`flex items-center justify-center w-7 h-7 sm:w-8 sm:h-8 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  isAnalyzed
                    ? 'bg-gray-100 text-gray-700 dark:bg-white/[0.04] dark:text-text-secondary hover:bg-gray-200 hover:text-gray-900 dark:hover:bg-white/[0.08] dark:hover:text-text-primary'
                    : isFailed
                    ? 'bg-gray-100 text-gray-700 dark:bg-white/[0.04] dark:text-text-secondary hover:bg-gray-200 hover:text-gray-900 dark:hover:bg-white/[0.08] dark:hover:text-text-primary'
                    : 'bg-gray-100 text-gray-700 dark:bg-white/[0.04] dark:text-text-secondary hover:bg-gray-200 hover:text-gray-900 dark:hover:bg-white/[0.08] dark:hover:text-text-primary'
                }`}
                title={
                  isAnalyzed 
                    ? t('重新分析', 'Re-analyze') 
                    : isFailed 
                    ? t('重新分析', 'Re-analyze')
                    : t('AI分析', 'AI Analyze')
                }
              >
                {isAnalyzing ? (
                  <div className="w-3.5 h-3.5 sm:w-4 sm:h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : isAnalyzed ? (
                  <Sparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                ) : (
                  <Bot className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                )}
              </button>

              {/* ZRead button - hidden on small screens */}
              <button
                onClick={handleOpenInZRead}
                className="hidden sm:flex items-center justify-center w-8 h-8 rounded-lg bg-gray-100 text-gray-700 dark:bg-white/[0.04] dark:text-text-secondary hover:bg-gray-200 hover:text-gray-900 dark:hover:bg-white/[0.08] dark:hover:text-text-primary transition-colors"
                title={t('在ZRead打开', 'Open in ZRead')}
              >
                <BookOpen className="w-4 h-4" />
              </button>

              {/* GitHub button - hidden on small screens */}
              <a
                href={repo.html_url}
                target="_blank"
                rel="noopener noreferrer"
                className="hidden sm:flex items-center justify-center w-8 h-8 rounded-lg bg-gray-100 text-gray-700 dark:bg-white/[0.04] dark:text-text-secondary hover:bg-gray-200 hover:text-gray-900 dark:hover:bg-white/[0.08] dark:hover:text-text-primary transition-colors"
                title={t('在GitHub打开', 'Open on GitHub')}
              >
                <ExternalLink className="w-4 h-4" />
              </a>

              {/* Star button */}
              <button
                onClick={handleStar}
                disabled={!githubToken || isStarring}
                className={`flex items-center justify-center w-7 h-7 sm:w-8 sm:h-8 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  isStarred
                    ? 'bg-gray-100 dark:bg-white/[0.04] text-gray-700 dark:text-text-secondary hover:bg-gray-100 dark:bg-white/[0.04] dark:hover:bg-gray-100 dark:bg-white/[0.04]'
                    : 'bg-light-surfacetext-gray-500 dark:bg-white/[0.04] dark:text-text-tertiary hover:bg-gray-100 dark:bg-white/[0.04] hover:text-gray-700 dark:text-text-secondary dark:hover:bg-gray-100 dark:bg-white/[0.04] dark:hover:text-gray-700 dark:text-text-secondary'
                }`}
                title={isStarred ? t('取消Star', 'Unstar') : t('添加Star', 'Add Star')}
              >
                {isStarring ? (
                  <div className="w-3.5 h-3.5 sm:w-4 sm:h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : isStarred ? (
                  <Star className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="currentColor" />
                ) : (
                  <Star className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                )}
              </button>
            </div>
          </div>

          {/* Description */}
          {repo.description && (
            <p className="text-sm text-gray-700 dark:text-text-tertiary mb-3 line-clamp-2">
              {repo.description}
            </p>
          )}

          {/* AI Summary */}
          {repo.ai_summary && (
            <div className="flex items-start gap-1.5 mb-3">
              <Bot className="w-4 h-4 text-gray-700 dark:text-text-secondary flex-shrink-0 mt-0.5" />
              <p className="text-sm text-gray-700 dark:text-text-secondary line-clamp-2">
                {repo.ai_summary}
              </p>
            </div>
          )}

          {/* Tags */}
          {((repo.ai_tags && repo.ai_tags.length > 0) || (repo.topics && repo.topics.length > 0)) && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {(repo.ai_tags || repo.topics || []).slice(0, 5).map((tag) => (
                <span
                  key={tag}
                  className="px-2 py-0.5 rounded-md text-xs font-medium bg-gray-100 dark:bg-white/[0.04] text-gray-700 dark:text-text-secondary dark:bg-brand-indigo/20/30 "
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Platform icons */}
          {repo.ai_platforms && repo.ai_platforms.length > 0 && (
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs text-gray-400 dark:text-text-tertiary">
                {t('平台:', 'Platforms:')}
              </span>
              <div className="flex items-center gap-1">
                {repo.ai_platforms.slice(0, 5).map((platform) => (
                  <span key={platform} className="text-gray-500 dark:text-text-tertiary" title={platform}>
                    {getPlatformIcon(platform)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Stats */}
          <div className="flex items-center gap-4 text-sm text-gray-500 dark:text-text-tertiary">
            {repo.language && (
              <div className="flex items-center gap-1">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: getLanguageColor(repo.language) }}
                />
                <span className="truncate max-w-20">{repo.language}</span>
              </div>
            )}
            <div className="flex items-center gap-1">
              <Star className="w-4 h-4" />
              <span>{formatNumber(repo.stargazers_count)}</span>
            </div>
            <div className="flex items-center gap-1">
              <GitFork className="w-4 h-4" />
              <span>{formatNumber(repo.forks_count ?? repo.forks ?? 0)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    {/* Unstar Confirm Modal */}
    <Modal
      isOpen={unstarConfirmOpen}
      onClose={() => {
        setUnstarConfirmOpen(false);
        setPendingUnstarAction(null);
      }}
      title={t('确认取消 Star', 'Confirm Unstar')}
      maxWidth="max-w-sm"
    >
      <div className="space-y-4">
        <div className="flex items-center gap-3 text-gray-700 dark:text-text-secondary ">
          <AlertTriangle className="w-8 h-8 flex-shrink-0" />
          <p className="text-sm text-gray-700 dark:text-text-tertiary">
            {language === 'zh' 
              ? `确定要取消 Star "${repo.full_name}" 吗？这将会从您的 GitHub 收藏中移除该仓库。`
              : `Are you sure you want to unstar "${repo.full_name}"? This will remove the repository from your GitHub stars.`}
          </p>
        </div>
        <div className="flex gap-3 justify-end">
          <button
            onClick={() => {
              setUnstarConfirmOpen(false);
              setPendingUnstarAction(null);
            }}
            className="px-4 py-2 rounded-lg text-sm font-medium text-gray-700 dark:text-text-tertiary hover:bg-light-surface dark:hover:bg-white/10 transition-colors"
          >
            {t('取消', 'Cancel')}
          </button>
          <button
            onClick={() => {
              setUnstarConfirmOpen(false);
              if (pendingUnstarAction) {
                pendingUnstarAction();
              }
            }}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-100 dark:bg-white/[0.04] text-white hover:bg-gray-100 dark:bg-white/[0.04] transition-colors"
          >
            {t('确认取消', 'Confirm Unstar')}
          </button>
        </div>
      </div>
    </Modal>

    {/* README Modal */}
      <ReadmeModal
        isOpen={readmeModalOpen}
        onClose={() => setReadmeModalOpen(false)}
        repository={repo} />
    </>
  );
};
