/**
 * Repository Health facts (Electron / CommonJS build).
 *
 * 与 `src/utils/repositoryHealth.ts` 保持同一套算法：Core 的客观事实必须跨运行时一致，
 * 否则 UI、MCP 与插件会给出互相矛盾的数字。
 *
 * 为什么是重复实现而不是共享模块：Electron 侧是 CommonJS（electron/package.json 无
 * `"type": "module"`），而仓库根是 ESM，且 electron-builder 只打包 `dist/`、`electron/`
 * 与 `node_modules/`，因此无法 import `src/` 树。这与既有 `mcpDiscovery.js` /
 * `server/src/mcp/repoSearch.ts` 的三份镜像实现是同一约束；改这里时请同步
 * `server/src/mcp/repoHealth.ts` 与 `src/utils/repositoryHealth.ts`。
 *
 * 边界与 TS 版一致：只输出客观事实与保守观测，不输出健康总分或「健康 / 不健康」结论。
 */

const MS_PER_DAY = 86400000;
const DAYS_PER_YEAR = 365.25;
/** 与 TS 版一致：超过一年无 push 只作为中性观测「No pushes in 12 months」。 */
const NO_RECENT_ACTIVITY_DAYS = 365;
const MIN_FREQUENCY_WINDOW_DAYS = 30;
const PRERELEASE_TOKENS = new Set([
  'alpha', 'beta', 'rc', 'pre', 'prerelease', 'preview', 'dev', 'devel',
  'next', 'canary', 'snapshot', 'nightly', 'insider', 'unstable',
]);

function toTimestamp(value) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function toCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

/** 布尔事实的三态化：只有记录里确实存在布尔值时才给出 true/false，否则为 null（未知）。 */
function toTriState(value) {
  return typeof value === 'boolean' ? value : null;
}

/** 预发布判定：先信任 GitHub 标记，再按 tag 词元兜底（避免 `presto` 里的 `pre` 误判）。 */
function isPrereleaseRelease(release) {
  if (release?.prerelease === true) return true;
  const tag = String(release?.tag_name ?? '').toLowerCase();
  if (!tag) return false;
  return tag
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .some((token) => PRERELEASE_TOKENS.has(token.replace(/\d+$/, '')));
}

/** 取某仓库的 Release，按发布时间降序（不可解析的条目丢弃）。 */
function releasesForRepository(releases, repositoryId) {
  return (Array.isArray(releases) ? releases : [])
    .filter((release) => Number(release?.repository?.id ?? release?.repo_id) === Number(repositoryId))
    .filter((release) => toTimestamp(release.published_at) !== null)
    .slice()
    .sort((left, right) => toTimestamp(right.published_at) - toTimestamp(left.published_at));
}

/**
 * 推导仓库健康事实（snake_case，便于直接作为 MCP JSON 证据输出）。
 *
 * @param {object} repo 已存储的仓库记录。
 * @param {Array} [releases] 该仓库的 Release；不传表示调用方没有这项数据，Release 相关事实为 null。
 * @param {number} [now] 计算「距今多久」的基准时间，便于测试注入。
 */
function deriveRepositoryHealthFacts(repo, releases, now = Date.now()) {
  const provided = Array.isArray(releases);
  const own = provided ? releasesForRepository(releases, repo?.id) : [];
  const latest = own[0] ?? null;
  const latestStable = own.find((release) => !isPrereleaseRelease(release)) ?? null;
  const latestPrerelease = own.find((release) => isPrereleaseRelease(release)) ?? null;

  const createdTimestamp = toTimestamp(repo?.created_at);
  const pushedTimestamp = toTimestamp(repo?.pushed_at || repo?.updated_at);
  const ageDays = createdTimestamp === null
    ? null
    : Math.max(0, Math.floor((now - createdTimestamp) / MS_PER_DAY));
  const daysSinceLastPush = pushedTimestamp === null
    ? null
    : Math.max(0, Math.floor((now - pushedTimestamp) / MS_PER_DAY));
  // 仓库年龄未知时无法换算「频率」：只有「确实没有任何 Release」才是 0，其余保持 null，
  // 否则会把「Release 总数」当成「次/年」报出去（与 TS 版必须一致）。
  const releasesPerYear = ageDays === null
    ? (provided && own.length === 0 ? 0 : null)
    : round1(own.length / (Math.max(ageDays, MIN_FREQUENCY_WINDOW_DAYS) / DAYS_PER_YEAR));

  const facts = {
    // GitHub 原生状态字段：三态。`null` = 该记录里根本没有这个事实（例如后端未存储），
    // 不能当成 false —— 把「未知」说成「未归档」是伪造事实。
    archived: toTriState(repo?.archived),
    disabled: toTriState(repo?.disabled),
    fork: toTriState(repo?.fork),
    is_template: toTriState(repo?.is_template),

    created_at: repo?.created_at ?? null,
    pushed_at: repo?.pushed_at ?? null,
    age_days: ageDays,
    days_since_last_push: daysSinceLastPush,

    // Release 事实在未提供 releases 时为 null（未知），而不是 0（已知没有）。
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
  };

  return { ...facts, signals: deriveRepositoryHealthSignals(facts) };
}

/** Core 允许提供的保守观测，顺序固定（archived → disabled → no-releases → no-recent-activity）。 */
function deriveRepositoryHealthSignals(facts) {
  const signals = [];
  if (facts.archived) signals.push('archived');
  if (facts.disabled) signals.push('disabled');
  if (facts.releases_fetched && facts.release_count === 0) signals.push('no-releases');
  if (facts.days_since_last_push !== null && facts.days_since_last_push >= NO_RECENT_ACTIVITY_DAYS) {
    signals.push('no-recent-activity');
  }
  return signals;
}

/**
 * 判断仓库是否已归档，三态返回（与 TS 版一致）。
 * 字段缺失时返回 undefined，调用方的严格相等比较因此不会把「未知」算成未归档。
 */
function isArchivedRepository(repo) {
  return typeof repo?.archived === 'boolean' ? repo.archived : undefined;
}

/** 与 TS 版一致：时间不可解析时返回 false（筛选语义下「未知」不算「近期活跃」）。 */
function hasRecentActivity(repo, now = Date.now()) {
  const pushed = toTimestamp(repo?.pushed_at) ?? toTimestamp(repo?.updated_at);
  if (pushed === null) return false;
  return now - pushed < NO_RECENT_ACTIVITY_DAYS * MS_PER_DAY;
}

module.exports = {
  NO_RECENT_ACTIVITY_DAYS,
  deriveRepositoryHealthFacts,
  deriveRepositoryHealthSignals,
  hasRecentActivity,
  isArchivedRepository,
  isPrereleaseRelease,
  releasesForRepository,
};
