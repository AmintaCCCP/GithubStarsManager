
import { WATCH_CUSTOM_RELEASE_SOURCE_ID, normalizeReleaseSourceSettings, normalizeRepoKey } from '../../utils/releaseSources';
import type { AppStoreSlice } from '../types';

export const createTimelineSlice: AppStoreSlice<Pick<import('../types').AppActions,
  | 'setReleases'
  | 'addReleases'
  | 'upsertReleases'
  | 'toggleReleaseSubscription'
  | 'batchUnsubscribeReleases'
  | 'removeReleasesByRepoId'
  | 'removeReleasesByRepoFullName'
  | 'markReleaseAsRead'
  | 'markAssetAsRead'
  | 'markAllReleasesAsRead'
  | 'setReleaseSourceSettings'
  | 'setReleaseEnabledSources'
  | 'toggleReleaseSource'
  | 'setReleaseSourceRepositories'
  | 'addReleaseSourceRepository'
  | 'removeReleaseSourceRepository'
  | 'updateReleaseSourceRepository'
  | 'setForks'
  | 'addForks'
  | 'updateFork'
  | 'markForkAsRead'
  | 'markAllForksAsRead'
  | 'setForkViewMode'
  | 'setForkSelectedFilters'
  | 'toggleForkSelectedFilter'
  | 'clearForkSelectedFilters'
  | 'setForkSearchQuery'
  | 'toggleForkExpandedRepository'
  | 'setForkExpandedRepositories'
  | 'setForkIsRefreshing'
>> = (set, get) => ({
      // Release actions
      setReleases: (releases) => set({ releases }),
      addReleases: (newReleases) => set((state) => {
        const existingIds = new Set(state.releases.map(r => r.id));
        const uniqueReleases = newReleases.filter(r => !existingIds.has(r.id));
        return { releases: [...state.releases, ...uniqueReleases] };
      }),
      upsertReleases: (updates) => set((state) => {
        const byId = new Map(updates.map(r => [r.id, r]));
        const updatedIds = new Set<number>();
        const merged = state.releases.map(r => {
          const update = byId.get(r.id);
          if (!update) return r;
          updatedIds.add(r.id);
          // 内容已变化（资产等），重置为未读，让用户注意到本次更新
          return {
            ...update,
            is_read: false,
          };
        });
        const nextReadReleases = new Set(
          Array.from(state.readReleases).filter(releaseId => !updatedIds.has(releaseId))
        );
        return { releases: merged, readReleases: nextReadReleases };
      }),
      toggleReleaseSubscription: (repoId) => set((state) => {
        const newSubscriptions = new Set(state.releaseSubscriptions);
        const wasSubscribed = newSubscriptions.has(repoId);

        if (wasSubscribed) {
          newSubscriptions.delete(repoId);
        } else {
          newSubscriptions.add(repoId);
        }

        return { releaseSubscriptions: newSubscriptions };
      }),
      batchUnsubscribeReleases: (repoIds) => set((state) => {
        const newSubscriptions = new Set(state.releaseSubscriptions);
        repoIds.forEach(repoId => {
          newSubscriptions.delete(repoId);
        });
        return { releaseSubscriptions: newSubscriptions };
      }),
      removeReleasesByRepoId: (repoId) => set((state) => {
        const filteredReleases = state.releases.filter(release => release.repository.id !== repoId);
        const remainingReleaseIds = new Set(filteredReleases.map(r => r.id));
        const nextReadReleases = new Set(
          Array.from(state.readReleases).filter(releaseId => remainingReleaseIds.has(releaseId))
        );
        const nextExpandedRepos = new Set(state.releaseExpandedRepositories);
        nextExpandedRepos.delete(repoId);
        return {
          releases: filteredReleases,
          readReleases: nextReadReleases,
          releaseExpandedRepositories: nextExpandedRepos,
        };
      }),
      removeReleasesByRepoFullName: (fullName) => set((state) => {
        const targetKey = normalizeRepoKey(fullName);
        const filteredReleases = state.releases.filter(release => normalizeRepoKey(release.repository.full_name) !== targetKey);
        const remainingReleaseIds = new Set(filteredReleases.map(r => r.id));
        const removedRepoIds = new Set(
          state.releases
            .filter(release => normalizeRepoKey(release.repository.full_name) === targetKey)
            .map(release => release.repository.id)
        );
        const nextExpandedRepos = new Set(state.releaseExpandedRepositories);
        removedRepoIds.forEach(repoId => nextExpandedRepos.delete(repoId));
        return {
          releases: filteredReleases,
          readReleases: new Set(Array.from(state.readReleases).filter(releaseId => remainingReleaseIds.has(releaseId))),
          releaseExpandedRepositories: nextExpandedRepos,
        };
      }),
      setReleaseSourceSettings: (settings) => set({ releaseSourceSettings: normalizeReleaseSourceSettings(settings) }),
      setReleaseEnabledSources: (sourceIds) => set((state) => ({
        releaseSourceSettings: normalizeReleaseSourceSettings({
          ...state.releaseSourceSettings,
          enabledSourceIds: sourceIds,
        }),
      })),
      toggleReleaseSource: (sourceId) => set((state) => {
        const settings = normalizeReleaseSourceSettings(state.releaseSourceSettings);
        const enabled = new Set(settings.enabledSourceIds);
        if (enabled.has(sourceId)) {
          if (enabled.size === 1) return state;
          enabled.delete(sourceId);
        } else {
          enabled.add(sourceId);
        }
        return {
          releaseSourceSettings: {
            ...settings,
            enabledSourceIds: Array.from(enabled),
          },
        };
      }),
      setReleaseSourceRepositories: (sourceId, repos) => set((state) => {
        const settings = normalizeReleaseSourceSettings(state.releaseSourceSettings);
        const listKey = sourceId === WATCH_CUSTOM_RELEASE_SOURCE_ID ? 'watchCustomReleaseRepos' : 'customReleaseRepos';
        return {
          releaseSourceSettings: normalizeReleaseSourceSettings({
            ...settings,
            [listKey]: repos,
          }),
        };
      }),
      addReleaseSourceRepository: (sourceId, repo) => set((state) => {
        const settings = normalizeReleaseSourceSettings(state.releaseSourceSettings);
        const listKey = sourceId === WATCH_CUSTOM_RELEASE_SOURCE_ID ? 'watchCustomReleaseRepos' : 'customReleaseRepos';
        const repoKey = normalizeRepoKey(repo.full_name);
        if (settings[listKey].some(item => normalizeRepoKey(item.full_name) === repoKey)) {
          return state;
        }
        return {
          releaseSourceSettings: {
            ...settings,
            [listKey]: [...settings[listKey], repo],
          },
        };
      }),
      removeReleaseSourceRepository: (sourceId, fullName) => set((state) => {
        const settings = normalizeReleaseSourceSettings(state.releaseSourceSettings);
        const listKey = sourceId === WATCH_CUSTOM_RELEASE_SOURCE_ID ? 'watchCustomReleaseRepos' : 'customReleaseRepos';
        const repoKey = normalizeRepoKey(fullName);
        return {
          releaseSourceSettings: {
            ...settings,
            [listKey]: settings[listKey].filter(repo => normalizeRepoKey(repo.full_name) !== repoKey),
          },
        };
      }),
      updateReleaseSourceRepository: (sourceId, fullName, updates) => set((state) => {
        const settings = normalizeReleaseSourceSettings(state.releaseSourceSettings);
        const listKey = sourceId === WATCH_CUSTOM_RELEASE_SOURCE_ID ? 'watchCustomReleaseRepos' : 'customReleaseRepos';
        const repoKey = normalizeRepoKey(fullName);
        return {
          releaseSourceSettings: {
            ...settings,
            [listKey]: settings[listKey].map(repo =>
              normalizeRepoKey(repo.full_name) === repoKey ? { ...repo, ...updates } : repo
            ),
          },
        };
      }),
      markReleaseAsRead: (releaseId) => set((state) => {
        const newReadReleases = new Set(state.readReleases);
        newReadReleases.add(releaseId);

        // 点击 Release 即视为已看过其资产更新：被标记已读的条目同时清除资产级
        // “资产已更新”标识（updated_asset_ids）。仅改动确有标识的记录，避免
        // 每次点击都生成新的 releases 数组触发多余的重渲染与持久化。
        const clearedIds = new Set<number>([releaseId]);

        // In 'latest' mode, marking the latest release as read also marks all other releases of that repo
        if (state.releaseLatestMode === 'latest') {
          const markedRelease = state.releases.find(r => r.id === releaseId);
          if (markedRelease) {
            const repoId = markedRelease.repository.id;
            const repoReleases = state.releases.filter(r => r.repository.id === repoId);
            const latestRepoRelease = repoReleases.reduce((latest, r) =>
              r.published_at > latest.published_at ? r : latest
            , repoReleases[0]);
            if (latestRepoRelease && latestRepoRelease.id === releaseId) {
              repoReleases.forEach(r => {
                newReadReleases.add(r.id);
                clearedIds.add(r.id);
              });
            }
          }
        }

        const releases = state.releases.some(r => clearedIds.has(r.id) && (r.updated_asset_ids?.length ?? 0) > 0)
          ? state.releases.map(r =>
              clearedIds.has(r.id) && (r.updated_asset_ids?.length ?? 0) > 0
                ? { ...r, updated_asset_ids: [] }
                : r
            )
          : state.releases;

        return { readReleases: newReadReleases, releases };
      }),
      // 资产级已读：仅从 release.updated_asset_ids 移除该资产 id，不动 readReleases/is_read。
      // 无命中时直接返回，避免多余的重渲染与 autoSync 推送。
      markAssetAsRead: (assetId) => {
        const state = get();
        const hasAsset = state.releases.some(release => release.updated_asset_ids?.includes(assetId));
        if (!hasAsset) return;
        set((s) => ({
          releases: s.releases.map(release =>
            release.updated_asset_ids?.includes(assetId)
              ? { ...release, updated_asset_ids: release.updated_asset_ids.filter(id => id !== assetId) }
              : release
          ),
        }));
      },
      markAllReleasesAsRead: () => set((state) => {
        const allReleaseIds = new Set(state.releases.map(r => r.id));
        // "全部已读"视为用户已看过所有更新：一并清除资产级"资产已更新"标识，
        // 并同步记录上的 is_read=true，避免后续 autoSync 整表推送时用陈旧的
        // is_read:false 覆盖后端 mark-all-read 已置为已读的状态。
        const releases = state.releases.map(release => {
          const hasBadges = !!release.updated_asset_ids && release.updated_asset_ids.length > 0;
          if (release.is_read === true && !hasBadges) return release;
          return {
            ...release,
            is_read: true,
            ...(hasBadges ? { updated_asset_ids: [] } : {}),
          };
        });
        return { readReleases: allReleaseIds, releases };
      }),

      // Fork actions
      setForks: (forks) => set({ forks }),
      addForks: (newForks) => set((state) => {
        const existingIds = new Set(state.forks.map(f => f.id));
        const uniqueForks = newForks.filter(f => !existingIds.has(f.id));
        return { forks: [...state.forks, ...uniqueForks] };
      }),
      updateFork: (fork) => set((state) => ({
        forks: state.forks.map(f => f.id === fork.id ? fork : f),
      })),
      markForkAsRead: (forkId) => set((state) => {
        const newReadForks = new Set(state.readForks);
        newReadForks.add(forkId);
        return { readForks: newReadForks };
      }),
      markAllForksAsRead: () => set((state) => {
        const allForkIds = new Set(state.forks.map(f => f.id));
        return { readForks: allForkIds };
      }),

      // Fork Timeline View actions
      setForkViewMode: (forkViewMode) => set({ forkViewMode }),
      setForkSelectedFilters: (forkSelectedFilters) => set({ forkSelectedFilters }),
      toggleForkSelectedFilter: (filterId) => set((state) => ({
        forkSelectedFilters: state.forkSelectedFilters.includes(filterId)
          ? state.forkSelectedFilters.filter(id => id !== filterId)
          : [...state.forkSelectedFilters, filterId]
      })),
      clearForkSelectedFilters: () => set({ forkSelectedFilters: [] }),
      setForkSearchQuery: (forkSearchQuery) => set({ forkSearchQuery }),
      toggleForkExpandedRepository: (repoId) => set((state) => {
        const newSet = new Set(state.forkExpandedRepositories);
        if (newSet.has(repoId)) {
          newSet.delete(repoId);
        } else {
          newSet.add(repoId);
        }
        return { forkExpandedRepositories: newSet };
      }),
      setForkExpandedRepositories: (forkExpandedRepositories) => set({ forkExpandedRepositories }),
      setForkIsRefreshing: (forkIsRefreshing) => set({ forkIsRefreshing }),
});
