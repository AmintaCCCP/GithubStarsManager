import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { ForkRepo, GitHubOrganization, WorkflowDefinition } from '../../../types';
import { useAppStore } from '../../../store/useAppStore';
import { selectForkTimelineState } from '../../../store/selectors';
import { GitHubApiService } from '../../../services/githubApi';
import { logger } from '../../../services/logger';
import { useDialog } from '../../../hooks/useDialog';
import { useAuthSessionGeneration, type AuthSessionGeneration } from '../../lifecycle/useAuthSessionGeneration';

interface SyncModalState {
  isOpen: boolean;
  forkId: number | null;
  owner: string;
  repo: string;
  branch: string;
  full_name: string;
}

/** Owns ForkTimeline's remote GitHub workflows while the view remains presentational. */
export const useForkTimelineActions = () => {
  const state = useAppStore(useShallow(selectForkTimelineState));
  const { setForkIsRefreshing } = state;
  const { toast } = useDialog();
  const [organizations, setOrganizations] = useState<GitHubOrganization[]>([]);
  const [isLoadingOrganizations, setIsLoadingOrganizations] = useState(false);
  const personalOwnerLogin = state.user?.login || '';
  const [selectedForkOwner, setSelectedForkOwner] = useState(personalOwnerLogin);
  const [lastRefreshTime, setLastRefreshTime] = useState<string | null>(null);
  const [expandedWorkflows, setExpandedWorkflows] = useState<Set<number>>(new Set());
  const [workflowsMap, setWorkflowsMap] = useState<Record<number, WorkflowDefinition[]>>({});
  const [loadingWorkflows, setLoadingWorkflows] = useState<Set<number>>(new Set());
  const workflowLoadInFlightRef = useRef<Map<number, AuthSessionGeneration>>(new Map());
  const refreshRequestRef = useRef<{ id: number; session: AuthSessionGeneration } | null>(null);
  const refreshRequestIdRef = useRef(0);
  const [syncingForks, setSyncingForks] = useState<Set<number>>(new Set());
  const [runningWorkflows, setRunningWorkflows] = useState<Set<number>>(new Set());
  const [needsSyncMap, setNeedsSyncMap] = useState<Record<number, boolean>>({});
  const [loadedForkOwners, setLoadedForkOwners] = useState<Set<string>>(new Set());
  const [syncModal, setSyncModal] = useState<SyncModalState>({
    isOpen: false, forkId: null, owner: '', repo: '', branch: 'main', full_name: '',
  });
  const [syncModalBranches, setSyncModalBranches] = useState<string[]>([]);
  const [isFetchingBranches, setIsFetchingBranches] = useState(false);
  const t = useCallback((zh: string, en: string) => state.language === 'zh' ? zh : en, [state.language]);
  const activeForkOwner = selectedForkOwner || personalOwnerLogin;

  useEffect(() => {
    setSelectedForkOwner(personalOwnerLogin);
    setLoadedForkOwners(new Set());
  }, [personalOwnerLogin]);

  const authSessionIdentity = `${state.githubToken ?? ''}\u0000${state.user?.id ?? ''}\u0000${state.user?.login ?? ''}`;
  const { captureSession, isCurrentSession } = useAuthSessionGeneration(authSessionIdentity);
  useEffect(() => {
    if (refreshRequestRef.current && !isCurrentSession(refreshRequestRef.current.session)) {
      refreshRequestRef.current = null;
      setForkIsRefreshing(false);
    }
  }, [authSessionIdentity, isCurrentSession, setForkIsRefreshing]);

  useEffect(() => {
    if (!state.githubToken || !personalOwnerLogin) {
      setOrganizations([]);
      setIsLoadingOrganizations(false);
      return;
    }
    let isCancelled = false;
    const loadOrganizations = async () => {
      setIsLoadingOrganizations(true);
      try {
        const api = new GitHubApiService(state.githubToken!);
        const userOrganizations = await api.getUserOrganizations();
        if (!isCancelled) setOrganizations(userOrganizations);
      } catch (error) {
        logger.warn('githubApi', 'Failed to load fork owner organizations', error);
        if (!isCancelled) {
          setOrganizations([]);
          toast(state.language === 'zh' ? '组织列表加载失败，请检查 GitHub token 权限。' : 'Failed to load organizations. Please check GitHub token permissions.', 'error');
        }
      } finally {
        if (!isCancelled) setIsLoadingOrganizations(false);
      }
    };
    void loadOrganizations();
    return () => { isCancelled = true; };
  }, [state.githubToken, state.language, personalOwnerLogin, toast]);

  const ownerForks = useMemo(() => activeForkOwner
    ? state.forks.filter(fork => fork.fork === true && fork.owner.login === activeForkOwner)
    : [], [state.forks, activeForkOwner]);
  const forkOwnerOptions = useMemo(() => {
    const options = new Map<string, { id: string; login: string; isPersonal: boolean }>();
    if (personalOwnerLogin) options.set(personalOwnerLogin, { id: `user-${personalOwnerLogin}`, login: personalOwnerLogin, isPersonal: true });
    organizations.forEach(org => options.set(org.login, { id: `org-${org.id}`, login: org.login, isPersonal: false }));
    state.forks.forEach(fork => {
      if (fork.fork && fork.owner.login !== personalOwnerLogin && !options.has(fork.owner.login)) {
        options.set(fork.owner.login, { id: `cached-${fork.owner.login}`, login: fork.owner.login, isPersonal: false });
      }
    });
    return Array.from(options.values());
  }, [state.forks, organizations, personalOwnerLogin]);

  const loadWorkflows = useCallback(async (forkId: number) => {
    const requestSession = captureSession();
    const fork = useAppStore.getState().forks.find(item => item.id === forkId);
    const githubToken = useAppStore.getState().githubToken;
    if (!fork || !githubToken || workflowLoadInFlightRef.current.get(forkId)?.generation === requestSession.generation) return;
    workflowLoadInFlightRef.current.set(forkId, requestSession);
    setLoadingWorkflows(previous => new Set(previous).add(forkId));
    try {
      const [owner, repo] = fork.full_name.split('/');
      const workflows = await new GitHubApiService(githubToken).getRepositoryWorkflows(owner, repo);
      if (!isCurrentSession(requestSession)) return;
      setWorkflowsMap(previous => ({ ...previous, [forkId]: workflows }));
    } catch (error) {
      if (!isCurrentSession(requestSession)) return;
      console.error('Failed to load workflows:', error);
    } finally {
      const isLatestRequest = workflowLoadInFlightRef.current.get(forkId)?.generation === requestSession.generation;
      if (isLatestRequest) workflowLoadInFlightRef.current.delete(forkId);
      if (isLatestRequest && isCurrentSession(requestSession)) {
        setLoadingWorkflows(previous => {
          const next = new Set(previous);
          next.delete(forkId);
          return next;
        });
      }
    }
  }, [captureSession, isCurrentSession]);

  const loadForksForOwner = useCallback(async (ownerLogin: string) => {
    if (!state.githubToken) {
      toast(t('GitHub token 未找到，请重新登录。', 'GitHub token not found. Please login again.'), 'error');
      return;
    }
    if (!ownerLogin) {
      toast(t('Fork 仓库拥有者未找到，请重新登录。', 'Fork owner not found. Please login again.'), 'error');
      return;
    }
    const requestSession = captureSession();
    const refreshRequest = { id: ++refreshRequestIdRef.current, session: requestSession };
    refreshRequestRef.current = refreshRequest;
    const startTime = Date.now();
    state.setForkIsRefreshing(true);
    try {
      const api = new GitHubApiService(state.githubToken);
      const fetchedForks = ownerLogin === personalOwnerLogin ? await api.getUserForks() : await api.getOrganizationForks(ownerLogin);
      if (!isCurrentSession(requestSession)) return;
      const newForks = fetchedForks.filter(fork => fork.fork === true && fork.owner.login === ownerLogin);
      logger.info('githubApi', 'Refresh forks completed', { owner: ownerLogin, forkCount: newForks.length, durationMs: Date.now() - startTime });
      let updatedForks: ForkRepo[] = [];
      let newCount = 0;
      useAppStore.setState(current => {
        const existingForkMap = new Map(current.forks.map(fork => [fork.id, fork]));
        const nextReadForks = new Set(current.readForks);
        newCount = newForks.filter(fork => !existingForkMap.has(fork.id)).length;
        updatedForks = newForks.map(newFork => {
          const existing = existingForkMap.get(newFork.id);
          if (!existing) return { ...newFork, has_unread: false, upstream_updated_at: newFork.source?.updated_at };
          const previousTime = existing.upstream_updated_at;
          const currentTime = newFork.source?.updated_at;
          const hasNewUpdates = !!previousTime && !!currentTime && new Date(currentTime) > new Date(previousTime);
          if (hasNewUpdates) {
            nextReadForks.delete(newFork.id);
            return { ...newFork, has_unread: existing.has_unread, upstream_updated_at: currentTime };
          }
          return { ...newFork, has_unread: existing.has_unread, upstream_updated_at: existing.upstream_updated_at || currentTime };
        });
        return { forks: [...current.forks.filter(fork => fork.owner.login !== ownerLogin || fork.fork !== true), ...updatedForks], readForks: nextReadForks };
      });
      setLoadedForkOwners(previous => new Set(previous).add(ownerLogin));
      setLastRefreshTime(new Date().toISOString());
      await Promise.all(updatedForks.map(async fork => {
        if (!fork.fork) return;
        const [owner, repo] = fork.full_name.split('/');
        try {
          const result = await api.checkForkSyncNeeded(owner, repo, fork.default_branch || 'main', fork.parent?.full_name || fork.source?.full_name);
          if (!isCurrentSession(requestSession)) return;
          setNeedsSyncMap(previous => ({ ...previous, [fork.id]: result.needsSync }));
          if (result.parentFullName && result.parentHtmlUrl && !fork.parent && !fork.source) {
            useAppStore.setState(current => ({
              forks: current.forks.map(item => item.id === fork.id ? {
                ...item,
                parent: { id: 0, full_name: result.parentFullName!, name: result.parentFullName!.split('/')[1], html_url: result.parentHtmlUrl! },
              } : item),
            }));
          }
        } catch {
          if (isCurrentSession(requestSession)) {
            setNeedsSyncMap(previous => ({ ...previous, [fork.id]: false }));
          }
        }
      }));
      if (!isCurrentSession(requestSession)) return;
      toast(newCount > 0 ? t(`刷新完成！发现 ${newCount} 个新Fork。`, `Refresh completed! Found ${newCount} new forks.`) : t('刷新完成！', 'Refresh completed!'), newCount > 0 ? 'success' : 'info');
    } catch (error) {
      if (!isCurrentSession(requestSession)) return;
      console.error('Fork refresh failed:', error);
      logger.error('githubApi', 'Refresh forks failed', { owner: ownerLogin, error: error instanceof Error ? error.message : String(error), durationMs: Date.now() - startTime });
      toast(t('Fork刷新失败，请检查网络连接。', 'Fork refresh failed. Please check your network connection.'), 'error');
    } finally {
      if (refreshRequestRef.current?.id === refreshRequest.id) {
        refreshRequestRef.current = null;
        state.setForkIsRefreshing(false);
      }
    }
  }, [captureSession, isCurrentSession, state, personalOwnerLogin, t, toast]);

  const handleForkOwnerChange = useCallback((ownerLogin: string) => {
    setSelectedForkOwner(ownerLogin);
    const hasCachedOwnerForks = useAppStore.getState().forks.some(fork => fork.fork === true && fork.owner.login === ownerLogin);
    if (!hasCachedOwnerForks && !loadedForkOwners.has(ownerLogin)) void loadForksForOwner(ownerLogin);
  }, [loadedForkOwners, loadForksForOwner]);

  const toggleWorkflows = useCallback((forkId: number) => {
    const isExpanding = !expandedWorkflows.has(forkId);
    const nextExpandedWorkflows = new Set(expandedWorkflows);
    if (isExpanding) nextExpandedWorkflows.add(forkId);
    else nextExpandedWorkflows.delete(forkId);
    setExpandedWorkflows(nextExpandedWorkflows);

    if (isExpanding && !workflowsMap[forkId]) {
      void loadWorkflows(forkId);
    }
  }, [expandedWorkflows, workflowsMap, loadWorkflows]);

  const handleSyncUpstream = useCallback(async (fork: ForkRepo) => {
    if (!state.githubToken) {
      toast(t('GitHub token 未找到，请重新登录。', 'GitHub token not found. Please login again.'), 'error');
      return;
    }
    const requestSession = captureSession();
    const defaultBranch = fork.default_branch || 'main';
    const [owner, repo] = fork.full_name.split('/');
    setSyncModal({ isOpen: true, forkId: fork.id, owner, repo, branch: defaultBranch, full_name: fork.full_name });
    setSyncModalBranches([]);
    setIsFetchingBranches(true);
    try {
      const branches = await new GitHubApiService(state.githubToken).getBranches(owner, repo);
      if (!isCurrentSession(requestSession)) return;
      setSyncModalBranches(branches);
      if (branches.length > 0 && !branches.includes(defaultBranch)) setSyncModal(previous => ({ ...previous, branch: branches[0] }));
    } catch (error) {
      if (!isCurrentSession(requestSession)) return;
      logger.error('githubApi', 'Failed to load fork branches for upstream sync', { repo: fork.full_name, error: error instanceof Error ? error.message : String(error) });
      setSyncModal(previous => ({ ...previous, isOpen: false, forkId: null }));
      setSyncModalBranches([]);
      toast(t('加载分支失败，请检查网络连接后重试。', 'Failed to load branches. Please check your network connection and try again.'), 'error');
    } finally {
      if (isCurrentSession(requestSession)) setIsFetchingBranches(false);
    }
  }, [captureSession, isCurrentSession, state.githubToken, t, toast]);

  const confirmSyncUpstream = useCallback(async () => {
    const githubToken = useAppStore.getState().githubToken;
    if (!githubToken || !syncModal.forkId) return;
    const fork = useAppStore.getState().forks.find(item => item.id === syncModal.forkId);
    if (!fork) return;
    const syncStartTime = Date.now();
    setSyncModal(previous => ({ ...previous, isOpen: false }));
    setSyncingForks(previous => new Set(previous).add(fork.id));
    try {
      const requestSession = captureSession();
      const result = await new GitHubApiService(githubToken).syncFork(syncModal.owner, syncModal.repo, syncModal.branch);
      if (!isCurrentSession(requestSession)) return;
      logger.info('githubApi', 'Sync fork completed', { repo: fork.full_name, mergeType: result.mergeType, durationMs: Date.now() - syncStartTime });
      useAppStore.setState(current => {
        const readForks = new Set(current.readForks);
        readForks.add(fork.id);
        return {
          forks: current.forks.map(item => item.id === fork.id ? {
            ...item,
            has_unread: false,
            upstream_updated_at: result.sourceUpdatedAt || item.upstream_updated_at,
          } : item),
          readForks,
        };
      });
      setNeedsSyncMap(previous => ({ ...previous, [fork.id]: false }));
      toast(result.mergeType === 'none' ? t(`${fork.name} 已是最新版本，无需更新。`, `${fork.name} is already up to date.`) : t(`已将 ${fork.name} 成功更新到上游最新版本。`, `${fork.name} has been successfully updated from upstream.`), result.mergeType === 'none' ? 'info' : 'success');
    } catch (error) {
      console.error('Sync failed:', error);
      const message = error instanceof Error ? error.message : String(error);
      logger.error('githubApi', 'Sync fork failed', { repo: fork.full_name, error: message, durationMs: Date.now() - syncStartTime });
      const userMessage = message === 'NOT_A_FORK'
        ? t(`${fork.name} 不是 Fork 仓库，无法同步上游。`, `${fork.name} is not a fork. Cannot sync upstream.`)
        : message === 'MERGE_CONFLICT'
          ? t(`同步失败：${fork.name} 与上游仓库存在合并冲突，请手动解决后重试。`, `Sync failed: ${fork.name} has merge conflicts with upstream. Please resolve manually.`)
          : t(`同步失败: ${message}`, `Sync failed: ${message}`);
      toast(userMessage, 'error');
    } finally {
      setSyncingForks(previous => { const next = new Set(previous); next.delete(fork.id); return next; });
    }
  }, [captureSession, isCurrentSession, syncModal, t, toast]);

  const handleRunWorkflow = useCallback(async (forkId: number, workflowPath: string, workflowName: string) => {
    const current = useAppStore.getState();
    if (!current.githubToken) {
      toast(t('GitHub token 未找到，请重新登录。', 'GitHub token not found. Please login again.'), 'error');
      return;
    }
    const fork = current.forks.find(item => item.id === forkId);
    if (!fork) return;
    const branch = fork.default_branch || 'main';
    const startTime = Date.now();
    setRunningWorkflows(previous => new Set(previous).add(forkId));
    try {
      const [owner, repo] = fork.full_name.split('/');
      await new GitHubApiService(current.githubToken).triggerWorkflowRun(owner, repo, workflowPath, branch);
      logger.info('githubApi', 'Trigger workflow completed', { repo: fork.full_name, workflow: workflowName, branch, durationMs: Date.now() - startTime });
      toast(t(`已触发工作流 "${workflowName}" 在 ${branch} 分支。`, `Triggered workflow "${workflowName}" on branch ${branch}.`), 'success');
      await loadWorkflows(forkId);
    } catch (error) {
      console.error('Failed to run workflow:', error);
      logger.error('githubApi', 'Trigger workflow failed', { repo: fork.full_name, workflow: workflowName, error: error instanceof Error ? error.message : String(error), durationMs: Date.now() - startTime });
      toast(t('运行工作流失败。', 'Failed to run workflow.'), 'error');
    } finally {
      setRunningWorkflows(previous => { const next = new Set(previous); next.delete(forkId); return next; });
    }
  }, [loadWorkflows, t, toast]);

  return {
    ...state,
    organizations,
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
    loadForksForOwner,
    handleRefresh: () => loadForksForOwner(activeForkOwner),
    handleForkOwnerChange,
    toggleWorkflows,
    handleSyncUpstream,
    confirmSyncUpstream,
    handleRunWorkflow,
  };
};
