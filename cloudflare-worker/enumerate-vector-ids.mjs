/**
 * Vectorize 向量 ID 全量枚举（游标分页）与 legacy ID 判定。
 *
 * 从 deploy.mjs 抽出的纯逻辑模块（R13 review）：分页读取通过参数注入，便于
 * 行为测试覆盖「达到分页上限仍有游标」与「读到末页」两种分支，而不是只断言
 * 源码文本顺序（见 scripts/deploy-vector.test.mjs）。
 */

// 多账号向量 ID 规则（与客户端 buildAccountScopedVectorId 对应）：单租户 legacy
// 向量为纯数字 repoId；完成 accountId 回填（重写）的向量为 `${accountId}:${repoId}`。
// 据此可用全量枚举向量 ID 做旧向量退役检查：只要还存在纯数字 ID，就存在未被账号
// 过滤收录的存量向量。
export function isLegacyVectorId(id) {
  return /^\d+$/.test(id);
}

/**
 * 全量枚举 Vectorize 索引的向量 ID（wrangler vectorize list-vectors，游标分页），
 * 用于旧向量退役核对（R2 review / R12 review / R13 review）。返回
 * { ok, total?, legacyCount?, reason? }；分页读取失败 / 输出异常 / 达到分页上限
 * 仍未读到末页时 ok=false——调用方据此明确报告「未验证」，绝不把采样或部分枚举
 * 结果当作覆盖证明。注意：枚举未发现纯数字 ID 只证明旧向量已退役，不是回填覆盖
 * 的证明——带账号前缀、缺少 accountId 元数据的向量对枚举不可见（R13 review）。
 *
 * @param {string} indexName 要枚举的索引名
 * @param {(indexName: string, cursor?: string) => unknown} listPage 分页读取函数：
 *   返回 { vectors: Array<string|{id}>, nextCursor?: string }，失败时返回 null。
 */
export function enumerateVectorIds(indexName, listPage) {
  const ids = new Set();
  let legacyCount = 0;
  const fail = (reason) => (
    legacyCount > 0
      ? { ok: false, reason, total: ids.size, legacyCount }
      : { ok: false, reason }
  );
  try {
    if (!indexName) return { ok: false, reason: 'missing_index_name' };
    if (typeof listPage !== 'function') return { ok: false, reason: 'list_failed' };
    let cursor;
    // 分页安全上限（1000/页 × 500 页）：超出按枚举失败处理，避免游标异常死循环。
    const MAX_ENUM_PAGES = 500;
    // R12 review：是否明确读到末页。达到页数上限仍有 nextCursor 时枚举不完整，
    // 必须按枚举失败处理——否则第 501 页才出现的 legacy 向量会被漏检，覆盖被误判。
    let reachedEnd = false;
    for (let page = 0; page < MAX_ENUM_PAGES; page++) {
      const data = listPage(indexName, cursor);
      if (!data || !Array.isArray(data.vectors)) return fail('list_failed');
      for (const entry of data.vectors) {
        const id = typeof entry === 'string' ? entry : String((entry && entry.id) ?? '');
        if (id && !ids.has(id)) {
          ids.add(id);
          if (isLegacyVectorId(id)) legacyCount++;
        }
      }
      const rawNext = data && data.nextCursor;
      const next = typeof rawNext === 'string' && rawNext ? rawNext : undefined;
      if (!next) {
        if (data && data.isTruncated === true) {
          return fail('truncated_without_cursor');
        }
        reachedEnd = true;
        break;
      }
      cursor = next;
    }
    if (!reachedEnd) {
      // 达到分页上限仍有后续游标：本次枚举不完整，按枚举失败处理（覆盖未验证）。
      return fail('page_limit_exceeded');
    }
    if (ids.size === 0) {
      // 采样查询能命中向量而枚举结果为空：快照矛盾，按枚举失败处理。
      return { ok: false, reason: 'empty_snapshot' };
    }
    return { ok: true, total: ids.size, legacyCount };
  } catch (err) {
    return fail(err && err.message ? err.message : 'list_failed');
  }
}
