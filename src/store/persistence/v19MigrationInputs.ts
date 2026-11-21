/**
 * v19 旧凭据迁移输入（第 12 轮审计 ISSUE-1 修复：按账号逐项失效）。
 *
 * 迁移输入 = 「仍未成功写入 safeStorage、但必须跨重启保留下来继续重试」的旧 PAT。
 * 它只在内存中维护（绝不作为新数据源写入明文分片）：partialize 只把输入中的账号
 * 回填进已存在的 savedAccounts 条目，运行时产生的任何新 PAT 一律剥除。
 *
 * 失效规则（缺一不可）：
 * - 某账号 PAT 成功写入 safeStorage ⇒ 删除该账号的迁移输入（新凭据已落盘）；
 * - 登出/移除账号 ⇒ 显式删除该账号的迁移输入（登录页不得凭旧记录一键恢复）；
 * - 重新授权产生更新的运行时 PAT ⇒ 该账号旧迁移输入不再回填（新旧比较时新值优先）。
 *
 * 独立成模块的原因：options.ts 与 authSlice.ts / ghAccountSecrets.ts 都需要读写
 * 这份状态，而 options.ts 依赖 useAppStore，反向导入会形成初始化环。
 */

export type V19MigrationInputMap = Record<string, string>;

/** GitHub 账号 ID 的规范形态（与 ghAccountSecrets 的校验保持一致）。 */
const ACCOUNT_ID_PATTERN = /^\d{1,20}$/;

let migrationInputs: V19MigrationInputMap | null = null;

const normalizeInputs = (tokens: V19MigrationInputMap | null | undefined): V19MigrationInputMap | null => {
  if (!tokens || typeof tokens !== 'object') return null;
  const next: V19MigrationInputMap = {};
  for (const [accountId, token] of Object.entries(tokens)) {
    if (!ACCOUNT_ID_PATTERN.test(accountId)) continue;
    if (typeof token !== 'string' || !token.trim()) continue;
    next[accountId] = token;
  }
  return Object.keys(next).length > 0 ? next : null;
};

/** 当前迁移输入（只读用途；调用方不得就地修改返回值）。 */
export const getV19MigrationInputs = (): V19MigrationInputMap | null => migrationInputs;

/** 是否存在仍需跨重启保留/重试的迁移输入。 */
export const hasV19MigrationInputs = (): boolean => !!migrationInputs && Object.keys(migrationInputs).length > 0;

/**
 * 记录本次启动由 migrate 产生的迁移输入（覆盖旧值）。
 * 传入空映射等价于清空；不需要迁移时由调用方直接确认。
 */
export const setV19MigrationInputs = (tokens: V19MigrationInputMap | null | undefined): void => {
  migrationInputs = normalizeInputs(tokens);
};

/**
 * 从持久化分片重建迁移输入（第二次及以后启动，migrate 不再运行）。
 * 已存在的条目不被覆盖——同账号可能已有本次启动更新鲜的迁移输入。
 */
export const mergeV19MigrationInputs = (tokens: V19MigrationInputMap | null | undefined): void => {
  const incoming = normalizeInputs(tokens);
  if (!incoming) return;
  const next: V19MigrationInputMap = { ...(migrationInputs ?? {}) };
  let changed = false;
  for (const [accountId, token] of Object.entries(incoming)) {
    if (next[accountId]) continue;
    next[accountId] = token;
    changed = true;
  }
  if (changed) migrationInputs = next;
};

/**
 * 让指定账号的迁移输入失效（成功写入 safeStorage / 显式登出或移除账号）。
 * 返回是否有条目被删除，便于调用方决定是否需要重新评估确认标记。
 */
export const forgetV19MigrationInputs = (accountIds: Iterable<string>): boolean => {
  if (!migrationInputs) return false;
  let changed = false;
  const next: V19MigrationInputMap = { ...migrationInputs };
  for (const accountId of accountIds) {
    if (!(accountId in next)) continue;
    delete next[accountId];
    changed = true;
  }
  if (!changed) return false;
  migrationInputs = Object.keys(next).length > 0 ? next : null;
  return true;
};

/** 仅供测试：重置模块级迁移输入，模拟一次全新的应用启动。 */
export const __resetV19MigrationInputsForTest = (): void => {
  migrationInputs = null;
};
