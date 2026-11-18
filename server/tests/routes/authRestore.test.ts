import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

const getDbMock = vi.fn();

vi.mock('../../src/db/connection.js', () => ({
  getDb: () => getDbMock(),
}));

// A35/A36：三个凭据来源（全局 settings、accounts 副本、account_settings）使用
// 互不相同的合成值，断言可以区分凭据到底来自哪一层。
vi.mock('../../src/services/crypto.js', () => ({
  decrypt: (value: string) => {
    const known: Record<string, string> = {
      'encrypted-global': 'plain-global-token',
      'encrypted-account-copy': 'plain-account-token',
      'encrypted-scoped': 'plain-scoped-token',
      'encrypted-token': 'github-token',
    };
    if (known[value]) return known[value];
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

interface MockDbOptions {
  /** settings.github_token 行（全局来源）；undefined 表示无该行 */
  globalTokenRow?: { value: string };
  /** accounts 表列表（readAccountRows 的 .all） */
  accountsRows?: Array<Record<string, unknown>>;
  /** accounts 表按 account_id 的定向 get（readScopedToken 的副本来源） */
  accountRow?: Record<string, unknown>;
  /** account_settings.github_token 定向行（账号设置来源）；undefined = 缺失 */
  scopedTokenRow?: { value: string | null };
  /** account_settings 凭据列表（A18 合并查询的 .all） */
  scopedCredentialRows?: Array<{ account_id: string; value: string | null }>;
}

/**
 * 按 SQL 形态分发的轻量 DB mock：accounts 列表 / account_settings 定向 get /
 * account_settings 凭据列表（A18 合并）/ accounts 定向 get / 全局 settings。
 */
function makeMockDb(options: MockDbOptions = {}) {
  return {
    prepare: (sql: string) => {
      if (sql.includes('FROM accounts ORDER BY')) {
        return { all: () => options.accountsRows ?? [], get: () => undefined };
      }
      if (sql.includes('account_settings') && sql.includes("account_id != 'default'")) {
        return { all: () => options.scopedCredentialRows ?? [], get: () => undefined };
      }
      if (sql.includes('account_settings')) {
        return { get: () => options.scopedTokenRow, all: () => [] };
      }
      if (sql.includes('FROM accounts WHERE')) {
        return { get: () => options.accountRow, all: () => [] };
      }
      return {
        get: (key: string) => (key === 'github_token' ? options.globalTokenRow : undefined),
        all: () => [],
      };
    },
  };
}

describe('authRestore route (POST /api/sync/auth)', () => {
  it('returns the decrypted GitHub token when stored', async () => {
    getDbMock.mockReturnValue(makeMockDb({ globalTokenRow: { value: 'encrypted-token' } }));

    const res = await request(createTestApp()).post('/api/sync/auth').expect(200);
    // 多账号扩展新增 active_account_id / accounts 字段；兼容字段子集断言
    expect(res.body).toMatchObject({ github_token: 'github-token' });
    expect(res.body.active_account_id).toBe('default');
    expect(res.body.accounts).toEqual([]);
  });

  it('returns null github_token when none is stored', async () => {
    getDbMock.mockReturnValue(makeMockDb());

    const res = await request(createTestApp()).post('/api/sync/auth').expect(200);
    expect(res.body).toMatchObject({ github_token: null });
  });

  it('returns null github_token instead of leaking plaintext on decrypt failure', async () => {
    getDbMock.mockReturnValue(makeMockDb({ globalTokenRow: { value: 'unreadable' } }));

    const res = await request(createTestApp()).post('/api/sync/auth').expect(200);
    expect(res.body).toMatchObject({ github_token: null });
  });

  it('returns the backend account list when the accounts table holds rows (A36: distinct credential sources)', async () => {
    // A36：全局凭据与账号凭据解密为不同值——顶层（default 分区回退全局）与
    // accounts[0]（账号自身凭据）分别断言。
    getDbMock.mockReturnValue(makeMockDb({
      globalTokenRow: { value: 'encrypted-global' },
      accountsRows: [{
        account_id: '1001',
        user_json: JSON.stringify({ id: 1001, login: 'alice', avatar_url: 'https://x/a.png' }),
        github_token_encrypted: 'encrypted-account-copy',
        added_at: '2026-01-01T00:00:00Z',
        last_used_at: '2026-01-02T00:00:00Z',
      }],
      accountRow: { github_token_encrypted: 'encrypted-account-copy' },
    }));

    const res = await request(createTestApp()).post('/api/sync/auth').expect(200);
    expect(res.body.github_token).toBe('plain-global-token');
    expect(res.body.accounts).toHaveLength(1);
    expect(res.body.accounts[0]).toMatchObject({
      accountId: '1001',
      githubToken: 'plain-account-token',
    });
    expect(res.body.accounts[0].user).toMatchObject({ login: 'alice' });
  });

  it('prefers the account_settings credential for the targeted restore and the account list (A35: present)', async () => {
    // 三来源并存：账号设置优先于 accounts 副本与全局 Token
    getDbMock.mockReturnValue(makeMockDb({
      globalTokenRow: { value: 'encrypted-global' },
      accountsRows: [{
        account_id: '1001',
        user_json: JSON.stringify({ id: 1001, login: 'alice' }),
        github_token_encrypted: 'encrypted-account-copy',
        added_at: '2026-01-01T00:00:00Z',
        last_used_at: '2026-01-02T00:00:00Z',
      }],
      accountRow: { github_token_encrypted: 'encrypted-account-copy' },
      scopedTokenRow: { value: 'encrypted-scoped' },
    }));

    const res = await request(createTestApp())
      .post('/api/sync/auth')
      .send({ account_id: '1001' })
      .expect(200);
    expect(res.body.github_token).toBe('plain-scoped-token');
    expect(res.body.accounts[0]).toMatchObject({ accountId: '1001', githubToken: 'plain-scoped-token' });
  });

  it('falls back to the accounts copy when account_settings is missing (A35: missing)', async () => {
    getDbMock.mockReturnValue(makeMockDb({
      globalTokenRow: { value: 'encrypted-global' },
      accountsRows: [{
        account_id: '1001',
        user_json: JSON.stringify({ id: 1001, login: 'alice' }),
        github_token_encrypted: 'encrypted-account-copy',
        added_at: '2026-01-01T00:00:00Z',
        last_used_at: '2026-01-02T00:00:00Z',
      }],
      accountRow: { github_token_encrypted: 'encrypted-account-copy' },
      // scopedTokenRow 缺失
    }));

    const res = await request(createTestApp())
      .post('/api/sync/auth')
      .send({ account_id: '1001' })
      .expect(200);
    expect(res.body.github_token).toBe('plain-account-token');
    expect(res.body.accounts[0]).toMatchObject({ accountId: '1001', githubToken: 'plain-account-token' });
  });

  it('returns null for the targeted restore and the account list when the token is explicitly cleared (A35: cleared)', async () => {
    getDbMock.mockReturnValue(makeMockDb({
      globalTokenRow: { value: 'encrypted-global' },
      accountsRows: [{
        account_id: '1001',
        user_json: JSON.stringify({ id: 1001, login: 'alice' }),
        github_token_encrypted: 'encrypted-account-copy',
        added_at: '2026-01-01T00:00:00Z',
        last_used_at: '2026-01-02T00:00:00Z',
      }],
      accountRow: { github_token_encrypted: 'encrypted-account-copy' },
      // 记录存在但值为空 = 显式清空：绝不回退 accounts 副本或全局 Token
      scopedTokenRow: { value: null },
    }));

    const res = await request(createTestApp())
      .post('/api/sync/auth')
      .send({ account_id: '1001' })
      .expect(200);
    expect(res.body.github_token).toBeNull();
    expect(res.body.accounts[0]).toMatchObject({ accountId: '1001', githubToken: null });
  });

  it('lists credential-only claimed accounts from account_settings even without an accounts row (A18)', async () => {
    // 已认领账号的凭据保存在 account_settings 但缺少 accounts 元数据行：
    // 恢复列表必须包含它；显式清空 Token 的凭据-only 账号不合成条目。
    getDbMock.mockReturnValue(makeMockDb({
      accountsRows: [],
      // 定向恢复与列表读取同源：account_settings 的凭据行
      scopedTokenRow: { value: 'encrypted-scoped' },
      scopedCredentialRows: [
        { account_id: '1001', value: 'encrypted-scoped' },
        { account_id: '1002', value: null },
        { account_id: 'default', value: 'encrypted-global' },
        { account_id: 'not-numeric', value: 'encrypted-scoped' },
      ],
    }));

    const res = await request(createTestApp()).post('/api/sync/auth').expect(200);
    expect(res.body.accounts).toHaveLength(1);
    expect(res.body.accounts[0]).toMatchObject({
      accountId: '1001',
      githubToken: 'plain-scoped-token',
    });
    expect(res.body.accounts[0].user).toBeNull();

    // 定向恢复同样可取到凭据
    const targeted = await request(createTestApp())
      .post('/api/sync/auth')
      .send({ account_id: '1001' })
      .expect(200);
    expect(targeted.body.github_token).toBe('plain-scoped-token');
  });
});
