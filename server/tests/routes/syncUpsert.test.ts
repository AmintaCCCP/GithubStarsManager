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

// 两段式语句中，保留分支用 releases.is_read，覆盖分支用 excluded.is_read
const releasePreserveIndex = (statements: { sql: string }[]) =>
  statements.findIndex((s) =>
    s.sql.includes('INSERT INTO releases') && s.sql.includes('is_read = releases.is_read')
  );
const releaseOverwriteIndex = (statements: { sql: string }[]) =>
  statements.findIndex((s) =>
    s.sql.includes('INSERT INTO releases') && s.sql.includes('is_read = excluded.is_read')
  );

const validRelease = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  tag_name: 'v1',
  assets: [],
  repo_id: 10,
  repo_full_name: 'owner/repo',
  repo_name: 'repo',
  ...overrides,
});

describe('POST /api/sync/import release upsert is_read semantics', () => {
  it('uses preserve-statement and inserts is_read=0 when snapshot does not carry it', async () => {
    const { statements } = captureStatements();
    await request(createTestApp())
      .post('/api/sync/import')
      .send({
        repositories: [],
        releases: [validRelease()],
      })
      .expect(200);

    const idx = releasePreserveIndex(statements);
    expect(idx).toBeGreaterThan(-1);
    const releaseStmt = statements[idx];
    // 保留分支：冲突时 is_read = releases.is_read（保留库中已读状态）
    expect(releaseStmt.sql).toContain('is_read = releases.is_read');
    expect(releaseStmt.sql).not.toContain('is_read = CASE WHEN');
    // is_read 位于 (id, tag_name, name, body, html_url, published_at, prerelease, draft, is_read, ...) 第 9 位
    // 非显式时落 0（与 releases 表 DEFAULT 0 语义一致），避免新导入行落 NULL 导致 unread 过滤漏行
    expect(releaseStmt.params[8]).toBe(0);
    // 覆盖分支语句不应被命中
    expect(releaseOverwriteIndex(statements)).toBe(-1);
  });

  it('uses overwrite-statement and passes explicit boolean when snapshot carries is_read', async () => {
    const { statements } = captureStatements();
    await request(createTestApp())
      .post('/api/sync/import')
      .send({
        repositories: [],
        releases: [validRelease({ is_read: true })],
      })
      .expect(200);

    const idx = releaseOverwriteIndex(statements);
    expect(idx).toBeGreaterThan(-1);
    // 覆盖分支：冲突时 is_read = excluded.is_read（用快照中的已读状态覆盖）
    expect(statements[idx].sql).toContain('is_read = excluded.is_read');
    expect(statements[idx].params[8]).toBe(1);
    // 保留分支语句不应被命中
    expect(releasePreserveIndex(statements)).toBe(-1);
  });

  it('rejects release snapshot missing required repository fields with 400', async () => {
    captureStatements();
    const res = await request(createTestApp())
      .post('/api/sync/import')
      .send({
        repositories: [],
        releases: [{ id: 1, tag_name: 'v1', assets: [] }],
      })
      .expect(400);

    expect(res.body.code).toBe('RELEASE_REPO_ID_REQUIRED');
  });

  it('accepts repository nested object for required repo fields', async () => {
    const { statements } = captureStatements();
    await request(createTestApp())
      .post('/api/sync/import')
      .send({
        repositories: [],
        releases: [{
          id: 2,
          tag_name: 'v2',
          assets: [],
          repository: { id: 20, full_name: 'owner/other', name: 'other' },
        }],
      })
      .expect(200);

    const idx = releasePreserveIndex(statements);
    expect(idx).toBeGreaterThan(-1);
    // repo_id / full_name / name 位于 is_read(8)、assets(9) 之后
    expect(statements[idx].params[10]).toBe(20);
    expect(statements[idx].params[11]).toBe('owner/other');
    expect(statements[idx].params[12]).toBe('other');
  });

  it('rejects decimal release id with 400 (must be integer)', async () => {
    captureStatements();
    const res = await request(createTestApp())
      .post('/api/sync/import')
      .send({
        repositories: [],
        releases: [validRelease({ id: 1.5 })],
      })
      .expect(400);

    expect(res.body.code).toBe('RELEASE_ID_REQUIRED');
  });

  it('persists zipball_url and tarball_url on import UPSERT', async () => {
    const { statements } = captureStatements();
    await request(createTestApp())
      .post('/api/sync/import')
      .send({
        repositories: [],
        releases: [validRelease({
          zipball_url: 'https://example.com/zip',
          tarball_url: 'https://example.com/tar',
        })],
      })
      .expect(200);

    const idx = releasePreserveIndex(statements);
    expect(idx).toBeGreaterThan(-1);
    expect(statements[idx].sql).toContain('zipball_url = excluded.zipball_url');
    expect(statements[idx].sql).toContain('tarball_url = excluded.tarball_url');
    // zipball/tarball 位于 repo_name(12) 之后
    expect(statements[idx].params[13]).toBe('https://example.com/zip');
    expect(statements[idx].params[14]).toBe('https://example.com/tar');
  });

  it('persists archive URLs on overwrite path as well', async () => {
    const { statements } = captureStatements();
    await request(createTestApp())
      .post('/api/sync/import')
      .send({
        repositories: [],
        releases: [validRelease({
          is_read: false,
          zipball_url: 'https://example.com/z2',
          tarball_url: 'https://example.com/t2',
        })],
      })
      .expect(200);

    const idx = releaseOverwriteIndex(statements);
    expect(idx).toBeGreaterThan(-1);
    expect(statements[idx].sql).toContain('zipball_url = excluded.zipball_url');
    expect(statements[idx].params[13]).toBe('https://example.com/z2');
    expect(statements[idx].params[14]).toBe('https://example.com/t2');
  });
});
