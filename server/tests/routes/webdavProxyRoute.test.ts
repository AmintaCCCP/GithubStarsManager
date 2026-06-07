import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const proxyRequestMock = vi.fn();

vi.mock('../../src/db/connection.js', () => ({
  getDb: () => ({
    prepare: (sql: string) => ({
      get: (keyOrId: string) => {
        if (sql.includes('FROM webdav_configs')) {
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
    proxyRequestMock.mockResolvedValue({ status: 200, data: { ok: true }, headers: {} });
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
      .expect(200, { ok: true });

    expect(proxyRequestMock).toHaveBeenCalledOnce();
    const options = proxyRequestMock.mock.calls[0][0];
    expect(options.url).toBe('https://dav.example.com/backup.json');
    expect(options.headers.authorization).toBeUndefined();
    expect(options.headers.AuthorIzation).toBeUndefined();
    expect(options.headers['Content-Type']).toBe('application/json');
    expect(options.headers.Authorization).toBe(`Basic ${Buffer.from('alice:secret').toString('base64')}`);
  });
});
