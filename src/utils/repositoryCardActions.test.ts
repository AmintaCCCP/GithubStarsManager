import { describe, expect, it } from 'vitest';
import { normalizeRepositoryCardActions } from './repositoryCardActions';
import { REPOSITORY_CARD_ACTION_IDS } from '../types/repositoryCardActions';

describe('normalizeRepositoryCardActions', () => {
  it('keeps a valid custom order and visibility while restoring missing actions', () => {
    const result = normalizeRepositoryCardActions([
      { id: 'github', visible: false },
      { id: 'edit', visible: true },
      { id: 'github', visible: true },
      { id: 'unknown', visible: true },
    ]);

    expect(result.slice(0, 2)).toEqual([
      { id: 'github', visible: false },
      { id: 'edit', visible: true },
    ]);
    expect(result.map((item) => item.id)).toHaveLength(REPOSITORY_CARD_ACTION_IDS.length);
    expect(new Set(result.map((item) => item.id)).size).toBe(REPOSITORY_CARD_ACTION_IDS.length);
  });

  it('falls back to the existing visible order when no preference exists', () => {
    expect(normalizeRepositoryCardActions(undefined).map((item) => item.id)).toEqual(REPOSITORY_CARD_ACTION_IDS);
    expect(normalizeRepositoryCardActions(undefined).every((item) => item.visible)).toBe(true);
  });
});
