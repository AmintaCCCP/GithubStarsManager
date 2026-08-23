import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockStoreState } = vi.hoisted(() => ({
  mockStoreState: {
    translationEngine: 'microsoft' as 'microsoft' | 'google' | 'ai',
    aiConfigs: [] as Array<{ id: string; name: string }>,
    activeAIConfig: null as string | null,
    language: 'zh' as 'zh' | 'en',
  },
}));

vi.mock('../store/useAppStore', () => ({
  useAppStore: { getState: () => mockStoreState },
}));

vi.mock('./aiService', () => ({
  AIService: vi.fn(),
}));

import { translateText, translateBatch } from './translateService';

interface MockFetchOptions {
  /** 模拟响应体：json() 的返回值（针对微软引擎）。 */
  msBody?: Array<{ translations?: Array<{ text?: string }> }>;
  /** 模拟响应体：json() 的返回值（针对 Google 引擎，直接透传）。 */
  rawBody?: unknown;
  /** json() 挂起直到 signal 中止（模拟慢速 body 读取）。 */
  hangBody?: boolean;
  status?: number;
}

const createMockResponse = (init: RequestInit, options: MockFetchOptions) => {
  const signal = init.signal as AbortSignal;
  const ok = (options.status ?? 200) < 400;
  const json = (): Promise<unknown> => {
    if (options.hangBody) {
      // 模拟真实 fetch 行为：读取 body 期间 signal 中止会以 AbortError 拒绝
      return new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
    }
    return Promise.resolve(options.msBody ?? options.rawBody ?? []);
  };
  return { ok, status: options.status ?? 200, json } as unknown as Response;
};

const installFetch = (options: MockFetchOptions | ((url: string, init: RequestInit) => MockFetchOptions)) => {
  const fetchMock = vi.fn(async (_url: string | URL, init: RequestInit = {}) => {
    const resolved = typeof options === 'function' ? options(String(_url), init) : options;
    return createMockResponse(init, resolved);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

describe('translateService', () => {
  beforeEach(() => {
    mockStoreState.translationEngine = 'microsoft';
    mockStoreState.aiConfigs = [];
    mockStoreState.activeAIConfig = null;
    mockStoreState.language = 'zh';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('microsoft engine: requests the new auth-free endpoint and maps the response', async () => {
    const fetchMock = installFetch({
      msBody: [{ translations: [{ text: '你好，世界' }] }],
    });

    const result = await translateText({ text: 'Hello world', to: 'zh', from: 'en' });

    expect(result.translatedText).toBe('你好，世界');
    const [calledUrl, callInit] = fetchMock.mock.calls[0];
    const init = callInit as RequestInit;
    expect(String(calledUrl)).toContain('https://edge.microsoft.com/translate/translatetext');
    expect(String(calledUrl)).toContain('from=en');
    expect(String(calledUrl)).toContain('to=zh-Hans');
    expect(String(calledUrl)).toContain('isEnterpriseClient=false');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual(['Hello world']);
    // 新端点无需鉴权头
    expect((init.headers as Record<string, string>)['Authorization']).toBeUndefined();
  });

  it('microsoft engine: leaves from empty for auto-detection', async () => {
    const fetchMock = installFetch({ msBody: [{ translations: [{ text: '你好' }] }] });

    await translateText({ text: 'Hello', to: 'zh' });

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('from=&');
    expect(url).toContain('to=zh-Hans');
  });

  it('google engine: posts to dict-chrome-ex and normalizes both response shapes', async () => {
    mockStoreState.translationEngine = 'google';

    const pairs = installFetch({ rawBody: [['你好世界', 'en']] });
    const r1 = await translateText({ text: 'Hello world', to: 'zh' });
    expect(r1.translatedText).toBe('你好世界');
    expect(String(pairs.mock.calls[0][0])).toContain('client=dict-chrome-ex');
    expect(String(pairs.mock.calls[0][0])).toContain('sl=auto&tl=zh-CN');
    // body 为 q=… 表单
    const googleInit = pairs.mock.calls[0][1] as RequestInit;
    expect(String(googleInit.body)).toBe('q=Hello+world');

    // 显式 sl 时接口返回裸字符串数组，同样要能归一化
    const flat = installFetch({ rawBody: ['你好世界'] });
    const r2 = await translateText({ text: 'Hello world', to: 'zh', from: 'en' });
    expect(r2.translatedText).toBe('你好世界');
    expect(String(flat.mock.calls[0][0])).toContain('sl=en');
  });

  it('google engine: chunks large batches into multiple requests', async () => {
    mockStoreState.translationEngine = 'google';
    const texts = Array.from({ length: 25 }, (_, i) => `text ${i}`);
    const fetchMock = installFetch({
      rawBody: [['translated', 'en']],
    });
    // 每次请求返回与该请求条数相同的译文
    fetchMock.mockImplementation(async (_url: string | URL, init: RequestInit = {}) => {
      const count = String(init.body).split('&').filter((p) => p.startsWith('q=')).length;
      return createMockResponse(init, { rawBody: Array.from({ length: count }, () => ['translated', 'en']) });
    });

    const results = await translateBatch(texts, 'zh', 'en');

    expect(results).toHaveLength(25);
    // 20 条上限 → 至少 2 个请求
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('html textType: protects inline <code> with placeholders and restores them', async () => {
    const fetchMock = installFetch({
      msBody: [{ translations: [{ text: '运行 {0} 以安装依赖' }] }],
    });

    const result = await translateText({
      text: 'Run <code>npm install</code> to install dependencies',
      to: 'zh',
      from: 'en',
      textType: 'html',
    });

    // 请求里是占位符而非代码标签
    const protectInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(protectInit.body))).toEqual(['Run {0} to install dependencies']);
    // 译文中占位符被还原回 <code>
    expect(result.translatedText).toBe('运行 <code>npm install</code> 以安装依赖');
  });

  it('html textType: falls back to the original text when a placeholder is lost', async () => {
    installFetch({ msBody: [{ translations: [{ text: '运行 以安装依赖' }] }] });

    const original = 'Run <code>npm install</code> to install dependencies';
    const result = await translateText({ text: original, to: 'zh', from: 'en', textType: 'html' });

    expect(result.translatedText).toBe(original);
  });

  it('html textType: inserts code containing $ sequences verbatim on restore', async () => {
    installFetch({ msBody: [{ translations: [{ text: '运行 {0} 处理文本' }] }] });

    const result = await translateText({
      text: "Run <code>sed 's/a/$&/' file</code> to process text",
      to: 'zh',
      from: 'en',
      textType: 'html',
    });

    // $& 不能被解释为"整个匹配"，必须原样还原
    expect(result.translatedText).toBe("运行 <code>sed 's/a/$&/' file</code> 处理文本");
  });

  it('timeout during a delayed body read is classified as a transient error and retried, then surfaced as timeout', async () => {
    vi.useFakeTimers();
    const fetchMock = installFetch({ hangBody: true });

    const promise = translateText({ text: 'Hello world', to: 'zh', from: 'en' });
    const assertion = expect(promise).rejects.toThrow('Request timed out after 20000ms');

    // 3 次尝试 × 20s 超时 + 两次退避 sleep（1s + 2s）
    await vi.advanceTimersByTimeAsync(3 * 20_000 + 3_000);
    await assertion;

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('caller abort is rethrown as AbortError and not retried', async () => {
    const fetchMock = installFetch({ msBody: [{ translations: [{ text: 'x' }] }] });
    fetchMock.mockImplementation(async (_url: string | URL, init: RequestInit = {}) => {
      const signal = init.signal as AbortSignal;
      if (signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      return createMockResponse(init, { msBody: [{ translations: [{ text: 'x' }] }] });
    });

    const controller = new AbortController();
    controller.abort();

    await expect(
      translateText({ text: 'Hello', to: 'zh', from: 'en', signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('transient HTTP errors (5xx) are retried, non-transient (4xx) are not', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fetchMock = vi.fn(async (_url: string | URL, init: RequestInit = {}) => {
      calls += 1;
      if (calls <= 2) return createMockResponse(init, { status: 500 });
      return createMockResponse(init, { status: 400 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const promise = translateText({ text: 'Hello', to: 'zh', from: 'en' });
    const assertion = expect(promise).rejects.toThrow('Translation failed: 400');
    await vi.advanceTimersByTimeAsync(3_000);
    await assertion;

    // 500 → 重试；400 → 立即抛出
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('ai engine without an active AI config fails with a setup hint', async () => {
    vi.useFakeTimers();
    mockStoreState.translationEngine = 'ai';
    const fetchMock = installFetch({ msBody: [] });

    const promise = translateText({ text: 'Hello', to: 'zh', from: 'en' });
    const assertion = expect(promise).rejects.toThrow('AI 翻译引擎未就绪');
    await vi.advanceTimersByTimeAsync(3_000);
    await assertion;

    // AI 引擎不走直连接口
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('empty batch returns immediately without any request', async () => {
    const fetchMock = installFetch({ msBody: [] });
    expect(await translateBatch([], 'zh')).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
