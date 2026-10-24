import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import axios from 'axios';
import { lookup as dnsLookup } from 'node:dns/promises';
import type { LookupOptions } from 'node:dns';
import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import { createSafeLookup, proxyRequest } from '../../src/services/proxyService.js';

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

// DNS 解析结果同样 mock，保证测试确定性（默认解析到公网地址）
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}));
const dnsLookupMock = dnsLookup as unknown as Mock;
const axiosMock = axios as unknown as Mock;

beforeEach(() => {
  dnsLookupMock.mockReset().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
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

describe('proxyRequest redirect & DNS hardening', () => {
  beforeEach(() => {
    axiosMock.mockReset();
    dnsLookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('follows a redirect hop-by-hop with maxRedirects disabled per hop', async () => {
    axiosMock
      .mockResolvedValueOnce({ status: 302, headers: { location: 'https://api.github.com/other' }, data: '' })
      .mockResolvedValueOnce({ status: 200, headers: { 'content-type': 'application/json' }, data: { ok: 1 } });

    const result = await proxyRequest({ url: 'https://api.github.com/first', method: 'GET' });

    expect(result.status).toBe(200);
    expect(result.data).toEqual({ ok: 1 });
    expect(axiosMock).toHaveBeenCalledTimes(2);
    expect(axiosMock.mock.calls[0][0].url).toBe('https://api.github.com/first');
    expect(axiosMock.mock.calls[0][0].maxRedirects).toBe(0);
    expect(axiosMock.mock.calls[1][0].url).toBe('https://api.github.com/other');
    expect(axiosMock.mock.calls[1][0].maxRedirects).toBe(0);
  });

  it('blocks a redirect hop to a private address in strict mode', async () => {
    axiosMock.mockResolvedValueOnce({
      status: 302,
      headers: { location: 'http://127.0.0.1/evil' },
      data: '',
    });

    const result = await proxyRequest({ url: 'https://api.github.com/first', method: 'GET' });

    expect(result.status).toBe(502);
    expect(axiosMock).toHaveBeenCalledTimes(1); // 第二跳未发出
    expect((result.data as { details: string }).details).toContain('127.0.0.1');
  });

  it('allows a redirect hop to a private address in allowPrivate mode', async () => {
    axiosMock
      .mockResolvedValueOnce({ status: 302, headers: { location: 'http://192.168.1.10:11434/v1' }, data: '' })
      .mockResolvedValueOnce({ status: 200, headers: { 'content-type': 'application/json' }, data: { ok: 1 } });

    const result = await proxyRequest({
      url: 'https://api.github.com/first',
      method: 'GET',
      allowPrivate: true,
    });

    expect(result.status).toBe(200);
    expect(axiosMock.mock.calls[1][0].url).toBe('http://192.168.1.10:11434/v1');
  });

  it('attaches policy-checking lookup agents for direct requests', async () => {
    axiosMock.mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'application/json' },
      data: { ok: 1 },
    });

    const result = await proxyRequest({ url: 'https://api.github.com/x', method: 'GET' });

    expect(result.status).toBe(200);
    const cfg = axiosMock.mock.calls[0][0];
    expect(cfg.httpAgent).toBeInstanceOf(HttpAgent);
    expect(cfg.httpsAgent).toBeInstanceOf(HttpsAgent);
    expect(cfg.proxy).toBe(false);
  });

  it('enforces the local DNS pre-check in proxy mode (remote proxy owns resolution)', async () => {
    dnsLookupMock.mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);

    const result = await proxyRequest({
      url: 'https://example.com/api',
      method: 'GET',
      allowPrivate: true,
      proxyConfig: { enabled: true, type: 'http', host: 'proxy.local', port: 7890 },
    });

    expect(result.status).toBe(502);
    expect(axiosMock).not.toHaveBeenCalled();
    expect((result.data as { details: string }).details).toContain('169.254.169.254');
  });

  it('re-runs the DNS pre-check per redirect hop in proxy mode', async () => {
    dnsLookupMock
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValueOnce([{ address: '169.254.169.254', family: 4 }]);
    axiosMock.mockResolvedValueOnce({
      status: 302,
      headers: { location: 'https://metadata.example.com/x' },
      data: '',
    });

    const result = await proxyRequest({
      url: 'https://api.github.com/first',
      method: 'GET',
      allowPrivate: true,
      proxyConfig: { enabled: true, type: 'http', host: 'proxy.local', port: 7890 },
    });

    expect(result.status).toBe(502);
    expect(axiosMock).toHaveBeenCalledTimes(1);
    expect(dnsLookupMock).toHaveBeenCalledTimes(2);
  });

  it('strips credential headers on cross-host redirect and converts 303 to GET', async () => {
    axiosMock
      .mockResolvedValueOnce({ status: 303, headers: { location: 'https://other.example.com/final' }, data: '' })
      .mockResolvedValueOnce({ status: 200, headers: { 'content-type': 'application/json' }, data: { done: true } });

    const result = await proxyRequest({
      url: 'https://api.github.com/first',
      method: 'POST',
      headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' },
      body: { a: 1 },
    });

    expect(result.status).toBe(200);
    const second = axiosMock.mock.calls[1][0];
    expect(second.url).toBe('https://other.example.com/final');
    expect(second.method).toBe('get');
    expect(second.data).toBeUndefined();
    expect(second.headers.Authorization).toBeUndefined();
  });


});

describe('IMDS protection in allowPrivate mode', () => {
  beforeEach(() => {
    axiosMock.mockReset();
    dnsLookupMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('blocks the IMDS IPv6 literal URL even in allowPrivate mode', async () => {
    const result = await proxyRequest({
      url: 'http://[fd00:ec2::254]/latest/meta-data',
      method: 'GET',
      allowPrivate: true,
    });

    expect(result.status).toBe(502);
    expect(axiosMock).not.toHaveBeenCalled();
    expect((result.data as { details: string }).details).toContain('fd00:ec2::254');
  });

  it('blocks DNS AAAA records returning IPv4-mapped IMDS in proxy mode', async () => {
    dnsLookupMock.mockResolvedValue([{ address: '::ffff:169.254.169.254', family: 6 }]);

    const result = await proxyRequest({
      url: 'https://metadata.example.com/secret',
      method: 'GET',
      allowPrivate: true,
      proxyConfig: { enabled: true, type: 'http', host: 'proxy.local', port: 7890 },
    });

    expect(result.status).toBe(502);
    expect(axiosMock).not.toHaveBeenCalled();
    expect((result.data as { details: string }).details).toContain('169.254.169.254');
  });
});

describe('createSafeLookup (connection-level pinning)', () => {
  type LookupResult = {
    err: Error | null;
    address?: string | Array<{ address: string; family: number }>;
    family?: number;
  };
  const run = (allowPrivate: boolean, hostname: string, options: LookupOptions = {}) =>
    new Promise<LookupResult>((resolve) => {
      createSafeLookup(allowPrivate)(hostname, options, (err, address, family) => {
        resolve({ err, address: address as LookupResult['address'], family });
      });
    });

  beforeEach(() => {
    dnsLookupMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects when every resolved address is IMDS', async () => {
    dnsLookupMock.mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
    const res = await run(true, 'metadata.example.com');
    expect(res.err?.message).toContain('no allowed resolved address');
  });

  it('rejects private addresses in strict mode but connects in allowPrivate mode', async () => {
    dnsLookupMock.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
    const strict = await run(false, 'gateway.example.com');
    expect(strict.err?.message).toContain('no allowed resolved address');

    const relaxed = await run(true, 'gateway.example.com');
    expect(relaxed.err).toBeNull();
    expect(relaxed.address).toBe('10.0.0.5');
  });

  it('skips violating candidates and connects to the allowed one in strict mode', async () => {
    dnsLookupMock.mockResolvedValue([
      { address: '10.0.0.5', family: 4 },
      { address: '93.184.216.34', family: 4 },
    ]);
    const res = await run(false, 'mixed.example.com');
    expect(res.err).toBeNull();
    expect(res.address).toBe('93.184.216.34');
  });

  it('normalizes IPv4-mapped IPv6 before policy checks', async () => {
    dnsLookupMock.mockResolvedValue([{ address: '::ffff:169.254.169.254', family: 6 }]);
    const res = await run(true, 'metadata.example.com');
    expect(res.err?.message).toContain('no allowed resolved address');
  });

  it('honours requested family and reports ENOTFOUND when no record passes', async () => {
    dnsLookupMock.mockResolvedValue([{ address: '2001:db8::1', family: 6 }]);
    const res = await run(true, 'v6only.example.com', { family: 4 });
    expect((res.err as NodeJS.ErrnoException).code).toBe('ENOTFOUND');
  });

  it('passes the full address list through when options.all is set', async () => {
    dnsLookupMock.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800::1', family: 6 },
    ]);
    const res = await run(true, 'dual.example.com', { all: true });
    expect(res.err).toBeNull();
    expect(Array.isArray(res.address)).toBe(true);
  });

  it('propagates DNS resolution failures', async () => {
    dnsLookupMock.mockRejectedValue(Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }));
    const res = await run(true, 'missing.example.com');
    expect(res.err?.message).toContain('ENOTFOUND');
  });
});
