import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

const getDbMock = vi.fn();

vi.mock('../../src/db/connection.js', () => ({
  getDb: () => getDbMock(),
}));
// sync 路由顶部引入 config/crypto，但 import 分支不实际使用它们，mock 为空即可。
vi.mock('../../src/config.js', () => ({ config: { encryptionKey: 'test-key' } }));
vi.mock('../../src/services/crypto.js', () => ({ encrypt: (v: string) => v, decrypt: (v: string) => v }));

const { default: syncRouter } = await import('../../src/routes/sync.js');

const createTestApp = () => {
  const app = express();
  app.use(express.json());
  app.use(syncRouter);
  return app;
};

/**
 * Mock DB：只记录 prepare 收到的 SQL 与每次 run 的参数，便于断言导入合并 UPSERT 的 is_read 语义。
 */
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
    // 路由中 `db.transaction(() => {...})` 返回 importAll，随后调用 `importAll()`；
    // 因此这里返回 fn 本身（与 releasesUpsert.test.ts 的惯例一致）。
    transaction: (fn: () => number) => fn,
    exec,
  };
  getDbMock.mockReturnValue(db);
  return { statements, db };
}

const releaseSqlIndex = (statements: { sql: string }[]) =>
  statements.findIndex((s) => s.sql.includes('INSERT INTO releases'));

describe('POST /api/sync/import release upsert is_read semantics', () => {
  it('passes NULL for is_read when snapshot does not carry it, so existing read state is preserved', async () => {
    const { statements } = captureStatements();
    await request(createTestApp())
      .post('/api/sync/import')
      .send({
        repositories: [],
        releases: [{ id: 1, tag_name: 'v1', assets: [] }],
      })
      .expect(200);

    const idx = releaseSqlIndex(statements);
    expect(idx).toBeGreaterThan(-1);
    const releaseStmt = statements[idx];
    // is_read 位于 (id, tag_name, name, body, html_url, published_at, prerelease, draft, is_read, ...) 第 9 位
    expect(releaseStmt.params[8]).toBeNull();
    // UPSERT 保留分支必须存在，以保留库中已读状态
    expect(releaseStmt.sql).toContain('is_read = CASE WHEN excluded.is_read IS NOT NULL');
    expect(releaseStmt.sql).toContain('ELSE releases.is_read');
  });

  it('passes explicit boolean for is_read when snapshot carries it, overwriting existing state', async () => {
    const { statements } = captureStatements();
    await request(createTestApp())
      .post('/api/sync/import')
      .send({
        repositories: [],
        releases: [{ id: 1, tag_name: 'v1', is_read: true, assets: [] }],
      })
      .expect(200);

    const idx = releaseSqlIndex(statements);
    expect(idx).toBeGreaterThan(-1);
    expect(statements[idx].params[8]).toBe(1);
  });
});
