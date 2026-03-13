import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { encrypt, decrypt } from '../services/crypto.js';
import { config } from '../config.js';
import { sendNotification } from '../services/notification.js';
import { getUserTasks, updateUserTask, getNotificationPreferences, updateNotificationPreferences } from '../services/scheduler.js';

const router = Router();

// ── AI Configs ──

function maskApiKey(key: string | null | undefined): string {
  if (!key || typeof key !== 'string') return '';
  if (key.length <= 4) return '****';
  return '***' + key.slice(-4);
}

// GET /api/configs/ai
router.get('/api/configs/ai', (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const db = getDb();
    const shouldDecrypt = req.query.decrypt === 'true';
    const rows = db.prepare('SELECT * FROM ai_configs WHERE user_id = ? ORDER BY id ASC').all(userId) as Record<string, unknown>[];
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
        apiType: row.api_type,
        model: row.model,
        baseUrl: row.base_url,
        apiKey: shouldDecrypt ? decryptedKey : maskApiKey(decryptedKey),
        isActive: !!row.is_active,
        customPrompt: row.custom_prompt ?? null,
        useCustomPrompt: !!row.use_custom_prompt,
        concurrency: row.concurrency ?? 1,
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
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const db = getDb();
    const { name, apiType, model, baseUrl, apiKey, isActive, customPrompt, useCustomPrompt, concurrency } = req.body as Record<string, unknown>;

    const encryptedKey = apiKey && typeof apiKey === 'string' ? encrypt(apiKey, config.encryptionKey) : null;

    const result = db.prepare(
      'INSERT INTO ai_configs (user_id, name, api_type, model, base_url, api_key_encrypted, is_active, custom_prompt, use_custom_prompt, concurrency) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      userId, name ?? '', apiType ?? 'openai', model ?? '', baseUrl ?? null,
      encryptedKey, isActive ? 1 : 0, customPrompt ?? null, useCustomPrompt ? 1 : 0, concurrency ?? 1
    );

    res.status(201).json({ id: result.lastInsertRowid, name, apiType, model, baseUrl, apiKey: maskApiKey(apiKey as string), isActive: !!isActive });
  } catch (err) {
    console.error('POST /api/configs/ai error:', err);
    res.status(500).json({ error: 'Failed to create AI config', code: 'CREATE_AI_CONFIG_FAILED' });
  }
});

// PUT /api/configs/ai/bulk — replace all AI configs (for sync)
// MUST be registered before :id route to avoid matching 'bulk' as an id
router.put('/api/configs/ai/bulk', (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const db = getDb();
    const configs = req.body.configs as Array<{
      id: string;
      name: string;
      apiType?: string;
      baseUrl: string;
      apiKey: string;
      model: string;
      isActive: boolean;
      customPrompt?: string;
      useCustomPrompt?: boolean;
      concurrency?: number;
    }>;

    if (!Array.isArray(configs)) {
      res.status(400).json({ error: 'configs array required', code: 'INVALID_REQUEST' });
      return;
    }

    const bulkSync = db.transaction(() => {
      // Read existing keys BEFORE delete
      const existingKeys = new Map<string, string>();
      const existingRows = db.prepare('SELECT id, api_key_encrypted FROM ai_configs WHERE user_id = ?').all(userId) as Array<{ id: string; api_key_encrypted: string }>;
      for (const row of existingRows) {
        if (row.api_key_encrypted) existingKeys.set(String(row.id), row.api_key_encrypted);
      }

      db.prepare('DELETE FROM ai_configs WHERE user_id = ?').run(userId);

      const stmt = db.prepare(`
        INSERT INTO ai_configs (id, user_id, name, api_type, base_url, api_key_encrypted, model, is_active, custom_prompt, use_custom_prompt, concurrency)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const c of configs) {
        let encryptedKey = '';
        if (c.apiKey && !c.apiKey.startsWith('***')) {
          encryptedKey = encrypt(c.apiKey, config.encryptionKey);
        } else {
          encryptedKey = existingKeys.get(String(c.id)) ?? '';
        }
        stmt.run(
          c.id, userId, c.name ?? '', c.apiType ?? 'openai', c.baseUrl ?? '',
          encryptedKey, c.model ?? '', c.isActive ? 1 : 0,
          c.customPrompt ?? null, c.useCustomPrompt ? 1 : 0, c.concurrency ?? 1
        );
      }
    });

    bulkSync();
    res.json({ synced: configs.length });
  } catch (err) {
    console.error('PUT /api/configs/ai/bulk error:', err);
    res.status(500).json({ error: 'Failed to sync AI configs', code: 'SYNC_AI_CONFIGS_FAILED' });
  }
});

// PUT /api/configs/ai/:id
router.put('/api/configs/ai/:id', (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const db = getDb();
    const id = req.params.id;
    const { name, apiType, model, baseUrl, apiKey, isActive, customPrompt, useCustomPrompt, concurrency } = req.body as Record<string, unknown>;

    let encryptedKey: string | null = null;
    if (apiKey && typeof apiKey === 'string' && !apiKey.startsWith('***')) {
      encryptedKey = encrypt(apiKey, config.encryptionKey);
    } else {
      // Keep existing encrypted key
      const existing = db.prepare('SELECT api_key_encrypted FROM ai_configs WHERE id = ? AND user_id = ?').get(id, userId) as Record<string, unknown> | undefined;
      encryptedKey = (existing?.api_key_encrypted as string) ?? null;
    }

    const result = db.prepare(
      'UPDATE ai_configs SET name = ?, api_type = ?, model = ?, base_url = ?, api_key_encrypted = ?, is_active = ?, custom_prompt = ?, use_custom_prompt = ?, concurrency = ? WHERE id = ? AND user_id = ?'
    ).run(name ?? '', apiType ?? 'openai', model ?? '', baseUrl ?? null, encryptedKey, isActive ? 1 : 0, customPrompt ?? null, useCustomPrompt ? 1 : 0, concurrency ?? 1, id, userId);

    if (result.changes === 0) {
      res.status(404).json({ error: 'AI config not found', code: 'AI_CONFIG_NOT_FOUND' });
      return;
    }
    let maskedKey = '';
    if (encryptedKey) {
      try { maskedKey = maskApiKey(decrypt(encryptedKey, config.encryptionKey)); } catch { maskedKey = '****'; }
    }

    res.json({ id, name, apiType, model, baseUrl, apiKey: maskedKey, isActive: !!isActive });
  } catch (err) {
    console.error('PUT /api/configs/ai error:', err);
    res.status(500).json({ error: 'Failed to update AI config', code: 'UPDATE_AI_CONFIG_FAILED' });
  }
});

// DELETE /api/configs/ai/:id
router.delete('/api/configs/ai/:id', (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const db = getDb();
    const id = req.params.id;
    const result = db.prepare('DELETE FROM ai_configs WHERE id = ? AND user_id = ?').run(id, userId);
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
router.get('/api/configs/webdav', (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const db = getDb();
    const shouldDecrypt = req.query.decrypt === 'true';
    const rows = db.prepare('SELECT * FROM webdav_configs WHERE user_id = ? ORDER BY id ASC').all(userId) as Record<string, unknown>[];
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
        password: shouldDecrypt ? decryptedPwd : maskPassword(decryptedPwd),
        path: row.path,
        isActive: !!row.is_active,
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
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const db = getDb();
    const { name, url, username, password, path, isActive } = req.body as Record<string, unknown>;

    const encryptedPwd = password && typeof password === 'string' ? encrypt(password, config.encryptionKey) : null;

    const result = db.prepare(
      'INSERT INTO webdav_configs (user_id, name, url, username, password_encrypted, path, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(
      userId, name ?? '', url ?? '', username ?? '', encryptedPwd,
      path ?? '/', isActive ? 1 : 0
    );

    res.status(201).json({ id: result.lastInsertRowid, name, url, username, password: maskPassword(password as string), path, isActive: !!isActive });
  } catch (err) {
    console.error('POST /api/configs/webdav error:', err);
    res.status(500).json({ error: 'Failed to create WebDAV config', code: 'CREATE_WEBDAV_CONFIG_FAILED' });
  }
});

// PUT /api/configs/webdav/bulk — replace all WebDAV configs (for sync)
// MUST be registered before :id route to avoid matching 'bulk' as an id
router.put('/api/configs/webdav/bulk', (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const db = getDb();
    const configs = req.body.configs as Array<{
      id: string;
      name: string;
      url: string;
      username: string;
      password: string;
      path: string;
      isActive: boolean;
    }>;

    if (!Array.isArray(configs)) {
      res.status(400).json({ error: 'configs array required', code: 'INVALID_REQUEST' });
      return;
    }

    const bulkSync = db.transaction(() => {
      // Read existing passwords BEFORE delete
      const existingPwds = new Map<string, string>();
      const existingRows = db.prepare('SELECT id, password_encrypted FROM webdav_configs WHERE user_id = ?').all(userId) as Array<{ id: string; password_encrypted: string }>;
      for (const row of existingRows) {
        if (row.password_encrypted) existingPwds.set(String(row.id), row.password_encrypted);
      }

      db.prepare('DELETE FROM webdav_configs WHERE user_id = ?').run(userId);

      const stmt = db.prepare(`
        INSERT INTO webdav_configs (id, user_id, name, url, username, password_encrypted, path, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const c of configs) {
        let encryptedPwd = '';
        if (c.password && !c.password.startsWith('***')) {
          encryptedPwd = encrypt(c.password, config.encryptionKey);
        } else {
          encryptedPwd = existingPwds.get(String(c.id)) ?? '';
        }
        stmt.run(
          c.id, userId, c.name ?? '', c.url ?? '', c.username ?? '',
          encryptedPwd, c.path ?? '/', c.isActive ? 1 : 0
        );
      }
    });

    bulkSync();
    res.json({ synced: configs.length });
  } catch (err) {
    console.error('PUT /api/configs/webdav/bulk error:', err);
    res.status(500).json({ error: 'Failed to sync WebDAV configs', code: 'SYNC_WEBDAV_CONFIGS_FAILED' });
  }
});

// PUT /api/configs/webdav/:id
router.put('/api/configs/webdav/:id', (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const db = getDb();
    const id = req.params.id;
    const { name, url, username, password, path, isActive } = req.body as Record<string, unknown>;

    let encryptedPwd: string | null = null;
    if (password && typeof password === 'string' && !password.startsWith('***')) {
      encryptedPwd = encrypt(password, config.encryptionKey);
    } else {
      const existing = db.prepare('SELECT password_encrypted FROM webdav_configs WHERE id = ? AND user_id = ?').get(id, userId) as Record<string, unknown> | undefined;
      encryptedPwd = (existing?.password_encrypted as string) ?? null;
    }

    const result = db.prepare(
      'UPDATE webdav_configs SET name = ?, url = ?, username = ?, password_encrypted = ?, path = ?, is_active = ? WHERE id = ? AND user_id = ?'
    ).run(name ?? '', url ?? '', username ?? '', encryptedPwd, path ?? '/', isActive ? 1 : 0, id, userId);

    if (result.changes === 0) {
      res.status(404).json({ error: 'WebDAV config not found', code: 'WEBDAV_CONFIG_NOT_FOUND' });
      return;
    }
    let maskedPwd = '';
    if (encryptedPwd) {
      try { maskedPwd = maskPassword(decrypt(encryptedPwd, config.encryptionKey)); } catch { maskedPwd = '****'; }
    }

    res.json({ id, name, url, username, password: maskedPwd, path, isActive: !!isActive });
  } catch (err) {
    console.error('PUT /api/configs/webdav error:', err);
    res.status(500).json({ error: 'Failed to update WebDAV config', code: 'UPDATE_WEBDAV_CONFIG_FAILED' });
  }
});

// DELETE /api/configs/webdav/:id
router.delete('/api/configs/webdav/:id', (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const db = getDb();
    const id = req.params.id;
    const result = db.prepare('DELETE FROM webdav_configs WHERE id = ? AND user_id = ?').run(id, userId);
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
router.get('/api/settings', (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const db = getDb();
    const rows = db.prepare('SELECT * FROM settings WHERE user_id = ?').all(userId) as Record<string, unknown>[];
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
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const db = getDb();
    const updates = req.body as Record<string, unknown>;

    const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, user_id, value) VALUES (?, ?, ?)');

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

        stmt.run(key, userId, value ?? null);
      }
    });

    upsert();
    res.json({ updated: true });
  } catch (err) {
    console.error('PUT /api/settings error:', err);
    res.status(500).json({ error: 'Failed to update settings', code: 'UPDATE_SETTINGS_FAILED' });
  }
});

// POST /api/notifications/test
router.post('/api/notifications/test', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { url } = req.body as { url?: string };
    
    const db = getDb();
    let notificationUrl = url;
    
    if (!notificationUrl) {
      const user = db.prepare('SELECT apprise_url FROM users WHERE id = ?').get(userId) as { apprise_url: string | null } | undefined;
      notificationUrl = user?.apprise_url || undefined;
    }
    
    if (!notificationUrl) {
      return res.status(400).json({ error: 'No notification URL configured', code: 'NO_NOTIFICATION_URL' });
    }

    const title = '🧪 Test Notification';
    const message = 'This is a test notification from GitHub Stars Manager. If you see this, your notification setup is working correctly!';
    
    const success = await sendNotification(notificationUrl, title, message);
    
    if (success) {
      res.json({ success: true, message: 'Notification sent successfully' });
    } else {
      res.status(500).json({ error: 'Failed to send notification', code: 'NOTIFICATION_FAILED' });
    }
  } catch (err) {
    console.error('POST /api/notifications/test error:', err);
    res.status(500).json({ error: 'Failed to send test notification', code: 'TEST_NOTIFICATION_FAILED' });
  }
});

// GET /api/scheduled-tasks
router.get('/api/scheduled-tasks', (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const tasks = getUserTasks(userId);
    res.json(tasks);
  } catch (err) {
    console.error('GET /api/scheduled-tasks error:', err);
    res.status(500).json({ error: 'Failed to get scheduled tasks' });
  }
});

// PUT /api/scheduled-tasks/:taskType
router.put('/api/scheduled-tasks/:taskType', (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { taskType } = req.params;
    const updates = req.body as { enabled?: number; cron_expression?: string };

    const task = updateUserTask(userId, taskType, updates);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.json(task);
  } catch (err: any) {
    console.error('PUT /api/scheduled-tasks error:', err);
    res.status(500).json({ error: err.message || 'Failed to update scheduled task' });
  }
});

// GET /api/notification-preferences
router.get('/api/notification-preferences', (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const prefs = getNotificationPreferences(userId);
    res.json(prefs);
  } catch (err) {
    console.error('GET /api/notification-preferences error:', err);
    res.status(500).json({ error: 'Failed to get notification preferences' });
  }
});

// PUT /api/notification-preferences
router.put('/api/notification-preferences', (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const updates = req.body as Partial<{
      notify_new_release: number;
      notify_star_added: number;
      notify_star_removed: number;
    }>;

    const prefs = updateNotificationPreferences(userId, updates);
    res.json(prefs);
  } catch (err) {
    console.error('PUT /api/notification-preferences error:', err);
    res.status(500).json({ error: 'Failed to update notification preferences' });
  }
});

export default router;
