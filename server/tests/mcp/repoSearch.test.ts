import { describe, it, expect } from 'vitest';
import {
  performBasicTextSearch,
  searchRepositories,
  projectRepoForAgent,
  matchesRepoFilters,
  type McpRepository,
} from '../../src/mcp/repoSearch.js';

function repo(partial: Partial<McpRepository> & Pick<McpRepository, 'id' | 'name' | 'full_name'>): McpRepository {
  return {
    description: null,
    html_url: `https://github.com/${partial.full_name}`,
    stargazers_count: 10,
    language: 'TS',
    topics: [],
    ...partial,
  };
}

const sample = [
  repo({
    id: 1,
    name: 'alpha',
    full_name: 'acme/alpha',
    ai_summary: 'CRDT offline sync',
    ai_tags: ['crdt'],
    stargazers_count: 100,
  }),
  repo({
    id: 2,
    name: 'beta',
    full_name: 'acme/beta',
    description: 'webdav',
    custom_category: 'tools',
    stargazers_count: 5,
  }),
];

describe('mcp repoSearch', () => {
  it('searches AI summary keywords', () => {
    const hits = performBasicTextSearch(sample, 'crdt offline');
    expect(hits.map((r) => r.id)).toEqual([1]);
  });

  it('paginates and filters category', () => {
    const { items, total } = searchRepositories(sample, { category: 'tools', limit: 10 });
    expect(total).toBe(1);
    expect(items[0].full_name).toBe('acme/beta');
  });

  it('projects compact agent payload', () => {
    const p = projectRepoForAgent(sample[0], { summaryMaxChars: 10 });
    expect(String(p.ai_summary).length).toBeLessThanOrEqual(11);
  });

  it('matches the approved vector filters with the same semantics as keyword search', () => {
    const candidate = repo({
      id: 3,
      name: 'gamma',
      full_name: 'acme/gamma',
      language: 'TypeScript',
      topics: ['retrieval'],
      ai_tags: ['commerce'],
      ai_platforms: ['linux'],
      license: 'MIT',
      custom_category: 'infrastructure',
      stargazers_count: 120,
      analyzed_at: '2026-09-01T00:00:00.000Z',
      analysis_failed: false,
      subscribed_to_releases: true,
    });

    expect(
      matchesRepoFilters(candidate, {
        languages: ['TypeScript'],
        tags: ['retrieval'],
        platforms: ['linux'],
        licenses: ['MIT'],
        category: 'infrastructure',
        minStars: 100,
        maxStars: 200,
        isAnalyzed: true,
        isSubscribed: true,
      })
    ).toBe(true);
    expect(matchesRepoFilters(candidate, { isAnalyzed: false })).toBe(false);
    expect(matchesRepoFilters(candidate, { isSubscribed: false })).toBe(false);
    expect(matchesRepoFilters(candidate, { maxStars: 119 })).toBe(false);
    expect(
      matchesRepoFilters(
        { ...candidate, analyzed_at: '2026-09-01T00:00:00.000Z', analysis_failed: true },
        { isAnalyzed: false }
      )
    ).toBe(false);
  });
});
