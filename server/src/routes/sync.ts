import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { encrypt, decrypt } from '../services/crypto.js';
import { config } from '../config.js';

const router = Router();

function maskApiKey(key: string | null | undefined): string {
  if (!key || typeof key !== 'string') return '';
  if (key.length <= 4) return '****';
  return '***' + key.slice(-4);
}

// POST /api/sync/export
router.post('/api/sync/export', (_req, res) => {
  try {
    const db = getDb();

    const repositories = db.prepare('SELECT * FROM repositories').all() as Record<string, unknown>[];
    const releases = db.prepare('SELECT * FROM releases').all() as Record<string, unknown>[];
    const categories = db.prepare('SELECT * FROM categories').all() as Record<string, unknown>[];
    const assetFilters = db.prepare('SELECT * FROM asset_filters').all() as Record<string, unknown>[];

    // AI configs — mask api_key
    const aiConfigRows = db.prepare('SELECT * FROM ai_configs').all() as Record<string, unknown>[];
    const aiConfigs = aiConfigRows.map((row) => {
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

    // WebDAV configs — mask password
    const webdavRows = db.prepare('SELECT * FROM webdav_configs').all() as Record<string, unknown>[];
    const webdavConfigs = webdavRows.map((row) => {
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

    // Settings — mask github_token
    const settingsRows = db.prepare('SELECT * FROM settings').all() as Record<string, unknown>[];
    const settings: Record<string, unknown> = {};
    for (const row of settingsRows) {
      const key = row.key as string;
      let value = row.value as string | null;
      if (key === 'github_token' && value) {
        try {
          value = maskApiKey(decrypt(value, config.encryptionKey));
        } catch {
          value = '****';
        }
      }
      settings[key] = value;
    }

    res.json({
      version: 1,
      exported_at: new Date().toISOString(),
      repositories,
      releases,
      categories,
      asset_filters: assetFilters,
      ai_configs: aiConfigs,
      webdav_configs: webdavConfigs,
      settings,
    });
  } catch (err) {
    console.error('POST /api/sync/export error:', err);
    res.status(500).json({ error: 'Failed to export data', code: 'EXPORT_DATA_FAILED' });
  }
});

// POST /api/sync/import
router.post('/api/sync/import', (req, res) => {
  try {
    const db = getDb();
    const data = req.body as Record<string, unknown>;
    const counts: Record<string, number> = {};

    const importAll = db.transaction(() => {
      // Repositories
      const repos = data.repositories as Record<string, unknown>[] | undefined;
      if (Array.isArray(repos) && repos.length > 0) {
        const repoStmt = db.prepare(`
          INSERT OR REPLACE INTO repositories (
            id, name, full_name, description, html_url, stargazers_count, language,
            created_at, updated_at, pushed_at, starred_at,
            owner_login, owner_avatar_url, topics,
            ai_summary, ai_tags, ai_platforms, analyzed_at, analysis_failed,
            custom_description, custom_tags, custom_category, last_edited,
            subscribed_to_releases
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const r of repos) {
          repoStmt.run(
            r.id, r.name, r.full_name, r.description ?? null,
            r.html_url, r.stargazers_count ?? 0, r.language ?? null,
            r.created_at ?? null, r.updated_at ?? null, r.pushed_at ?? null,
            r.starred_at ?? null,
            r.owner_login ?? '', r.owner_avatar_url ?? null,
            typeof r.topics === 'string' ? r.topics : JSON.stringify(r.topics ?? []),
            r.ai_summary ?? null,
            typeof r.ai_tags === 'string' ? r.ai_tags : JSON.stringify(r.ai_tags ?? []),
            typeof r.ai_platforms === 'string' ? r.ai_platforms : JSON.stringify(r.ai_platforms ?? []),
            r.analyzed_at ?? null, r.analysis_failed ? 1 : 0,
            r.custom_description ?? null,
            typeof r.custom_tags === 'string' ? r.custom_tags : JSON.stringify(r.custom_tags ?? []),
            r.custom_category ?? null, r.last_edited ?? null,
            r.subscribed_to_releases ? 1 : 0
          );
        }
        counts.repositories = repos.length;
      }

      // Releases
      const rels = data.releases as Record<string, unknown>[] | undefined;
      if (Array.isArray(rels) && rels.length > 0) {
        const relStmt = db.prepare(`
          INSERT OR REPLACE INTO releases (
            id, tag_name, name, body, html_url, published_at,
            prerelease, draft, is_read, assets,
            repo_id, repo_full_name, repo_name
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const r of rels) {
          relStmt.run(
            r.id, r.tag_name ?? null, r.name ?? null, r.body ?? null,
            r.html_url ?? null, r.published_at ?? null,
            r.prerelease ? 1 : 0, r.draft ? 1 : 0, r.is_read ? 1 : 0,
            typeof r.assets === 'string' ? r.assets : JSON.stringify(r.assets ?? []),
            r.repo_id ?? null, r.repo_full_name ?? null, r.repo_name ?? null
          );
        }
        counts.releases = rels.length;
      }

      // Categories
      const cats = data.categories as Record<string, unknown>[] | undefined;
      if (Array.isArray(cats) && cats.length > 0) {
        const catStmt = db.prepare(`
          INSERT OR REPLACE INTO categories (id, name, description, keywords, color, icon, sort_order)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        for (const c of cats) {
          catStmt.run(
            c.id, c.name ?? '', c.description ?? null,
            typeof c.keywords === 'string' ? c.keywords : JSON.stringify(c.keywords ?? []),
            c.color ?? null, c.icon ?? null, c.sort_order ?? 0
          );
        }
        counts.categories = cats.length;
      }

      // Asset Filters
      const filters = data.asset_filters as Record<string, unknown>[] | undefined;
      if (Array.isArray(filters) && filters.length > 0) {
        const filterStmt = db.prepare(`
          INSERT OR REPLACE INTO asset_filters (id, name, description, keywords, platform, sort_order)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        for (const f of filters) {
          filterStmt.run(
            f.id, f.name ?? '', f.description ?? null,
            typeof f.keywords === 'string' ? f.keywords : JSON.stringify(f.keywords ?? []),
            f.platform ?? null, f.sort_order ?? 0
          );
        }
        counts.asset_filters = filters.length;
      }

      // AI Configs — skip masked secrets
      const aiConfigs = data.ai_configs as Record<string, unknown>[] | undefined;
      if (Array.isArray(aiConfigs) && aiConfigs.length > 0) {
        for (const c of aiConfigs) {
          const existing = db.prepare('SELECT api_key_encrypted FROM ai_configs WHERE id = ?').get(c.id) as Record<string, unknown> | undefined;
          const existingKey = (existing?.api_key_encrypted as string) ?? null;
          // Skip masked keys, keep existing encrypted value
          db.prepare(`
            INSERT OR REPLACE INTO ai_configs (id, name, provider, model, base_url, api_key_encrypted, is_default, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            c.id, c.name ?? '', c.provider ?? '', c.model ?? '', c.base_url ?? null,
            existingKey,
            c.is_default ? 1 : 0, c.created_at ?? null, c.updated_at ?? null
          );
        }
        counts.ai_configs = aiConfigs.length;
      }

      // WebDAV Configs — skip masked secrets
      const webdavConfigs = data.webdav_configs as Record<string, unknown>[] | undefined;
      if (Array.isArray(webdavConfigs) && webdavConfigs.length > 0) {
        for (const c of webdavConfigs) {
          const existing = db.prepare('SELECT password_encrypted FROM webdav_configs WHERE id = ?').get(c.id) as Record<string, unknown> | undefined;
          const existingPwd = (existing?.password_encrypted as string) ?? null;
          db.prepare(`
            INSERT OR REPLACE INTO webdav_configs (id, name, url, username, password_encrypted, path, is_default, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            c.id, c.name ?? '', c.url ?? '', c.username ?? '',
            existingPwd,
            c.path ?? '/', c.is_default ? 1 : 0, c.created_at ?? null, c.updated_at ?? null
          );
        }
        counts.webdav_configs = webdavConfigs.length;
      }

      // Settings — skip masked github_token
      const settings = data.settings as Record<string, unknown> | undefined;
      if (settings && typeof settings === 'object') {
        const settingsStmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
        let settingsCount = 0;
        for (const [key, value] of Object.entries(settings)) {
          if (key === 'github_token' && typeof value === 'string' && value.startsWith('***')) {
            continue; // Skip masked token
          }
          if (key === 'github_token' && value && typeof value === 'string') {
            settingsStmt.run(key, encrypt(value, config.encryptionKey));
          } else {
            settingsStmt.run(key, (value as string) ?? null);
          }
          settingsCount++;
        }
        counts.settings = settingsCount;
      }
    });

    importAll();
    res.json({ imported: counts });
  } catch (err) {
    console.error('POST /api/sync/import error:', err);
    res.status(500).json({ error: 'Failed to import data', code: 'IMPORT_DATA_FAILED' });
  }
});

export default router;
