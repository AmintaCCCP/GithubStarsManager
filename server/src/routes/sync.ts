import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { encrypt, decrypt } from '../services/crypto.js';
import { config } from '../config.js';
import {
  resolveAccountScope,
  resolveWritableAccountScope,
  hasInvalidAccountHeader,
  hasPendingDefaultPartitionData,
  bumpAccountRevision,
  getAccountCredentialVersion,
  bumpAccountCredentialVersion,
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
 * Issue #612 审计（56）：encodeURIComponent 在字符串含孤立代理码元（如 JSON
 * 转义的 "\uD800"）时抛 URIError——导入事务内抛出会回滚同一事务中已执行的
 * 合法仓库写入并返回 500。改用确定性 UTF-8 百分号编码：合法码位与
 * encodeURIComponent 的输出逐字符一致（普通分类名的 ID 稳定不变），孤立代理
 * 按其码位的 UTF-8 字节形态（WTF-8）转义，保证任意输入都能生成稳定 ID。
 */
function encodeCategoryIdPart(raw: string): string {
  let encoded = '';
  // Array.from 按码点切分：合法代理对是长度 2 的字符串，孤立代理是长度 1。
  for (const ch of Array.from(raw)) {
    const code = ch.codePointAt(0) ?? 0;
    const isLoneSurrogate = ch.length === 1 && code >= 0xd800 && code <= 0xdfff;
    if (!isLoneSurrogate) {
      encoded += encodeURIComponent(ch);
    } else {
      const bytes = [0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f)];
      encoded += bytes.map((b) => `%${b.toString(16).toUpperCase()}`).join('');
    }
  }
  return encoded;
}

/**
 * Issue #612 R2-A19：导入分类的 id 归一化（顶层与工作区路径共用）。
 * 旧版备份的分类条目可能缺失 id（旧 POST /api/categories 不写 id），直接入库
 * 会撞 categories.id 的 NOT NULL 约束并回滚整个导入事务。
 * - 显式 ID（含数字形态）原样保留并预先占位；
 * - 缺失时使用 `legacy-category-${encodeCategoryIdPart(rawName)}` 保留原始名称区分
 *   （避免 `Build Tools` 与 `Build-Tools` 碰撞）；
 * - 同名条目或与显式 ID 冲突时追加稳定的 `#2` / `#3` 序号后缀，保证重复导入
 *   同一备份生成同一组 ID（配合 INSERT OR REPLACE 幂等更新而非创建副本）。
 *
 * Issue #612 R12：生成 ID 同时检查目标分区已有的分类 ID，并区分「同一旧分类
 * 的重复导入」与「不同分类占用同一 ID」：
 * - 目标分区存在同 ID 且同名的记录 → 视为同一条旧分类，复用该 ID（INSERT OR
 *   REPLACE 幂等更新，重试不创建副本）；
 * - 目标分区存在同 ID 但名称不同的记录 → 无法确认是同一条分类：保留目标记录，
 *   为导入条目分配下一个候选 ID，并把被保留的目标记录记入 conflicts（响应中
 *   报告冲突）。冲突路径同样是确定性的：同一备份重试生成同一组 ID，不产生副本。
 */
function buildImportedCategoryIds(
  db: ReturnType<typeof getDb>,
  targetAccountId: string,
  categories: Record<string, unknown>[],
): {
  ids: Array<string | number | null>;
  conflicts: Array<{ id: string; name: string }>;
  /** Issue #612 R13（审计 67）：生成 ID 条目应写入的规范化名称；显式 ID 条目为 null（名称保持原样）。 */
  generatedNames: Array<string | null>;
} {
  const usedIds = new Set<string>();
  const resolved: Array<string | number | null> = categories.map((c) => {
    if (!c || typeof c !== 'object' || Array.isArray(c)) return null;
    if (typeof c.id === 'string' && c.id.trim()) {
      usedIds.add(c.id);
      return c.id;
    }
    if (typeof c.id === 'number' && Number.isFinite(c.id)) {
      usedIds.add(String(c.id));
      return c.id;
    }
    return null;
  });
  const generatedNames: Array<string | null> = categories.map(() => null);

  const conflicts: Array<{ id: string; name: string }> = [];
  const targetNameById = (id: string): string | null => {
    try {
      const row = db.prepare('SELECT name FROM categories WHERE account_id = ? AND id = ?')
        .get(targetAccountId, id) as { name: string | null } | undefined;
      return row ? String(row.name ?? '') : null;
    } catch {
      // 轻量 stub 缺表时按无目标记录处理
      return null;
    }
  };

  for (let i = 0; i < categories.length; i++) {
    if (resolved[i] !== null) continue;
    const c = categories[i];
    if (!c || typeof c !== 'object' || Array.isArray(c)) continue;
    const rawName = typeof c.name === 'string' && c.name.trim() ? c.name.trim() : 'unnamed';
    const baseId = `legacy-category-${encodeCategoryIdPart(rawName)}`;
    let candidate = baseId;
    let suffix = 2;
    for (;;) {
      if (usedIds.has(candidate)) {
        candidate = `${baseId}#${suffix}`;
        suffix++;
        continue;
      }
      const targetName = targetNameById(candidate);
      // Issue #612 R13（审计 67）：ID 由 trim 后的名称生成，而分类写入可能保留
      // 备份中的原始名称——冲突检查按同一规范化表示（trim 后）比较，否则相同
      // 备份重试仅因首尾空格差异被误判为异名冲突，生成 #2 副本并随重试递增。
      // 真正的异名冲突仍换下一个候选 ID 并保留目标分类。
      if (targetName === null || targetName.trim() === rawName) break;
      conflicts.push({ id: candidate, name: rawName });
      candidate = `${baseId}#${suffix}`;
      suffix++;
    }
    usedIds.add(candidate);
    resolved[i] = candidate;
    // 写入与 ID 生成使用同一规范化名称表示：重复导入时存储值与生成 ID 的名称
    // 基准一致（配合上方的 trim 比较同时兼容旧版本写入的原始名称）。
    generatedNames[i] = rawName;
  }

  return { ids: resolved, conflicts, generatedNames };
}

const toSharedBit = (value: unknown): number => (value === true || value === 1) ? 1 : 0;

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
    // Issue #612 R12：显式携带但格式无效的账号头（如 `abc`）必须像仓库/发行版
    // 列表接口一样在解析范围前拒绝——resolveAccountScope 会把无效头当作未指定
    // 账号回退到活跃账号，导出会错误地把活跃账号数据标记为该账号。真正未携带
    // 账号头的旧版请求保留原行为。
    if (hasInvalidAccountHeader(req)) {
      res.status(409).json({
        error: 'X-GitHub-Account-Id must be a numeric account ID',
        code: 'ACCOUNT_SCOPE_REQUIRED',
      });
      return;
    }
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
    // Issue #612 R2-A16：显式存在但格式不受支持的 account_id 直接拒绝导入——
    // 绝不当作「未声明」跳过所有者比较；仅字段缺失时沿用旧备份兼容行为。
    const declaredAccountId = (data as { account_id?: unknown }).account_id;
    if (declaredAccountId !== undefined) {
      if (!isDeclaredAccountId(declaredAccountId)) {
        // null / 数字 / 任意字符串等非支持形态：显式存在但格式不受支持 → 拒绝。
        res.status(400).json({
          error: `Unsupported backup account_id: ${String(declaredAccountId)}`,
          code: 'INVALID_BACKUP_ACCOUNT_ID',
        });
        return;
      }
      if (declaredAccountId !== accountId
        && (data as { allowAccountMigration?: unknown }).allowAccountMigration !== true) {
        res.status(409).json({
          error: `Backup was exported from account ${declaredAccountId}; re-send with allowAccountMigration=true to migrate it into account ${accountId}`,
          code: 'ACCOUNT_ID_MISMATCH',
        });
        return;
      }
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
    const workspaceEntries: Array<{
      accountId: string;
      workspace: Record<string, unknown>;
      unverifiedOwner: boolean;
      /** Issue #612 R2-A23：凭据验证结果按工作区条目绑定（重复账号条目互不影响）。 */
      tokenVerification?: { ok: boolean; reason?: string };
      /** 异步 PAT 校验前记录的目标账号凭据版本，用于事务内检测并发清除/轮换。 */
      credentialVersionBefore?: number;
    }> = [];
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
        const wsObj = ws as Record<string, unknown>;
        if (wsObj.account_id !== undefined && wsObj.account_id !== null && String(wsObj.account_id) !== id) {
          res.status(400).json({
            error: `Account workspace account_id (${String(wsObj.account_id)}) does not match key (${id})`,
            code: 'INVALID_ACCOUNT_WORKSPACE',
          });
          return;
        }
        const unverifiedDefault = id === 'default'
          && (accountId !== 'default' || hasPendingDefaultPartitionData(db));
        workspaceEntries.push({
          accountId: id,
          workspace: wsObj,
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
        // Issue #612 R13（审计 66）：repo_full_name / repo_name 与顶层 releases
        // 使用同一规则——去除首尾空白后必须非空，否则仅含空白的名称（' '）会
        // 通过工作区校验写入数据库，导出后出现在顶层 releases 中，再次导入被
        // 顶层的 trim() 检查拒绝整个备份。
        if (typeof r.id !== 'number' || !Number.isInteger(r.id) || r.id <= 0
          || typeof repoId !== 'number' || !Number.isInteger(repoId) || repoId <= 0
          || typeof (r.tag_name as unknown) !== 'string' || !(r.tag_name as string).trim()
          || typeof (r.repo_full_name ?? repository?.full_name) !== 'string'
          || !((r.repo_full_name ?? repository?.full_name) as string).trim()
          || typeof (r.repo_name ?? repository?.name) !== 'string'
          || !((r.repo_name ?? repository?.name) as string).trim()) {
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
    // Issue #612 R2-A23：验证结果绑定到具体工作区条目（不再按账号 ID 共享
    // Map）——备份为同一账号提供多个工作区条目时，各条目的凭据独立验证、
    // 独立取舍，单条验证结果不会被另一条目覆盖。
    // 并行校验所有工作区及顶层真实 PAT，使总校验耗时受限于单次 8s 超时上限，
    // 不会因多工作区串行校验超过客户端 30s 请求超时而导致响应与提交状态不一致。
    const topLevelTokenMayBeWritten = workspaceEntries.length === 0 || accountId === 'default';
    const topTokenValue = topSettings && typeof topSettings === 'object' && !Array.isArray(topSettings)
      ? (topSettings as Record<string, unknown>).github_token
      : undefined;
    const shouldVerifyTopToken = topLevelTokenMayBeWritten
      && typeof topTokenValue === 'string'
      && Boolean(topTokenValue)
      && !topTokenValue.startsWith('***');

    const topLevelCredVersionBefore = getAccountCredentialVersion(db, accountId);
    for (const entry of workspaceEntries) {
      entry.credentialVersionBefore = getAccountCredentialVersion(db, entry.accountId);
    }

    let topLevelTokenVerification: { ok: boolean; reason?: string } | null = null;
    await Promise.all([
      ...workspaceEntries.map(async (entry) => {
        if (entry.unverifiedOwner) return;
        const wsSettings = entry.workspace.account_settings as Record<string, unknown> | undefined;
        if (!wsSettings || typeof wsSettings !== 'object' || Array.isArray(wsSettings)) return;
        const token = wsSettings.github_token;
        if (typeof token !== 'string' || !token || token.startsWith('***')) return;
        const ownerId = await fetchGitHubUserId(token);
        if (ownerId && (ownerId === entry.accountId || entry.accountId === 'default')) {
          // default 分区无数字身份可绑定：只要求 PAT 本身有效（保持纯 default
          // 部署的旧版导入行为）；数字账号分区则必须与工作区账号一致。
          entry.tokenVerification = { ok: true };
        } else {
          entry.tokenVerification = {
            ok: false,
            reason: ownerId
              ? `PAT belongs to account ${ownerId}, not ${entry.accountId}`
              : 'GitHub identity verification failed (network error, timeout or invalid token)',
          };
        }
      }),
      ...(shouldVerifyTopToken ? [(async () => {
        const ownerId = await fetchGitHubUserId(topTokenValue as string);
        if (ownerId && (ownerId === accountId || accountId === 'default')) {
          topLevelTokenVerification = { ok: true };
        } else {
          topLevelTokenVerification = {
            ok: false,
            reason: ownerId
              ? `PAT belongs to account ${ownerId}, not ${accountId}`
              : 'GitHub identity verification failed (network error, timeout or invalid token)',
          };
        }
      })()] : []),
    ]);

    // Issue #612 A3：验证未通过而未恢复的工作区凭据报告（在响应中返回）。
    const skippedCredentials: Array<{ account_id: string; restored: boolean; reason?: string }> = [];

    const importAll = db.transaction((): {
      scopeError: boolean;
      skippedPendingClaim: string[];
      topLevelDefaultBlocked: boolean;
      /** Issue #612 R12：顶层迁移让位给目标分区工作区快照而跳过的重叠记录数。 */
      migrationOverlapSkipped: { repositories: number; releases: number; categories: number };
      /** Issue #612 R12：因目标分区同 ID 不同名而保留目标记录的生成 ID 冲突。 */
      categoryIdConflicts: Array<{ account_id: string; id: string; name: string }>;
    } => {
      // 事务首次写入前重新解析无账号头请求的范围：若异步 PAT 验证期间账号状态变化
      // 导致范围变得歧义或目标改变，直接拒绝导入，绝不将已验证载荷改投到新目标。
      const currentScope = resolveWritableAccountScope(req, db);
      if (!currentScope.ok || currentScope.accountId !== accountId) {
        return {
          scopeError: true,
          skippedPendingClaim: [],
          topLevelDefaultBlocked: false,
          migrationOverlapSkipped: { repositories: 0, releases: 0, categories: 0 },
          categoryIdConflicts: [],
        };
      }

      // Issue #612 审计（597）：记录因 default 分区待认领保护而跳过的恢复分区——
      // 保留归属保护不变，但绝不静默丢弃：没有数据被应用时返回可操作的冲突
      // 响应，仍有其他数据提交时在响应中列出被跳过的分区与待认领这一原因。
      const skippedPendingClaim: string[] = [];
      const migrationOverlapSkipped = { repositories: 0, releases: 0, categories: 0 };
      const categoryIdConflicts: Array<{ account_id: string; id: string; name: string }> = [];
      const backupHasNonEmptyArray = (key: string): boolean => {
        const value = (data as Record<string, unknown>)[key];
        return Array.isArray(value) && value.length > 0;
      };

      // Issue #612 A10：workspaceEntries 非空时顶层 repositories/releases/
      // categories 不再静默丢弃——按已选定策略把顶层数据写入当前请求账号分区
      // （分区隔离约束由 A1 的目标范围校验保证：请求分区已明确且与备份声明
      // 一致，或调用方已显式确认迁移）。
      const hasAccountWorkspaces = workspaceEntries.length > 0;
      // Issue #612 R2-A15/A18：在事务开始后、首次写入前检查一次 default 待认领状态，
      // 顶层与 default 工作区共用该结果——既拦截验证期间的外部写入，又不会把本事务
      // 刚写入的顶层仓库误判为待认领数据。
      const pendingDefaultAtTxStart = hasPendingDefaultPartitionData(db);
      const topLevelDefaultBlocked = accountId === 'default' && pendingDefaultAtTxStart;
      if (topLevelDefaultBlocked) {
        if (backupHasNonEmptyArray('repositories')) skippedPendingClaim.push('repositories');
        if (backupHasNonEmptyArray('releases')) skippedPendingClaim.push('releases');
        if (backupHasNonEmptyArray('categories')) skippedPendingClaim.push('categories');
      }

      // Issue #612 R12：显式迁移（allowAccountMigration，声明账号 ≠ 请求分区）把
      // 顶层数据写入请求分区时，备份中指向同一分区（wsAccountId === accountId）
      // 的工作区数据与顶层迁移数据可能指向同一条记录——两个来源先后
      // INSERT OR REPLACE 会互相覆盖且都计为成功。写入前先收集目标分区工作区
      // 将写入的记录 ID：重叠记录采用明确优先级——分区自身的工作区快照优先，
      // 顶层迁移让位（保留所有互不重叠的数据），并在响应中报告跳过的重叠数量。
      const isMigrationImport = (data as { allowAccountMigration?: unknown }).allowAccountMigration === true
        && declaredAccountId !== undefined
        && declaredAccountId !== accountId;
      const workspaceOverlapIds: {
        repositories: Set<number>;
        releases: Set<number>;
        categories: Set<string | number>;
      } | null = isMigrationImport
        ? { repositories: new Set(), releases: new Set(), categories: new Set() }
        : null;
      if (workspaceOverlapIds) {
        for (const { accountId: wsAccountId, workspace, unverifiedOwner } of workspaceEntries) {
          if (wsAccountId !== accountId) continue;
          const willSkipWorkspace = unverifiedOwner || (wsAccountId === 'default'
            && (accountId !== 'default' || pendingDefaultAtTxStart));
          if (willSkipWorkspace) continue;
          const wsRepos = workspace.repositories as Record<string, unknown>[] | undefined;
          if (Array.isArray(wsRepos)) {
            for (const r of wsRepos) {
              if (!r || typeof r !== 'object' || Array.isArray(r)
                || typeof r.id !== 'number' || !Number.isInteger(r.id) || r.id <= 0
                || typeof r.name !== 'string'
                || typeof r.full_name !== 'string'
                || typeof r.html_url !== 'string') continue;
              workspaceOverlapIds.repositories.add(r.id);
            }
          }
          const wsRels = workspace.releases as Record<string, unknown>[] | undefined;
          if (Array.isArray(wsRels)) {
            for (const r of wsRels) {
              const repository = r.repository as { id?: unknown } | undefined;
              const repoId = r.repo_id ?? repository?.id;
              if (typeof r.id !== 'number' || !Number.isInteger(r.id) || r.id <= 0
                || typeof repoId !== 'number' || !Number.isInteger(repoId) || repoId <= 0
                || typeof r.tag_name !== 'string' || !r.tag_name.trim()) continue;
              workspaceOverlapIds.releases.add(r.id);
            }
          }
          const wsCats = workspace.categories as unknown[] | undefined;
          if (Array.isArray(wsCats) && wsCats.length > 0) {
            const { ids: wsOverlapCatIds } = buildImportedCategoryIds(db, wsAccountId, wsCats as Record<string, unknown>[]);
            for (const catId of wsOverlapCatIds) {
              if (catId !== null) workspaceOverlapIds.categories.add(catId);
            }
          }
        }
      }

      // 在首次写入前记录事务开始时的凭据版本差异：若异步验证期间目标账号凭据已被
      // 清除或轮换，事务内绝不用旧的已验证 PAT 覆盖较新状态。
      const topLevelCredChanged = getAccountCredentialVersion(db, accountId) !== topLevelCredVersionBefore;
      const wsCredChangedByAccount = new Map<string, boolean>();
      for (const entry of workspaceEntries) {
        if (!wsCredChangedByAccount.has(entry.accountId)) {
          wsCredChangedByAccount.set(
            entry.accountId,
            getAccountCredentialVersion(db, entry.accountId) !== (entry.credentialVersionBefore ?? 0),
          );
        }
      }

      // Repositories（导入到当前账号分区；account_id 占位参数末位追加）
      // 保留备份中的 ai_shared / ai_*_shared 共享授权标记（旧备份缺省时落 0）；
      // vector_indexed_at 一律清空为 NULL，避免旧版备份恢复后把缺少 accountId 元数据
      // 的旧向量视为已索引。
      const repos = data.repositories as Record<string, unknown>[] | undefined;
      if (!topLevelDefaultBlocked && Array.isArray(repos) && repos.length > 0) {
        const repoStmt = db.prepare(`
          INSERT OR REPLACE INTO repositories (
            id, name, full_name, description, html_url, stargazers_count, language,
            created_at, updated_at, pushed_at, starred_at,
            owner_login, owner_avatar_url, topics,
            ai_summary, ai_tags, ai_platforms, analyzed_at, analysis_failed,
            custom_description, custom_tags, custom_category, category_locked, last_edited,
            subscribed_to_releases, vector_indexed_at, license, vector_indexed_license,
            description_display, tags_display,
            ai_shared, ai_summary_shared, ai_tags_shared, ai_platforms_shared,
            account_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          // Issue #612 R12：与目标分区工作区重叠的记录让位给分区自身的工作区快照
          //（仅显式迁移场景收集了重叠 ID），绝不静默互相覆盖。
          if (workspaceOverlapIds?.repositories.has(r.id)) {
            migrationOverlapSkipped.repositories += 1;
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
            null,
            licenseValue,
            // INSERT OR REPLACE 会整行替换，故备份无此列时落 null（影响：增量谓词会
            // 触发一次重索引回填指纹），合预期。
            vectorIndexedLicense
            , toDisplayPref(r.description_display, DESCRIPTION_DISPLAY_VALUES)
            , toDisplayPref(r.tags_display, TAGS_DISPLAY_VALUES)
            , toSharedBit(r.ai_shared)
            , toSharedBit(r.ai_summary_shared)
            , toSharedBit(r.ai_tags_shared)
            , toSharedBit(r.ai_platforms_shared)
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
      if (!topLevelDefaultBlocked && Array.isArray(rels) && rels.length > 0) {
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
        let importedReleases = 0;
        for (const r of rels) {
          // Issue #612 R12：与目标分区工作区重叠的发行版让位（仅显式迁移场景）。
          // id 已在上方的 releases 预校验中确认为正整数。
          if (workspaceOverlapIds?.releases.has(r.id as number)) {
            migrationOverlapSkipped.releases += 1;
            continue;
          }
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
          importedReleases += 1;
        }
        counts.releases = importedReleases;
      }

      // Categories（导入到当前账号分区）
      const cats = data.categories as Record<string, unknown>[] | undefined;
      if (!topLevelDefaultBlocked && Array.isArray(cats) && cats.length > 0) {
        const catStmt = db.prepare(`
          INSERT OR REPLACE INTO categories (id, name, description, icon, keywords, color, sort_order, is_custom, account_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const { ids: catIds, conflicts: topLevelCatConflicts, generatedNames: topLevelCatNames } = buildImportedCategoryIds(db, accountId, cats);
        for (const conflict of topLevelCatConflicts) {
          categoryIdConflicts.push({ account_id: accountId, ...conflict });
        }
        let importedCategories = 0;
        for (let i = 0; i < cats.length; i++) {
          const c = cats[i];
          const catId = catIds[i];
          // Issue #612 A6：与工作区路径一致，事务内跳过无效对象，不因单条脏数据
          // 回滚整个导入。
          if (!c || typeof c !== 'object' || Array.isArray(c) || catId === null) continue;
          // Issue #612 R12：与目标分区工作区重叠的分类让位（仅显式迁移场景）。
          if (workspaceOverlapIds?.categories.has(catId)) {
            migrationOverlapSkipped.categories += 1;
            continue;
          }
          catStmt.run(
            // Issue #612 R2-A19：旧版分类 id 为 NULL/缺失时分配确定性稳定标识
            // （顶层与工作区共用），显式 ID 原样保留，避免 NOT NULL 约束回滚。
            // Issue #612 R13（审计 67）：生成 ID 的条目写入与 ID 生成同一规范化
            // 名称（trim 后），重复导入不再因首尾空格差异误判冲突。
            catId, topLevelCatNames[i] ?? (c.name ?? ''), c.description ?? null, c.icon ?? '📁',
            typeof c.keywords === 'string' ? c.keywords : JSON.stringify(c.keywords ?? []),
            c.color ?? null, c.sort_order ?? 0, c.is_custom ? 1 : 0,
            accountId
          );
          // Issue #612 R12：只统计实际写入的顶层分类——跳过的无效条目
          // （如 [null]）不得报告为已导入（与工作区分支的计数时机一致）。
          importedCategories += 1;
        }
        counts.categories = importedCategories;
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
      // Issue #612 R13 审计（16）：记录本事务已恢复到全局 settings 表的键。
      // default 工作区写入 account_settings 时镜像进全局表（下方 wsGlobalSettingsStmt），
      // 其中的历史副本（旧版 account_settings('default') 残留）不得覆盖同一键
      // 在顶层恢复的现行值。
      const globalSettingsRestoredKeys = new Set<string>();
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
          // Issue #612 R2-A15：目标 default 分区仍有待认领数据时，无论是否包含工作区
          // （包括不含工作区的 v1 备份），所有账号级设置均跳过，仅继续恢复真正的全局设置。
          if (topLevelDefaultBlocked && ACCOUNT_SCOPED_SETTING_KEYS.has(key)) {
            if (!skippedPendingClaim.includes('account_settings')) skippedPendingClaim.push('account_settings');
            continue;
          }
          if (hasAccountWorkspaces && ACCOUNT_SCOPED_SETTING_KEYS.has(key)) {
            // Issue #612 A2(a)：顶层账号范围设置必须纳入与 default 工作区相同的
            // 归属校验后才可写入全局表（default 分区的设置存储位置）。请求本身
            // 不在 default 分区时，全局表中的账号级键归属无法核验，一律跳过，
            // 防止把归属未验证的设置写进认领来源分区。真正的全局设置（非账号级
            // 键）不受影响，仍独立恢复。
            if (accountId !== 'default') continue;
            if (key === 'github_token' && value && typeof value === 'string') {
              // Issue #612 R2-A17：顶层真实 PAT 必须先通过 /user 身份验证
              // （与 A3 工作区路径同语义），失败保留目标凭据并报告。
              if (!topLevelTokenVerification?.ok) {
                skippedCredentials.push({
                  account_id: accountId,
                  restored: false,
                  reason: topLevelTokenVerification?.reason
                    ?? 'GitHub identity verification was not performed',
                });
                continue;
              }
              if (topLevelCredChanged) {
                skippedCredentials.push({
                  account_id: accountId,
                  restored: false,
                  reason: 'Account credential changed during verification',
                });
                continue;
              }
              globalSettingsStmt.run(key, encrypt(value, config.encryptionKey));
              globalSettingsRestoredKeys.add(key);
              bumpAccountCredentialVersion(db, accountId);
            } else {
              // Issue #612 审计（962）：顶层 default 的 github_token 显式空值
              // （null / '' / undefined）同样受凭据版本保护——版本在校验等待期间
              // 已变化时保留新凭据并在 skipped_credentials 中报告。
              if (key === 'github_token' && topLevelCredChanged) {
                skippedCredentials.push({
                  account_id: accountId,
                  restored: false,
                  reason: 'Account credential changed during verification',
                });
                continue;
              }
              globalSettingsStmt.run(key, serializeSettingValue(value));
              globalSettingsRestoredKeys.add(key);
              if (key === 'github_token') {
                bumpAccountCredentialVersion(db, accountId);
              }
            }
            settingsCount++;
            continue;
          }
          if (key === 'github_token' && value && typeof value === 'string') {
            // Issue #612 R2-A17：v1 备份顶层真实 PAT 同样必须先通过 /user 身份
            // 验证；失败保留目标账号现有凭据并在响应中报告。
            if (!topLevelTokenVerification?.ok) {
              skippedCredentials.push({
                account_id: accountId,
                restored: false,
                reason: topLevelTokenVerification?.reason
                  ?? 'GitHub identity verification was not performed',
              });
              continue;
            }
            if (topLevelCredChanged) {
              skippedCredentials.push({
                account_id: accountId,
                restored: false,
                reason: 'Account credential changed during verification',
              });
              continue;
            }
            const encrypted = encrypt(value, config.encryptionKey);
            if (accountId !== 'default') {
              accountSettingsStmt.run(accountId, key, encrypted);
            } else {
              globalSettingsStmt.run(key, encrypted);
              globalSettingsRestoredKeys.add(key);
            }
            bumpAccountCredentialVersion(db, accountId);
          } else if (key === 'github_token' && (value === null || value === undefined || value === '')) {
            // Issue #612 审计（962）：显式清空分支与真实 PAT 写入共用凭据版本检查
            // ——导入等待另一工作区校验期间凭据可能被轮换，版本已变化时保留新
            // 凭据并在 skipped_credentials 中报告，绝不覆盖；版本未变化时按备份
            // 执行显式清空。
            if (topLevelCredChanged) {
              skippedCredentials.push({
                account_id: accountId,
                restored: false,
                reason: 'Account credential changed during verification',
              });
              continue;
            }
            // 显式空 Token（null / ''；掩码 '***' 已在上方跳过）：除写入空值占位
            // 外，必须同步清空 accounts 的加密凭据副本，避免旧 Token 回退复活。
            if (accountId !== 'default') {
              accountSettingsStmt.run(accountId, key, serializeSettingValue(value));
              clearAccountTokenStmt.run(accountId);
            } else {
              globalSettingsStmt.run(key, serializeSettingValue(value));
              globalSettingsRestoredKeys.add(key);
            }
            bumpAccountCredentialVersion(db, accountId);
          } else if (ACCOUNT_SCOPED_SETTING_KEYS.has(key) && accountId !== 'default') {
            accountSettingsStmt.run(accountId, key, serializeSettingValue(value));
          } else {
            globalSettingsStmt.run(key, serializeSettingValue(value));
            globalSettingsRestoredKeys.add(key);
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
      // Issue #612 R13 审计（15b）：仅导入发行版（无仓库写入）的分区同样推进
      // 快照版本，但绝不据此清除向量回填检查标记——仓库已正确索引的分区被清标
      // 后，下一次 MCP 向量查询会重新探测并清空这些仓库的 vector_indexed_at，
      // 触发不必要的全量重建。只有实际写入仓库的分区才清除（与顶层路径一致）。
      const workspaceRepoWrittenAccounts = new Set<string>();
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
            ai_shared, ai_summary_shared, ai_tags_shared, ai_platforms_shared,
            account_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

        for (const { accountId: wsAccountId, workspace, unverifiedOwner, tokenVerification: entryTokenVerification } of workspaceEntries) {
          // Issue #612 R2-A18：复用事务开始前（首次写入前）采集的 pendingDefaultAtTxStart，
          // 既拦截验证期间的外部写入，又避免把本事务刚写入的顶层仓库误判为待认领数据。
          const skipDefaultWorkspace = unverifiedOwner || (wsAccountId === 'default'
            && (accountId !== 'default' || pendingDefaultAtTxStart));
          if (skipDefaultWorkspace) {
            // Issue #612 R12：目标为数字账号时，备份中的 default 工作区同样因归属
            // 未验证被跳过——必须在响应中单独报告该分区未恢复及原因，否则响应
            // 无法区分完整恢复与部分恢复。topLevelDefaultBlocked（目标 default +
            // 待认领）时沿用既有报告路径与原因。
            if (wsAccountId === 'default'
              && !skippedPendingClaim.includes('account_workspaces.default')) {
              skippedPendingClaim.push('account_workspaces.default');
            }
            continue;
          }
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
                null,
                licenseValue,
                vectorIndexedLicense,
                toDisplayPref(r.description_display, DESCRIPTION_DISPLAY_VALUES),
                toDisplayPref(r.tags_display, TAGS_DISPLAY_VALUES),
                toSharedBit(r.ai_shared),
                toSharedBit(r.ai_summary_shared),
                toSharedBit(r.ai_tags_shared),
                toSharedBit(r.ai_platforms_shared),
                wsAccountId
              );
              workspaceRepoCount++;
              workspaceWrittenAccounts.add(wsAccountId);
              workspaceRepoWrittenAccounts.add(wsAccountId);
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
            const { ids: wsCatIds, conflicts: wsCatConflicts, generatedNames: wsCatNames } = buildImportedCategoryIds(db, wsAccountId, wsCats);
            for (const conflict of wsCatConflicts) {
              categoryIdConflicts.push({ account_id: wsAccountId, ...conflict });
            }
            for (let i = 0; i < wsCats.length; i++) {
              const c = wsCats[i];
              const catId = wsCatIds[i];
              if (!c || typeof c !== 'object' || Array.isArray(c) || catId === null) continue;
              wsCatStmt.run(
                // Issue #612 R2-A19：旧版分类 id 为 NULL/缺失时分配确定性稳定
                // 标识（与顶层路径共用），显式 ID 原样保留，避免 NOT NULL 约束
                // 导致整个导入事务回滚。生成 ID 的条目写入与 ID 生成同一规范化
                // 名称（R13 审计 67，与顶层路径一致）。
                wsAccountId, catId, wsCatNames[i] ?? (c.name ?? ''), c.description ?? null, c.icon ?? '📁',
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
              // Issue #612 R13 审计（16）：同一 default 设置键已由备份顶层全局设置
              // 恢复时，跳过工作区中的历史副本（如旧版 account_settings('default')
              // 残留），避免覆盖顶层恢复的现行值；顶层未恢复该键时仍照常写入，
              // 支持仅由工作区提供的设置恢复。数字账号工作区写自身分区，不受影响。
              if (wsAccountId === 'default' && globalSettingsRestoredKeys.has(key)) continue;
              if (key === 'github_token' && typeof value === 'string' && value.startsWith('***')) {
                continue; // 掩码 Token：保留库中已有的 github_token_encrypted
              }
              let serialized = value === null || value === undefined
                ? null
                : typeof value === 'object' ? JSON.stringify(value) : (value as string);
              let credentialUpdated = false;
              if (key === 'github_token' && typeof value === 'string' && value) {
                // Issue #612 A3：真实 Token（勾选「包含密钥」的备份）必须先通过
                // 事务外的 /user 身份验证，且属于该工作区账号才写入；验证失败
                // 保留目标账号现有凭据并在响应中报告，绝不把未验证的凭据加密入库。
                // Issue #612 R2-A23：验证结果取自本工作区条目（重复账号条目互不影响）。
                const verification = entryTokenVerification;
                if (!verification?.ok) {
                  skippedCredentials.push({
                    account_id: wsAccountId,
                    restored: false,
                    reason: verification?.reason ?? 'GitHub identity verification was not performed',
                  });
                  continue;
                }
                if (wsCredChangedByAccount.get(wsAccountId)) {
                  skippedCredentials.push({
                    account_id: wsAccountId,
                    restored: false,
                    reason: 'Account credential changed during verification',
                  });
                  continue;
                }
                // 与其他凭据一致，写入前必须 encrypt()，绝不能把明文凭证当作
                // 普通设置序列化入库。
                serialized = encrypt(value, config.encryptionKey);
                credentialUpdated = true;
              } else if (key === 'github_token' && (value === null || value === undefined || value === '')) {
                // Issue #612 审计（962）：显式清空前同样检查凭据版本——验证等待
                // 期间被并发轮换时保留新凭据并在 skipped_credentials 中报告。
                if (wsCredChangedByAccount.get(wsAccountId)) {
                  skippedCredentials.push({
                    account_id: wsAccountId,
                    restored: false,
                    reason: 'Account credential changed during verification',
                  });
                  continue;
                }
                // 显式空 Token（null / ''）：同步清空 accounts 的加密凭据副本，
                // 避免已清空的 Token 经 accounts 回退复活。
                wsClearAccountTokenStmt.run(wsAccountId);
                credentialUpdated = true;
              }
              if (wsAccountId === 'default') wsGlobalSettingsStmt.run(key, serialized);
              else wsSettingsStmt.run(wsAccountId, key, serialized);
              if (credentialUpdated) {
                bumpAccountCredentialVersion(db, wsAccountId);
              }
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
              const parsedProfile = JSON.parse(userJson) as Record<string, unknown> | null;
              const profileId = parsedProfile && typeof parsedProfile === 'object' ? parsedProfile.id : undefined;
              const isValidNumericId = (typeof profileId === 'number' && Number.isInteger(profileId))
                || (typeof profileId === 'string' && /^\d+$/.test(profileId));
              if (!isValidNumericId || String(profileId) !== accountIdValue) continue;
              if (typeof profileId === 'string') {
                const numericId = Number(profileId);
                if (Number.isSafeInteger(numericId)) {
                  userJson = JSON.stringify({ ...parsedProfile, id: numericId });
                }
              }
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
      // 仓库导入会重置 vector_indexed_at，同步清除回填检查标记以便后续重新核验。
      const clearBackfillChecked = (targetAccountId: string) => {
        try {
          db.prepare(
            "DELETE FROM partition_meta WHERE account_id = ? AND key = 'vector_account_backfill_checked'"
          ).run(targetAccountId);
        } catch {
          // 轻量 stub 缺表时忽略
        }
      };
      if ((counts.repositories ?? 0) > 0 || (counts.releases ?? 0) > 0) {
        bumpAccountRevision(db, accountId);
        if ((counts.repositories ?? 0) > 0) {
          clearBackfillChecked(accountId);
        }
      }
      if (workspaceEntries.length > 0) {
        for (const wsAccountId of workspaceWrittenAccounts) {
          bumpAccountRevision(db, wsAccountId);
          // Issue #612 R13 审计（15b）：仅实际写入仓库的分区清除回填检查标记；
          // 仅写入发行版的分区保留标记（其仓库若已正确索引，无需触发重新探测
          // 与全量重建）。仓库与发行版写入推进分区版本的行为保持不变。
          if (workspaceRepoWrittenAccounts.has(wsAccountId)) {
            clearBackfillChecked(wsAccountId);
          }
        }
      }
      return {
        scopeError: false,
        skippedPendingClaim,
        topLevelDefaultBlocked,
        migrationOverlapSkipped,
        categoryIdConflicts,
      };
    });

    const importResult = typeof importAll.immediate === 'function' ? importAll.immediate() : importAll();
    if (importResult.scopeError) {
      res.status(409).json({
        error: 'X-GitHub-Account-Id is required when multiple accounts exist',
        code: 'ACCOUNT_SCOPE_REQUIRED',
      });
      return;
    }
    // Issue #612 审计（597）：待认领保护跳过的分区必须在响应中说明——完全没有
    // 数据被应用时返回可操作的冲突响应（而不是看似成功、实际什么都没写的 200）；
    // 仍有其他数据提交时在响应中列出被跳过的分区与跳过原因。
    // Issue #612 R12：跳过原因按实际保护来源区分——目标 default 待认领
    // （legacy_default_claim_pending）与目标为数字账号时备份 default 工作区归属
    // 未验证（default_workspace_ownership_unverified）。
    const skippedPendingClaim = importResult.skippedPendingClaim;
    const skippedReason = importResult.topLevelDefaultBlocked
      ? 'legacy_default_claim_pending'
      : 'default_workspace_ownership_unverified';
    const appliedTotal = Object.values(counts).reduce(
      (sum, value) => sum + (typeof value === 'number' ? value : 0),
      0,
    );
    if (appliedTotal === 0 && skippedPendingClaim.length > 0) {
      res.status(409).json({
        error: importResult.topLevelDefaultBlocked
          ? 'Nothing was imported: the target default partition still has unclaimed legacy data, so the backup\'s repositories, releases, categories and account-level settings were skipped. Complete the legacy claim first (or re-send with an explicit X-GitHub-Account-Id after claiming) and retry the import.'
          : 'Nothing was imported: the backup\'s default workspace was skipped because its ownership could not be verified for the requested numeric account. This instance cannot directly restore a backup default workspace once its own legacy default partition has been claimed: headerless imports resolve to the active numeric account and an explicit X-GitHub-Account-Id only accepts numeric account IDs, so no request can target the default partition. Restore the default workspace on a fresh instance before its legacy claim completes, or re-key the workspace to its owning numeric account in the backup.',
        code: 'LEGACY_DEFAULT_CLAIM_PENDING',
        skipped_partitions: skippedPendingClaim,
        reason: skippedReason,
      });
      return;
    }
    // Issue #612 A3：验证未通过的工作区凭据在响应中报告（目标账号现有凭据保留）。
    const { migrationOverlapSkipped } = importResult;
    res.json({
      imported: counts,
      skipped_credentials: skippedCredentials,
      ...(skippedPendingClaim.length > 0
        ? { skipped_pending_claim: { partitions: skippedPendingClaim, reason: skippedReason } }
        : {}),
      ...(importResult.categoryIdConflicts.length > 0
        ? { category_id_conflicts: importResult.categoryIdConflicts }
        : {}),
      ...(migrationOverlapSkipped.repositories + migrationOverlapSkipped.releases + migrationOverlapSkipped.categories > 0
        ? { migration_overlaps_skipped: migrationOverlapSkipped }
        : {}),
    });
  } catch (err) {
    console.error('POST /api/sync/import error:', err);
    res.status(500).json({ error: 'Failed to import data', code: 'IMPORT_DATA_FAILED' });
  }
});

// POST /api/sync/legacy-claim
// Issue #612 A17 / R2-A5：存量 default 数据无法通过身份校验确立归属时（存量快照
// PAT 已失效；可轮换的账号分区凭据不再作为归属证据），由持有 API_SECRET 的管理
// 员显式确认迁移目标。路由在全局 authMiddleware 之后挂载；归属已冻结为其他账号
// 时拒绝（不得改变已冻结的归属）；认领事务与自动路径一致，且不复制任何凭据
// （不自动信任当前全局 Token）。
router.post('/api/sync/legacy-claim', (req, res) => {
  try {
    const db = getDb();
    const body = (req.body ?? {}) as Record<string, unknown>;
    const accountId = typeof body.account_id === 'string' ? body.account_id.trim() : '';
    // Issue #612 审计（847）：同名歧义行阻断认领时，管理员可携带
    // resolve_conflicts: 'rename' 把无法自动归并的 default 仓库行改名后按独立
    // 行迁移续办（防误合并条件保留，绝不合并进已按 ID 配对的目标行）。
    const renameConflicts = body.resolve_conflicts === 'rename';
    const result = claimLegacyDefaultWithAdminConfirmation(
      db,
      accountId,
      renameConflicts ? { renameConflicts: true } : {},
    );
    if (!result.ok) {
      if (result.code === 'LEGACY_CLAIM_CONFLICT') {
        res.status(409).json({
          error: 'Legacy default claim blocked by unmigrated default rows; resolve the listed conflicts (rename or remove the ambiguous default rows) and retry, or re-send with resolve_conflicts: "rename" to keep them as standalone renamed rows in the target partition',
          code: result.code,
          conflicts: result.conflicts ?? [],
        });
        return;
      }
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
