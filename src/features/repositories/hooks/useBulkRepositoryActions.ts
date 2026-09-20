



import { makeT, useT } from '../../../i18n/useT';
import type { AppLanguage } from '../../../i18n/languages';
import { useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Category, Repository } from '../../../types';
import { useAppStore } from '../../../store/useAppStore';
import { useDialog } from '../../../hooks/useDialog';
import { forceSyncToBackend } from '../../../services/autoSync';
import { GitHubApiService } from '../../../services/githubApi';
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

    const githubApi = new GitHubApiService(githubToken);
    const successIds: number[] = [];
    const failedRepositories: string[] = [];

    for (const repository of repositories) {
      try {
        const [owner, name] = repository.full_name.split('/');
        await githubApi.unstarRepository(owner, name);
        successIds.push(repository.id);
      } catch (error) {
        console.error(`Failed to unstar ${repository.full_name}:`, error);
        failedRepositories.push(repository.full_name);
      }
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
