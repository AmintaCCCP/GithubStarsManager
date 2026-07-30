import { describe, expect, it } from 'vitest';
import { buildEmbeddingText } from '../services/vectorSearchService';
import { NO_LICENSE_SENTINEL, normalizeLicense } from './licenseFilter';
import type { Repository } from '../types';

const baseRepo = (overrides: Partial<Repository> = {}): Repository => ({
  id: 1,
  name: 'repo-1',
  full_name: 'owner/repo-1',
  description: 'A test repo',
  html_url: 'https://github.com/owner/repo-1',
  stargazers_count: 10,
  forks_count: 1,
  forks: 1,
  language: 'TypeScript',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
  pushed_at: '2026-01-03T00:00:00.000Z',
  owner: { login: 'owner', avatar_url: 'https://github.com/a.png' },
  topics: ['test'],
  ...overrides,
});

describe('normalizeLicense', () => {
  it('passes through SPDX ids unchanged', () => {
    expect(normalizeLicense('MIT')).toBe('MIT');
    expect(normalizeLicense('Apache-2.0')).toBe('Apache-2.0');
    expect(normalizeLicense('GPL-3.0')).toBe('GPL-3.0');
  });

  it('collapses null/undefined/empty to the no-license sentinel', () => {
    expect(normalizeLicense(null)).toBe(NO_LICENSE_SENTINEL);
    expect(normalizeLicense(undefined)).toBe(NO_LICENSE_SENTINEL);
    expect(normalizeLicense('')).toBe(NO_LICENSE_SENTINEL);
  });

  it('collapses GitHub "no assertion" forms to the sentinel', () => {
    expect(normalizeLicense('NOASSERTION')).toBe(NO_LICENSE_SENTINEL);
    expect(normalizeLicense('Other')).toBe(NO_LICENSE_SENTINEL);
    expect(normalizeLicense('NONE')).toBe(NO_LICENSE_SENTINEL);
    expect(normalizeLicense('no-license')).toBe(NO_LICENSE_SENTINEL);
  });

  it('collapses lowercase variants (legacy backup / third-party sources)', () => {
    expect(normalizeLicense('noassertion')).toBe(NO_LICENSE_SENTINEL);
    expect(normalizeLicense('other')).toBe(NO_LICENSE_SENTINEL);
    expect(normalizeLicense('none')).toBe(NO_LICENSE_SENTINEL);
  });

  it('trims scalar strings before sentinel matching and SPDX pass-through', () => {
    // 直接字符串路径此前未 trim，" Other " 会成为独立 facet，拆分过滤/统计。
    expect(normalizeLicense(' Other ')).toBe(NO_LICENSE_SENTINEL);
    expect(normalizeLicense('  NOASSERTION  ')).toBe(NO_LICENSE_SENTINEL);
    expect(normalizeLicense(' none ')).toBe(NO_LICENSE_SENTINEL);
    expect(normalizeLicense('   ')).toBe(NO_LICENSE_SENTINEL);
    expect(normalizeLicense('  MIT  ')).toBe('MIT');
  });

  it('never throws on a non-string license (GitHub object / number / legacy data)', () => {
    // Regression: performBasicTextSearch / performEnhancedBasicSearch / RepositoryCard call
    // normalizeLicense(repo.license) during render. A repo that never passed through
    // toLicenseSpdxId (legacy persisted store, third-party import, or a return path not
    // yet normalized) can carry a raw GitHub license object { key, spdx_id, ... } or a
    // number. normalizeLicense must reduce these without calling .toLowerCase() on a
    // non-string and crashing the client render ("e.toLowerCase is not a function").
    // GitHub object → resolve SPDX id (spdx_id preferred over key):
    expect(normalizeLicense({ spdx_id: 'MIT', key: 'MIT', name: 'MIT License', url: 'u' } as unknown))
      .toBe('MIT');
    // GitHub "Other" object (no SPDX): key 'Other' → sentinel.
    expect(normalizeLicense({ key: 'Other', spdx_id: 'NOASSERTION', name: 'Other' } as unknown))
      .toBe(NO_LICENSE_SENTINEL);
    // Object missing both string fields → sentinel.
    expect(normalizeLicense({ name: 'Custom' } as unknown)).toBe(NO_LICENSE_SENTINEL);
    // Non-string truthy values (number/boolean) → sentinel, no crash.
    expect(normalizeLicense(123 as unknown)).toBe(NO_LICENSE_SENTINEL);
    expect(normalizeLicense(true as unknown)).toBe(NO_LICENSE_SENTINEL);
    // String already carrying the sentinel stays.
    expect(normalizeLicense(NO_LICENSE_SENTINEL)).toBe(NO_LICENSE_SENTINEL);
  });

  it('falls back from blank/whitespace spdx_id to a valid key', () => {
    // Regression: `spdx_id ?? key` retained an empty-string spdx_id and wrongly returned
    // the no-license sentinel, discarding a valid key. Trim-first + `||` must select the
    // first non-empty field (spdx_id preferred, else key).
    expect(normalizeLicense({ spdx_id: '', key: 'MIT' } as unknown)).toBe('MIT');
    expect(normalizeLicense({ spdx_id: '   ', key: 'apache-2.0', name: 'Apache' } as unknown))
      .toBe('apache-2.0');
    // Both blank → sentinel.
    expect(normalizeLicense({ spdx_id: '', key: '  ' } as unknown)).toBe(NO_LICENSE_SENTINEL);
    // key 'Other' still collapses to sentinel once spdx_id is absent/blank.
    expect(normalizeLicense({ spdx_id: '', key: 'Other' } as unknown)).toBe(NO_LICENSE_SENTINEL);
  });
});

describe('buildEmbeddingText license', () => {
  it('includes a License: line when license is set', () => {
    const text = buildEmbeddingText(baseRepo({ license: 'MIT' }));
    expect(text).toContain('License: MIT');
  });

  it('omits the License line when license is null/missing', () => {
    const textNull = buildEmbeddingText(baseRepo({ license: null }));
    const textMissing = buildEmbeddingText(baseRepo());
    expect(textNull).not.toContain('License:');
    expect(textMissing).not.toContain('License:');
  });
});
