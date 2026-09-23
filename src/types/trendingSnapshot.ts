/**
 * Trending 快照（开发守则 §7）。
 *
 * 现有 Trending 只是"即时展示"：刷新一次就覆盖，看不出排名变化、看不出谁是新上榜的。
 * 这里把每次看到的榜单按「周期 × 平台 × 自然日」存一份快照，历史只在本地保留有限条数。
 *
 * 不维护独立的 Trending 详情模型：快照只记仓库名、排名与当时的 star 数，展示时统一回到
 * Repository 模型（与开发守则 §7 的要求一致）。
 */
import type { TrendingTimeRange } from './index';

export interface TrendingSnapshotEntry {
  repositoryFullName: string;
  /** 该快照里的名次（1 起）。 */
  rank: number;
  /** 抓取时的总 star 数；拿来算"自我们开始记录以来的新增"，不是 GitHub 的"今日新增"。 */
  stars: number;
}

export interface TrendingSnapshot {
  period: TrendingTimeRange;
  /** 'All' 或平台 id；与 Trending 请求使用的平台筛选一致。 */
  platform: string;
  /** ISO 时间戳。 */
  capturedAt: string;
  entries: TrendingSnapshotEntry[];
}

/** 每个「周期 × 平台」桶最多保留多少份快照。 */
export const MAX_TRENDING_SNAPSHOTS_PER_BUCKET = 30;

/** 单份快照只保留榜单头部，避免损坏的持久化数据无限扩张。 */
export const MAX_TRENDING_ENTRIES_PER_SNAPSHOT = 50;

/** 超过这个天数的快照在写入时清掉。 */
export const TRENDING_SNAPSHOT_MAX_AGE_DAYS = 90;

/** 判定"连续上榜"时最多回溯多少天。 */
export const TRENDING_STREAK_WINDOW_DAYS = 30;
