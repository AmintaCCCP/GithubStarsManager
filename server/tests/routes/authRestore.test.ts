import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

// Mock 门面方法：门面签名是 db.get(sql, ...args)，SQL 是第一个参数。
// 用 vi.hoisted 保证 mock 工厂提升后仍能引用这些 vi.fn()。
const dbMocks = vi.hoisted(() => ({
  all: vi.fn(),
  get: vi.fn(),
  run: vi.fn(),
  exec: vi.fn(),
  batch: vi.fn(),
}));

vi.mock('../../src/db/client.js', () => ({
  db: {
    all: (...args: unknown[]) => Promise.resolve(dbMocks.all(...args)),
    get: (...args: unknown[]) => Promise.resolve(dbMocks.get(...args)),
    run: (...args: unknown[]) => Promise.resolve(dbMocks.run(...args)),
    exec: (...args: unknown[]) => Promise.resolve(dbMocks.exec(...args)),
    batch: (...args: unknown[]) => Promise.resolve(dbMocks.batch(...args)),
  },
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
    // 路由：await db.get('SELECT value FROM settings WHERE key = ?', 'github_token')
    dbMocks.get.mockReturnValue({ value: 'encrypted-token' });

    const res = await request(createTestApp()).post('/api/sync/auth').expect(200);
    expect(res.body).toEqual({ github_token: 'github-token' });
  });

  it('returns null github_token when none is stored', async () => {
    dbMocks.get.mockReturnValue(undefined);

    const res = await request(createTestApp()).post('/api/sync/auth').expect(200);
    expect(res.body).toEqual({ github_token: null });
  });

  it('returns null github_token instead of leaking plaintext on decrypt failure', async () => {
    dbMocks.get.mockReturnValue({ value: 'unreadable' });

    const res = await request(createTestApp()).post('/api/sync/auth').expect(200);
    expect(res.body).toEqual({ github_token: null });
  });
});