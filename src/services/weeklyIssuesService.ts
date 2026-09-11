/**
 * 阮一峰周刊频道数据服务（按需分页抓取）。
 *
 * 数据管道：分页拉取 ruanyf/weekly 的 issues → 标题含"开源"过滤 → 正文提取
 * GitHub 仓库链接 → 按 full_name 去重（原贴取最新投稿）→ 仓库详情补全
 * （GraphQL 批量优先，REST 逐仓回退）→ 独立 IndexedDB 持久化 → 客户端按
 * 投稿时间倒序 + "周刊收录"过滤 + 分页切片。
 *
 * 分页语义（不一次性取全量）：
 * - 刷新遍历（page 1 / 手动刷新）：`state=all&sort=updated&since=上次同步-7天`，
 *   label 变更会 bump updated_at，单遍即覆盖"新投稿 + 编辑 + 发布几天后才补加
 *   的收录 label"；服务端已按窗口过滤，走到底（不足一页/空页）即窗口覆盖完。
 *   首次运行（无同步水位）不带 since、只取 1 页，秒级出数据。
 * - 深度遍历（缓存卡片不够当前分页时）：不带 since，从持久化游标
 *   deepNextPage-1（1 页重叠防删除位移）继续，每页落盘并推进游标，凑够目标
 *   卡片数或遇到不足一页/空页（→ historyComplete，历史取尽）或单次页数上限。
 * - 重复扫描由 updatedAt 快速跳过；每页增量落盘，中途取消不丢已处理条目。
 *
 * 不用 search/issues API 的原因：结果有 1000 条硬上限且独立限速 30 次/分；
 * list 端点走核心 API（5000 次/小时）。详情补全用 GraphQL alias 批量
 * （100 仓库/请求），失败自动回退 REST 逐仓。
 */

import type {
  DiscoveryChannelId,
  DiscoveryRepo,
  PaginatedDiscoveryRepositories,
  WeeklyIssueRef,
  WeeklySyncStatus,
} from '../types';
import { logger } from './logger';
import type { GitHubApiService, GitHubIssueListRead, GitHubRepoDetailRead } from './githubApi';
import {
  weeklyIssuesStorage,
  type WeeklyStoredIssue,
  type WeeklyStoredRepo,
  type WeeklySyncMeta,
} from './weeklyIssuesStorage';

export const WEEKLY_REPO_OWNER = 'ruanyf';
export const WEEKLY_REPO_NAME = 'weekly';
const WEEKLY_CHANNEL: DiscoveryChannelId = 'weekly';
/** issue 标题关键字（【开源自荐】/【开源项目】等投稿标题均含此词） */
export const WEEKLY_TITLE_KEYWORD = '开源';
/** 周刊收录 label（收录进周刊的投稿会带上） */
export const WEEKLY_COLLECTED_LABEL = 'weekly';
/** GitHub 站点级路径（github.com/<这些>/... 不是仓库链接） */
const NON_REPO_OWNER_PATHS = new Set([
  'features', 'topics', 'collections', 'sponsors', 'marketplace', 'settings', 'orgs',
  'enterprises', 'account', 'notifications', 'explore', 'trending', 'about', 'pricing',
  'security', 'contact', 'site', 'resources', 'events', 'customer-stories', 'readme',
  'user-attachments', 'github-assets', 'apps', 'codespaces', 'copilot', 'login', 'signup',
  'new', 'import', 'organizations', 'users', 'blog', 'docs', 'support', 'status', 'team',
]);
const ISSUE_PAGE_SIZE = 100;
const CARD_PAGE_SIZE = 50;
/** label 宽限窗口：每次增量多回看 7 天，覆盖"发布几天后才补加收录 label" */
const LABEL_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
/** 仓库详情的刷新周期：30 天内的快照视为新鲜 */
const REPO_DETAIL_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** 不可用仓库（404/私有）的重试周期 */
const UNAVAILABLE_RETRY_MS = 7 * 24 * 60 * 60 * 1000;
/** 每轮刷新遍历做详情维护（过期快照/不可用重试）的仓库上限 */
const MAINTENANCE_CAP = 30;
/** 深度遍历单次（一次"加载更多"）最多拉取的 issue 页数 */
const DEEP_WALK_MAX_PAGES = 10;
/** 刷新遍历单次最多页数（since 窗口异常扩大时的保险丝） */
const REFRESH_WALK_MAX_PAGES = 20;
/** 60 秒内同步过则跳过刷新遍历（过滤器切换等签名变化触发的重刷走缓存） */
const RECENT_SYNC_SKIP_MS = 60 * 1000;
const ISSUE_LIST_THROTTLE_MS = 100;
const REST_ENRICH_THROTTLE_MS = 80;

type StatusCallback = ((status: WeeklySyncStatus | null) => void) | undefined;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const isAbortError = (error: unknown): boolean =>
  (error instanceof Error && (error.name === 'AbortError' || error.message === 'Aborted')) ||
  (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError');

const isRateLimitError = (error: unknown): boolean =>
  error instanceof Error && error.message.startsWith('GitHub API rate limit exceeded');

const isTokenInvalidError = (error: unknown): boolean =>
  error instanceof Error && error.message.includes('token expired or invalid');

/**
 * 从 issue 正文提取 GitHub 仓库 full_name。
 * 只认完整 https 链接，剥离子路径（/tree/、/blob/ 等）；排除附件图片、
 * 站点级路径和周刊仓库自身；没有可提取链接时返回空数组（调用方舍弃该条目）。
 */
export function extractRepoFullNames(body: string | null | undefined): string[] {
  if (!body) return [];
  const result = new Set<string>();
  const pattern = /https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) {
    const owner = match[1];
    let name = match[2];
    if (!owner || !name) continue;
    const ownerLower = owner.toLowerCase();
    if (NON_REPO_OWNER_PATHS.has(ownerLower)) continue;
    if (ownerLower === WEEKLY_REPO_OWNER && name.toLowerCase() === WEEKLY_REPO_NAME) continue;
    // GitHub 仓库名不能以句点结尾（`bar.` 是正文标点被 [\w.-] 吞进来了）；
    // 末尾连字符是合法仓库名，保留
    name = name.replace(/\.+$/, '');
    if (!name) continue;
    if (name.toLowerCase().endsWith('.git')) name = name.slice(0, -4);
    result.add(`${owner}/${name}`);
  }
  return [...result];
}

export const hasCollectedLabel = (labels: string[]): boolean =>
  labels.some((label) => label.toLowerCase() === WEEKLY_COLLECTED_LABEL);

/**
 * 处理单条 issue：命中（标题含"开源"且正文提取到仓库链接）则 upsert 到
 * issues/repos 映射，并登记到 changed 集合。updatedAt 未变化的已知 issue 走快速跳过。
 * 返回是否命中投稿条目。
 */
export function processWeeklyIssue(
  issue: GitHubIssueListRead,
  issues: Map<number, WeeklyStoredIssue>,
  repos: Map<string, WeeklyStoredRepo>,
  changedIssueNumbers: Set<number>,
  changedRepoKeys: Set<string>,
): boolean {
  const existing = issues.get(issue.number);
  if (existing && existing.updatedAt === issue.updated_at) return Boolean(existing.repoFullNames.length);
  if (issue.isPullRequest || !issue.title.includes(WEEKLY_TITLE_KEYWORD)) return false;
  const fullNames = extractRepoFullNames(issue.body);
  if (fullNames.length === 0) return false;

  issues.set(issue.number, {
    number: issue.number,
    title: issue.title,
    body: issue.body,
    labels: issue.labels,
    state: issue.state,
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    htmlUrl: issue.html_url,
    repoFullNames: fullNames.map((fullName) => fullName.toLowerCase()),
  });
  changedIssueNumbers.add(issue.number);

  for (const fullName of fullNames) {
    const key = fullName.toLowerCase();
    const repo = repos.get(key);
    if (!repo) {
      repos.set(key, {
        fullName,
        detail: null,
        lastFetchedAt: '',
        sourceIssueNumber: issue.number,
        issueLabels: issue.labels,
        issueCreatedAt: issue.created_at,
      });
    } else if (issue.created_at > repo.issueCreatedAt) {
      // 同仓库多期投稿：原贴指向投稿时间最新的 issue
      repo.sourceIssueNumber = issue.number;
      repo.issueLabels = issue.labels;
      repo.issueCreatedAt = issue.created_at;
    } else if (repo.sourceIssueNumber === issue.number) {
      // 原贴 label 更新（weekly label 可能发布几天后才补加）
      repo.issueLabels = issue.labels;
    }
    changedRepoKeys.add(key);
  }
  return true;
}

const bySubmissionDesc = (a: WeeklyStoredRepo, b: WeeklyStoredRepo) =>
  b.issueCreatedAt.localeCompare(a.issueCreatedAt);

/** 本轮遍历新触达、且尚未补全详情的仓库（不设上限，遍历自身的新增必须补全）。 */
export function pendingReposFromKeys(
  repos: Map<string, WeeklyStoredRepo>,
  keys: Set<string>,
): WeeklyStoredRepo[] {
  const pending: WeeklyStoredRepo[] = [];
  for (const key of keys) {
    const repo = repos.get(key);
    if (repo && !repo.lastFetchedAt) pending.push(repo);
  }
  return pending.sort(bySubmissionDesc);
}

/**
 * 刷新遍历附带的详情维护（各自限额，控制单次 API 预算）：
 * 30 天未刷新的过期快照、到期重试的不可用仓库，以及游离的未补全仓库
 * （此前同步被中止遗留、不在本轮 changed 集合内的）。
 */
export function refreshMaintenanceRepos(
  repos: Map<string, WeeklyStoredRepo>,
  changedKeys: Set<string>,
  nowMs: number,
): WeeklyStoredRepo[] {
  const stale: WeeklyStoredRepo[] = [];
  const unavailableRetry: WeeklyStoredRepo[] = [];
  const stragglers: WeeklyStoredRepo[] = [];
  for (const repo of repos.values()) {
    if (!repo.lastFetchedAt) {
      if (!changedKeys.has(repo.fullName.toLowerCase())) stragglers.push(repo);
    } else if (repo.detail) {
      if (nowMs - Date.parse(repo.lastFetchedAt) > REPO_DETAIL_TTL_MS) stale.push(repo);
    } else if (nowMs - Date.parse(repo.lastFetchedAt) > UNAVAILABLE_RETRY_MS) {
      unavailableRetry.push(repo);
    }
  }
  return [
    ...stale.sort(bySubmissionDesc).slice(0, MAINTENANCE_CAP),
    ...unavailableRetry.sort(bySubmissionDesc).slice(0, MAINTENANCE_CAP),
    ...stragglers.sort(bySubmissionDesc).slice(0, MAINTENANCE_CAP),
  ];
}

/** 把补全结果写回仓库映射（null = 不可用，标记时间供到期重试）。 */
function applyEnrichmentResults(
  details: Map<string, GitHubRepoDetailRead | null>,
  repos: Map<string, WeeklyStoredRepo>,
  changedRepoKeys: Set<string>,
  fetchedAtIso: string,
): void {
  for (const [key, detail] of details) {
    const repo = repos.get(key);
    if (!repo) continue;
    repo.lastFetchedAt = fetchedAtIso;
    if (detail) repo.detail = detail;
    changedRepoKeys.add(key);
  }
}

/** REST 逐仓补全回退路径（GraphQL 不可用时），限流/鉴权错误直接上抛中止本轮。 */
async function enrichReposViaRest(
  api: GitHubApiService,
  targets: WeeklyStoredRepo[],
  changedRepoKeys: Set<string>,
  onStatus: StatusCallback,
  signal?: AbortSignal,
): Promise<void> {
  for (let i = 0; i < targets.length; i++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const repo = targets[i];
    const key = repo.fullName.toLowerCase();
    const [owner, name] = key.split('/');
    try {
      const detail = await api.getRepositoryDetails(owner, name, signal);
      repo.detail = detail;
      repo.lastFetchedAt = new Date().toISOString();
    } catch (error) {
      if (isAbortError(error) || isRateLimitError(error) || isTokenInvalidError(error)) throw error;
      // 404/410/其他 4xx：标记不可用，到期重试（makeRequest 已做过网络/5xx 重试）
      logger.warn('weeklyIssues', `Repo details unavailable: ${repo.fullName}`, error);
      repo.lastFetchedAt = new Date().toISOString();
    }
    changedRepoKeys.add(key);
    onStatus?.({ phase: 'enriching', current: i + 1, total: targets.length });
    await sleep(REST_ENRICH_THROTTLE_MS);
  }
}

/** GraphQL 批量补全；部分批次失败时仅对未成功的仓库回退 REST。 */
async function enrichRepos(
  api: GitHubApiService,
  targets: WeeklyStoredRepo[],
  repos: Map<string, WeeklyStoredRepo>,
  changedRepoKeys: Set<string>,
  onStatus: StatusCallback,
  signal?: AbortSignal,
): Promise<void> {
  if (targets.length === 0) return;
  const total = targets.length;
  onStatus?.({ phase: 'enriching', current: 0, total });
  const fullNames = targets.map((repo) => repo.fullName);
  const batchSize = 100;
  const appliedKeys = new Set<string>();
  try {
    const details = await api.graphqlFetchRepositories(fullNames, {
      signal,
      batchSize,
      onBatchDone: (doneBatches) => {
        const done = Math.min(total, doneBatches * batchSize);
        onStatus?.({ phase: 'enriching', current: done, total });
      },
    });
    for (const [key, detail] of details) {
      if (detail !== undefined) appliedKeys.add(key);
    }
    applyEnrichmentResults(details, repos, changedRepoKeys, new Date().toISOString());
  } catch (error) {
    if (isAbortError(error) || isRateLimitError(error) || isTokenInvalidError(error)) throw error;
    logger.warn('weeklyIssues', 'GraphQL batch enrichment failed, falling back to REST', error);
  }
  const restTargets = targets.filter((repo) => !appliedKeys.has(repo.fullName.toLowerCase()));
  if (restTargets.length > 0) {
    await enrichReposViaRest(api, restTargets, changedRepoKeys, onStatus, signal);
  }
}

/** 遍历共享的可变状态：issue/repo 内存映射、变更集合与增量落盘水位。 */
interface WalkContext {
  api: GitHubApiService;
  signal: AbortSignal | undefined;
  onStatus: StatusCallback;
  issues: Map<number, WeeklyStoredIssue>;
  repos: Map<string, WeeklyStoredRepo>;
  changedIssueNumbers: Set<number>;
  changedRepoKeys: Set<string>;
  meta: WeeklySyncMeta;
  savedIssues: number;
  savedRepos: number;
}

interface WalkOptions {
  /** 仅拉取 updated_at >= since 的 issue（刷新遍历）；深度遍历不传 */
  since?: string;
  startPage: number;
  maxPages: number;
  /** 是否推进深度分页游标（仅无 since 的全序遍历） */
  advanceCursor: boolean;
  /** 每页处理完后的停止条件（深度遍历：凑够目标卡片数即停） */
  stopWhen?: () => boolean;
}

interface WalkResult {
  pagesFetched: number;
  scanned: number;
  matched: number;
  /** 历史取尽：仅无 since 的遍历在遇到不足一页/空页时为 true */
  hitEnd: boolean;
}

/**
 * 原子落盘本页增量 + 游标：issues、repos、meta（deepNextPage/historyComplete）
 * 走同一事务。事务失败时抛出且不推进内存水位/游标——下轮同步重新拉取该页，
 * 避免"游标已推进但数据未落盘"的永久缺口。
 */
async function flushWalkPage(
  ctx: WalkContext,
  page: number,
  opts: { advanceCursor: boolean; markComplete: boolean },
): Promise<void> {
  const newIssues = [...ctx.changedIssueNumbers].slice(ctx.savedIssues)
    .map((number) => ctx.issues.get(number)!).filter(Boolean);
  const newRepos = [...ctx.changedRepoKeys].slice(ctx.savedRepos)
    .map((key) => ctx.repos.get(key)!).filter(Boolean);
  const nextMeta: WeeklySyncMeta = { ...ctx.meta };
  let metaChanged = false;
  if (opts.advanceCursor) {
    nextMeta.deepNextPage = page + 1;
    metaChanged = true;
  }
  if (opts.markComplete && !nextMeta.historyComplete) {
    nextMeta.historyComplete = true;
    metaChanged = true;
  }
  if (newIssues.length === 0 && newRepos.length === 0 && !metaChanged) return;
  await weeklyIssuesStorage.saveWalkPage({ issues: newIssues, repos: newRepos, meta: nextMeta });
  ctx.savedIssues = ctx.changedIssueNumbers.size;
  ctx.savedRepos = ctx.changedRepoKeys.size;
  ctx.meta = nextMeta;
}

/**
 * 按 updated 倒序遍历 issue 页：逐页处理、原子落盘、推进游标。
 * 停止条件：页数上限 / 不足一页或空页（无 since 时即历史取尽，随本页原子
 * 标记 historyComplete）/ 深度遍历凑够目标卡片数。
 */
async function walkIssuePages(ctx: WalkContext, opts: WalkOptions): Promise<WalkResult> {
  let page = opts.startPage;
  let scanned = 0;
  let matched = 0;
  let pagesFetched = 0;
  let hitEnd = false;
  while (pagesFetched < opts.maxPages) {
    const items = await ctx.api.listRepositoryIssues(WEEKLY_REPO_OWNER, WEEKLY_REPO_NAME, {
      state: 'all',
      sort: 'updated',
      direction: 'desc',
      since: opts.since,
      perPage: ISSUE_PAGE_SIZE,
      page,
      signal: ctx.signal,
    });
    pagesFetched++;
    const isShort = items.length < ISSUE_PAGE_SIZE;
    const markComplete = isShort && !opts.since;
    if (items.length > 0) {
      for (const issue of items) {
        if (processWeeklyIssue(issue, ctx.issues, ctx.repos, ctx.changedIssueNumbers, ctx.changedRepoKeys)) matched++;
      }
      scanned += items.length;
      ctx.onStatus?.({ phase: 'syncing', current: scanned, total: 0 });
    }
    await flushWalkPage(ctx, page, { advanceCursor: opts.advanceCursor, markComplete });
    if (isShort) {
      hitEnd = markComplete;
      break;
    }
    if (opts.stopWhen?.()) break;
    page++;
    await sleep(ISSUE_LIST_THROTTLE_MS);
  }
  return { pagesFetched, scanned, matched, hitEnd };
}

/** 由存储的仓库/issue 数据构建发现频道卡片（未补全详情的条目暂不展示）。 */
export function buildWeeklyDiscoveryRepos(
  repos: Map<string, WeeklyStoredRepo>,
  issues: Map<number, WeeklyStoredIssue>,
  onlyCollected: boolean,
): DiscoveryRepo[] {
  const list: DiscoveryRepo[] = [];
  for (const repo of repos.values()) {
    if (!repo.detail) continue;
    if (onlyCollected && !hasCollectedLabel(repo.issueLabels)) continue;
    const issue = issues.get(repo.sourceIssueNumber);
    const weeklyIssue: WeeklyIssueRef = {
      number: repo.sourceIssueNumber,
      title: issue?.title ?? '',
      html_url: issue?.htmlUrl || `https://github.com/${WEEKLY_REPO_OWNER}/${WEEKLY_REPO_NAME}/issues/${repo.sourceIssueNumber}`,
      labels: repo.issueLabels,
      createdAt: repo.issueCreatedAt,
    };
    list.push({
      ...repo.detail,
      rank: 0,
      channel: WEEKLY_CHANNEL,
      platform: 'All',
      weeklyIssue,
    });
  }
  list.sort((a, b) => (b.weeklyIssue?.createdAt ?? '').localeCompare(a.weeklyIssue?.createdAt ?? ''));
  list.forEach((repo, index) => { repo.rank = index + 1; });
  return list;
}

/** 当前可展示的卡片数（含过滤语义，仅统计已补全详情的），用于外层判断是否需要深度遍历。 */
const countCards = (repos: Map<string, WeeklyStoredRepo>, onlyCollected: boolean): number => {
  let count = 0;
  for (const repo of repos.values()) {
    if (repo.detail && (!onlyCollected || hasCollectedLabel(repo.issueLabels))) count++;
  }
  return count;
};

/**
 * 遍历完成后预期可展示的卡片数：待补全（!lastFetchedAt）的仓库紧随其后会被
 * 补全，也计入；不可用（已标记且无详情）的永不出卡，排除。供深度遍历的
 * 停止条件使用——补全发生在遍历结束之后，不能只数已补全的。
 */
const countProspectiveCards = (repos: Map<string, WeeklyStoredRepo>, onlyCollected: boolean): number => {
  let count = 0;
  for (const repo of repos.values()) {
    if (repo.lastFetchedAt && !repo.detail) continue;
    if (onlyCollected && !hasCollectedLabel(repo.issueLabels)) continue;
    count++;
  }
  return count;
};

const isRecentlySynced = (lastSyncedAt: string | null): boolean =>
  lastSyncedAt !== null
  && Number.isFinite(Date.parse(lastSyncedAt))
  && Date.now() - Date.parse(lastSyncedAt) < RECENT_SYNC_SKIP_MS;

let syncAbortController: AbortController | null = null;
let syncInFlight: Promise<void> | null = null;

/** 互斥执行：新请求中止上一轮并等待其落盘结算后再开新一轮。 */
async function runExclusiveSync(
  body: (signal: AbortSignal) => Promise<void>,
  onStatus: StatusCallback,
): Promise<void> {
  syncAbortController?.abort();
  // 等待被中止轮次完成落盘，避免旧快照覆盖新一轮刚写入的结果
  if (syncInFlight) await syncInFlight.catch(() => {});
  const controller = new AbortController();
  syncAbortController = controller;
  const run = body(controller.signal);
  syncInFlight = run.then(() => {}, () => {});
  try {
    await run;
  } finally {
    // 仅在仍持有同步权时清空状态，避免被中止的旧轮次清掉新一轮的进度显示
    if (syncAbortController === controller) {
      syncAbortController = null;
      onStatus?.(null);
    }
  }
}

/** 补全 targets 并在 finally 中落盘（中途限流/中止也不丢已获取详情）。 */
async function enrichAndPersist(
  ctx: WalkContext,
  targets: WeeklyStoredRepo[],
  signal: AbortSignal,
): Promise<void> {
  if (targets.length === 0) return;
  try {
    await enrichRepos(ctx.api, targets, ctx.repos, ctx.changedRepoKeys, ctx.onStatus, signal);
  } finally {
    await weeklyIssuesStorage.saveRepos(
      [...ctx.changedRepoKeys].map((key) => ctx.repos.get(key)!).filter(Boolean),
    );
  }
}

/**
 * 频道抓取入口（refreshChannel 调用）。按需分页：
 * - page 1：60 秒内未同步则做一次有界刷新遍历（since 窗口 / 首次 1 页）；
 * - 任意页：缓存卡片不足该页所需时做一次有界深度遍历（游标续页）；
 * - 缓存充足时纯切片不触网。"周刊收录"过滤为客户端行为。
 */
export async function syncWeeklyChannel(
  api: GitHubApiService,
  page: number,
  onlyCollected: boolean,
  onStatus: StatusCallback,
): Promise<PaginatedDiscoveryRepositories> {
  const meta0 = await weeklyIssuesStorage.getSyncMeta();
  const needsRefreshWalk = page <= 1 && !isRecentlySynced(meta0.lastSyncedAt);
  // 刷新路径会在互斥体内重读仓库并自行评估深度遍历条件，这里跳过冗余的全量读取
  const needsDeepWalk = !needsRefreshWalk
    && !meta0.historyComplete
    && countCards(await weeklyIssuesStorage.getAllRepos(), onlyCollected) < page * CARD_PAGE_SIZE;

  let finalIssues: Map<number, WeeklyStoredIssue> | null = null;
  let finalRepos: Map<string, WeeklyStoredRepo> | null = null;

  if (needsRefreshWalk || needsDeepWalk) {
    await runExclusiveSync(async (signal) => {
      // 上一轮可能已落盘新数据，重读最新状态
      const meta = await weeklyIssuesStorage.getSyncMeta();
      const issues = await weeklyIssuesStorage.getAllIssues();
      const repos = await weeklyIssuesStorage.getAllRepos();
      const ctx: WalkContext = {
        api,
        signal,
        onStatus,
        issues,
        repos,
        changedIssueNumbers: new Set<number>(),
        changedRepoKeys: new Set<string>(),
        meta,
        savedIssues: 0,
        savedRepos: 0,
      };

      if (page <= 1 && !isRecentlySynced(meta.lastSyncedAt)) {
        const firstRun = meta.lastSyncedAt === null;
        onStatus?.({ phase: 'syncing', current: 0, total: 0 });
        const walk = await walkIssuePages(ctx, firstRun
          ? { startPage: 1, maxPages: 1, advanceCursor: true }
          : {
              since: new Date(Date.parse(meta.lastSyncedAt!) - LABEL_GRACE_MS).toISOString(),
              startPage: 1,
              maxPages: REFRESH_WALK_MAX_PAGES,
              advanceCursor: false,
            });
        logger.info('weeklyIssues', 'Refresh walk finished', {
          pages: walk.pagesFetched, scanned: walk.scanned, matched: walk.matched, firstRun, hitEnd: walk.hitEnd,
        });
        await enrichAndPersist(ctx, [
          ...pendingReposFromKeys(repos, ctx.changedRepoKeys),
          ...refreshMaintenanceRepos(repos, ctx.changedRepoKeys, Date.now()),
        ], signal);
        ctx.meta.lastSyncedAt = new Date().toISOString();
        await weeklyIssuesStorage.saveSyncMeta(ctx.meta);
      }

      if (countCards(repos, onlyCollected) < page * CARD_PAGE_SIZE && !ctx.meta.historyComplete) {
        onStatus?.({ phase: 'syncing', current: 0, total: 0 });
        const walk = await walkIssuePages(ctx, {
          startPage: Math.max(1, ctx.meta.deepNextPage - 1),
          maxPages: DEEP_WALK_MAX_PAGES,
          advanceCursor: true,
          stopWhen: () => countProspectiveCards(repos, onlyCollected) >= page * CARD_PAGE_SIZE,
        });
        logger.info('weeklyIssues', 'Deep walk finished', {
          pages: walk.pagesFetched, scanned: walk.scanned, matched: walk.matched, hitEnd: walk.hitEnd,
        });
        await enrichAndPersist(ctx, pendingReposFromKeys(repos, ctx.changedRepoKeys), signal);
      }

      finalIssues = issues;
      finalRepos = repos;
    }, onStatus);
  }

  const issues = finalIssues ?? await weeklyIssuesStorage.getAllIssues();
  const repos = finalRepos ?? await weeklyIssuesStorage.getAllRepos();
  const historyComplete = (await weeklyIssuesStorage.getSyncMeta()).historyComplete;
  const accumulated = buildWeeklyDiscoveryRepos(repos, issues, onlyCollected);
  const start = (page - 1) * CARD_PAGE_SIZE;
  return {
    repos: accumulated.slice(start, start + CARD_PAGE_SIZE),
    hasMore: !historyComplete || accumulated.length > start + CARD_PAGE_SIZE,
    nextPageIndex: page + 1,
    totalCount: accumulated.length,
  };
}

/** "查看原贴"弹窗取 issue 正文：优先离线缓存（无需 token，logout 后仍可看），缓存未命中且提供了 api 时实时拉取兜底，否则原样返回缓存（可能为 null）。 */
export async function fetchWeeklyIssueBody(
  api: GitHubApiService | null,
  issueNumber: number,
): Promise<WeeklyStoredIssue | null> {
  const stored = await weeklyIssuesStorage.getIssue(issueNumber);
  if (stored?.body) return stored;
  if (!api) return stored;
  try {
    const issue = await api.getRepositoryIssue(WEEKLY_REPO_OWNER, WEEKLY_REPO_NAME, issueNumber);
    return {
      number: issue.number,
      title: issue.title,
      body: issue.body,
      labels: issue.labels,
      state: issue.state,
      createdAt: issue.created_at,
      updatedAt: issue.updated_at,
      htmlUrl: issue.html_url,
      repoFullNames: [],
    };
  } catch (error) {
    logger.warn('weeklyIssues', `Fallback fetch failed for issue #${issueNumber}`, error);
    return stored;
  }
}
