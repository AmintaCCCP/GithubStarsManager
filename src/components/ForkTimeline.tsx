import { Input } from './ui/input';
import { Button } from './ui/button';
import React, { useState, useMemo, useEffect } from 'react';
import { Package, Search, X, RefreshCw, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Loader2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import ForkCard from './ForkCard';
import { useForkTimelineActions } from '../features/forks/hooks/useForkTimelineActions';
import { Modal } from './Modal';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

export const ForkTimeline: React.FC = () => {
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
    t,
    handleRefresh,
    handleForkOwnerChange,
    toggleWorkflows,
    handleSyncUpstream,
    confirmSyncUpstream,
    handleRunWorkflow,
  } = useForkTimelineActions();

  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);
  const searchQuery = forkSearchQuery;
  const currentOwnerLabel = activeForkOwner || t('个人账号', 'Personal account');
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
              <Select value={activeForkOwner} onValueChange={handleForkOwnerSelection} disabled={!personalOwnerLogin || isLoadingOrganizations || forkIsRefreshing}>
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
              aria-label={t('搜索 Fork', 'Search forks')}
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
        <div className="flex w-full min-w-0 flex-col gap-2 mb-4 lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
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

          <div className="flex w-full min-w-0 flex-wrap items-center justify-end gap-3 sm:w-auto sm:gap-4 lg:w-auto lg:justify-self-end">
            {/* Items per page selector */}
            <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
              <span id="fork-page-size-label" className="whitespace-nowrap text-sm text-muted-foreground dark:text-muted-foreground">{t('每页:', 'Per page:')}</span>
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