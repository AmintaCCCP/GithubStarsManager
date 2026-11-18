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
  let resetLegacyOwnerResolutionState: (db: import('better-sqlite3').Database) => void;

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
    const accountScope = await import('../../src/db/accountScope.js');
    const index = await import('../../src/index.js');
    const supertest = await import('supertest');

    request = supertest.default;
    getDb = conn.getDb;
    encrypt = crypto.encrypt;
    decrypt = crypto.decrypt;
    encryptionKey = configModule.config.encryptionKey;
    resetLegacyOwnerResolutionState = accountScope.resetLegacyOwnerResolutionState;

    const db = conn.getDb();
    migrations.runMigrations(db);
    app = index.createApp();
  });

  beforeEach(() => {
    fetchMock.mockReset();
    proxyRequestMock.mockReset();
    proxyRequestMock.mockResolvedValue({ status: 200, data: { ok: true }, headers: {} });
    wipeDb();
    // 认领身份校验的内存态（失败负缓存 / 进行中去重 Promise）随库清空一起重置
    resetLegacyOwnerResolutionState(getDb());
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

  it('rejects headerless full syncs when multiple accounts exist (legacy client safety)', async () => {
    const db = getDb();
    await request(app)
      .put('/api/repositories')
      .set(authHeaders(ACCOUNT_A))
      .send({ isFullSync: true, repositories: [repoRow(1, 'owner/one')] })
      .expect(200);
    await request(app)
      .put('/api/repositories')
      .set(authHeaders(ACCOUNT_B))
      .send({ isFullSync: true, repositories: [repoRow(2, 'owner/two')] })
      .expect(200);
    // 新客户端把全局活跃账号切到 B；旧客户端（无账号头）仍发送 A 的快照。
    db.prepare("INSERT INTO accounts (account_id, user_json) VALUES (?, ?)")
      .run(ACCOUNT_A, JSON.stringify({ id: 111 }));
    db.prepare("INSERT INTO accounts (account_id, user_json) VALUES (?, ?)")
      .run(ACCOUNT_B, JSON.stringify({ id: 222 }));
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('active_account_id', ?)")
      .run(ACCOUNT_B);

    await request(app)
      .put('/api/repositories')
      .set(authHeaders())
      .send({ isFullSync: true, repositories: [repoRow(1, 'owner/one')] })
      .expect(409)
      .expect((res) => expect(res.body.code).toBe('ACCOUNT_SCOPE_REQUIRED'));

    const listB = await request(app).get('/api/repositories').set(authHeaders(ACCOUNT_B)).expect(200);
    expect(listB.body.repositories.map((r: { id: number }) => r.id)).toEqual([2]);
  });

  it('does not let the legacy claim marker authorize a headerless full sync', async () => {
    const db = getDb();
    await request(app)
      .put('/api/repositories')
      .set(authHeaders(ACCOUNT_A))
      .send({ isFullSync: true, repositories: [repoRow(1, 'owner/one')] })
      .expect(200);
    await request(app)
      .put('/api/repositories')
      .set(authHeaders(ACCOUNT_B))
      .send({ isFullSync: true, repositories: [repoRow(2, 'owner/two')] })
      .expect(200);
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('legacy_default_claimed_by', ?)").run(ACCOUNT_A);
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('active_account_id', ?)").run(ACCOUNT_A);

    // 认领标记只证明存量数据归属，不能证明无头请求属于 A：多分区仍须拒绝
    await request(app)
      .put('/api/repositories')
      .set(authHeaders())
      .send({ isFullSync: true, repositories: [repoRow(1, 'owner/one')] })
      .expect(409)
      .expect((res) => expect(res.body.code).toBe('ACCOUNT_SCOPE_REQUIRED'));

    const listB = await request(app).get('/api/repositories').set(authHeaders(ACCOUNT_B)).expect(200);
    expect(listB.body.repositories.map((r: { id: number }) => r.id)).toEqual([2]);
  });

  it('keeps an already-chosen active account when legacy data is claimed', async () => {
    const db = getDb();
    db.prepare(`
      INSERT INTO repositories (account_id, id, name, full_name, html_url, owner_login, topics)
      VALUES ('default', 1, 'legacy', 'owner/legacy', 'https://github.com/owner/legacy', 'owner', '[]')
    `).run();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('github_token', ?)")
      .run(encrypt('legacy-token', encryptionKey));
    // 用户已显式切到另一个账号
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('active_account_id', ?)").run(ACCOUNT_B);
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 111 }) });

    await request(app).get('/api/repositories').set(authHeaders(ACCOUNT_A)).expect(200);

    const claimedBy = db.prepare("SELECT value FROM settings WHERE key = 'legacy_default_claimed_by'").get() as { value: string };
    expect(claimedBy.value).toBe(ACCOUNT_A);
    const active = db.prepare("SELECT value FROM settings WHERE key = 'active_account_id'").get() as { value: string };
    expect(active.value).toBe(ACCOUNT_B);
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
    const releaseRows = db.prepare('SELECT id, account_id FROM releases').all() as Array<{ id: number; account_id: string }>;
    expect(releaseRows).toEqual([{ id: 50, account_id: '111' }]);
    const categoryRows = db.prepare('SELECT id, account_id FROM categories').all() as Array<{ id: string; account_id: string }>;
    expect(categoryRows).toEqual([{ id: 'custom-legacy', account_id: '111' }]);

    const claimedBy = db.prepare("SELECT value FROM settings WHERE key = 'legacy_default_claimed_by'").get() as { value: string };
    expect(claimedBy.value).toBe('111');
    const active = db.prepare("SELECT value FROM settings WHERE key = 'active_account_id'").get() as { value: string };
    expect(active.value).toBe('111');
    const scopedToken = db.prepare("SELECT value FROM account_settings WHERE account_id = '111' AND key = 'github_token'").get() as { value: string };
    expect(decrypt(scopedToken.value, encryptionKey)).toBe('legacy-token');
  });

  it('merges legacy default data into an existing account row by full_name (rebuilt repo id)', async () => {
    const db = getDb();
    // 存量 default 行（旧 id=1）与目标账号同 full_name 的新行（id=2，仓库重建）
    db.prepare(`
      INSERT INTO repositories (account_id, id, name, full_name, html_url, owner_login, topics, ai_summary, custom_tags)
      VALUES ('default', 1, 'legacy', 'owner/rebuilt', 'https://github.com/owner/rebuilt', 'owner', '[]', 'legacy-ai', '["legacy-tag"]')
    `).run();
    db.prepare(`
      INSERT INTO repositories (account_id, id, name, full_name, html_url, owner_login, topics)
      VALUES ('222', 2, 'rebuilt', 'owner/rebuilt', 'https://github.com/owner/rebuilt', 'owner', '[]')
    `).run();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('github_token', ?)").run(encrypt('legacy-token', encryptionKey));
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 222 }) });

    await request(app).get('/api/repositories').set(authHeaders('222')).expect(200);

    const merged = db.prepare("SELECT ai_summary, custom_tags FROM repositories WHERE account_id = '222' AND id = 2")
      .get() as { ai_summary: string | null; custom_tags: string | null };
    expect(merged.ai_summary).toBe('legacy-ai');
    expect(merged.custom_tags).toBe('["legacy-tag"]');
    const leftover = db.prepare("SELECT COUNT(*) AS total FROM repositories WHERE account_id = 'default'").get() as { total: number };
    expect(leftover.total).toBe(0);
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

  it('shares one in-flight identity check across concurrent requests (fetch called once)', async () => {
    const db = getDb();
    db.prepare(`
      INSERT INTO repositories (account_id, id, name, full_name, html_url, owner_login, topics)
      VALUES ('default', 1, 'legacy', 'owner/legacy', 'https://github.com/owner/legacy', 'owner', '[]')
    `).run();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('github_token', ?)").run(encrypt('legacy-token', encryptionKey));

    // 收集每个 fetch 调用的 resolver：即使去重失效也不会悬挂，计数断言会明确报错
    const releaseFetches: Array<(value: { ok: boolean; status: number; json: () => Promise<{ id: number }> }) => void> = [];
    fetchMock.mockImplementation(() => new Promise((resolve) => { releaseFetches.push(resolve); }));

    // supertest 的 Test 是 thenable：挂接 .then 才会真正发送请求。两个请求并发
    // 进入认领中间件，应共享同一次进行中的 /user 校验。
    const first = request(app).get('/api/repositories').set(authHeaders('111'))
      .expect(200).then((r) => r, (e) => { throw e; });
    const second = request(app).get('/api/repositories').set(authHeaders('111'))
      .expect(200).then((r) => r, (e) => { throw e; });

    try {
      // 两个并发请求共享同一次进行中的 /user 校验
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      await Promise.resolve();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      for (const release of releaseFetches) release({ ok: true, status: 200, json: async () => ({ id: 111 }) });
      await Promise.allSettled([first, second]);
    }
    await Promise.all([first, second]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    // 共享校验完成后认领照常完成（并发下的二次确认保证只认领一次）
    expect((db.prepare("SELECT value FROM settings WHERE key = 'legacy_default_claimed_by'").get() as { value: string }).value).toBe('111');
  });

  it('does not resend the identity check while the failure negative cache is fresh', async () => {
    const db = getDb();
    db.prepare(`
      INSERT INTO repositories (account_id, id, name, full_name, html_url, owner_login, topics)
      VALUES ('default', 1, 'legacy', 'owner/legacy', 'https://github.com/owner/legacy', 'owner', '[]')
    `).run();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('github_token', ?)").run(encrypt('legacy-token', encryptionKey));

    // 第一次校验网络失败：归属未确立，业务请求照常
    fetchMock.mockRejectedValueOnce(new Error('identity check unavailable'));
    await request(app).get('/api/repositories').set(authHeaders('111')).expect(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(db.prepare("SELECT value FROM settings WHERE key = 'legacy_default_claimed_by'").get()).toBeUndefined();

    // 负缓存 TTL 窗口内重试：不重发网络请求，default 数据保持未认领
    await request(app).get('/api/repositories').set(authHeaders('111')).expect(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // TTL 过期后允许重试：重试成功即完成认领
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 111 }) });
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000);
    try {
      await request(app).get('/api/repositories').set(authHeaders('111')).expect(200);
    } finally {
      nowSpy.mockRestore();
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((db.prepare("SELECT value FROM settings WHERE key = 'legacy_default_claimed_by'").get() as { value: string }).value).toBe('111');
  });

  it('skips the identity network call when the default partition has no rows to claim', async () => {
    const db = getDb();
    // 认领未发生、全局 Token 已配置，但 default 分区（含 account_settings）无任何行：
    // 无可认领数据 → 不发起网络请求、不写认领标记
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('github_token', ?)").run(encrypt('ready-token', encryptionKey));
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 111 }) });

    await request(app).get('/api/repositories').set(authHeaders('111')).expect(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.prepare("SELECT value FROM settings WHERE key = 'legacy_default_claimed_by'").get()).toBeUndefined();

    // 之后 default 分区出现待认领数据（旧客户端 / 无头请求写入）：认领流程自然恢复
    db.prepare(`
      INSERT INTO repositories (account_id, id, name, full_name, html_url, owner_login, topics)
      VALUES ('default', 1, 'legacy', 'owner/legacy', 'https://github.com/owner/legacy', 'owner', '[]')
    `).run();
    await request(app).get('/api/repositories').set(authHeaders('111')).expect(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((db.prepare("SELECT value FROM settings WHERE key = 'legacy_default_claimed_by'").get() as { value: string }).value).toBe('111');
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

    // 多账号共存时无头代理请求不得擅自回退全局/其他账号 Token，必须拒绝 409
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('github_token', ?)").run(encrypt('global-token', encryptionKey));
    await request(app)
      .post('/api/proxy/github/user')
      .set({ Authorization: `Bearer ${process.env.API_SECRET}` })
      .send({ method: 'GET' })
      .expect(409)
      .expect((res) => expect(res.body.code).toBe('ACCOUNT_SCOPE_REQUIRED'));

    // 单账号/纯 default 库时无头代理请求可回退全局 settings
    db.prepare('DELETE FROM account_settings').run();
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

  it('skips account entries without identity instead of aborting the whole import', async () => {
    // 手工编辑/第三方备份可能缺少 user_json：NOT NULL 违约会让整个事务回滚，
    // 同一 payload 里合法的仓库也一起丢失。该条目应被跳过。
    await request(app)
      .post('/api/sync/import')
      .set(authHeaders())
      .send({
        accounts: [{ account_id: '42' }],
        repositories: [repoRow(3, 'owner/three')],
      })
      .expect(200);

    const rows = getDb()
      .prepare("SELECT id FROM repositories WHERE account_id = 'default'")
      .all() as Array<{ id: number }>;
    expect(rows).toEqual([{ id: 3 }]);
  });

  it('excludes internal account-state keys from export settings (no token ciphertext leak)', async () => {
    const db = getDb();
    // 内部账号状态键 + 全局 Token：导出的 settings 绝不包含前者
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('active_account_id', '222')").run();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('legacy_default_claimed_by', '222')").run();
    const legacyOwnerCiphertext = encrypt('legacy-owner-ciphertext', encryptionKey);
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('legacy_default_owner_id', ?)")
      .run(JSON.stringify({ ownerId: '222', token: legacyOwnerCiphertext }));
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('github_token', ?)").run(encrypt('plain-global-token', encryptionKey));

    // 账号 A 有自己的分区凭据（导出包含其 workspace account_settings）
    await request(app)
      .put('/api/settings')
      .set(authHeaders(ACCOUNT_A))
      .send({ github_token: 'token-a', user_profile: { id: 111, login: 'alice', avatar_url: 'https://x/a.png' } })
      .expect(200);

    const exported = await request(app).post('/api/sync/export').set(authHeaders(ACCOUNT_A)).expect(200);
    const settings = exported.body.settings as Record<string, unknown>;
    expect(settings.active_account_id).toBeUndefined();
    expect(settings.legacy_default_claimed_by).toBeUndefined();
    expect(settings.legacy_default_owner_id).toBeUndefined();
    // 普通键与脱敏后的 github_token 照常导出
    expect(settings.github_token).toMatch(/^\*\*\*/);
    // legacy_default_owner_id 内的全局 Token 密文绝不随备份带出
    expect(JSON.stringify(exported.body)).not.toContain(legacyOwnerCiphertext);
    expect(JSON.stringify(exported.body)).not.toContain('legacy-owner-ciphertext');
    // workspace account_settings 只存账号级键：内部键不会出现在任何工作区中
    for (const ws of exported.body.account_workspaces as Array<Record<string, unknown>>) {
      const wsSettings = ws.account_settings as Record<string, unknown>;
      expect(wsSettings.active_account_id).toBeUndefined();
      expect(wsSettings.legacy_default_claimed_by).toBeUndefined();
      expect(wsSettings.legacy_default_owner_id).toBeUndefined();
    }
  });

  it('does not overwrite internal account-state keys on import (legacy backups included)', async () => {
    const db = getDb();
    // 目标服务器自身的内部状态
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('active_account_id', '222')").run();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('legacy_default_claimed_by', '222')").run();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('legacy_default_owner_id', ?)")
      .run(JSON.stringify({ ownerId: '222', token: 'target-owner-ciphertext' }));

    // 旧备份内含内部键（v1 与多账号格式都可能出现）：导入必须跳过，绝不覆盖目标状态
    await request(app)
      .post('/api/sync/import')
      .set(authHeaders(ACCOUNT_A))
      .send({
        settings: {
          active_account_id: '111',
          legacy_default_claimed_by: '111',
          legacy_default_owner_id: JSON.stringify({ ownerId: '111', token: 'backup-owner-ciphertext' }),
          activeAIConfig: 'restored-config',
        },
      })
      .expect(200);

    expect((db.prepare("SELECT value FROM settings WHERE key = 'active_account_id'").get() as { value: string }).value).toBe('222');
    expect((db.prepare("SELECT value FROM settings WHERE key = 'legacy_default_claimed_by'").get() as { value: string }).value).toBe('222');
    expect((db.prepare("SELECT value FROM settings WHERE key = 'legacy_default_owner_id'").get() as { value: string }).value)
      .toBe(JSON.stringify({ ownerId: '222', token: 'target-owner-ciphertext' }));
    // 非内部键照常导入（activeAIConfig 非账号级 → 全局表）
    expect((db.prepare("SELECT value FROM settings WHERE key = 'activeAIConfig'").get() as { value: string }).value).toBe('restored-config');
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

  it('clears the accounts credential copy when an imported top-level github_token is explicitly empty', async () => {
    const db = getDb();
    await request(app)
      .put('/api/settings')
      .set(authHeaders(ACCOUNT_A))
      .send({ github_token: 'token-a' })
      .expect(200);

    // v1 顶层导入：settings.github_token 显式清空（''，非掩码）
    await request(app)
      .post('/api/sync/import')
      .set(authHeaders(ACCOUNT_A))
      .send({ settings: { github_token: '' } })
      .expect(200);

    const scoped = db.prepare("SELECT value FROM account_settings WHERE account_id = '111' AND key = 'github_token'").get() as { value: string | null };
    expect(scoped.value).toBe('');
    // 与 configs.ts 显式清空语义一致：accounts 的加密凭据副本必须同步清空，
    // 否则 readScopedToken / readAccountRows / proxy 的 accounts 回退会让旧 Token 复活
    const accountRow = db.prepare('SELECT github_token_encrypted FROM accounts WHERE account_id = ?').get(ACCOUNT_A) as { github_token_encrypted: string | null };
    expect(accountRow.github_token_encrypted).toBeNull();

    // 防御纵深：即使 accounts 残留旧凭据副本，显式清空记录也不允许 Token 复活
    db.prepare('UPDATE accounts SET github_token_encrypted = ? WHERE account_id = ?')
      .run(encrypt('stale-token', encryptionKey), ACCOUNT_A);
    const restored = await request(app).post('/api/sync/auth').set(authHeaders(ACCOUNT_A)).expect(200);
    expect(restored.body.github_token).toBeNull();
    const listed = (restored.body.accounts as Array<{ accountId: string; githubToken: string | null }>)
      .find((a) => a.accountId === ACCOUNT_A);
    expect(listed?.githubToken).toBeNull();
  });

  it('clears the accounts credential copy when a workspace imports an explicitly empty github_token', async () => {
    const db = getDb();
    await request(app)
      .put('/api/settings')
      .set(authHeaders(ACCOUNT_A))
      .send({ github_token: 'token-a' })
      .expect(200);

    // 多账号工作区导入：账号 A 工作区显式携带空 Token（null）
    await request(app)
      .post('/api/sync/import')
      .set(authHeaders(ACCOUNT_B))
      .send({
        account_workspaces: [{
          account_id: ACCOUNT_A,
          repositories: [],
          releases: [],
          categories: [],
          account_settings: { github_token: null },
        }],
      })
      .expect(200);

    const scoped = db.prepare("SELECT value FROM account_settings WHERE account_id = '111' AND key = 'github_token'").get() as { value: string | null };
    expect(scoped.value).toBeNull();
    const accountRow = db.prepare('SELECT github_token_encrypted FROM accounts WHERE account_id = ?').get(ACCOUNT_A) as { github_token_encrypted: string | null };
    expect(accountRow.github_token_encrypted).toBeNull();

    // 已清空的 Token 不得经恢复通道复活
    const restored = await request(app).post('/api/sync/auth').set(authHeaders(ACCOUNT_A)).expect(200);
    expect(restored.body.github_token).toBeNull();
  });

  it('keeps the accounts credential copy when a workspace imports a masked github_token', async () => {
    const db = getDb();
    await request(app)
      .put('/api/settings')
      .set(authHeaders(ACCOUNT_A))
      .send({ github_token: 'token-a' })
      .expect(200);

    // 掩码 Token（'***' 前缀）不是显式清空：库中已有凭据必须原样保留
    await request(app)
      .post('/api/sync/import')
      .set(authHeaders(ACCOUNT_B))
      .send({
        account_workspaces: [{
          account_id: ACCOUNT_A,
          account_settings: { github_token: '***en-a' },
        }],
      })
      .expect(200);

    const accountRow = db.prepare('SELECT github_token_encrypted FROM accounts WHERE account_id = ?').get(ACCOUNT_A) as { github_token_encrypted: string | null };
    expect(accountRow.github_token_encrypted).not.toBeNull();
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

    // 失败负缓存覆盖 60s 窗口；此处模拟窗口过后网络恢复的重试（测试内直接重置
    // 内存态，等待真实 TTL 会拖慢测试）
    resetLegacyOwnerResolutionState(getDb());
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

    // 上面的首次请求在 fetch 无 mock 时校验失败并进入负缓存；此处模拟负缓存窗口
    // 过后网络恢复的重试（测试内直接重置内存态，等待真实 TTL 会拖慢测试）
    resetLegacyOwnerResolutionState(getDb());
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

  it('does not transfer legacy default data when the global token is swapped to another account', async () => {
    const db = getDb();
    db.prepare(`
      INSERT INTO repositories (account_id, id, name, full_name, html_url, owner_login, topics)
      VALUES ('default', 1, 'legacy', 'owner/legacy', 'https://github.com/owner/legacy', 'owner', '[]')
    `).run();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('github_token', ?)").run(encrypt('token-of-999', encryptionKey));

    // 第一次身份校验：存量 Token 属于 999（与请求者 222 不符）→ 已验证所有者确立为 999、不认领
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 999 }) });
    await request(app).get('/api/repositories').set(authHeaders(ACCOUNT_B)).expect(200);
    expect(db.prepare("SELECT value FROM settings WHERE key = 'legacy_default_claimed_by'").get()).toBeUndefined();

    // 全局 Token 被换成 222 的 Token（无头设置通道）
    await request(app)
      .put('/api/settings')
      .set({ Authorization: `Bearer ${process.env.API_SECRET}` })
      .send({ github_token: 'token-of-222' })
      .expect(200);

    // 已验证的数据所有者（999）与可替换的全局 Token 解耦：不得因换绑 Token 重新
    // 判定归属，222 绝不能据此认领原属 999 的存量数据
    const fetchCallsBefore = fetchMock.mock.calls.length;
    await request(app).get('/api/repositories').set(authHeaders(ACCOUNT_B)).expect(200);

    expect(db.prepare("SELECT value FROM settings WHERE key = 'legacy_default_claimed_by'").get()).toBeUndefined();
    const rows = db.prepare('SELECT account_id FROM repositories').all() as Array<{ account_id: string }>;
    expect(rows.map((r) => r.account_id)).toEqual(['default']);
    // 认领判定只认已验证所有者：不得依据换绑后的 Token 重新发起身份校验
    expect(fetchMock.mock.calls.length).toBe(fetchCallsBefore);
    // 222 分区既未收到存量数据，也未收到任何全局凭据 / 账号级设置
    expect(db.prepare('SELECT COUNT(*) as total FROM account_settings WHERE account_id = ?').get(ACCOUNT_B) as { total: number })
      .toMatchObject({ total: 0 });
  });

  it('still claims legacy default data for the verified owner after a same-account token rotation', async () => {
    const db = getDb();
    db.prepare(`
      INSERT INTO repositories (account_id, id, name, full_name, html_url, owner_login, topics)
      VALUES ('default', 1, 'legacy', 'owner/legacy', 'https://github.com/owner/legacy', 'owner', '[]')
    `).run();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('github_token', ?)").run(encrypt('token-of-999', encryptionKey));

    // 先由其他账号触发首次校验：归属确立为 999（请求者 222 被拒绝）
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 999 }) });
    await request(app).get('/api/repositories').set(authHeaders(ACCOUNT_B)).expect(200);

    // 999 同账号轮换 Token（无头通道换绑全局 Token）
    await request(app)
      .put('/api/settings')
      .set({ Authorization: `Bearer ${process.env.API_SECRET}` })
      .send({ github_token: 'token-of-999-rotated' })
      .expect(200);

    // 已验证归属不随 Token 轮换改变：999 携带账号头登录仍可认领存量数据
    const list = await request(app).get('/api/repositories').set(authHeaders('999')).expect(200);
    expect(list.body.repositories.map((r: { id: number }) => r.id)).toEqual([1]);

    const claimedBy = db.prepare("SELECT value FROM settings WHERE key = 'legacy_default_claimed_by'").get() as { value: string };
    expect(claimedBy.value).toBe('999');
    const rows = db.prepare('SELECT account_id FROM repositories').all() as Array<{ account_id: string }>;
    expect(rows.map((r) => r.account_id)).toEqual(['999']);
    // 轮换后的全局 Token 与验证时绑定的 Token 不一致：绝不把来源无法证明的
    // 凭据复制进认领账号的分区
    expect(db.prepare("SELECT value FROM account_settings WHERE account_id = '999' AND key = 'github_token'").get()).toBeUndefined();
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

  it('refuses to write an unverifiable default workspace into the target default partition', async () => {
    const db = getDb();
    await request(app)
      .post('/api/sync/import')
      .set(authHeaders(ACCOUNT_B))
      .send({
        account_workspaces: [{
          account_id: 'default',
          repositories: [repoRow(7, 'owner/legacy')],
          categories: [{ id: 'legacy-cat', name: 'Legacy' }],
          account_settings: { customCategories: '["legacy"]' },
        }],
      })
      .expect(200);

    // 目标服务器的 default 分区可被首个登录账号自动认领：来源归属无法核验时
    // 绝不写入（否则会串号到其他账号）。
    expect(db.prepare("SELECT COUNT(*) as total FROM repositories WHERE account_id = 'default'").get())
      .toMatchObject({ total: 0 });
    expect(db.prepare("SELECT COUNT(*) as total FROM categories WHERE account_id = 'default'").get())
      .toMatchObject({ total: 0 });
    expect(db.prepare("SELECT value FROM settings WHERE key = 'customCategories'").get()).toBeUndefined();
    expect(db.prepare("SELECT value FROM account_settings WHERE account_id = 'default' AND key = 'customCategories'").get())
      .toBeUndefined();
  });

  it('restores a default workspace settings into the global settings table', async () => {
    const db = getDb();
    // 无账号头且全局无 active_account_id：请求本身就在 default 分区，归属可核验。
    await request(app)
      .post('/api/sync/import')
      .set(authHeaders())
      .send({
        account_workspaces: [{
          account_id: 'default',
          account_settings: { customCategories: '["legacy"]' },
        }],
      })
      .expect(200);

    const global = db.prepare("SELECT value FROM settings WHERE key = 'customCategories'").get() as { value: string };
    expect(JSON.parse(global.value)).toEqual(['legacy']);
    // default 分区的读取路径是全局 settings 表，account_settings 不得留下副本。
    expect(db.prepare("SELECT value FROM account_settings WHERE account_id = 'default' AND key = 'customCategories'").get())
      .toBeUndefined();
  });

  it('background token writes do not rewrite the active account', async () => {
    const db = getDb();
    await request(app)
      .put('/api/settings')
      .set(authHeaders(ACCOUNT_B))
      .send({ user_profile: { id: Number(ACCOUNT_B), login: 'bob' } })
      .expect(200);

    // 设备 2 已切到 B；设备 1 迟到的后台 Token 补写（只有凭据）不得拽回 A
    await request(app)
      .put('/api/settings')
      .set(authHeaders(ACCOUNT_A))
      .send({ github_token: '{{SECRET_5xe7lbqm}}' })
      .expect(200);

    expect(db.prepare("SELECT value FROM settings WHERE key = 'active_account_id'").get())
      .toMatchObject({ value: ACCOUNT_B });
  });

  it('rejects headerless incremental repository writes when partitions are ambiguous', async () => {
    const db = getDb();
    await request(app)
      .put('/api/settings')
      .set(authHeaders(ACCOUNT_B))
      .send({ user_profile: { id: Number(ACCOUNT_B), login: 'bob' } })
      .expect(200);
    await request(app).put('/api/repositories').set(authHeaders(ACCOUNT_A))
      .send({ isFullSync: true, repositories: [repoRow(1, 'owner/one')] }).expect(200);
    await request(app).put('/api/repositories').set(authHeaders(ACCOUNT_B))
      .send({ isFullSync: true, repositories: [repoRow(1, 'owner/one')] }).expect(200);

    // 增量写入同样带不上分区归属：拒绝覆盖另一个账号同 ID 仓库的自定义字段
    await request(app)
      .put('/api/repositories')
      .set(authHeaders())
      .send({ repositories: [repoRow(1, 'owner/one', { custom_description: 'hijack' })] })
      .expect(409);
    const rows = db.prepare('SELECT account_id, custom_description FROM repositories').all() as Array<{ account_id: string; custom_description: string | null }>;
    expect(rows.every((row) => row.custom_description === null)).toBe(true);
  });

  it('counts release-only partitions when judging headerless ambiguity', async () => {
    const db = getDb();
    await request(app)
      .put('/api/settings')
      .set(authHeaders(ACCOUNT_B))
      .send({ user_profile: { id: Number(ACCOUNT_B), login: 'bob' } })
      .expect(200);
    db.prepare(`
      INSERT INTO releases (account_id, id, tag_name, repo_id, repo_full_name, repo_name)
      VALUES (?, 50, 'v1', 1, 'owner/x', 'x')
    `).run(ACCOUNT_A);

    await request(app).post('/api/releases/mark-all-read').set(authHeaders()).expect(400);
    await request(app).post('/api/releases/mark-all-read').set(authHeaders(ACCOUNT_A)).expect(200);
  });

  it('skips account metadata whose user id does not match account_id', async () => {
    const db = getDb();
    await request(app)
      .post('/api/sync/import')
      .set(authHeaders(ACCOUNT_A))
      .send({
        accounts: [{ account_id: ACCOUNT_A, user_json: { id: Number(ACCOUNT_B), login: 'bob' } }],
      })
      .expect(200);

    expect(db.prepare('SELECT account_id FROM accounts WHERE account_id = ?').get(ACCOUNT_A)).toBeUndefined();
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
