import { Input } from './ui/input';
import { Button } from './ui/button';
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Package, Search, X, RefreshCw, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Loader2 } from 'lucide-react';
import { ForkRepo, GitHubOrganization, WorkflowDefinition } from '../types';
import { useAppStore } from '../store/useAppStore';
import { GitHubApiService } from '../services/githubApi';
import { logger } from '../services/logger';
import { formatDistanceToNow } from 'date-fns';
import ForkCard from './ForkCard';
import { useDialog } from '../hooks/useDialog';
import { Modal } from './Modal';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

export const ForkTimeline: React.FC = () => {
  const {
    user,
    forks,
    readForks,
    githubToken,
    language,
    markForkAsRead,
    forkSearchQuery,
    forkIsRefreshing,
    setForkSearchQuery,
    setForkIsRefreshing,
  } = useAppStore();

  const { toast } = useDialog();

  const personalOwnerLogin = user?.login || '';
  const [organizations, setOrganizations] = useState<GitHubOrganization[]>([]);
  const [isLoadingOrganizations, setIsLoadingOrganizations] = useState(false);
  const [selectedForkOwner, setSelectedForkOwner] = useState(personalOwnerLogin);
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
  const [loadedForkOwners, setLoadedForkOwners] = useState<Set<string>>(new Set());

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

  const t = useCallback((zh: string, en: string) => language === 'zh' ? zh : en, [language]);
  const searchQuery = forkSearchQuery;
  const activeForkOwner = selectedForkOwner || personalOwnerLogin;
  const currentOwnerLabel = activeForkOwner || t('个人账号', 'Personal account');

  const isForkUnread = useCallback((forkId: number) => {
    return !readForks.has(forkId);
  }, [readForks]);

  useEffect(() => {
    setSelectedForkOwner(personalOwnerLogin);
    setCurrentPage(1);
    setLoadedForkOwners(new Set());
  }, [personalOwnerLogin]);

  useEffect(() => {
    if (!githubToken || !personalOwnerLogin) {
      setOrganizations([]);
      setIsLoadingOrganizations(false);
      return;
    }

    let isCancelled = false;
    const loadOrganizations = async () => {
      setIsLoadingOrganizations(true);
      try {
        const githubApi = new GitHubApiService(githubToken);
        const userOrganizations = await githubApi.getUserOrganizations();
        if (!isCancelled) {
          setOrganizations(userOrganizations);
        }
      } catch (error) {
        logger.warn('githubApi', 'Failed to load fork owner organizations', error);
        if (!isCancelled) {
          setOrganizations([]);
          toast(
            language === 'zh'
              ? '组织列表加载失败，请检查 GitHub token 权限。'
              : 'Failed to load organizations. Please check GitHub token permissions.',
            'error'
          );
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingOrganizations(false);
        }
      }
    };

    loadOrganizations();

    return () => {
      isCancelled = true;
    };
  }, [githubToken, language, personalOwnerLogin, toast]);

  const ownerForks = useMemo(() => {
    if (!activeForkOwner) return [];
    return forks.filter(fork => fork.fork === true && fork.owner.login === activeForkOwner);
  }, [forks, activeForkOwner]);

  const forkOwnerOptions = useMemo(() => {
    const options = new Map<string, { id: string; login: string; isPersonal: boolean }>();
    if (personalOwnerLogin) {
      options.set(personalOwnerLogin, { id: `user-${personalOwnerLogin}`, login: personalOwnerLogin, isPersonal: true });
    }
    organizations.forEach(org => {
      options.set(org.login, { id: `org-${org.id}`, login: org.login, isPersonal: false });
    });
    forks.forEach(fork => {
      if (fork.fork && fork.owner.login !== personalOwnerLogin && !options.has(fork.owner.login)) {
        options.set(fork.owner.login, { id: `cached-${fork.owner.login}`, login: fork.owner.login, isPersonal: false });
      }
    });
    return Array.from(options.values());
  }, [forks, organizations, personalOwnerLogin]);

  // Filter and sort forks
  const filteredForks = useMemo(() => {
    let filtered = [...ownerForks];

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
  }, [ownerForks, searchQuery]);

  // Pagination
  const totalPages = Math.ceil(filteredForks.length / itemsPerPage);
  const clampedPage = Math.max(1, Math.min(currentPage, totalPages || 1));
  const startIndex = filteredForks.length === 0 ? 0 : (clampedPage - 1) * itemsPerPage;
  const paginatedForks = filteredForks.slice(startIndex, startIndex + itemsPerPage);
  const displayStart = filteredForks.length === 0 ? 0 : startIndex + 1;
  const displayEnd = Math.min(startIndex + itemsPerPage, filteredForks.length);

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

  const loadForksForOwner = useCallback(async (ownerLogin: string) => {
    if (!githubToken) {
      toast(language === 'zh' ? 'GitHub token 未找到，请重新登录。' : 'GitHub token not found. Please login again.', 'error');
      return;
    }

    if (!ownerLogin) {
      toast(language === 'zh' ? 'Fork 仓库拥有者未找到，请重新登录。' : 'Fork owner not found. Please login again.', 'error');
      return;
    }

    const startTime = Date.now();
    setForkIsRefreshing(true);
    try {
      const githubApi = new GitHubApiService(githubToken);
      const fetchedForks = ownerLogin === personalOwnerLogin
        ? await githubApi.getUserForks()
        : await githubApi.getOrganizationForks(ownerLogin);
      const newForks = fetchedForks.filter(fork => fork.fork === true && fork.owner.login === ownerLogin);
      logger.info('githubApi', 'Refresh forks completed', { owner: ownerLogin, forkCount: newForks.length, durationMs: Date.now() - startTime });

      // Merge with existing forks, preserving read status from the latest store state
      let updatedForks: ForkRepo[] = [];
      let newCount = 0;
      useAppStore.setState(state => {
        const existingForkMap = new Map(state.forks.map(f => [f.id, f]));
        const nextReadForks = new Set(state.readForks);
        newCount = newForks.filter(f => !existingForkMap.has(f.id)).length;

        updatedForks = newForks.map(newFork => {
          const existing = existingForkMap.get(newFork.id);
          if (!existing) {
            // New fork — mark as unread if upstream has updates
            return {
              ...newFork,
              has_unread: false,
              upstream_updated_at: newFork.source?.updated_at,
            };
          }

          const prevUpstreamTime = existing.upstream_updated_at;
          const currentUpstreamTime = newFork.source?.updated_at;
          const hasNewUpdates = !!prevUpstreamTime && !!currentUpstreamTime
            && new Date(currentUpstreamTime) > new Date(prevUpstreamTime);

          if (hasNewUpdates) {
            nextReadForks.delete(newFork.id);
            return {
              ...newFork,
              has_unread: existing.has_unread,
              upstream_updated_at: currentUpstreamTime,
            };
          }

          return {
            ...newFork,
            has_unread: existing.has_unread,
            upstream_updated_at: existing.upstream_updated_at || currentUpstreamTime,
          };
        });

        return {
          forks: [
            ...state.forks.filter(fork => fork.owner.login !== ownerLogin || fork.fork !== true),
            ...updatedForks,
          ],
          readForks: nextReadForks,
        };
      });
      setLoadedForkOwners(prev => {
        const next = new Set(prev);
        next.add(ownerLogin);
        return next;
      });
      const now = new Date().toISOString();
      setLastRefreshTime(now);

      // Pre-check sync status for refreshed owner forks (out-of-date vs already up-to-date)
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
            useAppStore.setState(state => ({
              forks: state.forks.map(f => f.id === fork.id ? {
                ...f,
                parent: {
                  id: 0,
                  full_name: result.parentFullName as string,
                  name: (result.parentFullName as string).split('/')[1],
                  html_url: result.parentHtmlUrl as string
                }
              } : f)
            }));
          }
        } catch {
          setNeedsSyncMap(prev => ({ ...prev, [fork.id]: false }));
        }
      });
      await Promise.all(syncChecks);

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
      logger.error('githubApi', 'Refresh forks failed', { owner: ownerLogin, error: error instanceof Error ? error.message : String(error), durationMs: Date.now() - startTime });
      toast(language === 'zh'
        ? 'Fork刷新失败，请检查网络连接。'
        : 'Fork refresh failed. Please check your network connection.',
        'error'
      );
    } finally {
      setForkIsRefreshing(false);
    }
  }, [githubToken, language, personalOwnerLogin, setForkIsRefreshing, toast]);

  const handleRefresh = () => {
    loadForksForOwner(activeForkOwner);
  };

  const handleForkOwnerChange = (ownerLogin: string) => {
    setSelectedForkOwner(ownerLogin);
    setCurrentPage(1);

    const hasCachedOwnerForks = useAppStore.getState().forks.some(fork => fork.fork === true && fork.owner.login === ownerLogin);
    if (!hasCachedOwnerForks && !loadedForkOwners.has(ownerLogin)) {
      loadForksForOwner(ownerLogin);
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
    const syncStartTime = Date.now();

    setSyncModal(prev => ({ ...prev, isOpen: false }));
    setSyncingForks(prev => new Set(prev).add(fork.id));

    try {
      const githubApi = new GitHubApiService(githubToken);
      const result = await githubApi.syncFork(owner, repo, branch);
      logger.info('githubApi', 'Sync fork completed', { repo: fork.full_name, mergeType: result.mergeType, durationMs: Date.now() - syncStartTime });

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
      logger.error('githubApi', 'Sync fork failed', { repo: fork.full_name, error: error instanceof Error ? error.message : String(error), durationMs: Date.now() - syncStartTime });
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
    const workflowStartTime = Date.now();
    setRunningWorkflows(prev => new Set(prev).add(forkId));
    try {
      const [owner, repo] = fork.full_name.split('/');
      const githubApi = new GitHubApiService(githubToken);
      await githubApi.triggerWorkflowRun(owner, repo, workflowPath, branch);
      logger.info('githubApi', 'Trigger workflow completed', { repo: fork.full_name, workflow: workflowName, branch, durationMs: Date.now() - workflowStartTime });

      toast(language === 'zh'
        ? `已触发工作流 "${workflowName}" 在 ${branch} 分支。`
        : `Triggered workflow "${workflowName}" on branch ${branch}.`,
        'success'
      );

      // Reload workflows after triggering
      await loadWorkflows(forkId);
    } catch (error) {
      console.error('Failed to run workflow:', error);
      logger.error('githubApi', 'Trigger workflow failed', { repo: fork.full_name, workflow: workflowName, error: error instanceof Error ? error.message : String(error), durationMs: Date.now() - workflowStartTime });
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

  return (
    <div className="max-w-full mx-auto px-2 sm:px-4">
      {/* Header */}
      <div className="mb-6 sm:mb-8">
        <div className="flex flex-col gap-4 mb-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-foreground dark:text-foreground mb-2">
              {t('复刻', 'Fork')}
            </h2>
            <p className="text-muted-foreground dark:text-muted-foreground">
              {t(`管理 ${currentOwnerLabel} 的 ${ownerForks.length} 个Fork仓库`, `Manage ${ownerForks.length} forked repositories for ${currentOwnerLabel}`)}
            </p>
          </div>
          <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:gap-3 lg:w-auto lg:max-w-full lg:justify-end">
            {/* Fork owner selector */}
            <div className="flex min-w-0 max-w-full items-center gap-2 whitespace-nowrap">
              <span id="fork-owner-label" className="shrink-0 whitespace-nowrap text-sm text-muted-foreground dark:text-muted-foreground">{t('拥有者:', 'Owner:')}</span>
              <Select value={activeForkOwner} onValueChange={handleForkOwnerChange} disabled={!personalOwnerLogin || isLoadingOrganizations || forkIsRefreshing}>
                <SelectTrigger className="ui-field h-9 w-48 max-w-[calc(100vw-8rem)] shrink px-3 py-2 text-sm" aria-labelledby="fork-owner-label"><SelectValue /></SelectTrigger>
                <SelectContent>{forkOwnerOptions.map(owner => <SelectItem key={owner.id} value={owner.login}>{owner.isPersonal ? t(`${owner.login}（个人）`, `${owner.login} (Personal)`) : owner.login}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            {isLoadingOrganizations && (
              <span className="flex items-center space-x-1 text-sm text-muted-foreground dark:text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{t('加载组织中...', 'Loading organizations...')}</span>
              </span>
            )}

            {/* Last Refresh Time */}
            {lastRefreshTime && (
              <span className="w-full text-sm text-muted-foreground dark:text-muted-foreground lg:w-auto">
                {t('上次刷新:', 'Last refresh:')} {formatDistanceToNow(new Date(lastRefreshTime), { addSuffix: true })}
              </span>
            )}

            {/* Refresh Button */}
            <Button
              onClick={handleRefresh}
              disabled={forkIsRefreshing}
              className="ui-button-primary flex h-auto shrink-0 items-center space-x-2 px-4 py-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${forkIsRefreshing ? 'animate-spin' : ''}`} />
              <span>{forkIsRefreshing ? t('刷新中...', 'Refreshing...') : t('刷新', 'Refresh')}</span>
            </Button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="ui-toolbar p-3 sm:p-4 mb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground dark:text-muted-foreground/70 w-5 h-5" />
            <Input
              type="text"
              placeholder={t('搜索Fork...', 'Search forks...')}
              value={searchQuery}
              onChange={(e) => {
                setForkSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              className="ui-field w-full pl-10 pr-10 py-2 text-foreground dark:text-foreground"
            />
            {searchQuery && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => {
                  setForkSearchQuery('');
                  setCurrentPage(1);
                }}
                aria-label={t('清除搜索', 'Clear search')}
                className="absolute right-3 top-1/2 h-8 w-8 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>

        {/* Results Info and Pagination Controls */}
        <div className="flex w-full min-w-0 flex-col gap-2 mb-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2 sm:gap-4">
            <span className="text-sm text-muted-foreground dark:text-muted-foreground">
              {t(
                `显示 ${displayStart}-${displayEnd} 共 ${filteredForks.length} 个Fork`,
                `Showing ${displayStart}-${displayEnd} of ${filteredForks.length} forks`
              )}
            </span>
            {searchQuery && (
              <span className="text-sm text-primary dark:text-primary">
                ({t('已筛选', 'filtered')})
              </span>
            )}
          </div>

          <div className="flex w-full min-w-0 justify-end gap-3 sm:w-auto sm:items-center sm:gap-4 lg:ml-auto">
            {/* Items per page selector */}
            <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
              <span id="fork-page-size-label" className="whitespace-nowrap text-sm text-muted-foreground dark:text-muted-foreground">{t('每页:', 'Per page:')}</span>
              <Select value={String(itemsPerPage)} onValueChange={(value) => { setItemsPerPage(Number(value)); setCurrentPage(1); }}>
                <SelectTrigger aria-labelledby="fork-page-size-label" className="ui-field h-9 min-w-20 shrink-0 px-3 py-1 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="20">20</SelectItem><SelectItem value="50">50</SelectItem><SelectItem value="100">100</SelectItem><SelectItem value="200">200</SelectItem></SelectContent>
              </Select>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center space-x-1 overflow-x-auto pb-1">
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
                      variant="ghost"
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
            )}
          </div>
        </div>
      </div>

      {/* Fork List */}
      <div className="space-y-2">
        {paginatedForks.length === 0 ? (
          <div className="ui-empty-state text-center py-12">
            <Package className="w-12 h-12 text-muted-foreground dark:text-muted-foreground mx-auto mb-3" />
            <h3 className="text-lg font-medium text-foreground dark:text-muted-foreground mb-1">
              {searchQuery ? t('无符合条件的结果', 'No matching results') : t('没有Fork仓库', 'No Forked Repositories')}
            </h3>
            <p className="text-sm text-muted-foreground dark:text-muted-foreground">
              {searchQuery
                ? t('没有找到匹配的 Fork', 'No matching forks found.')
                : t(`${currentOwnerLabel} 下暂无 Fork 仓库，请刷新或切换拥有者。`, `No forked repositories found for ${currentOwnerLabel}. Refresh or switch owner.`)}
            </p>
            {searchQuery && (
              <Button
                onClick={() => setForkSearchQuery('')}
                className="ui-button-primary mt-4 px-4 py-2 text-sm"
              >
                {t('清除搜索', 'Clear Search')}
              </Button>
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
                  variant="ghost"
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

      {/* Sync Branch Modal */}
      <Modal
        isOpen={syncModal.isOpen}
        onClose={() => setSyncModal(prev => ({ ...prev, isOpen: false }))}
        title={language === 'zh' ? '同步上游代码 (Sync upstream)' : 'Sync Upstream'}
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground dark:text-muted-foreground">
            {language === 'zh' 
              ? `选择要将上游变更合并到的分支 (${syncModal.full_name})：`
              : `Select the branch to merge upstream changes into for ${syncModal.full_name}:`}
          </p>

          <div className="flex flex-col space-y-2">
            <span id="fork-target-branch-label" className="text-sm font-medium text-foreground dark:text-muted-foreground">
              {language === 'zh' ? '目标分支 (Target Branch)' : 'Target Branch'}
            </span>
            {isFetchingBranches ? (
              <div className="flex items-center space-x-2 text-sm text-muted-foreground dark:text-muted-foreground py-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{language === 'zh' ? '加载分支列表中...' : 'Loading branches...'}</span>
              </div>
            ) : (
              <Select value={syncModal.branch} onValueChange={(value) => setSyncModal(prev => ({ ...prev, branch: value }))}>
                <SelectTrigger aria-labelledby="fork-target-branch-label" className="ui-field h-10 w-full px-3 py-2 dark:text-foreground"><SelectValue /></SelectTrigger>
                <SelectContent>{syncModalBranches.length > 0 ? syncModalBranches.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>) : <SelectItem value={syncModal.branch}>{syncModal.branch}</SelectItem>}</SelectContent>
              </Select>
            )}
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <Button
              variant="outline"
              onClick={() => setSyncModal(prev => ({ ...prev, isOpen: false }))}
              className="px-4 py-2 text-sm font-medium"
            >
              {language === 'zh' ? '取消' : 'Cancel'}
            </Button>
            <Button
              onClick={confirmSyncUpstream}
              disabled={isFetchingBranches || !syncModal.branch}
              className="ui-button-primary px-4 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {language === 'zh' ? '确认同步' : 'Sync Branch'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};