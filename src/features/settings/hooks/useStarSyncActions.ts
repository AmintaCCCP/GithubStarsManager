import { useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../../store/useAppStore';
import { useDialog } from '../../../hooks/useDialog';
import { createGitHubListsApiService } from '../../../services/githubApiFactory';

interface UseStarSyncActionsOptions {
  t: (zh: string, en: string) => string;
}

export interface StarSyncActions {
  pushCategoriesToLists: () => Promise<void>;
}

/** Encapsulates the confirmed GitHub Lists synchronization workflow. */
export const useStarSyncActions = ({ t }: UseStarSyncActionsOptions): StarSyncActions => {
  const { githubToken, pushCategoriesToLists, setListsPushError } = useAppStore(useShallow((state) => ({
    githubToken: state.githubToken,
    pushCategoriesToLists: state.pushCategoriesToLists,
    setListsPushError: state.setListsPushError,
  })));
  const { confirm } = useDialog();

  const push = useCallback(async () => {
    if (!githubToken) {
      setListsPushError(t('未登录 GitHub，请先连接', 'Not connected to GitHub yet'));
      return;
    }
    const confirmed = await confirm(
      t('同步仓库分类到 GitHub list', 'Push categories to GitHub lists'),
      t(
        '将每个本地分类（含默认与自定义分类）写回为同名 GitHub List：\n\n' +
        '· 同名 list 将覆盖其成员（未匹配分类的仓库会从该 list 移除）\n' +
        '· 无同名 list 则新建（默认私有）\n' +
        '· 仓库将按其匹配的分类加入对应 list\n' +
        '· 不属于本地分类的其他 list 成员关系会被保留\n\n确定继续吗？',
        'Each local category (default & custom) will be written to a GitHub List of the same name:\n\n' +
        '· Existing same-name lists will be overwritten (repos no longer matching are removed)\n' +
        '· Missing lists will be created (private by default)\n' +
        '· Repos are added to the lists matching their category\n' +
        '· Memberships in lists not managed locally are preserved\n\nContinue?',
      ),
      { type: 'warning' },
    );
    if (!confirmed) return;
    await pushCategoriesToLists(createGitHubListsApiService(githubToken));
  }, [confirm, githubToken, pushCategoriesToLists, setListsPushError, t]);

  return { pushCategoriesToLists: push };
};
