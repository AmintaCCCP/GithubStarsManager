import { Router } from 'express';
import { getDb } from '../db/connection.js';

const router = Router();

// Helper to parse JSON columns safely
function parseJsonColumn(value: unknown): unknown[] {
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

// Helper to transform DB row to API response
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
    custom_tags: parseJsonColumn(row.custom_tags),
    custom_category: row.custom_category,
    last_edited: row.last_edited,
    subscribed_to_releases: !!row.subscribed_to_releases,
  };
}

// GET /api/repositories
router.get('/api/repositories', (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const db = getDb();
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(10000, Math.max(1, parseInt(req.query.limit as string) || 100));
    const search = req.query.search as string | undefined;
    const offset = (page - 1) * limit;

    let sql = 'SELECT * FROM repositories WHERE user_id = ?';
    const params: unknown[] = [userId];

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
      ? 'SELECT COUNT(*) as total FROM repositories WHERE user_id = ? AND (name LIKE ? OR full_name LIKE ? OR description LIKE ? OR ai_summary LIKE ? OR ai_tags LIKE ?)'
      : 'SELECT COUNT(*) as total FROM repositories WHERE user_id = ?';
    const countParams = search ? [userId, ...Array(5).fill(`%${search}%`)] : [userId];
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
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const db = getDb();
    const { repositories } = req.body as { repositories: Record<string, unknown>[] };
    if (!Array.isArray(repositories)) {
      res.status(400).json({ error: 'repositories array required', code: 'REPOSITORIES_ARRAY_REQUIRED' });
      return;
    }

    const stmt = db.prepare(`
      INSERT OR REPLACE INTO repositories (
        id, user_id, name, full_name, description, html_url, stargazers_count, language,
        created_at, updated_at, pushed_at, starred_at,
        owner_login, owner_avatar_url, topics,
        ai_summary, ai_tags, ai_platforms, analyzed_at, analysis_failed,
        custom_description, custom_tags, custom_category, last_edited,
        subscribed_to_releases
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const upsert = db.transaction(() => {
      let count = 0;
      for (const repo of repositories) {
        const owner = repo.owner as { login?: string; avatar_url?: string } | undefined;
        stmt.run(
          repo.id, userId, repo.name, repo.full_name, repo.description ?? null,
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
          repo.custom_category ?? null, repo.last_edited ?? null,
          (repo.subscribed_to_releases === true || repo.subscribed_to_releases === 1) ? 1 : 0
        );
        count++;
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
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const db = getDb();
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
      last_edited: (v) => v,
      subscribed_to_releases: (v) => (v === true || v === 1) ? 1 : 0,
      description: (v) => v,
      name: (v) => v,
    };

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

    values.push(id, userId);
    const result = db.prepare(`UPDATE repositories SET ${setClauses.join(', ')} WHERE id = ? AND user_id = ?`).run(...values);

    if (result.changes === 0) {
      res.status(404).json({ error: 'Repository not found', code: 'REPOSITORY_NOT_FOUND' });
      return;
    }

    const row = db.prepare('SELECT * FROM repositories WHERE id = ? AND user_id = ?').get(id, userId) as Record<string, unknown> | undefined;
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

export default router;
