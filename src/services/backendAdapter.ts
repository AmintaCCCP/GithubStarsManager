import { translateBackendError } from '../utils/backendErrors';
import { normalizeBackendUrl } from '../utils/backendUrl';
import { logger } from './logger';
import { setBackendAvailability, setBackendProbed } from './scrapeSupport';

import { Repository, Release, AIConfig, WebDAVConfig, EmbeddingConfig, VectorSearchConfig, GitHubUser } from '../types';
import { useAppStore } from '../store/useAppStore';
import { accountIdKey, getAccountSessionGeneration } from '../store/helpers/accountWorkspace';
import { isReadmeCandidateItem, type GitHubReadmeCandidateItem } from '../utils/readmeVariants';

interface GitHubContentResponse {
  content?: string;
  encoding?: string;
}

interface GitHubTreeResponse {
  tree?: GitHubReadmeCandidateItem[];
  truncated?: boolean;
}

/** POST /api/sync/auth 的多账号响应（Issue #611）。 */
export interface BackendAuthRestoreAccount {
  accountId: string;
  user: GitHubUser | null;
  githubToken: string | null;
  addedAt?: string | null;
  lastUsedAt?: string | null;
}

/**
 * 后端返回的已保存账号条目有效性校验（Issue #611 审计修复）。
 * 所有登记 savedAccounts 的后端登录路径（tryRestoreAuthFromBackend /
 * 登录页 handleBackendConnect / addAccountFromBackend）必须共用同一过滤规则：
 * accountId 为字符串、Token 非空字符串、user 满足完整 GitHubUser 契约。
 * 返回类型同时收窄 user/githubToken 非空，调用方无需重复判空。
 *
 * user 字段校验/补齐策略（审计修复 C10，选定「补齐默认值」而非整条拒绝）：
 * - id：数字且与 accountId 一致（不一致无法归一，整条拒绝）；
 * - login：非空字符串（缺失/空串无法展示身份，整条拒绝）；
 * - name：非字符串时补齐为 login（UI 均以 `name || login` 兜底展示）；
 * - avatar_url：非字符串时补齐为 ''（头像渲染失败但不阻塞账号登记）；
 * - email：字段缺失时补齐为 null（GitHubUser 契约允许值为 null，但键必须存在，
 *   否则守卫收窄的 GitHubUser 类型与实际对象不一致）。
 */
export const isValidBackendRestoreAccount = (
  account: unknown,
): account is BackendAuthRestoreAccount & { user: GitHubUser; githubToken: string } => {
  if (!account || typeof account !== 'object') return false;
  const record = account as Partial<BackendAuthRestoreAccount>;
  if (
    typeof record.accountId !== 'string'
    || typeof record.githubToken !== 'string'
    || record.githubToken.trim().length === 0
    || !record.user
    || typeof record.user !== 'object'
  ) {
    return false;
  }
  if (
    typeof record.user.id !== 'number'
    || !Number.isFinite(record.user.id)
    || String(record.user.id) !== record.accountId
    || typeof record.user.login !== 'string'
    || record.user.login.trim().length === 0
  ) {
    return false;
  }
  // 类型收窄与实际校验一致：以下字段按「补齐默认值」策略规整为 GitHubUser
  // 契约形状（name/avatar_url 字符串、email 键存在且值可为 null）。
  const normalizedUser = record.user as GitHubUser & { email?: unknown };
  if (typeof normalizedUser.name !== 'string') normalizedUser.name = normalizedUser.login;
  if (typeof normalizedUser.avatar_url !== 'string') normalizedUser.avatar_url = '';
  // R2-C16：email 是字符串时保留；缺失或非字符串（含数字）一律规范化为 null，
  // 保证收窄后的 GitHubUser 契约与实际对象一致。
  if (typeof normalizedUser.email !== 'string') normalizedUser.email = null;
  return true;
};

/**
 * R2-C12：恢复条目的异步归一化（服务端 authRestore.ts 返回 user:null 的客户端
 * 半边）。只有分区 PAT、没有 accounts 行的账号在新设备上 user 为 null，会被
 * 同步守卫 isValidBackendRestoreAccount 拒绝，导致账号列表缺项。
 *
 * 处理：accountId、Token 有效且 user 缺失/null 时，用该 PAT 直连 GitHub /user
 * 核对身份——返回的 user.id 必须等于 accountId，通过后构造完整 GitHubUser；
 * 身份不一致、请求失败或 user 结构不合法一律拒绝（绝不把未核实条目登记）。
 * 已经完整的条目直接复用同步守卫（含默认值补齐），存在但无效的 user 不回查。
 */
export const normalizeBackendRestoreAccount = async (
  account: unknown,
): Promise<(BackendAuthRestoreAccount & { user: GitHubUser; githubToken: string }) | null> => {
  if (isValidBackendRestoreAccount(account)) return account;
  if (!account || typeof account !== 'object') return null;
  const record = account as Partial<BackendAuthRestoreAccount>;
  if (
    typeof record.accountId !== 'string'
    || !/^\d+$/.test(record.accountId)
    || typeof record.githubToken !== 'string'
    || record.githubToken.trim().length === 0
  ) {
    return null;
  }
  // 只归一化「无 user」条目；存在但无效的 user 不回查覆盖。
  if (record.user !== null && record.user !== undefined) return null;
  // 直连 GitHub 核对分区 PAT 的真实身份（不能用后端代理：代理读到的是服务端
  // 保存的 Token，可能属于另一个账号；这里必须验证条目自身携带的 PAT）。
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `token ${record.githubToken}`,
        Accept: 'application/vnd.github+json',
      },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const user = await res.json() as GitHubUser;
    if (!user || typeof user.id !== 'number' || !Number.isFinite(user.id)) return null;
    if (String(user.id) !== record.accountId) return null;
    if (typeof user.login !== 'string' || user.login.trim().length === 0) return null;
    return {
      ...record,
      accountId: record.accountId,
      githubToken: record.githubToken,
      user: {
        ...user,
        name: typeof user.name === 'string' ? user.name : user.login,
        avatar_url: typeof user.avatar_url === 'string' ? user.avatar_url : '',
        email: typeof user.email === 'string' ? user.email : null,
      },
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
};

export interface BackendAuthRestore {
  github_token: string | null;
  active_account_id?: string;
  accounts?: BackendAuthRestoreAccount[];
}

const BACKEND_URL_STORAGE_KEY = 'github-stars-manager-backend-url';

const JSON_ARRAY_SETTING_KEYS = new Set([
  'hiddenDefaultCategoryIds',
  'categoryOrder',
  'customCategories',
  'assetFilters',
]);
const JSON_OBJECT_SETTING_KEYS = new Set([
  'releaseSourceSettings',
  'defaultCategoryOverrides',
]);

/**
 * Parse a SQLite TEXT setting back into an object or array.
 * Typed values and malformed JSON are returned unchanged.
 */
const parseJsonSetting = (value: unknown, expect: 'object' | 'array'): unknown => {
  if (typeof value !== 'string') return value;
  try {
    const parsed = JSON.parse(value);
    if (expect === 'array' && Array.isArray(parsed)) return parsed;
    if (expect === 'object' && parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    return value;
  }
  return value;
};

/**
 * Hydrate backend settings whose object/array values were stored as JSON TEXT.
 */
const hydrateBackendSettings = (settings: Record<string, unknown>): Record<string, unknown> => {
  const next = { ...settings };
  for (const key of JSON_ARRAY_SETTING_KEYS) {
    if (key in next) next[key] = parseJsonSetting(next[key], 'array');
  }
  for (const key of JSON_OBJECT_SETTING_KEYS) {
    if (key in next) next[key] = parseJsonSetting(next[key], 'object');
  }
  if (typeof next.collapsedSidebarCategoryCount === 'string') {
    const parsed = Number(next.collapsedSidebarCategoryCount);
    if (Number.isFinite(parsed) && parsed >= 1) next.collapsedSidebarCategoryCount = parsed;
  }
  return next;
};

/**
 * 共享 helper：构造后端 API 鉴权头（fullstack Web 模式下 API_SECRET 的
 * `Authorization: Bearer ...`）。服务端 `authMiddleware` 对所有 `/api/*`
 * （除 health）要求该头，直接 `fetch(backendUrl/...)` 的传输层必须复用它，
 * 否则在配置 API_SECRET 时一律 401。
 *
 * 多账号隔离（Issue #611）：自动附加 `X-GitHub-Account-Id` 请求头（当前活跃
 * 账号的 GitHub 数值 ID）。`explicitAccountId` 用于在切换会话中显式指定账号
 * （传 null 表示无账号上下文）；缺省时读取 Store 当前登录用户。
 */
export const getBackendAuthHeaders = (explicitAccountId?: string | null): Record<string, string> => {
  let secret = '';
  try {
    secret = useAppStore.getState().backendApiSecret || '';
  } catch {
    secret = '';
  }
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (secret) {
    headers['Authorization'] = `Bearer ${secret}`;
  }
  let accountId: string | null = null;
  try {
    accountId = explicitAccountId !== undefined
      ? explicitAccountId
      : accountIdKey(useAppStore.getState().user);
  } catch {
    accountId = null;
  }
  if (accountId) {
    headers['X-GitHub-Account-Id'] = accountId;
  }
  return headers;
};

const readStoredBackendUrl = (): string | null => {
  try {
    return normalizeBackendUrl(localStorage.getItem(BACKEND_URL_STORAGE_KEY) || '');
  } catch {
    return null;
  }
};

class BackendAdapter {
  private _backendUrl: string | null = null;
  private _availabilityListeners = new Set<() => void>();
  private _beforeInitHook: (() => Promise<void>) | null = null;

  registerBeforeInitHook(fn: () => Promise<void>): void {
    this._beforeInitHook = fn;
  }

  /**
   * 订阅可用性结论变化（init 探测结束或可用性翻转时触发）。返回取消订阅
   * 函数，供 useSyncExternalStore 等 UI 侧响应式使用。
   */
  subscribeAvailability(listener: () => void): () => void {
    this._availabilityListeners.add(listener);
    return () => this._availabilityListeners.delete(listener);
  }

  private commitBackendUrl(url: string | null): void {
    if (this._backendUrl === url) return;
    this._backendUrl = url;
    setBackendAvailability(url !== null);
  }

  async init(preferredUrl?: string): Promise<void> {
    if (this._beforeInitHook) {
      try {
        await this._beforeInitHook();
      } catch {
        // Ignore hook errors so init can proceed
      }
    }
    try {
      const configuredUrl = preferredUrl ? normalizeBackendUrl(preferredUrl) : readStoredBackendUrl();
      // Same-origin probing only makes sense when the UI itself is served over
      // HTTP(S) (nginx fullstack image / vite dev server). The desktop client
      // loads the bundle from `file://`, where `location.origin` is `file://`
      // and `${origin}/api` becomes `file:///api` — Chromium logs every probe
      // as `net::ERR_FILE_NOT_FOUND` before falling back to local-only mode.
      const sameOriginApiUrl = (() => {
        const { protocol, origin } = window.location;
        return protocol === 'http:' || protocol === 'https:' ? `${origin}/api` : null;
      })();
      const urls = preferredUrl
        ? (configuredUrl ? [configuredUrl] : [])
        : (configuredUrl ? [configuredUrl] : (sameOriginApiUrl ? [sameOriginApiUrl] : []));
      if (!preferredUrl && !configuredUrl && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
        urls.push('http://localhost:3000/api');
      }

      for (const baseUrl of urls) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        try {
          // redirect: 'error' — a 307/308 must never bounce the probe (or any
          // later authenticated request) to a different, possibly plaintext,
          // destination.
          const res = await fetch(`${baseUrl}/health`, {
            signal: controller.signal,
            redirect: 'error',
          });

          if (res.ok) {
            const data = await res.json();
            if (data.status === 'ok') {
              // In-memory commit only. Persistence is an explicit caller
              // decision (rememberActiveUrl) after its own auth checks, so a
              // candidate that later fails authentication is never remembered.
              this.commitBackendUrl(baseUrl);
              logger.info('backendAdapter', 'Backend connected', { url: baseUrl });
              return;
            }
          }
        } catch {
          // Try next URL
        } finally {
          clearTimeout(timeoutId);
        }
      }

      this.commitBackendUrl(null);
      logger.info('backendAdapter', 'Backend not available, using local-only mode');
    } catch {
      this.commitBackendUrl(null);
      logger.info('backendAdapter', 'Backend not available, using local-only mode');
    } finally {
      // 探测结束：标记结论已落定并通知订阅者。即使可用性没有翻转
      // （如纯浏览器模式保持 null），订阅方也需要重新取值。
      setBackendProbed();
      for (const listener of this._availabilityListeners) listener();
    }
  }

  get isAvailable(): boolean {
    return this._backendUrl !== null;
  }

  get backendUrl(): string | null {
    return this._backendUrl;
  }

  /** 供直接 fetch 后端路由的传输层复用（公开版 getAuthHeaders）。 */
  get backendAuthHeaders(): Record<string, string> {
    return getBackendAuthHeaders();
  }

  get configuredUrl(): string | null {
    return this._backendUrl || readStoredBackendUrl();
  }

  /**
   * Persist the active backend URL (the same storage the login screen prefills
   * from). Call only after caller-side checks — auth, session restore — have
   * fully succeeded; init() itself never persists candidate URLs.
   */
  rememberActiveUrl(): void {
    if (!this._backendUrl) return;
    try {
      localStorage.setItem(BACKEND_URL_STORAGE_KEY, this._backendUrl);
    } catch {
      // A restricted browser may block storage; keep this session connected.
    }
  }

  /** 读取持久化的后端 URL（登录页预填与 init 自动探测共用）。 */
  get persistedUrl(): string | null {
    return readStoredBackendUrl();
  }

  /**
   * 显式写入/清除持久化的后端 URL（审计修复 C63：候选后端恢复失败回滚时，
   * 把 rememberActiveUrl 保存的候选 URL 还原为恢复前的值，null 表示移除）。
   */
  persistUrl(url: string | null): void {
    try {
      if (url) {
        localStorage.setItem(BACKEND_URL_STORAGE_KEY, url);
      } else {
        localStorage.removeItem(BACKEND_URL_STORAGE_KEY);
      }
    } catch {
      // A restricted browser may block storage; ignore.
    }
  }

  /**
   * 显式断开连接、回到本地模式（审计修复 C63）：回滚原连接为 null 时使用，
   * 绝不经 init(undefined) 触发候选后端自动探测——自动探测会读取刚保存的
   * 候选 URL 并把回滚悄悄连回候选后端。
   */
  disconnect(): void {
    this.commitBackendUrl(null);
    setBackendProbed();
    for (const listener of this._availabilityListeners) listener();
  }

  private getAuthHeaders(): Record<string, string> {
    return getBackendAuthHeaders();
  }
  private async fetchWithTimeout(url: string, options?: RequestInit, timeoutMs = 30000): Promise<Response> {
    const startTime = Date.now();
    const method = (options?.method || 'GET').toUpperCase();
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    // If the caller provides a signal, forward its abort to our internal controller
    const callerSignal = options?.signal;
    if (callerSignal) {
      if (callerSignal.aborted) {
        controller.abort();
      } else {
        callerSignal.addEventListener('abort', () => controller.abort(), { once: true });
      }
    }

    // Capture request details for debug logging
    let requestHeaders: Record<string, string> | undefined;
    let requestBody: string | undefined;
    if (logger.isDebugMode()) {
      if (options?.headers) {
        if (options.headers instanceof Headers) {
          requestHeaders = {};
          options.headers.forEach((v, k) => { requestHeaders![k] = k.toLowerCase() === 'authorization' ? '***' : v; });
        } else if (Array.isArray(options.headers)) {
          requestHeaders = {};
          for (const [k, v] of options.headers) {
            requestHeaders[k] = k.toLowerCase() === 'authorization' ? '***' : v;
          }
        } else {
          requestHeaders = {};
          for (const [k, v] of Object.entries(options.headers as Record<string, string>)) {
            requestHeaders[k] = k.toLowerCase() === 'authorization' ? '***' : v;
          }
        }
      }
      if (typeof options?.body === 'string') {
        try {
          const parsed = JSON.parse(options.body);
          // Mask any apiKey/password fields recursively
          requestBody = JSON.stringify(parsed, (key, val) => {
            if (/api[_-]?key|password|secret|token|authorization|mcp/i.test(key)) return '***';
            if (typeof val === 'string' && val.startsWith('gsm_mcp_')) return '***';
            return val;
          }, 2);
        } catch {
          requestBody = options.body.slice(0, 2000);
        }
      }
    }

    try {
      const response = await fetch(url, { ...options, signal: controller.signal, redirect: 'error' });
      if (logger.isDebugMode()) {
        // Capture response headers
        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((v, k) => { responseHeaders[k] = v; });
        // Capture response body preview (clone to avoid consuming)
        let responseBody: string | undefined;
        // /sync/auth returns every saved account's plaintext GitHub token. Log
        // only status/timing there: a truncated >4000-char JSON fails to parse
        // and falls through to a redaction pass that cannot see those tokens.
        if (!path.split('?')[0].endsWith('/sync/auth')) {
          try {
            const cloned = response.clone();
            const text = await cloned.text();
            if (text.length > 0) {
              const preview = text.length > 4000 ? text.slice(0, 4000) + '...[truncated]' : text;
              // Redact secrets inside JSON (e.g. /mcp/status returns { token: "gsm_mcp_…" })
              try {
                const parsed = JSON.parse(preview.endsWith('...[truncated]') ? text.slice(0, 4000) : preview);
                responseBody = JSON.stringify(parsed, (key, val) => {
                  if (/api[_-]?key|password|secret|token|authorization|mcp/i.test(key)) return '***';
                  if (typeof val === 'string' && val.startsWith('gsm_mcp_')) return '***';
                  return val;
                }, 2);
                if (text.length > 4000) responseBody += '\n...[truncated]';
              } catch {
                // Non-JSON: strip gsm_mcp_ tokens if present
                responseBody = preview.replace(/gsm_mcp_[A-Za-z0-9_-]+/g, 'gsm_mcp_***');
              }
            }
          } catch { /* body not readable */ }
        }
        logger.debug('backendAdapter', 'Backend request', {
          method, path, status: response.status, durationMs: Date.now() - startTime,
          requestHeaders, requestBody, responseHeaders, responseBody,
        });
      }
      return response;
    } catch (err) {
      if (logger.isDebugMode()) {
        logger.debug('backendAdapter', 'Backend request', {
          method, path, error: 'timeout/network error', durationMs: Date.now() - startTime,
          requestHeaders, requestBody,
        });
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Retry wrapper with exponential backoff for transient network errors.
   * Covers browser fetch (Chrome/Firefox/Safari) and Node.js undici fetch.
   */
  private async fetchWithRetry(url: string, options?: RequestInit, timeoutMs = 30000, maxRetries = 3): Promise<Response> {
    const retryStartTime = Date.now();
    const method = (options?.method || 'GET').toUpperCase();
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.fetchWithTimeout(url, options, timeoutMs);
      } catch (err) {
        lastError = err as Error;
        const isRetryable =
          lastError.name === 'AbortError' ||
          // Browser messages: Chrome/Edge "Failed to fetch", Firefox "NetworkError...", Safari "Load failed"
          lastError.message?.includes('Failed to fetch') ||
          lastError.message?.includes('NetworkError') ||
          lastError.message?.includes('Load failed') ||
          // Node.js undici: message is "fetch failed", real code is in error.cause
          lastError.message === 'fetch failed' ||
          (lastError as { cause?: { code?: string } }).cause?.code === 'ECONNRESET' ||
          (lastError as { cause?: { code?: string } }).cause?.code === 'ECONNREFUSED' ||
          (lastError as { cause?: { code?: string } }).cause?.code === 'UND_ERR_SOCKET' ||
          (lastError as { cause?: { code?: string } }).cause?.code === 'UND_ERR_CONNECT_TIMEOUT' ||
          (lastError as { cause?: { code?: string } }).cause?.code === 'UND_ERR_HEADERS_TIMEOUT';
        if (!isRetryable || attempt === maxRetries) throw lastError;
        // Exponential backoff: 1s, 2s, 4s
        const delay = Math.min(1000 * Math.pow(2, attempt), 4000);
        logger.warn('backendAdapter', 'Sync request failed, retrying', { attempt: attempt + 1, maxRetries: maxRetries + 1, delayMs: delay, durationMs: Date.now() - retryStartTime, method, path });
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    throw lastError!;
  }
  private async throwTranslatedError(res: Response, fallbackPrefix: string): Promise<never> {
    let code: string | undefined;
    let detail = '';
    try {
      const data = await res.json();
      code = data.code;
      // Extract nested error details (e.g., DeepSeek returns { error: { message, type, code } })
      if (data.error) {
        const err = data.error;
        detail = typeof err === 'string' ? err : (err.message || JSON.stringify(err));
      } else if (data.message) {
        detail = data.message;
      }
    } catch { /* body not JSON */ }
    const translated = translateBackendError(code, `${fallbackPrefix}: ${res.status}`);
    const error = new Error(detail ? `${translated} - ${detail}` : translated) as Error & { statusCode?: number; code?: string; retryAfterMs?: number };
    error.statusCode = res.status;
    if (code) error.code = code;
    // 后端透传上游 Retry-After 头后，这里解析成毫秒供限流器使用（retry-after-ms 为毫秒，retry-after 为秒）
    if (res.status === 429) {
      const retryAfterMsHeader = res.headers.get('retry-after-ms');
      if (retryAfterMsHeader) {
        const v = Number(retryAfterMsHeader);
        if (Number.isFinite(v) && v > 0) error.retryAfterMs = Math.round(v);
      } else {
        const retryAfter = res.headers.get('retry-after');
        if (retryAfter) {
          // Retry-After 可能是「秒数」或「HTTP-date」；数值解析失败时按日期计算剩余时长
          const numeric = Number(retryAfter);
          if (Number.isFinite(numeric) && numeric > 0) {
            error.retryAfterMs = Math.round(numeric * 1000);
          } else {
            const parsedDate = Date.parse(retryAfter);
            if (!Number.isNaN(parsedDate)) {
              const remaining = parsedDate - Date.now();
              if (remaining > 0) error.retryAfterMs = Math.round(remaining);
            }
          }
        }
      }
    }
    throw error;
  }

  // === GitHub Proxy ===

  async fetchStarredRepos(page = 1, perPage = 100): Promise<Repository[]> {
    if (!this._backendUrl) throw new Error('Backend not available');

    const res = await this.fetchWithTimeout(`${this._backendUrl}/proxy/github/user/starred?page=${page}&per_page=${perPage}&sort=updated`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({
        method: 'GET',
        headers: { 'Accept': 'application/vnd.github.star+json' }
      })
    });
    if (!res.ok) await this.throwTranslatedError(res, 'Backend proxy error');
    const data = await res.json();
    return (data as Record<string, unknown>[]).map((item) =>
      (item as { starred_at?: string; repo?: Repository }).starred_at && (item as { repo?: Repository }).repo
        ? { ...((item as { repo: Repository }).repo), starred_at: (item as { starred_at: string }).starred_at }
        : item as unknown as Repository
    );
  }

  async getCurrentUser(): Promise<Record<string, unknown>> {
    if (!this._backendUrl) throw new Error('Backend not available');

    const res = await this.fetchWithTimeout(`${this._backendUrl}/proxy/github/user`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ method: 'GET' })
    });
    if (!res.ok) await this.throwTranslatedError(res, 'Backend proxy error');
    return res.json() as Promise<Record<string, unknown>>;
  }

  private decodeContentResponse(data: GitHubContentResponse): string {
    if (data.encoding === 'base64' && data.content) {
      const binaryStr = atob(data.content.replace(/\s/g, ''));
      const bytes = Uint8Array.from(binaryStr, c => c.charCodeAt(0));
      return new TextDecoder('utf-8').decode(bytes);
    }
    return data.content || '';
  }

  private encodeContentPath(path: string): string {
    return path.split('/').map(encodeURIComponent).join('/');
  }

  async getRepositoryReadme(owner: string, repo: string, signal?: AbortSignal): Promise<string> {
    if (!this._backendUrl) throw new Error('Backend not available');

    const res = await this.fetchWithTimeout(`${this._backendUrl}/proxy/github/repos/${owner}/${repo}/readme`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ method: 'GET' }),
      signal,
    });
    if (res.status === 404) return '';
    if (!res.ok) await this.throwTranslatedError(res, 'Backend proxy error');
    const data = await res.json() as GitHubContentResponse;
    return this.decodeContentResponse(data);
  }

  async listRepositoryReadmeCandidates(owner: string, repo: string, defaultBranch?: string, signal?: AbortSignal): Promise<GitHubReadmeCandidateItem[]> {
    if (!this._backendUrl) throw new Error('Backend not available');

    // 一次操作内的多次代理读取必须固定同一个账号与后端地址：默认分支/tree/根目录
    // 分别读取 Store 会在切号或切换后端后把旧凭据发往新地址或新分区。
    const backendUrl = this._backendUrl;
    const headers = this.getAuthHeaders();

    // 审计修复（C11）：账号切换（即使 backendUrl 不变）必须使在途候选请求失效。
    // 记录发起时的账号 ID 与会话代次，每一步请求前与返回前复核；失效时中止
    // 在途请求并返回空列表——调用方（ReadmeModal）拿到空候选不会应用旧账号的
    // 分支结果，具体「过期标记」的消费属 UI 组件职责（见 HANDOFF-B-TO-C.md
    // C 实现记录）。
    const startedAccountId = accountIdKey(useAppStore.getState().user);
    const startedGeneration = getAccountSessionGeneration();
    const sessionController = new AbortController();
    if (signal) {
      if (signal.aborted) sessionController.abort();
      else signal.addEventListener('abort', () => sessionController.abort(), { once: true });
    }
    const isSessionStale = (): boolean => {
      if (sessionController.signal.aborted) return true;
      try {
        return accountIdKey(useAppStore.getState().user) !== startedAccountId
          || getAccountSessionGeneration() !== startedGeneration;
      } catch {
        return false;
      }
    };
    // R2-C14：根目录与递归 tree 两条路径共用同一有效性检查——账号、会话代次
    // 或后端 URL 任一变化都必须丢弃结果（后端切换后旧地址的数据绝不混入）。
    const isRequestStale = (): boolean => isSessionStale() || this._backendUrl !== backendUrl;

    const fetchRootContents = async (): Promise<GitHubReadmeCandidateItem[]> => {
      if (isRequestStale()) return [];
      const res = await this.fetchWithTimeout(`${backendUrl}/proxy/github/repos/${owner}/${repo}/contents`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ method: 'GET' }),
        signal: sessionController.signal,
      });
      if (!res.ok || isRequestStale()) return [];
      const data = await res.json() as GitHubReadmeCandidateItem[];
      // 正文解析完成后、返回前再复核：解析期间切号/切后端必须丢弃结果。
      if (isRequestStale()) return [];
      return data.filter(isReadmeCandidateItem);
    };

    let branch = defaultBranch;
    if (!branch) {
      try {
        if (isRequestStale()) return [];
        const repoRes = await this.fetchWithTimeout(`${backendUrl}/proxy/github/repos/${owner}/${repo}`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ method: 'GET' }),
          signal: sessionController.signal,
        });
        // R2-C15：会话仍有效时，详情读取失败只放弃默认分支探测，继续走
        // fetchRootContents 兜底；仅会话失效才提前返回。
        if (!repoRes.ok) {
          if (isRequestStale()) return [];
          throw new Error('Repository details unavailable; falling back to root contents');
        }
        if (isRequestStale()) return [];
        const repoDetails = await repoRes.json() as { default_branch?: string };
        branch = repoDetails.default_branch;
        if (isRequestStale()) return [];
      } catch {
        if (isRequestStale()) return [];
        // Fall back to root contents below
      }
    }

    if (!branch) {
      try {
        return await fetchRootContents();
      } catch {
        return [];
      }
    }

    try {
      if (isRequestStale()) return [];
      const res = await this.fetchWithTimeout(`${backendUrl}/proxy/github/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ method: 'GET' }),
        signal: sessionController.signal,
      });
      if (!res.ok || isRequestStale()) return await fetchRootContents();
      const data = await res.json() as GitHubTreeResponse;
      const candidates = (data.tree || []).filter(isReadmeCandidateItem);
      // R2-C14：正文解析完成后、返回前统一复核账号/会话代次/后端 URL。
      if (isRequestStale()) return [];
      if (data.truncated) {
        logger.warn('backendAdapter', 'README candidate tree was truncated', { owner, repo });
        if (candidates.length === 0) return await fetchRootContents();
      }
      return candidates;
    } catch {
      if (isRequestStale()) return [];
      try {
        return await fetchRootContents();
      } catch {
        return [];
      }
    }
  }

  async getRepositoryReadmeByPath(owner: string, repo: string, path: string, signal?: AbortSignal): Promise<string> {
    if (!this._backendUrl) throw new Error('Backend not available');

    const res = await this.fetchWithTimeout(`${this._backendUrl}/proxy/github/repos/${owner}/${repo}/contents/${this.encodeContentPath(path)}`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ method: 'GET' }),
      signal,
    });
    if (res.status === 404) return '';
    if (!res.ok) await this.throwTranslatedError(res, 'Backend proxy error');
    const data = await res.json() as GitHubContentResponse;
    return this.decodeContentResponse(data);
  }

  async getRepositoryReleases(
    owner: string,
    repo: string,
    page = 1,
    perPage = 30,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>[]> {
    if (!this._backendUrl) throw new Error('Backend not available');

    const res = await this.fetchWithTimeout(`${this._backendUrl}/proxy/github/repos/${owner}/${repo}/releases?page=${page}&per_page=${perPage}`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ method: 'GET' }),
      signal,
    });
    if (!res.ok) await this.throwTranslatedError(res, 'Backend proxy error');

    const data = await res.json() as unknown;
    if (!Array.isArray(data)) {
      throw new Error('Backend proxy returned an invalid releases response');
    }
    return data as Record<string, unknown>[];
  }

  async downloadGitHubResource(path: string, signal?: AbortSignal): Promise<Blob> {
    if (!this._backendUrl) throw new Error('Backend not available');
    if (!path.startsWith('/repos/')) throw new Error('Invalid GitHub resource path');

    const res = await this.fetchWithTimeout(`${this._backendUrl}/proxy/github${path}`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({
        method: 'GET',
        headers: { Accept: 'application/octet-stream' },
      }),
      signal,
    });
    if (!res.ok) await this.throwTranslatedError(res, 'Backend proxy download error');
    return res.blob();
  }

  async checkRateLimit(): Promise<{ remaining: number; reset: number }> {
    if (!this._backendUrl) throw new Error('Backend not available');

    const res = await this.fetchWithTimeout(`${this._backendUrl}/proxy/github/rate_limit`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ method: 'GET' })
    });
    if (!res.ok) await this.throwTranslatedError(res, 'Backend proxy error');
    const data = await res.json() as { rate: { remaining: number; reset: number } };
    return { remaining: data.rate.remaining, reset: data.rate.reset };
  }

  // === AI Proxy ===

  async proxyAIRequest(configId: string, body: object, signal?: AbortSignal): Promise<unknown> {
    if (!this._backendUrl) throw new Error('Backend not available');

    const res = await this.fetchWithTimeout(`${this._backendUrl}/proxy/ai`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ configId, body }),
      signal,
    }, 120000);
    if (!res.ok) await this.throwTranslatedError(res, 'AI proxy error');
    return res.json();
  }

  async proxyAIRequestWithConfig(aiConfig: { apiType?: string; baseUrl: string; apiKey: string; model: string; reasoningEffort?: string }, body: object, signal?: AbortSignal): Promise<unknown> {
    if (!this._backendUrl) throw new Error('Backend not available');

    const res = await this.fetchWithTimeout(`${this._backendUrl}/proxy/ai`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ config: aiConfig, body }),
      signal,
    }, 120000);
    if (!res.ok) await this.throwTranslatedError(res, 'AI proxy error');
    return res.json();
  }

  async proxyAIRequestWithFallback(configId: string, aiConfig: { apiType?: string; baseUrl: string; apiKey: string; model: string; reasoningEffort?: string }, body: object, signal?: AbortSignal): Promise<unknown> {
    if (!this._backendUrl) throw new Error('Backend not available');

    // Try configId lookup first to avoid sending API key inline
    if (configId) {
      try {
        const res = await this.fetchWithTimeout(`${this._backendUrl}/proxy/ai`, {
          method: 'POST',
          headers: this.getAuthHeaders(),
          body: JSON.stringify({ configId, body }),
          signal,
        }, 120000);
        if (res.ok) return res.json();
        // Fall through to inline config on 404 (config not synced yet)
        if (res.status !== 404) await this.throwTranslatedError(res, 'AI proxy error');
      } catch (err) {
        // Rethrow non-404 errors; fall through to inline config on config-not-found
        const e = err as Error & { statusCode?: number; code?: string };
        if (e.statusCode !== 404 && e.code !== 'AI_CONFIG_NOT_FOUND') throw err;
      }
    }

    // Fallback: send full config inline
    return this.proxyAIRequestWithConfig(aiConfig, body, signal);
  }

  // === WebDAV Proxy ===

  async proxyWebDAV(
    configId: string,
    method: string,
    path: string,
    body?: string,
    headers?: Record<string, string>,
    inlineConfig?: { url: string; username: string; password: string },
    signal?: AbortSignal,
    timeoutMs?: number,
  ): Promise<Response> {
    if (!this._backendUrl) throw new Error('Backend not available');

    return this.fetchWithTimeout(`${this._backendUrl}/proxy/webdav`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({
        configId, method, path, body, headers,
        // WebDAV 大文件上传可达 300s；不放宽的话代理会先于调用方超时。
        ...(timeoutMs ? { timeoutMs } : {}),
        // 配置尚未同步到后端时（例如"测试连接"发生在保存之前），由前端直接带上凭据
        ...(inlineConfig ? {
          inlineUrl: inlineConfig.url,
          inlineUsername: inlineConfig.username,
          inlinePassword: inlineConfig.password,
        } : {}),
      }),
      ...(signal ? { signal } : {}),
      // 调用方自带的 AbortController 负责业务级超时；这里只兜底一个硬上限，
      // 避免 signal 缺失时请求无限挂起。
    }, timeoutMs ?? 300000);
  }

  // === Data Sync ===

  async syncRepositories(repos: Repository[], options?: { expectedRevision?: number | null }): Promise<void> {
    if (!this._backendUrl) return;

    // 跨端契约 A20x（Issue #612）：全量推送可携带 expectedRevision（来自
    // GET /repositories 响应的 revision）。服务端校验失败时返回 409
    // SNAPSHOT_CONFLICT，调用方（autoSync）负责重新拉取合并后重试。
    const res = await this.fetchWithRetry(`${this._backendUrl}/repositories`, {
      method: 'PUT',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({
        repositories: repos,
        isFullSync: true,
        ...(options?.expectedRevision !== undefined && options.expectedRevision !== null
          ? { expectedRevision: options.expectedRevision }
          : {}),
      }),
    }, 120000, 3);
    if (!res.ok) await this.throwTranslatedError(res, 'Sync repositories error');
  }

  /**
   * 拉取指定账号分区的仓库快照（Issue #612 A20x + 审计修复 C12）：
   * - 返回值携带服务端分区 revision，供全量推送的 expectedRevision 冲突检测；
   * - 分页补齐：后端 >10000 仓库场景按 page 依次读取全部页，完整空列表仍是
   *   有效结果；任一页请求失败或页间 revision 变化导致无法取得完整快照时，
   *   明确抛错（绝不把截断快照当作完整列表交给全量推送/恢复流程）。
   * accountId 显式指定目标分区（登录页显式账号恢复），缺省读取 Store 当前用户。
   */
  async fetchRepositories(accountId?: string | null): Promise<{ repositories: Repository[]; total: number; revision?: number | null }> {
    if (!this._backendUrl) throw new Error('Backend not available');

    const backendUrl = this._backendUrl;
    const headers = getBackendAuthHeaders(accountId);
    const collected: Repository[] = [];
    let total = 0;
    let revision: number | null = null;
    const PAGE_SIZE = 10000;
    for (let page = 1; ; page += 1) {
      const res = await this.fetchWithRetry(`${backendUrl}/repositories?page=${page}&limit=${PAGE_SIZE}`, {
        headers,
      }, 120000, 3);
      if (!res.ok) await this.throwTranslatedError(res, 'Fetch error');
      const data = await res.json() as { repositories?: Repository[]; total?: number; revision?: unknown };
      // R2-C13：分页累计前必须验证响应形状——缺失/非数组的 repositories 拒绝，
      // 绝不默认成 []（会被上游当作「完整空分区」授权破坏性推送/恢复）。
      // 显式 `repositories: []` + `total: 0` 仍是有效空分区。
      if (!Array.isArray(data.repositories)) {
        throw new Error('Invalid backend repositories response: repositories must be an array');
      }
      const pageRepos = data.repositories;
      const pageTotal = typeof data.total === 'number' ? data.total : pageRepos.length;
      const pageRevision = typeof data.revision === 'number' ? data.revision : null;
      if (page === 1) {
        total = pageTotal;
        revision = pageRevision;
      } else if (pageRevision !== null && revision !== null && pageRevision !== revision) {
        // 分页期间分区被其他设备写入：合并结果既非完整也非一致快照
        throw new Error('Repository snapshot changed while paging (revision mismatch)');
      }
      collected.push(...pageRepos);
      const morePages = collected.length < pageTotal;
      if (!morePages) break;
      if (pageRepos.length === 0) {
        // 服务端声明还有更多但本页为空：无法取得完整列表
        throw new Error('Backend reported more repositories than it returned');
      }
      if (page > 1000) {
        throw new Error('Backend repository pagination did not converge');
      }
    }
    if (collected.length < total) {
      throw new Error('Incomplete repository snapshot: fetched fewer repositories than reported total');
    }
    return { repositories: collected, total, revision };
  }

  async syncReleases(releases: Release[]): Promise<void> {
    if (!this._backendUrl) return;

    const res = await this.fetchWithRetry(`${this._backendUrl}/releases`, {
      method: 'PUT',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ releases })
    }, 120000, 3);
    if (!res.ok) await this.throwTranslatedError(res, 'Sync releases error');
  }

  async markAllReleasesAsRead(): Promise<{ updated: number }> {
    if (!this._backendUrl) return { updated: 0 };

    const res = await this.fetchWithRetry(`${this._backendUrl}/releases/mark-all-read`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
    });
    if (!res.ok) await this.throwTranslatedError(res, 'Mark all read error');
    return res.json() as Promise<{ updated: number }>;
  }

  async fetchReleases(accountId?: string | null): Promise<{ releases: Release[]; total: number }> {
    if (!this._backendUrl) throw new Error('Backend not available');

    const res = await this.fetchWithRetry(`${this._backendUrl}/releases?limit=10000`, {
      headers: getBackendAuthHeaders(accountId)
    }, 120000, 3);
    if (!res.ok) await this.throwTranslatedError(res, 'Fetch error');
    return res.json() as Promise<{ releases: Release[]; total: number }>;
  }

  async syncAIConfigs(configs: AIConfig[]): Promise<void> {
    if (!this._backendUrl) return;

    // Pre-sync validation: warn about configs that will likely be skipped
    for (const c of configs) {
      if (!c.apiKey) {
        logger.warn('backendAdapter', 'AI config has empty apiKey, will be skipped', { name: c.name, id: c.id });
      }
    }

    const res = await this.fetchWithRetry(`${this._backendUrl}/configs/ai/bulk`, {
      method: 'PUT',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ configs })
    }, 30000, 3);
    if (!res.ok) await this.throwTranslatedError(res, 'Sync AI configs error');

    // Parse response and throw on partial failure so callers don't clear pending changes
    try {
      const data = await res.json() as { synced?: number; skipped?: number; errors?: Array<{ id: string; name: string; reason: string }> };
      if (data.skipped && data.skipped > 0) {
        const reasons = data.errors?.map(e => `${e.name}: ${e.reason}`).join('; ') ?? '';
        throw new Error(`Sync AI configs partial failure: ${data.skipped} skipped${reasons ? ` (${reasons})` : ''}`);
      }
    } catch (err) {
      // Re-throw our own errors; ignore JSON parse errors from empty responses
      if (err instanceof Error && err.message.startsWith('Sync AI configs partial failure')) throw err;
    }
  }

  async fetchAIConfigs(accountId?: string | null): Promise<AIConfig[]> {
    if (!this._backendUrl) throw new Error('Backend not available');

    const res = await this.fetchWithTimeout(`${this._backendUrl}/configs/ai?decrypt=true`, {
      headers: getBackendAuthHeaders(accountId)
    });
    if (!res.ok) await this.throwTranslatedError(res, 'Fetch AI configs error');
    return res.json() as Promise<AIConfig[]>;
  }

  async syncWebDAVConfigs(configs: WebDAVConfig[]): Promise<void> {
    if (!this._backendUrl) return;

    // Pre-sync validation: warn about configs that will likely be skipped
    for (const c of configs) {
      if (!c.password) {
        logger.warn('backendAdapter', 'WebDAV config has empty password, will be skipped', { name: c.name, id: c.id });
      }
    }

    const res = await this.fetchWithRetry(`${this._backendUrl}/configs/webdav/bulk`, {
      method: 'PUT',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ configs })
    }, 30000, 3);
    if (!res.ok) await this.throwTranslatedError(res, 'Sync WebDAV configs error');

    // Parse response and throw on partial failure so callers don't clear pending changes
    try {
      const data = await res.json() as { synced?: number; skipped?: number; errors?: Array<{ id: string; name: string; reason: string }> };
      if (data.skipped && data.skipped > 0) {
        const reasons = data.errors?.map(e => `${e.name}: ${e.reason}`).join('; ') ?? '';
        throw new Error(`Sync WebDAV configs partial failure: ${data.skipped} skipped${reasons ? ` (${reasons})` : ''}`);
      }
    } catch (err) {
      // Re-throw our own errors; ignore JSON parse errors from empty responses
      if (err instanceof Error && err.message.startsWith('Sync WebDAV configs partial failure')) throw err;
    }
  }

  async fetchWebDAVConfigs(accountId?: string | null): Promise<WebDAVConfig[]> {
    if (!this._backendUrl) throw new Error('Backend not available');

    const res = await this.fetchWithTimeout(`${this._backendUrl}/configs/webdav?decrypt=true`, {
      headers: getBackendAuthHeaders(accountId)
    });
    if (!res.ok) await this.throwTranslatedError(res, 'Fetch WebDAV configs error');
    return res.json() as Promise<WebDAVConfig[]>;
  }

  // === Embedding Configs ===

  async syncEmbeddingConfigs(configs: EmbeddingConfig[]): Promise<void> {
    if (!this._backendUrl) return;

    const res = await this.fetchWithRetry(`${this._backendUrl}/configs/embedding/bulk`, {
      method: 'PUT',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ configs })
    }, 30000, 3);
    if (!res.ok) await this.throwTranslatedError(res, 'Sync embedding configs error');

    try {
      const data = await res.json() as { synced?: number; skipped?: number; errors?: Array<{ id: string; name: string; reason: string }> };
      if (data.skipped && data.skipped > 0) {
        const reasons = data.errors?.map(e => `${e.name}: ${e.reason}`).join('; ') ?? '';
        throw new Error(`Sync embedding configs partial failure: ${data.skipped} skipped${reasons ? ` (${reasons})` : ''}`);
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Sync embedding configs partial failure')) throw err;
    }
  }

  async fetchEmbeddingConfigs(accountId?: string | null): Promise<EmbeddingConfig[]> {
    if (!this._backendUrl) throw new Error('Backend not available');

    const res = await this.fetchWithTimeout(`${this._backendUrl}/configs/embedding?decrypt=true`, {
      headers: getBackendAuthHeaders(accountId)
    });
    if (!res.ok) await this.throwTranslatedError(res, 'Fetch embedding configs error');
    return res.json() as Promise<EmbeddingConfig[]>;
  }

  // === Vector Search Config ===

  async syncVectorSearchConfig(config: VectorSearchConfig): Promise<void> {
    if (!this._backendUrl) return;

    const res = await this.fetchWithRetry(`${this._backendUrl}/configs/vector-search`, {
      method: 'PUT',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(config)
    }, 30000, 3);
    if (!res.ok) await this.throwTranslatedError(res, 'Sync vector search config error');
  }

  async fetchVectorSearchConfig(accountId?: string | null): Promise<VectorSearchConfig> {
    if (!this._backendUrl) throw new Error('Backend not available');

    const res = await this.fetchWithTimeout(`${this._backendUrl}/configs/vector-search?decrypt=true`, {
      headers: getBackendAuthHeaders(accountId)
    });
    if (!res.ok) await this.throwTranslatedError(res, 'Fetch vector search config error');
    return res.json() as Promise<VectorSearchConfig>;
  }


  // === Settings (active selections) ===

  /**
   * Upsert frontend settings in the backend.
   *
   * An optional signal lets startup-only synchronization stop without delaying
   * the rest of application initialization when the backend is unreachable.
   */
  async syncSettings(
    settings: Record<string, unknown>,
    signal?: AbortSignal,
    accountId?: string | null,
  ): Promise<void> {
    if (!this._backendUrl) return;

    const res = await this.fetchWithTimeout(`${this._backendUrl}/settings`, {
      method: 'PUT',
      // accountId 显式指定目标账号（登录/添加流程在 Store 用户落位前写入后端时
      // 必须传入，否则请求头缺 X-GitHub-Account-Id，服务端回退全局
      // active_account_id 分区）；缺省时保持原行为（读取 Store 当前用户）。
      headers: getBackendAuthHeaders(accountId),
      body: JSON.stringify(settings),
      signal,
    });
    if (!res.ok) await this.throwTranslatedError(res, 'Sync settings error');
  }

  /**
   * Fetch frontend settings from the backend and hydrate JSON TEXT values.
   * accountId 显式指定目标分区（登录页显式账号恢复），缺省读取 Store 当前用户。
   */
  async fetchSettings(accountId?: string | null): Promise<Record<string, unknown>> {
    if (!this._backendUrl) throw new Error('Backend not available');

    const res = await this.fetchWithTimeout(`${this._backendUrl}/settings`, {
      headers: getBackendAuthHeaders(accountId)
    });
    if (!res.ok) await this.throwTranslatedError(res, 'Fetch settings error');
    const settings = await res.json();
    if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) {
      throw new Error('invalid settings response');
    }
    return hydrateBackendSettings(settings as Record<string, unknown>);
  }

  async exportData(): Promise<Record<string, unknown>> {
    if (!this._backendUrl) throw new Error('Backend not available');

    const res = await this.fetchWithTimeout(`${this._backendUrl}/sync/export`, {
      method: 'POST',
      headers: this.getAuthHeaders()
    });
    if (!res.ok) await this.throwTranslatedError(res, 'Export error');
    return res.json() as Promise<Record<string, unknown>>;
  }

  async importData(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this._backendUrl) throw new Error('Backend not available');

    const res = await this.fetchWithTimeout(`${this._backendUrl}/sync/import`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(data)
    });
    if (!res.ok) await this.throwTranslatedError(res, 'Import error');
    return res.json() as Promise<Record<string, unknown>>;
  }

  // === Health ===

  async checkHealth(): Promise<{ status: string; version: string; timestamp: string } | null> {
    if (!this._backendUrl) return null;

    try {
      const res = await this.fetchWithTimeout(`${this._backendUrl}/health`, undefined, 5000);
      if (res.ok) return res.json() as Promise<{ status: string; version: string; timestamp: string }>;
      return null;
    } catch {
      return null;
    }
  }

  async verifyAuth(): Promise<boolean> {
    if (!this._backendUrl) return false;

    try {
      const res = await this.fetchWithTimeout(`${this._backendUrl}/settings`, {
        headers: this.getAuthHeaders(),
      }, 5000);
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Restore the GitHub token stored on the backend for cross-browser/device
   * session recovery. Only callable when the backend is reachable AND this
   * client already authenticates (Bearer API_SECRET) — the backend never hands
   * it out to unauthenticated callers.
   *
   * 多账号扩展（Issue #611）：响应额外携带 active_account_id 与后端保存的
   * 全部账号列表 accounts，客户端可一次性恢复 savedAccounts。
   *
   * 候选后端恢复（R4 审计修复）：传 { omitAccountHeader: true } 显式省略
   * X-GitHub-Account-Id。本机仍登录旧账号 A 时若照常携带账号头，服务端会
   * 优先选择 A 分区——候选后端的活跃账号是 B 时返回 github_token: null，
   * 调用方据此误判 github-token-required，B 的有效凭证无法恢复。省略账号头
   * 后服务端回退到后端自己的 active_account_id 分区。Bearer 鉴权与普通
   * 账号定向恢复（缺省读取 Store 账号）均不受影响。
   */
  async restoreAuth(options?: { omitAccountHeader?: boolean }): Promise<BackendAuthRestore | null> {
    if (!this._backendUrl) return null;

    // 审计修复（C9）：恢复响应的正文读取必须与请求共享同一截止时间。
    // fetchWithTimeout 的计时器在响应头返回后即清理，res.json() 若挂起会让
    // tryRestoreAuthFromBackend 的恢复锁永久占用（不可重试）。这里改用调用方
    // AbortController 承载同一 8s 截止时间：中止信号会传导给 fetchWithTimeout
    // 的内部控制器，正文读取挂起时同样被中止；清理在读取结束或失败后进行。
    // 保持不记录恢复正文（fetchWithTimeout 的 /sync/auth 正文跳过逻辑不变）。
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await this.fetchWithTimeout(`${this._backendUrl}/sync/auth`, {
        method: 'POST',
        headers: options?.omitAccountHeader
          ? getBackendAuthHeaders(null)
          : this.getAuthHeaders(),
        signal: controller.signal,
      });
      if (!res.ok) return null;
      return await res.json() as BackendAuthRestore;
    } catch {
      // 超时/网络失败统一返回 null：tryRestoreAuthFromBackend 捕获后释放恢复锁，
      // 流程可重试。
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // === GitHub Search Proxy ===

  async searchRepositories(queryParams: Record<string, string>): Promise<{ items: Repository[] }> {
    if (!this._backendUrl) throw new Error('Backend not available');

    const res = await this.fetchWithTimeout(`${this._backendUrl}/proxy/github/search/repositories`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ query_params: queryParams })
    });
    if (!res.ok) await this.throwTranslatedError(res, 'Search repositories proxy error');
    return res.json() as Promise<{ items: Repository[] }>;
  }

  async searchUsers(queryParams: Record<string, string>): Promise<{ items: Array<{
    login: string;
    avatar_url: string;
    html_url: string;
    name: string | null;
    bio: string | null;
    public_repos: number;
    followers: number;
  }> }> {
    if (!this._backendUrl) throw new Error('Backend not available');

    const res = await this.fetchWithTimeout(`${this._backendUrl}/proxy/github/search/users`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ query_params: queryParams })
    });
    if (!res.ok) await this.throwTranslatedError(res, 'Search users proxy error');
    return res.json() as Promise<{ items: Array<{
      login: string;
      avatar_url: string;
      html_url: string;
      name: string | null;
      bio: string | null;
      public_repos: number;
      followers: number;
    }> }>;
  }

  // === MCP admin (backend-hosted Streamable HTTP / SSE) ===

  async getMcpStatus(): Promise<{
    enabled: boolean;
    token: string;
    endpoints: { streamableHttp: string; sse: string; messages: string };
    vectorAvailable: boolean;
    vectorReason: string | null;
  }> {
    if (!this._backendUrl) throw new Error('Backend not available');
    const res = await this.fetchWithTimeout(`${this._backendUrl}/mcp/status`, {
      headers: this.getAuthHeaders(),
    });
    if (!res.ok) await this.throwTranslatedError(res, 'Fetch MCP status error');
    return res.json();
  }

  async updateMcpConfig(body: {
    enabled?: boolean;
    resetToken?: boolean;
  }): Promise<{
    enabled: boolean;
    token: string;
    endpoints: { streamableHttp: string; sse: string; messages: string };
  }> {
    if (!this._backendUrl) throw new Error('Backend not available');
    const res = await this.fetchWithTimeout(`${this._backendUrl}/mcp/config`, {
      method: 'PUT',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) await this.throwTranslatedError(res, 'Update MCP config error');
    return res.json();
  }
}

export const backend = new BackendAdapter();
