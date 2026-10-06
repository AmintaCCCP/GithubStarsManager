import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installFetchCapture,
  uninstallFetchCapture,
  getNetworkEntries,
  clearNetworkEntries,
  setNetworkEntrySink,
  resetFetchCaptureForTest,
  BODY_CAPTURE_BUDGET,
} from './fetchCapture';
import type { LogEntry } from './logger';

type FetchStub = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function jsonResponse(body: string, status = 200, headers: Record<string, string> = { 'content-type': 'application/json' }): Response {
  return new Response(body, { status, headers });
}

function setDebugMode(enabled: boolean): void {
  sessionStorage.setItem('gsm:frontend-debug', String(enabled));
}

describe('fetchCapture', () => {
  const sinkEntries: LogEntry[] = [];
  const sink = (entry: LogEntry) => { sinkEntries.push(entry); };

  beforeEach(() => {
    resetFetchCaptureForTest();
    sinkEntries.length = 0;
    setNetworkEntrySink(sink);
    setDebugMode(false);
  });

  afterEach(() => {
    uninstallFetchCapture();
    setNetworkEntrySink(null);
    vi.restoreAllMocks();
  });

  it('records failures only in normal mode (reject → error, 4xx → warn, 2xx silent)', async () => {
    const impl: FetchStub = vi.fn(async (input) => {
      const url = String(input);
      if (url.endsWith('reject')) throw new TypeError('fetch failed');
      if (url.endsWith('bad')) return jsonResponse('nope', 404);
      return jsonResponse('ok');
    });
    (window as unknown as { fetch: FetchStub }).fetch = impl;
    installFetchCapture();

    await window.fetch('https://api.example.com/ok');
    await window.fetch('https://api.example.com/bad');
    await window.fetch('https://api.example.com/reject').catch(() => {});

    const entries = getNetworkEntries();
    expect(entries.map((e) => e.level).sort()).toEqual(['error', 'warn']);
    expect(entries.every((e) => e.module === 'net.fetch')).toBe(true);
    expect(sinkEntries.length).toBe(2);
  });

  it('records user aborts (AbortError) as info with errorName, not error', async () => {
    const impl: FetchStub = vi.fn(async () => {
      throw new DOMException('signal is aborted without reason', 'AbortError');
    });
    (window as unknown as { fetch: FetchStub }).fetch = impl;
    installFetchCapture();

    await window.fetch('https://api.example.com/aborted').catch(() => {});

    const entries = getNetworkEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].level).toBe('info');
    expect(entries[0].message).toContain('aborted');
    const data = entries[0].data as Record<string, unknown>;
    expect(data.errorName).toBe('AbortError');
    // jsdom's DOMException is not an Error subclass, so detail falls back to
    // String(error) ("AbortError: <message>"); assert on the message itself.
    expect(String(data.detail)).toContain('signal is aborted without reason');
  });

  it('records timeout aborts (DOMException TimeoutError) as info with errorName', async () => {
    const impl: FetchStub = vi.fn(async () => {
      throw new DOMException('The operation timed out', 'TimeoutError');
    });
    (window as unknown as { fetch: FetchStub }).fetch = impl;
    installFetchCapture();

    await window.fetch('https://api.example.com/timeout').catch(() => {});

    const entries = getNetworkEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].level).toBe('info');
    expect((entries[0].data as Record<string, unknown>).errorName).toBe('TimeoutError');
  });

  it('keeps non-abort rejections at error level and attaches errorName', async () => {
    const impl: FetchStub = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    (window as unknown as { fetch: FetchStub }).fetch = impl;
    installFetchCapture();

    await window.fetch('https://api.example.com/reject').catch(() => {});

    const entries = getNetworkEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].level).toBe('error');
    expect(entries[0].message).toContain('failed');
    const data = entries[0].data as Record<string, unknown>;
    expect(data.errorName).toBe('TypeError');
    expect(data.detail).toBe('fetch failed');
  });

  it('keeps request/response forwarding transparent', async () => {
    const impl: FetchStub = vi.fn(async () => jsonResponse('payload'));
    (window as unknown as { fetch: FetchStub }).fetch = impl;
    installFetchCapture();

    const response = await window.fetch('https://api.example.com/x', { method: 'POST', body: 'hello' });
    expect(await response.text()).toBe('payload');
    expect(impl).toHaveBeenCalledWith('https://api.example.com/x', { method: 'POST', body: 'hello' });
    expect(getNetworkEntries()).toEqual([]);
  });

  it('debug mode records all requests with sanitized headers and body preview', async () => {
    setDebugMode(true);
    const impl: FetchStub = vi.fn(async () => jsonResponse('{"answer":1}', 200, { 'content-type': 'application/json', 'content-length': '11' }));
    (window as unknown as { fetch: FetchStub }).fetch = impl;
    installFetchCapture();

    await window.fetch('https://api.example.com/x?token=secretvalue', {
      headers: { Authorization: 'Bearer sk-abcdef123456789012345678', Cookie: 'a=b; c=d', Accept: 'application/json' },
      body: '{"prompt":"hi"}',
    });
    // The clone-branch preview lands asynchronously; wait a microtask turn.
    await new Promise((r) => setTimeout(r, 10));

    const entries = getNetworkEntries();
    expect(entries.length).toBeGreaterThanOrEqual(1);
    const first = entries[0];
    expect(first.level).toBe('debug');
    const data = first.data as Record<string, unknown>;
    expect(String(data.url)).not.toContain('secretvalue');
    expect((data.requestHeaders as Record<string, string>).Authorization).toBe('Bearer ***5678');
    expect((data.requestHeaders as Record<string, string>).Cookie).toBe('***');
    expect(data.requestBody).toContain('prompt');
    expect(first.message).toContain('→ 200');
  });

  it('masks credentials embedded in JSON response bodies', async () => {
    setDebugMode(true);
    const impl: FetchStub = vi.fn(async () => jsonResponse('{"access_token":"secrettokenvalue123456"}', 200, { 'content-type': 'application/json' }));
    (window as unknown as { fetch: FetchStub }).fetch = impl;
    installFetchCapture();

    await window.fetch('https://api.example.com/oauth');
    await new Promise((r) => setTimeout(r, 10));

    const bodyEntries = getNetworkEntries().filter((e) => (e.data as Record<string, unknown>)?.responseBody !== undefined);
    expect(bodyEntries.length).toBe(1);
    const responseBody = String((bodyEntries[0].data as Record<string, unknown>).responseBody);
    expect(responseBody).not.toContain('secrettokenvalue123456');
    expect(responseBody).toContain('***');
  });

  it('omits previews for request bodies beyond the capture budget', async () => {
    setDebugMode(true);
    const impl: FetchStub = vi.fn(async () => jsonResponse('ok'));
    (window as unknown as { fetch: FetchStub }).fetch = impl;
    installFetchCapture();

    await window.fetch('https://api.example.com/upload', { method: 'PUT', body: 'x'.repeat(300 * 1024) });
    await new Promise((r) => setTimeout(r, 10));
    const entries = getNetworkEntries();
    expect(entries.length).toBe(1);
    expect((entries[0].data as Record<string, unknown>).requestBody).toBeUndefined();
  });

  it('skips body capture for SSE responses (response content-type decides)', async () => {
    setDebugMode(true);
    const impl: FetchStub = vi.fn(async () => jsonResponse('data: x', 200, { 'content-type': 'text/event-stream' }));
    (window as unknown as { fetch: FetchStub }).fetch = impl;
    installFetchCapture();

    await window.fetch('https://api.example.com/stream');
    await new Promise((r) => setTimeout(r, 10));

    const withBody = getNetworkEntries().filter((e) => (e.data as Record<string, unknown>)?.responseBody !== undefined);
    expect(withBody).toEqual([]);
  });

  it('skips body capture for binary responses and oversized content-length', async () => {
    setDebugMode(true);
    const impl: FetchStub = vi.fn(async (input) => (
      String(input).endsWith('bin')
        ? jsonResponse('binary', 200, { 'content-type': 'image/png' })
        : jsonResponse('huge', 200, { 'content-type': 'application/json', 'content-length': String(300 * 1024) })
    ));
    (window as unknown as { fetch: FetchStub }).fetch = impl;
    installFetchCapture();

    await window.fetch('https://api.example.com/bin');
    await window.fetch('https://api.example.com/huge');
    await new Promise((r) => setTimeout(r, 10));

    expect(getNetworkEntries().filter((e) => (e.data as Record<string, unknown>)?.responseBody !== undefined)).toEqual([]);
  });

  it('enforces the per-minute body capture budget', async () => {
    setDebugMode(true);
    const impl: FetchStub = vi.fn(async () => jsonResponse('body'));
    (window as unknown as { fetch: FetchStub }).fetch = impl;
    installFetchCapture();

    for (let i = 0; i < BODY_CAPTURE_BUDGET + 5; i++) {
      await window.fetch(`https://api.example.com/${i}`);
    }
    await new Promise((r) => setTimeout(r, 20));

    // One ledger entry per request: the first 60 carry a body preview, the
    // rest degrade to metadata-only for the rest of the minute.
    const entries = getNetworkEntries();
    expect(entries.length).toBe(BODY_CAPTURE_BUDGET + 5);
    const bodyEntries = entries.filter((e) => (e.data as Record<string, unknown>)?.responseBody !== undefined);
    expect(bodyEntries.length).toBe(BODY_CAPTURE_BUDGET);
  });

  it('install is idempotent and uninstall restores the original fetch', async () => {
    const impl: FetchStub = vi.fn(async () => jsonResponse('ok'));
    (window as unknown as { fetch: FetchStub }).fetch = impl;
    installFetchCapture();
    installFetchCapture();
    await window.fetch('https://api.example.com/ok');
    expect(impl).toHaveBeenCalledTimes(1);
    uninstallFetchCapture();
    await window.fetch('https://api.example.com/ok');
    expect(impl).toHaveBeenCalledTimes(2);
  });

  it('caps the ledger ring buffer at 1000 entries (FIFO)', async () => {
    setDebugMode(true);
    const impl: FetchStub = vi.fn(async () => jsonResponse('ok'));
    (window as unknown as { fetch: FetchStub }).fetch = impl;
    installFetchCapture();
    for (let i = 0; i < 1005; i++) {
      await window.fetch(`https://api.example.com/${i}`);
    }
    const entries = getNetworkEntries();
    expect(entries.length).toBe(1000);
    expect(String((entries[0].data as Record<string, unknown>).url)).not.toContain('/0"');
    clearNetworkEntries();
    expect(getNetworkEntries()).toEqual([]);
  });
});
