import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

const getDbMock = vi.fn();

vi.mock('../../src/db/connection.js', () => ({
  getDb: () => getDbMock(),
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

// PUT binds params in INSERT order; capture them so we can assert what persisted.
function capturePut(): { params: unknown[][] } {
  const capture = { params: [] as unknown[][] };
  getDbMock.mockReturnValue({
    prepare: () => ({
      get: () => undefined,
      run: (...p: unknown[]) => {
        capture.params.push(p);
      },
    }),
  });
  return capture;
}

function mockGetReturningRow(row: Record<string, unknown>) {
  getDbMock.mockReturnValue({
    prepare: (sql: string) => ({
      get: () => (sql.includes('vector_search_configs') ? row : undefined),
      run: () => ({ changes: 1 }),
    }),
  });
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