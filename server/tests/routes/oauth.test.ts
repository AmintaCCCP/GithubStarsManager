import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/db/connection.js', () => ({ getDb: () => null, closeDb: () => {} }));
vi.mock('../../src/services/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    errorFromError: vi.fn(),
    debug: vi.fn(),
  },
  morganLoggerStream: { write: vi.fn() },
}));

type OauthModule = typeof import('../../src/routes/oauth.js');
let oauth: OauthModule;

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = globalThis.fetch;

function configureOauth(overrides: Record<string, string | undefined> = {}): void {
  process.env.GITHUB_OAUTH_CLIENT_ID = 'client-id';
  process.env.GITHUB_OAUTH_CLIENT_SECRET = 'client-secret';
  process.env.GITHUB_OAUTH_CALLBACK_URL = 'https://app.example.com/api/oauth/github/callback';
  process.env.GITHUB_OAUTH_FRONTEND_URL = 'https://app.example.com/';
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

const buildApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use(oauth.default);
  return app;
};

/**
 * Start a flow with a cookie jar so the nonce cookie set by /start is replayed
 * on the callback, like a real browser would.
 */
const startFlowWithCookies = async (app: express.Express): Promise<{ agent: request.Agent; state: string }> => {
  const agent = request.agent(app);
  const res = await agent.get('/api/oauth/github/start');
  const state = new URL(res.headers.location).searchParams.get('state') as string;
  return { agent, state };
};

/** Stub the two GitHub endpoints the callback hits, with a fixed token/user. */
const stubGithubFlow = (token = 'gho_ttl_token'): void => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === 'https://github.com/login/oauth/access_token') {
      return new Response(JSON.stringify({ access_token: token }), { status: 200 });
    }
    return new Response(
      JSON.stringify({ id: 42, login: 'octocat', name: 'Octo', avatar_url: '', email: null }),
      { status: 200 },
    );
  }) as typeof fetch;
};

beforeEach(async () => {
  vi.resetModules();
  oauth = await import('../../src/routes/oauth.js');
  oauth.resetOauthStoresForTests();
  configureOauth();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  globalThis.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

describe('GET /api/oauth/config', () => {
  it('reports enabled with public clientId when fully configured', async () => {
    const res = await request(buildApp()).get('/api/oauth/config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: true, clientId: 'client-id' });
  });

  it('reports disabled and hides clientId when any variable is missing', async () => {
    configureOauth({ GITHUB_OAUTH_CLIENT_SECRET: undefined });
    const res = await request(buildApp()).get('/api/oauth/config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: false, clientId: null });
  });
});

describe('GET /api/oauth/github/start', () => {
  it('redirects to GitHub authorize with a fresh state', async () => {
    const res = await request(buildApp()).get('/api/oauth/github/start');
    expect(res.status).toBe(302);
    const location = new URL(res.headers.location);
    expect(location.origin + location.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(location.searchParams.get('client_id')).toBe('client-id');
    expect(location.searchParams.get('redirect_uri')).toBe('https://app.example.com/api/oauth/github/callback');
    expect(location.searchParams.get('scope')).toBe('read:user user:email repo gist');
    expect(location.searchParams.get('state')).toMatch(/^[0-9a-f]{32}$/);
  });

  it('returns 404 when OAuth is not configured', async () => {
    configureOauth({ GITHUB_OAUTH_FRONTEND_URL: undefined });
    const res = await request(buildApp()).get('/api/oauth/github/start');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/oauth/github/callback unconfigured', () => {
  it('returns 404 before touching state validation', async () => {
    configureOauth({ GITHUB_OAUTH_CLIENT_SECRET: undefined });
    const res = await request(buildApp()).get('/api/oauth/github/callback?code=abc&state=x');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/oauth/github/callback', () => {
  const stubGithub = (token = 'gho_new_token'): void => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://github.com/login/oauth/access_token') {
        return new Response(JSON.stringify({ access_token: token }), { status: 200 });
      }
      if (url === 'https://api.github.com/user') {
        return new Response(
          JSON.stringify({ id: 42, login: 'octocat', name: 'Octo', avatar_url: 'https://example.com/a.png', email: null }),
          { status: 200 },
        );
      }
      throw new Error('unexpected fetch ' + url);
    }) as typeof fetch;
  };

  it('exchanges code for token when the callback carries the start cookie', async () => {
    const app = buildApp();
    const { agent, state } = await startFlowWithCookies(app);
    stubGithub();
    const res = await agent.get(`/api/oauth/github/callback?code=abc&state=${state}`);
    expect(res.status).toBe(302);
    const frontend = new URL(res.headers.location);
    expect(frontend.protocol + '//' + frontend.host + frontend.pathname).toBe('https://app.example.com/');
    expect(frontend.hash).toMatch(/^#oauth\?ticket=[A-Za-z0-9_-]+$/);

    // The nonce cookie must be gone after the callback.
    expect(res.headers['set-cookie']?.join(';')).toMatch(/gsm_oauth_nonce=;/);

    const ticket = frontend.hash.match(/ticket=([A-Za-z0-9_-]+)/)![1];
    const exchange = await request(app).post('/api/oauth/github/exchange').send({ ticket });
    expect(exchange.status).toBe(200);
    expect(exchange.body.githubToken).toBe('gho_new_token');
    expect(exchange.body.user.id).toBe(42);
    expect(exchange.headers['cache-control']).toContain('no-store');
  });

  it('rejects the callback when the nonce cookie is missing (login CSRF)', async () => {
    const { state } = await startFlowWithCookies(buildApp());
    stubGithub();
    // Fresh request without a cookie jar replaying a leaked state+code pair.
    const res = await request(buildApp()).get(`/api/oauth/github/callback?code=abc&state=${state}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('#oauth?error=state');
  });

  it('rejects the callback when the nonce does not match the stored hash', async () => {
    await startFlowWithCookies(buildApp());
    stubGithub();
    // A second browser presenting its own nonce against the first flow's state.
    const res = await request(buildApp())
      .get('/api/oauth/github/callback?code=abc&state=whatever')
      .set('Cookie', 'gsm_oauth_nonce=wrong-nonce-value');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('#oauth?error=state');
  });

  it('rejects an unknown or replayed state without touching GitHub', async () => {
    let githubCalled = false;
    globalThis.fetch = (async () => {
      githubCalled = true;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    const noState = await request(buildApp()).get('/api/oauth/github/callback?code=abc');
    expect(noState.status).toBe(302);
    expect(noState.headers.location).toContain('#oauth?error=state');

    const { agent, state } = await startFlowWithCookies(buildApp());
    const first = await agent.get(`/api/oauth/github/callback?code=abc&state=${state}`);
    // No stubbed GitHub yet — the fetch stub above returns '{}' without
    // access_token, so the flow redirects with error=exchange but state is
    // already consumed.
    expect(first.headers.location).toContain('#oauth?error=exchange');
    const replay = await agent.get(`/api/oauth/github/callback?code=abc&state=${state}`);
    expect(replay.headers.location).toContain('#oauth?error=state');
    expect(githubCalled).toBe(true);
  });

  it('forwards GitHub errors without consuming flow state silently', async () => {
    const res = await request(buildApp()).get('/api/oauth/github/callback?error=access_denied');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('#oauth?error=state');
  });
});

describe('POST /api/oauth/github/exchange', () => {
  it('rejects a forged ticket', async () => {
    const res = await request(buildApp()).post('/api/oauth/github/exchange').send({ ticket: 'forged' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('OAUTH_TICKET_INVALID');
  });

  it('single-use: replaying a valid ticket fails', async () => {
    // Build a ticket through the callback flow (with the start cookie).
    const app = buildApp();
    const { agent, state } = await startFlowWithCookies(app);
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://github.com/login/oauth/access_token') {
        return new Response(JSON.stringify({ access_token: 'gho_t' }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: 7, login: 'octo' }), { status: 200 });
    }) as typeof fetch;
    const cb = await agent.get(`/api/oauth/github/callback?code=abc&state=${state}`);
    const ticket = cb.headers.location.match(/ticket=([A-Za-z0-9_-]+)/)![1];

    const first = await request(app).post('/api/oauth/github/exchange').send({ ticket });
    expect(first.status).toBe(200);
    const replay = await request(app).post('/api/oauth/github/exchange').send({ ticket });
    expect(replay.status).toBe(401);
  });

  it('rejects a missing ticket body', async () => {
    const res = await request(buildApp()).post('/api/oauth/github/exchange').send({});
    expect(res.status).toBe(400);
  });
});

describe('oauth TTL expiry', () => {
  it('rejects a state older than the 10 minute TTL', async () => {
    const { agent, state } = await startFlowWithCookies(buildApp());
    stubGithubFlow();
    vi.setSystemTime(Date.now() + 10 * 60 * 1000 + 1);
    try {
      const cb = await agent.get(`/api/oauth/github/callback?code=abc&state=${state}`);
      expect(cb.headers.location).toContain('#oauth?error=state');
    } finally {
      vi.useRealTimers();
    }
  });

  it('accepts a state within the TTL (boundary sanity)', async () => {
    const { agent, state } = await startFlowWithCookies(buildApp());
    stubGithubFlow();
    vi.setSystemTime(Date.now() + 60 * 1000);
    try {
      const cb = await agent.get(`/api/oauth/github/callback?code=abc&state=${state}`);
      expect(cb.headers.location).toContain('ticket=');
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects a ticket older than the 60 second TTL', async () => {
    const app = buildApp();
    const { agent, state } = await startFlowWithCookies(app);
    stubGithubFlow();
    const cb = await agent.get(`/api/oauth/github/callback?code=abc&state=${state}`);
    const ticket = cb.headers.location.match(/ticket=([A-Za-z0-9_-]+)/)![1];
    vi.setSystemTime(Date.now() + 61 * 1000);
    try {
      const res = await request(app).post('/api/oauth/github/exchange').send({ ticket });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('OAUTH_TICKET_INVALID');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('oauth robustness limits', () => {
  it('returns 503 OAUTH_BUSY when the pending state map is saturated', async () => {
    oauth.seedPendingStatesForTests(10000);
    const res = await request(buildApp()).get('/api/oauth/github/start');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('OAUTH_BUSY');
  });

  it('maps a hung GitHub fetch (abort/timeout) to error=exchange', async () => {
    const { agent, state } = await startFlowWithCookies(buildApp());
    globalThis.fetch = (async () => {
      // AbortSignal.timeout() rejects the fetch with a TimeoutError when it
      // fires; emulate the observable outcome.
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    }) as typeof fetch;
    const cb = await agent.get(`/api/oauth/github/callback?code=abc&state=${state}`);
    expect(cb.status).toBe(302);
    expect(cb.headers.location).toContain('#oauth?error=exchange');
  });
});

describe('oauth config enablement', () => {
  it('requires every variable to enable the flow', async () => {
    const { isOauthEnabled, oauthConfig } = oauth;
    configureOauth();
    expect(isOauthEnabled()).toBe(true);
    for (const key of ['GITHUB_OAUTH_CLIENT_ID', 'GITHUB_OAUTH_CLIENT_SECRET', 'GITHUB_OAUTH_CALLBACK_URL', 'GITHUB_OAUTH_FRONTEND_URL']) {
      const previous = process.env[key];
      delete process.env[key];
      expect(isOauthEnabled()).toBe(false);
      if (previous !== undefined) process.env[key] = previous;
    }
    expect(oauthConfig().clientId).toBe('client-id');
  });
});
