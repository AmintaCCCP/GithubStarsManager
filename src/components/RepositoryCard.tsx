import React, { useState, useRef, useEffect } from 'react';
import { Star, GitFork, Eye, ExternalLink, Calendar, Tag, Bell, BellOff, Bot, Monitor, Smartphone, Globe, Terminal, Package, Edit3, Save, X, Plus, BookOpen } from 'lucide-react';
import { Repository } from '../types';
import { useAppStore } from '../store/useAppStore';
import { GitHubApiService } from '../services/githubApi';
import { AIService } from '../services/aiService';
import { getAllCategories } from '../store/useAppStore';
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
    language,
    customCategories
  } = useAppStore();
  
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    description: repository.custom_description || repository.description || '',
    tags: repository.custom_tags || repository.ai_tags || [],
    category: repository.custom_category || ''
  });
  const [newTag, setNewTag] = useState('');
  const [showTooltip, setShowTooltip] = useState(false);
  const [isTextTruncated, setIsTextTruncated] = useState(false);
  
  const descriptionRef = useRef<HTMLParagraphElement>(null);
  
  const isSubscribed = releaseSubscriptions.has(repository.id);
  const allCategories = getAllCategories(customCategories, language);

  // Check if text is actually truncated by comparing scroll height with client height
  useEffect(() => {
    const checkTruncation = () => {
      if (descriptionRef.current) {
        const element = descriptionRef.current;
        const isTruncated = element.scrollHeight > element.clientHeight;
        setIsTextTruncated(isTruncated);
      }
    };

    // Check truncation after component mounts and when content changes
    checkTruncation();
    
    // Also check on window resize
    window.addEventListener('resize', checkTruncation);
    return () => window.removeEventListener('resize', checkTruncation);
  }, [repository, showAISummary, isEditing]);

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
      alert(language === 'zh' ? '请先在设置中配置AI服务。' : 'Please configure AI service in settings first.');
      return;
    }

    // 如果已经分析过，询问用户是否要重新分析
    if (repository.analyzed_at) {
      const confirmMessage = language === 'zh'
        ? `此仓库已于 ${new Date(repository.analyzed_at).toLocaleString()} 进行过AI分析。\n\n是否要重新分析？这将覆盖现有的分析结果。`
        : `This repository was analyzed on ${new Date(repository.analyzed_at).toLocaleString()}.\n\nDo you want to re-analyze? This will overwrite the existing analysis results.`;
      
      if (!confirm(confirmMessage)) {
        return;
      }
    }

    setLoading(true);
    try {
      const githubApi = new GitHubApiService(githubToken);
      const aiService = new AIService(activeConfig, language);
      
      // 获取README内容
      const [owner, name] = repository.full_name.split('/');
      const readmeContent = await githubApi.getRepositoryReadme(owner, name);
      
      // 获取自定义分类名称列表
      const customCategoryNames = customCategories.map(cat => cat.name);
      
      // AI分析
      const analysis = await aiService.analyzeRepository(repository, readmeContent, customCategoryNames);
      
      // 更新仓库信息
      const updatedRepo = {
        ...repository,
        ai_summary: analysis.summary,
        ai_tags: analysis.tags,
        ai_platforms: analysis.platforms,
        analyzed_at: new Date().toISOString()
      };
      
      updateRepository(updatedRepo);
      
      const successMessage = repository.analyzed_at
        ? (language === 'zh' ? 'AI重新分析完成！' : 'AI re-analysis completed!')
        : (language === 'zh' ? 'AI分析完成！' : 'AI analysis completed!');
      
      alert(successMessage);
    } catch (error) {
      console.error('AI analysis failed:', error);
      alert(language === 'zh' ? 'AI分析失败，请检查AI配置和网络连接。' : 'AI analysis failed. Please check AI configuration and network connection.');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveEdit = () => {
    const updatedRepo = {
      ...repository,
      custom_description: editForm.description !== repository.description ? editForm.description : undefined,
      custom_tags: editForm.tags.length > 0 ? editForm.tags : undefined,
      custom_category: editForm.category ? editForm.category : undefined,
      last_edited: new Date().toISOString()
    };
    
    updateRepository(updatedRepo);
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setEditForm({
      description: repository.custom_description || repository.description || '',
      tags: repository.custom_tags || repository.ai_tags || [],
      category: repository.custom_category || ''
    });
    setIsEditing(false);
  };

  const handleAddTag = () => {
    if (newTag.trim() && !editForm.tags.includes(newTag.trim())) {
      setEditForm(prev => ({
        ...prev,
        tags: [...prev.tags, newTag.trim()]
      }));
      setNewTag('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setEditForm(prev => ({
      ...prev,
      tags: prev.tags.filter(tag => tag !== tagToRemove)
    }));
  };

  // Convert GitHub URL to DeepWiki URL
  const getDeepWikiUrl = (githubUrl: string) => {
    return githubUrl.replace('github.com', 'deepwiki.com');
  };

  // 根据切换状态决定显示的内容
  const getDisplayContent = () => {
    if (repository.custom_description) {
      return {
        content: repository.custom_description,
        isCustom: true
      };
    } else if (showAISummary && repository.ai_summary) {
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

  // 获取显示的标签
  const getDisplayTags = () => {
    if (repository.custom_tags && repository.custom_tags.length > 0) {
      return { tags: repository.custom_tags, isCustom: true };
    } else if (repository.ai_tags && repository.ai_tags.length > 0) {
      return { tags: repository.ai_tags, isCustom: false };
    } else {
      return { tags: repository.topics || [], isCustom: false };
    }
  };

  const displayTags = getDisplayTags();

  // 获取显示的分类
  const getDisplayCategory = () => {
    if (repository.custom_category) {
      return repository.custom_category;
    }
    return null;
  };

  const displayCategory = getDisplayCategory();

  // 获取AI分析按钮的提示文本
  const getAIButtonTitle = () => {
    if (repository.analyzed_at) {
      const analyzeTime = new Date(repository.analyzed_at).toLocaleString();
      return language === 'zh' 
        ? `已于 ${analyzeTime} 分析过，点击重新分析`
        : `Analyzed on ${analyzeTime}, click to re-analyze`;
    } else {
      return language === 'zh' ? 'AI分析此仓库' : 'Analyze with AI';
    }
  };

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
        {/* Left side: AI Analysis, Release Subscription, and Edit */}
        <div className="flex items-center space-x-2">
          <button
            onClick={handleAIAnalyze}
            disabled={isLoading}
            className={`p-2 rounded-lg transition-colors ${
              repository.analyzed_at
                ? 'bg-green-100 text-green-600 dark:bg-green-900 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-800'
                : 'bg-purple-100 text-purple-600 dark:bg-purple-900 dark:text-purple-400 hover:bg-purple-200 dark:hover:bg-purple-800'
            } disabled:opacity-50`}
            title={getAIButtonTitle()}
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
          <button
            onClick={() => setIsEditing(!isEditing)}
            className="p-2 rounded-lg bg-orange-100 text-orange-600 dark:bg-orange-900 dark:text-orange-400 hover:bg-orange-200 dark:hover:bg-orange-800 transition-colors"
            title={language === 'zh' ? '编辑仓库信息' : 'Edit repository info'}
          >
            <Edit3 className="w-4 h-4" />
          </button>
        </div>

        {/* Right side: DeepWiki and GitHub Links */}
        <div className="flex items-center space-x-2">
          <a
            href={getDeepWikiUrl(repository.html_url)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-100 text-indigo-600 dark:bg-indigo-900 dark:text-indigo-400 hover:bg-indigo-200 dark:hover:bg-indigo-800 transition-colors"
            title={language === 'zh' ? '在DeepWiki中查看' : 'View on DeepWiki'}
          >
            <BookOpen className="w-4 h-4" />
          </a>
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

      {/* Edit Mode */}
      {isEditing && (
        <div className="mb-4 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600">
          <h4 className="font-medium text-gray-900 dark:text-white mb-3">
            {language === 'zh' ? '编辑仓库信息' : 'Edit Repository Info'}
          </h4>
          
          {/* Description */}
          <div className="mb-3">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {language === 'zh' ? '描述' : 'Description'}
            </label>
            <textarea
              value={editForm.description}
              onChange={(e) => setEditForm(prev => ({ ...prev, description: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm resize-none"
              rows={3}
              placeholder={language === 'zh' ? '输入仓库描述...' : 'Enter repository description...'}
            />
          </div>

          {/* Category */}
          <div className="mb-3">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {language === 'zh' ? '分类' : 'Category'}
            </label>
            <select
              value={editForm.category}
              onChange={(e) => setEditForm(prev => ({ ...prev, category: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm"
            >
              <option value="">{language === 'zh' ? '选择分类...' : 'Select category...'}</option>
              {allCategories.filter(cat => cat.id !== 'all').map(category => (
                <option key={category.id} value={category.name}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>

          {/* Tags */}
          <div className="mb-3">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {language === 'zh' ? '标签' : 'Tags'}
            </label>
            <div className="flex flex-wrap gap-2 mb-2">
              {editForm.tags.map((tag, index) => (
                <span
                  key={index}
                  className="inline-flex items-center px-2 py-1 bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 rounded text-xs"
                >
                  {tag}
                  <button
                    onClick={() => handleRemoveTag(tag)}
                    className="ml-1 text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-200"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex space-x-2">
              <input
                type="text"
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleAddTag()}
                className="flex-1 px-3 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm"
                placeholder={language === 'zh' ? '添加标签...' : 'Add tag...'}
              />
              <button
                onClick={handleAddTag}
                className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex space-x-2">
            <button
              onClick={handleSaveEdit}
              className="flex items-center space-x-1 px-3 py-1.5 bg-green-600 text-white rounded text-sm hover:bg-green-700 transition-colors"
            >
              <Save className="w-4 h-4" />
              <span>{language === 'zh' ? '保存' : 'Save'}</span>
            </button>
            <button
              onClick={handleCancelEdit}
              className="flex items-center space-x-1 px-3 py-1.5 bg-gray-500 text-white rounded text-sm hover:bg-gray-600 transition-colors"
            >
              <X className="w-4 h-4" />
              <span>{language === 'zh' ? '取消' : 'Cancel'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Description with Tooltip */}
      <div className="mb-4 flex-1">
        <div 
          className="relative"
          onMouseEnter={() => isTextTruncated && setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
        >
          <p 
            ref={descriptionRef}
            className="text-gray-700 dark:text-gray-300 text-sm leading-relaxed line-clamp-3 mb-2"
          >
            {displayContent.content}
          </p>
          
          {/* Tooltip - Only show when text is actually truncated */}
          {isTextTruncated && showTooltip && (
            <div className="absolute z-50 bottom-full left-0 right-0 mb-2 p-3 bg-gray-900 dark:bg-gray-700 text-white text-sm rounded-lg shadow-lg border border-gray-200 dark:border-gray-600 max-h-48 overflow-y-auto">
              <div className="whitespace-pre-wrap break-words">
                {displayContent.content}
              </div>
              {/* Arrow */}
              <div className="absolute top-full left-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-gray-900 dark:border-t-gray-700"></div>
            </div>
          )}
        </div>
        
        <div className="flex items-center space-x-2">
          {displayContent.isCustom && (
            <div className="flex items-center space-x-1 text-xs text-orange-600 dark:text-orange-400">
              <Edit3 className="w-3 h-3" />
              <span>{language === 'zh' ? '自定义' : 'Custom'}</span>
            </div>
          )}
          {displayContent.isAI && (
            <div className="flex items-center space-x-1 text-xs text-green-600 dark:text-green-400">
              <Bot className="w-3 h-3" />
              <span>{language === 'zh' ? 'AI总结' : 'AI Summary'}</span>
            </div>
          )}
        </div>
      </div>

      {/* Category Display */}
      {displayCategory && (
        <div className="mb-3">
          <span className="inline-flex items-center px-2 py-1 bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300 rounded-md text-xs font-medium">
            <Tag className="w-3 h-3 mr-1" />
            {displayCategory}
          </span>
        </div>
      )}

      {/* Tags */}
      {displayTags.tags.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {displayTags.tags.slice(0, 3).map((tag, index) => (
            <span
              key={index}
              className={`px-2 py-1 rounded-md text-xs font-medium ${
                displayTags.isCustom
                  ? 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300'
                  : 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300'
              }`}
            >
              {displayTags.isCustom && <Edit3 className="w-3 h-3 inline mr-1" />}
              {!displayTags.isCustom && <Tag className="w-3 h-3 inline mr-1" />}
              {tag}
            </span>
          ))}
          {repository.topics && repository.topics.length > 0 && !displayTags.isCustom && (
            <>
              {repository.topics.slice(0, 2).map((topic, index) => (
                <span
                  key={`topic-${index}`}
                  className="px-2 py-1 bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 rounded-md text-xs"
                >
                  {topic}
                </span>
              ))}
            </>
          )}
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
          
          <div className="flex items-center space-x-2">
            {repository.last_edited && (
              <div className="flex items-center space-x-1 text-xs">
                <Edit3 className="w-3 h-3 text-orange-500" />
                <span>{language === 'zh' ? '已编辑' : 'Edited'}</span>
              </div>
            )}
            {repository.analyzed_at && (
              <div className="flex items-center space-x-1 text-xs">
                <div className="w-2 h-2 bg-green-500 rounded-full" />
                <span>{language === 'zh' ? 'AI已分析' : 'AI analyzed'}</span>
              </div>
            )}
          </div>
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