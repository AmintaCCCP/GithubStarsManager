import { afterEach, describe, expect, it, vi } from 'vitest';
import { backend } from './backendAdapter';
import { logger } from './logger';

// 可变共享桩：restoreAuth 账号头测试需要模拟「本机已登录账号 A」的会话状态
const mockStoreState: { backendApiSecret: string; user: { id: number; login: string } | null } = {
  backendApiSecret: '',
  user: null,
};

vi.mock('../store/useAppStore', () => ({
  useAppStore: { getState: () => mockStoreState },
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

describe('syncSettings token 更新标志（server configs.ts 契约，审计修复）', () => {
  const adapter = backend as unknown as BackendAdapterLike;

  afterEach(() => {
    vi.mocked(window.fetch).mockReset();
    adapter._backendUrl = null;
  });

  it('puts settings and surfaces token_update_skipped / token_update_superseded flags', async () => {
    adapter._backendUrl = 'http://localhost:3000/api';
    vi.mocked(window.fetch).mockResolvedValue(makeJsonResponse({
      token_update_skipped: true,
      token_update_superseded: false,
    }));

    await expect(backend.syncSettings({ collapsedSidebarCategoryCount: 34 })).resolves.toEqual({
      tokenUpdateSkipped: true,
      tokenUpdateSuperseded: false,
    });
  });

  it('defaults missing flags to false (fully written)', async () => {
    adapter._backendUrl = 'http://localhost:3000/api';
    vi.mocked(window.fetch).mockResolvedValue(makeJsonResponse({}));

    await expect(backend.syncSettings({})).resolves.toEqual({
      tokenUpdateSkipped: false,
      tokenUpdateSuperseded: false,
    });
  });

  it('tolerates an unparseable response body as no flags', async () => {
    adapter._backendUrl = 'http://localhost:3000/api';
    vi.mocked(window.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError('no body'); },
      headers: { forEach: () => {} },
    } as unknown as Response);

    await expect(backend.syncSettings({})).resolves.toEqual({
      tokenUpdateSkipped: false,
      tokenUpdateSuperseded: false,
    });
  });

  it('passes the accountId header through for explicit partition writes', async () => {
    adapter._backendUrl = 'http://localhost:3000/api';
    const fetchMock = vi.mocked(window.fetch).mockResolvedValue(makeJsonResponse({}));
    await backend.syncSettings({ github_token: 'tok' }, undefined, '42');
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers['X-GitHub-Account-Id']).toBe('42');
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

describe('restoreAuth 账号头策略（R4 审计修复）', () => {
  const adapter = backend as unknown as BackendAdapterLike;

  afterEach(() => {
    vi.mocked(window.fetch).mockReset();
    adapter._backendUrl = null;
    mockStoreState.user = null;
    mockStoreState.backendApiSecret = '';
  });

  const requestHeaders = (): Record<string, string> => {
    const init = vi.mocked(window.fetch).mock.calls[0]?.[1] as RequestInit;
    return init.headers as Record<string, string>;
  };

  it('缺省携带当前登录账号的 X-GitHub-Account-Id（普通账号定向恢复保留）', async () => {
    adapter._backendUrl = 'https://backend.example.com/api';
    mockStoreState.user = { id: 1, login: 'alice' };
    vi.mocked(window.fetch).mockResolvedValue(makeJsonResponse({ github_token: 'tok', accounts: [] }));

    await backend.restoreAuth();

    expect(requestHeaders()['X-GitHub-Account-Id']).toBe('1');
  });

  it('omitAccountHeader 模式显式省略账号头，Bearer 鉴权保留', async () => {
    adapter._backendUrl = 'https://backend.example.com/api';
    mockStoreState.user = { id: 1, login: 'alice' };
    mockStoreState.backendApiSecret = 'api-secret';
    vi.mocked(window.fetch).mockResolvedValue(makeJsonResponse({ github_token: 'tok', accounts: [] }));

    await backend.restoreAuth({ omitAccountHeader: true });

    const headers = requestHeaders();
    // 候选后端恢复：绝不继承本机旧账号头（服务端回退后端自己的 active_account_id）
    expect(headers['X-GitHub-Account-Id']).toBeUndefined();
    expect(headers['Authorization']).toBe('Bearer api-secret');
  });

  it('/sync/auth 的响应正文不进入调试日志（多账号明文 Token）', async () => {
    adapter._backendUrl = 'https://backend.example.com/api';
    const token = 'synthetic-github-token-for-log-test';
    const withBody = (payload: unknown): Response => {
      const body = JSON.stringify(payload);
      return {
        ok: true,
        status: 200,
        json: async () => JSON.parse(body),
        headers: { forEach: () => {} },
        clone: () => ({ text: async () => body }),
      } as unknown as Response;
    };
    const isDebug = vi.spyOn(logger, 'isDebugMode').mockReturnValue(true);
    const debug = vi.spyOn(logger, 'debug').mockImplementation(() => {});
    let logged: string;
    try {
      // Control: a normal endpoint still logs its (redacted) body.
      vi.mocked(window.fetch).mockResolvedValueOnce(withBody({ collapsedSidebarCategoryCount: 3 }));
      await backend.fetchSettings();
      expect(JSON.stringify(debug.mock.calls)).toContain('collapsedSidebarCategoryCount');

      debug.mockClear();
      // >4000 chars: the pre-fix code truncated first, then failed to parse the
      // truncated JSON and fell back to a pass that only strips gsm_mcp_ tokens.
      const accounts = Array.from({ length: 60 }, (_, index) => ({
        accountId: String(index + 1),
        user: { id: index + 1, login: `user-${index + 1}` },
        githubToken: token,
      }));
      vi.mocked(window.fetch).mockResolvedValueOnce(withBody({
        github_token: token,
        accounts,
      }));
      expect(JSON.stringify({ github_token: token, accounts }).length).toBeGreaterThan(4000);
      await backend.restoreAuth({ omitAccountHeader: true });
      // Read before the finally block: mockRestore() clears recorded calls.
      logged = JSON.stringify(debug.mock.calls);
    } finally {
      isDebug.mockRestore();
      debug.mockRestore();
    }
    expect(logged).toContain('/sync/auth');
    expect(logged).not.toContain(token);
  });
});

describe('backendAdapter 探测源协议（file:// 桌面端不探测同源 /api）', () => {
  const adapter = backend as unknown as BackendAdapterLike;
  const STORAGE_KEY = 'github-stars-manager-backend-url';
  const originalLocation = window.location;

  // jsdom 的 Location 实例属性不可重定义，但 `window.location` 本身可替换。
  const setLocation = (protocol: string, origin: string, hostname: string): void => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { protocol, origin, hostname },
    });
  };

  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, writable: true, value: originalLocation });
    vi.mocked(window.fetch).mockReset();
    adapter._backendUrl = null;
    localStorage.removeItem(STORAGE_KEY);
  });

  it('桌面端 file:// 页面：不发起 file:///api/health 探测', async () => {
    setLocation('file:', 'file://', '');

    await backend.init();

    expect(window.fetch).not.toHaveBeenCalled();
    expect(backend.isAvailable).toBe(false);
  });

  it('HTTP(S) 页面：保留同源 /api 探测', async () => {
    setLocation('https:', 'https://app.example.com', 'app.example.com');
    vi.mocked(window.fetch).mockResolvedValue(makeHealthOkResponse());

    await backend.init();

    expect(window.fetch).toHaveBeenCalledWith(
      'https://app.example.com/api/health',
      expect.objectContaining({ redirect: 'error' })
    );
    expect(backend.isAvailable).toBe(true);
  });
});
