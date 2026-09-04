import { useCallback } from 'react';
import { GitHubApiService } from '../../../services/githubApi';
import { backend } from '../../../services/backendAdapter';
import type { GitHubUser } from '../../../types';

export interface LoginActions {
  authenticateWithGitHub: (token: string) => Promise<GitHubUser>;
  syncTokenToBackend: (token: string) => Promise<{ ok: boolean }>;
}

export const useLoginActions = (): LoginActions => {
  const authenticateWithGitHub = useCallback(async (token: string) => {
    const api = new GitHubApiService(token);
    return api.getCurrentUser();
  }, []);
  const syncTokenToBackend = useCallback(async (token: string) => {
    if (!backend.isAvailable) return { ok: true };
    try {
      await backend.syncSettings({ github_token: token });
      return { ok: true };
    } catch (e) {
      console.warn('Failed to save GitHub token to backend:', e);
      return { ok: false };
    }
  }, []);
  return { authenticateWithGitHub, syncTokenToBackend };
};
