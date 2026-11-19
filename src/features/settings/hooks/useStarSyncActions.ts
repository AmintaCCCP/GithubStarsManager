
import { useT } from '../../../i18n/useT';
import { useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../../store/useAppStore';
import {
  accountIdKey,
  getAccountSessionGeneration,
  isCurrentAccountSession,
} from '../../../store/helpers/accountWorkspace';
import { useDialog } from '../../../hooks/useDialog';
import { createGitHubListsApiService } from '../../../services/githubApiFactory';

export interface StarSyncActions {
  pushCategoriesToLists: (categoryIds?: string[]) => Promise<void>;
}

/** Encapsulates the confirmed GitHub Lists synchronization workflow. */
export const useStarSyncActions = (): StarSyncActions => {
  // 本 hook 的文案都在 settings 命名空间；面板传入的 t 绑定 app 命名空间，
  // 查不到 key 会原样渲染（历史 bug），故自行绑定 settings。
  const t = useT('settings');
  const { githubToken, user, pushCategoriesToLists, setListsPushError } = useAppStore(useShallow((state) => ({
    githubToken: state.githubToken,
    user: state.user,
    pushCategoriesToLists: state.pushCategoriesToLists,
    setListsPushError: state.setListsPushError,
  })));
  const { confirm } = useDialog();

  const push = useCallback(async (categoryIds?: string[]) => {
    // 从同一次 store 快照读取 token 与账号分区，防止确认弹窗期间切号导致 token 与代理分区错配
    const snapshot = typeof useAppStore.getState === 'function'
      ? useAppStore.getState()
      : { githubToken, user };
    const snapshotToken = snapshot.githubToken;
    const snapshotAccountId = accountIdKey(snapshot.user);
    const snapshotGeneration = getAccountSessionGeneration();

    if (!snapshotToken) {
      setListsPushError(t('useStarSyncActions.not-connected-to-github-yet'));
      return;
    }
    const confirmed = await confirm(
      t('useStarSyncActions.push-categories-to-github-lists'),
      categoryIds
        ? t('useStarSyncActions.push-confirm-body-selected', { count: categoryIds.length })
        : t('useStarSyncActions.push-confirm-body'),
      { type: 'warning' },
    );
    if (!confirmed) return;
    if (typeof useAppStore.getState === 'function' && !isCurrentAccountSession(snapshotAccountId, snapshotGeneration)) {
      return;
    }
    await pushCategoriesToLists(
      createGitHubListsApiService(snapshotToken, { accountId: snapshotAccountId }),
      categoryIds,
    );
  }, [confirm, githubToken, pushCategoriesToLists, setListsPushError, t, user]);

  return { pushCategoriesToLists: push };
};
