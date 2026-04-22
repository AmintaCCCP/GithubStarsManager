import React, { useMemo } from 'react';
import { Star, ExternalLink, Bot, GitFork, Monitor, Smartphone, Globe, Terminal, Package } from 'lucide-react';
import type { SubscriptionRepo } from '../types';
import { useAppStore } from '../store/useAppStore';

interface SubscriptionRepoCardProps {
  repo: SubscriptionRepo;
}

export const SubscriptionRepoCard: React.FC<SubscriptionRepoCardProps> = ({ repo }) => {
  const language = useAppStore(state => state.language);
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

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

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 hover:shadow-lg transition-shadow duration-200 hover:border-blue-300 dark:hover:border-blue-600">
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
              <a
                href={repo.html_url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-gray-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 truncate"
              >
                {repo.full_name}
              </a>
              <a
                href={repo.html_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-shrink-0 text-gray-400 hover:text-blue-500"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
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
  );
};