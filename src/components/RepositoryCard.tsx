import React from 'react';
import { Star, GitFork, Eye, ExternalLink, Calendar, Tag, Bell, BellOff, Bot, Monitor, Smartphone, Globe, Terminal, Package } from 'lucide-react';
import { Repository } from '../types';
import { useAppStore } from '../store/useAppStore';
import { GitHubApiService } from '../services/githubApi';
import { AIService } from '../services/aiService';
import { formatDistanceToNow } from 'date-fns';

interface RepositoryCardProps {
  repository: Repository;
  showAISummary?: boolean;
}

export const RepositoryCard: React.FC<RepositoryCardProps> = ({ 
  repository, 
  showAISummary = true 
}) => {
  const { 
    releaseSubscriptions, 
    toggleReleaseSubscription, 
    updateRepository,
    githubToken,
    aiConfigs,
    activeAIConfig,
    isLoading,
    setLoading,
    language
  } = useAppStore();
  
  const isSubscribed = releaseSubscriptions.has(repository.id);

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const getLanguageColor = (language: string | null) => {
    const colors = {
      JavaScript: '#f1e05a',
      TypeScript: '#3178c6',
      Python: '#3572A5',
      Java: '#b07219',
      'C++': '#f34b7d',
      C: '#555555',
      'C#': '#239120',
      Go: '#00ADD8',
      Rust: '#dea584',
      PHP: '#4F5D95',
      Ruby: '#701516',
      Swift: '#fa7343',
      Kotlin: '#A97BFF',
      Dart: '#00B4AB',
      Shell: '#89e051',
      HTML: '#e34c26',
      CSS: '#1572B6',
      Vue: '#4FC08D',
      React: '#61DAFB',
    };
    return colors[language as keyof typeof colors] || '#6b7280';
  };

  const getPlatformIcon = (platform: string) => {
    const iconMap: Record<string, string> = {
      mac: 'fab fa-apple',
      macos: 'fab fa-apple',
      windows: 'fab fa-windows',
      win: 'fab fa-windows',
      linux: 'fab fa-linux',
      ios: 'fab fa-apple',
      android: 'fab fa-android',
      web: 'fas fa-globe',
      cli: 'fas fa-terminal',
      docker: 'fab fa-docker',
    };
    return iconMap[platform.toLowerCase()] || 'fas fa-desktop';
  };

  const handleAIAnalyze = async () => {
    if (!githubToken) {
      alert('GitHub token not found. Please login again.');
      return;
    }

    const activeConfig = aiConfigs.find(config => config.id === activeAIConfig);
    if (!activeConfig) {
      alert('请先在设置中配置AI服务。');
      return;
    }

    setLoading(true);
    try {
      const githubApi = new GitHubApiService(githubToken);
      const aiService = new AIService(activeConfig, language);
      
      // 获取README内容
      const [owner, name] = repository.full_name.split('/');
      const readmeContent = await githubApi.getRepositoryReadme(owner, name);
      
      // AI分析
      const analysis = await aiService.analyzeRepository(repository, readmeContent);
      
      // 更新仓库信息
      const updatedRepo = {
        ...repository,
        ai_summary: analysis.summary,
        ai_tags: analysis.tags,
        ai_platforms: analysis.platforms,
        analyzed_at: new Date().toISOString()
      };
      
      updateRepository(updatedRepo);
      alert('AI分析完成！');
    } catch (error) {
      console.error('AI analysis failed:', error);
      alert('AI分析失败，请检查AI配置和网络连接。');
    } finally {
      setLoading(false);
    }
  };

  // 根据切换状态决定显示的内容
  const getDisplayContent = () => {
    if (showAISummary && repository.ai_summary) {
      return {
        content: repository.ai_summary,
        isAI: true
      };
    } else if (repository.description) {
      return {
        content: repository.description,
        isAI: false
      };
    } else {
      return {
        content: language === 'zh' ? '暂无描述' : 'No description available',
        isAI: false
      };
    }
  };

  const displayContent = getDisplayContent();

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 hover:shadow-lg transition-all duration-200 hover:border-blue-300 dark:hover:border-blue-600 animate-slide-up flex flex-col h-full">
      {/* Header - Repository Info */}
      <div className="flex items-center space-x-3 mb-3">
        <img
          src={repository.owner.avatar_url}
          alt={repository.owner.login}
          className="w-8 h-8 rounded-full flex-shrink-0"
        />
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-gray-900 dark:text-white truncate">
            {repository.name}
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
            {repository.owner.login}
          </p>
        </div>
      </div>

      {/* Action Buttons Row - Left and Right Aligned */}
      <div className="flex items-center justify-between mb-4">
        {/* Left side: AI Analysis and Release Subscription */}
        <div className="flex items-center space-x-2">
          <button
            onClick={handleAIAnalyze}
            disabled={isLoading}
            className={`p-2 rounded-lg transition-colors ${
              repository.analyzed_at
                ? 'bg-green-100 text-green-600 dark:bg-green-900 dark:text-green-400'
                : 'bg-purple-100 text-purple-600 dark:bg-purple-900 dark:text-purple-400 hover:bg-purple-200 dark:hover:bg-purple-800'
            } disabled:opacity-50`}
            title={repository.analyzed_at ? (language === 'zh' ? '已AI分析' : 'AI Analyzed') : (language === 'zh' ? 'AI分析此仓库' : 'Analyze with AI')}
          >
            <Bot className="w-4 h-4" />
          </button>
          <button
            onClick={() => toggleReleaseSubscription(repository.id)}
            className={`p-2 rounded-lg transition-colors ${
              isSubscribed
                ? 'bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-400'
                : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
            title={isSubscribed ? 'Unsubscribe from releases' : 'Subscribe to releases'}
          >
            {isSubscribed ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
          </button>
        </div>

        {/* Right side: GitHub Link - Fixed square container */}
        <div>
          <a
            href={repository.html_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center w-8 h-8 rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            title="View on GitHub"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      </div>

      {/* Description */}
      <div className="mb-4 flex-1">
        <p className="text-gray-700 dark:text-gray-300 text-sm leading-relaxed line-clamp-3 mb-2">
          {displayContent.content}
        </p>
        {displayContent.isAI && (
          <div className="flex items-center space-x-1 text-xs text-green-600 dark:text-green-400">
            <Bot className="w-3 h-3" />
            <span>{language === 'zh' ? 'AI总结' : 'AI Summary'}</span>
          </div>
        )}
      </div>

      {/* Tags */}
      {(repository.ai_tags?.length || repository.topics?.length) && (
        <div className="flex flex-wrap gap-2 mb-4">
          {repository.ai_tags?.slice(0, 3).map((tag, index) => (
            <span
              key={`ai-${index}`}
              className="px-2 py-1 bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300 rounded-md text-xs font-medium"
            >
              <Tag className="w-3 h-3 inline mr-1" />
              {tag}
            </span>
          ))}
          {repository.topics?.slice(0, 2).map((topic, index) => (
            <span
              key={`topic-${index}`}
              className="px-2 py-1 bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 rounded-md text-xs"
            >
              {topic}
            </span>
          ))}
        </div>
      )}

      {/* Platform Icons */}
      {repository.ai_platforms && repository.ai_platforms.length > 0 && (
        <div className="flex items-center space-x-2 mb-4">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {language === 'zh' ? '支持平台:' : 'Platforms:'}
          </span>
          <div className="flex space-x-1">
            {repository.ai_platforms.slice(0, 6).map((platform, index) => (
              <div
                key={index}
                className="w-6 h-6 flex items-center justify-center bg-gray-100 dark:bg-gray-700 rounded text-gray-600 dark:text-gray-400"
                title={platform}
              >
                <i className={`${getPlatformIcon(platform)} text-xs`}></i>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="space-y-3 mt-auto">
        {/* Language and Stars */}
        <div className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
          <div className="flex items-center space-x-4">
            {repository.language && (
              <div className="flex items-center space-x-1">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: getLanguageColor(repository.language) }}
                />
                <span className="truncate max-w-20">{repository.language}</span>
              </div>
            )}
            <div className="flex items-center space-x-1">
              <Star className="w-4 h-4" />
              <span>{formatNumber(repository.stargazers_count)}</span>
            </div>
          </div>
          
          {repository.analyzed_at && (
            <div className="flex items-center space-x-1 text-xs">
              <div className="w-2 h-2 bg-green-500 rounded-full" />
              <span>{language === 'zh' ? 'AI已分析' : 'AI analyzed'}</span>
            </div>
          )}
        </div>

        {/* Update Time - Separate Row */}
        <div className="flex items-center space-x-1 text-sm text-gray-500 dark:text-gray-400 pt-2 border-t border-gray-100 dark:border-gray-700">
          <Calendar className="w-4 h-4 flex-shrink-0" />
          <span className="truncate">
            {language === 'zh' ? '更新于' : 'Updated'} {formatDistanceToNow(new Date(repository.updated_at), { addSuffix: true })}
          </span>
        </div>
      </div>
    </div>
  );
};