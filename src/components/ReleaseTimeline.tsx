import { getDateFnsLocale } from '../i18n/format';
import { useT } from "../i18n/useT";
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Switch } from './ui/switch';
import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Package, Bell, Search, X, RefreshCw, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, LayoutGrid, ChevronDown, CheckCircle, Settings } from 'lucide-react';
import { Release } from '../types';
import { useReleaseTimelineActions } from '../features/releases/hooks/useReleaseTimelineActions';
import { useAppStore } from '../store/useAppStore';
import { formatDistanceToNow } from 'date-fns';
import { AssetFilterManager } from './AssetFilterManager';
import { PRESET_FILTERS } from '../constants/presetFilters';
import ReleaseCard from './ReleaseCard';
import { ReleaseSourceSettingsModal } from './ReleaseSourceSettingsModal';
import {
  releaseBelongsToResolvedSources,
  resolveReleaseSources,
} from '../utils/releaseSources';
import {
  effectiveReleaseTime,
  latestEffectiveRelease,
  shouldShowAssetsUpdatedIndicator,
} from '../utils/releaseAssets';

export const ReleaseTimeline: React.FC = () => {
  const {
    releases,
    repositories,
    releaseSubscriptions,
    releaseSourceSettings,
    readReleases,
    language,
    assetFilters,
    markReleaseAsRead,
    markAssetAsRead,
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
    includePreRelease,
    setIncludePreRelease,
    releaseShowMode,
    setReleaseShowMode,
    releaseLatestMode,
    setReleaseLatestMode,
    lastRefreshTime,
    isMarkingAllRead,
    handleRefresh,
    handleMarkAllRead,
    handleUnsubscribeRelease,
  } = useReleaseTimelineActions();
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);
  // 独立的展开状态：下载资产和更新日志分开控制（本地状态，不持久化）
  const [expandedAssets, setExpandedAssets] = useState<Set<number>>(new Set());
  const [expandedReleaseNotes, setExpandedReleaseNotes] = useState<Set<number>>(new Set());
  const [fullContentReleases, setFullContentReleases] = useState<Set<number>>(new Set());
  const [isReleaseSourceSettingsOpen, setIsReleaseSourceSettingsOpen] = useState(false);

  // 使用全局状态的别名，保持代码一致性
  const viewMode = releaseViewMode;
  const selectedFilters = releaseSelectedFilters;
  const searchQuery = releaseSearchQuery;
  const expandedRepositories = releaseExpandedRepositories;

  const resolvedReleaseSources = useMemo(() => resolveReleaseSources({
    repositories,
    releaseSubscriptions,
    releaseSourceSettings,
  }), [repositories, releaseSubscriptions, releaseSourceSettings]);
  const activeReleaseRepoCount = resolvedReleaseSources.repositories.length;

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
    const links: Array<{ name: string; url: string; size: number; downloadCount: number; isSourceCode?: boolean; assetId?: number; updatedAt?: string; contentType?: string }> = [];

    if (release.assets && release.assets.length > 0) {
      release.assets.forEach(asset => {
        links.push({
          name: asset.name,
          url: asset.browser_download_url,
          size: asset.size,
          downloadCount: asset.download_count,
          assetId: asset.id,
          updatedAt: asset.updated_at,
          contentType: asset.content_type,
        });
      });
    }

    if (release.zipball_url) {
      links.push({
        name: `Source code (${release.tag_name}.zip)`,
        url: release.zipball_url,
        size: 0,
        downloadCount: 0,
        isSourceCode: true,
        // 源码归档没有独立的 updated_at：用 Release 有效时间做版本戳，
        // 使 RPC 状态 key 随资源替换而变化，避免旧的"已发送 ✓"残留。
        updatedAt: effectiveReleaseTime(release),
      });
    }

    if (release.tarball_url) {
      links.push({
        name: `Source code (${release.tag_name}.tar.gz)`,
        url: release.tarball_url,
        size: 0,
        downloadCount: 0,
        isSourceCode: true,
        updatedAt: effectiveReleaseTime(release),
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
          links.push({ name, url, size: 0, downloadCount: 0, updatedAt: effectiveReleaseTime(release) });
        }
      }
    }

    return links;
  }, []);

  const subscribedReleases = useMemo(() =>
    releases.filter(release =>
      releaseBelongsToResolvedSources(release, resolvedReleaseSources) &&
      (includePreRelease || !release.prerelease)
    ),
    [releases, resolvedReleaseSources, includePreRelease]
  );

  // 未读模式下，快照当前未读 release ID，避免标记已读后立即消失
  // 不依赖 readReleases，避免标记已读时重建快照导致列表项立即消失
  const unreadSnapshotRef = useRef<Set<number>>(new Set());
  const [snapshotVersion, setSnapshotVersion] = useState(0);
  // 快照重建信号只看可见 release 的 ID 集合：markReleaseAsRead 会清除
  // “资产已更新”标识并生成新的 releases 数组，但 ID 集合不变——若直接依赖
  // releases，刚展开标记的条目会在“仅显示未读”下立即消失。
  const subscribedReleaseKey = useMemo(() =>
    releases
      .filter(r =>
        releaseBelongsToResolvedSources(r, resolvedReleaseSources) &&
        (includePreRelease || !r.prerelease)
      )
      .map(r => r.id)
      .join(','),
  [releases, resolvedReleaseSources, includePreRelease]);
  useEffect(() => {
    const state = useAppStore.getState();
    const ids = new Set<number>();
    releases.forEach(r => {
      if (releaseBelongsToResolvedSources(r, resolvedReleaseSources) &&
          (includePreRelease || !r.prerelease) &&
          !state.readReleases.has(r.id)) {
        ids.add(r.id);
      }
    });
    unreadSnapshotRef.current = ids;
    setSnapshotVersion(v => v + 1);
    // 重建时机由 subscribedReleaseKey/releaseShowMode/releaseLatestMode 决定，
    // 见上方说明；此处刻意不依赖 releases/resolvedReleaseSources 本身。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribedReleaseKey, releaseShowMode, releaseLatestMode]);

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

  const preUnreadFilteredReleases = useMemo(() => {
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

  // 仅最新模式过滤：每个仓库只保留最新的 release
  const latestModeReleases = useMemo(() => {
    if (releaseLatestMode !== 'latest') return preUnreadFilteredReleases;

    const repoMap = new Map<number, typeof preUnreadFilteredReleases[0]>();
    for (const item of preUnreadFilteredReleases) {
      const repoId = item.release.repository.id;
      const existing = repoMap.get(repoId);
      if (!existing || item.release.published_at > existing.release.published_at) {
        repoMap.set(repoId, item);
      }
    }
    return Array.from(repoMap.values());
  }, [preUnreadFilteredReleases, releaseLatestMode]);

  // 未读模式过滤（使用快照，标记已读后不会立即消失，刷新页面后才更新）
  const filteredReleases = useMemo(() => {
    if (releaseShowMode === 'unread') {
      return latestModeReleases.filter(({ release }) => unreadSnapshotRef.current.has(release.id));
    }
    return latestModeReleases;
    // snapshotVersion 触发快照更新后重算；readReleases 不在此处以避免标记已读立即消失
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestModeReleases, releaseShowMode, snapshotVersion]);

  const unreadCount = useMemo(() => {
    return subscribedReleases.filter(r => !readReleases.has(r.id)).length;
  }, [subscribedReleases, readReleases]);

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

    // 仓库容器的更新时间应覆盖所有可见 Release 的发布时间和资产更新时间。
    // latestRelease 仍用于展示“最新版本”标签，避免改变版本标签的语义。
    return Array.from(groups.values())
      .map(group => ({
        ...group,
        latestUpdatedRelease: latestEffectiveRelease(
          group.releases.map(({ release }) => release),
        ),
      }))
      .sort((a, b) => {
        const aTime = a.latestUpdatedRelease
          ? new Date(effectiveReleaseTime(a.latestUpdatedRelease)).getTime()
          : -Infinity;
        const bTime = b.latestUpdatedRelease
          ? new Date(effectiveReleaseTime(b.latestUpdatedRelease)).getTime()
          : -Infinity;
        return bTime - aTime;
      });
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

  const handleShowModeChange = (mode: 'all' | 'unread') => {
    setReleaseShowMode(mode);
    setCurrentPage(1);
  };

  const handleLatestModeChange = (mode: 'all' | 'latest') => {
    setReleaseLatestMode(mode);
    setCurrentPage(1);
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
      rangeWithDots.push(1, '…');
    } else {
      rangeWithDots.push(1);
    }

    rangeWithDots.push(...range);

    if (activePage + delta < totalPages - 1) {
      rangeWithDots.push('…', totalPages);
    } else if (totalPages > 1) {
      rangeWithDots.push(totalPages);
    }

    return rangeWithDots;
  };

  const t = useT('releases');

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

    return result + '…';
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

  if (subscribedReleases.length === 0) {
    const subscribedRepoCount = activeReleaseRepoCount;

    return (
      <>
      <div className="text-center py-12">
               <Package className="w-16 h-16 text-muted-foreground dark:text-quaternary mx-auto mb-4" />
         <h3 className="text-lg font-medium text-foreground dark:text-foreground mb-2">
          {subscribedRepoCount === 0 ? t('releaseTimeline.no-release-subscriptions') : t('releaseTimeline.no-recent-releases')}
        </h3>
             <p className="text-muted-foreground dark:text-muted-foreground mb-6 max-w-md mx-auto">
               {subscribedRepoCount === 0
                 ? t('releaseTimeline.subscribe-to-repository-releases-from-the-reposi')
                 : t('releaseTimeline.you-re-subscribed-to-subscribedrepocount-reposit', { subscribedRepoCount: subscribedRepoCount })
               }
             </p>
        
        {/* Pre-release toggle + Refresh button */}
        {subscribedRepoCount > 0 && (
           <div className="mb-6 flex flex-col items-center gap-3">
             {/* Pre-release toggle */}
             <div className="flex items-center gap-2 select-none">
               <Switch
                 checked={includePreRelease}
                 onCheckedChange={setIncludePreRelease}
                 aria-label={t('releaseTimeline.include-pre-release')}
               />
               <span className="text-sm text-muted-foreground dark:text-muted-foreground">
                 {t('releaseTimeline.include-pre-release')}
               </span>
             </div>

             <div className="flex flex-wrap items-center justify-center gap-2">
               {/* Refresh button */}
               <Button
                 onClick={handleRefresh}
                 disabled={releaseIsRefreshing}
                 className="flex items-center space-x-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
               >
                 <RefreshCw className={`w-5 h-5 ${releaseIsRefreshing ? 'animate-spin' : ''}`} />
                 <span>{releaseIsRefreshing ? t('releaseTimeline.refreshing') : t('releaseTimeline.refresh-releases')}</span>
               </Button>
               <Button
                 onClick={() => setIsReleaseSourceSettingsOpen(true)}
                 className="flex items-center space-x-2 px-4 py-3 bg-muted text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground rounded-lg hover:bg-accent dark:hover:bg-accent transition-colors"
                 title={t('releaseTimeline.release-source-settings')}
               >
                 <Settings className="w-5 h-5" />
                 <span>{t('releaseTimeline.sources')}</span>
               </Button>
             </div>
            {lastRefreshTime && (
              <p className="text-sm text-muted-foreground dark:text-muted-foreground">
                {t('releaseTimeline.last-refresh-time', { time: formatDistanceToNow(new Date(lastRefreshTime), { addSuffix: true, locale: getDateFnsLocale(language) }) })}
              </p>
            )}
          </div>
        )}

        {subscribedRepoCount === 0 && (
          <div className="bg-muted dark:bg-muted/20 border border-border dark:border-border rounded-xl p-6 max-w-lg mx-auto">
            <div className="flex items-start space-x-4">
              <div className="flex-shrink-0 w-12 h-12 bg-primary/20 rounded-full flex items-center justify-center">
                <Bell className="w-6 h-6 text-primary " />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-muted-foreground dark:text-muted-foreground mb-2">
                  {t('releaseTimeline.subscribe-to-repository-releases')}
                </h3>
                <p className="text-sm text-muted-foreground dark:text-muted-foreground mb-3 leading-relaxed">
                  {t('releaseTimeline.subscribe-to-receive-the-latest-release-updates')}
                </p>
                <div className="bg-card dark:bg-card/60 rounded-lg p-3 text-sm">
                  <div className="flex items-center space-x-2 text-muted-foreground dark:text-muted-foreground font-medium mb-2">
                    <span className="w-5 h-5 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-xs">1</span>
                    <span>{t('releaseTimeline.go-to-repositories')}</span>
                  </div>
                  <div className="flex items-center space-x-2 text-muted-foreground dark:text-muted-foreground font-medium">
                    <span className="w-5 h-5 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-xs">2</span>
                    <span>{t('releaseTimeline.click-the-bell-icon-on-any-repository-card')}</span>
                  </div>
                </div>
                <div className="mt-4 rounded-lg bg-card dark:bg-card/60 p-3 text-sm text-muted-foreground dark:text-muted-foreground">
                  <p className="mb-3">
                    {t('releaseTimeline.you-can-also-use-watch-repository-sync-or-a-cust')}
                  </p>
                  <Button
                    onClick={() => setIsReleaseSourceSettingsOpen(true)}
                    className="inline-flex items-center space-x-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                    title={t('releaseTimeline.release-source-settings')}
                  >
                    <Settings className="w-4 h-4" />
                    <span>{t('releaseTimeline.configure-release-sources')}</span>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      <ReleaseSourceSettingsModal
        isOpen={isReleaseSourceSettingsOpen}
        onClose={() => setIsReleaseSourceSettingsOpen(false)}
      />
      </>
    );
  }

  return (
    <div className="max-w-full mx-auto px-2 sm:px-4">
      {/* Header */}
      <div className="mb-6 sm:mb-8">
        <div className="flex flex-col gap-4 mb-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-foreground dark:text-foreground mb-2">
              {t('releaseTimeline.release-timeline')}
            </h2>
            <p className="text-muted-foreground dark:text-muted-foreground">
              {t('releaseTimeline.latest-releases-from-your-activereleaserepocount', { activeReleaseRepoCount: activeReleaseRepoCount })}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {/* Last Refresh Time */}
            {lastRefreshTime && (
              <span className="w-full text-sm text-muted-foreground dark:text-muted-foreground lg:w-auto">
                {t('releaseTimeline.last-refresh-time', { time: formatDistanceToNow(new Date(lastRefreshTime), { addSuffix: true, locale: getDateFnsLocale(language) }) })}
              </span>
            )}

            {/* Pre-release toggle */}
            <div className="flex items-center gap-1.5 select-none">
              <Switch
                checked={includePreRelease}
                onCheckedChange={setIncludePreRelease}
                aria-label={t('releaseTimeline.include-pre-release')}
              />
              <span className="hidden text-xs text-muted-foreground dark:text-muted-foreground sm:inline">
                {t('releaseTimeline.pre')}
              </span>
            </div>

            {/* Refresh Button */}
            <Button
              onClick={handleRefresh}
              disabled={releaseIsRefreshing}
              className="ui-button-primary flex items-center space-x-2 px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`w-4 h-4 ${releaseIsRefreshing ? 'animate-spin' : ''}`} />
              <span>{releaseIsRefreshing ? t('releaseTimeline.refreshing') : t('releaseTimeline.refresh')}</span>
            </Button>
            <Button
              onClick={() => setIsReleaseSourceSettingsOpen(true)}
              variant="ghost"
              className="ui-button flex items-center space-x-2 px-3 py-2"
              title={t('releaseTimeline.release-source-settings')}
            >
              <Settings className="w-4 h-4 text-muted-foreground dark:text-muted-foreground" />
              <span className="text-sm font-medium text-foreground dark:text-muted-foreground">{t('releaseTimeline.sources-2')}</span>
            </Button>
          </div>
        </div>

        {/* Search and Filters */}
        <div className="ui-toolbar p-3 sm:p-4 mb-4">
          {/* Search Bar */}
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground dark:text-muted-foreground/70 w-5 h-5" />
            <Input
              type="text"
              placeholder={t('releaseTimeline.search-releases')}
              value={searchQuery}
              onChange={(e) => {
                setReleaseSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              className="ui-field w-full pl-10 pr-12 py-2 text-foreground dark:text-foreground"
            />
            {searchQuery && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setReleaseSearchQuery('');
                  setCurrentPage(1);
                }}
                aria-label={t('releaseTimeline.clear-search')}
                className="absolute right-2 top-1/2 h-8 w-8 p-0 transform -translate-y-1/2 text-muted-foreground dark:text-muted-foreground/70 hover:text-muted-foreground dark:text-muted-foreground dark:hover:text-muted-foreground"
              >
                <X className="w-4 h-4" />
              </Button>
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

            {/* View Mode Select */}
            <Select
              value={viewMode}
              onValueChange={(value) => {
                if (value === 'timeline' || value === 'repository') {
                  setReleaseViewMode(value);
                  setCurrentPage(1);
                }
              }}
            >
              <SelectTrigger
                aria-label={t('releaseTimeline.view-mode')}
                className="ui-field h-9 w-48 px-3 py-1 text-sm"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="timeline">{t('releaseTimeline.timeline-view')}</SelectItem>
                <SelectItem value="repository">{t('releaseTimeline.repository-view')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Results Info and Controls */}
        <div className="flex flex-col gap-2 mb-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2 sm:gap-4">
            <span className="text-sm text-muted-foreground dark:text-muted-foreground">
              {viewMode === 'timeline'
                ? releaseShowMode === 'unread'
                  ? t('releaseTimeline.showing-v1-v2-of-v3-unread-total-v4', { v1: startIndex + 1, v2: Math.min(startIndex + itemsPerPage, filteredReleases.length), v3: filteredReleases.length, v4: preUnreadFilteredReleases.length })
                  : t('releaseTimeline.showing-v1-v2-of-v3-releases', { v1: startIndex + 1, v2: Math.min(startIndex + itemsPerPage, filteredReleases.length), v3: filteredReleases.length })
                : releaseShowMode === 'unread'
                  ? t('releaseTimeline.showing-v1-v2-of-v3-unread-repos-total-v4', { v1: startIndex + 1, v2: Math.min(startIndex + itemsPerPage, repositoryGroups.length), v3: repositoryGroups.length, v4: preUnreadFilteredReleases.length })
                  : t('releaseTimeline.showing-v1-v2-of-v3-repositories', { v1: startIndex + 1, v2: Math.min(startIndex + itemsPerPage, repositoryGroups.length), v3: repositoryGroups.length })
              }
            </span>
            {releaseShowMode === 'all' && unreadCount > 0 && (
              <span className="text-sm text-primary dark:text-primary">
                ({unreadCount} {t('releaseTimeline.unread')})
              </span>
            )}
            {(searchQuery || selectedFilters.length > 0) && (
              <span className="text-sm text-primary dark:text-primary">
                ({t('releaseTimeline.filtered')})
              </span>
            )}
            {releaseLatestMode === 'latest' && (
              <span className="text-sm text-primary dark:text-primary">
                ({t('releaseTimeline.latest-only')})
              </span>
            )}
          </div>

          <div className="flex w-full flex-wrap items-center justify-start gap-3 lg:w-auto lg:justify-end">
            {/* Show Mode Select */}
            <Select value={releaseShowMode} onValueChange={(value) => {
              if (value === 'all' || value === 'unread') handleShowModeChange(value);
            }}>
              <SelectTrigger
                aria-label={t('releaseTimeline.display-range')}
                className="ui-field h-9 w-44 px-3 py-1 text-sm"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('releaseTimeline.show-all')}</SelectItem>
                <SelectItem value="unread">{t('releaseTimeline.unread-only')}</SelectItem>
              </SelectContent>
            </Select>

            {/* Latest Mode Select */}
            <Select value={releaseLatestMode} onValueChange={(value) => {
              if (value === 'all' || value === 'latest') handleLatestModeChange(value);
            }}>
              <SelectTrigger
                aria-label={t('releaseTimeline.version-range')}
                className="ui-field h-9 w-48 px-3 py-1 text-sm"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('releaseTimeline.show-all-versions')}</SelectItem>
                <SelectItem value="latest">{t('releaseTimeline.latest-version-only')}</SelectItem>
              </SelectContent>
            </Select>

            {/* Items per page selector */}
            <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
              <span className="whitespace-nowrap text-sm text-muted-foreground dark:text-muted-foreground">{t('releaseTimeline.per-page')}</span>
              <Select value={String(itemsPerPage)} onValueChange={(value) => { setItemsPerPage(Number(value)); setCurrentPage(1); }}>
                <SelectTrigger aria-label={t('releaseTimeline.items-per-page')} className="ui-field h-9 w-20 shrink-0 px-3 py-1 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="20">20</SelectItem><SelectItem value="50">50</SelectItem><SelectItem value="100">100</SelectItem><SelectItem value="200">200</SelectItem></SelectContent>
              </Select>
            </div>

            {/* Mark All Read button */}
            <Button
              variant="ghost"
              onClick={handleMarkAllRead}
              disabled={isMarkingAllRead || unreadCount === 0}
              className="flex shrink-0 items-center space-x-2 rounded-lg bg-muted px-3 py-2 transition-all hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 dark:bg-muted/40 dark:hover:bg-accent"
              title={t('releaseTimeline.mark-all-as-read')}
            >
              {isMarkingAllRead ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              <span className="text-sm font-medium text-foreground dark:text-muted-foreground">{t('releaseTimeline.mark-all-read')}</span>
            </Button>
          </div>
        </div>
      </div>

       {/* Releases List */}
       <div className="space-y-2">
         {paginatedReleases.length === 0 ? (
           <div className="ui-empty-state text-center py-12">
            <Package className="w-12 h-12 text-muted-foreground dark:text-muted-foreground mx-auto mb-3" />
            <h3 className="text-lg font-medium text-foreground dark:text-muted-foreground mb-1">
              {releaseShowMode === 'unread'
                ? t('releaseTimeline.no-unread-releases')
                : t('releaseTimeline.no-matching-results')}
            </h3>
            <p className="text-sm text-muted-foreground dark:text-muted-foreground">
              {releaseShowMode === 'unread'
                ? t('releaseTimeline.all-releases-have-been-marked-as-read')
                : selectedFilters.length > 0
                  ? t('releaseTimeline.no-assets-match-the-current-filters-try-differen')
                  : t('releaseTimeline.no-matching-releases-found')}
            </p>
            {releaseShowMode === 'unread' && (
              <Button
                onClick={() => handleShowModeChange('all')}
                className="ui-button-primary mt-4 px-4 py-2 text-sm"
              >
                {t('releaseTimeline.show-all-2')}
              </Button>
            )}
            {selectedFilters.length > 0 && releaseShowMode !== 'unread' && (
              <Button
                onClick={handleClearFilters}
                className="ui-button-primary mt-4 px-4 py-2 text-sm"
              >
                {t('releaseTimeline.clear-filters')}
              </Button>
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
                onMarkAssetAsRead={markAssetAsRead}
                language={language}
                formatFileSize={formatFileSize}
              />
            );
          })
        ) : (
          // 仓库分类视图
          paginatedRepositoryGroups.map(({ repository, releases, latestRelease, latestUpdatedRelease }) => {
            const isExpanded = expandedRepositories.has(repository.id);
            const hasUnread = releases.some(({ release }) => isReleaseUnread(release.id));
            const latestEffectiveTime = latestUpdatedRelease
              ? effectiveReleaseTime(latestUpdatedRelease)
              : null;
            // 仓库分组头部的“资产已更新”与资产行共用同一事实来源（updated_asset_ids），
            // 只要组内任一 Release 存在未清除的资产级标识就展示，避免“头部有标识、
            // 展开后无任何资产行带标识”的不一致。
            const latestAssetsUpdated = releases.some(
              ({ release }) => shouldShowAssetsUpdatedIndicator(release)
            );

            return (
              <div key={repository.id} className="ui-card overflow-hidden">
                {/* Repository Header */}
                <Button
                  variant="ghost"
                  onClick={() => toggleReleaseExpandedRepository(repository.id)}
                  aria-expanded={isExpanded}
                  aria-controls={`release-group-${repository.id}`}
                  className="h-auto w-full flex items-center justify-between p-2 hover:bg-background dark:hover:bg-accent/50 transition-colors"
                >
                  <span className="flex items-center space-x-2">
                    {hasUnread && (
                      <span className="w-1.5 h-1.5 bg-primary rounded-full flex-shrink-0 animate-pulse"></span>
                    )}
                    <span className="flex items-center justify-center w-6 h-6 bg-primary/20 rounded flex-shrink-0">
                      <LayoutGrid className="w-3.5 h-3.5 text-primary" />
                    </span>
                    <span className="text-left">
                      <span className="block font-semibold text-sm text-foreground dark:text-foreground">
                        {repository.name}
                      </span>
                      <span className="block text-xs text-muted-foreground dark:text-muted-foreground">
                        {repository.full_name}
                      </span>
                    </span>
                  </span>
                  <span className="flex items-center space-x-2 min-w-0 ml-2">
                    <span className="text-right min-w-0">
                      <span className="block text-xs text-muted-foreground dark:text-muted-foreground hidden sm:block">
                        {releases.length} {t('releaseTimeline.releases')}
                      </span>
                      {latestRelease && (
                        <>
                          <span className="block text-xs text-muted-foreground dark:text-muted-foreground truncate">
                            {t('releaseTimeline.latest')} {latestRelease.tag_name}
                          </span>
                          {latestEffectiveTime && (
                            <span className="flex items-center justify-end gap-1 text-xs text-muted-foreground dark:text-muted-foreground/70 whitespace-nowrap">
                              {formatDistanceToNow(new Date(latestEffectiveTime), { addSuffix: true, locale: getDateFnsLocale(language) })}
                              {latestAssetsUpdated && (
                                <span className="text-xs px-1 py-px rounded bg-primary/10 text-primary font-medium">
                                  {t('releaseTimeline.assets-updated')}
                                </span>
                              )}
                            </span>
                          )}
                        </>
                      )}
                    </span>
                    <span className={`transform transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`}>
                      <ChevronDown className="w-4 h-4 text-muted-foreground dark:text-muted-foreground/70" />
                    </span>
                  </span>
                </Button>

                {/* Repository Releases (Collapsible) */}
                <div
                  id={`release-group-${repository.id}`}
                  className="grid transition-[grid-template-rows] duration-300 ease-in-out"
                  style={{ gridTemplateRows: isExpanded ? '1fr' : '0fr' }}
                >
                  {/* collapse-hidden 用延迟 visibility 替代 hidden：hidden 的 display:none
                      会直接打断 grid-rows 折叠/展开动画；visibility 过渡同样能把折叠内容
                      移出 Tab 焦点序与无障碍树，但动画得以保留。 */}
                  <div className={`overflow-hidden min-h-0 ${isExpanded ? '' : 'collapse-hidden'}`}>
                    <div className="border-t ui-divider bg-background dark:bg-card/50">
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
                            onMarkAssetAsRead={markAssetAsRead}
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
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => handlePageChange(1)}
              disabled={clampedPage === 1}
              aria-label={t('releaseTimeline.first-page')}
              className="h-9 w-9 rounded-lg bg-muted p-0 text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground hover:bg-accent dark:hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronsLeft className="w-4 h-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => handlePageChange(clampedPage - 1)}
              disabled={clampedPage === 1}
              aria-label={t('releaseTimeline.previous-page')}
              className="h-9 w-9 rounded-lg bg-muted p-0 text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground hover:bg-accent dark:hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            
            {getPageNumbers().map((page, index) => (
              typeof page === 'number' ? (
                <Button
                  key={index}
                  type="button"
                  aria-current={page === clampedPage ? 'page' : undefined}
                  onClick={() => handlePageChange(page)}
                  className={`px-3 py-2 rounded-lg text-sm ${
                    page === clampedPage
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground hover:bg-accent dark:hover:bg-accent'
                  }`}
                >
                  {page}
                </Button>
              ) : (
                <span key={index} className="px-3 py-2 text-sm text-muted-foreground">
                  {page}
                </span>
              )
            ))}
            
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => handlePageChange(clampedPage + 1)}
              disabled={clampedPage === totalPages}
              aria-label={t('releaseTimeline.next-page')}
              className="h-9 w-9 rounded-lg bg-muted p-0 text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground hover:bg-accent dark:hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => handlePageChange(totalPages)}
              disabled={clampedPage === totalPages}
              aria-label={t('releaseTimeline.last-page')}
              className="h-9 w-9 rounded-lg bg-muted p-0 text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground hover:bg-accent dark:hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronsRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
      <ReleaseSourceSettingsModal
        isOpen={isReleaseSourceSettingsOpen}
        onClose={() => setIsReleaseSourceSettingsOpen(false)}
      />
    </div>
  );
};
