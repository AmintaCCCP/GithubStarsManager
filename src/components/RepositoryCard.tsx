import React, { Suspense, useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  getPlatformDisplayName,
  getPlatformIcon,
} from './platformMeta';
import { useRepositoryPlatforms } from '../hooks/useRepositoryPlatforms';
import { GripVertical, Star, StarOff, ExternalLink, Calendar, Bell, BellOff, Bot, Sparkles, Terminal, Edit3, BookOpen, Square, CheckSquare, Loader2, HelpCircle, Search, Scale, MoreHorizontal, PackageOpen, MessageSquareText } from 'lucide-react';
import { Repository, Category } from '../types';
import { useAppStore } from '../store/useAppStore';
import { getAICategory, getDefaultCategory } from '../utils/categoryUtils';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { RepositoryEditModal } from './RepositoryEditModal';
import { ErrorBoundary } from './ErrorBoundary';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { NO_LICENSE_SENTINEL, normalizeLicense } from '../utils/licenseFilter';
import { useRepositoryCardActions } from '../features/repositories/hooks/useRepositoryCardActions';
import { Button } from './ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu';

type DialogContentPointerDownOutsideHandler = NonNullable<
  React.ComponentProps<typeof DialogContent>['onPointerDownOutside']
>;

const LazyReadmeModal = React.lazy(() =>
  import('./ReadmeModal').then((module) => ({ default: module.ReadmeModal }))
);

const LazyRepositoryReleaseSheet = React.lazy(() =>
  import('./RepositoryReleaseSheet').then((module) => ({ default: module.RepositoryReleaseSheet }))
);

const ReadmeModalLoadingFallback: React.FC<{
  onClose: () => void;
  onCloseAutoFocus: () => void;
}> = ({ onClose, onCloseAutoFocus }) => (
  <Dialog open onOpenChange={(open) => !open && onClose()}>
    <DialogContent
      aria-describedby={undefined}
      className="w-[calc(100%_-_2rem)] max-w-[1130px] p-6"
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        onCloseAutoFocus();
      }}
    >
      <DialogTitle className="sr-only">Loading README</DialogTitle>
      <div className="flex min-h-40 flex-col items-center justify-center gap-4" role="status" aria-live="polite">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
        <p className="text-muted-foreground">Loading README...</p>
      </div>
    </DialogContent>
  </Dialog>
);

const ReleaseSheetLoadingFallback: React.FC<{
  onClose: () => void;
  onCloseAutoFocus: () => void;
  onPointerDownOutside: DialogContentPointerDownOutsideHandler;
}> = ({ onClose, onCloseAutoFocus, onPointerDownOutside }) => (
  <Dialog open onOpenChange={(open) => !open && onClose()}>
    <DialogContent
      aria-describedby={undefined}
      className="w-[calc(100%_-_2rem)] max-w-sm p-6"
      onPointerDownOutside={onPointerDownOutside}
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        onCloseAutoFocus();
      }}
    >
      <DialogTitle className="sr-only">Loading releases</DialogTitle>
      <div className="flex min-h-40 flex-col items-center justify-center gap-4" role="status" aria-live="polite">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
        <p className="text-muted-foreground">Loading releases...</p>
      </div>
    </DialogContent>
  </Dialog>
);

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
  const baseClasses = 'h-8 w-8 p-0 rounded-md transition-colors disabled:opacity-50';
  const selectionClasses = selectionMode ? 'pointer-events-none' : '';

  const variantClasses = {
    default: '',
    ai: '', // AI variant uses dynamic classes based on state
    subscribe: '', // Subscribe variant uses dynamic classes based on state
    edit: 'bg-muted text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
    unstar: 'bg-muted text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed',
  };

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    // 阻止事件冒泡，防止触发卡片的点击事件
    e.stopPropagation();
    onClick?.(e);
  };

  return (
    <Button
      {...props}
      size="icon"
      onClick={handleClick}
      disabled={disabled || selectionMode}
      className={`${baseClasses} ${variantClasses[variant]} ${selectionClasses} ${className}`}
    >
      {children}
    </Button>
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
  viewMode?: 'grid' | 'list';
  onAskRepository?: (repository: Repository) => void;
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
  allCategories,
  viewMode = 'grid',
  onAskRepository,
}) => {
  const language = useAppStore((state) => state.language);
  const {
    analyze: handleAIAnalyze,
    findSimilar: handleFindSimilar,
    unstar: handleUnstar,
    toggleReleaseSubscription,
    isSubscribed,
    isAnalyzing,
    isFindingSimilar,
    isUnstarring: unstarring,
    vectorSearchAvailable,
  } = useRepositoryCardActions({ repository, allCategories });

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [readmeModalOpen, setReadmeModalOpen] = useState(false);
  const [releaseSheetOpen, setReleaseSheetOpen] = useState(false);
  const [showDragHint, setShowDragHint] = useState(false);
  const dragHintTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isActionsMenuOpen, setIsActionsMenuOpen] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const menuDismissedByPointerDownRef = useRef(false);
  const releaseSheetOutsideDismissedAtRef = useRef<number | null>(null);
  const editModalOutsideDismissedAtRef = useRef<number | null>(null);
  const gridActionRowRef = useRef<HTMLDivElement>(null);
  const [visibleGridActionCount, setVisibleGridActionCount] = useState(8);

  const restoreReadmeTriggerFocus = useCallback(() => {
    cardRef.current?.focus();
  }, []);

  useEffect(() => {
    if (viewMode !== 'list' || selectionMode) {
      setIsActionsMenuOpen(false);
    }
  }, [viewMode, selectionMode]);

  useEffect(() => {
    if (viewMode !== 'grid') return;

    const updateVisibleActionCount = () => {
      const width = gridActionRowRef.current?.clientWidth ?? 0;
      // A zero width occurs during hidden/JSDOM rendering; retain all actions
      // until a real layout measurement is available.
      if (width === 0) return;
      const capacity = Math.max(1, Math.floor((width + 6) / 38));
      setVisibleGridActionCount(capacity >= 8 ? 8 : Math.max(0, capacity - 1));
    };

    updateVisibleActionCount();
    const observer = new ResizeObserver(updateVisibleActionCount);
    if (gridActionRowRef.current) observer.observe(gridActionRowRef.current);
    window.addEventListener('resize', updateVisibleActionCount);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateVisibleActionCount);
    };
  }, [viewMode]);

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
            className="search-result-highlight px-1"
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

  // 展示平台：优先 release 资产/仓库元数据的确定性识别，无信号时回退 ai_platforms
  const displayPlatforms = useRepositoryPlatforms(repository);

  // Convert GitHub URL to DeepWiki URL
  const getDeepWikiUrl = (githubUrl: string) => {
    return githubUrl.replace('github.com', 'deepwiki.com');
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

  const handleReleaseSheetOutsideDismiss = useCallback<DialogContentPointerDownOutsideHandler>((event) => {
    // Keep the fallback overlay mounted through the current click sequence.
    // Otherwise, closing it on pointerdown can retarget the browser click to this card.
    event.preventDefault();
    releaseSheetOutsideDismissedAtRef.current = Date.now();
    window.setTimeout(() => setReleaseSheetOpen(false), 0);
  }, []);

  const handleEditModalOutsideDismiss = useCallback(() => {
    editModalOutsideDismissedAtRef.current = Date.now();
  }, []);

  // 使用 useCallback 优化事件处理函数
  const handleCardClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const releaseSheetDismissedAt = releaseSheetOutsideDismissedAtRef.current;
    if (releaseSheetDismissedAt !== null) {
      releaseSheetOutsideDismissedAtRef.current = null;
      if (Date.now() - releaseSheetDismissedAt < 250) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }

    const editModalDismissedAt = editModalOutsideDismissedAtRef.current;
    if (editModalDismissedAt !== null) {
      editModalOutsideDismissedAtRef.current = null;
      if (Date.now() - editModalDismissedAt < 250) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }

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

    const dismissedByPointerDown = menuDismissedByPointerDownRef.current;
    menuDismissedByPointerDownRef.current = false;
    if (dismissedByPointerDown) return;

    // 检查点击目标是否是交互元素或其子元素
    const target = event.target as HTMLElement;
    // 排除卡片本身的 role="button"，只检查子元素的交互元素
    const isInteractiveElement = target.closest('button, a, input, textarea, select, [draggable="true"]');

    // 如果点击的是交互元素，不处理
    if (isInteractiveElement) return;

    // 菜单展开时，点击卡片空白处仅收起菜单，不触发详情或选择。
    if (isActionsMenuOpen) {
      setIsActionsMenuOpen(false);
      return;
    }

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

    setReadmeModalOpen(true);
  }, [selectionMode, onSelect, repository.id, isActionsMenuOpen]);

  // 处理鼠标按下事件，阻止焦点变化导致页面滚动
  const handleMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    // 在选择模式下，阻止默认行为以防止焦点变化
    if (selectionMode && onSelect) {
      event.preventDefault();
    }
  }, [selectionMode, onSelect]);

  // 处理键盘事件，使卡片可键盘操作
  // 当编辑模态框或README模态框打开时，禁用卡片键盘事件
  const isModalOpen = editModalOpen || readmeModalOpen || releaseSheetOpen;
  
  const handleCardKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    // 仅由卡片自身获得焦点时处理，避免拦截三点菜单等后代控件的原生键盘行为。
    if (event.target !== event.currentTarget) return;

    // 如果任何模态框打开，不处理键盘事件
    if (isModalOpen) return;
    
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (selectionMode && onSelect) {
        onSelect(repository.id);
      } else {
        setReadmeModalOpen(true);
      }
    }
  }, [selectionMode, onSelect, repository.id, isModalOpen]);

  // 使用 useMemo 缓存卡片类名，避免重复计算
  const cardClassName = useMemo(() => {
    const baseClasses = viewMode === 'list'
      ? 'repository-card repository-card--list ui-card group relative px-6 pt-5 pb-0 transition-[color,background-color,border-color,box-shadow] duration-200 cursor-pointer'
      : 'repository-card ui-card group p-5 transition-[color,background-color,border-color,box-shadow] duration-200 flex flex-col h-full cursor-pointer';
    const selectedClasses = isSelected
      ? 'linear-card-selected'
      : '';
    const exitingClasses = isExitingSelection && isSelected ? 'animate-selection-exit' : '';
    return `${baseClasses} ${selectedClasses} ${exitingClasses}`.trim();
  }, [isSelected, isExitingSelection, viewMode]);

  return (
    <div
      ref={cardRef}
      className={cardClassName}
      onClick={handleCardClick}
      onPointerDown={() => {
        if (!isActionsMenuOpen) {
          menuDismissedByPointerDownRef.current = false;
        }
      }}
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
          className={`${viewMode === 'list' ? 'w-10 h-10' : 'w-8 h-8'} rounded-full flex-shrink-0`}
        />
        <div className="min-w-0 flex-1">
          <h3 className={`${viewMode === 'list' ? 'text-base' : ''} font-semibold text-foreground dark:text-foreground truncate`}>
            {highlightSearchTerm(repository.name, searchQuery)}
          </h3>
          <p className="text-sm text-muted-foreground dark:text-muted-foreground truncate">
            {repository.owner.login}
          </p>
        </div>
        
        {/* 拖拽按钮 - 右上角 - 手机和平板端隐藏 */}
        {viewMode === 'list' && (
          <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
            {displayContent.isAnalysisFailed ? (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-medium bg-destructive/10 text-destructive">
                  <Bot className="w-3 h-3" />
                  {language === 'zh' ? '分析失败' : 'Analysis failed'}
                </span>
            ) : displayContent.isAnalyzed ? (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-medium bg-primary/10 dark:bg-primary/20 text-primary">
                <Sparkles className="w-3 h-3" />
                {language === 'zh' ? '已分析' : 'Analyzed'}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-medium bg-muted dark:bg-muted/40 text-muted-foreground dark:text-muted-foreground">
                <Bot className="w-3 h-3" />
                {language === 'zh' ? '待分析' : 'Not analyzed'}
              </span>
            )}
            {!selectionMode && (
              <Button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setEditModalOpen(true);
                }}
                variant="ghost"
                size="icon"
                className="text-primary"
                title={displayContent.isCustomized ? (language === 'zh' ? '已自定义，编辑仓库信息' : 'Customized, edit repository info') : (language === 'zh' ? '编辑仓库信息' : 'Edit repository info')}
                aria-label={language === 'zh' ? '编辑仓库信息' : 'Edit repository info'}
              >
                <Edit3 className="w-4 h-4" />
              </Button>
            )}
          </div>
        )}

        {viewMode === 'list' && !selectionMode && (
          <DropdownMenu open={isActionsMenuOpen} onOpenChange={setIsActionsMenuOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                title={language === 'zh' ? '更多操作' : 'More actions'}
                aria-label={language === 'zh' ? '更多操作' : 'More actions'}
                onClick={(event) => event.stopPropagation()}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-52"
              onClick={(event) => event.stopPropagation()}
              onPointerDownOutside={(event) => {
                if (cardRef.current?.contains(event.target as Node)) {
                  menuDismissedByPointerDownRef.current = true;
                }
              }}
            >
              <DropdownMenuLabel>{language === 'zh' ? '仓库操作' : 'Repository actions'}</DropdownMenuLabel>
              <DropdownMenuItem
                disabled={isAnalyzing}
                onSelect={() => void handleAIAnalyze()}
              >
                {isAnalyzing ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Bot className="mr-2 h-3.5 w-3.5" />}
                {language === 'zh' ? 'AI 分析' : 'Analyze with AI'}
              </DropdownMenuItem>
              {onAskRepository && (
                <DropdownMenuItem onSelect={() => onAskRepository(repository)}>
                  <MessageSquareText className="mr-2 h-3.5 w-3.5" />
                  {language === 'zh' ? '问答此仓库' : 'Ask this repository'}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => toggleReleaseSubscription()}>
                {isSubscribed ? <Bell className="mr-2 h-3.5 w-3.5" /> : <BellOff className="mr-2 h-3.5 w-3.5" />}
                {isSubscribed ? (language === 'zh' ? '取消订阅 Release' : 'Unsubscribe from releases') : (language === 'zh' ? '订阅 Release' : 'Subscribe to releases')}
              </DropdownMenuItem>
              {vectorSearchAvailable && (
                <DropdownMenuItem disabled={isFindingSimilar} onSelect={() => handleFindSimilar()}>
                  {isFindingSimilar ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Search className="mr-2 h-3.5 w-3.5" />}
                  {language === 'zh' ? '查找同类仓库' : 'Find similar repositories'}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setReleaseSheetOpen(true)}>
                <PackageOpen className="mr-2 h-3.5 w-3.5" />
                {language === 'zh' ? '查看 Release' : 'View releases'}
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a
                  href={language === 'zh' ? getZreadUrl(repository.full_name) : getDeepWikiUrl(repository.html_url)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <BookOpen className="mr-2 h-3.5 w-3.5" />
                  {language === 'zh' ? '在 Zread 中查看' : 'View on DeepWiki'}
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href={repository.html_url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-2 h-3.5 w-3.5" />
                  {language === 'zh' ? '在 GitHub 中查看' : 'View on GitHub'}
                </a>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive" disabled={unstarring} onSelect={() => void handleUnstar()}>
                <StarOff className={`mr-2 h-3.5 w-3.5 ${unstarring ? 'animate-pulse' : ''}`} />
                {language === 'zh' ? '取消 Star' : 'Unstar'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {viewMode === 'grid' && !selectionMode && (
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
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  // 键盘等价的分类操作：打开编辑弹窗完成分类，
                  // 而不是仅显示拖拽提示气泡（拖拽本身无键盘等价物）。
                  setEditModalOpen(true);
                }
              }}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              tabIndex={0}
              role="button"
              aria-label={language === 'zh' ? '编辑仓库分类' : 'Edit repository category'}
              className="linear-icon-button flex items-center justify-center w-8 h-8 cursor-grab active:cursor-grabbing touch-manipulation"
              title={language === 'zh' ? '拖拽我到侧栏以分类' : 'Drag me to sidebar to categorize'}
            >
              <GripVertical className="w-4 h-4" />
            </div>
            {/* 弱气泡提示 */}
            {showDragHint && (
              <div className="absolute top-full right-0 z-50 mt-2 whitespace-nowrap rounded-lg border border-border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-dialog animate-fade-in">
                {language === 'zh' ? '拖拽我到左侧分类栏' : 'Drag me to left sidebar'}
                {/* 气泡箭头 */}
                <div className="absolute bottom-full right-3 h-0 w-0 border-x-4 border-b-4 border-l-transparent border-r-transparent border-b-popover"></div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Grid actions occupy equal slots from the left; tail actions collapse into a menu when space is constrained. */}
      {viewMode === 'grid' && (
        <div ref={gridActionRowRef} data-testid="grid-action-row" className="mb-4 flex w-full items-center justify-start gap-1.5 overflow-hidden">
          {visibleGridActionCount >= 1 && (
            <SelectionAwareButton
              onClick={handleAIAnalyze}
              disabled={isAnalyzing}
              selectionMode={selectionMode}
              className="bg-muted text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              title={aiButtonTitle}
              aria-label={aiButtonTitle}
            >
              {isAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bot className="w-4 h-4" />}
            </SelectionAwareButton>
          )}
          {onAskRepository && visibleGridActionCount >= 2 && (
            <SelectionAwareButton
              onClick={() => onAskRepository(repository)}
              selectionMode={selectionMode}
              className="bg-muted text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              title={language === 'zh' ? '问答此仓库' : 'Ask this repository'}
              aria-label={language === 'zh' ? '问答此仓库' : 'Ask this repository'}
            >
              <MessageSquareText className="w-4 h-4" />
            </SelectionAwareButton>
          )}
          {visibleGridActionCount >= 3 && (
            <SelectionAwareButton
              onClick={() => toggleReleaseSubscription()}
              selectionMode={selectionMode}
              className={`${isSubscribed
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'bg-muted text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground'
              }`}
              title={isSubscribed ? (language === 'zh' ? '取消订阅发布' : 'Unsubscribe from releases') : (language === 'zh' ? '订阅发布' : 'Subscribe to releases')}
              aria-label={isSubscribed ? (language === 'zh' ? '取消订阅发布' : 'Unsubscribe from releases') : (language === 'zh' ? '订阅发布' : 'Subscribe to releases')}
              aria-pressed={isSubscribed}
            >
              {isSubscribed ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
            </SelectionAwareButton>
          )}
          {visibleGridActionCount >= 4 && (
            <SelectionAwareButton
              onClick={() => setEditModalOpen(true)}
              selectionMode={selectionMode}
              variant="edit"
              title={language === 'zh' ? '编辑仓库信息' : 'Edit repository info'}
              aria-label={language === 'zh' ? '编辑仓库信息' : 'Edit repository info'}
            >
              <Edit3 className="w-4 h-4" />
            </SelectionAwareButton>
          )}
          {visibleGridActionCount >= 5 && (
            <SelectionAwareButton
              onClick={() => setReleaseSheetOpen(true)}
              selectionMode={selectionMode}
              className="bg-muted text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              title={language === 'zh' ? '查看 Release' : 'View releases'}
              aria-label={language === 'zh' ? '查看 Release' : 'View releases'}
            >
              <PackageOpen className="w-4 h-4" />
            </SelectionAwareButton>
          )}
          {visibleGridActionCount >= 6 && (
            <a
              href={language === 'zh' ? getZreadUrl(repository.full_name) : getDeepWikiUrl(repository.html_url)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => selectionMode && event.preventDefault()}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground ${selectionMode ? 'pointer-events-none opacity-50' : ''}`}
              title={language === 'zh' ? '在Zread中查看' : 'View on DeepWiki'}
            >
              <BookOpen className="w-4 h-4" />
            </a>
          )}
          {visibleGridActionCount >= 7 && (
            <a
              href={repository.html_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => selectionMode && event.preventDefault()}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground ${selectionMode ? 'pointer-events-none opacity-50' : ''}`}
              title={language === 'zh' ? '在GitHub上查看' : 'View on GitHub'}
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          )}
          {visibleGridActionCount >= 8 && (
            <SelectionAwareButton
              onClick={handleUnstar}
              disabled={unstarring}
              selectionMode={selectionMode}
              variant="unstar"
              title={language === 'zh' ? '取消 Star' : 'Unstar'}
            >
              <StarOff className={`w-4 h-4 ${unstarring ? 'animate-pulse' : ''}`} />
            </SelectionAwareButton>
          )}
          {visibleGridActionCount < 8 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={selectionMode}
                  className="h-8 w-8 shrink-0 rounded-md bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  aria-label={language === 'zh' ? '更多仓库操作' : 'More repository actions'}
                  title={language === 'zh' ? '更多仓库操作' : 'More repository actions'}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-52" onClick={(event) => event.stopPropagation()}>
                {visibleGridActionCount < 1 && (
                  <DropdownMenuItem disabled={isAnalyzing} onSelect={() => void handleAIAnalyze()}>
                    {isAnalyzing ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Bot className="mr-2 h-3.5 w-3.5" />}
                    {language === 'zh' ? 'AI 分析' : 'Analyze with AI'}
                  </DropdownMenuItem>
                )}
                {onAskRepository && visibleGridActionCount < 2 && (
                  <DropdownMenuItem onSelect={() => onAskRepository(repository)}>
                    <MessageSquareText className="mr-2 h-3.5 w-3.5" />
                    {language === 'zh' ? '问答此仓库' : 'Ask this repository'}
                  </DropdownMenuItem>
                )}
                {visibleGridActionCount < 3 && (
                  <DropdownMenuItem onSelect={() => toggleReleaseSubscription()}>
                    {isSubscribed ? <Bell className="mr-2 h-3.5 w-3.5" /> : <BellOff className="mr-2 h-3.5 w-3.5" />}
                    {isSubscribed ? (language === 'zh' ? '取消订阅 Release' : 'Unsubscribe from releases') : (language === 'zh' ? '订阅 Release' : 'Subscribe to releases')}
                  </DropdownMenuItem>
                )}
                {visibleGridActionCount < 4 && (
                  <DropdownMenuItem onSelect={() => setEditModalOpen(true)}>
                    <Edit3 className="mr-2 h-3.5 w-3.5" />
                    {language === 'zh' ? '编辑仓库信息' : 'Edit repository info'}
                  </DropdownMenuItem>
                )}
                {visibleGridActionCount < 5 && (
                  <DropdownMenuItem onSelect={() => setReleaseSheetOpen(true)}>
                    <PackageOpen className="mr-2 h-3.5 w-3.5" />
                    {language === 'zh' ? '查看 Release' : 'View releases'}
                  </DropdownMenuItem>
                )}
                {visibleGridActionCount < 6 && (
                  <DropdownMenuItem asChild>
                    <a href={language === 'zh' ? getZreadUrl(repository.full_name) : getDeepWikiUrl(repository.html_url)} target="_blank" rel="noopener noreferrer">
                      <BookOpen className="mr-2 h-3.5 w-3.5" />
                      {language === 'zh' ? '在 Zread 中查看' : 'View on DeepWiki'}
                    </a>
                  </DropdownMenuItem>
                )}
                {visibleGridActionCount < 7 && (
                  <DropdownMenuItem asChild>
                    <a href={repository.html_url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="mr-2 h-3.5 w-3.5" />
                      {language === 'zh' ? '在 GitHub 中查看' : 'View on GitHub'}
                    </a>
                  </DropdownMenuItem>
                )}
                {visibleGridActionCount < 8 && (
                  <DropdownMenuItem className="text-destructive focus:text-destructive" disabled={unstarring} onSelect={() => void handleUnstar()}>
                    <StarOff className={`mr-2 h-3.5 w-3.5 ${unstarring ? 'animate-pulse' : ''}`} />
                    {language === 'zh' ? '取消 Star' : 'Unstar'}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}

      {/* Description with shared Tooltip */}
      <div className={viewMode === 'list' ? 'mb-3' : 'mb-4 flex-1'}>
        <Tooltip>
          <TooltipTrigger asChild>
            <p
              tabIndex={0}
              className={viewMode === 'list'
                ? 'text-sm leading-6 text-muted-foreground dark:text-muted-foreground line-clamp-2 transition-colors duration-200 hover:text-foreground dark:hover:text-foreground'
                : 'text-foreground dark:text-muted-foreground text-[13px] leading-[1.625] line-clamp-3 mb-2 transition-colors duration-200 hover:text-foreground dark:hover:text-foreground rounded-md px-1 -mx-1 hover:bg-muted dark:hover:bg-card/[0.02]'}
            >
              {highlightSearchTerm(displayContent.content, searchQuery)}
            </p>
          </TooltipTrigger>
          <TooltipContent side="top" align="start" className="max-w-lg whitespace-pre-wrap break-words">
            {displayContent.content}
          </TooltipContent>
        </Tooltip>

        {/* 方案一：同时显示多个状态标签 */}
        {viewMode === 'grid' && (
        <div className="flex items-center space-x-2 flex-wrap gap-y-1">
          {/* 已自定义标签 - 与筛选器逻辑一致 */}
          {displayContent.isCustomized && (
            <div className="flex items-center space-x-1 text-xs text-muted-foreground dark:text-muted-foreground" title={language === 'zh' ? '此仓库已自定义（描述、标签或分类）' : 'This repository has been customized (description, tags or category)'}>
              <Edit3 className="w-3 h-3" />
              <span>{language === 'zh' ? '已自定义' : 'Customized'}</span>
            </div>
          )}
          {/* AI 分析状态标签 (合并展示) */}
          {displayContent.isAnalysisFailed ? (
            <div className="flex items-center space-x-1 text-xs text-destructive dark:text-destructive" title={language === 'zh' ? 'AI分析失败，点击AI按钮重新分析' : 'AI analysis failed, click AI button to retry'}>
              <Bot className="w-3 h-3" />
              <span>{language === 'zh' ? '分析失败' : 'Failed'}</span>
              <div className="group relative">
                <HelpCircle className="w-3 h-3 text-destructive/70 dark:text-destructive/70 cursor-help" />
                <div className="absolute left-0 top-full z-[9999] mt-2 w-72 max-w-xs rounded-lg border border-border bg-popover p-3 text-xs text-popover-foreground opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-[opacity,visibility] whitespace-normal break-words shadow-lg">
                  <p className="text-muted-foreground dark:text-muted-foreground leading-relaxed">
                    {repository.analysis_error || (language === 'zh' ? 'AI分析失败，请检查AI配置和网络连接' : 'AI analysis failed, please check AI configuration and network connection')}
                  </p>
                  <div className="absolute top-[-4px] left-3 h-2 w-2 rotate-45 transform border-l border-t border-border bg-popover"></div>
                </div>
              </div>
            </div>
          ) : displayContent.isAnalyzed ? (
            <div
              className="flex items-center space-x-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 dark:bg-primary/20 text-primary border border-primary/20 dark:border-primary/20"
              title={displayContent.analyzedAt ? `${language === 'zh' ? '分析于' : 'Analyzed on'} ${new Date(displayContent.analyzedAt).toLocaleString()}` : ''}
            >
              <Sparkles className="w-3 h-3" />
              <span>{language === 'zh' ? 'AI已分析' : 'AI Analyzed'}</span>
            </div>
          ) : null}
        </div>
        )}
      </div>

      {/* List mode keeps tags and repository metadata on one wrapping information row. */}
      <div className={viewMode === 'list' ? 'flex flex-wrap items-center gap-x-3 gap-y-2' : 'contents'}>
      {/* Tags - 未AI分析时显示Topics，AI分析后显示AI标签 */}
      {displayTags.tags.length > 0 && (
        <div className={`flex flex-wrap ${viewMode === 'list' ? 'gap-1' : 'gap-2 mb-4'}`}>
          {displayTags.tags.map((tagItem, index) => (
            <span
              key={`tag-${index}`}
              className={`linear-card-tag font-medium ${viewMode === 'list' ? 'px-1.5 py-0.5 text-xs' : 'px-2 py-1 text-xs'}`}
            >
              {highlightSearchTerm(tagItem.tag, searchQuery)}
            </span>
          ))}
        </div>
      )}

      {/* Platform Icons */}
      {viewMode === 'grid' && displayPlatforms.length > 0 && (
        <div className="flex items-center space-x-2 mb-4">
          <span className="text-xs text-muted-foreground dark:text-muted-foreground">
            {language === 'zh' ? '支持平台:' : 'Platforms:'}
          </span>
          <div className="flex space-x-1">
            {displayPlatforms.slice(0, 6).map((platform, index) => {
              const IconComponent = getPlatformIcon(platform);
              const displayName = getPlatformDisplayName(platform);

              return (
                <div
                  key={index}
                  className="linear-platform-icon w-6 h-6 flex items-center justify-center cursor-default"
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
      <div className={viewMode === 'list' ? 'contents' : 'space-y-3 mt-auto'}>
        {/* Language and Stars */}
        <div className={`flex items-center ${viewMode === 'list' ? 'space-x-3 flex-wrap gap-y-1' : 'space-x-4'} text-xs text-muted-foreground dark:text-muted-foreground`}>
          {repository.language && (
            <div className="flex items-center space-x-1 min-w-0">
              <div
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: getLanguageColor(repository.language) }}
              />
              <span className="truncate max-w-20">{repository.language}</span>
            </div>
          )}
          <div className="flex items-center space-x-1 flex-shrink-0">
            <Star className="w-3.5 h-3.5" />
            <span className="truncate max-w-16">{formatNumber(repository.stargazers_count)}</span>
          </div>
          {viewMode === 'list' && displayPlatforms.length > 0 && (
            <div className="flex items-center space-x-1 min-w-0">
              <Terminal className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate max-w-40">{displayPlatforms.slice(0, 3).map(getPlatformDisplayName).join(' · ')}</span>
            </div>
          )}
          {(() => {
            // license：归一化后展示 SPDX id；无 license 不渲染
            const lic = normalizeLicense(repository.license);
            if (lic === NO_LICENSE_SENTINEL) return null;
            return (
              <div className="flex items-center space-x-1 min-w-0">
                <Scale className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="truncate max-w-24">{lic}</span>
              </div>
            );
          })()}
        </div>

        {/* Update time is a compact footer in list mode and stays centered between divider and card edge. */}
        <div className={viewMode === 'list' ? 'basis-full flex-none' : 'mt-4'}>
        <div className={`flex items-center justify-between text-muted-foreground dark:text-muted-foreground border-t ui-divider ${viewMode === 'list' ? 'w-full h-14 mt-4 text-sm leading-5' : 'pt-2 text-sm'}`}>
          <div className="relative flex min-w-0 items-center gap-1.5 leading-none">
            <Calendar className={`w-4 h-4 flex-shrink-0 transition-opacity duration-150 ${viewMode === 'grid' && vectorSearchAvailable && !selectionMode ? 'group-hover:opacity-0' : ''}`} />
            <span className={`truncate transition-opacity duration-150 ${viewMode === 'grid' && vectorSearchAvailable && !selectionMode ? 'group-hover:opacity-0' : ''}`}>
              {language === 'zh' ? '最近提交' : 'Last pushed'} {formatDistanceToNow(new Date(repository.pushed_at || repository.updated_at), { addSuffix: true, ...(language === 'zh' ? { locale: zhCN } : {}) })}
            </span>

            {viewMode === 'grid' && vectorSearchAvailable && !selectionMode && (
              <Button
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  handleFindSimilar();
                }}
                disabled={isFindingSimilar}
                className="absolute -inset-y-1 left-0 flex h-auto items-center space-x-1 text-primary dark:text-primary font-medium opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-events-none group-hover:pointer-events-auto focus-visible:pointer-events-auto transition-opacity duration-150 hover:underline disabled:cursor-not-allowed disabled:hover:no-underline"
                title={language === 'zh' ? '查找相似仓库' : 'Find similar repositories'}
              >
                {isFindingSimilar ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                <span>{language === 'zh' ? '查找相似仓库' : 'Find similar'}</span>
              </Button>
            )}
          </div>


          {/* 选择按钮 */}
          {onSelect && (
            <Button
              variant="ghost"
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(repository.id);
              }}
              className={`flex items-center justify-center w-7 h-7 rounded-md p-0 transition-colors ${
                isSelected
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              }`}
              title={isSelected ? (language === 'zh' ? '取消选择' : 'Deselect') : (language === 'zh' ? '选择' : 'Select')}
              aria-label={isSelected ? (language === 'zh' ? '取消选择' : 'Deselect') : (language === 'zh' ? '选择' : 'Select')}
              aria-pressed={isSelected}
            >
              {isSelected ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5" />}
            </Button>
          )}
        </div>
        </div>
      </div>
      </div>

      {/* Repository Edit Modal - Using portal to render outside card container */}
      {editModalOpen && createPortal(
        <RepositoryEditModal
          isOpen={editModalOpen}
          onClose={() => setEditModalOpen(false)}
          onOutsideDismiss={handleEditModalOutsideDismiss}
          repository={repository}
        />,
        document.body
      )}

      {/* README Modal - lazily loaded and rendered outside the card container */}
      {readmeModalOpen && createPortal(
        <ErrorBoundary>
          <Suspense
            fallback={
              <ReadmeModalLoadingFallback
                onClose={() => setReadmeModalOpen(false)}
                onCloseAutoFocus={restoreReadmeTriggerFocus}
              />
            }
          >
            <LazyReadmeModal
              isOpen={readmeModalOpen}
              onClose={() => setReadmeModalOpen(false)}
              onCloseAutoFocus={restoreReadmeTriggerFocus}
              repository={repository}
            />
          </Suspense>
        </ErrorBoundary>,
        document.body
      )}

      {releaseSheetOpen && createPortal(
        <ErrorBoundary>
          <Suspense
            fallback={
              <ReleaseSheetLoadingFallback
                onClose={() => setReleaseSheetOpen(false)}
                onCloseAutoFocus={restoreReadmeTriggerFocus}
                onPointerDownOutside={handleReleaseSheetOutsideDismiss}
              />
            }
          >
            <LazyRepositoryReleaseSheet
              isOpen={releaseSheetOpen}
              onClose={() => setReleaseSheetOpen(false)}
              onCloseAutoFocus={restoreReadmeTriggerFocus}
              repository={repository}
            />
          </Suspense>
        </ErrorBoundary>,
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
    prevProps.repository.license === nextProps.repository.license &&
    prevProps.repository.stargazers_count === nextProps.repository.stargazers_count &&
    prevProps.repository.pushed_at === nextProps.repository.pushed_at &&
    prevProps.repository.language === nextProps.repository.language &&
    prevProps.repository.updated_at === nextProps.repository.updated_at &&
    prevProps.showAISummary === nextProps.showAISummary &&
    prevProps.searchQuery === nextProps.searchQuery &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.selectionMode === nextProps.selectionMode &&
    prevProps.isExitingSelection === nextProps.isExitingSelection &&
    prevProps.viewMode === nextProps.viewMode &&
    prevProps.onAskRepository === nextProps.onAskRepository &&
    allCategoriesEqual
  );
});
