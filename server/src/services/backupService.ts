import { getDb } from '../db/connection.js';
import { config } from '../config.js';
import { encrypt, decrypt } from '../services/crypto.js';
import { proxyRequest } from '../services/proxyService.js';
import type Database from 'better-sqlite3';

let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let lastBackupTime: number | null = null;
let lastActiveConfigId: string | null = null;
let isBackingUp = false;

function maskApiKey(key: string | null | undefined): string {
  if (!key || typeof key !== 'string') return '';
  if (key.length <= 4) return '****';
  return '***' + key.slice(-4);
}

export function exportAllData(db: Database.Database, mask = true): Record<string, unknown> {
  const repositories = db.prepare('SELECT * FROM repositories').all() as Record<string, unknown>[];
  const releases = db.prepare('SELECT * FROM releases').all() as Record<string, unknown>[];
  const categories = db.prepare('SELECT * FROM categories').all() as Record<string, unknown>[];
  const assetFilters = db.prepare('SELECT * FROM asset_filters').all() as Record<string, unknown>[];

  const aiConfigRows = db.prepare('SELECT * FROM ai_configs').all() as Record<string, unknown>[];
  const aiConfigs = aiConfigRows.map((row) => {
    if (!mask) return { ...row };
    const masked = { ...row };
    if (masked.api_key_encrypted && typeof masked.api_key_encrypted === 'string') {
      try {
        masked.api_key_masked = maskApiKey(decrypt(masked.api_key_encrypted, config.encryptionKey));
      } catch {
        masked.api_key_masked = '****';
      }
    }
    delete masked.api_key_encrypted;
    return masked;
  });

  const webdavRows = db.prepare('SELECT * FROM webdav_configs').all() as Record<string, unknown>[];
  const webdavConfigs = webdavRows.map((row) => {
    if (!mask) return { ...row };
    const masked = { ...row };
    if (masked.password_encrypted && typeof masked.password_encrypted === 'string') {
      try {
        masked.password_masked = maskApiKey(decrypt(masked.password_encrypted, config.encryptionKey));
      } catch {
        masked.password_masked = '****';
      }
    }
    delete masked.password_encrypted;
    return masked;
  });

  const settingsRows = db.prepare('SELECT * FROM settings').all() as Record<string, unknown>[];
  const settings: Record<string, unknown> = {};
  for (const row of settingsRows) {
    const key = row.key as string;
    let value = row.value as string | null;
    if (mask && key === 'github_token' && value) {
      try {
        value = maskApiKey(decrypt(value, config.encryptionKey));
      } catch {
        value = '****';
      }
    }
    settings[key] = value;
  }

  return {
    version: 1,
    exported_at: new Date().toISOString(),
    repositories,
    releases,
    categories,
    asset_filters: assetFilters,
    ai_configs: aiConfigs,
    webdav_configs: webdavConfigs,
    settings,
  };
}

// ── WebDAV helpers ──

function getWebDAVAuthHeader(username: string, password: string): string {
  const credentials = Buffer.from(`${username}:${password}`).toString('base64');
  return `Basic ${credentials}`;
}

async function webdavUpload(
  baseUrl: string,
  username: string,
  password: string,
  filePath: string,
  content: string
): Promise<void> {
  const targetUrl = `${baseUrl}${filePath}`;
  const result = await proxyRequest({
    url: targetUrl,
    method: 'PUT',
    headers: {
      'Authorization': getWebDAVAuthHeader(username, password),
      'Content-Type': 'application/json',
    },
    body: content,
    timeout: 120000,
  });
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`WebDAV PUT failed: HTTP ${result.status}`);
  }
}

async function webdavListFiles(
  baseUrl: string,
  username: string,
  password: string,
  dirPath: string
): Promise<string[]> {
  const propfindBody = `<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:displayname/>
    <D:getlastmodified/>
    <D:getcontentlength/>
  </D:prop>
</D:propfind>`;

  const result = await proxyRequest({
    url: `${baseUrl}${dirPath}`,
    method: 'PROPFIND',
    headers: {
      'Authorization': getWebDAVAuthHeader(username, password),
      'Content-Type': 'application/xml',
      'Depth': '1',
    },
    body: propfindBody,
    timeout: 30000,
  });

  if (!(result.status === 207 || (result.status >= 200 && result.status < 300))) {
    throw new Error(`WebDAV PROPFIND failed: HTTP ${result.status}`);
  }

  const xmlText = typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
  return parsePropfindXml(xmlText);
}

async function webdavDeleteFile(
  baseUrl: string,
  username: string,
  password: string,
  filePath: string
): Promise<boolean> {
  const result = await proxyRequest({
    url: `${baseUrl}${filePath}`,
    method: 'DELETE',
    headers: {
      'Authorization': getWebDAVAuthHeader(username, password),
    },
    timeout: 15000,
  });
  if (result.status >= 200 && result.status < 300) return true;
  if (result.status === 404) return false;
  console.warn(`WebDAV DELETE ${filePath} returned HTTP ${result.status}`);
  return false;
}

function parsePropfindXml(xmlText: string): string[] {
  // Try DOMParser first (backend may not have it), then fall back to regex
  try {
    const regex = /<D:href>([^<]+)<\/D:href>/gi;
    const results: string[] = [];
    let match;
    while ((match = regex.exec(xmlText)) !== null) {
      let href = match[1].trim();
      href = href.replace(/\/+$/, '');
      const parts = href.split('/').filter(Boolean);
      if (parts.length === 0) continue;
      const last = decodeURIComponent(parts[parts.length - 1]);
      if (last.toLowerCase().endsWith('.json')) {
        results.push(last.trim());
      }
    }
    if (results.length > 0) return results;
  } catch {
    // ignore
  }

  // Fallback: extract displayname
  const nameRegex = /<D:displayname>([^<]+)<\/D:displayname>/gi;
  const names: string[] = [];
  let m;
  while ((m = nameRegex.exec(xmlText)) !== null) {
    const name = m[1].trim();
    if (name.toLowerCase().endsWith('.json')) names.push(name);
  }
  return names;
}

// ── Backup logic ──

const BACKUP_FILENAME_REGEX = /^github-stars-backup-\d{4}-\d{2}-\d{2}(?:T\d{2}-\d{2}-\d{2})?\.json$/;

async function cleanupOldBackups(
  baseUrl: string,
  username: string,
  password: string,
  dirPath: string,
  retentionCount: number
): Promise<{ deleted: number; retained: number }> {
  try {
    const allFiles = await webdavListFiles(baseUrl, username, password, dirPath);
    const backupFiles = allFiles.filter(f => BACKUP_FILENAME_REGEX.test(f)).sort();

    if (backupFiles.length <= retentionCount) {
      return { deleted: 0, retained: backupFiles.length };
    }

    const toDelete = backupFiles.slice(0, backupFiles.length - retentionCount);
    const basePath = dirPath.endsWith('/') ? dirPath : `${dirPath}/`;

    let deletedCount = 0;
    for (const file of toDelete) {
      try {
        const deleted = await webdavDeleteFile(baseUrl, username, password, `${basePath}${file}`);
        if (deleted) {
          deletedCount++;
          console.log(`[Backup] Deleted old backup: ${file}`);
        } else {
          console.warn(`[Backup] Skip delete (not removed): ${file}`);
        }
      } catch (err) {
        console.warn(`[Backup] Failed to delete ${file}:`, err);
      }
    }

    return { deleted: deletedCount, retained: backupFiles.length - deletedCount };
  } catch (err) {
    console.warn('[Backup] Failed to cleanup old backups:', err);
    return { deleted: 0, retained: 0 };
  }
}

async function getActiveConfig(): Promise<{
  id: string; name: string; url: string; username: string; password: string; path: string;
} | null> {
  const db = getDb();
  const row = db.prepare('SELECT * FROM webdav_configs WHERE is_active = 1').get() as Record<string, unknown> | undefined;
  if (!row) return null;

  try {
    const password = decrypt(row.password_encrypted as string, config.encryptionKey);
    return {
      id: row.id as string,
      name: row.name as string,
      url: row.url as string,
      username: row.username as string,
      password,
      path: (row.path as string) || '/',
    };
  } catch (err) {
    console.warn('[Backup] Failed to decrypt WebDAV password:', err);
    return null;
  }
}

export async function performAutoBackup(): Promise<{
  success: boolean;
  message: string;
  backupTime?: string;
  retainedCount?: number;
}> {
  if (isBackingUp) {
    return { success: false, message: '另一个备份任务正在执行中' };
  }
  isBackingUp = true;
  try {
    const activeConfig = await getActiveConfig();
    if (!activeConfig) {
      return { success: false, message: '没有活跃的 WebDAV 配置' };
    }

    // Reset last backup time if active config changed
    if (lastActiveConfigId !== activeConfig.id) {
      lastBackupTime = null;
      lastActiveConfigId = activeConfig.id;
    }

    const db = getDb();
    const data = exportAllData(db, false);
    const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
    const filename = `github-stars-backup-${timestamp}.json`;

    const basePath = activeConfig.path.endsWith('/') ? activeConfig.path : `${activeConfig.path}/`;

    await webdavUpload(activeConfig.url, activeConfig.username, activeConfig.password, `${basePath}${filename}`, JSON.stringify(data));

    lastBackupTime = Date.now();

    // Read retention count from settings
    const retentionRow = db.prepare("SELECT value FROM settings WHERE key = 'auto_backup_retention_count'").get() as { value: string } | undefined;
    const retentionCount = retentionRow ? parseInt(retentionRow.value, 10) || 30 : 30;

    let cleanupResult = { deleted: 0, retained: 0 };
    if (retentionCount > 0) {
      cleanupResult = await cleanupOldBackups(
        activeConfig.url, activeConfig.username, activeConfig.password,
        activeConfig.path, retentionCount
      );
    }

    console.log(`[Backup] Auto backup completed: ${filename}, retained ${cleanupResult.retained} files`);

    return {
      success: true,
      message: `备份成功: ${filename}`,
      backupTime: new Date().toISOString(),
      retainedCount: cleanupResult.retained,
    };
  } catch (err) {
    console.error('[Backup] Auto backup failed:', err);
    return { success: false, message: `备份失败: ${err instanceof Error ? err.message : '未知错误'}` };
  } finally {
    isBackingUp = false;
  }
}

// ── Scheduler ──

export function startBackupScheduler(): void {
  if (schedulerTimer) return;

  // Immediate check on startup
  checkAndBackup().catch((err) => console.warn('[Backup] Initial backup check failed:', err));

  schedulerTimer = setInterval(() => {
    checkAndBackup().catch((err) => console.warn('[Backup] Scheduled backup check failed:', err));
  }, 60000);
}

export function stopBackupScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}

async function checkAndBackup(): Promise<void> {
  const db = getDb();
  const enabledRow = db.prepare("SELECT value FROM settings WHERE key = 'auto_backup_enabled'").get() as { value: string } | undefined;
  const enabled = enabledRow?.value === 'true';
  if (!enabled) return;

  const activeConfig = await getActiveConfig();
  if (!activeConfig) return;

  const intervalRow = db.prepare("SELECT value FROM settings WHERE key = 'auto_backup_interval_hours'").get() as { value: string } | undefined;
  const intervalHours = intervalRow ? parseInt(intervalRow.value, 10) || 24 : 24;
  const intervalMs = intervalHours * 3600 * 1000;

  if (lastBackupTime && (Date.now() - lastBackupTime) < intervalMs) return;

  await performAutoBackup();
}

export function getBackupStatus(): {
  lastBackupTime: string | null;
  nextScheduledTime: string | null;
  isEnabled: boolean;
  activeConfigId: string | null;
  activeConfigName: string | null;
  intervalHours: number;
  retentionCount: number;
  isBackingUp: boolean;
} {
  const db = getDb();

  const enabledRow = db.prepare("SELECT value FROM settings WHERE key = 'auto_backup_enabled'").get() as { value: string } | undefined;
  const isEnabled = enabledRow?.value === 'true';

  const intervalRow = db.prepare("SELECT value FROM settings WHERE key = 'auto_backup_interval_hours'").get() as { value: string } | undefined;
  const intervalHours = intervalRow ? parseInt(intervalRow.value, 10) || 24 : 24;

  const retentionRow = db.prepare("SELECT value FROM settings WHERE key = 'auto_backup_retention_count'").get() as { value: string } | undefined;
  const retentionCount = retentionRow ? parseInt(retentionRow.value, 10) || 30 : 30;

  const activeConfig = db.prepare('SELECT id, name FROM webdav_configs WHERE is_active = 1').get() as { id: string; name: string } | undefined;

  const nextScheduledTime = (isEnabled && lastBackupTime)
    ? new Date(lastBackupTime + intervalHours * 3600 * 1000).toISOString()
    : null;

  return {
    lastBackupTime: lastBackupTime ? new Date(lastBackupTime).toISOString() : null,
    nextScheduledTime,
    isEnabled,
    activeConfigId: activeConfig?.id ?? null,
    activeConfigName: activeConfig?.name ?? null,
    intervalHours,
    retentionCount,
    isBackingUp,
  };
}
