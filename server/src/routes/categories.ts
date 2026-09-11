import { Router } from 'express';
import { db } from '../db/client.js';

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
router.get('/api/categories', async (_req, res) => {
  try {
    const rows = await db.all<Record<string, unknown>>('SELECT * FROM categories ORDER BY sort_order ASC, name ASC');
    res.json(rows.map(transformCategory));
  } catch (err) {
    console.error('GET /api/categories error:', err);
    res.status(500).json({ error: 'Failed to fetch categories', code: 'FETCH_CATEGORIES_FAILED' });
  }
});

// POST /api/categories
router.post('/api/categories', async (req, res) => {
  try {
    const { name, description, keywords, color, icon, sort_order } = req.body as Record<string, unknown>;

    const result = await db.run(
      'INSERT INTO categories (name, description, keywords, color, icon, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
      name ?? '', description ?? null,
      JSON.stringify(keywords ?? []),
      color ?? null, icon ?? null, sort_order ?? 0
    );

    const row = await db.get<Record<string, unknown>>('SELECT * FROM categories WHERE id = ?', result.lastInsertRowid);
    res.status(201).json(transformCategory(row as Record<string, unknown>));
  } catch (err) {
    console.error('POST /api/categories error:', err);
    res.status(500).json({ error: 'Failed to create category', code: 'CREATE_CATEGORY_FAILED' });
  }
});

// PUT /api/categories/:id
router.put('/api/categories/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { name, description, keywords, color, icon, sort_order } = req.body as Record<string, unknown>;

    await db.run(
      'UPDATE categories SET name = ?, description = ?, keywords = ?, color = ?, icon = ?, sort_order = ? WHERE id = ?',
      name ?? '', description ?? null,
      JSON.stringify(keywords ?? []),
      color ?? null, icon ?? null, sort_order ?? 0, id
    );

    const row = await db.get<Record<string, unknown>>('SELECT * FROM categories WHERE id = ?', id);
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
router.delete('/api/categories/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const result = await db.run('DELETE FROM categories WHERE id = ?', id);
    if (result.rowsAffected === 0) {
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
router.get('/api/asset-filters', async (_req, res) => {
  try {
    const rows = await db.all<Record<string, unknown>>('SELECT * FROM asset_filters ORDER BY sort_order ASC, name ASC');
    res.json(rows.map(transformAssetFilter));
  } catch (err) {
    console.error('GET /api/asset-filters error:', err);
    res.status(500).json({ error: 'Failed to fetch asset filters', code: 'FETCH_ASSET_FILTERS_FAILED' });
  }
});

// POST /api/asset-filters
router.post('/api/asset-filters', async (req, res) => {
  try {
    const { name, description, keywords, platform, sort_order } = req.body as Record<string, unknown>;

    const result = await db.run(
      'INSERT INTO asset_filters (name, description, keywords, platform, sort_order) VALUES (?, ?, ?, ?, ?)',
      name ?? '', description ?? null,
      JSON.stringify(keywords ?? []),
      platform ?? null, sort_order ?? 0
    );

    const row = await db.get<Record<string, unknown>>('SELECT * FROM asset_filters WHERE id = ?', result.lastInsertRowid);
    res.status(201).json(transformAssetFilter(row as Record<string, unknown>));
  } catch (err) {
    console.error('POST /api/asset-filters error:', err);
    res.status(500).json({ error: 'Failed to create asset filter', code: 'CREATE_ASSET_FILTER_FAILED' });
  }
});

// PUT /api/asset-filters/:id
router.put('/api/asset-filters/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { name, description, keywords, platform, sort_order } = req.body as Record<string, unknown>;

    await db.run(
      'UPDATE asset_filters SET name = ?, description = ?, keywords = ?, platform = ?, sort_order = ? WHERE id = ?',
      name ?? '', description ?? null,
      JSON.stringify(keywords ?? []),
      platform ?? null, sort_order ?? 0, id
    );

    const row = await db.get<Record<string, unknown>>('SELECT * FROM asset_filters WHERE id = ?', id);
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
router.delete('/api/asset-filters/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const result = await db.run('DELETE FROM asset_filters WHERE id = ?', id);
    if (result.rowsAffected === 0) {
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
