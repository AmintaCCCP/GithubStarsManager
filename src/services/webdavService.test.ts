import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebDAVService } from './webdavService';
import { backend } from './backendAdapter';

vi.mock('./backendAdapter', () => ({
  backend: {
    isAvailable: false,
    proxyWebDAV: vi.fn(),
  },
}));

const proxyWebDAV = vi.mocked(backend.proxyWebDAV);

const config = {
  id: 'webdav-1',
  name: 'My NAS',
  url: 'https://dav.example.com',
  username: 'alice',
  password: 'secret',
  path: '/backup',
  isActive: true,
};

const davService = () => new WebDAVService(config);

describe('WebDAVService 传输层选择', () => {
  beforeEach(() => {
    vi.mocked(backend).isAvailable = false;
    proxyWebDAV.mockReset();
    vi.mocked(window.fetch).mockReset();
    delete window.electronAPI;
  });

  afterEach(() => {
    delete window.electronAPI;
  });

  it('无可用后端时回退为浏览器直连', async () => {
    vi.mocked(window.fetch).mockResolvedValue(new Response('{}', { status: 200 }));

    await davService().downloadFile('data.json');

    expect(window.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(window.fetch).mock.calls[0];
    expect(url).toBe('https://dav.example.com/backup/data.json');
    expect(init?.method).toBe('GET');
    expect(proxyWebDAV).not.toHaveBeenCalled();
  });

  it('后端可用时走后端代理，且不透传 Authorization', async () => {
    vi.mocked(backend).isAvailable = true;
    proxyWebDAV.mockResolvedValue(new Response('{}', { status: 200 }));

    await davService().downloadFile('data.json');

    expect(window.fetch).not.toHaveBeenCalled();
    const [configId, method, path, body, headers] = proxyWebDAV.mock.calls[0];
    expect(configId).toBe('webdav-1');
    expect(method).toBe('GET');
    expect(path).toBe('/backup/data.json');
    expect(body).toBeUndefined();
    // Authorization 由后端依据配置生成，前端不重复携带
    expect(headers?.Authorization).toBeUndefined();
  });

  it('把内部 AbortSignal 与 timeoutMs 透传给后端代理', async () => {
    vi.mocked(backend).isAvailable = true;
    proxyWebDAV.mockResolvedValue(new Response('{}', { status: 200 }));

    await davService().fileExists('data.json');

    // fileExists 内部自建 controller；这里断言 signal 与 timeoutMs 被显式传递
    const call = proxyWebDAV.mock.calls[0];
    expect(call[6]).toBeInstanceOf(AbortSignal);
    expect(call[7]).toBe(10000);
  });

  it('上传时透传按体积计算出的动态超时', async () => {
    vi.mocked(backend).isAvailable = true;
    proxyWebDAV.mockResolvedValue(new Response('', { status: 201 }));

    const big = 'x'.repeat(2 * 1024 * 1024);
    await davService().uploadFile('big.json', big);

    const putCall = proxyWebDAV.mock.calls.find((call) => call[1] === 'PUT');
    expect(putCall).toBeDefined();
    // 2MB → 2048KB * 100ms = 204800ms，落在 60s~300s 区间
    expect(putCall![7]).toBe(204800);
  });

  it('桌面版走主进程 IPC，不触发浏览器 fetch 与后端代理', async () => {
    const webdavRequest = vi.fn().mockResolvedValue({
      success: true,
      status: 200,
      statusText: 'OK',
      body: '{"restored":true}',
    });
    window.electronAPI = { webdavRequest } as unknown as Window['electronAPI'];
    vi.mocked(backend).isAvailable = true;

    const restored = await davService().downloadFile('data.json');

    expect(restored).toBe('{"restored":true}');
    expect(window.fetch).not.toHaveBeenCalled();
    expect(proxyWebDAV).not.toHaveBeenCalled();
    const params = webdavRequest.mock.calls[0][0];
    expect(params.url).toBe('https://dav.example.com/backup/data.json');
    expect(params.method).toBe('GET');
    expect(params.headers.Authorization).toMatch(/^Basic /);
  });

  it('桌面版把 IPC 超时归一成 AbortError，沿用既有超时文案', async () => {
    window.electronAPI = {
      webdavRequest: vi.fn().mockResolvedValue({ success: false, timedOut: true, error: 'timeout' }),
    } as unknown as Window['electronAPI'];

    await expect(davService().downloadFile('data.json')).rejects.toThrow('下载超时');
  });

  it('桌面版 PROPFIND 保留 207 状态与原始 XML', async () => {
    const xml = '<?xml version="1.0"?><D:multistatus xmlns:D="DAV:"><D:response><D:href>/backup/a.json</D:href></D:response></D:multistatus>';
    window.electronAPI = {
      webdavRequest: vi.fn().mockResolvedValue({
        success: true,
        status: 207,
        statusText: 'Multi-Status',
        body: xml,
        contentType: 'application/xml; charset=utf-8',
      }),
    } as unknown as Window['electronAPI'];

    await expect(davService().listFiles()).resolves.toEqual(['a.json']);
  });
});

describe('WebDAVService 错误提示', () => {
  beforeEach(() => {
    vi.mocked(backend).isAvailable = false;
    proxyWebDAV.mockReset();
    vi.mocked(window.fetch).mockReset();
    delete window.electronAPI;
  });

  afterEach(() => {
    delete window.electronAPI;
  });

  it('桌面版按 causeCode 给出可操作提示（ENOTFOUND → DNS 建议）', async () => {
    window.electronAPI = {
      webdavRequest: vi.fn().mockResolvedValue({
        success: false,
        error: 'undici: fetch failed <- ENOTFOUND: getaddrinfo ENOTFOUND dav.lan',
        causeCode: 'ENOTFOUND',
        causeMessage: 'getaddrinfo ENOTFOUND dav.lan',
      }),
    } as unknown as Window['electronAPI'];

    await expect(davService().testConnection()).rejects.toThrow(/无法解析 WebDAV 服务器地址/);
  });

  it('桌面版网络层失败不再误报 CORS，并保留技术详情', async () => {
    window.electronAPI = {
      webdavRequest: vi.fn().mockResolvedValue({
        success: false,
        error: 'undici: fetch failed <- ECONNREFUSED: connect ECONNREFUSED 192.168.1.10:5006',
        causeCode: 'ECONNREFUSED',
        causeMessage: 'connect ECONNREFUSED 192.168.1.10:5006',
      }),
    } as unknown as Window['electronAPI'];

    const attempt = davService().testConnection();
    await expect(attempt).rejects.toThrow(/服务器拒绝了连接/);
    await expect(attempt).rejects.toThrow(/ECONNREFUSED/);
    await expect(attempt).rejects.not.toThrow(/CORS策略阻止/);
  });

  it('桌面版自签名证书给出证书建议', async () => {
    window.electronAPI = {
      webdavRequest: vi.fn().mockResolvedValue({
        success: false,
        error: 'undici: fetch failed <- DEPTH_ZERO_SELF_SIGNED_CERT: self-signed certificate',
        causeCode: 'DEPTH_ZERO_SELF_SIGNED_CERT',
        causeMessage: 'self-signed certificate',
      }),
    } as unknown as Window['electronAPI'];

    await expect(davService().testConnection()).rejects.toThrow(/自签名证书/);
  });

  it('桌面版 IPC 超时仍归一为超时文案', async () => {
    window.electronAPI = {
      webdavRequest: vi.fn().mockResolvedValue({
        success: false,
        timedOut: true,
        error: 'undici: signal timed out',
      }),
    } as unknown as Window['electronAPI'];

    await expect(davService().testConnection()).rejects.toThrow(/连接超时/);
  });

  it('纯浏览器直连遇到 Failed to fetch 仍提示 CORS 配置', async () => {
    vi.mocked(window.fetch).mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(davService().testConnection()).rejects.toThrow(/CORS策略阻止/);
  });

  it('纯浏览器直连兼容 Safari 的 Load failed 文案', async () => {
    vi.mocked(window.fetch).mockRejectedValue(new TypeError('Load failed'));

    await expect(davService().testConnection()).rejects.toThrow(/CORS策略阻止/);
  });

  it('桌面版代理类错误码给出代理排查建议', async () => {
    window.electronAPI = {
      webdavRequest: vi.fn().mockResolvedValue({
        success: false,
        error: 'chromium: fetch failed <- ERR_PROXY_CONNECTION_FAILED',
        causeCode: 'ERR_PROXY_CONNECTION_FAILED',
      }),
    } as unknown as Window['electronAPI'];

    await expect(davService().testConnection()).rejects.toThrow(/经由代理连接失败/);
  });

  it('结构化 causeCode 优先于消息文本分类（ENOTFOUND 文本 + ETIMEDOUT code → 超时建议）', async () => {
    window.electronAPI = {
      webdavRequest: vi.fn().mockResolvedValue({
        success: false,
        // 主栈 undici 报 DNS、回退栈 chromium 超时；主进程认定的最相关失败在 causeCode 上
        error: 'undici: fetch failed <- ENOTFOUND: getaddrinfo ENOTFOUND dav.lan; chromium: fetch failed <- ETIMEDOUT: connect timed out',
        causeCode: 'ETIMEDOUT',
      }),
    } as unknown as Window['electronAPI'];

    const attempt = davService().testConnection();
    await expect(attempt).rejects.toThrow(/连接超时/);
    await expect(attempt).rejects.not.toThrow(/无法解析/);
  });

  it('electronAPI 存在但未暴露 webdavRequest（旧 preload）按直连路径提示', async () => {
    // 传输层会走后端/浏览器直连，错误提示不能套用"主进程代发"文案
    window.electronAPI = {} as unknown as Window['electronAPI'];
    vi.mocked(window.fetch).mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(davService().testConnection()).rejects.toThrow(/CORS策略阻止/);
  });
});

describe('WebDAVService 上传重试策略', () => {
  beforeEach(() => {
    vi.mocked(backend).isAvailable = false;
    proxyWebDAV.mockReset();
    delete window.electronAPI;
  });

  afterEach(() => {
    delete window.electronAPI;
  });

  it('连接被拒（非瞬时错误）不做无谓重试', async () => {
    const webdavRequest = vi.fn().mockResolvedValue({
      success: false,
      error: 'undici: fetch failed <- ECONNREFUSED: connect ECONNREFUSED 192.168.1.10:5006',
      causeCode: 'ECONNREFUSED',
    });
    window.electronAPI = { webdavRequest } as unknown as Window['electronAPI'];

    await expect(davService().uploadFile('a.json', '{}')).rejects.toThrow(/服务器拒绝了连接/);

    const puts = webdavRequest.mock.calls.filter((c) => c[0].method === 'PUT');
    expect(puts.length).toBe(1);
  });

  it('自签名证书（非瞬时错误）不做无谓重试', async () => {
    const webdavRequest = vi.fn().mockResolvedValue({
      success: false,
      error: 'undici: fetch failed <- DEPTH_ZERO_SELF_SIGNED_CERT: self-signed certificate',
      causeCode: 'DEPTH_ZERO_SELF_SIGNED_CERT',
    });
    window.electronAPI = { webdavRequest } as unknown as Window['electronAPI'];

    await expect(davService().uploadFile('a.json', '{}')).rejects.toThrow(/自签名证书/);

    const puts = webdavRequest.mock.calls.filter((c) => c[0].method === 'PUT');
    expect(puts.length).toBe(1);
  });

  it('连接超时（瞬时错误）仍按既有退避策略重试', async () => {
    vi.useFakeTimers();
    try {
      const webdavRequest = vi.fn().mockResolvedValue({
        success: false,
        error: 'undici: fetch failed <- UND_ERR_CONNECT_TIMEOUT: connect timeout',
        causeCode: 'UND_ERR_CONNECT_TIMEOUT',
      });
      window.electronAPI = { webdavRequest } as unknown as Window['electronAPI'];

      const attempt = davService().uploadFile('a.json', '{}');
      const assertion = expect(attempt).rejects.toThrow(/连接超时/);
      await vi.runAllTimersAsync();
      await assertion;

      const puts = webdavRequest.mock.calls.filter((c) => c[0].method === 'PUT');
      expect(puts.length).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('WebDAVService 连接测试探测顺序', () => {
  beforeEach(() => {
    vi.mocked(backend).isAvailable = false;
    proxyWebDAV.mockReset();
    vi.mocked(window.fetch).mockReset();
    delete window.electronAPI;
  });

  afterEach(() => {
    delete window.electronAPI;
  });

  it('先发 PROPFIND（Depth: 0），207 即成功且不再探测 HEAD', async () => {
    // 坚果云等服务器对集合 HEAD 返回 403：PROPFIND 成功时不应多付一次 403
    vi.mocked(window.fetch).mockResolvedValue(new Response(null, { status: 207 }));

    await expect(davService().testConnection()).resolves.toBe(true);

    expect(window.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(window.fetch).mock.calls[0];
    expect(url).toBe('https://dav.example.com/backup');
    expect(init?.method).toBe('PROPFIND');
    expect(init?.headers).toMatchObject({ Depth: '0', Authorization: /^Basic / });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('PROPFIND 200 同样视为成功', async () => {
    vi.mocked(window.fetch).mockResolvedValue(new Response(null, { status: 200 }));

    await expect(davService().testConnection()).resolves.toBe(true);
    expect(window.fetch).toHaveBeenCalledTimes(1);
  });

  it('PROPFIND 207 响应体报告目标资源 404 时判定失败（不误报连接可用）', async () => {
    const xml = '<?xml version="1.0"?><D:multistatus xmlns:D="DAV:">' +
      '<D:response><D:href>/backup</D:href><D:status>HTTP/1.1 404 Not Found</D:status></D:response>' +
      '</D:multistatus>';
    vi.mocked(window.fetch).mockResolvedValue(new Response(xml, {
      status: 207,
      headers: { 'Content-Type': 'application/xml; charset=utf-8' },
    }));

    await expect(davService().testConnection()).resolves.toBe(false);
  });

  it('PROPFIND 207 仅属性级 propstat 404（无资源级 status）仍视为成功', async () => {
    // 个别属性（如 getcontentlength）缺失是正常现象，不代表资源不存在
    const xml = '<?xml version="1.0"?><D:multistatus xmlns:D="DAV:">' +
      '<D:response><D:href>/backup</D:href>' +
      '<D:propstat><D:prop><D:getcontentlength/></D:prop>' +
      '<D:status>HTTP/1.1 404 Property Not Found</D:status></D:propstat>' +
      '</D:response></D:multistatus>';
    vi.mocked(window.fetch).mockResolvedValue(new Response(xml, {
      status: 207,
      headers: { 'Content-Type': 'application/xml; charset=utf-8' },
    }));

    await expect(davService().testConnection()).resolves.toBe(true);
  });

  it('PROPFIND 207 目标 href 精确匹配：无关条目的失败不影响判定', async () => {
    // /old/backup 的 404 不能匹配目标 /backup（宽松 endsWith 会读错条目）
    const xml = '<?xml version="1.0"?><D:multistatus xmlns:D="DAV:">' +
      '<D:response><D:href>/old/backup</D:href><D:status>HTTP/1.1 404 Not Found</D:status></D:response>' +
      '<D:response><D:href>/backup</D:href><D:status>HTTP/1.1 200 OK</D:status></D:response>' +
      '</D:multistatus>';
    vi.mocked(window.fetch).mockResolvedValue(new Response(xml, {
      status: 207,
      headers: { 'Content-Type': 'application/xml; charset=utf-8' },
    }));

    await expect(davService().testConnection()).resolves.toBe(true);
  });

  it('PROPFIND 不可用（405）时降级 HEAD，HEAD 200 即成功', async () => {
    vi.mocked(window.fetch)
      .mockResolvedValueOnce(new Response(null, { status: 405 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await expect(davService().testConnection()).resolves.toBe(true);

    expect(vi.mocked(window.fetch).mock.calls.map(([, init]) => init?.method)).toEqual(['PROPFIND', 'HEAD']);
    // 回退 HEAD 与首发 PROPFIND 共用同一 AbortController：10s 超时覆盖整个探测
    const [propfindInit, headInit] = vi.mocked(window.fetch).mock.calls.map(([, init]) => init);
    expect(headInit?.signal).toBeInstanceOf(AbortSignal);
    expect(headInit?.signal).toBe(propfindInit?.signal);
  });

  it('PROPFIND 抛网络错误（如 CORS 预检拒绝）时仍降级 HEAD', async () => {
    // 浏览器直连：PROPFIND 预检不被放行会直接抛 TypeError，而非返回 405
    vi.mocked(window.fetch)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await expect(davService().testConnection()).resolves.toBe(true);
    expect(vi.mocked(window.fetch).mock.calls.map(([, init]) => init?.method)).toEqual(['PROPFIND', 'HEAD']);
  });

  it('PROPFIND 超时（AbortError）不降级 HEAD，直接按连接超时抛出', async () => {
    vi.mocked(window.fetch).mockRejectedValueOnce(
      Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
    );

    await expect(davService().testConnection()).rejects.toThrow('连接超时');
    expect(window.fetch).toHaveBeenCalledTimes(1);
  });

  it('PROPFIND 与 HEAD 都失败时返回 false（不抛错）', async () => {
    vi.mocked(window.fetch)
      .mockResolvedValueOnce(new Response(null, { status: 405 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }));

    await expect(davService().testConnection()).resolves.toBe(false);
  });

  it('浏览器直连时 10 秒预算覆盖 HEAD 回退（回退停滞会被中止而不是挂死）', async () => {
    // 只 fake setTimeout/Date（预算与中止定时器）；不 fake setImmediate，
    // 避免与 mock fetch 的 promise 链交错产生环境差异。
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      // PROPFIND 405 正常返回；HEAD 回退停滞不返回（模拟 fetch 只认 signal）
      vi.mocked(window.fetch)
        .mockResolvedValueOnce(new Response(null, { status: 405 }))
        .mockImplementationOnce((_input, init) => new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted', 'AbortError')));
        }));

      const promise = davService().testConnection();
      const expectation = expect(promise).rejects.toThrow('连接超时');
      await vi.advanceTimersByTimeAsync(10001);
      await expectation;
    } finally {
      vi.useRealTimers();
    }
  });

  it('桌面端 PROPFIND 失败后剩余预算不足 1s 时跳过 HEAD 回退，总耗时不超预算', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const webdavRequest = vi.fn(() => new Promise((resolve) => {
        setTimeout(() => resolve({ success: true, status: 405, statusText: '', body: '' }), 9500);
      }));
      window.electronAPI = { webdavRequest } as unknown as Window['electronAPI'];

      const promise = davService().testConnection();
      const expectation = expect(promise).rejects.toThrow('连接超时');
      await vi.advanceTimersByTimeAsync(9600);
      await expectation;
      // 回退因剩余预算不足被跳过：只有首发这一次 IPC 请求
      expect(webdavRequest).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
      delete window.electronAPI;
    }
  });

  it('fileExists 遇 HEAD 403 降级 PROPFIND 确认存在（不支持 HEAD 的服务器）', async () => {
    vi.mocked(window.fetch)
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(new Response(
        '<?xml version="1.0"?><D:multistatus xmlns:D="DAV:"><D:response><D:href>/backup/data.json</D:href></D:response></D:multistatus>',
        { status: 207 },
      ));

    await expect(davService().fileExists('data.json')).resolves.toBe(true);
    expect(vi.mocked(window.fetch).mock.calls.map(([, init]) => init?.method)).toEqual(['HEAD', 'PROPFIND']);
    // 回退 PROPFIND 与首发 HEAD 共用同一 AbortController，超时覆盖整个检查
    const [headInit, propfindInit] = vi.mocked(window.fetch).mock.calls.map(([, init]) => init);
    expect(propfindInit?.signal).toBe(headInit?.signal);
  });

  it('fileExists 的 PROPFIND 207 响应体报告目标文件 404 时返回 false', async () => {
    const xml = '<?xml version="1.0"?><D:multistatus xmlns:D="DAV:">' +
      '<D:response><D:href>/backup/data.json</D:href><D:status>HTTP/1.1 404 Not Found</D:status></D:response>' +
      '</D:multistatus>';
    vi.mocked(window.fetch)
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(new Response(xml, {
        status: 207,
        headers: { 'Content-Type': 'application/xml; charset=utf-8' },
      }));

    await expect(davService().fileExists('data.json')).resolves.toBe(false);
  });

  it('fileExists 的 HEAD 404 仍直接判定不存在，不追加探测', async () => {
    vi.mocked(window.fetch).mockResolvedValue(new Response(null, { status: 404 }));

    await expect(davService().fileExists('missing.json')).resolves.toBe(false);
    expect(window.fetch).toHaveBeenCalledTimes(1);
  });
});
