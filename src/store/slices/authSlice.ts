
import { defaultReleaseSourceSettings } from '../../types';
import { logger } from '../../services/logger';
import type { AppStoreSlice } from '../types';
import { clearAuthMirror, writeAuthMirror, writeSessionBackendSecret } from '../persistence/authStorage';

export const createAuthSlice: AppStoreSlice<Pick<import('../types').AppActions, 'setUser' | 'setGitHubToken' | 'setBackendApiSecret' | 'logout'>> = (set, get) => ({
      // Auth actions
      setUser: (user) => {
        logger.info('store.setUser', 'Setting user', { hasUser: !!user });
        set({ user, isAuthenticated: !!user });
        const { githubToken, backendApiSecret } = get();
        writeAuthMirror({ user, githubToken, backendApiSecret });
      },
      setGitHubToken: (token) => {
        logger.info('store.setGitHubToken', 'Setting GitHub token', { hasToken: !!token });
        set({ githubToken: token });
        const { user, backendApiSecret } = get();
        writeAuthMirror({ user, githubToken: token, backendApiSecret });
      },
      setBackendApiSecret: (backendApiSecret) => {
        writeSessionBackendSecret(backendApiSecret);
        set({ backendApiSecret });
        const { user, githubToken } = get();
        writeAuthMirror({ user, githubToken, backendApiSecret });
      },
      logout: () => {
        // Full credential teardown: clear the localStorage auth mirror, the
        // sessionStorage API_SECRET, and the in-memory secret. Without this,
        // `backendApiSecret` survives logout in memory AND in the v10 IndexedDB
        // snapshot, so the backend would still authenticate a logged-out user.
        clearAuthMirror();
        writeSessionBackendSecret(null);
        set({
          user: null,
          githubToken: null,
          backendApiSecret: null,
          isAuthenticated: false,
          repositories: [],
          gists: [],
          starredGists: [],
          gistSearchResults: [],
          analyzingGistIds: new Set(),
          releases: [],
          releaseSubscriptions: new Set(),
          releaseSourceSettings: defaultReleaseSourceSettings,
          readReleases: new Set(),
          forks: [],
          readForks: new Set(),
          analyzingRepositoryIds: new Set(),
          searchResults: [],
          similarView: null,
          lastSync: null,
        });
      },

});
