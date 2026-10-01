import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GitHubApiService } from './githubApi';
import { loadExternalDiscoveryFeed, readExternalDiscoveryFeed, readExternalDiscoveryRssFeed } from './externalDiscoveryFeed';

afterEach(() => vi.unstubAllGlobals());

describe('external discovery feed', () => {
  it('checks format before saving and fetches without credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ repositories: ['owner/repo'] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await readExternalDiscoveryFeed('https://example.com/feed.json')).toEqual(['owner/repo']);
    expect(fetchMock).toHaveBeenCalledWith('https://example.com/feed.json', {
      headers: { Accept: 'application/json, application/rss+xml, application/xml, text/xml' },
      credentials: 'omit', signal: expect.any(AbortSignal),
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

  it('extracts GitHub repositories from a validated RSS feed', async () => {
    const xml = '<rss><channel><item><link>https://github.com/owner/feed-repo</link></item></channel></rss>';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(xml, { status: 200 })));
    await expect(readExternalDiscoveryRssFeed('https://example.com/feed.xml')).resolves.toEqual(['owner/feed-repo']);
  });

  it('rejects an HTML page served at the RSS feed URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html><body>not a feed</body></html>', { status: 200 })));
    await expect(readExternalDiscoveryRssFeed('https://example.com/feed.xml')).rejects.toThrow('RSS or Atom');
  });

  it('loads RSS feed repositories through the GitHub API', async () => {
    const xml = '<rss><channel><item><link>https://github.com/owner/rss-repo</link></item></channel></rss>';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(xml, { status: 200 })));
    const api = { getRepositoryDetails: vi.fn().mockResolvedValue({ id: 7, name: 'rss-repo', full_name: 'owner/rss-repo' }) } as unknown as GitHubApiService;
    const result = await loadExternalDiscoveryFeed('https://example.com/feed.xml', 'external:rss-one', api, 'rss');
    expect(api.getRepositoryDetails).toHaveBeenCalledWith('owner', 'rss-repo', undefined);
    expect(result.repos).toMatchObject([{ id: 7, channel: 'external:rss-one', platform: 'All' }]);
  });

  it('passes an abort signal to GitHub detail requests', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ repositories: ['owner/repo'] }), { status: 200 })));
    const controller = new AbortController();
    const api = { getRepositoryDetails: vi.fn().mockResolvedValue({ id: 1, name: 'repo', full_name: 'owner/repo' }) } as unknown as GitHubApiService;
    await loadExternalDiscoveryFeed('https://example.com/feed.json', 'external:one', api, 'json', controller.signal);
    expect(api.getRepositoryDetails).toHaveBeenCalledWith('owner', 'repo', controller.signal);
  });

  it('stops issuing GitHub detail requests once the signal aborts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      repositories: Array.from({ length: 10 }, (_, index) => `owner/repo-${index}`),
    }), { status: 200 })));
    const controller = new AbortController();
    const api = { getRepositoryDetails: vi.fn().mockImplementation(async () => {
      controller.abort();
      throw new DOMException('Aborted', 'AbortError');
    }) } as unknown as GitHubApiService;
    await expect(loadExternalDiscoveryFeed('https://example.com/feed.json', 'external:one', api, 'json', controller.signal))
      .rejects.toThrow();
    // 第一批 5 个并发请求已发出；中止后不再进入第二批
    expect(api.getRepositoryDetails).toHaveBeenCalledTimes(5);
  });
});
