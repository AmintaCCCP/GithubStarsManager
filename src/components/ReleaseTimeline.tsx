import React, { useState, useMemo, useEffect } from 'react';
import { ExternalLink, GitBranch, Calendar, Package, Bell, Search, X, RefreshCw, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Eye, EyeOff, Download, ChevronDown } from 'lucide-react';
import { Release } from '../types';
import { useAppStore } from '../store/useAppStore';
import { GitHubApiService } from '../services/githubApi';
import { formatDistanceToNow, format } from 'date-fns';
import { AssetFilterManager } from './AssetFilterManager';

export const ReleaseTimeline: React.FC = () => {
  const { 
    releases, 
    repositories, 
    releaseSubscriptions, 
    readReleases,
    githubToken, 
    language,
    assetFilters,
    setReleases,
    addReleases,
    markReleaseAsRead,
  } = useAppStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilters, setSelectedFilters] = useState<string[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshTime, setLastRefreshTime] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(100);
  const [viewMode, setViewMode] = useState<'compact' | 'detailed'>('compact');
  const [openDropdowns, setOpenDropdowns] = useState<Set<number>>(new Set());

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      if (!target.closest('.download-dropdown')) {
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

  // Toggle dropdown for a specific release
  const toggleDropdown = (releaseId: number) => {
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
    const downloadRegex = /\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g;
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

    // Custom asset filters
    if (selectedFilters.length > 0) {
      const activeFilters = assetFilters.filter(filter => selectedFilters.includes(filter.id));
      
      filtered = filtered.filter(release => {
        const downloadLinks = getDownloadLinks(release);
        
        return downloadLinks.some(link => 
          activeFilters.some(filter => 
            filter.keywords.some(keyword => 
              link.name.toLowerCase().includes(keyword.toLowerCase())
            )
          )
        );
      });
    }

    return filtered.sort((a, b) => 
      new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
    );
  }, [subscribedReleases, searchQuery, selectedFilters, assetFilters]);

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



  const truncateBody = (body: string, maxLength = 200) => {
    if (body.length <= maxLength) return body;
    return body.substring(0, maxLength) + '...';
  };

  const handleReleaseClick = (releaseId: number) => {
    markReleaseAsRead(releaseId);
  };

  const isReleaseUnread = (releaseId: number) => {
    return !readReleases.has(releaseId);
  };

  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

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
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
              {t('Release时间线', 'Release Timeline')}
            </h2>
            <p className="text-gray-600 dark:text-gray-400">
              {t(`来自您的 ${releaseSubscriptions.size} 个订阅仓库的最新Release`, `Latest releases from your ${releaseSubscriptions.size} subscribed repositories`)}
            </p>
          </div>
          <div className="flex items-center space-x-3">
            {/* View Mode Toggle */}
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setViewMode('compact')}
                className={`p-2 rounded-lg transition-colors ${
                  viewMode === 'compact'
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                    : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
                title={t('精简视图', 'Compact View')}
              >
                <EyeOff className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('detailed')}
                className={`p-2 rounded-lg transition-colors ${
                  viewMode === 'detailed'
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                    : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
                title={t('详细视图', 'Detailed View')}
              >
                <Eye className="w-4 h-4" />
              </button>
            </div>

            {/* Last Refresh Time */}
            {lastRefreshTime && (
              <span className="text-sm text-gray-500 dark:text-gray-400">
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
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-4">
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

          <div className="flex items-center space-x-4">
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
            )}
          </div>
        </div>
      </div>

      {/* Releases List */}
      <div className="space-y-4">
        {paginatedReleases.map(release => {
          const downloadLinks = getDownloadLinks(release);
          const isUnread = isReleaseUnread(release.id);
          
          return (
            <div
              key={release.id}
              className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 hover:shadow-lg transition-shadow cursor-pointer"
              onClick={() => handleReleaseClick(release.id)}
            >
              {viewMode === 'detailed' ? (
                // Detailed View
                <div className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center space-x-3 flex-1 min-w-0">
                      {/* Unread indicator */}
                      {isUnread && (
                        <div className="w-3 h-3 bg-blue-500 rounded-full flex-shrink-0"></div>
                      )}
                      <div className="flex items-center justify-center w-10 h-10 bg-green-100 dark:bg-green-900 rounded-lg flex-shrink-0">
                        <GitBranch className="w-5 h-5 text-green-600 dark:text-green-400" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h4 className="font-semibold text-gray-900 dark:text-white truncate">
                          {release.repository.name} {release.tag_name}
                        </h4>
                        <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                          {release.repository.full_name}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2 flex-shrink-0">
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        {formatDistanceToNow(new Date(release.published_at), { addSuffix: true })}
                      </span>
                      <a
                        href={release.html_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                        title={t('在GitHub上查看', 'View on GitHub')}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleReleaseClick(release.id);
                        }}
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    </div>
                  </div>

                  {release.name && release.name !== release.tag_name && (
                    <h5 className="font-medium text-gray-800 dark:text-gray-200 mb-2">
                      {release.name}
                    </h5>
                  )}

                  {/* Download Links - Dropdown */}
                  {downloadLinks.length > 0 && (
                    <div className="mb-4 relative download-dropdown">
                      <div className="flex items-center justify-between mb-2">
                        <h6 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                          {(() => {
                            // 计算过滤后的文件数量
                            let filteredCount = downloadLinks.length;
                            if (selectedFilters.length > 0) {
                              const activeFilters = assetFilters.filter(filter => selectedFilters.includes(filter.id));
                              const filteredLinks = downloadLinks.filter(link => 
                                activeFilters.some(filter => 
                                  filter.keywords.some(keyword => 
                                    link.name.toLowerCase().includes(keyword.toLowerCase())
                                  )
                                )
                              );
                              filteredCount = filteredLinks.length;
                            }
                            
                            return selectedFilters.length > 0 && filteredCount !== downloadLinks.length
                              ? `${t('下载:', 'Downloads:')} (${filteredCount}/${downloadLinks.length})`
                              : `${t('下载:', 'Downloads:')} (${downloadLinks.length})`;
                          })()}
                        </h6>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleDropdown(release.id);
                          }}
                          className="flex items-center space-x-1 px-3 py-1.5 bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 rounded-lg hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors text-sm"
                        >
                          <Download className="w-4 h-4" />
                          <span>{t('查看下载', 'View Downloads')}</span>
                          <ChevronDown className={`w-4 h-4 transition-transform ${openDropdowns.has(release.id) ? 'rotate-180' : ''}`} />
                        </button>
                      </div>
                      
                      {openDropdowns.has(release.id) && (
                        <div className="absolute z-10 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-80 overflow-y-auto">
                          {(() => {
                            // 如果有激活的过滤器，只显示匹配的文件
                            let filteredLinks = downloadLinks;
                            if (selectedFilters.length > 0) {
                              const activeFilters = assetFilters.filter(filter => selectedFilters.includes(filter.id));
                              filteredLinks = downloadLinks.filter(link => 
                                activeFilters.some(filter => 
                                  filter.keywords.some(keyword => 
                                    link.name.toLowerCase().includes(keyword.toLowerCase())
                                  )
                                )
                              );
                            }
                            
                            return filteredLinks.length > 0 ? filteredLinks.map((link, index) => {
                              const asset = release.assets.find(asset => asset.name === link.name);
                              return (
                                <a
                                  key={index}
                                  href={link.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors border-b border-gray-100 dark:border-gray-600 last:border-b-0 group"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleReleaseClick(release.id);
                                    toggleDropdown(release.id);
                                  }}
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="text-sm font-medium text-gray-900 dark:text-white truncate group-hover:text-blue-600 dark:group-hover:text-blue-400">
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
                                  <Download className="w-4 h-4 text-gray-400 group-hover:text-blue-600 dark:group-hover:text-blue-400 flex-shrink-0" />
                                </a>
                              );
                            }) : (
                              <div className="px-4 py-6 text-center text-gray-500 dark:text-gray-400">
                                <div className="text-sm">
                                  {t('没有匹配过滤器的文件', 'No files match the selected filters')}
                                </div>
                                <div className="text-xs mt-1">
                                  {t('尝试调整过滤器设置', 'Try adjusting your filter settings')}
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  )}

                  {release.body && (
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                      <div className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                        {truncateBody(release.body)}
                      </div>
                      {release.body.length > 200 && (
                        <a
                          href={release.html_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 dark:text-blue-400 hover:underline text-sm mt-2 inline-block"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleReleaseClick(release.id);
                          }}
                        >
                          {t('阅读完整Release说明 →', 'Read full release notes →')}
                        </a>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                // Compact View - Table-like layout
                <div className="p-4">
                  <div className="grid grid-cols-12 gap-4 items-center">
                    {/* Repository and Version - 缩小列宽 */}
                    <div className="col-span-3 min-w-0">
                      <div className="flex items-center space-x-2">
                        {/* Unread indicator */}
                        {isUnread && (
                          <div className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0"></div>
                        )}
                        <div className="w-6 h-6 bg-green-100 dark:bg-green-900 rounded flex items-center justify-center flex-shrink-0">
                          <GitBranch className="w-3 h-3 text-green-600 dark:text-green-400" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-gray-900 dark:text-white text-sm truncate">
                            {release.repository.name}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                            {release.tag_name}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Release Name */}
                    <div className="col-span-3 min-w-0">
                      <p className="text-sm text-gray-900 dark:text-white truncate" title={release.name || release.tag_name}>
                        {release.name || release.tag_name}
                      </p>
                    </div>

                    {/* Download Links - Dropdown */}
                    <div className="col-span-4 min-w-0 relative download-dropdown">
                      {downloadLinks.length > 0 ? (
                        <div className="relative">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleDropdown(release.id);
                            }}
                            className="flex items-center space-x-2 px-3 py-1.5 bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 rounded-lg hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors text-sm w-full justify-between"
                          >
                            <div className="flex items-center space-x-2">
                              <Download className="w-4 h-4" />
                              <span>
                                {(() => {
                                  // 计算过滤后的文件数量
                                  let filteredCount = downloadLinks.length;
                                  if (selectedFilters.length > 0) {
                                    const activeFilters = assetFilters.filter(filter => selectedFilters.includes(filter.id));
                                    const filteredLinks = downloadLinks.filter(link => 
                                      activeFilters.some(filter => 
                                        filter.keywords.some(keyword => 
                                          link.name.toLowerCase().includes(keyword.toLowerCase())
                                        )
                                      )
                                    );
                                    filteredCount = filteredLinks.length;
                                  }
                                  
                                  return selectedFilters.length > 0 && filteredCount !== downloadLinks.length
                                    ? `${filteredCount}/${downloadLinks.length} ${t('个文件', 'files')}`
                                    : `${downloadLinks.length} ${t('个文件', 'files')}`;
                                })()}
                              </span>
                            </div>
                            <ChevronDown className={`w-4 h-4 transition-transform ${openDropdowns.has(release.id) ? 'rotate-180' : ''}`} />
                          </button>
                          
                          {openDropdowns.has(release.id) && (
                            <div className="absolute z-20 left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-64 overflow-y-auto">
                              {(() => {
                                // 如果有激活的过滤器，只显示匹配的文件
                                let filteredLinks = downloadLinks;
                                if (selectedFilters.length > 0) {
                                  const activeFilters = assetFilters.filter(filter => selectedFilters.includes(filter.id));
                                  filteredLinks = downloadLinks.filter(link => 
                                    activeFilters.some(filter => 
                                      filter.keywords.some(keyword => 
                                        link.name.toLowerCase().includes(keyword.toLowerCase())
                                      )
                                    )
                                  );
                                }
                                
                                return filteredLinks.length > 0 ? filteredLinks.map((link, index) => {
                                  const asset = release.assets.find(asset => asset.name === link.name);
                                  return (
                                    <a
                                      key={index}
                                      href={link.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="flex items-center justify-between px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors border-b border-gray-100 dark:border-gray-600 last:border-b-0 group"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleReleaseClick(release.id);
                                        toggleDropdown(release.id);
                                      }}
                                    >
                                      <div className="min-w-0 flex-1">
                                        <div className="text-xs font-medium text-gray-900 dark:text-white truncate group-hover:text-blue-600 dark:group-hover:text-blue-400">
                                          {link.name}
                                        </div>
                                        <div className="flex items-center space-x-2 text-xs text-gray-500 dark:text-gray-400 mt-1">
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
                                      <Download className="w-3 h-3 text-gray-400 group-hover:text-blue-600 dark:group-hover:text-blue-400 flex-shrink-0" />
                                    </a>
                                  );
                                }) : (
                                  <div className="px-3 py-4 text-center text-gray-500 dark:text-gray-400">
                                    <div className="text-xs">
                                      {t('没有匹配过滤器的文件', 'No files match the selected filters')}
                                    </div>
                                    <div className="text-xs mt-1 opacity-75">
                                      {t('尝试调整过滤器设置', 'Try adjusting your filter settings')}
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                          {t('无下载', 'No downloads')}
                        </span>
                      )}
                    </div>

                    {/* Time and Actions */}
                    <div className="col-span-2 flex items-center justify-end space-x-2">
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {formatDistanceToNow(new Date(release.published_at), { addSuffix: true })}
                      </span>
                      <a
                        href={release.html_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 rounded bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                        title={t('在GitHub上查看', 'View on GitHub')}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleReleaseClick(release.id);
                        }}
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </div>
                </div>
              )}
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