import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { resolveAccountScope, resolveWritableAccountScope } from '../db/accountScope.js';

const router = Router();

/** Parse a JSON string column from the database, returning an empty array on failure. */
function parseJsonColumn(value: unknown): unknown[] {
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

/**
 * 把 GitHub 的 license 值统一为 SPDX id 字符串或 null。
 * 接受三种形态：GitHub 原始对象 `{ key, spdx_id, name, url }`、已规范化的字符串、null。
 * 优先取 spdx_id（如 "MIT"），无则回退 key（如 "Other" → "NOASSERTION" 由前端归一化处理）。
 */
function toLicenseSpdxId(license: unknown): string | null {
  if (license == null) return null;
  if (typeof license === 'string') return license.trim() || null;
  if (typeof license === 'object') {
    // 运行时校验：malformed 备份/第三方源可能把 spdx_id/key 写成非字符串
    const l = license as { spdx_id?: unknown; key?: unknown };
    const spdx = typeof l.spdx_id === 'string' ? l.spdx_id.trim() : '';
    const key = typeof l.key === 'string' ? l.key.trim() : '';
    return spdx || key || null;
  }
  return null;
}

export const DESCRIPTION_DISPLAY_VALUES: readonly string[] = ['follow', 'ai', 'original'];
export const TAGS_DISPLAY_VALUES: readonly string[] = ['follow', 'ai', 'topics'];

/** Normalize a per-repo display preference: only values allowed for the field are stored, anything else means "follow". */
export function toDisplayPref(value: unknown, allowed: readonly string[]): string | null {
  return typeof value === 'string' && allowed.includes(value) ? value : null;
}

/** Transform a database row into the API response shape, parsing JSON columns. */
function transformRepo(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    full_name: row.full_name,
    description: row.description,
    html_url: row.html_url,
    stargazers_count: row.stargazers_count,
    language: row.language,
    created_at: row.created_at,
    updated_at: row.updated_at,
    pushed_at: row.pushed_at,
    starred_at: row.starred_at,
    owner: { login: row.owner_login, avatar_url: row.owner_avatar_url },
    topics: parseJsonColumn(row.topics),
    ai_summary: row.ai_summary,
    ai_tags: parseJsonColumn(row.ai_tags),
    ai_platforms: parseJsonColumn(row.ai_platforms),
    analyzed_at: row.analyzed_at,
    analysis_failed: !!row.analysis_failed,
    custom_description: row.custom_description,
    // null 表示「未自定义」；空数组才是「明确清空」。二者语义不同，缺省时不能返回 []。
    custom_tags: row.custom_tags ? parseJsonColumn(row.custom_tags) : undefined,
    custom_category: row.custom_category ?? undefined,
    category_locked: !!row.category_locked,
    // 显式返回 null（而非省略字段），让客户端把「已重置为跟随」同步给其他设备。
    description_display: row.description_display ?? null,
    tags_display: row.tags_display ?? null,
    last_edited: row.last_edited,
    subscribed_to_releases: !!row.subscribed_to_releases,
    vector_indexed_at: row.vector_indexed_at ?? undefined,
    license: row.license ?? null,
    vector_indexed_license: row.vector_indexed_license ?? null,
  };
}

// GET /api/repositories
router.get('/api/repositories', (req, res) => {
  try {
    const db = getDb();
    const accountId = resolveAccountScope(req, db);
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(10000, Math.max(1, parseInt(req.query.limit as string) || 100));
    const search = req.query.search as string | undefined;
    const offset = (page - 1) * limit;

    let sql = 'SELECT * FROM repositories WHERE account_id = ?';
    const params: unknown[] = [accountId];

    if (search) {
      const escaped = search.replace(/[%_\\]/g, '\\$&');
      sql += " AND (name LIKE ? ESCAPE '\\' OR full_name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR ai_summary LIKE ? ESCAPE '\\' OR ai_tags LIKE ? ESCAPE '\\')";
      const searchPattern = `%${escaped}%`;
      params.push(searchPattern, searchPattern, searchPattern, searchPattern, searchPattern);
    }

    sql += ' ORDER BY stargazers_count DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
    const repositories = rows.map(transformRepo);

    const countSql = search
      ? 'SELECT COUNT(*) as total FROM repositories WHERE account_id = ? AND (name LIKE ? OR full_name LIKE ? OR description LIKE ? OR ai_summary LIKE ? OR ai_tags LIKE ?)'
      : 'SELECT COUNT(*) as total FROM repositories WHERE account_id = ?';
    const countParams = search ? [accountId, ...Array(5).fill(`%${search}%`)] : [accountId];
    const countRow = db.prepare(countSql).get(...countParams) as { total: number };

    res.json({ repositories, total: countRow.total, page, limit });
  } catch (err) {
    console.error('GET /api/repositories error:', err);
    res.status(500).json({ error: 'Failed to fetch repositories', code: 'FETCH_REPOSITORIES_FAILED' });
  }
});

// PUT /api/repositories (bulk upsert)
router.put('/api/repositories', (req, res) => {
  try {
    const db = getDb();
    const { repositories } = req.body as { repositories: Record<string, unknown>[] };
    if (!Array.isArray(repositories)) {
      res.status(400).json({ error: 'repositories array required', code: 'REPOSITORIES_ARRAY_REQUIRED' });
      return;
    }
    const isFullSync = Boolean(req.body?.isFullSync);
    // 旧版客户端（无 X-GitHub-Account-Id）无法证明自身身份：多账号分区共存时
    // 回退到全局 active_account_id 会把它账号的快照写进当前活跃分区——全量写入
    // 会物理删除缺项，增量 UPSERT 也会覆盖另一账号同 ID 仓库的自定义字段。
    // 两种情况都必须拒绝。
    const scope = resolveWritableAccountScope(req, db);
    if (!scope.ok) {
      res.status(409).json({
        error: 'X-GitHub-Account-Id is required when multiple accounts exist',
        code: 'ACCOUNT_SCOPE_REQUIRED',
      });
      return;
    }
    const accountId = scope.accountId;

    // 验证每个仓库的ID
    for (const repo of repositories) {
      if (!repo.id || typeof repo.id !== 'number' || repo.id <= 0) {
        res.status(400).json({ error: 'Each repository must have a valid positive integer id', code: 'INVALID_REPOSITORY_ID' });
        return;
      }
      if (!repo.full_name || typeof repo.full_name !== 'string') {
        res.status(400).json({ error: 'Each repository must have a valid full_name', code: 'INVALID_REPOSITORY_FULL_NAME' });
        return;
      }
      if (!repo.name || typeof repo.name !== 'string') {
        res.status(400).json({ error: 'Each repository must have a valid name', code: 'INVALID_REPOSITORY_NAME' });
        return;
      }
      const owner = repo.owner as Record<string, unknown> | undefined;
      if (!owner || typeof owner.login !== 'string' || typeof owner.avatar_url !== 'string') {
        res.status(400).json({ error: 'Each repository must have a valid owner with login and avatar_url', code: 'INVALID_REPOSITORY_OWNER' });
        return;
      }
      if (!repo.html_url || typeof repo.html_url !== 'string') {
        res.status(400).json({ error: 'Each repository must have a valid html_url', code: 'INVALID_REPOSITORY_HTML_URL' });
        return;
      }
      if (typeof repo.stargazers_count !== 'number' || repo.stargazers_count < 0) {
        res.status(400).json({ error: 'Each repository must have a valid non-negative stargazers_count', code: 'INVALID_STARGAZERS_COUNT' });
        return;
      }
      // 校验 vector_indexed_at：允许 null/undefined 或合法 ISO 8601 字符串
      if (repo.vector_indexed_at !== null && repo.vector_indexed_at !== undefined && repo.vector_indexed_at !== '') {
        if (typeof repo.vector_indexed_at !== 'string' || isNaN(Date.parse(repo.vector_indexed_at))) {
          res.status(400).json({ error: 'vector_indexed_at must be an ISO 8601 string or null', code: 'INVALID_VECTOR_INDEXED_AT' });
          return;
        }
      }
    }

    // v4 复合主键 (account_id, id)：UPSERT 冲突目标必须匹配复合主键。
    // account_id 占位参数追加在参数列表末位（见参数位置契约）。
    // 跨账号 AI 分析成果复用：当前账号该仓库尚无 AI 总结时，回填同库其他账号
    // 已分析过的同一仓库的成果（账号归属隔离，免去重复 AI Token 消耗）。
    // 已存储的 '[]'（普通同步对缺省字段的默认序列化）与 ''/NULL 一律视为
    // 「可回填」，当前账号已有非空值时保留其值。
    const stmt = db.prepare(`
      INSERT INTO repositories (
        id, name, full_name, description, html_url, stargazers_count, language,
        created_at, updated_at, pushed_at, starred_at,
        owner_login, owner_avatar_url, topics,
        ai_summary, ai_tags, ai_platforms, analyzed_at, analysis_failed,
        custom_description, custom_tags, custom_category, category_locked, last_edited,
        subscribed_to_releases, vector_indexed_at, license, vector_indexed_license,
        description_display, tags_display,
        account_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, id) DO UPDATE SET
        name = excluded.name,
        full_name = excluded.full_name,
        description = excluded.description,
        html_url = excluded.html_url,
        stargazers_count = excluded.stargazers_count,
        language = excluded.language,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        pushed_at = excluded.pushed_at,
        starred_at = excluded.starred_at,
        owner_login = excluded.owner_login,
        owner_avatar_url = excluded.owner_avatar_url,
        topics = excluded.topics,
        ai_summary = CASE
          WHEN excluded.ai_summary IS NOT NULL AND excluded.ai_summary != '' THEN excluded.ai_summary
          WHEN repositories.ai_summary IS NOT NULL AND repositories.ai_summary != '' THEN repositories.ai_summary
          ELSE COALESCE((
            SELECT other.ai_summary FROM repositories AS other
            WHERE other.id = excluded.id AND other.account_id != repositories.account_id
              AND other.account_id != 'default' AND repositories.account_id != 'default'
              AND other.ai_summary IS NOT NULL AND other.ai_summary != ''
            LIMIT 1
          ), repositories.ai_summary)
        END,
        ai_tags = CASE
          WHEN excluded.ai_tags IS NOT NULL AND excluded.ai_tags != '[]' THEN excluded.ai_tags
          WHEN repositories.ai_tags IS NOT NULL AND repositories.ai_tags != '[]' THEN repositories.ai_tags
          ELSE COALESCE((
            SELECT other.ai_tags FROM repositories AS other
            WHERE other.id = excluded.id AND other.account_id != repositories.account_id
              AND other.account_id != 'default' AND repositories.account_id != 'default'
              AND other.ai_tags IS NOT NULL AND other.ai_tags != '[]'
            LIMIT 1
          ), repositories.ai_tags)
        END,
        ai_platforms = CASE
          WHEN excluded.ai_platforms IS NOT NULL AND excluded.ai_platforms != '[]' THEN excluded.ai_platforms
          WHEN repositories.ai_platforms IS NOT NULL AND repositories.ai_platforms != '[]' THEN repositories.ai_platforms
          ELSE COALESCE((
            SELECT other.ai_platforms FROM repositories AS other
            WHERE other.id = excluded.id AND other.account_id != repositories.account_id
              AND other.account_id != 'default' AND repositories.account_id != 'default'
              AND other.ai_platforms IS NOT NULL AND other.ai_platforms != '[]'
            LIMIT 1
          ), repositories.ai_platforms)
        END,
        analyzed_at = CASE
          WHEN excluded.analyzed_at IS NOT NULL AND excluded.analyzed_at != '' THEN excluded.analyzed_at
          WHEN repositories.analyzed_at IS NOT NULL AND repositories.analyzed_at != '' THEN repositories.analyzed_at
          ELSE COALESCE((
            SELECT other.analyzed_at FROM repositories AS other
            WHERE other.id = excluded.id AND other.account_id != repositories.account_id
              AND other.account_id != 'default' AND repositories.account_id != 'default'
              AND other.analyzed_at IS NOT NULL AND other.analyzed_at != ''
            LIMIT 1
          ), repositories.analyzed_at)
        END,
        analysis_failed = excluded.analysis_failed,
        -- 同步只接收整仓快照：字段缺省即表示客户端已无自定义内容，须照实覆盖，
        -- 否则「跟随列表设置/显示AI」保存后的清空无法同步到后端（#565）。
        custom_description = excluded.custom_description,
        custom_tags = excluded.custom_tags,
        custom_category = excluded.custom_category,
        category_locked = excluded.category_locked,
        description_display = excluded.description_display,
        tags_display = excluded.tags_display,
        last_edited = CASE WHEN excluded.last_edited IS NOT NULL AND excluded.last_edited != '' THEN excluded.last_edited ELSE repositories.last_edited END,
        subscribed_to_releases = excluded.subscribed_to_releases,
        vector_indexed_at = excluded.vector_indexed_at,
        -- vector_indexed_license 是「上次向量索引时采用的 license」的照实记录，
        -- 仅由索引流程（PATCH）写入；批量 upsert/sync 一律保留已存储值，避免被
        -- 同步流写入的当前 license 覆盖而破坏增量变更检测。
        vector_indexed_license = COALESCE(repositories.vector_indexed_license, excluded.vector_indexed_license),
        -- 区分「省略 license 字段」与「显式提供 null/对象」：
        -- 旧客户端/旧备份不含 license 字段时（@licenseProvided = 0）保留已存储值；
        -- 显式提供时（@licenseProvided = 1）采用归一化后的 excluded.license（含 null 清空）。
        license = CASE WHEN @licenseProvided IS 1 THEN excluded.license ELSE repositories.license END
    `);

    const deleteAllAccountReleases = db.prepare('DELETE FROM releases WHERE account_id = ?');
    const deleteAllAccountRepositories = db.prepare('DELETE FROM repositories WHERE account_id = ?');
    const deleteReleasesNotIn = (placeholders: string) =>
      db.prepare(`DELETE FROM releases WHERE account_id = ? AND repo_id NOT IN (${placeholders})`);
    const deleteRepositoriesNotIn = (placeholders: string) =>
      db.prepare(`DELETE FROM repositories WHERE account_id = ? AND id NOT IN (${placeholders})`);

    // 跨账号 AI 成果批量回填：ON CONFLICT DO UPDATE 的回填子查询只覆盖冲突
    // （更新）路径；首次 INSERT 不进入该分支。这里对当前账号分区中仍缺 AI
    // 成果的仓库（含本次首次插入的行）统一补齐同库其他账号对同一仓库的
    // 已有分析成果，只补缺失字段、绝不覆盖当前账号已有非空值。
    const backfillAiFromOtherAccounts = db.prepare(`
      UPDATE repositories SET
        ai_summary = CASE
          WHEN ai_summary IS NULL OR ai_summary = '' THEN COALESCE((
            SELECT other.ai_summary FROM repositories AS other
            WHERE other.id = repositories.id AND other.account_id != repositories.account_id
              AND other.account_id != 'default'
              AND other.ai_summary IS NOT NULL AND other.ai_summary != ''
            LIMIT 1
          ), ai_summary)
          ELSE ai_summary END,
        ai_tags = CASE
          WHEN ai_tags IS NULL OR ai_tags = '[]' THEN COALESCE((
            SELECT other.ai_tags FROM repositories AS other
            WHERE other.id = repositories.id AND other.account_id != repositories.account_id
              AND other.account_id != 'default'
              AND other.ai_tags IS NOT NULL AND other.ai_tags != '[]'
            LIMIT 1
          ), ai_tags)
          ELSE ai_tags END,
        ai_platforms = CASE
          WHEN ai_platforms IS NULL OR ai_platforms = '[]' THEN COALESCE((
            SELECT other.ai_platforms FROM repositories AS other
            WHERE other.id = repositories.id AND other.account_id != repositories.account_id
              AND other.account_id != 'default'
              AND other.ai_platforms IS NOT NULL AND other.ai_platforms != '[]'
            LIMIT 1
          ), ai_platforms)
          ELSE ai_platforms END,
        analyzed_at = CASE
          WHEN analyzed_at IS NULL OR analyzed_at = '' THEN COALESCE((
            SELECT other.analyzed_at FROM repositories AS other
            WHERE other.id = repositories.id AND other.account_id != repositories.account_id
              AND other.account_id != 'default'
              AND other.analyzed_at IS NOT NULL AND other.analyzed_at != ''
            LIMIT 1
          ), analyzed_at)
          ELSE analyzed_at END
      WHERE account_id = ? AND account_id != 'default' AND (
        ai_summary IS NULL OR ai_summary = ''
        OR ai_tags IS NULL OR ai_tags = '[]'
        OR ai_platforms IS NULL OR ai_platforms = '[]'
        OR analyzed_at IS NULL OR analyzed_at = ''
      )
    `);

    const upsert = db.transaction(() => {
      if (isFullSync) {
        const repoIds = repositories
          .map((repo) => repo.id)
          .filter((id): id is number => typeof id === 'number');

        if (repoIds.length === 0) {
          // 清空严格限定在当前账号分区，绝不能触碰其他账号的数据。
          deleteAllAccountReleases.run(accountId);
          deleteAllAccountRepositories.run(accountId);
          return 0;
        }

        const placeholders = repoIds.map(() => '?').join(', ');
        deleteReleasesNotIn(placeholders).run(accountId, ...repoIds);
        deleteRepositoriesNotIn(placeholders).run(accountId, ...repoIds);
      }

      let count = 0;
      for (const repo of repositories) {
        const owner = repo.owner as { login?: string; avatar_url?: string } | undefined;
        // 仅当 payload 显式提供 license 字段时才覆盖已存储值；省略（旧客户端/旧备份）则保留。
        const licenseProvided = Object.prototype.hasOwnProperty.call(repo, 'license') ? 1 : 0;
        stmt.run(
          repo.id, repo.name, repo.full_name, repo.description ?? null,
          repo.html_url, repo.stargazers_count ?? 0, repo.language ?? null,
          repo.created_at ?? null, repo.updated_at ?? null, repo.pushed_at ?? null,
          repo.starred_at ?? null,
          owner?.login ?? '', owner?.avatar_url ?? null,
          JSON.stringify(Array.isArray(repo.topics) ? repo.topics : []),
          repo.ai_summary ?? null,
          JSON.stringify(Array.isArray(repo.ai_tags) ? repo.ai_tags : []),
          JSON.stringify(Array.isArray(repo.ai_platforms) ? repo.ai_platforms : []),
          repo.analyzed_at ?? null, (repo.analysis_failed === true || repo.analysis_failed === 1) ? 1 : 0,
          repo.custom_description ?? null,
          JSON.stringify(Array.isArray(repo.custom_tags) ? repo.custom_tags : []),
          repo.custom_category ?? null, (repo.category_locked === true || repo.category_locked === 1) ? 1 : 0, repo.last_edited ?? null,
          (repo.subscribed_to_releases === true || repo.subscribed_to_releases === 1) ? 1 : 0,
          repo.vector_indexed_at ?? null,
          toLicenseSpdxId(repo.license),
          // 备份中 vector_indexed_license 已是规范化的 SPDX id 字符串或 null；
          // 非 string 一律清空，避免奇怪类型破坏增量谓词的字符串比较。
          typeof repo.vector_indexed_license === 'string' ? repo.vector_indexed_license || null : null,
          toDisplayPref(repo.description_display, DESCRIPTION_DISPLAY_VALUES),
          toDisplayPref(repo.tags_display, TAGS_DISPLAY_VALUES),
          accountId,
          { licenseProvided }
        );
        count++;
      }

      // 首次插入的行不经过 ON CONFLICT DO UPDATE 的回填分支：统一执行一次
      // 批量回填（对已补齐的行是 no-op），保证新账号首次同步即可复用已有分析。
      if (count > 0) {
        backfillAiFromOtherAccounts.run(accountId);
      }
      return count;
    });

    const count = upsert();
    res.json({ upserted: count });
  } catch (err) {
    console.error('PUT /api/repositories error:', err);
    res.status(500).json({ error: 'Failed to upsert repositories', code: 'UPSERT_REPOSITORIES_FAILED' });
  }
});

// PATCH /api/repositories/:id
router.patch('/api/repositories/:id', (req, res) => {
  try {
    const db = getDb();
    const scope = resolveWritableAccountScope(req, db);
    if (!scope.ok) {
      res.status(409).json({
        error: 'X-GitHub-Account-Id is required when multiple accounts exist',
        code: 'ACCOUNT_SCOPE_REQUIRED',
      });
      return;
    }
    const accountId = scope.accountId;
    const id = parseInt(req.params.id);
    const updates = req.body as Record<string, unknown>;

    const allowedFields: Record<string, (v: unknown) => unknown> = {
      ai_summary: (v) => v,
      ai_tags: (v) => JSON.stringify(Array.isArray(v) ? v : []),
      ai_platforms: (v) => JSON.stringify(Array.isArray(v) ? v : []),
      analyzed_at: (v) => v,
      analysis_failed: (v) => (v === true || v === 1) ? 1 : 0,
      custom_description: (v) => v,
      custom_tags: (v) => JSON.stringify(Array.isArray(v) ? v : []),
      custom_category: (v) => v,
      category_locked: (v) => (v === true || v === 1) ? 1 : 0,
      description_display: (v) => toDisplayPref(v, DESCRIPTION_DISPLAY_VALUES),
      tags_display: (v) => toDisplayPref(v, TAGS_DISPLAY_VALUES),
      last_edited: (v) => v,
      subscribed_to_releases: (v) => (v === true || v === 1) ? 1 : 0,
      // 规范化：null/undefined/空字符串 → null；仅接受字符串（ISO 时间戳）
      vector_indexed_at: (v) =>
        (v === null || v === undefined || v === '') ? null : v,
      // vector_indexed_license：规范化为 SPDX id 字符串或 null；非字符串一律清空。
      vector_indexed_license: (v) =>
        (v === null || v === undefined || v === '' || typeof v !== 'string') ? null : v,
      description: (v) => v,
      name: (v) => v,
    };

    // 校验 vector_indexed_at 类型：只允许 null 或 ISO 8601 字符串，拒绝数字/布尔/对象/非日期字符串
    if ('vector_indexed_at' in updates) {
      const v = updates.vector_indexed_at;
      if (v !== null && v !== undefined && v !== '' && (typeof v !== 'string' || isNaN(Date.parse(v)))) {
        res.status(400).json({
          error: 'vector_indexed_at must be an ISO string or null',
          code: 'INVALID_VECTOR_INDEXED_AT',
        });
        return;
      }
    }

    const setClauses: string[] = [];
    const values: unknown[] = [];

    for (const [key, transform] of Object.entries(allowedFields)) {
      if (key in updates) {
        setClauses.push(`${key} = ?`);
        values.push(transform(updates[key]));
      }
    }

    if (setClauses.length === 0) {
      res.status(400).json({ error: 'No valid fields to update', code: 'NO_VALID_FIELDS' });
      return;
    }

    // account_id 条件防跨账号改写（WHERE account_id = ? AND id = ?）
    values.push(accountId, id);
    db.prepare(`UPDATE repositories SET ${setClauses.join(', ')} WHERE account_id = ? AND id = ?`).run(...values);

    const row = db.prepare('SELECT * FROM repositories WHERE account_id = ? AND id = ?').get(accountId, id) as Record<string, unknown> | undefined;
    if (!row) {
      res.status(404).json({ error: 'Repository not found', code: 'REPOSITORY_NOT_FOUND' });
      return;
    }
    res.json(transformRepo(row));
  } catch (err) {
    console.error('PATCH /api/repositories error:', err);
    res.status(500).json({ error: 'Failed to update repository', code: 'UPDATE_REPOSITORY_FAILED' });
  }
});

// DELETE /api/repositories/:id
router.delete('/api/repositories/:id', (req, res) => {
  try {
    const idStr = req.params.id;
    if (!/^\d+$/.test(idStr)) {
      res.status(400).json({ error: 'Valid repository id required', code: 'INVALID_REPOSITORY_ID' });
      return;
    }
    const id = parseInt(idStr, 10);

    if (isNaN(id) || id <= 0) {
      res.status(400).json({ error: 'Valid repository id required', code: 'INVALID_REPOSITORY_ID' });
      return;
    }

    const db = getDb();
    const scope = resolveWritableAccountScope(req, db);
    if (!scope.ok) {
      res.status(409).json({
        error: 'X-GitHub-Account-Id is required when multiple accounts exist',
        code: 'ACCOUNT_SCOPE_REQUIRED',
      });
      return;
    }
    const accountId = scope.accountId;
    const deleteReleases = db.prepare('DELETE FROM releases WHERE account_id = ? AND repo_id = ?');
    const deleteRepo = db.prepare('DELETE FROM repositories WHERE account_id = ? AND id = ?');

    const deleteAll = db.transaction(() => {
      const releaseResult = deleteReleases.run(accountId, id);
      const repoResult = deleteRepo.run(accountId, id);

      return {
        releasesDeleted: releaseResult.changes,
        repoDeleted: repoResult.changes
      };
    });

    const result = deleteAll();

    if (result.repoDeleted === 0) {
      res.status(404).json({ error: 'Repository not found', code: 'REPOSITORY_NOT_FOUND' });
      return;
    }

    res.json({
      deleted: true,
      id,
      releasesDeleted: result.releasesDeleted
    });
  } catch (err) {
    console.error('DELETE /api/repositories/:id error:', err);
    res.status(500).json({ error: 'Failed to delete repository', code: 'DELETE_REPOSITORY_FAILED' });
  }
});

export default router;
