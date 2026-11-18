/**
 * 桌面端 GitHub 账号 Token 的安全存储桥（审计修复 B7，CWE-922）。
 *
 * 复用 xAuth 的 Electron safeStorage 模式：PAT 只落主进程加密文件
 * `<userData>/gh-accounts.enc`（经 preload `ghAccounts` IPC 读写），
 * 浏览器持久化分片（IndexedDB/localStorage）仅保留 savedAccounts 的
 * 非敏感元数据。Web 构建（无 electronAPI 桥）不持久化任何 PAT——
 * 切换/恢复该账号时要求重新授权。
 */

const GH_ACCOUNT_ID_PATTERN = /^\d{1,20}$/;
/** GitHub Token 为可打印 ASCII（classic 与 fine-grained 均如此），禁止控制字符。 */
const GH_TOKEN_PATTERN = /^[\x21-\x7E]{1,512}$/;

export type GhAccountTokenMap = Record<string, string>;

interface GhAccountsBridge {
  save: (tokens: GhAccountTokenMap) => Promise<{ success: boolean; error?: string }>;
  get: () => Promise<GhAccountTokenMap | null>;
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

/** 读取桌面端安全存储中的全部账号 Token；不可用/读取失败返回 null。 */
export const loadGhAccountTokens = async (): Promise<GhAccountTokenMap | null> => {
  const bridge = getBridge();
  if (!bridge) return null;
  try {
    return sanitizeTokenMap(await bridge.get());
  } catch {
    return null;
  }
};

/** 全量覆写桌面端安全存储（空映射即清除加密文件）。 */
export const saveGhAccountTokens = async (tokens: GhAccountTokenMap): Promise<void> => {
  const bridge = getBridge();
  if (!bridge) return;
  const result = await bridge.save(sanitizeTokenMap(tokens));
  if (!result.success) {
    throw new Error(result.error ?? 'gh-accounts save failed');
  }
};

/** 清除桌面端安全存储中的全部账号 Token。 */
export const clearGhAccountTokens = async (): Promise<void> => {
  const bridge = getBridge();
  if (!bridge) return;
  const result = await bridge.clear();
  if (!result.success) {
    throw new Error(result.error ?? 'gh-accounts clear failed');
  }
};

/**
 * 把当前 Store 会话的全部账号 Token 幂等同步到桌面端安全存储（fire-and-forget）。
 * savedAccounts 的 githubToken 是唯一来源；顶层 githubToken 兜底并入当前账号，
 * 防止登记时序竞态把当前会话 Token 漏出加密文件。Web 构建（无桥）为 no-op。
 */
export const syncGhAccountTokensFromState = (state: {
  user: { id: number } | null;
  githubToken: string | null;
  savedAccounts: Record<string, { githubToken: string }>;
}): void => {
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
  saveGhAccountTokens(tokens).catch(() => {
    // 加密文件写失败不阻断会话：下次 Token 变更时重试；期间重启丢失 Token
    // 的账号按“需重新授权”处理。
  });
};
