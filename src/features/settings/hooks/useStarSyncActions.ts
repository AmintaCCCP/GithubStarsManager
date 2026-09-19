
import { TranslateFn } from '../../../i18n/useT';
import { useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../../store/useAppStore';
import { useDialog } from '../../../hooks/useDialog';
import { createGitHubListsApiService } from '../../../services/githubApiFactory';

interface UseStarSyncActionsOptions {
  t: TranslateFn;
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
      setListsPushError(t('useStarSyncActions.not-connected-to-github-yet'));
      return;
    }
    const confirmed = await confirm(
      t('useStarSyncActions.push-categories-to-github-lists'),
      t('useStarSyncActions.push-confirm-body'),
      { type: 'warning' },
    );
    if (!confirmed) return;
    await pushCategoriesToLists(createGitHubListsApiService(githubToken));
  }, [confirm, githubToken, pushCategoriesToLists, setListsPushError, t]);

  return { pushCategoriesToLists: push };
};
