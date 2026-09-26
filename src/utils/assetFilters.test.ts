import { describe, expect, it } from 'vitest';
import { normalizeAssetFilters } from './assetFilters';

describe('normalizeAssetFilters', () => {
  it('strips the obsolete excludeRepos field from persisted filters', () => {
    // #405 曾短暂实现反向语义的 excludeRepos，hydration 时必须剥掉旧键
    const filters = [
      {
        id: 'f1',
        name: 'Portable',
        keywords: ['portable'],
        excludeRepos: ['owner/legacy'],
        includeRepos: ['owner/beta'],
      },
      { id: 'f2', name: 'Windows', keywords: ['exe'] },
    ];

    expect(normalizeAssetFilters(filters)).toEqual([
      { id: 'f1', name: 'Portable', keywords: ['portable'], includeRepos: ['owner/beta'] },
      { id: 'f2', name: 'Windows', keywords: ['exe'] },
    ]);
  });

  it('keeps filters untouched when no legacy field is present', () => {
    const filters = [{ id: 'f1', name: 'Portable', keywords: ['portable'] }];
    expect(normalizeAssetFilters(filters)).toEqual(filters);
  });

  it('drops non-object entries and returns empty for non-arrays', () => {
    expect(normalizeAssetFilters([null, 'oops', { id: 'f1' }])).toEqual([{ id: 'f1' }]);
    expect(normalizeAssetFilters(undefined)).toEqual([]);
    expect(normalizeAssetFilters('nope')).toEqual([]);
  });
});
