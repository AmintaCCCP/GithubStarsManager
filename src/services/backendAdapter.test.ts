import { afterEach, describe, expect, it, vi } from 'vitest';
import { backend } from './backendAdapter';

vi.mock('../store/useAppStore', () => ({
  useAppStore: { getState: () => ({ backendApiSecret: '' }) },
}));

function make429Response(headers: Record<string, string>): Response {
  return {
    ok: false,
    status: 429,
    statusText: 'Too Many Requests',
    json: async () => ({ message: 'rate limited' }),
    headers: {
      get: (name: string) => headers[name] ?? headers[name.toLowerCase()] ?? null,
    },
  } as unknown as Response;
}

type BackendAdapterLike = { _backendUrl: string | null };

describe('backendAdapter 429 Retry-After 解析', () => {
  const adapter = backend as unknown as BackendAdapterLike;

  afterEach(() => {
    vi.mocked(window.fetch).mockReset();
    adapter._backendUrl = null;
  });

  it('解析 retry-after-ms（毫秒，优先于 retry-after）', async () => {
    adapter._backendUrl = 'http://localhost:3000/api';
    vi.mocked(window.fetch).mockResolvedValue(make429Response({ 'retry-after-ms': '60000', 'retry-after': '5' }));

    await expect(backend.checkRateLimit()).rejects.toMatchObject({
      statusCode: 429,
      retryAfterMs: 60000,
    });
  });

  it('解析数值型 retry-after（秒 → 毫秒）', async () => {
    adapter._backendUrl = 'http://localhost:3000/api';
    vi.mocked(window.fetch).mockResolvedValue(make429Response({ 'retry-after': '120' }));

    await expect(backend.checkRateLimit()).rejects.toMatchObject({
      statusCode: 429,
      retryAfterMs: 120000,
    });
  });

  it('解析 HTTP-date 型 retry-after', async () => {
    adapter._backendUrl = 'http://localhost:3000/api';
    const future = new Date(Date.now() + 2 * 60 * 60 * 1000);
    vi.mocked(window.fetch).mockResolvedValue(make429Response({ 'retry-after': future.toUTCString() }));

    const err = (await backend.checkRateLimit().catch((e: Error) => e)) as Error & { statusCode?: number; retryAfterMs?: number };
    expect(err.statusCode).toBe(429);
    expect(typeof err.retryAfterMs).toBe('number');
    expect(err.retryAfterMs!).toBeGreaterThan(0);
    expect(err.retryAfterMs!).toBeLessThanOrEqual(2 * 60 * 60 * 1000);
  });

  it('无法解析的 retry-after 不设置 retryAfterMs', async () => {
    adapter._backendUrl = 'http://localhost:3000/api';
    vi.mocked(window.fetch).mockResolvedValue(make429Response({ 'retry-after': 'bogus-value' }));

    const err = (await backend.checkRateLimit().catch((e: Error) => e)) as Error & { statusCode?: number; retryAfterMs?: number };
    expect(err.statusCode).toBe(429);
    expect(err.retryAfterMs).toBeUndefined();
  });
});