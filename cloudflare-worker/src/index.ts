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
        // R13 review：accountId 字段已提供但不是非空字符串（如数字 42）时返回
        // 400——静默当作「未传账号范围」会跳过索引就绪检查并执行无过滤查询；
        // 仅当字段省略时保留旧客户端的无范围行为。
        if (accountId !== undefined && (typeof accountId !== 'string' || accountId.length === 0)) {
          return jsonResponse({ success: false, error: 'accountId must be a non-empty string when provided' }, 400);
        }
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
        // R13 review：keepIds 必须全为字符串——`[42]` 这类数字元素会让
        // keepSet.has('42') 落空，采样命中 ID "42" 的旧向量时会把它提交删除。
        if (keepIds.some((id) => typeof id !== 'string')) {
          return jsonResponse({ success: false, error: 'keepIds must contain only string ids' }, 400);
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
        // R13 review：显式范围请求但没有任何可删除范围（accountPrefix 未提供且
        // includeLegacy=false）时，isDeletableId 对所有 ID 都返回 false——确定性
        // 空操作直接返回零删除，不执行索引查询，也不把空操作标成「未验证」；
        // 两个字段都省略时的旧版清理行为保持不变。
        if (scoped && prefix === null && !includeLegacy) {
          return jsonResponse({ success: true, deleted: 0 });
        }
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

        // Issue #612 R2-A28（R2 review 更正）：生产 Vectorize binding 不提供 list()
        // ——完整枚举只有 REST API 与 `wrangler vectorize list-vectors` 提供，Worker
        // 内没有可用的列举接口。因此清理只能用 query + 随机向量采样，采样只能
        // 观察有限窗口：keepSet 全保留时永远采样不到待删向量，跑满轮次也无法
        // 与「清理完成」区分——结果一律标「未验证」（partial: true + verified: false），
        // 绝不谎报 partial: false。
        // 采样路径：使用 query + 随机向量采样，循环删除不在 keepSet 中的向量。
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
