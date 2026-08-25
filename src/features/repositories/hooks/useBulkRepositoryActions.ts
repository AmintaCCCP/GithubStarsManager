import { useCallback } from 'react';
import { shallow } from 'zustand/shallow';
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

const formatFailures = (language: 'zh' | 'en', failedRepositories: string[]) => {
  if (failedRepositories.length === 0) return '';
  return language === 'zh'
    ? `\n\n失败 (${failedRepositories.length} 个):\n${failedRepositories.join('\n')}`
    : `\n\nFailed (${failedRepositories.length}):\n${failedRepositories.join('\n')}`;
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
  } = useAppStore(
    useCallback((state) => ({
      githubToken: state.githubToken,
      language: state.language,
      updateRepository: state.updateRepository,
      deleteRepository: state.deleteRepository,
      toggleReleaseSubscription: state.toggleReleaseSubscription,
      batchUnsubscribeReleases: state.batchUnsubscribeReleases,
      releaseSubscriptions: state.releaseSubscriptions,
    }), []),
    shallow,
  );
  const { toast, confirm } = useDialog();
  const t = useCallback((zh: string, en: string) => language === 'zh' ? zh : en, [language]);

  const unstar = useCallback(async (repositories: Repository[]) => {
    if (!githubToken) {
      toast(language === 'zh' ? 'GitHub token 未找到，请重新登录。' : 'GitHub token not found. Please login again.', 'error');
      return false;
    }

    const confirmed = await confirm(
      t('取消Star确认', 'Unstar Confirmation'),
      language === 'zh'
        ? `确定要取消 ${repositories.length} 个仓库的 Star 吗？此操作不可撤销！`
        : `Are you sure you want to unstar ${repositories.length} repositories? This action cannot be undone!`,
      { type: 'danger', confirmText: t('取消Star', 'Unstar') },
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
      language === 'zh'
        ? `成功取消 ${successIds.length} 个仓库的 Star${failures}`
        : `Successfully unstarred ${successIds.length} repositories${failures}`,
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
      language === 'zh'
        ? `成功还原 ${successCount} 个仓库${failures}`
        : `Successfully restored ${successCount} repositories${failures}`,
      failedRepositories.length > 0 ? 'error' : 'success',
    );
    return true;
  }, [language, toast, updateRepository]);

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
      language === 'zh'
        ? `成功为 ${successCount} 个仓库设置分类：${categoryName}${failures}`
        : `Successfully categorized ${successCount} repositories as: ${categoryName}${failures}`,
      failedRepositories.length > 0 ? 'error' : 'success',
    );
    return true;
  }, [allCategories, language, toast, updateRepository]);

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
      language === 'zh'
        ? `成功订阅 ${successCount} 个仓库的版本发布`
        : `Successfully subscribed to ${successCount} repositories releases`,
      'success',
    );
    return true;
  }, [language, releaseSubscriptions, toast, toggleReleaseSubscription, updateRepository]);

  const unsubscribe = useCallback(async (repositories: Repository[]) => {
    const subscribedRepositories = repositories.filter((repository) => releaseSubscriptions.has(repository.id));
    if (subscribedRepositories.length === 0) {
      toast(t('选中的仓库中没有被订阅的', 'None of the selected repositories are subscribed'), 'info');
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
      language === 'zh'
        ? `成功取消 ${successCount} 个仓库的版本发布订阅${failures}`
        : `Successfully unsubscribed ${successCount} repositories from releases${failures}`,
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
      ? (language === 'zh' ? `\n\n跳过 ${skippedCount} 个没有自定义分类的仓库` : `\n\nSkipped ${skippedCount} repositories without custom category`)
      : '';
    const failures = formatFailures(language, failedRepositories);
    toast(
      language === 'zh'
        ? `成功锁定 ${successCount} 个仓库的分类${failures}${skipped}`
        : `Successfully locked categories for ${successCount} repositories${failures}${skipped}`,
      failedRepositories.length > 0 ? 'error' : 'success',
    );
    return true;
  }, [language, toast, updateRepository]);

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
      language === 'zh'
        ? `成功解锁 ${successCount} 个仓库的分类${failures}`
        : `Successfully unlocked categories for ${successCount} repositories${failures}`,
      failedRepositories.length > 0 ? 'error' : 'success',
    );
    return true;
  }, [language, toast, updateRepository]);

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
