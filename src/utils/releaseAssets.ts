import type { ReleaseAsset } from '../types';

/**
 * 计算单个资产的指纹。
 * 资产指纹用于判断某条 Release 的资产是否发生变化。
 * 依据：GitHub 资产一旦被替换/重传，`updated_at` 会更新；用 `size` 与 `download_count`
 * 做兜底，覆盖同时间戳内出现大小或下载量变化的极端情况。
 */
export function assetFingerprint(asset: ReleaseAsset): string {
  return [asset.id, asset.updated_at, asset.size, asset.download_count].join(':');
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
