/**
 * 向量语义搜索服务
 *
 * 1. EmbeddingClient — 调用用户配置的 Embedding API 生成向量
 * 2. VectorSearchService — 与 Cloudflare Worker 通信（存/查/删向量）
 */

import type { EmbeddingConfig, VectorSearchConfig, Repository } from '../types';

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

export interface VectorizeVector {
  id: string;
  values: number[];
  metadata: {
    full_name: string;
    description: string;
    language: string;
    stars: number;
    tags: string[];
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
  };
}

export interface VectorizeStatus {
  vectorCount: number;
  dimensions: number;
  indexName?: string;
}

export class VectorSearchService {
  private workerUrl: string;
  private authToken: string;

  constructor(config: VectorSearchConfig) {
    this.workerUrl = config.workerUrl.replace(/\/+$/, '');
    this.authToken = config.authToken;
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
      throw new Error(`Worker error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    if (data.success === false) {
      throw new Error(data.error || 'Unknown worker error');
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
    options: { topK?: number; threshold?: number } = {},
    signal?: AbortSignal,
  ): Promise<VectorQueryResult[]> {
    const { topK = 20, threshold = 0.3 } = options;
    const result = await this.request<{ matches: VectorQueryResult[] }>('/query', {
      method: 'POST',
      body: JSON.stringify({ vector, topK, threshold }),
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
   * 清理不在 keepIds 列表中的向量（删除已 unstar 的仓库）
   */
  async cleanup(keepIds: string[], signal?: AbortSignal): Promise<{ deleted: number }> {
    return this.request<{ deleted: number }>('/cleanup', {
      method: 'POST',
      body: JSON.stringify({ keepIds }),
    }, signal);
  }

  /**
   * 获取索引状态
   */
  async getStatus(): Promise<VectorizeStatus> {
    return this.request<VectorizeStatus>('/status');
  }

  /**
   * 测试 Worker 连通性
   */
  async testConnection(): Promise<{ success: boolean; vectorCount: number; dimensions: number; error?: string }> {
    try {
      const status = await this.getStatus();
      return {
        success: true,
        vectorCount: status.vectorCount,
        dimensions: status.dimensions,
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
 * 拼接仓库文本用于 embedding
 * @param repo 仓库数据
 * @param readmeContent README 内容（可选）
 * @param maxChars README 最大字符数，默认 6000
 */
export function buildEmbeddingText(repo: Repository, readmeContent?: string, maxChars = 6000): string {
  const parts = [
    repo.full_name,
    repo.description || '',
    repo.custom_description || '',
    repo.ai_summary || '',
    (repo.topics || []).join(', '),
    (repo.ai_tags || []).join(', '),
    (repo.custom_tags || []).join(', '),
    repo.language || '',
  ];
  // README 内容提供最丰富的语义信息
  // 跳过常见的装饰性徽章/图片头部
  if (readmeContent) {
    const cleaned = readmeContent
      .replace(/\[!\[.*?\]\(.*?\)\]\(.*?\)/g, '') // 移除链接徽章 [![...](...)](...) — 必须在图片之前
      .replace(/!\[.*?\]\(.*?\)/g, '') // 移除图片/徽章 ![...](...)
      .replace(/<[^>]+>/g, ' ') // 移除 HTML 标签
      .replace(/\n{3,}/g, '\n\n') // 压缩多余空行
      .trim();
    const truncated = cleaned.slice(0, maxChars);
    if (truncated) parts.push(truncated);
  }
  return parts.filter(Boolean).join('\n');
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
 * 对最终拼接好的文本做二次截断用于重试。
 * 逐级折半直到不超过 maxChars。
 */
export function truncateForRetry(text: string, maxChars: number): string {
  // 已经够短，无需截断
  if (text.length <= maxChars) return text;
  // 逐级折半 maxChars 直到：要么 text 能放下，要么触达 256 下限
  let limit = maxChars;
  while (limit > 256 && text.length > limit) {
    limit = Math.floor(limit / 2);
  }
  return text.slice(0, Math.max(256, limit));
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
    // 截断重试阶梯：原始 → 折半 → 再折半
    const candidates = [
      original,
      truncateForRetry(original, retryMaxChars),
      truncateForRetry(original, Math.floor(retryMaxChars / 2)),
    ];
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
  } = {}
): Promise<{ indexed: number; skipped: number; errors: number; error?: string; indexedRepoIds: number[] }> {
  const { batchSize = 32, onProgress, signal, readmeFetcher, indexMode = 'readme', readmeMaxChars = 6000, incremental, onRepoIndexed } = options;

  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error('batchSize must be a positive integer');
  }

  // 只索引已分析且未失败的仓库
  let indexable = repos.filter((r) => r.analyzed_at && !r.analysis_failed);
  // 增量模式下跳过已索引且内容未更新的仓库
  if (incremental) {
    indexable = indexable.filter((r) => {
      if (!r.vector_indexed_at) return true; // 从未索引
      // 取 last_edited 与 analyzed_at 中较新者作为内容时间，更新后需要重新索引
      const contentTime = [r.last_edited, r.analyzed_at]
        .filter((t): t is string => !!t)
        .sort()
        .pop() || '';
      return contentTime > r.vector_indexed_at;
    });
  }
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
      let batchErrors = 0;
      for (let j = 0; j < batch.length; j++) {
        const vec = vectors[j];
        if (vec && Array.isArray(vec)) {
          vectorizeVectors.push({
            id: String(batch[j].id),
            values: vec,
            metadata: {
              full_name: batch[j].full_name,
              description: batch[j].description || '',
              language: batch[j].language || '',
              stars: batch[j].stargazers_count || 0,
              tags: batch[j].ai_tags || [],
            },
          });
        } else {
          batchErrors++;
        }
      }

      // 3. upsert 到 Worker（仅当有成功向量时）
      const currentBatch = Math.floor(i / batchSize) + 1;
      if (vectorizeVectors.length > 0) {
        onProgress?.({ phase: 'uploading', done: currentBatch, total: totalBatches });
        await vectorService.upsert(vectorizeVectors, signal);
        indexed += vectorizeVectors.length;
        for (const vec of vectorizeVectors) {
          const repoId = parseInt(vec.id, 10);
          indexedRepoIds.push(repoId);
          onRepoIndexed?.(repoId);
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

  return { indexed, skipped: repos.length - indexable.length, errors, error: lastError || undefined, indexedRepoIds };
}
