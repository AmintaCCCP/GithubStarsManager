import { Router } from 'express';
import crypto from 'node:crypto';
import { getDb } from '../db/connection.js';

const router = Router();

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
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const db = getDb();
    const rows = db.prepare('SELECT * FROM categories WHERE user_id = ? ORDER BY sort_order ASC, name ASC').all(userId) as Record<string, unknown>[];
    res.json(rows.map(transformCategory));
  } catch (err) {
    console.error('GET /api/categories error:', err);
    res.status(500).json({ error: 'Failed to fetch categories', code: 'FETCH_CATEGORIES_FAILED' });
  }
});

// POST /api/categories
router.post('/api/categories', (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const db = getDb();
    const { id, name, description, keywords, color, icon, sort_order } = req.body as Record<string, unknown>;

    const result = db.prepare(
      'INSERT INTO categories (id, user_id, name, description, keywords, color, icon, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      id ?? crypto.randomUUID(), userId, name ?? '', description ?? null,
      JSON.stringify(keywords ?? []),
      color ?? null, icon ?? null, sort_order ?? 0
    );

    const row = db.prepare('SELECT * FROM categories WHERE id = ?').get(result.lastInsertRowid) as Record<string, unknown>;
    res.status(201).json(transformCategory(row));
  } catch (err) {
    console.error('POST /api/categories error:', err);
    res.status(500).json({ error: 'Failed to create category', code: 'CREATE_CATEGORY_FAILED' });
  }
});

// PUT /api/categories/:id
router.put('/api/categories/:id', (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const db = getDb();
    const id = req.params.id; // changed to string since schema uses TEXT PRIMARY KEY for categories
    const { name, description, keywords, color, icon, sort_order } = req.body as Record<string, unknown>;

    db.prepare(
      'UPDATE categories SET name = ?, description = ?, keywords = ?, color = ?, icon = ?, sort_order = ? WHERE id = ? AND user_id = ?'
    ).run(
      name ?? '', description ?? null,
      JSON.stringify(keywords ?? []),
      color ?? null, icon ?? null, sort_order ?? 0, id, userId
    );

    const row = db.prepare('SELECT * FROM categories WHERE id = ? AND user_id = ?').get(id, userId) as Record<string, unknown> | undefined;
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
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const db = getDb();
    const id = req.params.id;
    const result = db.prepare('DELETE FROM categories WHERE id = ? AND user_id = ?').run(id, userId);
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
router.get('/api/asset-filters', (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const db = getDb();
    const rows = db.prepare('SELECT * FROM asset_filters WHERE user_id = ? ORDER BY sort_order ASC, name ASC').all(userId) as Record<string, unknown>[];
    res.json(rows.map(transformAssetFilter));
  } catch (err) {
    console.error('GET /api/asset-filters error:', err);
    res.status(500).json({ error: 'Failed to fetch asset filters', code: 'FETCH_ASSET_FILTERS_FAILED' });
  }
});

// POST /api/asset-filters
router.post('/api/asset-filters', (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const db = getDb();
    const { id, name, description, keywords, platform, sort_order } = req.body as Record<string, unknown>;

    const result = db.prepare(
      'INSERT INTO asset_filters (id, user_id, name, description, keywords, platform, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(
      id ?? crypto.randomUUID(), userId, name ?? '', description ?? null,
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
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const db = getDb();
    const id = req.params.id; // It's TEXT PRIMARY KEY
    const { name, description, keywords, platform, sort_order } = req.body as Record<string, unknown>;

    db.prepare(
      'UPDATE asset_filters SET name = ?, description = ?, keywords = ?, platform = ?, sort_order = ? WHERE id = ? AND user_id = ?'
    ).run(
      name ?? '', description ?? null,
      JSON.stringify(keywords ?? []),
      platform ?? null, sort_order ?? 0, id, userId
    );

    const row = db.prepare('SELECT * FROM asset_filters WHERE id = ? AND user_id = ?').get(id, userId) as Record<string, unknown> | undefined;
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
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const db = getDb();
    const id = req.params.id;
    const result = db.prepare('DELETE FROM asset_filters WHERE id = ? AND user_id = ?').run(id, userId);
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
