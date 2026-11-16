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
        all: () => [],
      }),
    });

    const res = await request(createTestApp()).post('/api/sync/auth').expect(200);
    // 多账号扩展新增 active_account_id / accounts 字段；兼容字段子集断言
    expect(res.body).toMatchObject({ github_token: 'github-token' });
    expect(res.body.active_account_id).toBe('default');
    expect(res.body.accounts).toEqual([]);
  });

  it('returns null github_token when none is stored', async () => {
    getDbMock.mockReturnValue({
      prepare: () => ({
        get: () => undefined,
        all: () => [],
      }),
    });

    const res = await request(createTestApp()).post('/api/sync/auth').expect(200);
    expect(res.body).toMatchObject({ github_token: null });
  });

  it('returns null github_token instead of leaking plaintext on decrypt failure', async () => {
    getDbMock.mockReturnValue({
      prepare: () => ({
        get: () => ({ value: 'unreadable' }),
        all: () => [],
      }),
    });

    const res = await request(createTestApp()).post('/api/sync/auth').expect(200);
    expect(res.body).toMatchObject({ github_token: null });
  });

  it('returns the backend account list when the accounts table holds rows', async () => {
    getDbMock.mockReturnValue({
      prepare: (sql: string) => {
        if (sql.includes('FROM accounts')) {
          return {
            all: () => [{
              account_id: '1001',
              user_json: JSON.stringify({ id: 1001, login: 'alice', avatar_url: 'https://x/a.png' }),
              github_token_encrypted: 'encrypted-token',
              added_at: '2026-01-01T00:00:00Z',
              last_used_at: '2026-01-02T00:00:00Z',
            }],
            get: () => undefined,
          };
        }
        return {
          get: (key: string) => (key === 'github_token' ? { value: 'encrypted-token' } : undefined),
          all: () => [],
        };
      },
    });

    const res = await request(createTestApp()).post('/api/sync/auth').expect(200);
    expect(res.body.github_token).toBe('github-token');
    expect(res.body.accounts).toHaveLength(1);
    expect(res.body.accounts[0]).toMatchObject({
      accountId: '1001',
      githubToken: 'github-token',
    });
    expect(res.body.accounts[0].user).toMatchObject({ login: 'alice' });
  });
});