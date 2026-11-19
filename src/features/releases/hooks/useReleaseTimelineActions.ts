import { useT } from "../../../i18n/useT";
import { useCallback, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../../store/useAppStore';
import {
  getAccountSessionGeneration,
  isCurrentAccountSession,
  peekCurrentAccountId,
} from '../../../store/helpers/accountWorkspace';
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

    // 账号代次校验（Issue #611）：Release 批量刷新耗时期间切号后丢弃结果。
    // B4（HANDOFF-B-TO-C.md）：刷新状态按发起会话归属——身份必须在 set(true)
    // 与 finally 的 set(false) 两处都传入。
    const startedAccountId = peekCurrentAccountId();
    // A→B→A 时账号 ID 与切号前相同，必须同时比较会话代次。
    const startedGeneration = getAccountSessionGeneration();
    setReleaseIsRefreshing(true, { accountId: startedAccountId, generation: startedGeneration });
    try {
      const githubApi = createGitHubApiService(githubToken);
      const { releases: newReleases, latestReleases, failedRepos } = await githubApi.getMultipleRepositoryReleases(
        subscribedRepos,
        { includePreRelease, refreshExistingAssets: true },
      );
      if (!isCurrentAccountSession(startedAccountId, startedGeneration)) {
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
      // 审计修复（C37）：失败提示先校验发起会话——已切换则不显示旧请求错误；
      // 同一会话失败仍提示。归属化刷新状态清理保持不变（B4）。
      if (isCurrentAccountSession(startedAccountId, startedGeneration)) {
        toast(t('useReleaseTimelineActions.release-refresh-failed-please-check-your-network'), 'error');
      }
    } finally {
      setReleaseIsRefreshing(false, { accountId: startedAccountId, generation: startedGeneration });
    }
  }, [state, toast, t]);

  const handleMarkAllRead = useCallback(async () => {
    const stateBeforeUpdate = useAppStore.getState();
    const readReleasesBeforeUpdate = new Set(stateBeforeUpdate.readReleases);
    // 记录本次乐观操作前每条 release 的 is_read 与 updated_asset_ids，
    // 失败回滚时按 ID 仅恢复这两个字段并保留请求期间的独立编辑。
    const releaseFieldsBeforeUpdate = new Map<
      number,
      { is_read: boolean | undefined; updated_asset_ids: number[] | undefined; mutated: boolean }
    >();
    for (const rel of stateBeforeUpdate.releases) {
      const hasBadges = Boolean(rel.updated_asset_ids && rel.updated_asset_ids.length > 0);
      releaseFieldsBeforeUpdate.set(rel.id, {
        is_read: rel.is_read,
        updated_asset_ids: rel.updated_asset_ids ? [...rel.updated_asset_ids] : undefined,
        mutated: rel.is_read !== true || hasBadges,
      });
    }
    // 账号代次校验（Issue #611 审计修复）：请求发起前保存账号与代次，失败回滚
    // 用 isCurrentAccountSession 约束（C39）——切号后把旧账号的已读快照写入
    // 新账号会覆盖并污染新账号的已读状态；A→B→A 只有代次能识别。
    const startedAccountId = peekCurrentAccountId();
    const startedGeneration = getAccountSessionGeneration();
    let addedByAction = new Set<number>();
    let optimisticReadReleases = new Set<number>();
    // 跟踪请求期间是否发生过整体替换（如备份恢复/后端同步替换了 readReleases，
    // 即使新集合恰好包含旧 ID 也意味着本次乐观更新已失去所有权）。
    let ownershipLostByBulkReplace = false;
    let unsubscribeReadWatcher: (() => void) | null = null;
    const rollbackReadReleases = (current: Iterable<number>): Set<number> | null => {
      if (ownershipLostByBulkReplace) return null;
      const currentSet = new Set(Array.from(current));
      for (const id of optimisticReadReleases) {
        if (!currentSet.has(id)) return null;
      }
      // 回滚保留并发新增的已读记录，并补回乐观更新整体替换时被吞掉的历史已读
      const next = new Set(Array.from(currentSet).filter(id => !addedByAction.has(id)));
      for (const id of readReleasesBeforeUpdate) next.add(id);
      return next;
    };
    const rollbackReleases = <T extends { id: number; is_read?: boolean; updated_asset_ids?: number[] }>(
      currentReleases: T[],
    ): T[] => currentReleases.map((rel) => {
      const before = releaseFieldsBeforeUpdate.get(rel.id);
      if (!before || !before.mutated) return rel;
      // 按字段检查当前值是否仍归本次乐观写入所有：保留请求期间刷新的并发更新（如新的 updated_asset_ids）
      const restoreIsRead = before.is_read !== true && rel.is_read === true;
      const restoreUpdatedAssets = Boolean(before.updated_asset_ids && before.updated_asset_ids.length > 0)
        && Array.isArray(rel.updated_asset_ids)
        && rel.updated_asset_ids.length === 0;
      if (!restoreIsRead && !restoreUpdatedAssets) return rel;
      return {
        ...rel,
        ...(restoreIsRead ? { is_read: before.is_read } : {}),
        ...(restoreUpdatedAssets && before.updated_asset_ids !== undefined
          ? { updated_asset_ids: [...before.updated_asset_ids] }
          : {}),
      };
    });
    setIsMarkingAllRead(true);
    try {
      state.markAllReleasesAsRead();
      // 本次操作新增的已读 ID：失败回滚只撤销它们，保留等待期间由其他
      // 操作标为已读的记录（整体替换快照会吞掉那些独立更新）。
      addedByAction = new Set(
        Array.from(useAppStore.getState().readReleases).filter(id => !readReleasesBeforeUpdate.has(id)),
      );
      optimisticReadReleases = new Set(useAppStore.getState().readReleases);
      if (typeof useAppStore.subscribe === 'function') {
        unsubscribeReadWatcher = useAppStore.subscribe((nextState, prevState) => {
          // 忽略切号本身引起的工作区替换；但在发起账号活跃（含 A→B→A 切回后）期间，
          // 任何非单条增量的 readReleases 替换（如备份恢复）都使本次乐观更新失去所有权。
          if (nextState.user?.id !== prevState.user?.id) return;
          if (peekCurrentAccountId() !== startedAccountId) return;
          if (nextState.readReleases === prevState.readReleases) return;
          const isSingleIncrementalAdd = nextState.readReleases.size === prevState.readReleases.size + 1
            && Array.from(prevState.readReleases).every(id => nextState.readReleases.has(id));
          if (!isSingleIncrementalAdd) {
            ownershipLostByBulkReplace = true;
          }
        });
      }
      await backend.markAllReleasesAsRead();
      if (isCurrentAccountSession(startedAccountId, startedGeneration)) {
        toast(t('useReleaseTimelineActions.all-marked-as-read'), 'success');
      }
    } catch {
      if (isCurrentAccountSession(startedAccountId, startedGeneration)) {
        const current = useAppStore.getState();
        const rolledBack = rollbackReadReleases(current.readReleases);
        // 乐观更新的所有权已被更晚的恢复/备份替换：保留当前状态
        if (rolledBack) {
          useAppStore.setState({
            readReleases: rolledBack,
            releases: rollbackReleases(current.releases),
          });
        }
      } else if (startedAccountId) {
        // 会话已切换（C39）：switchAccountWorkspace 已把包含乐观更新（全部已读）
        // 的 live 工作区写入发起账号的归档快照，仅跳过 live 回滚会让服务端失败
        // 的已读状态留在该快照里。这里只把发起账号快照中的 readReleases 与 releases 回写，
        // 且仅当快照仍拥有本次乐观变更时执行——绝不创建/覆盖不存在的快照，也不触碰当前账号的工作区。
        if (peekCurrentAccountId() === startedAccountId) {
          // R2-C21（A→B→A）：发起账号已重新激活，切回时其归档快照被换入实时
          // 工作区，乐观更新现在位于实时集合——只修正实时集合与实时 releases，
          // B 的工作区与归档均不触碰。
          const current = useAppStore.getState();
          const rolledBack = rollbackReadReleases(current.readReleases);
          if (rolledBack) {
            useAppStore.setState({
              readReleases: rolledBack,
              releases: rollbackReleases(current.releases),
            });
          }
        } else {
          useAppStore.setState((current) => {
            const parked = current.accountWorkspaces?.[startedAccountId];
            if (!parked) return current;
            const rolledBack = rollbackReadReleases(parked.readReleases);
            if (!rolledBack) return current;
            return {
              accountWorkspaces: {
                ...current.accountWorkspaces,
                [startedAccountId]: {
                  ...parked,
                  readReleases: [...rolledBack],
                  releases: rollbackReleases(parked.releases),
                },
              },
            };
          });
        }
      }
      if (isCurrentAccountSession(startedAccountId, startedGeneration)) {
        toast(t('useReleaseTimelineActions.failed-to-mark-all-as-read'), 'error');
      }
    } finally {
      unsubscribeReadWatcher?.();
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
    // 审计修复（C40）：确认前记录会话代次，确认后守卫与失败回滚守卫都用
    // isCurrentAccountSession(accountIdBeforeConfirm, generationBeforeConfirm)。
    const accountIdBeforeConfirm = peekCurrentAccountId();
    const generationBeforeConfirm = getAccountSessionGeneration();
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

    // 账号代次校验（Issue #611 / C40）：确认弹窗等待期间可能已切号（含 A→B→A），
    // 守卫与失败回滚都用会话代次一并校验，回滚快照绝不跨账号污染。
    if (!isCurrentAccountSession(accountIdBeforeConfirm, generationBeforeConfirm)) {
      return;
    }
    if (sourcesToRemove.includes(STARRED_RELEASE_SOURCE_ID) && starredRepo) {
      state.updateRepository({ ...starredRepo, subscribed_to_releases: false });
      state.batchUnsubscribeReleases([starredRepo.id]);
    }
    // 在实际删除前捕获当前自定义来源条目，避免从确认框打开前的旧快照恢复过时元数据
    const preDeleteSourceSettings = useAppStore.getState().releaseSourceSettings;
    const removedWatchCustomSnapshot = sourcesToRemove.includes(WATCH_CUSTOM_RELEASE_SOURCE_ID)
      ? preDeleteSourceSettings.watchCustomReleaseRepos.find(item => normalizeRepoKey(item.full_name) === repoKey)
      : undefined;
    const removedCustomSnapshot = sourcesToRemove.includes(CUSTOM_RELEASE_SOURCE_ID)
      ? preDeleteSourceSettings.customReleaseRepos.find(item => normalizeRepoKey(item.full_name) === repoKey)
      : undefined;
    if (sourcesToRemove.includes(WATCH_CUSTOM_RELEASE_SOURCE_ID)) state.removeReleaseSourceRepository(WATCH_CUSTOM_RELEASE_SOURCE_ID, releaseRepo.full_name);
    if (sourcesToRemove.includes(CUSTOM_RELEASE_SOURCE_ID)) state.removeReleaseSourceRepository(CUSTOM_RELEASE_SOURCE_ID, releaseRepo.full_name);

    const stillActive = resolveReleaseSources(useAppStore.getState()).entries.some(entry => normalizeRepoKey(entry.repository.full_name) === repoKey);
    // 在执行删除前捕获实际将被删除的 release，确保确认框打开期间新增的记录也能回滚恢复
    const removedReleasesSnapshot = !stillActive
      ? useAppStore.getState().releases.filter(item => normalizeRepoKey(item.repository.full_name) === repoKey)
      : [];
    // 审计修复：removeReleasesByRepoFullName 会同时删除被移除 Release 的已读
    // 记录与被删除仓库的展开状态——回滚前记录两者，回滚时只把仍缺失的 ID
    // 写回对应集合（与现有 Release 去重逻辑一致，不重复、不覆盖已有状态）。
    const removedReleaseIds = new Set(removedReleasesSnapshot.map(item => item.id));
    const removedReadReleaseIds = new Set(
      Array.from(useAppStore.getState().readReleases).filter(id => removedReleaseIds.has(id)),
    );
    const removedExpandedRepoIds = new Set(
      removedReleasesSnapshot.map(item => item.repository.id),
    );
    if (!stillActive) state.removeReleasesByRepoFullName(releaseRepo.full_name);
    try {
      await forceSyncToBackend({ reportFailures: true });
    } catch (error) {
      console.error('Failed to unsubscribe release:', error);
      // 审计修复（C41 / R2-C5）：按分片实际提交结果分别决定是否回滚 starred 与 custom 来源。
      // 若 repositories 已提交而仅 settings 失败，保留已确认的 starred 退订，仅恢复未确认的 custom 来源；
      // 若尚未尝试任何写入或失败清单未知，才回滚整个本地操作（含无来源仓库被删除的历史 Release）。
      const failedShards = (error as { failedShards?: string[] }).failedShards;
      const pushAttempted = (error as { pushAttempted?: boolean }).pushAttempted !== false;
      const rollbackAll = !pushAttempted || !Array.isArray(failedShards) || failedShards.length === 0;
      const shouldRollbackStarred = Boolean(starredRepo && sourcesToRemove.includes(STARRED_RELEASE_SOURCE_ID))
        && (rollbackAll || failedShards.includes('repositories'));
      const shouldRollbackSettings = (
        sourcesToRemove.includes(WATCH_CUSTOM_RELEASE_SOURCE_ID)
        || sourcesToRemove.includes(CUSTOM_RELEASE_SOURCE_ID)
      ) && (rollbackAll || failedShards.includes('settings'));
      const shouldRollbackRemovedReleases = !stillActive
        && removedReleasesSnapshot.length > 0
        && (rollbackAll || shouldRollbackStarred || shouldRollbackSettings);
      // 同步等待期间可能已切号（含 A→B→A）：发起账号的回滚绝不写入新账号工作区
      if (!isCurrentAccountSession(accountIdBeforeConfirm, generationBeforeConfirm)) {
        return;
      }
      if (shouldRollbackStarred || shouldRollbackSettings || shouldRollbackRemovedReleases) {
        useAppStore.setState((current) => {
          const next: {
            repositories?: typeof current.repositories;
            searchResults?: typeof current.searchResults;
            releaseSubscriptions?: typeof current.releaseSubscriptions;
            releaseSourceSettings?: typeof current.releaseSourceSettings;
            releases?: typeof current.releases;
            readReleases?: typeof current.readReleases;
            releaseExpandedRepositories?: typeof current.releaseExpandedRepositories;
          } = {};
          // 仅撤销未确认提交的变更 1/3：恢复 starredRepo 的订阅标记与订阅集合
          if (shouldRollbackStarred && starredRepo) {
            const restoreRepo = (repo: typeof starredRepo) => (
              repo.id === starredRepo.id
                ? { ...repo, subscribed_to_releases: starredRepo.subscribed_to_releases }
                : repo
            );
            next.repositories = current.repositories.map(restoreRepo);
            next.searchResults = current.searchResults.map(restoreRepo);
            const releaseSubscriptions = new Set(current.releaseSubscriptions);
            if (stateBeforeConfirm.releaseSubscriptions.has(starredRepo.id)) {
              releaseSubscriptions.add(starredRepo.id);
            } else {
              releaseSubscriptions.delete(starredRepo.id);
            }
            next.releaseSubscriptions = releaseSubscriptions;
          }
          // 2/3：恢复未确认提交的 custom / watchCustom 来源条目（使用删除前最新快照）
          if (shouldRollbackSettings && removedWatchCustomSnapshot) {
            const stillRemoved = !current.releaseSourceSettings.watchCustomReleaseRepos
              .some(item => normalizeRepoKey(item.full_name) === repoKey);
            if (stillRemoved) {
              next.releaseSourceSettings = {
                ...current.releaseSourceSettings,
                watchCustomReleaseRepos: [...current.releaseSourceSettings.watchCustomReleaseRepos, removedWatchCustomSnapshot],
              };
            }
          }
          if (shouldRollbackSettings && removedCustomSnapshot) {
            const stillRemoved = !current.releaseSourceSettings.customReleaseRepos
              .some(item => normalizeRepoKey(item.full_name) === repoKey);
            if (stillRemoved) {
              // R2-C20：基于已累积的 next.releaseSourceSettings 合并——同一仓库
              // 同时来自 watchCustom 与 custom 两个来源时，先前恢复的
              // watchCustomReleaseRepos 不得被本分支覆盖。
              const baseSettings = next.releaseSourceSettings ?? current.releaseSourceSettings;
              next.releaseSourceSettings = {
                ...baseSettings,
                customReleaseRepos: [...baseSettings.customReleaseRepos, removedCustomSnapshot],
              };
            }
          }
          // 3/3：恢复本次因来源全部退出被实际删除的 release 记录（按 ID 去重）
          if (shouldRollbackRemovedReleases) {
            const existingIds = new Set(current.releases.map(item => item.id));
            const restoredReleases = removedReleasesSnapshot.filter(item => !existingIds.has(item.id));
            if (restoredReleases.length > 0) {
              next.releases = [...current.releases, ...restoredReleases];
            }
            // 审计修复：回滚同时恢复被删除 Release 的已读记录与被删除仓库的
            // 展开状态——只写回当前仍缺失的 ID（等待期间其他操作可能已独立
            // 写入同名记录），与 releases 的去重逻辑一致。
            const missingReadIds = Array.from(removedReadReleaseIds)
              .filter(id => !current.readReleases.has(id));
            if (missingReadIds.length > 0) {
              next.readReleases = new Set([...current.readReleases, ...missingReadIds]);
            }
            const missingExpandedRepoIds = Array.from(removedExpandedRepoIds)
              .filter(id => !current.releaseExpandedRepositories.has(id));
            if (missingExpandedRepoIds.length > 0) {
              next.releaseExpandedRepositories = new Set([...current.releaseExpandedRepositories, ...missingExpandedRepoIds]);
            }
          }
          return next;
        });
      }
      toast(t('useReleaseTimelineActions.failed-to-unsubscribe-please-check-backend-conne'), 'error');
      return;
    }
    // 审计修复：forceSyncToBackend 等待期间可能切号——B 不应看到 A 的退订
    // 成功提示，成功路径与失败/回滚路径一样复用发起会话校验。
    if (isCurrentAccountSession(accountIdBeforeConfirm, generationBeforeConfirm)) {
      toast(t('useReleaseTimelineActions.unsubscribed-from-repository-releases'), 'success');
    }
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
