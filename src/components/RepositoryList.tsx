import React, { useState, useRef } from 'react';
import { Bot, ChevronDown, Pause, Play } from 'lucide-react';
import { RepositoryCard } from './RepositoryCard';
import { SearchResultStats } from './SearchResultStats';
import { Repository } from '../types';
import { useAppStore, getAllCategories } from '../store/useAppStore';
import { GitHubApiService } from '../services/githubApi';
import { AIService } from '../services/aiService';

interface RepositoryListProps {
  repositories: Repository[];
  selectedCategory: string;
}

export const RepositoryList: React.FC<RepositoryListProps> = ({ 
  repositories, 
  selectedCategory 
}) => {
  const {
    githubToken,
    aiConfigs,
    activeAIConfig,
    isLoading,
    setLoading,
    updateRepository,
    language,
    customCategories,
  } = useAppStore();

  const [showAISummary, setShowAISummary] = useState(true);
  const [showDropdown, setShowDropdown] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState({ current: 0, total: 0 });
  const [isPaused, setIsPaused] = useState(false);
  const [searchTime, setSearchTime] = useState<number | undefined>(undefined);
  
  // 使用 useRef 来管理停止状态，确保在异步操作中能正确访问最新值
  const shouldStopRef = useRef(false);
  const isAnalyzingRef = useRef(false);

  const allCategories = getAllCategories(customCategories, language);

  // Filter repositories by selected category
  const filteredRepositories = repositories.filter(repo => {
    if (selectedCategory === 'all') return true;
    
    const selectedCategoryObj = allCategories.find(cat => cat.id === selectedCategory);
    if (!selectedCategoryObj) return false;

    // Check custom category first
    if (repo.custom_category === selectedCategoryObj.name) {
      return true;
    }
    
    // 优先使用AI标签进行匹配
    if (repo.ai_tags && repo.ai_tags.length > 0) {
      return repo.ai_tags.some(tag => 
        selectedCategoryObj.keywords.some(keyword => 
          tag.toLowerCase().includes(keyword.toLowerCase()) ||
          keyword.toLowerCase().includes(tag.toLowerCase())
        )
      );
    }
    
    // 如果没有AI标签，使用传统方式匹配
    const repoText = [
      repo.name,
      repo.description || '',
      repo.language || '',
      ...(repo.topics || []),
      repo.ai_summary || ''
    ].join(' ').toLowerCase();
    
    return selectedCategoryObj.keywords.some(keyword => 
      repoText.includes(keyword.toLowerCase())
    );
  });

  const handleAIAnalyze = async (analyzeUnanalyzedOnly: boolean = false) => {
    if (!githubToken) {
      alert(language === 'zh' ? 'GitHub token 未找到，请重新登录。' : 'GitHub token not found. Please login again.');
      return;
    }

    const activeConfig = aiConfigs.find(config => config.id === activeAIConfig);
    if (!activeConfig) {
      alert(language === 'zh' ? '请先在设置中配置AI服务。' : 'Please configure AI service in settings first.');
      return;
    }

    const targetRepos = analyzeUnanalyzedOnly 
      ? filteredRepositories.filter(repo => !repo.analyzed_at)
      : filteredRepositories;

    if (targetRepos.length === 0) {
      alert(language === 'zh' 
        ? (analyzeUnanalyzedOnly ? '所有仓库都已经分析过了！' : '没有可分析的仓库！')
        : (analyzeUnanalyzedOnly ? 'All repositories have been analyzed!' : 'No repositories to analyze!')
      );
      return;
    }

    const actionText = language === 'zh' 
      ? (analyzeUnanalyzedOnly ? '未分析' : '全部')
      : (analyzeUnanalyzedOnly ? 'unanalyzed' : 'all');
    
    const confirmMessage = language === 'zh'
      ? `将对 ${targetRepos.length} 个${actionText}仓库进行AI分析，这可能需要几分钟时间。是否继续？`
      : `Will analyze ${targetRepos.length} ${actionText} repositories with AI. This may take several minutes. Continue?`;
    
    const confirmed = confirm(confirmMessage);
    if (!confirmed) return;

    // 重置状态
    shouldStopRef.current = false;
    isAnalyzingRef.current = true;
    setLoading(true);
    setAnalysisProgress({ current: 0, total: targetRepos.length });
    setShowDropdown(false);
    setIsPaused(false);

    try {
      const githubApi = new GitHubApiService(githubToken);
      const aiService = new AIService(activeConfig, language);
      
      // 获取自定义分类名称列表
      const customCategoryNames = customCategories.map(cat => cat.name);
      
      let analyzed = 0;
      
      for (let i = 0; i < targetRepos.length; i++) {
        // 检查是否需要停止
        if (shouldStopRef.current) {
          console.log('Analysis stopped by user');
          break;
        }

        // 处理暂停
        while (isPaused && !shouldStopRef.current) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // 再次检查停止状态（暂停期间可能被停止）
        if (shouldStopRef.current) {
          console.log('Analysis stopped during pause');
          break;
        }

        const repo = targetRepos[i];
        setAnalysisProgress({ current: i + 1, total: targetRepos.length });
        
        try {
          // 获取README内容
          const [owner, name] = repo.full_name.split('/');
          const readmeContent = await githubApi.getRepositoryReadme(owner, name);
          
          // AI分析
          const analysis = await aiService.analyzeRepository(repo, readmeContent, customCategoryNames);
          
          // 更新仓库信息
          const updatedRepo = {
            ...repo,
            ai_summary: analysis.summary,
            ai_tags: analysis.tags,
            ai_platforms: analysis.platforms,
            analyzed_at: new Date().toISOString()
          };
          
          updateRepository(updatedRepo);
          analyzed++;
          
          // 避免API限制
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          console.warn(`Failed to analyze ${repo.full_name}:`, error);
        }
      }
      
      const completionMessage = shouldStopRef.current
        ? (language === 'zh'
            ? `AI分析已停止！已成功分析了 ${analyzed} 个仓库。`
            : `AI analysis stopped! Successfully analyzed ${analyzed} repositories.`)
        : (language === 'zh'
            ? `AI分析完成！成功分析了 ${analyzed} 个仓库。`
            : `AI analysis completed! Successfully analyzed ${analyzed} repositories.`);
      
      alert(completionMessage);
    } catch (error) {
      console.error('AI analysis failed:', error);
      const errorMessage = language === 'zh'
        ? 'AI分析失败，请检查AI配置和网络连接。'
        : 'AI analysis failed. Please check AI configuration and network connection.';
      alert(errorMessage);
    } finally {
      // 清理状态
      isAnalyzingRef.current = false;
      shouldStopRef.current = false;
      setLoading(false);
      setAnalysisProgress({ current: 0, total: 0 });
      setIsPaused(false);
    }
  };

  const handlePauseResume = () => {
    if (!isAnalyzingRef.current) return;
    setIsPaused(!isPaused);
    console.log(isPaused ? 'Analysis resumed' : 'Analysis paused');
  };

  const handleStop = () => {
    if (!isAnalyzingRef.current) return;
    
    const confirmMessage = language === 'zh'
      ? '确定要停止AI分析吗？已分析的结果将会保存。'
      : 'Are you sure you want to stop AI analysis? Analyzed results will be saved.';
    
    if (confirm(confirmMessage)) {
      shouldStopRef.current = true;
      setIsPaused(false);
      console.log('Stop requested by user');
    }
  };

  if (filteredRepositories.length === 0) {
    const selectedCategoryObj = allCategories.find(cat => cat.id === selectedCategory);
    const categoryName = selectedCategoryObj?.name || selectedCategory;
    const { searchFilters } = useAppStore();
    
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 dark:text-gray-400 mb-4">
          {searchFilters.query ? (
            language === 'zh' 
              ? `未找到与"${searchFilters.query}"相关的仓库。`
              : `No repositories found for "${searchFilters.query}".`
          ) : selectedCategory === 'all' 
            ? (language === 'zh' ? '未找到仓库。点击同步加载您的星标仓库。' : 'No repositories found. Click sync to load your starred repositories.')
            : (language === 'zh' 
                ? `在"${categoryName}"分类中未找到仓库。`
                : `No repositories found in "${categoryName}" category.`
              )
          }
        </p>
        {searchFilters.query && (
          <div className="text-sm text-gray-400 dark:text-gray-500">
            <p className="mb-2">
              {language === 'zh' ? '搜索建议：' : 'Search suggestions:'}
            </p>
            <ul className="space-y-1">
              <li>• {language === 'zh' ? '尝试使用不同的关键词' : 'Try different keywords'}</li>
              <li>• {language === 'zh' ? '使用AI搜索进行语义匹配' : 'Use AI search for semantic matching'}</li>
              <li>• {language === 'zh' ? '检查拼写或尝试英文/中文关键词' : 'Check spelling or try English/Chinese keywords'}</li>
            </ul>
          </div>
        )}
      </div>
    );
  }

  const unanalyzedCount = filteredRepositories.filter(r => !r.analyzed_at).length;
  const analyzedCount = filteredRepositories.filter(r => r.analyzed_at).length;

  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

  return (
    <div className="space-y-6">
      {/* Search Result Statistics */}
      <SearchResultStats
        repositories={repositories}
        filteredRepositories={filteredRepositories}
        searchQuery={useAppStore.getState().searchFilters.query}
        isRealTimeSearch={useAppStore.getState().searchFilters.query === ''}
        searchTime={searchTime}
      />

      {/* AI Analysis Controls */}
      <div className="flex items-center justify-between bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center space-x-4">
          {/* AI Analysis Dropdown Button */}
          <div className="relative">
            <button
              onClick={() => setShowDropdown(!showDropdown)}
              disabled={isLoading}
              className="flex items-center space-x-2 px-4 py-2 bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300 rounded-lg hover:bg-purple-200 dark:hover:bg-purple-800 transition-colors disabled:opacity-50"
            >
              <Bot className="w-4 h-4" />
              <span>
                {isLoading 
                  ? t(`AI分析中... (${analysisProgress.current}/${analysisProgress.total})`, `AI Analyzing... (${analysisProgress.current}/${analysisProgress.total})`)
                  : t('AI分析', 'AI Analysis')
                }
              </span>
              <ChevronDown className="w-4 h-4" />
            </button>

            {/* Dropdown Menu */}
            {showDropdown && !isLoading && (
              <div className="absolute top-full left-0 mt-2 w-56 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-10">
                <button
                  onClick={() => handleAIAnalyze(false)}
                  className="w-full px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors border-b border-gray-100 dark:border-gray-600"
                >
                  <div className="font-medium text-gray-900 dark:text-white">
                    {t('分析全部', 'Analyze All')}
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    {t(`分析 ${filteredRepositories.length} 个仓库`, `Analyze ${filteredRepositories.length} repositories`)}
                  </div>
                </button>
                <button
                  onClick={() => handleAIAnalyze(true)}
                  disabled={unanalyzedCount === 0}
                  className="w-full px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="font-medium text-gray-900 dark:text-white">
                    {t('分析未分析的', 'Analyze Unanalyzed')}
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    {t(`分析 ${unanalyzedCount} 个未分析仓库`, `Analyze ${unanalyzedCount} unanalyzed repositories`)}
                  </div>
                </button>
              </div>
            )}
          </div>

          {/* Progress Bar and Controls */}
          {isLoading && analysisProgress.total > 0 && (
            <div className="flex items-center space-x-3">
              <div className="w-32 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div 
                  className="bg-purple-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${(analysisProgress.current / analysisProgress.total) * 100}%` }}
                ></div>
              </div>
              <span className="text-sm text-gray-600 dark:text-gray-400">
                {Math.round((analysisProgress.current / analysisProgress.total) * 100)}%
              </span>
              <button
                onClick={handlePauseResume}
                className="p-1.5 rounded-lg bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300 hover:bg-yellow-200 dark:hover:bg-yellow-800 transition-colors"
                title={isPaused ? t('继续', 'Resume') : t('暂停', 'Pause')}
              >
                {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
              </button>
              <button
                onClick={handleStop}
                className="px-3 py-1.5 rounded-lg bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-800 transition-colors text-sm"
              >
                {t('停止', 'Stop')}
              </button>
            </div>
          )}

          {/* Description Toggle - Radio Style */}
          {!isLoading && (
            <div className="flex items-center space-x-3">
              <span className="text-sm text-gray-600 dark:text-gray-400">
                {t('显示内容:', 'Display:')}
              </span>
              <div className="flex items-center space-x-4">
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="radio"
                    name="displayContent"
                    checked={showAISummary}
                    onChange={() => setShowAISummary(true)}
                    className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                  />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t('AI总结', 'AI Summary')}
                  </span>
                </label>
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="radio"
                    name="displayContent"
                    checked={!showAISummary}
                    onChange={() => setShowAISummary(false)}
                    className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                  />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t('原始描述', 'Original Description')}
                  </span>
                </label>
              </div>
            </div>
          )}
        </div>

        {/* Statistics */}
        <div className="text-sm text-gray-500 dark:text-gray-400">
          <div className="flex items-center justify-between">
            <div>
              {t(`显示 ${filteredRepositories.length} 个仓库`, `Showing ${filteredRepositories.length} repositories`)}
              {repositories.length !== filteredRepositories.length && (
                <span className="ml-2 text-blue-600 dark:text-blue-400">
                  {t(`(从 ${repositories.length} 个中筛选)`, `(filtered from ${repositories.length})`)}
                </span>
              )}
            </div>
            <div>
              {analyzedCount > 0 && (
                <span className="mr-3">
                  • {analyzedCount} {t('个已AI分析', 'AI analyzed')}
                </span>
              )}
              {unanalyzedCount > 0 && (
                <span>
                  • {unanalyzedCount} {t('个未分析', 'unanalyzed')}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Repository Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        {filteredRepositories.map(repo => (
          <RepositoryCard 
            key={repo.id} 
            repository={repo} 
            showAISummary={showAISummary}
            searchQuery={useAppStore.getState().searchFilters.query}
          />
        ))}
      </div>
    </div>
  );
};