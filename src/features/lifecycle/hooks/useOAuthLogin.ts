import { useCallback, useEffect, useRef, useState } from 'react';
import { backend } from '../../../services/backendAdapter';
import { isElectron } from '../../../services/electronProxy';
import { useAppStore } from '../../../store/useAppStore';
import { useLoginActions } from './useLoginActions';
import type { GitHubUser } from '../../../types';

export type OAuthMode = 'web' | 'device';

interface OAuthConfigResponse {
  enabled: boolean;
  clientId: string | null;
}

export interface OAuthLoginState {
  /** Which OAuth entry the login page should show, if any. */
  mode: OAuthMode | null;
  /** True while a ticket exchange or device flow is completing. */
  isCompleting: boolean;
  startWebLogin: () => void;
  startDeviceFlow: () => Promise<void>;
  /** Consumes #oauth?ticket=... if present and finishes the login. */
  completeFromUrl: () => Promise<boolean>;
  resetError: () => void;
  error: string | null;
}

const OAUTH_HASH_PREFIX = '#oauth?';

function readOAuthCallbackFromHash(): { ticket: string | null; error: string | null } {
  const hash = window.location.hash;
  if (!hash.startsWith(OAUTH_HASH_PREFIX)) return { ticket: null, error: null };
  const params = new URLSearchParams(hash.slice(OAUTH_HASH_PREFIX.length));
  return { ticket: params.get('ticket'), error: params.get('error') };
}

function clearOAuthHash(): void {
  try {
    history.replaceState(null, '', window.location.pathname + window.location.search);
  } catch {
    window.location.hash = '';
  }
}

/**
 * Shared finish path for every OAuth flavor: the token goes through the same
 * authenticateWithGitHub → setGitHubToken/setUser → syncTokenToBackend flow as
 * a pasted PAT, so the resulting account workspace is identical.
 */
export const useOAuthLogin = (onFinished: (user: GitHubUser, token: string) => void | Promise<void>): OAuthLoginState => {
  const { authenticateWithGitHub, syncTokenToBackend, syncBackendData } = useLoginActions();
  const setGitHubToken = useAppStore((state) => state.setGitHubToken);
  const setUser = useAppStore((state) => state.setUser);
  const [mode, setMode] = useState<OAuthMode | null>(null);
  const [isCompleting, setIsCompleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const completingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const detect = async () => {
      if (backend.isAvailable) {
        // Web OAuth works for both the served SPA and Electron with a
        // connected backend: the start route simply navigates this window and
        // the callback redirects back to GITHUB_OAUTH_FRONTEND_URL. This
        // branch re-runs whenever backend availability flips, so a fresh load
        // that lands before backend.init() finishes still gets probed once
        // the health check settles — without polling.
        try {
          const res = await fetch(`${backend.backendUrl}/oauth/config`, {
            headers: backend.backendAuthHeaders,
          });
          if (res.ok) {
            const data = (await res.json()) as OAuthConfigResponse;
            if (!cancelled && data.enabled) setMode('web');
          }
        } catch {
          // Config probe failure just means no OAuth entry.
        }
        return;
      }
      if (!isElectron()) return;
      // Desktop local mode: show Device Flow only when the main process has a
      // client_id injected (GITHUB_OAUTH_DEVICE_CLIENT_ID); otherwise keep
      // PAT login as the only entry instead of a button that must fail.
      const config = await window.electronAPI?.oauthDeviceFlowConfig?.();
      if (!cancelled) {
        setMode(backend.isAvailable || !config?.clientId ? null : 'device');
      }
    };
    void detect();
    // backend.init() notifies subscribers when its probe settles (and on any
    // later availability flip); re-detect then. Detect is idempotent.
    const unsubscribe = backend.subscribeAvailability(() => {
      void detect();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const finishLogin = useCallback(async (token: string) => {
    if (completingRef.current) return;
    completingRef.current = true;
    setIsCompleting(true);
    setError(null);
    try {
      const user = await authenticateWithGitHub(token);
      setGitHubToken(token);
      setUser(user);
      await syncTokenToBackend(token);
      // Intentional extra vs the PAT path: the token was just minted server
      // side, so pull the backend's authoritative data once before handing
      // over to the app shell.
      if (backend.isAvailable) await syncBackendData();
      await onFinished(user, token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OAuth sign-in failed');
    } finally {
      completingRef.current = false;
      setIsCompleting(false);
    }
  }, [authenticateWithGitHub, syncTokenToBackend, syncBackendData, setGitHubToken, setUser, onFinished]);

  const completeFromUrl = useCallback(async () => {
    const { ticket, error } = readOAuthCallbackFromHash();
    if (!ticket && !error) return false;
    // A ticket is single-use and short-lived: never burn it against a backend
    // URL that has not resolved yet — the caller retries once the backend
    // availability subscription fires.
    if (ticket && !backend.backendUrl) return false;
    clearOAuthHash();
    if (error) {
      // GitHub or the callback refused the flow (state mismatch, user denial,
      // exchange failure) — surface the same generic message as a failed
      // exchange and let the user restart from the login form.
      setError('oauth.failed');
      return true;
    }
    setIsCompleting(true);
    try {
      const res = await fetch(`${backend.backendUrl}/oauth/github/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...backend.backendAuthHeaders },
        body: JSON.stringify({ ticket }),
      });
      if (!res.ok) {
        setError(res.status === 401 ? 'oauth.expired' : 'oauth.failed');
        return true;
      }
      const data = (await res.json()) as { githubToken: string; user: GitHubUser };
      await finishLogin(data.githubToken);
      return true;
    } catch {
      setError('oauth.failed');
      return true;
    } finally {
      setIsCompleting(false);
    }
  }, [finishLogin]);

  const startWebLogin = useCallback(() => {
    if (!backend.backendUrl) return;
    window.location.href = `${backend.backendUrl}/oauth/github/start`;
  }, []);

  const startDeviceFlow = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.oauthDeviceFlow) return;
    setIsCompleting(true);
    setError(null);
    try {
      const result = await api.oauthDeviceFlow();
      if (!result.success || !result.token) {
        setError(result.error ?? 'oauth.failed');
        return;
      }
      await finishLogin(result.token);
    } catch {
      // IPC rejection (main process crash, handler missing) must surface in
      // the UI instead of dying as an unhandled rejection.
      setError('oauth.failed');
    } finally {
      setIsCompleting(false);
    }
  }, [finishLogin]);

  // Retry a ticket exchange once the backend URL resolves: completeFromUrl
  // keeps the hash (and thus the ticket) while the backend is not ready.
  useEffect(() => {
    if (!backend.backendUrl) {
      const unsubscribe = backend.subscribeAvailability(() => {
        void completeFromUrl();
      });
      return unsubscribe;
    }
  }, [completeFromUrl]);

  const resetError = useCallback(() => setError(null), []);

  return { mode, isCompleting, startWebLogin, startDeviceFlow, completeFromUrl, resetError, error };
};
