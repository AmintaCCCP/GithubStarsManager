import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

const getDbMock = vi.fn();

vi.mock('../../src/db/connection.js', () => ({
  getDb: () => getDbMock(),
}));
vi.mock('../../src/config.js', () => ({ config: { encryptionKey: 'test-key' } }));
vi.mock('../../src/services/crypto.js', () => ({
  encrypt: (value: string) => `encrypted:${value}`,
  decrypt: (value: string) => value,
}));
vi.mock('../../src/services/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    errorFromError: vi.fn(),
  },
}));

const { default: proxyRouter } = await import('../../src/routes/proxy.js');

/**
 * Create an in-memory settings database stub for the route test.
 */
function createSettingsDb() {
  const values = new Map<string, string | null>();
  const statement = {
    run: (key: string, value: string | null) => {
      values.set(key, value);
      return { changes: 1 };
    },
    get: (key: string) => {
      const value = values.get(key);
      return value === undefined ? undefined : { value };
    },
  };
  const db = {
    prepare: () => statement,
    transaction: (fn: () => void) => fn,
  };
  getDbMock.mockReturnValue(db);
  return values;
}

/**
 * Build an Express app containing the proxy routes under test.
 */
const createTestApp = () => {
  const app = express();
  app.use(express.json());
  app.use(proxyRouter);
  return app;
};

describe('RPC download host/port hardening', () => {
  it('PUT /api/settings/rpc-download rejects a host that could alter the jsonrpc URL structure', async () => {
    createSettingsDb();
    const app = createTestApp();

    for (const host of ['1.2.3.4/#x', 'a%2fb', 'user@host', 'nas ?q', 'a\\b']) {
      const res = await request(app).put('/api/settings/rpc-download').send({
        enabled: true,
        host,
        port: 6800,
        secret: 'token',
      });
      expect(res.status, `host=${host}`).toBe(400);
      expect(res.body.code).toBe('INVALID_RPC_TARGET');
    }

    // 非整数端口同样拒绝
    const res = await request(app).put('/api/settings/rpc-download').send({
      enabled: true,
      host: '192.168.1.5',
      port: '6800/evil',
      secret: 'token',
    });
    expect(res.status).toBe(400);
  });

  it('PUT /api/settings/rpc-download keeps legitimate intranet targets and empty host behavior', async () => {
    const values = createSettingsDb();
    const app = createTestApp();

    const res = await request(app).put('/api/settings/rpc-download').send({
      enabled: true,
      host: '192.168.1.5',
      port: 6800,
      secret: 'token',
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const stored = JSON.parse(values.get('rpc_download_config') ?? '{}');
    expect(stored.host).toBe('192.168.1.5');
    expect(stored.port).toBe(6800);

    // 未配置时的空 host 保存行为保持不变
    const emptyRes = await request(app).put('/api/settings/rpc-download').send({
      enabled: false,
      host: '',
      port: '',
    });
    expect(emptyRes.status).toBe(200);
  });

  it('POST /api/settings/rpc-download/test rejects a forged host before any network call', async () => {
    createSettingsDb();
    const app = createTestApp();

    const res = await request(app).post('/api/settings/rpc-download/test').send({
      host: '1.2.3.4/#x',
      port: 6800,
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_RPC_TARGET');
  });

  it('PUT /api/settings/rpc-download rejects non-string host values that would bypass validation', async () => {
    createSettingsDb();
    const app = createTestApp();

    // 数字 0 等假值曾因 `host &&` 短路绕过校验
    const res = await request(app).put('/api/settings/rpc-download').send({
      enabled: true,
      host: 0,
      port: 6800,
      secret: 'token',
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_RPC_TARGET');
  });

  it('GET /api/download/rpc fail-closes on stored configs saved before the validation existed', async () => {
    const values = createSettingsDb();
    values.set(
      'rpc_download_config',
      JSON.stringify({ enabled: true, host: '127.0.0.1/#x', port: 6800 }),
    );
    const app = createTestApp();

    const res = await request(app).post('/api/download/rpc').send({
      url: 'https://example.com/file.zip',
    });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('not configured');
  });

  it('POST /api/settings/rpc-download/test accepts a legitimate intranet host shape', async () => {
    createSettingsDb();
    const app = createTestApp();

    // 合法形态放行（不真正联网，只验证没有被 400 拦截：连接失败走 success:false 路径）
    const res = await request(app).post('/api/settings/rpc-download/test').send({
      host: '127.0.0.1',
      port: 9,
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false); // 9 端口无服务，连接失败
  });

  it('POST /api/settings/rpc-download/test accepts bare IPv6 and brackets it into a valid URL', async () => {
    createSettingsDb();
    const app = createTestApp();
    // mock fetch 并断言完整 URL：裸 IPv6 必须被补上方括号才是合法 URL
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ result: { version: 'test' } }),
    } as Response);

    try {
      const res = await request(app).post('/api/settings/rpc-download/test').send({
        host: '::1',
        port: 9,
      });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://[::1]:9/jsonrpc',
        expect.objectContaining({ method: 'POST' }),
      );
    } finally {
      fetchMock.mockRestore();
    }
  });
});
