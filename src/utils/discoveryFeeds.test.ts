import { describe, expect, it } from 'vitest';
import { normalizeDiscoveryFeedUrl, normalizeExternalDiscoveryChannels, parseDiscoveryFeedRepositories } from './discoveryFeeds';

describe('external discovery feed input', () => {
  it('accepts only public HTTPS feed URLs without embedded credentials', () => {
    expect(normalizeDiscoveryFeedUrl('https://example.com/feed.json#section')).toBe('https://example.com/feed.json');
    expect(normalizeDiscoveryFeedUrl('http://example.com/feed.json')).toBeNull();
    expect(normalizeDiscoveryFeedUrl('https://user:secret@example.com/feed.json')).toBeNull();
  });

  it('parses and deduplicates repository links without accepting arbitrary URLs', () => {
    expect(parseDiscoveryFeedRepositories({ repositories: ['https://github.com/owner/repo', 'owner/repo'] }))
      .toEqual(['owner/repo']);
    expect(() => parseDiscoveryFeedRepositories({ repositories: ['https://example.com/owner/repo'] })).toThrow();
    expect(() => parseDiscoveryFeedRepositories({ repositories: Array(31).fill('owner/repo') })).toThrow();
  });

  it('restores only well-formed custom channels from persisted data', () => {
    expect(normalizeExternalDiscoveryChannels([
      { id: 'external:one', name: 'My feed', sourceUrl: 'https://example.com/feed.json', enabled: false },
      { id: 'external:bad', name: 'Unsafe', sourceUrl: 'http://example.com/feed.json' },
      { id: 'trending', name: 'Override', sourceUrl: 'https://example.com/other.json' },
    ])).toEqual([{
      id: 'external:one', name: 'My feed', nameEn: 'My feed', icon: 'search',
      description: 'https://example.com/feed.json', sourceUrl: 'https://example.com/feed.json', enabled: false,
    }]);
  });
});
