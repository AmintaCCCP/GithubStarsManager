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

const { default: releasesRouter } = await import('../../src/routes/releases.js');

const createTestApp = () => {
  const app = express();
  app.use(express.json());
  app.use(releasesRouter);
  return app;
};

/**
 * Mock DB 只记录 db.run 收到的 SQL 与参数，便于断言合并 UPSERT 的行为。
 * 门面签名：db.run(sql, ...args)，首个参数是 SQL。
 */
function captureStatements() {
  const statements: { sql: string; params: unknown[][] }[] = [];

  dbMocks.run.mockImplementation((sql: string, ...params: unknown[]) => {
    statements.push({ sql, params: params as unknown[] });
    return { lastInsertRowid: 0, rowsAffected: 1 };
  });
  dbMocks.all.mockReturnValue([]);
  dbMocks.get.mockReturnValue(undefined);

  return { statements };
}

const sampleRelease = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  tag_name: 'v1',
  name: 'Release 1',
  body: null,
  html_url: 'https://github.com/owner/repo/releases/tag/v1',
  published_at: '2026-01-01T00:00:00.000Z',
  assets: [{ id: 100, name: 'a.dmg', size: 1000 }],
  repository: { id: 10, full_name: 'owner/repo', name: 'repo' },
  ...overrides,
});

describe('PUT /api/releases merge upsert', () => {
  it('preserves existing is_read when release does not carry it explicitly', async () => {
    const { statements } = captureStatements();
    await request(createTestApp())
      .put('/api/releases')
      .send({ releases: [sampleRelease()] })
      .expect(200);

    const sql = statements[0].sql;
    // 未显式携带 is_read 时，冲突分支应保留 releases.is_read
    expect(sql).toContain('is_read = releases.is_read');
    expect(sql).not.toContain('is_read = excluded.is_read');
    // 新插入时 is_read 传入 0（默认未读）
    expect(statements[0].params[8]).toBe(0);
  });

  it('overwrites is_read when the release carries it explicitly', async () => {
    const { statements } = captureStatements();
    await request(createTestApp())
      .put('/api/releases')
      .send({ releases: [sampleRelease({ is_read: true })] })
      .expect(200);

    const sql = statements[0].sql;
    expect(sql).toContain('is_read = excluded.is_read');
    expect(statements[0].params[8]).toBe(1);
  });

  it('updates data columns while preserving is_read on conflict', async () => {
    const { statements } = captureStatements();
    await request(createTestApp())
      .put('/api/releases')
      .send({ releases: [sampleRelease({ assets: [{ id: 100, size: 9999 }], name: 'New name' })] })
      .expect(200);

    const sql = statements[0].sql;
    // 数据列应更新
    expect(sql).toContain('assets = excluded.assets');
    expect(sql).toContain('name = excluded.name');
    // is_read 保留
    expect(sql).toContain('is_read = releases.is_read');
  });

  it('rejects release without a valid positive id', async () => {
    captureStatements();
    await request(createTestApp())
      .put('/api/releases')
      .send({ releases: [{ ...sampleRelease(), id: 0 }] })
      .expect(400);
  });
});
