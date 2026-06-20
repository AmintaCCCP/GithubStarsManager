import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const proxyRequestMock = vi.fn();
const validateUrlMock = vi.fn();

vi.mock('../../src/db/connection.js', () => ({
  getDb: () => ({
    prepare: (sql: string) => ({
      get: (key: string) => {
        if (!sql.includes('FROM settings')) return undefined;
        if (key === 'github_token') return { value: 'encrypted-token' };
        if (key === 'proxy_config') return {
          value: JSON.stringify({ enabled: true, type: 'http', host: '127.0.0.1', port: 7890 }),
        };
        return undefined;
      },
    }),
  }),
}));

vi.mock('../../src/services/crypto.js', () => ({
  decrypt: (value: string) => value === 'encrypted-token' ? 'github-token' : value,
  encrypt: (value: string) => value,
}));

vi.mock('../../src/services/proxyService.js', () => ({
  validateUrl: validateUrlMock,
  proxyRequest: proxyRequestMock,
}));

const { default: proxyRouter } = await import('../../src/routes/proxy.js');

const createTestApp = () => {
  const app = express();
  app.use(express.json());
  app.use(proxyRouter);
  return app;
};

describe('GitHub proxy routes', () => {
  beforeEach(() => {
    proxyRequestMock.mockReset();
    validateUrlMock.mockReset();
    proxyRequestMock.mockResolvedValue({ status: 200, data: { ok: true }, headers: { 'content-type': 'application/json' } });
  });

  it('forwards GitHub API request body and configured proxy', async () => {
    const app = createTestApp();

    await request(app)
      .post('/api/proxy/github/gists/abc123')
      .send({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'updated' }),
      })
      .expect(200, { ok: true });

    expect(proxyRequestMock).toHaveBeenCalledOnce();
    const options = proxyRequestMock.mock.calls[0][0];
    expect(options.url).toBe('https://api.github.com/gists/abc123');
    expect(options.method).toBe('PATCH');
    expect(options.body).toBe(JSON.stringify({ description: 'updated' }));
    expect(options.headers.Authorization).toBe('Bearer github-token');
    expect(options.headers['Content-Type']).toBe('application/json');
    expect(options.proxyConfig).toMatchObject({ enabled: true, type: 'http', host: '127.0.0.1', port: 7890 });
  });

  it('proxies raw gist file URLs through the configured proxy as text', async () => {
    const app = createTestApp();
    proxyRequestMock.mockResolvedValueOnce({
      status: 200,
      data: 'raw file text',
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });

    await request(app)
      .post('/api/proxy/github-raw')
      .send({ url: 'https://gist.githubusercontent.com/karpathy/8627fe009c40f57531cb18360106ce95/raw/file' })
      .expect(200, 'raw file text');

    expect(validateUrlMock).toHaveBeenCalledWith('https://gist.githubusercontent.com/karpathy/8627fe009c40f57531cb18360106ce95/raw/file');
    expect(proxyRequestMock).toHaveBeenCalledOnce();
    const options = proxyRequestMock.mock.calls[0][0];
    expect(options.url).toBe('https://gist.githubusercontent.com/karpathy/8627fe009c40f57531cb18360106ce95/raw/file');
    expect(options.method).toBe('GET');
    expect(options.preserveRawResponse).toBe(true);
    expect(options.proxyConfig).toMatchObject({ enabled: true, type: 'http', host: '127.0.0.1', port: 7890 });
  });

  it('rejects malformed raw gist URLs as client errors', async () => {
    const app = createTestApp();

    await request(app)
      .post('/api/proxy/github-raw')
      .send({ url: 'not a url' })
      .expect(400, { error: 'Invalid URL format', code: 'INVALID_URL' });

    expect(validateUrlMock).not.toHaveBeenCalled();
    expect(proxyRequestMock).not.toHaveBeenCalled();
  });

  it('rejects raw URLs from non-GitHub content hosts', async () => {
    const app = createTestApp();

    await request(app)
      .post('/api/proxy/github-raw')
      .send({ url: 'https://example.com/file.txt' })
      .expect(400, { error: 'Host example.com not allowed', code: 'HOST_NOT_ALLOWED' });

    expect(validateUrlMock).not.toHaveBeenCalled();
    expect(proxyRequestMock).not.toHaveBeenCalled();
  });

  it('does not let client raw headers override server GitHub credentials', async () => {
    const app = createTestApp();

    await request(app)
      .post('/api/proxy/github-raw')
      .send({
        url: 'https://gist.githubusercontent.com/karpathy/8627fe009c40f57531cb18360106ce95/raw/file',
        headers: {
          Authorization: 'Bearer client-token',
          'Proxy-Authorization': 'Basic client-proxy',
          Host: 'evil.example.com',
          'Content-Length': '999',
          'X-Custom': 'kept',
        },
      })
      .expect(200, { ok: true });

    expect(proxyRequestMock).toHaveBeenCalledOnce();
    const options = proxyRequestMock.mock.calls[0][0];
    expect(options.headers.Authorization).toBe('Bearer github-token');
    expect(options.headers['Proxy-Authorization']).toBeUndefined();
    expect(options.headers.Host).toBeUndefined();
    expect(options.headers['Content-Length']).toBeUndefined();
    expect(options.headers['X-Custom']).toBe('kept');
  });
});
