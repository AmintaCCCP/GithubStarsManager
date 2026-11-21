



import { useT } from '../../../i18n/useT';
import { useCallback, useState } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import {
  getAccountSessionGeneration,
  isCurrentAccountSession,
  peekCurrentAccountId,
} from '../../../store/helpers/accountWorkspace';
import { createGitHubApiService } from '../../../services/githubApiFactory';
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
    // 账号代次校验（Issue #611）：Watch 拉取切号后丢弃结果，不写入新账号的来源配置
    const startedAccountId = peekCurrentAccountId();
    // A→B→A 时账号 ID 与切号前相同：必须比较会话代次。
    const startedGeneration = getAccountSessionGeneration();
    try {
      const githubApi = createGitHubApiService(githubToken);
      // 只拉 /user/subscriptions（含私有仓）。/users/{login}/subscriptions 已被 GitHub 改为
      // 恒定返回 204 空响应体，且其结果本就是前者的公开子集，并行合并只会拖垮整个同步。
      const watchedRepos = await githubApi.getAllWatchedRepositories();
      if (!isCurrentAccountSession(startedAccountId, startedGeneration)) {
        return;
      }
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
      // 审计修复（C43）：失败 toast 前校验发起会话（账号 ID + 会话代次）——
      // 仅发起会话仍是当前会话时提示；finally 的加载状态清理保持不变。
      if (isCurrentAccountSession(startedAccountId, startedGeneration)) {
        toast(t('useWatchedSourcesSync.failed-to-sync-watch-repositories-check-network'), 'error');
      }
    } finally {
      setIsSyncingWatchedSources(false);
    }
  }, [githubToken, isSyncingWatchedSources, setReleaseSourceRepositories, t, toast]);

  return { syncWatchedSources, isSyncingWatchedSources };
};
