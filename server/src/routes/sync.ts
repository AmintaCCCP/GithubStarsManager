import { Router } from 'express';
import { db } from '../db/client.js';
import { encrypt, decrypt } from '../services/crypto.js';
import { config } from '../config.js';

const router = Router();

/** 与前端 NOASSERTION_KEYS 对齐：空白 / NOASSERTION / Other / none 等落 null。 */
const NO_LICENSE_KEYS = new Set(['', 'noassertion', 'other', 'none', 'no-license']);

/**
 * 把导入的 license 字符串规范为 SPDX id 或 null。
 * trim 后若为空或落入「无 license」集合则返回 null，否则返回 trim 后的原值。
 */
function canonicalizeLicenseString(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || NO_LICENSE_KEYS.has(trimmed.toLowerCase())) return null;
  return trimmed;
}

function maskApiKey(key: string | null | undefined): string {
  if (!key || typeof key !== 'string') return '';
  if (key.length <= 4) return '****';
  return '***' + key.slice(-4);
}

// POST /api/sync/export
router.post('/api/sync/export', async (_req, res) => {
  try {
    const repositories = await db.all<Record<string, unknown>>('SELECT * FROM repositories');
    const releases = await db.all<Record<string, unknown>>('SELECT * FROM releases');
    const categories = await db.all<Record<string, unknown>>('SELECT * FROM categories');
    const assetFilters = await db.all<Record<string, unknown>>('SELECT * FROM asset_filters');

    // AI configs — mask api_key
    const aiConfigRows = await db.all<Record<string, unknown>>('SELECT * FROM ai_configs');
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
    const webdavRows = await db.all<Record<string, unknown>>('SELECT * FROM webdav_configs');
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
    const settingsRows = await db.all<Record<string, unknown>>('SELECT * FROM settings');
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
router.post('/api/sync/import', async (req, res) => {
  try {
    const data = req.body as Record<string, unknown>;
    const counts: Record<string, number> = {};

    // 验证必要的数据结构
    if (!data || typeof data !== 'object') {
      res.status(400).json({ error: 'Invalid data format', code: 'INVALID_DATA_FORMAT' });
      return;
    }

    // 导入前校验 releases：id / repo_id / repo_full_name / repo_name 均非空，
    // 避免 NOT NULL 列绑 null 导致整笔事务 500。
    const importRels = data.releases as Record<string, unknown>[] | undefined;
    if (Array.isArray(importRels)) {
      for (const r of importRels) {
        const repository = r.repository as { id?: unknown; full_name?: unknown; name?: unknown } | undefined;
        const id = r.id;
        const repoId = r.repo_id ?? repository?.id;
        const repoFullName = r.repo_full_name ?? repository?.full_name;
        const repoName = r.repo_name ?? repository?.name;
        if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) {
          res.status(400).json({
            error: 'Each release must have a valid positive integer id',
            code: 'RELEASE_ID_REQUIRED',
          });
          return;
        }
        if (typeof repoId !== 'number' || !Number.isInteger(repoId) || repoId <= 0) {
          res.status(400).json({
            error: 'Each release must have a valid positive integer repo_id',
            code: 'RELEASE_REPO_ID_REQUIRED',
          });
          return;
        }
        if (typeof repoFullName !== 'string' || !repoFullName.trim()) {
          res.status(400).json({
            error: 'Each release must have a non-empty repo_full_name',
            code: 'RELEASE_REPO_FULL_NAME_REQUIRED',
          });
          return;
        }
        if (typeof repoName !== 'string' || !repoName.trim()) {
          res.status(400).json({
            error: 'Each release must have a non-empty repo_name',
            code: 'RELEASE_REPO_NAME_REQUIRED',
          });
          return;
        }
      }
    }

    // ── 导入事务（保持原 transaction body 控制流语义，逐条 await 执行）──

    // Repositories
    const repos = data.repositories as Record<string, unknown>[] | undefined;
    if (Array.isArray(repos) && repos.length > 0) {
      const repoInsertSql = `
          INSERT OR REPLACE INTO repositories (
            id, name, full_name, description, html_url, stargazers_count, language,
            created_at, updated_at, pushed_at, starred_at,
            owner_login, owner_avatar_url, topics,
            ai_summary, ai_tags, ai_platforms, analyzed_at, analysis_failed,
            custom_description, custom_tags, custom_category, category_locked, last_edited,
            subscribed_to_releases, vector_indexed_at, license, vector_indexed_license
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
      for (const r of repos) {
        // 验证必需的字段
        if (!r.id || typeof r.id !== 'number') {
          throw new Error(`Invalid repository data: missing or invalid id`);
        }
        // license：兼容旧备份（无该列→null）、GitHub 对象形态、已规范化的 SPDX 字符串。
        // 候选字符串 trim 后，空白 / NOASSERTION / Other / none 统一落 null（与
        // 前端 normalizeLicense 的「无 license」语义对齐），保证 DB 只存 SPDX-or-null。
        const rawLicense = (r as Record<string, unknown>).license;
        let licenseValue: string | null = null;
        if (typeof rawLicense === 'string') {
          licenseValue = canonicalizeLicenseString(rawLicense);
        } else if (rawLicense && typeof rawLicense === 'object') {
          const obj = rawLicense as { spdx_id?: unknown; key?: unknown };
          const spdx = typeof obj.spdx_id === 'string' ? obj.spdx_id.trim() : '';
          const key = typeof obj.key === 'string' ? obj.key.trim() : '';
          licenseValue = canonicalizeLicenseString(spdx || key);
        }
        // vector_indexed_license 与 license 同一套 SPDX-or-null 规则，避免指纹与当前
        // license 语义分裂（例如 "NOASSERTION" 原样入库后增量谓词永远判定为变更）。
        const rawVectorLicense = (r as Record<string, unknown>).vector_indexed_license;
        const vectorIndexedLicense = typeof rawVectorLicense === 'string'
          ? canonicalizeLicenseString(rawVectorLicense)
          : null;
        await db.run(
          repoInsertSql,
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
          r.custom_category ?? null, (r.category_locked === true || r.category_locked === 1) ? 1 : 0, r.last_edited ?? null,
          r.subscribed_to_releases ? 1 : 0,
          r.vector_indexed_at ?? null,
          licenseValue,
          // INSERT OR REPLACE 会整行替换，故备份无此列时落 null（影响：增量谓词会
          // 触发一次重索引回填指纹），合预期。
          vectorIndexedLicense
        );
      }
      counts.repositories = repos.length;
    }

    // Releases
    // 合并 UPSERT：冲突时仅更新数据列，保留库中已有的 is_read 已读状态。
    // 仅当快照显式携带 is_read 布尔值时才覆盖已读状态（stmtOverwriteIsRead）；
    // 否则走保留分支，避免导入/回退把已读状态误清空。
    const rels = data.releases as Record<string, unknown>[] | undefined;
    if (Array.isArray(rels) && rels.length > 0) {
      const relSqlPreserveIsRead = `
          INSERT INTO releases (
            id, tag_name, name, body, html_url, published_at,
            prerelease, draft, is_read, assets,
            repo_id, repo_full_name, repo_name,
            zipball_url, tarball_url
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            tag_name = excluded.tag_name,
            name = excluded.name,
            body = excluded.body,
            html_url = excluded.html_url,
            published_at = excluded.published_at,
            prerelease = excluded.prerelease,
            draft = excluded.draft,
            is_read = releases.is_read,
            assets = excluded.assets,
            repo_id = excluded.repo_id,
            repo_full_name = excluded.repo_full_name,
            repo_name = excluded.repo_name,
            zipball_url = excluded.zipball_url,
            tarball_url = excluded.tarball_url
        `;
      const relSqlOverwriteIsRead = `
          INSERT INTO releases (
            id, tag_name, name, body, html_url, published_at,
            prerelease, draft, is_read, assets,
            repo_id, repo_full_name, repo_name,
            zipball_url, tarball_url
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            tag_name = excluded.tag_name,
            name = excluded.name,
            body = excluded.body,
            html_url = excluded.html_url,
            published_at = excluded.published_at,
            prerelease = excluded.prerelease,
            draft = excluded.draft,
            is_read = excluded.is_read,
            assets = excluded.assets,
            repo_id = excluded.repo_id,
            repo_full_name = excluded.repo_full_name,
            repo_name = excluded.repo_name,
            zipball_url = excluded.zipball_url,
            tarball_url = excluded.tarball_url
        `;
      for (const r of rels) {
        const repository = r.repository as { id?: number; full_name?: string; name?: string } | undefined;
        const hasExplicitIsRead = typeof r.is_read === 'boolean';
        const relSql = hasExplicitIsRead ? relSqlOverwriteIsRead : relSqlPreserveIsRead;
        await db.run(
          relSql,
          r.id, r.tag_name ?? null, r.name ?? null, r.body ?? null,
          r.html_url ?? null, r.published_at ?? null,
          r.prerelease ? 1 : 0, r.draft ? 1 : 0,
          // 保留分支下仍落 0（非空），与 releases 表 is_read DEFAULT 0 语义一致，
          // 避免新导入行写入 NULL 导致 unread 过滤（is_read = 0）漏行。
          hasExplicitIsRead ? (r.is_read ? 1 : 0) : 0,
          typeof r.assets === 'string' ? r.assets : JSON.stringify(r.assets ?? []),
          r.repo_id ?? repository?.id ?? null,
          r.repo_full_name ?? repository?.full_name ?? null,
          r.repo_name ?? repository?.name ?? null,
          r.zipball_url ?? null,
          r.tarball_url ?? null
        );
      }
      counts.releases = rels.length;
    }

    // Categories
    const cats = data.categories as Record<string, unknown>[] | undefined;
    if (Array.isArray(cats) && cats.length > 0) {
      const catSql = `
          INSERT OR REPLACE INTO categories (id, name, description, icon, keywords, color, sort_order, is_custom)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;
      for (const c of cats) {
        await db.run(
          catSql,
          c.id, c.name ?? '', c.description ?? null, c.icon ?? '📁',
          typeof c.keywords === 'string' ? c.keywords : JSON.stringify(c.keywords ?? []),
          c.color ?? null, c.sort_order ?? 0, c.is_custom ? 1 : 0
        );
      }
      counts.categories = cats.length;
    }

    // Asset Filters
    const filters = data.asset_filters as Record<string, unknown>[] | undefined;
    if (Array.isArray(filters) && filters.length > 0) {
      const filterSql = `
          INSERT OR REPLACE INTO asset_filters (id, name, description, keywords, platform, sort_order)
          VALUES (?, ?, ?, ?, ?, ?)
        `;
      for (const f of filters) {
        await db.run(
          filterSql,
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
        const existing = await db.get<Record<string, unknown>>('SELECT api_key_encrypted FROM ai_configs WHERE id = ?', c.id);
        const existingKey = (existing?.api_key_encrypted as string) ?? null;
        // Skip masked keys, keep existing encrypted value
        await db.run(`
            INSERT OR REPLACE INTO ai_configs (id, name, api_type, base_url, api_key_encrypted, model, is_active, custom_prompt, use_custom_prompt, concurrency, reasoning_effort, mimo_plan)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          c.id, c.name ?? '', c.api_type ?? c.apiType ?? 'openai', c.base_url ?? c.baseUrl ?? null,
          existingKey, c.model ?? '',
          (c.is_active ?? c.isActive) ? 1 : 0, c.custom_prompt ?? c.customPrompt ?? null,
          (c.use_custom_prompt ?? c.useCustomPrompt) ? 1 : 0, c.concurrency ?? 1, c.reasoning_effort ?? c.reasoningEffort ?? null,
          c.mimo_plan ?? c.mimoPlan ?? null
        );
      }
      counts.ai_configs = aiConfigs.length;
    }

    // WebDAV Configs — skip masked secrets
    const webdavConfigs = data.webdav_configs as Record<string, unknown>[] | undefined;
    if (Array.isArray(webdavConfigs) && webdavConfigs.length > 0) {
      for (const c of webdavConfigs) {
        const existing = await db.get<Record<string, unknown>>('SELECT password_encrypted FROM webdav_configs WHERE id = ?', c.id);
        const existingPwd = (existing?.password_encrypted as string) ?? null;
        await db.run(`
            INSERT OR REPLACE INTO webdav_configs (id, name, url, username, password_encrypted, path, is_active)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
          c.id, c.name ?? '', c.url ?? '', c.username ?? '',
          existingPwd,
          c.path ?? '/', (c.is_active ?? c.isActive) ? 1 : 0
        );
      }
      counts.webdav_configs = webdavConfigs.length;
    }

    // Settings — skip masked github_token
    const settings = data.settings as Record<string, unknown> | undefined;
    if (settings && typeof settings === 'object') {
      let settingsCount = 0;
      for (const [key, value] of Object.entries(settings)) {
        if (key === 'github_token' && typeof value === 'string' && value.startsWith('***')) {
          continue; // Skip masked token
        }
        if (key === 'github_token' && value && typeof value === 'string') {
          await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', key, encrypt(value, config.encryptionKey));
        } else {
          await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', key, (value as string) ?? null);
        }
        settingsCount++;
      }
      counts.settings = settingsCount;
    }

    res.json({ imported: counts });
  } catch (err) {
    console.error('POST /api/sync/import error:', err);
    res.status(500).json({ error: 'Failed to import data', code: 'IMPORT_DATA_FAILED' });
  }
});

export default router;
