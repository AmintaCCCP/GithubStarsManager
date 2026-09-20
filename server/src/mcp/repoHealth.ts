/**
 * Repository Health facts（后端 MCP 运行时）。
 *
 * 与 `electron/repoHealth.js`、`src/utils/repositoryHealth.ts` 是同一套算法的三份镜像：
 * Core 的客观事实必须跨运行时一致，否则 UI、MCP 与插件会给出互相矛盾的数字。
 * 之所以必须镜像而不是共享模块：server 的 tsconfig `rootDir: "src"` 不允许 import 应用源码树，
 * Electron 侧则是 CommonJS。改动本文件时请同步另外两份。
 *
 * 边界一致：只输出客观事实与保守观测，不输出健康总分或「健康 / 不健康」结论。
 */

const MS_PER_DAY = 86_400_000;
const DAYS_PER_YEAR = 365.25;
/** 与 TS 版一致：超过一年无 push 只作为中性观测「No pushes in 12 months」。 */
export const NO_RECENT_ACTIVITY_DAYS = 365;
const MIN_FREQUENCY_WINDOW_DAYS = 30;
const PRERELEASE_TOKENS = new Set([
  'alpha', 'beta', 'rc', 'pre', 'prerelease', 'preview', 'dev', 'devel',
  'next', 'canary', 'snapshot', 'nightly', 'insider', 'unstable',
]);

/** 供健康事实推导使用的最小仓库形状（后端不存储 GitHub 原生状态字段）。 */
export interface HealthRepositoryInput {
  id: number;
  created_at?: string | null;
  updated_at?: string | null;
  pushed_at?: string | null;
  stargazers_count?: number | null;
  forks_count?: number | null;
  forks?: number | null;
  license?: string | null;
  has_fetched_releases?: boolean;
  archived?: boolean;
  disabled?: boolean;
  fork?: boolean;
  is_template?: boolean;
  open_issues_count?: number;
  default_branch?: string;
}

/** 健康事实推导所需的最小 Release 形状。 */
export interface HealthReleaseInput {
  repo_id?: number;
  repository?: { id?: number } | null;
  tag_name?: string | null;
  published_at?: string | null;
  prerelease?: boolean;
}

export interface RepositoryHealthFacts {
  archived: boolean | null;
  disabled: boolean | null;
  fork: boolean | null;
  is_template: boolean | null;
  created_at: string | null;
  pushed_at: string | null;
  age_days: number | null;
  days_since_last_push: number | null;
  release_count: number | null;
  has_releases: boolean | null;
  releases_fetched: boolean;
  latest_release_at: string | null;
  latest_stable_version: string | null;
  latest_prerelease_version: string | null;
  releases_per_year: number | null;
  stars: number;
  forks: number;
  open_issues_count: number | null;
  default_branch: string | null;
  license: string | null;
  signals: string[];
}

function toTimestamp(value?: string | null): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function toCount(value: unknown): number {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** 布尔事实的三态化：只有记录里确实存在布尔值时才给出 true/false，否则为 null（未知）。 */
function toTriState(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

/** 预发布判定：先信任 GitHub 标记，再按 tag 词元兜底（避免 `presto` 里的 `pre` 误判）。 */
export function isPrereleaseRelease(release: Pick<HealthReleaseInput, 'prerelease' | 'tag_name'>): boolean {
  if (release?.prerelease === true) return true;
  const tag = String(release?.tag_name ?? '').toLowerCase();
  if (!tag) return false;
  return tag
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .some((token) => PRERELEASE_TOKENS.has(token.replace(/\d+$/, '')));
}

/** 取某仓库的 Release，按发布时间降序（不可解析的条目丢弃）。 */
export function releasesForRepository(
  releases: readonly HealthReleaseInput[] | undefined,
  repositoryId: number,
): HealthReleaseInput[] {
  return (Array.isArray(releases) ? releases : [])
    .filter((release) => Number(release?.repository?.id ?? release?.repo_id) === Number(repositoryId))
    .filter((release) => toTimestamp(release.published_at) !== null)
    .slice()
    .sort((left, right) => (toTimestamp(right.published_at) as number) - (toTimestamp(left.published_at) as number));
}

/**
 * 推导仓库健康事实。
 *
 * @param repo 已存储的仓库记录。
 * @param releases 该仓库的 Release；不传表示调用方没有这项数据，Release 相关事实为 null。
 * @param now 计算「距今多久」的基准时间，便于测试注入。
 */
export function deriveRepositoryHealthFacts(
  repo: HealthRepositoryInput,
  releases?: readonly HealthReleaseInput[],
  now: number = Date.now(),
): RepositoryHealthFacts {
  const provided = Array.isArray(releases);
  const own = provided ? releasesForRepository(releases, repo?.id) : [];
  const latest = own[0] ?? null;
  const latestStable = own.find((release) => !isPrereleaseRelease(release)) ?? null;
  const latestPrerelease = own.find((release) => isPrereleaseRelease(release)) ?? null;

  const createdTimestamp = toTimestamp(repo?.created_at);
  const pushedTimestamp = toTimestamp(repo?.pushed_at || repo?.updated_at);
  const ageDays =
    createdTimestamp === null ? null : Math.max(0, Math.floor((now - createdTimestamp) / MS_PER_DAY));
  const daysSinceLastPush =
    pushedTimestamp === null ? null : Math.max(0, Math.floor((now - pushedTimestamp) / MS_PER_DAY));
  // 仓库年龄未知时无法换算「频率」：只有「确实没有任何 Release」才是 0，其余保持 null，
  // 否则会把「Release 总数」当成「次/年」报出去（与 Electron / TS 版必须一致）。
  const releasesPerYear =
    ageDays === null
      ? provided && own.length === 0
        ? 0
        : null
      : round1(own.length / (Math.max(ageDays, MIN_FREQUENCY_WINDOW_DAYS) / DAYS_PER_YEAR));

  const facts: RepositoryHealthFacts = {
    archived: toTriState(repo?.archived),
    disabled: toTriState(repo?.disabled),
    fork: toTriState(repo?.fork),
    is_template: toTriState(repo?.is_template),

    created_at: repo?.created_at ?? null,
    pushed_at: repo?.pushed_at ?? null,
    age_days: ageDays,
    days_since_last_push: daysSinceLastPush,

    release_count: provided ? own.length : null,
    has_releases: provided ? own.length > 0 : null,
    releases_fetched: provided && repo?.has_fetched_releases === true,
    latest_release_at: latest?.published_at ?? null,
    latest_stable_version: latestStable?.tag_name ?? null,
    latest_prerelease_version: latestPrerelease?.tag_name ?? null,
    releases_per_year: releasesPerYear,

    stars: toCount(repo?.stargazers_count),
    forks: repo?.forks_count !== undefined ? toCount(repo.forks_count) : toCount(repo?.forks),
    open_issues_count: repo?.open_issues_count === undefined ? null : toCount(repo.open_issues_count),
    default_branch: repo?.default_branch ?? null,
    license: repo?.license ?? null,
    signals: [],
  };

  facts.signals = deriveRepositoryHealthSignals(facts);
  return facts;
}

/** Core 允许提供的保守观测，顺序固定（archived → disabled → no-releases → no-recent-activity）。 */
export function deriveRepositoryHealthSignals(facts: RepositoryHealthFacts): string[] {
  const signals: string[] = [];
  if (facts.archived === true) signals.push('archived');
  if (facts.disabled === true) signals.push('disabled');
  if (facts.releases_fetched && facts.release_count === 0) signals.push('no-releases');
  if (facts.days_since_last_push !== null && facts.days_since_last_push >= NO_RECENT_ACTIVITY_DAYS) {
    signals.push('no-recent-activity');
  }
  return signals;
}

/**
 * 判断仓库是否已归档，三态返回（与 Electron / TS 版一致）。
 * 字段缺失时返回 undefined，调用方的严格相等比较因此不会把「未知」算成未归档。
 */
export function isArchivedRepository(
  repo: Pick<HealthRepositoryInput, 'archived'>,
): boolean | undefined {
  return typeof repo?.archived === 'boolean' ? repo.archived : undefined;
}

/** 与 TS 版一致：时间不可解析时返回 false（筛选语义下「未知」不算「近期活跃」）。 */
export function hasRecentActivity(
  repo: Pick<HealthRepositoryInput, 'pushed_at' | 'updated_at'>,
  now: number = Date.now(),
): boolean {
  const pushed = toTimestamp(repo?.pushed_at) ?? toTimestamp(repo?.updated_at);
  if (pushed === null) return false;
  return now - pushed < NO_RECENT_ACTIVITY_DAYS * MS_PER_DAY;
}
