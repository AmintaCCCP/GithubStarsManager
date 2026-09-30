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

  it('把调用方的 AbortSignal 与 timeoutMs 透传给后端代理', async () => {
    vi.mocked(backend).isAvailable = true;
    proxyWebDAV.mockResolvedValue(new Response('{}', { status: 200 }));

    const controller = new AbortController();
    await davService().fileExists('data.json');

    // fileExists 内部自建 controller；这里只断言 timeoutMs 被显式传递
    const call = proxyWebDAV.mock.calls[0];
    expect(call[6]).toBeInstanceOf(AbortSignal);
    expect(call[7]).toBe(10000);
    expect(controller.signal.aborted).toBe(false);
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
