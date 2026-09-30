import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GitHubApiService } from './githubApi';
import { loadExternalDiscoveryFeed, readExternalDiscoveryFeed } from './externalDiscoveryFeed';

afterEach(() => vi.unstubAllGlobals());

describe('external discovery feed', () => {
  it('checks format before saving and fetches without credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ repositories: ['owner/repo'] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await readExternalDiscoveryFeed('https://example.com/feed.json')).toEqual(['owner/repo']);
    expect(fetchMock).toHaveBeenCalledWith('https://example.com/feed.json', {
      headers: { Accept: 'application/json' }, credentials: 'omit', signal: expect.any(AbortSignal),
    });
  });

  it('resolves feed entries to GitHub repository cards', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      repositories: ['https://github.com/owner/repo', 'owner/missing'],
    }), { status: 200 })));
    const api = { getRepositoryDetails: vi.fn()
      .mockResolvedValueOnce({ id: 1, name: 'repo', full_name: 'owner/repo' })
      .mockRejectedValueOnce(new Error('Not Found')) } as unknown as GitHubApiService;
    const result = await loadExternalDiscoveryFeed('https://example.com/feed.json', 'external:one', api);
    expect(result.repos).toMatchObject([{ id: 1, channel: 'external:one', platform: 'All', rank: 1 }]);
    expect(result.hasMore).toBe(false);
    expect(result.totalCount).toBe(1);
  });

  it('reports malformed feeds instead of creating an empty channel', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    await expect(readExternalDiscoveryFeed('https://example.com/feed.json')).rejects.toThrow('Invalid feed format');
  });

  it('reports an unreadable browser feed without contacting GitHub', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(readExternalDiscoveryFeed('https://example.com/feed.json')).rejects.toThrow('CORS');
  });

  it('stops reading a feed once its streamed body exceeds the size limit', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(128_001));
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream, { status: 200 })));
    await expect(readExternalDiscoveryFeed('https://example.com/feed.json')).rejects.toThrow('too large');
  });

  it('times out while reading a stalled feed body', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn().mockImplementation((_url: string, options: RequestInit) => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            options.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')));
          },
        });
        return Promise.resolve(new Response(stream, { status: 200 }));
      });
      vi.stubGlobal('fetch', fetchMock);
      const result = readExternalDiscoveryFeed('https://example.com/feed.json');
      const assertion = expect(result).rejects.toThrow('timed out');
      await vi.advanceTimersByTimeAsync(15_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
