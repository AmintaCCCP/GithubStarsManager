import { Router } from 'express';
import { getDb } from '../db/connection.js';

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
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const repoId = req.query.repo_id as string | undefined;
    const unread = req.query.unread as string | undefined;
    const offset = (page - 1) * limit;

    let sql = 'SELECT * FROM releases';
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (repoId) {
      conditions.push('repo_id = ?');
      params.push(parseInt(repoId));
    }
    if (unread === 'true') {
      conditions.push('is_read = 0');
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY published_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
    const releases = rows.map(transformRelease);

    let countSql = 'SELECT COUNT(*) as total FROM releases';
    const countParams: unknown[] = [];
    if (conditions.length > 0) {
      countSql += ' WHERE ' + conditions.join(' AND ');
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
    const { releases } = req.body as { releases: Record<string, unknown>[] };
    if (!Array.isArray(releases)) {
      res.status(400).json({ error: 'releases array required', code: 'RELEASES_ARRAY_REQUIRED' });
      return;
    }

    const stmt = db.prepare(`
      INSERT OR REPLACE INTO releases (
        id, tag_name, name, body, html_url, published_at,
        prerelease, draft, is_read, assets,
        repo_id, repo_full_name, repo_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const upsert = db.transaction(() => {
      let count = 0;
      for (const release of releases) {
        const repository = release.repository as { id?: number; full_name?: string; name?: string } | undefined;
        stmt.run(
          release.id,
          release.tag_name ?? null,
          release.name ?? null,
          release.body ?? null,
          release.html_url ?? null,
          release.published_at ?? null,
          release.prerelease ? 1 : 0,
          release.draft ? 1 : 0,
          release.is_read ? 1 : 0,
          JSON.stringify(release.assets ?? []),
          repository?.id ?? release.repo_id ?? null,
          repository?.full_name ?? release.repo_full_name ?? null,
          repository?.name ?? release.repo_name ?? null
        );
        count++;
      }
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
    const id = parseInt(req.params.id);
    const { is_read } = req.body as { is_read?: boolean };

    if (is_read === undefined) {
      res.status(400).json({ error: 'is_read field required', code: 'IS_READ_REQUIRED' });
      return;
    }

    db.prepare('UPDATE releases SET is_read = ? WHERE id = ?').run(is_read ? 1 : 0, id);

    const row = db.prepare('SELECT * FROM releases WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) {
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
router.post('/api/releases/mark-all-read', (_req, res) => {
  try {
    const db = getDb();
    const result = db.prepare('UPDATE releases SET is_read = 1').run();
    res.json({ updated: result.changes });
  } catch (err) {
    console.error('POST /api/releases/mark-all-read error:', err);
    res.status(500).json({ error: 'Failed to mark all as read', code: 'MARK_ALL_READ_FAILED' });
  }
});

export default router;
