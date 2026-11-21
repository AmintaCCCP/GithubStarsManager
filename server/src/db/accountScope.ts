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
  // Issue #612 A21：跨账号 AI 成果共享开关（默认 false，zod 校验布尔值，
  // 存储为 '1'/'0'）。写入分析结果时据此在仓库记录上持久化 ai_shared 标记。
  'ai_result_sharing_enabled',
]);

const ACCOUNT_ID_PATTERN = /^\d+$/;
const GITHUB_USER_API = 'https://api.github.com/user';
const CLAIMED_BY_KEY = 'legacy_default_claimed_by';
const LEGACY_OWNER_CACHE_KEY = 'legacy_default_owner_id';
const DEFAULT_SCOPE = 'default';

/**
 * legacy 认领时把 default 行合并进目标账号行的列规则（只补缺失，绝不覆盖目标）。
 * 同 id 与同 full_name 两种冲突必须共用同一份清单：过去是两段逐列复制的 SQL，
 * 新增合并列时漏改其中一段，该列就会在「仓库删除后以新 id 重建」的 full_name
 * 冲突路径被静默丢弃。
 */
const LEGACY_REPOSITORY_MERGE_COLUMNS: ReadonlyArray<{
  column: string;
  expression: (source: string) => string;
}> = [
  {
    column: 'ai_summary',
    expression: (source) => `CASE WHEN ai_summary IS NULL OR ai_summary = '' THEN COALESCE(${source}, ai_summary) ELSE ai_summary END`,
  },
  {
    // Issue #612 审计（R13）：从 default 补入 ai_summary 的同一事务内必须同步
    // 设置 ai_summary_shared——目标行在空摘要上的授权位本无实际效果（捐赠查询
    // 要求字段非空），补入他人的总结后该位却会生效，其他账号的回填可能因此
    // 收到未经授权共享的 default 摘要。与 repositories.ts 回填路径「被回填字段
    // 的共享标记清零」语义一致：清零而非沿用，绝不继承空字段上的旧授权位；
    // 目标摘要非空（未补入）时保留现有标记。ai_tags / ai_platforms 同理。
    column: 'ai_summary_shared',
    expression: () => `CASE WHEN ai_summary IS NULL OR ai_summary = '' THEN 0 ELSE ai_summary_shared END`,
  },
  {
    column: 'ai_tags',
    expression: (source) => `CASE WHEN ai_tags IS NULL OR ai_tags = '[]' THEN COALESCE(${source}, ai_tags) ELSE ai_tags END`,
  },
  {
    column: 'ai_tags_shared',
    expression: () => `CASE WHEN ai_tags IS NULL OR ai_tags = '[]' THEN 0 ELSE ai_tags_shared END`,
  },
  {
    column: 'ai_platforms',
    expression: (source) => `CASE WHEN ai_platforms IS NULL OR ai_platforms = '[]' THEN COALESCE(${source}, ai_platforms) ELSE ai_platforms END`,
  },
  {
    column: 'ai_platforms_shared',
    expression: () => `CASE WHEN ai_platforms IS NULL OR ai_platforms = '[]' THEN 0 ELSE ai_platforms_shared END`,
  },
  {
    column: 'analyzed_at',
    expression: (source) => `CASE WHEN analyzed_at IS NULL OR analyzed_at = '' THEN COALESCE(${source}, analyzed_at) ELSE analyzed_at END`,
  },
  { column: 'custom_description', expression: (source) => `COALESCE(custom_description, ${source})` },
  {
    column: 'custom_tags',
    // Issue #612 R12：写入路由对缺省 custom_tags 落 '[]'（与 NULL 同义的「未设置」
    // 占位）。合并规则把目标的 '[]' 视为未设置：旧行的自定义标签不因目标的空数组
    // 占位而丢失（与 ai_tags 的合并语义一致）。「未提供」与「显式清空」在快照
    // 通道无法区分，统一按未设置处理。
    expression: (source) => `CASE WHEN custom_tags IS NULL OR custom_tags = '[]' THEN COALESCE(${source}, custom_tags) ELSE custom_tags END`,
  },
  { column: 'custom_category', expression: (source) => `COALESCE(custom_category, ${source})` },
  {
    column: 'category_locked',
    expression: (source) => `CASE WHEN category_locked = 1 THEN 1 ELSE COALESCE(${source}, category_locked) END`,
  },
  { column: 'description_display', expression: (source) => `COALESCE(description_display, ${source})` },
  { column: 'tags_display', expression: (source) => `COALESCE(tags_display, ${source})` },
  { column: 'last_edited', expression: (source) => `COALESCE(last_edited, ${source})` },
  { column: 'starred_at', expression: (source) => `COALESCE(starred_at, ${source})` },
  {
    column: 'subscribed_to_releases',
    expression: (source) => `CASE WHEN subscribed_to_releases = 1 THEN 1 ELSE COALESCE(${source}, subscribed_to_releases) END`,
  },
];

function buildLegacyRepositoryMergeSql(matchColumn: 'id' | 'full_name'): string {
  const source = (column: string) =>
    `(SELECT d.${column} FROM repositories d WHERE d.account_id = 'default' AND d.${matchColumn} = repositories.${matchColumn})`;
  const assignments = LEGACY_REPOSITORY_MERGE_COLUMNS
    .map(({ column, expression }) => `${column} = ${expression(source(column))}`)
    .join(',\n        ');
  // Issue #612 A16：同名兼容归并（full_name 路径）必须排除「已按 ID 配对」的
  // 目标行——否则已被 ID 配对吸收过一次的目标行会再吸收另一条仅同名的历史行。
  const exclusion = matchColumn === 'full_name'
    ? ' AND repositories.id NOT IN (SELECT id FROM temp.legacy_claim_id_matched)'
    : '';
  return `
      UPDATE repositories SET
        ${assignments}
      WHERE account_id = ? AND EXISTS (
        SELECT 1 FROM repositories d WHERE d.account_id = 'default' AND d.${matchColumn} = repositories.${matchColumn}
      )${exclusion}
    `;
}

function buildLegacyRepositoryDeleteSql(matchColumn: 'id' | 'full_name'): string {
  // 同名删除同样以 ID 配对结果为排除条件：对应关系歧义的旧行保留在 default
  // （由迁移完整性校验整体回滚、等待处理），绝不被已配对的目标行静默吸收删除。
  const exclusion = matchColumn === 'full_name'
    ? ' AND t.id NOT IN (SELECT id FROM temp.legacy_claim_id_matched)'
    : '';
  return `
      DELETE FROM repositories WHERE account_id = 'default' AND EXISTS (
        SELECT 1 FROM repositories t WHERE t.account_id = ? AND t.${matchColumn} = repositories.${matchColumn}${exclusion}
      )
    `;
}

/**
 * 只存于全局 settings 的内部账号状态键（活跃账号 / 认领标记 / 已验证所有者）。
 * 绝不随 /api/sync 导出/导入迁移：legacy_default_owner_id 的 JSON 还绑定全局
 * Token 密文（github_token 本身在导出时已脱敏），且这些键描述的是「本服务器
 * 自身」的认领与活跃状态，随备份迁移会覆盖导入方的既有状态。导入侧同样跳过，
 * 以兼容已生成、内含这些键的旧备份。
 */
export const INTERNAL_SETTING_KEYS: ReadonlySet<string> = new Set([
  'active_account_id',
  CLAIMED_BY_KEY,
  LEGACY_OWNER_CACHE_KEY,
  'legacy_default_github_token',
]);

/**
 * 账号请求头的三态解析（Issue #612 审计：区分缺失 / 有效 / 无效）。
 * - absent：请求头未发送——旧客户端回退规则仅在此状态启用；
 * - valid：合法数字 ID 形态；
 * - invalid：已发送但值为空白或非数字形态。空白值不再与缺失混同：显式发送
 *   的空头部同样判为无效，绝不回退到可变的活跃账号 / default 分区。
 *
 * 注：Express 的头部读取大小写不敏感，`x-github-account-id` 与
 * `X-GitHub-Account-Id` 是同一个头。
 */
export type AccountHeaderResolution =
  | { state: 'absent' }
  | { state: 'valid'; accountId: string }
  | { state: 'invalid' };

function readAccountHeader(req: Request): AccountHeaderResolution {
  const rawHeader = req.header('x-github-account-id');
  if (rawHeader === undefined) return { state: 'absent' };
  const trimmed = rawHeader.trim();
  if (trimmed && ACCOUNT_ID_PATTERN.test(trimmed)) return { state: 'valid', accountId: trimmed };
  return { state: 'invalid' };
}

/** 从请求头提取合法的账号 ID；缺失/空白/非法格式一律返回 null（防垃圾字符串污染分区名）。 */
export function extractRequestedAccountId(req: Request): string | null {
  const header = readAccountHeader(req);
  return header.state === 'valid' ? header.accountId : null;
}

/**
 * Issue #612 R2-A3（审计修订）：请求是否携带了无效的账号头（已发送但值为空白
 * 或非数字形态，如 `abc` / `''`）。这类请求与「真正无头请求」必须区分处理：
 * 解析写入范围时直接拒绝，绝不回退到可变的活跃账号 / default 分区。
 */
export function hasInvalidAccountHeader(req: Request): boolean {
  return readAccountHeader(req).state === 'invalid';
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

/**
 * 收集所有非 'default' 分区的账号 ID（覆盖 accounts / repositories / releases /
 * categories / account_settings）。逐表查询以兼容单元测试的轻量 DB stub。
 * 导出供恢复候选（authRestore）等需要枚举分区归属的场景使用。
 */
export function collectNonDefaultPartitionIds(db: Database.Database): Set<string> {
  const ids = new Set<string>();
  const queries = [
    "SELECT account_id FROM accounts WHERE account_id != 'default'",
    "SELECT DISTINCT account_id FROM repositories WHERE account_id != 'default'",
    "SELECT DISTINCT account_id FROM releases WHERE account_id != 'default'",
    "SELECT DISTINCT account_id FROM categories WHERE account_id != 'default'",
    "SELECT DISTINCT account_id FROM account_settings WHERE account_id != 'default'",
  ];
  for (const sql of queries) {
    try {
      const rows = db.prepare(sql).all() as Array<{ account_id: string | null }>;
      for (const row of rows) {
        if (typeof row.account_id === 'string' && row.account_id && row.account_id !== DEFAULT_SCOPE) {
          ids.add(row.account_id);
        }
      }
    } catch {
      // 轻量 stub 缺表时跳过该表，不影响其余表的统计。
    }
  }
  return ids;
}

/**
 * 无账号头的写入解析：显式账号头直接放行；无头请求仅在能唯一确定目标分区时
 * 返回 `{ ok: true, accountId }`（唯一真实分区 / 活跃账号 / default），
 * 多分区共存或活跃账号与唯一分区冲突时返回 `{ ok: false }`。
 */
export function resolveWritableAccountScope(
  req: Request,
  db: Database.Database,
): { ok: true; accountId: string } | { ok: false } {
  const headerId = extractRequestedAccountId(req);
  if (headerId) return { ok: true, accountId: headerId };
  // Issue #612 R2-A3：显式携带但格式无效的账号头（如 `abc`）绝不当作无头请求
  // 回退到活跃账号分区——回退会把身份不明的写入路由到错误分区。
  if (hasInvalidAccountHeader(req)) return { ok: false };

  const partitionIds = collectNonDefaultPartitionIds(db);
  if (partitionIds.size > 1) return { ok: false };

  const active = readSetting(db, 'active_account_id');
  const validActive = active && ACCOUNT_ID_PATTERN.test(active) ? active : null;
  if (partitionIds.size === 1) {
    const sole = partitionIds.values().next().value as string;
    if (validActive && validActive !== sole) return { ok: false };
    // Issue #612 A15/A20：唯一真实分区不能证明无头请求的归属——
    // ① default 分区仍有待认领数据时，无头请求可能属于存量 default 数据
    //   （无头 GET 读 default），路由到唯一真实分区会造成 GET/PUT 分区错配，
    //   isFullSync 会误删另一侧的数据；
    // ② 无有效活跃账号时，无头 GET 同样读 default，而唯一分区可能来自导入
    //   等非认领路径，快照归属无法确认。
    // 两种情况都必须要求显式账号头。default 数据已完成认领（claimed_by 已写）
    // 且确实仅剩一个分区时保留兼容路径。
    if (hasPendingDefaultPartitionData(db)) return { ok: false };
    if (isLegacyClaimPending(db) && !validActive) return { ok: false };
    // Issue #612 R12：升级库残留的旧全局凭据（github_token / legacy 快照）证明存在
    // 身份未知的旧数据所有者——唯一真实分区只有在其本身就是已确认的旧数据所有者
    // （legacy_default_claimed_by）时才可承接无头写入。否则升级前 A 的全局 PAT +
    // 后登录的 B（唯一分区 / 活跃账号）会让 A 的旧客户端无头全量快照写进 B 分区
    // 并按 isFullSync 误删 B 的数据。纯 default 库（无真实分区）与已验证认领者的
    // 兼容路径保持不变。
    if (hasLegacyGlobalCredential(db) && getLegacyDefaultClaimedBy(db) !== sole) {
      return { ok: false };
    }
    return { ok: true, accountId: sole };
  }
  return { ok: true, accountId: validActive ?? DEFAULT_SCOPE };
}

/**
 * 无账号头的全量写入是否可安全落到解析出的分区（Issue #611 审计修复）。
 *
 * 无头请求（旧版客户端）无法证明自身身份：多账号分区共存时，回退到全局
 * 可变的 active_account_id 会把 A 的快照写进 B 分区，并以 isFullSync 物理
 * 删除 B 分区中不在 A 快照里的数据。只有 default 分区、已验证的 legacy
 * 归属账号、或单账号部署保持旧行为；其余情况必须拒绝破坏性全量写入。
 */
export function isHeaderlessFullSyncSafe(db: Database.Database, req: Request): boolean {
  return resolveWritableAccountScope(req, db).ok;
}

/**
 * 多账号分区共存时，无账号头请求无法证明目标分区（回退到可变的全局
 * active_account_id 可能命中其他账号）。显式账号头永远不歧义。
 */
export function hasAmbiguousAccountScope(db: Database.Database, req: Request): boolean {
  return !resolveWritableAccountScope(req, db).ok;
}

/**
 * 在无头客户端覆写全局 settings.github_token 之前固化存量归属凭据：
 * 若库中已有 default 分区数据且尚未记录 legacy_default_github_token，
 * 则保存覆写前的全局 Token（或空哨兵），防止新写入的 Token 冒充存量数据所有者。
 */
export function snapshotLegacyDefaultTokenBeforeOverwrite(db: Database.Database): void {
  try {
    const existingSnapshot = db
      .prepare("SELECT value FROM settings WHERE key = 'legacy_default_github_token'")
      .get() as { value: string | null } | undefined;
    if (existingSnapshot !== undefined) return;
    if (!hasDefaultPartitionRows(db) && !hasLegacyGlobalAccountSettings(db)) return;
    const currentGlobal = readSetting(db, 'github_token') ?? '';
    db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('legacy_default_github_token', ?)")
      .run(currentGlobal);
  } catch {
    // 轻量 stub 缺表时忽略
  }
}

function isLegacyClaimPending(db: Database.Database): boolean {
  return readSetting(db, CLAIMED_BY_KEY) === null;
}

/** 读取存量 default 数据的认领账号（未认领或标记非法时为 null）。 */
export function getLegacyDefaultClaimedBy(db: Database.Database): string | null {
  const claimed = readSetting(db, CLAIMED_BY_KEY);
  return claimed && ACCOUNT_ID_PATTERN.test(claimed) ? claimed : null;
}

/**
 * 认领时通过 GitHub 身份校验的那份全局 Token 密文。
 *
 * 认领标记只证明「存量数据归属」，不证明当前全局 Token 仍属于该账号：
 * 调用方用它校验全局凭据未被换绑后才可复用。
 */
export function getLegacyDefaultVerifiedToken(db: Database.Database): string | null {
  const cached = readSetting(db, LEGACY_OWNER_CACHE_KEY);
  if (!cached) return null;
  if (ACCOUNT_ID_PATTERN.test(cached)) return null; // 旧版裸 id 缓存没有绑定 Token
  try {
    const parsed = JSON.parse(cached) as { token?: unknown };
    return typeof parsed.token === 'string' && parsed.token ? parsed.token : null;
  } catch {
    return null;
  }
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
 * 失败负缓存 TTL：身份校验失败（网络错误 / 超时 / 401 / 无效 Token）后的窗口期内，
 * 带账号头的请求不再重复发起 /user 校验——middleware 对每个请求同步等待校验完成，
 * 失败若不被短期记忆，网络不可用时每个请求都会被拖住最多 8s。负缓存只针对
 * 「校验失败」；成功结果另有持久化（legacy_default_owner_id），不受影响。
 */
const LEGACY_CHECK_FAILURE_TTL_MS = 60_000;

/** 身份校验的进程内运行态（按 DB 实例隔离）：失败负缓存时间戳 + 进行中的校验 Promise。 */
interface LegacyOwnerCheckRuntime {
  /** 最近一次校验失败的时间戳（毫秒）；0 表示当前没有生效的失败负缓存。 */
  lastFailureAt: number;
  /** 进行中的 /user 校验：并发请求共享同一次网络调用。 */
  inFlight: Promise<LegacyOwnerResolution> | null;
}

const legacyCheckRuntimeByDb = new WeakMap<Database.Database, LegacyOwnerCheckRuntime>();

function getLegacyOwnerCheckRuntime(db: Database.Database): LegacyOwnerCheckRuntime {
  let runtime = legacyCheckRuntimeByDb.get(db);
  if (!runtime) {
    runtime = { lastFailureAt: 0, inFlight: null };
    legacyCheckRuntimeByDb.set(db, runtime);
  }
  return runtime;
}

/**
 * 清空指定 DB 的 legacy 认领身份校验内存态（失败负缓存 + 进行中去重 Promise）。
 * 仅供测试在清空/重建数据库后调用；生产路径的内存态与 DB 生命周期天然一致，
 * 无需主动重置。
 */
export function resetLegacyOwnerResolutionState(db: Database.Database): void {
  const runtime = legacyCheckRuntimeByDb.get(db);
  if (runtime) {
    runtime.lastFailureAt = 0;
    runtime.inFlight = null;
  }
}

/**
 * default 分区是否仍有待认领数据：repositories / releases / categories /
 * account_settings 任一存在 account_id='default' 的行。
 * claimed_by 已设置（认领完成）时上游 claimLegacyDefaultIfNeeded 已提前返回；
 * 这里覆盖的是「认领未发生但也不存在任何 default 数据」的情形——身份校验无从
 * 服务任何目的，直接跳过、不发起网络请求。default 行随后续无头/旧客户端写入
 * 再次出现时，认领流程自然恢复。
 */
function hasDefaultPartitionRows(db: Database.Database): boolean {
  for (const table of ['repositories', 'releases', 'categories', 'account_settings'] as const) {
    try {
      const row = db.prepare(`SELECT 1 AS one FROM ${table} WHERE account_id = 'default' LIMIT 1`).get();
      if (row) return true;
    } catch {
      // 表不存在（未跑 v4 迁移）时按无 default 行处理
    }
  }
  return false;
}

const LEGACY_GLOBAL_ACCOUNT_SETTING_KEYS: readonly string[] = [
  'customCategories',
  'categoryOrder',
  'hiddenDefaultCategoryIds',
  'defaultCategoryOverrides',
  'releaseSourceSettings',
  'categoryListIdMap',
  'syncMode',
  'syncModeConfigured',
  'ai_result_sharing_enabled',
];

/**
 * 全局 settings 表中是否仍存在旧版账号级设置（如 v3 升级后仅保存了 customCategories
 * 而无 repositories/releases/categories 行的场景）。
 */
function hasLegacyGlobalAccountSettings(db: Database.Database): boolean {
  try {
    const placeholders = LEGACY_GLOBAL_ACCOUNT_SETTING_KEYS.map(() => '?').join(', ');
    const row = db
      .prepare(`SELECT 1 AS one FROM settings WHERE key IN (${placeholders}) LIMIT 1`)
      .get(...LEGACY_GLOBAL_ACCOUNT_SETTING_KEYS);
    return Boolean(row);
  } catch {
    return false;
  }
}

/**
 * 库中是否仍存在「旧全局凭据」（全局 settings.github_token，或 v4 固化的
 * legacy_default_github_token 快照）。这类凭据属于升级前的旧数据所有者、身份
 * 未知：无头写入不能仅凭「唯一真实分区 / 活跃账号」推断归属（Issue #612 R12）。
 */
function hasLegacyGlobalCredential(db: Database.Database): boolean {
  return readSetting(db, 'github_token') !== null
    || readSetting(db, 'legacy_default_github_token') !== null;
}

/**
 * default 分区是否仍存在「归属未确立」的待认领数据（认领未发生且分区里有行，
 * 或全局 settings 表中存在旧版账号级设置）。
 * Issue #612 A4：无头导入的外部 default 工作区绝不能写进这种分区——否则外部
 * 数据会与待认领存量混在一起，被首个通过身份校验的账号一并自动认领。
 */
export function hasPendingDefaultPartitionData(db: Database.Database): boolean {
  return isLegacyClaimPending(db) && (hasDefaultPartitionRows(db) || hasLegacyGlobalAccountSettings(db));
}

/**
 * 是否存在多个真实（非 default）账号分区。覆盖 accounts 与全部分区表——
 * Issue #612 A26：单账号判定不得只看 repositories 表，否则其他分区表中
 * 潜伏的第二账号会让无范围兼容查询跨账号泄漏候选向量。
 */
export function hasMultipleAccountPartitions(db: Database.Database): boolean {
  return collectNonDefaultPartitionIds(db).size > 1;
}

// ── 每账号分区元数据（partition_meta）──
// Issue #612 A20x：仓库快照版本（repo_revision）等服务端自身的分区级元数据
// 不放 account_settings——该表会随备份导出/导入与 /api/settings 暴露，客户端
// 可写；独立元数据存储保证 revision 单调性不被备份恢复或请求篡改破坏。

/** 读取分区元数据；缺表（未跑 v6 迁移）或轻量 stub 时返回 null。 */
export function getPartitionMeta(db: Database.Database, accountId: string, key: string): string | null {
  try {
    const row = db
      .prepare('SELECT value FROM partition_meta WHERE account_id = ? AND key = ?')
      .get(accountId, key) as { value: string | null } | undefined;
    return typeof row?.value === 'string' && row.value.length > 0 ? row.value : null;
  } catch {
    return null;
  }
}

/** 写入分区元数据（upsert）；失败静默（元数据属 best-effort）。 */
export function setPartitionMeta(db: Database.Database, accountId: string, key: string, value: string): void {
  try {
    db.prepare('INSERT OR REPLACE INTO partition_meta (account_id, key, value) VALUES (?, ?, ?)')
      .run(accountId, key, value);
  } catch {
    // 轻量 stub 缺表时忽略
  }
}

/** 当前账号分区的仓库快照版本（单调递增，从 0 开始）。 */
export function getAccountRevision(db: Database.Database, accountId: string): number {
  const raw = getPartitionMeta(db, accountId, 'repo_revision');
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

/** 轻量 DB stub 缺 partition_meta 表的错误（R2-A21：这是版本写入唯一容忍的失败）。 */
function isMissingPartitionMetaTableError(err: unknown): boolean {
  return err instanceof Error && /no such table: partition_meta/.test(err.message);
}

/** 仓库/发行版写入成功后递增快照版本，返回新版本号。 */
export function bumpAccountRevision(db: Database.Database, accountId: string): number {
  try {
    db.prepare(`
      INSERT INTO partition_meta (account_id, key, value) VALUES (?, 'repo_revision', '1')
      ON CONFLICT(account_id, key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
    `).run(accountId);
  } catch (err) {
    // Issue #612 R2-A21：仅容忍轻量 stub 缺 partition_meta 表的错误（版本保持 0，
    // expectedRevision 校验随之降级为兼容路径）；其他写入错误向上抛出——
    // 事务内调用时随事务回滚，绝不吞掉真实的版本写入失败。
    if (!isMissingPartitionMetaTableError(err)) throw err;
  }
  return getAccountRevision(db, accountId);
}

/**
 * 认领事务内直接设定目标分区快照版本（Issue #612 审计：认领后的版本必须高于
 * default 与目标分区迁移前版本的最大值，bumpAccountRevision 的 +1 无法保证）。
 * 失败容忍范围与 bumpAccountRevision 一致：仅轻量 stub 缺 partition_meta 表。
 */
function setAccountRevision(db: Database.Database, accountId: string, value: number): void {
  try {
    db.prepare('INSERT OR REPLACE INTO partition_meta (account_id, key, value) VALUES (?, ?, ?)')
      .run(accountId, 'repo_revision', String(value));
  } catch (err) {
    if (!isMissingPartitionMetaTableError(err)) throw err;
  }
}

/**
 * 账号分区凭据版本（Issue #612 R2-A1：并发凭据变更检测）。
 * 新 PAT 写入与显式清空都会推进版本；PUT /api/settings 在 GitHub 校验等待
 * 前记录版本、写入事务内复核，版本已变化时放弃本次 PAT 写回。
 */
export function getAccountCredentialVersion(db: Database.Database, accountId: string): number {
  const raw = getPartitionMeta(db, accountId, 'credential_revision');
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

/** 凭据实际变更（新 PAT 写入 / 显式清空）后递增凭据版本。 */
export function bumpAccountCredentialVersion(db: Database.Database, accountId: string): void {
  try {
    db.prepare(`
      INSERT INTO partition_meta (account_id, key, value) VALUES (?, 'credential_revision', '1')
      ON CONFLICT(account_id, key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
    `).run(accountId);
  } catch (err) {
    // 与 bumpAccountRevision 相同的容忍范围：仅轻量 stub 缺表，其余向上抛出。
    if (!isMissingPartitionMetaTableError(err)) throw err;
  }
}

/**
 * 账号资料版本（Issue #612 R13 审计 13：并发资料变更检测）。资料变更（accounts
 * .user_json 写入）不推进凭据版本或活跃账号版本：携带资料 + 新 PAT 的请求在
 * GitHub 校验等待期间，另一设备可更新同账号资料。PUT /api/settings 在等待前
 * 记录本版本、写入事务内单独复核，已变化时跳过迟到请求携带的旧资料并报告冲突
 * （已验证且未被替换的 PAT 仍照常保存）。
 */
export function getAccountProfileVersion(db: Database.Database, accountId: string): number {
  const raw = getPartitionMeta(db, accountId, 'profile_revision');
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

/** 资料实际变更（accounts.user_json 写入 / 显式清空）后递增资料版本。 */
export function bumpAccountProfileVersion(db: Database.Database, accountId: string): void {
  try {
    db.prepare(`
      INSERT INTO partition_meta (account_id, key, value) VALUES (?, 'profile_revision', '1')
      ON CONFLICT(account_id, key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
    `).run(accountId);
  } catch (err) {
    // 与 bumpAccountCredentialVersion 相同的容忍范围：仅轻量 stub 缺表，其余向上抛出。
    if (!isMissingPartitionMetaTableError(err)) throw err;
  }
}

const GLOBAL_META_SCOPE = '__global__';

/** 全局活跃账号切换版本（用于防止异步 PAT 校验完成后覆盖期间发生的较新账号切换）。 */
export function getActiveAccountVersion(db: Database.Database): number {
  const raw = getPartitionMeta(db, GLOBAL_META_SCOPE, 'active_account_revision');
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

/** 活跃账号变更后递增全局活跃账号版本。 */
export function bumpActiveAccountVersion(db: Database.Database): void {
  try {
    db.prepare(`
      INSERT INTO partition_meta (account_id, key, value) VALUES (?, 'active_account_revision', '1')
      ON CONFLICT(account_id, key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
    `).run(GLOBAL_META_SCOPE);
  } catch (err) {
    if (!isMissingPartitionMetaTableError(err)) throw err;
  }
}

/** 执行一次 GitHub /user 身份查询（8s 超时），返回数字用户 id 字符串或 null。 */
export async function fetchGitHubUserId(token: string): Promise<string | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
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
    if (!res.ok) {
      logger.warn('db.accountScope', 'GitHub /user identity check failed for default claim', { status: res.status });
      return null;
    }
    const user = (await res.json()) as { id?: unknown };
    return typeof user.id === 'number' && Number.isInteger(user.id) && user.id > 0
      ? String(user.id)
      : null;
  } catch (err) {
    logger.warn('db.accountScope', 'Legacy default-claim identity check request failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 执行一次 GitHub /user 身份校验（8s 超时）。成功即冻结归属（持久化已验证所有者
 * 与被校验的加密 Token）；任何失败（网络错误 / 超时 / 401 / 无法解析的载荷）都
 * 写入失败负缓存并返回 ownerId=null——归属未确立：不冻结、不认领，等待真正的
 * 归属账号登录后再校验。
 */
async function performLegacyOwnerIdentityCheck(
  db: Database.Database,
  token: string,
  encryptedToken: string,
): Promise<LegacyOwnerResolution> {
  const runtime = getLegacyOwnerCheckRuntime(db);
  try {
    const ownerId = await fetchGitHubUserId(token);
    if (ownerId) {
      // Issue #612 审计：/user 校验是异步的——发起时存量数据可能尚未认领，
      // 返回时其他账号可能已通过管理员确认完成认领。认领已完成后绝不再冻结
      // 迟到的校验结果（ownerId 与密文绑定）：否则「B 已认领」+「全局密文匹配」
      // 两项检查会同时成立，让代理在 B 的分区上下文中复用 A 的凭据。
      if (isLegacyClaimPending(db)) {
        try {
          // 首次成功校验即冻结归属（同时记录被校验的加密 Token）：此后认领判定
          // 只认这份已验证所有者，不再随 Token 轮换重新判定，且供后续请求免网络复用。
          db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
            .run(LEGACY_OWNER_CACHE_KEY, JSON.stringify({ ownerId, token: encryptedToken }));
        } catch { /* cache write is best-effort */ }
      }
      return { ownerId, verifiedToken: encryptedToken };
    }
    // 校验被拒绝（401 / 无效 Token / 无法解析的载荷）：归属未确立，不冻结、不认领。
    runtime.lastFailureAt = Date.now();
    return { ownerId: null, verifiedToken: null };
  } catch (err) {
    logger.warn('db.accountScope', 'Legacy default-claim identity check request failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    // 校验失败（网络/超时）= 归属未确立：不冻结、不认领；负缓存窗口内不重发请求。
    runtime.lastFailureAt = Date.now();
    return { ownerId: null, verifiedToken: null };
  }
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
 *
 * 网络校验发起前依次经过三道零网络闸门：已验证归属缓存 → default 分区是否
 * 还有待认领行 → 失败负缓存（TTL）；真正需要发起 /user 时以进行中 Promise
 * 去重，并发请求共享同一次网络调用。
 */
async function resolveLegacyDefaultOwner(db: Database.Database): Promise<LegacyOwnerResolution> {
  const runtime = getLegacyOwnerCheckRuntime(db);

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

  // default 分区无任何待认领数据且无 v4 迁移固化的存量 Token：无需身份校验，直接返回（不发起网络请求）。
  if (
    !hasDefaultPartitionRows(db)
    && !hasLegacyGlobalAccountSettings(db)
    && !readSetting(db, 'legacy_default_github_token')
  ) {
    return { ownerId: null, verifiedToken: null };
  }

  // 失败负缓存仍在 TTL 窗口内：不重发网络请求（等待窗口过后自然重试）。
  if (runtime.lastFailureAt > 0 && Date.now() - runtime.lastFailureAt < LEGACY_CHECK_FAILURE_TTL_MS) {
    return { ownerId: null, verifiedToken: null };
  }

  let encrypted: string | null = null;
  try {
    const snapshotRow = db
      .prepare("SELECT value FROM settings WHERE key = 'legacy_default_github_token'")
      .get() as { value: string | null } | undefined;
    if (snapshotRow !== undefined) {
      encrypted = typeof snapshotRow.value === 'string' && snapshotRow.value.length > 0 ? snapshotRow.value : null;
    } else {
      encrypted = readSetting(db, 'github_token');
    }
  } catch {
    encrypted = readSetting(db, 'github_token');
  }
  if (!encrypted) return { ownerId: null, verifiedToken: null };
  let token: string;
  try {
    token = decrypt(encrypted, config.encryptionKey);
  } catch {
    logger.warn('db.accountScope', 'Failed to decrypt legacy github_token for default-claim identity check');
    return { ownerId: null, verifiedToken: null };
  }

  // 并发去重：进行中的校验 Promise 被共享，同一时刻只发一次 /user 调用。
  if (!runtime.inFlight) {
    runtime.inFlight = performLegacyOwnerIdentityCheck(db, token, encrypted).finally(() => {
      runtime.inFlight = null;
    });
  }
  return runtime.inFlight;
}

/**
 * Issue #612 R2-A5（修订第一轮 A17 方案）：分区凭据恢复路径已移除。
 *
 * 可轮换的账号分区 PAT（account_settings / accounts 副本）不能作为存量数据
 * 的归属证据——用「目标账号当前持有的凭据」通过 /user 校验只能证明请求者
 * 现在控制该账号，不能证明存量 default 数据历史上属于它；据此自动认领并
 * 写入认领标记，会让任何拿到目标账号控制权的凭据冒充存量数据所有者。
 * 因此归属确立只保留两条独立于可轮换 PAT 的证据：
 * 1. 存量快照 PAT（legacy_default_github_token / 认领时刻的全局 Token）经
 *    /user 校验确立的已冻结归属（resolveLegacyDefaultOwner）；
 * 2. 管理员显式确认（POST /api/sync/legacy-claim →
 *    claimLegacyDefaultWithAdminConfirmation）。
 * 无上述证据时存量数据原地保留，等待真正的归属账号登录或管理员确认。
 */

/** 读取已冻结（缓存）的 legacy 归属账号；兼容旧版裸 id 与 JSON 两种缓存形态。 */
function readFrozenLegacyOwner(db: Database.Database): string | null {
  const cached = readSetting(db, LEGACY_OWNER_CACHE_KEY);
  if (!cached) return null;
  if (ACCOUNT_ID_PATTERN.test(cached)) return cached;
  try {
    const parsed = JSON.parse(cached) as { ownerId?: unknown };
    return typeof parsed.ownerId === 'string' && ACCOUNT_ID_PATTERN.test(parsed.ownerId)
      ? parsed.ownerId
      : null;
  } catch {
    return null;
  }
}

/**
 * 读取已验证归属密文（legacy_default_owner_id）绑定的所有者（Issue #612 审计）。
 * 代理使用全局密文回退前，用它确认「密文绑定的所有者 === 解析出的账号 ID」：
 * 归属校验是异步的，迟到结果可能在他人认领后写坏绑定（594），仅凭「全局密文
 * 与校验时一致」不足以证明当前分区可以复用该凭据。
 */
export function getLegacyDefaultVerifiedOwnerBinding(db: Database.Database): string | null {
  return readFrozenLegacyOwner(db);
}

interface LegacyClaimCounts {
  repositories: number;
  releases: number;
  categories: number;
}

/** 认领完整性冲突的单条记录（供管理端点返回可处理的明细）。 */
export interface LegacyClaimConflict {
  table: 'repositories' | 'releases' | 'categories';
  id: string | number;
  /** repositories 的 full_name / releases 的 tag_name / categories 的 name。 */
  label: string | null;
}

/**
 * 认领完整性冲突（Issue #612 审计 847）：防误合并条件（A16）正确保留了无法
 * 自动归并的 default 行（如「目标行已按 ID 配对、另一条旧记录仅同名」的歧义
 * 行），整体回滚保持可重试。冲突明细随错误携带：自动路径记录日志，管理员
 * 端点返回可处理清单。管理员解决冲突后重新发起认领即可续办；自动重试在
 * 冲突解决前不会重复成功。
 */
export class LegacyClaimConflictError extends Error {
  readonly conflicts: LegacyClaimConflict[];
  constructor(conflicts: LegacyClaimConflict[]) {
    super('legacy default claim incomplete: unmigrated default rows remain (ambiguous same-name rows kept for resolution)');
    this.name = 'LegacyClaimConflictError';
    this.conflicts = conflicts;
  }
}

/**
 * Issue #612 审计 847 的安全冲突解决：把无法自动归并的 default 仓库行（同名
 * 歧义行）改名后按独立行迁移进目标账号分区——保留防误合并条件（绝不把歧义
 * 行合并进已按 ID 配对的目标行），又不让认领永久卡死。改名追加稳定后缀并在
 * 目标分区内去重；发行版/分类无同名唯一约束，正常不会残留、不走该路径。
 * 返回成功迁移的行数（改名碰撞被 OR IGNORE 跳过的行不计入，仍按冲突回滚）。
 */
function resolveClaimConflictsByRename(db: Database.Database, accountId: string): number {
  const rows = db.prepare(
    "SELECT id, full_name FROM repositories WHERE account_id = 'default'"
  ).all() as Array<{ id: number; full_name: string }>;
  const renameStmt = db.prepare(
    "UPDATE OR IGNORE repositories SET account_id = ?, full_name = ? WHERE account_id = 'default' AND id = ?"
  );
  const existsStmt = db.prepare(
    'SELECT 1 AS one FROM repositories WHERE account_id = ? AND full_name = ?'
  );
  let migrated = 0;
  for (const row of rows) {
    const baseName = `${row.full_name} (legacy-${row.id})`;
    let candidate = baseName;
    let suffix = 2;
    while (existsStmt.get(accountId, candidate)) {
      candidate = `${baseName}#${suffix}`;
      suffix++;
    }
    migrated += renameStmt.run(accountId, candidate, row.id).changes;
  }
  return migrated;
}

/**
 * 认领事务本体（供自动认领与管理员显式确认共用）：迁移 default 分区数据进
 * 目标账号分区，写入认领标记。verifiedToken 为 null 时不复制任何凭据。
 * 返回 null 表示并发下认领已完成（二次确认），抛出异常表示事务回滚。
 * options.renameConflicts：审计 847 的管理员续办选项——把同名歧义行改名后
 * 按独立行迁移（见 resolveClaimConflictsByRename），其余调用方保持回滚语义。
 */
function runLegacyDefaultClaimTransaction(
  db: Database.Database,
  accountId: string,
  verifiedToken: string | null,
  options: { renameConflicts?: boolean } = {},
): LegacyClaimCounts | null {
  const claim = db.transaction((): LegacyClaimCounts | null => {
    const claimed = readSetting(db, CLAIMED_BY_KEY);
    if (claimed) return null; // 并发请求下的二次确认

    const counts = {
      repositories: 0,
      releases: 0,
      categories: 0,
    };

    // A16 的 ID 配对记录表：在删除旧行之前固化「已按 ID 配对」的目标行集合。
    db.exec('CREATE TEMP TABLE IF NOT EXISTS legacy_claim_id_matched (id INTEGER PRIMARY KEY)');
    db.prepare('DELETE FROM legacy_claim_id_matched').run();
    // R2-A2 的同名归并映射表：旧仓库 ID → 目标仓库 ID（发行版 repo_id 重映射用）。
    db.exec('CREATE TEMP TABLE IF NOT EXISTS legacy_claim_full_name_matched (old_id INTEGER PRIMARY KEY, target_id INTEGER NOT NULL)');
    db.prepare('DELETE FROM legacy_claim_full_name_matched').run();

    // ── repositories：先迁移无冲突行；再按记录合并冲突行（同 id / 同 full_name），
    // 目标分区已有数据时绝不整表跳过，避免存量行永久滞留 default。──
    counts.repositories = db.prepare(
      "UPDATE OR IGNORE repositories SET account_id = ? WHERE account_id = 'default'"
    ).run(accountId).changes;

    // 同 id 冲突：目标行（账号自己的同步结果）保留，把 default 行独有的 AI 成果与
    // 用户自定义数据按「只补缺失」合并进目标行，然后删除 default 行。
    db.prepare(buildLegacyRepositoryMergeSql('id')).run(accountId);
    // 先固化 ID 配对关系再删除旧行：同名兼容归并以该集合为排除条件（A16）。
    db.prepare(`
      INSERT INTO legacy_claim_id_matched (id)
      SELECT id FROM repositories WHERE account_id = 'default' AND EXISTS (
        SELECT 1 FROM repositories t WHERE t.account_id = ? AND t.id = repositories.id
      )
    `).run(accountId);
    db.prepare(buildLegacyRepositoryDeleteSql('id')).run(accountId);

    // 同 full_name 异 id 冲突（仓库删除后重建等）：仅对无 ID 配对且对应关系
    // 无歧义的旧行补入后删除（A16）。
    db.prepare(buildLegacyRepositoryMergeSql('full_name')).run(accountId);
    // Issue #612 R2-A2：同名归并删除旧仓库前，固化「已确认的旧仓库 ID→目标 ID」
    // 映射（排除已被 ID 配对的目标行；旧 ID 与目标 ID 相同时无需重映射），随后把
    // 引用旧 ID 的发行版 repo_id 重映射到目标 ID——否则重建仓库的发行版会因
    // repo_id 指向已删除的旧 ID 而永久失联。
    db.prepare(`
      INSERT INTO legacy_claim_full_name_matched (old_id, target_id)
      SELECT d.id, t.id
      FROM repositories d
      JOIN repositories t
        ON t.account_id = ? AND t.full_name = d.full_name
       AND t.id NOT IN (SELECT id FROM legacy_claim_id_matched)
      WHERE d.account_id = 'default' AND d.id != t.id
    `).run(accountId);
    db.prepare(buildLegacyRepositoryDeleteSql('full_name')).run(accountId);

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
    // Issue #612 R2-A2：同名归并迁移完成后，把账号分区中仍引用旧仓库 ID 的
    // 发行版 repo_id 重映射到目标 ID（重建仓库保持发行版关联）。
    db.prepare(`
      UPDATE releases SET repo_id = (
        SELECT m.target_id FROM legacy_claim_full_name_matched m WHERE m.old_id = releases.repo_id
      )
      WHERE account_id = ? AND repo_id IN (SELECT old_id FROM legacy_claim_full_name_matched)
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

    // 迁移完整性校验：仍有 default 残留行（防误合并条件保留的歧义行）时整体
    // 回滚，保留可重试状态；绝不在迁移未完成时写入 legacy_default_claimed_by。
    // Issue #612 审计 847：残留行明细随 LegacyClaimConflictError 携带（管理端点
    // 返回可处理的冲突清单），不再只抛无信息的通用错误；管理员可按明细解决
    // 冲突后重试，或携带 renameConflicts 选项把歧义仓库行改名后按独立行续办。
    const conflicts: LegacyClaimConflict[] = [];
    let leftover = 0;
    for (const table of ['repositories', 'releases', 'categories'] as const) {
      const rows = db.prepare(`SELECT * FROM ${table} WHERE account_id = 'default'`).all() as Array<Record<string, unknown>>;
      leftover += rows.length;
      for (const row of rows) {
        conflicts.push({
          table,
          id: (row.id as string | number | undefined) ?? '',
          label: table === 'repositories'
            ? ((row.full_name as string | null) ?? null)
            : table === 'releases'
              ? ((row.tag_name as string | null) ?? null)
              : ((row.name as string | null) ?? null),
        });
      }
    }
    if (leftover > 0 && options.renameConflicts) {
      leftover -= resolveClaimConflictsByRename(db, accountId);
    }
    if (leftover > 0) {
      logger.warn('db.accountScope', 'Legacy default claim aborted: unmigrated default rows remain', { leftover, conflicts });
      throw new LegacyClaimConflictError(conflicts);
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
    // Issue #612 审计（852）：v3 旧版数据可能把账号级设置存进 account_settings
    // 的 'default' 行（预检把该行视为待认领数据，但此前认领只复制全局 settings，
    // 迁移遗漏却仍标记完成并阻止重试）。认领同时处理两个旧版设置来源：只补
    // 缺失地迁移账号级键（目标账号已保存的新值绝不被覆盖），随后删除 default
    // 行——default 设置行全部处理完是写认领标记的前提。default 行的 github_token
    // 来源无法证明归属，按 R2-A5 语义不迁移（宁可缺失，不可错配）。
    try {
      const legacyDefaultSettingRows = db
        .prepare("SELECT key, value FROM account_settings WHERE account_id = 'default'")
        .all() as Array<{ key: string; value: string | null }>;
      for (const row of legacyDefaultSettingRows) {
        if (ACCOUNT_SCOPED_SETTING_KEYS.has(row.key) && row.key !== 'github_token') {
          db.prepare('INSERT OR IGNORE INTO account_settings (account_id, key, value) VALUES (?, ?, ?)')
            .run(accountId, row.key, row.value);
        }
        db.prepare("DELETE FROM account_settings WHERE account_id = 'default' AND key = ?").run(row.key);
      }
    } catch (err) {
      // 仅容忍轻量 stub 缺 account_settings 表的错误（与 partition_meta 写入的
      // 容忍范围一致）；其余真实数据库错误向上抛出——事务内抛出即整体回滚，
      // 绝不带着未迁移完的设置写入 legacy_default_claimed_by（认领标记一旦写入，
      // 自动与手动认领都会跳过，剩余设置将永远失去迁移入口）。
      if (!(err instanceof Error && /no such table: account_settings/.test(err.message))) throw err;
    }
    // 仅在多账号共存时清除存量仓库的 vector_indexed_at，避免单账号老用户升级后被迫全量重建向量。
    if (collectNonDefaultPartitionIds(db).size > 1) {
      db.prepare(
        'UPDATE repositories SET vector_indexed_at = NULL WHERE account_id = ? AND vector_indexed_at IS NOT NULL',
      ).run(accountId);
    }
    // Issue #612 R2-A6（审计修订 874）：认领迁移了仓库/发行版数据，在写入认领
    // 标记前把目标账号快照版本推进到 default 与目标分区已有版本的最大值之上——
    // 认领前从任一分区读取的快照（expectedRevision）都无法通过认领后的版本
    // 检查，防止旧客户端用旧快照做全量同步、误删认领迁移进来的数据。
    const claimRevisionFloor = Math.max(
      getAccountRevision(db, DEFAULT_SCOPE),
      getAccountRevision(db, accountId),
    ) + 1;
    setAccountRevision(db, accountId, claimRevisionFloor);
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(CLAIMED_BY_KEY, accountId);
    // 认领只补「尚无有效活跃账号」的缺口：用户可能已在设置里显式切到其他账号，
    // 认领不得把它改回存量归属账号。
    const active = readSetting(db, 'active_account_id');
    if (!active || !ACCOUNT_ID_PATTERN.test(active)) {
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('active_account_id', accountId);
      bumpActiveAccountVersion(db);
    }
    return counts;
  });

  return claim();
}

/**
 * 存量 'default' 数据首次真实账号认领（Legacy Default Claim）。
 *
 * 仅当同时满足以下条件时才执行认领，否则 'default' 数据原地不动：
 * 1. settings 中尚未记录 legacy_default_claimed_by；
 * 2. 存量数据的「已验证所有者」（resolveLegacyDefaultOwner 冻结的身份，一经
 *    校验确立便不再随 Token 轮换改变）=== 请求账号 ID。
 *
 * Issue #612 R2-A5（修订第一轮 A17 方案）：归属确立只接受独立于可轮换 PAT 的
 * 证据——存量快照 PAT 校验确立的已冻结归属。账号分区自身保存的凭据
 * （account_settings / accounts 副本）可随时轮换，不能证明存量数据的历史归属，
 * 不再用于自动认领；身份校验无法确立归属时存量数据原地保留，等待真正的归属
 * 账号登录，或由管理员经 POST /api/sync/legacy-claim 显式确认迁移目标。
 *
 * 认领在单个事务中完成：repositories / releases / categories 的 default 行
 * 「逐条」迁移为请求账号 ID（目标分区已有数据时按记录合并而非整表跳过），
 * 账号级设置键以「只补缺失」方式复制进 account_settings（不覆盖账号已保存的
 * 新值；其中全局 github_token 仅当仍是当初通过身份校验的那份加密 Token 时才
 * 复制，Token 已换绑其他账号或同账号轮换时一律跳过，绝不把来源无法证明的
 * 凭据迁移进账号分区），最后清除重建标记、推进快照版本并写入
 * legacy_default_claimed_by 与 active_account_id。
 * 若仍有 default 残留行（意外冲突），整体回滚并保持可重试状态，绝不写认领标记。
 */
export async function claimLegacyDefaultIfNeeded(db: Database.Database, accountId: string): Promise<void> {
  if (!ACCOUNT_ID_PATTERN.test(accountId)) return;
  if (!isLegacyClaimPending(db)) return;

  const resolution = await resolveLegacyDefaultOwner(db);
  const ownerId = resolution.ownerId;
  const verifiedToken = resolution.verifiedToken;
  if (!ownerId) {
    // R2-A5：归属未确立（无已冻结归属、存量快照 PAT 也校验失败）→ 不认领。
    // 可轮换的分区凭据不能作为归属证据；管理员显式确认路径保持可用。
    return;
  }
  if (ownerId !== accountId) {
    // 身份不符：绝不认领。'default' 存量数据原地保留，等待已验证的归属账号登录；
    // 全局 Token 被换成其他账号不得改变已验证的归属。
    logger.info('db.accountScope', 'Skipping legacy default claim: verified owner does not match requester', {
      legacyOwner: ownerId,
      requested: accountId,
    });
    return;
  }

  let claimed: LegacyClaimCounts | null = null;
  try {
    claimed = runLegacyDefaultClaimTransaction(db, accountId, verifiedToken);
  } catch (err) {
    if (err instanceof LegacyClaimConflictError) {
      // Issue #612 审计 847：防误合并条件保留的歧义行让自动认领无法一次完成——
      // 冲突明细已记录，事务回滚、存量数据保持可重试状态；管理员解决冲突或经
      // 管理端点 resolve_conflicts: 'rename' 改名续办后，重试即完成认领。
      logger.warn('db.accountScope', 'Legacy default claim blocked by ambiguous default rows (see conflicts)', {
        conflicts: err.conflicts,
      });
      return;
    }
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
 * A17 管理员显式确认的迁移目标认领：身份校验无法确立归属（存量快照 PAT 已
 * 失效，且可轮换的分区凭据按 R2-A5 不再作为归属证据）时，由持有 API_SECRET
 * 的管理员显式指定迁移目标。
 * 约束：归属已冻结为其他账号时拒绝（不得改变已冻结的归属）；认领事务与自动
 * 路径完全一致，且不复制任何凭据（不自动信任当前全局 Token）。
 */
export function claimLegacyDefaultWithAdminConfirmation(
  db: Database.Database,
  accountId: string,
  options: { renameConflicts?: boolean } = {},
): { ok: true; claimed: LegacyClaimCounts } | { ok: false; code: string; conflicts?: LegacyClaimConflict[] } {
  if (!ACCOUNT_ID_PATTERN.test(accountId)) return { ok: false, code: 'INVALID_ACCOUNT_ID' };
  if (!isLegacyClaimPending(db)) return { ok: false, code: 'LEGACY_DEFAULT_ALREADY_CLAIMED' };
  const frozenOwner = readFrozenLegacyOwner(db);
  if (frozenOwner && frozenOwner !== accountId) {
    return { ok: false, code: 'LEGACY_OWNER_FROZEN_MISMATCH' };
  }
  let claimed: LegacyClaimCounts | null = null;
  try {
    claimed = runLegacyDefaultClaimTransaction(db, accountId, null, options);
  } catch (err) {
    // Issue #612 审计 847：无法自动归并的歧义行返回可处理的冲突明细（不再让
    // 管理员确认与自动重试重复执行同一失败事务而拿不到任何定位信息）。
    if (err instanceof LegacyClaimConflictError) {
      return { ok: false, code: 'LEGACY_CLAIM_CONFLICT', conflicts: err.conflicts };
    }
    throw err;
  }
  if (!claimed) return { ok: false, code: 'LEGACY_DEFAULT_ALREADY_CLAIMED' };
  logger.info('db.accountScope', 'Legacy default data claimed via admin confirmation', { accountId, ...claimed });
  return { ok: true, claimed };
}

/**
 * 全局中间件：对携带真实账号 ID 的请求尝试执行一次存量 default 数据认领。
 * 认领失败（网络/校验不可用）不阻塞请求；分区解析本身是纯同步逻辑。
 * 身份校验有「已验证缓存 → 无 default 行免校验 → 失败负缓存（TTL）」三道零
 * 网络闸门与进行中 Promise 去重，网络不可用时请求不会被成批拖住
 * （详见 resolveLegacyDefaultOwner）。
 */
export function accountScopeMiddleware(req: Request, _res: import('express').Response, next: import('express').NextFunction): void {
  // 健康检查必须零副作用：不校验 GitHub、不迁移数据、不改账号状态。
  // Issue #612 R12：Express 默认大小写不敏感路由（/api/Health 同样命中健康
  // 路由），认领跳过判定必须与路由的匹配规则一致——所有能匹配健康路由的
  // 路径都不得等待身份校验或触发迁移。
  const lowerPath = req.path.toLowerCase();
  if (lowerPath === '/health' || lowerPath === '/health/') {
    next();
    return;
  }
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
