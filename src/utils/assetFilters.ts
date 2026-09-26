import type { AssetFilter } from '../types';

const coerceStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === 'string');
};

/**
 * 规范化外部（本地持久化 / 后端同步 / 备份导入）传入的资产过滤器：
 * - 丢弃缺少必填字段（非空 id、name、keywords 数组）的畸形条目，保证下游
 *   ReleaseTimeline 的关键词匹配读取 keywords 不会抛错；
 * - keywords / excludeKeywords / includeRepos 中的非字符串元素被剔除；
 * - 按 AssetFilter 的已知字段重建条目，顺带丢弃未知键——包括 #405 曾短暂
 *   引入、已被 includeRepos 取代的反向语义字段 `excludeRepos`，避免废弃
 *   数据随设置同步无限往返。
 */
export const normalizeAssetFilters = (filters: unknown): AssetFilter[] => {
  if (!Array.isArray(filters)) return [];

  return filters
    .filter((filter): filter is Record<string, unknown> => !!filter && typeof filter === 'object')
    .map(filter => {
      const rawKeywords = filter.keywords;
      if (
        typeof filter.id !== 'string' || filter.id.length === 0 ||
        typeof filter.name !== 'string' ||
        !Array.isArray(rawKeywords)
      ) {
        return null;
      }

      const normalized: AssetFilter = {
        id: filter.id,
        name: filter.name,
        keywords: rawKeywords.filter((keyword): keyword is string => typeof keyword === 'string'),
      };

      const excludeKeywords = coerceStringArray(filter.excludeKeywords);
      if (excludeKeywords) normalized.excludeKeywords = excludeKeywords;
      const includeRepos = coerceStringArray(filter.includeRepos);
      if (includeRepos) normalized.includeRepos = includeRepos;
      if (typeof filter.isPreset === 'boolean') normalized.isPreset = filter.isPreset;
      if (typeof filter.icon === 'string') normalized.icon = filter.icon;

      return normalized;
    })
    .filter((filter): filter is AssetFilter => filter !== null);
};
