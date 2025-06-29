import React, { useState, useMemo } from 'react';
import { ExternalLink, GitBranch, Calendar, Package, Bell, Search, X, RefreshCw, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Eye, EyeOff } from 'lucide-react';
import { Release } from '../types';
import { useAppStore } from '../store/useAppStore';
import { GitHubApiService } from '../services/githubApi';
import { formatDistanceToNow, format } from 'date-fns';

export const ReleaseTimeline: React.FC = () => {
  const { 
    releases, 
    repositories, 
    releaseSubscriptions, 
    githubToken, 
    language,
    setReleases,
    addReleases,
  } = useAppStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshTime, setLastRefreshTime] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(100);
  const [viewMode, setViewMode] = useState<'compact' | 'detailed'>('compact');

  // Enhanced platform detection based on the userscript
  const detectPlatforms = (filename: string): string[] => {
    const name = filename.toLowerCase();
    const platforms: string[] = [];

    // Platform detection rules based on the userscript
    const platformRules = {
      windows: [
        '.exe', '.msi', '.zip', '.7z',
        'windows', 'win32', 'win64', 'win-x64', 'win-x86', 'win-arm64',
        '-win.', '.win.', '-windows.', '.windows.',
        'setup', 'installer'
      ],
      macos: [
        '.dmg', '.pkg', '.app.zip',
        'darwin', 'macos', 'mac-os', 'osx', 'mac-universal',
        '-mac.', '.mac.', '-macos.', '.macos.', '-darwin.', '.darwin.',
        'universal', 'x86_64-apple', 'arm64-apple'
      ],
      linux: [
        '.deb', '.rpm', '.tar.gz', '.tar.xz', '.tar.bz2', '.appimage',
        'linux', 'ubuntu', 'debian', 'fedora', 'centos', 'arch', 'alpine',
        '-linux.', '.linux.', 'x86_64-unknown-linux', 'aarch64-unknown-linux',
        'musl', 'gnu'
      ],
      android: [
        '.apk', '.aab',
        'android', '-android.', '.android.',
        'arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64'
      ],
      ios: [
        '.ipa',
        'ios', '-ios.', '.ios.',
        'iphone', 'ipad'
      ]
    };

    // Check each platform
    Object.entries(platformRules).forEach(([platform, keywords]) => {
      if (keywords.some(keyword => name.includes(keyword))) {
        platforms.push(platform);
      }
    });

    // Special handling for universal files
    if (platforms.length === 0) {
      // Check for source code or universal packages
      if (name.includes('source') || name.includes('src') || 
          name.includes('universal') || name.includes('all') ||
          name.match(/\.(zip|tar\.gz|tar\.xz)$/) && !name.includes('win') && !name.includes('mac') && !name.includes('linux')) {
        platforms.push('universal');
      }
    }

    return platforms.length > 0 ? platforms : ['universal'];
  };

  const getDownloadLinks = (release: Release) => {
    // Extract download links from release body
    const downloadRegex = /\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g;
    const links: Array<{ name: string; url: string; platforms: string[] }> = [];
    
    let match;
    while ((match = downloadRegex.exec(release.body)) !== null) {
      const [, name, url] = match;
      // Only include actual download links (not documentation, etc.)
      if (url.includes('/download/') || url.includes('/releases/') || 
          name.toLowerCase().includes('download') ||
          /\.(exe|dmg|deb|rpm|apk|ipa|zip|tar\.gz|msi|pkg|appimage)$/i.test(url)) {
        const platforms = detectPlatforms(name + ' ' + url);
        links.push({ name, url, platforms });
      }
    }

    // Also check for GitHub release assets pattern
    const assetRegex = /https:\/\/github\.com\/[^\/]+\/[^\/]+\/releases\/download\/[^\/]+\/([^\s\)]+)/g;
    while ((match = assetRegex.exec(release.body)) !== null) {
      const [url, filename] = match;
      const platforms = detectPlatforms(filename);
      // Avoid duplicates
      if (!links.some(link => link.url === url)) {
        links.push({ name: filename, url, platforms });
      }
    }

    return links;
  };

  // Filter releases for subscribed repositories
  const subscribedReleases = releases.filter(release => 
    releaseSubscriptions.has(release.repository.id)
  );

  // Apply search and platform filters
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

    // Platform filter
    if (selectedPlatforms.length > 0) {
      filtered = filtered.filter(release => {
        const downloadLinks = getDownloadLinks(release);
        return downloadLinks.some(link => 
          selectedPlatforms.some(platform => link.platforms.includes(platform))
        );
      });
    }

    return filtered.sort((a, b) => 
      new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
    );
  }, [subscribedReleases, searchQuery, selectedPlatforms]);

  // Pagination
  const totalPages = Math.ceil(filteredReleases.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedReleases = filteredReleases.slice(startIndex, startIndex + itemsPerPage);

  // Get available platforms from all releases
  const availablePlatforms = useMemo(() => {
    const platforms = new Set<string>();
    subscribedReleases.forEach(release => {
      const downloadLinks = getDownloadLinks(release);
      downloadLinks.forEach(link => {
        link.platforms.forEach(platform => platforms.add(platform));
      });
    });
    return Array.from(platforms).sort();
  }, [subscribedReleases]);

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

  const handlePlatformToggle = (platform: string) => {
    setSelectedPlatforms(prev => 
      prev.includes(platform)
        ? prev.filter(p => p !== platform)
        : [...prev, platform]
    );
    setCurrentPage(1); // Reset to first page when filtering
  };

  const clearFilters = () => {
    setSearchQuery('');
    setSelectedPlatforms([]);
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

  const getPlatformIcon = (platform: string) => {
    const iconMap: Record<string, string> = {
      windows: 'fab fa-windows',
      macos: 'fab fa-apple',
      linux: 'fab fa-linux',
      android: 'fab fa-android',
      ios: 'fab fa-apple',
      universal: 'fas fa-download'
    };
    return iconMap[platform] || 'fas fa-download';
  };

  const getPlatformColor = (platform: string) => {
    const colorMap: Record<string, string> = {
      windows: 'text-blue-600 dark:text-blue-400',
      macos: 'text-gray-600 dark:text-gray-400',
      linux: 'text-yellow-600 dark:text-yellow-400',
      android: 'text-green-600 dark:text-green-400',
      ios: 'text-gray-600 dark:text-gray-400',
      universal: 'text-purple-600 dark:text-purple-400'
    };
    return colorMap[platform] || 'text-gray-600 dark:text-gray-400';
  };

  const truncateBody = (body: string, maxLength = 200) => {
    if (body.length <= maxLength) return body;
    return body.substring(0, maxLength) + '...';
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
            : t(`您已订阅 ${subscribedRepoCount} 个仓库，但没有找到最近的Release。尝试同步以获取最新更新。`, `You're subscribed to ${subscribedRepoCount} repositories, but no recent releases were found. Try syncing to get the latest updates.`)
          }
        </p>
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

          {/* Platform Filters */}
          {availablePlatforms.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300 mr-2">
                {t('平台:', 'Platforms:')}
              </span>
              {availablePlatforms.map(platform => (
                <button
                  key={platform}
                  onClick={() => handlePlatformToggle(platform)}
                  className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    selectedPlatforms.includes(platform)
                      ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                      : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  <i className={`${getPlatformIcon(platform)} w-4 h-4`}></i>
                  <span className="capitalize">{platform}</span>
                </button>
              ))}
              {(searchQuery || selectedPlatforms.length > 0) && (
                <button
                  onClick={clearFilters}
                  className="flex items-center space-x-1 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
                >
                  <X className="w-4 h-4" />
                  <span>{t('清除', 'Clear')}</span>
                </button>
              )}
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
            {(searchQuery || selectedPlatforms.length > 0) && (
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
          
          return (
            <div
              key={release.id}
              className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 hover:shadow-lg transition-shadow"
            >
              {viewMode === 'detailed' ? (
                // Detailed View
                <div className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center space-x-3 flex-1 min-w-0">
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

                  {/* Download Links */}
                  {downloadLinks.length > 0 && (
                    <div className="mb-4">
                      <h6 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        {t('下载:', 'Downloads:')}
                      </h6>
                      <div className="flex flex-wrap gap-2">
                        {downloadLinks.map((link, index) => (
                          <a
                            key={index}
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center space-x-2 px-3 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors text-sm"
                            title={link.name}
                          >
                            <div className="flex items-center space-x-1">
                              {link.platforms.map((platform, pIndex) => (
                                <i
                                  key={pIndex}
                                  className={`${getPlatformIcon(platform)} w-4 h-4 ${getPlatformColor(platform)}`}
                                  title={platform}
                                ></i>
                              ))}
                            </div>
                            <span className="truncate max-w-32">{link.name}</span>
                          </a>
                        ))}
                      </div>
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

                    {/* Download Links - 横向排列，可换行 */}
                    <div className="col-span-4 min-w-0">
                      {downloadLinks.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {downloadLinks.slice(0, 6).map((link, index) => (
                            <a
                              key={index}
                              href={link.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center space-x-1 px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                              title={`${link.name} (${link.platforms.join(', ')})`}
                            >
                              <div className="flex items-center space-x-0.5">
                                {link.platforms.map((platform, pIndex) => (
                                  <i
                                    key={pIndex}
                                    className={`${getPlatformIcon(platform)} w-3 h-3 ${getPlatformColor(platform)}`}
                                    title={platform}
                                  ></i>
                                ))}
                              </div>
                              <span className="text-xs text-gray-700 dark:text-gray-300 truncate max-w-16">
                                {link.name.split('.').pop() || link.name}
                              </span>
                            </a>
                          ))}
                          {downloadLinks.length > 6 && (
                            <span className="text-xs text-gray-500 dark:text-gray-400 px-2 py-1">
                              +{downloadLinks.length - 6}
                            </span>
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