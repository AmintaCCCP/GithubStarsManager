import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));

vi.mock('../../src/db/connection.js', () => ({ getDb: getDbMock }));
vi.mock('../../src/services/crypto.js', () => ({ decrypt: (value: string) => value }));
vi.mock('../../src/config.js', () => ({ config: { encryptionKey: 'test-key' } }));
vi.mock('../../src/services/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const provider = await import('../../src/mcp/provider.js');

const repoRow = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'alpha',
  full_name: 'acme/alpha',
  // A37：记录携带分区归属，get mock 按第一个绑定参数（accountId）校验
  account_id: 'default',
  description: 'retrieval repository',
  html_url: 'https://github.com/acme/alpha',
  stargazers_count: 100,
  language: 'Rust',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-02-01T00:00:00.000Z',
  pushed_at: '2026-02-02T00:00:00.000Z',
  starred_at: '2026-02-03T00:00:00.000Z',
  owner_login: 'acme',
  owner_avatar_url: '',
  topics: JSON.stringify(['retrieval']),
  ai_summary: 'A retrieval system',
  ai_tags: JSON.stringify(['semantic']),
  ai_platforms: JSON.stringify(['linux']),
  analyzed_at: '2026-02-04T00:00:00.000Z',
  analysis_failed: 0,
  custom_description: null,
  custom_tags: JSON.stringify([]),
  custom_category: 'infrastructure',
  category_locked: 0,
  subscribed_to_releases: 1,
  license: 'MIT',
  ...overrides,
});

const releaseRow = (overrides: Record<string, unknown> = {}) => ({
  id: 10,
  tag_name: 'v1.0.0',
  name: 'First release',
  html_url: 'https://github.com/acme/alpha/releases/tag/v1.0.0',
  published_at: '2026-03-01T00:00:00.000Z',
  prerelease: 0,
  draft: 0,
  ...overrides,
});

function configureDb(options: {
  repos?: Record<string, unknown>[];
  releases?: Record<string, unknown>[];
  vectorEnabled?: boolean;
  /** 模拟全局 settings.active_account_id（A37：活跃账号分区） */
  activeAccountId?: string;
} = {}) {
  const repos = options.repos ?? [repoRow()];
  const releases = options.releases ?? [];
  const vectorConfig = {
    id: 'default',
    enabled: options.vectorEnabled === false ? 0 : 1,
    worker_url: 'https://worker.example',
    auth_token_encrypted: 'worker-token',
    embedding_config_id: 'embedding-1',
  };
  const embeddingConfig = {
    api_type: 'ollama',
    model: 'bge-m3',
    api_key_encrypted: '',
    base_url: 'http://127.0.0.1:11434',
  };

  getDbMock.mockReturnValue({
    prepare(sql: string) {
      return {
        all: (accountId?: unknown) => {
          if (sql.includes('FROM repositories')) {
            // A37：列表查询同样按第一个绑定参数（account_id）过滤
            return repos.filter((repo) => !repo.account_id || repo.account_id === accountId);
          }
          return [];
        },
        // v4 多账号隔离后 SQL 均带 account_id 前导条件；第一个绑定参数是
        // account_id，实际查找值是第二个参数。
        get: (accountId?: unknown, second?: unknown) => {
          if (sql.includes('FROM vector_search_configs')) return vectorConfig;
          if (sql.includes('FROM embedding_configs')) return embeddingConfig;
          if (sql.includes('FROM settings')) {
            return options.activeAccountId && accountId === 'active_account_id'
              ? { value: options.activeAccountId }
              : undefined;
          }
          if (sql.includes('FROM releases')) {
            return releases.find((release) => Number(release.repo_id) === Number(second));
          }
          if (sql.includes('AND id = ?')) {
            return repos.find((repo) => repo.account_id === accountId
              && Number(repo.id) === Number(second));
          }
          if (sql.includes('full_name = ?')) {
            return repos.find(
              (repo) => repo.account_id === accountId
                && String(repo.full_name).toLowerCase() === String(second).toLowerCase()
            );
          }
          return undefined;
        },
      };
    },
  });
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('MCP provider discovery', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    configureDb();
  });

  it('returns bounded batch entries in order and preserves duplicates', () => {
    const result = provider.getRepositories(['acme/alpha', 'missing/repo', 'acme/alpha']);
    expect(result.notFound).toEqual(['missing/repo']);
    expect(result.items.map((item) => item.input)).toEqual([
      'acme/alpha',
      'missing/repo',
      'acme/alpha',
    ]);
    expect(result.items[1]).toMatchObject({ status: 'not_found', repository: null });
    expect(result.foundCount).toBe(2);
    expect(result.notFoundCount).toBe(1);
    expect(() => provider.getRepositories(Array.from({ length: 51 }, () => 'acme/alpha'))).toThrow(
      'A maximum of 50 repositories may be requested'
    );
  });

  it('reads the latest release from the local cache only', () => {
    configureDb({ releases: [releaseRow({ repo_id: 1 })] });
    const result = provider.getRepoEvidence('acme/alpha');
    expect(result).not.toHaveProperty('error');
    expect(result.evidence.latest_release).toMatchObject({ id: 10, tag_name: 'v1.0.0' });
  });

  it('uses the requested topK unchanged when vector filters are absent', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ embeddings: [[0.1, 0.2]] }))
      .mockResolvedValueOnce(jsonResponse({
        matches: [{ id: '1', score: 0.9 }],
      }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider.vectorSearch('retrieval', { topK: 2, threshold: 0.4 });
    expect(result).toMatchObject({ available: true, matches: [{ id: 1, score: 0.9 }] });
    expect(result).not.toHaveProperty('filtering');
    const workerBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(workerBody.topK).toBe(2);
    expect(workerBody.threshold).toBe(0.4);
  });

  it('retrieves at most 50 candidates before applying local vector filters', async () => {
    configureDb({
      repos: [
        repoRow({ id: 1, name: 'rust-one', full_name: 'acme/rust-one', language: 'Rust' }),
        repoRow({ id: 2, name: 'python-one', full_name: 'acme/python-one', language: 'Python' }),
      ],
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ embeddings: [[0.1, 0.2]] }))
      .mockResolvedValueOnce(jsonResponse({
        matches: [
          { id: '1', score: 0.9 },
          { id: '2', score: 0.8 },
        ],
      }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider.vectorSearch('retrieval', {
      topK: 1,
      languages: ['Rust'],
    });
    expect(result).toMatchObject({
      available: true,
      matches: [{ id: 1, score: 0.9 }],
      filtering: {
        mode: 'local_candidate_set',
        candidateLimit: 50,
        exactCorpusFilteredTopK: false,
      },
    });
    expect((result as { filtering: { candidateCount: number; filteredCount: number } }).filtering).toMatchObject({
      candidateCount: 2,
      filteredCount: 1,
    });
    const workerBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(workerBody.topK).toBe(50);
  });

  it('excludes the source and deterministically deduplicates similar matches', async () => {
    configureDb({
      repos: [
        repoRow({ id: 1, name: 'source', full_name: 'acme/source' }),
        repoRow({ id: 2, name: 'zeta', full_name: 'acme/zeta' }),
        repoRow({ id: 3, name: 'alpha', full_name: 'acme/alpha-two' }),
      ],
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ embeddings: [[0.1, 0.2]] }))
      .mockResolvedValueOnce(jsonResponse({
        matches: [
          { id: '1', score: 1.0 },
          { id: '2', score: 0.8 },
          { id: '2', score: 0.8 },
          { id: '3', score: 0.8 },
        ],
      }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider.findSimilarRepositories('acme/source', { topK: 2, threshold: 0.2 });
    expect(result).toMatchObject({ available: true, sourceExcluded: true });
    expect(result.matches.map((match) => match.full_name)).toEqual(['acme/alpha-two', 'acme/zeta']);
    expect(result.matches.some((match) => match.id === 1)).toBe(false);
    const workerBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(workerBody.topK).toBe(10);
  });

  it('maps worker connection failures to worker_query_failed instead of throwing', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ embeddings: [[0.1, 0.2]] }))
      .mockRejectedValueOnce(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider.vectorSearch('retrieval', {});
    expect(result).toMatchObject({ available: false });
    expect((result as { reason: string }).reason).toBe('worker_query_failed');
  });

  it('maps a worker timeout abort to worker_query_failed instead of throwing', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ embeddings: [[0.1, 0.2]] }))
      .mockImplementationOnce((_url: unknown, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('This operation was aborted', 'AbortError'))
          );
        })
      );
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();
    try {
      const pending = provider.vectorSearch('retrieval', {});
      await vi.advanceTimersByTimeAsync(15_000);
      const result = await pending;
      expect(result).toMatchObject({ available: false });
      expect((result as { reason: string }).reason).toBe('worker_query_failed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('maps a non-JSON worker response to worker_query_failed instead of throwing', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ embeddings: [[0.1, 0.2]] }))
      .mockResolvedValueOnce(new Response('<html>gateway error</html>', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider.vectorSearch('retrieval', {});
    expect(result).toMatchObject({ available: false });
    expect((result as { reason: string }).reason).toBe('worker_query_failed');
  });

  it('returns the declared unavailable result from findSimilarRepositories when the worker fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ embeddings: [[0.1, 0.2]] }))
      .mockRejectedValueOnce(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider.findSimilarRepositories('acme/alpha', { topK: 3 });
    expect(result).toMatchObject({ available: false });
    expect((result as { reason: string }).reason).toBe('worker_query_failed');
  });

  it('rejects a JSON null worker payload instead of throwing or returning empty matches', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ embeddings: [[0.1, 0.2]] }))
      .mockResolvedValueOnce(new Response('null', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider.vectorSearch('retrieval', {});
    expect(result).toEqual({ available: false, reason: 'worker_query_failed' });
  });

  it('rejects a non-array matches field instead of silently returning empty matches', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ embeddings: [[0.1, 0.2]] }))
      .mockResolvedValueOnce(jsonResponse({ matches: 'not-an-array' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider.vectorSearch('retrieval', {});
    expect(result).toEqual({ available: false, reason: 'worker_query_failed' });
  });

  it('returns only the active account record when two accounts hold the same repository id (A37)', async () => {
    // 审计修订：改用真实双分区 SQLite 夹具执行实际 SQL——按 ID、全名与批量
    // 查询的 account_id 谓词由 SQLite 亲自过滤，不依赖 configureDb 按绑定参数
    // 模拟筛选（那种夹具即使生产 SQL 写错比较符也会通过）。结果必须只含
    // 活跃账号（222）的仓库。
    const Database = (await import('better-sqlite3')).default;
    const { initializeSchema } = await import('../../src/db/schema.js');
    const db = new Database(':memory:');
    try {
      initializeSchema(db);
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('active_account_id', '222')").run();
      const insertRepo = db.prepare(
        'INSERT INTO repositories (account_id, id, name, full_name, html_url, owner_login, topics) VALUES (?, ?, ?, ?, ?, ?, ?)',
      );
      insertRepo.run('default', 1, 'default-alpha', 'acme/alpha', 'https://github.com/acme/alpha', 'acme', '[]');
      insertRepo.run('222', 1, 'beta-alpha', 'acme/alpha', 'https://github.com/acme/alpha', 'acme', '[]');

      getDbMock.mockReturnValue(db);
      const byId = provider.getRepository(1);
      expect(byId).not.toBeNull();
      expect(byId?.name).toBe('beta-alpha');
      const byName = provider.getRepository('acme/alpha');
      expect(byName).not.toBeNull();
      expect(byName?.name).toBe('beta-alpha');
      const batch = provider.getRepositories(['acme/alpha']);
      expect(batch.items[0]).toMatchObject({ status: 'found' });
      expect((batch.items[0] as { repository: { name: string } | null }).repository?.name).toBe('beta-alpha');
      // 列表查询同样只含活跃账号分区
      const all = provider.loadAllRepositories();
      expect(all.map((repo) => repo.name)).toEqual(['beta-alpha']);
    } finally {
      db.close();
    }
  });

  it('falls back to the default partition when no active account is set (A37)', () => {
    configureDb({
      repos: [
        repoRow({ id: 1, name: 'default-alpha', full_name: 'acme/alpha' }),
        repoRow({ id: 1, name: 'beta-alpha', full_name: 'acme/alpha', account_id: '222' }),
      ],
    });
    const byId = provider.getRepository(1);
    expect(byId).not.toBeNull();
    expect(byId?.name).toBe('default-alpha');
  });

  it('reads release evidence only from the active account partition (R2-A26)', async () => {
    // R2-A26：用小型内存库执行实际 SQL——两个账号持有同一 repo_id 的仓库与
    // 发行版（不同 tag_name），最新发行版与发行版历史（health 事实）都必须
    // 只含活跃账号数据；筛选由真实 SQL 完成，不在替身中复制。
    const Database = (await import('better-sqlite3')).default;
    const { initializeSchema } = await import('../../src/db/schema.js');
    const db = new Database(':memory:');
    try {
      initializeSchema(db);
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('active_account_id', '222')").run();
      const insertRepo = db.prepare(
        'INSERT INTO repositories (account_id, id, name, full_name, html_url, owner_login, topics) VALUES (?, ?, ?, ?, ?, ?, ?)',
      );
      insertRepo.run('default', 1, 'default-alpha', 'acme/alpha', 'https://github.com/acme/alpha', 'acme', '[]');
      insertRepo.run('222', 1, 'beta-alpha', 'acme/alpha', 'https://github.com/acme/alpha', 'acme', '[]');
      const insertRelease = db.prepare(
        'INSERT INTO releases (account_id, id, tag_name, name, published_at, prerelease, draft, repo_id, repo_full_name, repo_name) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?)',
      );
      // default 分区包含一条时间晚于活跃账号（222）的发行版，确保最新发行版查询也严格按 account_id 过滤
      insertRelease.run('default', 10, 'v9.9.9-legacy-newer', 'Legacy newer release', '2026-05-01T00:00:00.000Z', 1, 'acme/alpha', 'alpha');
      insertRelease.run('default', 11, 'v0.8.0-legacy', 'Legacy release two', '2026-02-01T00:00:00.000Z', 1, 'acme/alpha', 'alpha');
      insertRelease.run('222', 12, 'v2.0.0-beta', 'Beta release', '2026-04-01T00:00:00.000Z', 1, 'acme/alpha', 'alpha');

      getDbMock.mockReturnValue(db);
      const result = provider.getRepoEvidence('acme/alpha');
      expect(result).not.toHaveProperty('error');
      const evidence = (result as { evidence: { latest_release: { id: number; tag_name: string } | null; health: { release_count: number | null; latest_release_at: string | null } } }).evidence;
      // 最新发行版只取活跃账号（222）的数据
      expect(evidence.latest_release).toMatchObject({ id: 12, tag_name: 'v2.0.0-beta' });
      // 发行版历史只统计活跃账号的发行版（default 分区的两条不参与）
      expect(evidence.health).toMatchObject({
        release_count: 1,
        latest_release_at: '2026-04-01T00:00:00.000Z',
      });
    } finally {
      db.close();
    }
  });

  describe('account metadata backfill probe (R2-A11/A13/A14)', () => {
    const setupVectorDb = async () => {
      const Database = (await import('better-sqlite3')).default;
      const { initializeSchema } = await import('../../src/db/schema.js');
      const db = new Database(':memory:');
      initializeSchema(db);
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('active_account_id', '222')").run();
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('legacy_default_claimed_by', '222')").run();
      db.prepare(
        "INSERT INTO repositories (account_id, id, name, full_name, html_url, owner_login, topics, vector_indexed_at) VALUES ('222', 1, 'alpha', 'acme/alpha', 'https://github.com/acme/alpha', 'acme', '[]', '2025-01-01T00:00:00Z')",
      ).run();
      db.prepare(
        "INSERT INTO vector_search_configs (id, enabled, worker_url, auth_token_encrypted, embedding_config_id) VALUES ('default', 1, 'https://worker.example', 'worker-token', 'embedding-1')",
      ).run();
      db.prepare(
        "INSERT INTO embedding_configs (id, name, api_type, model, api_key_encrypted, base_url) VALUES ('embedding-1', 'embedding', 'ollama', 'bge-m3', '', 'http://127.0.0.1:11434')",
      ).run();
      return db;
    };

    it('schedules a rebuild when the probe cannot fully confirm index ownership (R2-A11)', async () => {
      const db = await setupVectorDb();
      try {
        getDbMock.mockReturnValue(db);
        // 诊断探测的 topK/threshold 不复用用户查询；探测结果无法证明索引归属
        // （无同快照证据）→ 明确安排一次全量重建，且不再有无范围兼容重试。
        const fetchMockLocal = vi.fn()
          .mockResolvedValueOnce(jsonResponse({ embeddings: [[0.1, 0.2]] }))
          .mockResolvedValueOnce(jsonResponse({ success: false, code: 'ACCOUNT_METADATA_NOT_INDEXED' }, 400))
          .mockResolvedValueOnce(jsonResponse({ matches: [{ id: '222:1', score: 0.9, metadata: { accountId: '222' } }] }));
        vi.stubGlobal('fetch', fetchMockLocal);

        const result = await provider.vectorSearch('retrieval', {});
        expect(result).toEqual({ available: false, reason: 'account_metadata_not_indexed' });
        // 无范围兼容重试已移除：探测之外不得再发起任何 Worker 请求
        expect(fetchMockLocal).toHaveBeenCalledTimes(3);

        // 探测请求独立于用户查询：topK=50、threshold=0
        const probeBody = JSON.parse(fetchMockLocal.mock.calls[2][1].body as string);
        expect(probeBody).toMatchObject({ topK: 50, threshold: 0 });

        // 重建已安排：索引标记清除、快照版本推进、完成标记绑定当前 Worker 标识（同一事务）
        const row = db.prepare("SELECT vector_indexed_at FROM repositories WHERE account_id = '222' AND id = 1").get() as { vector_indexed_at: string | null };
        expect(row.vector_indexed_at).toBeNull();
        expect(db.prepare("SELECT value FROM partition_meta WHERE account_id = '222' AND key = 'vector_account_backfill_checked'").get())
          .toMatchObject({ value: 'https://worker.example' });
        expect(db.prepare("SELECT value FROM partition_meta WHERE account_id = '222' AND key = 'repo_revision'").get())
          .toMatchObject({ value: '1' });
      } finally {
        db.close();
      }
    });

    it('schedules a rebuild even when the probe returns fully scoped candidates (count equality is not snapshot evidence)', async () => {
      const db = await setupVectorDb();
      try {
        getDbMock.mockReturnValue(db);
        // 审计修订（381-384）：探测已不再调用 /status——候选全部带账号前缀
        //（无 legacy 向量、数量与本地相等）同样不构成归属证据，归属仍按未确认
        // 处理：清除重建标记并安排全量重建，绝不记录「探测完成」。
        const fetchMockLocal = vi.fn()
          .mockResolvedValueOnce(jsonResponse({ embeddings: [[0.1, 0.2]] }))
          .mockResolvedValueOnce(jsonResponse({ success: false, code: 'ACCOUNT_METADATA_NOT_INDEXED' }, 400))
          .mockResolvedValueOnce(jsonResponse({ matches: [{ id: '222:1', score: 0.9, metadata: { accountId: '222' } }] }));
        vi.stubGlobal('fetch', fetchMockLocal);

        const result = await provider.vectorSearch('retrieval', {});
        expect(result).toEqual({ available: false, reason: 'account_metadata_not_indexed' });

        // 实际请求序列恰好是 embedding → /query(400) → 探测 /query；
        // 探测流程已不请求 /status：两次 /query 之外没有任何状态请求。
        expect(fetchMockLocal).toHaveBeenCalledTimes(3);
        const requestedUrls = fetchMockLocal.mock.calls.map((call) => String(call[0]));
        expect(requestedUrls.filter((url) => url.includes('/query'))).toHaveLength(2);
        expect(requestedUrls.some((url) => url.includes('/status'))).toBe(false);

        const row = db.prepare("SELECT vector_indexed_at FROM repositories WHERE account_id = '222' AND id = 1").get() as { vector_indexed_at: string | null };
        expect(row.vector_indexed_at).toBeNull();
        expect(db.prepare("SELECT value FROM partition_meta WHERE account_id = '222' AND key = 'vector_account_backfill_checked'").get())
          .toMatchObject({ value: 'https://worker.example' });
        // 清除了索引标记 → 推进快照版本（R2-A14）
        expect(db.prepare("SELECT value FROM partition_meta WHERE account_id = '222' AND key = 'repo_revision'").get())
          .toMatchObject({ value: '1' });
      } finally {
        db.close();
      }
    });

    it('schedules a rebuild when the probe detects legacy prefix-less vectors', async () => {
      const db = await setupVectorDb();
      try {
        getDbMock.mockReturnValue(db);
        // 探测返回无前缀旧向量（命中本账号仓库 ID）→ 归属仍未确认并安排重建；
        // 探测流程只发 embedding + 两次 /query，不再请求 /status。
        const fetchMockLocal = vi.fn()
          .mockResolvedValueOnce(jsonResponse({ embeddings: [[0.1, 0.2]] }))
          .mockResolvedValueOnce(jsonResponse({ success: false, code: 'ACCOUNT_METADATA_NOT_INDEXED' }, 400))
          .mockResolvedValueOnce(jsonResponse({ matches: [{ id: '1', score: 0.9 }] }));
        vi.stubGlobal('fetch', fetchMockLocal);

        const result = await provider.vectorSearch('retrieval', {});
        expect(result).toEqual({ available: false, reason: 'account_metadata_not_indexed' });
        expect(fetchMockLocal).toHaveBeenCalledTimes(3);
        const requestedUrls = fetchMockLocal.mock.calls.map((call) => String(call[0]));
        expect(requestedUrls.some((url) => url.includes('/status'))).toBe(false);

        const row = db.prepare("SELECT vector_indexed_at FROM repositories WHERE account_id = '222' AND id = 1").get() as { vector_indexed_at: string | null };
        expect(row.vector_indexed_at).toBeNull();
        expect(db.prepare("SELECT value FROM partition_meta WHERE account_id = '222' AND key = 'vector_account_backfill_checked'").get())
          .toMatchObject({ value: 'https://worker.example' });
      } finally {
        db.close();
      }
    });

    it('sends default scope for default-partition queries and triggers backfill on empty scoped 200', async () => {
      const db = await setupVectorDb();
      try {
        getDbMock.mockReturnValue(db);
        // 1) R12：default 查询一律发送 accountId: 'default'——本地分区数量不能
        //    证明共享 Worker 中无前缀向量的归属，无范围兼容查询已移除。
        db.prepare("DELETE FROM settings WHERE key = 'active_account_id'").run();
        db.prepare(
          "INSERT INTO repositories (account_id, id, name, full_name, html_url, owner_login, topics) VALUES ('default', 2, 'beta', 'acme/beta', 'https://github.com/acme/beta', 'acme', '[]')",
        ).run();
        const fetchDefault = vi.fn()
          .mockResolvedValueOnce(jsonResponse({ embeddings: [[0.1, 0.2]] }))
          .mockResolvedValueOnce(jsonResponse({ matches: [{ id: '2', score: 0.9 }] }));
        vi.stubGlobal('fetch', fetchDefault);

        await provider.vectorSearch('retrieval', {});
        const defaultQueryBody = JSON.parse(fetchDefault.mock.calls[1][1].body as string);
        expect(defaultQueryBody.accountId).toBe('default');

        // 2) 元数据索引已启用（200 空结果）但分区有非空 vector_indexed_at 时触发回填探测并清除旧标记
        //    （实际请求为 embedding → /query → 探测 /query，探测不再请求 /status）
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('active_account_id', '222')").run();
        const fetchEmpty = vi.fn()
          .mockResolvedValueOnce(jsonResponse({ embeddings: [[0.1, 0.2]] }))
          .mockResolvedValueOnce(jsonResponse({ matches: [] }))
          .mockResolvedValueOnce(jsonResponse({ matches: [{ id: '1', score: 0.9 }] }));
        vi.stubGlobal('fetch', fetchEmpty);

        const emptyRes = await provider.vectorSearch('retrieval', {});
        // 回填已安排重建时，同一次请求与重建完成前的后续请求都不应报告为正常无匹配
        expect(emptyRes).toEqual({ available: false, reason: 'vector_rebuild_pending' });
        const row = db.prepare("SELECT vector_indexed_at FROM repositories WHERE account_id = '222' AND id = 1").get() as { vector_indexed_at: string | null };
        expect(row.vector_indexed_at).toBeNull();

        // 重建完成前后续查询仍返回 vector_rebuild_pending（不会因探测标记跳过而误报正常空结果）
        const fetchStillPending = vi.fn()
          .mockResolvedValueOnce(jsonResponse({ embeddings: [[0.1, 0.2]] }))
          .mockResolvedValueOnce(jsonResponse({ matches: [] }));
        vi.stubGlobal('fetch', fetchStillPending);
        const stillPendingRes = await provider.vectorSearch('retrieval', {});
        expect(stillPendingRes).toEqual({ available: false, reason: 'vector_rebuild_pending' });

        // 客户端重建并写回 vector_indexed_at 后，空结果恢复为正常的 available: true
        db.prepare("UPDATE repositories SET vector_indexed_at = '2026-01-01T00:00:00Z' WHERE account_id = '222' AND id = 1").run();
        const fetchAfterRebuild = vi.fn()
          .mockResolvedValueOnce(jsonResponse({ embeddings: [[0.1, 0.2]] }))
          .mockResolvedValueOnce(jsonResponse({ matches: [] }));
        vi.stubGlobal('fetch', fetchAfterRebuild);
        const afterRebuildRes = await provider.vectorSearch('retrieval', {});
        expect(afterRebuildRes).toMatchObject({ available: true, matches: [] });
      } finally {
        db.close();
      }
    });

    it('returns the migration state for default scope when local indexed vectors are not recallable (R12 ISSUE-2)', async () => {
      const db = await setupVectorDb();
      try {
        getDbMock.mockReturnValue(db);
        // default 分区：本地记录有已上传的向量（非空 vector_indexed_at），
        // 但带 accountId='default' 的查询返回 200 空结果 → 索引已启用但存量
        // 向量未回填/覆盖未确认，绝不能静默返回 available:true, matches:[]。
        db.prepare("DELETE FROM settings WHERE key = 'active_account_id'").run();
        db.prepare(
          "INSERT INTO repositories (account_id, id, name, full_name, html_url, owner_login, topics, vector_indexed_at) VALUES ('default', 2, 'beta', 'acme/beta', 'https://github.com/acme/beta', 'acme', '[]', '2025-01-01T00:00:00Z')",
        ).run();
        const fetchDefaultEmpty = vi.fn()
          .mockResolvedValueOnce(jsonResponse({ embeddings: [[0.1, 0.2]] }))
          .mockResolvedValueOnce(jsonResponse({ matches: [] }))
          // 独立覆盖探测：default 范围内没有任何向量
          .mockResolvedValueOnce(jsonResponse({ matches: [] }));
        vi.stubGlobal('fetch', fetchDefaultEmpty);

        const result = await provider.vectorSearch('retrieval', {});
        expect(result).toEqual({ available: false, reason: 'account_metadata_not_indexed' });

        const probeBody = JSON.parse(fetchDefaultEmpty.mock.calls[2][1].body as string);
        expect(probeBody).toMatchObject({ accountId: 'default', topK: 50, threshold: -1e9 });
        // 不触发破坏性重建（default 分区向量由未登录客户端上传，重建不会补元数据）
        const row = db.prepare("SELECT vector_indexed_at FROM repositories WHERE account_id = 'default' AND id = 2").get() as { vector_indexed_at: string | null };
        expect(row.vector_indexed_at).not.toBeNull();
        expect(db.prepare("SELECT value FROM partition_meta WHERE account_id = 'default' AND key = 'vector_account_backfill_checked'").get())
          .toBeUndefined();
      } finally {
        db.close();
      }
    });

    it('returns the migration state for default scope when the coverage probe fails', async () => {
      const db = await setupVectorDb();
      try {
        getDbMock.mockReturnValue(db);
        db.prepare("DELETE FROM settings WHERE key = 'active_account_id'").run();
        db.prepare(
          "INSERT INTO repositories (account_id, id, name, full_name, html_url, owner_login, topics, vector_indexed_at) VALUES ('default', 2, 'beta', 'acme/beta', 'https://github.com/acme/beta', 'acme', '[]', '2025-01-01T00:00:00Z')",
        ).run();
        const fetchProbeFails = vi.fn()
          .mockResolvedValueOnce(jsonResponse({ embeddings: [[0.1, 0.2]] }))
          .mockResolvedValueOnce(jsonResponse({ matches: [] }))
          .mockResolvedValueOnce(jsonResponse({ error: 'worker down' }, 500));
        vi.stubGlobal('fetch', fetchProbeFails);

        const result = await provider.vectorSearch('retrieval', {});
        // 探测失败同样属于「覆盖未确认」——不得静默返回空结果
        expect(result).toEqual({ available: false, reason: 'account_metadata_not_indexed' });
      } finally {
        db.close();
      }
    });

    it('returns default_coverage_unverifiable instead of account_metadata_not_indexed when default partition exceeds probe topK', async () => {
      const db = await setupVectorDb();
      try {
        getDbMock.mockReturnValue(db);
        db.prepare("DELETE FROM settings WHERE key = 'active_account_id'").run();
        const insertStmt = db.prepare(
          "INSERT INTO repositories (account_id, id, name, full_name, html_url, owner_login, topics, vector_indexed_at) VALUES ('default', ?, ?, ?, ?, 'acme', '[]', '2025-01-01T00:00:00Z')",
        );
        for (let i = 1; i <= 51; i++) {
          insertStmt.run(i, `repo-${i}`, `acme/repo-${i}`, `https://github.com/acme/repo-${i}`);
        }
        const fetchOverLimit = vi.fn()
          .mockResolvedValueOnce(jsonResponse({ embeddings: [[0.1, 0.2]] }))
          .mockResolvedValueOnce(jsonResponse({ matches: [] }));
        vi.stubGlobal('fetch', fetchOverLimit);

        const result = await provider.vectorSearch('retrieval', {});
        expect(result).toEqual({ available: false, reason: 'default_coverage_unverifiable' });
      } finally {
        db.close();
      }
    });

    it('keeps an empty result for default scope when scoped probe finds vectors (threshold-only emptiness)', async () => {
      const db = await setupVectorDb();
      try {
        getDbMock.mockReturnValue(db);
        db.prepare("DELETE FROM settings WHERE key = 'active_account_id'").run();
        db.prepare(
          "INSERT INTO repositories (account_id, id, name, full_name, html_url, owner_login, topics, vector_indexed_at) VALUES ('default', 2, 'beta', 'acme/beta', 'https://github.com/acme/beta', 'acme', '[]', '2025-01-01T00:00:00Z')",
        ).run();
        const fetchHasScopedVectors = vi.fn()
          .mockResolvedValueOnce(jsonResponse({ embeddings: [[0.1, 0.2]] }))
          // 用户查询（threshold 默认 0.35）为空
          .mockResolvedValueOnce(jsonResponse({ matches: [] }))
          // 覆盖探测（极低阈值）在 default 范围内找到向量 → 空结果是阈值导致
          .mockResolvedValueOnce(jsonResponse({ matches: [{ id: '2', score: 0.1 }] }));
        vi.stubGlobal('fetch', fetchHasScopedVectors);

        const result = await provider.vectorSearch('retrieval', {});
        expect(result).toMatchObject({ available: true, matches: [] });
      } finally {
        db.close();
      }
    });

    it('keeps an empty result for default scope when the local partition never indexed vectors', async () => {
      const db = await setupVectorDb();
      try {
        getDbMock.mockReturnValue(db);
        db.prepare("DELETE FROM settings WHERE key = 'active_account_id'").run();
        db.prepare(
          "INSERT INTO repositories (account_id, id, name, full_name, html_url, owner_login, topics) VALUES ('default', 2, 'beta', 'acme/beta', 'https://github.com/acme/beta', 'acme', '[]')",
        ).run();
        const fetchNoLocalIndex = vi.fn()
          .mockResolvedValueOnce(jsonResponse({ embeddings: [[0.1, 0.2]] }))
          .mockResolvedValueOnce(jsonResponse({ matches: [] }));
        vi.stubGlobal('fetch', fetchNoLocalIndex);

        const result = await provider.vectorSearch('retrieval', {});
        // 本地没有 default 索引标记 = 真「无数据」，不额外探测
        expect(result).toMatchObject({ available: true, matches: [] });
        expect(fetchNoLocalIndex).toHaveBeenCalledTimes(2);
      } finally {
        db.close();
      }
    });

    it('returns structured unavailable result instead of rejecting when backfill transaction fails', async () => {
      const db = await setupVectorDb();
      try {
        // R15（审计 24）：故障注入点放在索引标记清除之后——用 partition_meta 的
        // 写入触发器使「快照版本 / 完成标记」写入失败，验证事务中已执行的仓库
        // 更新确实被整体回滚（而不是「还没开始就失败」）：原 vector_indexed_at
        // 保持不变、快照版本未推进、完成标记未写入。
        db.exec(`
          CREATE TRIGGER fail_backfill BEFORE INSERT ON partition_meta
          BEGIN SELECT RAISE(ABORT, 'simulated db write failure'); END;
        `);
        getDbMock.mockReturnValue(db);
        const fetchMockFail = vi.fn()
          .mockResolvedValueOnce(jsonResponse({ embeddings: [[0.1, 0.2]] }))
          .mockResolvedValueOnce(jsonResponse({ success: false, code: 'ACCOUNT_METADATA_NOT_INDEXED' }, 400))
          .mockResolvedValueOnce(jsonResponse({ matches: [{ id: '1', score: 0.9 }] }))
          .mockResolvedValueOnce(jsonResponse({ vectorCount: 1 }));
        vi.stubGlobal('fetch', fetchMockFail);

        const result = await provider.vectorSearch('retrieval', {});
        expect(result).toEqual({ available: false, reason: 'vector_backfill_failed' });
        // 失败回滚：已执行的 vector_indexed_at 清除被撤销（保持原值），快照版本
        // 未推进，完成标记未写入——状态可重试
        const row = db.prepare("SELECT vector_indexed_at FROM repositories WHERE account_id = '222' AND id = 1").get() as { vector_indexed_at: string | null };
        expect(row.vector_indexed_at).toBe('2025-01-01T00:00:00Z');
        expect(db.prepare("SELECT value FROM partition_meta WHERE account_id = '222' AND key = 'repo_revision'").get())
          .toBeUndefined();
        expect(db.prepare("SELECT value FROM partition_meta WHERE account_id = '222' AND key = 'vector_account_backfill_checked'").get())
          .toBeUndefined();
      } finally {
        db.close();
      }
    });
  });
});
