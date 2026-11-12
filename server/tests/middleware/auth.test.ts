import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// auth.ts reads `config` at request time, so a shared mutable mock lets each
// scenario flip apiSecret / apiSecretSource / allowInsecureNoAuth without
// re-importing.
const configState = vi.hoisted(() => ({
  apiSecret: null as string | null,
  apiSecretSource: null as 'env' | 'generated' | null,
  allowInsecureNoAuth: false,
}));

vi.mock('../../src/config.js', () => ({ config: configState }));

const { authMiddleware } = await import('../../src/middleware/auth.js');

const createApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api', authMiddleware);
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.post('/api/sync/auth', (_req, res) => {
    res.json({ ok: true });
  });
  return app;
};

describe('authMiddleware with no API_SECRET (fail closed)', () => {
  it('rejects protected routes with 401 AUTH_NOT_CONFIGURED and an actionable message', async () => {
    configState.apiSecret = null;
    configState.apiSecretSource = null;
    configState.allowInsecureNoAuth = false;

    const res = await request(createApp()).post('/api/sync/auth');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_NOT_CONFIGURED');
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  it('keeps GET /api/health bypassed while failing closed', async () => {
    configState.apiSecret = null;
    configState.apiSecretSource = null;
    configState.allowInsecureNoAuth = false;

    const res = await request(createApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('allows requests in explicit dev mode (ALLOW_INSECURE_NO_AUTH) and warns exactly once', async () => {
    configState.apiSecret = null;
    configState.apiSecretSource = null;
    configState.allowInsecureNoAuth = true;

    vi.resetModules();
    const { authMiddleware: freshAuth } = await import('../../src/middleware/auth.js');
    const app = express();
    app.use(express.json());
    app.use('/api', freshAuth);
    app.post('/api/sync/auth', (_req, res) => {
      res.json({ ok: true });
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await request(app).post('/api/sync/auth').expect(200);
    await request(app).post('/api/sync/auth').expect(200);

    // Read the recorded calls before restoring (restore clears them).
    const authWarnings = warnSpy.mock.calls.filter((call) => String(call[0]).includes('ALLOW_INSECURE_NO_AUTH'));
    warnSpy.mockRestore();
    expect(authWarnings).toHaveLength(1);
  });
});

describe('authMiddleware with a server-generated secret', () => {
  it('returns 401 AUTH_NOT_CONFIGURED when the client sends no credentials yet', async () => {
    configState.apiSecret = 'generated-secret';
    configState.apiSecretSource = 'generated';
    configState.allowInsecureNoAuth = false;

    const res = await request(createApp()).post('/api/sync/auth');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_NOT_CONFIGURED');
  });

  it('keeps GET /api/health bypassed for generated secrets too', async () => {
    configState.apiSecret = 'generated-secret';
    configState.apiSecretSource = 'generated';
    configState.allowInsecureNoAuth = false;

    const res = await request(createApp()).get('/api/health');
    expect(res.status).toBe(200);
  });

  it('returns plain UNAUTHORIZED for a wrong token (not the not-configured code)', async () => {
    configState.apiSecret = 'generated-secret';
    configState.apiSecretSource = 'generated';
    configState.allowInsecureNoAuth = false;

    const res = await request(createApp()).post('/api/sync/auth').set('Authorization', 'Bearer stale-token');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
    expect(res.body.code).not.toBe('AUTH_NOT_CONFIGURED');
  });

  it('accepts the generated secret as Bearer token', async () => {
    configState.apiSecret = 'generated-secret';
    configState.apiSecretSource = 'generated';
    configState.allowInsecureNoAuth = false;

    const res = await request(createApp()).post('/api/sync/auth').set('Authorization', 'Bearer generated-secret');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe('authMiddleware with an operator-set API_SECRET (Bearer path unchanged)', () => {
  it('rejects requests without an Authorization header (401 UNAUTHORIZED)', async () => {
    configState.apiSecret = 'test-secret';
    configState.apiSecretSource = 'env';
    configState.allowInsecureNoAuth = false;

    const res = await request(createApp()).post('/api/sync/auth');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('rejects a wrong token (401 UNAUTHORIZED)', async () => {
    configState.apiSecret = 'test-secret';
    configState.apiSecretSource = 'env';
    configState.allowInsecureNoAuth = false;

    const res = await request(createApp()).post('/api/sync/auth').set('Authorization', 'Bearer wrong-token');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('rejects a non-Bearer Authorization header (401 UNAUTHORIZED)', async () => {
    configState.apiSecret = 'test-secret';
    configState.apiSecretSource = 'env';
    configState.allowInsecureNoAuth = false;

    const res = await request(createApp()).post('/api/sync/auth').set('Authorization', 'Basic dGVzdC1zZWNyZXQ=');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('allows a correct token through', async () => {
    configState.apiSecret = 'test-secret';
    configState.apiSecretSource = 'env';
    configState.allowInsecureNoAuth = false;

    const res = await request(createApp()).post('/api/sync/auth').set('Authorization', 'Bearer test-secret');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('does not leak the AUTH_NOT_CONFIGURED code once a secret exists', async () => {
    configState.apiSecret = 'test-secret';
    configState.apiSecretSource = 'env';
    configState.allowInsecureNoAuth = false;

    const res = await request(createApp()).post('/api/sync/auth');
    expect(res.body.code).not.toBe('AUTH_NOT_CONFIGURED');
  });
});
