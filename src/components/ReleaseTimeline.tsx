import { Input } from './ui/input';
import { Button } from './ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Package, Bell, Search, X, RefreshCw, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, LayoutGrid, CalendarDays, ChevronDown, CheckCircle, Filter, Settings } from 'lucide-react';
import { Release } from '../types';
import { useAppStore } from '../store/useAppStore';
import { GitHubApiService } from '../services/githubApi';
import { forceSyncToBackend } from '../services/autoSync';
import { backend } from '../services/backendAdapter';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { AssetFilterManager } from './AssetFilterManager';
import { PRESET_FILTERS } from '../constants/presetFilters';
import ReleaseCard from './ReleaseCard';
import { ReleaseSourceSettingsModal } from './ReleaseSourceSettingsModal';
import { useDialog } from '../hooks/useDialog';
import {
  STARRED_RELEASE_SOURCE_ID,
  WATCH_CUSTOM_RELEASE_SOURCE_ID,
  CUSTOM_RELEASE_SOURCE_ID,
  getReleaseSourceLabel,
  getSourcesForReleaseRepository,
  normalizeRepoKey,
  releaseBelongsToResolvedSources,
  resolveReleaseSources,
} from '../utils/releaseSources';
import {
  effectiveReleaseTime,
  findReleasesWithChangedAssets,
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
    githubToken,
    language,
    assetFilters,
    addReleases,
    upsertReleases,
    markReleaseAsRead,
    markAssetAsRead,
    markAllReleasesAsRead,
    batchUnsubscribeReleases,
    removeReleasesByRepoFullName,
    updateRepository,
    removeReleaseSourceRepository,
    updateReleaseSourceRepository,
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
    includePreRelease,
    setIncludePreRelease,
    releaseShowMode,
    setReleaseShowMode,
    releaseLatestMode,
    setReleaseLatestMode,
  } = useAppStore();

  const { toast, confirm } = useDialog();

  const [lastRefreshTime, setLastRefreshTime] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);
  // 独立的展开状态：下载资产和更新日志分开控制（本地状态，不持久化）
  const [expandedAssets, setExpandedAssets] = useState<Set<number>>(new Set());
  const [expandedReleaseNotes, setExpandedReleaseNotes] = useState<Set<number>>(new Set());
  const [fullContentReleases, setFullContentReleases] = useState<Set<number>>(new Set());
  const [isReleaseSourceSettingsOpen, setIsReleaseSourceSettingsOpen] = useState(false);
  const [isMarkingAllRead, setIsMarkingAllRead] = useState(false);

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
    const links: Array<{ name: string; url: string; size: number; downloadCount: number; isSourceCode?: boolean; assetId?: number }> = [];
    
    if (release.assets && release.assets.length > 0) {
      release.assets.forEach(asset => {
        links.push({
          name: asset.name,
          url: asset.browser_download_url,
          size: asset.size,
          downloadCount: asset.download_count,
          assetId: asset.id,
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
  }, [releases, resolvedReleaseSources, includePreRelease, releaseShowMode, releaseLatestMode]);

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

  const handleRefresh = async () => {
    if (!githubToken) {
      toast(language === 'zh' ? 'GitHub token 未找到，请重新登录。' : 'GitHub token not found. Please login again.', 'error');
      return;
    }

    const state = useAppStore.getState();
    const resolvedSources = resolveReleaseSources(state);
    const subscribedRepos = resolvedSources.repositories;

    if (resolvedSources.enabledSourceIds.length === 0) {
      toast(language === 'zh' ? '没有启用的 Release 来源。' : 'No release sources enabled.', 'error');
      return;
    }

    if (subscribedRepos.length === 0) {
      toast(language === 'zh' ? '所选来源中没有可检查的仓库。' : 'No repositories to check in the selected sources.', 'error');
      return;
    }

    setReleaseIsRefreshing(true);
    try {
      const githubApi = new GitHubApiService(githubToken);

      const { releases: newReleases, latestReleases, failedRepos } = await githubApi.getMultipleRepositoryReleases(
        subscribedRepos,
        { includePreRelease, refreshExistingAssets: true }
      );

      // Update repository sync metadata only for repos that succeeded
      const now = new Date().toISOString();
      const failedRepoIds = new Set(failedRepos.map(repo => repo.repoId));
      for (const entry of resolvedSources.entries) {
        const repo = entry.repository;
        if (failedRepoIds.has(repo.id)) {
          continue;
        }
        if (entry.sources.includes(STARRED_RELEASE_SOURCE_ID)) {
          const starredRepo = state.repositories.find(item => normalizeRepoKey(item.full_name) === normalizeRepoKey(repo.full_name));
          if (starredRepo) {
            updateRepository({
              ...starredRepo,
              has_fetched_releases: true,
              last_release_fetch_time: now,
            });
          }
        }
        if (entry.sources.includes(WATCH_CUSTOM_RELEASE_SOURCE_ID)) {
          updateReleaseSourceRepository(WATCH_CUSTOM_RELEASE_SOURCE_ID, repo.full_name, {
            has_fetched_releases: true,
            last_release_fetch_time: now,
          });
        }
        if (entry.sources.includes(CUSTOM_RELEASE_SOURCE_ID)) {
          updateReleaseSourceRepository(CUSTOM_RELEASE_SOURCE_ID, repo.full_name, {
            has_fetched_releases: true,
            last_release_fetch_time: now,
          });
        }
      }

      // Filter out existing releases and add new ones
      const existingIds = new Set(useAppStore.getState().releases.map(r => r.id));
      const actuallyNewReleases = newReleases.filter(r => !existingIds.has(r.id));
      const actuallyNewCount = actuallyNewReleases.length;

      if (actuallyNewReleases.length > 0) {
        addReleases(actuallyNewReleases);
      }

      // 只比每仓最新 1 条资产指纹：对已存在的最新 Release，若资产发生变化则按 id 合并更新，
      // 内容变化后由 upsertReleases 自动重置为未读（is_read=false 并从 readReleases 移除）。
      const updatedReleases = findReleasesWithChangedAssets(
        latestReleases,
        useAppStore.getState().releases
      );
      const updatedCount = updatedReleases.length;

      if (updatedReleases.length > 0) {
        upsertReleases(updatedReleases);
      }

      setLastRefreshTime(now);

      // Build success message with failed repos info
      let message: string;
      const updatedPart = updatedCount > 0
        ? (language === 'zh' ? `，${updatedCount} 个Release资产已更新` : `, ${updatedCount} release assets updated`)
        : '';
      if (failedRepos.length > 0) {
        message = language === 'zh'
          ? `刷新完成！发现 ${actuallyNewCount} 个新Release${updatedPart}，${failedRepos.length} 个仓库刷新失败。`
          : `Refresh completed! Found ${actuallyNewCount} new releases${updatedPart}, ${failedRepos.length} repos failed.`;
      } else {
        message = language === 'zh'
          ? `刷新完成！发现 ${actuallyNewCount} 个新Release${updatedPart}。`
          : `Refresh completed! Found ${actuallyNewCount} new releases${updatedPart}.`;
      }

      toast(message, actuallyNewCount > 0 || updatedCount > 0 ? 'success' : 'info');
    } catch (error) {
      console.error('Refresh failed:', error);
      const errorMessage = language === 'zh'
        ? 'Release刷新失败，请检查网络连接。'
        : 'Release refresh failed. Please check your network connection.';
      toast(errorMessage, 'error');
    } finally {
      setReleaseIsRefreshing(false);
    }
  };

  const handleShowModeChange = (mode: 'all' | 'unread') => {
    setReleaseShowMode(mode);
    setCurrentPage(1);
  };

  const handleLatestModeChange = (mode: 'all' | 'latest') => {
    setReleaseLatestMode(mode);
    setCurrentPage(1);
  };

  const handleMarkAllRead = async () => {
    setIsMarkingAllRead(true);
    try {
      markAllReleasesAsRead();
      await backend.markAllReleasesAsRead();
      toast(t('已全部标记为已读', 'All marked as read'), 'success');
    } catch {
      toast(t('标记全部已读失败', 'Failed to mark all as read'), 'error');
    } finally {
      setIsMarkingAllRead(false);
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
    const release = releases.find(item => item.repository.id === repoId);
    const releaseRepo = release?.repository;
    if (!releaseRepo) {
      toast(t('仓库信息不完整，无法取消订阅。', 'Repository information missing. Cannot unsubscribe.'), 'error');
      return;
    }

    const stateBeforeConfirm = useAppStore.getState();
    const repoKey = normalizeRepoKey(releaseRepo.full_name);
    const starredRepo = stateBeforeConfirm.repositories.find(item => normalizeRepoKey(item.full_name) === repoKey);
    const sourcesToRemove = getSourcesForReleaseRepository(stateBeforeConfirm, releaseRepo);
    const isOrphanRelease = sourcesToRemove.length === 0;
    const sourceLabels = sourcesToRemove.map(sourceId => getReleaseSourceLabel(sourceId, language));

    let confirmMessage: string;
    if (isOrphanRelease) {
      confirmMessage = language === 'zh'
        ? `"${releaseRepo.full_name}" 当前不在任何 Release 来源中。确认后仅移除本地已缓存的 Release 记录。`
        : `"${releaseRepo.full_name}" is not in any release source. Confirming will only remove locally cached releases.`;
    } else if (sourcesToRemove.length > 1) {
      confirmMessage = language === 'zh'
        ? `"${releaseRepo.full_name}" 同时来自多个 Release 来源：${sourceLabels.join('、')}。确认后将从这些来源中一并取消订阅。`
        : `"${releaseRepo.full_name}" comes from multiple release sources: ${sourceLabels.join(', ')}. Confirming will unsubscribe it from all of these sources.`;
    } else if (sourcesToRemove[0] === WATCH_CUSTOM_RELEASE_SOURCE_ID) {
      confirmMessage = language === 'zh'
        ? `确定取消订阅 "${releaseRepo.full_name}" 吗？确认后将一并取消 Watch 仓库来源。`
        : `Unsubscribe from "${releaseRepo.full_name}"? This will also remove it from Watch repositories.`;
    } else if (sourcesToRemove[0] === CUSTOM_RELEASE_SOURCE_ID) {
      confirmMessage = language === 'zh'
        ? `确定取消订阅 "${releaseRepo.full_name}" 吗？确认后将从自定义仓库列表中移除。`
        : `Unsubscribe from "${releaseRepo.full_name}"? This will remove it from the custom repository list.`;
    } else {
      confirmMessage = language === 'zh'
        ? `确定取消订阅 "${releaseRepo.full_name}" 的 Release 吗？`
        : `Unsubscribe from releases for "${releaseRepo.full_name}"?`;
    }

    const confirmed = await confirm(
      t('取消订阅确认', 'Unsubscribe Confirmation'),
      confirmMessage,
      { type: 'warning' }
    );
    if (!confirmed) {
      return;
    }

    const rollbackState = {
      repositories: stateBeforeConfirm.repositories,
      searchResults: stateBeforeConfirm.searchResults,
      releaseSubscriptions: new Set(stateBeforeConfirm.releaseSubscriptions),
      releaseSourceSettings: stateBeforeConfirm.releaseSourceSettings,
      releases: stateBeforeConfirm.releases,
      readReleases: new Set(stateBeforeConfirm.readReleases),
      releaseExpandedRepositories: new Set(stateBeforeConfirm.releaseExpandedRepositories),
    };

    if (sourcesToRemove.includes(STARRED_RELEASE_SOURCE_ID) && starredRepo) {
      updateRepository({ ...starredRepo, subscribed_to_releases: false });
      batchUnsubscribeReleases([starredRepo.id]);
    }
    if (sourcesToRemove.includes(WATCH_CUSTOM_RELEASE_SOURCE_ID)) {
      removeReleaseSourceRepository(WATCH_CUSTOM_RELEASE_SOURCE_ID, releaseRepo.full_name);
    }
    if (sourcesToRemove.includes(CUSTOM_RELEASE_SOURCE_ID)) {
      removeReleaseSourceRepository(CUSTOM_RELEASE_SOURCE_ID, releaseRepo.full_name);
    }

    const stateAfterRemoval = useAppStore.getState();
    const stillActive = resolveReleaseSources(stateAfterRemoval).entries
      .some(entry => normalizeRepoKey(entry.repository.full_name) === repoKey);
    if (!stillActive) {
      removeReleasesByRepoFullName(releaseRepo.full_name);
    }

    try {
      await forceSyncToBackend();
    } catch (error) {
      console.error('Failed to unsubscribe release:', error);
      useAppStore.setState(rollbackState);
      toast(t('取消订阅失败，请检查后端连接。', 'Failed to unsubscribe. Please check backend connection.'), 'error');
      return;
    }

    toast(t('已取消订阅该仓库的 Release。', 'Unsubscribed from repository releases.'), 'success');
  };

  if (subscribedReleases.length === 0) {
    const subscribedRepoCount = activeReleaseRepoCount;

    return (
      <>
      <div className="text-center py-12">
               <Package className="w-16 h-16 text-muted-foreground dark:text-quaternary mx-auto mb-4" />
         <h3 className="text-lg font-medium text-foreground dark:text-foreground mb-2">
          {subscribedRepoCount === 0 ? t('没有Release订阅', 'No Release Subscriptions') : t('没有最近的Release', 'No Recent Releases')}
        </h3>
             <p className="text-muted-foreground dark:text-muted-foreground mb-6 max-w-md mx-auto">
               {subscribedRepoCount === 0
                 ? t('从仓库页面订阅仓库Release以在此查看更新。', 'Subscribe to repository releases from the Repositories tab to see updates here.')
                 : t(`您已订阅 ${subscribedRepoCount} 个仓库，但没有找到最近的Release。点击下方刷新按钮获取最新更新。`, `You're subscribed to ${subscribedRepoCount} repositories, but no recent releases were found. Click the refresh button below to get the latest updates.`)
               }
             </p>
        
        {/* Pre-release toggle + Refresh button */}
        {subscribedRepoCount > 0 && (
           <div className="mb-6 flex flex-col items-center gap-3">
             {/* Pre-release toggle */}
             <div className="flex items-center gap-2 select-none">
               <Button
                 type="button"
                 role="switch"
                 aria-checked={includePreRelease}
                 aria-label={t('包含 Pre-release', 'Include Pre-release')}
                 onClick={() => setIncludePreRelease(!includePreRelease)}
                 className={`relative inline-flex h-5 w-9 p-0 items-center rounded-full transition-colors ${includePreRelease ? 'bg-primary' : 'bg-gray-300 dark:bg-accent'}`}
               >
                 <span
                   className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${includePreRelease ? 'translate-x-[18px]' : 'translate-x-[2px]'}`}
                 />
               </Button>
               <span
                 className="cursor-pointer text-sm text-muted-foreground dark:text-muted-foreground"
                 onClick={() => setIncludePreRelease(!includePreRelease)}
               >
                 {t('包含 Pre-release', 'Include Pre-release')}
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
                 <span>{releaseIsRefreshing ? t('刷新中...', 'Refreshing...') : t('刷新Release', 'Refresh Releases')}</span>
               </Button>
               <Button
                 onClick={() => setIsReleaseSourceSettingsOpen(true)}
                 className="flex items-center space-x-2 px-4 py-3 bg-muted text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground rounded-lg hover:bg-accent dark:hover:bg-accent transition-colors"
                 title={t('Release 来源设置', 'Release Source Settings')}
               >
                 <Settings className="w-5 h-5" />
                 <span>{t('来源设置', 'Sources')}</span>
               </Button>
             </div>
            {lastRefreshTime && (
              <p className="text-sm text-muted-foreground dark:text-muted-foreground">
                {t('上次刷新:', 'Last refresh:')} {formatDistanceToNow(new Date(lastRefreshTime), { addSuffix: true, locale: language === 'zh' ? zhCN : undefined })}
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
                  {t('订阅仓库Release', 'Subscribe to Repository Releases')}
                </h3>
                <p className="text-sm text-muted-foreground dark:text-muted-foreground mb-3 leading-relaxed">
                  {t('订阅后，您可以在这里查看所有关注仓库的最新发布版本，第一时间获取更新动态。', 'Subscribe to receive the latest release updates from your favorite repositories in one place.')}
                </p>
                <div className="bg-white/60 dark:bg-card/60 rounded-lg p-3 text-sm">
                  <div className="flex items-center space-x-2 text-muted-foreground dark:text-muted-foreground font-medium mb-2">
                    <span className="w-5 h-5 bg-primary text-white rounded-full flex items-center justify-center text-xs">1</span>
                    <span>{t('前往仓库页面', 'Go to Repositories')}</span>
                  </div>
                  <div className="flex items-center space-x-2 text-muted-foreground dark:text-muted-foreground font-medium">
                    <span className="w-5 h-5 bg-primary text-white rounded-full flex items-center justify-center text-xs">2</span>
                    <span>{t('点击仓库卡片上的铃铛图标', 'Click the bell icon on any repository card')}</span>
                  </div>
                </div>
                <div className="mt-4 rounded-lg bg-white/60 dark:bg-card/60 p-3 text-sm text-muted-foreground dark:text-muted-foreground">
                  <p className="mb-3">
                    {t('也可以通过 Watch 仓库同步或自定义仓库列表作为 Release 来源。', 'You can also use Watch repository sync or a custom repository list as release sources.')}
                  </p>
                  <Button
                    onClick={() => setIsReleaseSourceSettingsOpen(true)}
                    className="inline-flex items-center space-x-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                    title={t('Release 来源设置', 'Release Source Settings')}
                  >
                    <Settings className="w-4 h-4" />
                    <span>{t('配置 Release 来源', 'Configure Release Sources')}</span>
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
              {t('Release时间线', 'Release Timeline')}
            </h2>
            <p className="text-muted-foreground dark:text-muted-foreground">
              {t(`来自您的 ${activeReleaseRepoCount} 个订阅仓库的最新Release`, `Latest releases from your ${activeReleaseRepoCount} subscribed repositories`)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {/* Last Refresh Time */}
            {lastRefreshTime && (
              <span className="w-full text-sm text-muted-foreground dark:text-muted-foreground lg:w-auto">
                {t('上次刷新:', 'Last refresh:')} {formatDistanceToNow(new Date(lastRefreshTime), { addSuffix: true, locale: language === 'zh' ? zhCN : undefined })}
              </span>
            )}

            {/* Pre-release toggle */}
            <div className="flex items-center gap-1.5 select-none">
              <Button
                type="button"
                role="switch"
                aria-checked={includePreRelease}
                aria-label={t('包含 Pre-release', 'Include Pre-release')}
                onClick={() => setIncludePreRelease(!includePreRelease)}
                className={`relative inline-flex h-5 w-9 p-0 items-center rounded-full transition-colors ${includePreRelease ? 'bg-primary' : 'bg-gray-300 dark:bg-accent'}`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${includePreRelease ? 'translate-x-[18px]' : 'translate-x-[2px]'}`}
                />
              </Button>
              <span
                className="hidden cursor-pointer text-xs text-muted-foreground dark:text-muted-foreground sm:inline"
                onClick={() => setIncludePreRelease(!includePreRelease)}
              >
                {t('Pre', 'Pre')}
              </span>
            </div>

            {/* Refresh Button */}
            <Button
              onClick={handleRefresh}
              disabled={releaseIsRefreshing}
              className="ui-button-primary flex items-center space-x-2 px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`w-4 h-4 ${releaseIsRefreshing ? 'animate-spin' : ''}`} />
              <span>{releaseIsRefreshing ? t('刷新中...', 'Refreshing...') : t('刷新', 'Refresh')}</span>
            </Button>
            <Button
              onClick={() => setIsReleaseSourceSettingsOpen(true)}
              variant="ghost"
              className="ui-button flex items-center space-x-2 px-3 py-2"
              title={t('Release 来源设置', 'Release Source Settings')}
            >
              <Settings className="w-4 h-4 text-muted-foreground dark:text-muted-foreground" />
              <span className="text-sm font-medium text-foreground dark:text-muted-foreground">{t('来源', 'Sources')}</span>
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
              placeholder={t('搜索Release...', 'Search releases...')}
              value={searchQuery}
              onChange={(e) => {
                setReleaseSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              className="ui-field w-full pl-10 pr-10 py-2 text-foreground dark:text-foreground"
            />
            {searchQuery && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setReleaseSearchQuery('');
                  setCurrentPage(1);
                }}
                aria-label={t('清除搜索', 'Clear search')}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground dark:text-muted-foreground/70 hover:text-muted-foreground dark:text-muted-foreground dark:hover:text-gray-300"
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

            {/* View Mode Toggle Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="group ui-button flex items-center space-x-2 px-3 py-2"
                  title={viewMode === 'timeline' ? t('按日期排序视图', 'Timeline View') : t('仓库分类视图', 'Repository View')}
                >
                  {viewMode === 'timeline' ? (
                    <CalendarDays className="w-4 h-4 text-muted-foreground dark:text-muted-foreground" />
                  ) : (
                    <LayoutGrid className="w-4 h-4 text-muted-foreground dark:text-muted-foreground" />
                  )}
                  <span className="text-sm font-medium text-foreground dark:text-muted-foreground">
                    {viewMode === 'timeline' ? t('按日期', 'Timeline') : t('按仓库', 'Repository')}
                  </span>
                  <ChevronDown className="w-4 h-4 text-muted-foreground dark:text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem
                  onSelect={() => {
                    setReleaseViewMode('timeline');
                    setCurrentPage(1);
                  }}
                  className={`flex items-start space-x-3 px-4 py-2.5 ${
                    viewMode === 'timeline' ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground'
                  }`}
                >
                  <CalendarDays className={`w-4 h-4 mt-0.5 ${viewMode === 'timeline' ? 'text-foreground' : 'text-muted-foreground'}`} />
                  <div>
                    <div className="text-sm font-medium">{t('按日期排序', 'Timeline View')}</div>
                    <div className="text-xs text-muted-foreground">{t('按发布时间排序', 'Sort by publish date')}</div>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    setReleaseViewMode('repository');
                    setCurrentPage(1);
                  }}
                  className={`flex items-start space-x-3 px-4 py-2.5 ${
                    viewMode === 'repository' ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground'
                  }`}
                >
                  <LayoutGrid className={`w-4 h-4 mt-0.5 ${viewMode === 'repository' ? 'text-foreground' : 'text-muted-foreground'}`} />
                  <div>
                    <div className="text-sm font-medium">{t('仓库分类', 'Repository View')}</div>
                    <div className="text-xs text-muted-foreground">{t('按仓库分组折叠', 'Group by repository')}</div>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Results Info and Controls */}
        <div className="flex flex-col gap-2 mb-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2 sm:gap-4">
            <span className="text-sm text-muted-foreground dark:text-muted-foreground">
              {viewMode === 'timeline'
                ? releaseShowMode === 'unread'
                  ? t(
                      `显示 ${startIndex + 1}-${Math.min(startIndex + itemsPerPage, filteredReleases.length)} 共 ${filteredReleases.length} 个未读 (总计 ${preUnreadFilteredReleases.length})`,
                      `Showing ${startIndex + 1}-${Math.min(startIndex + itemsPerPage, filteredReleases.length)} of ${filteredReleases.length} unread (total: ${preUnreadFilteredReleases.length})`
                    )
                  : t(
                      `显示 ${startIndex + 1}-${Math.min(startIndex + itemsPerPage, filteredReleases.length)} 共 ${filteredReleases.length} 个Release`,
                      `Showing ${startIndex + 1}-${Math.min(startIndex + itemsPerPage, filteredReleases.length)} of ${filteredReleases.length} releases`
                    )
                : releaseShowMode === 'unread'
                  ? t(
                      `显示 ${startIndex + 1}-${Math.min(startIndex + itemsPerPage, repositoryGroups.length)} 共 ${repositoryGroups.length} 个未读仓库 (总计 ${preUnreadFilteredReleases.length})`,
                      `Showing ${startIndex + 1}-${Math.min(startIndex + itemsPerPage, repositoryGroups.length)} of ${repositoryGroups.length} unread repos (total: ${preUnreadFilteredReleases.length})`
                    )
                  : t(
                      `显示 ${startIndex + 1}-${Math.min(startIndex + itemsPerPage, repositoryGroups.length)} 共 ${repositoryGroups.length} 个仓库`,
                      `Showing ${startIndex + 1}-${Math.min(startIndex + itemsPerPage, repositoryGroups.length)} of ${repositoryGroups.length} repositories`
                    )
              }
            </span>
            {releaseShowMode === 'all' && unreadCount > 0 && (
              <span className="text-sm text-primary dark:text-primary">
                ({unreadCount} {t('未读', 'unread')})
              </span>
            )}
            {(searchQuery || selectedFilters.length > 0) && (
              <span className="text-sm text-primary dark:text-primary">
                ({t('已筛选', 'filtered')})
              </span>
            )}
            {releaseLatestMode === 'latest' && (
              <span className="text-sm text-primary dark:text-primary">
                ({t('仅最新', 'latest only')})
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Show Mode Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="group ui-button flex items-center space-x-2 px-3 py-2"
                  title={releaseShowMode === 'all' ? t('显示全部', 'Show All') : t('仅显示未读', 'Show Unread Only')}
                >
                  <Filter className="w-4 h-4 text-muted-foreground dark:text-muted-foreground" />
                  <span className="text-sm font-medium text-foreground dark:text-muted-foreground">
                    {releaseShowMode === 'all' ? t('全部', 'All') : t('仅未读', 'Unread')}
                  </span>
                  <ChevronDown className="w-4 h-4 text-muted-foreground dark:text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48">
                <DropdownMenuItem
                  onSelect={() => handleShowModeChange('all')}
                  className={`flex items-start space-x-3 px-4 py-2.5 ${
                    releaseShowMode === 'all' ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground'
                  }`}
                >
                  <Filter className={`w-4 h-4 mt-0.5 ${releaseShowMode === 'all' ? 'text-foreground' : 'text-muted-foreground'}`} />
                  <div>
                    <div className="text-sm font-medium">{t('显示全部', 'Show All')}</div>
                    <div className="text-xs text-muted-foreground">{t('显示所有Release', 'Show all releases')}</div>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => handleShowModeChange('unread')}
                  className={`flex items-start space-x-3 px-4 py-2.5 ${
                    releaseShowMode === 'unread' ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground'
                  }`}
                >
                  <Filter className={`w-4 h-4 mt-0.5 ${releaseShowMode === 'unread' ? 'text-foreground' : 'text-muted-foreground'}`} />
                  <div>
                    <div className="text-sm font-medium">{t('仅显示未读', 'Unread Only')}</div>
                    <div className="text-xs text-muted-foreground">{t('只显示未读的Release', 'Only show unread releases')}</div>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Latest Mode Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="group ui-button flex items-center space-x-2 px-3 py-2"
                  title={releaseLatestMode === 'all' ? t('显示全部', 'Show All') : t('仅显示最新', 'Latest Only')}
                >
                  <Package className="w-4 h-4 text-muted-foreground dark:text-muted-foreground" />
                  <span className="text-sm font-medium text-foreground dark:text-muted-foreground">
                    {releaseLatestMode === 'all' ? t('全部版本', 'All Versions') : t('仅最新', 'Latest')}
                  </span>
                  <ChevronDown className="w-4 h-4 text-muted-foreground dark:text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48">
                <DropdownMenuItem
                  onSelect={() => handleLatestModeChange('all')}
                  className={`flex items-start space-x-3 px-4 py-2.5 ${
                    releaseLatestMode === 'all' ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground'
                  }`}
                >
                  <Package className={`w-4 h-4 mt-0.5 ${releaseLatestMode === 'all' ? 'text-foreground' : 'text-muted-foreground'}`} />
                  <div>
                    <div className="text-sm font-medium">{t('显示全部版本', 'Show All Versions')}</div>
                    <div className="text-xs text-muted-foreground">{t('显示所有Release记录', 'Show all release records')}</div>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => handleLatestModeChange('latest')}
                  className={`flex items-start space-x-3 px-4 py-2.5 ${
                    releaseLatestMode === 'latest' ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground'
                  }`}
                >
                  <Package className={`w-4 h-4 mt-0.5 ${releaseLatestMode === 'latest' ? 'text-foreground' : 'text-muted-foreground'}`} />
                  <div>
                    <div className="text-sm font-medium">{t('仅显示最新版本', 'Latest Version Only')}</div>
                    <div className="text-xs text-muted-foreground">{t('每个仓库仅显示最新Release', 'Show only the latest release per repo')}</div>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Items per page selector */}
            <div className="flex items-center space-x-2">
              <span className="text-sm text-muted-foreground dark:text-muted-foreground">{t('每页:', 'Per page:')}</span>
              <Select value={String(itemsPerPage)} onValueChange={(value) => { setItemsPerPage(Number(value)); setCurrentPage(1); }}>
                <SelectTrigger aria-label={t('每页条数', 'Items per page')} className="ui-field h-9 min-w-20 px-3 py-1 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="20">20</SelectItem><SelectItem value="50">50</SelectItem><SelectItem value="100">100</SelectItem><SelectItem value="200">200</SelectItem></SelectContent>
              </Select>
            </div>

            {/* Mark All Read button */}
            <Button
              onClick={handleMarkAllRead}
              disabled={isMarkingAllRead || unreadCount === 0}
              className="flex items-center space-x-2 px-3 py-2 bg-muted dark:bg-muted/40 rounded-lg hover:bg-accent dark:hover:bg-accent transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              title={t('全部标记为已读', 'Mark all as read')}
            >
              {isMarkingAllRead ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              <span className="text-sm font-medium text-foreground dark:text-muted-foreground">{t('全部已读', 'Mark All Read')}</span>
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
                ? t('没有未读的 Release', 'No unread releases')
                : t('无符合条件的结果', 'No matching results')}
            </h3>
            <p className="text-sm text-muted-foreground dark:text-muted-foreground">
              {releaseShowMode === 'unread'
                ? t('所有 Release 都已标记为已读', 'All releases have been marked as read')
                : selectedFilters.length > 0
                  ? t('当前过滤器没有匹配到任何资产，请尝试其他过滤条件', 'No assets match the current filters. Try different filter criteria.')
                  : t('没有找到匹配的 Release', 'No matching releases found.')}
            </p>
            {releaseShowMode === 'unread' && (
              <Button
                onClick={() => handleShowModeChange('all')}
                className="ui-button-primary mt-4 px-4 py-2 text-sm"
              >
                {t('查看全部', 'Show All')}
              </Button>
            )}
            {selectedFilters.length > 0 && releaseShowMode !== 'unread' && (
              <Button
                onClick={handleClearFilters}
                className="ui-button-primary mt-4 px-4 py-2 text-sm"
              >
                {t('清除过滤器', 'Clear Filters')}
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
                  className="w-full flex items-center justify-between p-2 hover:bg-background dark:hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-center space-x-2">
                    {hasUnread && (
                      <div className="w-1.5 h-1.5 bg-primary rounded-full flex-shrink-0 animate-pulse"></div>
                    )}
                    <div className="flex items-center justify-center w-6 h-6 bg-primary/20 rounded flex-shrink-0">
                      <LayoutGrid className="w-3.5 h-3.5 text-primary" />
                    </div>
                    <div className="text-left">
                      <h3 className="font-semibold text-sm text-foreground dark:text-foreground">
                        {repository.name}
                      </h3>
                      <p className="text-xs text-muted-foreground dark:text-muted-foreground">
                        {repository.full_name}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2 min-w-0 ml-2">
                    <div className="text-right min-w-0">
                      <p className="text-xs text-muted-foreground dark:text-muted-foreground hidden sm:block">
                        {releases.length} {t('个版本', 'releases')}
                      </p>
                      {latestRelease && (
                        <>
                          <p className="text-xs text-muted-foreground dark:text-muted-foreground truncate">
                            {t('最新:', 'Latest:')} {latestRelease.tag_name}
                          </p>
                          {latestEffectiveTime && (
                            <p className="text-xs text-muted-foreground dark:text-muted-foreground/70 whitespace-nowrap flex items-center justify-end gap-1">
                              {formatDistanceToNow(new Date(latestEffectiveTime), { addSuffix: true, locale: language === 'zh' ? zhCN : undefined })}
                              {latestAssetsUpdated && (
                                <span className="text-[10px] px-1 py-px rounded bg-primary/10 text-primary font-medium">
                                  {t('资产已更新', 'Assets updated')}
                                </span>
                              )}
                            </p>
                          )}
                        </>
                      )}
                    </div>
                    <div className={`transform transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`}>
                      <ChevronDown className="w-4 h-4 text-muted-foreground dark:text-muted-foreground/70" />
                    </div>
                  </div>
                </Button>

                {/* Repository Releases (Collapsible) */}
                <div
                  id={`release-group-${repository.id}`}
                  className="grid transition-[grid-template-rows] duration-300 ease-in-out"
                  style={{ gridTemplateRows: isExpanded ? '1fr' : '0fr' }}
                >
                  <div className="overflow-hidden min-h-0">
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
              onClick={() => handlePageChange(1)}
              disabled={clampedPage === 1}
              aria-label={t('第一页', 'First page')}
              className="p-2 rounded-lg bg-muted text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground hover:bg-accent dark:hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronsLeft className="w-4 h-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => handlePageChange(clampedPage - 1)}
              disabled={clampedPage === 1}
              aria-label={t('上一页', 'Previous page')}
              className="p-2 rounded-lg bg-muted text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground hover:bg-accent dark:hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
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
              onClick={() => handlePageChange(clampedPage + 1)}
              disabled={clampedPage === totalPages}
              aria-label={t('下一页', 'Next page')}
              className="p-2 rounded-lg bg-muted text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground hover:bg-accent dark:hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => handlePageChange(totalPages)}
              disabled={clampedPage === totalPages}
              aria-label={t('最后一页', 'Last page')}
              className="p-2 rounded-lg bg-muted text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground hover:bg-accent dark:hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
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
