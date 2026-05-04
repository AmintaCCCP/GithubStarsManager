import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Package, Search, X, RefreshCw, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Loader2, GitFork } from 'lucide-react';
import { ForkRepo, WorkflowDefinition } from '../types';
import { useAppStore } from '../store/useAppStore';
import { GitHubApiService } from '../services/githubApi';
import { formatDistanceToNow } from 'date-fns';
import ForkCard from './ForkCard';
import { useDialog } from '../hooks/useDialog';
import { Modal } from './Modal';

export const ForkTimeline: React.FC = () => {
  const {
    forks,
    readForks,
    githubToken,
    language,
    setForks,
    addForks,
    markForkAsRead,
    markAllForksAsRead,
    updateFork,
    // Fork Timeline View State from global store
    forkViewMode,
    forkSelectedFilters,
    forkSearchQuery,
    forkExpandedRepositories,
    forkIsRefreshing,
    setForkViewMode,
    toggleForkSelectedFilter,
    clearForkSelectedFilters,
    setForkSearchQuery,
    toggleForkExpandedRepository,
    setForkIsRefreshing,
  } = useAppStore();

  const { toast, confirm } = useDialog();

  const [lastRefreshTime, setLastRefreshTime] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);
  // Workflow expansion state (local UI state)
  const [expandedWorkflows, setExpandedWorkflows] = useState<Set<number>>(new Set());
  const [workflowsMap, setWorkflowsMap] = useState<Record<number, WorkflowDefinition[]>>({});
  const [loadingWorkflows, setLoadingWorkflows] = useState<Set<number>>(new Set());
  const [syncingForks, setSyncingForks] = useState<Set<number>>(new Set());
  const [runningWorkflows, setRunningWorkflows] = useState<Set<number>>(new Set());
  // Track which forks need sync (out-of-date vs already-up-to-date)
  const [needsSyncMap, setNeedsSyncMap] = useState<Record<number, boolean>>({});

  // Sync Modal state
  const [syncModal, setSyncModal] = useState<{
    isOpen: boolean;
    forkId: number | null;
    owner: string;
    repo: string;
    branch: string;
    full_name: string;
  }>({
    isOpen: false,
    forkId: null,
    owner: '',
    repo: '',
    branch: 'main',
    full_name: ''
  });
  const [syncModalBranches, setSyncModalBranches] = useState<string[]>([]);
  const [isFetchingBranches, setIsFetchingBranches] = useState(false);

  // Alias global state for local use
  const viewMode = forkViewMode;
  const selectedFilters = forkSelectedFilters;
  const searchQuery = forkSearchQuery;
  const expandedRepositories = forkExpandedRepositories;

  const t = useCallback((zh: string, en: string) => language === 'zh' ? zh : en, [language]);

  const isForkUnread = useCallback((forkId: number) => {
    return !readForks.has(forkId);
  }, [readForks]);

  // Filter and sort forks
  const filteredForks = useMemo(() => {
    let filtered = [...forks];

    // Only show actual forks (not user-created repos)
    filtered = filtered.filter(fork => fork.fork === true);

    // Sort by source.updated_at desc (upstream latest update first)
    filtered.sort((a, b) => {
      const aTime = a.source?.updated_at ? new Date(a.source.updated_at).getTime() : 0;
      const bTime = b.source?.updated_at ? new Date(b.source.updated_at).getTime() : 0;
      return bTime - aTime;
    });

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(fork =>
        fork.name.toLowerCase().includes(query) ||
        fork.full_name.toLowerCase().includes(query) ||
        (fork.source?.full_name || '').toLowerCase().includes(query) ||
        (fork.description || '').toLowerCase().includes(query) ||
        (fork.source?.description || '').toLowerCase().includes(query)
      );
    }

    return filtered;
  }, [forks, searchQuery]);

  // Pagination
  const totalPages = Math.ceil(filteredForks.length / itemsPerPage);
  const clampedPage = Math.max(1, Math.min(currentPage, totalPages || 1));
  const startIndex = (clampedPage - 1) * itemsPerPage;
  const paginatedForks = filteredForks.slice(startIndex, startIndex + itemsPerPage);

  // Sync currentPage when data changes
  useEffect(() => {
    const maxPage = Math.max(totalPages, 1);
    if (currentPage < 1 || currentPage > maxPage) {
      setCurrentPage(Math.min(Math.max(currentPage, 1), maxPage));
    }
  }, [totalPages, currentPage]);

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

  const handleRefresh = async () => {
    if (!githubToken) {
      toast(language === 'zh' ? 'GitHub token 未找到，请重新登录。' : 'GitHub token not found. Please login again.', 'error');
      return;
    }

    setForkIsRefreshing(true);
    try {
      const githubApi = new GitHubApiService(githubToken);
      const newForks = await githubApi.getUserForks();

      // Merge with existing forks, preserving read status
      const existingForkMap = new Map(forks.map(f => [f.id, f]));
      const mergedForks: ForkRepo[] = newForks.map(newFork => {
        const existing = existingForkMap.get(newFork.id);
        if (existing) {
          // Preserve local state
          return {
            ...newFork,
            has_unread: existing.has_unread,
            upstream_updated_at: existing.upstream_updated_at,
          };
        }
        // New fork — mark as unread if upstream has updates
        return {
          ...newFork,
          has_unread: false,
          upstream_updated_at: newFork.source?.updated_at,
        };
      });

      // Check for upstream updates on existing forks - mark as unread if source has newer commits
      const updatedForks = mergedForks.map(fork => {
        const existing = existingForkMap.get(fork.id);
        if (existing) {
          // Compare: if source updated since last check, mark as unread
          const prevUpstreamTime = existing.upstream_updated_at;
          const currentUpstreamTime = fork.source?.updated_at;
          if (prevUpstreamTime && currentUpstreamTime) {
            const hasNewUpdates = new Date(currentUpstreamTime) > new Date(prevUpstreamTime);
            if (hasNewUpdates) {
              // Mark as unread by removing from readForks
              useAppStore.setState(state => {
                const newReadForks = new Set(state.readForks);
                newReadForks.delete(fork.id);
                return { readForks: newReadForks };
              });
              return {
                ...fork,
                upstream_updated_at: currentUpstreamTime,
              };
            }
          }
          return {
            ...fork,
            upstream_updated_at: existing.upstream_updated_at || fork.source?.updated_at,
          };
        }
        return fork;
      });

      setForks(updatedForks);
      const now = new Date().toISOString();
      setLastRefreshTime(now);

      // Pre-check sync status for all forks (out-of-date vs already up-to-date)
      const syncChecks: Promise<void>[] = updatedForks.map(async (fork) => {
        if (!fork.fork) return;
        const [owner, repo] = fork.full_name.split('/');
        const branch = fork.default_branch || 'main';
        try {
          const result = await githubApi.checkForkSyncNeeded(
            owner, 
            repo, 
            branch, 
            fork.parent?.full_name || fork.source?.full_name
          );
          setNeedsSyncMap(prev => ({ ...prev, [fork.id]: result.needsSync }));
          
          if (result.parentFullName && result.parentHtmlUrl && !fork.parent && !fork.source) {
            const currentForks = useAppStore.getState().forks;
            setForks(currentForks.map(f => f.id === fork.id ? { 
              ...f, 
              parent: { 
                id: 0, 
                full_name: result.parentFullName as string, 
                name: (result.parentFullName as string).split('/')[1], 
                html_url: result.parentHtmlUrl as string 
              } 
            } : f));
          }
        } catch {
          setNeedsSyncMap(prev => ({ ...prev, [fork.id]: false }));
        }
      });
      await Promise.all(syncChecks);

      // Count new forks
      const newCount = newForks.filter(f => !existingForkMap.has(f.id)).length;
      if (newCount > 0) {
        toast(language === 'zh'
          ? `刷新完成！发现 ${newCount} 个新Fork。`
          : `Refresh completed! Found ${newCount} new forks.`,
          'success'
        );
      } else {
        toast(language === 'zh'
          ? `刷新完成！`
          : `Refresh completed!`,
          'info'
        );
      }
    } catch (error) {
      console.error('Fork refresh failed:', error);
      toast(language === 'zh'
        ? 'Fork刷新失败，请检查网络连接。'
        : 'Fork refresh failed. Please check your network connection.',
        'error'
      );
    } finally {
      setForkIsRefreshing(false);
    }
  };

  const toggleWorkflows = async (forkId: number) => {
    setExpandedWorkflows(prev => {
      const newSet = new Set(prev);
      if (newSet.has(forkId)) {
        newSet.delete(forkId);
      } else {
        newSet.add(forkId);
        // Fetch workflows if not loaded yet
        if (!workflowsMap[forkId]) {
          loadWorkflows(forkId);
        }
      }
      return newSet;
    });
  };

  const loadWorkflows = async (forkId: number) => {
    const fork = forks.find(f => f.id === forkId);
    if (!fork || !githubToken) return;

    setLoadingWorkflows(prev => new Set(prev).add(forkId));
    try {
      const [owner, repo] = fork.full_name.split('/');
      const githubApi = new GitHubApiService(githubToken);
      const workflows = await githubApi.getRepositoryWorkflows(owner, repo);
      setWorkflowsMap(prev => ({ ...prev, [forkId]: workflows }));
    } catch (error) {
      console.error('Failed to load workflows:', error);
    } finally {
      setLoadingWorkflows(prev => {
        const newSet = new Set(prev);
        newSet.delete(forkId);
        return newSet;
      });
    }
  };

  const handleSyncUpstream = async (fork: ForkRepo) => {
    if (!githubToken) {
      toast(language === 'zh' ? 'GitHub token 未找到，请重新登录。' : 'GitHub token not found. Please login again.', 'error');
      return;
    }

    const defaultBranch = fork.default_branch || 'main';
    const [owner, repo] = fork.full_name.split('/');
    
    setSyncModal({
      isOpen: true,
      forkId: fork.id,
      owner,
      repo,
      branch: defaultBranch,
      full_name: fork.full_name
    });
    setSyncModalBranches([]);
    setIsFetchingBranches(true);
    
    try {
      const githubApi = new GitHubApiService(githubToken);
      const branches = await githubApi.getBranches(owner, repo);
      setSyncModalBranches(branches);
      if (branches.length > 0 && !branches.includes(defaultBranch)) {
        setSyncModal(prev => ({ ...prev, branch: branches[0] }));
      }
    } finally {
      setIsFetchingBranches(false);
    }
  };

  const confirmSyncUpstream = async () => {
    if (!githubToken || !syncModal.forkId) return;

    const fork = forks.find(f => f.id === syncModal.forkId);
    if (!fork) return;

    const { owner, repo, branch } = syncModal;

    setSyncModal(prev => ({ ...prev, isOpen: false }));
    setSyncingForks(prev => new Set(prev).add(fork.id));
    
    try {
      const githubApi = new GitHubApiService(githubToken);
      const result = await githubApi.syncFork(owner, repo, branch);

      // Mark fork as up-to-date in UI
      setNeedsSyncMap(prev => ({ ...prev, [fork.id]: false }));

      if (result.mergeType === 'none') {
        toast(language === 'zh'
          ? `${fork.name} 已是最新版本，无需更新。`
          : `${fork.name} is already up to date.`,
          'info'
        );
      } else {
        toast(language === 'zh'
          ? `已将 ${fork.name} 成功更新到上游最新版本。`
          : `${fork.name} has been successfully updated from upstream.`,
          'success'
        );
      }
    } catch (error) {
      console.error('Sync failed:', error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (errorMsg === 'NOT_A_FORK') {
        toast(language === 'zh'
          ? `${fork.name} 不是 Fork 仓库，无法同步上游。`
          : `${fork.name} is not a fork. Cannot sync upstream.`,
          'error'
        );
      } else if (errorMsg === 'MERGE_CONFLICT') {
        toast(language === 'zh'
          ? `同步失败：${fork.name} 与上游仓库存在合并冲突，请手动解决后重试。`
          : `Sync failed: ${fork.name} has merge conflicts with upstream. Please resolve manually.`,
          'error'
        );
      } else {
        toast(language === 'zh'
          ? `同步失败: ${errorMsg}`
          : `Sync failed: ${errorMsg}`,
          'error'
        );
      }
    } finally {
      setSyncingForks(prev => {
        const newSet = new Set(prev);
        newSet.delete(fork.id);
        return newSet;
      });
    }
  };

  const handleRunWorkflow = async (forkId: number, workflowPath: string, workflowName: string) => {
    if (!githubToken) {
      toast(language === 'zh' ? 'GitHub token 未找到，请重新登录。' : 'GitHub token not found. Please login again.', 'error');
      return;
    }

    const fork = forks.find(f => f.id === forkId);
    if (!fork) return;

    const branch = fork.default_branch || 'main';
    setRunningWorkflows(prev => new Set(prev).add(forkId));
    try {
      const [owner, repo] = fork.full_name.split('/');
      const githubApi = new GitHubApiService(githubToken);
      await githubApi.triggerWorkflowRun(owner, repo, workflowPath, branch);

      toast(language === 'zh'
        ? `已触发工作流 "${workflowName}" 在 ${branch} 分支。`
        : `Triggered workflow "${workflowName}" on branch ${branch}.`,
        'success'
      );

      // Reload workflows after triggering
      await loadWorkflows(forkId);
    } catch (error) {
      console.error('Failed to run workflow:', error);
      toast(language === 'zh'
        ? `运行工作流失败。`
        : `Failed to run workflow.`,
        'error'
      );
    } finally {
      setRunningWorkflows(prev => {
        const next = new Set(prev);
        next.delete(forkId);
        return next;
      });
    }
  };

  if (forks.length === 0) {
    return (
      <div className="text-center py-12">
        <GitFork className="w-16 h-16 text-gray-500 dark:text-quaternary mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gray-900 dark:text-text-primary mb-2">
          {t('没有Fork仓库', 'No Forked Repositories')}
        </h3>
        <p className="text-gray-500 dark:text-text-tertiary mb-6 max-w-md mx-auto">
          {t('您还没有Fork任何仓库。Fork一个仓库后即可在此处管理。', 'You have not forked any repositories. Fork a repository to manage it here.')}
        </p>

        {/* Refresh button */}
        <div className="mb-6 flex flex-col items-center gap-3">
          <button
            onClick={handleRefresh}
            disabled={forkIsRefreshing}
            className="flex items-center space-x-2 px-6 py-3 bg-brand-indigo text-white rounded-lg hover:bg-brand-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-5 h-5 ${forkIsRefreshing ? 'animate-spin' : ''}`} />
            <span>{forkIsRefreshing ? t('刷新中...', 'Refreshing...') : t('刷新Fork', 'Refresh Forks')}</span>
          </button>
          {lastRefreshTime && (
            <p className="text-sm text-gray-500 dark:text-text-tertiary">
              {t('上次刷新:', 'Last refresh:')} {formatDistanceToNow(new Date(lastRefreshTime), { addSuffix: true })}
            </p>
          )}
        </div>
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
              {t('复刻', 'Fork')}
            </h2>
            <p className="text-gray-700 dark:text-text-tertiary">
              {t(`管理您的 ${forks.filter(f => f.fork).length} 个Fork仓库`, `Manage your ${forks.filter(f => f.fork).length} forked repositories`)}
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
              disabled={forkIsRefreshing}
              className="flex items-center space-x-2 px-4 py-2 bg-brand-indigo text-white rounded-lg hover:bg-brand-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`w-4 h-4 ${forkIsRefreshing ? 'animate-spin' : ''}`} />
              <span>{forkIsRefreshing ? t('刷新中...', 'Refreshing...') : t('刷新', 'Refresh')}</span>
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="bg-white dark:bg-panel-dark rounded-xl border border-black/[0.06] dark:border-white/[0.04] p-3 mb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-text-quaternary w-5 h-5" />
            <input
              type="text"
              placeholder={t('搜索Fork...', 'Search forks...')}
              value={searchQuery}
              onChange={(e) => {
                setForkSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full pl-10 pr-10 py-2 border border-black/[0.06] dark:border-white/[0.04] rounded-lg focus:ring-2 focus:ring-brand-violet focus:border-transparent bg-white dark:bg-white/[0.04] text-gray-900 dark:text-text-primary"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setForkSearchQuery('');
                  setCurrentPage(1);
                }}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-text-quaternary hover:text-gray-700 dark:text-text-secondary dark:hover:text-gray-300"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Results Info and Pagination Controls */}
        <div className="flex flex-col gap-2 mb-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2 sm:gap-4">
            <span className="text-sm text-gray-700 dark:text-text-tertiary">
              {t(
                `显示 ${startIndex + 1}-${Math.min(startIndex + itemsPerPage, filteredForks.length)} 共 ${filteredForks.length} 个Fork`,
                `Showing ${startIndex + 1}-${Math.min(startIndex + itemsPerPage, filteredForks.length)} of ${filteredForks.length} forks`
              )}
            </span>
            {searchQuery && (
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

      {/* Fork List */}
      <div className="space-y-2">
        {paginatedForks.length === 0 ? (
          <div className="text-center py-12 bg-light-bg dark:bg-panel-dark/50 rounded-xl border-2 border-dashed border-black/[0.06] dark:border-white/[0.04]">
            <Package className="w-12 h-12 text-gray-400 dark:text-text-secondary mx-auto mb-3" />
            <h3 className="text-lg font-medium text-gray-900 dark:text-text-secondary mb-1">
              {t('无符合条件的结果', 'No matching results')}
            </h3>
            <p className="text-sm text-gray-500 dark:text-text-tertiary">
              {t('没有找到匹配的 Fork', 'No matching forks found.')}
            </p>
            {searchQuery && (
              <button
                onClick={() => setForkSearchQuery('')}
                className="mt-4 px-4 py-2 bg-brand-indigo text-white rounded-lg hover:bg-brand-hover transition-colors text-sm"
              >
                {t('清除搜索', 'Clear Search')}
              </button>
            )}
          </div>
        ) : (
          paginatedForks.map((fork) => {
            const isUnread = isForkUnread(fork.id);
            const isWorkflowsExpanded = expandedWorkflows.has(fork.id);
            const workflows = workflowsMap[fork.id] || [];
            const isLoadingWf = loadingWorkflows.has(fork.id);
            const isSyncing = syncingForks.has(fork.id);
            const isRunningWf = runningWorkflows.has(fork.id);
            const needsSync = needsSyncMap[fork.id] ?? true;

            return (
              <ForkCard
                key={fork.id}
                fork={fork}
                isUnread={isUnread}
                isWorkflowsExpanded={isWorkflowsExpanded}
                onToggleWorkflows={() => toggleWorkflows(fork.id)}
                onSyncUpstream={() => handleSyncUpstream(fork)}
                onMarkAsRead={() => markForkAsRead(fork.id)}
                onRunWorkflow={(workflowPath, workflowName) => handleRunWorkflow(fork.id, workflowPath, workflowName)}
                workflows={workflows}
                isLoadingWorkflows={isLoadingWf}
                isSyncing={isSyncing}
                isRunningWorkflow={isRunningWf}
                needsSync={needsSync}
                language={language}
              />
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

      {/* Sync Branch Modal */}
      <Modal
        isOpen={syncModal.isOpen}
        onClose={() => setSyncModal(prev => ({ ...prev, isOpen: false }))}
        title={language === 'zh' ? '同步上游代码 (Sync upstream)' : 'Sync Upstream'}
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-text-tertiary">
            {language === 'zh' 
              ? `选择要将上游变更合并到的分支 (${syncModal.full_name})：`
              : `Select the branch to merge upstream changes into for ${syncModal.full_name}:`}
          </p>

          <div className="flex flex-col space-y-2">
            <label className="text-sm font-medium text-gray-900 dark:text-text-secondary">
              {language === 'zh' ? '目标分支 (Target Branch)' : 'Target Branch'}
            </label>
            {isFetchingBranches ? (
              <div className="flex items-center space-x-2 text-sm text-gray-500 dark:text-text-tertiary py-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{language === 'zh' ? '加载分支列表中...' : 'Loading branches...'}</span>
              </div>
            ) : (
              <select
                value={syncModal.branch}
                onChange={(e) => setSyncModal(prev => ({ ...prev, branch: e.target.value }))}
                className="w-full px-3 py-2 bg-white dark:bg-panel-dark border border-gray-300 dark:border-white/[0.08] rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-indigo focus:border-transparent dark:text-text-primary"
              >
                {syncModalBranches.length > 0 ? (
                  syncModalBranches.map(b => (
                    <option key={b} value={b}>{b}</option>
                  ))
                ) : (
                  <option value={syncModal.branch}>{syncModal.branch}</option>
                )}
              </select>
            )}
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <button
              onClick={() => setSyncModal(prev => ({ ...prev, isOpen: false }))}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-text-secondary bg-gray-100 dark:bg-white/[0.04] hover:bg-gray-200 dark:hover:bg-white/[0.08] rounded-lg transition-colors"
            >
              {language === 'zh' ? '取消' : 'Cancel'}
            </button>
            <button
              onClick={confirmSyncUpstream}
              disabled={isFetchingBranches || !syncModal.branch}
              className="px-4 py-2 text-sm font-medium text-white bg-brand-indigo hover:bg-brand-hover rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {language === 'zh' ? '确认同步' : 'Sync Branch'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};