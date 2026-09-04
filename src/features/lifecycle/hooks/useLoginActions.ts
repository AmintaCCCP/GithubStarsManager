import { useCallback } from 'react';
import { GitHubApiService } from '../../../services/githubApi';
import { backend } from '../../../services/backendAdapter';
import { syncFromBackend } from '../../../services/autoSync';
import type { GitHubUser } from '../../../types';

export type BackendLoginResult =
  | { status: 'connected'; githubToken: string; user: GitHubUser }
  | { status: 'backend-unavailable' }
  | { status: 'unauthorized' }
  | { status: 'restore-failed' }
  | { status: 'github-token-required' };

export interface LoginActions {
  authenticateWithGitHub: (token: string) => Promise<GitHubUser>;
  syncTokenToBackend: (token: string) => Promise<{ ok: boolean }>;
  configuredBackendUrl: string | null;
  restoreBackendSession: (url: string) => Promise<BackendLoginResult>;
  setupBackendGitHubToken: (token: string) => Promise<GitHubUser>;
  syncBackendData: () => Promise<void>;
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
  const restoreBackendSession = useCallback(async (url: string): Promise<BackendLoginResult> => {
    await backend.init(url);
    if (!backend.isAvailable) return { status: 'backend-unavailable' };
    if (!await backend.verifyAuth()) return { status: 'unauthorized' };

    const restored = await backend.restoreAuth();
    if (!restored) return { status: 'restore-failed' };
    if (!restored.github_token) return { status: 'github-token-required' };

    const user = await authenticateWithGitHub(restored.github_token);
    return { status: 'connected', githubToken: restored.github_token, user };
  }, [authenticateWithGitHub]);
  const setupBackendGitHubToken = useCallback(async (token: string) => {
    const user = await authenticateWithGitHub(token);
    await backend.syncSettings({ github_token: token });
    return user;
  }, [authenticateWithGitHub]);
  const syncBackendData = useCallback(async () => {
    await syncFromBackend();
  }, []);

  return {
    authenticateWithGitHub,
    syncTokenToBackend,
    configuredBackendUrl: backend.configuredUrl,
    restoreBackendSession,
    setupBackendGitHubToken,
    syncBackendData,
  };
};
