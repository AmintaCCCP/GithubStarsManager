import { Router } from 'express';
import { getDb } from '../db/connection.js';

const router = Router();

/** Parse a JSON string column from the database, returning an empty array on failure. */
function parseJsonColumn(value: unknown): unknown[] {
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
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
    custom_tags: parseJsonColumn(row.custom_tags),
    custom_category: row.custom_category,
    category_locked: !!row.category_locked,
    last_edited: row.last_edited,
    subscribed_to_releases: !!row.subscribed_to_releases,
  };
}

// GET /api/repositories
router.get('/api/repositories', (req, res) => {
  try {
    const db = getDb();
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(10000, Math.max(1, parseInt(req.query.limit as string) || 100));
    const search = req.query.search as string | undefined;
    const offset = (page - 1) * limit;

    let sql = 'SELECT * FROM repositories';
    const params: unknown[] = [];

    if (search) {
      const escaped = search.replace(/[%_\\]/g, '\\$&');
      sql += " WHERE name LIKE ? ESCAPE '\\' OR full_name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR ai_summary LIKE ? ESCAPE '\\' OR ai_tags LIKE ? ESCAPE '\\'";
      const searchPattern = `%${escaped}%`;
      params.push(searchPattern, searchPattern, searchPattern, searchPattern, searchPattern);
    }

    sql += ' ORDER BY stargazers_count DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
    const repositories = rows.map(transformRepo);

    const countSql = search
      ? 'SELECT COUNT(*) as total FROM repositories WHERE name LIKE ? OR full_name LIKE ? OR description LIKE ? OR ai_summary LIKE ? OR ai_tags LIKE ?'
      : 'SELECT COUNT(*) as total FROM repositories';
    const countParams = search ? Array(5).fill(`%${search}%`) : [];
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
    }

    const stmt = db.prepare(`
      INSERT INTO repositories (
        id, name, full_name, description, html_url, stargazers_count, language,
        created_at, updated_at, pushed_at, starred_at,
        owner_login, owner_avatar_url, topics,
        ai_summary, ai_tags, ai_platforms, analyzed_at, analysis_failed,
        custom_description, custom_tags, custom_category, category_locked, last_edited,
        subscribed_to_releases
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
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
        ai_summary = CASE WHEN excluded.ai_summary IS NOT NULL AND excluded.ai_summary != '' THEN excluded.ai_summary ELSE repositories.ai_summary END,
        ai_tags = CASE WHEN excluded.ai_tags IS NOT NULL AND excluded.ai_tags != '[]' THEN excluded.ai_tags ELSE repositories.ai_tags END,
        ai_platforms = CASE WHEN excluded.ai_platforms IS NOT NULL AND excluded.ai_platforms != '[]' THEN excluded.ai_platforms ELSE repositories.ai_platforms END,
        analyzed_at = CASE WHEN excluded.analyzed_at IS NOT NULL AND excluded.analyzed_at != '' THEN excluded.analyzed_at ELSE repositories.analyzed_at END,
        analysis_failed = excluded.analysis_failed,
        custom_description = CASE WHEN excluded.custom_description IS NOT NULL AND excluded.custom_description != '' THEN excluded.custom_description ELSE repositories.custom_description END,
        custom_tags = CASE WHEN excluded.custom_tags IS NOT NULL AND excluded.custom_tags != '[]' THEN excluded.custom_tags ELSE repositories.custom_tags END,
        custom_category = CASE WHEN excluded.custom_category IS NOT NULL AND excluded.custom_category != '' THEN excluded.custom_category ELSE repositories.custom_category END,
        category_locked = excluded.category_locked,
        last_edited = CASE WHEN excluded.last_edited IS NOT NULL AND excluded.last_edited != '' THEN excluded.last_edited ELSE repositories.last_edited END,
        subscribed_to_releases = excluded.subscribed_to_releases
    `);

    const deleteAllReleases = db.prepare('DELETE FROM releases');
    const deleteAllRepositories = db.prepare('DELETE FROM repositories');
    const deleteReleasesNotIn = (placeholders: string) =>
      db.prepare(`DELETE FROM releases WHERE repo_id NOT IN (${placeholders})`);
    const deleteRepositoriesNotIn = (placeholders: string) =>
      db.prepare(`DELETE FROM repositories WHERE id NOT IN (${placeholders})`);

    const upsert = db.transaction(() => {
      const isFullSync = Boolean(req.body?.isFullSync);

      if (isFullSync) {
        const repoIds = repositories
          .map((repo) => repo.id)
          .filter((id): id is number => typeof id === 'number');

        if (repoIds.length === 0) {
          deleteAllReleases.run();
          deleteAllRepositories.run();
          return 0;
        }

        const placeholders = repoIds.map(() => '?').join(', ');
        deleteReleasesNotIn(placeholders).run(...repoIds);
        deleteRepositoriesNotIn(placeholders).run(...repoIds);
      }

      let count = 0;
      for (const repo of repositories) {
        const owner = repo.owner as { login?: string; avatar_url?: string } | undefined;
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
      category_locked: (v) => (v === true || v === 1) ? 1 : 0,
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

    values.push(id);
    db.prepare(`UPDATE repositories SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);

    const row = db.prepare('SELECT * FROM repositories WHERE id = ?').get(id) as Record<string, unknown> | undefined;
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
    const deleteReleases = db.prepare('DELETE FROM releases WHERE repo_id = ?');
    const deleteRepo = db.prepare('DELETE FROM repositories WHERE id = ?');

    const deleteAll = db.transaction(() => {
      const releaseResult = deleteReleases.run(id);
      const repoResult = deleteRepo.run(id);
      
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
