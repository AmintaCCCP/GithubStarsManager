import type Database from 'better-sqlite3';
import type { Request } from 'express';
import { decrypt } from '../services/crypto.js';
import { config } from '../config.js';
import { logger } from '../services/logger.js';
import { getDb } from './connection.js';

/**
 * 多账号数据隔离的分区解析（Issue #611）。
 *
 * - 请求头 `X-GitHub-Account-Id` 携带当前活跃账号（GitHub 数值 ID 字符串）；
 * - 未携带（旧版客户端 / 无头请求 / MCP）时回退读取全局 `settings.active_account_id`；
 * - 仍不存在则返回 'default'（与 v4 之前无租户概念的存量数据 100% 兼容）；
 * - 首个携带真实账号 ID 的请求会触发「存量 default 数据认领」流程
 *   （claimLegacyDefaultIfNeeded），该流程带 GitHub 身份校验，防止误认领。
 */

/** 账号专属（Per-Account）设置键：写入 account_settings，切换账号互不可见。 */
export const ACCOUNT_SCOPED_SETTING_KEYS: ReadonlySet<string> = new Set([
  'github_token',
  'customCategories',
  'categoryOrder',
  'hiddenDefaultCategoryIds',
  'defaultCategoryOverrides',
  'releaseSourceSettings',
  'categoryListIdMap',
  'syncMode',
  'syncModeConfigured',
]);

const ACCOUNT_ID_PATTERN = /^\d+$/;
const GITHUB_USER_API = 'https://api.github.com/user';
const CLAIMED_BY_KEY = 'legacy_default_claimed_by';
const LEGACY_OWNER_CACHE_KEY = 'legacy_default_owner_id';
const DEFAULT_SCOPE = 'default';

export interface AccountScopedRequest extends Request {
  /** 由 accountScopeMiddleware 解析并暂存的账号分区。 */
  accountScope?: string;
}

/** 从请求头提取合法的账号 ID；非法/缺失格式一律视为未传（防垃圾字符串污染分区名）。 */
export function extractRequestedAccountId(req: Request): string | null {
  const raw = req.header('x-github-account-id')?.trim() ?? req.header('X-GitHub-Account-Id')?.trim() ?? '';
  return raw && ACCOUNT_ID_PATTERN.test(raw) ? raw : null;
}

function readSetting(db: Database.Database, key: string): string | null {
  try {
    const row = db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(key) as { value: string | null } | undefined;
    const value = row?.value;
    return typeof value === 'string' && value.length > 0 ? value : null;
  } catch {
    // 单元测试的轻量 DB stub 可能没有 settings 表语义；按未配置处理。
    return null;
  }
}

/**
 * 同步解析当前请求的账号分区：请求头（合法数字）→ 全局 active_account_id → 'default'。
 * 路由处理器内部使用；认领副作用由 accountScopeMiddleware 异步完成。
 */
export function computeAccountScope(db: Database.Database, req?: Request): string {
  if (req) {
    const headerId = extractRequestedAccountId(req);
    if (headerId) return headerId;
    const stashed = (req as AccountScopedRequest).accountScope;
    if (stashed && ACCOUNT_ID_PATTERN.test(stashed)) return stashed;
  }
  const active = readSetting(db, 'active_account_id');
  if (active && ACCOUNT_ID_PATTERN.test(active)) return active;
  return DEFAULT_SCOPE;
}

/** 兼容入口：路由内调用（带请求上下文）。 */
export function resolveAccountScope(req: Request, db: Database.Database): string {
  return computeAccountScope(db, req);
}

/** 无请求上下文入口（MCP / 后台任务）：全局 active_account_id → 'default'。 */
export function resolveActiveAccountScope(db: Database.Database): string {
  return computeAccountScope(db);
}

function isLegacyClaimPending(db: Database.Database): boolean {
  return readSetting(db, CLAIMED_BY_KEY) === null;
}

/** 通过 GitHub /user API 解析 Token 真实归属的账号 id；成功结果缓存进 settings。 */
async function resolveLegacyDefaultOwner(db: Database.Database): Promise<string | null> {
  const cached = readSetting(db, LEGACY_OWNER_CACHE_KEY);
  if (cached && ACCOUNT_ID_PATTERN.test(cached)) return cached;

  const encrypted = readSetting(db, 'github_token');
  if (!encrypted) return null;
  let token: string;
  try {
    token = decrypt(encrypted, config.encryptionKey);
  } catch {
    logger.warn('db.accountScope', 'Failed to decrypt legacy github_token for default-claim identity check');
    return null;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    let ownerId: string | null = null;
    try {
      const res = await fetch(GITHUB_USER_API, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'GithubStarsManager-Backend',
        },
        signal: controller.signal,
      });
      if (res.ok) {
        const user = (await res.json()) as { id?: unknown };
        ownerId = typeof user.id === 'number' && Number.isInteger(user.id) && user.id > 0
          ? String(user.id)
          : null;
      } else {
        logger.warn('db.accountScope', 'GitHub /user identity check failed for default claim', { status: res.status });
      }
    } finally {
      clearTimeout(timeoutId);
    }
    if (ownerId) {
      try {
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(LEGACY_OWNER_CACHE_KEY, ownerId);
      } catch { /* cache write is best-effort */ }
    }
    return ownerId;
  } catch (err) {
    logger.warn('db.accountScope', 'Legacy default-claim identity check request failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * 存量 'default' 数据首次真实账号认领（Legacy Default Claim）。
 *
 * 仅当同时满足以下条件时才执行认领，否则 'default' 数据原地不动：
 * 1. settings 中尚未记录 legacy_default_claimed_by；
 * 2. 全局 settings.github_token 经 GitHub /user 校验出的真实归属 === 请求账号 ID。
 *
 * 认领在单个事务中完成：repositories / releases / categories 的 default 行
 * 迁移为请求账号 ID，账号级设置键复制进 account_settings，并写入
 * legacy_default_claimed_by 与 active_account_id。
 */
export async function claimLegacyDefaultIfNeeded(db: Database.Database, accountId: string): Promise<void> {
  if (!ACCOUNT_ID_PATTERN.test(accountId)) return;
  if (!isLegacyClaimPending(db)) return;

  const ownerId = await resolveLegacyDefaultOwner(db);
  if (!ownerId) return;
  if (ownerId !== accountId) {
    // 身份不符：绝不认领。'default' 存量数据原地保留，等待真正的归属账号登录。
    logger.info('db.accountScope', 'Skipping legacy default claim: identity mismatch', {
      legacyOwner: ownerId,
      requested: accountId,
    });
    return;
  }

  const claim = db.transaction(() => {
    const claimed = readSetting(db, CLAIMED_BY_KEY);
    if (claimed) return; // 并发请求下的二次确认

    const counts = {
      repositories: 0,
      releases: 0,
      categories: 0,
    };
    for (const table of ['repositories', 'releases', 'categories'] as const) {
      const defaultRow = db.prepare(`SELECT COUNT(*) as total FROM ${table} WHERE account_id = 'default'`).get() as { total: number } | undefined;
      const accountRow = db.prepare(`SELECT COUNT(*) as total FROM ${table} WHERE account_id = ?`).get(accountId) as { total: number } | undefined;
      if ((defaultRow?.total ?? 0) > 0 && (accountRow?.total ?? 0) === 0) {
        const result = db
          .prepare(`UPDATE ${table} SET account_id = ? WHERE account_id = 'default'`)
          .run(accountId);
        counts[table] = result.changes;
      }
    }
    for (const key of ACCOUNT_SCOPED_SETTING_KEYS) {
      const value = readSetting(db, key);
      if (value === null) continue;
      db.prepare('INSERT OR REPLACE INTO account_settings (account_id, key, value) VALUES (?, ?, ?)')
        .run(accountId, key, value);
    }
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(CLAIMED_BY_KEY, accountId);
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('active_account_id', accountId);
    return counts;
  });

  const claimed = claim();
  if (claimed) {
    logger.info('db.accountScope', 'Legacy default data claimed by first verified account', { accountId, ...claimed });
  }
}

/**
 * 全局中间件：对携带真实账号 ID 的请求尝试执行一次存量 default 数据认领。
 * 认领失败（网络/校验不可用）不阻塞请求；分区解析本身是纯同步逻辑。
 */
export function accountScopeMiddleware(req: Request, _res: import('express').Response, next: import('express').NextFunction): void {
  const requested = extractRequestedAccountId(req);
  if (!requested) {
    next();
    return;
  }
  void (async () => {
    try {
      await claimLegacyDefaultIfNeeded(getDb(), requested);
    } catch (err) {
      logger.warn('db.accountScope', 'Legacy default claim attempt failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      next();
    }
  })();
}
