import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Package, Bell, Search, X, RefreshCw, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, LayoutGrid, CalendarDays, ChevronDown } from 'lucide-react';
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
    batchUnsubscribeReleases,
    removeReleasesByRepoId,
    updateRepository,
    // Release Timeline View State from global store
    releaseViewMode,
    releaseSelectedFilters,
    releaseSearchQuery,
    releaseExpandedRepositories,
    releaseIsRefreshing,
    setReleaseViewMode,
    toggleReleaseSelectedFilter,
    clearReleaseSelectedFilters,
    setReleaseSearchQuery,
    toggleReleaseExpandedRepository,
    setReleaseIsRefreshing,
  } = useAppStore();

  const [lastRefreshTime, setLastRefreshTime] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);
  // 独立的展开状态：下载资产和更新日志分开控制（本地状态，不持久化）
  const [expandedAssets, setExpandedAssets] = useState<Set<number>>(new Set());
  const [expandedReleaseNotes, setExpandedReleaseNotes] = useState<Set<number>>(new Set());
  const [fullContentReleases, setFullContentReleases] = useState<Set<number>>(new Set());
  // 视图切换下拉菜单状态（本地UI状态）
  const [isViewDropdownOpen, setIsViewDropdownOpen] = useState(false);

  // 使用全局状态的别名，保持代码一致性
  const viewMode = releaseViewMode;
  const selectedFilters = releaseSelectedFilters;
  const searchQuery = releaseSearchQuery;
  const expandedRepositories = releaseExpandedRepositories;

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

  // Toggle assets expansion for a specific release
  const toggleAssets = (releaseId: number) => {
    setExpandedAssets(prev => {
      const newSet = new Set(prev);
      if (newSet.has(releaseId)) {
        newSet.delete(releaseId);
      } else {
        newSet.add(releaseId);
        // Mark as read when expanding assets
        markReleaseAsRead(releaseId);
      }
      return newSet;
    });
  };

  // Toggle release notes expansion for a specific release
  const toggleReleaseNotes = (releaseId: number) => {
    setExpandedReleaseNotes(prev => {
      const newSet = new Set(prev);
      if (newSet.has(releaseId)) {
        newSet.delete(releaseId);
      } else {
        newSet.add(releaseId);
        // Mark as read when expanding release notes
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

  const getDownloadLinks = useCallback((release: Release) => {
    const links: Array<{ name: string; url: string; size: number; downloadCount: number; isSourceCode?: boolean }> = [];
    
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

    if (release.zipball_url) {
      links.push({
        name: `Source code (${release.tag_name}.zip)`,
        url: release.zipball_url,
        size: 0,
        downloadCount: 0,
        isSourceCode: true
      });
    }

    if (release.tarball_url) {
      links.push({
        name: `Source code (${release.tag_name}.tar.gz)`,
        url: release.tarball_url,
        size: 0,
        downloadCount: 0,
        isSourceCode: true
      });
    }

    const bodyText = release.body || '';
    const downloadRegex = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
    let match;
    while ((match = downloadRegex.exec(bodyText)) !== null) {
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

  // 预计算每个 release 的下载链接和过滤后的链接
  const releasesWithLinks = useMemo(() => {
    return subscribedReleases.map(release => {
      const allLinks = getDownloadLinks(release);
      const filteredLinks = selectedFilters.length > 0
        ? allLinks.filter(link => matchesActiveFilters(link.name))
        : allLinks;
      return {
        release,
        allLinks,
        filteredLinks,
        hasMatchingAssets: filteredLinks.length > 0
      };
    });
  }, [subscribedReleases, getDownloadLinks, selectedFilters, matchesActiveFilters]);

  const filteredReleases = useMemo(() => {
    let filtered = releasesWithLinks;

    // 搜索过滤
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(({ release }) =>
        release.repository.name.toLowerCase().includes(query) ||
        release.repository.full_name.toLowerCase().includes(query) ||
        release.tag_name.toLowerCase().includes(query) ||
        (release.name || '').toLowerCase().includes(query) ||
        (release.body || '').toLowerCase().includes(query)
      );
    }

    // 资产类型过滤 - 只显示包含匹配资产的 release
    if (selectedFilters.length > 0) {
      filtered = filtered.filter(({ hasMatchingAssets }) => hasMatchingAssets);
    }

    return filtered
      .sort((a, b) =>
        new Date(b.release.published_at).getTime() - new Date(a.release.published_at).getTime()
      )
      .map(({ release, allLinks, filteredLinks }) => ({
        release,
        // 如果有过滤器，只显示匹配的资产；否则显示全部
        displayLinks: selectedFilters.length > 0 ? filteredLinks : allLinks
      }));
  }, [releasesWithLinks, searchQuery, selectedFilters]);

  // 按仓库分组的 Release 数据
  const repositoryGroups = useMemo(() => {
    const groups = new Map<number, {
      repository: Release['repository'];
      releases: typeof filteredReleases;
      latestRelease: Release;
    }>();

    filteredReleases.forEach(({ release, displayLinks }) => {
      const repoId = release.repository.id;
      if (!groups.has(repoId)) {
        groups.set(repoId, {
          repository: release.repository,
          releases: [],
          latestRelease: release,
        });
      }
      const group = groups.get(repoId)!;
      group.releases.push({ release, displayLinks });
      // 更新最新发布
      if (new Date(release.published_at) > new Date(group.latestRelease.published_at)) {
        group.latestRelease = release;
      }
    });

    // 按最新发布时间排序仓库组
    return Array.from(groups.values()).sort((a, b) =>
      new Date(b.latestRelease.published_at).getTime() - new Date(a.latestRelease.published_at).getTime()
    );
  }, [filteredReleases]);

  // 根据视图模式计算分页
  const totalPages = viewMode === 'timeline'
    ? Math.ceil(filteredReleases.length / itemsPerPage)
    : Math.ceil(repositoryGroups.length / itemsPerPage);
  const clampedPage = Math.max(1, Math.min(currentPage, totalPages || 1));
  const startIndex = (clampedPage - 1) * itemsPerPage;
  const paginatedReleases = filteredReleases.slice(startIndex, startIndex + itemsPerPage);
  const paginatedRepositoryGroups = repositoryGroups.slice(startIndex, startIndex + itemsPerPage);

  // 同步 currentPage 状态，确保始终在有效范围内
  useEffect(() => {
    const maxPage = Math.max(totalPages, 1);
    if (currentPage < 1 || currentPage > maxPage) {
      setCurrentPage(Math.min(Math.max(currentPage, 1), maxPage));
    }
  }, [totalPages, currentPage]);



  // Filter handlers - 使用全局状态
  const handleFilterToggle = (filterId: string) => {
    toggleReleaseSelectedFilter(filterId);
    setCurrentPage(1); // Reset to first page when filtering
  };

  const handleClearFilters = () => {
    clearReleaseSelectedFilters();
    setCurrentPage(1);
  };

  const handleRefresh = async () => {
    if (!githubToken) {
      alert(language === 'zh' ? 'GitHub token 未找到，请重新登录。' : 'GitHub token not found. Please login again.');
      return;
    }

    setReleaseIsRefreshing(true);
    try {
      const githubApi = new GitHubApiService(githubToken);
      const subscribedRepos = repositories.filter(repo => releaseSubscriptions.has(repo.id));
      
      if (subscribedRepos.length === 0) {
        alert(language === 'zh' ? '没有订阅的仓库。' : 'No subscribed repositories.');
        return;
      }

      const allNewReleases: Release[] = [];

      const latestReleaseTime = releases.length > 0 
        ? releases.reduce((max, r) => Math.max(max, new Date(r.published_at).getTime()), 0)
        : 0;
      const sinceTimestamp = latestReleaseTime > 0 ? new Date(latestReleaseTime).toISOString() : undefined;

      for (const repo of subscribedRepos) {
        const [owner, name] = repo.full_name.split('/');
        
        const hasExistingReleases = releases.some(r => r.repository.id === repo.id);
        
        let repoReleases: Release[];
        if (!hasExistingReleases) {
          repoReleases = await githubApi.getRepositoryReleases(owner, name, 1, 10);
        } else {
          repoReleases = await githubApi.getIncrementalRepositoryReleases(owner, name, sinceTimestamp, 10);
        }
        
        repoReleases.forEach(release => {
          release.repository.id = repo.id;
        });
        
        allNewReleases.push(...repoReleases);
        
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      const existingIds = new Set(useAppStore.getState().releases.map(r => r.id));
      const actuallyNewCount = allNewReleases.filter(r => !existingIds.has(r.id)).length;

      if (allNewReleases.length > 0) {
        addReleases(allNewReleases);
      }

      const now = new Date().toISOString();
      setLastRefreshTime(now);

      const message = language === 'zh'
        ? `刷新完成！发现 ${actuallyNewCount} 个新Release。`
        : `Refresh completed! Found ${actuallyNewCount} new releases.`;
      
      alert(message);
    } catch (error) {
      console.error('Refresh failed:', error);
      const errorMessage = language === 'zh'
        ? 'Release刷新失败，请检查网络连接。'
        : 'Release refresh failed. Please check your network connection.';
      alert(errorMessage);
    } finally {
      setReleaseIsRefreshing(false);
    }
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)));
  };

  const getPageNumbers = () => {
    const delta = 2;
    const range = [];
    const rangeWithDots = [];
    const activePage = clampedPage;

    for (let i = Math.max(2, activePage - delta); i <= Math.min(totalPages - 1, activePage + delta); i++) {
      range.push(i);
    }

    if (activePage - delta > 2) {
      rangeWithDots.push(1, '...');
    } else {
      rangeWithDots.push(1);
    }

    rangeWithDots.push(...range);

    if (activePage + delta < totalPages - 1) {
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
    paginatedReleases.forEach(({ release }) => {
      map.set(release.id, getTruncatedBody(release.body || '', 500));
    });
    paginatedRepositoryGroups.forEach(({ releases }) => {
      releases.forEach(({ release }) => {
        if (!map.has(release.id)) {
          map.set(release.id, getTruncatedBody(release.body || '', 500));
        }
      });
    });
    return map;
  }, [paginatedReleases, paginatedRepositoryGroups, getTruncatedBody]);

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

    const removedReleases = releases.filter(r => r.repository.id === repoId);
    const removedReadIds = new Set(removedReleases.map(r => r.id));

    const updatedRepo = { ...repo, subscribed_to_releases: false };
    updateRepository(updatedRepo);
    batchUnsubscribeReleases([repo.id]);
    removeReleasesByRepoId(repo.id);

    try {
      await forceSyncToBackend();
    } catch (error) {
      console.error('Failed to unsubscribe release:', error);
      updateRepository({ ...repo, subscribed_to_releases: true });
      const state = useAppStore.getState();
      useAppStore.setState({
        releaseSubscriptions: new Set([...state.releaseSubscriptions, repo.id]),
        releases: [...state.releases, ...removedReleases],
        readReleases: new Set([...state.readReleases, ...removedReadIds]),
      });
      alert(t('取消订阅失败，请检查后端连接。', 'Failed to unsubscribe. Please check backend connection.'));
      return;
    }

    alert(t('已取消订阅该仓库的 Release。', 'Unsubscribed from repository releases.'));
  };

  if (subscribedReleases.length === 0) {
    const subscribedRepoCount = releaseSubscriptions.size;
    
    return (
      <div className="text-center py-12">
               <Package className="w-16 h-16 text-gray-500 dark:text-quaternary mx-auto mb-4" />
         <h3 className="text-lg font-medium text-gray-900 dark:text-text-primary mb-2">
          {subscribedRepoCount === 0 ? t('没有Release订阅', 'No Release Subscriptions') : t('没有最近的Release', 'No Recent Releases')}
        </h3>
             <p className="text-gray-500 dark:text-text-tertiary mb-6 max-w-md mx-auto">
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
               disabled={releaseIsRefreshing}
               className="flex items-center space-x-2 px-6 py-3 bg-brand-indigo text-white rounded-lg hover:bg-brand-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed mx-auto"
             >
               <RefreshCw className={`w-5 h-5 ${releaseIsRefreshing ? 'animate-spin' : ''}`} />
               <span>{releaseIsRefreshing ? t('刷新中...', 'Refreshing...') : t('刷新Release', 'Refresh Releases')}</span>
             </button>
            {lastRefreshTime && (
              <p className="text-sm text-gray-500 dark:text-text-tertiary mt-2">
                {t('上次刷新:', 'Last refresh:')} {formatDistanceToNow(new Date(lastRefreshTime), { addSuffix: true })}
              </p>
            )}
          </div>
        )}

        {subscribedRepoCount === 0 && (
          <div className="bg-light-surface border border-black/[0.06] rounded-xl p-6 max-w-lg mx-auto">
            <div className="flex items-start space-x-4">
              <div className="flex-shrink-0 w-12 h-12 bg-brand-indigo/20 rounded-full flex items-center justify-center">
                <Bell className="w-6 h-6 text-brand-violet " />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-gray-700 dark:text-text-secondary mb-2">
                  {t('订阅仓库Release', 'Subscribe to Repository Releases')}
                </h3>
                <p className="text-sm text-gray-700 dark:text-text-secondary mb-3 leading-relaxed">
                  {t('订阅后，您可以在这里查看所有关注仓库的最新发布版本，第一时间获取更新动态。', 'Subscribe to receive the latest release updates from your favorite repositories in one place.')}
                </p>
                <div className="bg-white/60 dark:bg-panel-dark/60 rounded-lg p-3 text-sm">
                  <div className="flex items-center space-x-2 text-gray-700 dark:text-text-secondary font-medium mb-2">
                    <span className="w-5 h-5 bg-brand-violet text-white rounded-full flex items-center justify-center text-xs">1</span>
                    <span>{t('前往仓库页面', 'Go to Repositories')}</span>
                  </div>
                  <div className="flex items-center space-x-2 text-gray-700 dark:text-text-secondary font-medium">
                    <span className="w-5 h-5 bg-brand-violet text-white rounded-full flex items-center justify-center text-xs">2</span>
                    <span>{t('点击仓库卡片上的铃铛图标', 'Click the bell icon on any repository card')}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-full mx-auto px-2 sm:px-4">
      {/* Header */}
      <div className="mb-6 sm:mb-8">
        <div className="flex flex-col gap-4 mb-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-text-primary mb-2">
              {t('Release时间线', 'Release Timeline')}
            </h2>
            <p className="text-gray-700 dark:text-text-tertiary">
              {t(`来自您的 ${releaseSubscriptions.size} 个订阅仓库的最新Release`, `Latest releases from your ${releaseSubscriptions.size} subscribed repositories`)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {/* Last Refresh Time */}
            {lastRefreshTime && (
              <span className="w-full text-sm text-gray-500 dark:text-text-tertiary lg:w-auto">
                {t('上次刷新:', 'Last refresh:')} {formatDistanceToNow(new Date(lastRefreshTime), { addSuffix: true })}
              </span>
            )}

            {/* Refresh Button */}
            <button
              onClick={handleRefresh}
              disabled={releaseIsRefreshing}
              className="flex items-center space-x-2 px-4 py-2 bg-brand-indigo text-white rounded-lg hover:bg-brand-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`w-4 h-4 ${releaseIsRefreshing ? 'animate-spin' : ''}`} />
              <span>{releaseIsRefreshing ? t('刷新中...', 'Refreshing...') : t('刷新', 'Refresh')}</span>
            </button>
          </div>
        </div>

        {/* Search and Filters */}
        <div className="bg-white dark:bg-panel-dark rounded-xl border border-black/[0.06] dark:border-white/[0.04] p-3 mb-4">
          {/* Search Bar */}
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-text-quaternary w-5 h-5" />
            <input
              type="text"
              placeholder={t('搜索Release...', 'Search releases...')}
              value={searchQuery}
              onChange={(e) => {
                setReleaseSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full pl-10 pr-10 py-2 border border-black/[0.06] dark:border-white/[0.04] rounded-lg focus:ring-2 focus:ring-brand-violet focus:border-transparent bg-white dark:bg-white/[0.04] text-gray-900 dark:text-text-primary"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setReleaseSearchQuery('');
                  setCurrentPage(1);
                }}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-text-quaternary hover:text-gray-700 dark:text-text-secondary dark:hover:text-gray-300"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Filters and View Toggle Row */}
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div className="flex-1">
              <AssetFilterManager
                selectedFilters={selectedFilters}
                onFilterToggle={handleFilterToggle}
                onClearFilters={handleClearFilters}
              />
            </div>

            {/* View Mode Toggle Dropdown */}
            <div className="relative">
              <button
                onClick={() => setIsViewDropdownOpen(!isViewDropdownOpen)}
                className="flex items-center space-x-2 px-3 py-2 bg-light-surface dark:bg-white/[0.04] rounded-lg hover:bg-gray-200 dark:hover:bg-white/10 transition-all"
                title={viewMode === 'timeline' ? t('按日期排序视图', 'Timeline View') : t('仓库分类视图', 'Repository View')}
              >
                {viewMode === 'timeline' ? (
                  <CalendarDays className="w-4 h-4 text-gray-700 dark:text-text-tertiary" />
                ) : (
                  <LayoutGrid className="w-4 h-4 text-gray-700 dark:text-text-tertiary" />
                )}
                <span className="text-sm font-medium text-gray-900 dark:text-text-secondary">
                  {viewMode === 'timeline' ? t('按日期', 'Timeline') : t('按仓库', 'Repository')}
                </span>
                <ChevronDown className={`w-4 h-4 text-gray-500 dark:text-text-tertiary transition-transform ${isViewDropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              {/* Dropdown Menu */}
              {isViewDropdownOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setIsViewDropdownOpen(false)}
                  />
                  <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-panel-dark rounded-lg shadow-lg border border-black/[0.06] dark:border-white/[0.04] z-50 py-1">
                    <button
                      onClick={() => {
                        setReleaseViewMode('timeline');
                        setIsViewDropdownOpen(false);
                        setCurrentPage(1);
                      }}
                      className={`w-full flex items-center space-x-3 px-4 py-2.5 text-left hover:bg-light-surface dark:hover:bg-white/10 transition-colors ${
                        viewMode === 'timeline' ? 'bg-gray-100 dark:bg-white/[0.08] text-gray-900 dark:text-text-primary font-medium' : 'text-gray-700 dark:text-text-secondary'
                      }`}
                    >
                      <CalendarDays className={`w-4 h-4 ${viewMode === 'timeline' ? 'text-gray-900 dark:text-text-primary' : 'text-gray-500 dark:text-text-tertiary'}`} />
                      <div>
                        <div className="text-sm font-medium">{t('按日期排序', 'Timeline View')}</div>
                        <div className="text-xs text-gray-500 dark:text-text-tertiary">{t('按发布时间排序', 'Sort by publish date')}</div>
                      </div>
                    </button>
                    <button
                      onClick={() => {
                        setReleaseViewMode('repository');
                        setIsViewDropdownOpen(false);
                        setCurrentPage(1);
                      }}
                      className={`w-full flex items-center space-x-3 px-4 py-2.5 text-left hover:bg-light-surface dark:hover:bg-white/10 transition-colors ${
                        viewMode === 'repository' ? 'bg-gray-100 dark:bg-white/[0.08] text-gray-900 dark:text-text-primary font-medium' : 'text-gray-700 dark:text-text-secondary'
                      }`}
                    >
                      <LayoutGrid className={`w-4 h-4 ${viewMode === 'repository' ? 'text-gray-900 dark:text-text-primary' : 'text-gray-500 dark:text-text-tertiary'}`} />
                      <div>
                        <div className="text-sm font-medium">{t('仓库分类', 'Repository View')}</div>
                        <div className="text-xs text-gray-500 dark:text-text-tertiary">{t('按仓库分组折叠', 'Group by repository')}</div>
                      </div>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Results Info and Pagination Controls */}
        <div className="flex flex-col gap-2 mb-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2 sm:gap-4">
            <span className="text-sm text-gray-700 dark:text-text-tertiary">
              {viewMode === 'timeline'
                ? t(
                    `显示 ${startIndex + 1}-${Math.min(startIndex + itemsPerPage, filteredReleases.length)} 共 ${filteredReleases.length} 个Release`,
                    `Showing ${startIndex + 1}-${Math.min(startIndex + itemsPerPage, filteredReleases.length)} of ${filteredReleases.length} releases`
                  )
                : t(
                    `显示 ${startIndex + 1}-${Math.min(startIndex + itemsPerPage, repositoryGroups.length)} 共 ${repositoryGroups.length} 个仓库`,
                    `Showing ${startIndex + 1}-${Math.min(startIndex + itemsPerPage, repositoryGroups.length)} of ${repositoryGroups.length} repositories`
                  )
              }
            </span>
            {(searchQuery || selectedFilters.length > 0) && (
              <span className="text-sm text-brand-violet dark:text-brand-violet">
                ({t('已筛选', 'filtered')})
              </span>
            )}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
            {/* Items per page selector */}
            <div className="flex items-center space-x-2">
              <span className="text-sm text-gray-700 dark:text-text-tertiary">{t('每页:', 'Per page:')}</span>
              <select
                value={itemsPerPage}
                onChange={(e) => {
                  setItemsPerPage(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="px-3 py-1 border border-black/[0.06] dark:border-white/[0.04] rounded bg-white dark:bg-white/[0.04] text-gray-900 dark:text-text-primary text-sm"
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
                  disabled={clampedPage === 1}
                  className="p-2 rounded-lg bg-light-surface text-gray-700 dark:bg-white/[0.04] dark:text-text-tertiary hover:bg-gray-200 dark:hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronsLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handlePageChange(clampedPage - 1)}
                  disabled={clampedPage === 1}
                  className="p-2 rounded-lg bg-light-surface text-gray-700 dark:bg-white/[0.04] dark:text-text-tertiary hover:bg-gray-200 dark:hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                
                {getPageNumbers().map((page, index) => (
                  <button
                    key={index}
                    onClick={() => typeof page === 'number' ? handlePageChange(page) : undefined}
                    disabled={typeof page !== 'number'}
                    className={`px-3 py-2 rounded-lg text-sm ${
                      page === clampedPage
                        ? 'bg-brand-indigo text-white'
                        : typeof page === 'number'
                        ? 'bg-light-surface text-gray-700 dark:bg-white/[0.04] dark:text-text-tertiary hover:bg-gray-200 dark:hover:bg-white/10'
                        : 'text-gray-400 cursor-default'
                    }`}
                  >
                    {page}
                  </button>
                ))}
                
                <button
                  onClick={() => handlePageChange(clampedPage + 1)}
                  disabled={clampedPage === totalPages}
                  className="p-2 rounded-lg bg-light-surface text-gray-700 dark:bg-white/[0.04] dark:text-text-tertiary hover:bg-gray-200 dark:hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handlePageChange(totalPages)}
                  disabled={clampedPage === totalPages}
                  className="p-2 rounded-lg bg-light-surface text-gray-700 dark:bg-white/[0.04] dark:text-text-tertiary hover:bg-gray-200 dark:hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronsRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

       {/* Releases List */}
       <div className="space-y-2">
         {paginatedReleases.length === 0 ? (
           <div className="text-center py-12 bg-light-bg dark:bg-panel-dark/50 rounded-xl border-2 border-dashed border-black/[0.06]-alt dark:border-white/[0.04]">
            <Package className="w-12 h-12 text-gray-400 dark:text-text-secondarymx-auto mb-3" />
            <h3 className="text-lg font-medium text-gray-900 dark:text-text-secondary mb-1">
              {t('无符合条件的结果', 'No matching results')}
            </h3>
            <p className="text-sm text-gray-500 dark:text-text-tertiary">
              {selectedFilters.length > 0
                ? t('当前过滤器没有匹配到任何资产，请尝试其他过滤条件', 'No assets match the current filters. Try different filter criteria.')
                : t('没有找到匹配的 Release', 'No matching releases found.')}
            </p>
            {selectedFilters.length > 0 && (
              <button
                onClick={handleClearFilters}
                className="mt-4 px-4 py-2 bg-brand-indigo text-white rounded-lg hover:bg-brand-hover transition-colors text-sm"
              >
                {t('清除过滤器', 'Clear Filters')}
              </button>
            )}
          </div>
        ) : viewMode === 'timeline' ? (
          // 按日期排序视图
          paginatedReleases.map(({ release, displayLinks }) => {
            const isUnread = isReleaseUnread(release.id);
            const isAssetsExpanded = expandedAssets.has(release.id);
            const isReleaseNotesExpanded = expandedReleaseNotes.has(release.id);
            const isFullContent = fullContentReleases.has(release.id);
            const truncatedBody = releasesTruncatedBody.get(release.id) || release.body || '';

            return (
              <ReleaseCard
                key={release.id}
                release={release}
                downloadLinks={displayLinks}
                isUnread={isUnread}
                isAssetsExpanded={isAssetsExpanded}
                isReleaseNotesExpanded={isReleaseNotesExpanded}
                isFullContent={isFullContent}
                truncatedBody={truncatedBody}
                matchesActiveFilters={matchesActiveFilters}
                selectedFilters={selectedFilters}
                onToggleAssets={() => toggleAssets(release.id)}
                onToggleReleaseNotes={() => toggleReleaseNotes(release.id)}
                onToggleFullContent={(e) => toggleFullContent(release.id, e)}
                onUnsubscribe={() => handleUnsubscribeRelease(release.repository.id)}
                onMarkAsRead={() => markReleaseAsRead(release.id)}
                language={language}
                formatFileSize={formatFileSize}
              />
            );
          })
        ) : (
          // 仓库分类视图
          paginatedRepositoryGroups.map(({ repository, releases }) => {
            const isExpanded = expandedRepositories.has(repository.id);
            const hasUnread = releases.some(({ release }) => isReleaseUnread(release.id));
            const latestRelease = releases[0]?.release;

            return (
              <div key={repository.id} className="bg-light-bg dark:bg-panel-dark rounded-xl border border-black/[0.06] dark:border-white/[0.04] overflow-hidden">
                {/* Repository Header */}
                <button
                  onClick={() => toggleReleaseExpandedRepository(repository.id)}
                  className="w-full flex items-center justify-between p-2 hover:bg-light-bg dark:hover:bg-white/10/50 transition-colors"
                >
                  <div className="flex items-center space-x-2">
                    {hasUnread && (
                      <div className="w-1.5 h-1.5 bg-brand-violet rounded-full flex-shrink-0 animate-pulse"></div>
                    )}
                    <div className="flex items-center justify-center w-6 h-6 bg-brand-indigo/20 rounded flex-shrink-0">
                      <LayoutGrid className="w-3.5 h-3.5 text-brand-violet" />
                    </div>
                    <div className="text-left">
                      <h3 className="font-semibold text-sm text-gray-900 dark:text-text-primary">
                        {repository.name}
                      </h3>
                      <p className="text-xs text-gray-500 dark:text-text-tertiary">
                        {repository.full_name}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <div className="text-right hidden sm:block">
                      <p className="text-xs text-gray-500 dark:text-text-tertiary">
                        {releases.length} {t('个版本', 'releases')}
                      </p>
                      {latestRelease && (
                        <p className="text-xs text-gray-400 dark:text-text-tertiary">
                          {t('最新:', 'Latest:')} {latestRelease.tag_name}
                        </p>
                      )}
                    </div>
                    <div className={`transform transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                      <ChevronDown className="w-4 h-4 text-gray-400 dark:text-text-quaternary" />
                    </div>
                  </div>
                </button>

                {/* Repository Releases (Collapsible) */}
                <div
                  className="grid transition-[grid-template-rows] duration-300 ease-in-out"
                  style={{ gridTemplateRows: isExpanded ? '1fr' : '0fr' }}
                >
                  <div className="overflow-hidden min-h-0">
                    <div className="border-t border-black/[0.06] dark:border-white/[0.04] bg-light-bg dark:bg-panel-dark/50">
                      <div className="p-1.5 space-y-1.5">
                      {releases.map(({ release, displayLinks }) => {
                        const isUnread = isReleaseUnread(release.id);
                        const isAssetsExpanded = expandedAssets.has(release.id);
                        const isReleaseNotesExpanded = expandedReleaseNotes.has(release.id);
                        const isFullContent = fullContentReleases.has(release.id);
                        const truncatedBody = releasesTruncatedBody.get(release.id) || release.body || '';

                        return (
                          <ReleaseCard
                            key={release.id}
                            release={release}
                            downloadLinks={displayLinks}
                            isUnread={isUnread}
                            isAssetsExpanded={isAssetsExpanded}
                            isReleaseNotesExpanded={isReleaseNotesExpanded}
                            isFullContent={isFullContent}
                            truncatedBody={truncatedBody}
                            matchesActiveFilters={matchesActiveFilters}
                            selectedFilters={selectedFilters}
                            onToggleAssets={() => toggleAssets(release.id)}
                            onToggleReleaseNotes={() => toggleReleaseNotes(release.id)}
                            onToggleFullContent={(e) => toggleFullContent(release.id, e)}
                            onUnsubscribe={() => handleUnsubscribeRelease(release.repository.id)}
                            onMarkAsRead={() => markReleaseAsRead(release.id)}
                            language={language}
                            formatFileSize={formatFileSize}
                          />
                        );
                      })}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Bottom Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center mt-8">
          <div className="flex items-center space-x-1">
            <button
              onClick={() => handlePageChange(1)}
              disabled={clampedPage === 1}
              className="p-2 rounded-lg bg-light-surface text-gray-700 dark:bg-white/[0.04] dark:text-text-tertiary hover:bg-gray-200 dark:hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronsLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => handlePageChange(clampedPage - 1)}
              disabled={clampedPage === 1}
              className="p-2 rounded-lg bg-light-surface text-gray-700 dark:bg-white/[0.04] dark:text-text-tertiary hover:bg-gray-200 dark:hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            
            {getPageNumbers().map((page, index) => (
              <button
                key={index}
                onClick={() => typeof page === 'number' ? handlePageChange(page) : undefined}
                disabled={typeof page !== 'number'}
                className={`px-3 py-2 rounded-lg text-sm ${
                  page === clampedPage
                    ? 'bg-brand-indigo text-white'
                    : typeof page === 'number'
                    ? 'bg-light-surface text-gray-700 dark:bg-white/[0.04] dark:text-text-tertiary hover:bg-gray-200 dark:hover:bg-white/10'
                    : 'text-gray-400 cursor-default'
                }`}
              >
                {page}
              </button>
            ))}
            
            <button
              onClick={() => handlePageChange(clampedPage + 1)}
              disabled={clampedPage === totalPages}
              className="p-2 rounded-lg bg-light-surface text-gray-700 dark:bg-white/[0.04] dark:text-text-tertiary hover:bg-gray-200 dark:hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => handlePageChange(totalPages)}
              disabled={clampedPage === totalPages}
              className="p-2 rounded-lg bg-light-surface text-gray-700 dark:bg-white/[0.04] dark:text-text-tertiary hover:bg-gray-200 dark:hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronsRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
