
import type { GitHubUser } from '../../types';

const BACKEND_SECRET_SESSION_KEY = 'github-stars-manager-backend-secret';
const AUTH_MIRROR_KEY = 'github-stars-manager-auth';

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

export const readSessionBackendSecret = (): string | null => {
  if (typeof window === 'undefined') return null;
  return window.sessionStorage.getItem(BACKEND_SECRET_SESSION_KEY);
};

export const writeSessionBackendSecret = (secret: string | null): void => {
  if (typeof window === 'undefined') return;
  if (secret) {
    window.sessionStorage.setItem(BACKEND_SECRET_SESSION_KEY, secret);
  } else {
    window.sessionStorage.removeItem(BACKEND_SECRET_SESSION_KEY);
  }
};
