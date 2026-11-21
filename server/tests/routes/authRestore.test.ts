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
      'encrypted-account-1001': 'plain-account-1001',
      'encrypted-account-1002': 'plain-account-1002',
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
  /** 分区枚举（collectNonDefaultPartitionIds）返回的真实账号分区 ID */
  partitionAccountIds?: string[];
  /** accounts 表按绑定账号 ID 的定向 get（readScopedToken 的副本来源） */
  accountRows?: Record<string, Record<string, unknown> | undefined>;
  /** account_settings.github_token 定向行，按绑定账号 ID 返回；键缺失 = 缺行 */
  scopedTokenRows?: Record<string, { value: string | null } | undefined>;
  /** account_settings 凭据列表（A18 合并查询的 .all） */
  scopedCredentialRows?: Array<{ account_id: string; value: string | null }>;
}

/**
 * 按 SQL 形态分发的轻量 DB mock：accounts 列表 / 分区枚举 / account_settings
 * 定向 get / account_settings 凭据列表（A18 合并）/ accounts 定向 get / 全局 settings。
 * R2-A27：定向查询按第一个绑定参数（绑定账号 ID）返回数据——同一替身可为
 * 多个账号分别配置缺行 / 显式 null / 有效凭据。
 * R12：分区枚举与 accountsRows 保持一致，路由才能走真实的多账号解析路径。
 */
function makeMockDb(options: MockDbOptions = {}) {
  return {
    prepare: (sql: string) => {
      if (sql.includes('FROM accounts ORDER BY')) {
        return { all: () => options.accountsRows ?? [], get: () => undefined };
      }
      // 分区枚举查询（collectNonDefaultPartitionIds）：accounts / repositories /
      // releases / categories / account_settings 五条。A18 的凭据合并查询同样
      // 含 "account_id != 'default'"，用 SELECT 形态区分。行形态与真实 DB 一致
      // （{ account_id } 对象）。
      if (
        sql.includes("account_id != 'default'")
        && (sql.includes('SELECT DISTINCT account_id FROM') || sql.includes('SELECT account_id FROM accounts'))
      ) {
        return { all: () => (options.partitionAccountIds ?? []).map((id) => ({ account_id: id })), get: () => undefined };
      }
      if (sql.includes('account_settings') && sql.includes("account_id != 'default'")) {
        return { all: () => options.scopedCredentialRows ?? [], get: () => undefined };
      }
      if (sql.includes('account_settings')) {
        return {
          get: (accountId?: unknown) => (options.scopedTokenRows ?? {})[String(accountId)],
          all: () => [],
        };
      }
      if (sql.includes('FROM accounts WHERE')) {
        return {
          get: (accountId?: unknown) => (options.accountRows ?? {})[String(accountId)],
          all: () => [],
        };
      }
      return {
        get: (key?: string) => (
          key === 'github_token' || (key === undefined && sql.includes("key = 'github_token'"))
            ? options.globalTokenRow
            : undefined
        ),
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
    expect(res.body.account_selection_required).toBeUndefined();
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

  it('requires account selection for an unclaimed sole partition while keeping its own credential listed (A36 + R12)', async () => {
    // A36：全局凭据与账号凭据解密为不同值，账号列表仍按账号自身凭据解析。
    // R12：分区枚举替身与 accountsRows 保持一致——账号 1001 是唯一真实分区。
    // 未认领且无活跃账号的无头恢复不得返回全局 PAT，也不得返回空选择列表：
    // account_selection_required 为 true、顶层 Token 为 null，账号列表仍包含
    // 1001 的独立凭据。纯 default 夹具（无分区）的全局 PAT 断言保留在上方用例。
    getDbMock.mockReturnValue(makeMockDb({
      globalTokenRow: { value: 'encrypted-global' },
      partitionAccountIds: ['1001'],
      accountsRows: [{
        account_id: '1001',
        user_json: JSON.stringify({ id: 1001, login: 'alice', avatar_url: 'https://x/a.png' }),
        github_token_encrypted: 'encrypted-account-copy',
        added_at: '2026-01-01T00:00:00Z',
        last_used_at: '2026-01-02T00:00:00Z',
      }],
      accountRows: { '1001': { github_token_encrypted: 'encrypted-account-copy' } },
    }));

    const res = await request(createTestApp()).post('/api/sync/auth').expect(200);
    expect(res.body.github_token).toBeNull();
    expect(res.body.account_selection_required).toBe(true);
    expect(res.body.accounts).toHaveLength(1);
    expect(res.body.accounts[0]).toMatchObject({
      accountId: '1001',
      githubToken: 'plain-account-token',
    });
    expect(res.body.accounts[0].user).toMatchObject({ login: 'alice' });
  });

  it('lists partition-only accounts as restore candidates without exposing the global token (R12)', async () => {
    // 升级后唯一真实账号 111 已同步仓库但还没有资料或分区凭据：恢复需要显式
    // 选择时不得返回空选择列表——111 作为候选出现（user / token 为 null，由
    // 客户端走 PAT 设置 / 身份回查），全局 PAT 绝不分配给未验证的账号；
    // 非数字形态的分区 ID 不作为恢复候选。
    getDbMock.mockReturnValue(makeMockDb({
      globalTokenRow: { value: 'encrypted-global' },
      partitionAccountIds: ['111', 'not-numeric'],
    }));

    const res = await request(createTestApp()).post('/api/sync/auth').expect(200);
    expect(res.body.account_selection_required).toBe(true);
    expect(res.body.github_token).toBeNull();
    expect(res.body.accounts).toHaveLength(1);
    expect(res.body.accounts[0]).toEqual({
      accountId: '111',
      user: null,
      githubToken: null,
      addedAt: null,
      lastUsedAt: null,
    });
  });

  it('converts the token-only placeholder identity to user null so clients re-resolve via GitHub (R12)', async () => {
    // token-only 保存写入仅含 id 的占位 user_json：恢复列表把它转换为
    // user: null——客户端因缺少 login 拒绝条目、又因 user 非 null 跳过 PAT
    // 身份回查的死角不再存在。
    getDbMock.mockReturnValue(makeMockDb({
      partitionAccountIds: ['333'],
      accountsRows: [{
        account_id: '333',
        user_json: JSON.stringify({ id: 333 }),
        github_token_encrypted: 'encrypted-token',
        added_at: '2026-01-01T00:00:00Z',
        last_used_at: '2026-01-02T00:00:00Z',
      }],
      accountRows: { '333': { github_token_encrypted: 'encrypted-token' } },
    }));

    const res = await request(createTestApp()).post('/api/sync/auth').expect(200);
    expect(res.body.accounts).toHaveLength(1);
    expect(res.body.accounts[0]).toMatchObject({ accountId: '333', user: null, githubToken: 'github-token' });
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
      accountRows: { '1001': { github_token_encrypted: 'encrypted-account-copy' } },
      scopedTokenRows: { '1001': { value: 'encrypted-scoped' } },
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
      accountRows: { '1001': { github_token_encrypted: 'encrypted-account-copy' } },
      // scopedTokenRows 缺 '1001' 键 = account_settings 缺行
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
      accountRows: { '1001': { github_token_encrypted: 'encrypted-account-copy' } },
      // 记录存在但值为空 = 显式清空：绝不回退 accounts 副本或全局 Token
      scopedTokenRows: { '1001': { value: null } },
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
      scopedTokenRows: { '1001': { value: 'encrypted-scoped' } },
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

  it('resolves credentials per bound account when several accounts coexist (R2-A27)', async () => {
    // R2-A27：定向查询替身按绑定账号 ID 返回数据——1001 显式 null（显式清空）、
    // 1002 缺行（回退 accounts 副本），两者在同一替身中按账号分别配置。
    getDbMock.mockReturnValue(makeMockDb({
      globalTokenRow: { value: 'encrypted-global' },
      accountsRows: [
        {
          account_id: '1001',
          user_json: JSON.stringify({ id: 1001, login: 'alice' }),
          github_token_encrypted: 'encrypted-account-1001',
          added_at: '2026-01-01T00:00:00Z',
          last_used_at: '2026-01-02T00:00:00Z',
        },
        {
          account_id: '1002',
          user_json: JSON.stringify({ id: 1002, login: 'bob' }),
          github_token_encrypted: 'encrypted-account-1002',
          added_at: '2026-01-01T00:00:00Z',
          last_used_at: '2026-01-03T00:00:00Z',
        },
      ],
      accountRows: {
        '1001': { github_token_encrypted: 'encrypted-account-1001' },
        '1002': { github_token_encrypted: 'encrypted-account-1002' },
      },
      scopedTokenRows: {
        '1001': { value: null },
        // '1002' 缺行：定向 get 返回 undefined，回退 accounts 副本
      },
    }));

    // 1001：account_settings 记录存在但值为空 → 显式清空，绝不回退
    const cleared = await request(createTestApp())
      .post('/api/sync/auth')
      .send({ account_id: '1001' })
      .expect(200);
    expect(cleared.body.github_token).toBeNull();

    // 1002：account_settings 缺行 → 回退 accounts 副本（区分账号密文，防错绑）
    const fallback = await request(createTestApp())
      .post('/api/sync/auth')
      .send({ account_id: '1002' })
      .expect(200);
    expect(fallback.body.github_token).toBe('plain-account-1002');

    // 恢复列表按账号分别解析：显式清空 → null；缺行回退 → plain-account-1002
    const listed = fallback.body.accounts as Array<{ accountId: string; githubToken: string | null }>;
    expect(listed.find((a) => a.accountId === '1001')?.githubToken).toBeNull();
    expect(listed.find((a) => a.accountId === '1002')?.githubToken).toBe('plain-account-1002');
  });

  it('rejects non-string body account_id instead of falling back to headerless restore', async () => {
    getDbMock.mockReturnValue(makeMockDb({
      partitionAccountIds: ['111'],
      accountRows: { '111': { github_token_encrypted: 'encrypted-account-111' } },
      scopedTokenRows: { '111': { value: 'encrypted-account-111' } },
    }));

    const res = await request(createTestApp())
      .post('/api/sync/auth')
      .send({ account_id: 222 })
      .expect(409);
    expect(res.body.code).toBe('ACCOUNT_SCOPE_REQUIRED');
  });
});
