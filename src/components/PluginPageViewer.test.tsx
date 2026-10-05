import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { getPage, requestPageCapability, getSearchEndpoint, searchWeb, confirm, generateChatText, getState } = vi.hoisted(() => ({
  getPage: vi.fn(),
  requestPageCapability: vi.fn(),
  getSearchEndpoint: vi.fn(),
  searchWeb: vi.fn(),
  confirm: vi.fn(),
  generateChatText: vi.fn(),
  getState: vi.fn(),
}));
vi.mock('../plugins/pluginClient', () => ({ pluginClient: { getPage, requestPageCapability, getSearchEndpoint, searchWeb } }));
vi.mock('../hooks/useDialog', () => ({ useDialog: () => ({ confirm }) }));
const storeState: Record<string, unknown> = { language: 'zh', getState };

vi.mock('../store/useAppStore', () => ({
  useAppStore: Object.assign(
    (selector?: (state: unknown) => unknown) => (selector ? selector(storeState) : storeState),
    { getState: (...args: unknown[]) => getState(...(args as [])) },
  ),
}));
vi.mock('../services/aiService', () => ({ AIService: class { generateChatText = generateChatText; } }));

import { makeT } from '../i18n/useT';
import { PluginPageViewer } from './PluginPageViewer';
import { validatePluginPageMessage } from '../plugins/pluginPageMessages';

const t = makeT('zh', 'app');

describe('PluginPageViewer', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('confirms the exact AI prompt and sends only generated text back to the page', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'session-token' });
    getPage.mockResolvedValue({ success: true, url: 'plugin-page://com.example.page/dashboard/index.html' });
    requestPageCapability.mockResolvedValue({ success: true, value: null });
    getState.mockReturnValue({
      aiConfigs: [{ id: 'provider', name: 'Example AI', model: 'sample-model', baseUrl: 'https://ai.example/v1', apiKey: 'test-secret' }],
      activeAIConfig: 'provider', language: 'zh',
    });
    confirm.mockResolvedValue(true);
    generateChatText.mockResolvedValue('Generated answer');
    render(<PluginPageViewer pluginId="com.example.page" pluginName="Example" pageId="dashboard"
      pageTitle="Dashboard" onClose={() => {}} t={t} />);
    const frame = await screen.findByTitle('Example: Dashboard') as HTMLIFrameElement;
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage');
    fireEvent.load(frame);
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'plugin-page:request', pluginId: 'com.example.page', pageId: 'dashboard',
          requestId: 'ai-1', token: 'session-token', method: 'ai.generate',
          args: { system: 'System instructions', user: 'Example repository' },
          origin: 'plugin-page://com.example.page' },
        origin: 'plugin-page://com.example.page', source: frame.contentWindow,
      }));
    });
    expect(confirm).toHaveBeenCalledWith('允许插件调用 AI？', expect.stringContaining('Example repository'), expect.any(Object));
    expect(requestPageCapability).toHaveBeenCalledTimes(2);
    expect(generateChatText).toHaveBeenCalledWith({ system: 'System instructions', user: 'Example repository', maxTokens: undefined, signal: expect.any(AbortSignal) });
    const response = postMessage.mock.calls.find(([message]) => (message as { requestId?: string }).requestId === 'ai-1')?.[0];
    expect(response).toEqual(expect.objectContaining({ success: true, value: 'Generated answer' }));
    expect(JSON.stringify(response)).not.toContain('test-secret');
  });

  it('does not call the AI provider when the user rejects the request', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'session-token' });
    getPage.mockResolvedValue({ success: true, url: 'plugin-page://com.example.page/dashboard/index.html' });
    requestPageCapability.mockResolvedValue({ success: true, value: null });
    getState.mockReturnValue({
      aiConfigs: [{ id: 'provider', name: 'Example AI', model: 'sample-model', baseUrl: 'https://ai.example/v1' }],
      activeAIConfig: 'provider', language: 'zh',
    });
    confirm.mockResolvedValue(false);
    render(<PluginPageViewer pluginId="com.example.page" pluginName="Example" pageId="dashboard"
      pageTitle="Dashboard" onClose={() => {}} t={t} />);
    const frame = await screen.findByTitle('Example: Dashboard') as HTMLIFrameElement;
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage');
    fireEvent.load(frame);
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'plugin-page:request', pluginId: 'com.example.page', pageId: 'dashboard',
          requestId: 'ai-2', token: 'session-token', method: 'ai.generate',
          args: { system: '', user: 'Example repository' },
          origin: 'plugin-page://com.example.page' },
        origin: 'plugin-page://com.example.page', source: frame.contentWindow,
      }));
    });
    expect(generateChatText).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'ai-2', success: false, error: expect.objectContaining({ code: 'PLUGIN_AI_CANCELLED' }),
    }), 'plugin-page://com.example.page');
  });

  it('asks before sending a web search to the configured service', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'session-token' });
    getPage.mockResolvedValue({ success: true, url: 'plugin-page://com.example.page/dashboard/index.html' });
    requestPageCapability.mockResolvedValue({ success: true, value: null });
    getSearchEndpoint.mockResolvedValue({ endpoint: 'https://search.example.com' });
    confirm.mockResolvedValue(true);
    searchWeb.mockResolvedValue({ success: true, value: [{ title: 'Example', url: 'https://example.com', snippet: '' }] });
    render(<PluginPageViewer pluginId="com.example.page" pluginName="Example" pageId="dashboard"
      pageTitle="Dashboard" onClose={() => {}} t={t} />);
    const frame = await screen.findByTitle('Example: Dashboard') as HTMLIFrameElement;
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage');
    fireEvent.load(frame);
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'plugin-page:request', pluginId: 'com.example.page', pageId: 'dashboard',
          requestId: 'search-1', token: 'session-token', method: 'web.search', args: { query: 'Example', limit: 2 },
          origin: 'plugin-page://com.example.page' },
        origin: 'plugin-page://com.example.page', source: frame.contentWindow,
      }));
    });
    expect(confirm).toHaveBeenCalledWith('允许插件联网搜索？', expect.stringContaining('https://search.example.com'), expect.any(Object));
    expect(searchWeb).toHaveBeenCalledWith({ pluginId: 'com.example.page', pageId: 'dashboard', args: { query: 'Example', limit: 2 } });
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'search-1', success: true }), 'plugin-page://com.example.page');
  });

  it('loads a sandboxed page and forwards only valid bridge messages', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'session-token' });
    getPage.mockResolvedValue({ success: true, url: 'plugin-page://com.example.page/dashboard/index.html' });
    requestPageCapability.mockResolvedValue({ success: true, value: [{ id: 1 }] });
    render(<PluginPageViewer
      pluginId="com.example.page" pluginName="Example" pageId="dashboard" pageTitle="Dashboard"
      onClose={() => {}} t={t}
    />);
    const frame = await screen.findByTitle('Example: Dashboard') as HTMLIFrameElement;
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage');
    fireEvent.load(frame);
    expect(postMessage).toHaveBeenCalledWith({
      type: 'plugin-page:init', pluginId: 'com.example.page', pageId: 'dashboard', token: 'session-token',
    }, 'plugin-page://com.example.page');

    const request = {
      type: 'plugin-page:request', pluginId: 'com.example.page', pageId: 'dashboard',
      requestId: '1', token: 'session-token', method: 'repositories.search', args: { query: 'react' },
      origin: 'plugin-page://com.example.page',
    };
    expect(validatePluginPageMessage(new MessageEvent('message', {
      data: request, origin: 'plugin-page://com.example.page', source: frame.contentWindow,
    }), frame.contentWindow, 'com.example.page', 'dashboard', 'session-token')).toEqual(request);
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { ...request, token: 'wrong' }, origin: 'plugin-page://com.example.page', source: frame.contentWindow,
      }));
      window.dispatchEvent(new MessageEvent('message', {
        data: request, origin: 'https://attacker.example', source: frame.contentWindow,
      }));
      window.dispatchEvent(new MessageEvent('message', {
        data: request, origin: 'plugin-page://com.example.page', source: frame.contentWindow,
      }));
    });
    await waitFor(() => expect(requestPageCapability).toHaveBeenCalledTimes(1));
    expect(requestPageCapability).toHaveBeenCalledWith({
      pluginId: 'com.example.page', pageId: 'dashboard', method: 'repositories.search', args: { query: 'react' },
    });
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'plugin-page:response', requestId: '1', success: true, value: [{ id: 1 }],
    }), 'plugin-page://com.example.page');
  });

  it('responds with a structured error when request arguments exceed the limit', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'session-token' });
    getPage.mockResolvedValue({ success: true, url: 'plugin-page://com.example.page/dashboard/index.html' });
    render(<PluginPageViewer pluginId="com.example.page" pluginName="Example" pageId="dashboard"
      pageTitle="Dashboard" onClose={() => {}} t={t} />);
    const frame = await screen.findByTitle('Example: Dashboard') as HTMLIFrameElement;
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage');
    fireEvent.load(frame);

    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'plugin-page:request', pluginId: 'com.example.page', pageId: 'dashboard',
          requestId: 'large', token: 'session-token', method: 'repositories.search',
          args: { query: 'x'.repeat(1024 * 1024) },
          origin: 'plugin-page://com.example.page' },
        origin: 'plugin-page://com.example.page', source: frame.contentWindow,
      }));
    });

    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'large', success: false,
      error: expect.objectContaining({ code: 'PLUGIN_PAGE_REQUEST_TOO_LARGE' }),
    }), 'plugin-page://com.example.page');
    expect(requestPageCapability).not.toHaveBeenCalled();
  });

  it('lets binary export payloads use the larger budget shared with the main process', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'session-token' });
    getPage.mockResolvedValue({ success: true, url: 'plugin-page://com.example.page/dashboard/index.html' });
    requestPageCapability.mockResolvedValue({ success: true, value: { fileName: 'card.png' } });
    render(<PluginPageViewer pluginId="com.example.page" pluginName="Example" pageId="dashboard"
      pageTitle="Dashboard" onClose={() => {}} t={t} />);
    const frame = await screen.findByTitle('Example: Dashboard') as HTMLIFrameElement;
    fireEvent.load(frame);

    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'plugin-page:request', pluginId: 'com.example.page', pageId: 'dashboard',
          requestId: 'png', token: 'session-token', method: 'downloads.saveFile',
          args: { fileName: 'card.png', dataBase64: 'A'.repeat(2 * 1024 * 1024) },
          origin: 'plugin-page://com.example.page' },
        origin: 'plugin-page://com.example.page', source: frame.contentWindow,
      }));
    });

    await waitFor(() => expect(requestPageCapability).toHaveBeenCalledWith({
      pluginId: 'com.example.page', pageId: 'dashboard', method: 'downloads.saveFile',
      args: { fileName: 'card.png', dataBase64: 'A'.repeat(2 * 1024 * 1024) },
    }));
  });
});

describe('PluginPageViewer init context (V1.4 modal actions)', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('passes the one-shot context with plugin-page:init and keeps bridge methods permission-checked', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'session-token' });
    getPage.mockResolvedValue({ success: true, url: 'plugin-page://com.example.page/dashboard/index.html' });
    requestPageCapability.mockResolvedValue({ success: true, value: null });
    const t = makeT('zh', 'app');
    render(<PluginPageViewer pluginId="com.example.page" pluginName="Example" pageId="dashboard"
      pageTitle="Dashboard" onClose={() => {}} t={t}
      variant="modal"
      initContext={{ repository: { id: 7, full_name: 'a/b' }, readme: null, language: 'zh' }} />);
    const frame = await screen.findByTitle('Example: Dashboard') as HTMLIFrameElement;
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage');
    fireEvent.load(frame);
    expect(postMessage).toHaveBeenCalledWith({
      type: 'plugin-page:init', pluginId: 'com.example.page', pageId: 'dashboard', token: 'session-token',
      context: { repository: { id: 7, full_name: 'a/b' }, readme: null, language: 'zh' },
    }, 'plugin-page://com.example.page');
    // 普通桥方法仍然走 IPC 能力桥，不受上下文影响。
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'plugin-page:request', pluginId: 'com.example.page', pageId: 'dashboard',
          requestId: 'clip-1', token: 'session-token', method: 'clipboard.write',
          args: { text: 'hello' },
          origin: 'plugin-page://com.example.page' },
        origin: 'plugin-page://com.example.page', source: frame.contentWindow,
      }));
    });
    await waitFor(() => expect(requestPageCapability).toHaveBeenCalledWith({
      pluginId: 'com.example.page', pageId: 'dashboard', method: 'clipboard.write', args: { text: 'hello' },
    }));
  });

  it('re-sends init with the same token when the context arrives later', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'session-token' });
    getPage.mockResolvedValue({ success: true, url: 'plugin-page://com.example.page/dashboard/index.html' });
    const t = makeT('zh', 'app');
    const { rerender } = render(<PluginPageViewer pluginId="com.example.page" pluginName="Example"
      pageId="dashboard" pageTitle="Dashboard" onClose={() => {}} t={t} variant="modal"
      initContext={{ repository: { id: 7, full_name: 'a/b' }, readme: null, language: 'zh' }} />);
    const frame = await screen.findByTitle('Example: Dashboard') as HTMLIFrameElement;
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage');
    fireEvent.load(frame);

    rerender(<PluginPageViewer pluginId="com.example.page" pluginName="Example" pageId="dashboard"
      pageTitle="Dashboard" onClose={() => {}} t={t} variant="modal"
      initContext={{ repository: { id: 7, full_name: 'a/b' }, readme: '# readme', language: 'zh' }} />);

    await waitFor(() => expect(postMessage).toHaveBeenCalledWith({
      type: 'plugin-page:init', pluginId: 'com.example.page', pageId: 'dashboard', token: 'session-token',
      context: { repository: { id: 7, full_name: 'a/b' }, readme: '# readme', language: 'zh' },
    }, 'plugin-page://com.example.page'));
  });

  it('renders without a header row in the modal variant', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'session-token' });
    getPage.mockResolvedValue({ success: true, url: 'plugin-page://com.example.page/dashboard/index.html' });
    const t = makeT('zh', 'app');
    render(<PluginPageViewer pluginId="com.example.page" pluginName="Example" pageId="dashboard"
      pageTitle="Dashboard" onClose={() => {}} t={t} variant="modal" />);
    await screen.findByTitle('Example: Dashboard');
    expect(screen.queryByText('Example · Dashboard')).toBeNull();
    expect(screen.queryByText(t('pluginPageViewer.back-to-plugins'))).toBeNull();
  });

  it('proxies network.request through the host with the user token attached', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'session-token' });
    getPage.mockResolvedValue({ success: true, url: 'plugin-page://com.example.page/dashboard/index.html' });
    requestPageCapability.mockResolvedValue({ success: true, value: null });
    // 渲染端 hook 通过被 mock 的 useAppStore selector 读取 token，必须挂在模块级 storeState 上。
    storeState.githubToken = 'gh-token-sample';
    getState.mockReturnValue({ language: 'zh', githubToken: 'gh-token-sample' });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ total: 42 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<PluginPageViewer pluginId="com.example.page" pluginName="Example" pageId="dashboard"
      pageTitle="Dashboard" onClose={() => {}} t={t} />);
    const frame = await screen.findByTitle('Example: Dashboard') as HTMLIFrameElement;
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage');
    fireEvent.load(frame);
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'plugin-page:request', pluginId: 'com.example.page', pageId: 'dashboard',
          requestId: 'net-1', token: 'session-token', method: 'network.request',
          args: { host: 'api.github.com', path: '/repos/o/r/contributors', query: { per_page: 12 } },
          origin: 'plugin-page://com.example.page' },
        origin: 'plugin-page://com.example.page', source: frame.contentWindow,
      }));
    });
    expect(requestPageCapability).toHaveBeenCalledWith({
      pluginId: 'com.example.page', pageId: 'dashboard', method: 'network.request',
      args: { host: 'api.github.com', path: '/repos/o/r/contributors', query: { per_page: 12 } },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/o/r/contributors?per_page=12');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer gh-token-sample');
    expect((init.headers as Record<string, string>)['X-GitHub-Api-Version']).toBe('2022-11-28');
    expect(init.method).toBe('GET');
    const response = postMessage.mock.calls.find(([message]) => (message as { requestId?: string }).requestId === 'net-1')?.[0];
    expect(response).toEqual(expect.objectContaining({ success: true, value: { status: 200, body: { total: 42 } } }));
    expect(JSON.stringify(response)).not.toContain('gh-token-sample');
  });

  it('maps GitHub HTTP failures to a structured network error', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'session-token' });
    getPage.mockResolvedValue({ success: true, url: 'plugin-page://com.example.page/dashboard/index.html' });
    requestPageCapability.mockResolvedValue({ success: true, value: null });
    getState.mockReturnValue({ language: 'zh', githubToken: null });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 })));
    render(<PluginPageViewer pluginId="com.example.page" pluginName="Example" pageId="dashboard"
      pageTitle="Dashboard" onClose={() => {}} t={t} />);
    const frame = await screen.findByTitle('Example: Dashboard') as HTMLIFrameElement;
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage');
    fireEvent.load(frame);
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'plugin-page:request', pluginId: 'com.example.page', pageId: 'dashboard',
          requestId: 'net-2', token: 'session-token', method: 'network.request',
          args: { host: 'api.github.com', path: '/repos/o/r/stats/commit_activity' },
          origin: 'plugin-page://com.example.page' },
        origin: 'plugin-page://com.example.page', source: frame.contentWindow,
      }));
    });
    const response = postMessage.mock.calls.find(([message]) => (message as { requestId?: string }).requestId === 'net-2')?.[0];
    expect(response).toEqual(expect.objectContaining({
      success: false,
      error: expect.objectContaining({ code: 'PLUGIN_NETWORK_HTTP_ERROR', message: expect.stringContaining('404') }),
    }));
  });

  it('surfaces 202 statistics-pending responses as body-null success', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'session-token' });
    getPage.mockResolvedValue({ success: true, url: 'plugin-page://com.example.page/dashboard/index.html' });
    requestPageCapability.mockResolvedValue({ success: true, value: null });
    storeState.githubToken = null;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 202 })));
    render(<PluginPageViewer pluginId="com.example.page" pluginName="Example" pageId="dashboard"
      pageTitle="Dashboard" onClose={() => {}} t={t} />);
    const frame = await screen.findByTitle('Example: Dashboard') as HTMLIFrameElement;
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage');
    fireEvent.load(frame);
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'plugin-page:request', pluginId: 'com.example.page', pageId: 'dashboard',
          requestId: 'net-202', token: 'session-token', method: 'network.request',
          args: { host: 'api.github.com', path: '/repos/o/r/stats/commit_activity' },
          origin: 'plugin-page://com.example.page' },
        origin: 'plugin-page://com.example.page', source: frame.contentWindow,
      }));
    });
    const response = postMessage.mock.calls.find(([message]) => (message as { requestId?: string }).requestId === 'net-202')?.[0];
    expect(response).toEqual(expect.objectContaining({ success: true, value: { status: 202, body: null } }));
  });

  it('blocks non-allowlisted network targets before any request leaves the host', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'session-token' });
    getPage.mockResolvedValue({ success: true, url: 'plugin-page://com.example.page/dashboard/index.html' });
    requestPageCapability.mockResolvedValue({ success: true, value: null });
    getState.mockReturnValue({ language: 'zh', githubToken: null });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<PluginPageViewer pluginId="com.example.page" pluginName="Example" pageId="dashboard"
      pageTitle="Dashboard" onClose={() => {}} t={t} />);
    const frame = await screen.findByTitle('Example: Dashboard') as HTMLIFrameElement;
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage');
    fireEvent.load(frame);
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'plugin-page:request', pluginId: 'com.example.page', pageId: 'dashboard',
          requestId: 'net-3', token: 'session-token', method: 'network.request',
          args: { host: 'evil.example', path: '/repos/o/r' },
          origin: 'plugin-page://com.example.page' },
        origin: 'plugin-page://com.example.page', source: frame.contentWindow,
      }));
    });
    expect(requestPageCapability).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    const response = postMessage.mock.calls.find(([message]) => (message as { requestId?: string }).requestId === 'net-3')?.[0];
    expect(response).toEqual(expect.objectContaining({
      success: false,
      error: expect.objectContaining({ code: 'PLUGIN_PAGE_REQUEST_INVALID' }),
    }));
  });
});

