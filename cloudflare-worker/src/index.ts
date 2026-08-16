/**
 * GitHub Stars Vectorize — 极简代理 Worker
 *
 * 纯 Vectorize 存/查/删代理，不持有任何 AI Key。
 * 前端负责 Embedding 生成，Worker 只负责向量存储和检索。
 */

interface Env {
  VECTORIZE: Vectorize;
  AUTH_TOKEN: string;
}

interface QueryRequest {
  vector: number[];
  topK?: number;
  threshold?: number;
}

interface DeleteRequest {
  ids: string[];
}

interface UpsertRequest {
  vectors: VectorizeVector[];
}

type CompactMetadata = {
  full_name: string;
  description: string;
  language: string;
  stars: number;
  tags: string[];
  license?: string;
};

// Keep a margin below Vectorize's 10 KiB per-vector metadata limit so that
// future small fields or JSON overhead do not turn a valid payload into a 40016.
export const VECTORIZE_METADATA_LIMIT_BYTES = 10_240;
const VECTORIZE_METADATA_SAFE_BYTES = 9_500;
const encoder = new TextEncoder();

function utf8ByteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

function jsonByteLength(value: unknown): number {
  return utf8ByteLength(JSON.stringify(value) ?? '');
}

/** Truncate on Unicode code-point boundaries, using UTF-8 bytes rather than JS characters. */
export function truncateUtf8(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  if (utf8ByteLength(value) <= maxBytes) return value;

  const codePoints = Array.from(value);
  let low = 0;
  let high = codePoints.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (utf8ByteLength(codePoints.slice(0, middle).join('')) <= maxBytes) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return codePoints.slice(0, low).join('');
}

function normalizeMetadata(input: unknown): CompactMetadata {
  const source = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const metadata: CompactMetadata = {
    full_name: typeof source.full_name === 'string' ? source.full_name : '',
    description: typeof source.description === 'string' ? source.description : '',
    language: typeof source.language === 'string' ? source.language : '',
    stars: typeof source.stars === 'number' && Number.isFinite(source.stars) ? source.stars : 0,
    tags: Array.isArray(source.tags)
      ? source.tags.filter((tag): tag is string => typeof tag === 'string')
      : [],
  };
  if (typeof source.license === 'string') metadata.license = source.license;
  return metadata;
}

function truncateTags(tags: string[], maxBytes: number): string[] {
  if (maxBytes <= 0) return [];
  const result: string[] = [];
  for (const tag of tags) {
    const candidate = [...result, tag];
    if (jsonByteLength(candidate) <= maxBytes) {
      result.push(tag);
      continue;
    }

    // Keep a prefix of the first tag that does not fit, then stop: later tags
    // cannot be more useful than the already retained prefix under this budget.
    const codePoints = Array.from(tag);
    let low = 0;
    let high = codePoints.length;
    let best = '';
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const shortened = codePoints.slice(0, middle).join('');
      if (jsonByteLength([...result, shortened]) <= maxBytes) {
        best = shortened;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    if (best) result.push(best);
    break;
  }
  return result;
}

/**
 * Compact one vector's metadata independently of the rest of its batch.
 * The largest variable field is reduced first; once fields reach a similar
 * size, both are reduced together until the complete JSON fits the budget.
 */
export function compactVectorMetadata(input: unknown): CompactMetadata {
  const metadata = normalizeMetadata(input);
  if (jsonByteLength(metadata) <= VECTORIZE_METADATA_SAFE_BYTES) return metadata;

  const variableBytes = Math.max(
    utf8ByteLength(metadata.description),
    jsonByteLength(metadata.tags),
  );
  let low = 0;
  let high = variableBytes;
  let best: CompactMetadata = { ...metadata, description: '', tags: [] };

  // A shared cap implements the "largest field first, then both together"
  // policy: a smaller field is untouched until the larger one reaches it.
  while (low <= high) {
    const cap = Math.floor((low + high) / 2);
    const candidate: CompactMetadata = {
      ...metadata,
      description: truncateUtf8(metadata.description, cap),
      tags: truncateTags(metadata.tags, cap),
    };
    if (jsonByteLength(candidate) <= VECTORIZE_METADATA_SAFE_BYTES) {
      best = candidate;
      low = cap + 1;
    } else {
      high = cap - 1;
    }
  }

  if (jsonByteLength(best) <= VECTORIZE_METADATA_SAFE_BYTES) return best;

  // The normal fields above are already small; this final fallback protects
  // against malformed input such as an enormous license or repository name.
  const fallback: CompactMetadata = {
    full_name: truncateUtf8(metadata.full_name, 512),
    description: '',
    language: truncateUtf8(metadata.language, 128),
    stars: metadata.stars,
    tags: [],
  };
  if (metadata.license) fallback.license = truncateUtf8(metadata.license, 256);
  if (jsonByteLength(fallback) > VECTORIZE_METADATA_SAFE_BYTES) delete fallback.license;
  return fallback;
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResponse(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: CORS_HEADERS,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // 认证
    if (!env.AUTH_TOKEN) {
      return jsonResponse({ success: false, error: 'Server auth not configured' }, 500);
    }
    const token = request.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
    if (token !== env.AUTH_TOKEN) {
      return jsonResponse({ success: false, error: 'Unauthorized' }, 401);
    }

    const url = new URL(request.url);

    try {
      // POST /upsert — 批量写入向量
      if (request.method === 'POST' && url.pathname === '/upsert') {
        const { vectors } = (await request.json()) as UpsertRequest;
        if (!Array.isArray(vectors) || vectors.length === 0) {
          return jsonResponse({ success: false, error: 'vectors array required' }, 400);
        }
        const compactedVectors = vectors.map((vector) => ({
          ...vector,
          metadata: compactVectorMetadata(vector.metadata),
        }));
        await env.VECTORIZE.upsert(compactedVectors);
        return jsonResponse({ success: true, upserted: vectors.length });
      }

      // POST /query — 向量相似度查询
      if (request.method === 'POST' && url.pathname === '/query') {
        const { vector, topK = 20, threshold = 0.35 } = (await request.json()) as QueryRequest;
        if (!Array.isArray(vector) || vector.length === 0) {
          return jsonResponse({ success: false, error: 'vector array required' }, 400);
        }
        // returnMetadata:'all' caps topK at 50; clamp to avoid silent truncation
        const clampedTopK = Math.min(topK, 50);
        const matches = await env.VECTORIZE.query(vector, {
          topK: clampedTopK,
          returnMetadata: 'all' as const,
        });
        // 过滤低分结果
        const filtered = matches.matches.filter((m) => m.score >= threshold);
        return jsonResponse({ success: true, matches: filtered });
      }

      // POST /delete — 删除指定向量
      if (request.method === 'POST' && url.pathname === '/delete') {
        const { ids } = (await request.json()) as DeleteRequest;
        if (!Array.isArray(ids) || ids.length === 0) {
          return jsonResponse({ success: false, error: 'ids array required' }, 400);
        }
        await env.VECTORIZE.deleteByIds(ids);
        return jsonResponse({ success: true, deleted: ids.length });
      }

      // POST /cleanup — 删除不在 keepIds 列表中的向量（清理已 unstar 的仓库）
      if (request.method === 'POST' && url.pathname === '/cleanup') {
        const { keepIds } = (await request.json()) as { keepIds: string[] };
        if (!Array.isArray(keepIds)) {
          return jsonResponse({ success: false, error: 'keepIds array required' }, 400);
        }
        const keepSet = new Set(keepIds);
        const info = await env.VECTORIZE.describe();
        if ((info.vectorCount ?? 0) === 0) {
          return jsonResponse({ success: true, deleted: 0 });
        }
        // 使用 query + 零向量采样，循环删除不在 keepSet 中的向量
        // Vectorize binding 不支持 listVectors，topK 上限 100
        const dimensions = info.dimensions ?? 1536;
        let totalDeleted = 0;
        const zeroVector = new Array(dimensions).fill(0);
        // 最多迭代 10 轮（覆盖最多 1000 个向量）
        for (let round = 0; round < 10; round++) {
          const result = await env.VECTORIZE.query(zeroVector, {
            topK: 100,
            returnMetadata: 'none',
          });
          const staleIds = result.matches
            .filter((m) => !keepSet.has(m.id))
            .map((m) => m.id);
          if (staleIds.length === 0) break;
          await env.VECTORIZE.deleteByIds(staleIds);
          totalDeleted += staleIds.length;
        }
        return jsonResponse({ success: true, deleted: totalDeleted });
      }

      // GET /status — 返回索引信息
      if (request.method === 'GET' && url.pathname === '/status') {
        const info = await env.VECTORIZE.describe();
        return jsonResponse({
          success: true,
          vectorCount: info.vectorCount ?? 0,
          dimensions: info.dimensions ?? 0,
        });
      }

      return jsonResponse({ error: 'Not Found' }, 404);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return jsonResponse({ success: false, error: message }, 500);
    }
  },
};
