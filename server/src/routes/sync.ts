import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { encrypt, decrypt } from '../services/crypto.js';
import { config } from '../config.js';
import {
  resolveAccountScope,
  resolveWritableAccountScope,
  hasPendingDefaultPartitionData,
  bumpAccountRevision,
  claimLegacyDefaultWithAdminConfirmation,
  fetchGitHubUserId,
  ACCOUNT_SCOPED_SETTING_KEYS,
  INTERNAL_SETTING_KEYS,
} from '../db/accountScope.js';
import { toDisplayPref, DESCRIPTION_DISPLAY_VALUES, TAGS_DISPLAY_VALUES } from './repositories.js';

const router = Router();

/** 顶层备份声明的账号是否为合法形态（数字 id 或 'default'）。 */
function isDeclaredAccountId(value: unknown): value is string {
  return typeof value === 'string' && (/^\d+$/.test(value) || value === 'default');
}

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
      // Issue #612 A9：内部账号状态键（含内嵌密文的 legacy_default_owner_id /
      // legacy_default_github_token 等）绝不进入任何工作区的备份，覆盖历史版本
      // 可能已写入 account_settings 的记录。
      if (INTERNAL_SETTING_KEYS.has(row.key)) continue;
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
    const hasMultiAccountTables = Boolean(
      db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'accounts'").get()
      && db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'account_settings'").get(),
    );
    if (hasMultiAccountTables) {
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
    }

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
router.post('/api/sync/import', async (req, res) => {
  try {
    const db = getDb();
    // Issue #612 A1(a)：无头请求存在多个可能账号时必须显式选择目标，绝不回退
    // 可变的活跃账号分区（旧客户端的备份可能属于任一账号）。仅存在 default
    // 分区时保留旧版导入行为。
    const scope = resolveWritableAccountScope(req, db);
    if (!scope.ok) {
      res.status(409).json({
        error: 'X-GitHub-Account-Id is required when multiple accounts exist',
        code: 'ACCOUNT_SCOPE_REQUIRED',
      });
      return;
    }
    const accountId = scope.accountId;
    const data = req.body as Record<string, unknown>;
    const counts: Record<string, number> = {};

    // 验证必要的数据结构
    if (!data || typeof data !== 'object') {
      res.status(400).json({ error: 'Invalid data format', code: 'INVALID_DATA_FORMAT' });
      return;
    }

    // Issue #612 A1(b)：顶层备份声明的 account_id 必须与解析出的目标范围一致；
    // 不一致拒绝导入，除非调用方通过 allowAccountMigration 显式选择迁移（把
    // 顶层 v1 数据写入当前请求账号分区）。校验发生在任何写入之前。
    const declaredAccountId = (data as { account_id?: unknown }).account_id;
    if (isDeclaredAccountId(declaredAccountId)
      && declaredAccountId !== accountId
      && (data as { allowAccountMigration?: unknown }).allowAccountMigration !== true) {
      res.status(409).json({
        error: `Backup was exported from account ${declaredAccountId}; re-send with allowAccountMigration=true to migrate it into account ${accountId}`,
        code: 'ACCOUNT_ID_MISMATCH',
      });
      return;
    }

    // Issue #612 A2(b)：github_token 必须是字符串（掩码跳过 / 有效值加密 /
    // 显式空清除）或显式空值；非字符串的非空值（如对象）一律拒绝，绝不把
    // 令牌对象当普通设置序列化持久化。顶层与工作区设置都适用，且在事务前完成。
    const invalidTokenLocations: string[] = [];
    const topSettings = data.settings as Record<string, unknown> | undefined;
    if (topSettings && typeof topSettings === 'object' && !Array.isArray(topSettings)) {
      const tokenValue = (topSettings as Record<string, unknown>).github_token;
      if (tokenValue !== null && tokenValue !== undefined && tokenValue !== '' && typeof tokenValue !== 'string') {
        invalidTokenLocations.push('settings');
      }
    }
    const preWorkspaceEntries = Array.isArray(data.account_workspaces)
      ? data.account_workspaces as unknown[]
      : data.account_workspaces && typeof data.account_workspaces === 'object'
        ? Object.values(data.account_workspaces as Record<string, unknown>)
        : [];
    for (const ws of preWorkspaceEntries) {
      if (!ws || typeof ws !== 'object' || Array.isArray(ws)) continue;
      const wsSettings = (ws as Record<string, unknown>).account_settings as Record<string, unknown> | undefined;
      if (!wsSettings || typeof wsSettings !== 'object' || Array.isArray(wsSettings)) continue;
      const tokenValue = wsSettings.github_token;
      if (tokenValue !== null && tokenValue !== undefined && tokenValue !== '' && typeof tokenValue !== 'string') {
        const wsId = (ws as Record<string, unknown>).account_id;
        invalidTokenLocations.push(`account_workspaces${wsId !== undefined ? ` (account_id: ${String(wsId)})` : ''}`);
      }
    }
    if (invalidTokenLocations.length > 0) {
      res.status(400).json({
        error: `github_token must be a string, null or empty when present: ${invalidTokenLocations.join(', ')}`,
        code: 'INVALID_GITHUB_TOKEN_FORMAT',
      });
      return;
    }

    // 导入前校验 releases：id / repo_id / tag_name / repo_full_name / repo_name 均非空，
    // 避免 NOT NULL 列绑 null 导致整笔事务 500。
    const importRels = data.releases as Record<string, unknown>[] | undefined;
    if (Array.isArray(importRels)) {
      for (const r of importRels) {
        if (!r || typeof r !== 'object' || Array.isArray(r)) {
          res.status(400).json({
            error: 'Each release must be an object',
            code: 'RELEASE_ID_REQUIRED',
          });
          return;
        }
        const repository = r.repository as { id?: unknown; full_name?: unknown; name?: unknown } | undefined;
        const id = r.id;
        const repoId = r.repo_id ?? repository?.id;
        const tagName = r.tag_name;
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
        // Issue #612 A8：releases.tag_name 为 NOT NULL，缺失/无效时提前给出
        // 可定位的 400，避免 NULL 写入后整体回滚返回 500。
        if (typeof tagName !== 'string' || !tagName.trim()) {
          res.status(400).json({
            error: `Each release must have a non-empty tag_name (release id: ${id})`,
            code: 'RELEASE_TAG_NAME_REQUIRED',
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
      | Array<unknown>
      | Record<string, unknown>
      | undefined;
    const workspaceEntries: Array<{ accountId: string; workspace: Record<string, unknown>; unverifiedOwner: boolean }> = [];
    if (Array.isArray(accountWorkspacesRaw)) {
      for (const ws of accountWorkspacesRaw) {
        if (!ws || typeof ws !== 'object' || Array.isArray(ws)) {
          res.status(400).json({ error: 'Invalid account workspace entry', code: 'INVALID_ACCOUNT_WORKSPACE' });
          return;
        }
        const wsObj = ws as Record<string, unknown>;
        const id = typeof wsObj.account_id === 'string' ? wsObj.account_id : '';
        if (!id || !/^\d+$|^(default)$/.test(id)) continue;
        // Issue #612 A4：'default' 分区在目标服务器可被首个登录账号自动认领。
        // 两种情况来源归属都无法核验，数据一律不写入（数字账号工作区仍原样恢复）：
        // ① 请求本身不在 default 分区；
        // ② 目标服务器的 default 分区仍有待认领数据——外部 default 工作区会与
        //    待认领存量混在一起被自动认领。仍保留条目，避免顶层兼容副本被误判。
        const unverifiedDefault = id === 'default'
          && (accountId !== 'default' || hasPendingDefaultPartitionData(db));
        workspaceEntries.push({ accountId: id, workspace: wsObj, unverifiedOwner: unverifiedDefault });
      }
    } else if (accountWorkspacesRaw && typeof accountWorkspacesRaw === 'object') {
      for (const [id, ws] of Object.entries(accountWorkspacesRaw)) {
        if (!ws || typeof ws !== 'object' || Array.isArray(ws)) {
          res.status(400).json({ error: 'Invalid account workspace entry', code: 'INVALID_ACCOUNT_WORKSPACE' });
          return;
        }
        if (!/^\d+$|^(default)$/.test(id)) continue;
        const unverifiedDefault = id === 'default'
          && (accountId !== 'default' || hasPendingDefaultPartitionData(db));
        workspaceEntries.push({
          accountId: id,
          workspace: ws as Record<string, unknown>,
          unverifiedOwner: unverifiedDefault,
        });
      }
    }
    for (const { workspace, unverifiedOwner } of workspaceEntries) {
      if (unverifiedOwner) continue;
      const rels = workspace.releases as Record<string, unknown>[] | undefined;
      if (!Array.isArray(rels)) continue;
      for (const r of rels) {
        if (!r || typeof r !== 'object' || Array.isArray(r)) {
          res.status(400).json({
            error: 'Each release must be an object',
            code: 'RELEASE_ID_REQUIRED',
          });
          return;
        }
        const repository = r.repository as { id?: unknown; full_name?: unknown; name?: unknown } | undefined;
        const repoId = r.repo_id ?? repository?.id;
        // Issue #612 A8：tag_name 为 NOT NULL，缺失/无效时提前给出可定位的 400。
        if (typeof r.id !== 'number' || !Number.isInteger(r.id) || r.id <= 0
          || typeof repoId !== 'number' || !Number.isInteger(repoId) || repoId <= 0
          || typeof (r.tag_name as unknown) !== 'string' || !(r.tag_name as string).trim()
          || typeof (r.repo_full_name ?? repository?.full_name) !== 'string'
          || !(r.repo_full_name ?? repository?.full_name)
          || typeof (r.repo_name ?? repository?.name) !== 'string'
          || !(r.repo_name ?? repository?.name)) {
          res.status(400).json({
            error: 'Each release must have a valid positive integer id / repo_id / non-empty tag_name / repo_full_name / repo_name',
            code: 'RELEASE_ID_REQUIRED',
          });
          return;
        }
      }
    }

    // Issue #612 A6：工作区分类数组必须在事务开启前整体验证——每个条目必须是
    // 有效对象，无效条目返回可定位的 400（指明工作区与条目索引），不得先写
    // 部分分类再因读 c.id 抛 500 回滚。
    for (const { accountId: wsAccountId, workspace, unverifiedOwner } of workspaceEntries) {
      if (unverifiedOwner) continue;
      const wsCats = workspace.categories as unknown[] | undefined;
      if (!Array.isArray(wsCats)) continue;
      for (let i = 0; i < wsCats.length; i++) {
        const c = wsCats[i];
        if (!c || typeof c !== 'object' || Array.isArray(c)) {
          res.status(400).json({
            error: `Invalid category entry at index ${i} in account workspace ${wsAccountId}`,
            code: 'INVALID_CATEGORY_ENTRY',
          });
          return;
        }
      }
    }

    // Issue #612 A3：导入工作区真实 PAT（勾选「包含密钥」的备份）前，在事务外
    // 向 GitHub /user 验证身份；只有验证通过且属于该工作区账号的 PAT 才加密
    // 写入对应分区。掩码值与显式清除不需要身份查询；验证失败保留目标账号现有
    // 凭据并在响应中报告（降级处理，不得让整个导入失败）。
    const tokenVerification = new Map<string, { ok: boolean; reason?: string }>();
    for (const { accountId: wsAccountId, workspace, unverifiedOwner } of workspaceEntries) {
      if (unverifiedOwner) continue;
      const wsSettings = workspace.account_settings as Record<string, unknown> | undefined;
      if (!wsSettings || typeof wsSettings !== 'object' || Array.isArray(wsSettings)) continue;
      const token = wsSettings.github_token;
      if (typeof token !== 'string' || !token || token.startsWith('***')) continue;
      const ownerId = await fetchGitHubUserId(token);
      if (ownerId && (ownerId === wsAccountId || wsAccountId === 'default')) {
        // default 分区无数字身份可绑定：只要求 PAT 本身有效（保持纯 default
        // 部署的旧版导入行为）；数字账号分区则必须与工作区账号一致。
        tokenVerification.set(wsAccountId, { ok: true });
      } else {
        tokenVerification.set(wsAccountId, {
          ok: false,
          reason: ownerId
            ? `PAT belongs to account ${ownerId}, not ${wsAccountId}`
            : 'GitHub identity verification failed (network error, timeout or invalid token)',
        });
      }
    }

    // Issue #612 A3：验证未通过而未恢复的工作区凭据报告（在响应中返回）。
    const skippedCredentials: Array<{ account_id: string; restored: boolean; reason?: string }> = [];

    const importAll = db.transaction(() => {
      // Issue #612 A10：workspaceEntries 非空时顶层 repositories/releases/
      // categories 不再静默丢弃——按已选定策略把顶层数据写入当前请求账号分区
      // （分区隔离约束由 A1 的目标范围校验保证：请求分区已明确且与备份声明
      // 一致，或调用方已显式确认迁移）。
      const hasAccountWorkspaces = workspaceEntries.length > 0;

      // Repositories（导入到当前账号分区；account_id 占位参数末位追加）
      const repos = data.repositories as Record<string, unknown>[] | undefined;
      if (Array.isArray(repos) && repos.length > 0) {
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
          // Issue #612 A7：与工作区分支一致，先做对象类型检查再读字段。
          if (
            !r
            || typeof r !== 'object'
            || Array.isArray(r)
            || typeof r.id !== 'number'
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
      if (Array.isArray(rels) && rels.length > 0) {
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
      if (Array.isArray(cats) && cats.length > 0) {
        const catStmt = db.prepare(`
          INSERT OR REPLACE INTO categories (id, name, description, icon, keywords, color, sort_order, is_custom, account_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const c of cats) {
          // Issue #612 A6：与工作区路径一致，事务内跳过无效对象，不因单条脏数据
          // 回滚整个导入。
          if (!c || typeof c !== 'object' || Array.isArray(c)) continue;
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
            // Issue #612 A2(a)：顶层账号范围设置必须纳入与 default 工作区相同的
            // 归属校验后才可写入全局表（default 分区的设置存储位置）。请求本身
            // 不在 default 分区时，全局表中的账号级键归属无法核验，一律跳过，
            // 防止把归属未验证的设置写进认领来源分区。真正的全局设置（非账号级
            // 键）不受影响，仍独立恢复。
            if (accountId !== 'default') continue;
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
      // Issue #612 A20x：记录发生了仓库/发行版写入的工作区分区，事务末尾统一推进快照版本。
      const workspaceWrittenAccounts = new Set<string>();
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
                !r
                || typeof r !== 'object'
                || typeof r.id !== 'number'
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
              workspaceWrittenAccounts.add(wsAccountId);
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
              workspaceWrittenAccounts.add(wsAccountId);
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
              // Issue #612 A9：内部认领状态键（含内嵌密文）只属于目标服务器自身，
              // 绝不随备份迁移——扩展到所有工作区，不再仅限 default。
              if (INTERNAL_SETTING_KEYS.has(key)) continue;
              if (key === 'github_token' && typeof value === 'string' && value.startsWith('***')) {
                continue; // 掩码 Token：保留库中已有的 github_token_encrypted
              }
              let serialized = value === null || value === undefined
                ? null
                : typeof value === 'object' ? JSON.stringify(value) : (value as string);
              if (key === 'github_token' && typeof value === 'string' && value) {
                // Issue #612 A3：真实 Token（勾选「包含密钥」的备份）必须先通过
                // 事务外的 /user 身份验证，且属于该工作区账号才写入；验证失败
                // 保留目标账号现有凭据并在响应中报告，绝不把未验证的凭据加密入库。
                const verification = tokenVerification.get(wsAccountId);
                if (!verification?.ok) {
                  skippedCredentials.push({
                    account_id: wsAccountId,
                    restored: false,
                    reason: verification?.reason ?? 'GitHub identity verification was not performed',
                  });
                  continue;
                }
                // 与其他凭据一致，写入前必须 encrypt()，绝不能把明文凭证当作
                // 普通设置序列化入库。
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
          // Issue #612 A5：与缺失身份跳过行为一致，null / 非对象条目直接跳过，
          // 避免 [null] 抛错导致已导入数据整体回滚。
          if (!a || typeof a !== 'object' || Array.isArray(a)) continue;
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
          // account_id 就是 GitHub user id：资料 id 与之不一致说明备份把两个
          // 账号错配在一起，导入会把 A 的 PAT 登记到 B 名下。
          if (/^\d+$/.test(accountIdValue)) {
            try {
              const profileId = (JSON.parse(userJson) as { id?: unknown })?.id;
              if (typeof profileId !== 'number' || String(profileId) !== accountIdValue) continue;
            } catch {
              continue;
            }
          }
          accountStmt.run(accountIdValue, userJson);
          accountCount++;
        }
        counts.accounts = accountCount;
      }

      // Issue #612 A20x：导入写入的每个分区推进仓库快照版本（仅当发生了
      // 仓库/发行版写入；分区归属与 A1 的目标范围校验一致）。
      if ((counts.repositories ?? 0) > 0 || (counts.releases ?? 0) > 0) {
        bumpAccountRevision(db, accountId);
      }
      if (workspaceEntries.length > 0) {
        for (const wsAccountId of workspaceWrittenAccounts) {
          bumpAccountRevision(db, wsAccountId);
        }
      }
    });

    importAll();
    // Issue #612 A3：验证未通过的工作区凭据在响应中报告（目标账号现有凭据保留）。
    res.json({ imported: counts, skipped_credentials: skippedCredentials });
  } catch (err) {
    console.error('POST /api/sync/import error:', err);
    res.status(500).json({ error: 'Failed to import data', code: 'IMPORT_DATA_FAILED' });
  }
});

// POST /api/sync/legacy-claim
// Issue #612 A17：存量 default 数据无法通过身份校验确立归属时（旧 PAT 已失效且
// 账号分区也没有可用凭据），由持有 API_SECRET 的管理员显式确认迁移目标。路由在
// 全局 authMiddleware 之后挂载；归属已冻结为其他账号时拒绝（不得改变已冻结的
// 归属）；认领事务与自动路径一致，且不复制任何凭据（不自动信任当前全局 Token）。
router.post('/api/sync/legacy-claim', (req, res) => {
  try {
    const db = getDb();
    const body = (req.body ?? {}) as Record<string, unknown>;
    const accountId = typeof body.account_id === 'string' ? body.account_id.trim() : '';
    const result = claimLegacyDefaultWithAdminConfirmation(db, accountId);
    if (!result.ok) {
      const status = result.code === 'INVALID_ACCOUNT_ID' ? 400 : 409;
      res.status(status).json({ error: `Legacy default claim rejected: ${result.code}`, code: result.code });
      return;
    }
    res.json({ claimed: true, account_id: accountId, ...result.claimed });
  } catch (err) {
    console.error('POST /api/sync/legacy-claim error:', err);
    res.status(500).json({ error: 'Failed to claim legacy default data', code: 'LEGACY_CLAIM_FAILED' });
  }
});

export default router;
