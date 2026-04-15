import React, { useState, useMemo, useEffect, useCallback, memo } from 'react';
import { Package, Bell, Search, X, RefreshCw, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { Release } from '../types';
import { useAppStore } from '../store/useAppStore';
import { GitHubApiService } from '../services/githubApi';
import { forceSyncToBackend } from '../services/autoSync';
import { formatDistanceToNow } from 'date-fns';
import { AssetFilterManager } from './AssetFilterManager';
import { PRESET_FILTERS } from '../constants/presetFilters';
import ReleaseCard from './ReleaseCard';

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
  const [itemsPerPage, setItemsPerPage] = useState(20);
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

  const getDownloadLinks = useCallback((release: Release) => {
    const links: Array<{ name: string; url: string; size: number; downloadCount: number }> = [];
    
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

    const downloadRegex = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
    let match;
    while ((match = downloadRegex.exec(release.body)) !== null) {
      const [, name, url] = match;
      if (url.includes('/download/') || url.includes('/releases/') || 
          name.toLowerCase().includes('download') ||
          /\.(exe|dmg|deb|rpm|apk|ipa|zip|tar\.gz|msi|pkg|appimage)$/i.test(url)) {
        if (!links.some(link => link.url === url || link.name === name)) {
          links.push({ name, url, size: 0, downloadCount: 0 });
        }
      }
    }

    return links;
  }, []);

  const subscribedReleases = useMemo(() => 
    releases.filter(release => releaseSubscriptions.has(release.repository.id)),
    [releases, releaseSubscriptions]
  );

  const filteredReleases = useMemo(() => {
    let filtered = subscribedReleases;

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

    if (selectedFilters.length > 0) {
      filtered = filtered.filter(release => {
        const downloadLinks = getDownloadLinks(release);
        return downloadLinks.some(link => matchesActiveFilters(link.name));
      });
    }

    return filtered.sort((a, b) =>
      new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
    );
  }, [subscribedReleases, searchQuery, selectedFilters, matchesActiveFilters, getDownloadLinks]);

  const totalPages = Math.ceil(filteredReleases.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedReleases = filteredReleases.slice(startIndex, startIndex + itemsPerPage);

  const releasesDownloadLinks = useMemo(() => {
    const map = new Map<number, ReturnType<typeof getDownloadLinks>>();
    paginatedReleases.forEach(release => {
      map.set(release.id, getDownloadLinks(release));
    });
    return map;
  }, [paginatedReleases, getDownloadLinks]);

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

  const t = useCallback((zh: string, en: string) => language === 'zh' ? zh : en, [language]);

  const isReleaseUnread = useCallback((releaseId: number) => {
    return !readReleases.has(releaseId);
  }, [readReleases]);

  const getTruncatedBody = useCallback((body: string, maxLength = 300) => {
    if (body.length <= maxLength) return body;

    const lines = body.split(/\n\n|\r\n\r\n|\n|\r\n/);
    let result = '';
    for (const line of lines) {
      if ((result + line).length > maxLength) break;
      result += (result ? '\n\n' : '') + line;
    }

    if (result.length < maxLength * 0.3) {
      let cutPoint = maxLength;
      const safeBreakpoints = ['\n', ' ', ')', ']', '`', '*', '_', '.', ',', ';', '!', '?'];

      for (let i = maxLength; i >= maxLength * 0.5; i--) {
        if (safeBreakpoints.includes(body[i])) {
          cutPoint = i + 1;
          break;
        }
      }

      const beforeCut = body.substring(0, cutPoint);
      const openBrackets = (beforeCut.match(/\[/g) || []).length - (beforeCut.match(/\]/g) || []).length;
      const openParens = (beforeCut.match(/\(/g) || []).length - (beforeCut.match(/\)/g) || []).length;
      const openBackticks = (beforeCut.match(/`/g) || []).length;

      if (openBrackets > 0 || openParens > 0) {
        const lastOpenBracket = beforeCut.lastIndexOf('[');
        const lastOpenParen = beforeCut.lastIndexOf('(');
        const validIndices = [lastOpenBracket, lastOpenParen].filter(i => i >= 0);
        if (validIndices.length > 0) {
          const minIndex = Math.min(...validIndices);
          if (minIndex > maxLength * 0.5) {
            cutPoint = minIndex;
          }
        }
      }

      if (openBackticks % 2 !== 0) {
        const lastBacktick = beforeCut.lastIndexOf('`');
        if (lastBacktick > maxLength * 0.5) {
          cutPoint = lastBacktick;
        }
      }

      result = body.substring(0, cutPoint).trimEnd();
    }

    return result + '...';
  }, []);

  const releasesTruncatedBody = useMemo(() => {
    const map = new Map<number, string>();
    paginatedReleases.forEach(release => {
      map.set(release.id, getTruncatedBody(release.body, 500));
    });
    return map;
  }, [paginatedReleases, getTruncatedBody]);

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
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
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
          const downloadLinks = releasesDownloadLinks.get(release.id) || [];
          const isUnread = isReleaseUnread(release.id);
          const isExpanded = expandedReleases.has(release.id);
          const isFullContent = fullContentReleases.has(release.id);
          const isReleaseNotesCollapsed = collapsedReleaseNotes.has(release.id);
          const isDropdownOpen = openDropdowns.has(release.id);
          const truncatedBody = releasesTruncatedBody.get(release.id) || release.body;
          
          return (
            <ReleaseCard
              key={release.id}
              release={release}
              downloadLinks={downloadLinks}
              isUnread={isUnread}
              isExpanded={isExpanded}
              isFullContent={isFullContent}
              isReleaseNotesCollapsed={isReleaseNotesCollapsed}
              isDropdownOpen={isDropdownOpen}
              truncatedBody={truncatedBody}
              matchesActiveFilters={matchesActiveFilters}
              selectedFilters={selectedFilters}
              onToggleExpansion={() => toggleReleaseExpansion(release.id)}
              onToggleDropdown={() => toggleDropdown(release.id)}
              onToggleFullContent={(e) => toggleFullContent(release.id, e)}
              onToggleReleaseNotes={() => toggleReleaseNotes(release.id)}
              onUnsubscribe={() => handleUnsubscribeRelease(release.repository.id)}
              onMarkAsRead={() => markReleaseAsRead(release.id)}
              language={language}
              formatFileSize={formatFileSize}
            />
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
