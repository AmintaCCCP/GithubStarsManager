import React, { useState, useMemo, useCallback } from 'react';
import { Star, ExternalLink, Bot, GitFork, Monitor, Smartphone, Globe, Terminal, Package, Bookmark, BookmarkCheck, Sparkles, BookOpen } from 'lucide-react';
import type { DiscoveryRepo } from '../types';
import { useAppStore, getAllCategories } from '../store/useAppStore';
import { analyzeRepository, createFailedAnalysisResult } from '../services/aiAnalysisHelper';
import { forceSyncToBackend } from '../services/autoSync';
import { GitHubApiService } from '../services/githubApi';
import { ReadmeModal } from './ReadmeModal';

interface SubscriptionRepoCardProps {
  repo: DiscoveryRepo;
  onStar?: (repo: DiscoveryRepo) => void;
  onAnalyze?: (repo: DiscoveryRepo) => void;
}

export const SubscriptionRepoCard: React.FC<SubscriptionRepoCardProps> = ({ repo, onStar, onAnalyze }) => {
  const language = useAppStore(state => state.language);
  const githubToken = useAppStore(state => state.githubToken);
  const aiConfigs = useAppStore(state => state.aiConfigs);
  const activeAIConfig = useAppStore(state => state.activeAIConfig);
  const customCategories = useAppStore(state => state.customCategories);
  const updateDiscoveryRepo = useAppStore(state => state.updateDiscoveryRepo);
  
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

  const [isStarring, setIsStarring] = useState(false);
  const [isStarred, setIsStarred] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [readmeModalOpen, setReadmeModalOpen] = useState(false);

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
    if (repo.rank === 1) return 'bg-yellow-400 text-yellow-900 dark:bg-yellow-500 dark:text-yellow-900';
    if (repo.rank === 2) return 'bg-gray-300 text-gray-700 dark:bg-gray-400 dark:text-gray-800';
    if (repo.rank === 3) return 'bg-amber-600 text-white dark:bg-amber-700 dark:text-white';
    return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300';
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

  // 处理添加Star
  const handleStar = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!githubToken || isStarring) return;

    setIsStarring(true);
    try {
      const githubApi = new GitHubApiService(githubToken);
      const [owner, name] = repo.full_name.split('/');
      await githubApi.starRepository(owner, name);
      setIsStarred(true);
      
      if (onStar) {
        onStar(repo);
      }
      
      await forceSyncToBackend();
    } catch (error) {
      console.error('Failed to star repository:', error);
      alert(t('Star 操作失败，请检查网络连接或 GitHub Token 权限。', 'Failed to star repository. Please check your network connection or GitHub Token permissions.'));
    } finally {
      setIsStarring(false);
    }
  }, [githubToken, isStarring, repo, onStar, t]);

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

    if (isAnalyzing) return;

    setIsAnalyzing(true);

    try {
      // 使用 store 中的工具函数合并分类，避免重复定义合并逻辑
      const allCategories = getAllCategories(customCategories, language);

      const result = await analyzeRepository({
        repository: repo,
        githubToken,
        aiConfig: activeConfig,
        language,
        categories: allCategories,
      });

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
      console.error('AI analysis error:', error);
      const failedResult = createFailedAnalysisResult();
      const failedRepo: DiscoveryRepo = {
        ...repo,
        analyzed_at: failedResult.analyzed_at,
        analysis_failed: failedResult.analysis_failed,
      };
      updateDiscoveryRepo(failedRepo);
      alert(t('AI分析失败，请检查AI配置。', 'AI analysis failed. Please check your AI configuration.'));
    } finally {
      setIsAnalyzing(false);
    }
  }, [githubToken, aiConfigs, activeAIConfig, language, repo, isAnalyzing, customCategories, updateDiscoveryRepo, onAnalyze, t]);

  // 判断是否已分析
  const isAnalyzed = !!repo.analyzed_at && !repo.analysis_failed;
  const isFailed = !!repo.analysis_failed;

  // 点击卡片打开 README
  const handleCardClick = useCallback(() => {
    setReadmeModalOpen(true);
  }, []);

  return (
    <>
    <div 
      onClick={handleCardClick}
      className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 hover:shadow-lg transition-shadow duration-200 hover:border-blue-300 dark:hover:border-blue-600 cursor-pointer"
    >
      <div className="flex items-start gap-4">
        {/* Rank badge */}
        <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg ${rankBadgeClass}`}>
          {repo.rank}
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="flex items-center gap-2 min-w-0">
              <img
                src={repo.owner.avatar_url}
                alt={repo.owner.login}
                className="w-6 h-6 rounded-full flex-shrink-0"
              />
              <span className="font-semibold text-gray-900 dark:text-white truncate">
                {repo.full_name}
              </span>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2 flex-shrink-0">
              {/* AI Analyze button */}
              <button
                onClick={handleAnalyze}
                disabled={!githubToken || isAnalyzing}
                className={`flex items-center justify-center w-8 h-8 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  isAnalyzed
                    ? 'bg-green-100 text-green-600 dark:bg-green-900 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-800'
                    : isFailed
                    ? 'bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-800'
                    : 'bg-purple-100 text-purple-600 dark:bg-purple-900 dark:text-purple-400 hover:bg-purple-200 dark:hover:bg-purple-800'
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
                  <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : isAnalyzed ? (
                  <Sparkles className="w-4 h-4" />
                ) : (
                  <Bot className="w-4 h-4" />
                )}
              </button>

              {/* ZRead button */}
              <button
                onClick={handleOpenInZRead}
                className="flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-100 text-indigo-600 dark:bg-indigo-900 dark:text-indigo-400 hover:bg-indigo-200 dark:hover:bg-indigo-800 transition-colors"
                title={t('在ZRead打开', 'Open in ZRead')}
              >
                <BookOpen className="w-4 h-4" />
              </button>

              {/* GitHub button */}
              <a
                href={repo.html_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center w-8 h-8 rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                title={t('在GitHub打开', 'Open on GitHub')}
              >
                <ExternalLink className="w-4 h-4" />
              </a>

              {/* Star button */}
              <button
                onClick={handleStar}
                disabled={!githubToken || isStarring || isStarred}
                className={`flex items-center justify-center w-8 h-8 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  isStarred
                    ? 'bg-yellow-100 text-yellow-600 dark:bg-yellow-900 dark:text-yellow-400'
                    : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400 hover:bg-yellow-100 hover:text-yellow-600 dark:hover:bg-yellow-900 dark:hover:text-yellow-400'
                }`}
                title={isStarred ? t('已Star', 'Starred') : t('添加Star', 'Add Star')}
              >
                {isStarring ? (
                  <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : isStarred ? (
                  <BookmarkCheck className="w-4 h-4" />
                ) : (
                  <Bookmark className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          {/* Description */}
          {repo.description && (
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3 line-clamp-2">
              {repo.description}
            </p>
          )}

          {/* AI Summary */}
          {repo.ai_summary && (
            <div className="flex items-start gap-1.5 mb-3">
              <Bot className="w-4 h-4 text-purple-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-purple-600 dark:text-purple-400 line-clamp-2">
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
                  className="px-2 py-0.5 rounded-md text-xs font-medium bg-blue-50/50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Platform icons */}
          {repo.ai_platforms && repo.ai_platforms.length > 0 && (
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {t('平台:', 'Platforms:')}
              </span>
              <div className="flex items-center gap-1">
                {repo.ai_platforms.slice(0, 5).map((platform) => (
                  <span key={platform} className="text-gray-500 dark:text-gray-400" title={platform}>
                    {getPlatformIcon(platform)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Stats */}
          <div className="flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
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

    {/* README Modal */}
    <ReadmeModal
      isOpen={readmeModalOpen}
      onClose={() => setReadmeModalOpen(false)}
      repository={repo}
    />
    </>
  );
};
