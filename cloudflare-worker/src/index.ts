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

/**
 * Issue #612 R2-A28：Vectorize binding 的分页列举接口（运行时按可用性探测）。
 * binding 类型定义尚未收录 list()；响应字段同时兼容 cursor / nextCursor 两种
 * 形态，调用失败（运行时不支持 / 瞬时错误）时回退采样路径并标注「未验证」。
 */
type ListCapableVectorize = Vectorize & {
  list?: (options?: { limit?: number; cursor?: string }) => Promise<{
    vectors?: Array<{ id?: unknown } | string>;
    cursor?: unknown;
    nextCursor?: unknown;
  }>;
};

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
        const dimensions = info.dimensions ?? 1536;
        // 待删判定（R2-A28）：应用范围与 keepIds 条件——keepSet 中的向量、
        // 已提交删除的向量与范围外的向量一律不算待删。
        const isDeletableId = (id: string): boolean => {
          if (!id || keepSet.has(id)) return false;
          // 无范围参数（旧客户端）只清理 legacy 无前缀向量：带账号前缀的
          // 向量只有在请求显式给出范围时才可删除。
          if (!scoped) return isLegacyId(id);
          if (prefix && id.startsWith(prefix)) return true;
          return includeLegacy && isLegacyId(id);
        };
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

        // Issue #612 R2-A28：可验证的待删集合判断——优先用 Vectorize 分页列举
        // 接口完整枚举向量 ID，应用范围与 keepIds 条件，游标耗尽（枚举完成）
        // 才报告完成。采样只能观察有限窗口：keepSet 全保留时永远采样不到
        // 待删向量，跑满轮次也无法与「清理完成」区分——只能采样时结果一律
        // 标「未验证」（partial: true + verified: false），绝不谎报 partial: false。
        const listBinding = env.VECTORIZE as ListCapableVectorize;
        if (typeof listBinding.list === 'function') {
          try {
            let cursor: string | undefined;
            let totalDeleted = 0;
            let listedAll = false;
            // 分页安全上限（1000/页 × 500 页）：超出按未验证处理，避免游标异常导致死循环。
            const MAX_LIST_PAGES = 500;
            for (let page = 0; page < MAX_LIST_PAGES; page++) {
              const pageResult = await listBinding.list({ limit: 1000, ...(cursor ? { cursor } : {}) });
              const vectors = Array.isArray(pageResult?.vectors) ? pageResult.vectors : [];
              const staleIds = vectors
                .map((v) => (typeof v === 'string' ? v : String((v as { id?: unknown }).id ?? '')))
                .filter((id) => isDeletableId(id));
              // deleteByIds 分批提交（与采样路径的单批上限一致）
              for (let i = 0; i < staleIds.length; i += 100) {
                await env.VECTORIZE.deleteByIds(staleIds.slice(i, i + 100));
              }
              totalDeleted += staleIds.length;
              const rawNext = pageResult?.nextCursor ?? pageResult?.cursor;
              const next = typeof rawNext === 'string' && rawNext ? rawNext : undefined;
              if (!next) {
                // 游标耗尽：快照范围内待删向量已全部提交删除 → 可验证完成。
                listedAll = true;
                break;
              }
              // 异常分页（带游标却无向量）：按未验证处理，避免空页死循环。
              if (vectors.length === 0) break;
              cursor = next;
            }
            if (listedAll) {
              return jsonResponse({ success: true, deleted: totalDeleted, partial: false });
            }
            // 超出分页上限仍未枚举完：覆盖未确认 → 明确标注未验证。
            return jsonResponse({ success: true, deleted: totalDeleted, partial: true, verified: false });
          } catch {
            // list 运行时不可用 / 调用失败：回退采样路径（结果标未验证）。
          }
        }

        // 采样回退路径：使用 query + 随机向量采样，循环删除不在 keepSet 中的向量。
        let totalDeleted = 0;
        // 采样收敛判定：query 只返回 topK 条。若某轮采样恰好没有当前账号
        // 前缀/legacy 的向量，旧逻辑直接 break 并返回 deleted:0，客户端误以为
        // 清理完成。改为持续采样到没有新向量出现，避免「采样未命中」被当成
        // 「清理完成」。
        const seenIds = new Set<string>();
        // Vectorize 删除并非立即可见：刚删掉的 ID 可能在同一轮采样里再次出现，
        // 必须跳过，避免重复提交删除和重复计数。
        const deletedIds = new Set<string>();
        // 最多迭代 10 轮（覆盖最多 1000 个向量）
        const MAX_ROUNDS = 10;
        for (let round = 0; round < MAX_ROUNDS; round++) {
          // 每轮用随机向量采样：固定零向量可能每轮都命中同一批 keepIds，
          // 随机向量让采样窗口在候选池内轮转。
          const queryVector = Array.from({ length: dimensions }, () => Math.random() * 2 - 1);
          const result = await env.VECTORIZE.query(queryVector, {
            topK: 100,
            returnMetadata: 'none',
            ...(accountFilter ? { filter: accountFilter } : {}),
          });
          const sampled = result.matches;
          const staleIds = sampled.filter((m) => isDeletableId(m.id) && !deletedIds.has(m.id)).map((m) => m.id);
          const unseen = sampled.filter((m) => !seenIds.has(m.id));
          for (const match of unseen) seenIds.add(match.id);
          if (staleIds.length > 0) {
            await env.VECTORIZE.deleteByIds(staleIds);
            for (const id of staleIds) deletedIds.add(id);
            totalDeleted += staleIds.length;
            continue;
          }
          // 候选池被观察为空（0 条采样结果）：无更多可采样向量，提前结束。
          // 但采样无法证明范围覆盖（带元数据索引外的向量不可见）——完成与否
          // 交给统一「未验证」结果，不再据此谎报 partial: false。
          if (sampled.length === 0) {
            break;
          }
        }
        // R2-A28：采样只能观察有限窗口，无法验证「不存在待删向量」——
        // 明确标注未验证（partial: true），绝不返回 partial: false。
        return jsonResponse({ success: true, deleted: totalDeleted, partial: true, verified: false });
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
