
import { TranslateFn } from '../../../i18n/useT';
import { useCallback, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { GitHubApiService, GITHUB_TOKEN_INVALID_ERROR } from '../../../services/githubApi';
import { backend } from '../../../services/backendAdapter';
import { useAppStore } from '../../../store/useAppStore';
import { useDialog } from '../../../hooks/useDialog';

interface UseGitHubTokenActionsOptions {
  t: TranslateFn;
}

export interface GitHubTokenActions {
  tokenInput: string;
  isSaving: boolean;
  setTokenInput: (value: string) => void;
  updateToken: () => Promise<void>;
}

export const useGitHubTokenActions = ({ t }: UseGitHubTokenActionsOptions): GitHubTokenActions => {
  const { user, setUser, setGitHubToken } = useAppStore(useShallow((state) => ({
    user: state.user,
    setUser: state.setUser,
    setGitHubToken: state.setGitHubToken,
  })));
  const { toast } = useDialog();
  const [tokenInput, setTokenInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const updateToken = useCallback(async () => {
    const token = tokenInput.trim();
    if (!token) {
      toast(t('useGitHubTokenActions.please-enter-a-valid-github-access-token'), 'error');
      return;
    }

    setIsSaving(true);
    try {
      const nextUser = await new GitHubApiService(token).getCurrentUser();
      if (user && nextUser.id !== user.id) {
        toast(
          t('useGitHubTokenActions.this-token-belongs-to-v1-but-you-are-signed-in-a', { v1: nextUser.login, v2: user.login }),
          'error',
        );
        return;
      }

      // When a backend is available, sync the token there FIRST. Committing
      // local credentials before the backend write would leave them out of
      // sync if the backend call fails (the local session uses the new token
      // while the backend still stores the old one).
      if (backend.isAvailable) {
        try {
          await backend.syncSettings({ github_token: token });
        } catch (error) {
          console.warn('Failed to save GitHub token to backend:', error);
          toast(
            t('useGitHubTokenActions.failed-to-save-the-new-token-to-the-backend-loca'),
            'error',
          );
          setTokenInput('');
          return;
        }
      }
      setGitHubToken(token);
      setUser(nextUser);
      setTokenInput('');
      toast(t('useGitHubTokenActions.github-token-updated'), 'success');
    } catch (error) {
      const message = error instanceof Error && error.message === GITHUB_TOKEN_INVALID_ERROR
        ? t('useGitHubTokenActions.github-token-has-expired-or-is-invalid')
        : (error instanceof Error ? error.message : t('useGitHubTokenActions.update-failed-please-try-again'));
      toast(message, 'error');
    } finally {
      setIsSaving(false);
    }
  }, [setGitHubToken, setUser, t, toast, tokenInput, user]);

  return { tokenInput, isSaving, setTokenInput, updateToken };
};
