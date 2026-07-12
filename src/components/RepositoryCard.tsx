import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { GripVertical, Star, StarOff, ExternalLink, Calendar, Bell, BellOff, Bot, Sparkles, Monitor, Smartphone, Globe, Terminal, Package, Edit3, BookOpen, Apple, Square, CheckSquare, Loader2, HelpCircle, Search } from 'lucide-react';
import { Repository, Category } from '../types';
import { useAppStore } from '../store/useAppStore';
import { EmbeddingClient, VectorSearchService, findSimilarRepositories } from '../services/vectorSearchService';
import { getAICategory, getDefaultCategory } from '../utils/categoryUtils';
import { analyzeRepository, createFailedAnalysisResult } from '../services/aiAnalysisHelper';
import { forceSyncToBackend } from '../services/autoSync';
import { GitHubApiService } from '../services/githubApi';
import { formatDistanceToNow } from 'date-fns';
import { RepositoryEditModal } from './RepositoryEditModal';
import { ReadmeModal } from './ReadmeModal';
import { FloatingTooltip } from './FloatingTooltip';
import { shallow } from 'zustand/shallow';
import { useDialog } from '../hooks/useDialog';
import { logger } from '../services/logger';

// Selection-aware button component to centralize selectionMode disable logic
interface SelectionAwareButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  selectionMode?: boolean;
  children: React.ReactNode;
  variant?: 'default' | 'ai' | 'subscribe' | 'edit' | 'unstar';
}

const SelectionAwareButton: React.FC<SelectionAwareButtonProps> = ({
  selectionMode,
  children,
  variant = 'default',
  className = '',
  disabled,
  onClick,
  ...props
}) => {
  const baseClasses = 'p-2 rounded-lg transition-colors disabled:opacity-50';
  const selectionClasses = selectionMode ? 'pointer-events-none' : '';

  const variantClasses = {
    default: '',
    ai: '', // AI variant uses dynamic classes based on state
    subscribe: '', // Subscribe variant uses dynamic classes based on state
    edit: 'bg-gray-100 text-gray-700 hover:bg-gray-200 hover:text-gray-900 dark:bg-white/[0.04] dark:text-text-secondary dark:hover:bg-white/[0.08] dark:hover:text-text-primary',
    unstar: 'flex items-center justify-center w-8 h-8 bg-gray-100 text-gray-700 hover:bg-gray-200 hover:text-gray-900 dark:bg-white/[0.04] dark:text-text-secondary dark:hover:bg-white/[0.08] dark:hover:text-text-primary disabled:cursor-not-allowed',
  };

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    // 阻止事件冒泡，防止触发卡片的点击事件
    e.stopPropagation();
    onClick?.(e);
  };

  return (
    <button
      {...props}
      onClick={handleClick}
      disabled={disabled || selectionMode}
      className={`${baseClasses} ${variantClasses[variant]} ${selectionClasses} ${className}`}
    >
      {children}
    </button>
  );
};

interface RepositoryCardProps {
  repository: Repository;
  showAISummary?: boolean;
  searchQuery?: string;
  isSelected?: boolean;
  onSelect?: (id: number) => void;
  selectionMode?: boolean;
  isExitingSelection?: boolean;
  allCategories: Category[];
}

const MAX_CACHE_SIZE = 500;

const highlightCache = new Map<string, React.ReactNode>();

const escapeRegExp = (string: string): string => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

const RepositoryCardComponent: React.FC<RepositoryCardProps> = ({
  repository,
  showAISummary = true,
  searchQuery = '',
  isSelected = false,
  onSelect,
  selectionMode = false,
  isExitingSelection = false,
  allCategories
}) => {
  const repoId = repository.id;

  const isSubscribed = useAppStore(
    useCallback((state) => state.releaseSubscriptions.has(repoId), [repoId])
  );
  const isStoreAnalyzing = useAppStore(
    useCallback((state) => state.analyzingRepositoryIds.has(repoId), [repoId])
  );

  const {
    toggleReleaseSubscription,
    githubToken,
    activeAIConfig,
    setAnalyzingRepository,
    language,
    updateRepository,
    deleteRepository,
    vectorSearchConfig,
    vectorSearchStatus,
    embeddingConfigs,
    activeEmbeddingConfig,
    repositories,
    enterSimilarView
  } = useAppStore(
    useCallback(
      (state) => ({
        toggleReleaseSubscription: state.toggleReleaseSubscription,
        githubToken: state.githubToken,
        activeAIConfig: state.activeAIConfig,
        setAnalyzingRepository: state.setAnalyzingRepository,
        language: state.language,
        updateRepository: state.updateRepository,
        deleteRepository: state.deleteRepository,
        vectorSearchConfig: state.vectorSearchConfig,
        vectorSearchStatus: state.vectorSearchStatus,
        embeddingConfigs: state.embeddingConfigs,
        activeEmbeddingConfig: state.activeEmbeddingConfig,
        repositories: state.repositories,
        enterSimilarView: state.enterSimilarView
      }),
      []
    ),
    shallow
  );

  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      setAnalyzingRepository(repoId, false);
    };
  }, [repoId, setAnalyzingRepository]);

  const aiConfigs = useAppStore(state => state.aiConfigs);

  const { toast, confirm } = useDialog();

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [readmeModalOpen, setReadmeModalOpen] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const descTriggerRef = useRef<HTMLDivElement>(null);
  const tooltipHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [unstarring, setUnstarring] = useState(false);
  const [showDragHint, setShowDragHint] = useState(false);
  const dragHintTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isLocallyAnalyzing, setIsLocallyAnalyzing] = useState(false);
  const isAnalyzing = isLocallyAnalyzing || isStoreAnalyzing;

  // 向量搜索是否可用（开关开启 + Worker 已连接 + 有索引 + Embedding 配置完整）
  // 仅在可用时显示"查找相似仓库"按钮，避免无效点击
  const vectorSearchAvailable = useMemo(() => {
    const activeConfig = embeddingConfigs.find((c) => c.id === activeEmbeddingConfig);
    const configComplete = !!activeConfig
      && !!activeConfig.baseUrl
      && !!activeConfig.model
      && (activeConfig.apiType === 'ollama' || !!activeConfig.apiKey);
    return (
      vectorSearchConfig.enabled
      && !!vectorSearchStatus?.connected
      && (vectorSearchStatus?.vectorCount ?? 0) > 0
      && configComplete
      && !!vectorSearchConfig.workerUrl
      && !!vectorSearchConfig.authToken
    );
  }, [embeddingConfigs, activeEmbeddingConfig, vectorSearchConfig, vectorSearchStatus]);

  const [isFindingSimilar, setIsFindingSimilar] = useState(false);

  // 高亮搜索关键词的工具函数 - 使用缓存优化
  const highlightSearchTerm = useCallback((text: string, searchTerm: string): React.ReactNode => {
    if (!searchTerm.trim() || !text) return text;

    const cacheKey = `${text}::${searchTerm}`;
    const cached = highlightCache.get(cacheKey);
    if (cached) return cached;

    const escapedTerm = escapeRegExp(searchTerm);
    const regex = new RegExp(`(${escapedTerm})`, 'gi');
    const parts = text.split(regex);

    const result = parts.map((part, index) => {
      if (part.toLowerCase() === searchTerm.toLowerCase()) {
        return (
          <mark
            key={index}
            className="bg-gray-100 dark:bg-white/[0.04] text-gray-700 dark:text-text-secondary px-1 rounded"
          >
            {part}
          </mark>
        );
      }
      return part;
    });

    if (highlightCache.size > MAX_CACHE_SIZE) {
      const firstKey = highlightCache.keys().next().value;
      if (firstKey) highlightCache.delete(firstKey);
    }
    highlightCache.set(cacheKey, result);
    return result;
  }, []);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (dragHintTimeoutRef.current) {
        clearTimeout(dragHintTimeoutRef.current);
      }
      if (tooltipHideTimerRef.current) {
        clearTimeout(tooltipHideTimerRef.current);
      }
    };
  }, []);

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  // 缓存语言颜色映射
  const languageColors = useMemo(() => ({
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
  }), []);

  const getLanguageColor = useCallback((language: string | null) => {
    return languageColors[language as keyof typeof languageColors] || '#6b7280';
  }, [languageColors]);

  // 缓存平台图标映射
  const platformIconMap = useMemo(() => ({
    mac: Apple,
    macos: Apple,
    ios: Apple,
    windows: Monitor,
    win: Monitor,
    linux: Terminal,
    android: Smartphone,
    web: Globe,
    cli: Terminal,
    docker: Package,
  }), []);

  const getPlatformIcon = useCallback((platform: string) => {
    const platformLower = platform.toLowerCase();
    return platformIconMap[platformLower as keyof typeof platformIconMap] || Monitor;
  }, [platformIconMap]);

  // 缓存平台显示名称映射
  const platformNameMap = useMemo(() => ({
    mac: 'macOS',
    macos: 'macOS',
    windows: 'Windows',
    win: 'Windows',
    linux: 'Linux',
    ios: 'iOS',
    android: 'Android',
    web: 'Web',
    cli: 'CLI',
    docker: 'Docker',
  }), []);

  const getPlatformDisplayName = useCallback((platform: string) => {
    const platformLower = platform.toLowerCase();
    return platformNameMap[platformLower as keyof typeof platformNameMap] || platform;
  }, [platformNameMap]);

  const handleAIAnalyze = async () => {
    if (!githubToken) {
      toast(t('GitHub token 未找到，请重新登录。', 'GitHub token not found. Please login again.'), 'error');
      return;
    }

    const activeConfig = aiConfigs.find(config => config.id === activeAIConfig);
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

    if (repository.analyzed_at) {
      const confirmMessage = language === 'zh'
        ? `此仓库已于 ${new Date(repository.analyzed_at).toLocaleString()} 进行过AI分析。\n\n是否要重新分析？这将覆盖现有的分析结果。`
        : `This repository was analyzed on ${new Date(repository.analyzed_at).toLocaleString()}.\n\nDo you want to re-analyze? This will overwrite the existing analysis results.`;

      if (!await confirm(t('重新分析确认', 'Re-analyze Confirmation'), confirmMessage, { type: 'warning' })) {
        return;
      }
    }

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const analysisStartedAt = performance.now();
    setIsLocallyAnalyzing(true);
    requestAnimationFrame(() => {
      logger.info('ai.performance', 'Repository card AI spinner painted', {
        repoId,
        fullName: repository.full_name,
        elapsedMs: Math.round(performance.now() - analysisStartedAt),
      });
    });
    setAnalyzingRepository(repoId, true);
    try {
      const result = await analyzeRepository({
        repository,
        githubToken,
        aiConfig: activeConfig,
        language,
        categories: allCategories,
        onProgress: (status) => {
          logger.info('ai.performance', 'Repository card AI analysis step', {
            repoId,
            fullName: repository.full_name,
            status,
            elapsedMs: Math.round(performance.now() - analysisStartedAt),
          });
        },
        signal: controller.signal,
      });
      logger.info('ai.performance', 'Repository card AI request completed', {
        repoId,
        fullName: repository.full_name,
        elapsedMs: Math.round(performance.now() - analysisStartedAt),
      });

      if (controller.signal.aborted) return;

      const updatedRepo = {
        ...repository,
        ai_summary: result.summary,
        ai_tags: result.tags,
        ai_platforms: result.platforms,
        custom_category: result.custom_category,
        category_locked: result.category_locked,
        analyzed_at: result.analyzed_at,
        analysis_failed: result.analysis_failed,
        analysis_error: undefined,
      };

      const updateStartedAt = performance.now();
      updateRepository(updatedRepo);
      logger.info('ai.performance', 'Repository card AI result stored', {
        repoId,
        fullName: repository.full_name,
        updateMs: Math.round(performance.now() - updateStartedAt),
        elapsedMs: Math.round(performance.now() - analysisStartedAt),
      });

      const successMessage = repository.analyzed_at
        ? (language === 'zh' ? 'AI重新分析完成！' : 'AI re-analysis completed!')
        : (language === 'zh' ? 'AI分析完成！' : 'AI analysis completed!');

      toast(successMessage, 'success');
    } catch (error) {
      if (!controller.signal.aborted) {
        console.error('AI analysis failed:', error);

        const errorMsg = error instanceof Error && error.message
          ? error.message
          : (language === 'zh' ? 'AI分析失败，请检查AI配置和网络连接' : 'AI analysis failed, please check AI configuration and network connection');
        const failedResult = createFailedAnalysisResult(errorMsg);
        const failedRepo = {
          ...repository,
          analyzed_at: failedResult.analyzed_at,
          analysis_failed: failedResult.analysis_failed,
          analysis_error: failedResult.analysis_error,
        };

        const updateStartedAt = performance.now();
        updateRepository(failedRepo);
        logger.info('ai.performance', 'Repository card AI failure stored', {
          repoId,
          fullName: repository.full_name,
          updateMs: Math.round(performance.now() - updateStartedAt),
          elapsedMs: Math.round(performance.now() - analysisStartedAt),
        });

        toast(language === 'zh' ? 'AI分析失败，请检查AI配置和网络连接。' : 'AI analysis failed. Please check AI configuration and network connection.', 'error');
      }
    } finally {
      setIsLocallyAnalyzing(false);
      if (!controller.signal.aborted) {
        setAnalyzingRepository(repoId, false);
      }
    }
  };

  // Convert GitHub URL to DeepWiki URL
  const getDeepWikiUrl = (githubUrl: string) => {
    return githubUrl.replace('github.com', 'deepwiki.com');
  };

  // 查找相似仓库：利用向量检索匹配语义相关的仓库，并进入相似仓库视图
  const handleFindSimilar = async () => {
    if (isFindingSimilar) return;
    if (!vectorSearchAvailable) {
      toast(
        language === 'zh'
          ? '向量搜索未就绪：请先在设置中开启向量搜索并完成索引。'
          : 'Vector search is not ready. Please enable vector search and build the index in settings first.',
        'error'
      );
      return;
    }

    const activeConfig = embeddingConfigs.find((c) => c.id === activeEmbeddingConfig);
    if (!activeConfig) return;

    setIsFindingSimilar(true);
    try {
      const embeddingClient = new EmbeddingClient({
        ...activeConfig,
        apiType: activeConfig.apiType,
        baseUrl: activeConfig.baseUrl,
        apiKey: activeConfig.apiKey,
        model: activeConfig.model,
        dimensions: activeConfig.dimensions,
      });
      const vectorService = new VectorSearchService({
        enabled: true,
        workerUrl: vectorSearchConfig.workerUrl,
        authToken: vectorSearchConfig.authToken,
        embeddingConfigId: activeEmbeddingConfig || '',
      });

      const similar = await findSimilarRepositories(repository, {
        embeddingClient,
        vectorService,
        allRepos: repositories,
        topK: vectorSearchConfig.searchTopK ?? 30,
        threshold: vectorSearchConfig.searchThreshold ?? 0.35,
      });

      enterSimilarView(similar, repository);

      if (similar.length === 0) {
        toast(
          language === 'zh'
            ? '未找到相似的仓库。'
            : 'No similar repositories found.',
          'info'
        );
      }
    } catch (error) {
      console.error('Find similar repositories failed:', error);
      const errorMessage = error instanceof Error && error.message
        ? error.message
        : (language === 'zh' ? '查找相似仓库失败，请检查向量搜索配置。' : 'Failed to find similar repositories. Please check vector search configuration.');
      toast(errorMessage, 'error');
    } finally {
      setIsFindingSimilar(false);
    }
  };

  // Convert GitHub URL to Zread URL
  const getZreadUrl = (fullName: string) => {
    return `https://zread.ai/${fullName}`;
  };

  // 使用 useMemo 缓存显示内容计算
  // 方案一：分离内容与状态指示，同时显示多个状态标签
  const displayContent = useMemo(() => {
    // 确定显示的内容（按优先级）
    // custom_description === '' 表示用户明确清空，应显示为空
    // custom_description === undefined 表示无自定义，回退到AI/原始
    let content: string;
    let contentSource: 'custom' | 'ai' | 'original' | 'empty';

    // 检查是否有明确的自定义描述（包括空标记）
    const hasExplicitCustomDesc = repository.custom_description !== undefined;
    const isExplicitlyCleared = repository.custom_description === '';

    if (isExplicitlyCleared) {
      // 用户明确清空描述
      content = language === 'zh' ? '（无描述）' : '(No description)';
      contentSource = 'empty';
    } else if (repository.custom_description) {
      // 有自定义描述
      content = repository.custom_description;
      contentSource = 'custom';
    } else if (showAISummary && repository.ai_summary) {
      // 显示AI总结
      content = repository.ai_summary;
      contentSource = 'ai';
    } else if (repository.description) {
      // 显示原始描述
      content = repository.description;
      contentSource = 'original';
    } else {
      // 无可用描述
      content = language === 'zh' ? '暂无描述' : 'No description available';
      contentSource = 'empty';
    }

    if (showAISummary && repository.analysis_failed) {
      if (isExplicitlyCleared) {
        content = language === 'zh' ? '（无描述）' : '(No description)';
        contentSource = 'empty';
      } else if (repository.custom_description) {
        content = repository.custom_description;
        contentSource = 'custom';
      } else if (repository.description) {
        content = repository.description;
        contentSource = 'original';
      } else {
        content = language === 'zh' ? '暂无描述' : 'No description available';
        contentSource = 'empty';
      }
    }

    // 判断仓库是否有任何自定义行为（与筛选器逻辑一致）
    // 描述：有自定义描述标记（包括明确清空），且内容与AI/原始不同
    const hasCustomDesc = repository.custom_description !== undefined;
    const repoDesc = (repository.description || '').trim();
    const aiDesc = (repository.ai_summary || '').trim();
    const customDesc = (repository.custom_description || '').trim();
    const isDescEdited = hasCustomDesc &&
      (customDesc === '' || (customDesc !== repoDesc && customDesc !== aiDesc));

    // 标签：有自定义标签标记（包括明确清空），且内容与AI/Topics不同
    const hasCustomTags = repository.custom_tags !== undefined;
    const aiTags = repository.ai_tags || [];
    const topics = repository.topics || [];
    const customTags = repository.custom_tags || [];
    const isTagsEdited = hasCustomTags &&
      (customTags.length === 0 || (
        JSON.stringify([...customTags].sort()) !== JSON.stringify([...aiTags].sort()) &&
        JSON.stringify([...customTags].sort()) !== JSON.stringify([...topics].sort())
      ));

    // 分类：有自定义分类标记（包括明确清空），且与AI/默认不一致
    const aiCat = getAICategory(repository, allCategories);
    const defaultCat = getDefaultCategory(repository, allCategories);
    const customCat = repository.custom_category;
    const isCategoryEdited = customCat !== undefined &&
      (customCat === '' || (customCat !== aiCat && customCat !== defaultCat));

    // 任意一个为true则显示已自定义（注意：分类锁定不算自定义）
    const isCustomized = isDescEdited || isTagsEdited || isCategoryEdited;

    return {
      content,
      contentSource,
      hasCustomDescription: hasExplicitCustomDesc,
      hasAISummary: !!repository.ai_summary,
      isAnalysisFailed: !!repository.analysis_failed,
      isAnalyzed: !!repository.analyzed_at,
      analyzedAt: repository.analyzed_at,
      isExplicitlyCleared,
      isCustomized
    };
  }, [repository, showAISummary, language, allCategories]);

  // 使用 useMemo 缓存标签计算
  // 逻辑：优先显示自定义标签，如果没有则按AI分析状态显示AI标签或Topics
  const displayTags = useMemo(() => {
    // 检查是否有明确的自定义标签设置（包括空数组）
    const hasExplicitCustomTags = repository.custom_tags !== undefined;
    const isExplicitlyCleared = hasExplicitCustomTags && repository.custom_tags!.length === 0;

    // 优先显示自定义标签（如果非空）
    if (repository.custom_tags && repository.custom_tags.length > 0) {
      return {
        tags: repository.custom_tags.map(tag => ({ tag, source: 'custom' as const })),
        tagType: 'custom' as const,
        hasExplicitCustomTags,
        isExplicitlyCleared
      };
    }

    // 如果用户明确清空标签，显示空状态
    if (isExplicitlyCleared) {
      return {
        tags: [],
        tagType: 'empty' as const,
        hasExplicitCustomTags,
        isExplicitlyCleared
      };
    }

    // 没有自定义标签时，按AI分析状态显示
    const isAnalyzed = !!repository.analyzed_at && !repository.analysis_failed;
    if (isAnalyzed && repository.ai_tags && repository.ai_tags.length > 0) {
      return {
        tags: repository.ai_tags.map(tag => ({ tag, source: 'ai' as const })),
        tagType: 'ai' as const,
        hasExplicitCustomTags,
        isExplicitlyCleared
      };
    } else {
      const topics = repository.topics || [];
      return {
        tags: topics.map(tag => ({ tag, source: 'topic' as const })),
        tagType: 'topic' as const,
        hasExplicitCustomTags,
        isExplicitlyCleared
      };
    }
  }, [repository.custom_tags, repository.analyzed_at, repository.analysis_failed, repository.ai_tags, repository.topics]);

  // 使用 useMemo 缓存AI分析按钮提示文本
  const aiButtonTitle = useMemo(() => {
    if (repository.analysis_failed) {
      const analyzeTime = new Date(repository.analyzed_at!).toLocaleString();
      return language === 'zh'
        ? `分析失败于 ${analyzeTime}，点击重新分析`
        : `Analysis failed on ${analyzeTime}, click to retry`;
    } else if (repository.analyzed_at) {
      const analyzeTime = new Date(repository.analyzed_at).toLocaleString();
      return language === 'zh'
        ? `已于 ${analyzeTime} 分析过，点击重新分析`
        : `Analyzed on ${analyzeTime}, click to re-analyze`;
    } else {
      return language === 'zh' ? 'AI分析此仓库' : 'Analyze with AI';
    }
  }, [repository.analysis_failed, repository.analyzed_at, language]);

  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

  const handleUnstar = async () => {
    if (!githubToken) {
      toast(t('未找到 GitHub Token，请重新登录。', 'GitHub token not found. Please login again.'), 'error');
      return;
    }

    const confirmMessage = language === 'zh'
      ? `确定要取消 Star "${repository.full_name}" 吗？\n\n这将会从您的 GitHub 收藏中移除该仓库。`
      : `Are you sure you want to unstar "${repository.full_name}"?\n\nThis will remove the repository from your GitHub stars.`;

    if (!await confirm(t('取消Star确认', 'Unstar Confirmation'), confirmMessage, { type: 'danger', confirmText: t('取消Star', 'Unstar') })) {
      return;
    }

    setUnstarring(true);
    try {
      const githubApi = new GitHubApiService(githubToken);
      const [owner, repo] = repository.full_name.split('/');
      await githubApi.unstarRepository(owner, repo);
      deleteRepository(repository.id);
      await forceSyncToBackend();
      const successMessage = language === 'zh'
        ? '已成功取消 Star'
        : 'Successfully unstarred';
      toast(successMessage, 'success');
    } catch (error) {
      console.error('Failed to unstar repository:', error);
      const errorMessage = language === 'zh'
        ? '取消 Star 失败，请检查网络连接或重新登录。'
        : 'Failed to unstar repository. Please check your network connection or login again.';
      toast(errorMessage, 'error');
    } finally {
      setUnstarring(false);
    }
  };

  const dragStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false);
  const dragHandleRef = useRef<HTMLDivElement>(null);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const isTouchDraggingRef = useRef(false);

  const handleDragStart = (event: React.DragEvent<HTMLDivElement>) => {
    event.dataTransfer.setData('application/x-gsm-repository-id', String(repository.id));
    event.dataTransfer.effectAllowed = 'move';

    // 设置拖拽图片为整个卡片
    const cardElement = event.currentTarget.closest('.repository-card') as HTMLElement;
    if (cardElement) {
      const rect = cardElement.getBoundingClientRect();
      // offsetX/Y 使拖拽图片中心对准鼠标位置
      event.dataTransfer.setDragImage(cardElement, event.clientX - rect.left, event.clientY - rect.top);
    }

    event.stopPropagation();
    isDraggingRef.current = true;
    // 标记正在拖拽，防止触发卡片点击
    (window as Window & { __isDraggingRepo?: boolean }).__isDraggingRepo = true;
  };

  const handleDragEnd = () => {
    isDraggingRef.current = false;
    // 拖拽结束后延迟清除标记，确保 click 事件能检测到拖拽状态
    setTimeout(() => {
      (window as Window & { __isDraggingRepo?: boolean }).__isDraggingRepo = false;
    }, 200);
  };

  const handleDragHandleMouseDown = (event: React.MouseEvent) => {
    dragStartPosRef.current = { x: event.clientX, y: event.clientY };
    event.stopPropagation();
  };

  const handleDragHandleClick = (event: React.MouseEvent) => {
    // 如果发生了拖拽，阻止点击事件
    if (isDraggingRef.current || (window as Window & { __isDraggingRepo?: boolean }).__isDraggingRepo) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  // 移动端触摸拖拽处理
  const handleTouchStart = (event: React.TouchEvent) => {
    const touch = event.touches[0];
    touchStartPosRef.current = { x: touch.clientX, y: touch.clientY };
    isTouchDraggingRef.current = false;
  };

  const handleTouchMove = (event: React.TouchEvent) => {
    if (!touchStartPosRef.current) return;
    
    const touch = event.touches[0];
    const deltaX = Math.abs(touch.clientX - touchStartPosRef.current.x);
    const deltaY = Math.abs(touch.clientY - touchStartPosRef.current.y);
    
    // 如果移动距离超过阈值，认为是拖拽
    if (deltaX > 10 || deltaY > 10) {
      isTouchDraggingRef.current = true;
    }
  };

  const handleTouchEnd = () => {
    if (isTouchDraggingRef.current) {
      // 如果发生了拖拽，阻止后续点击事件
      (window as Window & { __isDraggingRepo?: boolean }).__isDraggingRepo = true;
      setTimeout(() => {
        (window as Window & { __isDraggingRepo?: boolean }).__isDraggingRepo = false;
      }, 200);
    }
    touchStartPosRef.current = null;
    isTouchDraggingRef.current = false;
  };

  // 使用 ref 记录当前选中状态，避免闭包问题
  const isSelectedRef = useRef(isSelected);
  useEffect(() => {
    isSelectedRef.current = isSelected;
  }, [isSelected]);

  // 使用 ref 来跟踪是否已经处理了点击
  const isProcessingClickRef = useRef(false);

  const hideDescriptionTooltip = useCallback(() => {
    if (tooltipHideTimerRef.current) {
      clearTimeout(tooltipHideTimerRef.current);
      tooltipHideTimerRef.current = null;
    }
    setShowTooltip(false);
  }, []);

  // 使用 useCallback 优化事件处理函数
  const handleCardClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    // 防止重复处理
    if (isProcessingClickRef.current) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    // 如果正在拖拽，不处理点击
    if (isDraggingRef.current || (window as Window & { __isDraggingRepo?: boolean }).__isDraggingRepo) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    // 检查点击目标是否是交互元素或其子元素
    const target = event.target as HTMLElement;
    // 排除卡片本身的 role="button"，只检查子元素的交互元素
    const isInteractiveElement = target.closest('button, a, input, textarea, select, [draggable="true"]');

    // 如果点击的是交互元素，不处理
    if (isInteractiveElement) return;

    // 如果选择模式下，点击卡片切换选择状态
    if (selectionMode && onSelect) {
      // 阻止默认行为以防止焦点改变导致页面滚动
      event.preventDefault();
      event.stopPropagation();
      // 设置标志防止重复处理
      isProcessingClickRef.current = true;
      // 立即执行选择操作
      onSelect(repository.id);
      // 重置标志
      setTimeout(() => {
        isProcessingClickRef.current = false;
      }, 50);
      return;
    }

    // 打开 README 模态框前隐藏描述悬浮提示，避免遮挡预览层
    hideDescriptionTooltip();
    setReadmeModalOpen(true);
  }, [selectionMode, onSelect, repository.id, hideDescriptionTooltip]);

  // 处理鼠标按下事件，阻止焦点变化导致页面滚动
  const handleMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    // 在选择模式下，阻止默认行为以防止焦点变化
    if (selectionMode && onSelect) {
      event.preventDefault();
    }
  }, [selectionMode, onSelect]);

  // 处理键盘事件，使卡片可键盘操作
  // 当编辑模态框或README模态框打开时，禁用卡片键盘事件
  const isModalOpen = editModalOpen || readmeModalOpen;
  
  const handleCardKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    // 如果任何模态框打开，不处理键盘事件
    if (isModalOpen) return;
    
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (selectionMode && onSelect) {
        hideDescriptionTooltip();
        onSelect(repository.id);
      } else {
        hideDescriptionTooltip();
        setReadmeModalOpen(true);
      }
    }
  }, [selectionMode, onSelect, repository.id, isModalOpen, hideDescriptionTooltip]);

  // 使用 useMemo 缓存卡片类名，避免重复计算
  const cardClassName = useMemo(() => {
    const baseClasses = 'repository-card group bg-white dark:bg-panel-dark rounded-xl border border-black/[0.06] dark:border-white/[0.04] p-6 shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 hover:border-black/10 dark:hover:border-white/10 flex flex-col h-full cursor-pointer select-none';
    const selectedClasses = isSelected
      ? 'shadow-[0_0_0_2px_theme(colors.blue.500)] dark:shadow-[0_0_0_2px_theme(colors.brand.violet)] bg-gray-100 dark:bg-white/[0.04] dark:bg-brand-indigo/10'
      : '';
    const exitingClasses = isExitingSelection && isSelected ? 'animate-selection-exit' : '';
    return `${baseClasses} ${selectedClasses} ${exitingClasses}`.trim();
  }, [isSelected, isExitingSelection]);

  return (
    <div
      className={cardClassName}
      onClick={handleCardClick}
      onMouseDown={handleMouseDown}
      onKeyDown={handleCardKeyDown}
      tabIndex={isModalOpen ? -1 : 0}
      role="button"
      aria-label={`${repository.full_name} - ${repository.description || 'No description'}`}
      data-selection-mode={selectionMode}
      aria-disabled={isModalOpen}
    >
      {/* Header - Repository Info */}
      <div className="flex items-start space-x-3 mb-3">
        <img
          src={repository.owner.avatar_url}
          alt={repository.owner.login}
          className="w-8 h-8 rounded-full flex-shrink-0"
        />
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-gray-900 dark:text-text-primary truncate">
            {highlightSearchTerm(repository.name, searchQuery)}
          </h3>
          <p className="text-sm text-gray-500 dark:text-text-secondary truncate">
            {repository.owner.login}
          </p>
        </div>
        
        {/* 拖拽按钮 - 右上角 - 手机和平板端隐藏 */}
        {!selectionMode && (
          <div className="hidden lg:block relative flex-shrink-0 mt-[-4px] opacity-0 hover:opacity-100 transition-opacity duration-200 group-hover:opacity-100">
            <div
              ref={dragHandleRef}
              draggable
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onMouseDown={handleDragHandleMouseDown}
              onClick={(e) => {
                handleDragHandleClick(e);
                // 显示弱气泡提示
                setShowDragHint(true);
                if (dragHintTimeoutRef.current) {
                  clearTimeout(dragHintTimeoutRef.current);
                }
                dragHintTimeoutRef.current = setTimeout(() => {
                  setShowDragHint(false);
                }, 2000);
              }}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              className="flex items-center justify-center w-8 h-8 rounded-lg cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-700 dark:text-text-tertiary dark:hover:text-gray-900 hover:bg-light-surface dark:hover:bg-white/5 transition-all duration-200 touch-manipulation"
              title={language === 'zh' ? '拖拽我到侧栏以分类' : 'Drag me to sidebar to categorize'}
            >
              <GripVertical className="w-4 h-4" />
            </div>
            {/* 弱气泡提示 */}
            {showDragHint && (
              <div className="absolute top-full right-0 mt-2 px-3 py-1.5 bg-gray-800 dark:bg-surface-3 text-white dark:text-text-primary text-xs rounded-lg shadow-dialog dark:border dark:border-white/[0.04] whitespace-nowrap z-50 animate-fade-in">
                {language === 'zh' ? '拖拽我到左侧分类栏' : 'Drag me to left sidebar'}
                {/* 气泡箭头 */}
                <div className="absolute bottom-full right-3 w-0 h-0 border-l-4 border-r-4 border-b-4 border-l-transparent border-r-transparent border-b-gray-800 dark:border-b-surface-3"></div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Action Buttons Row - Left and Right Aligned */}
      <div className="flex items-center justify-between mb-4">
        {/* Left side: AI Analysis, Release Subscription, and Edit */}
        <div className="flex items-center gap-1.5">
          <SelectionAwareButton
            onClick={handleAIAnalyze}
            disabled={isAnalyzing}
            selectionMode={selectionMode}
            className={`${
              repository.analysis_failed
              ? 'bg-gray-100 text-gray-700 hover:bg-gray-200 hover:text-gray-900 dark:bg-white/[0.04] dark:text-text-secondary dark:hover:bg-white/[0.08] dark:hover:text-text-primary'
              : repository.analyzed_at
                ? 'bg-gray-100 text-gray-700 hover:bg-gray-200 hover:text-gray-900 dark:bg-white/[0.04] dark:text-text-secondary dark:hover:bg-white/[0.08] dark:hover:text-text-primary'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200 hover:text-gray-900 dark:bg-white/[0.04] dark:text-text-secondary dark:hover:bg-white/[0.08] dark:hover:text-text-primary'
            }`}
            title={aiButtonTitle}
          >
            {isAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bot className="w-4 h-4" />}
          </SelectionAwareButton>
          <SelectionAwareButton
            onClick={() => toggleReleaseSubscription(repository.id)}
            selectionMode={selectionMode}
            className={`${isSubscribed
              ? 'bg-brand-indigo text-white shadow-sm dark:bg-brand-indigo/80 dark:text-white'
              : 'bg-gray-100 text-gray-700 dark:bg-white/[0.04] dark:text-text-secondary hover:bg-gray-200 hover:text-gray-900 dark:hover:bg-white/[0.08] dark:hover:text-text-primary'
            }`}
            title={isSubscribed ? (language === 'zh' ? '取消订阅发布' : 'Unsubscribe from releases') : (language === 'zh' ? '订阅发布' : 'Subscribe to releases')}
          >
            {isSubscribed ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
          </SelectionAwareButton>
          <SelectionAwareButton
            onClick={() => setEditModalOpen(true)}
            selectionMode={selectionMode}
            variant="edit"
            title={language === 'zh' ? '编辑仓库信息' : 'Edit repository info'}
          >
            <Edit3 className="w-4 h-4" />
          </SelectionAwareButton>
        </div>

        {/* Right side: Zread/DeepWiki, GitHub Links, and Unstar */}
        <div className="flex items-center gap-1.5">
          <a
            href={language === 'zh' ? getZreadUrl(repository.full_name) : getDeepWikiUrl(repository.html_url)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => selectionMode && e.preventDefault()}
            className={`flex items-center justify-center w-8 h-8 rounded-lg bg-gray-100 dark:bg-white/[0.04] text-gray-700 dark:text-text-secondary dark:bg-brand-indigo/20 dark:text-brand-violet hover:bg-gray-100 dark:bg-white/[0.04] dark:hover:bg-brand-indigo/30 transition-colors ${selectionMode ? 'pointer-events-none opacity-50' : ''}`}
            title={language === 'zh' ? '在Zread中查看' : 'View on DeepWiki'}
          >
            <BookOpen className="w-4 h-4" />
          </a>
          <a
            href={repository.html_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => selectionMode && e.preventDefault()}
            className={`flex items-center justify-center w-8 h-8 rounded-lg bg-gray-100 text-gray-700 dark:bg-white/[0.04] dark:text-text-secondary hover:bg-gray-200 hover:text-gray-900 dark:hover:bg-white/[0.08] dark:hover:text-text-primary transition-colors ${selectionMode ? 'pointer-events-none opacity-50' : ''}`}
            title={language === 'zh' ? '在GitHub上查看' : 'View on GitHub'}
          >
            <ExternalLink className="w-4 h-4" />
          </a>
          <SelectionAwareButton
            onClick={handleUnstar}
            disabled={unstarring}
            selectionMode={selectionMode}
            variant="unstar"
            title={language === 'zh' ? '取消 Star' : 'Unstar'}
          >
            <StarOff className={`w-4 h-4 ${unstarring ? 'animate-pulse' : ''}`} />
          </SelectionAwareButton>
        </div>
      </div>

      {/* Description with Tooltip */}
      <div className="mb-4 flex-1">
        <div
          ref={descTriggerRef}
          className="relative group"
          onMouseEnter={() => { if (tooltipHideTimerRef.current) clearTimeout(tooltipHideTimerRef.current); setShowTooltip(true); }}
          onMouseLeave={() => { tooltipHideTimerRef.current = setTimeout(() => setShowTooltip(false), 150); }}
          onFocus={() => { if (tooltipHideTimerRef.current) clearTimeout(tooltipHideTimerRef.current); setShowTooltip(true); }}
          onBlur={() => { tooltipHideTimerRef.current = setTimeout(() => setShowTooltip(false), 150); }}
          onTouchStart={() => setShowTooltip((v) => !v)}
          tabIndex={0}
        >
          <p
            className="text-gray-800 dark:text-text-secondary text-[13px] leading-[1.625] line-clamp-3 mb-2 transition-colors duration-200 hover:text-gray-900 dark:hover:text-text-primary rounded px-1 -mx-1 hover:bg-gray-50/50 dark:hover:bg-white/[0.02]"
          >
            {highlightSearchTerm(displayContent.content, searchQuery)}
          </p>
          <FloatingTooltip
            content={highlightSearchTerm(displayContent.content, searchQuery)}
            visible={showTooltip}
            triggerRef={descTriggerRef}
            onMouseEnter={() => { if (tooltipHideTimerRef.current) clearTimeout(tooltipHideTimerRef.current); }}
            onMouseLeave={() => { tooltipHideTimerRef.current = setTimeout(() => setShowTooltip(false), 150); }}
          />
        </div>

        {/* 方案一：同时显示多个状态标签 */}
        <div className="flex items-center space-x-2 flex-wrap gap-y-1">
          {/* 已自定义标签 - 与筛选器逻辑一致 */}
          {displayContent.isCustomized && (
            <div className="flex items-center space-x-1 text-xs text-gray-700 dark:text-text-secondary" title={language === 'zh' ? '此仓库已自定义（描述、标签或分类）' : 'This repository has been customized (description, tags or category)'}>
              <Edit3 className="w-3 h-3" />
              <span>{language === 'zh' ? '已自定义' : 'Customized'}</span>
            </div>
          )}
          {/* AI 分析状态标签 (合并展示) */}
          {displayContent.isAnalysisFailed ? (
            <div className="flex items-center space-x-1 text-xs text-status-red dark:text-status-red" title={language === 'zh' ? 'AI分析失败，点击AI按钮重新分析' : 'AI analysis failed, click AI button to retry'}>
              <Bot className="w-3 h-3" />
              <span>{language === 'zh' ? '分析失败' : 'Failed'}</span>
              <div className="group relative">
                <HelpCircle className="w-3 h-3 text-status-red/70 dark:text-status-red/70 cursor-help" />
                <div className="absolute left-0 top-full mt-2 w-72 max-w-xs p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white text-xs rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-[9999] whitespace-normal break-words">
                  <p className="text-gray-600 dark:text-gray-300 leading-relaxed">
                    {repository.analysis_error || (language === 'zh' ? 'AI分析失败，请检查AI配置和网络连接' : 'AI analysis failed, please check AI configuration and network connection')}
                  </p>
                  <div className="absolute top-[-4px] left-3 w-2 h-2 bg-white dark:bg-gray-800 border-l border-t border-gray-200 dark:border-gray-700 transform rotate-45"></div>
                </div>
              </div>
            </div>
          ) : displayContent.isAnalyzed ? (
            <div 
              className="flex items-center space-x-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-gradient-to-r from-brand-indigo/10 to-brand-violet/10 text-brand-violet dark:from-brand-indigo/20 dark:to-brand-violet/20 dark:text-brand-violet border border-brand-violet/20 dark:border-brand-violet/20" 
              title={displayContent.analyzedAt ? `${language === 'zh' ? '分析于' : 'Analyzed on'} ${new Date(displayContent.analyzedAt).toLocaleString()}` : ''}
            >
              <Sparkles className="w-3 h-3" />
              <span>{language === 'zh' ? 'AI已分析' : 'AI Analyzed'}</span>
            </div>
          ) : null}
        </div>
      </div>

      {/* Tags - 未AI分析时显示Topics，AI分析后显示AI标签 */}
      {displayTags.tags.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {displayTags.tags.map((tagItem, index) => (
            <span
              key={`tag-${index}`}
              className="px-2 py-1 rounded-md text-xs font-medium bg-gray-100 text-gray-700 dark:bg-white/[0.04] dark:text-text-secondary border border-transparent dark:border-white/[0.04]"
            >
              {highlightSearchTerm(tagItem.tag, searchQuery)}
            </span>
          ))}
        </div>
      )}

      {/* Platform Icons */}
      {repository.ai_platforms && repository.ai_platforms.length > 0 && (
        <div className="flex items-center space-x-2 mb-4">
          <span className="text-xs text-gray-700 dark:text-text-secondary">
            {language === 'zh' ? '支持平台:' : 'Platforms:'}
          </span>
          <div className="flex space-x-1">
            {repository.ai_platforms.slice(0, 6).map((platform, index) => {
              const IconComponent = getPlatformIcon(platform);
              const displayName = getPlatformDisplayName(platform);

              return (
                <div
                  key={index}
                  className="w-6 h-6 flex items-center justify-center bg-light-surface dark:bg-white/[0.04] rounded text-gray-700 dark:text-text-tertiary hover:bg-gray-200 dark:hover:bg-white/10 dark:hover:text-gray-700 transition-colors cursor-default"
                  title={displayName}
                >
                  <IconComponent className="w-3 h-3" />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="space-y-3 mt-auto">
        {/* Language and Stars */}
        <div className="flex items-center space-x-4 text-sm text-gray-700 dark:text-text-secondary">
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

        {/* Update Time / 查找相似仓库 - 悬停时时间淡出，显示高亮按钮 */}
        <div className="flex items-center justify-between text-sm text-gray-700 dark:text-text-secondary pt-2 border-t border-black/[0.04] dark:border-white/[0.04]">
          <div className="relative flex items-center space-x-1 min-w-0">
            <Calendar className={`w-4 h-4 flex-shrink-0 transition-opacity duration-150 ${vectorSearchAvailable && !selectionMode ? 'group-hover:opacity-0' : ''}`} />
            <span className={`truncate transition-opacity duration-150 ${vectorSearchAvailable && !selectionMode ? 'group-hover:opacity-0' : ''}`}>
              {language === 'zh' ? '最近提交' : 'Last pushed'} {formatDistanceToNow(new Date(repository.pushed_at || repository.updated_at), { addSuffix: true })}
            </span>

            {vectorSearchAvailable && !selectionMode && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleFindSimilar();
                }}
                disabled={isFindingSimilar}
                className="absolute inset-y-0 left-0 flex items-center space-x-1 text-brand-violet dark:text-brand-violet font-medium opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity duration-150 hover:underline disabled:cursor-not-allowed disabled:hover:no-underline"
                title={language === 'zh' ? '查找相似仓库' : 'Find similar repositories'}
              >
                {isFindingSimilar ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                <span>{language === 'zh' ? '查找相似仓库' : 'Find similar'}</span>
              </button>
            )}
          </div>

          {/* 选择按钮 */}
          {onSelect && (
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(repository.id);
              }}
              className={`flex items-center justify-center w-8 h-8 rounded-lg transition-colors ${
                isSelected
                  ? 'bg-gray-200 text-gray-900 dark:bg-white/[0.08] dark:text-text-primary'
                  : 'text-gray-400 dark:text-text-tertiary hover:bg-light-surface dark:hover:bg-white/10'
              }`}
              title={isSelected ? (language === 'zh' ? '取消选择' : 'Deselect') : (language === 'zh' ? '选择' : 'Select')}
            >
              {isSelected ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5" />}
            </button>
          )}
        </div>
      </div>

      {/* Repository Edit Modal - Using portal to render outside card container */}
      {editModalOpen && createPortal(
        <RepositoryEditModal
          isOpen={editModalOpen}
          onClose={() => setEditModalOpen(false)}
          repository={repository}
        />,
        document.body
      )}

      {/* README Modal - Using portal to render outside card container */}
      {readmeModalOpen && createPortal(
        <ReadmeModal
          isOpen={readmeModalOpen}
          onClose={() => setReadmeModalOpen(false)}
          repository={repository}
        />,
        document.body
      )}
    </div>
  );
};

// 使用 React.memo 优化，避免不必要的重渲染
export const RepositoryCard = React.memo(RepositoryCardComponent, (prevProps, nextProps) => {
  const allCategoriesEqual = 
    prevProps.allCategories.length === nextProps.allCategories.length &&
    prevProps.allCategories.every((cat, i) => {
      const nextCat = nextProps.allCategories[i];
      return nextCat && 
             cat.id === nextCat.id && 
             cat.name === nextCat.name && 
             JSON.stringify(cat.keywords) === JSON.stringify(nextCat.keywords);
    });

  return (
    prevProps.repository.id === nextProps.repository.id &&
    prevProps.repository.analyzed_at === nextProps.repository.analyzed_at &&
    prevProps.repository.analysis_failed === nextProps.repository.analysis_failed &&
    prevProps.repository.analysis_error === nextProps.repository.analysis_error &&
    prevProps.repository.ai_summary === nextProps.repository.ai_summary &&
    prevProps.repository.ai_tags === nextProps.repository.ai_tags &&
    prevProps.repository.ai_platforms === nextProps.repository.ai_platforms &&
    prevProps.repository.custom_description === nextProps.repository.custom_description &&
    prevProps.repository.custom_tags === nextProps.repository.custom_tags &&
    prevProps.repository.custom_category === nextProps.repository.custom_category &&
    prevProps.repository.category_locked === nextProps.repository.category_locked &&
    prevProps.repository.description === nextProps.repository.description &&
    prevProps.repository.topics === nextProps.repository.topics &&
    prevProps.repository.stargazers_count === nextProps.repository.stargazers_count &&
    prevProps.repository.pushed_at === nextProps.repository.pushed_at &&
    prevProps.repository.updated_at === nextProps.repository.updated_at &&
    prevProps.showAISummary === nextProps.showAISummary &&
    prevProps.searchQuery === nextProps.searchQuery &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.selectionMode === nextProps.selectionMode &&
    prevProps.isExitingSelection === nextProps.isExitingSelection &&
    allCategoriesEqual
  );
});
