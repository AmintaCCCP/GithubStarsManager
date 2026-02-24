import { translateBackendError } from '../utils/backendErrors';

import { Repository, Release } from '../types';

class BackendAdapter {
  private _backendUrl: string | null = null;

  async init(): Promise<void> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      // Try common backend URLs
      const urls = [
        window.location.origin + '/api',
        'http://localhost:3000/api',
      ];

      for (const baseUrl of urls) {
        try {
          const res = await fetch(`${baseUrl}/health`, {
            signal: controller.signal,
          });

          if (res.ok) {
            const data = await res.json();
            if (data.status === 'ok') {
              this._backendUrl = baseUrl;
              console.log(`✅ Backend connected: ${baseUrl}`);
              clearTimeout(timeoutId);
              return;
            }
          }
        } catch {
          // Try next URL
        }
      }

      clearTimeout(timeoutId);
      this._backendUrl = null;
      console.log('ℹ️ Backend not available, using local-only mode');
    } catch {
      this._backendUrl = null;
      console.log('ℹ️ Backend not available, using local-only mode');
    }
  }

  get isAvailable(): boolean {
    return this._backendUrl !== null;
  }

  get backendUrl(): string | null {
    return this._backendUrl;
  }

  private getAuthHeaders(): Record<string, string> {
    // Read from localStorage directly to avoid circular dependency with store
    const storeData = localStorage.getItem('github-stars-manager');
    let secret = '';
    if (storeData) {
      try {
        const parsed = JSON.parse(storeData);
        secret = parsed.state?.backendApiSecret || '';
      } catch { /* ignore */ }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (secret) {
      headers['Authorization'] = `Bearer ${secret}`;
    }
    return headers;
  }
  private async throwTranslatedError(res: Response, fallbackPrefix: string): Promise<never> {
    let code: string | undefined;
    try {
      const data = await res.json();
      code = data.code;
    } catch { /* body not JSON */ }
    throw new Error(translateBackendError(code, `${fallbackPrefix}: ${res.status}`));
  }

  // === GitHub Proxy ===

  async fetchStarredRepos(page = 1, perPage = 100): Promise<Repository[]> {
    if (!this._backendUrl) throw new Error('Backend not available');

    const res = await fetch(`${this._backendUrl}/proxy/github/user/starred?page=${page}&per_page=${perPage}&sort=updated`, {
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

    const res = await fetch(`${this._backendUrl}/proxy/github/user`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ method: 'GET' })
    });
    if (!res.ok) await this.throwTranslatedError(res, 'Backend proxy error');
    return res.json() as Promise<Record<string, unknown>>;
  }

  async getRepositoryReadme(owner: string, repo: string): Promise<string> {
    if (!this._backendUrl) throw new Error('Backend not available');

    try {
      const res = await fetch(`${this._backendUrl}/proxy/github/repos/${owner}/${repo}/readme`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({ method: 'GET' })
      });
      if (!res.ok) return '';
      const data = await res.json() as { encoding?: string; content?: string };
      if (data.encoding === 'base64' && data.content) {
        return atob(data.content);
      }
      return data.content || '';
    } catch {
      return '';
    }
  }

  async getRepositoryReleases(owner: string, repo: string, page = 1, perPage = 30): Promise<Record<string, unknown>[]> {
    if (!this._backendUrl) throw new Error('Backend not available');

    try {
      const res = await fetch(`${this._backendUrl}/proxy/github/repos/${owner}/${repo}/releases?page=${page}&per_page=${perPage}`, {
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

    const res = await fetch(`${this._backendUrl}/proxy/github/rate_limit`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ method: 'GET' })
    });
    if (!res.ok) await this.throwTranslatedError(res, 'Backend proxy error');
    const data = await res.json() as { rate: { remaining: number; reset: number } };
    return { remaining: data.rate.remaining, reset: data.rate.reset };
  }

  // === AI Proxy ===

  async proxyAIRequest(configId: string, body: object): Promise<unknown> {
    if (!this._backendUrl) throw new Error('Backend not available');

    const res = await fetch(`${this._backendUrl}/proxy/ai`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ configId, body })
    });
    if (!res.ok) await this.throwTranslatedError(res, 'AI proxy error');
    return res.json();
  }

  // === WebDAV Proxy ===

  async proxyWebDAV(configId: string, method: string, path: string, body?: string, headers?: Record<string, string>): Promise<Response> {
    if (!this._backendUrl) throw new Error('Backend not available');

    return fetch(`${this._backendUrl}/proxy/webdav`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ configId, method, path, body, headers })
    });
  }

  // === Data Sync ===

  async syncRepositories(repos: Repository[]): Promise<void> {
    if (!this._backendUrl) return;

    await fetch(`${this._backendUrl}/repositories`, {
      method: 'PUT',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ repositories: repos })
    });
  }

  async fetchRepositories(): Promise<{ repositories: Repository[]; total: number }> {
    if (!this._backendUrl) throw new Error('Backend not available');

    const res = await fetch(`${this._backendUrl}/repositories?limit=10000`, {
      headers: this.getAuthHeaders()
    });
    if (!res.ok) await this.throwTranslatedError(res, 'Fetch error');
    return res.json() as Promise<{ repositories: Repository[]; total: number }>;
  }

  async syncReleases(releases: Release[]): Promise<void> {
    if (!this._backendUrl) return;

    await fetch(`${this._backendUrl}/releases`, {
      method: 'PUT',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ releases })
    });
  }

  async fetchReleases(): Promise<{ releases: Release[]; total: number }> {
    if (!this._backendUrl) throw new Error('Backend not available');

    const res = await fetch(`${this._backendUrl}/releases?limit=10000`, {
      headers: this.getAuthHeaders()
    });
    if (!res.ok) await this.throwTranslatedError(res, 'Fetch error');
    return res.json() as Promise<{ releases: Release[]; total: number }>;
  }

  async exportData(): Promise<Record<string, unknown>> {
    if (!this._backendUrl) throw new Error('Backend not available');

    const res = await fetch(`${this._backendUrl}/sync/export`, {
      method: 'POST',
      headers: this.getAuthHeaders()
    });
    if (!res.ok) await this.throwTranslatedError(res, 'Export error');
    return res.json() as Promise<Record<string, unknown>>;
  }

  async importData(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this._backendUrl) throw new Error('Backend not available');

    const res = await fetch(`${this._backendUrl}/sync/import`, {
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
      const res = await fetch(`${this._backendUrl}/health`);
      if (res.ok) return res.json() as Promise<{ status: string; version: string; timestamp: string }>;
      return null;
    } catch {
      return null;
    }
  }
}

export const backend = new BackendAdapter();
