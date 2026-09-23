import { describe, expect, it } from 'vitest';
import {
  buildTrendingHistory,
  normalizeTrendingSnapshot,
  normalizeTrendingSnapshots,
  pickTrendingHighlights,
  pruneTrendingSnapshots,
  recordTrendingSnapshot,
} from './trendingSnapshots';
import {
  MAX_TRENDING_SNAPSHOTS_PER_BUCKET,
  TRENDING_SNAPSHOT_MAX_AGE_DAYS,
} from '../types/trendingSnapshot';
import type { TrendingSnapshot } from '../types/trendingSnapshot';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 8, 21, 12, 0, 0).getTime();
const at = (dayOffset: number) => new Date(NOW + dayOffset * DAY).toISOString();

const snapshot = (
  overrides: Partial<TrendingSnapshot> = {},
): TrendingSnapshot => ({
  period: 'daily',
  platform: 'All',
  capturedAt: at(0),
  entries: [{ repositoryFullName: 'owner/repo', rank: 1, stars: 100 }],
  ...overrides,
});

describe('normalizeTrendingSnapshot', () => {
  it('rejects junk instead of throwing', () => {
    expect(normalizeTrendingSnapshot(null)).toBeNull();
    expect(normalizeTrendingSnapshot('nope')).toBeNull();
    expect(normalizeTrendingSnapshot({ period: 'hourly', capturedAt: at(0), entries: [] })).toBeNull();
    expect(normalizeTrendingSnapshot({ period: 'daily', capturedAt: 'nope', entries: [] })).toBeNull();
    expect(normalizeTrendingSnapshot({
      period: 'daily',
      capturedAt: '2025-02-30T12:00:00.000Z',
      entries: [{ repositoryFullName: 'owner/repo', rank: 1, stars: 1 }],
    })).toBeNull();
    expect(normalizeTrendingSnapshot({ period: 'daily', capturedAt: at(0), entries: [] })).toBeNull();
  });

  it('defaults the platform, drops broken entries and keeps the valid ones', () => {
    const normalized = normalizeTrendingSnapshot({
      period: 'weekly',
      capturedAt: at(0),
      entries: [
        { repositoryFullName: 'owner/ok', rank: 2, stars: 10 },
        { repositoryFullName: '  ', rank: 1, stars: 1 },
        { repositoryFullName: 'owner/bad-rank', rank: 0, stars: 1 },
        { repositoryFullName: 'owner/no-stars', rank: 3 },
      ],
    });

    expect(normalized?.platform).toBe('All');
    expect(normalized?.entries).toEqual([
      { repositoryFullName: 'owner/ok', rank: 2, stars: 10 },
      { repositoryFullName: 'owner/no-stars', rank: 3, stars: 0 },
    ]);
  });

  it('canonicalizes timestamps and keeps only the best rank for duplicate repositories', () => {
    const normalized = normalizeTrendingSnapshot({
      period: 'daily',
      capturedAt: '2026-09-21T12:00:00+08:00',
      entries: [
        { repositoryFullName: 'owner/repo', rank: 8, stars: 90 },
        { repositoryFullName: 'owner/repo', rank: 2, stars: 100 },
      ],
    });

    expect(normalized?.capturedAt).toBe('2026-09-21T04:00:00.000Z');
    expect(normalized?.entries).toEqual([{ repositoryFullName: 'owner/repo', rank: 2, stars: 100 }]);
  });
});

describe('recordTrendingSnapshot', () => {
  it('keeps one snapshot per period, platform and day', () => {
    const first = recordTrendingSnapshot([], snapshot({ capturedAt: at(0) }), NOW);
    const sameDay = recordTrendingSnapshot(first, snapshot({
      capturedAt: new Date(NOW + 60 * 60 * 1000).toISOString(),
      entries: [{ repositoryFullName: 'owner/repo', rank: 5, stars: 120 }],
    }), NOW + 60 * 60 * 1000);

    expect(sameDay).toHaveLength(1);
    expect(sameDay[0]?.entries[0]?.rank).toBe(5);
  });

  it('uses the local calendar day for deduplication', () => {
    const localMorning = new Date(2026, 8, 21, 0, 30).toISOString();
    const localEvening = new Date(2026, 8, 21, 23, 30).toISOString();
    const result = pruneTrendingSnapshots([
      snapshot({ capturedAt: localMorning }),
      snapshot({ capturedAt: localEvening }),
    ], new Date(2026, 8, 22).getTime());

    expect(result).toHaveLength(1);
    expect(result[0].capturedAt).toBe(localEvening);
  });

  it('keeps separate buckets for different periods and platforms', () => {
    let snapshots: TrendingSnapshot[] = [];
    snapshots = recordTrendingSnapshot(snapshots, snapshot({ period: 'daily', platform: 'All' }), NOW);
    snapshots = recordTrendingSnapshot(snapshots, snapshot({ period: 'weekly', platform: 'All' }), NOW);
    snapshots = recordTrendingSnapshot(snapshots, snapshot({ period: 'daily', platform: 'Windows' }), NOW);

    expect(snapshots).toHaveLength(3);
  });

  it('appends the next day and keeps snapshots ordered', () => {
    let snapshots: TrendingSnapshot[] = [];
    snapshots = recordTrendingSnapshot(snapshots, snapshot({ capturedAt: at(-1) }), NOW);
    snapshots = recordTrendingSnapshot(snapshots, snapshot({ capturedAt: at(0) }), NOW);

    expect(snapshots.map((item) => item.capturedAt)).toEqual([at(-1), at(0)]);
  });

  it('caps each bucket and drops stale snapshots', () => {
    let snapshots: TrendingSnapshot[] = [];
    for (let day = 0; day < MAX_TRENDING_SNAPSHOTS_PER_BUCKET + 5; day += 1) {
      snapshots = recordTrendingSnapshot(snapshots, snapshot({ capturedAt: at(-day) }), NOW);
    }
    expect(snapshots.length).toBeLessThanOrEqual(MAX_TRENDING_SNAPSHOTS_PER_BUCKET);

    const stale = recordTrendingSnapshot([], snapshot({
      capturedAt: at(-(TRENDING_SNAPSHOT_MAX_AGE_DAYS + 1)),
    }), NOW);
    expect(stale).toHaveLength(0);

    const future = recordTrendingSnapshot([], snapshot({ capturedAt: at(1) }), NOW);
    expect(future).toHaveLength(0);
  });
});

describe('pruneTrendingSnapshots', () => {
  it('treats unusable input as empty instead of throwing', () => {
    expect(normalizeTrendingSnapshots(undefined)).toEqual([]);
    expect(normalizeTrendingSnapshots([null, 5, {}])).toEqual([]);
    expect(pruneTrendingSnapshots([], NOW)).toEqual([]);
  });

  it('keeps only the latest snapshot for each bucket and day', () => {
    const result = pruneTrendingSnapshots([
      snapshot({ capturedAt: at(0), entries: [{ repositoryFullName: 'owner/old', rank: 1, stars: 1 }] }),
      snapshot({
        capturedAt: new Date(NOW + 60 * 60 * 1000).toISOString(),
        entries: [{ repositoryFullName: 'owner/new', rank: 1, stars: 2 }],
      }),
    ], NOW + 2 * 60 * 60 * 1000);

    expect(result).toHaveLength(1);
    expect(result[0]?.entries[0]?.repositoryFullName).toBe('owner/new');
  });
});

describe('buildTrendingHistory', () => {
  const threeDays = (): TrendingSnapshot[] => [
    snapshot({
      capturedAt: at(-2),
      entries: [
        { repositoryFullName: 'owner/rising', rank: 8, stars: 1000 },
        { repositoryFullName: 'owner/steady', rank: 2, stars: 5000 },
      ],
    }),
    snapshot({
      capturedAt: at(-1),
      entries: [
        { repositoryFullName: 'owner/rising', rank: 6, stars: 1100 },
        { repositoryFullName: 'owner/steady', rank: 2, stars: 5100 },
      ],
    }),
    snapshot({
      capturedAt: at(0),
      entries: [
        { repositoryFullName: 'owner/rising', rank: 3, stars: 1300 },
        { repositoryFullName: 'owner/steady', rank: 2, stars: 5200 },
        { repositoryFullName: 'owner/fresh', rank: 9, stars: 300 },
      ],
    }),
  ];

  it('compares against the previous day and marks brand new entries', () => {
    const rows = buildTrendingHistory(threeDays(), 'daily', 'All');
    const rising = rows.find((row) => row.repositoryFullName === 'owner/rising');
    const steady = rows.find((row) => row.repositoryFullName === 'owner/steady');
    const fresh = rows.find((row) => row.repositoryFullName === 'owner/fresh');

    expect(rising).toMatchObject({ rank: 3, previousRank: 6, rankChange: 3, firstSeenAt: at(-2), streakDays: 3, starsGained: 300 });
    expect(steady).toMatchObject({ rank: 2, previousRank: 2, rankChange: 0 });
    expect(fresh).toMatchObject({ rank: 9, previousRank: null, rankChange: null, streakDays: 1, starsGained: 0 });
  });

  it('returns rows sorted by rank and ignores repositories that left the list', () => {
    const snapshots = [
      ...threeDays().slice(0, 2),
      snapshot({
        capturedAt: at(0),
        entries: [
          { repositoryFullName: 'owner/steady', rank: 1, stars: 5200 },
          { repositoryFullName: 'owner/rising', rank: 4, stars: 1300 },
        ],
      }),
    ];

    const rows = buildTrendingHistory(snapshots, 'daily', 'All');
    expect(rows.map((row) => row.repositoryFullName)).toEqual(['owner/steady', 'owner/rising']);
  });

  it('does not report a rank change when only same-day refreshes differ', () => {
    const snapshots = [
      snapshot({ capturedAt: at(0), entries: [{ repositoryFullName: 'owner/repo', rank: 5, stars: 100 }] }),
      snapshot({
        capturedAt: new Date(NOW + 30 * 60 * 1000).toISOString(),
        entries: [{ repositoryFullName: 'owner/repo', rank: 2, stars: 100 }],
      }),
    ];

    const rows = buildTrendingHistory(snapshots, 'daily', 'All');
    expect(rows[0]).toMatchObject({ rank: 2, previousRank: null, rankChange: null });
  });

  it('counts only consecutive recorded days in the streak', () => {
    const rows = buildTrendingHistory([
      snapshot({ capturedAt: at(-3) }),
      snapshot({ capturedAt: at(-1) }),
      snapshot({ capturedAt: at(0) }),
    ], 'daily', 'All');

    expect(rows[0]?.streakDays).toBe(2);
  });

  it('is empty when the bucket has no snapshots', () => {
    expect(buildTrendingHistory(threeDays(), 'monthly', 'All')).toEqual([]);
    expect(buildTrendingHistory(threeDays(), 'daily', 'Rust')).toEqual([]);
  });
});

describe('pickTrendingHighlights', () => {
  it('surfaces risers, new entries and fallers', () => {
    const rows = buildTrendingHistory([
      snapshot({
        capturedAt: at(-1),
        entries: [
          { repositoryFullName: 'owner/up', rank: 10, stars: 1 },
          { repositoryFullName: 'owner/down', rank: 2, stars: 1 },
        ],
      }),
      snapshot({
        capturedAt: at(0),
        entries: [
          { repositoryFullName: 'owner/up', rank: 4, stars: 1 },
          { repositoryFullName: 'owner/down', rank: 9, stars: 1 },
          { repositoryFullName: 'owner/new', rank: 1, stars: 1 },
        ],
      }),
    ], 'daily', 'All');

    const highlights = pickTrendingHighlights(rows);
    expect(highlights).toContainEqual({ kind: 'rising', repositoryFullName: 'owner/up', rankChange: 6, rank: 4 });
    expect(highlights).toContainEqual({ kind: 'falling', repositoryFullName: 'owner/down', rankChange: -7, rank: 9 });
    expect(highlights).toContainEqual({ kind: 'new-entry', repositoryFullName: 'owner/new', rankChange: null, rank: 1 });
  });
});
