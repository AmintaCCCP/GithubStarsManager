/**
 * 向量语义搜索服务
 *
 * 1. EmbeddingClient — 调用用户配置的 Embedding API 生成向量
 * 2. VectorSearchService — 与 Cloudflare Worker 通信（存/查/删向量）
 */

import type { EmbeddingConfig, VectorSearchConfig, Repository } from '../types';
import { NO_LICENSE_SENTINEL, normalizeLicense } from '../utils/licenseFilter';

// ============================================================
// EmbeddingClient
// ============================================================

export class EmbeddingClient {
  constructor(private config: EmbeddingConfig) {}

  /**
   * 批量生成 embedding 向量
   * @param purpose 'document' 用于索引, 'query' 用于搜索查询
   */
  async embed(texts: string[], purpose: 'document' | 'query' = 'document', signal?: AbortSignal): Promise<number[][]> {
    switch (this.config.apiType) {
      case 'openai':
      case 'openai-compatible':
      case 'siliconflow':
        return this.embedOpenAICompatible(texts, signal);
      case 'ollama':
        return this.embedOllama(texts, signal);
      case 'gemini':
        return this.embedGemini(texts, purpose, signal);
      case 'cohere':
        return this.embedCohere(texts, purpose, signal);
      default:
        throw new Error(`Unsupported embedding API type: ${this.config.apiType}`);
    }
  }

  /**
   * 测试连接：发送单条文本，验证返回向量维度
   */
  async testConnection(): Promise<{ success: boolean; dimensions: number; error?: string }> {
    try {
      const vectors = await this.embed(['hello']);
      if (!vectors || vectors.length === 0 || !Array.isArray(vectors[0])) {
        return { success: false, dimensions: 0, error: 'Invalid response format' };
      }
      return { success: true, dimensions: vectors[0].length };
    } catch (error) {
      return {
        success: false,
        dimensions: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ----------------------------------------------------------
  // OpenAI / OpenAI-compatible
  // POST /v1/embeddings  or  custom URL
  // ----------------------------------------------------------
  private async embedOpenAICompatible(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    const url =
      this.config.apiType === 'openai' || this.config.apiType === 'siliconflow'
        ? `${this.config.baseUrl.replace(/\/+$/, '')}/v1/embeddings`
        : this.config.baseUrl;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: this.config.model, input: texts }),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Embedding API error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    // OpenAI 格式: { data: [{ embedding: [...], index: 0 }] }
    return data.data
      .sort((a: { index: number }, b: { index: number }) => a.index - b.index)
      .map((d: { embedding: number[] }) => d.embedding);
  }

  // ----------------------------------------------------------
  // Ollama 本地模型
  // POST /api/embed
  // ----------------------------------------------------------
  private async embedOllama(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    const url = `${this.config.baseUrl.replace(/\/+$/, '')}/api/embed`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.config.model, input: texts }),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Ollama API error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    // Ollama 格式: { embeddings: [[...], [...]] }
    return data.embeddings;
  }

  // ----------------------------------------------------------
  // Google Gemini
  // POST /v1beta/models/{model}:batchEmbedContents
  // ----------------------------------------------------------
  private async embedGemini(texts: string[], purpose: 'document' | 'query' = 'document', signal?: AbortSignal): Promise<number[][]> {
    const baseUrl = this.config.baseUrl.replace(/\/+$/, '');
    const url = `${baseUrl}/v1beta/models/${this.config.model}:batchEmbedContents?key=${this.config.apiKey}`;
    const taskType = purpose === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT';

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: texts.map((text) => ({
          model: `models/${this.config.model}`,
          content: { parts: [{ text }] },
          taskType,
        })),
      }),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Gemini API error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    return data.embeddings.map((e: { values: number[] }) => e.values);
  }

  // ----------------------------------------------------------
  // Cohere
  // POST /v1/embed
  // ----------------------------------------------------------
  private async embedCohere(texts: string[], purpose: 'document' | 'query' = 'document', signal?: AbortSignal): Promise<number[][]> {
    const url = `${this.config.baseUrl.replace(/\/+$/, '')}/v1/embed`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        texts,
        input_type: purpose === 'query' ? 'search_query' : 'search_document',
      }),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Cohere API error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    return data.embeddings;
  }
}

// ============================================================
// VectorSearchService — 与 Cloudflare Worker 通信
// ============================================================

// Vectorize V2 限制：returnMetadata 返回 metadata 时 topK 上限为 50。
// Worker /query 同样以 50 为 clamp 上限，此处保持一致，避免请求被静默截断。
export const VECTORIZE_QUERY_TOPK_LIMIT = 50;

export interface VectorizeVector {
  id: string;
  values: number[];
  metadata: {
    full_name: string;
    description: string;
    language: string;
    stars: number;
    tags: string[];
    // 可选：此 PR 之前（embedding v2）索引的向量不含 license 键，重索引前以 undefined 出现。
    // indexAllRepos 写入时会填入字符串；消费方请按可选处理。
    license?: string;
    // 可选：多账号账号隔离（R4 审计修复）。此前的存量向量（legacy）没有该键；
    // 新写入的向量始终记录归属账号，供查询侧按当前账号过滤。
    accountId?: string;
  };
}

export interface VectorQueryResult {
  id: string;
  score: number;
  metadata: {
    full_name: string;
    description: string;
    language: string;
    stars: number;
    tags: string[];
    // 同上：旧向量查询返回时缺该键，按可选处理。
    license?: string;
    // 同上：legacy 向量缺该键，按可选处理。
    accountId?: string;
  };
}

/**
 * 宽查询（`wide: true`）返回类型：Worker 使用 `returnMetadata: 'indexed'`，
 * 仅保证已索引的元数据字段（如 `accountId`），不包含 `description`、`tags` 等未索引字段。
 */
export interface VectorWideQueryResult {
  id: string;
  score: number;
  metadata?: {
    accountId?: string;
  };
}

/**
 * 账号隔离的向量 ID（R4 审计修复）：多账号共享同一 VECTORIZE 索引，若沿用
 * `String(repo.id)` 作为向量 ID，两个账号索引同一仓库会以相同 ID 互相覆盖
 * 向量与 metadata（ai_tags/license 串号泄漏）。upsert 统一写入
 * `${accountId}:${repo.id}` 并在 metadata 记录 accountId，使每个账号拥有
 * 独立的向量副本。
 *
 * 兼容策略：accountId 未知（未登录边缘态）时保持旧格式无前缀 ID——与
 * cleanup keepIds 的 legacy 形式一致；存量旧格式 ID 由查询侧按会话形态兼容
 * （单账号会话视为本账号 legacy 数据继续可见，多账号会话因无法判定归属而
 * 过滤，详见 hydrateMatches）。
 */
export const buildAccountScopedVectorId = (accountId: string | null | undefined, repoId: number | string): string => (
  accountId ? `${accountId}:${repoId}` : String(repoId)
);

/**
 * 解析向量 ID：带合法数字账号前缀（`accountId:repoId`）时返回归属账号与仓库
 * ID；否则视为 legacy 无前缀 ID（accountId=null，repoId 即原 ID）。
 */
export const parseAccountScopedVectorId = (id: string): { accountId: string | null; repoId: string } => {
  const separatorIndex = id.indexOf(':');
  if (separatorIndex > 0) {
    const prefix = id.slice(0, separatorIndex);
    if (/^\d+$/.test(prefix)) {
      return { accountId: prefix, repoId: id.slice(separatorIndex + 1) };
    }
  }
  return { accountId: null, repoId: id };
};

export interface VectorizeStatus {
  vectorCount: number;
  dimensions: number;
  indexName?: string;
  /** /cleanup 是否支持按账号前缀限定删除范围（旧部署的 Worker 不携带该字段） */
  accountScopedCleanup?: boolean;
}

/** /cleanup 的账号范围参数（R5 审计修复：多账号共享索引时的删除范围约定）。 */
export interface VectorCleanupOptions {
  /**
   * 仅删除 ID 以 `${accountPrefix}:` 开头的向量；其他账号前缀与 legacy 无前缀
   * 向量一律保留。缺省时 Worker 只清理 legacy 无前缀向量。
   */
  accountPrefix?: string | null;
  /**
   * 是否同时清理 legacy 无前缀向量（审计修复 C17）。
   * 仅在独立确认旧无前缀向量归属后才可为 true——例如通过旧部署记录/迁移
   * 清单确认该索引的 legacy 向量专属当前账号。本机仅有一个已保存账号不能
   * 作为归属已确认的依据：共享索引中可能仍有其他设备/旧客户端上传的
   * legacy 向量，无法由本机账号数证明其归属。
   */
  includeLegacy?: boolean;
  signal?: AbortSignal;
}

/**
 * 识别 AbortSignal（审计修复 C18）：`instanceof` 只认当前窗口的构造函数——
 * 跨窗口（iframe/弹窗）传来的 signal 不通过该检查，会被误当作选项对象。
 * 在 instanceof 之外叠加 duck-typing（aborted 布尔 + add/removeEventListener
 * 函数）识别跨窗口 AbortSignal。
 */
const isAbortSignalLike = (value: unknown): value is AbortSignal => (
  value instanceof AbortSignal
  || (
    typeof value === 'object'
    && value !== null
    && typeof (value as AbortSignal).aborted === 'boolean'
    && typeof (value as AbortSignal).addEventListener === 'function'
    && typeof (value as AbortSignal).removeEventListener === 'function'
    && typeof (value as AbortSignal).dispatchEvent === 'function'
  )
);

type VectorSearchServiceConfig = Pick<VectorSearchConfig, 'workerUrl' | 'authToken'>;

/**
 * Worker 请求错误（第 13 轮审计修复 [71]/[73]）：保留响应体中的稳定错误码
 * （如 ACCOUNT_METADATA_NOT_INDEXED——/status 探测通过后 Worker 仍可能在查询
 * 时回滚），查询管道据此识别「账号元数据索引未就绪」并把稠密召回标记为降级。
 */
export class WorkerRequestError extends Error {
  readonly code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'WorkerRequestError';
    if (code) this.code = code;
  }
}

/** 从 Worker 错误响应体（JSON 文本）中提取稳定错误码。 */
const parseWorkerErrorCode = (rawBody: string): string | undefined => {
  try {
    const parsed: unknown = JSON.parse(rawBody);
    const code = (parsed as { code?: unknown } | null)?.code;
    return typeof code === 'string' && code ? code : undefined;
  } catch {
    return undefined;
  }
};

export class VectorSearchService {
  private workerUrl: string;
  private authToken: string;

  constructor(config: VectorSearchServiceConfig) {
    this.workerUrl = config.workerUrl.replace(/\/+$/, '');
    this.authToken = config.authToken;
  }

  /**
   * 归一化后的 Worker 地址——账号范围迁移完成记录的绑定身份（第 12 轮审计
   * 修复）：切换向量 Worker 后旧记录不再豁免增量路径。
   */
  get workerId(): string {
    return this.workerUrl;
  }

  private async request<T>(path: string, options: RequestInit = {}, signal?: AbortSignal): Promise<T> {
    const url = `${this.workerUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.authToken}`,
      ...(options.headers as Record<string, string>),
    };

    const response = await fetch(url, { ...options, headers, signal });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new WorkerRequestError(`Worker error ${response.status}: ${errText}`, parseWorkerErrorCode(errText));
    }

    const data = await response.json();
    if (data.success === false) {
      const code = (data as { code?: unknown }).code;
      throw new WorkerRequestError(
        data.error || 'Unknown worker error',
        typeof code === 'string' && code ? code : undefined,
      );
    }
    return data as T;
  }

  /**
   * 批量 upsert 向量到 Vectorize
   */
  async upsert(vectors: VectorizeVector[], signal?: AbortSignal): Promise<{ upserted: number }> {
    return this.request<{ upserted: number }>('/upsert', {
      method: 'POST',
      body: JSON.stringify({ vectors }),
    }, signal);
  }

  /**
   * 向量相似度查询
   */
  async query(
    vector: number[],
    options: { topK?: number; threshold?: number; accountId?: string; wide: true },
    signal?: AbortSignal,
  ): Promise<VectorWideQueryResult[]>;
  async query(
    vector: number[],
    options?: { topK?: number; threshold?: number; accountId?: string; wide?: false },
    signal?: AbortSignal,
  ): Promise<VectorQueryResult[]>;
  async query(
    vector: number[],
    options?: { topK?: number; threshold?: number; accountId?: string; wide?: boolean },
    signal?: AbortSignal,
  ): Promise<VectorQueryResult[] | VectorWideQueryResult[]>;
  async query(
    vector: number[],
    options: { topK?: number; threshold?: number; accountId?: string; wide?: boolean } = {},
    signal?: AbortSignal,
  ): Promise<VectorQueryResult[] | VectorWideQueryResult[]> {
    const { topK = 20, threshold = 0.35, accountId, wide } = options;
    // 第 16 轮审计修复 [99]：显式传入空账号或纯空白时直接拒绝，避免退化为无范围查询；
    // 只有调用方未提供 accountId（undefined）时才保留旧的无范围兼容行为。
    if (accountId !== undefined) {
      if (typeof accountId !== 'string' || accountId.trim().length === 0) {
        throw new Error('accountId must be a non-empty string when provided');
      }
    }
    const result = await this.request<{ matches: VectorQueryResult[] }>('/query', {
      method: 'POST',
      // accountId 让 Worker 在 topK 之前按归属过滤（多账号共享索引）。
      // wide（第 15 轮审计修复 [20]）：宽候选池——Worker 改用
      // returnMetadata:'indexed' 以允许 topK > 50（旧版 Worker 会按原上限
      // 截断，向后兼容）；客户端只消费 metadata.accountId。
      body: JSON.stringify({
        vector,
        topK,
        threshold,
        ...(accountId !== undefined ? { accountId } : {}),
        ...(wide ? { wide: true } : {}),
      }),
    }, signal);
    return result.matches;
  }

  /**
   * 删除指定 ID 的向量
   */
  async delete(ids: string[], signal?: AbortSignal): Promise<{ deleted: number }> {
    return this.request<{ deleted: number }>('/delete', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }, signal);
  }

  /**
   * 清理不在 keepIds 列表中的向量（删除已 unstar 的仓库）。
   *
   * R5 审计修复：多账号共享同一 VECTORIZE 索引时必须携带账号范围——
   * `accountPrefix` 限定只删除当前账号前缀的向量（其他设备/其他账号的向量
   * 一律保留）；`includeLegacy` 默认应为 `false`，本机仅有一个已保存账号不足以
   * 证明共享索引中无前缀 legacy 向量的归属，只有独立确认归属后才可传入 true。
   * 两者都缺省时请求体与旧版客户端一致，Worker 保持旧行为：只删除 keepIds
   * 之外的纯数字 legacy ID，带账号前缀的向量一律保留。
   * 兼容旧签名 cleanup(keepIds, signal)。
   */
  async cleanup(keepIds: string[], options: VectorCleanupOptions | AbortSignal = {}): Promise<{ deleted: number; partial?: boolean }> {
    // 审计修复（C18）：跨窗口 AbortSignal 不依赖当前窗口构造函数识别，
    // 兼容旧签名 cleanup(keepIds, signal) 并转发给清理请求。
    const normalized: VectorCleanupOptions = isAbortSignalLike(options)
      ? { signal: options }
      : options ?? {};
    const { accountPrefix, includeLegacy, signal } = normalized;
    const body: Record<string, unknown> = { keepIds };
    // R2-C25：显式账号前缀必须非空。旧实现用 truthy 判断，空串会被静默省略，
    // 请求退化为旧版无范围清理（可能删除其他账号向量）——客户端直接拒绝。
    if (accountPrefix !== undefined && accountPrefix !== null) {
      if (typeof accountPrefix !== 'string' || accountPrefix.length === 0) {
        throw new Error('accountPrefix must be a non-empty string when provided');
      }
      body.accountPrefix = accountPrefix;
    }
    // 显式 false 也必须写入：省略会让 Worker 按旧版无范围请求处理。
    if (includeLegacy !== undefined) body.includeLegacy = includeLegacy;
    return this.request<{ deleted: number; partial?: boolean }>('/cleanup', {
      method: 'POST',
      body: JSON.stringify(body),
    }, signal);
  }

  /**
   * 获取索引状态
   */
  async getStatus(signal?: AbortSignal): Promise<VectorizeStatus> {
    return this.request<VectorizeStatus>('/status', {}, signal);
  }

  /**
   * 测试 Worker 连通性
   */
  async testConnection(): Promise<{ success: boolean; vectorCount: number; dimensions: number; accountScopedCleanup?: boolean; error?: string }> {
    try {
      const status = await this.getStatus();
      return {
        success: true,
        vectorCount: status.vectorCount,
        dimensions: status.dimensions,
        ...(status.accountScopedCleanup !== undefined ? { accountScopedCleanup: status.accountScopedCleanup } : {}),
      };
    } catch (error) {
      return {
        success: false,
        vectorCount: 0,
        dimensions: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

// ============================================================
// 工具函数
// ============================================================

/**
 * 嵌入文本格式版本。
 * buildEmbeddingText 的输出格式变化时必须递增，
 * 使增量索引能检测到格式变化并强制重新索引所有向量。
 *
 * 保持 v3 不变：单账号老用户升级后可直接沿用存量 v3 向量（免重新调 Embedding API），
 * 仅在添加多账号时通过多账号隔离路径按需重建索引。
 */
export const EMBEDDING_FORMAT_VERSION = 3;

// ============================================================
// 账号范围迁移状态（审计修复：与 v3 版本、vector_indexed_at 分开记录）
// ============================================================

const ACCOUNT_SCOPE_MIGRATION_KEY = 'gsm.vectorAccountScopeMigrationDone';
const ACCOUNT_WORKER_VECTOR_COUNTS_KEY = 'gsm.vectorAccountWorkerCounts';

/**
 * 单账号老用户升级到多账号后的账号范围迁移（第 16 轮审计修复 [47]）：
 * - 新格式按 `(accountId, workerId)` 记录已确认以带账号前缀 ID 成功写入目标 Worker
 *   的仓库 ID 集合（`{ workers: Record<string, number[]> }`）。
 *   这样即使首次迁移只包含仓库 1，之后后端同步引入带有旧 `vector_indexed_at` 的仓库 2，
 *   增量索引仍会识别仓库 2 尚未在当前 Worker 确认补写，自动将其纳入补写候选，
 *   同时不会对已确认的仓库 1 重复生成 embedding。
 * - 兼容读取旧格式 `Record<string, string>`（整账号绑定单个 workerId，记入 `legacyWorkerId`），
 *   避免已有旧持久化记录或测试夹具失效。
 */
interface AccountScopeMigrationEntry {
  legacyWorkerId?: string;
  workers: Record<string, number[]>;
}
type AccountScopeMigrationStore = Record<string, AccountScopeMigrationEntry>;

/**
 * 会话内迁移完成记录（第 13 轮审计修复 [22]）：localStorage 写入失败（隐私
 * 模式/配额）时退化为会话内标记——迁移成功后先同步更新内存，再尝试持久化；
 * 读取路径合并内存与持久化记录，使写入失败后本次会话的后续增量索引仍能
 * 识别已完成迁移，不会对全部已分析仓库重复生成 Embedding。
 */
let inMemoryMigrationStore: AccountScopeMigrationStore = {};

const sanitizeRepoIdList = (raw: unknown): number[] => {
  if (!Array.isArray(raw)) return [];
  const unique = new Set<number>();
  for (const item of raw) {
    if (typeof item === 'number' && Number.isInteger(item)) {
      unique.add(item);
    }
  }
  return [...unique];
};

const readPersistedMigrationStore = (): AccountScopeMigrationStore => {
  try {
    const raw = localStorage.getItem(ACCOUNT_SCOPE_MIGRATION_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const record = parsed as Record<string, unknown>;
    const result: AccountScopeMigrationStore = {};
    for (const [accountId, value] of Object.entries(record)) {
      if (!accountId) continue;
      if (typeof value === 'string') {
        result[accountId] = { legacyWorkerId: value, workers: {} };
        continue;
      }
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const obj = value as { legacyWorkerId?: unknown; workers?: unknown };
      const workers: Record<string, number[]> = {};
      if (obj.workers && typeof obj.workers === 'object' && !Array.isArray(obj.workers)) {
        for (const [workerKey, ids] of Object.entries(obj.workers as Record<string, unknown>)) {
          const cleanIds = sanitizeRepoIdList(ids);
          if (cleanIds.length > 0) workers[workerKey] = cleanIds;
        }
      }
      const entry: AccountScopeMigrationEntry = { workers };
      if (typeof obj.legacyWorkerId === 'string') {
        entry.legacyWorkerId = obj.legacyWorkerId;
      }
      if (entry.legacyWorkerId !== undefined || Object.keys(workers).length > 0) {
        result[accountId] = entry;
      }
    }
    return result;
  } catch {
    return {};
  }
};

const mergeMigrationEntries = (
  base: AccountScopeMigrationEntry | undefined,
  overlay: AccountScopeMigrationEntry | undefined,
): AccountScopeMigrationEntry | undefined => {
  if (!base) return overlay;
  if (!overlay) return base;
  const workers: Record<string, number[]> = {};
  for (const [workerKey, ids] of Object.entries(base.workers)) {
    workers[workerKey] = [...ids];
  }
  for (const [workerKey, ids] of Object.entries(overlay.workers)) {
    workers[workerKey] = [...new Set([...(workers[workerKey] ?? []), ...ids])];
  }
  return {
    ...(overlay.legacyWorkerId !== undefined
      ? { legacyWorkerId: overlay.legacyWorkerId }
      : base.legacyWorkerId !== undefined
        ? { legacyWorkerId: base.legacyWorkerId }
        : {}),
    workers,
  };
};

const readMigrationStore = (): AccountScopeMigrationStore => {
  const persisted = readPersistedMigrationStore();
  const result: AccountScopeMigrationStore = { ...persisted };
  for (const [accountId, entry] of Object.entries(inMemoryMigrationStore)) {
    const merged = mergeMigrationEntries(result[accountId], entry);
    if (merged) result[accountId] = merged;
  }
  return result;
};

const persistMigrationStore = (store: AccountScopeMigrationStore): void => {
  try {
    localStorage.setItem(ACCOUNT_SCOPE_MIGRATION_KEY, JSON.stringify(store));
  } catch {
    // 存储不可用（隐私模式/配额）时退化为会话内标记（内存记录已同步更新）
  }
};

/**
 * 判断指定仓库在 `(accountId, workerId)` 上是否已确认完成账号范围迁移。
 * 无账号上下文时返回 true（匿名 legacy 路径）。
 */
export function isRepoAccountScopeMigrated(
  accountId: string | null | undefined,
  repoId: number,
  workerId?: string | null,
): boolean {
  if (!accountId) return true;
  const entry = readMigrationStore()[accountId];
  if (!entry) return false;
  if (typeof workerId === 'string' && workerId) {
    if (entry.workers[workerId]?.includes(repoId)) return true;
    return entry.legacyWorkerId !== undefined && entry.legacyWorkerId === workerId;
  }
  if (Object.values(entry.workers).some((ids) => ids.includes(repoId))) return true;
  return entry.legacyWorkerId !== undefined;
}

/**
 * 该账号是否已有针对目标 Worker 的账号范围迁移完成记录。
 * `workerId` 为当前向量 Worker 的绑定身份（归一化 workerUrl）；无法确定
 * Worker 身份（老调用方/测试桩）时退回仅按账号判断的旧行为。
 */
export function isAccountScopeMigrationDone(
  accountId: string | null | undefined,
  workerId?: string | null,
): boolean {
  if (!accountId) return true;
  const entry = readMigrationStore()[accountId];
  if (!entry) return false;
  if (typeof workerId === 'string' && workerId) {
    if ((entry.workers[workerId]?.length ?? 0) > 0) return true;
    return entry.legacyWorkerId !== undefined && entry.legacyWorkerId === workerId;
  }
  if (Object.values(entry.workers).some((ids) => ids.length > 0)) return true;
  return entry.legacyWorkerId !== undefined;
}

function markAccountScopeReposMigrated(accountId: string, workerId: string | null | undefined, repoIds: number[]): void {
  if (!accountId || repoIds.length === 0) return;
  const workerKey = typeof workerId === 'string' && workerId ? workerId : '';
  const store = readMigrationStore();
  const existing = store[accountId] ?? { workers: {} };
  const mergedIds = [...new Set([...(existing.workers[workerKey] ?? []), ...repoIds])];
  const nextEntry: AccountScopeMigrationEntry = {
    ...(existing.legacyWorkerId !== undefined ? { legacyWorkerId: existing.legacyWorkerId } : {}),
    workers: { ...existing.workers, [workerKey]: mergedIds },
  };
  // 第 13 轮审计修复 [22]：先同步更新内存记录（localStorage 写入失败时会话内
  // 标记仍然生效），再尝试持久化；仅在上传成功后被调用，上传失败保持未完成。
  inMemoryMigrationStore[accountId] = mergeMigrationEntries(inMemoryMigrationStore[accountId], nextEntry) ?? nextEntry;
  persistMigrationStore({ ...store, [accountId]: nextEntry });
}

/** 仅供测试：清空会话内迁移完成记录，模拟一次全新的应用启动。 */
export const __resetInMemoryAccountScopeMigrationForTest = (): void => {
  inMemoryMigrationStore = {};
};

// ============================================================
// 按 (账号, Worker) 隔离的向量计数（第 16 轮审计修复 [101]）
// ============================================================

let inMemoryAccountWorkerCounts: Record<string, number> = {};

const buildAccountWorkerCountKey = (
  accountId: string | null | undefined,
  workerId: string | null | undefined,
): string => `${accountId ?? ''}::${(workerId ?? '').trim().replace(/\/+$/, '')}`;

const readPersistedAccountWorkerCounts = (): Record<string, number> => {
  try {
    const raw = localStorage.getItem(ACCOUNT_WORKER_VECTOR_COUNTS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        result[key] = Math.floor(value);
      }
    }
    return result;
  } catch {
    return {};
  }
};

const readAccountWorkerCounts = (): Record<string, number> => ({
  ...readPersistedAccountWorkerCounts(),
  ...inMemoryAccountWorkerCounts,
});

export function getAccountWorkerVectorCount(
  accountId: string | null | undefined,
  workerId: string | null | undefined,
): number | undefined {
  const counts = readAccountWorkerCounts();
  const key = buildAccountWorkerCountKey(accountId, workerId);
  return Object.prototype.hasOwnProperty.call(counts, key) ? counts[key] : undefined;
}

export function hasAnyAccountWorkerVectorCount(): boolean {
  return Object.keys(readAccountWorkerCounts()).length > 0;
}

export function setAccountWorkerVectorCount(
  accountId: string | null | undefined,
  workerId: string | null | undefined,
  count: number,
): void {
  const key = buildAccountWorkerCountKey(accountId, workerId);
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  inMemoryAccountWorkerCounts[key] = safeCount;
  try {
    const next = { ...readPersistedAccountWorkerCounts(), ...inMemoryAccountWorkerCounts };
    localStorage.setItem(ACCOUNT_WORKER_VECTOR_COUNTS_KEY, JSON.stringify(next));
  } catch {
    // 存储不可用时保留内存记录
  }
}

export const __resetAccountWorkerVectorCountsForTest = (): void => {
  inMemoryAccountWorkerCounts = {};
  try {
    localStorage.removeItem(ACCOUNT_WORKER_VECTOR_COUNTS_KEY);
  } catch {
    // ignore
  }
};

/**
 * 拼接仓库文本用于 embedding
 * @param repo 仓库数据
 * @param readmeContent README 内容（可选）
 * @param maxChars README 最大字符数，默认 6000
 */
export function buildEmbeddingText(repo: Repository, readmeContent?: string, maxChars = 6000): string {
  const parts: string[] = [];

  // 结构化字段标签，帮助 embedding 模型理解字段角色和权重
  if (repo.full_name) parts.push(`Repository: ${repo.full_name}`);

  // 去重：description 和 ai_summary 内容重叠时，跳过较短的 description
  const description = repo.description || '';
  const aiSummary = repo.ai_summary || '';
  const customDesc = repo.custom_description || '';

  if (description && !aiSummary.includes(description)) {
    parts.push(`Description: ${description}`);
  }
  if (customDesc) parts.push(`About: ${customDesc}`);
  if (aiSummary) parts.push(`Summary: ${aiSummary}`);

  // 合并 topics 和 tags，去重
  const allTopics = [...new Set([
    ...(repo.topics || []),
    ...(repo.ai_tags || []),
    ...(repo.custom_tags || []),
  ])];
  if (allTopics.length > 0) parts.push(`Topics: ${allTopics.join(', ')}`);

  if (repo.language) parts.push(`Language: ${repo.language}`);
  // 开源许可：先归一化，避免 raw GitHub 对象变成 "[object Object]" 污染 embedding；
  // 哨兵（无/未声明）不写入，与 null/缺失保持同一语义。
  {
    const lic = normalizeLicense(repo.license);
    if (lic !== NO_LICENSE_SENTINEL) parts.push(`License: ${lic}`);
  }

  // README 内容提供最丰富的语义信息
  if (readmeContent) {
    const cleaned = readmeContent
      .replace(/\[!\[.*?\]\(.*?\)\]\(.*?\)/g, '') // 移除链接徽章 [![...](...)](...) — 必须在图片之前
      .replace(/!\[.*?\]\(.*?\)/g, '') // 移除图片/徽章 ![...](...)
      .replace(/<[^>]+>/g, ' ') // 移除 HTML 标签
      .replace(/\n{3,}/g, '\n\n') // 压缩多余空行
      .trim();
    const truncated = cleaned.slice(0, maxChars);
    if (truncated) parts.push(`README:\n${truncated}`);
  }
  return parts.join('\n');
}

/**
 * 判断单个仓库是否需要重新向量索引（增量谓词的权威实现）。
 *
 * 以下任一成立即视为需要重索引：
 *  - 从未索引（`vector_indexed_at` 缺失）；
 *  - embedding 格式版本升级（由调用方据 `formatVersionChanged` 传入）；
 *  - 内容时间（`last_edited` 与 `analyzed_at` 中较新者）晚于上次索引时间；
 *  - license 变化（归一化后比对 `vector_indexed_license` 与 `license`）。
 *
 * 该模块与 `VectorSearchSettings.tsx` 的 `unindexedCount` / `attemptedCount` 谓词
 * 必须保持一致，故统一抽取为可选导出供复用，避免三处副本分别漂移。
 */
export function needsReindex(repo: Pick<Repository, 'last_edited' | 'analyzed_at' | 'license' | 'vector_indexed_at' | 'vector_indexed_license'>, formatVersionChanged: boolean): boolean {
  if (!repo.vector_indexed_at) return true; // 从未索引
  if (formatVersionChanged) return true; // 格式版本升级，需要重新索引
  // 取 last_edited 与 analyzed_at 中较新者作为内容时间，更新后需要重新索引
  const contentTime = [repo.last_edited, repo.analyzed_at]
    .filter((t): t is string => !!t)
    .sort()
    .pop() || '';
  if (contentTime > repo.vector_indexed_at) return true;
  // license 变化（归一化后比对）：GitHub 同步可能仅更新 license 而 last_edited 不变，
  // 此时向量元数据与嵌入文本中的 License 字段会过时，故需重新索引。
  return normalizeLicense(repo.vector_indexed_license ?? null) !== normalizeLicense(repo.license ?? null);
}

/**
 * indexAllRepos 的候选选择规则（唯一实现，UI 计数与 license 标记共用）：
 * 分析过滤 → 增量模式按 needsReindex 过滤 → 同一 id 只保留首条。去重放在
 * 增量过滤之后，使未变化的重复记录不会遮蔽已更新的记录。
 */
export function selectIndexableRepos(
  repos: Repository[],
  options: {
    incremental?: boolean;
    formatVersion?: number;
    currentFormatVersion?: number;
    accountId?: string | null;
    workerId?: string | null;
  } = {},
): Repository[] {
  let indexable = repos.filter((r) => r.analyzed_at && !r.analysis_failed);
  if (options.incremental) {
    // 嵌入文本格式版本变化时，强制重新索引所有向量以避免混合格式
    // 缺失版本号视为 v1（旧格式），仍需触发升级
    const formatVersionChanged = (options.formatVersion ?? 1) < (options.currentFormatVersion ?? EMBEDDING_FORMAT_VERSION);
    indexable = indexable.filter((r) => (
      needsReindex(r, formatVersionChanged)
      || (!!options.accountId && !isRepoAccountScopeMigrated(options.accountId, r.id, options.workerId))
    ));
  }
  const seenRepoIds = new Set<number>();
  return indexable.filter((r) => {
    if (seenRepoIds.has(r.id)) return false;
    seenRepoIds.add(r.id);
    return true;
  });
}

/**
 * 全量/增量重建向量索引
 * 遍历已分析仓库，分批生成 embedding 并 upsert 到 Worker
 * @param readmeFetcher 可选：获取仓库 README 内容的函数 (owner, repo) => content
 */
export interface IndexProgress {
  phase: 'readme' | 'embedding' | 'uploading';
  done: number;
  total: number;
}

/**
 * 判断 embedding 错误是否属于"输入过长"类（如硅基流动 20015）。
 * 这类错误的特点是：batch 中某一条超 token 限制导致整批失败，
 * 可以通过降级为逐条 embed 来隔离出真正超限的那条。
 * 只匹配明确的长度/token 关键词，避免把通用 400/配置错误误判为可重试。
 */
export function looksLikeLengthError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /\b20015\b/.test(msg) ||
    /input length/i.test(msg) ||
    /maximum token/i.test(msg) ||
    /token limit/i.test(msg) ||
    /too long/i.test(msg)
  );
}

/**
 * 对文本做截断，保留下限 256 字符。
 */
export function truncateForRetry(text: string, maxChars: number): string {
  return text.slice(0, Math.max(256, Math.min(text.length, maxChars)));
}

/**
 * 批量 embed，带单条失败隔离 + 截断重试。
 * - 正常路径：一次 batch 调用，快。
 * - 若 batch 抛出"长度类"错误：降级为逐条 embed，只让真正超限的那条失败。
 * - 非 length 错误（auth/5xx/网络）：直接 rethrow，交由上层整批失败处理。
 * 返回稀疏数组：成功位置为向量，彻底失败的位置为 null。
 */
export async function embedWithFallback(
  texts: string[],
  embeddingClient: EmbeddingClient,
  signal: AbortSignal | undefined,
  retryMaxChars: number
): Promise<(number[] | null)[]> {
  // 快路径：尝试整批
  try {
    if (signal?.aborted) throw new Error('Aborted');
    const vectors = await embeddingClient.embed(texts, 'document', signal);
    if (Array.isArray(vectors) && vectors.length >= texts.length) {
      return vectors.slice(0, texts.length);
    }
    throw new Error(`Embedding API returned ${vectors?.length ?? 0} vectors for ${texts.length} texts`);
  } catch (err) {
    if (signal?.aborted || (err instanceof Error && err.message === 'Aborted')) {
      throw new Error('Aborted');
    }
    // 仅对"长度类"错误降级为逐条；其他错误整批失败
    if (!looksLikeLengthError(err)) {
      throw err;
    }
  }

  // 慢路径：逐条 embed，单条超限则截断重试
  const results: (number[] | null)[] = new Array(texts.length).fill(null);
  for (let i = 0; i < texts.length; i++) {
    if (signal?.aborted) throw new Error('Aborted');
    const original = texts[i];
    // 截断重试阶梯：每步严格递减，保留下限 256
    const firstLimit = Math.max(256, Math.min(retryMaxChars, Math.floor(original.length / 2)));
    const secondLimit = Math.max(256, Math.floor(firstLimit / 2));
    const candidates = [
      original,
      truncateForRetry(original, firstLimit),
      truncateForRetry(original, secondLimit),
    ].filter((c, idx, arr) => idx === 0 || c.length < (arr[idx - 1]?.length ?? Infinity));
    let succeeded = false;
    for (const candidate of candidates) {
      if (!candidate) { succeeded = true; break; } // 空文本直接跳过
      try {
        const v = await embeddingClient.embed([candidate], 'document', signal);
        if (Array.isArray(v) && v.length === 1 && Array.isArray(v[0])) {
          results[i] = v[0];
          succeeded = true;
          break;
        }
      } catch (err) {
        if (signal?.aborted || (err instanceof Error && err.message === 'Aborted')) {
          throw new Error('Aborted');
        }
        // 仍是 length 错误 → 尝试更短的候选；非长度错误（5xx/network/auth）立即抛出
        if (!looksLikeLengthError(err)) {
          throw err;
        }
      }
    }
    if (!succeeded) {
      results[i] = null;
    }
  }
  return results;
}

export async function indexAllRepos(
  repos: Repository[],
  embeddingClient: EmbeddingClient,
  vectorService: VectorSearchService,
  options: {
    batchSize?: number;
    onProgress?: (progress: IndexProgress) => void;
    signal?: AbortSignal;
    readmeFetcher?: (owner: string, repo: string, signal?: AbortSignal) => Promise<string>;
    indexMode?: 'description' | 'readme';
    readmeMaxChars?: number;
    incremental?: boolean;
    onRepoIndexed?: (repoId: number) => void;
    /** 当前存储的格式版本号 */
    formatVersion?: number;
    /** 最新格式版本号（EMBEDDING_FORMAT_VERSION） */
    currentFormatVersion?: number;
    /**
     * 归属账号（GitHub 数值 ID 字符串）。多账号共享同一向量索引时必须提供：
     * 向量 ID 以账号为前缀、metadata 记录归属，避免不同账号互相覆盖/泄漏。
     * 未提供（未登录边缘态）时退回 legacy 无前缀 ID（见
     * buildAccountScopedVectorId 的兼容策略）。
     */
    accountId?: string | null;
  } = {}
): Promise<{ indexed: number; skipped: number; errors: number; error?: string; indexedRepoIds: number[] }> {
  const { batchSize = 32, onProgress, signal, readmeFetcher, indexMode = 'readme', readmeMaxChars = 6000, incremental, onRepoIndexed, accountId } = options;

  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error('batchSize must be a positive integer');
  }

  // 账号范围迁移（第 16 轮审计修复 [47]）：按 (accountId, workerId, repoId) 逐仓
  // 判断是否已确认带账号前缀写入目标 Worker；即使先前快照只迁移了仓库 1，之后后端
  // 同步进来的带旧 vector_indexed_at 的仓库 2 也会自动进入补写候选，且不重嵌仓库 1。
  const workerId = typeof vectorService.workerId === 'string' && vectorService.workerId
    ? vectorService.workerId
    : null;
  const indexable = selectIndexableRepos(repos, {
    incremental: incremental === true,
    formatVersion: options.formatVersion,
    currentFormatVersion: options.currentFormatVersion,
    accountId,
    workerId,
  });
  let indexed = 0;
  let errors = 0;
  let lastError = '';
  const indexedRepoIds: number[] = [];

  // 仅在 readme 模式下获取 README 内容
  const shouldFetchReadme = indexMode === 'readme' && readmeFetcher;
  const readmeCache = new Map<string, string>();
  if (shouldFetchReadme) {
    const CONCURRENCY = 5;
    let completed = 0;

    for (let i = 0; i < indexable.length; i += CONCURRENCY) {
      if (signal?.aborted) throw new Error('Aborted');

      const batch = indexable.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (repo) => {
          const [owner, name] = repo.full_name.split('/');
          const readme = await readmeFetcher(owner, name, signal);
          return { fullName: repo.full_name, readme };
        })
      );

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value.readme) {
          readmeCache.set(result.value.fullName, result.value.readme);
        }
      }

      completed = Math.min(completed + batch.length, indexable.length);
      onProgress?.({ phase: 'readme', done: completed, total: indexable.length });
    }
  }

  const totalBatches = Math.ceil(indexable.length / batchSize);
  for (let i = 0; i < indexable.length; i += batchSize) {
    if (signal?.aborted) {
      throw new Error('Aborted');
    }

    const batch = indexable.slice(i, i + batchSize);
    const texts = batch.map(repo => buildEmbeddingText(repo, readmeCache.get(repo.full_name), readmeMaxChars));

    try {
      // 1. 调用 Embedding API 生成向量（带单条失败隔离 + 截断重试）
      //    长度类错误（如硅基流动 20015）会降级为逐条 embed，避免整批失败
      const vectors = await embedWithFallback(texts, embeddingClient, signal, readmeMaxChars);

      // 2. 组装成功项的 Vectorize 格式（跳过 null 的失败项）
      const vectorizeVectors: VectorizeVector[] = [];
      // R5 审计修复（CodeRabbit 发现 4）：构造向量的同时记录每个成功向量对应的
      // 仓库 ID——embedding 失败的项（null）不入列，两者的下标一一对应。此前
      // upsertedCount 回调直接取 batch[j].id，当批内存在失败项时会把「失败仓库」
      // 报告为已上传（调用方写入 vector_indexed_at，增量索引永久跳过它），而
      // 真正上传成功的仓库反而没有标记。
      const vectorizeRepoIds: number[] = [];
      let batchErrors = 0;
      for (let j = 0; j < batch.length; j++) {
        const vec = vectors[j];
        if (vec && Array.isArray(vec)) {
          vectorizeVectors.push({
            // 账号隔离（R4 审计修复）：多账号共享索引时按账号前缀区分向量，
            // metadata 同步记录归属账号，查询侧据此过滤
            id: buildAccountScopedVectorId(accountId, batch[j].id),
            values: vec,
            metadata: {
              full_name: batch[j].full_name,
              description: batch[j].description || '',
              language: batch[j].language || '',
              stars: batch[j].stargazers_count || 0,
              tags: batch[j].ai_tags || [],
              // 历史/导入数据 license 可能是 GitHub 对象或数字；统一经 normalizeLicense
              // 降为 SPDX id / 哨兵，避免把 "[object Object]" 写入向量元数据。
              license: normalizeLicense(batch[j].license),
              // 第 13 轮跨域接缝（server 域 [68]）：未登录（accountId 缺省）的上传
              // 统一以 'default' 记入 metadata.accountId——服务端按归属投影候选时
              // 匿名向量不再无法归属。仅写 metadata，不改向量 ID 形态（保持
              // legacy 无前缀 ID，server 侧候选投影无需放行新前缀）。
              accountId: accountId ?? 'default',
            },
          });
          vectorizeRepoIds.push(batch[j].id);
        } else {
          batchErrors++;
        }
      }

      // 3. upsert 到 Worker（仅当有成功向量时）
      //    Vectorize upsert 是原子的，但用返回的 upserted 数量计数更严谨
      const currentBatch = Math.floor(i / batchSize) + 1;
      if (vectorizeVectors.length > 0) {
        onProgress?.({ phase: 'uploading', done: currentBatch, total: totalBatches });
        const upsertResult = await vectorService.upsert(vectorizeVectors, signal);
        const upsertedCount = typeof upsertResult?.upserted === 'number'
          ? Math.min(upsertResult.upserted, vectorizeVectors.length)
          : vectorizeVectors.length;
        indexed += upsertedCount;
        // 仅标记确认 upserted 的 repo（按 vectorizeRepoIds 的顺序，即成功向量
        // 的构造顺序）。全批成功时该列表与 batch 的 id 顺序一致，保持既有报告
        // 顺序；有失败项时失败仓库不会被报告——向量 ID 带账号前缀后不能再
        // parseInt(id)（前缀非数字会得到 NaN）。
        for (let j = 0; j < upsertedCount; j++) {
          const repoId = vectorizeRepoIds[j];
          indexedRepoIds.push(repoId);
          onRepoIndexed?.(repoId);
        }
        // 若 worker 返回的 upserted 少于发送数，差额计入 errors
        const notUpserted = vectorizeVectors.length - upsertedCount;
        if (notUpserted > 0) {
          batchErrors += notUpserted;
        }
      }
      if (batchErrors > 0) {
        errors += batchErrors;
        lastError = `${batchErrors} text(s) failed embedding (likely over token limit)`;
      }
    } catch (err) {
      if (signal?.aborted || (err instanceof Error && err.message === 'Aborted')) {
        throw new Error('Aborted');
      }
      lastError = err instanceof Error ? err.message : String(err);
      console.error(`Batch ${i}-${i + batch.length} failed:`, err);
      errors += batch.length;
    }

    const currentBatch = Math.floor(i / batchSize) + 1;
    onProgress?.({ phase: 'embedding', done: currentBatch, total: totalBatches });
  }

  // 迁移完成的判定（第 16 轮审计修复 [47]）：按 (accountId, workerId) 记录已确认
  // 成功写入的仓库 ID，而非用一次快照标记整个账号完成。若本轮存在带旧
  // vector_indexed_at 的候选仓库失败，则暂不提交本次确认记录，下次运行继续补写。
  if (accountId && indexedRepoIds.length > 0) {
    const indexedIdSet = new Set(indexedRepoIds);
    const failedLegacyIndexed = indexable.some((repo) => !indexedIdSet.has(repo.id) && !!repo.vector_indexed_at);
    if (!failedLegacyIndexed) {
      markAccountScopeReposMigrated(accountId, workerId, indexedRepoIds);
    }
  }

  return { indexed, skipped: repos.length - indexable.length, errors, error: lastError || undefined, indexedRepoIds };
}
