import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { decrypt } from '../services/crypto.js';
import { config } from '../config.js';
import { logger } from '../services/logger.js';
import { resolveAccountScope, claimLegacyDefaultIfNeeded } from '../db/accountScope.js';

const router = Router();

/**
 * POST /api/sync/auth
 *
 * Returns the credentials the browser needs to re-establish a session after a
 * tab/device switch. This route is mounted under the existing /api middleware,
 * so it is only reachable when the caller already proves knowledge of
 * `API_SECRET` (Bearer). It therefore only echoes data an authorized client is
 * already entitled to; an unauthenticated caller is rejected by authMiddleware.
 *
 * 多账号扩展（Issue #611）：支持可选请求体 `{ account_id }` 或请求头
 * `X-GitHub-Account-Id` 选择恢复哪个账号分区；响应在保持
 * `{ github_token }` 兼容字段的基础上额外返回 `active_account_id` 与
 * 后端已保存的全部账号列表 `accounts`，让全新浏览器一次性恢复所有账号。
 * (api_secret is intentionally NOT returned — the client must already hold it
 *  to authenticate, so echoing it would serve no purpose and invite misuse.)
 */
// Defence-in-depth: the response carries the decrypted GitHub PAT, so make it
// uncacheable at every layer even though helmet() already sets no-store globally.
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, no-cache, must-revalidate' };

interface AccountEntry {
  accountId: string;
  user: unknown;
  githubToken: string | null;
  addedAt: string | null;
  lastUsedAt: string | null;
}

function readAccountRows(db: ReturnType<typeof getDb>): AccountEntry[] {
  const rows = db.prepare('SELECT * FROM accounts ORDER BY last_used_at DESC').all() as Array<Record<string, unknown>>;
  const entries = rows.map((row) => {
    let githubToken: string | null = null;
    // 与 readScopedToken 相同的来源顺序：非 default 账号优先读
    // account_settings.github_token（多账号备份导入后凭据保存在该表），
    // 缺失再回退 accounts.github_token_encrypted。
    const accountId = String(row.account_id);
    const scopedRow = accountId !== 'default'
      ? db.prepare("SELECT value FROM account_settings WHERE account_id = ? AND key = 'github_token'")
          .get(accountId) as { value: string | null } | undefined
      : undefined;
    let encrypted: unknown = row.github_token_encrypted;
    if (scopedRow !== undefined) {
      if (!scopedRow.value) {
        // 记录存在但值为空 = 已被显式清空：绝不回退 accounts 旧凭据副本，
        // 否则已清空的 Token 会复活（与 proxy 的显式清空优先语义一致）。
        encrypted = null;
      } else if (typeof scopedRow.value === 'string') {
        encrypted = scopedRow.value;
      }
    }
    if (typeof encrypted === 'string' && encrypted) {
      try {
        githubToken = decrypt(encrypted, config.encryptionKey);
      } catch {
        logger.warn('authRestore', 'Failed to decrypt an account token; returning null for that account');
        githubToken = null;
      }
    }
    let user: unknown = null;
    if (typeof row.user_json === 'string' && row.user_json) {
      try { user = JSON.parse(row.user_json); } catch { user = null; }
    }
    return {
      accountId: String(row.account_id),
      user,
      githubToken,
      addedAt: typeof row.added_at === 'string' ? row.added_at : null,
      lastUsedAt: typeof row.last_used_at === 'string' ? row.last_used_at : null,
    };
  });

  // Issue #612 A18：已认领但缺少 accounts 元数据行的账号也要出现在恢复列表——
  // 查询时合并 account_settings 中持有可用凭据（github_token 非空）的非 default
  // 账号（与 readScopedToken 的凭据语义一致：定向恢复能取到，列表也应能列出）。
  // 显式清空 Token 的账号（记录存在但值为空）不据此合成条目——排除逻辑保留。
  const known = new Set(entries.map((entry) => entry.accountId));
  try {
    const scopedRows = db
      .prepare("SELECT account_id, value FROM account_settings WHERE key = 'github_token' AND account_id != 'default'")
      .all() as Array<{ account_id: string; value: string | null }>;
    for (const row of scopedRows) {
      const accountId = String(row.account_id);
      if (!accountId || !/^\d+$/.test(accountId) || known.has(accountId)) continue;
      if (!row.value) continue; // 显式清空：不合成恢复条目
      let githubToken: string | null = null;
      try {
        githubToken = decrypt(row.value, config.encryptionKey);
      } catch {
        logger.warn('authRestore', 'Failed to decrypt a credential-only account token; returning null for that account');
      }
      known.add(accountId);
      entries.push({
        accountId,
        user: null,
        githubToken,
        addedAt: null,
        lastUsedAt: null,
      });
    }
  } catch {
    // 轻量 stub 缺 account_settings 表时跳过合并
  }
  return entries;
}

/**
 * 解析恢复目标账号的 Token：
 * 1. account_settings.github_token（当前账号分区）；
 * 2. accounts.github_token_encrypted（账号元数据表）；
 * 3. 全局 settings.github_token —— 仅当目标账号为 'default'（旧版兼容回退）。
 *    显式/解析出的真实账号缺少自身凭据时返回 null，绝不回退可能属于
 *    其他账号的全局凭证（恢复脱敏备份后无账号 Token 是明确支持的状态）。
 */
function readScopedToken(db: ReturnType<typeof getDb>, accountId: string): string | null {
  const decryptOrNull = (value: string | null | undefined): string | null => {
    if (!value) return null;
    try {
      return decrypt(value, config.encryptionKey);
    } catch {
      logger.error('authRestore', 'Failed to decrypt GitHub token for auth restore');
      return null;
    }
  };

  if (accountId !== 'default') {
    const scoped = db.prepare("SELECT value FROM account_settings WHERE account_id = ? AND key = 'github_token'")
      .get(accountId) as { value: string | null } | undefined;
    if (scoped !== undefined) {
      // 记录存在即权威：为空表示显式清空，解密失败也返回 null，
      // 绝不回退 accounts 旧凭据副本（否则已清空的 Token 会复活）。
      return decryptOrNull(scoped.value);
    }

    const accountRow = db.prepare('SELECT github_token_encrypted FROM accounts WHERE account_id = ?')
      .get(accountId) as { github_token_encrypted: string | null } | undefined;
    const fromAccounts = decryptOrNull(accountRow?.github_token_encrypted ?? null);
    if (fromAccounts) return fromAccounts;

    // 真实账号没有自身凭据：返回 null（不回退全局，避免与其他账号凭证串号）。
    return null;
  }

  const tokenRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('github_token') as { value: string } | undefined;
  return decryptOrNull(tokenRow?.value ?? null);
}

router.post('/api/sync/auth', async (req, res) => {
  try {
    const db = getDb();
    const bodyAccountId = typeof (req.body as Record<string, unknown> | undefined)?.account_id === 'string'
      ? ((req.body as Record<string, unknown>).account_id as string).trim()
      : '';
    const headerAccountId = req.header('x-github-account-id')?.trim() ?? '';
    // Issue #612 A19：请求体 account_id 与请求头 x-github-account-id 按同一优先级
    // 解析出唯一最终账号——认领层（accountScopeMiddleware）以请求头为准，恢复层
    // 采用相同优先级收敛，两者不一致时绝不分别选择不同账号。
    const accountId = /^\d+$/.test(headerAccountId)
      ? headerAccountId
      : /^\d+$/.test(bodyAccountId)
        ? bodyAccountId
        : resolveAccountScope(req, db);

    // Issue #612 A19：认领与恢复两层都处理最终选定账号。请求头路径已由全局
    // 中间件认领（此处为幂等快速返回）；仅请求体指定账号（无请求头）时在此
    // 触发认领。失败不阻塞恢复（与中间件语义一致）。
    try {
      await claimLegacyDefaultIfNeeded(db, accountId);
    } catch (err) {
      logger.warn('authRestore', 'Legacy default claim attempt failed during auth restore', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const activeToken = readScopedToken(db, accountId);

    let accounts: AccountEntry[] = [];
    try {
      accounts = readAccountRows(db);
    } catch {
      // 旧库缺 accounts 表（尚未跑 v4 迁移）时降级为仅返回兼容字段。
      accounts = [];
    }

    res.set(NO_STORE_HEADERS).json({
      github_token: activeToken,
      active_account_id: accountId,
      accounts,
    });
  } catch (err) {
    logger.errorFromError('authRestore', 'POST /api/sync/auth error', err);
    res.status(500).json({ error: 'Failed to restore auth', code: 'AUTH_RESTORE_FAILED' });
  }
});

export default router;
