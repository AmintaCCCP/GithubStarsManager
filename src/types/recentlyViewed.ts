import type { Repository } from './index';

/**
 * 一条「最近浏览」记录。
 *
 * 存整份 Repository 快照而不是只存 id：Discovery 里的仓库不在本地 stars 列表里，
 * 只存 id 的话重启后无法还原展示内容（`discoveryRepos` 本身不持久化）。条数有上限
 * 且带时间上限（见 `src/utils/recentlyViewed.ts`），体积可控。
 *
 * 纯本地数据：不上传远端，也不进插件快照。
 */
export interface RecentlyViewedEntry {
  repository: Repository;
  /** ISO 时间戳。 */
  viewedAt: string;
}
