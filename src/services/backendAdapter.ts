import { translateBackendError } from '../utils/backendErrors';
import { logger } from './logger';

import { Repository, Release, AIConfig, WebDAVConfig, EmbeddingConfig, VectorSearchConfig } from '../types';
import { useAppStore } from '../store/useAppStore';
import { isReadmeCandidateItem, type GitHubReadmeCandidateItem } from '../utils/readmeVariants';

interface GitHubContentResponse {
  content?: string;
  encoding?: string;
}

interface GitHubTreeResponse {
  tree?: GitHubReadmeCandidateItem[];
  truncated?: boolean;
}

class BackendAdapter {
  private _backendUrl: string | null = null;

  async init(): Promise<void> {
    try {
      // Try common backend URLs
      const urls = [
        window.location.origin + '/api',
      ];
      // Only probe localhost in development
      if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        urls.push('http://localhost:3000/api');
      }

      for (const baseUrl of urls) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        try {
          const res = await fetch(`${baseUrl}/health`, {
            signal: controller.signal,
          });

          if (res.ok) {
            const data = await res.json();
            if (data.status === 'ok') {
              this._backendUrl = baseUrl;
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

      this._backendUrl = null;
      logger.info('backendAdapter', 'Backend not available, using local-only mode');
    } catch {
      this._backendUrl = null;
      logger.info('backendAdapter', 'Backend not available, using local-only mode');
    }
  }

  get isAvailable(): boolean {
    return this._backendUrl !== null;
  }

  get backendUrl(): string | null {
    return this._backendUrl;
  }

  private getAuthHeaders(): Record<string, string> {
    const secret = useAppStore.getState().backendApiSecret || '';

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (secret) {
      headers['Authorization'] = `Bearer ${secret}`;
    }
    return headers;
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
            if (/api[_-]?key|password|secret|token|authorization/i.test(key)) return '***';
            return val;
          }, 2);
        } catch {
          requestBody = options.body.slice(0, 2000);
        }
      }
    }

    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      if (logger.isDebugMode()) {
        // Capture response headers
        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((v, k) => { responseHeaders[k] = v; });
        // Capture response body preview (clone to avoid consuming)
        let responseBody: string | undefined;
        try {
          const cloned = response.clone();
          const text = await cloned.text();
          if (text.length > 0) {
            responseBody = text.length > 4000 ? text.slice(0, 4000) + '...[truncated]' : text;
          }
        } catch { /* body not readable */ }
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
    const error = new Error(detail ? `${translated} - ${detail}` : translated) as Error & { statusCode?: number; code?: string };
    error.statusCode = res.status;
    if (code) error.code = code;
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

    const fetchRootContents = async (): Promise<GitHubReadmeCandidateItem[]> => {
      const res = await this.fetchWithTimeout(`${this._backendUrl}/proxy/github/repos/${owner}/${repo}/contents`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({ method: 'GET' }),
        signal,
      });
      if (!res.ok) return [];
      const data = await res.json() as GitHubReadmeCandidateItem[];
      return data.filter(isReadmeCandidateItem);
    };

    let branch = defaultBranch;
    if (!branch) {
      try {
        const repoRes = await this.fetchWithTimeout(`${this._backendUrl}/proxy/github/repos/${owner}/${repo}`, {
          method: 'POST',
          headers: this.getAuthHeaders(),
          body: JSON.stringify({ method: 'GET' }),
          signal,
        });
        if (repoRes.ok) {
          const repoDetails = await repoRes.json() as { default_branch?: string };
          branch = repoDetails.default_branch;
        }
      } catch {
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
      const res = await this.fetchWithTimeout(`${this._backendUrl}/proxy/github/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({ method: 'GET' }),
        signal,
      });
      if (!res.ok) return await fetchRootContents();
      const data = await res.json() as GitHubTreeResponse;
      const candidates = (data.tree || []).filter(isReadmeCandidateItem);
      if (data.truncated) {
        logger.warn('backendAdapter', 'README candidate tree was truncated', { owner, repo });
        if (candidates.length === 0) return await fetchRootContents();
      }
      return candidates;
    } catch {
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

  async getRepositoryReleases(owner: string, repo: string, page = 1, perPage = 30): Promise<Record<string, unknown>[]> {
    if (!this._backendUrl) throw new Error('Backend not available');

    try {
      const res = await this.fetchWithTimeout(`${this._backendUrl}/proxy/github/repos/${owner}/${repo}/releases?page=${page}&per_page=${perPage}`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({ method: 'GET' })
      });
      if (!res.ok) return [];
      return res.json() as Promise<Record<string, unknown>[]>;
    } catch {
      return [];
    }
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

  async proxyWebDAV(configId: string, method: string, path: string, body?: string, headers?: Record<string, string>): Promise<Response> {
    if (!this._backendUrl) throw new Error('Backend not available');

    return this.fetchWithTimeout(`${this._backendUrl}/proxy/webdav`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ configId, method, path, body, headers })
    });
  }

  // === Data Sync ===

  async syncRepositories(repos: Repository[]): Promise<void> {
    if (!this._backendUrl) return;

    const res = await this.fetchWithRetry(`${this._backendUrl}/repositories`, {
      method: 'PUT',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ repositories: repos, isFullSync: true })
    }, 120000, 3);
    if (!res.ok) await this.throwTranslatedError(res, 'Sync repositories error');
  }

  async fetchRepositories(): Promise<{ repositories: Repository[]; total: number }> {
    if (!this._backendUrl) throw new Error('Backend not available');

    const res = await this.fetchWithRetry(`${this._backendUrl}/repositories?limit=10000`, {
      headers: this.getAuthHeaders()
    }, 120000, 3);
    if (!res.ok) await this.throwTranslatedError(res, 'Fetch error');
    return res.json() as Promise<{ repositories: Repository[]; total: number }>;
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

  async fetchReleases(): Promise<{ releases: Release[]; total: number }> {
    if (!this._backendUrl) throw new Error('Backend not available');

    const res = await this.fetchWithRetry(`${this._backendUrl}/releases?limit=10000`, {
      headers: this.getAuthHeaders()
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

  async fetchAIConfigs(): Promise<AIConfig[]> {
    if (!this._backendUrl) throw new Error('Backend not available');

    const res = await this.fetchWithTimeout(`${this._backendUrl}/configs/ai?decrypt=true`, {
      headers: this.getAuthHeaders()
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

  async fetchWebDAVConfigs(): Promise<WebDAVConfig[]> {
    if (!this._backendUrl) throw new Error('Backend not available');

    const res = await this.fetchWithTimeout(`${this._backendUrl}/configs/webdav?decrypt=true`, {
      headers: this.getAuthHeaders()
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

  async fetchEmbeddingConfigs(): Promise<EmbeddingConfig[]> {
    if (!this._backendUrl) throw new Error('Backend not available');

    const res = await this.fetchWithTimeout(`${this._backendUrl}/configs/embedding?decrypt=true`, {
      headers: this.getAuthHeaders()
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

  async fetchVectorSearchConfig(): Promise<VectorSearchConfig> {
    if (!this._backendUrl) throw new Error('Backend not available');

    const res = await this.fetchWithTimeout(`${this._backendUrl}/configs/vector-search?decrypt=true`, {
      headers: this.getAuthHeaders()
    });
    if (!res.ok) await this.throwTranslatedError(res, 'Fetch vector search config error');
    return res.json() as Promise<VectorSearchConfig>;
  }


  // === Settings (active selections) ===

  async syncSettings(settings: Record<string, unknown>): Promise<void> {
    if (!this._backendUrl) return;

    const res = await this.fetchWithTimeout(`${this._backendUrl}/settings`, {
      method: 'PUT',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(settings)
    });
    if (!res.ok) await this.throwTranslatedError(res, 'Sync settings error');
  }

  async fetchSettings(): Promise<Record<string, unknown>> {
    if (!this._backendUrl) throw new Error('Backend not available');

    const res = await this.fetchWithTimeout(`${this._backendUrl}/settings`, {
      headers: this.getAuthHeaders()
    });
    if (!res.ok) await this.throwTranslatedError(res, 'Fetch settings error');
    return res.json() as Promise<Record<string, unknown>>;
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
