import React, { useState, useMemo, useCallback } from 'react';
import { Star, StarOff, ExternalLink, Bot, GitFork, Sparkles, BookOpen, AlertTriangle } from 'lucide-react';
import { getPlatformIcon as getSharedPlatformIcon } from './platformMeta';
import type { DiscoveryRepo } from '../types';
import { useAppStore } from '../store/useAppStore';
import { useDiscoveryRepoActions } from '../features/discovery/hooks/useDiscoveryRepoActions';
import { ReadmeModal } from './ReadmeModal';
import { Modal } from './Modal';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
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

  const t = useCallback((zh: string, en: string) => language === 'zh' ? zh : en, [language]);

  const { analyze, star, executeUnstar, isAnalyzing, isStarring, isStarred } =
    useDiscoveryRepoActions({ repo });

  const [readmeModalOpen, setReadmeModalOpen] = useState(false);
  // 取消Star确认对话框状态（确认 UI 留 View；动作本体在 useDiscoveryRepoActions）
  const [unstarConfirmOpen, setUnstarConfirmOpen] = useState(false);

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

  // 执行取消Star操作：确认 UI（自定义 Modal）留 View，动作本体在 hook。
  const confirmUnstar = () => {
    setUnstarConfirmOpen(false);
    void executeUnstar();
  };

  // 处理添加/取消Star：已 Star 时打开自定义确认 Modal，否则执行添加
  const handleStar = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!githubToken || isStarring) return;
    if (isStarred) {
      setUnstarConfirmOpen(true);
      return;
    }
    void star(onStar);
  };

  // 处理在ZRead打开
  const handleOpenInZRead = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const zreadUrl = `https://zread.ai/${repo.full_name}`;
    window.open(zreadUrl, '_blank');
  }, [repo.full_name]);

  // 处理单个项目AI分析（校验/中止/patch/toast 均在 hook）
  const handleAnalyze = (e: React.MouseEvent) => {
    e.stopPropagation();
    void analyze(onAnalyze);
  };

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
            }}
            variant="ghost"
            className="px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground dark:text-muted-foreground hover:bg-muted dark:hover:bg-accent transition-colors"
          >
            {t('取消', 'Cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={confirmUnstar}
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
