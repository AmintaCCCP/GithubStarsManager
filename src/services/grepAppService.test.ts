import { describe, expect, it, vi } from 'vitest';
import {
  buildGrepSearchUrl,
  filterStarredHits,
  normalizeGrepSearchResponse,
  sanitizeGrepSnippet,
  searchGrepApp,
} from './grepAppService';

describe('grepAppService', () => {
  it('builds fuzzy search url without mode flags', () => {
    const url = buildGrepSearchUrl({ q: 'star' });
    expect(url).toContain('q=star');
    expect(url).not.toContain('words=true');
    expect(url).not.toContain('regexp=true');
  });

  it('keeps words and regexp mutually exclusive by construction', () => {
    expect(buildGrepSearchUrl({ q: 'star', mode: 'words' })).toContain('words=true');
    expect(buildGrepSearchUrl({ q: 'a@b', mode: 'regexp', caseSensitive: true })).toContain('regexp=true');
    expect(buildGrepSearchUrl({ q: 'a@b', mode: 'regexp', caseSensitive: true })).toContain('case=true');
  });

  it('repeats f.* params for multi-value filters', () => {
    const url = buildGrepSearchUrl({ q: 'x', langs: ['TypeScript', 'JavaScript'], repos: ['a/b'], paths: ['src/'], page: 2 });
    expect(url).toContain('f.lang=TypeScript');
    expect(url).toContain('f.lang=JavaScript');
    expect(url).toContain('f.repo=a%2Fb');
    expect(url).toContain('f.path=src%2F');
    expect(url).toContain('page=2');
  });

  it('normalizes both plain-string and legacy {raw} hit shapes', () => {
    const result = normalizeGrepSearchResponse({
      facets: {
        count: 2,
        repo: { buckets: [{ val: 'a/b', count: 2 }] },
        path: { buckets: [{ val: 'src/', count: 1 }] },
        lang: { buckets: [{ val: 'TypeScript', count: 2 }] },
      },
      hits: {
        total: 2,
        hits: [
          { repo: 'a/b', branch: 'main', path: 'src/a.ts', language: 'TypeScript', total_matches: '4', content: { snippet: '<mark>x</mark>' } },
          { repo: { raw: 'c/d' }, branch: { raw: 'dev' }, path: { raw: 'x.md' }, language: { raw: 'Markdown' }, total_matches: { raw: '1' }, content: { snippet: 'y' } },
        ],
      },
    });
    expect(result.total).toBe(2);
    expect(result.hits[0]).toMatchObject({ repo: 'a/b', branch: 'main', totalMatches: '4' });
    expect(result.hits[1]).toMatchObject({ repo: 'c/d', branch: 'dev', totalMatches: '1' });
  });

  it('filters starred hits case-insensitively', () => {
    const hits = [
      { repo: 'AmintaCCCP/GithubStarsManager', branch: 'main', path: 'a', language: 'TS', totalMatches: '1', snippetHtml: '' },
      { repo: 'other/repo', branch: 'main', path: 'b', language: 'TS', totalMatches: '1', snippetHtml: '' },
    ];
    expect(filterStarredHits(hits, ['amintacccp/githubstarsmanager'])).toHaveLength(1);
  });

  it('sanitizes snippet executable payloads but keeps mark', () => {
    const out = sanitizeGrepSnippet('<table><tr><td onclick="evil()"><mark>x</mark><script>alert(1)</script></td></tr></table>');
    expect(out).toContain('<mark>x</mark>');
    expect(out).not.toContain('<script>');
    expect(out).not.toContain('onclick');
  });

  it('marks 429 with status for retry UI', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 429 });
    await expect(searchGrepApp({ q: 'star' }, { fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toMatchObject({ status: 429 });
  });

  it('returns empty result for blank query without fetching', async () => {
    const fetchImpl = vi.fn();
    const result = await searchGrepApp({ q: '  ' }, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result.hits).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
