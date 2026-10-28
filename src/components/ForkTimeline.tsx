
import { getDateFnsLocale } from '../i18n/format';
import { Input } from './ui/input';
import { Button } from './ui/button';
import React, { useState, useMemo, useEffect } from 'react';
import {
  Package,
  Search,
  X,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Loader2,
  GitFork,
  ArrowDownUp,
  CheckCheck,
  CircleHelp,
  GitBranch,
  UserRound,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import ForkCard from './ForkCard';
import { useForkTimelineActions } from '../features/forks/hooks/useForkTimelineActions';
import { useT } from '../i18n/useT';
import { Modal } from './Modal';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { WorkspacePageHeader } from './WorkspacePageHeader';

const UPSTREAM_PREVIEW_LIMIT = 6;

export const ForkTimeline: React.FC = () => {
  const t = useT('releases');
  const {
    readForks,
    language,
    markForkAsRead,
    forkSearchQuery,
    forkIsRefreshing,
    setForkSearchQuery,
    isLoadingOrganizations,
    personalOwnerLogin,
    activeForkOwner,
    ownerForks,
    forkOwnerOptions,
    lastRefreshTime,
    expandedWorkflows,
    workflowsMap,
    loadingWorkflows,
    syncingForks,
    runningWorkflows,
    needsSyncMap,
    syncModal,
    setSyncModal,
    syncModalBranches,
    isFetchingBranches,
    handleRefresh,
    handleForkOwnerChange,
    toggleWorkflows,
    handleSyncUpstream,
    confirmSyncUpstream,
    handleRunWorkflow,
  } = useForkTimelineActions();

  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);
  const [forkSyncFilter, setForkSyncFilter] = useState<'all' | 'update' | 'current' | 'unchecked'>('all');
  const [showAllUpstreamRepositories, setShowAllUpstreamRepositories] = useState(false);
  const searchQuery = forkSearchQuery;
  const isForkUnread = (forkId: number) => !readForks.has(forkId);
  const handleForkOwnerSelection = (ownerLogin: string) => {
    handleForkOwnerChange(ownerLogin);
    setCurrentPage(1);
  };

  // Filter and sort forks
  const filteredForks = useMemo(() => {
    let filtered = [...ownerForks];

    // Sort by source.updated_at desc (upstream latest update first)
    filtered.sort((a, b) => {
      const aTime = a.source?.updated_at ? new Date(a.source.updated_at).getTime() : 0;
      const bTime = b.source?.updated_at ? new Date(b.source.updated_at).getTime() : 0;
      return bTime - aTime;
    });

    if (forkSyncFilter === 'update') {
      filtered = filtered.filter((fork) => needsSyncMap[fork.id] === true);
    } else if (forkSyncFilter === 'current') {
      filtered = filtered.filter((fork) => needsSyncMap[fork.id] === false);
    } else if (forkSyncFilter === 'unchecked') {
      filtered = filtered.filter((fork) => needsSyncMap[fork.id] === undefined);
    }

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(fork =>
        fork.name.toLowerCase().includes(query) ||
        fork.full_name.toLowerCase().includes(query) ||
        (fork.source?.full_name || '').toLowerCase().includes(query) ||
        (fork.parent?.full_name || '').toLowerCase().includes(query) ||
        (fork.description || '').toLowerCase().includes(query) ||
        (fork.source?.description || '').toLowerCase().includes(query)
      );
    }

    return filtered;
  }, [ownerForks, needsSyncMap, forkSyncFilter, searchQuery]);

  const forkSyncCounts = useMemo(() => ({
    update: ownerForks.filter((fork) => needsSyncMap[fork.id] === true).length,
    current: ownerForks.filter((fork) => needsSyncMap[fork.id] === false).length,
    unchecked: ownerForks.filter((fork) => needsSyncMap[fork.id] === undefined).length,
  }), [ownerForks, needsSyncMap]);

  const upstreamRepositories = useMemo(() => {
    const counts = new Map<string, number>();
    ownerForks.forEach((fork) => {
      const name = fork.source?.full_name || fork.parent?.full_name;
      if (name) counts.set(name, (counts.get(name) || 0) + 1);
    });
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [ownerForks]);

  const visibleUpstreamRepositories = useMemo(() => {
    if (
      showAllUpstreamRepositories ||
      upstreamRepositories.length <= UPSTREAM_PREVIEW_LIMIT
    ) {
      return upstreamRepositories;
    }

    const preview = upstreamRepositories.slice(0, UPSTREAM_PREVIEW_LIMIT);
    const selectedIndex = upstreamRepositories.findIndex(([name]) => name === searchQuery);
    if (selectedIndex < UPSTREAM_PREVIEW_LIMIT) {
      return preview;
    }

    // Keep an active repository visible even when it falls outside the preview.
    return [...preview.slice(0, UPSTREAM_PREVIEW_LIMIT - 1), upstreamRepositories[selectedIndex]];
  }, [searchQuery, showAllUpstreamRepositories, upstreamRepositories]);

  // Pagination
  const totalPages = Math.ceil(filteredForks.length / itemsPerPage);
  const clampedPage = Math.max(1, Math.min(currentPage, totalPages || 1));
  const startIndex = filteredForks.length === 0 ? 0 : (clampedPage - 1) * itemsPerPage;
  const paginatedForks = filteredForks.slice(startIndex, startIndex + itemsPerPage);
  const displayStart = filteredForks.length === 0 ? 0 : startIndex + 1;
  const displayEnd = Math.min(startIndex + itemsPerPage, filteredForks.length);
  const hasActiveFilter = Boolean(searchQuery.trim()) || forkSyncFilter !== 'all';
  const clearForkFilters = () => {
    setForkSearchQuery('');
    setForkSyncFilter('all');
    setCurrentPage(1);
  };

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

  const forkContextSidebar = (
    <aside
      data-context-sidebar="forks"
      aria-label={t('forkTimeline.fork')}
      className="context-sidebar w-full shrink-0 lg:w-(--app-sidebar-width) lg:self-start"
    >
      <div className="context-sidebar-head">
        <div>
          <p className="app-side-eyebrow">{t('forkTimeline.fork-control-label')}</p>
          <h3 className="app-side-title">
            {t('forkTimeline.fork-status')}
          </h3>
        </div>
        <Button
          onClick={handleRefresh}
          disabled={forkIsRefreshing}
          variant="ghost"
          size="icon"
          className="linear-icon-button"
          title={forkIsRefreshing ? t('forkTimeline.refreshing') : t('forkTimeline.refresh')}
          aria-label={forkIsRefreshing ? t('forkTimeline.refreshing') : t('forkTimeline.refresh')}
        >
          <RefreshCw className={`h-4 w-4 ${forkIsRefreshing ? 'animate-spin' : ''}`} />
        </Button>
      </div>
      <div className="context-sidebar-body">
        <section className="app-side-section" aria-label={t('forkTimeline.status')}>
          <p className="app-section-label app-side-group-label">{t('forkTimeline.status')}</p>
          <div className="app-side-list">
            <Button
              variant="ghost"
              onClick={() => {
                setForkSyncFilter('all');
                setCurrentPage(1);
              }}
              aria-pressed={forkSyncFilter === 'all'}
              className="app-side-item justify-between"
            >
              <span className="app-side-item-label">
                <GitFork className="h-4 w-4" />
                <span>{t('forkTimeline.all-forks')}</span>
              </span>
              <span className="app-side-count">{ownerForks.length}</span>
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setForkSyncFilter('update');
                setCurrentPage(1);
              }}
              aria-pressed={forkSyncFilter === 'update'}
              className="app-side-item justify-between"
            >
              <span className="app-side-item-label">
                <ArrowDownUp className="h-4 w-4" />
                <span>{t('forkTimeline.update-available')}</span>
              </span>
              <span className="app-side-count">{forkSyncCounts.update}</span>
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setForkSyncFilter('current');
                setCurrentPage(1);
              }}
              aria-pressed={forkSyncFilter === 'current'}
              className="app-side-item justify-between"
            >
              <span className="app-side-item-label">
                <CheckCheck className="h-4 w-4" />
                <span>{t('forkTimeline.up-to-date')}</span>
              </span>
              <span className="app-side-count">{forkSyncCounts.current}</span>
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setForkSyncFilter('unchecked');
                setCurrentPage(1);
              }}
              aria-pressed={forkSyncFilter === 'unchecked'}
              className="app-side-item justify-between"
            >
              <span className="app-side-item-label">
                <CircleHelp className="h-4 w-4" />
                <span>{t('forkTimeline.check-pending')}</span>
              </span>
              <span className="app-side-count">{forkSyncCounts.unchecked}</span>
            </Button>
          </div>
        </section>

        <section className="app-side-section" aria-label={t('forkTimeline.forked-repositories')}>
          <p className="app-section-label app-side-group-label">
            {t('forkTimeline.forked-repositories')}
          </p>
          <div className="app-side-list">
            {upstreamRepositories.length === 0 ? (
              <p className="app-side-empty">{t('forkTimeline.no-forked-repositories')}</p>
            ) : visibleUpstreamRepositories.map(([name, count]) => (
              <Button
                key={name}
                variant="ghost"
                onClick={() => {
                  setForkSearchQuery(name);
                  setCurrentPage(1);
                }}
                aria-pressed={searchQuery === name}
                className="app-side-item justify-between"
                title={name}
              >
                <span className="app-side-item-label">
                  <GitBranch className="h-4 w-4" />
                  <span className="truncate">{name}</span>
                </span>
                {count > 1 && <span className="app-side-count">{count}</span>}
              </Button>
            ))}
            {upstreamRepositories.length > UPSTREAM_PREVIEW_LIMIT && (
              <Button
                type="button"
                variant="ghost"
                className="app-side-more"
                onClick={() => setShowAllUpstreamRepositories((expanded) => !expanded)}
                aria-expanded={showAllUpstreamRepositories}
              >
                {showAllUpstreamRepositories
                  ? t('forkTimeline.show-fewer-upstreams')
                  : t('forkTimeline.show-all-upstreams', { count: upstreamRepositories.length })}
              </Button>
            )}
          </div>
        </section>
      </div>
      <div className="context-sidebar-foot">
        <div className="app-side-foot-status">
          <span className="app-status-dot" aria-hidden="true" />
          <span>
            {lastRefreshTime
              ? `${t('forkTimeline.last-refresh')} ${formatDistanceToNow(new Date(lastRefreshTime), { addSuffix: true, locale: getDateFnsLocale(language) })}`
              : t('forkTimeline.status')}
          </span>
        </div>
        <div className="app-side-foot-meta">
          <span>{t('forkTimeline.fork-count', { count: ownerForks.length })}</span>
          <span>{t('forkTimeline.update-count', { count: forkSyncCounts.update })}</span>
        </div>
      </div>
    </aside>
  );

  return (
    <>
      <div className="route-workspace">
        {forkContextSidebar}
        <div className="workspace-content app-workspace-content">
          <div className="w-full">
      <WorkspacePageHeader
        eyebrow={t('forkTimeline.fork-control-label')}
        section={t('forkTimeline.fork')}
        title={t('forkTimeline.fork')}
        meta={(
          <span className="app-workspace-meta-pill">
            {t('forkTimeline.fork-count', { count: ownerForks.length })}
          </span>
        )}
        actions={(
          <div className="app-route-scope">
            <span className="app-route-scope-label">{t('forkTimeline.owner')}</span>
            <Select value={activeForkOwner} onValueChange={handleForkOwnerSelection} disabled={!personalOwnerLogin || isLoadingOrganizations || forkIsRefreshing}>
              <SelectTrigger className="app-route-scope-trigger" aria-label={t('forkTimeline.owner')}>
                <UserRound className="shrink-0" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>{forkOwnerOptions.map(owner => <SelectItem key={owner.id} value={owner.login}>{owner.isPersonal ? t('forkTimeline.v1-personal', { v1: owner.login }) : owner.login}</SelectItem>)}</SelectContent>
            </Select>
            {isLoadingOrganizations && (
              <span className="app-side-inline-status">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>{t('forkTimeline.loading-organizations')}</span>
              </span>
            )}
          </div>
        )}
      />

        {/* Search Bar */}
        <div className="ui-toolbar p-3 sm:p-4 mb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground dark:text-muted-foreground/70 w-5 h-5" />
            <Input
              type="text"
              aria-label={t('forkTimeline.search-forks')}
              placeholder={t('forkTimeline.search-forks-2')}
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
                aria-label={t('forkTimeline.clear-search')}
                className="absolute right-3 top-1/2 h-8 w-8 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>

        {/* Results Info and Pagination Controls */}
        <div className="flex w-full min-w-0 flex-col gap-2 mb-4 lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="flex flex-wrap items-center gap-2 sm:gap-4">
            <span className="text-sm text-muted-foreground dark:text-muted-foreground">
              {t('forkTimeline.showing-displaystart-displayend-of-v3-forks', { displayStart: displayStart, displayEnd: displayEnd, v3: filteredForks.length })}
            </span>
            {hasActiveFilter && (
              <span className="text-sm text-primary dark:text-primary">
                ({t('forkTimeline.filtered')})
              </span>
            )}
          </div>

          <div className="flex w-full min-w-0 flex-wrap items-center justify-end gap-3 sm:w-auto sm:gap-4 lg:w-auto lg:justify-self-end">
            {/* Items per page selector */}
            <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
              <span id="fork-page-size-label" className="whitespace-nowrap text-sm text-muted-foreground dark:text-muted-foreground">{t('forkTimeline.per-page')}</span>
              <Select value={String(itemsPerPage)} onValueChange={(value) => { setItemsPerPage(Number(value)); setCurrentPage(1); }}>
                <SelectTrigger aria-labelledby="fork-page-size-label" className="ui-field h-9 w-20 max-w-20 min-w-20 shrink-0 px-3 py-1 text-sm"><SelectValue /></SelectTrigger>
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
                  aria-label={t('forkTimeline.first-page')}
                  className="p-2 rounded-lg bg-muted text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground hover:bg-accent dark:hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronsLeft className="w-4 h-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => handlePageChange(clampedPage - 1)}
                  disabled={clampedPage === 1}
                  aria-label={t('forkTimeline.previous-page')}
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
                  aria-label={t('forkTimeline.next-page')}
                  className="p-2 rounded-lg bg-muted text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground hover:bg-accent dark:hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => handlePageChange(totalPages)}
                  disabled={clampedPage === totalPages}
                  aria-label={t('forkTimeline.last-page')}
                  className="p-2 rounded-lg bg-muted text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground hover:bg-accent dark:hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronsRight className="w-4 h-4" />
                </Button>
              </div>
            )}
          </div>
        </div>

      {/* Fork List */}
      <div className="app-fork-list">
        {paginatedForks.length === 0 ? (
          <div className="ui-empty-state text-center py-12">
            <Package className="w-12 h-12 text-muted-foreground dark:text-muted-foreground mx-auto mb-3" />
            <h3 className="text-lg font-medium text-foreground dark:text-muted-foreground mb-1">
              {hasActiveFilter ? t('forkTimeline.no-matching-results') : t('forkTimeline.no-forked-repositories')}
            </h3>
            <p className="text-sm text-muted-foreground dark:text-muted-foreground">
              {hasActiveFilter
                ? t('forkTimeline.no-matching-forks-found')
                : t('forkTimeline.no-forked-repositories-found-for-currentownerlab', {
                    currentOwnerLabel: activeForkOwner || t('forkTimeline.personal-account'),
                  })}
            </p>
            {hasActiveFilter && (
              <Button
                onClick={clearForkFilters}
                className="ui-button-primary mt-4 px-4 py-2 text-sm"
              >
                {t('forkTimeline.clear-search-2')}
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
              aria-label={t('forkTimeline.first-page')}
              className="p-2 rounded-lg bg-muted text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground hover:bg-accent dark:hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronsLeft className="w-4 h-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => handlePageChange(clampedPage - 1)}
              disabled={clampedPage === 1}
              aria-label={t('forkTimeline.previous-page')}
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
              aria-label={t('forkTimeline.next-page')}
              className="p-2 rounded-lg bg-muted text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground hover:bg-accent dark:hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => handlePageChange(totalPages)}
              disabled={clampedPage === totalPages}
              aria-label={t('forkTimeline.last-page')}
              className="p-2 rounded-lg bg-muted text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground hover:bg-accent dark:hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronsRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
      </div>
    </div>
  </div>

      {/* Sync Branch Modal */}
      <Modal
        isOpen={syncModal.isOpen}
        onClose={() => setSyncModal(prev => ({ ...prev, isOpen: false }))}
        title={t('forkTimeline.sync-upstream')}
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground dark:text-muted-foreground">
            {t('forkTimeline.select-the-branch-to-merge-upstream-changes-into', { v1: syncModal.full_name })}
          </p>

          <div className="flex flex-col space-y-2">
            <span id="fork-target-branch-label" className="text-sm font-medium text-foreground dark:text-muted-foreground">
              {t('forkTimeline.target-branch')}
            </span>
            {isFetchingBranches ? (
              <div className="flex items-center space-x-2 text-sm text-muted-foreground dark:text-muted-foreground py-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{t('forkTimeline.loading-branches')}</span>
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
              {t('forkTimeline.cancel')}
            </Button>
            <Button
              onClick={confirmSyncUpstream}
              disabled={isFetchingBranches || !syncModal.branch}
              className="ui-button-primary px-4 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('forkTimeline.sync-branch')}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
};
