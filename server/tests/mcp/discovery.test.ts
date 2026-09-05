import { describe, expect, it } from 'vitest';
import {
  buildBatchLookupResult,
  buildRepositoryEmbeddingText,
  filterVectorCandidates,
  hasActiveVectorFilters,
} from '../../src/mcp/discovery.js';
import { buildRepoEvidence } from '../../src/mcp/evidence.js';
import type { McpRepository } from '../../src/mcp/repoSearch.js';

function repo(partial: Partial<McpRepository> & Pick<McpRepository, 'id' | 'name' | 'full_name'>): McpRepository {
  return {
    description: 'A repository description',
    html_url: `https://github.com/${partial.full_name}`,
    stargazers_count: 10,
    language: 'TypeScript',
    topics: [],
    ...partial,
  };
}

describe('MCP discovery pure contracts', () => {
  it('preserves input order and duplicate occurrences in bounded batch results', () => {
    const alpha = repo({ id: 1, name: 'alpha', full_name: 'acme/alpha' });
    const result = buildBatchLookupResult(
      ['acme/alpha', 'missing/repo', 'acme/alpha'],
      (input) => (input === 'acme/alpha' ? alpha : null)
    );

    expect(result).toEqual({
      requested: 3,
      foundCount: 2,
      notFoundCount: 1,
      notFound: ['missing/repo'],
      items: [
        { input: 'acme/alpha', status: 'found', repository: expect.any(Object) },
        { input: 'missing/repo', status: 'not_found', repository: null },
        { input: 'acme/alpha', status: 'found', repository: expect.any(Object) },
      ],
    });
    expect(result.items[0]).toEqual(result.items[2]);
  });

  it('builds the same structured metadata query deterministically', () => {
    const value = repo({
      id: 2,
      name: 'beta',
      full_name: 'acme/beta',
      description: 'A description',
      ai_summary: 'A summary',
      custom_description: 'An internal note',
      topics: ['one'],
      ai_tags: ['two'],
      custom_tags: ['three'],
      language: 'Rust',
      license: 'MIT',
    });

    expect(buildRepositoryEmbeddingText(value)).toBe(
      'Repository: acme/beta\n' +
        'Description: A description\n' +
        'About: An internal note\n' +
        'Summary: A summary\n' +
        'Topics: one, two, three\n' +
        'Language: Rust\n' +
        'License: MIT'
    );
  });

  it('filters only the retrieved candidate set and truncates after local filtering', () => {
    const first = repo({ id: 1, name: 'first', full_name: 'acme/first', language: 'Rust' });
    const second = repo({ id: 2, name: 'second', full_name: 'acme/second', language: 'Python' });
    const third = repo({ id: 3, name: 'third', full_name: 'acme/third', language: 'Rust' });
    const result = filterVectorCandidates(
      [
        { id: '1', score: 0.95, repository: first },
        { id: '2', score: 0.9, repository: second },
        { id: '3', score: 0.8, repository: third },
      ],
      { languages: ['Rust'] },
      1
    );

    expect(result.matches.map((match) => match.repository.full_name)).toEqual(['acme/first']);
    expect(result.candidateCount).toBe(3);
    expect(result.filteredCount).toBe(2);
    expect(hasActiveVectorFilters({ languages: [] })).toBe(false);
    expect(hasActiveVectorFilters({ isSubscribed: false })).toBe(true);
  });

  it('returns deterministic local evidence and nulls for unavailable fields', () => {
    const value = repo({
      id: 4,
      name: 'evidence',
      full_name: 'acme/evidence',
      created_at: '2025-01-01T00:00:00.000Z',
      updated_at: '2026-02-01T00:00:00.000Z',
      pushed_at: '2026-02-02T00:00:00.000Z',
      starred_at: '2026-02-03T00:00:00.000Z',
      analyzed_at: '2026-02-04T00:00:00.000Z',
      analysis_failed: false,
      subscribed_to_releases: true,
      license: 'Apache-2.0',
    });
    const release = {
      id: 99,
      tag_name: 'v2.0.0',
      name: 'Second release',
      html_url: 'https://github.com/acme/evidence/releases/tag/v2.0.0',
      published_at: '2026-03-01T00:00:00.000Z',
      prerelease: false,
      draft: false,
    };

    const result = buildRepoEvidence(value, release);
    expect(result.evidence.repository).toMatchObject({
      full_name: 'acme/evidence',
      license: 'Apache-2.0',
      archived: null,
      analysis_status: 'analyzed',
      subscribed_to_releases: true,
    });
    expect(result.evidence.latest_release).toEqual(release);
    expect(result.evidence.sources).toEqual({ repository: 'repositories', latest_release: 'releases_cache' });
    expect(result.evidence.limitations).toContain('archived is not stored locally');
    expect(JSON.stringify(result)).not.toMatch(/ADOPT|ADAPT|REFERENCE|REJECT/);
  });
});
