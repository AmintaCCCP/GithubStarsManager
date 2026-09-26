import type { AssetFilter } from '../types';

/**
 * 规范化外部（本地持久化 / 后端同步）传入的资产过滤器：
 * - 剔除非对象项；
 * - 剥离 #405 曾短暂引入的反向语义字段 `excludeRepos`（已由 `includeRepos`
 *   取代）：旧键不会被任何读取方消费，剥掉以免随设置同步无限往返。
 */
export const normalizeAssetFilters = (filters: unknown): AssetFilter[] => {
  if (!Array.isArray(filters)) return [];
  return filters
    .filter((filter): filter is Record<string, unknown> => !!filter && typeof filter === 'object')
    .map(filter => {
      const normalized = { ...filter };
      delete normalized.excludeRepos;
      return normalized as unknown as AssetFilter;
    });
};
