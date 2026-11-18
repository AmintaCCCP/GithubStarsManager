import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { encrypt, decrypt } from '../services/crypto.js';
import { config } from '../config.js';
import { resolveAccountScope, ACCOUNT_SCOPED_SETTING_KEYS, INTERNAL_SETTING_KEYS } from '../db/accountScope.js';
import { toDisplayPref, DESCRIPTION_DISPLAY_VALUES, TAGS_DISPLAY_VALUES } from './repositories.js';

const router = Router();

/**
 * 服务端导出（SELECT *）把 is_read 序列化为数字 0/1，客户端备份则是布尔值。
 * 两者都视为「显式已读状态」：按对应值恢复；缺省或无效值走保留分支，
 * 维持目标记录的现有已读状态。
 */
function hasExplicitIsRead(row: Record<string, unknown>): boolean {
  return typeof row.is_read === 'boolean' || row.is_read === 0 || row.is_read === 1;
}

const toIsReadBit = (value: unknown): number => (value === true || value === 1) ? 1 : 0;

// 控制字符或 Latin-1 以外的码位会被 undici 拒绝，直接拒绝存储
const sanitizeUserAgent = (value: unknown): string | null =>
  typeof value === 'string' && !/[^\u0020-\u007e\u00a0-\u00ff]/.test(value) ? value : null;

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

/** 多账号导出/导入：收集库中出现过的所有账号分区 id。 */
function collectAccountIds(db: ReturnType<typeof getDb>): string[] {
  const ids = new Set<string>();
  for (const sql of [
    'SELECT DISTINCT account_id FROM repositories',
    'SELECT DISTINCT account_id FROM releases',
    'SELECT DISTINCT account_id FROM categories',
    'SELECT DISTINCT account_id FROM account_settings',
  ]) {
    try {
      const rows = db.prepare(sql).all() as Array<{ account_id: string }>;
      for (const row of rows) {
        if (row.account_id) ids.add(String(row.account_id));
      }
    } catch {
      // 表不存在（未跑 v4 迁移）时跳过该来源
    }
  }
  try {
    const rows = db.prepare('SELECT account_id FROM accounts').all() as Array<{ account_id: string }>;
    for (const row of rows) ids.add(String(row.account_id));
  } catch { /* ignore */ }
  return Array.from(ids);
}

/** 汇总单个账号分区的全部数据；github_token 一律脱敏为 '***' + 后 4 位。 */
function exportAccountWorkspace(db: ReturnType<typeof getDb>, accountId: string): Record<string, unknown> {
  const repositories = db.prepare('SELECT * FROM repositories WHERE account_id = ?').all(accountId) as Record<string, unknown>[];
  const releases = db.prepare('SELECT * FROM releases WHERE account_id = ?').all(accountId) as Record<string, unknown>[];
  const categories = db.prepare('SELECT * FROM categories WHERE account_id = ?').all(accountId) as Record<string, unknown>[];
  const accountSettings: Record<string, unknown> = {};
  try {
    const rows = db.prepare('SELECT key, value FROM account_settings WHERE account_id = ?').all(accountId) as Array<{ key: string; value: string | null }>;
    for (const row of rows) {
      let value = row.value;
      if (row.key === 'github_token' && value) {
        try {
          value = maskApiKey(decrypt(value, config.encryptionKey));
        } catch {
          value = '****';
        }
      }
      accountSettings[row.key] = value;
    }
  } catch { /* ignore */ }
  return {
    account_id: accountId,
    repositories,
    releases,
    categories,
    account_settings: accountSettings,
  };
}

// POST /api/sync/export
router.post('/api/sync/export', (req, res) => {
  try {
    const db = getDb();
    const accountId = resolveAccountScope(req, db);

    const repositories = db.prepare('SELECT * FROM repositories WHERE account_id = ?').all(accountId) as Record<string, unknown>[];
    const releases = db.prepare('SELECT * FROM releases WHERE account_id = ?').all(accountId) as Record<string, unknown>[];
    const categories = db.prepare('SELECT * FROM categories WHERE account_id = ?').all(accountId) as Record<string, unknown>[];
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

    // Settings — mask github_token。
    // 内部账号状态键（INTERNAL_SETTING_KEYS）绝不导出：legacy_default_owner_id 的
    // JSON 绑定全局 GitHub Token 密文（github_token 本身在下方已脱敏），且认领标记 /
    // 已验证所有者 / 活跃账号只属于本服务器自身，随备份迁移会覆盖导入方的状态。
    const settingsRows = db.prepare('SELECT * FROM settings').all() as Record<string, unknown>[];
    const settings: Record<string, unknown> = {};
    for (const row of settingsRows) {
      const key = row.key as string;
      if (INTERNAL_SETTING_KEYS.has(key)) continue;
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

    // 多账号扩展：accounts 元数据（token 脱敏）与各账号分区全量工作区。
    let accounts: Array<Record<string, unknown>> = [];
    let account_workspaces: Array<Record<string, unknown>> = [];
    try {
      const accountRows = db.prepare('SELECT * FROM accounts').all() as Record<string, unknown>[];
      accounts = accountRows.map((row) => {
        const masked = { ...row };
        if (masked.github_token_encrypted && typeof masked.github_token_encrypted === 'string') {
          try {
            masked.github_token_masked = maskApiKey(decrypt(masked.github_token_encrypted, config.encryptionKey));
          } catch {
            masked.github_token_masked = '****';
          }
        }
        delete masked.github_token_encrypted;
        return masked;
      });
      account_workspaces = collectAccountIds(db).map((id) => exportAccountWorkspace(db, id));
    } catch { /* 旧库未迁移时降级为 v1 导出 */ }

    res.json({
      version: 1,
      exported_at: new Date().toISOString(),
      account_id: accountId,
      repositories,
      releases,
      categories,
      asset_filters: assetFilters,
      ai_configs: aiConfigs,
      webdav_configs: webdavConfigs,
      settings,
      accounts,
      account_workspaces,
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
    const accountId = resolveAccountScope(req, db);
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

    // 多账号导入前校验 account_workspaces 内的 releases（同上规则）
    const accountWorkspacesRaw = data.account_workspaces as
      | Array<Record<string, unknown>>
      | Record<string, Record<string, unknown>>
      | undefined;
    const workspaceEntries: Array<{ accountId: string; workspace: Record<string, unknown>; unverifiedOwner: boolean }> = [];
    if (Array.isArray(accountWorkspacesRaw)) {
      for (const ws of accountWorkspacesRaw) {
        const id = typeof ws.account_id === 'string' ? ws.account_id : '';
        if (!id || !/^\d+$|^(default)$/.test(id)) continue;
        // 'default' 分区在目标服务器可被首个登录账号自动认领：请求本身不在
        // default 分区时，来源归属无法核验，数据一律不写入（数字账号工作区
        // 仍原样恢复）。仍保留条目，避免顶层兼容副本被误判为「无工作区」。
        workspaceEntries.push({ accountId: id, workspace: ws, unverifiedOwner: id === 'default' && accountId !== 'default' });
      }
    } else if (accountWorkspacesRaw && typeof accountWorkspacesRaw === 'object') {
      for (const [id, ws] of Object.entries(accountWorkspacesRaw)) {
        if (!ws || typeof ws !== 'object') continue;
        if (!/^\d+$|^(default)$/.test(id)) continue;
        workspaceEntries.push({
          accountId: id,
          workspace: ws as Record<string, unknown>,
          unverifiedOwner: id === 'default' && accountId !== 'default',
        });
      }
    }
    for (const { workspace } of workspaceEntries) {
      const rels = workspace.releases as Record<string, unknown>[] | undefined;
      if (!Array.isArray(rels)) continue;
      for (const r of rels) {
        const repository = r.repository as { id?: unknown; full_name?: unknown; name?: unknown } | undefined;
        const repoId = r.repo_id ?? repository?.id;
        if (typeof r.id !== 'number' || !Number.isInteger(r.id) || r.id <= 0
          || typeof repoId !== 'number' || !Number.isInteger(repoId) || repoId <= 0
          || typeof (r.repo_full_name ?? repository?.full_name) !== 'string'
          || !(r.repo_full_name ?? repository?.full_name)
          || typeof (r.repo_name ?? repository?.name) !== 'string'
          || !(r.repo_name ?? repository?.name)) {
          res.status(400).json({
            error: 'Each release must have a valid positive integer id / repo_id / non-empty repo_full_name / repo_name',
            code: 'RELEASE_ID_REQUIRED',
          });
          return;
        }
      }
    }

    const importAll = db.transaction(() => {
      // 多账号全量导出包含 account_workspaces 时，顶层 repositories/releases/
      // categories 是导出账号分区的副本（已含在 account_workspaces 中）——
      // 跳过顶层 v1 导入，避免把这些数据错位复制进当前请求账号分区。
      const hasAccountWorkspaces = workspaceEntries.length > 0;

      // Repositories（导入到当前账号分区；account_id 占位参数末位追加）
      const repos = data.repositories as Record<string, unknown>[] | undefined;
      if (!hasAccountWorkspaces && Array.isArray(repos) && repos.length > 0) {
        const repoStmt = db.prepare(`
          INSERT OR REPLACE INTO repositories (
            id, name, full_name, description, html_url, stargazers_count, language,
            created_at, updated_at, pushed_at, starred_at,
            owner_login, owner_avatar_url, topics,
            ai_summary, ai_tags, ai_platforms, analyzed_at, analysis_failed,
            custom_description, custom_tags, custom_category, category_locked, last_edited,
            subscribed_to_releases, vector_indexed_at, license, vector_indexed_license,
            description_display, tags_display,
            account_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        let importedRepos = 0;
        for (const r of repos) {
          // 单条脏数据不得回滚整个导入事务：缺必填字段的仓库直接跳过。
          if (
            typeof r.id !== 'number'
            || !Number.isInteger(r.id)
            || r.id <= 0
            || typeof r.name !== 'string'
            || typeof r.full_name !== 'string'
            || typeof r.html_url !== 'string'
          ) {
            continue;
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
            // NULL 表示「未自定义」，只有显式数组才写 '[]'（明确清空），避免恢复后隐藏标签。
            typeof r.custom_tags === 'string' ? r.custom_tags : (r.custom_tags == null ? null : JSON.stringify(r.custom_tags)),
            r.custom_category ?? null, (r.category_locked === true || r.category_locked === 1) ? 1 : 0, r.last_edited ?? null,
            r.subscribed_to_releases ? 1 : 0,
            r.vector_indexed_at ?? null,
            licenseValue,
            // INSERT OR REPLACE 会整行替换，故备份无此列时落 null（影响：增量谓词会
            // 触发一次重索引回填指纹），合预期。
            vectorIndexedLicense
            , toDisplayPref(r.description_display, DESCRIPTION_DISPLAY_VALUES)
            , toDisplayPref(r.tags_display, TAGS_DISPLAY_VALUES)
            , accountId
          );
          importedRepos += 1;
        }
        counts.repositories = importedRepos;
      }

      // Releases
      // 合并 UPSERT：冲突时仅更新数据列，保留库中已有的 is_read 已读状态。
      // 仅当快照显式携带 is_read 布尔值时才覆盖已读状态（stmtOverwriteIsRead）；
      // 否则走保留分支，避免导入/回退把已读状态误清空。
      const rels = data.releases as Record<string, unknown>[] | undefined;
      if (!hasAccountWorkspaces && Array.isArray(rels) && rels.length > 0) {
        const relStmtPreserveIsRead = db.prepare(`
          INSERT INTO releases (
            id, tag_name, name, body, html_url, published_at,
            prerelease, draft, is_read, assets,
            repo_id, repo_full_name, repo_name,
            zipball_url, tarball_url,
            account_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(account_id, id) DO UPDATE SET
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
        `);
        const relStmtOverwriteIsRead = db.prepare(`
          INSERT INTO releases (
            id, tag_name, name, body, html_url, published_at,
            prerelease, draft, is_read, assets,
            repo_id, repo_full_name, repo_name,
            zipball_url, tarball_url,
            account_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(account_id, id) DO UPDATE SET
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
        `);
        for (const r of rels) {
          const repository = r.repository as { id?: number; full_name?: string; name?: string } | undefined;
          const explicitIsRead = hasExplicitIsRead(r);
          const relStmt = explicitIsRead ? relStmtOverwriteIsRead : relStmtPreserveIsRead;
          relStmt.run(
            r.id, r.tag_name ?? null, r.name ?? null, r.body ?? null,
            r.html_url ?? null, r.published_at ?? null,
            r.prerelease ? 1 : 0, r.draft ? 1 : 0,
            // 保留分支下仍落 0（非空），与 releases 表 is_read DEFAULT 0 语义一致，
            // 避免新导入行写入 NULL 导致 unread 过滤（is_read = 0）漏行。
            explicitIsRead ? toIsReadBit(r.is_read) : 0,
            typeof r.assets === 'string' ? r.assets : JSON.stringify(r.assets ?? []),
            r.repo_id ?? repository?.id ?? null,
            r.repo_full_name ?? repository?.full_name ?? null,
            r.repo_name ?? repository?.name ?? null,
            r.zipball_url ?? null,
            r.tarball_url ?? null,
            accountId
          );
        }
        counts.releases = rels.length;
      }

      // Categories（导入到当前账号分区）
      const cats = data.categories as Record<string, unknown>[] | undefined;
      if (!hasAccountWorkspaces && Array.isArray(cats) && cats.length > 0) {
        const catStmt = db.prepare(`
          INSERT OR REPLACE INTO categories (id, name, description, icon, keywords, color, sort_order, is_custom, account_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const c of cats) {
          catStmt.run(
            c.id, c.name ?? '', c.description ?? null, c.icon ?? '📁',
            typeof c.keywords === 'string' ? c.keywords : JSON.stringify(c.keywords ?? []),
            c.color ?? null, c.sort_order ?? 0, c.is_custom ? 1 : 0,
            accountId
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
            INSERT OR REPLACE INTO ai_configs (id, name, api_type, base_url, api_key_encrypted, model, is_active, custom_prompt, use_custom_prompt, concurrency, reasoning_effort, mimo_plan)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
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
          const existing = db.prepare('SELECT password_encrypted FROM webdav_configs WHERE id = ?').get(c.id) as Record<string, unknown> | undefined;
          const existingPwd = (existing?.password_encrypted as string) ?? null;
          db.prepare(`
            INSERT OR REPLACE INTO webdav_configs (id, name, url, username, password_encrypted, path, is_active, custom_user_agent)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            c.id, c.name ?? '', c.url ?? '', c.username ?? '',
            existingPwd,
            c.path ?? '/', (c.is_active ?? c.isActive) ? 1 : 0,
            sanitizeUserAgent(
              typeof c.custom_user_agent === 'string' ? c.custom_user_agent
              : typeof c.customUserAgent === 'string' ? c.customUserAgent
              : undefined
            )
          );
        }
        counts.webdav_configs = webdavConfigs.length;
      }

      // Settings — skip masked github_token。
      // 无 account_workspaces（v1 备份）：账号级键在真实账号分区下写入
      // account_settings，其余写全局 settings。
      // 多账号全量导入：顶层 settings 中的账号级键来自导出时的全局 settings
      // （各账号分区自身的键已由 account_workspaces 按分区复原），统一恢复回
      // 全局表——默认分区/旧客户端/无头请求与 legacy 认领流程都依赖全局表，
      // 绝不能因存在工作区就静默丢弃这些默认分区设置。
      const settings = data.settings as Record<string, unknown> | undefined;
      if (settings && typeof settings === 'object') {
        const globalSettingsStmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
        const accountSettingsStmt = db.prepare('INSERT OR REPLACE INTO account_settings (account_id, key, value) VALUES (?, ?, ?)');
        // 显式空 Token 时与 configs.ts 的显式清空语义一致：同步清空 accounts 的
        // 加密凭据副本，否则 readScopedToken / readAccountRows / proxy 的 accounts
        // 回退会让已清空的 Token 复活。
        const clearAccountTokenStmt = db.prepare('UPDATE accounts SET github_token_encrypted = NULL WHERE account_id = ?');
        let settingsCount = 0;
        const serializeSettingValue = (v: unknown): string | null =>
          v === null || v === undefined
            ? null
            : typeof v === 'object' ? JSON.stringify(v) : (v as string);
        for (const [key, value] of Object.entries(settings)) {
          // 内部账号状态键一律跳过（兼容已生成、内含这些键的旧备份）：认领标记 /
          // 已验证所有者 / 活跃账号只属于目标服务器自身，绝不随备份迁移覆盖。
          if (INTERNAL_SETTING_KEYS.has(key)) continue;
          if (key === 'github_token' && typeof value === 'string' && value.startsWith('***')) {
            continue; // Skip masked token
          }
          if (hasAccountWorkspaces && ACCOUNT_SCOPED_SETTING_KEYS.has(key)) {
            if (key === 'github_token' && value && typeof value === 'string') {
              globalSettingsStmt.run(key, encrypt(value, config.encryptionKey));
            } else {
              globalSettingsStmt.run(key, serializeSettingValue(value));
            }
            settingsCount++;
            continue;
          }
          if (key === 'github_token' && value && typeof value === 'string') {
            const encrypted = encrypt(value, config.encryptionKey);
            if (accountId !== 'default') {
              accountSettingsStmt.run(accountId, key, encrypted);
            } else {
              globalSettingsStmt.run(key, encrypted);
            }
          } else if (key === 'github_token' && (value === null || value === undefined || value === '')) {
            // 显式空 Token（null / ''；掩码 '***' 已在上方跳过）：除写入空值占位
            // 外，必须同步清空 accounts 的加密凭据副本，避免旧 Token 回退复活。
            if (accountId !== 'default') {
              accountSettingsStmt.run(accountId, key, serializeSettingValue(value));
              clearAccountTokenStmt.run(accountId);
            } else {
              globalSettingsStmt.run(key, serializeSettingValue(value));
            }
          } else if (ACCOUNT_SCOPED_SETTING_KEYS.has(key) && accountId !== 'default') {
            accountSettingsStmt.run(accountId, key, serializeSettingValue(value));
          } else {
            globalSettingsStmt.run(key, serializeSettingValue(value));
          }
          settingsCount++;
        }
        counts.settings = settingsCount;
      }

      // ── 多账号全量导入（Issue #611）──
      // 按各自 account_id 分别导入 repositories / releases / categories /
      // account_settings；跳过 '***' 掩码 Token，保留库中已有的加密 Token。
      if (workspaceEntries.length > 0) {
        const wsRepoStmt = db.prepare(`
          INSERT OR REPLACE INTO repositories (
            id, name, full_name, description, html_url, stargazers_count, language,
            created_at, updated_at, pushed_at, starred_at,
            owner_login, owner_avatar_url, topics,
            ai_summary, ai_tags, ai_platforms, analyzed_at, analysis_failed,
            custom_description, custom_tags, custom_category, category_locked, last_edited,
            subscribed_to_releases, vector_indexed_at, license, vector_indexed_license,
            description_display, tags_display,
            account_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const wsRelStmtPreserveIsRead = db.prepare(`
          INSERT INTO releases (
            id, tag_name, name, body, html_url, published_at,
            prerelease, draft, is_read, assets,
            repo_id, repo_full_name, repo_name,
            zipball_url, tarball_url,
            account_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(account_id, id) DO UPDATE SET
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
        `);
        const wsRelStmtOverwriteIsRead = db.prepare(`
          INSERT INTO releases (
            id, tag_name, name, body, html_url, published_at,
            prerelease, draft, is_read, assets,
            repo_id, repo_full_name, repo_name,
            zipball_url, tarball_url,
            account_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(account_id, id) DO UPDATE SET
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
        `);
        const wsCatStmt = db.prepare(`
          INSERT OR REPLACE INTO categories (account_id, id, name, description, icon, keywords, color, sort_order, is_custom)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const wsSettingsStmt = db.prepare('INSERT OR REPLACE INTO account_settings (account_id, key, value) VALUES (?, ?, ?)');
        // 'default' 分区的设置由 readSetting / 旧客户端 / 无头请求从全局 settings
        // 表读取：写进 account_settings('default') 等于静默丢弃。
        const wsGlobalSettingsStmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
        // 显式空 Token 时同步清空 accounts 的加密凭据副本（与 configs.ts 显式清空
        // 语义一致），否则 readScopedToken / readAccountRows / proxy 的 accounts
        // 回退会让已清空的 Token 复活。
        const wsClearAccountTokenStmt = db.prepare('UPDATE accounts SET github_token_encrypted = NULL WHERE account_id = ?');

        let workspaceRepoCount = 0;
        let workspaceReleaseCount = 0;
        let workspaceCategoryCount = 0;
        let workspaceSettingsCount = 0;

        for (const { accountId: wsAccountId, workspace, unverifiedOwner } of workspaceEntries) {
          if (unverifiedOwner) continue;
          const wsRepos = workspace.repositories as Record<string, unknown>[] | undefined;
          if (Array.isArray(wsRepos)) {
            for (const r of wsRepos) {
              // 单条脏数据不得回滚整个导入事务（手工编辑/第三方备份常见）：
              // 仓库表 name/full_name/html_url 均为 NOT NULL，缺任一必填字段
              // 直接跳过该条，合法的仓库/Release/分类继续导入。
              if (
                typeof r.id !== 'number'
                || !Number.isInteger(r.id)
                || r.id <= 0
                || typeof r.name !== 'string'
                || typeof r.full_name !== 'string'
                || typeof r.html_url !== 'string'
              ) {
                continue;
              }
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
              const rawVectorLicense = (r as Record<string, unknown>).vector_indexed_license;
              const vectorIndexedLicense = typeof rawVectorLicense === 'string'
                ? canonicalizeLicenseString(rawVectorLicense)
                : null;
              wsRepoStmt.run(
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
                typeof r.custom_tags === 'string' ? r.custom_tags : (r.custom_tags == null ? null : JSON.stringify(r.custom_tags)),
                r.custom_category ?? null, (r.category_locked === true || r.category_locked === 1) ? 1 : 0, r.last_edited ?? null,
                r.subscribed_to_releases ? 1 : 0,
                r.vector_indexed_at ?? null,
                licenseValue,
                vectorIndexedLicense,
                toDisplayPref(r.description_display, DESCRIPTION_DISPLAY_VALUES),
                toDisplayPref(r.tags_display, TAGS_DISPLAY_VALUES),
                wsAccountId
              );
              workspaceRepoCount++;
            }
          }

          const wsRels = workspace.releases as Record<string, unknown>[] | undefined;
          if (Array.isArray(wsRels)) {
            for (const r of wsRels) {
              const repository = r.repository as { id?: number; full_name?: string; name?: string } | undefined;
              const explicitIsRead = hasExplicitIsRead(r);
              const wsRelStmt = explicitIsRead ? wsRelStmtOverwriteIsRead : wsRelStmtPreserveIsRead;
              wsRelStmt.run(
                r.id, r.tag_name ?? null, r.name ?? null, r.body ?? null,
                r.html_url ?? null, r.published_at ?? null,
                r.prerelease ? 1 : 0, r.draft ? 1 : 0,
                explicitIsRead ? toIsReadBit(r.is_read) : 0,
                typeof r.assets === 'string' ? r.assets : JSON.stringify(r.assets ?? []),
                r.repo_id ?? repository?.id ?? null,
                r.repo_full_name ?? repository?.full_name ?? null,
                r.repo_name ?? repository?.name ?? null,
                r.zipball_url ?? null,
                r.tarball_url ?? null,
                wsAccountId
              );
              workspaceReleaseCount++;
            }
          }

          const wsCats = workspace.categories as Record<string, unknown>[] | undefined;
          if (Array.isArray(wsCats)) {
            for (const c of wsCats) {
              wsCatStmt.run(
                wsAccountId, c.id, c.name ?? '', c.description ?? null, c.icon ?? '📁',
                typeof c.keywords === 'string' ? c.keywords : JSON.stringify(c.keywords ?? []),
                c.color ?? null, c.sort_order ?? 0, c.is_custom ? 1 : 0
              );
              workspaceCategoryCount++;
            }
          }

          const wsSettings = workspace.account_settings as Record<string, unknown> | undefined;
          if (wsSettings && typeof wsSettings === 'object' && !Array.isArray(wsSettings)) {
            for (const [key, value] of Object.entries(wsSettings)) {
              // 内部认领状态键只属于目标服务器自身，绝不随备份迁移。
              if (wsAccountId === 'default' && INTERNAL_SETTING_KEYS.has(key)) continue;
              if (key === 'github_token' && typeof value === 'string' && value.startsWith('***')) {
                continue; // 掩码 Token：保留库中已有的 github_token_encrypted
              }
              let serialized = value === null || value === undefined
                ? null
                : typeof value === 'object' ? JSON.stringify(value) : (value as string);
              if (key === 'github_token' && typeof value === 'string' && value) {
                // 真实 Token（勾选「包含密钥」的备份）：与其他凭据一致，写入前必须
                // encrypt()，绝不能把明文凭证当作普通设置序列化入库。
                serialized = encrypt(value, config.encryptionKey);
              } else if (key === 'github_token' && (value === null || value === undefined || value === '')) {
                // 显式空 Token（null / ''）：同步清空 accounts 的加密凭据副本，
                // 避免已清空的 Token 经 accounts 回退复活。
                wsClearAccountTokenStmt.run(wsAccountId);
              }
              if (wsAccountId === 'default') wsGlobalSettingsStmt.run(key, serialized);
              else wsSettingsStmt.run(wsAccountId, key, serialized);
              workspaceSettingsCount++;
            }
          }
        }

        counts.account_workspaces_repositories = workspaceRepoCount;
        counts.account_workspaces_releases = workspaceReleaseCount;
        counts.account_workspaces_categories = workspaceCategoryCount;
        counts.account_workspaces_settings = workspaceSettingsCount;
      }

      // accounts 元数据：仅导入身份信息；加密 Token 一律保留库中已有值（导入包中
      // 只有脱敏掩码，没有可用的密文）。
      const accounts = data.accounts as Record<string, unknown>[] | undefined;
      if (Array.isArray(accounts) && accounts.length > 0) {
        const accountStmt = db.prepare(`
          INSERT INTO accounts (account_id, user_json, github_token_encrypted, added_at, last_used_at)
          VALUES (?, ?, NULL, datetime('now'), datetime('now'))
          ON CONFLICT(account_id) DO UPDATE SET
            user_json = COALESCE(excluded.user_json, accounts.user_json),
            last_used_at = excluded.last_used_at
        `);
        let accountCount = 0;
        for (const a of accounts) {
          const accountIdValue = typeof a.account_id === 'string' ? a.account_id : '';
          if (!accountIdValue || !/^\d+$|^(default)$/.test(accountIdValue)) continue;
          let userJson: string | null = null;
          if (typeof a.user_json === 'string') {
            userJson = a.user_json;
          } else if (a.user_json && typeof a.user_json === 'object') {
            userJson = JSON.stringify(a.user_json);
          } else if (a.user && typeof a.user === 'object') {
            userJson = JSON.stringify(a.user);
          }
          // accounts.user_json 是 NOT NULL：缺身份资料时跳过该条目，否则
          // INSERT 触发约束错误、整个 importAll 事务回滚（合法数据一并丢失）。
          if (userJson === null) continue;
          accountStmt.run(accountIdValue, userJson);
          accountCount++;
        }
        counts.accounts = accountCount;
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
