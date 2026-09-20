import type { Repository } from '../types';
import type { RecentlyViewedEntry } from '../types/recentlyViewed';

/** 最多保留多少条最近浏览。 */
export const MAX_RECENTLY_VIEWED = 30;

/** 超过这个天数的记录在写入时顺手清掉，避免历史无限增长。 */
export const RECENTLY_VIEWED_MAX_AGE_DAYS = 90;

const MAX_AGE_MS = RECENTLY_VIEWED_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const isRepositorySnapshot = (value: unknown): value is Repository => {
  if (!isRecord(value) || !isRecord(value.owner)) return false;

  const stringFields = ['name', 'full_name', 'html_url', 'created_at', 'updated_at', 'pushed_at'];
  const numberFields = ['id', 'stargazers_count', 'forks_count', 'forks'];
  return stringFields.every((field) => typeof value[field] === 'string')
    && numberFields.every((field) => typeof value[field] === 'number' && Number.isFinite(value[field]))
    && (value.description === null || typeof value.description === 'string')
    && (value.language === null || typeof value.language === 'string')
    && typeof value.owner.login === 'string'
    && typeof value.owner.avatar_url === 'string'
    && Array.isArray(value.topics)
    && value.topics.every((topic) => typeof topic === 'string');
};

/** 时间戳解析不出来、来自未来或已经超期的记录都清掉。 */
const isFresh = (entry: RecentlyViewedEntry, now: number): boolean => {
  const viewedAt = Date.parse(entry?.viewedAt ?? '');
  if (!Number.isFinite(viewedAt)) return false;
  const age = now - viewedAt;
  return age >= 0 && age <= MAX_AGE_MS;
};

/** Hydration boundary: validate, prune and restore the canonical newest-first order. */
export const normalizeRecentlyViewed = (
  value: unknown,
  now: number = Date.now(),
): RecentlyViewedEntry[] => {
  if (!Array.isArray(value)) return [];

  const candidates: RecentlyViewedEntry[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || !isRepositorySnapshot(entry.repository)) continue;
    if (typeof entry.viewedAt !== 'string' || !Number.isFinite(Date.parse(entry.viewedAt))) continue;
    const candidate = { repository: entry.repository, viewedAt: entry.viewedAt };
    if (!isFresh(candidate, now)) continue;
    candidates.push(candidate);
  }

  candidates.sort((left, right) => Date.parse(right.viewedAt) - Date.parse(left.viewedAt));

  const normalized: RecentlyViewedEntry[] = [];
  const seen = new Set<number>();
  for (const entry of candidates) {
    if (seen.has(entry.repository.id)) continue;
    seen.add(entry.repository.id);
    normalized.push(entry);
    if (normalized.length === MAX_RECENTLY_VIEWED) break;
  }
  return normalized;
};

/** 去掉超期与时间戳非法的记录。 */
export const pruneRecentlyViewed = (
  entries: RecentlyViewedEntry[],
  now: number = Date.now(),
): RecentlyViewedEntry[] => entries.filter((entry) => isFresh(entry, now));

/**
 * 把一次浏览放到列表最前。
 *
 * 同一仓库重复浏览只保留最新一条（按 id 去重，重命名后 id 不变）；
 * 结果先裁剪再截断，保证列表长度不超过上限。
 */
export const recordRecentlyViewed = (
  entries: RecentlyViewedEntry[],
  repository: Repository,
  now: number = Date.now(),
): RecentlyViewedEntry[] => {
  const rest = pruneRecentlyViewed(entries, now)
    .filter((entry) => entry.repository?.id !== repository.id);
  return [{ repository, viewedAt: new Date(now).toISOString() }, ...rest].slice(0, MAX_RECENTLY_VIEWED);
};

/** 浏览过的仓库 id 集合，供 Discovery 的 Hide Seen 过滤使用。 */
export const recentlyViewedIds = (entries: RecentlyViewedEntry[]): Set<number> => (
  new Set(entries.flatMap((entry) => Number.isFinite(entry.repository?.id) ? [entry.repository.id] : []))
);
