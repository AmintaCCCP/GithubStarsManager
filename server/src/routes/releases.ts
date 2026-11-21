import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { resolveAccountScope, resolveWritableAccountScope, hasInvalidAccountHeader, bumpAccountRevision } from '../db/accountScope.js';

const router = Router();

function parseJsonColumn(value: unknown): unknown[] {
  if (typeof value !== 'string' || !value) return [];
  try { return JSON.parse(value); } catch { return []; }
}

function transformRelease(row: Record<string, unknown>) {
  return {
    id: row.id,
    tag_name: row.tag_name,
    name: row.name,
    body: row.body,
    html_url: row.html_url,
    published_at: row.published_at,
    prerelease: !!row.prerelease,
    draft: !!row.draft,
    is_read: !!row.is_read,
    assets: parseJsonColumn(row.assets),
    zipball_url: row.zipball_url ?? undefined,
    tarball_url: row.tarball_url ?? undefined,
    repository: {
      id: row.repo_id,
      full_name: row.repo_full_name,
      name: row.repo_name,
    },
  };
}

// GET /api/releases
router.get('/api/releases', (req, res) => {
  try {
    const db = getDb();
    // Issue #612 审计（143）：显式携带但格式无效的账号头（空白 / 非数字）按无效
    // 请求处理，绝不当作缺失回退到活跃账号 / default 分区读取他人数据。
    if (hasInvalidAccountHeader(req)) {
      res.status(409).json({
        error: 'X-GitHub-Account-Id must be a numeric account ID',
        code: 'ACCOUNT_SCOPE_REQUIRED',
      });
      return;
    }
    const accountId = resolveAccountScope(req, db);
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(10000, Math.max(1, parseInt(req.query.limit as string) || 50));
    const repoId = req.query.repo_id as string | undefined;
    const unread = req.query.unread as string | undefined;
    const offset = (page - 1) * limit;

    let sql = 'SELECT * FROM releases WHERE account_id = ?';
    const conditions: string[] = [];
    const params: unknown[] = [accountId];

    if (repoId) {
      conditions.push('repo_id = ?');
      params.push(parseInt(repoId));
    }
    if (unread === 'true') {
      conditions.push('is_read = 0');
    }

    if (conditions.length > 0) {
      sql += ' AND ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY published_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
    const releases = rows.map(transformRelease);

    let countSql = 'SELECT COUNT(*) as total FROM releases WHERE account_id = ?';
    const countParams: unknown[] = [accountId];
    if (conditions.length > 0) {
      countSql += ' AND ' + conditions.join(' AND ');
      if (repoId) countParams.push(parseInt(repoId));
    }
    const countRow = db.prepare(countSql).get(...countParams) as { total: number };

    res.json({ releases, total: countRow.total, page, limit });
  } catch (err) {
    console.error('GET /api/releases error:', err);
    res.status(500).json({ error: 'Failed to fetch releases', code: 'FETCH_RELEASES_FAILED' });
  }
});

// PUT /api/releases (bulk upsert)
router.put('/api/releases', (req, res) => {
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
    const { releases } = req.body as { releases: Record<string, unknown>[] };
    if (!Array.isArray(releases)) {
      res.status(400).json({ error: 'releases array required', code: 'RELEASES_ARRAY_REQUIRED' });
      return;
    }

    for (const release of releases) {
      if (!release.id || typeof release.id !== 'number' || release.id <= 0) {
        res.status(400).json({ error: 'Each release must have a valid positive integer id', code: 'RELEASE_ID_REQUIRED' });
        return;
      }
    }

    // v4 复合主键 (account_id, id)：两条 UPSERT 的冲突目标与 INSERT 列均加入
    // account_id；account_id 占位参数一律追加到参数列表末位（参数位置契约）。
    const stmtPreserveIsRead = db.prepare(`
      INSERT INTO releases (
        id, tag_name, name, body, html_url, published_at,
        prerelease, draft, is_read, assets,
        repo_id, repo_full_name, repo_name,
        zipball_url, tarball_url,
        account_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, id) DO UPDATE SET
        tag_name = excluded.tag_name,
        name = excluded.name,
        body = excluded.body,
        html_url = excluded.html_url,
        published_at = excluded.published_at,
        prerelease = excluded.prerelease,
        draft = excluded.draft,
        is_read = releases.is_read,
        assets = excluded.assets,
        repo_id = excluded.repo_id,
        repo_full_name = excluded.repo_full_name,
        repo_name = excluded.repo_name,
        zipball_url = excluded.zipball_url,
        tarball_url = excluded.tarball_url
    `);
    const stmtOverwriteIsRead = db.prepare(`
      INSERT INTO releases (
        id, tag_name, name, body, html_url, published_at,
        prerelease, draft, is_read, assets,
        repo_id, repo_full_name, repo_name,
        zipball_url, tarball_url,
        account_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, id) DO UPDATE SET
        tag_name = excluded.tag_name,
        name = excluded.name,
        body = excluded.body,
        html_url = excluded.html_url,
        published_at = excluded.published_at,
        prerelease = excluded.prerelease,
        draft = excluded.draft,
        is_read = excluded.is_read,
        assets = excluded.assets,
        repo_id = excluded.repo_id,
        repo_full_name = excluded.repo_full_name,
        repo_name = excluded.repo_name,
        zipball_url = excluded.zipball_url,
        tarball_url = excluded.tarball_url
    `);

    const upsert = db.transaction(() => {
      let count = 0;
      for (const release of releases) {
        const repository = release.repository as { id?: number; full_name?: string; name?: string } | undefined;
        // 合并 UPSERT：仅更新数据列，保留库中已有的 is_read 已读状态，避免整行替换把已读清空。
        // 仅当请求显式携带 is_read（如导入/同步完整快照）时才覆盖已读状态。
        const hasExplicitIsRead = typeof release.is_read === 'boolean';
        const stmt = hasExplicitIsRead ? stmtOverwriteIsRead : stmtPreserveIsRead;
        stmt.run(
          release.id,
          release.tag_name ?? null,
          release.name ?? null,
          release.body ?? null,
          release.html_url ?? null,
          release.published_at ?? null,
          release.prerelease ? 1 : 0,
          release.draft ? 1 : 0,
          hasExplicitIsRead ? (release.is_read ? 1 : 0) : 0,
          JSON.stringify(release.assets ?? []),
          repository?.id ?? release.repo_id ?? null,
          repository?.full_name ?? release.repo_full_name ?? null,
          repository?.name ?? release.repo_name ?? null,
          release.zipball_url ?? null,
          release.tarball_url ?? null,
          accountId
        );
        count++;
      }
      // Issue #612 A20x：发行版写入成功后递增账号分区的仓库快照版本。
      if (count > 0) bumpAccountRevision(db, accountId);
      return count;
    });

    const count = upsert();
    res.json({ upserted: count });
  } catch (err) {
    console.error('PUT /api/releases error:', err);
    res.status(500).json({ error: 'Failed to upsert releases', code: 'UPSERT_RELEASES_FAILED' });
  }
});

// PATCH /api/releases/:id
router.patch('/api/releases/:id', (req, res) => {
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
    const { is_read } = req.body as { is_read?: boolean };

    if (is_read === undefined) {
      res.status(400).json({ error: 'is_read field required', code: 'IS_READ_REQUIRED' });
      return;
    }

    // Issue #612 R2-A21：PATCH 写入与快照版本递增纳入同一事务——版本写入失败
    // 时数据写入一并回滚（PUT 路径 159-190 行方式）。
    const applyReadState = db.transaction((): Record<string, unknown> | null => {
      db.prepare('UPDATE releases SET is_read = ? WHERE account_id = ? AND id = ?').run(is_read ? 1 : 0, accountId, id);
      const row = db.prepare('SELECT * FROM releases WHERE account_id = ? AND id = ?').get(accountId, id) as Record<string, unknown> | undefined;
      if (!row) return null;
      // Issue #612 A20x：发行版写入成功后递增账号分区的仓库快照版本。
      bumpAccountRevision(db, accountId);
      return row;
    });

    const row = applyReadState();
    if (row === null) {
      res.status(404).json({ error: 'Release not found', code: 'RELEASE_NOT_FOUND' });
      return;
    }
    res.json(transformRelease(row));
  } catch (err) {
    console.error('PATCH /api/releases error:', err);
    res.status(500).json({ error: 'Failed to update release', code: 'UPDATE_RELEASE_FAILED' });
  }
});

// POST /api/releases/mark-all-read
router.post('/api/releases/mark-all-read', (req, res) => {
  try {
    const db = getDb();
    const scope = resolveWritableAccountScope(req, db);
    if (!scope.ok) {
      res.status(400).json({ error: 'Account id required', code: 'ACCOUNT_SCOPE_REQUIRED' });
      return;
    }
    const accountId = scope.accountId;
    // Issue #612 R2-A21：写入与快照版本递增纳入同一事务——版本写入失败时
    // 数据写入一并回滚（PUT 路径 159-190 行方式）。
    const markAll = db.transaction((): number => {
      const result = db.prepare('UPDATE releases SET is_read = 1 WHERE account_id = ?').run(accountId);
      // Issue #612 A20x：发行版写入成功后递增账号分区的仓库快照版本。
      if (result.changes > 0) bumpAccountRevision(db, accountId);
      return result.changes;
    });
    res.json({ updated: markAll() });
  } catch (err) {
    console.error('POST /api/releases/mark-all-read error:', err);
    res.status(500).json({ error: 'Failed to mark all as read', code: 'MARK_ALL_READ_FAILED' });
  }
});

// DELETE /api/releases/:id
router.delete('/api/releases/:id', (req, res) => {
  try {
    const idStr = req.params.id;
    if (!/^\d+$/.test(idStr)) {
      res.status(400).json({ error: 'Valid release id required', code: 'INVALID_RELEASE_ID' });
      return;
    }
    const id = parseInt(idStr, 10);

    if (isNaN(id) || id <= 0) {
      res.status(400).json({ error: 'Valid release id required', code: 'INVALID_RELEASE_ID' });
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
    // Issue #612 R2-A21：删除与快照版本递增纳入同一事务——版本写入失败时
    // 删除一并回滚（PUT 路径 159-190 行方式）。
    const remove = db.transaction((): boolean => {
      const result = db.prepare('DELETE FROM releases WHERE account_id = ? AND id = ?').run(accountId, id);
      if (result.changes === 0) return false;
      // Issue #612 A20x：发行版写入成功后递增账号分区的仓库快照版本。
      bumpAccountRevision(db, accountId);
      return true;
    });

    if (!remove()) {
      res.status(404).json({ error: 'Release not found', code: 'RELEASE_NOT_FOUND' });
      return;
    }

    res.json({ deleted: true, id });
  } catch (err) {
    console.error('DELETE /api/releases/:id error:', err);
    res.status(500).json({ error: 'Failed to delete release', code: 'DELETE_RELEASE_FAILED' });
  }
});

export default router;
