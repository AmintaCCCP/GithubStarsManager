import { useCallback, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../../store/useAppStore';
import { selectReleaseTimelineState } from '../../../store/selectors';
import { GitHubApiService } from '../../../services/githubApi';
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
  const t = useCallback((zh: string, en: string) => state.language === 'zh' ? zh : en, [state.language]);

  const handleRefresh = useCallback(async () => {
    const {
      githubToken,
      language,
      setReleaseIsRefreshing,
      updateRepository,
      updateReleaseSourceRepository,
      addReleases,
      upsertReleases,
      includePreRelease,
    } = state;
    if (!githubToken) {
      toast(language === 'zh' ? 'GitHub token 未找到，请重新登录。' : 'GitHub token not found. Please login again.', 'error');
      return;
    }

    const currentState = useAppStore.getState();
    const resolvedSources = resolveReleaseSources(currentState);
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
        { includePreRelease, refreshExistingAssets: true },
      );
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
      const actuallyNewReleases = newReleases.filter(release => !new Set(existingReleases.map(item => item.id)).has(release.id));
      const updatedReleases = findReleasesWithChangedAssets(latestReleases, useAppStore.getState().releases);
      if (actuallyNewReleases.length > 0) addReleases(actuallyNewReleases);
      if (updatedReleases.length > 0) upsertReleases(updatedReleases);
      setLastRefreshTime(now);

      const updatedPart = updatedReleases.length > 0
        ? (language === 'zh' ? `，${updatedReleases.length} 个Release资产已更新` : `, ${updatedReleases.length} release assets updated`)
        : '';
      const message = failedRepos.length > 0
        ? (language === 'zh'
          ? `刷新完成！发现 ${actuallyNewReleases.length} 个新Release${updatedPart}，${failedRepos.length} 个仓库刷新失败。`
          : `Refresh completed! Found ${actuallyNewReleases.length} new releases${updatedPart}, ${failedRepos.length} repos failed.`)
        : (language === 'zh'
          ? `刷新完成！发现 ${actuallyNewReleases.length} 个新Release${updatedPart}。`
          : `Refresh completed! Found ${actuallyNewReleases.length} new releases${updatedPart}.`);
      toast(message, actuallyNewReleases.length > 0 || updatedReleases.length > 0 ? 'success' : 'info');
    } catch (error) {
      console.error('Refresh failed:', error);
      toast(language === 'zh' ? 'Release刷新失败，请检查网络连接。' : 'Release refresh failed. Please check your network connection.', 'error');
    } finally {
      setReleaseIsRefreshing(false);
    }
  }, [state, toast]);

  const handleMarkAllRead = useCallback(async () => {
    setIsMarkingAllRead(true);
    try {
      state.markAllReleasesAsRead();
      await backend.markAllReleasesAsRead();
      toast(t('已全部标记为已读', 'All marked as read'), 'success');
    } catch {
      toast(t('标记全部已读失败', 'Failed to mark all as read'), 'error');
    } finally {
      setIsMarkingAllRead(false);
    }
  }, [state, t, toast]);

  const handleUnsubscribeRelease = useCallback(async (repoId: number) => {
    const release = state.releases.find(item => item.repository.id === repoId);
    const releaseRepo = release?.repository;
    if (!releaseRepo) {
      toast(t('仓库信息不完整，无法取消订阅。', 'Repository information missing. Cannot unsubscribe.'), 'error');
      return;
    }

    const stateBeforeConfirm = useAppStore.getState();
    const repoKey = normalizeRepoKey(releaseRepo.full_name);
    const starredRepo = stateBeforeConfirm.repositories.find(item => normalizeRepoKey(item.full_name) === repoKey);
    const sourcesToRemove = getSourcesForReleaseRepository(stateBeforeConfirm, releaseRepo);
    const sourceLabels = sourcesToRemove.map(sourceId => getReleaseSourceLabel(sourceId, state.language));
    let confirmMessage: string;
    if (sourcesToRemove.length === 0) {
      confirmMessage = state.language === 'zh'
        ? `"${releaseRepo.full_name}" 当前不在任何 Release 来源中。确认后仅移除本地已缓存的 Release 记录。`
        : `"${releaseRepo.full_name}" is not in any release source. Confirming will only remove locally cached releases.`;
    } else if (sourcesToRemove.length > 1) {
      confirmMessage = state.language === 'zh'
        ? `"${releaseRepo.full_name}" 同时来自多个 Release 来源：${sourceLabels.join('、')}。确认后将从这些来源中一并取消订阅。`
        : `"${releaseRepo.full_name}" comes from multiple release sources: ${sourceLabels.join(', ')}. Confirming will unsubscribe it from all of these sources.`;
    } else if (sourcesToRemove[0] === WATCH_CUSTOM_RELEASE_SOURCE_ID) {
      confirmMessage = t(`确定取消订阅 "${releaseRepo.full_name}" 吗？确认后将一并取消 Watch 仓库来源。`, `Unsubscribe from "${releaseRepo.full_name}"? This will also remove it from Watch repositories.`);
    } else if (sourcesToRemove[0] === CUSTOM_RELEASE_SOURCE_ID) {
      confirmMessage = t(`确定取消订阅 "${releaseRepo.full_name}" 吗？确认后将从自定义仓库列表中移除。`, `Unsubscribe from "${releaseRepo.full_name}"? This will remove it from the custom repository list.`);
    } else {
      confirmMessage = t(`确定取消订阅 "${releaseRepo.full_name}" 的 Release 吗？`, `Unsubscribe from releases for "${releaseRepo.full_name}"?`);
    }
    const confirmed = await confirm(t('取消订阅确认', 'Unsubscribe Confirmation'), confirmMessage, { type: 'warning' });
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
      useAppStore.setState(rollbackState);
      toast(t('取消订阅失败，请检查后端连接。', 'Failed to unsubscribe. Please check backend connection.'), 'error');
      return;
    }
    toast(t('已取消订阅该仓库的 Release。', 'Unsubscribed from repository releases.'), 'success');
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
