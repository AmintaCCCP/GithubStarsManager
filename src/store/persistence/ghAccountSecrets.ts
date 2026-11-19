/**
 * 桌面端 GitHub 账号 Token 的安全存储桥（审计修复 B7，CWE-922；R2-B1 语义重构）。
 *
 * 复用 xAuth 的 Electron safeStorage 模式：PAT 只落主进程加密文件
 * `<userData>/gh-accounts.enc`（经 preload `ghAccounts` IPC 读写），
 * 浏览器持久化分片（IndexedDB/localStorage）仅保留 savedAccounts 的
 * 非敏感元数据。Web 构建（无 electronAPI 桥）不持久化任何 PAT——
 * 切换/恢复该账号时要求重新授权。
 *
 * R2-B1 失败语义：loadGhAccountTokens 区分三种结果——
 *   - 'unavailable'：无 IPC 桥（Web 构建）；
 *   - 'error'：桥调用失败（异常或主进程返回 error）。磁盘状态未知，
 *     必须保持「未加载」状态，不得当作空映射，也不得据此覆写磁盘；
 *   - 'loaded'：拿到完整映射（文件不存在 ⇒ 空映射也算已确认加载）。
 *
 * 写入前提：只有已确认加载到完整映射后才允许全量覆写；未确认加载前
 * saveGhAccountTokens 自动改为「先读后写」的合并更新（磁盘已有而本会话
 * 未知的账号 Token 一律保留），确保读取暂时失败时磁盘上其他账号的 PAT
 * 不会被抹掉。
 */

const GH_ACCOUNT_ID_PATTERN = /^\d{1,20}$/;
/** GitHub Token 为可打印 ASCII（classic 与 fine-grained 均如此），禁止控制字符。 */
const GH_TOKEN_PATTERN = /^[\x21-\x7E]{1,512}$/;

export type GhAccountTokenMap = Record<string, string>;

/**
 * R2-B1：桌面端安全存储的加载结果语义。
 * - unavailable：无桥（Web），不涉及磁盘；
 * - error：读取失败——磁盘状态未知（tokens 字段缺省）；
 * - loaded：已确认完整映射（文件不存在 ⇒ 空映射）。
 */
export type GhAccountsLoadResult =
  | { status: 'unavailable' }
  | { status: 'error'; error: string }
  | { status: 'loaded'; tokens: GhAccountTokenMap };

/** 主进程 gh-accounts:get 的结构化返回（missing = 磁盘无 Token 文件）。 */
export type GhAccountsGetPayload =
  | { status: 'missing' }
  | { status: 'loaded'; tokens: GhAccountTokenMap }
  | { status: 'error'; error: string };

interface GhAccountsBridge {
  save: (tokens: GhAccountTokenMap) => Promise<{ success: boolean; error?: string }>;
  get: () => Promise<GhAccountsGetPayload>;
  clear: () => Promise<{ success: boolean; error?: string }>;
}

const getBridge = (): GhAccountsBridge | null => {
  if (typeof window === 'undefined') return null;
  const bridge = (window as unknown as {
    electronAPI?: { ghAccounts?: GhAccountsBridge };
  }).electronAPI?.ghAccounts;
  return bridge ?? null;
};

/** 桌面端安全存储是否可用（Web 构建恒为 false：PAT 不持久化）。 */
export const hasGhAccountsBridge = (): boolean => getBridge() !== null;

/**
 * 是否已确认加载到磁盘上的完整 Token 映射（R2-B1）。只有该状态为 true 时
 * saveGhAccountTokens 才允许全量覆写；否则自动先读后写合并更新。
 */
let ghAccountTokensFullyLoaded = false;

/**
 * 最近一次确认的磁盘权威映射（自审计补充）。合并写入只发生在「读取失败后
 * 再次写入」的场景，此时 Store 里的 savedAccounts 并不含磁盘上的其他账号
 * Token；若后续由 state 派生的写入直接整表覆写（登出、移除账号），这些
 * 账号的 PAT 会被抹掉。因此所有写入都以该镜像为基底，再由显式移除列表
 * 删除条目——既保留其他账号，也保证登出/移除真正生效。
 * null = 磁盘状态未知（尚未成功读取或读取失败）。
 */
let knownDiskTokens: GhAccountTokenMap | null = null;

/**
 * 待提交的删除列表：保存失败时保留待删除账号，直到后续保存成功才清除，
 * 避免删除请求因单次 I/O 失败而永久丢失、导致已登出/已移除账号的 PAT 残留在磁盘。
 */
const pendingRemovedAccountIds = new Set<string>();

/**
 * 串行队列：把 load / save / clear 的读取基底、合并、删除、写入与镜像更新
 * 纳入同一顺序，避免并发保存基于过期的 knownDiskTokens 恢复已删除的 PAT。
 */
let ghAccountsQueue: Promise<void> = Promise.resolve();

const enqueueGhAccountsOp = <T>(op: () => Promise<T>): Promise<T> => {
  const next = ghAccountsQueue.then(op, op);
  ghAccountsQueue = next.then(() => undefined, () => undefined);
  return next;
};

/** 仅供测试观察：磁盘完整映射是否已确认加载。 */
export const isGhAccountTokensFullyLoaded = (): boolean => ghAccountTokensFullyLoaded;

/** 供调用方/测试检查是否存在尚未落盘的账号凭据删除请求（可用于重试提示）。 */
export const hasPendingGhAccountSecretRemovals = (): boolean => pendingRemovedAccountIds.size > 0;

/** 丢弃非法键（非数字 ID）与非法值（空/超长/含控制字符）的条目。 */
const sanitizeTokenMap = (tokens: GhAccountTokenMap | null | undefined): GhAccountTokenMap => {
  const result: GhAccountTokenMap = {};
  if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) return result;
  for (const [accountId, token] of Object.entries(tokens)) {
    if (!GH_ACCOUNT_ID_PATTERN.test(accountId)) continue;
    if (typeof token !== 'string' || !GH_TOKEN_PATTERN.test(token)) continue;
    result[accountId] = token;
  }
  return result;
};

const loadGhAccountTokensUnlocked = async (): Promise<GhAccountsLoadResult> => {
  const bridge = getBridge();
  if (!bridge) return { status: 'unavailable' };
  let payload: GhAccountsGetPayload;
  try {
    payload = await bridge.get();
  } catch (error) {
    // 桥调用异常：磁盘状态未知，保持「未加载」状态。
    return {
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    };
  }
  if (payload && typeof payload === 'object' && payload.status === 'error') {
    return { status: 'error', error: typeof payload.error === 'string' ? payload.error : 'gh-accounts load failed' };
  }
  if (payload && typeof payload === 'object' && payload.status === 'loaded') {
    const tokens = sanitizeTokenMap(payload.tokens);
    ghAccountTokensFullyLoaded = true;
    knownDiskTokens = { ...tokens };
    return { status: 'loaded', tokens };
  }
  // status 'missing'（文件不存在）或无法识别的载荷：磁盘确认无有效映射。
  ghAccountTokensFullyLoaded = true;
  knownDiskTokens = {};
  return { status: 'loaded', tokens: {} };
};

/**
 * 读取桌面端安全存储中的全部账号 Token（R2-B1 语义）。
 * 成功加载（含「文件不存在 ⇒ 空映射」）会标记完整映射已确认；
 * 读取失败返回 { status: 'error' } 且不改变加载状态——调用方不得把
 * 失败当作「磁盘上没有 Token」。
 */
export const loadGhAccountTokens = (): Promise<GhAccountsLoadResult> =>
  enqueueGhAccountsOp(loadGhAccountTokensUnlocked);

/**
 * 写入桌面端安全存储（R2-B1 + 串行队列 + 失败删除保留）：
 * - 全流程在 ghAccountsQueue 内串行执行，避免并发写入从过期镜像恢复已删除 PAT；
 * - 以最近一次确认的磁盘映射（knownDiskTokens）为基底，叠加本次提供的条目，
 *   再删除显式移除列表及之前保存失败残留的 pendingRemovedAccountIds；
 * - 磁盘镜像未知（尚未成功读取）⇒ 先读后写；读取失败则中止写入，绝不以
 *   部分映射覆写磁盘；
 * - 保存成功后才清除已应用的 pendingRemovedAccountIds；抛错时磁盘与待删列表均保留。
 */
export const saveGhAccountTokens = (
  tokens: GhAccountTokenMap,
  removedAccountIds: string[] = [],
): Promise<void> => enqueueGhAccountsOp(async () => {
  const bridge = getBridge();
  if (!bridge) return;
  const sanitized = sanitizeTokenMap(tokens);
  // 记录本次显式删除；若本次又为同一账号写入了有效 Token，则取消其待删标记。
  for (const accountId of Object.keys(sanitized)) {
    pendingRemovedAccountIds.delete(accountId);
  }
  for (const accountId of removedAccountIds) {
    if (GH_ACCOUNT_ID_PATTERN.test(accountId)) {
      pendingRemovedAccountIds.add(accountId);
    }
  }
  let base: GhAccountTokenMap;
  if (knownDiskTokens) {
    base = { ...knownDiskTokens };
  } else {
    const disk = await loadGhAccountTokensUnlocked();
    if (disk.status === 'error') {
      // 读取失败：磁盘状态未知，拒绝写入（绝不以部分映射覆写磁盘），并保留 pendingRemovedAccountIds。
      throw new Error(disk.error || 'gh-accounts load failed; refusing to overwrite');
    }
    base = disk.status === 'loaded' ? { ...disk.tokens } : {};
  }
  const payload: GhAccountTokenMap = { ...base, ...sanitized };
  const appliedRemovals = Array.from(pendingRemovedAccountIds);
  for (const accountId of appliedRemovals) {
    delete payload[accountId];
  }
  const result = await bridge.save(payload);
  if (!result.success) {
    throw new Error(result.error ?? 'gh-accounts save failed');
  }
  for (const accountId of appliedRemovals) {
    pendingRemovedAccountIds.delete(accountId);
  }
  knownDiskTokens = { ...payload };
  ghAccountTokensFullyLoaded = true;
});

/** 清除桌面端安全存储中的全部账号 Token（成功后磁盘状态已知为空）。 */
export const clearGhAccountTokens = (): Promise<void> => enqueueGhAccountsOp(async () => {
  const bridge = getBridge();
  if (!bridge) return;
  const result = await bridge.clear();
  if (!result.success) {
    throw new Error(result.error ?? 'gh-accounts clear failed');
  }
  pendingRemovedAccountIds.clear();
  ghAccountTokensFullyLoaded = true;
  knownDiskTokens = {};
});

/**
 * 把当前 Store 会话的全部账号 Token 幂等同步到桌面端安全存储。
 * 返回 Promise<boolean> 表示本次落盘是否成功（不向外抛未捕获异常，同时允许
 * 需要重试语义的调用方检查结果；失败的删除请求会保留至下次保存自动重试）。
 * Web 构建（无桥）返回 Promise<true>。
 */
export const syncGhAccountTokensFromState = (state: {
  user: { id: number } | null;
  githubToken: string | null;
  savedAccounts: Record<string, { githubToken: string }>;
}, removedAccountIds: string[] = []): Promise<boolean> => {
  if (!hasGhAccountsBridge()) return Promise.resolve(true);
  const tokens: GhAccountTokenMap = {};
  for (const [accountId, account] of Object.entries(state.savedAccounts ?? {})) {
    const token = account?.githubToken;
    if (typeof token === 'string' && token.trim()) tokens[accountId] = token;
  }
  const currentAccountId = typeof state.user?.id === 'number' && Number.isFinite(state.user.id)
    ? String(state.user.id)
    : null;
  const currentToken = typeof state.githubToken === 'string' ? state.githubToken.trim() : '';
  if (currentAccountId && currentToken && !tokens[currentAccountId]) {
    tokens[currentAccountId] = currentToken;
  }
  return saveGhAccountTokens(tokens, removedAccountIds)
    .then(() => true)
    .catch(() => false);
};
