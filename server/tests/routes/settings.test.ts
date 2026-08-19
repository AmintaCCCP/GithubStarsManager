import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

const getDbMock = vi.fn();

vi.mock('../../src/db/connection.js', () => ({
  getDb: () => getDbMock(),
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
 */
function createSettingsDb() {
  const values = new Map<string, string | null>();
  const statement = {
    run: (key: string, value: string | null) => {
      values.set(key, value);
      return { changes: 1 };
    },
  };
  const db = {
    prepare: () => statement,
    transaction: (fn: () => void) => fn,
  };
  getDbMock.mockReturnValue(db);
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
