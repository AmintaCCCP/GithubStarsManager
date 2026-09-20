import type { TrendingTimeRange } from '../types';
import type { TrendingSnapshot, TrendingSnapshotEntry } from '../types/trendingSnapshot';
import {
  MAX_TRENDING_SNAPSHOTS_PER_BUCKET,
  MAX_TRENDING_ENTRIES_PER_SNAPSHOT,
  TRENDING_SNAPSHOT_MAX_AGE_DAYS,
  TRENDING_STREAK_WINDOW_DAYS,
} from '../types/trendingSnapshot';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_AGE_MS = TRENDING_SNAPSHOT_MAX_AGE_DAYS * DAY_MS;
const PERIODS: TrendingTimeRange[] = ['daily', 'weekly', 'monthly'];
const ISO_DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/;

const toTimestamp = (value: string): number | null => {
  const match = ISO_DATE_PREFIX.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarDate.getUTCFullYear() !== year
    || calendarDate.getUTCMonth() !== month - 1
    || calendarDate.getUTCDate() !== day
  ) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** 自然日键：同一天内多次刷新只保留最后一份快照。 */
const dayKey = (iso: string): string => {
  const date = new Date(toTimestamp(iso) ?? 0);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const dayNumber = (iso: string): number => {
  const date = new Date(toTimestamp(iso) ?? 0);
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS);
};

const bucketKey = (period: TrendingTimeRange, language: string): string => `${period}\u0000${language}`;

const isPeriod = (value: unknown): value is TrendingTimeRange => (
  typeof value === 'string' && (PERIODS as string[]).includes(value)
);

/** 规范化单条entry；名字为空或名次非正数就丢弃。 */
const normalizeEntry = (value: unknown): TrendingSnapshotEntry | null => {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const fullName = typeof record.repositoryFullName === 'string' ? record.repositoryFullName.trim() : '';
  if (!fullName) return null;
  const rank = typeof record.rank === 'number' && Number.isFinite(record.rank) && record.rank >= 1
    ? Math.floor(record.rank)
    : null;
  if (rank === null) return null;
  const stars = typeof record.stars === 'number' && Number.isFinite(record.stars) && record.stars >= 0
    ? Math.floor(record.stars)
    : 0;
  return { repositoryFullName: fullName, rank, stars };
};

/** 规范化整份快照；坏输入返回 null。 */
export const normalizeTrendingSnapshot = (value: unknown): TrendingSnapshot | null => {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (!isPeriod(record.period)) return null;
  const language = typeof record.language === 'string' && record.language.trim() ? record.language.trim() : 'All';
  const capturedTimestamp = typeof record.capturedAt === 'string' ? toTimestamp(record.capturedAt) : null;
  if (capturedTimestamp === null) return null;
  const capturedAt = new Date(capturedTimestamp).toISOString();
  if (!Array.isArray(record.entries)) return null;

  const candidates = record.entries
    .map(normalizeEntry)
    .filter((entry): entry is TrendingSnapshotEntry => entry !== null)
    .sort((left, right) => left.rank - right.rank);
  const seen = new Set<string>();
  const entries: TrendingSnapshotEntry[] = [];
  for (const entry of candidates) {
    if (seen.has(entry.repositoryFullName)) continue;
    seen.add(entry.repositoryFullName);
    entries.push(entry);
    if (entries.length === MAX_TRENDING_ENTRIES_PER_SNAPSHOT) break;
  }
  if (entries.length === 0) return null;

  return { period: record.period, language, capturedAt, entries };
};

/** 逐份规范化并丢弃非法项。 */
export const normalizeTrendingSnapshots = (value: unknown): TrendingSnapshot[] => {
  if (!Array.isArray(value)) return [];
  const snapshots = value
    .map(normalizeTrendingSnapshot)
    .filter((snapshot): snapshot is TrendingSnapshot => snapshot !== null);
  return pruneTrendingSnapshots(snapshots);
};

/** 去掉超期快照，并按桶裁剪到上限（每桶保留最新 N 份）。 */
export const pruneTrendingSnapshots = (
  snapshots: TrendingSnapshot[],
  now: number = Date.now(),
): TrendingSnapshot[] => {
  const fresh = snapshots.filter((snapshot) => {
    const captured = toTimestamp(snapshot.capturedAt);
    if (captured === null) return false;
    const age = now - captured;
    return age >= 0 && age <= MAX_AGE_MS;
  });

  const byBucket = new Map<string, TrendingSnapshot[]>();
  for (const snapshot of fresh) {
    const key = bucketKey(snapshot.period, snapshot.language);
    const bucket = byBucket.get(key) ?? [];
    bucket.push(snapshot);
    byBucket.set(key, bucket);
  }

  const kept: TrendingSnapshot[] = [];
  for (const bucket of byBucket.values()) {
    const latestByDay = new Map<string, TrendingSnapshot>();
    bucket
      .sort((a, b) => (toTimestamp(a.capturedAt) ?? 0) - (toTimestamp(b.capturedAt) ?? 0))
      .forEach((snapshot) => latestByDay.set(dayKey(snapshot.capturedAt), snapshot));
    [...latestByDay.values()]
      .slice(-MAX_TRENDING_SNAPSHOTS_PER_BUCKET)
      .forEach((snapshot) => kept.push(snapshot));
  }
  return kept.sort((a, b) => (toTimestamp(a.capturedAt) ?? 0) - (toTimestamp(b.capturedAt) ?? 0));
};

/**
 * 记一份快照。
 *
 * 同一个「周期 × 语言 × 自然日」只保留最后一次看到的榜单——一天之内翻页、切语言再切回来
 * 都不该留下多份互相矛盾的快照。写入时顺带裁掉超期与超量的历史。
 */
export const recordTrendingSnapshot = (
  snapshots: TrendingSnapshot[],
  next: TrendingSnapshot,
  now: number = Date.now(),
): TrendingSnapshot[] => {
  const normalized = normalizeTrendingSnapshot(next);
  if (!normalized) return pruneTrendingSnapshots(snapshots, now);

  const sameBucketAndDay = (snapshot: TrendingSnapshot) => (
    snapshot.period === normalized.period
    && snapshot.language === normalized.language
    && dayKey(snapshot.capturedAt) === dayKey(normalized.capturedAt)
  );

  const rest = snapshots.filter((snapshot) => !sameBucketAndDay(snapshot));
  return pruneTrendingSnapshots([...rest, normalized], now);
};

export interface TrendingHistoryRow {
  repositoryFullName: string;
  /** 最新一份快照里的名次。 */
  rank: number;
  /** 上一份快照里的名次；之前没上榜时为 null。 */
  previousRank: number | null;
  /** 正数=上升了几名（名次数字变小），负数=下降，0=没变；首次上榜为 null。 */
  rankChange: number | null;
  firstSeenAt: string;
  /** 连续上榜的自然日数（按每天至少一份快照算，最多回看 30 天）。 */
  streakDays: number;
  /** 自第一次记录以来的 star 增量；数据不足或为负时返回 null。 */
  starsGained: number | null;
}

/**
 * 把某个「周期 × 语言」桶的快照整理成逐仓库的历史。
 *
 * 名次变化对比的是**上一天的快照**，不是"上一份"——同一天刷新多次不算变化，否则用户每次
 * 刷新都会看到"上升 N 名"的假象。
 */
export const buildTrendingHistory = (
  snapshots: TrendingSnapshot[],
  period: TrendingTimeRange,
  language: string,
): TrendingHistoryRow[] => {
  const bucket = snapshots
    .filter((snapshot) => snapshot.period === period && snapshot.language === language)
    .sort((a, b) => (toTimestamp(a.capturedAt) ?? 0) - (toTimestamp(b.capturedAt) ?? 0));
  if (bucket.length === 0) return [];

  const latest = bucket[bucket.length - 1];
  const latestDay = dayKey(latest.capturedAt);
  const previousDaySnapshot = [...bucket]
    .reverse()
    .find((snapshot) => dayKey(snapshot.capturedAt) < latestDay) ?? null;

  const byRepository = new Map<string, TrendingHistoryRow>();

  const ensureRow = (fullName: string, firstSeenAt: string): TrendingHistoryRow => {
    const existing = byRepository.get(fullName);
    if (existing) return existing;
    const row: TrendingHistoryRow = {
      repositoryFullName: fullName,
      rank: 0,
      previousRank: null,
      rankChange: null,
      firstSeenAt,
      streakDays: 0,
      starsGained: null,
    };
    byRepository.set(fullName, row);
    return row;
  };

  for (const snapshot of bucket) {
    const captured = toTimestamp(snapshot.capturedAt) ?? 0;
    for (const entry of snapshot.entries) {
      const row = ensureRow(entry.repositoryFullName, snapshot.capturedAt);
      const firstSeen = toTimestamp(row.firstSeenAt) ?? 0;
      if (captured < firstSeen) {
        row.firstSeenAt = snapshot.capturedAt;
      }
    }
  }

  const latestDayNumber = dayNumber(latest.capturedAt);
  const presenceDays = new Map<string, Set<number>>();

  for (const snapshot of bucket) {
    if (dayNumber(snapshot.capturedAt) < latestDayNumber - (TRENDING_STREAK_WINDOW_DAYS - 1)) continue;
    for (const entry of snapshot.entries) {
      const days = presenceDays.get(entry.repositoryFullName) ?? new Set<number>();
      days.add(dayNumber(snapshot.capturedAt));
      presenceDays.set(entry.repositoryFullName, days);
    }
  }

  for (const entry of latest.entries) {
    const row = ensureRow(entry.repositoryFullName, latest.capturedAt);
    row.rank = entry.rank;
    const days = presenceDays.get(entry.repositoryFullName) ?? new Set<number>();
    let streakDays = 0;
    for (let day = dayNumber(latest.capturedAt); streakDays < TRENDING_STREAK_WINDOW_DAYS; day -= 1) {
      if (!days.has(day)) break;
      streakDays += 1;
    }
    row.streakDays = Math.max(streakDays, 1);

    const previousEntry = previousDaySnapshot?.entries
      .find((candidate) => candidate.repositoryFullName === entry.repositoryFullName) ?? null;
    row.previousRank = previousEntry?.rank ?? null;
    row.rankChange = previousEntry ? previousEntry.rank - entry.rank : null;

    const earliest = bucket
      .filter((snapshot) => toTimestamp(snapshot.capturedAt) !== null)
      .map((snapshot) => snapshot.entries.find((candidate) => candidate.repositoryFullName === entry.repositoryFullName))
      .find((candidate): candidate is TrendingSnapshotEntry => Boolean(candidate));
    // 只用我们自己记录到的 star 数做差，不假装是 GitHub 的"本周期新增"
    row.starsGained = earliest && entry.stars >= earliest.stars ? entry.stars - earliest.stars : null;
  }

  return [...byRepository.values()]
    .filter((row) => row.rank > 0)
    .sort((a, b) => a.rank - b.rank);
};

/** 榜单里最值得展示的变化：新上榜、上升最多、下降最多。 */
export interface TrendingHighlight {
  kind: 'new-entry' | 'rising' | 'falling';
  repositoryFullName: string;
  /** 名次变化量（新上榜为 null）。 */
  rankChange: number | null;
  rank: number;
}

export const pickTrendingHighlights = (
  rows: TrendingHistoryRow[],
  limit = 3,
): TrendingHighlight[] => {
  const newEntries: TrendingHighlight[] = rows
    .filter((row) => row.rankChange === null)
    .slice(0, limit)
    .map((row) => ({
      kind: 'new-entry' as const,
      repositoryFullName: row.repositoryFullName,
      rankChange: null,
      rank: row.rank,
    }));

  const risers: TrendingHighlight[] = rows
    .filter((row): row is TrendingHistoryRow & { rankChange: number } => typeof row.rankChange === 'number' && row.rankChange > 0)
    .sort((a, b) => b.rankChange - a.rankChange)
    .slice(0, limit)
    .map((row) => ({
      kind: 'rising' as const,
      repositoryFullName: row.repositoryFullName,
      rankChange: row.rankChange,
      rank: row.rank,
    }));

  const fallers: TrendingHighlight[] = rows
    .filter((row): row is TrendingHistoryRow & { rankChange: number } => typeof row.rankChange === 'number' && row.rankChange < 0)
    .sort((a, b) => a.rankChange - b.rankChange)
    .slice(0, limit)
    .map((row) => ({
      kind: 'falling' as const,
      repositoryFullName: row.repositoryFullName,
      rankChange: row.rankChange,
      rank: row.rank,
    }));

  return [...risers, ...newEntries, ...fallers];
};
