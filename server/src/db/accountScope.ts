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
 *   （claimLegacyDefaultIfNeeded），该流程带 GitHub 身份校验，防止误认领；
 *   归属一经校验确立即冻结（legacy_default_owner_id），不随全局 Token 轮换改变。
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

/** 读取存量 default 数据的认领账号（未认领或标记非法时为 null）。 */
export function getLegacyDefaultClaimedBy(db: Database.Database): string | null {
  const claimed = readSetting(db, CLAIMED_BY_KEY);
  return claimed && ACCOUNT_ID_PATTERN.test(claimed) ? claimed : null;
}

interface LegacyOwnerResolution {
  ownerId: string | null;
  /**
   * 归属验证时所绑定的加密全局 Token；null 表示无法证明当前全局 Token 与
   * 已验证归属同源（如旧版裸 id 缓存）。认领事务据此决定是否把全局
   * github_token 复制进账号分区。
   */
  verifiedToken: string | null;
}

/**
 * 解析存量 default 数据的「已验证所有者」——与可替换的全局 Token 解耦。
 *
 * 归属一经 GitHub /user 校验确立（无论请求者是否匹配），即持久化到
 * settings.legacy_default_owner_id（绑定校验时的加密 Token）；此后认领判定
 * 只认这份已验证所有者，绝不随全局 Token 轮换/换绑重新判定——防止无头请求
 * 把全局 Token 换成其他账号后，把原属旧账号的存量数据错误迁移给新账号。
 * 同一账号轮换 Token 不影响其认领资格。
 * 从未成功验证过归属（校验网络失败 / 无 Token / 解密失败）时返回 null：
 * 存量数据保持不可认领，直到真正的归属账号登录后校验成功再确立归属。
 */
async function resolveLegacyDefaultOwner(db: Database.Database): Promise<LegacyOwnerResolution> {
  const cached = readSetting(db, LEGACY_OWNER_CACHE_KEY);
  if (cached) {
    // 已验证归属已持久化：直接采用，绝不依据当前全局 Token 重新判定。
    // 旧版缓存为裸账号 id（无 Token 绑定）：归属可信，仅缺 Token 绑定。
    if (ACCOUNT_ID_PATTERN.test(cached)) {
      return { ownerId: cached, verifiedToken: null };
    }
    try {
      const parsed = JSON.parse(cached) as { ownerId?: unknown; token?: unknown };
      if (typeof parsed.ownerId === 'string' && ACCOUNT_ID_PATTERN.test(parsed.ownerId)) {
        return {
          ownerId: parsed.ownerId,
          verifiedToken: typeof parsed.token === 'string' && parsed.token ? parsed.token : null,
        };
      }
    } catch {
      // 无法解析的脏缓存：视为未验证，走重新校验并覆写。
    }
  }

  const encrypted = readSetting(db, 'github_token');
  if (!encrypted) return { ownerId: null, verifiedToken: null };
  let token: string;
  try {
    token = decrypt(encrypted, config.encryptionKey);
  } catch {
    logger.warn('db.accountScope', 'Failed to decrypt legacy github_token for default-claim identity check');
    return { ownerId: null, verifiedToken: null };
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
        // 首次成功校验即冻结归属（同时记录被校验的加密 Token）：此后认领判定
        // 只认这份已验证所有者，不再随 Token 轮换重新判定，且供后续请求免网络复用。
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
          .run(LEGACY_OWNER_CACHE_KEY, JSON.stringify({ ownerId, token: encrypted }));
      } catch { /* cache write is best-effort */ }
    }
    return { ownerId, verifiedToken: encrypted };
  } catch (err) {
    logger.warn('db.accountScope', 'Legacy default-claim identity check request failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    // 校验失败 = 归属未确立：不冻结、不认领，等待真正的归属账号登录后再校验。
    return { ownerId: null, verifiedToken: null };
  }
}

/**
 * 存量 'default' 数据首次真实账号认领（Legacy Default Claim）。
 *
 * 仅当同时满足以下条件时才执行认领，否则 'default' 数据原地不动：
 * 1. settings 中尚未记录 legacy_default_claimed_by；
 * 2. 存量数据的「已验证所有者」（resolveLegacyDefaultOwner 冻结的身份，一经
 *    校验确立便不再随 Token 轮换改变）=== 请求账号 ID。
 *
 * 认领在单个事务中完成：repositories / releases / categories 的 default 行
 * 「逐条」迁移为请求账号 ID（目标分区已有数据时按记录合并而非整表跳过），
 * 账号级设置键以「只补缺失」方式复制进 account_settings（不覆盖账号已保存的
 * 新值；其中全局 github_token 仅当仍是当初通过身份校验的那份加密 Token 时才
 * 复制，Token 已换绑其他账号或同账号轮换时一律跳过，绝不把来源无法证明的
 * 凭据迁移进账号分区），最后写入 legacy_default_claimed_by 与 active_account_id。
 * 若仍有 default 残留行（意外冲突），整体回滚并保持可重试状态，绝不写认领标记。
 */
export async function claimLegacyDefaultIfNeeded(db: Database.Database, accountId: string): Promise<void> {
  if (!ACCOUNT_ID_PATTERN.test(accountId)) return;
  if (!isLegacyClaimPending(db)) return;

  const resolution = await resolveLegacyDefaultOwner(db);
  if (!resolution.ownerId) return;
  if (resolution.ownerId !== accountId) {
    // 身份不符：绝不认领。'default' 存量数据原地保留，等待已验证的归属账号登录；
    // 全局 Token 被换成其他账号不得改变已验证的归属。
    logger.info('db.accountScope', 'Skipping legacy default claim: verified owner does not match requester', {
      legacyOwner: resolution.ownerId,
      requested: accountId,
    });
    return;
  }

  const verifiedToken = resolution.verifiedToken;
  const claim = db.transaction(() => {
    const claimed = readSetting(db, CLAIMED_BY_KEY);
    if (claimed) return null; // 并发请求下的二次确认

    const counts = {
      repositories: 0,
      releases: 0,
      categories: 0,
    };

    // ── repositories：先迁移无冲突行；再按记录合并冲突行（同 id / 同 full_name），
    // 目标分区已有数据时绝不整表跳过，避免存量行永久滞留 default。──
    counts.repositories = db.prepare(
      "UPDATE OR IGNORE repositories SET account_id = ? WHERE account_id = 'default'"
    ).run(accountId).changes;

    // 同 id 冲突：目标行（账号自己的同步结果）保留，把 default 行独有的 AI 成果与
    // 用户自定义数据按「只补缺失」合并进目标行，然后删除 default 行。
    db.prepare(`
      UPDATE repositories SET
        ai_summary = CASE WHEN ai_summary IS NULL OR ai_summary = '' THEN COALESCE(
          (SELECT d.ai_summary FROM repositories d WHERE d.account_id = 'default' AND d.id = repositories.id), ai_summary) ELSE ai_summary END,
        ai_tags = CASE WHEN ai_tags IS NULL OR ai_tags = '[]' THEN COALESCE(
          (SELECT d.ai_tags FROM repositories d WHERE d.account_id = 'default' AND d.id = repositories.id), ai_tags) ELSE ai_tags END,
        ai_platforms = CASE WHEN ai_platforms IS NULL OR ai_platforms = '[]' THEN COALESCE(
          (SELECT d.ai_platforms FROM repositories d WHERE d.account_id = 'default' AND d.id = repositories.id), ai_platforms) ELSE ai_platforms END,
        analyzed_at = CASE WHEN analyzed_at IS NULL OR analyzed_at = '' THEN COALESCE(
          (SELECT d.analyzed_at FROM repositories d WHERE d.account_id = 'default' AND d.id = repositories.id), analyzed_at) ELSE analyzed_at END,
        custom_description = COALESCE(custom_description, (SELECT d.custom_description FROM repositories d WHERE d.account_id = 'default' AND d.id = repositories.id)),
        custom_tags = COALESCE(custom_tags, (SELECT d.custom_tags FROM repositories d WHERE d.account_id = 'default' AND d.id = repositories.id)),
        custom_category = COALESCE(custom_category, (SELECT d.custom_category FROM repositories d WHERE d.account_id = 'default' AND d.id = repositories.id)),
        category_locked = CASE WHEN category_locked = 1 THEN 1 ELSE COALESCE(
          (SELECT d.category_locked FROM repositories d WHERE d.account_id = 'default' AND d.id = repositories.id), category_locked) END,
        description_display = COALESCE(description_display, (SELECT d.description_display FROM repositories d WHERE d.account_id = 'default' AND d.id = repositories.id)),
        tags_display = COALESCE(tags_display, (SELECT d.tags_display FROM repositories d WHERE d.account_id = 'default' AND d.id = repositories.id)),
        last_edited = COALESCE(last_edited, (SELECT d.last_edited FROM repositories d WHERE d.account_id = 'default' AND d.id = repositories.id)),
        starred_at = COALESCE(starred_at, (SELECT d.starred_at FROM repositories d WHERE d.account_id = 'default' AND d.id = repositories.id)),
        subscribed_to_releases = CASE WHEN subscribed_to_releases = 1 THEN 1 ELSE COALESCE(
          (SELECT d.subscribed_to_releases FROM repositories d WHERE d.account_id = 'default' AND d.id = repositories.id), subscribed_to_releases) END
      WHERE account_id = ? AND EXISTS (
        SELECT 1 FROM repositories d WHERE d.account_id = 'default' AND d.id = repositories.id
      )
    `).run(accountId);
    db.prepare(`
      DELETE FROM repositories WHERE account_id = 'default' AND EXISTS (
        SELECT 1 FROM repositories t WHERE t.account_id = ? AND t.id = repositories.id
      )
    `).run(accountId);

    // 同 full_name 异 id 冲突（仓库删除后重建等）：同样补入后删除。
    db.prepare(`
      UPDATE repositories SET
        ai_summary = CASE WHEN ai_summary IS NULL OR ai_summary = '' THEN COALESCE(
          (SELECT d.ai_summary FROM repositories d WHERE d.account_id = 'default' AND d.full_name = repositories.full_name), ai_summary) ELSE ai_summary END,
        ai_tags = CASE WHEN ai_tags IS NULL OR ai_tags = '[]' THEN COALESCE(
          (SELECT d.ai_tags FROM repositories d WHERE d.account_id = 'default' AND d.full_name = repositories.full_name), ai_tags) ELSE ai_tags END,
        ai_platforms = CASE WHEN ai_platforms IS NULL OR ai_platforms = '[]' THEN COALESCE(
          (SELECT d.ai_platforms FROM repositories d WHERE d.account_id = 'default' AND d.full_name = repositories.full_name), ai_platforms) ELSE ai_platforms END,
        analyzed_at = CASE WHEN analyzed_at IS NULL OR analyzed_at = '' THEN COALESCE(
          (SELECT d.analyzed_at FROM repositories d WHERE d.account_id = 'default' AND d.full_name = repositories.full_name), analyzed_at) ELSE analyzed_at END,
        custom_description = COALESCE(custom_description, (SELECT d.custom_description FROM repositories d WHERE d.account_id = 'default' AND d.full_name = repositories.full_name)),
        custom_tags = COALESCE(custom_tags, (SELECT d.custom_tags FROM repositories d WHERE d.account_id = 'default' AND d.full_name = repositories.full_name)),
        custom_category = COALESCE(custom_category, (SELECT d.custom_category FROM repositories d WHERE d.account_id = 'default' AND d.full_name = repositories.full_name)),
        category_locked = CASE WHEN category_locked = 1 THEN 1 ELSE COALESCE(
          (SELECT d.category_locked FROM repositories d WHERE d.account_id = 'default' AND d.full_name = repositories.full_name), category_locked) END,
        description_display = COALESCE(description_display, (SELECT d.description_display FROM repositories d WHERE d.account_id = 'default' AND d.full_name = repositories.full_name)),
        tags_display = COALESCE(tags_display, (SELECT d.tags_display FROM repositories d WHERE d.account_id = 'default' AND d.full_name = repositories.full_name)),
        last_edited = COALESCE(last_edited, (SELECT d.last_edited FROM repositories d WHERE d.account_id = 'default' AND d.full_name = repositories.full_name)),
        starred_at = COALESCE(starred_at, (SELECT d.starred_at FROM repositories d WHERE d.account_id = 'default' AND d.full_name = repositories.full_name)),
        subscribed_to_releases = CASE WHEN subscribed_to_releases = 1 THEN 1 ELSE COALESCE(
          (SELECT d.subscribed_to_releases FROM repositories d WHERE d.account_id = 'default' AND d.full_name = repositories.full_name), subscribed_to_releases) END
      WHERE account_id = ? AND EXISTS (
        SELECT 1 FROM repositories d WHERE d.account_id = 'default' AND d.full_name = repositories.full_name
      )
    `).run(accountId);
    db.prepare(`
      DELETE FROM repositories WHERE account_id = 'default' AND EXISTS (
        SELECT 1 FROM repositories t WHERE t.account_id = ? AND t.full_name = repositories.full_name
      )
    `).run(accountId);

    // ── releases：同 id 冲突时合并已读状态（并集），其余行直接迁移。──
    counts.releases = db.prepare(
      "UPDATE OR IGNORE releases SET account_id = ? WHERE account_id = 'default'"
    ).run(accountId).changes;
    db.prepare(`
      UPDATE releases SET
        is_read = CASE WHEN is_read = 1 THEN 1 ELSE COALESCE(
          (SELECT d.is_read FROM releases d WHERE d.account_id = 'default' AND d.id = releases.id), is_read) END
      WHERE account_id = ? AND EXISTS (
        SELECT 1 FROM releases d WHERE d.account_id = 'default' AND d.id = releases.id
      )
    `).run(accountId);
    db.prepare(`
      DELETE FROM releases WHERE account_id = 'default' AND EXISTS (
        SELECT 1 FROM releases t WHERE t.account_id = ? AND t.id = releases.id
      )
    `).run(accountId);

    // ── categories：同 id 冲突时补入目标缺失的分类字段，其余行直接迁移。──
    counts.categories = db.prepare(
      "UPDATE OR IGNORE categories SET account_id = ? WHERE account_id = 'default'"
    ).run(accountId).changes;
    db.prepare(`
      UPDATE categories SET
        keywords = COALESCE(keywords, (SELECT d.keywords FROM categories d WHERE d.account_id = 'default' AND d.id = categories.id)),
        description = COALESCE(description, (SELECT d.description FROM categories d WHERE d.account_id = 'default' AND d.id = categories.id)),
        color = COALESCE(color, (SELECT d.color FROM categories d WHERE d.account_id = 'default' AND d.id = categories.id)),
        sort_order = COALESCE(sort_order, (SELECT d.sort_order FROM categories d WHERE d.account_id = 'default' AND d.id = categories.id))
      WHERE account_id = ? AND EXISTS (
        SELECT 1 FROM categories d WHERE d.account_id = 'default' AND d.id = categories.id
      )
    `).run(accountId);
    db.prepare(`
      DELETE FROM categories WHERE account_id = 'default' AND EXISTS (
        SELECT 1 FROM categories t WHERE t.account_id = ? AND t.id = categories.id
      )
    `).run(accountId);

    // 迁移完整性校验：仍有 default 残留行（意外冲突）时整体回滚，保留可重试状态；
    // 绝不在迁移未完成时写入 legacy_default_claimed_by。
    let leftover = 0;
    for (const table of ['repositories', 'releases', 'categories'] as const) {
      const row = db.prepare(`SELECT COUNT(*) as total FROM ${table} WHERE account_id = 'default'`).get() as { total: number };
      leftover += row.total;
    }
    if (leftover > 0) {
      logger.warn('db.accountScope', 'Legacy default claim aborted: unmigrated default rows remain', { leftover });
      throw new Error('legacy default claim incomplete');
    }

    for (const key of ACCOUNT_SCOPED_SETTING_KEYS) {
      const value = readSetting(db, key);
      if (value === null) continue;
      // 只补充目标账号缺失的设置：账号已保存的新值（如认领前先写入的
      // customCategories / github_token）绝不被全局存量值覆盖。
      if (key === 'github_token') {
        // 全局 Token 与存量归属可能已脱钩（其他账号换绑 / 同账号轮换）：
        // 仅当它仍是当初通过身份校验的那份加密 Token 时才复制，绝不把
        // 来源无法证明的凭据迁移进认领账号的分区（宁可缺失，不可错配）。
        if (!verifiedToken || readSetting(db, 'github_token') !== verifiedToken) continue;
      }
      db.prepare('INSERT OR IGNORE INTO account_settings (account_id, key, value) VALUES (?, ?, ?)')
        .run(accountId, key, value);
    }
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(CLAIMED_BY_KEY, accountId);
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('active_account_id', accountId);
    return counts;
  });

  let claimed: { repositories: number; releases: number; categories: number } | null = null;
  try {
    claimed = claim();
  } catch (err) {
    // 事务已回滚：保留 default 数据与可重试状态，本次请求照常继续。
    logger.warn('db.accountScope', 'Legacy default claim transaction rolled back', {
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }
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
