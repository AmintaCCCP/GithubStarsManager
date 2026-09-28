import { describe, expect, it } from 'vitest';
import { normalizeBatchStarHistory } from './batchStarHistoryStorage';

describe('batch Star history normalization', () => {
  it('drops timestamps that cannot be rendered as dates', () => {
    const valid = { text: 'valid', generatedAt: 1_700_000_000_000 };
    expect(normalizeBatchStarHistory([
      valid,
      { text: 'too large', generatedAt: 8.64e15 + 1 },
      { text: 'not finite', generatedAt: Number.POSITIVE_INFINITY },
      { text: 'not a number', generatedAt: 'yesterday' },
    ])).toEqual([valid]);
  });
});
