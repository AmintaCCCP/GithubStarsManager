import type { AssetFilter } from '../types';
import { normalizeRepoKey } from './releaseSources';

/**
 * 关键词条目的去重键：trim 后小写（关键词匹配本身大小写不敏感，
 * "Mac" 与 "mac" 视为同一条，保留首个的书写形式）。
 */
const keywordKey = (value: string): string => value.trim().toLowerCase();

/**
 * 净化字符串数组：过滤非字符串元素、trim、剔除空/纯空白项、按 key 去重（保留首个）。
 * 空字符串关键词必须剔除——`includes("")` 恒为 true，`keywords: [""]` 会变相
 * 匹配所有 Release，击穿"畸形全空 filter 不意外匹配"的防御。
 */
const sanitizeStringArray = (value: unknown, key: (item: string) => string): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;

  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    const dedupeKey = key(trimmed);
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    result.push(trimmed);
  }
  return result;
};

/**
 * 规范化外部（本地持久化 / 后端同步 / 备份导入）传入的资产过滤器：
 * - 丢弃缺少必填字段（非空 id、name、keywords 数组）的畸形条目，保证下游
 *   ReleaseTimeline 的关键词匹配读取 keywords 不会抛错；
 * - keywords / excludeKeywords / includeRepos / alwaysExcludeRepos 统一净化：
 *   过滤非字符串元素、trim、剔除空/纯空白项、去重（仓库按 normalizeRepoKey
 *   不区分大小写去重，关键词按 trim 后小写去重，均保留首个的展示文本）；
 * - 按 AssetFilter 的已知字段重建条目，顺带丢弃未知键——包括 #405 曾短暂
 *   引入、已被 includeRepos 取代的反向语义字段 `excludeRepos`，避免废弃
 *   数据随设置同步无限往返，也防止旧字段被重新解释为 `alwaysExcludeRepos` 语义。
 */
export const normalizeAssetFilters = (filters: unknown): AssetFilter[] => {
  if (!Array.isArray(filters)) return [];

  return filters
    .filter((filter): filter is Record<string, unknown> => !!filter && typeof filter === 'object')
    .map(filter => {
      if (
        typeof filter.id !== 'string' || filter.id.length === 0 ||
        typeof filter.name !== 'string' ||
        !Array.isArray(filter.keywords)
      ) {
        return null;
      }

      const keywords = sanitizeStringArray(filter.keywords, keywordKey);
      if (!keywords) return null;

      const normalized: AssetFilter = {
        id: filter.id,
        name: filter.name,
        keywords,
      };

      const excludeKeywords = sanitizeStringArray(filter.excludeKeywords, keywordKey);
      if (excludeKeywords) normalized.excludeKeywords = excludeKeywords;
      const includeRepos = sanitizeStringArray(filter.includeRepos, normalizeRepoKey);
      if (includeRepos) normalized.includeRepos = includeRepos;
      const alwaysExcludeRepos = sanitizeStringArray(filter.alwaysExcludeRepos, normalizeRepoKey);
      if (alwaysExcludeRepos) normalized.alwaysExcludeRepos = alwaysExcludeRepos;
      if (typeof filter.isPreset === 'boolean') normalized.isPreset = filter.isPreset;
      if (typeof filter.icon === 'string') normalized.icon = filter.icon;

      return normalized;
    })
    .filter((filter): filter is AssetFilter => filter !== null);
};

/**
 * 判定单个过滤器是否命中一个 Release（对每个已启用过滤器独立求值，多过滤器间取 OR）：
 * 1. 仓库命中「始终排除」→ 不命中（排除优先，且早于 includeRepos 与关键词判断）；
 * 2. 仓库命中「始终包含」→ 命中（仅绕过本过滤器的关键词判断，绕不过本过滤器的排除）；
 * 3. 有资产规则时：包含关键词非空则匹配范围为全部下载链接名（含源码归档伪资产与
 *    Release 正文提取链接，`preset-source` 依赖此现状）；包含关键词为空则只匹配
 *    release.assets 的真实上传资产名——否则真实资产全被排除的 Release 仍可能被
 *    未排除的伪资产/正文链接命中，排除关键词无法隐藏该 Release；
 * 4. 无资产规则时：includeRepos 非空 → 不命中（白名单之外没有正向条件）；
 *    仅 alwaysExcludeRepos 非空 → 命中（其余仓库匹配）；两者皆空 → 不命中。
 *
 * lowerRepoKey / lowerAllLinkNames / lowerRealAssetNames 由调用方小写归一化；
 * 过滤器自身字段为原始值（仓库与关键词匹配均不区分大小写）。
 */
export const filterMatchesRelease = (
  filter: Pick<AssetFilter, 'keywords'> & Partial<AssetFilter>,
  lowerRepoKey: string,
  lowerAllLinkNames: string[],
  lowerRealAssetNames: string[],
): boolean => {
  if ((filter.alwaysExcludeRepos ?? []).some(name => normalizeRepoKey(name) === lowerRepoKey)) {
    return false;
  }
  if ((filter.includeRepos ?? []).some(name => normalizeRepoKey(name) === lowerRepoKey)) {
    return true;
  }

  // 防御未经过 normalizeAssetFilters 的数据：空字符串关键词经 includes("") 恒为
  // true，会让包含词击穿匹配、排除词隐藏全部 Release，这里先剔除。
  const keywords = (filter.keywords ?? []).filter(keyword => keyword.trim().length > 0);
  const excludeKeywords = (filter.excludeKeywords ?? []).filter(keyword => keyword.trim().length > 0);
  const hasKeywords = keywords.length > 0;
  const hasExcludeKeywords = excludeKeywords.length > 0;

  if (hasKeywords || hasExcludeKeywords) {
    const matchScope = hasKeywords ? lowerAllLinkNames : lowerRealAssetNames;
    const assetHit = matchScope.some(lowerLinkName =>
      (!hasKeywords || keywords.some(keyword => lowerLinkName.includes(keyword.toLowerCase()))) &&
      !excludeKeywords.some(keyword => lowerLinkName.includes(keyword.toLowerCase()))
    );
    if (assetHit) return true;
  }

  if (!hasKeywords && !hasExcludeKeywords) {
    // 仓库白名单（includeRepos）存在时不命中其之外的仓库；仅排除列表是有意
    // 支持的负向仓库过滤器：除排除仓库外的仓库均命中（第 2 节规则 7）
    if ((filter.includeRepos ?? []).length === 0 && (filter.alwaysExcludeRepos ?? []).length > 0) {
      return true;
    }
  }

  return false;
};
