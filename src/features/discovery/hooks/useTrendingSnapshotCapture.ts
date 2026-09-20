import { useEffect, useRef } from 'react';
import type { DiscoveryRepo, TrendingTimeRange } from '../../../types';
import { MAX_TRENDING_ENTRIES_PER_SNAPSHOT } from '../../../types/trendingSnapshot';
import { useAppStore } from '../../../store/useAppStore';

/**
 * 把当前看到的 Trending 榜单记成一份快照（开发守则 §7）。
 *
 * 只在 trending 频道调用；每天同一「周期 × 语言」只保留一份（去重与上限由
 * `utils/trendingSnapshots` 负责），所以重复渲染、翻页、切回来都不会堆出互相矛盾的历史。
 */
export const useTrendingSnapshotCapture = (
  repos: DiscoveryRepo[],
  isTrendingChannel: boolean,
  period: TrendingTimeRange,
  language: string,
  lastRefresh: string | null,
): void => {
  const recordTrendingSnapshot = useAppStore((state) => state.recordTrendingSnapshot);
  const capturedRefreshRef = useRef(lastRefresh);

  useEffect(() => {
    if (!lastRefresh || lastRefresh === capturedRefreshRef.current) return;
    capturedRefreshRef.current = lastRefresh;
    if (!isTrendingChannel || repos.length === 0) return;
    recordTrendingSnapshot({
      period,
      language,
      capturedAt: new Date().toISOString(),
      entries: repos.slice(0, MAX_TRENDING_ENTRIES_PER_SNAPSHOT).map((repo, index) => ({
        repositoryFullName: repo.full_name,
        // 接口给的 rank 可能缺失，用当前顺序兜底
        rank: typeof repo.rank === 'number' && repo.rank >= 1 ? repo.rank : index + 1,
        stars: typeof repo.stargazers_count === 'number' && repo.stargazers_count >= 0 ? repo.stargazers_count : 0,
      })),
    });
  }, [repos, isTrendingChannel, period, language, lastRefresh, recordTrendingSnapshot]);
};
