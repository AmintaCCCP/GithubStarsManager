import type { Repository } from '../types';

/**
 * 仓库身份判定的唯一权威实现。
 *
 * ## 不变量
 *
 * **`id` 是权威的 GitHub 身份；`full_name` 仅在身份缺失时作兜底线索。**
 *
 * 历史教训：本模块出现之前，这条规则被分别写在 `addRepository`、
 * `mergeStarredRepositories`、发现页三处，且三处实现不一致（有的要求
 * full_name 同时命中、有的只比名称、有的大小写敏感），导致「改名」「复用旧名」
 * 「历史合成 id」三类场景反复互相干扰，修一处冒一处。所有身份判断一律走本模块。
 *
 * ## 合成 id
 *
 * 批量从链接 Star 的早期版本会给新仓库分配时间戳型合成 id
 * （`Date.now() + random`，约 1.8e12），这类记录没有权威 GitHub 身份。
 * 真实 GitHub 仓库 id 远小于该阈值（当前量级 < 1e10），故用下界即可区分。
 */
export const SYNTHETIC_REPOSITORY_ID_FLOOR = 1e11;

/** 入参是否带有可用的 GitHub 仓库 id（正整数）。 */
export const isValidGitHubRepositoryId = (id: unknown): id is number =>
  typeof id === 'number' && Number.isInteger(id) && id > 0;

/**
 * 该记录是否为「批量 Star 遗留的合成 id 记录」。
 *
 * 只有这类记录允许按名称认领：它们本就没有 GitHub id，名称是唯一线索。
 * 反之，带真实 id 的记录身份是权威的 —— id 对不上说明该仓库已被改名或删除，
 * 此时按名称认领会让复用旧名的新仓库错误继承旧仓库的 AI 分析与分类。
 */
export const isLegacySyntheticIdRecord = (repo: Pick<Repository, 'id'>): boolean =>
  repo.id >= SYNTHETIC_REPOSITORY_ID_FLOOR;

/** 身份判定所需的入参形状。 */
export type RepositoryIdentity = Pick<Repository, 'id' | 'full_name'>;

/** 同一 GitHub 身份：入参 id 有效且与候选记录相同（改名不影响，因为只比 id）。 */
export const matchesSameGitHubId = (
  incoming: RepositoryIdentity,
  candidate: RepositoryIdentity,
): boolean => isValidGitHubRepositoryId(incoming.id) && candidate.id === incoming.id;

/**
 * 名称兜底：入参名称与候选记录相同，**且**候选记录是合成 id 的历史记录。
 * 大小写不敏感 —— GitHub 的 owner/repo 名称本身不区分大小写，
 * 本地缓存的大小写可能与上游不一致。
 */
export const matchesLegacyNameFallback = (
  incoming: RepositoryIdentity,
  candidate: RepositoryIdentity,
): boolean => Boolean(incoming.full_name)
  && Boolean(candidate.full_name)
  && isLegacySyntheticIdRecord(candidate)
  && candidate.full_name.toLowerCase() === incoming.full_name.toLowerCase();

/**
 * 为一条入参选取对应的本地记录，未命中返回 `undefined`（视为新增）。
 *
 * 选取顺序即不变量：**id 优先，合成 id 的名称兜底其次**。
 */
export const findIdentityMatch = (
  incoming: RepositoryIdentity,
  candidates: Repository[],
): Repository | undefined => candidates.find(candidate => matchesSameGitHubId(incoming, candidate))
  ?? candidates.find(candidate => matchesLegacyNameFallback(incoming, candidate));

/**
 * 为**整批**入参分配本地记录，结果与 `incoming` 一一对齐（`undefined` = 新增）。
 *
 * 两遍分配，第二遍一对一：
 * 1. 先用 id 匹配整批入参，把命中的本地记录全部标记为「已占用」；
 * 2. 再对剩余未匹配入参做名称兜底，跳过已被占用的候选。
 *
 * 为什么必须分两遍：GitHub 允许新仓库复用刚改完名的旧仓库名。若本地是
 * `{ id: 1, full_name: 'owner/old' }`，而本批入参同时包含改名的
 * `{ id: 1, full_name: 'owner/new' }` 与复用旧名的 `{ id: 2, full_name: 'owner/old' }`，
 * 单遍匹配会让两条入参都命中同一条本地记录 → 产出两条 `id: 1` 的记录，
 * 并把旧仓库的 AI 分析与分类复制到新仓库上。分两遍后结果也与入参顺序无关。
 */
export const assignIdentityMatches = (
  incoming: Repository[],
  candidates: Repository[],
): Array<Repository | undefined> => {
  const assignments: Array<Repository | undefined> = new Array(incoming.length).fill(undefined);
  if (incoming.length === 0 || candidates.length === 0) return assignments;

  // 已占用的候选记录，按对象引用登记，保证「同一份本地记录只被用一次」。
  const claimed = new Set<Repository>();

  // 第一遍：整批 id 匹配，先把命中的本地记录全部占住。
  incoming.forEach((repo, index) => {
    const match = candidates.find(candidate => matchesSameGitHubId(repo, candidate));
    if (!match) return;
    assignments[index] = match;
    claimed.add(match);
  });

  // 第二遍：仅对未匹配入参做名称兜底，跳过已被第一遍占用的记录。
  incoming.forEach((repo, index) => {
    if (assignments[index]) return;
    const match = candidates.find(
      candidate => !claimed.has(candidate) && matchesLegacyNameFallback(repo, candidate),
    );
    if (!match) return;
    assignments[index] = match;
    claimed.add(match);
  });

  return assignments;
};
