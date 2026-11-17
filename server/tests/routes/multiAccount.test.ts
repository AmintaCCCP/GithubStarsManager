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

  it('saves token-only credentials for a fresh account without 500 (placeholder identity)', async () => {
    const db = getDb();
    // autoSync 的 token-only 通道：账号行尚不存在且未携带 user_profile 时，
    // 绝不能因 accounts.user_json NOT NULL 约束让整个设置事务 500。
    await request(app)
      .put('/api/settings')
      .set(authHeaders('333'))
      .send({ github_token: 'fresh-token' })
      .expect(200);

    const scopedToken = db.prepare("SELECT value FROM account_settings WHERE account_id = '333' AND key = 'github_token'").get() as { value: string };
    expect(decrypt(scopedToken.value, encryptionKey)).toBe('fresh-token');
    const accountRow = db.prepare('SELECT * FROM accounts WHERE account_id = ?').get('333') as { user_json: string; github_token_encrypted: string };
    // 占位身份只含 GitHub 数值 id，后续携带 user_profile 时会被真实资料覆盖
    expect(JSON.parse(accountRow.user_json)).toEqual({ id: 333 });
    expect(decrypt(accountRow.github_token_encrypted, encryptionKey)).toBe('fresh-token');
    const active = db.prepare("SELECT value FROM settings WHERE key = 'active_account_id'").get() as { value: string };
    expect(active.value).toBe('333');
  });

  it('clears the accounts credential copy when github_token is explicitly emptied', async () => {
    const db = getDb();
    await request(app)
      .put('/api/settings')
      .set(authHeaders(ACCOUNT_A))
      .send({ github_token: 'token-a', user_profile: { id: 111, login: 'alice', avatar_url: 'https://x/a.png' } })
      .expect(200);

    // 显式清空（''）：account_settings 与 accounts.github_token_encrypted 必须同步清空
    await request(app)
      .put('/api/settings')
      .set(authHeaders(ACCOUNT_A))
      .send({ github_token: '' })
      .expect(200);

    const scoped = db.prepare("SELECT value FROM account_settings WHERE account_id = '111' AND key = 'github_token'").get() as { value: string };
    expect(scoped.value).toBe('');
    const accountRow = db.prepare('SELECT github_token_encrypted FROM accounts WHERE account_id = ?').get(ACCOUNT_A) as { github_token_encrypted: string | null };
    expect(accountRow.github_token_encrypted).toBeNull();
  });

  it('does not fall back to the global token for an explicit account without credentials', async () => {
    const db = getDb();
    // 全局 Token 属于其他账号（999）：显式请求账号 B 绝不能使用它
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('github_token', ?)").run(encrypt('global-token-of-999', encryptionKey));

    const res = await request(app)
      .post('/api/proxy/github/user')
      .set(authHeaders(ACCOUNT_B))
      .send({ method: 'GET' })
      .expect(400);
    expect(res.body.code).toBe('GITHUB_TOKEN_NOT_CONFIGURED');
    expect(proxyRequestMock).not.toHaveBeenCalled();
  });

  it('does not reuse the accounts token after an explicit clear via the proxy', async () => {
    const db = getDb();
    await request(app)
      .put('/api/settings')
      .set(authHeaders(ACCOUNT_A))
      .send({ github_token: 'token-a' })
      .expect(200);
    await request(app)
      .put('/api/settings')
      .set(authHeaders(ACCOUNT_A))
      .send({ github_token: '' })
      .expect(200);

    // 防御纵深：即使 accounts 中仍残留旧凭据副本，account_settings 的显式清空
    // 记录（存在但值为空）也必须优先——代理绝不复用旧 Token
    db.prepare('UPDATE accounts SET github_token_encrypted = ? WHERE account_id = ?')
      .run(encrypt('stale-token', encryptionKey), ACCOUNT_A);

    const res = await request(app)
      .post('/api/proxy/github/user')
      .set(authHeaders(ACCOUNT_A))
      .send({ method: 'GET' })
      .expect(400);
    expect(res.body.code).toBe('GITHUB_TOKEN_NOT_CONFIGURED');
    expect(proxyRequestMock).not.toHaveBeenCalled();
  });

  it('returns null token for an explicitly requested account without its own credentials on auth restore', async () => {
    const db = getDb();
    // 全局 Token 属于账号 A：显式恢复账号 B 时绝不返回它
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('github_token', ?)").run(encrypt('global-token-of-a', encryptionKey));

    const explicit = await request(app)
      .post('/api/sync/auth')
      .set({ Authorization: `Bearer ${process.env.API_SECRET}` })
      .send({ account_id: ACCOUNT_B })
      .expect(200);
    expect(explicit.body.github_token).toBeNull();
    expect(explicit.body.active_account_id).toBe(ACCOUNT_B);

    // 无显式账号（default 分区）：保持旧版全局回退契约
    const headless = await request(app)
      .post('/api/sync/auth')
      .set({ Authorization: `Bearer ${process.env.API_SECRET}` })
      .send({})
      .expect(200);
    expect(headless.body.github_token).toBe('global-token-of-a');
    expect(headless.body.active_account_id).toBe('default');
  });

  it('does not inherit other accounts account-scoped settings from the global table', async () => {
    const db = getDb();
    // 全局表中残留账号 A（legacy owner）的账号级设置
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('github_token', ?)").run(encrypt('global-token-of-a', encryptionKey));
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('customCategories', ?)").run('["legacy-cats"]');
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('categoryOrder', ?)").run('["a","b"]');

    // 账号 B 尚无任何账号级设置：不得继承 A 的 github_token / customCategories / categoryOrder
    const fetched = await request(app).get('/api/settings').set(authHeaders(ACCOUNT_B)).expect(200);
    expect(fetched.body.github_token).toBeUndefined();
    expect(fetched.body.github_token_status).toBeUndefined();
    expect(fetched.body.customCategories).toBeUndefined();
    expect(fetched.body.categoryOrder).toBeUndefined();

    // B 保存自己的设置后：仅返回自己的值
    await request(app)
      .put('/api/settings')
      .set(authHeaders(ACCOUNT_B))
      .send({ github_token: 'token-b', customCategories: ['mine'] })
      .expect(200);
    const own = await request(app).get('/api/settings').set(authHeaders(ACCOUNT_B)).expect(200);
    expect(own.body.github_token).toBe('***en-b');
    expect(JSON.parse(own.body.customCategories)).toEqual(['mine']);
  });

  it('merges legacy default rows per record when the target partition already has data', async () => {
    const db = getDb();
    // 存量 default：仓库 1（含 AI 成果与自定义数据）、仓库 2；release 50 已读；分类 shared-cat
    db.prepare(`
      INSERT INTO repositories (account_id, id, name, full_name, html_url, owner_login, topics, ai_summary, ai_tags, custom_description, starred_at)
      VALUES ('default', 1, 'legacy-one', 'owner/one', 'https://github.com/owner/one', 'owner', '[]', 'legacy-ai', '["legacy-tag"]', 'legacy-desc', '2025-01-01T00:00:00Z')
    `).run();
    db.prepare(`
      INSERT INTO repositories (account_id, id, name, full_name, html_url, owner_login, topics)
      VALUES ('default', 2, 'legacy-two', 'owner/two', 'https://github.com/owner/two', 'owner', '[]')
    `).run();
    db.prepare(`
      INSERT INTO releases (account_id, id, tag_name, repo_id, repo_full_name, repo_name, is_read)
      VALUES ('default', 50, 'v1', 1, 'owner/one', 'one', 1)
    `).run();
    db.prepare(`
      INSERT INTO categories (account_id, id, name, icon, keywords)
      VALUES ('default', 'shared-cat', 'Legacy', '📁', '["legacy-kw"]')
    `).run();
    // 全局账号级设置（认领时只补账号缺失的键）
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('github_token', ?)").run(encrypt('token-of-111', encryptionKey));
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('customCategories', ?)").run('["legacy"]');

    // 认领前身份校验失败（网络）：业务请求照常，账号先保存自己的新设置
    fetchMock.mockRejectedValueOnce(new Error('identity check unavailable'));
    await request(app)
      .put('/api/settings')
      .set(authHeaders(ACCOUNT_A))
      .send({ customCategories: ['mine'] })
      .expect(200);

    // 账号分区已有仓库 1（自己的同步结果，无 AI 成果）
    await request(app)
      .put('/api/repositories')
      .set(authHeaders(ACCOUNT_A))
      .send({ repositories: [repoRow(1, 'owner/one')] })
      .expect(200);

    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 111 }) });

    const list = await request(app).get('/api/repositories').set(authHeaders(ACCOUNT_A)).expect(200);
    // 冲突行未跳过：仓库 1 与 2 都在账号分区，default 无残留
    expect(list.body.repositories.map((r: { id: number }) => r.id).sort()).toEqual([1, 2]);
    const repo1 = db.prepare("SELECT * FROM repositories WHERE account_id = '111' AND id = 1").get() as Record<string, unknown>;
    // 目标行（自己的同步结果）保留，缺失的 AI 成果与自定义数据从 default 行补入
    expect(repo1.ai_summary).toBe('legacy-ai');
    expect(JSON.parse(repo1.ai_tags as string)).toEqual(['legacy-tag']);
    expect(repo1.custom_description).toBe('legacy-desc');
    expect(repo1.starred_at).toBe('2025-01-01T00:00:00Z');
    const defaultRepos = db.prepare("SELECT COUNT(*) as total FROM repositories WHERE account_id = 'default'").get() as { total: number };
    expect(defaultRepos.total).toBe(0);

    // release 已读状态合并保留；分类冲突时目标值保留、缺失字段补入
    const release = db.prepare("SELECT is_read FROM releases WHERE account_id = '111' AND id = 50").get() as { is_read: number };
    expect(release.is_read).toBe(1);
    const category = db.prepare("SELECT name, keywords FROM categories WHERE account_id = '111' AND id = 'shared-cat'").get() as { name: string; keywords: string };
    expect(category.name).toBe('Legacy');
    expect(JSON.parse(category.keywords)).toEqual(['legacy-kw']);

    // 认领标记与设置合并：账号已保存的 customCategories 绝不被全局旧值覆盖
    const claimedBy = db.prepare("SELECT value FROM settings WHERE key = 'legacy_default_claimed_by'").get() as { value: string };
    expect(claimedBy.value).toBe(ACCOUNT_A);
    const scopedCategories = db.prepare("SELECT value FROM account_settings WHERE account_id = '111' AND key = 'customCategories'").get() as { value: string };
    expect(JSON.parse(scopedCategories.value)).toEqual(['mine']);
    const scopedToken = db.prepare("SELECT value FROM account_settings WHERE account_id = '111' AND key = 'github_token'").get() as { value: string };
    expect(decrypt(scopedToken.value, encryptionKey)).toBe('token-of-111');
  });

  it('preserves category_locked when claiming legacy rows that conflict by full_name', async () => {
    const db = getDb();
    // 存量 default：仓库已锁定分类并带自定义分类；账号分区已有同 full_name、
    // 不同 id 的仓库（删除后重建），分类未锁定
    db.prepare(`
      INSERT INTO repositories (account_id, id, name, full_name, html_url, owner_login, topics, custom_category, category_locked)
      VALUES ('default', 10, 'legacy-locked', 'owner/rebuilt', 'https://github.com/owner/rebuilt', 'owner', '[]', 'legacy-cat', 1)
    `).run();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('github_token', ?)").run(encrypt('token-of-111', encryptionKey));

    await request(app)
      .put('/api/repositories')
      .set(authHeaders(ACCOUNT_A))
      .send({ repositories: [repoRow(20, 'owner/rebuilt')] })
      .expect(200);

    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 111 }) });

    const list = await request(app).get('/api/repositories').set(authHeaders(ACCOUNT_A)).expect(200);
    // full_name 冲突行未跳过：同 full_name 只保留账号自己的仓库（UNIQUE 约束）
    expect(list.body.repositories.map((r: { id: number }) => r.id)).toEqual([20]);
    const row = db.prepare("SELECT custom_category, category_locked FROM repositories WHERE account_id = '111' AND id = 20").get() as { custom_category: string | null; category_locked: number };
    // 删除 default 行前必须合并：custom_category 补入且 category_locked 保留 1
    expect(row.custom_category).toBe('legacy-cat');
    expect(row.category_locked).toBe(1);
    const defaultRepos = db.prepare("SELECT COUNT(*) as total FROM repositories WHERE account_id = 'default'").get() as { total: number };
    expect(defaultRepos.total).toBe(0);
  });

  it('revalidates the cached legacy identity against the current global token', async () => {
    const db = getDb();
    db.prepare(`
      INSERT INTO repositories (account_id, id, name, full_name, html_url, owner_login, topics)
      VALUES ('default', 1, 'legacy', 'owner/legacy', 'https://github.com/owner/legacy', 'owner', '[]')
    `).run();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('github_token', ?)").run(encrypt('token-of-999', encryptionKey));

    // 第一次身份校验：存量 Token 属于 999（与请求者 222 不符）→ 缓存 999、不认领
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 999 }) });
    await request(app).get('/api/repositories').set(authHeaders(ACCOUNT_B)).expect(200);
    expect(db.prepare("SELECT value FROM settings WHERE key = 'legacy_default_claimed_by'").get()).toBeUndefined();

    // 全局 Token 被换成 222 的 Token（无头设置通道）
    await request(app)
      .put('/api/settings')
      .set({ Authorization: `Bearer ${process.env.API_SECRET}` })
      .send({ github_token: 'token-of-222' })
      .expect(200);

    // 缓存的 999 绑定的是旧 Token：与当前全局 Token 不一致时必须重新校验，
    // 不得沿用旧身份错配新凭证
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 222 }) });
    await request(app).get('/api/repositories').set(authHeaders(ACCOUNT_B)).expect(200);

    const claimedBy = db.prepare("SELECT value FROM settings WHERE key = 'legacy_default_claimed_by'").get() as { value: string };
    expect(claimedBy.value).toBe(ACCOUNT_B);
    const rows = db.prepare('SELECT account_id FROM repositories').all() as Array<{ account_id: string }>;
    expect(rows.map((r) => r.account_id)).toEqual([ACCOUNT_B]);
    const scopedToken = db.prepare("SELECT value FROM account_settings WHERE account_id = '222' AND key = 'github_token'").get() as { value: string };
    expect(decrypt(scopedToken.value, encryptionKey)).toBe('token-of-222');
  });

  it('restores default-partition account-level settings from top-level settings on workspace import', async () => {
    const db = getDb();
    // 默认分区：仓库（使导出包含 default 工作区）+ 仍存于全局表的账号级设置
    db.prepare(`
      INSERT INTO repositories (account_id, id, name, full_name, html_url, owner_login, topics)
      VALUES ('default', 1, 'legacy', 'owner/legacy', 'https://github.com/owner/legacy', 'owner', '[]')
    `).run();
    await request(app)
      .put('/api/settings')
      .set({ Authorization: `Bearer ${process.env.API_SECRET}` })
      .send({ customCategories: ['legacy-cats'], categoryOrder: ['a'] })
      .expect(200);

    const exported = await request(app).post('/api/sync/export').set(authHeaders(ACCOUNT_A)).expect(200);
    expect((exported.body.settings as Record<string, unknown>).customCategories).toBe('["legacy-cats"]');

    wipeDb();
    await request(app)
      .post('/api/sync/import')
      .set(authHeaders(ACCOUNT_B))
      .send(exported.body)
      .expect(200);

    // 默认分区设置恢复进全局表（不能因存在工作区而静默丢弃）
    const global = db.prepare("SELECT value FROM settings WHERE key = 'customCategories'").get() as { value: string };
    expect(JSON.parse(global.value)).toEqual(['legacy-cats']);
    const order = db.prepare("SELECT value FROM settings WHERE key = 'categoryOrder'").get() as { value: string };
    expect(JSON.parse(order.value)).toEqual(['a']);

    // 且不串号：账号 B 查询设置时看不到全局表中的其他账号账号级键
    const fetched = await request(app).get('/api/settings').set(authHeaders(ACCOUNT_B)).expect(200);
    expect(fetched.body.customCategories).toBeUndefined();
  });

  it('encrypts real workspace tokens on import', async () => {
    const payload = {
      account_workspaces: [{
        account_id: '333',
        repositories: [],
        releases: [],
        categories: [],
        account_settings: { github_token: 'plain-workspace-token' },
      }],
    };
    await request(app)
      .post('/api/sync/import')
      .set(authHeaders(ACCOUNT_B))
      .send(payload)
      .expect(200);

    const db = getDb();
    const scoped = db.prepare("SELECT value FROM account_settings WHERE account_id = '333' AND key = 'github_token'").get() as { value: string };
    // 明文 Token 绝不能直接入库：必须以密文存储且可解出原值
    expect(scoped.value).not.toBe('plain-workspace-token');
    expect(decrypt(scoped.value, encryptionKey)).toBe('plain-workspace-token');
  });

  it('restores numeric is_read from server exports in workspace import', async () => {
    const release = {
      id: 7,
      tag_name: 'v1',
      assets: [],
      repo_id: 1,
      repo_full_name: 'owner/one',
      repo_name: 'one',
    };
    await request(app).put('/api/releases').set(authHeaders(ACCOUNT_A)).send({ releases: [release] }).expect(200);
    await request(app).patch('/api/releases/7').set(authHeaders(ACCOUNT_A)).send({ is_read: true }).expect(200);

    const exported = await request(app).post('/api/sync/export').set(authHeaders(ACCOUNT_A)).expect(200);
    const workspaceA = (exported.body.account_workspaces as Array<Record<string, unknown>>).find((w) => w.account_id === ACCOUNT_A);
    const exportedRelease = (workspaceA?.releases as Array<Record<string, unknown>>).find((r) => r.id === 7);
    // 服务端导出序列化为数字 0/1
    expect(exportedRelease?.is_read).toBe(1);

    wipeDb();
    await request(app)
      .post('/api/sync/import')
      .set(authHeaders(ACCOUNT_B))
      .send(exported.body)
      .expect(200);

    const db = getDb();
    const restored = db.prepare("SELECT is_read FROM releases WHERE account_id = '111' AND id = 7").get() as { is_read: number };
    // 数字型已读状态必须按原值恢复，而不是全部落回未读
    expect(restored.is_read).toBe(1);
  });

  it('backfills cross-account AI results on first insert and treats empty arrays as backfillable', async () => {
    const db = getDb();
    const analyzed = (extra: Record<string, unknown> = {}) => ({
      ...repoRow(0, 'placeholder'),
      ...extra,
      ai_summary: 'shared-summary',
      ai_tags: ['shared-tag'],
      ai_platforms: ['chrome'],
      analyzed_at: '2026-01-01T00:00:00Z',
    });

    // 账号 A 已分析仓库 1、3（仓库 2 尚无任何分析）
    await request(app)
      .put('/api/repositories')
      .set(authHeaders(ACCOUNT_A))
      .send({
        repositories: [
          analyzed({ ...repoRow(1, 'owner/one') }),
          analyzed({ ...repoRow(3, 'owner/three') }),
        ],
      })
      .expect(200);

    // 账号 B 首次同步仓库 1（无 AI 字段）：INSERT 路径也必须复用成果
    await request(app)
      .put('/api/repositories')
      .set(authHeaders(ACCOUNT_B))
      .send({ repositories: [repoRow(1, 'owner/one')] })
      .expect(200);
    const b1 = db.prepare("SELECT * FROM repositories WHERE account_id = '222' AND id = 1").get() as Record<string, unknown>;
    expect(b1.ai_summary).toBe('shared-summary');
    expect(JSON.parse(b1.ai_tags as string)).toEqual(['shared-tag']);
    expect(JSON.parse(b1.ai_platforms as string)).toEqual(['chrome']);
    expect(b1.analyzed_at).toBe('2026-01-01T00:00:00Z');

    // 账号 B 先以空数组入库仓库 2（此刻尚无捐赠者）；A 分析后 B 再次同步
    // （UPDATE 路径）：'[]' 也必须视为可回填
    await request(app)
      .put('/api/repositories')
      .set(authHeaders(ACCOUNT_B))
      .send({ repositories: [repoRow(2, 'owner/two')] })
      .expect(200);
    const b2Before = db.prepare("SELECT ai_summary FROM repositories WHERE account_id = '222' AND id = 2").get() as { ai_summary: string | null };
    expect(b2Before.ai_summary).toBeNull();

    await request(app)
      .put('/api/repositories')
      .set(authHeaders(ACCOUNT_A))
      .send({ repositories: [analyzed({ ...repoRow(2, 'owner/two') })] })
      .expect(200);
    await request(app)
      .put('/api/repositories')
      .set(authHeaders(ACCOUNT_B))
      .send({ repositories: [repoRow(2, 'owner/two')] })
      .expect(200);
    const b2 = db.prepare("SELECT * FROM repositories WHERE account_id = '222' AND id = 2").get() as Record<string, unknown>;
    expect(b2.ai_summary).toBe('shared-summary');
    expect(JSON.parse(b2.ai_tags as string)).toEqual(['shared-tag']);

    // 账号 B 已有自己的非空 AI 值时绝不被覆盖（缺省字段 '[]' 可回填）
    await request(app)
      .put('/api/repositories')
      .set(authHeaders(ACCOUNT_B))
      .send({ repositories: [{ ...repoRow(4, 'owner/four'), ai_summary: 'own-summary' }] })
      .expect(200);
    await request(app)
      .put('/api/repositories')
      .set(authHeaders(ACCOUNT_A))
      .send({ repositories: [analyzed({ ...repoRow(4, 'owner/four') })] })
      .expect(200);
    await request(app)
      .put('/api/repositories')
      .set(authHeaders(ACCOUNT_B))
      .send({ repositories: [repoRow(4, 'owner/four')] })
      .expect(200);
    const b4 = db.prepare("SELECT * FROM repositories WHERE account_id = '222' AND id = 4").get() as Record<string, unknown>;
    expect(b4.ai_summary).toBe('own-summary');
    expect(JSON.parse(b4.ai_tags as string)).toEqual(['shared-tag']);
  });
});
