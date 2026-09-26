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

  it('preserves preset metadata and coerces non-string elements out of string arrays', () => {
    expect(normalizeAssetFilters([
      {
        id: 'preset-windows',
        name: 'Windows',
        keywords: ['exe', 42, null],
        excludeKeywords: ['setup'],
        includeRepos: ['owner/beta', 7],
        isPreset: true,
        icon: 'Monitor',
      },
    ])).toEqual([
      {
        id: 'preset-windows',
        name: 'Windows',
        keywords: ['exe'],
        excludeKeywords: ['setup'],
        includeRepos: ['owner/beta'],
        isPreset: true,
        icon: 'Monitor',
      },
    ]);
  });

  it('drops filters missing required fields so keyword matching cannot throw', () => {
    expect(normalizeAssetFilters([
      { id: 'f1' },                              // 缺 name / keywords
      { id: '', name: 'X', keywords: ['k'] },    // 空 id
      { id: 'f2', keywords: ['k'] },             // 缺 name
      { id: 'f3', name: 'X' },                   // 缺 keywords
      { id: 'f4', name: 'X', keywords: 'oops' }, // keywords 不是数组
      { id: 'ok', name: 'OK', keywords: ['k'] }, // 合法条目保留
    ])).toEqual([{ id: 'ok', name: 'OK', keywords: ['k'] }]);
  });

  it('drops non-object entries and returns empty for non-arrays', () => {
    expect(normalizeAssetFilters([null, 'oops', { id: 'f1' }])).toEqual([]);
    expect(normalizeAssetFilters(undefined)).toEqual([]);
    expect(normalizeAssetFilters('nope')).toEqual([]);
  });
});
