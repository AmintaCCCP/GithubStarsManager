import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitHubListsApiService } from './githubListsApi';

function makeJsonResponse(status: number, body: unknown, statusText = ''): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => body,
    headers: { get: () => null },
  } as unknown as Response;
}

const DIRECT_URL = 'https://api.github.com/graphql';
const PROXY_URL = 'http://backend.test/api/proxy/github/graphql';
const BACKEND_URL = 'http://backend.test/api';

const SUCCESS_DATA = {
  data: { createUserList: { list: { id: 'L_1', name: 't' } } },
};

const LIST_SUMMARIES_DATA = {
  data: {
    user: {
      lists: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ id: 'L_1', name: 't' }] },
    },
  },
};

const UPDATE_ITEM_DATA = {
  data: { updateUserListsForItem: { clientMutationId: 'c1' } },
};

const VIEWER_LISTS_DATA = {
  data: {
    viewer: {
      lists: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ id: 'L_99', name: 't' }] },
    },
  },
};

function makeService(backendUrl: string | null = null): GitHubListsApiService {
  const api = new GitHubListsApiService('gh_token');
  if (backendUrl) {
    api.setBackendUrl(backendUrl);
    api.setBackendAuthToken('backend_secret');
  }
  return api;
}

describe('GitHubListsApiService 后端代理回退直连', () => {
  beforeEach(() => {
    // 退避等待直接完成，避免测试被 1→2→4s 背压拖慢
    vi.spyOn(GitHubListsApiService.prototype, 'sleep' as never).mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    vi.mocked(window.fetch).mockReset();
    vi.restoreAllMocks();
  });

  it('查询（getUserListSummaries）代理 502 后回退直连并成功', async () => {
    const api = makeService(BACKEND_URL);
    vi.mocked(window.fetch)
      .mockResolvedValueOnce(makeJsonResponse(502, { error: 'Bad Gateway', code: 'BAD_GATEWAY', details: 'getaddrinfo ENOTFOUND api.github.com' }, 'Bad Gateway'))
      .mockResolvedValueOnce(makeJsonResponse(200, LIST_SUMMARIES_DATA));

    const summaries = await api.getUserListSummaries('cgy141514');

    expect(summaries).toHaveLength(1);
    expect(summaries[0].id).toBe('L_1');
    const calls = vi.mocked(window.fetch).mock.calls;
    expect(calls).toHaveLength(2);
    expect(String(calls[0][0])).toBe(PROXY_URL);
    expect(String(calls[1][0])).toBe(DIRECT_URL);
  });

  it('代理 400 GITHUB_TOKEN_NOT_CONFIGURED 后回退直连并成功（无需退避，mutation 确定未执行）', async () => {
    const api = makeService(BACKEND_URL);
    vi.mocked(window.fetch)
      .mockResolvedValueOnce(makeJsonResponse(400, { error: 'GitHub token not configured', code: 'GITHUB_TOKEN_NOT_CONFIGURED' }))
      .mockResolvedValueOnce(makeJsonResponse(200, SUCCESS_DATA));

    const id = await api.createUserList('t');

    expect(id).toBe('L_1');
    const calls = vi.mocked(window.fetch).mock.calls;
    expect(calls).toHaveLength(2);
    expect(String(calls[0][0])).toBe(PROXY_URL);
    expect(String(calls[1][0])).toBe(DIRECT_URL);
  });

  it('代理成功时保持代理，不发起直连', async () => {
    const api = makeService(BACKEND_URL);
    vi.mocked(window.fetch).mockResolvedValueOnce(makeJsonResponse(200, SUCCESS_DATA));

    const id = await api.createUserList('t');

    expect(id).toBe('L_1');
    const calls = vi.mocked(window.fetch).mock.calls;
    expect(calls).toHaveLength(1);
    expect(String(calls[0][0])).toBe(PROXY_URL);
  });

  it('回退后同实例后续查询请求直接直连，不再撞击代理', async () => {
    const api = makeService(BACKEND_URL);
    vi.mocked(window.fetch)
      .mockResolvedValueOnce(makeJsonResponse(502, { error: 'Bad Gateway', code: 'BAD_GATEWAY' }, 'Bad Gateway'))
      .mockResolvedValue(makeJsonResponse(200, LIST_SUMMARIES_DATA));

    await api.getUserListSummaries('first');
    await api.getUserListSummaries('second');

    const calls = vi.mocked(window.fetch).mock.calls;
    expect(calls).toHaveLength(3);
    expect(String(calls[0][0])).toBe(PROXY_URL);
    expect(String(calls[1][0])).toBe(DIRECT_URL);
    expect(String(calls[2][0])).toBe(DIRECT_URL);
  });

  it('代理返回 401 时抛权限错误，不触发回退直连', async () => {
    const api = makeService(BACKEND_URL);
    vi.mocked(window.fetch).mockResolvedValueOnce(
      makeJsonResponse(401, { data: null, errors: [{ message: '401 Unauthorized' }] })
    );

    await expect(api.createUserList('t')).rejects.toThrow(/缺少操作星标列表/);
    expect(vi.mocked(window.fetch).mock.calls).toHaveLength(1);
  });

  it('5xx 错误文本含鉴权关键词时仍走重试回退，而非误判权限不足', async () => {
    const api = makeService(BACKEND_URL);
    vi.mocked(window.fetch)
      .mockResolvedValueOnce(makeJsonResponse(502, { data: null, errors: [{ message: 'Something went wrong while processing a permission-authorized request' }] }, 'Bad Gateway'))
      .mockResolvedValueOnce(makeJsonResponse(200, LIST_SUMMARIES_DATA));

    const summaries = await api.getUserListSummaries('cgy141514');

    expect(summaries).toHaveLength(1);
    const calls = vi.mocked(window.fetch).mock.calls;
    expect(calls).toHaveLength(2);
    expect(String(calls[0][0])).toBe(PROXY_URL);
    expect(String(calls[1][0])).toBe(DIRECT_URL);
  });

  it('mutation（createUserList）代理 502 未知结果时抛错，不自动重放直连', async () => {
    const api = makeService(BACKEND_URL);
    vi.mocked(window.fetch)
      .mockResolvedValueOnce(makeJsonResponse(502, { error: 'Bad Gateway', code: 'BAD_GATEWAY', details: 'getaddrinfo ENOTFOUND api.github.com' }, 'Bad Gateway'))
      // 核对查询（viewer）失败时保留原始错误
      .mockResolvedValue(makeJsonResponse(502, { data: null, errors: [{ message: 'Something went wrong' }] }, 'Bad Gateway'));

    await expect(api.createUserList('t')).rejects.toThrow(/后端代理：BAD_GATEWAY/);
    expect(String(vi.mocked(window.fetch).mock.calls[0][0])).toBe(PROXY_URL);
    expect(vi.mocked(window.fetch).mock.calls.some(c => String(c[0]) === DIRECT_URL && String(c[1]).includes('createUserList'))).toBe(false);
  });

  it('mutation（createUserList）代理网络失败后按名核对复用已有 list，不重复创建', async () => {
    const api = makeService(BACKEND_URL);
    vi.mocked(window.fetch)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(makeJsonResponse(200, VIEWER_LISTS_DATA));

    const id = await api.createUserList('t');

    expect(id).toBe('L_99');
    const calls = vi.mocked(window.fetch).mock.calls;
    expect(calls).toHaveLength(2);
    expect(String(calls[0][0])).toBe(PROXY_URL);
    expect(String(calls[1][0])).toBe(DIRECT_URL);
    // 第二次是 viewer 核对查询，而非重放 createUserList mutation
    const secondBody = String((calls[1][1] as RequestInit).body ?? '');
    expect(secondBody).toContain('viewer');
    expect(secondBody).not.toContain('createUserList');
  });

  it('mutation（updateUserListsForItem）整集替换语义幂等，代理 502 后回退直连并成功', async () => {
    const api = makeService(BACKEND_URL);
    vi.mocked(window.fetch)
      .mockResolvedValueOnce(makeJsonResponse(502, { error: 'Bad Gateway', code: 'BAD_GATEWAY' }, 'Bad Gateway'))
      .mockResolvedValueOnce(makeJsonResponse(200, UPDATE_ITEM_DATA));

    await api.updateUserListsForItem('node_1', ['L_1', 'L_2']);

    const calls = vi.mocked(window.fetch).mock.calls;
    expect(calls).toHaveLength(2);
    expect(String(calls[0][0])).toBe(PROXY_URL);
    expect(String(calls[1][0])).toBe(DIRECT_URL);
  });

  it('代理请求内部超时（AbortError）后回退直连并成功', async () => {
    const api = makeService(BACKEND_URL);
    vi.mocked(window.fetch)
      .mockRejectedValueOnce(new DOMException('The operation was aborted.', 'AbortError'))
      .mockResolvedValueOnce(makeJsonResponse(200, LIST_SUMMARIES_DATA));

    const summaries = await api.getUserListSummaries('cgy141514');

    expect(summaries).toHaveLength(1);
    const calls = vi.mocked(window.fetch).mock.calls;
    expect(calls).toHaveLength(2);
    expect(String(calls[0][0])).toBe(PROXY_URL);
    expect(String(calls[1][0])).toBe(DIRECT_URL);
  });

  it('mutation 内部超时（AbortError）未知结果时抛错，不自动重放', async () => {
    const api = makeService(BACKEND_URL);
    vi.mocked(window.fetch)
      .mockRejectedValueOnce(new DOMException('The operation was aborted.', 'AbortError'))
      .mockResolvedValueOnce(makeJsonResponse(200, SUCCESS_DATA));

    await expect(api.createUserList('t')).rejects.toThrow(/请求超时/);
    const calls = vi.mocked(window.fetch).mock.calls;
    // mutation 超时后做了一次 viewer 核对查询（非重放），随后抛出原始超时错误
    expect(calls).toHaveLength(2);
    expect(String(calls[0][0])).toBe(PROXY_URL);
    const secondBody = String((calls[1][1] as RequestInit).body ?? '');
    expect(secondBody).toContain('viewer');
    expect(secondBody).not.toContain('createUserList');
  });

  it('调用方取消（父信号中止）时传播 AbortError，不重试不回退', async () => {
    const api = makeService(BACKEND_URL);
    const controller = new AbortController();
    // 模拟请求进行中调用方取消：先中止父信号，fetch 随即以 AbortError 失败
    vi.mocked(window.fetch).mockImplementationOnce(() => {
      controller.abort();
      return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
    });

    await expect(api.getUserListSummaries('cgy141514', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(vi.mocked(window.fetch).mock.calls).toHaveLength(1);
  });

  it('未配置后端时直接直连', async () => {
    const api = makeService(null);
    vi.mocked(window.fetch).mockResolvedValueOnce(makeJsonResponse(200, SUCCESS_DATA));

    const id = await api.createUserList('t');

    expect(id).toBe('L_1');
    expect(String(vi.mocked(window.fetch).mock.calls[0][0])).toBe(DIRECT_URL);
  });

  it('代理与直连都持续 5xx 时，查询重试耗尽后抛出', async () => {
    const api = makeService(BACKEND_URL);
    vi.mocked(window.fetch)
      .mockResolvedValueOnce(makeJsonResponse(502, { error: 'Bad Gateway', code: 'BAD_GATEWAY' }, 'Bad Gateway'))
      .mockResolvedValue(makeJsonResponse(502, { data: null, errors: [{ message: 'Something went wrong' }] }, 'Bad Gateway'));

    await expect(api.getUserListSummaries('cgy141514')).rejects.toThrow(/Something went wrong/);
  });

  it('透传后端代理错误 code/details 到错误信息', async () => {
    const api = makeService(BACKEND_URL);
    vi.mocked(window.fetch)
      .mockResolvedValueOnce(makeJsonResponse(502, { error: 'Bad Gateway', code: 'BAD_GATEWAY', details: 'getaddrinfo ENOTFOUND api.github.com' }, 'Bad Gateway'))
      .mockResolvedValue(makeJsonResponse(502, { error: 'Bad Gateway', code: 'BAD_GATEWAY', details: 'getaddrinfo ENOTFOUND api.github.com' }, 'Bad Gateway'));

    await expect(api.createUserList('t')).rejects.toThrow(/后端代理：BAD_GATEWAY：getaddrinfo ENOTFOUND/);
  });

  it('5xx 的 errors 分支也透传 code/details 诊断', async () => {
    const api = makeService(BACKEND_URL);
    vi.mocked(window.fetch)
      .mockResolvedValueOnce(makeJsonResponse(502, { data: null, errors: [{ message: 'Something went wrong' }], code: 'BAD_GATEWAY', details: 'getaddrinfo ENOTFOUND' }, 'Bad Gateway'))
      .mockResolvedValue(makeJsonResponse(502, { data: null, errors: [{ message: 'Something went wrong' }], code: 'BAD_GATEWAY', details: 'getaddrinfo ENOTFOUND' }, 'Bad Gateway'));

    await expect(api.createUserList('t')).rejects.toThrow(/Something went wrong.*后端代理：BAD_GATEWAY：getaddrinfo ENOTFOUND/);
  });

  it('5xx 仅有 details 无 code 时也透传诊断', async () => {
    const api = makeService(BACKEND_URL);
    vi.mocked(window.fetch)
      .mockResolvedValueOnce(makeJsonResponse(502, { error: 'Bad Gateway', details: 'ECONNREFUSED' }, 'Bad Gateway'))
      .mockResolvedValue(makeJsonResponse(502, { error: 'Bad Gateway', details: 'ECONNREFUSED' }, 'Bad Gateway'));

    await expect(api.createUserList('t')).rejects.toThrow(/后端代理：ECONNREFUSED/);
  });
});