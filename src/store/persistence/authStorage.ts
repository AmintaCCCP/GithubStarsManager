
import type { GitHubUser } from '../../types';
import { scopedKey } from '../../services/profileStorage';

const BACKEND_SECRET_SESSION_BASE_KEY = 'github-stars-manager-backend-secret';
const AUTH_MIRROR_KEY = scopedKey('github-stars-manager-auth');

interface AuthMirror {
  user: GitHubUser | null;
  githubToken: string | null;
  backendApiSecret: string | null;
}

export const readAuthMirror = (): AuthMirror | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(AUTH_MIRROR_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AuthMirror>;
    return {
      user: parsed.user ?? null,
      githubToken: typeof parsed.githubToken === 'string' ? parsed.githubToken : null,
      backendApiSecret: typeof parsed.backendApiSecret === 'string' ? parsed.backendApiSecret : null,
    };
  } catch {
    return null;
  }
};

export const writeAuthMirror = (auth: AuthMirror): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(AUTH_MIRROR_KEY, JSON.stringify(auth));
  } catch {
    // Quota/security errors are expected in constrained environments; the
    // IndexedDB persist path remains the fallback there.
  }
};

export const clearAuthMirror = (): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(AUTH_MIRROR_KEY);
  } catch {
    // ignore
  }
};

export const readSessionBackendSecret = (profileId?: string): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    const key = scopedKey(BACKEND_SECRET_SESSION_BASE_KEY, profileId);
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
};

export const writeSessionBackendSecret = (secret: string | null, profileId?: string): void => {
  if (typeof window === 'undefined') return;
  try {
    const key = scopedKey(BACKEND_SECRET_SESSION_BASE_KEY, profileId);
    if (secret) {
      // codeql[js/clear-text-storage-of-sensitive-data] Session-scoped and per-tab by design: the secret must survive a profile-switch reload, is never written to disk, and is cleared when the tab closes.
      window.sessionStorage.setItem(key, secret);
    } else {
      window.sessionStorage.removeItem(key);
    }
  } catch {
    // Storage may be blocked or unavailable; IndexedDB remains the durable path.
  }
};
