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
type GhAccountsGetPayload =
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

/** 仅供测试观察：磁盘完整映射是否已确认加载。 */
export const isGhAccountTokensFullyLoaded = (): boolean => ghAccountTokensFullyLoaded;

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

/**
 * 读取桌面端安全存储中的全部账号 Token（R2-B1 语义）。
 * 成功加载（含「文件不存在 ⇒ 空映射」）会标记完整映射已确认；
 * 读取失败返回 { status: 'error' } 且不改变加载状态——调用方不得把
 * 失败当作「磁盘上没有 Token」。
 */
export const loadGhAccountTokens = async (): Promise<GhAccountsLoadResult> => {
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
 * 写入桌面端安全存储（R2-B1 + 自审计补充）：
 * - 以最近一次确认的磁盘映射（knownDiskTokens）为基底，叠加本次提供的条目，
 *   再删除显式移除列表中的账号——合并写入后 Store 可能并不含磁盘上的其他
 *   账号 Token，基底保证它们不会被后续整表覆写抹掉；
 * - 磁盘镜像未知（尚未成功读取）⇒ 先读后写；读取失败则中止写入，绝不以
 *   部分映射覆写磁盘；
 * - removedAccountIds 用于登出/移除账号等需要真正从磁盘删除 PAT 的场景。
 * 抛错时磁盘保持原状。
 */
export const saveGhAccountTokens = async (
  tokens: GhAccountTokenMap,
  removedAccountIds: string[] = [],
): Promise<void> => {
  const bridge = getBridge();
  if (!bridge) return;
  const sanitized = sanitizeTokenMap(tokens);
  let base: GhAccountTokenMap;
  if (knownDiskTokens) {
    base = { ...knownDiskTokens };
  } else {
    const disk = await loadGhAccountTokens();
    if (disk.status === 'error') {
      // 读取失败：磁盘状态未知，拒绝写入（绝不以部分映射覆写磁盘）。
      throw new Error(disk.error || 'gh-accounts load failed; refusing to overwrite');
    }
    base = disk.status === 'loaded' ? { ...disk.tokens } : {};
  }
  const payload: GhAccountTokenMap = { ...base, ...sanitized };
  for (const accountId of removedAccountIds) {
    delete payload[accountId];
  }
  const result = await bridge.save(payload);
  if (!result.success) {
    throw new Error(result.error ?? 'gh-accounts save failed');
  }
  knownDiskTokens = { ...payload };
  ghAccountTokensFullyLoaded = true;
};

/** 清除桌面端安全存储中的全部账号 Token（成功后磁盘状态已知为空）。 */
export const clearGhAccountTokens = async (): Promise<void> => {
  const bridge = getBridge();
  if (!bridge) return;
  const result = await bridge.clear();
  if (!result.success) {
    throw new Error(result.error ?? 'gh-accounts clear failed');
  }
  ghAccountTokensFullyLoaded = true;
  knownDiskTokens = {};
};

/**
 * 把当前 Store 会话的全部账号 Token 幂等同步到桌面端安全存储（fire-and-forget）。
 * savedAccounts 的 githubToken 是唯一来源；顶层 githubToken 兜底并入当前账号，
 * 防止登记时序竞态把当前会话 Token 漏出加密文件。Web 构建（无桥）为 no-op。
 * removedAccountIds：登出 / 移除账号时需真正从磁盘删除 PAT 的账号（显式移除，
 * 与「磁盘未知账号」区分开——后者一律保留）。写入基底见 saveGhAccountTokens。
 */
export const syncGhAccountTokensFromState = (state: {
  user: { id: number } | null;
  githubToken: string | null;
  savedAccounts: Record<string, { githubToken: string }>;
}, removedAccountIds: string[] = []): void => {
  if (!hasGhAccountsBridge()) return;
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
  saveGhAccountTokens(tokens, removedAccountIds).catch(() => {
    // 加密文件写失败不阻断会话：下次 Token 变更时重试；期间重启丢失 Token
    // 的账号按「需重新授权」处理。
  });
};
