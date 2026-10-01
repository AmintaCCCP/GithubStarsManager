import { describe, expect, it } from 'vitest';
import { parseDiscoveryRssRepositories } from './discoveryRss';

const RSS_ITEM = (link: string) => `<item><title>t</title><link>${link}</link></item>`;

describe('discovery RSS parsing', () => {
  it('extracts unique GitHub repositories from RSS items', () => {
    const xml = `<?xml version="1.0"?><rss><channel>
      ${RSS_ITEM('https://github.com/owner/repo')}
      ${RSS_ITEM('https://github.com/Owner/Repo#readme')}
      ${RSS_ITEM('https://github.com/owner/repo/issues/12')}
    </channel></rss>`;
    expect(parseDiscoveryRssRepositories(xml)).toEqual(['owner/repo']);
  });

  it('reads repositories from Atom entries and content bodies', () => {
    const xml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
      <entry><link href="https://github.com/vuejs/core"/></entry>
      <entry><content type="html">&lt;p&gt;Also check https://github.com/vitejs/vite.&lt;/p&gt;</content></entry>
    </feed>`;
    expect(parseDiscoveryRssRepositories(xml)).toEqual(['vuejs/core', 'vitejs/vite']);
  });

  it('skips GitHub site sections and caps at 30 entries', () => {
    const links = Array.from({ length: 40 }, (_, index) => RSS_ITEM(`https://github.com/owner/repo-${index}`));
    const xml = `<rss><channel>${links.join('')}
      ${RSS_ITEM('https://github.com/topics/javascript')}
      ${RSS_ITEM('https://github.com/trending')}
    </channel></rss>`;
    const result = parseDiscoveryRssRepositories(xml);
    expect(result).toHaveLength(30);
    expect(result[0]).toBe('owner/repo-0');
    expect(result.every(name => !name.startsWith('topics/'))).toBe(true);
  });

  it('rejects non-feed documents and feeds without repository links', () => {
    expect(() => parseDiscoveryRssRepositories('<html><body>hello</body></html>')).toThrow();
    expect(() => parseDiscoveryRssRepositories('')).toThrow();
    expect(() => parseDiscoveryRssRepositories('<rss><channel><item><title>no links</title></item></channel></rss>'))
      .toThrow('No GitHub repository links');
  });
});
