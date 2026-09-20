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

function makeHealthOkResponse(): Response {
  return {
    ok: true,
    json: async () => ({ status: 'ok' }),
  } as unknown as Response;
}

function makeJsonResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
    headers: { forEach: () => {} },
    clone: () => ({ text: async () => '' }),
  } as unknown as Response;
}

describe('backendAdapter settings hydration', () => {
  const adapter = backend as unknown as BackendAdapterLike;

  afterEach(() => {
    vi.mocked(window.fetch).mockReset();
    adapter._backendUrl = null;
  });

  it('parses JSON-serialized object and array settings from SQLite TEXT values', async () => {
    adapter._backendUrl = 'http://localhost:3000/api';
    vi.mocked(window.fetch).mockResolvedValue(makeJsonResponse({
      customCategories: '[{"id":"custom-1","name":"Custom","icon":"folder","keywords":["custom"]}]',
      hiddenDefaultCategoryIds: '["hidden-default"]',
      categoryOrder: '["custom-1","hidden-default"]',
      assetFilters: '[{"id":"zip","name":"Archives","keywords":["zip"]}]',
      releaseSourceSettings: '{"source":"github"}',
      defaultCategoryOverrides: '{"web":{"name":"Web Apps","keywords":["web"]}}',
      collapsedSidebarCategoryCount: '34',
    }));

    await expect(backend.fetchSettings()).resolves.toEqual({
      customCategories: [{ id: 'custom-1', name: 'Custom', icon: 'folder', keywords: ['custom'] }],
      hiddenDefaultCategoryIds: ['hidden-default'],
      categoryOrder: ['custom-1', 'hidden-default'],
      assetFilters: [{ id: 'zip', name: 'Archives', keywords: ['zip'] }],
      releaseSourceSettings: { source: 'github' },
      defaultCategoryOverrides: { web: { name: 'Web Apps', keywords: ['web'] } },
      collapsedSidebarCategoryCount: 34,
    });
  });

  it('keeps already typed settings unchanged', async () => {
    adapter._backendUrl = 'http://localhost:3000/api';
    const customCategories = [{ id: 'custom-1' }];
    const defaultCategoryOverrides = { web: { name: 'Web' } };
    vi.mocked(window.fetch).mockResolvedValue(makeJsonResponse({
      customCategories,
      defaultCategoryOverrides,
      collapsedSidebarCategoryCount: 20,
    }));

    const settings = await backend.fetchSettings();
    expect(settings.customCategories).toBe(customCategories);
    expect(settings.defaultCategoryOverrides).toBe(defaultCategoryOverrides);
    expect(settings.collapsedSidebarCategoryCount).toBe(20);
  });

  it('leaves malformed JSON strings unchanged', async () => {
    adapter._backendUrl = 'http://localhost:3000/api';
    const response = {
      defaultCategoryOverrides: '{not-json',
      customCategories: '[]oops',
      collapsedSidebarCategoryCount: '0',
    };
    vi.mocked(window.fetch).mockResolvedValue(makeJsonResponse(response));

    await expect(backend.fetchSettings()).resolves.toEqual(response);
  });

  it.each([null, [], 'settings', 1])('rejects invalid top-level settings payloads: %j', async payload => {
    adapter._backendUrl = 'http://localhost:3000/api';
    vi.mocked(window.fetch).mockResolvedValue(makeJsonResponse(payload));

    await expect(backend.fetchSettings()).rejects.toThrow('invalid settings response');
  });
});

describe('backendAdapter 后端 URL 安全策略', () => {
  const adapter = backend as unknown as BackendAdapterLike;
  const STORAGE_KEY = 'github-stars-manager-backend-url';

  afterEach(() => {
    vi.mocked(window.fetch).mockReset();
    adapter._backendUrl = null;
    localStorage.removeItem(STORAGE_KEY);
  });

  it('拒绝远程 HTTP 后端：不发起探测请求，也不写入本地存储', async () => {
    await backend.init('http://backend.example.com');

    expect(window.fetch).not.toHaveBeenCalled();
    expect(backend.isAvailable).toBe(false);
    expect(backend.configuredUrl).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('拒绝伪装成 loopback 的远程主机（如 127.example.com）', async () => {
    await backend.init('http://127.example.com');

    expect(window.fetch).not.toHaveBeenCalled();
    expect(backend.isAvailable).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('放行 HTTPS 后端；rememberActiveUrl 之前不写入本地存储', async () => {
    vi.mocked(window.fetch).mockResolvedValue(makeHealthOkResponse());

    await backend.init('https://backend.example.com');

    expect(window.fetch).toHaveBeenCalledWith(
      'https://backend.example.com/api/health',
      expect.objectContaining({ redirect: 'error' })
    );
    expect(backend.isAvailable).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    backend.rememberActiveUrl();
    expect(localStorage.getItem(STORAGE_KEY)).toBe('https://backend.example.com/api');
  });

  it('认证请求同样禁止自动重定向', async () => {
    adapter._backendUrl = 'https://backend.example.com/api';
    vi.mocked(window.fetch).mockResolvedValue({ ok: true, status: 200 } as unknown as Response);

    await backend.verifyAuth();

    expect(window.fetch).toHaveBeenCalledWith(
      'https://backend.example.com/api/settings',
      expect.objectContaining({ redirect: 'error' })
    );
  });

  it('loopback HTTP 后端仍可用于本地开发', async () => {
    vi.mocked(window.fetch).mockResolvedValue(makeHealthOkResponse());

    await backend.init('http://localhost:3000');

    expect(window.fetch).toHaveBeenCalledWith('http://localhost:3000/api/health', expect.anything());
    expect(backend.isAvailable).toBe(true);

    vi.mocked(window.fetch).mockClear();
    adapter._backendUrl = null;
    localStorage.removeItem(STORAGE_KEY);

    await backend.init('http://127.0.0.2:8080');

    expect(window.fetch).toHaveBeenCalledWith('http://127.0.0.2:8080/api/health', expect.anything());
    expect(backend.isAvailable).toBe(true);
  });
});