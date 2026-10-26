import { Router } from 'express';
import crypto from 'node:crypto';
import type { Config } from '../config.js';
import { logger } from '../services/logger.js';

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_USER_URL = 'https://api.github.com/user';
const STATE_TTL_MS = 10 * 60 * 1000;
const TICKET_TTL_MS = 60 * 1000;
// Bound the in-memory state map: expired entries are pruned, but an attacker
// (or a misbehaving proxy) hammering /start must not grow it without limit.
const MAX_PENDING_STATES = 10000;
// Login-CSRF defense: /start plants this nonce cookie and keeps the value in
// server memory next to the state; /callback accepts a state only when the
// browser that presents the GitHub redirect is the same one that started the
// flow.
const NONCE_COOKIE = 'gsm_oauth_nonce';

interface PendingState {
  nonce: string;
  expiresAt: number;
}
interface PendingTicket {
  githubToken: string;
  user: Record<string, unknown>;
  expiresAt: number;
}

const pendingStates = new Map<string, PendingState>();
const pendingTickets = new Map<string, PendingTicket>();

function pruneExpired(): void {
  const now = Date.now();
  for (const [key, entry] of pendingStates) {
    if (entry.expiresAt <= now) pendingStates.delete(key);
  }
  for (const [key, entry] of pendingTickets) {
    if (entry.expiresAt <= now) pendingTickets.delete(key);
  }
}

/** Length-safe constant-time comparison for the nonce token. */
function noncesMatch(presented: string, stored: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(stored);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Minimal cookie reader — avoids adding cookie-parser for a single name. */
function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

/** Consume-and-delete: both state and ticket are single-use by construction. */
function takeOneTime<T extends { expiresAt: number }>(store: Map<string, T>, key: string): T | null {
  const entry = store.get(key);
  store.delete(key);
  if (!entry || entry.expiresAt <= Date.now()) return null;
  return entry;
}

/** Read per request so tests (and runtime env reloads) see current env values. */
let oauthConfigSource: () => Config['githubOauth'] = () =>
  ({
    clientId: process.env.GITHUB_OAUTH_CLIENT_ID || null,
    clientSecret: process.env.GITHUB_OAUTH_CLIENT_SECRET || null,
    callbackUrl: process.env.GITHUB_OAUTH_CALLBACK_URL || null,
    frontendUrl: process.env.GITHUB_OAUTH_FRONTEND_URL || null,
  }) as Config['githubOauth'];

/** Test seam: production config.ts wires this to its typed config object. */
export const setOauthConfigSourceForTests = (source: () => Config['githubOauth']): void => {
  oauthConfigSource = source;
};

const oauthConfig = () => oauthConfigSource();
export { oauthConfig };

export const isOauthEnabled = (cfg: ReturnType<typeof oauthConfig> = oauthConfig()): boolean =>
  Boolean(cfg.clientId && cfg.clientSecret && cfg.callbackUrl && cfg.frontendUrl);

export const resetOauthStoresForTests = (): void => {
  pendingStates.clear();
  pendingTickets.clear();
};

/** Test seam: fill the state map past its cap without HTTP round-trips. */
export const seedPendingStatesForTests = (count: number): void => {
  for (let i = 0; i < count; i += 1) {
    pendingStates.set(`seed-${i}`, { nonce: 'n', expiresAt: Date.now() + STATE_TTL_MS });
  }
};

const GITHUB_FETCH_TIMEOUT_MS = 10000;

async function exchangeGithubToken(code: string, cfg: ReturnType<typeof oauthConfig>): Promise<string> {
  const response = await fetch(GITHUB_TOKEN_URL, {
    signal: AbortSignal.timeout(GITHUB_FETCH_TIMEOUT_MS),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code,
      redirect_uri: cfg.callbackUrl,
    }),
  });
  if (!response.ok) {
    throw new Error(`GitHub token endpoint responded ${response.status}`);
  }
  const data = (await response.json()) as { access_token?: string; error?: string };
  if (!data.access_token) {
    throw new Error(data.error ? `GitHub OAuth error: ${data.error}` : 'GitHub token response missing access_token');
  }
  return data.access_token;
}

async function fetchGithubUser(githubToken: string): Promise<Record<string, unknown>> {
  const response = await fetch(GITHUB_USER_URL, {
    signal: AbortSignal.timeout(GITHUB_FETCH_TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${githubToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub user endpoint responded ${response.status}`);
  }
  const user = (await response.json()) as Record<string, unknown>;
  if (typeof user.id !== 'number') {
    throw new Error('GitHub user payload missing id');
  }
  return user;
}

const router = Router();

/**
 * GET /api/oauth/config — login-page probe. Intentionally mounted before the
 * /api auth middleware so an unauthenticated visitor can learn whether OAuth
 * sign-in is offered (clientId is public; secrets never leave the server).
 */
router.get('/api/oauth/config', (_req, res) => {
  const cfg = oauthConfig();
  const enabled = isOauthEnabled(cfg);
  // Only expose the public client_id for an actually usable flow; a half
  // configured deployment must look identical to a disabled one.
  res.json({ enabled, clientId: enabled ? cfg.clientId : null });
});

router.get('/api/oauth/github/start', (req, res) => {
  const cfg = oauthConfig();
  if (!isOauthEnabled(cfg)) {
    res.status(404).json({ error: 'Not Found', code: 'OAUTH_NOT_CONFIGURED' });
    return;
  }
  pruneExpired();
  if (pendingStates.size >= MAX_PENDING_STATES) {
    logger.warn('oauth.start', 'Pending OAuth state limit reached; rejecting new flow');
    res.status(503).json({ error: 'Too Many Requests', code: 'OAUTH_BUSY' });
    return;
  }
  const state = crypto.randomBytes(16).toString('hex');
  const nonce = crypto.randomBytes(24).toString('hex');
  pendingStates.set(state, { nonce, expiresAt: Date.now() + STATE_TTL_MS });
  res.cookie(NONCE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.protocol === 'https',
    maxAge: STATE_TTL_MS,
    path: '/api/oauth/github',
  });
  const params = new URLSearchParams({
    client_id: cfg.clientId!,
    redirect_uri: cfg.callbackUrl!,
    scope: 'read:user user:email repo gist',
    state,
    ...(req.query.login && typeof req.query.login === 'string' ? { login: req.query.login } : {}),
  });
  res.redirect(302, `${GITHUB_AUTHORIZE_URL}?${params.toString()}`);
});

router.get('/api/oauth/github/callback', async (req, res) => {
  const cfg = oauthConfig();
  if (!isOauthEnabled(cfg)) {
    res.status(404).json({ error: 'Not Found', code: 'OAUTH_NOT_CONFIGURED' });
    return;
  }
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const errorParam = typeof req.query.error === 'string' ? req.query.error : '';
  const nonce = readCookie(req.headers.cookie, NONCE_COOKIE);
  // Always expire the nonce cookie: the flow ends on this request either way.
  res.clearCookie(NONCE_COOKIE, { path: '/api/oauth/github' });
  // Intentional: the state is consumed before the token exchange, so a failed
  // exchange cannot be replayed; a user retry after error=exchange therefore
  // lands on error=state and must restart the flow from /start.
  const pending = takeOneTime(pendingStates, state);
  const nonceMatches = Boolean(pending && nonce && noncesMatch(nonce, pending.nonce));
  if (errorParam || !state || !code || !pending || !nonceMatches) {
    logger.warn('oauth.callback', 'GitHub OAuth callback rejected', {
      error: errorParam || undefined,
      reason: errorParam
        ? 'user_denied'
        : !state
          ? 'missing_state'
          : !code
            ? 'missing_code'
            : !pending
              ? 'unknown_state'
              : 'nonce_mismatch',
    });
    res.redirect(302, `${cfg.frontendUrl}#oauth?error=state`);
    return;
  }
  try {
    const githubToken = await exchangeGithubToken(code, cfg);
    const user = await fetchGithubUser(githubToken);
    const ticket = crypto.randomBytes(24).toString('base64url');
    pendingTickets.set(ticket, { githubToken, user, expiresAt: Date.now() + TICKET_TTL_MS });
    res.redirect(302, `${cfg.frontendUrl}#oauth?ticket=${encodeURIComponent(ticket)}`);
  } catch (err) {
    logger.errorFromError('oauth.callback', 'GitHub OAuth callback failed', err);
    res.redirect(302, `${cfg.frontendUrl}#oauth?error=exchange`);
  }
});

router.post('/api/oauth/github/exchange', (req, res) => {
  // Lazy cleanup symmetric with /start: tickets are otherwise only evicted
  // when queried, so never-redeemed ones would linger until process exit.
  pruneExpired();
  const ticket = typeof req.body?.ticket === 'string' ? req.body.ticket : '';
  if (!ticket) {
    res.status(400).json({ error: 'Bad Request', code: 'OAUTH_TICKET_REQUIRED' });
    return;
  }
  const entry = takeOneTime(pendingTickets, ticket);
  if (!entry) {
    res.status(401).json({ error: 'Unauthorized', code: 'OAUTH_TICKET_INVALID' });
    return;
  }
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.json({ githubToken: entry.githubToken, user: entry.user });
});

export default router;
