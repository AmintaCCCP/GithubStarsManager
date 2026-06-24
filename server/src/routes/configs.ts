import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { encrypt, decrypt } from '../services/crypto.js';
import { config } from '../config.js';
import { logger } from '../services/logger.js';

const router = Router();

type SecretStatus = 'ok' | 'empty' | 'decrypt_failed';

function getMaskedSecretResult(params: {
  encryptedValue: unknown;
  encryptionKey: string;
  kind: 'AI API key' | 'WebDAV password' | 'GitHub token';
  configId?: unknown;
  configName?: unknown;
}): { decryptedValue: string; status: SecretStatus } {
  const { encryptedValue, encryptionKey, kind, configId, configName } = params;

  if (!encryptedValue || typeof encryptedValue !== 'string') {
    return { decryptedValue: '', status: 'empty' };
  }

  try {
    return {
      decryptedValue: decrypt(encryptedValue, encryptionKey),
      status: 'ok',
    };
  } catch {
    logger.warn('configs.decrypt', 'Failed to decrypt stored secret', { kind, configId, configName });
    return { decryptedValue: '', status: 'decrypt_failed' };
  }
}

// ── Helpers ──

function maskApiKey(key: string | null | undefined): string {
  if (!key || typeof key !== 'string') return '';
  if (key.length <= 4) return '****';
  return '***' + key.slice(-4);
}

/**
 * 为加密配置表注册 bulk sync / single update / delete 路由
 * 消除 AI configs 和 embedding configs 之间的重复代码
 */
function registerEncryptedConfigRoutes(opts: {
  router: ReturnType<typeof Router>;
  basePath: string;           // e.g. '/api/configs/ai'
  table: string;              // e.g. 'ai_configs'
  secretColumn: string;       // e.g. 'api_key_encrypted'
  label: string;              // e.g. 'AI config' (for error messages)
  logPrefix: string;          // e.g. 'configs.ai'
  insertSql: string;          // full INSERT statement with ? placeholders
  updateSql: string;          // full UPDATE statement with ? placeholders (last ? is id)
  /** Extract ordered bind params from a config body item for INSERT */
  insertParams: (c: Record<string, unknown>, encryptedKey: string) => unknown[];
  /** Extract ordered bind params from a req.body for UPDATE (last element must be id) */
  updateParams: (body: Record<string, unknown>, id: string, encryptedKey: string) => unknown[];
  /** Shape the response object for a single config */
  shapeResponse: (c: Record<string, unknown>, id: string | number, maskedKey: string) => Record<string, unknown>;
}): void {
  const { router, basePath, table, secretColumn, label, logPrefix, insertSql, updateSql, insertParams, updateParams, shapeResponse } = opts;

  // PUT /bulk — replace all configs (for sync)
  router.put(`${basePath}/bulk`, (req, res) => {
    const syncResult = { inserted: 0, skipped: [] as Array<{ id: string; name: string; reason: string }> };

    try {
      const db = getDb();
      const configs = req.body.configs as Array<Record<string, unknown>>;

      if (!Array.isArray(configs)) {
        res.status(400).json({ error: 'configs array required', code: 'INVALID_REQUEST' });
        return;
      }

      const bulkSync = db.transaction(() => {
        const existingKeys = new Map<string, string>();
        const existingRows = db.prepare(`SELECT id, ${secretColumn} FROM ${table}`).all() as Array<{ id: string; [key: string]: string }>;
        for (const row of existingRows) {
          if (row[secretColumn]) existingKeys.set(String(row.id), row[secretColumn]);
        }

        db.prepare(`DELETE FROM ${table}`).run();
        const stmt = db.prepare(insertSql);

        for (const c of configs) {
          let encryptedKey = '';
          const rawKey = c.apiKey ?? c.password;
          if (rawKey && typeof rawKey === 'string' && !rawKey.startsWith('***')) {
            try {
              encryptedKey = encrypt(String(rawKey), config.encryptionKey);
            } catch (encErr) {
              logger.errorFromError(`${logPrefix}.encrypt`, `Failed to encrypt secret for ${label}`, encErr, { configId: c.id, configName: c.name });
              encryptedKey = existingKeys.get(String(c.id)) ?? '';
              if (!encryptedKey) {
                syncResult.skipped.push({ id: String(c.id), name: String(c.name ?? ''), reason: 'encrypt_failed' });
                continue;
              }
            }
          } else {
            encryptedKey = existingKeys.get(String(c.id)) ?? '';
          }

          if (!encryptedKey) {
            syncResult.skipped.push({
              id: String(c.id),
              name: String(c.name ?? ''),
              reason: (typeof rawKey === 'string' && rawKey.startsWith('***'))
                ? 'Secret is masked and no existing key found'
                : 'Secret is empty',
            });
            continue;
          }

          stmt.run(...insertParams(c, encryptedKey));
          syncResult.inserted++;
        }

        if (syncResult.skipped.length > 0) {
          logger.warn(`${logPrefix}.bulk`, `Skipped ${label} configs with missing keys`, { skippedCount: syncResult.skipped.length, skipped: syncResult.skipped });
        }

        if (syncResult.inserted === 0 && configs.length > 0) {
          throw new Error('ALL_CONFIGS_SKIPPED');
        }
      });

      bulkSync();
      res.json({ synced: syncResult.inserted, skipped: syncResult.skipped.length, errors: syncResult.skipped });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.errorFromError(`${logPrefix}.bulk`, `PUT ${basePath}/bulk error`, err);
      if (errMsg === 'ALL_CONFIGS_SKIPPED') {
        res.status(422).json({
          error: `All ${label} configs were skipped — check the errors field for per-config reasons`,
          code: `SYNC_${logPrefix.toUpperCase().replace(/\./g, '_')}_ALL_SKIPPED`,
          synced: 0,
          skipped: syncResult.skipped.length,
          errors: syncResult.skipped,
        });
      } else {
        res.status(500).json({ error: `Failed to sync ${label} configs`, code: `SYNC_${logPrefix.toUpperCase().replace(/\./g, '_')}_FAILED` });
      }
    }
  });

  // PUT /:id — update single config
  router.put(`${basePath}/:id`, (req, res) => {
    try {
      const db = getDb();
      const id = req.params.id;
      const body = req.body as Record<string, unknown>;
      const rawKey = body.apiKey ?? body.password;

      let encryptedKey: string | null = null;
      if (rawKey && typeof rawKey === 'string' && !rawKey.startsWith('***')) {
        encryptedKey = encrypt(rawKey, config.encryptionKey);
      } else {
        const existing = db.prepare(`SELECT ${secretColumn} FROM ${table} WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
        encryptedKey = (existing?.[secretColumn] as string) ?? null;
      }

      const result = db.prepare(updateSql).run(...updateParams(body, id, encryptedKey ?? ''));

      if (result.changes === 0) {
        res.status(404).json({ error: `${label} not found`, code: `${logPrefix.toUpperCase().replace(/\./g, '_')}_NOT_FOUND` });
        return;
      }

      let maskedKey = '';
      if (encryptedKey) {
        try { maskedKey = maskApiKey(decrypt(encryptedKey, config.encryptionKey)); } catch { maskedKey = '****'; }
      }

      res.json(shapeResponse(body, id, maskedKey));
    } catch (err) {
      logger.errorFromError(`${logPrefix}.update`, `PUT ${basePath}/:id error`, err);
      res.status(500).json({ error: `Failed to update ${label}`, code: `UPDATE_${logPrefix.toUpperCase().replace(/\./g, '_')}_FAILED` });
    }
  });

  // DELETE /:id
  router.delete(`${basePath}/:id`, (req, res) => {
    try {
      const db = getDb();
      const id = req.params.id;
      const result = db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
      if (result.changes === 0) {
        res.status(404).json({ error: `${label} not found`, code: `${logPrefix.toUpperCase().replace(/\./g, '_')}_NOT_FOUND` });
        return;
      }
      res.json({ deleted: true });
    } catch (err) {
      logger.errorFromError(`${logPrefix}.delete`, `DELETE ${basePath}/:id error`, err);
      res.status(500).json({ error: `Failed to delete ${label}`, code: `DELETE_${logPrefix.toUpperCase().replace(/\./g, '_')}_FAILED` });
    }
  });
}

// GET /api/configs/ai
router.get('/api/configs/ai', (req, res) => {
  try {
    const db = getDb();
    const shouldDecrypt = req.query.decrypt === 'true';
    const rows = db.prepare('SELECT * FROM ai_configs ORDER BY id ASC').all() as Record<string, unknown>[];
    const configs = rows.map((row) => {
      const { decryptedValue, status } = getMaskedSecretResult({
        encryptedValue: row.api_key_encrypted,
        encryptionKey: config.encryptionKey,
        kind: 'AI API key',
        configId: row.id,
        configName: row.name,
      });
      return {
        id: row.id,
        name: row.name,
        apiType: row.api_type,
        model: row.model,
        baseUrl: row.base_url,
        apiKey: shouldDecrypt ? decryptedValue : maskApiKey(decryptedValue),
        apiKeyStatus: status,
        isActive: !!row.is_active,
        customPrompt: row.custom_prompt ?? null,
        useCustomPrompt: !!row.use_custom_prompt,
        concurrency: row.concurrency ?? 1,
        reasoningEffort: row.reasoning_effort ?? null,
        mimoPlan: row.mimo_plan ?? null,
      };
    });
    res.json(configs);
  } catch (err) {
    logger.errorFromError('configs.getAI', 'GET /api/configs/ai error', err);
    res.status(500).json({ error: 'Failed to fetch AI configs', code: 'FETCH_AI_CONFIGS_FAILED' });
  }
});

// POST /api/configs/ai
router.post('/api/configs/ai', (req, res) => {
  try {
    const db = getDb();
    const { name, apiType, model, baseUrl, apiKey, isActive, customPrompt, useCustomPrompt, concurrency, reasoningEffort, mimoPlan } = req.body as Record<string, unknown>;

    const encryptedKey = apiKey && typeof apiKey === 'string' ? encrypt(apiKey, config.encryptionKey) : null;

    const result = db.prepare(
      'INSERT INTO ai_configs (name, api_type, model, base_url, api_key_encrypted, is_active, custom_prompt, use_custom_prompt, concurrency, reasoning_effort, mimo_plan) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      name ?? '', apiType ?? 'openai', model ?? '', baseUrl ?? null,
      encryptedKey, isActive ? 1 : 0, customPrompt ?? null, useCustomPrompt ? 1 : 0, concurrency ?? 1, reasoningEffort ?? null, mimoPlan ?? null
    );

    res.status(201).json({ id: result.lastInsertRowid, name, apiType, model, baseUrl, apiKey: maskApiKey(apiKey as string), isActive: !!isActive, reasoningEffort: reasoningEffort ?? null, mimoPlan: mimoPlan ?? null });
  } catch (err) {
    logger.errorFromError('configs.createAI', 'POST /api/configs/ai error', err);
    res.status(500).json({ error: 'Failed to create AI config', code: 'CREATE_AI_CONFIG_FAILED' });
  }
});

// AI config bulk/update/delete — delegated to shared factory
registerEncryptedConfigRoutes({
  router,
  basePath: '/api/configs/ai',
  table: 'ai_configs',
  secretColumn: 'api_key_encrypted',
  label: 'AI config',
  logPrefix: 'configs.ai',
  insertSql: `INSERT INTO ai_configs (id, name, api_type, base_url, api_key_encrypted, model, is_active, custom_prompt, use_custom_prompt, concurrency, reasoning_effort, mimo_plan) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  updateSql: `UPDATE ai_configs SET name = ?, api_type = ?, model = ?, base_url = ?, api_key_encrypted = ?, is_active = ?, custom_prompt = ?, use_custom_prompt = ?, concurrency = ?, reasoning_effort = ?, mimo_plan = ? WHERE id = ?`,
  insertParams: (c, ek) => [
    c.id, c.name ?? '', c.apiType ?? 'openai', c.baseUrl ?? '',
    ek, c.model ?? '', c.isActive ? 1 : 0,
    c.customPrompt ?? null, c.useCustomPrompt ? 1 : 0, c.concurrency ?? 1, c.reasoningEffort ?? null, c.mimoPlan ?? null,
  ],
  updateParams: (b, id, ek) => [
    b.name ?? '', b.apiType ?? 'openai', b.model ?? '', b.baseUrl ?? null,
    ek, b.isActive ? 1 : 0, b.customPrompt ?? null, b.useCustomPrompt ? 1 : 0,
    b.concurrency ?? 1, b.reasoningEffort ?? null, b.mimoPlan ?? null, id,
  ],
  shapeResponse: (c, id, maskedKey) => ({
    id, name: c.name, apiType: c.apiType, model: c.model, baseUrl: c.baseUrl,
    apiKey: maskedKey, isActive: !!c.isActive,
    reasoningEffort: c.reasoningEffort ?? null, mimoPlan: c.mimoPlan ?? null,
  }),
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
    const db = getDb();
    const shouldDecrypt = req.query.decrypt === 'true';
    const rows = db.prepare('SELECT * FROM webdav_configs ORDER BY id ASC').all() as Record<string, unknown>[];
    const configs = rows.map((row) => {
      const { decryptedValue, status } = getMaskedSecretResult({
        encryptedValue: row.password_encrypted,
        encryptionKey: config.encryptionKey,
        kind: 'WebDAV password',
        configId: row.id,
        configName: row.name,
      });
      return {
        id: row.id,
        name: row.name,
        url: row.url,
        username: row.username,
        password: shouldDecrypt ? decryptedValue : maskPassword(decryptedValue),
        passwordStatus: status,
        path: row.path,
        isActive: !!row.is_active,
      };
    });
    res.json(configs);
  } catch (err) {
    logger.errorFromError('configs.getWebDAV', 'GET /api/configs/webdav error', err);
    res.status(500).json({ error: 'Failed to fetch WebDAV configs', code: 'FETCH_WEBDAV_CONFIGS_FAILED' });
  }
});

// POST /api/configs/webdav
router.post('/api/configs/webdav', (req, res) => {
  try {
    const db = getDb();
    const { name, url, username, password, path, isActive } = req.body as Record<string, unknown>;

    const encryptedPwd = password && typeof password === 'string' ? encrypt(password, config.encryptionKey) : null;

    const result = db.prepare(
      'INSERT INTO webdav_configs (name, url, username, password_encrypted, path, is_active) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(
      name ?? '', url ?? '', username ?? '', encryptedPwd,
      path ?? '/', isActive ? 1 : 0
    );

    res.status(201).json({ id: result.lastInsertRowid, name, url, username, password: maskPassword(password as string), path, isActive: !!isActive });
  } catch (err) {
    logger.errorFromError('configs.createWebDAV', 'POST /api/configs/webdav error', err);
    res.status(500).json({ error: 'Failed to create WebDAV config', code: 'CREATE_WEBDAV_CONFIG_FAILED' });
  }
});

// PUT /api/configs/webdav/bulk — replace all WebDAV configs (for sync)
// MUST be registered before :id route to avoid matching 'bulk' as an id
router.put('/api/configs/webdav/bulk', (req, res) => {
  // Shared between transaction, response, and error handler
  const syncResult = { inserted: 0, skipped: [] as Array<{ id: string; name: string; reason: string }> };

  try {
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
      const existingRows = db.prepare('SELECT id, password_encrypted FROM webdav_configs').all() as Array<{ id: string; password_encrypted: string }>;
      for (const row of existingRows) {
        if (row.password_encrypted) existingPwds.set(String(row.id), row.password_encrypted);
      }

      db.prepare('DELETE FROM webdav_configs').run();

      const stmt = db.prepare(`
        INSERT INTO webdav_configs (id, name, url, username, password_encrypted, path, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      for (const c of configs) {
        let encryptedPwd = '';
        if (c.password && !c.password.startsWith('***')) {
          try {
            encryptedPwd = encrypt(String(c.password), config.encryptionKey);
          } catch (encErr) {
            logger.errorFromError('configs.encryptWebDAVPwd', 'Failed to encrypt WebDAV password for config', encErr, { configId: c.id, configName: c.name });
            encryptedPwd = existingPwds.get(String(c.id)) ?? '';
            if (!encryptedPwd) {
              syncResult.skipped.push({ id: c.id, name: c.name ?? '', reason: 'encrypt_failed' });
              continue;
            }
          }
        } else {
          encryptedPwd = existingPwds.get(String(c.id)) ?? '';
        }

        if (!encryptedPwd) {
          syncResult.skipped.push({
            id: c.id,
            name: c.name ?? '',
            reason: c.password?.startsWith('***')
              ? 'Password is masked and no existing password found'
              : 'Password is empty',
          });
          continue;
        }

        stmt.run(
          c.id, c.name ?? '', c.url ?? '', c.username ?? '',
          encryptedPwd, c.path ?? '/', c.isActive ? 1 : 0
        );
        syncResult.inserted++;
      }

      if (syncResult.skipped.length > 0) {
        logger.warn('configs.bulkWebDAV', 'Skipped WebDAV configs with missing passwords', { skippedCount: syncResult.skipped.length });
      }

      // Safety guard: prevent committing an empty database when all configs were skipped
      if (syncResult.inserted === 0 && configs.length > 0) {
        throw new Error('ALL_CONFIGS_SKIPPED');
      }
    });

    bulkSync();
    res.json({ synced: syncResult.inserted, skipped: syncResult.skipped.length, errors: syncResult.skipped });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.errorFromError('configs.bulkWebDAV', 'PUT /api/configs/webdav/bulk error', err);
    if (errMsg === 'ALL_CONFIGS_SKIPPED') {
      res.status(422).json({
        error: 'All WebDAV configs were skipped — check the errors field for per-config reasons',
        code: 'SYNC_WEBDAV_CONFIGS_ALL_SKIPPED',
        synced: 0,
        skipped: syncResult.skipped.length,
        errors: syncResult.skipped,
      });
    } else {
      res.status(500).json({ error: 'Failed to sync WebDAV configs', code: 'SYNC_WEBDAV_CONFIGS_FAILED' });
    }
  }
});

// PUT /api/configs/webdav/:id
router.put('/api/configs/webdav/:id', (req, res) => {
  try {
    const db = getDb();
    const id = req.params.id;
    const { name, url, username, password, path, isActive } = req.body as Record<string, unknown>;

    let encryptedPwd: string | null = null;
    if (password && typeof password === 'string' && !password.startsWith('***')) {
      encryptedPwd = encrypt(password, config.encryptionKey);
    } else {
      const existing = db.prepare('SELECT password_encrypted FROM webdav_configs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
      encryptedPwd = (existing?.password_encrypted as string) ?? null;
    }

    const result = db.prepare(
      'UPDATE webdav_configs SET name = ?, url = ?, username = ?, password_encrypted = ?, path = ?, is_active = ? WHERE id = ?'
    ).run(name ?? '', url ?? '', username ?? '', encryptedPwd, path ?? '/', isActive ? 1 : 0, id);

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
    logger.errorFromError('configs.updateWebDAV', 'PUT /api/configs/webdav error', err);
    res.status(500).json({ error: 'Failed to update WebDAV config', code: 'UPDATE_WEBDAV_CONFIG_FAILED' });
  }
});

// DELETE /api/configs/webdav/:id
router.delete('/api/configs/webdav/:id', (req, res) => {
  try {
    const db = getDb();
    const id = req.params.id;
    const result = db.prepare('DELETE FROM webdav_configs WHERE id = ?').run(id);
    if (result.changes === 0) {
      res.status(404).json({ error: 'WebDAV config not found', code: 'WEBDAV_CONFIG_NOT_FOUND' });
      return;
    }
    res.json({ deleted: true });
  } catch (err) {
    logger.errorFromError('configs.deleteWebDAV', 'DELETE /api/configs/webdav error', err);
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
        const { decryptedValue, status } = getMaskedSecretResult({
          encryptedValue: value,
          encryptionKey: config.encryptionKey,
          kind: 'GitHub token',
        });
        value = status === 'empty' ? '' : maskApiKey(decryptedValue);
        settings.github_token_status = status;
      }

      settings[key] = value;
    }

    res.json(settings);
  } catch (err) {
    logger.errorFromError('configs.getSettings', 'GET /api/settings error', err);
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

        // better-sqlite3 interprets objects/arrays as named parameter maps,
        // causing RangeError. Serialize non-primitive values to JSON strings.
        const serialized =
          value === null || value === undefined
            ? null
            : typeof value === 'object'
              ? JSON.stringify(value)
              : value;
        stmt.run(key, serialized);
      }
    });

    upsert();
    res.json({ updated: true });
  } catch (err) {
    logger.errorFromError('configs.updateSettings', 'PUT /api/settings error', err);
    res.status(500).json({ error: 'Failed to update settings', code: 'UPDATE_SETTINGS_FAILED' });
  }
});

// ── Embedding Configs ──

// GET /api/configs/embedding
router.get('/api/configs/embedding', (req, res) => {
  try {
    const db = getDb();
    const shouldDecrypt = req.query.decrypt === 'true';
    const rows = db.prepare('SELECT * FROM embedding_configs ORDER BY id ASC').all() as Record<string, unknown>[];
    const configs = rows.map((row) => {
      const { decryptedValue, status } = getMaskedSecretResult({
        encryptedValue: row.api_key_encrypted,
        encryptionKey: config.encryptionKey,
        kind: 'AI API key',
        configId: row.id,
        configName: row.name,
      });
      return {
        id: row.id,
        name: row.name,
        apiType: row.api_type,
        baseUrl: row.base_url,
        apiKey: shouldDecrypt ? decryptedValue : maskApiKey(decryptedValue),
        apiKeyStatus: status,
        model: row.model,
        dimensions: row.dimensions,
        isActive: !!row.is_active,
      };
    });
    res.json(configs);
  } catch (err) {
    logger.errorFromError('configs.getEmbedding', 'GET /api/configs/embedding error', err);
    res.status(500).json({ error: 'Failed to fetch embedding configs', code: 'FETCH_EMBEDDING_CONFIGS_FAILED' });
  }
});

// POST /api/configs/embedding
router.post('/api/configs/embedding', (req, res) => {
  try {
    const db = getDb();
    const { name, apiType, baseUrl, apiKey, model, dimensions, isActive } = req.body as Record<string, unknown>;

    const encryptedKey = apiKey && typeof apiKey === 'string' ? encrypt(apiKey, config.encryptionKey) : '';

    const result = db.prepare(
      'INSERT INTO embedding_configs (name, api_type, base_url, api_key_encrypted, model, dimensions, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(name ?? '', apiType ?? 'openai', baseUrl ?? '', encryptedKey, model ?? '', dimensions ?? 1536, isActive ? 1 : 0);

    res.status(201).json({
      id: result.lastInsertRowid,
      name,
      apiType,
      baseUrl,
      apiKey: maskApiKey(apiKey as string),
      model,
      dimensions: dimensions ?? 1536,
      isActive: !!isActive,
    });
  } catch (err) {
    logger.errorFromError('configs.createEmbedding', 'POST /api/configs/embedding error', err);
    res.status(500).json({ error: 'Failed to create embedding config', code: 'CREATE_EMBEDDING_CONFIG_FAILED' });
  }
});

// Embedding config bulk/update/delete — delegated to shared factory
registerEncryptedConfigRoutes({
  router,
  basePath: '/api/configs/embedding',
  table: 'embedding_configs',
  secretColumn: 'api_key_encrypted',
  label: 'Embedding config',
  logPrefix: 'configs.embedding',
  insertSql: `INSERT INTO embedding_configs (id, name, api_type, base_url, api_key_encrypted, model, dimensions, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  updateSql: `UPDATE embedding_configs SET name = ?, api_type = ?, base_url = ?, api_key_encrypted = ?, model = ?, dimensions = ?, is_active = ?, updated_at = datetime('now') WHERE id = ?`,
  insertParams: (c, ek) => [
    c.id, c.name ?? '', c.apiType ?? 'openai', c.baseUrl ?? '',
    ek, c.model ?? '', c.dimensions ?? 1536, c.isActive ? 1 : 0,
  ],
  updateParams: (b, id, ek) => [
    b.name ?? '', b.apiType ?? 'openai', b.baseUrl ?? '',
    ek, b.model ?? '', b.dimensions ?? 1536, b.isActive ? 1 : 0, id,
  ],
  shapeResponse: (c, id, maskedKey) => ({
    id, name: c.name, apiType: c.apiType, baseUrl: c.baseUrl,
    apiKey: maskedKey, model: c.model, dimensions: c.dimensions ?? 1536, isActive: !!c.isActive,
  }),
});

// ── Vector Search Config ──

// GET /api/configs/vector-search
router.get('/api/configs/vector-search', (req, res) => {
  try {
    const db = getDb();
    const shouldDecrypt = req.query.decrypt === 'true';
    const row = db.prepare('SELECT * FROM vector_search_configs WHERE id = ?').get('default') as Record<string, unknown> | undefined;

    if (!row) {
      res.json({ enabled: false, workerUrl: '', authToken: '', embeddingConfigId: '' });
      return;
    }

    let authToken = '';
    let authTokenStatus: SecretStatus = 'empty';
    if (row.auth_token_encrypted) {
      const result = getMaskedSecretResult({
        encryptedValue: row.auth_token_encrypted,
        encryptionKey: config.encryptionKey,
        kind: 'AI API key',
      });
      authToken = shouldDecrypt ? result.decryptedValue : maskApiKey(result.decryptedValue);
      authTokenStatus = result.status;
    }

    let status = undefined;
    if (row.status_json && typeof row.status_json === 'string') {
      try { status = JSON.parse(row.status_json); } catch { /* ignore */ }
    }

    res.json({
      enabled: !!row.enabled,
      workerUrl: row.worker_url ?? '',
      authToken,
      authTokenStatus,
      embeddingConfigId: row.embedding_config_id ?? '',
      status,
      lastSyncAt: row.last_sync_at ?? null,
    });
  } catch (err) {
    logger.errorFromError('configs.getVectorSearch', 'GET /api/configs/vector-search error', err);
    res.status(500).json({ error: 'Failed to fetch vector search config', code: 'FETCH_VECTOR_SEARCH_CONFIG_FAILED' });
  }
});

// PUT /api/configs/vector-search
router.put('/api/configs/vector-search', (req, res) => {
  try {
    const db = getDb();
    const { enabled, workerUrl, authToken, embeddingConfigId, status, lastSyncAt } = req.body as Record<string, unknown>;

    let encryptedToken = '';
    if (authToken && typeof authToken === 'string' && !authToken.startsWith('***')) {
      encryptedToken = encrypt(authToken, config.encryptionKey);
    } else {
      const existing = db.prepare('SELECT auth_token_encrypted FROM vector_search_configs WHERE id = ?').get('default') as Record<string, unknown> | undefined;
      encryptedToken = (existing?.auth_token_encrypted as string) ?? '';
    }

    const statusJson = status ? JSON.stringify(status) : null;

    db.prepare(`
      INSERT OR REPLACE INTO vector_search_configs (id, enabled, worker_url, auth_token_encrypted, embedding_config_id, status_json, last_sync_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run('default', enabled ? 1 : 0, workerUrl ?? '', encryptedToken, embeddingConfigId ?? '', statusJson, lastSyncAt ?? null);

    res.json({ updated: true });
  } catch (err) {
    logger.errorFromError('configs.updateVectorSearch', 'PUT /api/configs/vector-search error', err);
    res.status(500).json({ error: 'Failed to update vector search config', code: 'UPDATE_VECTOR_SEARCH_CONFIG_FAILED' });
  }
});

export default router;
