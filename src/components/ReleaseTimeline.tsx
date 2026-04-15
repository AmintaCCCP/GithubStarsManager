import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { ExternalLink, GitBranch, Calendar, Package, Bell, BellOff, Search, X, RefreshCw, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Download, ChevronDown, ChevronUp, BookOpen, ArrowUpRight, Folder } from 'lucide-react';
import { Release } from '../types';
import { useAppStore } from '../store/useAppStore';
import { GitHubApiService } from '../services/githubApi';
import { forceSyncToBackend } from '../services/autoSync';
import { formatDistanceToNow } from 'date-fns';
import { AssetFilterManager } from './AssetFilterManager';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PRESET_FILTERS } from '../constants/presetFilters';

// Markdown链接组件
interface MarkdownLinkProps {
  href?: string;
  children?: React.ReactNode;
}

const MarkdownLink: React.FC<MarkdownLinkProps> = ({ href, children }) => {
  if (!href) return <>{children}</>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline decoration-blue-400 hover:decoration-blue-600 transition-colors"
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </a>
  );
};

// Markdown渲染组件
interface MarkdownContentProps {
  content: string;
  className?: string;
}

const MarkdownContent: React.FC<MarkdownContentProps> = ({ content, className = '' }) => {
  return (
    <div className={`prose prose-sm dark:prose-invert max-w-none ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: MarkdownLink,
          h1: ({ children }) => <h1 className="text-lg font-bold text-gray-900 dark:text-white mt-4 mb-2">{children}</h1>,
          h2: ({ children }) => <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200 mt-3 mb-2">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mt-2 mb-1">{children}</h3>,
          p: ({ children }) => <p className="text-gray-700 dark:text-gray-300 mb-2 leading-relaxed">{children}</p>,
          ul: ({ children }) => <ul className="list-disc list-inside text-gray-700 dark:text-gray-300 mb-2 space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal list-inside text-gray-700 dark:text-gray-300 mb-2 space-y-1">{children}</ol>,
          li: ({ children }) => <li className="ml-2">{children}</li>,
          code: ({ children, className, inline }) => {
            const isInline = inline || !className;
            return isInline ? (
              <code className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded text-xs font-mono">
                {children}
              </code>
            ) : (
              <pre className="bg-gray-100 dark:bg-gray-800 p-3 rounded-lg overflow-x-auto my-3">
                <code className="text-xs font-mono text-gray-800 dark:text-gray-200">{children}</code>
              </pre>
            );
          },
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-blue-400 dark:border-blue-600 pl-4 py-1 my-2 text-gray-600 dark:text-gray-400 italic bg-gray-50 dark:bg-gray-800/50 rounded-r">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-4 border-gray-200 dark:border-gray-700" />,
          table: ({ children }) => (
            <div className="overflow-x-auto my-3">
              <table className="min-w-full border-collapse border border-gray-200 dark:border-gray-700 text-sm">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-gray-100 dark:bg-gray-800">{children}</thead>,
          th: ({ children }) => (
            <th className="border border-gray-200 dark:border-gray-700 px-3 py-2 text-left font-semibold text-gray-800 dark:text-gray-200">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-gray-200 dark:border-gray-700 px-3 py-2 text-gray-700 dark:text-gray-300">
              {children}
            </td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};

export const ReleaseTimeline: React.FC = () => {
  const { 
    releases, 
    repositories, 
    releaseSubscriptions, 
    readReleases,
    githubToken, 
    language,
    assetFilters,
    addReleases,
    markReleaseAsRead,
    toggleReleaseSubscription,
    updateRepository,
  } = useAppStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilters, setSelectedFilters] = useState<string[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshTime, setLastRefreshTime] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(100);
  const [openDropdowns, setOpenDropdowns] = useState<Set<number>>(new Set());
  const [expandedReleases, setExpandedReleases] = useState<Set<number>>(new Set());
  const [fullContentReleases, setFullContentReleases] = useState<Set<number>>(new Set());
  const [collapsedReleaseNotes, setCollapsedReleaseNotes] = useState<Set<number>>(new Set());

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      // 只有在点击文件列表内部但不是按钮时才关闭
      const dropdown = target.closest('.download-dropdown');
      const button = target.closest('.file-toggle-btn');
      if (!dropdown && !button) {
        setOpenDropdowns(new Set());
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Format file size helper function
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  // Helper function to check if a link matches any active filter
  const matchesActiveFilters = useCallback((linkName: string): boolean => {
    if (selectedFilters.length === 0) return true;
    
    const lowerLinkName = linkName.toLowerCase();
    const activeCustomFilters = assetFilters.filter(filter => selectedFilters.includes(filter.id));
    const activePresetFilters = PRESET_FILTERS.filter(filter => selectedFilters.includes(filter.id));
    
    const matchesCustom = activeCustomFilters.some(filter => 
      filter.keywords.some(keyword => lowerLinkName.includes(keyword.toLowerCase()))
    );
    
    const matchesPreset = activePresetFilters.some(filter => 
      filter.keywords.some(keyword => lowerLinkName.includes(keyword.toLowerCase()))
    );
    
    return matchesCustom || matchesPreset;
  }, [selectedFilters, assetFilters]);

  // Toggle dropdown for a specific release
  const toggleDropdown = (releaseId: number, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setOpenDropdowns(prev => {
      const newSet = new Set(prev);
      if (newSet.has(releaseId)) {
        newSet.delete(releaseId);
      } else {
        newSet.add(releaseId);
      }
      return newSet;
    });
  };

  // Toggle release expansion
  const toggleReleaseExpansion = (releaseId: number) => {
    setExpandedReleases(prev => {
      const newSet = new Set(prev);
      if (newSet.has(releaseId)) {
        newSet.delete(releaseId);
      } else {
        newSet.add(releaseId);
        // Mark as read when expanding
        markReleaseAsRead(releaseId);
      }
      return newSet;
    });
  };

  // Toggle full content view
  const toggleFullContent = (releaseId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setFullContentReleases(prev => {
      const newSet = new Set(prev);
      if (newSet.has(releaseId)) {
        newSet.delete(releaseId);
      } else {
        newSet.add(releaseId);
      }
      return newSet;
    });
  };

  // Toggle release notes collapse
  const toggleReleaseNotes = (releaseId: number, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setCollapsedReleaseNotes(prev => {
      const newSet = new Set(prev);
      if (newSet.has(releaseId)) {
        newSet.delete(releaseId);
      } else {
        newSet.add(releaseId);
      }
      return newSet;
    });
  };

  const getDownloadLinks = (release: Release) => {
    const links: Array<{ name: string; url: string; size: number; downloadCount: number }> = [];
    
    // Use GitHub release assets (this is the correct way to get downloads)
    if (release.assets && release.assets.length > 0) {
      release.assets.forEach(asset => {
        links.push({
          name: asset.name,
          url: asset.browser_download_url,
          size: asset.size,
          downloadCount: asset.download_count
        });
      });
    }

    // Fallback: Extract download links from release body (for custom links)
    const downloadRegex = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
    let match;
    while ((match = downloadRegex.exec(release.body)) !== null) {
      const [, name, url] = match;
      // Only include actual download links (not documentation, etc.)
      if (url.includes('/download/') || url.includes('/releases/') || 
          name.toLowerCase().includes('download') ||
          /\.(exe|dmg|deb|rpm|apk|ipa|zip|tar\.gz|msi|pkg|appimage)$/i.test(url)) {
        // Avoid duplicates with assets
        if (!links.some(link => link.url === url || link.name === name)) {
          links.push({ name, url, size: 0, downloadCount: 0 });
        }
      }
    }

    return links;
  };

  // Filter releases for subscribed repositories
  const subscribedReleases = releases.filter(release => 
    releaseSubscriptions.has(release.repository.id)
  );

  // Apply search and custom filters
  const filteredReleases = useMemo(() => {
    let filtered = subscribedReleases;

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(release => 
        release.repository.name.toLowerCase().includes(query) ||
        release.repository.full_name.toLowerCase().includes(query) ||
        release.tag_name.toLowerCase().includes(query) ||
        release.name.toLowerCase().includes(query) ||
        release.body.toLowerCase().includes(query)
      );
    }

    // Custom asset filters (including presets)
    if (selectedFilters.length > 0) {
      filtered = filtered.filter(release => {
        const downloadLinks = getDownloadLinks(release);
        return downloadLinks.some(link => matchesActiveFilters(link.name));
      });
    }

    return filtered.sort((a, b) =>
      new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
    );
  }, [subscribedReleases, searchQuery, selectedFilters, assetFilters, matchesActiveFilters]);

  // Pagination
  const totalPages = Math.ceil(filteredReleases.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedReleases = filteredReleases.slice(startIndex, startIndex + itemsPerPage);

  // Filter handlers
  const handleFilterToggle = (filterId: string) => {
    setSelectedFilters(prev => 
      prev.includes(filterId)
        ? prev.filter(id => id !== filterId)
        : [...prev, filterId]
    );
    setCurrentPage(1); // Reset to first page when filtering
  };

  const handleClearFilters = () => {
    setSelectedFilters([]);
    setCurrentPage(1);
  };

  const handleRefresh = async () => {
    if (!githubToken) {
      alert(language === 'zh' ? 'GitHub token 未找到，请重新登录。' : 'GitHub token not found. Please login again.');
      return;
    }

    setIsRefreshing(true);
    try {
      const githubApi = new GitHubApiService(githubToken);
      const subscribedRepos = repositories.filter(repo => releaseSubscriptions.has(repo.id));
      
      if (subscribedRepos.length === 0) {
        alert(language === 'zh' ? '没有订阅的仓库。' : 'No subscribed repositories.');
        return;
      }

      let newReleasesCount = 0;
      const allNewReleases: Release[] = [];

      // 获取最新的release时间戳
      const latestReleaseTime = releases.length > 0 
        ? Math.max(...releases.map(r => new Date(r.published_at).getTime()))
        : 0;
      const sinceTimestamp = latestReleaseTime > 0 ? new Date(latestReleaseTime).toISOString() : undefined;

      for (const repo of subscribedRepos) {
        const [owner, name] = repo.full_name.split('/');
        
        // 检查这个仓库是否是新订阅的（没有任何release记录）
        const hasExistingReleases = releases.some(r => r.repository.id === repo.id);
        
        let repoReleases: Release[];
        if (!hasExistingReleases) {
          // 新订阅的仓库，获取全部releases
          repoReleases = await githubApi.getRepositoryReleases(owner, name, 1, 10);
        } else {
          // 已有记录的仓库，增量更新
          repoReleases = await githubApi.getIncrementalRepositoryReleases(owner, name, sinceTimestamp, 10);
        }
        
        // 设置repository信息
        repoReleases.forEach(release => {
          release.repository.id = repo.id;
        });
        
        allNewReleases.push(...repoReleases);
        newReleasesCount += repoReleases.length;
        
        // Rate limiting protection
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      if (allNewReleases.length > 0) {
        addReleases(allNewReleases);
      }

      const now = new Date().toISOString();
      setLastRefreshTime(now);

      const message = language === 'zh'
        ? `刷新完成！发现 ${newReleasesCount} 个新Release。`
        : `Refresh completed! Found ${newReleasesCount} new releases.`;
      
      alert(message);
    } catch (error) {
      console.error('Refresh failed:', error);
      const errorMessage = language === 'zh'
        ? 'Release刷新失败，请检查网络连接。'
        : 'Release refresh failed. Please check your network connection.';
      alert(errorMessage);
    } finally {
      setIsRefreshing(false);
    }
  };

  const clearAllFilters = () => {
    setSearchQuery('');
    setSelectedFilters([]);
    setCurrentPage(1);
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)));
  };

  const getPageNumbers = () => {
    const delta = 2;
    const range = [];
    const rangeWithDots = [];

    for (let i = Math.max(2, currentPage - delta); i <= Math.min(totalPages - 1, currentPage + delta); i++) {
      range.push(i);
    }

    if (currentPage - delta > 2) {
      rangeWithDots.push(1, '...');
    } else {
      rangeWithDots.push(1);
    }

    rangeWithDots.push(...range);

    if (currentPage + delta < totalPages - 1) {
      rangeWithDots.push('...', totalPages);
    } else if (totalPages > 1) {
      rangeWithDots.push(totalPages);
    }

    return rangeWithDots;
  };

  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

  const isReleaseUnread = (releaseId: number) => {
    return !readReleases.has(releaseId);
  };

  // Truncate body for preview - 按段落/换行截断保证 Markdown 完整
  const getTruncatedBody = (body: string, maxLength = 300) => {
    if (body.length <= maxLength) return body;

    // 优先按段落/换行截断
    const lines = body.split(/\n\n|\r\n\r\n|\n|\r\n/);
    let result = '';
    for (const line of lines) {
      if ((result + line).length > maxLength) break;
      result += (result ? '\n\n' : '') + line;
    }

    // 如果按段落截断后内容太少，改用字符截断
    if (result.length < maxLength * 0.3) {
      result = body.substring(0, maxLength);
    }

    return result + '...';
  };

  const handleUnsubscribeRelease = async (repoId: number) => {
    const repo = repositories.find((item) => item.id === repoId);
    if (!repo) {
      alert(t('仓库信息不完整，无法取消订阅。', 'Repository information missing. Cannot unsubscribe.'));
      return;
    }

    const confirmMessage = language === 'zh'
      ? `确定取消订阅 "${repo.full_name}" 的 Release 吗？`
      : `Unsubscribe from releases for "${repo.full_name}"?`;

    if (!confirm(confirmMessage)) {
      return;
    }

    const updatedRepo = { ...repo, subscribed_to_releases: false };
    updateRepository(updatedRepo);
    toggleReleaseSubscription(repo.id);

    try {
      await forceSyncToBackend();
    } catch (error) {
      console.error('Failed to unsubscribe release:', error);
      updateRepository({ ...repo, subscribed_to_releases: true });
      toggleReleaseSubscription(repo.id);
      alert(t('取消订阅失败，请检查后端连接。', 'Failed to unsubscribe. Please check backend connection.'));
      return;
    }

    alert(t('已取消订阅该仓库的 Release。', 'Unsubscribed from repository releases.'));
  };

  if (subscribedReleases.length === 0) {
    const subscribedRepoCount = releaseSubscriptions.size;
    
    return (
      <div className="text-center py-12">
        <Package className="w-16 h-16 text-gray-400 dark:text-gray-600 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
          {subscribedRepoCount === 0 ? t('没有Release订阅', 'No Release Subscriptions') : t('没有最近的Release', 'No Recent Releases')}
        </h3>
        <p className="text-gray-500 dark:text-gray-400 mb-6 max-w-md mx-auto">
          {subscribedRepoCount === 0 
            ? t('从仓库页面订阅仓库Release以在此查看更新。', 'Subscribe to repository releases from the Repositories tab to see updates here.')
            : t(`您已订阅 ${subscribedRepoCount} 个仓库，但没有找到最近的Release。点击下方刷新按钮获取最新更新。`, `You're subscribed to ${subscribedRepoCount} repositories, but no recent releases were found. Click the refresh button below to get the latest updates.`)
          }
        </p>
        
        {/* 刷新按钮 - 在有订阅仓库时显示 */}
        {subscribedRepoCount > 0 && (
          <div className="mb-6">
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="flex items-center space-x-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed mx-auto"
            >
              <RefreshCw className={`w-5 h-5 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>{isRefreshing ? t('刷新中...', 'Refreshing...') : t('刷新Release', 'Refresh Releases')}</span>
            </button>
            {lastRefreshTime && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                {t('上次刷新:', 'Last refresh:')} {formatDistanceToNow(new Date(lastRefreshTime), { addSuffix: true })}
              </p>
            )}
          </div>
        )}

        {subscribedRepoCount === 0 && (
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 max-w-md mx-auto">
            <div className="flex items-center space-x-2 text-blue-700 dark:text-blue-300">
              <Bell className="w-5 h-5" />
              <span className="font-medium">{t('如何订阅:', 'How to subscribe:')}</span>
            </div>
            <p className="text-sm text-blue-600 dark:text-blue-400 mt-2">
              {t('转到仓库页面，点击任何仓库卡片上的铃铛图标以订阅其Release。', 'Go to the Repositories tab and click the bell icon on any repository card to subscribe to its releases.')}
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6 sm:mb-8">
        <div className="flex flex-col gap-4 mb-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
              {t('Release时间线', 'Release Timeline')}
            </h2>
            <p className="text-gray-600 dark:text-gray-400">
              {t(`来自您的 ${releaseSubscriptions.size} 个订阅仓库的最新Release`, `Latest releases from your ${releaseSubscriptions.size} subscribed repositories`)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {/* Last Refresh Time */}
            {lastRefreshTime && (
              <span className="w-full text-sm text-gray-500 dark:text-gray-400 lg:w-auto">
                {t('上次刷新:', 'Last refresh:')} {formatDistanceToNow(new Date(lastRefreshTime), { addSuffix: true })}
              </span>
            )}

            {/* Refresh Button */}
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>{isRefreshing ? t('刷新中...', 'Refreshing...') : t('刷新', 'Refresh')}</span>
            </button>
          </div>
        </div>

        {/* Search and Filters */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-6">
          {/* Search Bar */}
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type="text"
              placeholder={t('搜索Release...', 'Search releases...')}
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full pl-10 pr-10 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setCurrentPage(1);
                }}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Custom Asset Filters */}
          <AssetFilterManager
            selectedFilters={selectedFilters}
            onFilterToggle={handleFilterToggle}
            onClearFilters={handleClearFilters}
          />

          {/* Clear All Filters */}
          {(searchQuery || selectedFilters.length > 0) && (
            <div className="flex justify-end pt-2 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={clearAllFilters}
                className="flex items-center space-x-1 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
              >
                <X className="w-4 h-4" />
                <span>{t('清除所有筛选', 'Clear All Filters')}</span>
              </button>
            </div>
          )}
        </div>

        {/* Results Info and Pagination Controls */}
        <div className="flex flex-col gap-3 mb-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2 sm:gap-4">
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {t(
                `显示 ${startIndex + 1}-${Math.min(startIndex + itemsPerPage, filteredReleases.length)} 共 ${filteredReleases.length} 个Release`,
                `Showing ${startIndex + 1}-${Math.min(startIndex + itemsPerPage, filteredReleases.length)} of ${filteredReleases.length} releases`
              )}
            </span>
            {(searchQuery || selectedFilters.length > 0) && (
              <span className="text-sm text-blue-600 dark:text-blue-400">
                ({t('已筛选', 'filtered')})
              </span>
            )}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
            {/* Items per page selector */}
            <div className="flex items-center space-x-2">
              <span className="text-sm text-gray-600 dark:text-gray-400">{t('每页:', 'Per page:')}</span>
              <select
                value={itemsPerPage}
                onChange={(e) => {
                  setItemsPerPage(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
              >
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
                <option value={500}>500</option>
              </select>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center space-x-1 overflow-x-auto pb-1">
                <button
                  onClick={() => handlePageChange(1)}
                  disabled={currentPage === 1}
                  className="p-2 rounded-lg bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronsLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="p-2 rounded-lg bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                
                {getPageNumbers().map((page, index) => (
                  <button
                    key={index}
                    onClick={() => typeof page === 'number' ? handlePageChange(page) : undefined}
                    disabled={typeof page !== 'number'}
                    className={`px-3 py-2 rounded-lg text-sm ${
                      page === currentPage
                        ? 'bg-blue-600 text-white'
                        : typeof page === 'number'
                        ? 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                        : 'text-gray-400 cursor-default'
                    }`}
                  >
                    {page}
                  </button>
                ))}
                
                <button
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className="p-2 rounded-lg bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handlePageChange(totalPages)}
                  disabled={currentPage === totalPages}
                  className="p-2 rounded-lg bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronsRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Releases List */}
      <div className="space-y-4">
        {paginatedReleases.map(release => {
          const downloadLinks = getDownloadLinks(release);
          const isUnread = isReleaseUnread(release.id);
          const isExpanded = expandedReleases.has(release.id);
          const isFullContent = fullContentReleases.has(release.id);
          const isReleaseNotesCollapsed = collapsedReleaseNotes.has(release.id);
          
          return (
            <div
              key={release.id}
              className={`bg-white dark:bg-gray-800 rounded-xl border transition-all duration-300 ease-in-out ${
                isExpanded 
                  ? 'border-blue-300 dark:border-blue-700 shadow-lg ring-1 ring-blue-100 dark:ring-blue-900' 
                  : 'border-gray-200 dark:border-gray-700 hover:shadow-md hover:border-gray-300 dark:hover:border-gray-600'
              }`}
            >
              {/* Card Header - Clickable to expand */}
              <div
                className="p-3 sm:p-4 cursor-pointer select-none"
                onClick={() => toggleReleaseExpansion(release.id)}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center space-x-2 flex-1 min-w-0">
                    {/* Unread indicator */}
                    {isUnread && (
                      <div className="w-2.5 h-2.5 bg-blue-500 rounded-full flex-shrink-0 animate-pulse"></div>
                    )}
                    <div className="flex items-center justify-center w-8 h-8 sm:w-10 sm:h-10 bg-gradient-to-br from-green-100 to-green-200 dark:from-green-900 dark:to-green-800 rounded-lg flex-shrink-0">
                      <GitBranch className="w-4 h-4 sm:w-5 sm:h-5 text-green-600 dark:text-green-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h4 className="font-semibold text-gray-900 dark:text-white text-base sm:text-lg truncate">
                        {release.repository.name} <span className="text-blue-600 dark:text-blue-400">{release.tag_name}</span>
                      </h4>
                      <p className="text-sm sm:text-base text-gray-500 dark:text-gray-400 truncate">
                        {release.repository.full_name}
                      </p>
                      {release.name && release.name !== release.tag_name && (
                        <p className="text-sm sm:text-base text-gray-600 dark:text-gray-300 truncate">
                          {release.name}
                        </p>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-1.5 flex-shrink-0">
                    {/* Expand/Collapse indicator */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleReleaseExpansion(release.id);
                      }}
                      className={`p-1.5 rounded-lg transition-all duration-300 ${
                        isExpanded
                          ? 'bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300 rotate-180'
                          : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                      }`}
                      aria-label={isExpanded ? t('折叠', 'Collapse') : t('展开', 'Expand')}
                      aria-expanded={isExpanded}
                      aria-controls={`release-content-${release.id}`}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggleReleaseExpansion(release.id);
                        }
                      }}
                    >
                      <ChevronDown className="w-4 h-4 sm:w-5 sm:h-5" />
                    </button>
                  </div>
                </div>

                {/* Quick info row */}
                <div className="flex flex-wrap items-center gap-2 mt-2 pt-2 border-t border-gray-100 dark:border-gray-700">
                  {/* Download Links Summary */}
                  {downloadLinks.length > 0 && (
                    <div className="flex items-center space-x-1.5 text-sm sm:text-base text-gray-600 dark:text-gray-400">
                      <Download className="w-4 h-4 sm:w-5 sm:h-5" />
                      <span>
                        {(() => {
                          const filteredLinks = downloadLinks.filter(link => matchesActiveFilters(link.name));
                          const filteredCount = filteredLinks.length;
                          return selectedFilters.length > 0 && filteredCount !== downloadLinks.length
                            ? `${filteredCount}/${downloadLinks.length} ${t('个文件', 'files')}`
                            : `${downloadLinks.length} ${t('个文件', 'files')}`;
                        })()}
                      </span>
                    </div>
                  )}

                  {/* Time */}
                  <div className="flex items-center space-x-1.5 text-sm sm:text-base text-gray-500 dark:text-gray-400">
                    <Calendar className="w-4 h-4 sm:w-5 sm:h-5" />
                    <span>{formatDistanceToNow(new Date(release.published_at), { addSuffix: true })}</span>
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center space-x-2 ml-auto">
                    {/* 文件夹按钮 - 智能切换文件列表 */}
                    {downloadLinks.length > 0 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          // 如果主卡片未展开，先展开主卡片，再展开文件表
                          // 如果主卡片已展开，只切换文件表
                          if (!isExpanded) {
                            // 展开主卡片
                            toggleReleaseExpansion(release.id);
                            // 展开文件表
                            setOpenDropdowns(prev => {
                              const newSet = new Set(prev);
                              newSet.add(release.id);
                              return newSet;
                            });
                          } else {
                            // 主卡片已展开，只切换文件表
                            setOpenDropdowns(prev => {
                              const newSet = new Set(prev);
                              if (newSet.has(release.id)) {
                                newSet.delete(release.id);
                              } else {
                                newSet.add(release.id);
                              }
                              return newSet;
                            });
                          }
                        }}
                        className={`file-toggle-btn flex items-center space-x-1.5 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg transition-all duration-200 text-xs sm:text-sm font-medium ${
                          openDropdowns.has(release.id)
                            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-800'
                            : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                        }`}
                        title={openDropdowns.has(release.id) ? t('隐藏文件', 'Hide Files') : t('显示文件', 'Show Files')}
                        aria-label={openDropdowns.has(release.id) ? t('隐藏文件', 'Hide Files') : t('显示文件', 'Show Files')}
                        aria-pressed={openDropdowns.has(release.id)}
                      >
                        <Folder className="w-4 h-4 sm:w-5 sm:h-5" />
                        <span className="hidden sm:inline">{openDropdowns.has(release.id) ? t('隐藏文件', 'Hide Files') : t('显示文件', 'Show Files')}</span>
                      </button>
                    )}

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleUnsubscribeRelease(release.repository.id);
                      }}
                      className="p-2 sm:p-2.5 rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                      title={t('取消订阅 Release', 'Unsubscribe from releases')}
                      aria-label={t('取消订阅 Release', 'Unsubscribe from releases')}
                    >
                      <BellOff className="w-4 h-4 sm:w-5 sm:h-5" />
                    </button>
                    <a
                      href={release.html_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 sm:p-2.5 rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                      title={t('在GitHub上查看', 'View on GitHub')}
                      aria-label={t('在GitHub上查看', 'View on GitHub')}
                      onClick={(e) => {
                        e.stopPropagation();
                        markReleaseAsRead(release.id);
                      }}
                    >
                      <ExternalLink className="w-4 h-4 sm:w-5 sm:h-5" />
                    </a>
                  </div>
                </div>
              </div>

              {/* Expanded Content */}
              <div
                id={`release-content-${release.id}`}
                className={`overflow-hidden transition-all duration-300 ease-in-out ${
                  isExpanded ? 'max-h-[5000px] opacity-100' : 'max-h-0 opacity-0'
                }`}
              >
                <div className="px-4 sm:px-6 pb-4 sm:pb-6 border-t border-gray-100 dark:border-gray-700">
                  {/* Download Links Section */}
                  {downloadLinks.length > 0 && (
                    <div className="py-4 relative download-dropdown">
                      <div className="flex items-center justify-between mb-3">
                        {/* 可点击的下载文件标题 */}
                        <button
                          onClick={(e) => toggleDropdown(release.id, e)}
                          className={`flex items-center space-x-2 text-sm font-medium transition-all duration-200 ${
                            openDropdowns.has(release.id)
                              ? 'text-blue-700 dark:text-blue-300'
                              : 'text-gray-700 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400'
                          }`}
                        >
                          <Download className="w-4 h-4" />
                          <span>
                            {(() => {
                              const filteredLinks = downloadLinks.filter(link => matchesActiveFilters(link.name));
                              const filteredCount = filteredLinks.length;
                              return selectedFilters.length > 0 && filteredCount !== downloadLinks.length
                                ? `${t('下载文件', 'Downloads')} (${filteredCount}/${downloadLinks.length})`
                                : `${t('下载文件', 'Downloads')} (${downloadLinks.length})`;
                            })()}
                          </span>
                          <ChevronDown className={`w-4 h-4 transition-transform duration-300 ${openDropdowns.has(release.id) ? 'rotate-180' : ''}`} />
                        </button>
                      </div>
                      
                      {/* Download Links Dropdown */}
                      <div className={`overflow-hidden transition-all duration-300 ${
                        openDropdowns.has(release.id) ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
                      }`}>
                        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700 max-h-80 overflow-y-auto">
                          {(() => {
                            const filteredLinks = downloadLinks.filter(link => matchesActiveFilters(link.name));
                            return filteredLinks.length > 0 ? filteredLinks.map((link, index) => {
                              const asset = release.assets.find(asset => asset.name === link.name);
                              return (
                                <a
                                  key={index}
                                  href={link.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center justify-between px-4 py-3 hover:bg-white dark:hover:bg-gray-700 transition-colors border-b border-gray-200 dark:border-gray-700 last:border-b-0 group"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    markReleaseAsRead(release.id);
                                  }}
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="text-xs sm:text-sm font-medium text-gray-900 dark:text-white truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                                      {link.name}
                                    </div>
                                    <div className="flex items-center space-x-3 text-xs text-gray-500 dark:text-gray-400 mt-1">
                                      {link.size > 0 && (
                                        <span>{formatFileSize(link.size)}</span>
                                      )}
                                      {asset?.updated_at && (
                                        <span>
                                          {formatDistanceToNow(new Date(asset.updated_at), { addSuffix: true })}
                                        </span>
                                      )}
                                      {link.downloadCount > 0 && (
                                        <span>{link.downloadCount.toLocaleString()} {t('次下载', 'downloads')}</span>
                                      )}
                                    </div>
                                  </div>
                                  <Download className="w-4 h-4 text-gray-400 group-hover:text-blue-600 dark:group-hover:text-blue-400 flex-shrink-0 transition-colors" />
                                </a>
                              );
                            }) : (
                              <div className="px-4 py-6 text-center text-gray-500 dark:text-gray-400">
                                <div className="text-sm">{t('没有匹配过滤器的文件', 'No files match the selected filters')}</div>
                                <div className="text-xs mt-1 opacity-75">{t('尝试调整过滤器设置', 'Try adjusting your filter settings')}</div>
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Release Notes Section */}
                  {release.body && (
                    <div className="py-4">
                      {/* Collapsible Header */}
                      <button
                        onClick={(e) => toggleReleaseNotes(release.id, e)}
                        className="w-full flex items-center justify-between mb-3 group"
                      >
                        <h6 className={`text-sm font-medium flex items-center space-x-2 transition-colors duration-200 ${
                          isReleaseNotesCollapsed
                            ? 'text-gray-700 dark:text-gray-300'
                            : 'text-blue-700 dark:text-blue-300'
                        }`}>
                          <BookOpen className="w-4 h-4" />
                          <span>{t('Release 说明', 'Release Notes')}</span>
                          <ChevronDown className={`w-4 h-4 transition-transform duration-300 ${isReleaseNotesCollapsed ? '' : 'rotate-180'}`} />
                        </h6>
                      </button>
                      
                      {/* Collapsible Content */}
                      <div className={`overflow-hidden transition-all duration-300 ease-in-out ${
                        isReleaseNotesCollapsed ? 'max-h-0 opacity-0' : 'max-h-[5000px] opacity-100'
                      }`}>
                        {/* Markdown Content */}
                        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                          <MarkdownContent 
                            content={isFullContent ? release.body : getTruncatedBody(release.body, 500)}
                          />
                        </div>

                        {/* Action Buttons */}
                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mt-4">
                          {/* Read Full Content Button */}
                          {release.body.length > 500 && (
                            <button
                              onClick={(e) => toggleFullContent(release.id, e)}
                              className="flex items-center justify-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 active:bg-blue-800 transition-all duration-200 text-xs sm:text-sm font-medium shadow-sm hover:shadow-md"
                            >
                              {isFullContent ? (
                                <>
                                  <ChevronUp className="w-4 h-4" />
                                  <span>{t('收起内容', 'Collapse Content')}</span>
                                </>
                              ) : (
                                <>
                                  <BookOpen className="w-4 h-4" />
                                  <span>{t('在本地阅读全文', 'Read Full Content Locally')}</span>
                                </>
                              )}
                            </button>
                          )}

                          {/* View on GitHub Button */}
                          <a
                            href={release.html_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-center space-x-2 px-4 py-2 bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 active:bg-gray-300 dark:active:bg-gray-500 transition-all duration-200 text-xs sm:text-sm font-medium"
                            onClick={(e) => {
                              e.stopPropagation();
                              markReleaseAsRead(release.id);
                            }}
                          >
                            <ArrowUpRight className="w-4 h-4" />
                            <span>{t('前往查看完整Release说明', 'View Full Release Notes')}</span>
                          </a>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center mt-8">
          <div className="flex items-center space-x-1">
            <button
              onClick={() => handlePageChange(1)}
              disabled={currentPage === 1}
              className="p-2 rounded-lg bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronsLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 1}
              className="p-2 rounded-lg bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            
            {getPageNumbers().map((page, index) => (
              <button
                key={index}
                onClick={() => typeof page === 'number' ? handlePageChange(page) : undefined}
                disabled={typeof page !== 'number'}
                className={`px-3 py-2 rounded-lg text-sm ${
                  page === currentPage
                    ? 'bg-blue-600 text-white'
                    : typeof page === 'number'
                    ? 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                    : 'text-gray-400 cursor-default'
                }`}
              >
                {page}
              </button>
            ))}
            
            <button
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="p-2 rounded-lg bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => handlePageChange(totalPages)}
              disabled={currentPage === totalPages}
              className="p-2 rounded-lg bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronsRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
