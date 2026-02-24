import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { proxyRequest } from '../../src/services/proxyService.js';

// Store original fetch
const originalFetch = globalThis.fetch;

describe('proxyRequest', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('should forward GET request and return JSON response', async () => {
    const responseData = { items: [1, 2, 3] };
    const headers = new Headers({ 'content-type': 'application/json', 'x-ratelimit': '100' });
    mockFetch.mockResolvedValueOnce({
      status: 200,
      headers,
      json: () => Promise.resolve(responseData),
      text: () => Promise.resolve(JSON.stringify(responseData)),
    });

    const result = await proxyRequest({
      url: 'https://api.github.com/user/starred',
      method: 'GET',
      headers: { 'Authorization': 'Bearer test-token' },
    });

    expect(result.status).toBe(200);
    expect(result.data).toEqual(responseData);
    expect(result.headers['content-type']).toBe('application/json');
    expect(result.headers['x-ratelimit']).toBe('100');

    expect(mockFetch).toHaveBeenCalledOnce();
    const [calledUrl, calledOptions] = mockFetch.mock.calls[0];
    expect(calledUrl).toBe('https://api.github.com/user/starred');
    expect(calledOptions.method).toBe('GET');
    expect(calledOptions.headers['Authorization']).toBe('Bearer test-token');
    expect(calledOptions.body).toBeUndefined();
  });

  it('should forward POST request with JSON body', async () => {
    const requestBody = { model: 'gpt-4', messages: [{ role: 'user', content: 'hello' }] };
    const responseData = { choices: [{ message: { content: 'hi' } }] };
    const headers = new Headers({ 'content-type': 'application/json' });
    mockFetch.mockResolvedValueOnce({
      status: 200,
      headers,
      json: () => Promise.resolve(responseData),
      text: () => Promise.resolve(JSON.stringify(responseData)),
    });

    const result = await proxyRequest({
      url: 'https://api.openai.com/v1/chat/completions',
      method: 'POST',
      headers: { 'Authorization': 'Bearer sk-test', 'Content-Type': 'application/json' },
      body: requestBody,
    });

    expect(result.status).toBe(200);
    expect(result.data).toEqual(responseData);

    const [, calledOptions] = mockFetch.mock.calls[0];
    expect(calledOptions.method).toBe('POST');
    expect(calledOptions.body).toBe(JSON.stringify(requestBody));
  });

  it('should forward POST request with string body', async () => {
    const xmlBody = '<?xml version="1.0"?><propfind/>';
    const headers = new Headers({ 'content-type': 'application/xml' });
    mockFetch.mockResolvedValueOnce({
      status: 207,
      headers,
      json: () => Promise.reject(new Error('not json')),
      text: () => Promise.resolve('<multistatus/>'),
    });

    const result = await proxyRequest({
      url: 'https://dav.example.com/remote.php/dav',
      method: 'PROPFIND',
      headers: { 'Content-Type': 'application/xml' },
      body: xmlBody,
    });

    expect(result.status).toBe(207);
    expect(result.data).toBe('<multistatus/>');

    const [, calledOptions] = mockFetch.mock.calls[0];
    expect(calledOptions.body).toBe(xmlBody);
  });

  it('should auto-set Content-Type to application/json when body is object and no Content-Type header', async () => {
    const headers = new Headers({ 'content-type': 'application/json' });
    mockFetch.mockResolvedValueOnce({
      status: 200,
      headers,
      json: () => Promise.resolve({ ok: true }),
      text: () => Promise.resolve('{"ok":true}'),
    });

    await proxyRequest({
      url: 'https://example.com/api',
      method: 'POST',
      body: { key: 'value' },
    });

    const [, calledOptions] = mockFetch.mock.calls[0];
    expect((calledOptions.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('should NOT attach body for GET requests', async () => {
    const headers = new Headers({ 'content-type': 'application/json' });
    mockFetch.mockResolvedValueOnce({
      status: 200,
      headers,
      json: () => Promise.resolve([]),
      text: () => Promise.resolve('[]'),
    });

    await proxyRequest({
      url: 'https://api.github.com/repos',
      method: 'GET',
      body: { should: 'be-ignored' },
    });

    const [, calledOptions] = mockFetch.mock.calls[0];
    expect(calledOptions.body).toBeUndefined();
  });

  it('should NOT attach body for HEAD requests', async () => {
    const headers = new Headers({});
    mockFetch.mockResolvedValueOnce({
      status: 200,
      headers,
      json: () => Promise.resolve(null),
      text: () => Promise.resolve(''),
    });

    await proxyRequest({
      url: 'https://example.com/check',
      method: 'HEAD',
      body: 'ignored',
    });

    const [, calledOptions] = mockFetch.mock.calls[0];
    expect(calledOptions.body).toBeUndefined();
  });

  it('should return text data when response is not JSON', async () => {
    const headers = new Headers({ 'content-type': 'text/html' });
    mockFetch.mockResolvedValueOnce({
      status: 200,
      headers,
      json: () => Promise.reject(new Error('not json')),
      text: () => Promise.resolve('<html>hello</html>'),
    });

    const result = await proxyRequest({
      url: 'https://example.com/page',
      method: 'GET',
    });

    expect(result.status).toBe(200);
    expect(result.data).toBe('<html>hello</html>');
  });

  it('should return 504 on timeout (AbortError)', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    mockFetch.mockRejectedValueOnce(abortError);

    const result = await proxyRequest({
      url: 'https://slow.example.com/api',
      method: 'GET',
      timeout: 100,
    });

    expect(result.status).toBe(504);
    expect(result.data).toEqual({ error: 'Gateway Timeout', code: 'GATEWAY_TIMEOUT' });
    expect(result.headers).toEqual({});
  });

  it('should return 502 on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const result = await proxyRequest({
      url: 'https://down.example.com/api',
      method: 'GET',
    });

    expect(result.status).toBe(502);
    expect(result.data).toEqual({
      error: 'Bad Gateway',
      code: 'BAD_GATEWAY',
      details: 'ECONNREFUSED',
    });
    expect(result.headers).toEqual({});
  });

  it('should pass abort signal to fetch', async () => {
    const headers = new Headers({ 'content-type': 'application/json' });
    mockFetch.mockResolvedValueOnce({
      status: 200,
      headers,
      json: () => Promise.resolve({ ok: true }),
      text: () => Promise.resolve('{"ok":true}'),
    });

    await proxyRequest({
      url: 'https://example.com/api',
      method: 'GET',
      timeout: 5000,
    });

    const [, calledOptions] = mockFetch.mock.calls[0];
    expect(calledOptions.signal).toBeInstanceOf(AbortSignal);
  });

  it('should handle upstream 4xx/5xx status codes transparently', async () => {
    const headers = new Headers({ 'content-type': 'application/json' });
    mockFetch.mockResolvedValueOnce({
      status: 403,
      headers,
      json: () => Promise.resolve({ message: 'Forbidden' }),
      text: () => Promise.resolve('{"message":"Forbidden"}'),
    });

    const result = await proxyRequest({
      url: 'https://api.github.com/forbidden',
      method: 'GET',
    });

    expect(result.status).toBe(403);
    expect(result.data).toEqual({ message: 'Forbidden' });
  });

  it('should use default timeout of 30000ms', async () => {
    const headers = new Headers({ 'content-type': 'application/json' });
    mockFetch.mockResolvedValueOnce({
      status: 200,
      headers,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve('{}'),
    });

    // Just verify it doesn't throw — the default timeout is internal
    const result = await proxyRequest({
      url: 'https://example.com/api',
      method: 'GET',
    });

    expect(result.status).toBe(200);
  });

  it('should handle PUT method with body for WebDAV', async () => {
    const headers = new Headers({ 'content-type': 'text/plain' });
    mockFetch.mockResolvedValueOnce({
      status: 201,
      headers,
      json: () => Promise.reject(new Error('not json')),
      text: () => Promise.resolve(''),
    });

    const result = await proxyRequest({
      url: 'https://dav.example.com/remote.php/dav/backup.json',
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{"repos":[]}',
    });

    expect(result.status).toBe(201);

    const [, calledOptions] = mockFetch.mock.calls[0];
    expect(calledOptions.method).toBe('PUT');
    expect(calledOptions.body).toBe('{"repos":[]}');
  });
});
