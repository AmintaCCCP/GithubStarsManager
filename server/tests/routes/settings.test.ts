import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

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
vi.mock('../../src/config.js', () => ({ config: { encryptionKey: 'test-key' } }));
vi.mock('../../src/services/crypto.js', () => ({
  encrypt: (value: string) => `encrypted:${value}`,
  decrypt: (value: string) => value,
}));
vi.mock('../../src/services/logger.js', () => ({
  logger: {
    warn: vi.fn(),
    errorFromError: vi.fn(),
  },
}));

const { default: configsRouter } = await import('../../src/routes/configs.js');

/**
 * Create an in-memory settings database stub for the route test.
 * 路由通过 db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', key, serialized)
 * 写入，门面签名中 SQL 是第一参数，key/value 依次跟在后面。
 */
function createSettingsDb() {
  const values = new Map<string, string | null>();
  dbMocks.run.mockImplementation((_sql: string, key: string, value: string | null) => {
    values.set(key, value);
    return { lastInsertRowid: 0, rowsAffected: 1 };
  });
  return values;
}

/**
 * Build an Express app containing the settings route under test.
 */
const createTestApp = () => {
  const app = express();
  app.use(express.json());
  app.use(configsRouter);
  return app;
};

describe('PUT /api/settings', () => {
  it('preserves the backend GitHub token across subsequent partial settings updates', async () => {
    const values = createSettingsDb();
    const app = createTestApp();

    await request(app)
      .put('/api/settings')
      .send({ github_token: 'ghp-local-token' })
      .expect(200);

    await request(app)
      .put('/api/settings')
      .send({ activeAIConfig: 'default' })
      .expect(200);

    expect(values.get('github_token')).toBe('encrypted:ghp-local-token');
    expect(values.get('activeAIConfig')).toBe('default');
  });
});
