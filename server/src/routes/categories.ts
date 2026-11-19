import { randomUUID } from 'crypto';
import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { hasInvalidAccountHeader, resolveAccountScope, resolveWritableAccountScope } from '../db/accountScope.js';

const router = Router();

function getAccountScopeErrorMessage(req: Parameters<typeof hasInvalidAccountHeader>[0]): string {
  return hasInvalidAccountHeader(req)
    ? 'X-GitHub-Account-Id must be a numeric account ID'
    : 'X-GitHub-Account-Id header is required because the target account scope is ambiguous';
}

function parseJsonColumn(value: unknown): unknown[] {
  if (typeof value !== 'string' || !value) return [];
  try { return JSON.parse(value); } catch { return []; }
}

// ── Categories ──

function transformCategory(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    keywords: parseJsonColumn(row.keywords),
    color: row.color,
    icon: row.icon,
    sort_order: row.sort_order,
  };
}

// GET /api/categories
router.get('/api/categories', (req, res) => {
  try {
    const db = getDb();
    const accountId = resolveAccountScope(req, db);
    const rows = db.prepare('SELECT * FROM categories WHERE account_id = ? ORDER BY sort_order ASC, name ASC').all(accountId) as Record<string, unknown>[];
    res.json(rows.map(transformCategory));
  } catch (err) {
    console.error('GET /api/categories error:', err);
    res.status(500).json({ error: 'Failed to fetch categories', code: 'FETCH_CATEGORIES_FAILED' });
  }
});

// POST /api/categories
router.post('/api/categories', (req, res) => {
  try {
    const db = getDb();
    const scope = resolveWritableAccountScope(req, db);
    if (!scope.ok) {
      res.status(409).json({
        error: getAccountScopeErrorMessage(req),
        code: 'ACCOUNT_SCOPE_REQUIRED',
      });
      return;
    }
    const accountId = scope.accountId;
    const { name, description, keywords, color, icon, sort_order } = req.body as Record<string, unknown>;

    // v4 后 id TEXT 是复合主键 (account_id, id) 的组成部分，POST 必须显式生成 id。
    const id = randomUUID();

    db.prepare(
      'INSERT INTO categories (account_id, id, name, description, keywords, color, icon, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      accountId, id, name ?? '', description ?? null,
      JSON.stringify(keywords ?? []),
      // icon 为 NOT NULL 列：请求缺省时落默认图标（绑 null 会违反约束）
      color ?? null, icon ?? '📁', sort_order ?? 0
    );

    const row = db.prepare('SELECT * FROM categories WHERE account_id = ? AND id = ?').get(accountId, id) as Record<string, unknown>;
    res.status(201).json(transformCategory(row));
  } catch (err) {
    console.error('POST /api/categories error:', err);
    res.status(500).json({ error: 'Failed to create category', code: 'CREATE_CATEGORY_FAILED' });
  }
});

// PUT /api/categories/:id
router.put('/api/categories/:id', (req, res) => {
  try {
    const db = getDb();
    const scope = resolveWritableAccountScope(req, db);
    if (!scope.ok) {
      res.status(409).json({
        error: getAccountScopeErrorMessage(req),
        code: 'ACCOUNT_SCOPE_REQUIRED',
      });
      return;
    }
    const accountId = scope.accountId;
    const id = req.params.id;
    const { name, description, keywords, color, icon, sort_order } = req.body as Record<string, unknown>;

    db.prepare(
      'UPDATE categories SET name = ?, description = ?, keywords = ?, color = ?, icon = ?, sort_order = ? WHERE account_id = ? AND id = ?'
    ).run(
      name ?? '', description ?? null,
      JSON.stringify(keywords ?? []),
      color ?? null, icon ?? '📁', sort_order ?? 0, accountId, id
    );

    const row = db.prepare('SELECT * FROM categories WHERE account_id = ? AND id = ?').get(accountId, id) as Record<string, unknown> | undefined;
    if (!row) {
      res.status(404).json({ error: 'Category not found', code: 'CATEGORY_NOT_FOUND' });
      return;
    }
    res.json(transformCategory(row));
  } catch (err) {
    console.error('PUT /api/categories error:', err);
    res.status(500).json({ error: 'Failed to update category', code: 'UPDATE_CATEGORY_FAILED' });
  }
});

// DELETE /api/categories/:id
router.delete('/api/categories/:id', (req, res) => {
  try {
    const db = getDb();
    const scope = resolveWritableAccountScope(req, db);
    if (!scope.ok) {
      res.status(409).json({
        error: getAccountScopeErrorMessage(req),
        code: 'ACCOUNT_SCOPE_REQUIRED',
      });
      return;
    }
    const accountId = scope.accountId;
    const id = req.params.id;
    const result = db.prepare('DELETE FROM categories WHERE account_id = ? AND id = ?').run(accountId, id);
    if (result.changes === 0) {
      res.status(404).json({ error: 'Category not found', code: 'CATEGORY_NOT_FOUND' });
      return;
    }
    res.json({ deleted: true });
  } catch (err) {
    console.error('DELETE /api/categories error:', err);
    res.status(500).json({ error: 'Failed to delete category', code: 'DELETE_CATEGORY_FAILED' });
  }
});

// ── Asset Filters ──

function transformAssetFilter(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    keywords: parseJsonColumn(row.keywords),
    platform: row.platform,
    sort_order: row.sort_order,
  };
}

// GET /api/asset-filters
router.get('/api/asset-filters', (_req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM asset_filters ORDER BY sort_order ASC, name ASC').all() as Record<string, unknown>[];
    res.json(rows.map(transformAssetFilter));
  } catch (err) {
    console.error('GET /api/asset-filters error:', err);
    res.status(500).json({ error: 'Failed to fetch asset filters', code: 'FETCH_ASSET_FILTERS_FAILED' });
  }
});

// POST /api/asset-filters
router.post('/api/asset-filters', (req, res) => {
  try {
    const db = getDb();
    const { name, description, keywords, platform, sort_order } = req.body as Record<string, unknown>;

    const result = db.prepare(
      'INSERT INTO asset_filters (name, description, keywords, platform, sort_order) VALUES (?, ?, ?, ?, ?)'
    ).run(
      name ?? '', description ?? null,
      JSON.stringify(keywords ?? []),
      platform ?? null, sort_order ?? 0
    );

    const row = db.prepare('SELECT * FROM asset_filters WHERE id = ?').get(result.lastInsertRowid) as Record<string, unknown>;
    res.status(201).json(transformAssetFilter(row));
  } catch (err) {
    console.error('POST /api/asset-filters error:', err);
    res.status(500).json({ error: 'Failed to create asset filter', code: 'CREATE_ASSET_FILTER_FAILED' });
  }
});

// PUT /api/asset-filters/:id
router.put('/api/asset-filters/:id', (req, res) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id);
    const { name, description, keywords, platform, sort_order } = req.body as Record<string, unknown>;

    db.prepare(
      'UPDATE asset_filters SET name = ?, description = ?, keywords = ?, platform = ?, sort_order = ? WHERE id = ?'
    ).run(
      name ?? '', description ?? null,
      JSON.stringify(keywords ?? []),
      platform ?? null, sort_order ?? 0, id
    );

    const row = db.prepare('SELECT * FROM asset_filters WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) {
      res.status(404).json({ error: 'Asset filter not found', code: 'ASSET_FILTER_NOT_FOUND' });
      return;
    }
    res.json(transformAssetFilter(row));
  } catch (err) {
    console.error('PUT /api/asset-filters error:', err);
    res.status(500).json({ error: 'Failed to update asset filter', code: 'UPDATE_ASSET_FILTER_FAILED' });
  }
});

// DELETE /api/asset-filters/:id
router.delete('/api/asset-filters/:id', (req, res) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id);
    const result = db.prepare('DELETE FROM asset_filters WHERE id = ?').run(id);
    if (result.changes === 0) {
      res.status(404).json({ error: 'Asset filter not found', code: 'ASSET_FILTER_NOT_FOUND' });
      return;
    }
    res.json({ deleted: true });
  } catch (err) {
    console.error('DELETE /api/asset-filters error:', err);
    res.status(500).json({ error: 'Failed to delete asset filter', code: 'DELETE_ASSET_FILTER_FAILED' });
  }
});

export default router;
