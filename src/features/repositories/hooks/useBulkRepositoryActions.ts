



import { makeT, useT } from '../../../i18n/useT';
import type { AppLanguage } from '../../../i18n/languages';
import { useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Category, Repository } from '../../../types';
import { useAppStore } from '../../../store/useAppStore';
import {
  getAccountSessionGeneration,
  isCurrentAccount,
  isCurrentAccountSession,
  peekCurrentAccountId,
} from '../../../store/helpers/accountWorkspace';
import { useDialog } from '../../../hooks/useDialog';
import { forceSyncToBackend, markPendingAccountSync, withAccountSwitchGuardSync } from '../../../services/autoSync';
import { backend } from '../../../services/backendAdapter';
import { createGitHubApiService } from '../../../services/githubApiFactory';
import { computeCustomCategory, getAICategory, getDefaultCategory } from '../../../utils/categoryUtils';
import {
  applyCategoryAssignment,
  lockRepositoryCategory,
  restoreRepositoryFields,
  setReleaseSubscriptionMarker,
  unlockRepositoryCategory,
} from '../application/repositoryPatches';

export interface RepositoryRestoreConfig {
  description: { enabled: boolean; target: 'original' | 'ai' };
  tags: { enabled: boolean; target: 'original' | 'ai' };
  category: { enabled: boolean; target: 'original' | 'ai' };
}

interface UseBulkRepositoryActionsOptions {
  allCategories: Category[];
}

export interface BulkRepositoryActions {
  unstar: (repositories: Repository[]) => Promise<boolean>;
  restore: (repositories: Repository[], config: RepositoryRestoreConfig) => Promise<boolean>;
  categorize: (repositories: Repository[], categoryName: string) => Promise<boolean>;
  subscribe: (repositories: Repository[]) => Promise<boolean>;
  unsubscribe: (repositories: Repository[]) => Promise<boolean>;
  lockCategory: (repositories: Repository[]) => Promise<boolean>;
  unlockCategory: (repositories: Repository[]) => Promise<boolean>;
}

const formatFailures = (language: AppLanguage, failedRepositories: string[]) => {
  const t = makeT(language, 'repositories');
  if (failedRepositories.length === 0) return '';
  return t('useBulkRepositoryActions.failed-v1-v2', { v1: failedRepositories.length, v2: failedRepositories.join('\n') });
};

/**
 * Encapsulates RepositoryList's non-AI bulk workflows. Every completed logical
 * batch owns exactly one backend synchronization call and uses the repository
 * patch module for local state transitions.
 */
export const useBulkRepositoryActions = ({
  allCategories,
}: UseBulkRepositoryActionsOptions): BulkRepositoryActions => {
  const {
    githubToken,
    language,
    updateRepository,
    deleteRepository,
    toggleReleaseSubscription,
    batchUnsubscribeReleases,
    releaseSubscriptions,
  } = useAppStore(useShallow((state) => ({
    githubToken: state.githubToken,
    language: state.language,
    updateRepository: state.updateRepository,
    deleteRepository: state.deleteRepository,
    toggleReleaseSubscription: state.toggleReleaseSubscription,
    batchUnsubscribeReleases: state.batchUnsubscribeReleases,
    releaseSubscriptions: state.releaseSubscriptions,
  })));

  const { toast, confirm } = useDialog();
  const t = useT('repositories');

  const unstar = useCallback(async (repositories: Repository[]) => {
    // 账号代次校验（Issue #611 审计修复）：操作所属账号必须在任何 await（含
    // 确认框）之前保存；确认返回后、每次远端操作前、删除本地仓库前都用保存值
    // 复核——两次即时读取（peekCurrentAccountId + isCurrentAccount 内部再读）
    // 比较的都是当前账号，识别不出等待期间发生的切号。
    const startedAccountId = peekCurrentAccountId();
    // A→B→A：账号 ID 与确认前相同，只有会话代次能识别这次切号。
    const startedGeneration = getAccountSessionGeneration();
    // 审计修复（C26）：操作发起时保存目标后端地址——完成时即使后端已切换，
    // 待补推标记也登记到发起时的 (账号, 后端) 复合键，绝不推到切换后的后端。
    const startedBackendUrl = backend.backendUrl ?? '';
    if (!githubToken) {
      toast(t('useBulkRepositoryActions.github-token-not-found-please-login-again'), 'error');
      return false;
    }

    const confirmed = await confirm(
      t('useBulkRepositoryActions.unstar-confirmation'),
      t('useBulkRepositoryActions.are-you-sure-you-want-to-unstar-v1-repositories', { v1: repositories.length }),
      { type: 'danger', confirmText: t('useBulkRepositoryActions.unstar') },
    );
    if (!confirmed) return false;
    if (!isCurrentAccountSession(startedAccountId, startedGeneration)) {
      return false;
    }

    const githubApi = createGitHubApiService(githubToken);
    const successIds: number[] = [];
    const failedRepositories: string[] = [];

    for (const repository of repositories) {
      // 切号后不再发起新的远端操作（已完成的远端取消星标不可撤销）
      if (!isCurrentAccountSession(startedAccountId, startedGeneration)) break;
      try {
        const [owner, name] = repository.full_name.split('/');
        await githubApi.unstarRepository(owner, name);
        successIds.push(repository.id);
      } catch (error) {
        console.error(`Failed to unstar ${repository.full_name}:`, error);
        failedRepositories.push(repository.full_name);
      }
    }

    // 等待 GitHub API 期间已切号：远端取消星标按发起账号完成（保留），
    // 审计修复（C25）：按结果归属处理——发起账号已重新激活时在其当前实时
    // 工作区对账（列表与 release 归档一致），仍停放时更新其归档快照；
    // 两条路径都只作用于发起账号自己的数据，绝不影响其他账号中 ID 相同的
    // 仓库（代次不匹配后也不再发起新的远端请求，循环已在会话失效时 break）。
    if (!isCurrentAccountSession(startedAccountId, startedGeneration)) {
      if (startedAccountId && successIds.length > 0 && typeof useAppStore.setState === 'function') {
        const unstarredSet = new Set(successIds);
        if (isCurrentAccount(startedAccountId)) {
          // 已重新激活：在其当前实时工作区应用删除
          withAccountSwitchGuardSync(() => {
            useAppStore.setState((state) => ({
              repositories: state.repositories.filter((r) => !unstarredSet.has(r.id)),
              releases: state.releases.filter((rel) => !unstarredSet.has(rel.repository.id)),
            }));
          });
        }
        withAccountSwitchGuardSync(() => {
          useAppStore.setState((state) => {
            const parked = state.accountWorkspaces[startedAccountId];
            if (!parked) return state;
            // 归档快照同样应用删除，保持列表/归档一致（仅限发起账号条目）
            return {
              accountWorkspaces: {
                ...state.accountWorkspaces,
                [startedAccountId]: {
                  ...parked,
                  repositories: parked.repositories.filter((r) => !unstarredSet.has(r.id)),
                  releases: parked.releases.filter((rel) => !unstarredSet.has(rel.repository.id)),
                },
              },
            };
          });
        });
        // 审计修复（C26）：登记到发起时的 (账号, 后端)，切回后先补推删除再拉取。
        markPendingAccountSync(startedAccountId, startedBackendUrl);
      }
      return false;
    }
    for (const repositoryId of successIds) {
      deleteRepository(repositoryId);
    }

    await forceSyncToBackend();
    const failures = formatFailures(language, failedRepositories);
    toast(
      t('useBulkRepositoryActions.successfully-unstarred-v1-repositories-failures', { v1: successIds.length, failures: failures }),
      failedRepositories.length > 0 ? 'error' : 'success',
    );
    return true;
  }, [confirm, deleteRepository, githubToken, language, t, toast]);

  const restore = useCallback(async (repositories: Repository[], config: RepositoryRestoreConfig) => {
    if (repositories.length === 0) return false;

    // 账号代次校验（Issue #611）：本地写入为同步执行，入口保存并复核一次快照
    const startedAccountId = peekCurrentAccountId();
    if (!isCurrentAccount(startedAccountId)) return false;
    let successCount = 0;
    const failedRepositories: string[] = [];
    for (const repository of repositories) {
      try {
        const updatedRepository = restoreRepositoryFields(repository, config, new Date().toISOString());
        if (updatedRepository) {
          updateRepository(updatedRepository);
        }
        successCount += 1;
      } catch (error) {
        console.error(`Failed to restore ${repository.full_name}:`, error);
        failedRepositories.push(repository.full_name);
      }
    }

    await forceSyncToBackend();
    const failures = formatFailures(language, failedRepositories);
    toast(
      t('useBulkRepositoryActions.successfully-restored-successcount-repositories', { successCount: successCount, failures: failures }),
      failedRepositories.length > 0 ? 'error' : 'success',
    );
    return true;
  }, [language, toast, updateRepository, t]);

  const categorize = useCallback(async (repositories: Repository[], categoryName: string) => {
    // 账号代次校验（Issue #611）：入口保存并复核一次快照
    const startedAccountId = peekCurrentAccountId();
    if (!isCurrentAccount(startedAccountId)) return false;
    const failedRepositories: string[] = [];
    for (const repository of repositories) {
      try {
        const aiCategory = getAICategory(repository, allCategories);
        const defaultCategory = getDefaultCategory(repository, allCategories);
        const customCategory = computeCustomCategory(categoryName, aiCategory, defaultCategory);
        updateRepository(applyCategoryAssignment(repository, customCategory, new Date().toISOString()));
      } catch (error) {
        console.error(`Failed to categorize ${repository.full_name}:`, error);
        failedRepositories.push(repository.full_name);
      }
    }

    await forceSyncToBackend();
    const successCount = repositories.length - failedRepositories.length;
    const failures = formatFailures(language, failedRepositories);
    toast(
      t('useBulkRepositoryActions.successfully-categorized-successcount-repositori', { successCount: successCount, categoryName: categoryName, failures: failures }),
      failedRepositories.length > 0 ? 'error' : 'success',
    );
    return true;
  }, [allCategories, language, toast, updateRepository, t]);

  const subscribe = useCallback(async (repositories: Repository[]) => {
    // 账号代次校验（Issue #611）：入口保存并复核一次快照
    const startedAccountId = peekCurrentAccountId();
    if (!isCurrentAccount(startedAccountId)) return false;
    let successCount = 0;
    for (const repository of repositories) {
      try {
        updateRepository(setReleaseSubscriptionMarker(repository, true));
        if (!releaseSubscriptions.has(repository.id)) {
          toggleReleaseSubscription(repository.id);
        }
        successCount += 1;
      } catch (error) {
        console.error(`Failed to subscribe ${repository.full_name}:`, error);
      }
    }

    await forceSyncToBackend();
    toast(
      t('useBulkRepositoryActions.successfully-subscribed-to-successcount-reposito', { successCount: successCount }),
      'success',
    );
    return true;
  }, [releaseSubscriptions, toast, toggleReleaseSubscription, updateRepository, t]);

  const unsubscribe = useCallback(async (repositories: Repository[]) => {
    const subscribedRepositories = repositories.filter((repository) => releaseSubscriptions.has(repository.id));
    if (subscribedRepositories.length === 0) {
      toast(t('useBulkRepositoryActions.none-of-the-selected-repositories-are-subscribed'), 'info');
      return false;
    }

    // 账号代次校验（Issue #611）：入口保存并复核一次快照
    const startedAccountId = peekCurrentAccountId();
    if (!isCurrentAccount(startedAccountId)) return false;
    batchUnsubscribeReleases(subscribedRepositories.map((repository) => repository.id));
    const failedRepositories: string[] = [];
    for (const repository of subscribedRepositories) {
      try {
        updateRepository(setReleaseSubscriptionMarker(repository, false));
      } catch (error) {
        console.error(`Failed to update repository ${repository.full_name}:`, error);
        failedRepositories.push(repository.full_name);
      }
    }

    await forceSyncToBackend();
    const successCount = subscribedRepositories.length - failedRepositories.length;
    const failures = formatFailures(language, failedRepositories);
    toast(
      t('useBulkRepositoryActions.successfully-unsubscribed-successcount-repositor', { successCount: successCount, failures: failures }),
      failedRepositories.length > 0 ? 'error' : 'success',
    );
    return true;
  }, [batchUnsubscribeReleases, language, releaseSubscriptions, t, toast, updateRepository]);

  const lockCategory = useCallback(async (repositories: Repository[]) => {
    // 账号代次校验（Issue #611）：入口保存并复核一次快照
    const startedAccountId = peekCurrentAccountId();
    if (!isCurrentAccount(startedAccountId)) return false;
    let successCount = 0;
    let skippedCount = 0;
    const failedRepositories: string[] = [];
    for (const repository of repositories) {
      try {
        const updatedRepository = lockRepositoryCategory(repository, new Date().toISOString());
        if (updatedRepository) {
          updateRepository(updatedRepository);
          successCount += 1;
        } else {
          skippedCount += 1;
        }
      } catch (error) {
        console.error(`Failed to lock category for ${repository.full_name}:`, error);
        failedRepositories.push(repository.full_name);
      }
    }

    await forceSyncToBackend();
    const skipped = skippedCount > 0
      ? (t('useBulkRepositoryActions.skipped-skippedcount-repositories-without-custom', { skippedCount: skippedCount }))
      : '';
    const failures = formatFailures(language, failedRepositories);
    toast(
      t('useBulkRepositoryActions.successfully-locked-categories-for-successcount', { successCount: successCount, failures: failures, skipped: skipped }),
      failedRepositories.length > 0 ? 'error' : 'success',
    );
    return true;
  }, [language, toast, updateRepository, t]);

  const unlockCategory = useCallback(async (repositories: Repository[]) => {
    // 账号代次校验（Issue #611）：入口保存并复核一次快照
    const startedAccountId = peekCurrentAccountId();
    if (!isCurrentAccount(startedAccountId)) return false;
    let successCount = 0;
    const failedRepositories: string[] = [];
    for (const repository of repositories) {
      try {
        updateRepository(unlockRepositoryCategory(repository, new Date().toISOString()));
        successCount += 1;
      } catch (error) {
        console.error(`Failed to unlock category for ${repository.full_name}:`, error);
        failedRepositories.push(repository.full_name);
      }
    }

    await forceSyncToBackend();
    const failures = formatFailures(language, failedRepositories);
    toast(
      t('useBulkRepositoryActions.successfully-unlocked-categories-for-successcoun', { successCount: successCount, failures: failures }),
      failedRepositories.length > 0 ? 'error' : 'success',
    );
    return true;
  }, [language, toast, updateRepository, t]);

  return {
    unstar,
    restore,
    categorize,
    subscribe,
    unsubscribe,
    lockCategory,
    unlockCategory,
  };
};
