import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const proxyRequestMock = vi.fn();

vi.mock('../../src/db/connection.js', () => ({
  getDb: () => ({
    prepare: (sql: string) => ({
      get: (keyOrId: string) => {
        if (sql.includes('FROM webdav_configs')) {
          // 模拟"配置尚未同步到后端"：该 id 在库中不存在
          if (keyOrId === 'not-synced-yet') return undefined;
          return {
            id: keyOrId,
            username: 'alice',
            password_encrypted: 'secret',
            url: 'https://dav.example.com',
          };
        }
        if (sql.includes('FROM settings')) {
          return undefined;
        }
        return undefined;
      },
    }),
  }),
}));

vi.mock('../../src/services/crypto.js', () => ({
  decrypt: (value: string) => value,
  encrypt: (value: string) => value,
}));

vi.mock('../../src/services/proxyService.js', () => ({
  validateUrl: vi.fn(),
  proxyRequest: proxyRequestMock,
}));

const { default: proxyRouter } = await import('../../src/routes/proxy.js');

const createTestApp = () => {
  const app = express();
  app.use(express.json());
  app.use(proxyRouter);
  return app;
};

describe('WebDAV proxy route', () => {
  beforeEach(() => {
    proxyRequestMock.mockReset();
    proxyRequestMock.mockResolvedValue({ status: 200, data: '{"ok":true}', headers: {} });
  });

  it('strips client Authorization headers case-insensitively before adding proxy auth', async () => {
    const app = createTestApp();

    await request(app)
      .post('/api/proxy/webdav')
      .send({
        configId: 'webdav-1',
        method: 'PUT',
        path: '/backup.json',
        body: '{"ok":true}',
        headers: {
          authorization: 'Bearer lower-case-token',
          AuthorIzation: 'Bearer mixed-case-token',
          'Content-Type': 'application/json',
        },
      })
      .expect(200, '{"ok":true}');

    expect(proxyRequestMock).toHaveBeenCalledOnce();
    const options = proxyRequestMock.mock.calls[0][0];
    expect(options.url).toBe('https://dav.example.com/backup.json');
    expect(options.headers.authorization).toBeUndefined();
    expect(options.headers.AuthorIzation).toBeUndefined();
    expect(options.headers['Content-Type']).toBe('application/json');
    expect(options.headers.Authorization).toBe(`Basic ${Buffer.from('alice:secret').toString('base64')}`);
  });

  it('passes PROPFIND XML through untouched so the client can parse it', async () => {
    const app = createTestApp();
    const xml = '<?xml version="1.0"?><D:multistatus xmlns:D="DAV:"><D:response><D:href>/backup/a.json</D:href></D:response></D:multistatus>';
    proxyRequestMock.mockResolvedValue({
      status: 207,
      data: xml,
      headers: { 'content-type': 'application/xml; charset=utf-8' },
    });

    const res = await request(app)
      .post('/api/proxy/webdav')
      .send({ configId: 'webdav-1', method: 'PROPFIND', path: '/backup', headers: { Depth: '1' } })
      .expect(207);

    // 原样透传：不能被 res.json() 二次编码成带引号的 JSON 字符串
    expect(res.text).toBe(xml);
    expect(res.headers['content-type']).toMatch(/application\/xml/);
    expect(proxyRequestMock.mock.calls[0][0].preserveRawResponse).toBe(true);
  });

  it('relays 207 Multi-Status instead of collapsing it', async () => {
    const app = createTestApp();
    proxyRequestMock.mockResolvedValue({ status: 207, data: '<D:multistatus/>', headers: {} });
    await request(app)
      .post('/api/proxy/webdav')
      .send({ configId: 'webdav-1', method: 'PROPFIND', path: '/backup' })
      .expect(207);
  });

  it('sends no body for HEAD requests', async () => {
    const app = createTestApp();
    proxyRequestMock.mockResolvedValue({ status: 200, data: '', headers: {} });
    const res = await request(app)
      .post('/api/proxy/webdav')
      .send({ configId: 'webdav-1', method: 'HEAD', path: '/backup.json' })
      .expect(200);
    expect(res.text).toBe('');
  });

  it('returns 400 when neither a saved config nor inline credentials are supplied', async () => {
    const app = createTestApp();

    const res = await request(app)
      .post('/api/proxy/webdav')
      .send({ method: 'GET', path: '/backup.json' })
      .expect(400);

    expect(res.body.code).toBe('CONFIG_ID_REQUIRED');
    expect(proxyRequestMock).not.toHaveBeenCalled();
  });

  it('rejects a relative path so the target host cannot be overridden via userinfo', async () => {
    const app = createTestApp();

    const res = await request(app)
      .post('/api/proxy/webdav')
      .send({ configId: 'webdav-1', method: 'GET', path: '@evil.example.com/x' })
      .expect(400);

    expect(res.body.code).toBe('WEBDAV_PATH_INVALID');
    expect(proxyRequestMock).not.toHaveBeenCalled();
  });

  it('honours a client-supplied timeout for large uploads, clamped to the max', async () => {
    const app = createTestApp();
    proxyRequestMock.mockResolvedValue({ status: 201, data: '', headers: {} });

    await request(app)
      .post('/api/proxy/webdav')
      .send({ configId: 'webdav-1', method: 'PUT', path: '/big.json', body: '{}', timeoutMs: 240000 })
      .expect(201);
    expect(proxyRequestMock.mock.calls[0][0].timeout).toBe(240000);

    await request(app)
      .post('/api/proxy/webdav')
      .send({ configId: 'webdav-1', method: 'PUT', path: '/big.json', body: '{}', timeoutMs: 99999999 })
      .expect(201);
    expect(proxyRequestMock.mock.calls[1][0].timeout).toBe(300000);
  });

  it('falls back to inline credentials when the config is not synced yet', async () => {
    const app = createTestApp();

    await request(app)
      .post('/api/proxy/webdav')
      .send({
        configId: 'not-synced-yet',
        method: 'GET',
        path: '/backup.json',
        inlineUrl: 'https://dav.example.com',
        inlineUsername: 'bob',
        inlinePassword: 'pw',
      })
      .expect(200);

    const options = proxyRequestMock.mock.calls[0][0];
    expect(options.url).toBe('https://dav.example.com/backup.json');
    expect(options.headers.Authorization).toBe(`Basic ${Buffer.from('bob:pw').toString('base64')}`);
  });
});
