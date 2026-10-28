import { describe, expect, it } from 'vitest';
import type { Gist, GistSearchFilters } from '../types';
import { filterAndSortGists, inferGistCodeLanguage, resolveGistAiSearchResults } from './gistUtils';

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

describe('resolveGistAiSearchResults', () => {
  it('keeps AI ranking and candidate membership while the analysis filter changes', () => {
    const aiResults = [
      { id: 'b', description: 'semantic result b' },
      { id: 'a', description: 'semantic result a' },
    ] as Gist[];
    const currentItems = [
      { id: 'a', analyzed_at: null, analysis_failed: false, description: 'semantic result a' },
      { id: 'b', analyzed_at: '2026-10-28T00:00:00.000Z', analysis_failed: false, description: 'semantic result b' },
    ] as Gist[];
    const baseFilters = {
      query: 'semantic query',
      sortBy: 'updated',
      sortOrder: 'desc',
    } satisfies Omit<GistSearchFilters, 'isAnalyzed'>;

    expect(resolveGistAiSearchResults(
      aiResults,
      currentItems,
      { ...baseFilters, isAnalyzed: undefined },
      true,
    ).map((gist) => gist.id)).toEqual(['b', 'a']);
    expect(resolveGistAiSearchResults(
      aiResults,
      currentItems,
      { ...baseFilters, isAnalyzed: true },
      true,
    ).map((gist) => gist.id)).toEqual(['b']);
    expect(resolveGistAiSearchResults(
      aiResults,
      currentItems,
      { ...baseFilters, isAnalyzed: false },
      true,
    ).map((gist) => gist.id)).toEqual(['a']);
  });
});
