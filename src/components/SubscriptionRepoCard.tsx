import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Star, StarOff, ExternalLink, Bot, GitFork, Sparkles, BookOpen, AlertTriangle } from 'lucide-react';
import { getPlatformIcon as getSharedPlatformIcon } from './platformMeta';
import type { DiscoveryRepo } from '../types';
import { useAppStore, getAllCategories } from '../store/useAppStore';
import { analyzeRepository, createFailedAnalysisResult } from '../services/aiAnalysisHelper';
import { forceSyncToBackend } from '../services/autoSync';
import { GitHubApiService } from '../services/githubApi';
import { ReadmeModal } from './ReadmeModal';
import { Modal } from './Modal';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { useDialog } from '../hooks/useDialog';
import { Button } from './ui/button';

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

  const { toast } = useDialog();

  const t = useCallback((zh: string, en: string) => language === 'zh' ? zh : en, [language]);

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
    return 'bg-muted dark:bg-muted/40 text-muted-foreground dark:text-muted-foreground';
  }, []);

  // 平台图标统一由 platformMeta 模块提供
  const getPlatformIcon = (platform: string) => {
    const Icon = getSharedPlatformIcon(platform);
    return <Icon className="w-3 h-3" />;
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
      toast(errorMessage, 'error');
    } finally {
      setIsStarring(false);
      setPendingUnstarAction(null);
    }
  }, [githubToken, repo, repositories, deleteRepository, t, toast]);

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
  }, [githubToken, isStarring, repo, onStar, t, toast, isStarred, addRepository, executeUnstar]);

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

      const updatedRepo: DiscoveryRepo = {
        ...repo,
        ai_summary: result.summary,
        ai_tags: result.tags,
        ai_platforms: result.platforms,
        analyzed_at: result.analyzed_at,
        analysis_failed: result.analysis_failed,
        analysis_error: undefined,
      };
      updateDiscoveryRepo(updatedRepo);
      
      if (onAnalyze) {
        onAnalyze(updatedRepo);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        console.error('AI analysis error:', error);
        const errorMsg = error instanceof Error && error.message
          ? error.message
          : t('AI分析失败，请检查AI配置和网络连接', 'AI analysis failed, please check AI configuration and network connection');
        const failedResult = createFailedAnalysisResult(errorMsg);
        const failedRepo: DiscoveryRepo = {
          ...repo,
          analyzed_at: failedResult.analyzed_at,
          analysis_failed: failedResult.analysis_failed,
          analysis_error: failedResult.analysis_error,
        };
        updateDiscoveryRepo(failedRepo);
        toast(t('AI分析失败，请检查AI配置。', 'AI analysis failed. Please check your AI configuration.'), 'error');
      }
    } finally {
      if (!controller.signal.aborted) {
        setIsAnalyzing(false);
      }
    }
  }, [githubToken, aiConfigs, activeAIConfig, language, repo, isAnalyzing, customCategories, updateDiscoveryRepo, onAnalyze, t, toast]);

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
      className="ui-card p-5 transition-all duration-200 cursor-pointer"
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
              <span className="font-semibold text-foreground dark:text-foreground truncate">
                {cardTitle}
              </span>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
              {/* AI Analyze button */}
              <Button
                size="icon"
                onClick={handleAnalyze}
                disabled={!githubToken || isAnalyzing}
                className="flex items-center justify-center w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-muted text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50 disabled:cursor-not-allowed"
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
              </Button>

              {/* ZRead button - hidden on small screens */}
              <Button
                size="icon"
                onClick={handleOpenInZRead}
                className="hidden sm:flex items-center justify-center w-8 h-8 rounded-lg bg-muted text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                title={t('在ZRead打开', 'Open in ZRead')}
              >
                <BookOpen className="w-4 h-4" />
              </Button>

              {/* GitHub button - hidden on small screens */}
              <a
                href={repo.html_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => event.stopPropagation()}
                className="hidden sm:flex items-center justify-center w-8 h-8 rounded-lg bg-muted text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                title={t('在GitHub打开', 'Open on GitHub')}
              >
                <ExternalLink className="w-4 h-4" />
              </a>

              {/* Star button */}
              <Button
                size="icon"
                onClick={handleStar}
                disabled={!githubToken || isStarring}
                className={`flex items-center justify-center w-7 h-7 sm:w-8 sm:h-8 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  isStarred
                    ? 'bg-primary text-primary-foreground shadow-sm dark:bg-primary/80 dark:text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                }`}
                title={isStarred ? t('取消Star', 'Unstar') : t('添加Star', 'Add Star')}
              >
                {isStarring ? (
                  <div className="w-3.5 h-3.5 sm:w-4 sm:h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : isStarred ? (
                  <StarOff className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                ) : (
                  <Star className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                )}
              </Button>
            </div>
          </div>

          {/* Description */}
          {repo.description && (
            <Popover>
              <Tooltip>
                <TooltipTrigger asChild>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      onClick={(event) => event.stopPropagation()}
                      className="relative mb-3 block w-full cursor-text text-left"
                    >
                      <span className="block text-sm text-muted-foreground dark:text-muted-foreground line-clamp-2 rounded px-1 -mx-1 hover:bg-accent/50 dark:hover:bg-card/[0.02] transition-colors duration-200">
                        {repo.description}
                      </span>
                    </button>
                  </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent side="top" align="start" className="max-w-lg whitespace-pre-wrap break-words">
                  {repo.description}
                </TooltipContent>
              </Tooltip>
              <PopoverContent side="top" align="start" className="max-w-lg whitespace-pre-wrap break-words" onClick={(event) => event.stopPropagation()}>
                {repo.description}
              </PopoverContent>
            </Popover>
          )}

          {/* AI Summary */}
          {repo.ai_summary && (
            <Popover>
              <Tooltip>
                <TooltipTrigger asChild>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      onClick={(event) => event.stopPropagation()}
                      className="relative mb-3 flex w-full cursor-text items-start gap-1.5 text-left"
                    >
                      <Bot className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground dark:text-muted-foreground" aria-hidden="true" />
                      <span className="block text-sm text-muted-foreground dark:text-muted-foreground line-clamp-2 rounded px-1 -mx-1 hover:bg-accent/50 dark:hover:bg-card/[0.02] transition-colors duration-200">
                        {repo.ai_summary}
                      </span>
                    </button>
                  </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent side="top" align="start" className="max-w-lg whitespace-pre-wrap break-words">
                  {repo.ai_summary}
                </TooltipContent>
              </Tooltip>
              <PopoverContent side="top" align="start" className="max-w-lg whitespace-pre-wrap break-words" onClick={(event) => event.stopPropagation()}>
                {repo.ai_summary}
              </PopoverContent>
            </Popover>
          )}

          {/* Tags */}
          {((repo.ai_tags && repo.ai_tags.length > 0) || (repo.topics && repo.topics.length > 0)) && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {(repo.ai_tags || repo.topics || []).slice(0, 5).map((tag) => (
                <span
                  key={tag}
                  className="px-2 py-0.5 rounded-md text-xs font-medium bg-muted text-muted-foreground dark:text-muted-foreground dark:bg-primary/20"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Platform icons */}
          {repo.ai_platforms && repo.ai_platforms.length > 0 && (
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs text-muted-foreground dark:text-muted-foreground">
                {t('平台:', 'Platforms:')}
              </span>
              <div className="flex items-center gap-1">
                {repo.ai_platforms.slice(0, 5).map((platform) => (
                  <span key={platform} className="text-muted-foreground dark:text-muted-foreground" title={platform}>
                    {getPlatformIcon(platform)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Stats */}
          <div className="flex items-center gap-4 text-sm text-muted-foreground dark:text-muted-foreground">
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
        <div className="flex items-center gap-3 text-muted-foreground dark:text-muted-foreground ">
          <AlertTriangle className="w-8 h-8 flex-shrink-0" />
          <p className="text-sm text-muted-foreground dark:text-muted-foreground">
            {language === 'zh' 
              ? `确定要取消 Star "${repo.full_name}" 吗？这将会从您的 GitHub 收藏中移除该仓库。`
              : `Are you sure you want to unstar "${repo.full_name}"? This will remove the repository from your GitHub stars.`}
          </p>
        </div>
        <div className="flex gap-3 justify-end">
          <Button
            onClick={() => {
              setUnstarConfirmOpen(false);
              setPendingUnstarAction(null);
            }}
            variant="ghost"
            className="px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground dark:text-muted-foreground hover:bg-muted dark:hover:bg-accent transition-colors"
          >
            {t('取消', 'Cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              setUnstarConfirmOpen(false);
              if (pendingUnstarAction) {
                pendingUnstarAction();
              }
            }}
            className="rounded-lg px-4 py-2 text-sm font-medium"
          >
            {t('确认取消', 'Confirm Unstar')}
          </Button>
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
