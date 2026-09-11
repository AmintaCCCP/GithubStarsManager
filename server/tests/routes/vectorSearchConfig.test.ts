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

vi.mock('../../src/services/crypto.js', () => ({
  decrypt: (value: string) => value,
  encrypt: (value: string) => value,
}));

vi.mock('../../src/config.js', () => ({
  config: { encryptionKey: 'test-encryption-key' },
}));

const { default: configsRouter } = await import('../../src/routes/configs.js');

const createTestApp = () => {
  const app = express();
  app.use(express.json());
  app.use(configsRouter);
  return app;
};

// 门面签名：db.run(sql, ...args)，SQL 是第一参数；捕获 SQL 之后的绑定参数，
// 便于断言 PUT 实际持久化的字段顺序。
function capturePut(): { params: unknown[][] } {
  const capture = { params: [] as unknown[][] };
  dbMocks.get.mockReturnValue(undefined);
  dbMocks.run.mockImplementation((_sql: string, ...p: unknown[]) => {
    capture.params.push(p);
    return { lastInsertRowid: 0, rowsAffected: 1 };
  });
  return capture;
}

function mockGetReturningRow(row: Record<string, unknown>) {
  // GET 路由只查 vector_search_configs 一行：db.get('SELECT * FROM vector_search_configs WHERE id = ?', 'default')
  dbMocks.get.mockReturnValue(row);
}

const fullConfig = {
  enabled: true,
  workerUrl: 'https://example.com/vectorize',
  authToken: 'worker-secret-token',
  embeddingConfigId: 'emb_test1',
  indexMode: 'readme',
  readmeMaxChars: 8000,
  searchThreshold: 0.42,
  searchTopK: 25,
  enableHyDE: false,
  enableReranking: true,
  embeddingFormatVersion: 2,
};

describe('vector search config route (GET/PUT /api/configs/vector-search)', () => {
  it('PUT persists all vector-search fields to the backend', async () => {
    const capture = capturePut();
    const res = await request(createTestApp()).put('/api/configs/vector-search').send(fullConfig);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: true });
    expect(capture.params).toHaveLength(1);

    const p = capture.params[0];
    expect(p[0]).toBe('default');
    expect(p[1]).toBe(1); // enabled
    expect(p[2]).toBe(fullConfig.workerUrl);
    expect(p[3]).toBe(fullConfig.authToken); // encrypted (encrypt is identity in mock)
    expect(p[4]).toBe(fullConfig.embeddingConfigId);
    expect(p[5]).toBe(fullConfig.indexMode);
    expect(p[6]).toBe(fullConfig.readmeMaxChars);
    expect(p[7]).toBe(fullConfig.searchThreshold);
    expect(p[8]).toBe(fullConfig.searchTopK);
    expect(p[9]).toBe(0); // enableHyDE false → 0
    expect(p[10]).toBe(1); // enableReranking true → 1
    expect(p[11]).toBe(2); // embedding_format_version
  });

  it('GET returns all persisted vector-search fields', async () => {
    const row = {
      id: 'default',
      enabled: 1,
      worker_url: fullConfig.workerUrl,
      auth_token_encrypted: fullConfig.authToken,
      embedding_config_id: fullConfig.embeddingConfigId,
      index_mode: fullConfig.indexMode,
      readme_max_chars: fullConfig.readmeMaxChars,
      search_threshold: fullConfig.searchThreshold,
      search_top_k: fullConfig.searchTopK,
      enable_hyde: 0,
      enable_reranking: 1,
      embedding_format_version: 2,
      status_json: null,
      last_sync_at: null,
    };
    mockGetReturningRow(row);

    const res = await request(createTestApp()).get('/api/configs/vector-search?decrypt=true');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      enabled: true,
      workerUrl: fullConfig.workerUrl,
      authToken: fullConfig.authToken,
      embeddingConfigId: fullConfig.embeddingConfigId,
      indexMode: fullConfig.indexMode,
      readmeMaxChars: fullConfig.readmeMaxChars,
      searchThreshold: fullConfig.searchThreshold,
      searchTopK: fullConfig.searchTopK,
      enableHyDE: false,
      enableReranking: true,
      embeddingFormatVersion: 2,
    });
  });

  it('PUT normalizes out-of-range search params and clears the format version when absent', async () => {
    const capture = capturePut();
    await request(createTestApp()).put('/api/configs/vector-search').send({
      enabled: false,
      authToken: '',
      searchThreshold: 5,
      searchTopK: 999,
      embeddingFormatVersion: 0,
    });

    const p = capture.params[0];
    expect(p[7]).toBe(0.35); // out-of-range threshold → default
    expect(p[8]).toBe(30); // out-of-range topK → default
    expect(p[9]).toBe(0); // enable_hyde absent → false
    expect(p[10]).toBe(0); // enable_reranking absent → false
    expect(p[11]).toBeNull(); // embeddingFormatVersion 0 (invalid) → null
  });
});