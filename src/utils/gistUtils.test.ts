import { describe, expect, it } from 'vitest';
import type { Gist, GistSearchFilters } from '../types';
import { filterAndSortGists, inferGistCodeLanguage } from './gistUtils';

describe('inferGistCodeLanguage', () => {
  it('uses plaintext for files without an extension', () => {
    expect(inferGistCodeLanguage('mnist1')).toBe('plaintext');
  });

  it('keeps known extensionless filenames', () => {
    expect(inferGistCodeLanguage('Dockerfile')).toBe('dockerfile');
  });

  it('normalizes GitHub Text language to highlight.js plaintext', () => {
    expect(inferGistCodeLanguage('notes', 'Text')).toBe('plaintext');
  });
});

describe('filterAndSortGists analysis filter', () => {
  it('includes failed analyses in the not-analyzed complement', () => {
    const gists = [
      { id: 'pending', analyzed_at: null, analysis_failed: false },
      { id: 'failed', analyzed_at: '2026-10-28T00:00:00.000Z', analysis_failed: true },
      { id: 'analyzed', analyzed_at: '2026-10-28T00:00:00.000Z', analysis_failed: false },
    ] as Gist[];
    const filters = {
      query: '',
      sortBy: 'updated',
      sortOrder: 'desc',
      isAnalyzed: false,
    } satisfies GistSearchFilters;

    expect(filterAndSortGists(gists, filters).map((gist) => gist.id)).toEqual(['pending', 'failed']);
  });
});
