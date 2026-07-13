import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { proxyRequest } from '../../src/services/proxyService.js';

// 确定性测试：mock axios，避免对真实外网的依赖（原测试依赖网络连通性，环境不通时随机失败）。
vi.mock('axios', () => {
  const fn = vi.fn();
  fn.isAxiosError = (e: unknown): boolean =>
    Boolean(
      e &&
        ((e as { isAxiosError?: boolean }).isAxiosError ||
          (e as { name?: string }).name === 'AbortError')
    );
  return { default: fn };
});

describe('proxyRequest', () => {
  let mockAxios: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockAxios = axios as unknown as ReturnType<typeof vi.fn>;
    mockAxios.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should forward GET request and return JSON response', async () => {
    const responseData = { items: [1, 2, 3] };
    mockAxios.mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'application/json', 'x-ratelimit': '100' },
      data: responseData,
    });

    const result = await proxyRequest({
      url: 'https://api.github.com/user/starred',
      method: 'GET',
      headers: { Authorization: 'Bearer test-token' },
    });

    expect(result.status).toBe(200);
    expect(result.data).toEqual(responseData);
    expect(result.headers['content-type']).toBe('application/json');
    expect(result.headers['x-ratelimit']).toBe('100');

    expect(mockAxios).toHaveBeenCalledOnce();
    const cfg = mockAxios.mock.calls[0][0];
    expect(cfg.url).toBe('https://api.github.com/user/starred');
    expect(cfg.method).toBe('get'); // proxyService lowercases method
    expect(cfg.headers['Authorization']).toBe('Bearer test-token');
    expect(cfg.data).toBeUndefined();
  });

  it('should forward POST request with JSON body', async () => {
    const requestBody = { model: 'gpt-4', messages: [{ role: 'user', content: 'hello' }] };
    const responseData = { choices: [{ message: { content: 'hi' } }] };
    mockAxios.mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'application/json' },
      data: responseData,
    });

    const result = await proxyRequest({
      url: 'https://api.openai.com/v1/chat/completions',
      method: 'POST',
      headers: { Authorization: 'Bearer sk-test', 'Content-Type': 'application/json' },
      body: requestBody,
    });

    expect(result.status).toBe(200);
    expect(result.data).toEqual(responseData);

    const cfg = mockAxios.mock.calls[0][0];
    expect(cfg.method).toBe('post');
    expect(cfg.data).toEqual(requestBody); // 对象 body 保持原样透传
  });

  it('should forward POST request with string body', async () => {
    const xmlBody = '<?xml version="1.0"?><propfind/>';
    mockAxios.mockResolvedValueOnce({
      status: 207,
      headers: { 'content-type': 'application/xml' },
      data: '<multistatus/>',
    });

    const result = await proxyRequest({
      url: 'https://dav.example.com/remote.php/dav',
      method: 'PROPFIND',
      headers: { 'Content-Type': 'application/xml' },
      body: xmlBody,
    });

    expect(result.status).toBe(207);
    expect(result.data).toBe('<multistatus/>');

    const cfg = mockAxios.mock.calls[0][0];
    expect(cfg.data).toBe(xmlBody);
  });

  it('should auto-set Content-Type to application/json when body is object and no Content-Type header', async () => {
    mockAxios.mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'application/json' },
      data: { ok: true },
    });

    await proxyRequest({
      url: 'https://example.com/api',
      method: 'POST',
      body: { key: 'value' },
    });

    const cfg = mockAxios.mock.calls[0][0];
    expect(cfg.headers['Content-Type']).toBe('application/json');
  });

  it('should NOT attach body for GET requests', async () => {
    mockAxios.mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'application/json' },
      data: [],
    });

    await proxyRequest({
      url: 'https://api.github.com/repos',
      method: 'GET',
      body: { should: 'be-ignored' },
    });

    const cfg = mockAxios.mock.calls[0][0];
    expect(cfg.data).toBeUndefined();
  });

  it('should NOT attach body for HEAD requests', async () => {
    mockAxios.mockResolvedValueOnce({
      status: 200,
      headers: {},
      data: null,
    });

    await proxyRequest({
      url: 'https://example.com/check',
      method: 'HEAD',
      body: 'ignored',
    });

    const cfg = mockAxios.mock.calls[0][0];
    expect(cfg.data).toBeUndefined();
  });

  it('should return text data when response is not JSON', async () => {
    mockAxios.mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'text/html' },
      data: '<html>hello</html>',
    });

    const result = await proxyRequest({
      url: 'https://example.com/page',
      method: 'GET',
    });

    expect(result.status).toBe(200);
    expect(result.data).toBe('<html>hello</html>');
  });

  it('should return 504 on timeout (AbortError)', async () => {
    const abortError = {
      name: 'AbortError',
      code: 'ECONNABORTED',
      message: 'timeout of 100ms exceeded',
      isAxiosError: true,
    };
    mockAxios.mockRejectedValueOnce(abortError);

    const result = await proxyRequest({
      url: 'https://slow.example.com/api',
      method: 'GET',
      timeout: 100,
    });

    expect(result.status).toBe(504);
    expect(result.data).toEqual({ error: 'Gateway Timeout', code: 'GATEWAY_TIMEOUT' });
    expect(result.headers).toEqual({});
  });

  it('should return 502 with PROXY_CONNECTION_REFUSED on ECONNREFUSED', async () => {
    mockAxios.mockRejectedValueOnce({
      isAxiosError: true,
      code: 'ECONNREFUSED',
      message: 'connect ECONNREFUSED',
    });

    const result = await proxyRequest({
      url: 'https://down.example.com/api',
      method: 'GET',
    });

    expect(result.status).toBe(502);
    expect(result.data).toEqual({
      error: 'Proxy connection refused',
      code: 'PROXY_CONNECTION_REFUSED',
      details: 'connect ECONNREFUSED',
    });
    expect(result.headers).toEqual({});
  });

  it('should forward the timeout value into the axios config', async () => {
    mockAxios.mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'application/json' },
      data: { ok: true },
    });

    await proxyRequest({
      url: 'https://example.com/api',
      method: 'GET',
      timeout: 5000,
    });

    const cfg = mockAxios.mock.calls[0][0];
    expect(cfg.timeout).toBe(5000);
  });

  it('should handle upstream 4xx/5xx status codes transparently', async () => {
    mockAxios.mockResolvedValueOnce({
      status: 403,
      headers: { 'content-type': 'application/json' },
      data: { message: 'Forbidden' },
    });

    const result = await proxyRequest({
      url: 'https://api.github.com/forbidden',
      method: 'GET',
    });

    expect(result.status).toBe(403);
    expect(result.data).toEqual({ message: 'Forbidden' });
  });

  it('should use default timeout of 30000ms', async () => {
    mockAxios.mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'application/json' },
      data: {},
    });

    const result = await proxyRequest({
      url: 'https://example.com/api',
      method: 'GET',
    });

    expect(result.status).toBe(200);
    expect(mockAxios.mock.calls[0][0].timeout).toBe(30000);
  });

  it('should handle PUT method with body for WebDAV', async () => {
    mockAxios.mockResolvedValueOnce({
      status: 201,
      headers: { 'content-type': 'text/plain' },
      data: '',
    });

    const result = await proxyRequest({
      url: 'https://dav.example.com/remote.php/dav/backup.json',
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{"repo":[]}',
    });

    expect(result.status).toBe(201);

    const cfg = mockAxios.mock.calls[0][0];
    expect(cfg.method).toBe('put');
    expect(cfg.data).toBe('{"repo":[]}');
  });

  it('should forward to axios for a private-IP URL when allowPrivate is set (fixes #244 local AI)', async () => {
    mockAxios.mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'application/json' },
      data: { ok: true },
    });

    const result = await proxyRequest({
      url: 'http://192.168.1.10:11434/v1/chat/completions',
      method: 'POST',
      headers: { Authorization: 'Bearer local' },
      body: { model: 'llama', messages: [] },
      allowPrivate: true,
    });

    expect(result.status).toBe(200);
    const cfg = mockAxios.mock.calls[0][0];
    expect(cfg.url).toBe('http://192.168.1.10:11434/v1/chat/completions');
  });

  it('should return 502 without calling axios for a private-IP URL in strict mode', async () => {
    const result = await proxyRequest({
      url: 'http://192.168.1.10:11434/v1/chat/completions',
      method: 'POST',
    });

    expect(result.status).toBe(502);
    expect(mockAxios).not.toHaveBeenCalled();
  });
});
