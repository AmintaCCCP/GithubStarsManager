import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { decrypt } from '../services/crypto.js';
import { config } from '../config.js';
import { logger } from '../services/logger.js';
import {
  claimLegacyDefaultIfNeeded,
  getLegacyDefaultClaimedBy,
  hasInvalidAccountHeader,
  resolveWritableAccountScope,
  collectNonDefaultPartitionIds,
} from '../db/accountScope.js';

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
    // Issue #612 R12：token-only 凭据保存的占位身份（upsertAccountRow 写入的
    // 仅含 id 的 user_json）不能作为恢复条目的资料——客户端会因缺少 login 拒绝
    // 该条目，又因 user 非 null 跳过 PAT 身份回查，导致凭据已保存却永远无法
    // 出现在恢复列表。转换为 user: null，让客户端复用现有的 GitHub 身份回查。
    if (
      user !== null
      && typeof user === 'object'
      && !Array.isArray(user)
      && Object.keys(user as Record<string, unknown>).length === 1
      && 'id' in (user as Record<string, unknown>)
    ) {
      user = null;
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

  // Issue #612 R12：只有分区数据、还没有资料或分区凭据的账号（升级后首个带
  // 账号头的同步先于资料/凭据保存完成）也要出现在恢复候选中——否则恢复需要
  // 显式选择账号时（account_selection_required）登录页没有可选项，也无法进入
  // PAT 设置步骤。绝不把全局 PAT 分配给这些未验证的账号（githubToken 保持
  // null，由客户端走 PAT 设置 / 身份回查流程）。
  try {
    for (const partitionId of collectNonDefaultPartitionIds(db)) {
      if (!/^\d+$/.test(partitionId) || known.has(partitionId)) continue;
      known.add(partitionId);
      entries.push({
        accountId: partitionId,
        user: null,
        githubToken: null,
        addedAt: null,
        lastUsedAt: null,
      });
    }
  } catch {
    // 轻量 stub 缺分区表时跳过合并
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
    // Issue #612 R13（审计 63）：先拒绝格式无效的账号头（已发送但值为空白或
    // 非数字形态，如 `abc` / ''）再解析恢复目标——否则请求体中携带的 account_id
    // 会被选中并返回该账号的恢复结果，与分类/设置/代理等路由对同一无效头返回
    // 409 ACCOUNT_SCOPE_REQUIRED 的行为不一致。合法账号头优先、未发送账号头时
    // 才从请求体选择账号的行为保持不变。
    if (hasInvalidAccountHeader(req)) {
      res.status(409).json({
        error: 'X-GitHub-Account-Id must be a numeric account ID',
        code: 'ACCOUNT_SCOPE_REQUIRED',
      });
      return;
    }
    const bodyAccountId = typeof (req.body as Record<string, unknown> | undefined)?.account_id === 'string'
      ? ((req.body as Record<string, unknown>).account_id as string).trim()
      : '';
    const headerAccountId = req.header('x-github-account-id')?.trim() ?? '';
    // Issue #612 A19：请求体 account_id 与请求头 x-github-account-id 按同一优先级
    // 解析出唯一显式账号；无账号头且未提供 account_id 的旧客户端兼容恢复与全局活跃
    // 账号解析分开，无法安全确定目标账号时不返回其他账号的 PAT，要求显式选择账号。
    const explicitAccountId = /^\d+$/.test(headerAccountId)
      ? headerAccountId
      : /^\d+$/.test(bodyAccountId)
        ? bodyAccountId
        : null;

    let accountId: string | null = explicitAccountId;
    let accountSelectionRequired = false;

    if (!accountId) {
      const resolved = resolveWritableAccountScope(req, db);
      if (!resolved.ok) {
        accountSelectionRequired = true;
      } else if (resolved.accountId !== 'default') {
        const claimedBy = getLegacyDefaultClaimedBy(db);
        let hasGlobalToken = false;
        try {
          const row = db
            .prepare("SELECT value FROM settings WHERE key = 'github_token'")
            .get() as { value: string | null } | undefined;
          hasGlobalToken = typeof row?.value === 'string' && row.value.length > 0;
        } catch {
          hasGlobalToken = false;
        }
        // 未完成旧数据认领但库中仍存在全局 PAT 时，不能假设无头旧客户端属于当前唯一真实分区
        if (claimedBy !== resolved.accountId && hasGlobalToken) {
          accountSelectionRequired = true;
        } else {
          accountId = resolved.accountId;
        }
      } else {
        accountId = resolved.accountId;
      }
    }

    // Issue #612 A19：认领与恢复两层都处理最终选定账号。请求头路径已由全局
    // 中间件认领（此处为幂等快速返回）；仅请求体指定账号（无请求头）时在此
    // 触发认领。失败不阻塞恢复（与中间件语义一致）。
    if (accountId) {
      try {
        await claimLegacyDefaultIfNeeded(db, accountId);
      } catch (err) {
        logger.warn('authRestore', 'Legacy default claim attempt failed during auth restore', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const activeToken = accountId ? readScopedToken(db, accountId) : null;

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
      ...(accountSelectionRequired ? { account_selection_required: true } : {}),
      accounts,
    });
  } catch (err) {
    logger.errorFromError('authRestore', 'POST /api/sync/auth error', err);
    res.status(500).json({ error: 'Failed to restore auth', code: 'AUTH_RESTORE_FAILED' });
  }
});

export default router;
