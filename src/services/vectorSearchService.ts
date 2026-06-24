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
 * @param readmeContent README 内容（可选，截取前 6000 字符，跳过装饰性头部）
 */
export function buildEmbeddingText(repo: Repository, readmeContent?: string): string {
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
  // 截取前 6000 字符，跳过常见的装饰性徽章/图片头部
  if (readmeContent) {
    const cleaned = readmeContent
      .replace(/!\[.*?\]\(.*?\)/g, '') // 移除图片/徽章 ![...](...)
      .replace(/\[!\[.*?\]\(.*?\)\]\(.*?\)/g, '') // 移除链接徽章 [![...](...)](...)
      .replace(/<[^>]+>/g, ' ') // 移除 HTML 标签
      .replace(/\n{3,}/g, '\n\n') // 压缩多余空行
      .trim();
    const truncated = cleaned.slice(0, 6000);
    if (truncated) parts.push(truncated);
  }
  return parts.filter(Boolean).join('\n');
}

/**
 * 全量重建向量索引
 * 遍历所有已分析仓库，分批生成 embedding 并 upsert 到 Worker
 * @param readmeFetcher 可选：获取仓库 README 内容的函数 (owner, repo) => content
 */
export async function indexAllRepos(
  repos: Repository[],
  embeddingClient: EmbeddingClient,
  vectorService: VectorSearchService,
  options: {
    batchSize?: number;
    onProgress?: (done: number, total: number) => void;
    signal?: AbortSignal;
    readmeFetcher?: (owner: string, repo: string, signal?: AbortSignal) => Promise<string>;
  } = {}
): Promise<{ indexed: number; skipped: number; errors: number }> {
  const { batchSize = 100, onProgress, signal, readmeFetcher } = options;

  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error('batchSize must be a positive integer');
  }

  // 只索引已分析且未失败的仓库
  const indexable = repos.filter((r) => r.analyzed_at && !r.analysis_failed);
  let indexed = 0;
  let errors = 0;

  // 预先批量获取 README 内容（如果提供了 fetcher）
  const readmeCache = new Map<string, string>();
  if (readmeFetcher) {
    for (const repo of indexable) {
      if (signal?.aborted) throw new Error('Aborted');
      try {
        const [owner, name] = repo.full_name.split('/');
        const readme = await readmeFetcher(owner, name, signal);
        if (readme) readmeCache.set(repo.full_name, readme);
      } catch {
        // README 获取失败不影响索引
      }
    }
  }

  for (let i = 0; i < indexable.length; i += batchSize) {
    if (signal?.aborted) {
      throw new Error('Aborted');
    }

    const batch = indexable.slice(i, i + batchSize);
    const texts = batch.map(repo => buildEmbeddingText(repo, readmeCache.get(repo.full_name)));

    try {
      // 1. 调用 Embedding API 生成向量
      const vectors = await embeddingClient.embed(texts, 'document', signal);

      // Validate that the embedding API returned the expected number of vectors
      if (!Array.isArray(vectors) || vectors.length < batch.length) {
        throw new Error(
          `Embedding API returned ${vectors?.length ?? 0} vectors for ${batch.length} texts`
        );
      }

      // 2. 组装 Vectorize 格式
      const vectorizeVectors: VectorizeVector[] = batch.map((repo, j) => ({
        id: String(repo.id),
        values: vectors[j],
        metadata: {
          full_name: repo.full_name,
          description: repo.description || '',
          language: repo.language || '',
          stars: repo.stargazers_count || 0,
          tags: repo.ai_tags || [],
        },
      }));

      // 3. upsert 到 Worker
      await vectorService.upsert(vectorizeVectors, signal);
      indexed += batch.length;
    } catch (err) {
      if (signal?.aborted || (err instanceof Error && err.message === 'Aborted')) {
        throw new Error('Aborted');
      }
      console.error(`Batch ${i}-${i + batch.length} failed:`, err);
      errors += batch.length;
    }

    onProgress?.(Math.min(i + batchSize, indexable.length), indexable.length);
  }

  return { indexed, skipped: repos.length - indexable.length, errors };
}
