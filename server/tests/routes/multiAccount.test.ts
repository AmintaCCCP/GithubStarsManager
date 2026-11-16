import { describe, expect, it, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Isolate DB before importing app modules that call getDb()
// Synthetic env values built at runtime (see config.apiSecret.test.ts) so the
// secret scanner never mistakes fixture constants for real credentials.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-multi-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.ENCRYPTION_KEY = 'f'.repeat(64);
process.env.API_SECRET = 'import-time-placeholder';

const fetchMock = vi.hoisted(() => vi.fn());
vi.stubGlobal('fetch', fetchMock);

const proxyRequestMock = vi.hoisted(() => vi.fn());
vi.mock('../../src/services/proxyService.js', () => ({
  proxyRequest: proxyRequestMock,
  validateUrl: vi.fn(),
  isPrivateOrLoopback: vi.fn(() => true),
}));

async function canOpenSqlite(): Promise<boolean> {
  try {
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(':memory:');
    db.close();
    return true;
  } catch {
    return false;
  }
}

const dbAvailable = await canOpenSqlite();
const describeIfDb = dbAvailable ? describe : describe.skip;

const ACCOUNT_A = '111';
const ACCOUNT_B = '222';

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describeIfDb('multi-account isolation (Issue #611)', () => {
  let request: typeof import('supertest').default;
  let app: import('express').Express;
  let getDb: () => import('better-sqlite3').Database;
  let encrypt: (value: string, key: string) => string;
  let decrypt: (value: string, key: string) => string;
  let encryptionKey: string;

  const authHeaders = (accountId?: string): Record<string, string> => ({
    Authorization: `Bearer ${process.env.API_SECRET}`,
    ...(accountId ? { 'X-GitHub-Account-Id': accountId } : {}),
  });

  const repoRow = (id: number, fullName: string, extra: Record<string, unknown> = {}) => ({
    id,
    name: `repo-${id}`,
    full_name: fullName,
    html_url: `https://github.com/${fullName}`,
    stargazers_count: 10,
    owner: { login: 'owner', avatar_url: 'https://x/o.png' },
    topics: [],
    ...extra,
  });

  const wipeDb = (): void => {
    const db = getDb();
    db.exec(`
      DELETE FROM repositories;
      DELETE FROM releases;
      DELETE FROM categories;
      DELETE FROM account_settings;
      DELETE FROM accounts;
      DELETE FROM settings;
    `);
  };

  beforeAll(async () => {
    const conn = await import('../../src/db/connection.js');
    const migrations = await import('../../src/db/migrations.js');
    const crypto = await import('../../src/services/crypto.js');
    const configModule = await import('../../src/config.js');
    const index = await import('../../src/index.js');
    const supertest = await import('supertest');

    request = supertest.default;
    getDb = conn.getDb;
    encrypt = crypto.encrypt;
    decrypt = crypto.decrypt;
    encryptionKey = configModule.config.encryptionKey;

    const db = conn.getDb();
    migrations.runMigrations(db);
    app = index.createApp();
  });

  beforeEach(() => {
    fetchMock.mockReset();
    proxyRequestMock.mockReset();
    proxyRequestMock.mockResolvedValue({ status: 200, data: { ok: true }, headers: {} });
    wipeDb();
  });

  it('v4 schema isolates full syncs per account (isFullSync never deletes other accounts)', async () => {
    // 账号 A 全量同步 1 个仓库
    await request(app)
      .put('/api/repositories')
      .set(authHeaders(ACCOUNT_A))
      .send({ isFullSync: true, repositories: [repoRow(1, 'owner/one')] })
      .expect(200);

    // 账号 B 全量同步另一个仓库
    await request(app)
      .put('/api/repositories')
      .set(authHeaders(ACCOUNT_B))
      .send({ isFullSync: true, repositories: [repoRow(2, 'owner/two')] })
      .expect(200);

    const listA = await request(app).get('/api/repositories').set(authHeaders(ACCOUNT_A)).expect(200);
    const listB = await request(app).get('/api/repositories').set(authHeaders(ACCOUNT_B)).expect(200);
    expect(listA.body.repositories.map((r: { id: number }) => r.id)).toEqual([1]);
    expect(listB.body.repositories.map((r: { id: number }) => r.id)).toEqual([2]);

    // 账号 A 再次全量同步（空列表）绝不删除账号 B 的数据
    await request(app)
      .put('/api/repositories')
      .set(authHeaders(ACCOUNT_A))
      .send({ isFullSync: true, repositories: [] })
      .expect(200);
    const listAAfter = await request(app).get('/api/repositories').set(authHeaders(ACCOUNT_A)).expect(200);
    const listBAfter = await request(app).get('/api/repositories').set(authHeaders(ACCOUNT_B)).expect(200);
    expect(listAAfter.body.repositories).toEqual([]);
    expect(listBAfter.body.repositories.map((r: { id: number }) => r.id)).toEqual([2]);
  });

  it('claims legacy default data for the verified owner and sets active_account_id', async () => {
    const db = getDb();
    // 存量 default 数据 + 加密的 github_token
    db.prepare(`
      INSERT INTO repositories (account_id, id, name, full_name, html_url, owner_login, topics)
      VALUES ('default', 1, 'legacy', 'owner/legacy', 'https://github.com/owner/legacy', 'owner', '[]')
    `).run();
    db.prepare(`
      INSERT INTO releases (account_id, id, tag_name, repo_id, repo_full_name, repo_name)
      VALUES ('default', 50, 'v1', 1, 'owner/legacy', 'legacy')
    `).run();
    db.prepare(`
      INSERT INTO categories (account_id, id, name, icon)
      VALUES ('default', 'custom-legacy', 'Legacy', '📁')
    `).run();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('github_token', ?)").run(encrypt('legacy-token', encryptionKey));

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 111 }),
    });

    // 携带真实账号 ID 的请求触发认领
    const list = await request(app).get('/api/repositories').set(authHeaders('111')).expect(200);
    expect(list.body.repositories.map((r: { id: number }) => r.id)).toEqual([1]);

    // default 行全部迁移到 111 分区，default 无残留
    const releaseRows = db.prepare('SELECT account_id FROM releases').all() as Array<{ account_id: string }>;
    expect(releaseRows.every((r) => r.account_id === '111')).toBe(true);
    const categoryRows = db.prepare('SELECT account_id FROM categories').all() as Array<{ account_id: string }>;
    expect(categoryRows.every((r) => r.account_id === '111')).toBe(true);

    const claimedBy = db.prepare("SELECT value FROM settings WHERE key = 'legacy_default_claimed_by'").get() as { value: string };
    expect(claimedBy.value).toBe('111');
    const active = db.prepare("SELECT value FROM settings WHERE key = 'active_account_id'").get() as { value: string };
    expect(active.value).toBe('111');
    const scopedToken = db.prepare("SELECT value FROM account_settings WHERE account_id = '111' AND key = 'github_token'").get() as { value: string };
    expect(decrypt(scopedToken.value, encryptionKey)).toBe('legacy-token');
  });

  it('refuses to claim legacy default data when the identity does not match', async () => {
    const db = getDb();
    db.prepare(`
      INSERT INTO repositories (account_id, id, name, full_name, html_url, owner_login, topics)
      VALUES ('default', 1, 'legacy', 'owner/legacy', 'https://github.com/owner/legacy', 'owner', '[]')
    `).run();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('github_token', ?)").run(encrypt('legacy-token', encryptionKey));

    // 存量 Token 属于账号 999，而请求者是 111：绝不认领
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 999 }),
    });

    const list = await request(app).get('/api/repositories').set(authHeaders('111')).expect(200);
    expect(list.body.repositories).toEqual([]);

    const rows = db.prepare('SELECT account_id FROM repositories').all() as Array<{ account_id: string }>;
    expect(rows.map((r) => r.account_id)).toEqual(['default']);
    expect(db.prepare("SELECT value FROM settings WHERE key = 'legacy_default_claimed_by'").get()).toBeUndefined();
  });

  it('writes account-scoped settings to account_settings for real accounts and mirrors to global for headless requests', async () => {
    const db = getDb();

    // 无头请求：github_token 必须镜像写入全局 settings
    await request(app)
      .put('/api/settings')
      .set({ Authorization: `Bearer ${process.env.API_SECRET}` })
      .send({ github_token: 'headless-token' })
      .expect(200);
    const globalToken = db.prepare("SELECT value FROM settings WHERE key = 'github_token'").get() as { value: string };
    expect(decrypt(globalToken.value, encryptionKey)).toBe('headless-token');
    expect(db.prepare('SELECT COUNT(*) as total FROM account_settings').get() as { total: number }).toMatchObject({ total: 0 });

    // 真实账号：写入 account_settings + accounts + active_account_id；全局表不被覆盖
    await request(app)
      .put('/api/settings')
      .set(authHeaders(ACCOUNT_A))
      .send({
        github_token: 'token-a',
        user_profile: { id: 111, login: 'alice', name: 'Alice', avatar_url: 'https://x/a.png' },
        activeAIConfig: 'shared-config',
      })
      .expect(200);

    const scopedToken = db.prepare("SELECT value FROM account_settings WHERE account_id = '111' AND key = 'github_token'").get() as { value: string };
    expect(decrypt(scopedToken.value, encryptionKey)).toBe('token-a');
    const accountRow = db.prepare('SELECT * FROM accounts WHERE account_id = ?').get('111') as { user_json: string };
    expect(JSON.parse(accountRow.user_json)).toMatchObject({ login: 'alice' });
    const active = db.prepare("SELECT value FROM settings WHERE key = 'active_account_id'").get() as { value: string };
    expect(active.value).toBe('111');
    // 全局 github_token 保持无头请求写入的值；全局键仍写全局表
    expect(decrypt((db.prepare("SELECT value FROM settings WHERE key = 'github_token'").get() as { value: string }).value, encryptionKey))
      .toBe('headless-token');
    expect((db.prepare("SELECT value FROM settings WHERE key = 'activeAIConfig'").get() as { value: string }).value)
      .toBe('shared-config');

    // GET /api/settings 按账号合并：github_token 来自 account_settings
    const fetched = await request(app).get('/api/settings').set(authHeaders(ACCOUNT_A)).expect(200);
    expect(fetched.body.github_token).toBe('***en-a');
    expect(fetched.body.github_token_status).toBe('ok');
  });

  it('routes GitHub proxy requests with the current account token', async () => {
    const db = getDb();
    db.prepare("INSERT OR REPLACE INTO account_settings (account_id, key, value) VALUES (?, 'github_token', ?)").run(ACCOUNT_A, encrypt('token-a', encryptionKey));
    db.prepare("INSERT OR REPLACE INTO account_settings (account_id, key, value) VALUES (?, 'github_token', ?)").run(ACCOUNT_B, encrypt('token-b', encryptionKey));

    await request(app)
      .post('/api/proxy/github/user')
      .set(authHeaders(ACCOUNT_A))
      .send({ method: 'GET' })
      .expect(200);
    expect(proxyRequestMock.mock.calls[0][0].headers.Authorization).toBe('Bearer token-a');

    await request(app)
      .post('/api/proxy/github/user')
      .set(authHeaders(ACCOUNT_B))
      .send({ method: 'GET' })
      .expect(200);
    expect(proxyRequestMock.mock.calls[1][0].headers.Authorization).toBe('Bearer token-b');

    // 缺省账号（headless）：回退全局 settings
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('github_token', ?)").run(encrypt('global-token', encryptionKey));
    await request(app)
      .post('/api/proxy/github/user')
      .set({ Authorization: `Bearer ${process.env.API_SECRET}` })
      .send({ method: 'GET' })
      .expect(200);
    expect(proxyRequestMock.mock.calls[2][0].headers.Authorization).toBe('Bearer global-token');
  });

  it('exports and imports multi-account workspaces without cross-account loss', async () => {
    // 账号 A：仓库 + 自定义分类；账号 B：另一个仓库
    await request(app)
      .put('/api/repositories')
      .set(authHeaders(ACCOUNT_A))
      .send({ repositories: [repoRow(1, 'owner/one', { ai_summary: 'ai-one' })] })
      .expect(200);
    await request(app)
      .put('/api/repositories')
      .set(authHeaders(ACCOUNT_B))
      .send({ repositories: [repoRow(2, 'owner/two')] })
      .expect(200);
    await request(app)
      .post('/api/categories')
      .set(authHeaders(ACCOUNT_A))
      .send({ name: 'A-Cat', keywords: [] })
      .expect(201);
    await request(app)
      .put('/api/settings')
      .set(authHeaders(ACCOUNT_A))
      .send({ github_token: 'token-a', user_profile: { id: 111, login: 'alice', avatar_url: 'https://x/a.png' } })
      .expect(200);
    await request(app)
      .put('/api/settings')
      .set(authHeaders(ACCOUNT_B))
      .send({ github_token: 'token-b', user_profile: { id: 222, login: 'bob', avatar_url: 'https://x/b.png' } })
      .expect(200);

    const exported = await request(app).post('/api/sync/export').set(authHeaders(ACCOUNT_A)).expect(200);
    // 顶层保持 v1 兼容：仅当前账号（A）的数据
    expect(exported.body.repositories.map((r: { id: number }) => r.id)).toEqual([1]);
    expect(exported.body.account_id).toBe(ACCOUNT_A);
    // 多账号字段
    expect(exported.body.accounts).toHaveLength(2);
    const exportedWorkspaces = exported.body.account_workspaces as Array<Record<string, unknown>>;
    expect(exportedWorkspaces).toHaveLength(2);
    const workspaceA = exportedWorkspaces.find((w) => w.account_id === ACCOUNT_A);
    const workspaceB = exportedWorkspaces.find((w) => w.account_id === ACCOUNT_B);
    expect(workspaceA?.repositories as Array<{ id: number }>).toHaveLength(1);
    expect(workspaceB?.repositories as Array<{ id: number }>).toHaveLength(1);
    // Token 脱敏：'***' + 后 4 位
    const wsSettingsA = workspaceA?.account_settings as Record<string, string>;
    expect(wsSettingsA.github_token).toBe('***en-a');
    expect(JSON.stringify(exported.body)).not.toContain('token-a');

    // 清空后按账号 B 分区导入完整导出包：多账号数据按各自 account_id 复原
    wipeDb();
    await request(app)
      .post('/api/sync/import')
      .set(authHeaders(ACCOUNT_B))
      .send(exported.body)
      .expect(200);

    const db = getDb();
    const repoRows = db.prepare('SELECT account_id, id FROM repositories ORDER BY account_id, id').all() as Array<{ account_id: string; id: number }>;
    expect(repoRows).toContainEqual({ account_id: ACCOUNT_A, id: 1 });
    expect(repoRows).toContainEqual({ account_id: ACCOUNT_B, id: 2 });
    const categoryRows = db.prepare('SELECT account_id, name FROM categories').all() as Array<{ account_id: string; name: string }>;
    expect(categoryRows[0]).toMatchObject({ account_id: ACCOUNT_A, name: 'A-Cat' });
    const accountRows = db.prepare('SELECT account_id, user_json FROM accounts ORDER BY account_id').all() as Array<{ account_id: string; user_json: string }>;
    expect(accountRows).toHaveLength(2);
    // 掩码 Token 被跳过：导入绝不把掩码当作真实凭据写入（清库后此处应为空）
    const scopedTokens = db.prepare("SELECT account_id, value FROM account_settings WHERE key = 'github_token'").all() as Array<{ account_id: string; value: string }>;
    expect(scopedTokens).toHaveLength(0);
    // AI 成果（ai_summary）随工作区复原
    const summary = db.prepare('SELECT ai_summary FROM repositories WHERE account_id = ? AND id = 1').get(ACCOUNT_A) as { ai_summary: string };
    expect(summary.ai_summary).toBe('ai-one');
  });

  it('generates an explicit id on POST /api/categories and scopes lists per account', async () => {
    const created = await request(app)
      .post('/api/categories')
      .set(authHeaders(ACCOUNT_A))
      .send({ name: 'A-Cat', keywords: ['k'] })
      .expect(201);
    expect(typeof created.body.id).toBe('string');
    expect(created.body.id.length).toBeGreaterThan(0);

    const listA = await request(app).get('/api/categories').set(authHeaders(ACCOUNT_A)).expect(200);
    expect(listA.body).toHaveLength(1);
    const listB = await request(app).get('/api/categories').set(authHeaders(ACCOUNT_B)).expect(200);
    expect(listB.body).toEqual([]);
  });

  it('keeps release read state scoped per account for identical release ids', async () => {
    const release = {
      id: 5,
      tag_name: 'v1',
      assets: [],
      repo_id: 1,
      repo_full_name: 'owner/one',
      repo_name: 'one',
    };
    await request(app).put('/api/releases').set(authHeaders(ACCOUNT_A)).send({ releases: [release] }).expect(200);
    await request(app).put('/api/releases').set(authHeaders(ACCOUNT_B)).send({ releases: [release] }).expect(200);

    await request(app).patch('/api/releases/5').set(authHeaders(ACCOUNT_A)).send({ is_read: true }).expect(200);

    // 未读过滤按账号分区：A 已读 → 0 条；B 仍未读 → 1 条
    const unreadA = await request(app).get('/api/releases?unread=true').set(authHeaders(ACCOUNT_A)).expect(200);
    const unreadB = await request(app).get('/api/releases?unread=true').set(authHeaders(ACCOUNT_B)).expect(200);
    expect(unreadA.body.releases).toHaveLength(0);
    expect(unreadB.body.releases).toHaveLength(1);

    // mark-all-read 仅命中当前账号分区（B 的 1 行，而非 A+B 共 2 行）
    const markAll = await request(app).post('/api/releases/mark-all-read').set(authHeaders(ACCOUNT_B)).expect(200);
    expect(markAll.body.updated).toBe(1);
  });
});
