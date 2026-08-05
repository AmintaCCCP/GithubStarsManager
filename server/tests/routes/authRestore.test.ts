import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

const getDbMock = vi.fn();

vi.mock('../../src/db/connection.js', () => ({
  getDb: () => getDbMock(),
}));

vi.mock('../../src/services/crypto.js', () => ({
  decrypt: (value: string) => {
    if (value === 'encrypted-token') return 'github-token';
    throw new Error('boom');
  },
  encrypt: (value: string) => value,
}));

const { default: authRestoreRouter } = await import('../../src/routes/authRestore.js');

const createTestApp = () => {
  const app = express();
  app.use(express.json());
  app.use(authRestoreRouter);
  return app;
};

describe('authRestore route (POST /api/sync/auth)', () => {
  it('returns the decrypted GitHub token when stored', async () => {
    getDbMock.mockReturnValue({
      prepare: () => ({
        get: (key: string) => (key === 'github_token' ? { value: 'encrypted-token' } : undefined),
      }),
    });

    const res = await request(createTestApp()).post('/api/sync/auth').expect(200);
    expect(res.body).toEqual({ github_token: 'github-token' });
  });

  it('returns null github_token when none is stored', async () => {
    getDbMock.mockReturnValue({
      prepare: () => ({
        get: () => undefined,
      }),
    });

    const res = await request(createTestApp()).post('/api/sync/auth').expect(200);
    expect(res.body).toEqual({ github_token: null });
  });

  it('returns null github_token instead of leaking plaintext on decrypt failure', async () => {
    getDbMock.mockReturnValue({
      prepare: () => ({
        get: () => ({ value: 'unreadable' }),
      }),
    });

    const res = await request(createTestApp()).post('/api/sync/auth').expect(200);
    expect(res.body).toEqual({ github_token: null });
  });
});