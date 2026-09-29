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
 * 归一化「参与关键词匹配的下载链接名」（调用方已小写化）。
 *
 * GitHub 为**每个** Release 自动生成 `Source code (<tag>.zip)` /
 * `Source code (<tag>.tar.gz)` 伪资产，它们无条件存在、不含任何区分信息。
 * 若原样参与包含关键词的子串匹配，`zip` / `tar.gz` 这类常见的归档后缀词会命中
 * 全部 Release——过滤器等于失效（表现为「macOS」过滤器里冒出零资产的 Release：
 * MinerU 的 `mineru-4.0.0-py3-none-any.whl`、cline/openclaw 的纯源码归档 Release）。
 *
 * 因此匹配时剥掉自动生成的归档后缀（名称形如 `source code (<tag>.zip)`，归档后缀
 * 在右括号之前）：`source code (<tag>)` 仍可被 `source` 命中，
 * `preset-source` 依赖的既有行为不变；而 `zip` / `tar.gz` 只再命中真实上传资产
 * 与 Release 正文提取的下载链接。
 */
export const normalizeMatchedLinkName = (lowerName: string, isSourceCode: boolean): string =>
  isSourceCode ? lowerName.replace(/\.(?:zip|tar\.gz)(?=\)$)/, '') : lowerName;

/**
 * 单个链接名是否命中关键词规则（调用方小写化；排除关键词优先，命中即出局）。
 * 包含关键词为空时不构成正向限制，只做排除判断。
 */
const linkHitsKeywordRules = (
  lowerName: string,
  keywords: string[],
  excludeKeywords: string[],
): boolean =>
  !excludeKeywords.some(keyword => lowerName.includes(keyword.toLowerCase())) &&
  (keywords.length === 0 || keywords.some(keyword => lowerName.includes(keyword.toLowerCase())));

/** 「仓库规则」求值结果：排除优先于包含（排除列表命中的仓库永不被本过滤器命中）。 */
type RepoRuleOutcome = 'excluded' | 'included' | 'none';

const resolveRepoRule = (
  filter: Pick<AssetFilter, 'keywords'> & Partial<AssetFilter>,
  lowerRepoKey: string,
): RepoRuleOutcome => {
  if ((filter.alwaysExcludeRepos ?? []).some(name => normalizeRepoKey(name) === lowerRepoKey)) {
    return 'excluded';
  }
  if ((filter.includeRepos ?? []).some(name => normalizeRepoKey(name) === lowerRepoKey)) {
    return 'included';
  }
  return 'none';
};

export interface AssetFilterEvaluation {
  /** 该 Release 是否出现在 Release 列表中 */
  matchesRelease: boolean;
  /** 卡片默认展示的下载链接索引（下标与传入的 lowerMatchedLinkNames 一一对应） */
  matchedLinkIndexes: Set<number>;
}

/**
 * 单个过滤器对单个 Release 的完整求值：Release 级命中 + 该过滤器贡献的资产索引。
 * 多过滤器之间 Release 级取 OR、资产索引取并集（由调用方合并）。
 *
 * 两层判定共用**同一份**规则实现，因此不存在「Release 出现了却没有任何资产可展示」
 * 或「两层关键词范围不一致」的漂移空间；这与最初拆成两个导出函数、靠注释约定同步的
 * 写法不同（审计发现：那种写法会让两侧规则各自演化）。
 *
 * Release 级（matchesRelease）：
 * 1. 仓库命中「始终排除」→ 不命中（排除优先，且早于 includeRepos 与关键词判断）；
 * 2. 仓库命中「始终包含」→ 命中（仅绕过本过滤器的关键词判断，绕不过本过滤器的排除）；
 * 3. 有资产规则时：包含关键词非空则匹配范围为全部下载链接名（含源码归档伪资产与
 *    Release 正文提取链接，`preset-source` 依赖此现状）——源码归档伪资产经
 *    normalizeMatchedLinkName 剥掉自动生成的归档后缀后再匹配，避免 `zip` / `tar.gz`
 *    命中每个 Release 上的伪资产而使过滤器失效；包含关键词为空则只匹配
 *    release.assets 的真实上传资产名——否则真实资产全被排除的 Release 仍可能被
 *    未排除的伪资产/正文链接命中，排除关键词无法隐藏该 Release；
 * 4. 无资产规则时：includeRepos 非空 → 不命中（白名单之外没有正向条件）；
 *    仅 alwaysExcludeRepos 非空 → 命中（其余仓库匹配）；两者皆空 → 不命中。
 *
 * 资产级（matchedLinkIndexes）：
 * 1. 只有**命中本 Release 的过滤器**才贡献资产：未命中的过滤器（含没有任何规则的
 *    畸形/空过滤器）返回空集，否则它会变相"解锁"所有 Release 的完整资产清单；
 * 2. 仓库命中「始终包含」→ 全部索引（该仓库的 Release 按设计展示全部资产）；
 * 3. 有关键词规则 → 命中包含关键词且不含排除关键词的链接；包含关键词为空时不构成
 *    正向限制，只按排除关键词剔除（负向过滤器不做正向裁剪）；
 * 4. 无资产规则但命中（仅排除列表的负向仓库过滤器）→ 不做资产级限制，返回全部索引。
 *
 * lowerRepoKey / lowerMatchedLinkNames / lowerRealAssetNames 由调用方小写归一化，
 * 且 lowerMatchedLinkNames 需先经 normalizeMatchedLinkName 归一化；
 * 过滤器自身字段为原始值（仓库与关键词匹配均不区分大小写）。
 */
export const evaluateAssetFilter = (
  filter: Pick<AssetFilter, 'keywords'> & Partial<AssetFilter>,
  lowerRepoKey: string,
  lowerMatchedLinkNames: readonly string[],
  lowerRealAssetNames: readonly string[],
): AssetFilterEvaluation => {
  const noIndexes = (): Set<number> => new Set<number>();
  const allIndexes = (): Set<number> =>
    new Set(lowerMatchedLinkNames.map((_, index) => index));

  const repoRule = resolveRepoRule(filter, lowerRepoKey);
  if (repoRule === 'excluded') {
    return { matchesRelease: false, matchedLinkIndexes: noIndexes() };
  }
  if (repoRule === 'included') {
    return { matchesRelease: true, matchedLinkIndexes: allIndexes() };
  }

  // 防御未经过 normalizeAssetFilters 的数据：空字符串关键词经 includes("") 恒为
  // true，会让包含词击穿匹配、排除词隐藏全部 Release，这里先剔除。
  const keywords = (filter.keywords ?? []).filter(keyword => keyword.trim().length > 0);
  const excludeKeywords = (filter.excludeKeywords ?? []).filter(keyword => keyword.trim().length > 0);

  if (keywords.length === 0 && excludeKeywords.length === 0) {
    // 纯仓库规则：白名单命中已在上方返回，这里只剩「仅排除列表」的负向过滤器
    const matchesRelease = (filter.includeRepos ?? []).length === 0
      && (filter.alwaysExcludeRepos ?? []).length > 0;
    return { matchesRelease, matchedLinkIndexes: matchesRelease ? allIndexes() : noIndexes() };
  }

  const hitsKeywordRules = (lowerName: string): boolean =>
    linkHitsKeywordRules(lowerName, keywords, excludeKeywords);
  const matchScope = keywords.length > 0 ? lowerMatchedLinkNames : lowerRealAssetNames;
  if (!matchScope.some(hitsKeywordRules)) {
    return { matchesRelease: false, matchedLinkIndexes: noIndexes() };
  }

  const matchedLinkIndexes = new Set<number>();
  lowerMatchedLinkNames.forEach((lowerName, index) => {
    if (hitsKeywordRules(lowerName)) matchedLinkIndexes.add(index);
  });
  return { matchesRelease: true, matchedLinkIndexes };
};
