import { describe, expect, it } from 'vitest';
import { isRepositoryCardFieldVisible, normalizeRepositoryCardFields } from './repositoryCardFields';
import { DEFAULT_REPOSITORY_CARD_FIELDS, REPOSITORY_CARD_FIELD_IDS } from '../types/repositoryCardFields';

describe('normalizeRepositoryCardFields', () => {
  it('falls back to showing everything for junk input', () => {
    expect(normalizeRepositoryCardFields(undefined)).toEqual(DEFAULT_REPOSITORY_CARD_FIELDS);
    expect(normalizeRepositoryCardFields(null)).toEqual(DEFAULT_REPOSITORY_CARD_FIELDS);
    expect(normalizeRepositoryCardFields('nope')).toEqual(DEFAULT_REPOSITORY_CARD_FIELDS);
    expect(normalizeRepositoryCardFields([1, 2])).toEqual(DEFAULT_REPOSITORY_CARD_FIELDS);
  });

  it('keeps booleans and ignores non-boolean values per field', () => {
    const normalized = normalizeRepositoryCardFields({
      description: false,
      stars: 'yes',
      unknownField: false,
    });

    expect(normalized.description).toBe(false);
    expect(normalized.stars).toBe(true);
    expect(Object.keys(normalized).sort()).toEqual([...REPOSITORY_CARD_FIELD_IDS].sort());
    expect('unknownField' in normalized).toBe(false);
  });

  it('is idempotent', () => {
    const once = normalizeRepositoryCardFields({ tags: false, license: false });
    expect(normalizeRepositoryCardFields(once)).toEqual(once);
  });
});

describe('isRepositoryCardFieldVisible', () => {
  it('treats a missing table as the default (visible)', () => {
    expect(isRepositoryCardFieldVisible(undefined, 'stars')).toBe(true);
  });

  it('only hides a field that is explicitly false', () => {
    expect(isRepositoryCardFieldVisible({ ...DEFAULT_REPOSITORY_CARD_FIELDS, stars: false }, 'stars')).toBe(false);
    expect(isRepositoryCardFieldVisible({ ...DEFAULT_REPOSITORY_CARD_FIELDS }, 'stars')).toBe(true);
  });
});
