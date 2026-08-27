import { describe, it, expect } from 'vitest';
import type { Repository } from '../types';
import {
  performBasicTextSearch,
  applyRepoFilters,
  searchRepositories,
  projectRepoForAgent,
} from './repoSearch';
import { NO_LICENSE_SENTINEL, normalizeLicense } from './licenseFilter';

function makeRepo(partial: Partial<Repository> & Pick<Repository, 'id' | 'name' | 'full_name'>): Repository {
  return {
    description: null,
    html_url: `https://github.com/${partial.full_name}`,
    stargazers_count: 100,
    forks_count: 10,
    forks: 10,
    language: 'TypeScript',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-06-01T00:00:00Z',
    pushed_at: '2024-06-01T00:00:00Z',
    owner: { login: 'owner', avatar_url: '' },
    topics: [],
    ...partial,
  };
}

const sample: Repository[] = [
  makeRepo({
    id: 1,
    name: 'alpha',
    full_name: 'acme/alpha',
    description: 'offline first CRDT',
    language: 'Rust',
    stargazers_count: 500,
    ai_summary: 'A CRDT library for sync',
    ai_tags: ['crdt', 'sync'],
    ai_platforms: ['cli'],
    topics: ['database'],
    license: 'MIT',
  }),
  makeRepo({
    id: 2,
    name: 'beta',
    full_name: 'acme/beta',
    description: 'webdav client',
    language: 'TypeScript',
    stargazers_count: 50,
    ai_tags: ['webdav'],
    custom_category: 'tools',
    license: 'GPL-3.0',
  }),
  makeRepo({
    id: 3,
    name: 'gamma',
    full_name: 'acme/gamma',
    description: 'ssrf helper',
    language: 'Go',
    stargazers_count: 200,
    analyzed_at: '2024-01-01',
    analysis_failed: true,
    license: 'NOASSERTION',
  }),
];

describe('performBasicTextSearch', () => {
  it('matches AND of words across AI fields', () => {
    const hits = performBasicTextSearch(sample, 'crdt sync');
    expect(hits.map((r) => r.id)).toEqual([1]);
  });

  it('matches custom tags and topics', () => {
    const hits = performBasicTextSearch(sample, 'database');
    expect(hits.map((r) => r.id)).toEqual([1]);
  });

  it('returns all for empty query', () => {
    expect(performBasicTextSearch(sample, '  ').length).toBe(3);
  });
});

describe('applyRepoFilters', () => {
  it('filters by language and min stars', () => {
    const hits = applyRepoFilters(sample, { languages: ['Rust'], minStars: 100 });
    expect(hits.map((r) => r.id)).toEqual([1]);
  });

  it('filters by tags across ai/topics/custom', () => {
    const hits = applyRepoFilters(sample, { tags: ['webdav'] });
    expect(hits.map((r) => r.id)).toEqual([2]);
  });

  it('sorts by stars desc by default', () => {
    const hits = applyRepoFilters(sample, { sortBy: 'stars', sortOrder: 'desc' });
    expect(hits.map((r) => r.id)).toEqual([1, 3, 2]);
  });

  it('sorts recently updated repositories by GitHub updated_at rather than last pushed_at', () => {
    const repositories = [
      makeRepo({ id: 10, name: 'older-update', full_name: 'acme/older-update', updated_at: '2026-01-01T00:00:00Z', pushed_at: '2026-06-01T00:00:00Z' }),
      makeRepo({ id: 11, name: 'newer-update', full_name: 'acme/newer-update', updated_at: '2026-05-01T00:00:00Z', pushed_at: '2026-02-01T00:00:00Z' }),
    ];

    const hits = applyRepoFilters(repositories, { sortBy: 'updated', sortOrder: 'desc' });
    expect(hits.map((repository) => repository.id)).toEqual([11, 10]);
  });

  it('filters by SPDX id license', () => {
    const hits = applyRepoFilters(sample, { licenses: ['MIT'] });
    expect(hits.map((r) => r.id)).toEqual([1]);
  });

  it('aggregates no-license repos via the sentinel', () => {
    // normalizeLicense collapses every no-license shape to the sentinel, so the
    // "no license" UI bucket is a single stable key regardless of how GitHub
    // reports the absence: null/'Other' (key-only licenses)/'NOASSERTION'/
    // 'none'/''/and mixed-case 'noassertion' all collapse to NO_LICENSE_SENTINEL.
    expect(normalizeLicense(null)).toBe(NO_LICENSE_SENTINEL);
    expect(normalizeLicense('NOASSERTION')).toBe(NO_LICENSE_SENTINEL);
    expect(normalizeLicense('Other')).toBe(NO_LICENSE_SENTINEL);
    expect(normalizeLicense('none')).toBe(NO_LICENSE_SENTINEL);
    expect(normalizeLicense('')).toBe(NO_LICENSE_SENTINEL);
    expect(normalizeLicense('noassertion')).toBe(NO_LICENSE_SENTINEL);
    expect(normalizeLicense('NoAssertion')).toBe(NO_LICENSE_SENTINEL);

    // A repo whose stored license collapses to the sentinel is matched by the
    // "no license" filter. (sample[2] carries license: 'NOASSERTION' → sentinel.)
    const hits = applyRepoFilters(sample, { licenses: [NO_LICENSE_SENTINEL] });
    expect(hits.map((r) => r.id)).toEqual([3]);
  });
});

describe('searchRepositories', () => {
  it('paginates and reports total', () => {
    const { items, total } = searchRepositories(sample, { query: '', limit: 1, offset: 1, sortBy: 'stars', sortOrder: 'desc' });
    expect(total).toBe(3);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(3);
  });

  it('filters by custom_category', () => {
    const { items, total } = searchRepositories(sample, { category: 'tools' });
    expect(total).toBe(1);
    expect(items[0].full_name).toBe('acme/beta');
  });
});

describe('projectRepoForAgent', () => {
  it('truncates long summaries', () => {
    const long = makeRepo({
      id: 9,
      name: 'x',
      full_name: 'a/x',
      ai_summary: 'y'.repeat(500),
    });
    const projected = projectRepoForAgent(long, { summaryMaxChars: 50 });
    expect(String(projected.ai_summary).length).toBeLessThanOrEqual(51);
  });
});
