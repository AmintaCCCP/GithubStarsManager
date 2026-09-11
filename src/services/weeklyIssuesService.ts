/**
 * 阮一峰周刊频道数据服务。
 *
 * 数据管道：分页拉取 ruanyf/weekly 的 issues（增量走 `sort=updated&since=上次同步-7天`，
 * label 变更会 bump updated_at，因此"发布几天后才补加 weekly label"的场景天然被覆盖）
 * → 标题含"开源"过滤 → 正文提取 GitHub 仓库链接 → 按 full_name 去重（原贴取最新投稿）
 * → 仓库详情补全（GraphQL 批量优先，REST 逐仓回退）→ 独立 IndexedDB 持久化
 * → 客户端按投稿时间倒序 + "周刊收录"过滤 + 分页切片。
 *
 * 不用 search/issues API 的原因：结果有 1000 条硬上限且独立限速 30 次/分，
 * 装不下仓库上万条 issue；list 端点走核心 API（5000 次/小时）。
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
/** 每轮同步最多刷新的过期仓库数（控制 API 预算） */
const STALE_REPO_REFRESH_CAP = 150;
/** 60 秒内同步过则跳过网络同步（过滤器切换等签名变化触发的重刷走缓存） */
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

/** 挑选本轮需要补全详情的仓库：新仓库优先，其后是过期快照与到期重试的不可用仓库。 */
export function selectReposToEnrich(repos: Map<string, WeeklyStoredRepo>, nowMs: number): WeeklyStoredRepo[] {
  const pending: WeeklyStoredRepo[] = [];
  const stale: WeeklyStoredRepo[] = [];
  const unavailableRetry: WeeklyStoredRepo[] = [];
  for (const repo of repos.values()) {
    if (!repo.lastFetchedAt) {
      pending.push(repo);
    } else if (repo.detail) {
      if (nowMs - Date.parse(repo.lastFetchedAt) > REPO_DETAIL_TTL_MS) stale.push(repo);
    } else if (nowMs - Date.parse(repo.lastFetchedAt) > UNAVAILABLE_RETRY_MS) {
      unavailableRetry.push(repo);
    }
  }
  const bySubmissionDesc = (a: WeeklyStoredRepo, b: WeeklyStoredRepo) => b.issueCreatedAt.localeCompare(a.issueCreatedAt);
  pending.sort(bySubmissionDesc);
  return [
    ...pending,
    ...stale.sort(bySubmissionDesc).slice(0, STALE_REPO_REFRESH_CAP),
    ...unavailableRetry.sort(bySubmissionDesc).slice(0, STALE_REPO_REFRESH_CAP),
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

/** 全量/增量同步：分页遍历 issues → 提取入库 → 详情补全 → 写同步时间戳。 */
export async function syncWeeklyIssues(
  api: GitHubApiService,
  signal: AbortSignal | undefined,
  onStatus: StatusCallback,
): Promise<void> {
  const meta = await weeklyIssuesStorage.getSyncMeta();
  const since = meta.lastSyncedAt
    ? new Date(Date.parse(meta.lastSyncedAt) - LABEL_GRACE_MS).toISOString()
    : undefined;
  const issues = await weeklyIssuesStorage.getAllIssues();
  const repos = await weeklyIssuesStorage.getAllRepos();
  const changedIssueNumbers = new Set<number>();
  const changedRepoKeys = new Set<string>();

  onStatus?.({ phase: 'syncing', current: 0, total: 0 });
  let page = 1;
  let scanned = 0;
  let matched = 0;
  let savedIssues = 0;
  while (true) {
    const items = await api.listRepositoryIssues(WEEKLY_REPO_OWNER, WEEKLY_REPO_NAME, {
      state: 'all',
      sort: 'updated',
      direction: 'desc',
      since,
      perPage: ISSUE_PAGE_SIZE,
      page,
      signal,
    });
    if (items.length === 0) break;
    for (const issue of items) {
      if (processWeeklyIssue(issue, issues, repos, changedIssueNumbers, changedRepoKeys)) matched++;
    }
    scanned += items.length;
    onStatus?.({ phase: 'syncing', current: scanned, total: 0 });
    // 每页落盘一次：中途取消/断网时已处理条目不丢（重复扫描靠 updatedAt 快速跳过）
    if (changedIssueNumbers.size > savedIssues) {
      await weeklyIssuesStorage.saveIssues(
        [...changedIssueNumbers].slice(savedIssues).map((number) => issues.get(number)!).filter(Boolean),
      );
      await weeklyIssuesStorage.saveRepos(
        [...changedRepoKeys].map((key) => repos.get(key)!).filter(Boolean),
      );
      savedIssues = changedIssueNumbers.size;
    }
    if (items.length < ISSUE_PAGE_SIZE) break;
    page++;
    await sleep(ISSUE_LIST_THROTTLE_MS);
  }
  await weeklyIssuesStorage.saveIssues([...changedIssueNumbers].map((number) => issues.get(number)!).filter(Boolean));
  await weeklyIssuesStorage.saveRepos([...changedRepoKeys].map((key) => repos.get(key)!).filter(Boolean));

  logger.info('weeklyIssues', 'Issue scan finished', { scanned, matched, pages: page, since: since ?? 'full' });

  const targets = selectReposToEnrich(repos, Date.now());
  if (targets.length > 0) {
    try {
      await enrichRepos(api, targets, repos, changedRepoKeys, onStatus, signal);
    } finally {
      // 中途失败（限流/中止）也落盘已获取的批量详情，避免下次重复请求
      await weeklyIssuesStorage.saveRepos([...changedRepoKeys].map((key) => repos.get(key)!).filter(Boolean));
    }
  }

  await weeklyIssuesStorage.saveSyncMeta({ lastSyncedAt: new Date().toISOString() });
  logger.info('weeklyIssues', 'Weekly sync finished', { enriched: targets.length });
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

let syncAbortController: AbortController | null = null;

/** 互斥的同步入口：新请求会中止上一轮未完成的同步（切换频道/重入场景）。 */
async function runExclusiveSync(api: GitHubApiService, onStatus: StatusCallback): Promise<void> {
  syncAbortController?.abort();
  const controller = new AbortController();
  syncAbortController = controller;
  try {
    await syncWeeklyIssues(api, controller.signal, onStatus);
  } finally {
    // 仅在仍持有同步权时清空状态，避免被中止的旧轮次清掉新一轮的进度显示
    if (syncAbortController === controller) {
      syncAbortController = null;
      onStatus?.(null);
    }
  }
}

/**
 * 频道抓取入口（refreshChannel 调用）：page 1 触发（增量）同步后返回首页切片，
 * page > 1 纯缓存切片不触网。"周刊收录"过滤为客户端行为，切换过滤器
 * 会改变请求签名从而重跑本入口（60 秒内已同步则直接重建）。
 */
export async function syncWeeklyChannel(
  api: GitHubApiService,
  page: number,
  onlyCollected: boolean,
  onStatus: StatusCallback,
): Promise<PaginatedDiscoveryRepositories> {
  if (page <= 1) {
    const meta = await weeklyIssuesStorage.getSyncMeta();
    const recentlySynced = meta.lastSyncedAt !== null
      && Number.isFinite(Date.parse(meta.lastSyncedAt))
      && Date.now() - Date.parse(meta.lastSyncedAt) < RECENT_SYNC_SKIP_MS;
    if (!recentlySynced) {
      await runExclusiveSync(api, onStatus);
    }
  }
  const [issues, repos] = await Promise.all([
    weeklyIssuesStorage.getAllIssues(),
    weeklyIssuesStorage.getAllRepos(),
  ]);
  const all = buildWeeklyDiscoveryRepos(repos, issues, onlyCollected);
  const start = (page - 1) * CARD_PAGE_SIZE;
  return {
    repos: all.slice(start, start + CARD_PAGE_SIZE),
    hasMore: start + CARD_PAGE_SIZE < all.length,
    nextPageIndex: page + 1,
    totalCount: all.length,
  };
}

/** "查看原贴"弹窗取 issue 正文：优先离线缓存，缺失时兜底实时拉取。 */
export async function fetchWeeklyIssueBody(
  api: GitHubApiService,
  issueNumber: number,
): Promise<WeeklyStoredIssue | null> {
  const stored = await weeklyIssuesStorage.getIssue(issueNumber);
  if (stored?.body) return stored;
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
