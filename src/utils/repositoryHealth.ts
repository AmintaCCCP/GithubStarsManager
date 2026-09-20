/**
 * Repository Health Core —— 从本地数据推导客观健康事实。
 *
 * 纯函数、无副作用、无网络请求：输入 `Repository` + 本地 `Release[]`（+ 可选 enrichment），
 * 输出 {@link RepositoryHealthSnapshot}。因此 Repository 列表、筛选、排序、Discovery、
 * AI 提示、MCP 证据与插件快照可以复用同一份结果，并且离线可用。
 *
 * 明确的非目标：
 * - 不输出 0–100 健康总分，不输出「健康 / 不健康」结论（主观评分属于插件）。
 * - 不因为「最近提交少」而把成熟稳定项目标记为异常：`no-recent-activity` 只是中性观测。
 * - 不猜测缺失事实：需要联网补全的字段在未补全时为 `undefined`（未知）。
 */
import type { Release, Repository } from '../types';
import type {
  RepositoryHealthEnrichment,
  RepositoryHealthFact,
  RepositoryHealthFactId,
  RepositoryHealthGroup,
  RepositoryHealthGroupView,
  RepositoryHealthSignal,
  RepositoryHealthSnapshot,
} from '../types/health';
import { NO_LICENSE_SENTINEL, normalizeLicense } from './licenseFilter';

const MS_PER_DAY = 86_400_000;
const DAYS_PER_YEAR = 365.25;

/**
 * 「近期无提交」观测阈值（天）。
 * 一年只是**展示**阈值：超过后 UI 显示中性文案「No pushes in the last 12 months」，
 * 而不是判定项目不健康（成熟稳定项目长期不更新属正常状态）。
 */
export const NO_RECENT_ACTIVITY_DAYS = 365;

/** 发布频率的分母下限（月），避免新仓库出现「每年 365 个 release」这类噪声值。 */
const MIN_FREQUENCY_WINDOW_DAYS = 30;

/** tag 中的一个 token 命中即视为预发布。按 token 比对，避免 `presto` 里的 `pre` 之类误判。 */
const PRERELEASE_TOKENS = new Set([
  'alpha',
  'beta',
  'rc',
  'pre',
  'prerelease',
  'preview',
  'dev',
  'devel',
  'next',
  'canary',
  'snapshot',
  'nightly',
  'insider',
  'unstable',
]);

/** 把时间字符串解析为 epoch 毫秒；缺失或不可解析返回 null。 */
function toTimestamp(value?: string | null): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

/** 把可能为 undefined/NaN 的计数收敛为非负整数。 */
function toCount(value: unknown): number {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

/** 保留一位小数，消除浮点尾差。 */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * 判断单个 Release 是否为预发布。
 * 先信任 GitHub 的 `prerelease` 标记，再按 tag 词元兜底（许多维护者只用 tag 表达预发布）。
 */
export function isPrereleaseRelease(release: Pick<Release, 'prerelease' | 'tag_name'>): boolean {
  if (release.prerelease === true) return true;
  const tag = (release.tag_name ?? '').toLowerCase();
  if (!tag) return false;
  return tag
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .some((token) => PRERELEASE_TOKENS.has(token.replace(/\d+$/, '')));
}

/**
 * 取某个仓库的 Release，按发布时间降序（不可解析的条目丢弃）。
 * 只统计 `repository.id` 匹配的条目——调用方常传入全局 Release 数组。
 */
export function releasesForRepository<T extends Pick<Release, 'repository' | 'published_at'>>(
  releases: readonly T[] | undefined,
  repositoryId: number,
): T[] {
  return (releases ?? [])
    .filter((release) => Number(release.repository?.id) === Number(repositoryId))
    .filter((release) => toTimestamp(release.published_at) !== null)
    .slice()
    .sort(
      (left, right) =>
        (toTimestamp(right.published_at) as number) - (toTimestamp(left.published_at) as number),
    );
}

/**
 * 推导仓库健康事实快照。
 *
 * @param repository 仓库实体（含 GitHub 原生状态字段与本地 AI/自定义字段）。
 * @param releases 本地已同步的 Release；可为全局数组，内部按 `repository.id` 过滤。
 * @param enrichment 可选联网补全结果；缺失字段在快照中保持 `undefined`（未知）。
 * @param now 计算「距今多久」的基准时间，便于测试注入。
 */
export function deriveRepositoryHealthSnapshot(
  repository: Repository,
  releases?: readonly Release[],
  enrichment?: RepositoryHealthEnrichment,
  now: number = Date.now(),
): RepositoryHealthSnapshot {
  const ownReleases = releasesForRepository(releases, repository.id);
  const releaseCount = ownReleases.length;
  const latestRelease = ownReleases[0] ?? null;
  const latestStable =
    ownReleases.find((release) => !isPrereleaseRelease(release)) ?? null;
  const latestPrerelease =
    ownReleases.find((release) => isPrereleaseRelease(release)) ?? null;

  const createdTimestamp = toTimestamp(repository.created_at);
  // 与 `hasRecentActivity` 及 electron/server 两份镜像一致：pushed_at 缺失或不可解析时
  // 回落到 updated_at，避免同一份数据在「最近活动」筛选与事实面板上给出不同答案。
  const pushedTimestamp =
    toTimestamp(repository.pushed_at) ?? toTimestamp(repository.updated_at);
  const ageDays =
    createdTimestamp === null
      ? null
      : Math.max(0, Math.floor((now - createdTimestamp) / MS_PER_DAY));
  const daysSinceLastPush =
    pushedTimestamp === null
      ? null
      : Math.max(0, Math.floor((now - pushedTimestamp) / MS_PER_DAY));

  // 发布频率：以仓库年龄为窗口，分母下限一个月，避免新仓库出现噪声极值。
  // 仓库年龄未知时无法换算「频率」：
  // - 调用方没给 Release 数据 → null（不知道）
  // - 给了数据但没有 Release → 0（确实从不发布）
  // - 给了数据且有 Release → 也只能是 null：把「总数」当成「次/年」是错的
  const releasesPerYear =
    ageDays === null
      ? releases !== undefined && releaseCount === 0
        ? 0
        : null
      : round1(
          releaseCount /
            (Math.max(ageDays, MIN_FREQUENCY_WINDOW_DAYS) / DAYS_PER_YEAR),
        );

  const forkCount =
    repository.forks_count !== undefined
      ? toCount(repository.forks_count)
      : toCount(repository.forks);

  const snapshot: RepositoryHealthSnapshot = {
    // 直接透传三态：字段缺失时保留 undefined（未知），不要用 `=== true` 收敛成 false
    // ——那会把旧数据/后端未存储的仓库误报成「未归档 / 非 Fork / 非模板」。
    archived: repository.archived,
    disabled: repository.disabled,
    fork: repository.fork,
    isTemplate: repository.is_template,

    createdAt: repository.created_at ?? '',
    pushedAt: repository.pushed_at || null,
    latestCommitAt: enrichment?.latestCommitAt,
    recentCommitCount: enrichment?.recentCommitCount,

    hasReleases: releaseCount > 0,
    // 只有调用方显式传入 Release 数组（哪怕是空数组）时才承认「已知该仓库的 Release 情况」；
    // 完全不传表示调用方没有这项数据，此时 Release 相关事实保持「未知」。
    releasesFetched: releases !== undefined && repository.has_fetched_releases === true,
    latestReleaseAt: latestRelease?.published_at ?? null,
    releaseCount,
    releasesPerYear,
    latestStableVersion: latestStable?.tag_name ?? null,
    latestPrereleaseVersion: latestPrerelease?.tag_name ?? null,

    stars: toCount(repository.stargazers_count),
    forks: forkCount,
    openIssues:
      repository.open_issues_count === undefined
        ? undefined
        : toCount(repository.open_issues_count),
    closedIssues: enrichment?.closedIssues,
    contributors: enrichment?.contributors,

    license: repository.license,
    hasSecurityPolicy: enrichment?.hasSecurityPolicy,
    hasCI: enrichment?.hasCI,
    hasReadme: enrichment?.hasReadme,
    hasDocs: enrichment?.hasDocs,

    ageDays,
    daysSinceLastPush,
    signals: [],
  };

  snapshot.signals = deriveRepositoryHealthSignals(snapshot);
  return snapshot;
}

/**
 * 推导 Core 允许提供的保守状态。
 *
 * 只有 4 种观测，且顺序固定（archived → disabled → no-releases → no-recent-activity）：
 * 顺序稳定可让 UI 与测试依赖它。`no-releases` 只在确认同步过 Release 后给出，
 * 否则「本地没有 Release」只代表尚未拉取。`since` 只在时间型观测上有值。
 */
export function deriveRepositoryHealthSignals(
  snapshot: RepositoryHealthSnapshot,
): RepositoryHealthSignal[] {
  const signals: RepositoryHealthSignal[] = [];

  if (snapshot.archived) {
    signals.push({ id: 'archived', since: null, detail: snapshot.pushedAt });
  }
  if (snapshot.disabled === true) {
    signals.push({ id: 'disabled', since: null, detail: null });
  }
  if (snapshot.releasesFetched && snapshot.releaseCount === 0) {
    signals.push({ id: 'no-releases', since: null, detail: null });
  }
  if (
    snapshot.daysSinceLastPush !== null &&
    snapshot.daysSinceLastPush >= NO_RECENT_ACTIVITY_DAYS
  ) {
    signals.push({
      id: 'no-recent-activity',
      since: toTimestamp(snapshot.pushedAt),
      detail: snapshot.pushedAt,
    });
  }

  return signals;
}

/** 分组顺序固定，UI 与测试依赖它。 */
export const REPOSITORY_HEALTH_GROUP_ORDER: readonly RepositoryHealthGroup[] = [
  'activity',
  'maintenance',
  'community',
  'maturity',
];

/** 每个分组包含的事实 id 与顺序（固定）。 */
const GROUP_FACT_IDS: Record<RepositoryHealthGroup, readonly RepositoryHealthFactId[]> = {
  activity: ['pushedAt', 'latestCommitAt', 'recentCommitCount', 'hasReleases', 'latestReleaseAt'],
  maintenance: [
    'archived',
    'disabled',
    'fork',
    'template',
    'license',
    'hasSecurityPolicy',
    'hasCI',
    'hasReadme',
    'hasDocs',
  ],
  community: ['stars', 'forks', 'openIssues', 'closedIssues', 'contributors'],
  maturity: ['createdAt', 'ageDays', 'releaseCount', 'releasesPerYear', 'latestStableVersion'],
};

/** 每个事实的取值来源，供 UI 标注「需要联网补全」与筛选能力判断。 */
const FACT_SOURCE: Record<RepositoryHealthFactId, RepositoryHealthFact['source']> = {
  pushedAt: 'repository',
  latestCommitAt: 'enrichment',
  recentCommitCount: 'enrichment',
  hasReleases: 'releases',
  latestReleaseAt: 'releases',
  archived: 'repository',
  disabled: 'repository',
  fork: 'repository',
  template: 'repository',
  license: 'repository',
  hasSecurityPolicy: 'enrichment',
  hasCI: 'enrichment',
  hasReadme: 'enrichment',
  hasDocs: 'enrichment',
  stars: 'repository',
  forks: 'repository',
  openIssues: 'repository',
  closedIssues: 'enrichment',
  contributors: 'enrichment',
  createdAt: 'repository',
  ageDays: 'repository',
  releaseCount: 'releases',
  releasesPerYear: 'releases',
  latestStableVersion: 'releases',
};

/** 每个事实的数据类型，供 UI 选择格式化方式。 */
const FACT_KIND: Record<RepositoryHealthFactId, RepositoryHealthFact['kind']> = {
  pushedAt: 'date',
  latestCommitAt: 'date',
  recentCommitCount: 'count',
  hasReleases: 'boolean',
  latestReleaseAt: 'date',
  archived: 'boolean',
  disabled: 'boolean',
  fork: 'boolean',
  template: 'boolean',
  license: 'text',
  hasSecurityPolicy: 'boolean',
  hasCI: 'boolean',
  hasReadme: 'boolean',
  hasDocs: 'boolean',
  stars: 'count',
  forks: 'count',
  openIssues: 'count',
  closedIssues: 'count',
  contributors: 'count',
  createdAt: 'date',
  ageDays: 'duration',
  releaseCount: 'count',
  releasesPerYear: 'count',
  latestStableVersion: 'text',
};

/**
 * 从快照取单个事实的原始值。
 *
 * 注意三态语义：`undefined` = 未知，`null` = 已知且为空（例如无 license / 无稳定版本）。
 */
function readFactValue(
  snapshot: RepositoryHealthSnapshot,
  id: RepositoryHealthFactId,
): RepositoryHealthFact['value'] {
  switch (id) {
    case 'hasReleases':
      // 尚未同步过 Release 时，「没有 Release」并不成立——保持未知。
      if (!snapshot.releasesFetched && !snapshot.hasReleases) return undefined;
      return snapshot.hasReleases;
    case 'license':
      // 空值统一收敛为「无 license」哨兵，避免 UI 把 '' 当成已声明。
      if (snapshot.license === undefined) return undefined;
      return normalizeLicense(snapshot.license) === NO_LICENSE_SENTINEL
        ? null
        : snapshot.license;
    case 'template':
      // 事实 id 用 `template`（GitHub 语义），快照字段用 `isTemplate`（避免与 JS 保留语义混淆）。
      return snapshot.isTemplate;
    default:
      return snapshot[id] as RepositoryHealthFact['value'];
  }
}

/**
 * 把快照展开为 UI 分组视图（Activity / Maintenance / Community / Maturity）。
 * 不做任何格式化——标签、日期与数字格式由 UI 层决定（i18n 重构后归口语言包）。
 */
export function groupRepositoryHealthFacts(
  snapshot: RepositoryHealthSnapshot,
): RepositoryHealthGroupView[] {
  return REPOSITORY_HEALTH_GROUP_ORDER.map((group) => ({
    group,
    facts: GROUP_FACT_IDS[group].map((id) => ({
      id,
      group,
      kind: FACT_KIND[id],
      value: readFactValue(snapshot, id),
      source: FACT_SOURCE[id],
    })),
  }));
}

/**
 * 判断仓库是否已归档，三态返回。
 *
 * 字段缺失时返回 `undefined`（未知），调用方必须用严格相等比较，
 * 这样 `healthArchived: true` 与 `healthArchived: false` 都不会命中未知的仓库——
 * 否则「筛出未归档」会把本地根本没有该字段的仓库一并当成未归档列出。
 */
export function isArchivedRepository(
  repository: Pick<Repository, 'archived'>,
): boolean | undefined {
  return typeof repository.archived === 'boolean' ? repository.archived : undefined;
}

/**
 * 判断仓库最近是否有 push 活动。
 * `now` 可注入以便测试；时间不可解析时返回 false（筛选语义：未知不算「近期活跃」）。
 */
export function hasRecentActivity(
  repository: Pick<Repository, 'pushed_at' | 'updated_at'>,
  now: number = Date.now(),
): boolean {
  const pushed = toTimestamp(repository.pushed_at) ?? toTimestamp(repository.updated_at);
  if (pushed === null) return false;
  return now - pushed < NO_RECENT_ACTIVITY_DAYS * MS_PER_DAY;
}

/** 判断仓库是否声明了可识别的 license（复用既有归一化，保证与 license 过滤器一致）。 */
export function hasDeclaredLicense(repository: Pick<Repository, 'license'>): boolean {
  return normalizeLicense(repository.license) !== NO_LICENSE_SENTINEL;
}
