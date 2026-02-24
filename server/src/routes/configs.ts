import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { encrypt, decrypt } from '../services/crypto.js';
import { config } from '../config.js';

const router = Router();

// ── AI Configs ──

function maskApiKey(key: string | null | undefined): string {
  if (!key || typeof key !== 'string') return '';
  if (key.length <= 4) return '****';
  return '***' + key.slice(-4);
}

// GET /api/configs/ai
router.get('/api/configs/ai', (_req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM ai_configs ORDER BY id ASC').all() as Record<string, unknown>[];
    const configs = rows.map((row) => {
      let decryptedKey = '';
      try {
        if (row.api_key_encrypted && typeof row.api_key_encrypted === 'string') {
          decryptedKey = decrypt(row.api_key_encrypted, config.encryptionKey);
        }
      } catch { /* leave empty */ }
      return {
        id: row.id,
        name: row.name,
        provider: row.provider,
        model: row.model,
        base_url: row.base_url,
        api_key: maskApiKey(decryptedKey),
        is_default: !!row.is_default,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
    });
    res.json(configs);
  } catch (err) {
    console.error('GET /api/configs/ai error:', err);
    res.status(500).json({ error: 'Failed to fetch AI configs', code: 'FETCH_AI_CONFIGS_FAILED' });
  }
});

// POST /api/configs/ai
router.post('/api/configs/ai', (req, res) => {
  try {
    const db = getDb();
    const { name, provider, model, base_url, apiKey, is_default } = req.body as Record<string, unknown>;

    const encryptedKey = apiKey && typeof apiKey === 'string' ? encrypt(apiKey, config.encryptionKey) : null;
    const now = new Date().toISOString();

    const result = db.prepare(
      'INSERT INTO ai_configs (name, provider, model, base_url, api_key_encrypted, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      name ?? '', provider ?? '', model ?? '', base_url ?? null,
      encryptedKey, is_default ? 1 : 0, now, now
    );

    res.status(201).json({ id: result.lastInsertRowid, name, provider, model, base_url, api_key: maskApiKey(apiKey as string), is_default: !!is_default });
  } catch (err) {
    console.error('POST /api/configs/ai error:', err);
    res.status(500).json({ error: 'Failed to create AI config', code: 'CREATE_AI_CONFIG_FAILED' });
  }
});

// PUT /api/configs/ai/:id
router.put('/api/configs/ai/:id', (req, res) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id);
    const { name, provider, model, base_url, apiKey, is_default } = req.body as Record<string, unknown>;

    let encryptedKey: string | null = null;
    if (apiKey && typeof apiKey === 'string' && !apiKey.startsWith('***')) {
      encryptedKey = encrypt(apiKey, config.encryptionKey);
    } else {
      // Keep existing encrypted key
      const existing = db.prepare('SELECT api_key_encrypted FROM ai_configs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
      encryptedKey = (existing?.api_key_encrypted as string) ?? null;
    }

    const now = new Date().toISOString();
    db.prepare(
      'UPDATE ai_configs SET name = ?, provider = ?, model = ?, base_url = ?, api_key_encrypted = ?, is_default = ?, updated_at = ? WHERE id = ?'
    ).run(name ?? '', provider ?? '', model ?? '', base_url ?? null, encryptedKey, is_default ? 1 : 0, now, id);

    let maskedKey = '';
    if (encryptedKey) {
      try { maskedKey = maskApiKey(decrypt(encryptedKey, config.encryptionKey)); } catch { maskedKey = '****'; }
    }

    res.json({ id, name, provider, model, base_url, api_key: maskedKey, is_default: !!is_default });
  } catch (err) {
    console.error('PUT /api/configs/ai error:', err);
    res.status(500).json({ error: 'Failed to update AI config', code: 'UPDATE_AI_CONFIG_FAILED' });
  }
});

// DELETE /api/configs/ai/:id
router.delete('/api/configs/ai/:id', (req, res) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id);
    const result = db.prepare('DELETE FROM ai_configs WHERE id = ?').run(id);
    if (result.changes === 0) {
      res.status(404).json({ error: 'AI config not found', code: 'AI_CONFIG_NOT_FOUND' });
      return;
    }
    res.json({ deleted: true });
  } catch (err) {
    console.error('DELETE /api/configs/ai error:', err);
    res.status(500).json({ error: 'Failed to delete AI config', code: 'DELETE_AI_CONFIG_FAILED' });
  }
});

// ── WebDAV Configs ──

function maskPassword(pwd: string | null | undefined): string {
  if (!pwd || typeof pwd !== 'string') return '';
  if (pwd.length <= 4) return '****';
  return '***' + pwd.slice(-4);
}

// GET /api/configs/webdav
router.get('/api/configs/webdav', (_req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM webdav_configs ORDER BY id ASC').all() as Record<string, unknown>[];
    const configs = rows.map((row) => {
      let decryptedPwd = '';
      try {
        if (row.password_encrypted && typeof row.password_encrypted === 'string') {
          decryptedPwd = decrypt(row.password_encrypted, config.encryptionKey);
        }
      } catch { /* leave empty */ }
      return {
        id: row.id,
        name: row.name,
        url: row.url,
        username: row.username,
        password: maskPassword(decryptedPwd),
        path: row.path,
        is_default: !!row.is_default,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
    });
    res.json(configs);
  } catch (err) {
    console.error('GET /api/configs/webdav error:', err);
    res.status(500).json({ error: 'Failed to fetch WebDAV configs', code: 'FETCH_WEBDAV_CONFIGS_FAILED' });
  }
});

// POST /api/configs/webdav
router.post('/api/configs/webdav', (req, res) => {
  try {
    const db = getDb();
    const { name, url, username, password, path, is_default } = req.body as Record<string, unknown>;

    const encryptedPwd = password && typeof password === 'string' ? encrypt(password, config.encryptionKey) : null;
    const now = new Date().toISOString();

    const result = db.prepare(
      'INSERT INTO webdav_configs (name, url, username, password_encrypted, path, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      name ?? '', url ?? '', username ?? '', encryptedPwd,
      path ?? '/', is_default ? 1 : 0, now, now
    );

    res.status(201).json({ id: result.lastInsertRowid, name, url, username, password: maskPassword(password as string), path, is_default: !!is_default });
  } catch (err) {
    console.error('POST /api/configs/webdav error:', err);
    res.status(500).json({ error: 'Failed to create WebDAV config', code: 'CREATE_WEBDAV_CONFIG_FAILED' });
  }
});

// PUT /api/configs/webdav/:id
router.put('/api/configs/webdav/:id', (req, res) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id);
    const { name, url, username, password, path, is_default } = req.body as Record<string, unknown>;

    let encryptedPwd: string | null = null;
    if (password && typeof password === 'string' && !password.startsWith('***')) {
      encryptedPwd = encrypt(password, config.encryptionKey);
    } else {
      const existing = db.prepare('SELECT password_encrypted FROM webdav_configs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
      encryptedPwd = (existing?.password_encrypted as string) ?? null;
    }

    const now = new Date().toISOString();
    db.prepare(
      'UPDATE webdav_configs SET name = ?, url = ?, username = ?, password_encrypted = ?, path = ?, is_default = ?, updated_at = ? WHERE id = ?'
    ).run(name ?? '', url ?? '', username ?? '', encryptedPwd, path ?? '/', is_default ? 1 : 0, now, id);

    let maskedPwd = '';
    if (encryptedPwd) {
      try { maskedPwd = maskPassword(decrypt(encryptedPwd, config.encryptionKey)); } catch { maskedPwd = '****'; }
    }

    res.json({ id, name, url, username, password: maskedPwd, path, is_default: !!is_default });
  } catch (err) {
    console.error('PUT /api/configs/webdav error:', err);
    res.status(500).json({ error: 'Failed to update WebDAV config', code: 'UPDATE_WEBDAV_CONFIG_FAILED' });
  }
});

// DELETE /api/configs/webdav/:id
router.delete('/api/configs/webdav/:id', (req, res) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id);
    const result = db.prepare('DELETE FROM webdav_configs WHERE id = ?').run(id);
    if (result.changes === 0) {
      res.status(404).json({ error: 'WebDAV config not found', code: 'WEBDAV_CONFIG_NOT_FOUND' });
      return;
    }
    res.json({ deleted: true });
  } catch (err) {
    console.error('DELETE /api/configs/webdav error:', err);
    res.status(500).json({ error: 'Failed to delete WebDAV config', code: 'DELETE_WEBDAV_CONFIG_FAILED' });
  }
});

// ── Settings ──

// GET /api/settings
router.get('/api/settings', (_req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM settings').all() as Record<string, unknown>[];
    const settings: Record<string, unknown> = {};

    for (const row of rows) {
      const key = row.key as string;
      let value = row.value as string | null;

      if (key === 'github_token' && value) {
        try {
          const decrypted = decrypt(value, config.encryptionKey);
          value = maskApiKey(decrypted);
        } catch {
          value = '****';
        }
      }

      settings[key] = value;
    }

    res.json(settings);
  } catch (err) {
    console.error('GET /api/settings error:', err);
    res.status(500).json({ error: 'Failed to fetch settings', code: 'FETCH_SETTINGS_FAILED' });
  }
});

// PUT /api/settings
router.put('/api/settings', (req, res) => {
  try {
    const db = getDb();
    const updates = req.body as Record<string, unknown>;

    const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');

    const upsert = db.transaction(() => {
      for (const [key, rawValue] of Object.entries(updates)) {
        let value = rawValue as string | null;

        if (key === 'github_token' && value && typeof value === 'string') {
          if (value.startsWith('***')) {
            // Skip masked values — keep existing
            continue;
          }
          value = encrypt(value, config.encryptionKey);
        }

        stmt.run(key, value ?? null);
      }
    });

    upsert();
    res.json({ updated: true });
  } catch (err) {
    console.error('PUT /api/settings error:', err);
    res.status(500).json({ error: 'Failed to update settings', code: 'UPDATE_SETTINGS_FAILED' });
  }
});

export default router;
