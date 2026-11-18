import { compactUpsertVectors, InvalidVectorMetadataError } from './metadata';

/**
 * GitHub Stars Vectorize — 极简代理 Worker
 *
 * 纯 Vectorize 存/查/删代理，不持有任何 AI Key。
 * 前端负责 Embedding 生成，Worker 只负责向量存储和检索。
 */

interface Env {
  VECTORIZE: Vectorize;
  AUTH_TOKEN: string;
  /** 'true' 表示 Vectorize 已建立 accountId 元数据索引且存量向量已回填。 */
  ACCOUNT_METADATA_INDEXED?: string;
}

interface QueryRequest {
  vector: number[];
  topK?: number;
  threshold?: number;
  accountId?: string;
}

interface DeleteRequest {
  ids: string[];
}

interface UpsertRequest {
  vectors: VectorizeVector[];
}

// returnMetadata:'all' caps topK at 50 on Vectorize V2 indexes; clamp requests
// to avoid passing an out-of-range topK and being silently truncated.
const QUERY_TOPK_LIMIT = 50;
const QUERY_DEFAULT_TOPK = 20;

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
        let compactedVectors;
        try {
          compactedVectors = compactUpsertVectors(vectors);
        } catch (err) {
          if (err instanceof InvalidVectorMetadataError) {
            return jsonResponse({ success: false, error: err.message }, 400);
          }
          throw err;
        }
        await env.VECTORIZE.upsert(compactedVectors);
        return jsonResponse({ success: true, upserted: vectors.length });
      }

      // POST /query — 向量相似度查询
      if (request.method === 'POST' && url.pathname === '/query') {
        const { vector, topK = QUERY_DEFAULT_TOPK, threshold = 0.35, accountId } = (await request.json()) as QueryRequest;
        if (!Array.isArray(vector) || vector.length === 0) {
          return jsonResponse({ success: false, error: 'vector array required' }, 400);
        }
        // returnMetadata:'all' caps topK at 50 (Vectorize V2 limits); clamp so
        // an oversized/negative/NaN topK degrades gracefully instead of erroring.
        const requestedTopK = typeof topK === 'number' && Number.isFinite(topK)
          ? Math.floor(topK)
          : QUERY_DEFAULT_TOPK;
        const clampedTopK = Math.min(Math.max(requestedTopK, 1), QUERY_TOPK_LIMIT);
        // 账号范围过滤必须在 topK 之前生效（Vectorize 的 filter 语义），
        // 否则其他账号的高分向量会占满候选名额；若 accountId 元数据索引尚未
        // 就绪，直接拒绝按账号过滤的查询，避免静默漏召回或退回无范围查询。
        const requestedAccountId = typeof accountId === 'string' && accountId.length > 0 ? accountId : null;
        if (requestedAccountId && env.ACCOUNT_METADATA_INDEXED !== 'true') {
          return jsonResponse(
            {
              success: false,
              error: 'accountId metadata index is not ready (ACCOUNT_METADATA_INDEXED != true)',
              code: 'ACCOUNT_METADATA_NOT_INDEXED',
            },
            400,
          );
        }
        const accountFilter = requestedAccountId ? { accountId: requestedAccountId } : undefined;
        const matches = await env.VECTORIZE.query(vector, {
          topK: clampedTopK,
          returnMetadata: 'all' as const,
          ...(accountFilter ? { filter: accountFilter } : {}),
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
      // R5 审计修复：多账号共享同一 VECTORIZE 索引时，向量 ID 以账号为前缀
      //（`${accountId}:${repoId}`）。请求可携带范围参数限定删除范围：
      // - accountPrefix：只允许删除该账号前缀的向量，其他账号前缀的向量一律保留；
      // - includeLegacy：单租户时代的 legacy 无前缀向量属于唯一所有者，仅在
      //   请求显式携带 includeLegacy=true 时才允许删除；
      // - 两个参数都不携带时保持旧行为：只删除采样结果中不在 keepIds 且 ID 为
      //   纯数字的 legacy 向量，带账号前缀的向量一律保留。
      if (request.method === 'POST' && url.pathname === '/cleanup') {
        const body = (await request.json()) as {
          keepIds?: string[];
          accountPrefix?: unknown;
          includeLegacy?: unknown;
        };
        const { keepIds } = body;
        if (!Array.isArray(keepIds)) {
          return jsonResponse({ success: false, error: 'keepIds array required' }, 400);
        }
        if (body.accountPrefix !== undefined) {
          if (typeof body.accountPrefix !== 'string' || !/^\d+$/.test(body.accountPrefix.trim())) {
            return jsonResponse({ success: false, error: 'accountPrefix must be a numeric account id string' }, 400);
          }
        }
        if (body.includeLegacy !== undefined && typeof body.includeLegacy !== 'boolean') {
          return jsonResponse({ success: false, error: 'includeLegacy must be a boolean' }, 400);
        }
        const accountPrefix = typeof body.accountPrefix === 'string' ? body.accountPrefix.trim() : null;
        const includeLegacy = body.includeLegacy === true;
        // 新客户端总是显式携带范围参数；accountPrefix 缺失但请求中出现
        // includeLegacy 时（未登录边缘态），legacy 向量成为唯一删除候选
        const scoped = body.accountPrefix !== undefined || body.includeLegacy !== undefined;
        const prefix = accountPrefix !== null ? `${accountPrefix}:` : null;
        const isLegacyId = (id: string): boolean => /^\d+$/.test(id);
        const keepSet = new Set(keepIds);
        const info = await env.VECTORIZE.describe();
        if ((info.vectorCount ?? 0) === 0) {
          return jsonResponse({ success: true, deleted: 0 });
        }
        // 使用 query + 零向量采样，循环删除不在 keepSet 中的向量
        // Vectorize binding 不支持 listVectors，topK 上限 100
        const dimensions = info.dimensions ?? 1536;
        let totalDeleted = 0;
        let sampledAll = false;
        // 采样收敛判定：query 只返回 topK 条，且无法 listVectors。若某轮采样
        // 恰好没有当前账号前缀/legacy 的向量，旧逻辑直接 break 并返回
        // deleted:0，客户端误以为清理完成。改为持续采样到没有新向量出现，
        // 避免「采样未命中」被当成「清理完成」。
        const seenIds = new Set<string>();
        // Vectorize 删除并非立即可见：刚删掉的 ID 可能在同一轮采样里再次出现，
        // 必须跳过，避免重复提交删除和重复计数。
        const deletedIds = new Set<string>();
        // 新写入的向量在 metadata 记录 accountId；按前缀清理时用 metadata
        // filter 把候选池收窄到该账号，采样不再被其他账号的向量占满。
        // includeLegacy 时不能过滤（legacy 向量没有 accountId）。
        const accountFilter = prefix && !includeLegacy ? { accountId: accountPrefix as string } : undefined;
        if (accountFilter && env.ACCOUNT_METADATA_INDEXED !== 'true') {
          return jsonResponse(
            {
              success: false,
              error: 'accountId metadata index is not ready (ACCOUNT_METADATA_INDEXED != true)',
              code: 'ACCOUNT_METADATA_NOT_INDEXED',
            },
            400,
          );
        }
        // 最多迭代 10 轮（覆盖最多 1000 个向量）
        const MAX_ROUNDS = 10;
        for (let round = 0; round < MAX_ROUNDS; round++) {
          // 每轮用随机向量采样：固定零向量在无 listVectors 时可能每轮都命中
          // 同一批 keepIds，随机向量让采样窗口在候选池内轮转。
          const queryVector = Array.from({ length: dimensions }, () => Math.random() * 2 - 1);
          const result = await env.VECTORIZE.query(queryVector, {
            topK: 100,
            returnMetadata: 'none',
            ...(accountFilter ? { filter: accountFilter } : {}),
          });
          const sampled = result.matches;
          const staleIds = sampled
            .filter((m) => {
              if (keepSet.has(m.id) || deletedIds.has(m.id)) return false;
              // 无范围参数（旧客户端）只清理 legacy 无前缀向量：带账号前缀的
              // 向量只有在请求显式给出范围时才可删除。
              if (!scoped) return isLegacyId(m.id);
              if (prefix && m.id.startsWith(prefix)) return true;
              return includeLegacy && isLegacyId(m.id);
            })
            .map((m) => m.id);
          const unseen = sampled.filter((m) => !seenIds.has(m.id));
          for (const match of unseen) seenIds.add(match.id);
          if (staleIds.length > 0) {
            await env.VECTORIZE.deleteByIds(staleIds);
            for (const id of staleIds) deletedIds.add(id);
            totalDeleted += staleIds.length;
            continue;
          }
          // Issue #612 A29：采样收敛判定——历史 seenIds 数量与 info.vectorCount
          // 相等不能证明覆盖当前索引（数量不变但 ID 可被替换），该判定已移除；
          // 本轮采样窗口小于 topK 同样不是完成证据（下一轮可能命中未见向量）。
          // 唯一可靠的完成证据是候选池已被观察为空（0 条采样结果）——此时该
          // 范围内已无任何可清理向量。覆盖未确认时保持 partial: true，并继续
          // 用剩余采样轮次直到 MAX_ROUNDS。
          if (sampled.length === 0) {
            sampledAll = true;
            break;
          }
        }
        // 采样轮数耗尽仍可能有未处理的向量：明确返回 partial，不谎报完成。
        return jsonResponse({ success: true, deleted: totalDeleted, partial: !sampledAll });
      }

      // GET /status — 返回索引信息
      if (request.method === 'GET' && url.pathname === '/status') {
        const info = await env.VECTORIZE.describe();
        return jsonResponse({
          success: true,
          vectorCount: info.vectorCount ?? 0,
          dimensions: info.dimensions ?? 0,
          // 客户端据此判定 /cleanup 是否支持按账号前缀限定删除范围。
          // 只有在部署方确认 accountId 元数据索引已建立并回填后才启用。
          accountScopedCleanup: env.ACCOUNT_METADATA_INDEXED === 'true',
        });
      }

      return jsonResponse({ error: 'Not Found' }, 404);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return jsonResponse({ success: false, error: message }, 500);
    }
  },
};
