import { useCallback } from 'react';
import { GitHubApiService, GITHUB_TOKEN_INVALID_ERROR } from '../../../services/githubApi';
import { backend } from '../../../services/backendAdapter';
import { syncFromBackend } from '../../../services/autoSync';
import type { GitHubUser } from '../../../types';

export type BackendLoginResult =
  | { status: 'connected'; githubToken: string; user: GitHubUser }
  | { status: 'backend-unavailable' }
  | { status: 'unauthorized' }
  | { status: 'restore-failed' }
  | { status: 'restored-token-invalid' }
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
    const previousUrl = backend.backendUrl;
    await backend.init(url);
    if (!backend.isAvailable) return { status: 'backend-unavailable' };
    if (!await backend.verifyAuth()) {
      // Wrong key: drop the candidate and fall back to whatever backend was
      // active before (or auto-detect), so a failed candidate is never kept.
      await backend.init(previousUrl ?? undefined);
      return { status: 'unauthorized' };
    }

    const restored = await backend.restoreAuth();
    if (!restored) {
      await backend.init(previousUrl ?? undefined);
      return { status: 'restore-failed' };
    }
    if (!restored.github_token) return { status: 'github-token-required' };

    try {
      const user = await authenticateWithGitHub(restored.github_token);
      // Backend, API key, and stored token are all proven — remember the URL
      // (the setup step re-remembers after persisting a new token).
      backend.rememberActiveUrl();
      return { status: 'connected', githubToken: restored.github_token, user };
    } catch (err) {
      if (err instanceof Error && err.message === GITHUB_TOKEN_INVALID_ERROR) {
        // Confirmed auth failure: the stored token is what failed, while the
        // backend and API key are fine — keep the connection for token setup;
        // saving a new token there overwrites the broken one on the backend.
        return { status: 'restored-token-invalid' };
      }
      // Network failures, rate limits, and 5xx are transient — propagate so
      // the user can retry without being pushed into token setup.
      throw err;
    }
  }, [authenticateWithGitHub]);
  const setupBackendGitHubToken = useCallback(async (token: string) => {
    const user = await authenticateWithGitHub(token);
    await backend.syncSettings({ github_token: token });
    backend.rememberActiveUrl();
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
