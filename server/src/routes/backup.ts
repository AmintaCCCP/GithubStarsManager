import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { getBackupStatus, performAutoBackup } from '../services/backupService.js';

const router = Router();

// GET /api/backup/settings
router.get('/api/backup/settings', (_req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT key, value FROM settings WHERE key LIKE ?').all(
      'auto_backup_%'
    ) as { key: string; value: string | null }[];

    const settings: Record<string, unknown> = {
      auto_backup_enabled: false,
      auto_backup_interval_hours: 24,
      auto_backup_retention_count: 30,
    };

    for (const row of rows) {
      if (row.key === 'auto_backup_enabled') {
        settings[row.key] = row.value === 'true';
      } else if (row.key === 'auto_backup_interval_hours' || row.key === 'auto_backup_retention_count') {
        settings[row.key] = row.value ? parseInt(row.value, 10) : settings[row.key];
      }
    }

    res.json(settings);
  } catch (err) {
    console.error('GET /api/backup/settings error:', err);
    res.status(500).json({ error: 'Failed to fetch backup settings', code: 'FETCH_BACKUP_SETTINGS_FAILED' });
  }
});

// PUT /api/backup/settings
router.put('/api/backup/settings', (req, res) => {
  try {
    const db = getDb();
    const { auto_backup_enabled, auto_backup_interval_hours, auto_backup_retention_count } = req.body as {
      auto_backup_enabled?: boolean;
      auto_backup_interval_hours?: number;
      auto_backup_retention_count?: number;
    };

    const errors: string[] = [];

    if (auto_backup_interval_hours !== undefined) {
      if (typeof auto_backup_interval_hours !== 'number' || auto_backup_interval_hours < 1 || auto_backup_interval_hours > 720) {
        errors.push('备份间隔必须在 1-720 小时之间');
      }
    }

    if (auto_backup_retention_count !== undefined) {
      if (typeof auto_backup_retention_count !== 'number' || auto_backup_retention_count < 0 || auto_backup_retention_count > 365) {
        errors.push('保留份数必须在 0-365 之间（0 表示不限制）');
      }
    }

    if (auto_backup_enabled === true) {
      const activeConfig = db.prepare('SELECT id FROM webdav_configs WHERE is_active = 1').get();
      if (!activeConfig) {
        errors.push('启用自动备份前，请先在 WebDAV 设置中激活一个配置');
      }
    }

    if (errors.length > 0) {
      res.status(400).json({ error: errors.join('；'), code: 'VALIDATION_FAILED' });
      return;
    }

    const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');

    const upsert = db.transaction(() => {
      if (auto_backup_enabled !== undefined) {
        stmt.run('auto_backup_enabled', auto_backup_enabled ? 'true' : 'false');
      }
      if (auto_backup_interval_hours !== undefined) {
        stmt.run('auto_backup_interval_hours', String(auto_backup_interval_hours));
      }
      if (auto_backup_retention_count !== undefined) {
        stmt.run('auto_backup_retention_count', String(auto_backup_retention_count));
      }
    });

    upsert();
    res.json({ updated: true });
  } catch (err) {
    console.error('PUT /api/backup/settings error:', err);
    res.status(500).json({ error: 'Failed to update backup settings', code: 'UPDATE_BACKUP_SETTINGS_FAILED' });
  }
});

// GET /api/backup/status
router.get('/api/backup/status', (_req, res) => {
  try {
    const status = getBackupStatus();
    res.json(status);
  } catch (err) {
    console.error('GET /api/backup/status error:', err);
    res.status(500).json({ error: 'Failed to fetch backup status', code: 'FETCH_BACKUP_STATUS_FAILED' });
  }
});

// POST /api/backup/trigger
router.post('/api/backup/trigger', async (_req, res) => {
  try {
    const result = await performAutoBackup();
    res.json(result);
  } catch (err) {
    console.error('POST /api/backup/trigger error:', err);
    res.status(500).json({ success: false, message: '触发备份失败', error: 'TRIGGER_BACKUP_FAILED' });
  }
});

export default router;
