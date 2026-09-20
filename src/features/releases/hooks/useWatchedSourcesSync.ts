



import { useT } from '../../../i18n/useT';
import { useCallback, useState } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { GitHubApiService } from '../../../services/githubApi';
import { useDialog } from '../../../hooks/useDialog';
import {
  normalizeRepoKey,
  repositoryToCustomReleaseRepository,
  WATCH_CUSTOM_RELEASE_SOURCE_ID,
} from '../../../utils/releaseSources';

/**
 * 同步 Watch 仓库为 Release 来源（原 ReleaseSourceSettingsModal →
 * WatchCustomReleaseSyncPanel.handleSync）：无 confirm、无 forceSync、无 Abort。
 * 独立于 useReleaseTimelineActions 的窄订阅 hook：设置弹窗只需要这两项，
 * 不应随整个 Release 时间线状态重渲染。
 */
export const useWatchedSourcesSync = () => {
  const githubToken = useAppStore((s) => s.githubToken);
  const setReleaseSourceRepositories = useAppStore((s) => s.setReleaseSourceRepositories);
  const { toast } = useDialog();
  const [isSyncingWatchedSources, setIsSyncingWatchedSources] = useState(false);
  const t = useT('releases');

  const syncWatchedSources = useCallback(async () => {
    if (!githubToken || isSyncingWatchedSources) return;

    setIsSyncingWatchedSources(true);
    try {
      const githubApi = new GitHubApiService(githubToken);
      // 只拉 /user/subscriptions（含私有仓）。/users/{login}/subscriptions 已被 GitHub 改为
      // 恒定返回 204 空响应体，且其结果本就是前者的公开子集，并行合并只会拖垮整个同步。
      const watchedRepos = await githubApi.getAllWatchedRepositories();
      // hiddenByRepo 在 await 之后从最新 state 读取：同步期间用户仍可在设置面板
      // 切换 release_hidden，旧快照会在 setReleaseSourceRepositories 时覆盖该修改。
      const hiddenByRepo = new Map(
        useAppStore.getState().releaseSourceSettings.watchCustomReleaseRepos.map(repo => [normalizeRepoKey(repo.full_name), repo.release_hidden]),
      );
      const sourceRepos = watchedRepos.map(repo => ({
        ...repositoryToCustomReleaseRepository(repo, WATCH_CUSTOM_RELEASE_SOURCE_ID),
        release_hidden: hiddenByRepo.get(normalizeRepoKey(repo.full_name)) || undefined,
      }));
      setReleaseSourceRepositories(WATCH_CUSTOM_RELEASE_SOURCE_ID, sourceRepos);
      toast(
        t('useWatchedSourcesSync.synced-v1-watch-repositories', { v1: sourceRepos.length }),
        'success'
      );
    } catch (error) {
      console.error('Failed to sync watched repositories:', error);
      toast(t('useWatchedSourcesSync.failed-to-sync-watch-repositories-check-network'), 'error');
    } finally {
      setIsSyncingWatchedSources(false);
    }
  }, [githubToken, isSyncingWatchedSources, setReleaseSourceRepositories, t, toast]);

  return { syncWatchedSources, isSyncingWatchedSources };
};
