import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

const getDbMock = vi.fn();

vi.mock('../../src/db/connection.js', () => ({
  getDb: () => getDbMock(),
}));

const { default: releasesRouter } = await import('../../src/routes/releases.js');

const createTestApp = () => {
  const app = express();
  app.use(express.json());
  app.use(releasesRouter);
  return app;
};

/**
 * Mock DB 只记录 prepare 收到的 SQL 与每次 run 的参数，便于断言合并 UPSERT 的行为。
 */
async function createReleaseDb() {
  const Database = (await import('better-sqlite3')).default;
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE releases (
      id INTEGER PRIMARY KEY,
      tag_name TEXT NOT NULL,
      name TEXT,
      body TEXT,
      html_url TEXT,
      published_at TEXT,
      prerelease INTEGER DEFAULT 0,
      draft INTEGER DEFAULT 0,
      is_read INTEGER DEFAULT 0,
      assets TEXT,
      updated_asset_ids TEXT NOT NULL DEFAULT '[]',
      repo_id INTEGER NOT NULL,
      repo_full_name TEXT NOT NULL,
      repo_name TEXT NOT NULL,
      zipball_url TEXT,
      tarball_url TEXT
    )
  `);
  getDbMock.mockReturnValue(db);
  return db;
}

function captureStatements() {
  const statements: { sql: string; params: unknown[][] }[] = [];
  const exec: Record<string, unknown> = {};

  const db = {
    prepare: (sql: string) => {
      const stmt = {
        run: (...params: unknown[]) => {
          statements.push({ sql, params });
          return { changes: 1 };
        },
        all: () => [],
        get: () => undefined,
      };
      return stmt;
    },
    transaction: (fn: () => number) => fn,
    exec,
  };
  getDbMock.mockReturnValue(db);
  return { statements, db };
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
    expect(statements[0].params[16]).toBe(0);
    expect(sql).toContain('updated_asset_ids = CASE WHEN ? = 1 THEN excluded.updated_asset_ids ELSE releases.updated_asset_ids END');
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
    expect(statements[0].params[16]).toBe(0);
  });

  it('persists updated_asset_ids with release data', async () => {
    const { statements } = captureStatements();
    await request(createTestApp())
      .put('/api/releases')
      .send({ releases: [sampleRelease({ updated_asset_ids: [100, 101] })] })
      .expect(200);

    const sql = statements[0].sql;
    expect(sql).toContain('updated_asset_ids = CASE WHEN ? = 1 THEN excluded.updated_asset_ids ELSE releases.updated_asset_ids END');
    expect(statements[0].params[10]).toBe('[100,101]');
    expect(statements[0].params[16]).toBe(1);
  });

  it('preserves stored asset markers when the update omits updated_asset_ids', async () => {
    const db = await createReleaseDb();
    try {
      db.prepare(`
        INSERT INTO releases (
          id, tag_name, name, body, html_url, published_at,
          prerelease, draft, is_read, assets, updated_asset_ids,
          repo_id, repo_full_name, repo_name, zipball_url, tarball_url
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        1, 'v0', 'Old release', null, 'https://example.com/old', null,
        0, 0, 1, '[]', '[100,101]', 10, 'owner/repo', 'repo', null, null
      );

      await request(createTestApp())
        .put('/api/releases')
        .send({ releases: [sampleRelease({ name: 'New release' })] })
        .expect(200);

      const row = db.prepare('SELECT updated_asset_ids, name FROM releases WHERE id = 1').get() as {
        updated_asset_ids: string;
        name: string;
      };
      expect(row.updated_asset_ids).toBe('[100,101]');
      expect(row.name).toBe('New release');
    } finally {
      db.close();
    }
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
