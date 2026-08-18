import type { Release, ReleaseAsset } from '../types';

/**
 * 计算单个资产的指纹。
 * 资产指纹用于判断某条 Release 的资产内容是否发生变化。
 * 依据：GitHub 资产一旦被替换/重传，`updated_at` 会更新；用 `size` 做兜底，
 * 覆盖同时间戳内出现大小变化的极端情况。
 * 注意：`download_count` 是易变元数据（每次下载都会 +1），若纳入指纹会导致
 * 指纹在两次刷新间必然变化，从而让增量刷新的“无变化则短路”失效，故不纳入。
 */
export function assetFingerprint(asset: ReleaseAsset): string {
  return [asset.id, asset.updated_at, asset.size].join(':');
}

/**
 * 计算一组资产的稳定指纹。
 * 对资产数组做稳定排序（按 id）后逐个序列化，保证幂等：
 * - 同一组资产无论顺序如何，指纹一致；
 * - 资产未变化时指纹不变，可用于短路（不触发 store/后端写入）。
 */
export function assetsFingerprint(assets: ReleaseAsset[] | undefined): string {
  if (!Array.isArray(assets) || assets.length === 0) return '';
  const sorted = [...assets].sort((a, b) => a.id - b.id);
  return sorted.map(assetFingerprint).join('|');
}

/**
 * 判断两组资产的指纹是否一致（即资产是否发生变化）。
 * 用于增量刷新时判断已存在 Release 的资产是否需要更新。
 */
export function hasAssetsChanged(
  current: ReleaseAsset[] | undefined,
  incoming: ReleaseAsset[] | undefined
): boolean {
  return assetsFingerprint(current) !== assetsFingerprint(incoming);
}

/**
 * 从最新拉取的 Release 中筛出“资产相对本地已变化”的条目。
 * 只比对本地已存在 id 的 Release（新增条目由调用方 addReleases 处理）；
 * 资产指纹未变化则跳过，保证幂等，避免重复触发 store/后端写入。
 * 供刷新入口（ReleaseTimeline.handleRefresh）与测试复用。
 */
export function findReleasesWithChangedAssets(
  latestReleases: Release[] | undefined,
  currentReleases: Release[]
): Release[] {
  const byId = new Map(currentReleases.map(r => [r.id, r]));
  return (latestReleases || []).filter((latest) => {
    const local = byId.get(latest.id);
    if (!local) return false;
    return assetsFingerprint(local.assets) !== assetsFingerprint(latest.assets);
  });
}

/**
 * 计算 Release 的有效展示时间。
 * GitHub 的 Release 对象没有 updated_at，资产变更时 published_at 不会变化；
 * 资产更新时间已包含在 assets[].updated_at 中（每次替换/重传都会更新）。
 * 取 published_at 与所有资产 updated_at 中的较新者，作为用户可见的更新时间。
 * 返回标准化 ISO 字符串（toISOString），保证不同时间戳格式（含/不含毫秒）可稳定比较。
 */
export function effectiveReleaseTime(release: Pick<Release, 'published_at' | 'assets'>): string {
  let latest = new Date(release.published_at).getTime();
  if (Array.isArray(release.assets)) {
    for (const asset of release.assets) {
      const assetTime = new Date(asset.updated_at).getTime();
      if (!Number.isNaN(assetTime) && assetTime > latest) {
        latest = assetTime;
      }
    }
  }
  return new Date(latest).toISOString();
}

/**
 * 判断是否存在发布时间之后更新过的资产。
 * 使用时间值比较，而不是比较不同格式的时间字符串，避免时区或毫秒精度差异造成误判。
 */
export function hasAssetsUpdatedAfterPublish(
  release: Pick<Release, 'published_at' | 'assets'>
): boolean {
  const publishedTime = new Date(release.published_at).getTime();
  if (Number.isNaN(publishedTime) || !Array.isArray(release.assets)) return false;

  return release.assets.some((asset) => {
    const assetTime = new Date(asset.updated_at).getTime();
    return !Number.isNaN(assetTime) && assetTime > publishedTime;
  });
}

/**
 * “资产已更新”是未读更新提示的一部分；Release 被标记为已读后应立即隐藏该提示。
 */
export function shouldShowAssetsUpdatedIndicator(
  release: Pick<Release, 'published_at' | 'assets'>,
  isUnread: boolean
): boolean {
  return isUnread && hasAssetsUpdatedAfterPublish(release);
}
