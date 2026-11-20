import { getDb } from '../db/connection.js';
import { decrypt } from '../services/crypto.js';
import { config } from '../config.js';
import { logger } from '../services/logger.js';
import {
  resolveActiveAccountScope,
  getLegacyDefaultClaimedBy,
  getPartitionMeta,
  bumpAccountRevision,
} from '../db/accountScope.js';
import {
  type McpRepository,
  type McpSearchFilters,
  normalizeLicense,
  projectRepoForAgent,
  searchRepositories,
} from './repoSearch.js';
import {
  buildBatchLookupResult,
  buildRepositoryEmbeddingText,
  filterVectorCandidates,
  hasActiveVectorFilters,
  MCP_BATCH_LIMIT,
  VECTOR_CANDIDATE_LIMIT,
} from './discovery.js';
import { buildRepoEvidence, type McpReleaseEvidence } from './evidence.js';
import type { HealthReleaseInput } from './repoHealth.js';

function parseJsonColumn(value: unknown): unknown[] {
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function transformRepoRow(row: Record<string, unknown>): McpRepository {
  return {
    id: row.id as number,
    name: row.name as string,
    full_name: row.full_name as string,
    description: (row.description as string | null) ?? null,
    html_url: row.html_url as string,
    stargazers_count: (row.stargazers_count as number) ?? 0,
    language: (row.language as string | null) ?? null,
    created_at: (row.created_at as string | null) ?? null,
    updated_at: (row.updated_at as string | null) ?? null,
    pushed_at: (row.pushed_at as string | null) ?? null,
    starred_at: (row.starred_at as string | null) ?? null,
    owner: {
      login: (row.owner_login as string) ?? '',
      avatar_url: (row.owner_avatar_url as string) ?? '',
    },
    topics: parseJsonColumn(row.topics) as string[],
    ai_summary: (row.ai_summary as string | null) ?? null,
    ai_tags: parseJsonColumn(row.ai_tags) as string[],
    ai_platforms: parseJsonColumn(row.ai_platforms) as string[],
    analyzed_at: (row.analyzed_at as string | null) ?? null,
    analysis_failed: !!row.analysis_failed,
    custom_description: (row.custom_description as string | null) ?? null,
    custom_tags: parseJsonColumn(row.custom_tags) as string[],
    custom_category: (row.custom_category as string | null) ?? null,
    category_locked: !!row.category_locked,
    subscribed_to_releases: !!row.subscribed_to_releases,
    license: (row.license as string | null) ?? null,
  };
}

/** Soft cap to avoid unbounded memory if a DB ever holds extreme row counts. */
const MAX_REPOS_IN_MEMORY = 50_000;

export function loadAllRepositories(scope?: string): McpRepository[] {
  const db = getDb();
  // MCP 查询按当前活跃账号分区过滤（无头请求回退 active_account_id → 'default'）
  const accountId = scope ?? resolveActiveAccountScope(db);
  const rows = db
    .prepare('SELECT * FROM repositories WHERE account_id = ? ORDER BY stargazers_count DESC LIMIT ?')
    .all(accountId, MAX_REPOS_IN_MEMORY) as Record<string, unknown>[];
  return rows.map(transformRepoRow);
}

export function getRepository(idOrFullName: string | number, scope?: string): McpRepository | null {
  const db = getDb();
  const accountId = scope ?? resolveActiveAccountScope(db);
  let row: Record<string, unknown> | undefined;
  if (typeof idOrFullName === 'number' || /^\d+$/.test(String(idOrFullName))) {
    row = db
      .prepare('SELECT * FROM repositories WHERE account_id = ? AND id = ?')
      .get(accountId, Number(idOrFullName)) as Record<string, unknown> | undefined;
  } else {
    row = db
      .prepare('SELECT * FROM repositories WHERE account_id = ? AND full_name = ? COLLATE NOCASE')
      .get(accountId, String(idOrFullName)) as Record<string, unknown> | undefined;
  }
  return row ? transformRepoRow(row) : null;
}

export function getRepositories(inputs: string[]) {
  if (inputs.length > MCP_BATCH_LIMIT) {
    throw new Error(`A maximum of ${MCP_BATCH_LIMIT} repositories may be requested`);
  }
  return buildBatchLookupResult(inputs, (input) => getRepository(input));
}

export function getLatestRelease(repoId: number): McpReleaseEvidence | null {
  const db = getDb();
  const accountId = resolveActiveAccountScope(db);
  const row = db
    .prepare(
      `SELECT id, tag_name, name, html_url, published_at, prerelease, draft
       FROM releases
       WHERE account_id = ? AND repo_id = ?
       ORDER BY (published_at IS NULL) ASC, published_at DESC, id DESC
       LIMIT 1`
    )
    .get(accountId, repoId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: row.id as number,
    tag_name: (row.tag_name as string | null) ?? null,
    name: (row.name as string | null) ?? null,
    html_url: (row.html_url as string | null) ?? null,
    published_at: (row.published_at as string | null) ?? null,
    prerelease: !!row.prerelease,
    draft: !!row.draft,
  };
}

export function getRepoEvidence(idOrFullName: string | number) {
  const repo = getRepository(idOrFullName);
  if (!repo) return { error: 'not_found' as const, idOrFullName: String(idOrFullName) };
  return buildRepoEvidence(repo, getLatestRelease(repo.id), getRepositoryReleases(repo.id));
}

/** Soft cap on how many cached releases feed the health facts of a single repository. */
const MAX_RELEASES_PER_REPO_EVIDENCE = 500;

/**
 * 单个仓库的轻量 Release 行（已按发布时间降序）。
 * Repository Health 需要 Release 数量、最新稳定版本与发布频率，这些都要看完整列表
 * 而不只是最新一条；因此这里单独取一份最小列集合并限制上限。
 *
 * 注意 SQLite 把布尔存成 0/1，这里显式归一化为 boolean，否则 `prerelease === true`
 * 永远为假，预发布会被误当成稳定版（与 getLatestRelease 的 `!!row.prerelease` 一致）。
 */
export function getRepositoryReleases(repoId: number): HealthReleaseInput[] {
  const db = getDb();
  const accountId = resolveActiveAccountScope(db);
  const rows = db
    .prepare(
      `SELECT repo_id, tag_name, published_at, prerelease
       FROM releases
       WHERE account_id = ? AND repo_id = ?
       ORDER BY (published_at IS NULL) ASC, published_at DESC, id DESC
       LIMIT ?`
    )
    .all(accountId, repoId, MAX_RELEASES_PER_REPO_EVIDENCE) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    repo_id: typeof row.repo_id === 'number' ? row.repo_id : Number(row.repo_id),
    tag_name: typeof row.tag_name === 'string' ? row.tag_name : null,
    published_at: typeof row.published_at === 'string' ? row.published_at : null,
    prerelease: row.prerelease === 1 || row.prerelease === true,
  }));
}

export function listCategories(): Array<Record<string, unknown>> {
  const db = getDb();
  const accountId = resolveActiveAccountScope(db);
  const rows = db
    .prepare('SELECT * FROM categories WHERE account_id = ? ORDER BY sort_order ASC, name ASC')
    .all(accountId) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    keywords: parseJsonColumn(row.keywords),
    color: row.color,
    sort_order: row.sort_order,
  }));
}

export function searchRepos(filters: McpSearchFilters) {
  const all = loadAllRepositories();
  const { items, total } = searchRepositories(all, filters);
  return {
    total,
    count: items.length,
    offset: filters.offset ?? 0,
    limit: Math.min(100, Math.max(1, filters.limit ?? 20)),
    items: items.map((r) => projectRepoForAgent(r)),
  };
}

export function getStats() {
  const repos = loadAllRepositories();
  const byLanguage: Record<string, number> = {};
  const byLicense: Record<string, number> = {};
  const tagCounts: Record<string, number> = {};
  let analyzed = 0;
  let subscribed = 0;
  let failed = 0;

  for (const r of repos) {
    const lang = r.language || 'Unknown';
    byLanguage[lang] = (byLanguage[lang] || 0) + 1;
    const lic = normalizeLicense(r.license);
    byLicense[lic] = (byLicense[lic] || 0) + 1;
    if (r.analyzed_at && !r.analysis_failed) analyzed += 1;
    if (r.analyzed_at && r.analysis_failed) failed += 1;
    if (r.subscribed_to_releases) subscribed += 1;
    for (const tag of [...(r.ai_tags || []), ...(r.custom_tags || [])]) {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    }
  }

  const topTags = Object.entries(tagCounts)
    // 同数标签按名称稳定排序，与 Electron mcpDiscovery.buildStats 保持一致
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 20)
    .map(([tag, count]) => ({ tag, count }));

  return {
    totalRepositories: repos.length,
    analyzed,
    analysisFailed: failed,
    unanalyzed: repos.length - analyzed - failed,
    subscribedToReleases: subscribed,
    byLanguage,
    byLicense,
    topTags,
  };
}

export interface VectorAvailability {
  available: boolean;
  reason?: string;
  workerUrl?: string;
  embeddingModel?: string;
}

export function getVectorAvailability(): VectorAvailability {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM vector_search_configs WHERE id = ?')
    .get('default') as Record<string, unknown> | undefined;

  if (!row || !row.enabled) {
    return { available: false, reason: 'vector_search_disabled' };
  }
  const workerUrl = String(row.worker_url || '').trim();
  if (!workerUrl) {
    return { available: false, reason: 'worker_url_missing' };
  }
  const embeddingId = String(row.embedding_config_id || '').trim();
  if (!embeddingId) {
    return { available: false, reason: 'embedding_config_missing' };
  }
  const emb = db
    .prepare('SELECT * FROM embedding_configs WHERE id = ?')
    .get(embeddingId) as Record<string, unknown> | undefined;
  if (!emb) {
    return { available: false, reason: 'embedding_config_not_found' };
  }
  const hasKey = !!emb.api_key_encrypted || emb.api_type === 'ollama';
  if (!hasKey && emb.api_type !== 'ollama') {
    return { available: false, reason: 'embedding_api_key_missing' };
  }
  return {
    available: true,
    workerUrl,
    embeddingModel: String(emb.model || ''),
  };
}

const FETCH_TIMEOUT_MS = 15_000;

/** partition_meta 标记：该账号分区的账号元数据回填探测已完成（避免重复探测）。 */
const VECTOR_BACKFILL_CHECKED_KEY = 'vector_account_backfill_checked';

/** 诊断探测查询的 topK 上限（与 Worker /query 的 QUERY_TOPK_LIMIT 一致）。 */
const VECTOR_PROBE_TOPK = 50;

/**
 * default 分区覆盖探测使用的阈值：保留合法的负 cosine/dot 分数，确保「索引里
 * 是否存在该范围的向量」不会被相似度阈值影响（与 deploy.mjs 的覆盖探测一致）。
 */
const VECTOR_PROBE_THRESHOLD = -1e9;

/**
 * Issue #612 R12 审计 ISSUE-2：default 分区的元数据覆盖探测。
 *
 * Worker 的 ACCOUNT_METADATA_INDEXED 开启后，带 accountId='default' 的 /query
 * 会按元数据过滤；索引建立前写入的存量向量（前端在未登录时上传、metadata
 * 不含 accountId）不会出现在结果里——200 空结果是「未回填」，不是「无数据」。
 * 本地 default 分区仍存在非空 vector_indexed_at 说明客户端确实上传过向量，
 * 此时用独立探测（topK=上限、极低阈值、显式 accountId='default'）区分：
 * - has_scoped_vectors：default 范围确有向量，空用户结果是阈值/相似度导致；
 * - no_scoped_vectors：default 范围查不到任何向量，而本地记录有已索引仓库 →
 *   覆盖未确认（未回填/索引丢失），必须返回迁移状态而不是静默空结果；
 * - probe_failed：无法确认，同样不得静默返回空结果。
 */
async function probeDefaultPartitionScopedCoverage(
  workerUrl: string,
  queryHeaders: Record<string, string>,
  queryVector: number[],
): Promise<'has_scoped_vectors' | 'no_scoped_vectors' | 'probe_failed'> {
  try {
    const probeResult = await fetchWithBodyTimeout(
      `${workerUrl}/query`,
      {
        method: 'POST',
        headers: queryHeaders,
        body: JSON.stringify({
          vector: queryVector,
          topK: VECTOR_PROBE_TOPK,
          threshold: VECTOR_PROBE_THRESHOLD,
          accountId: 'default',
        }),
      },
      async (res) => {
        if (!res.ok) return { ok: false as const };
        const payload = (await res.json().catch(() => null)) as { matches?: unknown } | null;
        return { ok: true as const, payload };
      },
    );
    if (!probeResult.ok || !probeResult.payload || !Array.isArray(probeResult.payload.matches)) {
      return 'probe_failed';
    }
    return probeResult.payload.matches.length > 0 ? 'has_scoped_vectors' : 'no_scoped_vectors';
  } catch {
    return 'probe_failed';
  }
}

/** 本地 default 分区是否记录过已上传的向量（依据 vector_indexed_at 标记）。 */
function hasIndexedDefaultPartitionRepositories(db: ReturnType<typeof getDb>): boolean {
  try {
    return Boolean(
      db
        .prepare("SELECT 1 AS one FROM repositories WHERE account_id = 'default' AND vector_indexed_at IS NOT NULL LIMIT 1")
        .get(),
    );
  } catch {
    // 轻量 stub 缺列/缺表时按「无本地索引标记」处理（保持旧行为）
    return false;
  }
}

/**
 * Issue #612 A25（R2-A11/A12/A13/A14 修订 + 审计 381 修订）：旧索引标记（v4 迁移 /
 * 无冲突认领保留的 legacy 向量）触发账号元数据回填。服务端无法对存量向量增量
 * 补写元数据（向量由客户端生成上传），恢复路径是全量重建。
 *
 * 探测流程：
 * - 使用独立于用户查询参数的诊断请求（topK=探针上限、threshold=0），不复用
 *   用户查询的有限 topK/threshold；
 * - 审计修订：探测无法取得「/query 结果来自当前索引快照」的证据（Worker API
 *   无快照 ID，两次独立请求之间的数量相等只是巧合），一律按归属未确认处理——
 *   明确安排一次全量重建（清除该分区 vector_indexed_at，客户端下次同步携带
 *   accountId 元数据重新上传）后再标记完成，绝不记录「探测完整确认」。
 *
 * 写入流程（R2-A13/A14）：
 * - 完成标记的重查、索引标记清除与版本推进在同一写事务内执行；迟到的并发
 *   探测不得再次清除已重建的索引状态；
 * - 任一写入失败回滚事务并向外传播（不吞异常），失败可重试；
 * - 仅当确实清除了索引标记才推进对应账号快照版本。
 * 探测阶段的网络失败不标记、静默返回，下次查询重试。
 */
async function ensureAccountVectorMetadataBackfill(
  db: ReturnType<typeof getDb>,
  accountId: string,
  workerUrl: string,
  queryHeaders: Record<string, string>,
  queryVector: number[],
): Promise<void> {
  if (accountId === 'default') return;
  const workerIdentity = workerUrl.replace(/\/$/, '');
  if (getPartitionMeta(db, accountId, VECTOR_BACKFILL_CHECKED_KEY) === workerIdentity) return;

  // ── 探测阶段（网络）：诊断 /query 失败直接返回并允许重试 ──
  try {
    const probeResult = await fetchWithBodyTimeout(
      `${workerIdentity}/query`,
      {
        method: 'POST',
        headers: queryHeaders,
        body: JSON.stringify({ vector: queryVector, topK: VECTOR_PROBE_TOPK, threshold: 0 }),
      },
      async (res) => {
        if (!res.ok) return { ok: false as const, payload: null };
        const payload = (await res.json().catch(() => null)) as
          | { matches?: Array<{ id: string; metadata?: Record<string, unknown> }> }
          | null;
        return { ok: true as const, payload };
      },
    );
    if (!probeResult.ok || !probeResult.payload || !Array.isArray(probeResult.payload.matches)) {
      return; // Worker 不可用 / 被拒：不置位，下次重试
    }
  } catch (err) {
    logger.warn('mcp.vector', 'Account metadata backfill probe failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  // Issue #612 审计（381-384）：/query 与 /status 是两次独立请求，Worker API
  // 未提供把两个响应绑定到同一索引快照的证据（无快照 ID / 版本号）。两次请求
  // 之间并发客户端可能删除向量并重传不同格式的新向量，「数量相等」只反映巧合
  // 而非同一快照。无法取得同快照证据时一律按「归属未确认」处理：明确安排一次
  // 全量重建（清除该分区 vector_indexed_at，客户端携带 accountId 元数据重新
  // 上传），绝不仅凭数量相等记录探测完成。探测响应本身不再参与归属判定
  // （上方校验仅作为 Worker 可达性与响应合法性门槛），失败时不标记、下次重试。

  // ── 写入阶段（R2-A13/A14）：单事务，提交前核对当前 Worker 标识，失败回滚并向上传播 ──
  const applyBackfillDecision = db.transaction((): boolean => {
    const currentConfig = db
      .prepare('SELECT worker_url FROM vector_search_configs WHERE id = ?')
      .get('default') as { worker_url?: unknown } | undefined;
    const currentWorkerIdentity = typeof currentConfig?.worker_url === 'string'
      ? currentConfig.worker_url.replace(/\/$/, '')
      : '';
    if (currentWorkerIdentity !== workerIdentity) return false;

    // 重新检查完成标记：相同 Worker 标识的并发探测共享完成状态，不得再次清除已重建的索引状态。
    const claimedRow = db
      .prepare('SELECT value FROM partition_meta WHERE account_id = ? AND key = ?')
      .get(accountId, VECTOR_BACKFILL_CHECKED_KEY) as { value: string | null } | undefined;
    if (claimedRow && claimedRow.value === workerIdentity) return false;
    // 归属未确认（无同快照证据）或探测到 legacy 向量：清除索引标记，明确安排
    // 一次全量重建（客户端下次同步携带 accountId 元数据重新上传）。
    const cleared = db.prepare(
      'UPDATE repositories SET vector_indexed_at = NULL WHERE account_id = ? AND vector_indexed_at IS NOT NULL',
    ).run(accountId).changes;
    // 仅当确实清除了索引标记才推进对应账号快照版本。
    if (cleared > 0) bumpAccountRevision(db, accountId);
    db.prepare('INSERT OR REPLACE INTO partition_meta (account_id, key, value) VALUES (?, ?, ?)')
      .run(accountId, VECTOR_BACKFILL_CHECKED_KEY, workerIdentity);
    return true;
  });

  const rebuilt = applyBackfillDecision();
  if (rebuilt) {
    logger.warn('mcp.vector', 'Account vector index rebuild scheduled (legacy vectors detected or ownership unverifiable)', {
      accountId,
    });
  }
}

async function fetchWithBodyTimeout<T>(
  url: string,
  init: RequestInit,
  readBody: (res: Response) => Promise<T>,
  timeoutMs = FETCH_TIMEOUT_MS
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return await readBody(response);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Match app EmbeddingClient URL rules in vectorSearchService.ts:
 * - openai / siliconflow: `${baseUrl}/v1/embeddings` (baseUrl usually host without /v1)
 * - openai-compatible: baseUrl is the full embeddings endpoint
 * - ollama: `${baseUrl}/api/embed` with { model, input }
 */
async function embedQuery(
  texts: string[],
  emb: Record<string, unknown>
): Promise<number[]> {
  const apiType = String(emb.api_type || 'openai');
  const model = String(emb.model || '');
  let apiKey = '';
  if (emb.api_key_encrypted) {
    try {
      apiKey = decrypt(String(emb.api_key_encrypted), config.encryptionKey);
    } catch {
      throw new Error('Failed to decrypt embedding API key');
    }
  }

  const baseUrl = String(emb.base_url || '').replace(/\/+$/, '');
  let url: string;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  let body: Record<string, unknown>;

  if (apiType === 'ollama') {
    url = `${baseUrl || 'http://127.0.0.1:11434'}/api/embed`;
    body = { model, input: texts };
  } else if (apiType === 'gemini') {
    const root = baseUrl || 'https://generativelanguage.googleapis.com';
    url = `${root}/v1beta/models/${model}:batchEmbedContents?key=${encodeURIComponent(apiKey)}`;
    body = {
      requests: texts.map((t) => ({
        model: `models/${model}`,
        content: { parts: [{ text: t }] },
        taskType: 'RETRIEVAL_QUERY',
      })),
    };
  } else if (apiType === 'cohere') {
    url = `${baseUrl || 'https://api.cohere.com'}/v1/embed`;
    headers.Authorization = `Bearer ${apiKey}`;
    body = { model, texts, input_type: 'search_query' };
  } else if (apiType === 'openai-compatible') {
    if (!baseUrl) {
      throw new Error('openai-compatible base_url is required (full embeddings endpoint)');
    }
    url = baseUrl;
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    body = { model, input: texts };
  } else {
    // openai / siliconflow
    const root =
      baseUrl ||
      (apiType === 'siliconflow' ? 'https://api.siliconflow.cn' : 'https://api.openai.com');
    url = /\/v1$/i.test(root) ? `${root}/embeddings` : `${root}/v1/embeddings`;
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    body = { model, input: texts };
  }

  const data = await fetchWithBodyTimeout(
    url,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    },
    async (res) => {
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Embedding API error ${res.status} (${apiType} ${url}): ${text.slice(0, 200)}`);
      }
      return (await res.json()) as Record<string, unknown>;
    },
  );

  if (apiType === 'ollama') {
    const embeddings = data.embeddings as number[][] | undefined;
    if (embeddings?.[0]) return embeddings[0];
    const embVec = data.embedding as number[] | undefined;
    if (embVec) return embVec;
    throw new Error('Ollama embedding missing');
  }
  if (apiType === 'gemini') {
    const batch = data.embeddings as Array<{ values?: number[] }> | undefined;
    if (batch?.[0]?.values) return batch[0].values;
    const embObj = data.embedding as { values?: number[] } | undefined;
    if (embObj?.values) return embObj.values;
    throw new Error('Gemini embedding missing');
  }
  if (apiType === 'cohere') {
    const embeddings = data.embeddings as number[][] | undefined;
    if (!embeddings?.[0]) throw new Error('Cohere embedding missing');
    return embeddings[0];
  }
  const list = data.data as Array<{ embedding: number[] }> | undefined;
  if (!list?.[0]?.embedding) throw new Error('OpenAI-compatible embedding missing');
  return list[0].embedding;
}

export interface VectorSearchOptions
  extends Pick<
    McpSearchFilters,
    | 'languages'
    | 'tags'
    | 'platforms'
    | 'licenses'
    | 'category'
    | 'minStars'
    | 'maxStars'
    | 'isAnalyzed'
    | 'isSubscribed'
  > {
  topK?: number;
  threshold?: number;
}

export async function vectorSearch(
  query: string,
  opts: VectorSearchOptions = {}
): Promise<
  | { available: false; reason: string }
  | { available: true; matches: Array<Record<string, unknown>>; filtering?: Record<string, unknown> }
> {
  const availability = getVectorAvailability();
  if (!availability.available) {
    return { available: false, reason: availability.reason || 'unavailable' };
  }

  const db = getDb();
  // 固定一次账号范围：后续两次查询（Worker 候选 + DB 仓库）必须同一账号。
  const accountId = resolveActiveAccountScope(db);
  const vs = db
    .prepare('SELECT * FROM vector_search_configs WHERE id = ?')
    .get('default') as Record<string, unknown>;
  const emb = db
    .prepare('SELECT * FROM embedding_configs WHERE id = ?')
    .get(String(vs.embedding_config_id)) as Record<string, unknown>;

  let workerToken = '';
  if (vs.auth_token_encrypted) {
    try {
      workerToken = decrypt(String(vs.auth_token_encrypted), config.encryptionKey);
    } catch {
      logger.warn('mcp.vector', 'Failed to decrypt worker auth token');
      return { available: false, reason: 'worker_token_decrypt_failed' };
    }
  }

  const topK = Math.min(50, Math.max(1, opts.topK ?? 20));
  const threshold = opts.threshold ?? 0.35;
  const filtersActive = hasActiveVectorFilters(opts);
  const workerTopK = filtersActive ? VECTOR_CANDIDATE_LIMIT : topK;

  let vector: number[];
  try {
    vector = await embedQuery([query], emb);
  } catch (err) {
    logger.warn('mcp.vector', 'Embedding failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { available: false, reason: `embedding_failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  const workerUrl = String(vs.worker_url).replace(/\/$/, '');
  const queryHeaders = {
    'Content-Type': 'application/json',
    ...(workerToken ? { Authorization: `Bearer ${workerToken}` } : {}),
  };
  const sendWorkerQuery = (scopedAccountId?: string) => fetchWithBodyTimeout(
    `${workerUrl}/query`,
    {
      method: 'POST',
      headers: queryHeaders,
      body: JSON.stringify({
        vector,
        topK: workerTopK,
        threshold,
        ...(scopedAccountId ? { accountId: scopedAccountId } : {}),
      }),
    },
    async (response) => {
      if (!response.ok) {
        return { ok: false as const, status: response.status, text: await response.text().catch(() => '') };
      }
      const json = (await response.json()) as {
        matches?: Array<{ id: string; score: number; metadata?: Record<string, unknown> }>;
      };
      return { ok: true as const, status: response.status, data: json };
    },
  );

  // Issue #612 R2-A12：default（无活跃账号）查询同样要向 Worker 提供能隔离
  // default 候选的范围（accountId='default' 过滤），避免其他账号候选占满
  // topK 后被本地丢弃。
  // Issue #612 R12（审计修订）：本地分区数量无法推断远程共享 Worker 中向量的
  // 归属——共享索引上其他部署遗留的无前缀向量同样存在，无范围兼容查询会把
  // 其他部署的向量仅凭仓库 ID 匹配关联到本地仓库并参与打分。范围过滤必须在
  // Worker 的 topK 计算前按已验证的元数据范围生效：default 查询一律发送
  // accountId='default'；旧索引尚未回填元数据时 Worker 返回
  // ACCOUNT_METADATA_NOT_INDEXED，走现有迁移状态（客户端携带 accountId 元数据
  // 重新上传），绝不仅凭仓库 ID 匹配接受无前缀候选。
  const workerScope = accountId;
  let queryResult:
    | { ok: false; status: number; text: string }
    | { ok: true; status: number; data: { matches?: Array<{ id: string; score: number; metadata?: Record<string, unknown> }> } };
  try {
    queryResult = await sendWorkerQuery(workerScope);
  } catch {
    // 连接失败 / 15s 超时 abort / 非 JSON 响应都走这里；findSimilarRepositories 依赖本函数
    // 永不 throw，异常必须折叠进声明的 { available: false } 结果
    return {
      available: false,
      reason: 'worker_query_failed',
    };
  }
  if (!queryResult.ok) {
    const { status, text } = queryResult;
    const isMetadataNotIndexed = status === 400 && text.includes('ACCOUNT_METADATA_NOT_INDEXED');
    if (isMetadataNotIndexed && accountId !== 'default' && getLegacyDefaultClaimedBy(db) === accountId) {
      // Issue #612 A25：在启用 accountId 过滤前完成存量向量元数据回填——探测
      // 无法可靠确认索引归属时明确安排一次全量重建（R2-A11/A13/A14）。
      try {
        await ensureAccountVectorMetadataBackfill(db, accountId, workerUrl, queryHeaders, vector);
      } catch (err) {
        logger.warn('mcp.vector', 'Account metadata backfill transaction failed', {
          error: err instanceof Error ? err.message : String(err),
        });
        return { available: false, reason: 'vector_backfill_failed' };
      }
      // Issue #612 A26（审计修订 668）：本地 SQLite 的账号分区数量不能证明远程
      // 共享索引中的无前缀旧向量只属于当前账号——共享 Worker 上其他部署遗留的
      // 无前缀向量同样存在，无范围兼容查询会把其他账号的相似度用于本账号的
      // 仓库。当前 Worker API 未提供无前缀索引归属的独立证据，兼容重试路径
      // 已移除：一律按归属未确认返回；恢复路径是回填探测安排的全量重建
      // （客户端携带 accountId 元数据重新上传后，带范围的查询正常工作）。
      return { available: false, reason: 'account_metadata_not_indexed' };
    } else if (isMetadataNotIndexed) {
      // R2-A12：default 范围查询在元数据索引未就绪时同样声明语义化原因。
      return { available: false, reason: 'account_metadata_not_indexed' };
    } else {
      return { available: false, reason: `worker_query_failed: ${status} ${text.slice(0, 120)}` };
    }
  }
  const data = queryResult.data;
  // JSON null / 缺 matches 字段是合法 JSON，res.json() 不会 reject，必须在此
  // 做结构校验；Electron 端 runVectorSearch 保持相同语义
  if (!data || !Array.isArray(data.matches)) {
    return { available: false, reason: 'worker_query_failed' };
  }
  const matches = data.matches;
  // 若元数据索引已启用，但账号分区仍有非空 vector_indexed_at（如备份恢复或
  // 单账号升级保留的旧向量标记）且尚未针对当前 Worker 完成回填探测，触发一次
  // 回填探测以在存在旧向量时清除索引标记并安排重建。
  // Issue #612 审计（702/867）：检查不依赖过滤查询结果是否为空——范围查询按
  // accountId 元数据过滤，缺元数据的旧向量本就不会出现在结果中；只要该账号
  // 存在已索引仓库且当前 Worker 尚未完成检查，就执行探测（失败被下方
  // try/catch 包裹，不阻断当前查询）。
  if (
    accountId !== 'default'
    && getPartitionMeta(db, accountId, VECTOR_BACKFILL_CHECKED_KEY) !== workerUrl
  ) {
    let hasIndexedRepos = false;
    try {
      const indexedRow = db
        .prepare('SELECT 1 AS one FROM repositories WHERE account_id = ? AND vector_indexed_at IS NOT NULL LIMIT 1')
        .get(accountId);
      hasIndexedRepos = Boolean(indexedRow);
    } catch {
      // 轻量 stub 缺列/缺表时忽略
    }
    if (hasIndexedRepos) {
      try {
        await ensureAccountVectorMetadataBackfill(db, accountId, workerUrl, queryHeaders, vector);
      } catch (err) {
        logger.warn('mcp.vector', 'Account metadata backfill after empty scoped search failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
  // Issue #612 R12 审计 ISSUE-2：default 分区不得在「元数据索引已启用但未回填/
  // 覆盖未确认」时静默返回空结果。带 accountId='default' 的查询在旧向量缺少
  // accountId 元数据时同样返回 200 空 matches；本地 default 分区存在已索引仓库
  // 时先做独立探测区分「阈值导致的空结果」与「范围内没有任何向量」——后者
  // （以及探测失败导致无法确认）按与 account_metadata_not_indexed 一致的迁移
  // 状态返回，避免把未回填伪装成「没有相似仓库」。default 分区没有本地索引
  // 标记时是真「无数据」，保持空结果。
  if (
    accountId === 'default'
    && matches.length === 0
    && hasIndexedDefaultPartitionRepositories(db)
  ) {
    const coverage = await probeDefaultPartitionScopedCoverage(workerUrl, queryHeaders, vector);
    if (coverage !== 'has_scoped_vectors') {
      logger.warn('mcp.vector', 'Default partition account metadata coverage unconfirmed', {
        coverage,
      });
      return { available: false, reason: 'account_metadata_not_indexed' };
    }
  }
  const repos = loadAllRepositories(accountId);
  const byId = new Map(repos.map((r) => [String(r.id), r]));

  // Issue #612 A27：旧索引（迁移期）里同一仓库可能同时存在 legacy 无前缀向量
  // 与 `${accountId}:${repoId}` 新向量。投影前先按规范化 repoId 去重，避免同一
  // 仓库占用两个候选名额；两种候选并存时优先保留带账号前缀（scopedAccountId）
  // 的新向量，等优先级时保留更高分。首次出现顺序保持稳定。
  const dedupedCandidates = new Map<string, { id: string; score: number; repository: McpRepository; scoped: boolean }>();
  for (const m of matches) {
    // 向量 ID 可能是 `${accountId}:${repoId}`：先解析再核对归属与元数据一致性。
    const rawId = String(m.id);
    const separator = rawId.indexOf(':');
    const prefix = separator > 0 ? rawId.slice(0, separator) : '';
    const scopedAccountId = /^\d+$/.test(prefix) ? prefix : null;
    if (scopedAccountId && scopedAccountId !== accountId) continue;
    const metaAccountId = typeof m.metadata?.accountId === 'string' ? m.metadata.accountId : null;
    if (metaAccountId && metaAccountId !== accountId) continue;
    if (scopedAccountId && metaAccountId && metaAccountId !== scopedAccountId) continue;
    const repoId = scopedAccountId ? rawId.slice(separator + 1) : rawId;
    const repo = byId.get(repoId);
    if (!repo) continue;
    const score = Number(m.score);
    const scoped = scopedAccountId !== null;
    const existing = dedupedCandidates.get(repoId);
    if (!existing) {
      dedupedCandidates.set(repoId, { id: repoId, score, repository: repo, scoped });
      continue;
    }
    const preferNew = scoped && !existing.scoped;
    const preferHigherScore = scoped === existing.scoped && score > existing.score;
    if (preferNew || preferHigherScore) {
      // Map.set 对已存在键保持首次插入位置，稳定候选顺序。
      dedupedCandidates.set(repoId, { id: repoId, score, repository: repo, scoped });
    }
  }

  const candidates = Array.from(
    dedupedCandidates.values(),
    ({ id, score, repository }) => ({ id, score, repository }),
  );

  if (!filtersActive) {
    const enriched = candidates.map((candidate) => ({
      score: candidate.score,
      ...projectRepoForAgent(candidate.repository),
    }));
    return { available: true, matches: enriched };
  }

  // This is intentionally local filtering over the retrieved candidate set,
  // not an exact filtered topK over the complete Vectorize corpus. The Worker
  // remains unchanged and returns at most VECTOR_CANDIDATE_LIMIT candidates.
  const filtered = filterVectorCandidates(candidates, opts, topK);
  const enriched = filtered.matches.map((candidate) => ({
    score: candidate.score,
    ...projectRepoForAgent(candidate.repository),
  }));

  return {
    available: true,
    matches: enriched,
    filtering: {
      mode: 'local_candidate_set',
      candidateLimit: VECTOR_CANDIDATE_LIMIT,
      exactCorpusFilteredTopK: false,
      candidateCount: filtered.candidateCount,
      filteredCount: filtered.filteredCount,
    },
  };
}

export async function findSimilarRepositories(
  idOrFullName: string | number,
  opts: { topK?: number; threshold?: number } = {}
): Promise<
  | { error: 'not_found'; idOrFullName: string }
  | { available: false; reason: string }
  | {
      available: true;
      source: Record<string, unknown>;
      sourceExcluded: true;
      matches: Array<Record<string, unknown>>;
    }
> {
  const accountId = resolveActiveAccountScope(getDb());
  const source = getRepository(idOrFullName, accountId);
  if (!source) return { error: 'not_found', idOrFullName: String(idOrFullName) };

  const topK = Math.min(50, Math.max(1, opts.topK ?? 10));
  const result = await vectorSearch(buildRepositoryEmbeddingText(source), {
    topK: Math.min(50, topK + 8),
    threshold: opts.threshold,
  });
  if (!result.available) return result;

  const bestById = new Map<string, { score: number; match: Record<string, unknown> }>();
  for (const match of result.matches) {
    const matchId = String(match.id ?? '');
    if (!matchId || matchId === String(source.id)) continue;
    const score = Number.isFinite(Number(match.score)) ? Number(match.score) : Number.NEGATIVE_INFINITY;
    const current = bestById.get(matchId);
    if (!current || score > current.score) bestById.set(matchId, { score, match });
  }

  const matches = Array.from(bestById.values())
    .sort(
      (left, right) =>
        right.score - left.score ||
        String(left.match.full_name || '').localeCompare(String(right.match.full_name || ''))
    )
    .slice(0, topK)
    .map(({ match }) => match);

  return {
    available: true,
    source: projectRepoForAgent(source, { summaryMaxChars: 2000 }),
    sourceExcluded: true,
    matches,
  };
}
