import { describe, expect, it } from 'vitest';
import type { Repository } from '../types';
import {
  MAX_RECENTLY_VIEWED,
  RECENTLY_VIEWED_MAX_AGE_DAYS,
  pruneRecentlyViewed,
  normalizeRecentlyViewed,
  recentlyViewedIds,
  recordRecentlyViewed,
} from './recentlyViewed';

const repository = (id: number): Repository => ({
  id,
  name: `repo-${id}`,
  full_name: `owner/repo-${id}`,
  description: null,
  html_url: `https://github.com/owner/repo-${id}`,
  stargazers_count: 0,
  forks_count: 0,
  forks: 0,
  language: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  pushed_at: '2026-01-01T00:00:00.000Z',
  owner: { login: 'owner', avatar_url: 'https://example.com/avatar.png' },
  topics: [],
});

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-09-21T04:00:00.000Z');

describe('recordRecentlyViewed', () => {
  it('puts the newest view first', () => {
    const first = recordRecentlyViewed([], repository(1), NOW - DAY);
    const second = recordRecentlyViewed(first, repository(2), NOW);

    expect(second.map((entry) => entry.repository.id)).toEqual([2, 1]);
    expect(second[0]?.viewedAt).toBe(new Date(NOW).toISOString());
  });

  it('keeps one entry per repository so re-viewing only refreshes the timestamp', () => {
    const once = recordRecentlyViewed(recordRecentlyViewed([], repository(1), NOW - 5 * DAY), repository(2), NOW - DAY);
    const again = recordRecentlyViewed(once, repository(1), NOW);

    expect(again).toHaveLength(2);
    expect(again.map((entry) => entry.repository.id)).toEqual([1, 2]);
    expect(again[0]?.viewedAt).toBe(new Date(NOW).toISOString());
  });

  it('caps the list length', () => {
    let entries = recordRecentlyViewed([], repository(0), NOW);
    for (let id = 1; id <= MAX_RECENTLY_VIEWED + 5; id += 1) {
      entries = recordRecentlyViewed(entries, repository(id), NOW);
    }

    expect(entries).toHaveLength(MAX_RECENTLY_VIEWED);
    expect(entries[0]?.repository.id).toBe(MAX_RECENTLY_VIEWED + 5);
    expect(entries.some((entry) => entry.repository.id === 0)).toBe(false);
  });

  it('drops entries older than the age limit while writing', () => {
    const stale = Math.floor(RECENTLY_VIEWED_MAX_AGE_DAYS + 1) * DAY;
    const entries = recordRecentlyViewed(
      [{ repository: repository(1), viewedAt: new Date(NOW - stale).toISOString() }],
      repository(2),
      NOW,
    );

    expect(entries.map((entry) => entry.repository.id)).toEqual([2]);
  });
});

describe('pruneRecentlyViewed', () => {
  it('keeps fresh entries and drops unparsable timestamps', () => {
    const entries = [
      { repository: repository(1), viewedAt: new Date(NOW - DAY).toISOString() },
      { repository: repository(2), viewedAt: 'not a date' },
    ];

    expect(pruneRecentlyViewed(entries, NOW).map((entry) => entry.repository.id)).toEqual([1]);
  });
});

describe('recentlyViewedIds', () => {
  it('exposes the seen repository ids for the Discovery filter', () => {
    const entries = [
      { repository: repository(7), viewedAt: new Date(NOW).toISOString() },
      { repository: repository(9), viewedAt: new Date(NOW).toISOString() },
    ];

    expect(recentlyViewedIds(entries)).toEqual(new Set([7, 9]));
  });
});

describe('normalizeRecentlyViewed', () => {
  it('drops malformed persisted entries and duplicate repository ids', () => {
    const valid = { repository: repository(7), viewedAt: new Date(NOW).toISOString() };
    const normalized = normalizeRecentlyViewed([
      null,
      { viewedAt: valid.viewedAt },
      { repository: { id: 8 }, viewedAt: valid.viewedAt },
      { repository: repository(9), viewedAt: 'invalid' },
      valid,
      { ...valid, viewedAt: new Date(NOW - DAY).toISOString() },
    ], NOW);

    expect(normalized).toEqual([valid]);
  });

  it('prunes stale and future entries before sorting and deduplicating', () => {
    const newerDuplicate = { repository: repository(7), viewedAt: new Date(NOW - DAY).toISOString() };
    const normalized = normalizeRecentlyViewed([
      { repository: repository(7), viewedAt: new Date(NOW - 5 * DAY).toISOString() },
      { repository: repository(8), viewedAt: new Date(NOW - 2 * DAY).toISOString() },
      { repository: repository(9), viewedAt: new Date(NOW - (RECENTLY_VIEWED_MAX_AGE_DAYS + 1) * DAY).toISOString() },
      { repository: repository(10), viewedAt: new Date(NOW + DAY).toISOString() },
      newerDuplicate,
    ], NOW);

    expect(normalized).toEqual([
      newerDuplicate,
      { repository: repository(8), viewedAt: new Date(NOW - 2 * DAY).toISOString() },
    ]);
  });
});
