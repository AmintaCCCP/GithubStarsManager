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
          args: { system: 'System instructions', user: 'Example repository' } },
        origin: 'null', source: frame.contentWindow,
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
          args: { system: '', user: 'Example repository' } },
        origin: 'null', source: frame.contentWindow,
      }));
    });
    expect(generateChatText).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'ai-2', success: false, error: expect.objectContaining({ code: 'PLUGIN_AI_CANCELLED' }),
    }), '*');
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
          requestId: 'search-1', token: 'session-token', method: 'web.search', args: { query: 'Example', limit: 2 } },
        origin: 'null', source: frame.contentWindow,
      }));
    });
    expect(confirm).toHaveBeenCalledWith('允许插件联网搜索？', expect.stringContaining('https://search.example.com'), expect.any(Object));
    expect(searchWeb).toHaveBeenCalledWith({ pluginId: 'com.example.page', pageId: 'dashboard', args: { query: 'Example', limit: 2 } });
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'search-1', success: true }), '*');
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
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage');
    fireEvent.load(frame);
    expect(postMessage).toHaveBeenCalledWith({
      type: 'plugin-page:init', pluginId: 'com.example.page', pageId: 'dashboard', token: 'session-token',
    }, '*');

    const request = {
      type: 'plugin-page:request', pluginId: 'com.example.page', pageId: 'dashboard',
      requestId: '1', token: 'session-token', method: 'repositories.search', args: { query: 'react' },
    };
    expect(validatePluginPageMessage(new MessageEvent('message', {
      data: request, origin: 'null', source: frame.contentWindow,
    }), frame.contentWindow, 'com.example.page', 'dashboard', 'session-token')).toEqual(request);
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { ...request, token: 'wrong' }, origin: 'null', source: frame.contentWindow,
      }));
      window.dispatchEvent(new MessageEvent('message', {
        data: request, origin: 'https://attacker.example', source: frame.contentWindow,
      }));
      window.dispatchEvent(new MessageEvent('message', {
        data: request, origin: 'null', source: frame.contentWindow,
      }));
    });
    await waitFor(() => expect(requestPageCapability).toHaveBeenCalledTimes(1));
    expect(requestPageCapability).toHaveBeenCalledWith({
      pluginId: 'com.example.page', pageId: 'dashboard', method: 'repositories.search', args: { query: 'react' },
    });
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'plugin-page:response', requestId: '1', success: true, value: [{ id: 1 }],
    }), '*');
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
          args: { query: 'x'.repeat(1024 * 1024) } },
        origin: 'null', source: frame.contentWindow,
      }));
    });

    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'large', success: false,
      error: expect.objectContaining({ code: 'PLUGIN_PAGE_REQUEST_TOO_LARGE' }),
    }), '*');
    expect(requestPageCapability).not.toHaveBeenCalled();
  });
});
