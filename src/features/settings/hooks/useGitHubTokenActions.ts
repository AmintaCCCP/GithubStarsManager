import { useCallback, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { GitHubApiService, GITHUB_TOKEN_INVALID_ERROR } from '../../../services/githubApi';
import { backend } from '../../../services/backendAdapter';
import { useAppStore } from '../../../store/useAppStore';
import { useDialog } from '../../../hooks/useDialog';

interface UseGitHubTokenActionsOptions {
  t: (zh: string, en: string) => string;
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
      toast(t('请输入有效的 GitHub Access Token', 'Please enter a valid GitHub access token'), 'error');
      return;
    }

    setIsSaving(true);
    try {
      const nextUser = await new GitHubApiService(token).getCurrentUser();
      if (user && nextUser.id !== user.id) {
        toast(
          t(
            `该 token 属于 ${nextUser.login}，当前账号是 ${user.login}。请先退出再登录另一个账号，本地数据会按账号分别保留。`,
            `This token belongs to ${nextUser.login}, but you are signed in as ${user.login}. Log out first to switch accounts; local data is kept per GitHub account.`,
          ),
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
            t(
              '未能将新 Token 保存到后端，本地凭证未更新。请稍后重试。',
              'Failed to save the new token to the backend. Local credentials were not updated. Please try again later.',
            ),
            'error',
          );
          setTokenInput('');
          return;
        }
      }
      setGitHubToken(token);
      setUser(nextUser);
      setTokenInput('');
      toast(t('GitHub Token 已更新', 'GitHub token updated'), 'success');
    } catch (error) {
      const message = error instanceof Error && error.message === GITHUB_TOKEN_INVALID_ERROR
        ? t('GitHub token 已过期或无效', 'GitHub token has expired or is invalid')
        : (error instanceof Error ? error.message : t('更新失败，请稍后重试', 'Update failed. Please try again'));
      toast(message, 'error');
    } finally {
      setIsSaving(false);
    }
  }, [setGitHubToken, setUser, t, toast, tokenInput, user]);

  return { tokenInput, isSaving, setTokenInput, updateToken };
};
