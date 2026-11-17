import { useT } from "../../../i18n/useT";
import { useCallback, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../../store/useAppStore';
import { isCurrentAccount, peekCurrentAccountId } from '../../../store/helpers/accountWorkspace';
import { selectReleaseTimelineState } from '../../../store/selectors';
import { createGitHubApiService } from '../../../services/githubApiFactory';
import { forceSyncToBackend } from '../../../services/autoSync';
import { backend } from '../../../services/backendAdapter';
import { useDialog } from '../../../hooks/useDialog';
import {
  CUSTOM_RELEASE_SOURCE_ID,
  getReleaseSourceLabel,
  getSourcesForReleaseRepository,
  normalizeRepoKey,
  releaseBelongsToResolvedSources,
  resolveReleaseSources,
  STARRED_RELEASE_SOURCE_ID,
  WATCH_CUSTOM_RELEASE_SOURCE_ID,
} from '../../../utils/releaseSources';
import { findReleasesWithChangedAssets } from '../../../utils/releaseAssets';

/**
 * Keeps ReleaseTimeline presentation-only by owning remote refresh, optimistic
 * unsubscribe with rollback, and backend read-state synchronization.
 */
export const useReleaseTimelineActions = () => {
  const state = useAppStore(useShallow(selectReleaseTimelineState));
  const { toast, confirm } = useDialog();
  const [lastRefreshTime, setLastRefreshTime] = useState<string | null>(null);
  const [isMarkingAllRead, setIsMarkingAllRead] = useState(false);
  const t = useT('releases');

  const handleRefresh = useCallback(async () => {
    const {
      githubToken,
      setReleaseIsRefreshing,
      updateRepository,
      updateReleaseSourceRepository,
      addReleases,
      upsertReleases,
      includePreRelease,
    } = state;
    if (!githubToken) {
      toast(t('useReleaseTimelineActions.github-token-not-found-please-login-again'), 'error');
      return;
    }

    const currentState = useAppStore.getState();
    const resolvedSources = resolveReleaseSources(currentState);
    const subscribedRepos = resolvedSources.repositories;
    if (resolvedSources.enabledSourceIds.length === 0) {
      toast(t('useReleaseTimelineActions.no-release-sources-enabled'), 'error');
      return;
    }
    if (subscribedRepos.length === 0) {
      toast(t('useReleaseTimelineActions.no-repositories-to-check-in-the-selected-sources'), 'error');
      return;
    }

    setReleaseIsRefreshing(true);
    // 账号代次校验（Issue #611）：Release 批量刷新耗时期间切号后丢弃结果
    const startedAccountId = peekCurrentAccountId();
    try {
      const githubApi = createGitHubApiService(githubToken);
      const { releases: newReleases, latestReleases, failedRepos } = await githubApi.getMultipleRepositoryReleases(
        subscribedRepos,
        { includePreRelease, refreshExistingAssets: true },
      );
      if (!isCurrentAccount(startedAccountId)) {
        return;
      }
      const now = new Date().toISOString();
      const failedRepoIds = new Set(failedRepos.map(repo => repo.repoId));
      for (const entry of resolvedSources.entries) {
        const repo = entry.repository;
        if (failedRepoIds.has(repo.id)) continue;
        if (entry.sources.includes(STARRED_RELEASE_SOURCE_ID)) {
          const starredRepo = currentState.repositories.find(item => normalizeRepoKey(item.full_name) === normalizeRepoKey(repo.full_name));
          if (starredRepo) {
            updateRepository({ ...starredRepo, has_fetched_releases: true, last_release_fetch_time: now });
          }
        }
        if (entry.sources.includes(WATCH_CUSTOM_RELEASE_SOURCE_ID)) {
          updateReleaseSourceRepository(WATCH_CUSTOM_RELEASE_SOURCE_ID, repo.full_name, { has_fetched_releases: true, last_release_fetch_time: now });
        }
        if (entry.sources.includes(CUSTOM_RELEASE_SOURCE_ID)) {
          updateReleaseSourceRepository(CUSTOM_RELEASE_SOURCE_ID, repo.full_name, { has_fetched_releases: true, last_release_fetch_time: now });
        }
      }

      const existingReleases = useAppStore.getState().releases;
      const existingReleaseIds = new Set(existingReleases.map(item => item.id));
      const actuallyNewReleases = newReleases.filter(release => !existingReleaseIds.has(release.id));
      const updatedReleases = findReleasesWithChangedAssets(latestReleases, existingReleases);
      if (actuallyNewReleases.length > 0) addReleases(actuallyNewReleases);
      if (updatedReleases.length > 0) upsertReleases(updatedReleases);
      setLastRefreshTime(now);

      // updatedReleases 既含资产变化也含正文回填（空日志补回），文案不再只提资产。
      const updatedPart = updatedReleases.length > 0
        ? t('useReleaseTimelineActions.releases-updated', { count: updatedReleases.length })
        : '';
      const message = failedRepos.length > 0
        ? (t('useReleaseTimelineActions.refresh-completed-found-v1-new-releases-updatedp', { v1: actuallyNewReleases.length, updatedPart: updatedPart, v3: failedRepos.length }))
        : (t('useReleaseTimelineActions.refresh-completed-found-v1-new-releases-updatedp-2', { v1: actuallyNewReleases.length, updatedPart: updatedPart }));
      toast(message, actuallyNewReleases.length > 0 || updatedReleases.length > 0 ? 'success' : 'info');
    } catch (error) {
      console.error('Refresh failed:', error);
      toast(t('useReleaseTimelineActions.release-refresh-failed-please-check-your-network'), 'error');
    } finally {
      setReleaseIsRefreshing(false);
    }
  }, [state, toast, t]);

  const handleMarkAllRead = useCallback(async () => {
    const readReleasesBeforeUpdate = new Set(useAppStore.getState().readReleases);
    // 账号代次校验（Issue #611 审计修复）：请求发起前保存账号，失败回滚只在
    // 发起账号仍是当前账号时执行——切号后把旧账号的已读快照写入新账号会
    // 覆盖并污染新账号的已读状态
    const startedAccountId = peekCurrentAccountId();
    setIsMarkingAllRead(true);
    try {
      state.markAllReleasesAsRead();
      await backend.markAllReleasesAsRead();
      toast(t('useReleaseTimelineActions.all-marked-as-read'), 'success');
    } catch {
      if (isCurrentAccount(startedAccountId)) {
        useAppStore.setState({ readReleases: readReleasesBeforeUpdate });
      } else if (startedAccountId) {
        // 账号代次校验补充（审计修复）：切号时 switchAccountWorkspace 已把
        // 包含乐观更新（全部已读）的 live 工作区写入发起账号的归档快照，
        // 仅跳过 live 回滚会让服务端失败的已读状态留在该快照里，下次激活
        // 原账号时被恢复。这里只把发起账号快照中的 readReleases 回写为
        // 操作前集合，绝不创建/覆盖不存在的快照，也不触碰当前账号的工作区。
        useAppStore.setState((state) => {
          const parked = state.accountWorkspaces?.[startedAccountId];
          if (!parked) return state;
          return {
            accountWorkspaces: {
              ...state.accountWorkspaces,
              [startedAccountId]: {
                ...parked,
                readReleases: Array.from(readReleasesBeforeUpdate),
              },
            },
          };
        });
      }
      toast(t('useReleaseTimelineActions.failed-to-mark-all-as-read'), 'error');
    } finally {
      setIsMarkingAllRead(false);
    }
  }, [state, t, toast]);

  const handleUnsubscribeRelease = useCallback(async (repoId: number) => {
    const release = state.releases.find(item => item.repository.id === repoId);
    const releaseRepo = release?.repository;
    if (!releaseRepo) {
      toast(t('useReleaseTimelineActions.repository-information-missing-cannot-unsubscrib'), 'error');
      return;
    }

    // 账号代次校验（Issue #611 审计修复）：账号 ID 必须在 await confirm 之前
    // 保存——确认后再读取会拿到切号后的账号，比较恒通过；stateBeforeConfirm、
    // starredRepo 与 sourcesToRemove 都属于发起账号，账号已切换时必须整体退出。
    const accountIdBeforeConfirm = peekCurrentAccountId();
    const stateBeforeConfirm = useAppStore.getState();
    const repoKey = normalizeRepoKey(releaseRepo.full_name);
    const starredRepo = stateBeforeConfirm.repositories.find(item => normalizeRepoKey(item.full_name) === repoKey);
    const sourcesToRemove = getSourcesForReleaseRepository(stateBeforeConfirm, releaseRepo);
    const sourceLabels = sourcesToRemove.map(sourceId => getReleaseSourceLabel(sourceId, state.language));
    let confirmMessage: string;
    if (sourcesToRemove.length === 0) {
      confirmMessage = t('useReleaseTimelineActions.v1-is-not-in-any-release-source-confirming-will', { v1: releaseRepo.full_name });
    } else if (sourcesToRemove.length > 1) {
      confirmMessage = t('useReleaseTimelineActions.v1-comes-from-multiple-release-sources-v2-confir', { v1: releaseRepo.full_name, v2: sourceLabels.join('、') });
    } else if (sourcesToRemove[0] === WATCH_CUSTOM_RELEASE_SOURCE_ID) {
      confirmMessage = t('useReleaseTimelineActions.unsubscribe-from-v1-this-will-also-remove-it-fro', { v1: releaseRepo.full_name });
    } else if (sourcesToRemove[0] === CUSTOM_RELEASE_SOURCE_ID) {
      confirmMessage = t('useReleaseTimelineActions.unsubscribe-from-v1-this-will-remove-it-from-the', { v1: releaseRepo.full_name });
    } else {
      confirmMessage = t('useReleaseTimelineActions.unsubscribe-from-releases-for-v1', { v1: releaseRepo.full_name });
    }
    const confirmed = await confirm(t('useReleaseTimelineActions.unsubscribe-confirmation'), confirmMessage, { type: 'warning' });
    if (!confirmed) return;

    const rollbackState = {
      repositories: stateBeforeConfirm.repositories,
      searchResults: stateBeforeConfirm.searchResults,
      releaseSubscriptions: new Set(stateBeforeConfirm.releaseSubscriptions),
      releaseSourceSettings: stateBeforeConfirm.releaseSourceSettings,
      releases: stateBeforeConfirm.releases,
      readReleases: new Set(stateBeforeConfirm.readReleases),
      releaseExpandedRepositories: new Set(stateBeforeConfirm.releaseExpandedRepositories),
    };
    // 账号代次校验（Issue #611）：确认弹窗等待期间可能已切号，回滚快照跨账号会污染
    if (!isCurrentAccount(accountIdBeforeConfirm)) {
      return;
    }
    if (sourcesToRemove.includes(STARRED_RELEASE_SOURCE_ID) && starredRepo) {
      state.updateRepository({ ...starredRepo, subscribed_to_releases: false });
      state.batchUnsubscribeReleases([starredRepo.id]);
    }
    if (sourcesToRemove.includes(WATCH_CUSTOM_RELEASE_SOURCE_ID)) state.removeReleaseSourceRepository(WATCH_CUSTOM_RELEASE_SOURCE_ID, releaseRepo.full_name);
    if (sourcesToRemove.includes(CUSTOM_RELEASE_SOURCE_ID)) state.removeReleaseSourceRepository(CUSTOM_RELEASE_SOURCE_ID, releaseRepo.full_name);

    const stillActive = resolveReleaseSources(useAppStore.getState()).entries.some(entry => normalizeRepoKey(entry.repository.full_name) === repoKey);
    if (!stillActive) state.removeReleasesByRepoFullName(releaseRepo.full_name);
    try {
      await forceSyncToBackend();
    } catch (error) {
      console.error('Failed to unsubscribe release:', error);
      // 同步等待期间可能已切号：发起账号的回滚快照绝不写入新账号工作区
      if (isCurrentAccount(accountIdBeforeConfirm)) {
        useAppStore.setState(rollbackState);
      }
      toast(t('useReleaseTimelineActions.failed-to-unsubscribe-please-check-backend-conne'), 'error');
      return;
    }
    toast(t('useReleaseTimelineActions.unsubscribed-from-repository-releases'), 'success');
  }, [state, t, toast, confirm]);

  return {
    ...state,
    lastRefreshTime,
    isMarkingAllRead,
    handleRefresh,
    handleMarkAllRead,
    handleUnsubscribeRelease,
  };
};

export { releaseBelongsToResolvedSources };
