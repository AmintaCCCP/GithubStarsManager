/**
 * Repository Health Core —— 客观事实模型。
 *
 * 设计边界（见 docs/plans/2026-09-17-product-roadmap.md §4）：
 * - Core 只提供**可验证的事实**与保守状态，不提供 0–100 健康总分，也不做主观结论。
 * - 「最近没有提交」不等于「不健康」：成熟稳定项目长期不更新是正常状态，
 *   因此本模块只输出中性观测（例如 `no-recent-activity`），由 UI/插件决定如何解释。
 * - 依赖网络补全的事实（贡献者数、closed issues、Security Policy、CI、README/文档、
 *   默认分支最近提交）在未补全时为 `undefined`，显式表示「未知」，绝不猜测。
 *
 * 所有事实均可由 `Repository` + 本地 `Release[]`（+ 可选 enrichment）纯函数推导，
 * 因此筛选、排序、Discovery、AI、MCP 与 Plugin API 复用同一份结果，不需要额外网络请求。
 */

/** UI 分组：Activity / Maintenance / Community / Maturity。 */
export type RepositoryHealthGroup = 'activity' | 'maintenance' | 'community' | 'maturity';

/** 事实来源：仓库字段、本地 Release、或需要联网补全的 enrichment。 */
export type RepositoryHealthFactSource = 'repository' | 'releases' | 'enrichment';

/**
 * 事实数据类型，决定 UI 的格式化方式与筛选行为。
 * `duration` 用于「多久以前」这类派生时间跨度（值为 epoch 毫秒）。
 */
export type RepositoryHealthFactKind = 'boolean' | 'date' | 'count' | 'text' | 'duration';

export type RepositoryHealthFactId =
  // Activity
  | 'pushedAt'
  | 'latestCommitAt'
  | 'recentCommitCount'
  | 'hasReleases'
  | 'latestReleaseAt'
  // Maintenance
  | 'archived'
  | 'disabled'
  | 'fork'
  | 'template'
  | 'license'
  | 'hasSecurityPolicy'
  | 'hasCI'
  | 'hasReadme'
  | 'hasDocs'
  // Community
  | 'stars'
  | 'forks'
  | 'openIssues'
  | 'closedIssues'
  | 'contributors'
  // Maturity
  | 'createdAt'
  | 'ageDays'
  | 'releaseCount'
  | 'releasesPerYear'
  | 'latestStableVersion';

/** 单个事实。`value === null` 表示已知但没有值（例如无 license）；`undefined` 表示未知。 */
export interface RepositoryHealthFact {
  id: RepositoryHealthFactId;
  group: RepositoryHealthGroup;
  kind: RepositoryHealthFactKind;
  /** `null` = 已知且为空（如无 license）；`undefined` = 尚未获得该事实。 */
  value: boolean | number | string | null | undefined;
  source: RepositoryHealthFactSource;
}

/**
 * Core 允许提供的保守状态。这些都是**观测**而不是评分：
 * - `archived` / `disabled`：GitHub 上的客观状态。
 * - `no-releases`：仅在已确认同步过 Release（`has_fetched_releases === true`）时才给出。
 * - `no-recent-activity`：最近一次 push 超过 `NO_RECENT_ACTIVITY_DAYS`，中性描述。
 */
export type RepositoryHealthSignalId = 'archived' | 'disabled' | 'no-releases' | 'no-recent-activity';

export interface RepositoryHealthSignal {
  id: RepositoryHealthSignalId;
  /** 触发该观测的时间（epoch 毫秒）；非时间型观测为 null。 */
  since: number | null;
  /** 触发该观测的原始事实值，便于 UI 展示而不必二次推导。 */
  detail?: string | null;
}

/**
 * 需要联网补全的事实。
 * 未提供 enrichment 时，快照中对应字段保持 `undefined`（未知）。
 */
export interface RepositoryHealthEnrichment {
  latestCommitAt?: string | null;
  recentCommitCount?: number;
  closedIssues?: number;
  contributors?: number;
  hasSecurityPolicy?: boolean;
  hasCI?: boolean;
  hasReadme?: boolean;
  hasDocs?: boolean;
}

/**
 * 统一健康事实快照（roadmap §4.1 建议模型 + 补充字段）。
 * 与 `Repository` 分离：快照是派生的只读投影，不进入持久化仓库实体，
 * 因此不会影响后端同步指纹（Issue #304 的哈希契约）。
 */
export interface RepositoryHealthSnapshot {
  /**
   * GitHub 原生状态字段：三态。
   * `true` / `false` 是已知事实，`undefined` 表示本地根本没有这个字段
   * （例如后端 schema 不存储该列、或旧持久化数据缺失）——**不等于「未归档」**。
   * 面板对 `undefined` 显示「未知」，筛选也对 unknown 既不匹配 true 也不匹配 false。
   */
  archived: boolean | undefined;
  disabled: boolean | undefined;
  fork: boolean | undefined;
  isTemplate: boolean | undefined;

  createdAt: string;
  pushedAt: string | null;
  latestCommitAt?: string | null;
  recentCommitCount?: number;

  hasReleases: boolean;
  /** 是否已确认同步过该仓库的 Release。为 false 时 `hasReleases === false` 只代表「尚未拉取」。 */
  releasesFetched: boolean;
  latestReleaseAt: string | null;
  releaseCount: number;
  /** 粗略发布频率：release 总数 / 仓库年龄（年），保留一位小数；无法计算时为 null（未知）。 */
  releasesPerYear: number | null;
  latestStableVersion: string | null;
  latestPrereleaseVersion: string | null;

  stars: number;
  forks: number;
  openIssues?: number;
  closedIssues?: number;
  contributors?: number;

  license?: string | null;
  hasSecurityPolicy?: boolean;
  hasCI?: boolean;
  hasReadme?: boolean;
  hasDocs?: boolean;

  /** 仓库年龄（天）。createdAt 不可解析时为 null。 */
  ageDays: number | null;
  /** 距离最近一次 push 的天数。pushedAt 不可解析时为 null。 */
  daysSinceLastPush: number | null;
  /** 保守状态，顺序稳定（archived → disabled → no-releases → no-recent-activity）。 */
  signals: RepositoryHealthSignal[];
}

/** 供 UI 渲染的分组视图模型。 */
export interface RepositoryHealthGroupView {
  group: RepositoryHealthGroup;
  facts: RepositoryHealthFact[];
}
