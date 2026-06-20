import {
  Repository,
  Gist,
  GistFile,
  Release,
  GitHubUser,
  DiscoveryPlatform,
  ProgrammingLanguage,
  SortBy,
  SortOrder,
  PaginatedDiscoveryRepositories,
  DiscoveryRepo,
  DiscoveryChannelId,
  TopicCategory,
  TrendingTimeRange,
  SubscriptionRepo,
  SubscriptionDev,
  GitHubSearchUserResponse,
  GitHubUserDetail,
  GitHubOrganization,
  ForkRepo,
  WorkflowDefinition,
} from '../types';
import { logger } from './logger';
import { isReadmeCandidateItem, type GitHubReadmeCandidateItem } from '../utils/readmeVariants';

interface GitHubContentResponse {
  content?: string;
  encoding?: string;
}

interface GitHubTreeResponse {
  tree?: GitHubReadmeCandidateItem[];
  truncated?: boolean;
}

interface GitHubStarredItem {
  starred_at?: string;
  repo?: Repository;
  [key: string]: unknown;
}

interface GitHubRateLimitResponse {
  rate: {
    remaining: number;
    reset: number;
  };
}

const GITHUB_API_BASE = 'https://api.github.com';

interface GitHubSearchRepoResponse {
  items: (Repository & { forks_count?: number })[];
  total_count: number;
}

export interface GistFileInput {
  filename: string;
  content: string;
}

export interface GistCreateInput {
  description: string;
  public: boolean;
  files: GistFileInput[];
}

export interface GistUpdateInput {
  description?: string;
  files?: Array<GistFileInput & { previousFilename?: string; deleted?: boolean }>;
}

export interface ReleaseFetchOptions {
  includePreRelease?: boolean;
}

export interface MultipleReleasesResult {
  releases: Release[];
  failedRepos: { repoId: number; full_name: string; error: string }[];
}


export class GitHubApiService {
  private token: string;
  private rateLimitRemaining: number | null = null;
  private rateLimitReset: number | null = null;
  private backendUrl: string | null = null;
  private backendAuthToken: string | null = null;

  constructor(token: string) {
    this.token = token;
  }

  /**
   * 设置后端代理地址。设置后所有请求（makeRequest / getGistFileRaw）将
   * 通过服务器的 /api/proxy/github/* 路由转发，从而走用户配置的代理。
   * 传 null 恢复直连模式。
   */
  setBackendUrl(url: string | null): void {
    this.backendUrl = url;
  }

  setBackendAuthToken(token: string | null): void {
    this.backendAuthToken = token;
  }

  private getBackendHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.backendAuthToken) {
      headers.Authorization = `Bearer ${this.backendAuthToken}`;
    }
    return headers;
  }

  private async makeRequest<T>(endpoint: string, options: RequestInit & { operationTag?: string } = {}, signal?: AbortSignal): Promise<T> {
    const startTime = Date.now();
    const method = (options.method || 'GET') as string;
    const { operationTag, ...fetchOptions } = options;

    // Check rate limit before making request
    if (this.rateLimitRemaining !== null && this.rateLimitRemaining < 100 && this.rateLimitReset !== null) {
      const waitMs = (this.rateLimitReset * 1000) - Date.now();
      if (waitMs > 0) {
        logger.warn('githubApi', 'Rate limit low, waiting for reset', { remaining: this.rateLimitRemaining, resetTime: this.rateLimitReset });
        // Honor abort signal during rate limit wait
        await new Promise<void>((resolve, reject) => {
          const timeoutId = setTimeout(() => resolve(), waitMs + 1000);
          const signalHandler = () => {
            clearTimeout(timeoutId);
            reject(new Error('Aborted'));
          };
          signal?.addEventListener('abort', signalHandler);
          // Also check if already aborted
          if (signal?.aborted) {
            clearTimeout(timeoutId);
            signal?.removeEventListener('abort', signalHandler);
            reject(new Error('Aborted'));
          }
        }).catch(err => {
          if (err.message === 'Aborted') throw err;
        });
      }
    }

    // GitHub 的 gist 等端点偶发 502/503/504（网关瞬时故障），这里对 5xx 做指数退避重试，
    // 退避策略与 backendAdapter.fetchWithRetry 保持一致（1s/2s/4s，最多重试 3 次）。
    const maxRetries = 3;
    let response: Response | undefined;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (this.backendUrl) {
          // 通过后端代理路由：POST {backendUrl}/proxy/github/{endpoint}?query
          // 服务端负责加鉴权头 + 读取代理配置 + 转发，所以客户端不再传 Authorization。
          const proxyUrl = `${this.backendUrl}/proxy/github${endpoint}`;
          const proxyBody: Record<string, unknown> = { method };
          const requestHeaders = fetchOptions.headers as Record<string, string> | undefined;
          // 转发必要头（如 starred repos 需要 star+json，POST/PATCH 需要 JSON Content-Type）
          const acceptHeader = requestHeaders?.Accept || requestHeaders?.accept;
          const contentTypeHeader = requestHeaders?.['Content-Type'] || requestHeaders?.['content-type'];
          const proxyHeaders: Record<string, string> = {};
          if (acceptHeader) proxyHeaders.Accept = acceptHeader;
          if (contentTypeHeader) proxyHeaders['Content-Type'] = contentTypeHeader;
          if (Object.keys(proxyHeaders).length > 0) proxyBody.headers = proxyHeaders;
          if (fetchOptions.body) proxyBody.body = fetchOptions.body;

          response = await fetch(proxyUrl, {
            method: 'POST',
            signal,
            headers: this.getBackendHeaders(),
            body: JSON.stringify(proxyBody),
          });
        } else {
          response = await fetch(`${GITHUB_API_BASE}${endpoint}`, {
            ...fetchOptions,
            signal,
            headers: {
              'Authorization': `Bearer ${this.token}`,
              'Accept': 'application/vnd.github.v3+json',
              'X-GitHub-Api-Version': '2022-11-28',
              ...fetchOptions.headers,
            },
          });
        }
      } catch (fetchError) {
        const durationMs = Date.now() - startTime;
        // 网络错误（连接断开、DNS 超时、socket hang-up 等）视为可重试的瞬时故障，
        // 仅在最后一次尝试时抛出；之前的尝试会继续走指数退避重试。
        if (attempt === maxRetries || signal?.aborted) {
          logger.error('githubApi', 'API request network error', { method, endpoint, durationMs, attempt: attempt + 1, maxRetries: maxRetries + 1, error: fetchError instanceof Error ? fetchError.message : String(fetchError) });
          throw fetchError;
        }
        logger.warn('githubApi', 'API request network error, retrying', { method, endpoint, attempt: attempt + 1, maxRetries: maxRetries + 1, durationMs, error: fetchError instanceof Error ? fetchError.message : String(fetchError) });
        const delayMs = Math.min(1000 * Math.pow(2, attempt), 4000);
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => {
            clearTimeout(timeoutId);
            signal?.removeEventListener('abort', onAbort);
            reject(new Error('Aborted'));
          };
          const timeoutId = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
          }, delayMs);
          signal?.addEventListener('abort', onAbort);
          if (signal?.aborted) onAbort();
        });
        continue;
      }

      // Parse rate limit headers
      const remaining = response.headers.get('X-RateLimit-Remaining');
      const reset = response.headers.get('X-RateLimit-Reset');
      if (remaining !== null) {
        this.rateLimitRemaining = parseInt(remaining, 10);
      }
      if (reset !== null) {
        this.rateLimitReset = parseInt(reset, 10);
      }

      if (response.ok) break;

      const durationMs = Date.now() - startTime;
      if (response.status === 401) {
        logger.warn('githubApi', 'API request failed: unauthorized', { method, endpoint, status: response.status, durationMs });
        throw new Error('GitHub token expired or invalid');
      }
      if (response.status === 403 && this.rateLimitRemaining === 0) {
        const resetDate = this.rateLimitReset
          ? new Date(this.rateLimitReset * 1000).toLocaleString()
          : 'unknown';
        logger.warn('githubApi', 'API request failed: rate limit exceeded', { method, endpoint, status: response.status, durationMs });
        throw new Error(`GitHub API rate limit exceeded. Resets at ${resetDate}`);
      }

      // 5xx 视为可重试的瞬时故障；其余 4xx 直接抛出（重试无意义）。
      const isRetryable = response.status >= 500 && response.status <= 599;
      if (!isRetryable || attempt === maxRetries) {
        logger.warn('githubApi', 'API request failed', { method, endpoint, status: response.status, durationMs });
        throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
      }

      // 重试前若请求已被取消，则不再等待，直接以当前失败状态抛出。
      if (signal?.aborted) {
        logger.warn('githubApi', 'API request aborted before retry', { method, endpoint, status: response.status });
        throw new Error('Aborted');
      }
      const delayMs = Math.min(1000 * Math.pow(2, attempt), 4000);
      logger.warn('githubApi', 'API request failed, retrying', { method, endpoint, status: response.status, attempt: attempt + 1, maxRetries: maxRetries + 1, delayMs, durationMs });
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          clearTimeout(timeoutId);
          signal?.removeEventListener('abort', onAbort);
          reject(new Error('Aborted'));
        };
        const timeoutId = setTimeout(() => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        }, delayMs);
        signal?.addEventListener('abort', onAbort);
        if (signal?.aborted) onAbort();
      });
    }

    // 循环正常退出时 response 一定已赋值（最后一次成功 break 或在循环内抛出）。
    const finalResponse = response!;

    if (logger.isDebugMode()) {
      // Capture request headers (mask auth)
      const requestHeaders: Record<string, string> = {
        'Authorization': 'Bearer ***',
        'Accept': 'application/vnd.github.v3+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.headers as Record<string, string> || {}),
      };
      // Capture response headers
      const responseHeaders: Record<string, string> = {};
      finalResponse.headers.forEach((v, k) => { responseHeaders[k] = v; });
      // Capture response body preview (clone to avoid consuming)
      let responseBody: string | undefined;
      try {
        const cloned = finalResponse.clone();
        const text = await cloned.text();
        if (text.length > 0) {
          responseBody = text.length > 4000 ? text.slice(0, 4000) + '...[truncated]' : text;
        }
      } catch { /* body not readable */ }
      logger.debug('githubApi', 'API request', {
        method, endpoint, status: finalResponse.status, durationMs: Date.now() - startTime,
        rateLimitRemaining: finalResponse.headers.get('x-ratelimit-remaining'),
        requestHeaders, responseHeaders, responseBody,
        ...(operationTag ? { operationTag } : {}),
      });
    }

    const data = finalResponse.status === 204 ? null : await finalResponse.json();

    // 如果是starred repositories的响应，需要处理特殊格式
    if (endpoint.includes('/user/starred') && Array.isArray(data)) {
      return data.map((item: GitHubStarredItem) => {
        // 如果使用了star+json格式，数据结构会不同
        if (item.starred_at && item.repo) {
          return {
            ...item.repo,
            starred_at: item.starred_at
          };
        }
        return item;
      }) as T;
    }

    return data;
  }

  async getCurrentUser(): Promise<GitHubUser> {
    return this.makeRequest<GitHubUser>('/user');
  }

  async getStarredRepositories(page = 1, perPage = 100): Promise<Repository[]> {
    const repos = await this.makeRequest<Repository[]>(
      `/user/starred?page=${page}&per_page=${perPage}&sort=updated`,
      {
        headers: {
          'Accept': 'application/vnd.github.star+json'
        }
      }
    );
    return repos;
  }

  async getAllStarredRepositories(): Promise<Repository[]> {
    let allRepos: Repository[] = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      const repos = await this.getStarredRepositories(page, perPage);
      if (repos.length === 0) break;

      allRepos = [...allRepos, ...repos];

      if (repos.length < perPage) break;
      page++;

      // Rate limiting protection
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return allRepos;
  }

  private mergeGistMetadata(existing: Gist | undefined, incoming: Gist, starred?: boolean): Gist {
    // 列表 API 不返回文件内容，深度合并文件以保留已加载过的 content；
    // starred 仅信任显式传入或接口新值，不再回退到缓存，避免取消收藏后状态陈旧。
    const mergedFiles: Record<string, GistFile> = { ...incoming.files };
    if (existing?.files) {
      for (const [filename, file] of Object.entries(mergedFiles)) {
        const existingFile = existing.files[filename];
        if (existingFile && file.content === undefined && existingFile.content !== undefined) {
          mergedFiles[filename] = { ...file, content: existingFile.content };
        }
      }
    }

    return {
      ...incoming,
      files: mergedFiles,
      starred: starred ?? incoming.starred,
      ai_summary: existing?.ai_summary,
      analyzed_at: existing?.analyzed_at,
      analysis_failed: existing?.analysis_failed,
      analysis_error: existing?.analysis_error,
      last_edited: existing?.last_edited,
    };
  }

  async getGists(page = 1, perPage = 100): Promise<Gist[]> {
    return this.makeRequest<Gist[]>(`/gists?page=${page}&per_page=${perPage}`);
  }

  async getAllGists(existingGists: Gist[] = []): Promise<Gist[]> {
    let allGists: Gist[] = [];
    let page = 1;
    const perPage = 100;
    const existingById = new Map(existingGists.map(gist => [gist.id, gist]));

    while (true) {
      const gists = await this.getGists(page, perPage);
      if (gists.length === 0) break;

      allGists = [
        ...allGists,
        ...gists.map(gist => this.mergeGistMetadata(existingById.get(gist.id), gist)),
      ];

      if (gists.length < perPage) break;
      page++;
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return allGists;
  }

  async getStarredGists(page = 1, perPage = 100): Promise<Gist[]> {
    return this.makeRequest<Gist[]>(`/gists/starred?page=${page}&per_page=${perPage}`);
  }

  async getAllStarredGists(existingGists: Gist[] = []): Promise<Gist[]> {
    let allGists: Gist[] = [];
    let page = 1;
    const perPage = 100;
    const existingById = new Map(existingGists.map(gist => [gist.id, gist]));

    while (true) {
      const gists = await this.getStarredGists(page, perPage);
      if (gists.length === 0) break;

      allGists = [
        ...allGists,
        ...gists.map(gist => this.mergeGistMetadata(existingById.get(gist.id), gist, true)),
      ];

      if (gists.length < perPage) break;
      page++;
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return allGists;
  }

  async getGist(gistId: string, existing?: Gist): Promise<Gist> {
    const gist = await this.makeRequest<Gist>(`/gists/${encodeURIComponent(gistId)}`);
    return this.mergeGistMetadata(existing, gist, existing?.starred);
  }

  /**
   * 拉取 gist 单个文件的原始内容。
   * 用于 GitHub gist 详情 API 返回 truncated:true（文件 >1MB，content 被省略）时的回退取数。
   * raw_url 指向 gist.githubusercontent.com，不能复用 makeRequest（它会在前面拼 GITHUB_API_BASE）。
   * 当 backendUrl 已设置时通过服务端代理路由（走用户配置的代理），否则直连。
   */
  async getGistFileRaw(rawUrl: string, signal?: AbortSignal): Promise<string> {
    if (this.backendUrl) {
      const proxyUrl = `${this.backendUrl}/proxy/github-raw`;
      const response = await fetch(proxyUrl, {
        method: 'POST',
        signal,
        headers: this.getBackendHeaders(),
        body: JSON.stringify({ url: rawUrl }),
      });
      if (!response.ok) {
        // 尝试从 JSON 错误体提取消息
        let detail = response.statusText;
        try { const data = await response.json(); detail = (data as { error?: string }).error || detail; } catch { /* ignore */ }
        throw new Error(`GitHub raw proxy error: ${response.status} ${detail}`);
      }
      return response.text();
    }

    const response = await fetch(rawUrl, {
      signal,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }
    return response.text();
  }

  async createGist(input: GistCreateInput): Promise<Gist> {
    const files = input.files.reduce<Record<string, { content: string }>>((acc, file) => {
      acc[file.filename] = { content: file.content };
      return acc;
    }, {});

    return this.makeRequest<Gist>('/gists', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        description: input.description,
        public: input.public,
        files,
      }),
    });
  }

  async updateGist(gistId: string, input: GistUpdateInput, existing?: Gist): Promise<Gist> {
    const files = (input.files || []).reduce<Record<string, { content?: string; filename?: string } | null>>((acc, file) => {
      if (file.deleted) {
        acc[file.previousFilename || file.filename] = null;
        return acc;
      }

      acc[file.previousFilename || file.filename] = {
        content: file.content,
        ...(file.previousFilename && file.previousFilename !== file.filename ? { filename: file.filename } : {}),
      };
      return acc;
    }, {});

    const payload: Record<string, unknown> = {};
    if (input.description !== undefined) payload.description = input.description;
    if (Object.keys(files).length > 0) payload.files = files;

    const gist = await this.makeRequest<Gist>(`/gists/${encodeURIComponent(gistId)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    return this.mergeGistMetadata(existing, gist, existing?.starred);
  }

  async deleteGist(gistId: string): Promise<void> {
    await this.makeRequest<void>(`/gists/${encodeURIComponent(gistId)}`, {
      method: 'DELETE',
    });
  }

  async unstarGist(gistId: string): Promise<void> {
    await this.makeRequest<void>(`/gists/${encodeURIComponent(gistId)}/star`, {
      method: 'DELETE',
    });
  }

  async starGist(gistId: string): Promise<void> {
    await this.makeRequest<void>(`/gists/${encodeURIComponent(gistId)}/star`, {
      method: 'PUT',
    });
  }

  getGistContentPreview(gist: Gist, maxChars = 6000): string {
    return Object.values(gist.files || {})
      .map((file: GistFile) => {
        const content = file.content || '';
        return `### ${file.filename}\n${content.slice(0, maxChars)}`;
      })
      .join('\n\n')
      .slice(0, maxChars);
  }

  async getWatchedRepositories(page = 1, perPage = 100, username?: string): Promise<Repository[]> {
    const endpoint = username
      ? `/users/${encodeURIComponent(username)}/subscriptions?page=${page}&per_page=${perPage}`
      : `/user/subscriptions?page=${page}&per_page=${perPage}`;
    return this.makeRequest<Repository[]>(endpoint);
  }

  async getAllWatchedRepositories(username?: string): Promise<Repository[]> {
    let allRepos: Repository[] = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      const repos = await this.getWatchedRepositories(page, perPage, username);
      if (repos.length === 0) break;

      allRepos = [...allRepos, ...repos];

      if (repos.length < perPage) break;
      page++;

      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return allRepos;
  }

  async getAllWatchedRepositoriesForCurrentUser(): Promise<Repository[]> {
    const currentUser = await this.getCurrentUser();
    const [privateAware, publicProfile] = await Promise.all([
      this.getAllWatchedRepositories(),
      this.getAllWatchedRepositories(currentUser.login),
    ]);
    const reposByName = new Map<string, Repository>();
    [...privateAware, ...publicProfile].forEach(repo => {
      reposByName.set(repo.full_name.toLowerCase(), repo);
    });
    return Array.from(reposByName.values());
  }

  private decodeContentResponse(response: GitHubContentResponse): string {
    if (response.encoding === 'base64' && response.content) {
      // 使用 TextDecoder 正确处理 UTF-8 编码，避免中文乱码
      const binaryString = atob(response.content.replace(/\s/g, ''));
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return new TextDecoder('utf-8').decode(bytes);
    }
    return response.content || '';
  }

  private encodeContentPath(path: string): string {
    return path.split('/').map(encodeURIComponent).join('/');
  }

  async getRepositoryReadme(owner: string, repo: string, signal?: AbortSignal): Promise<string> {
    try {
      const response = await this.makeRequest<GitHubContentResponse>(
        `/repos/${owner}/${repo}/readme`,
        undefined,
        signal
      );

      return this.decodeContentResponse(response);
    } catch (error) {
      logger.warn('githubApi', `Failed to fetch README for ${owner}/${repo}`, error);
      return '';
    }
  }

  async listRepositoryReadmeCandidates(owner: string, repo: string, defaultBranch?: string, signal?: AbortSignal): Promise<GitHubReadmeCandidateItem[]> {
    const fetchRootContents = async (): Promise<GitHubReadmeCandidateItem[]> => {
      const rootItems = await this.makeRequest<GitHubReadmeCandidateItem[]>(
        `/repos/${owner}/${repo}/contents`,
        undefined,
        signal
      );
      return rootItems.filter(isReadmeCandidateItem);
    };

    let branch = defaultBranch;
    if (!branch) {
      try {
        const repoDetails = await this.makeRequest<{ default_branch?: string }>(
          `/repos/${owner}/${repo}`,
          undefined,
          signal
        );
        branch = repoDetails.default_branch;
      } catch (error) {
        logger.warn('githubApi', `Failed to fetch default branch for ${owner}/${repo}`, error);
      }
    }

    if (!branch) {
      try {
        return await fetchRootContents();
      } catch (error) {
        logger.warn('githubApi', `Failed to list README candidates for ${owner}/${repo}`, error);
        return [];
      }
    }

    try {
      const tree = await this.makeRequest<GitHubTreeResponse>(
        `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
        undefined,
        signal
      );
      const candidates = (tree.tree || []).filter(isReadmeCandidateItem);
      if (tree.truncated) {
        logger.warn('githubApi', `README candidate tree was truncated for ${owner}/${repo}`);
        if (candidates.length === 0) return await fetchRootContents();
      }
      return candidates;
    } catch (error) {
      logger.warn('githubApi', `Failed to list README candidates from tree for ${owner}/${repo}`, error);
      try {
        return await fetchRootContents();
      } catch (contentsError) {
        logger.warn('githubApi', `Failed to list README candidates from root contents for ${owner}/${repo}`, contentsError);
        return [];
      }
    }
  }

  async getRepositoryReadmeByPath(owner: string, repo: string, path: string, signal?: AbortSignal): Promise<string> {
    try {
      const response = await this.makeRequest<GitHubContentResponse>(
        `/repos/${owner}/${repo}/contents/${this.encodeContentPath(path)}`,
        undefined,
        signal
      );

      return this.decodeContentResponse(response);
    } catch (error) {
      logger.warn('githubApi', `Failed to fetch README ${path} for ${owner}/${repo}`, error);
      return '';
    }
  }

  async getRepositoryReleases(owner: string, repo: string, page = 1, perPage = 30): Promise<Release[]> {
    try {
      const releases = await this.makeRequest<Release[]>(
        `/repos/${owner}/${repo}/releases?page=${page}&per_page=${perPage}`,
        { operationTag: 'release' }
      );

      return releases.map(release => ({
        id: release.id,
        tag_name: release.tag_name,
        name: release.name || release.tag_name,
        body: release.body || '',
        published_at: release.published_at,
        html_url: release.html_url,
        assets: release.assets || [],
        zipball_url: release.zipball_url,
        tarball_url: release.tarball_url,
        prerelease: release.prerelease ?? false,
        repository: {
          id: 0,
          full_name: `${owner}/${repo}`,
          name: repo,
        },
      }));
    } catch (error) {
      logger.warn('githubApi', `Failed to fetch releases for ${owner}/${repo}`, error);
      throw error; // Re-throw to let caller handle
    }
  }

  /**
   * Fetch all releases for a repository with pagination.
   * New repos (never synced) use this for full sync - paginates until exhausted.
   */
  async fetchAllReleasesForRepo(owner: string, repo: string): Promise<Release[]> {
    const allReleases: Release[] = [];
    let page = 1;

    while (true) {
      const batch = await this.makeRequest<Release[]>(
        `/repos/${owner}/${repo}/releases?page=${page}&per_page=30`,
        { operationTag: 'release' }
      );

      if (batch.length === 0) break;

      const mapped = batch.map(release => ({
        id: release.id,
        tag_name: release.tag_name,
        name: release.name || release.tag_name,
        body: release.body || '',
        published_at: release.published_at,
        html_url: release.html_url,
        assets: release.assets || [],
        zipball_url: release.zipball_url,
        tarball_url: release.tarball_url,
        prerelease: release.prerelease ?? false,
        repository: {
          id: 0,
          full_name: `${owner}/${repo}`,
          name: repo,
        },
      }));

      allReleases.push(...mapped);

      if (batch.length < 30) break;
      page++;

      // Rate limiting protection between pages
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return allReleases;
  }

  async getMultipleRepositoryReleases(
    repositories: Repository[],
    options: ReleaseFetchOptions = {}
  ): Promise<MultipleReleasesResult> {
    const startTime = Date.now();
    const { includePreRelease = true } = options;
    const allReleases: Release[] = [];
    const failedRepos: { repoId: number; full_name: string; error: string }[] = [];

    // Controlled concurrency: process 3 repos at a time
    const concurrency = 3;
    let index = 0;

    const workers = Array.from({ length: Math.min(concurrency, repositories.length) }, async () => {
      while (true) {
        const currentIndex = index++;
        if (currentIndex >= repositories.length) break;

        const repo = repositories[currentIndex];
        const [owner, name] = repo.full_name.split('/');

        try {
          let releases: Release[];

          if (!repo.has_fetched_releases) {
            // New subscription: full sync (fetch up to 30)
            releases = await this.fetchAllReleasesForRepo(owner, name);
          } else {
            // Already synced: incremental sync with pagination until we cross the watermark
            const sinceTime = repo.last_release_fetch_time
              ? new Date(repo.last_release_fetch_time)
              : null;

            let page = 1;
            releases = [];
            while (true) {
              const batch = await this.getRepositoryReleases(owner, name, page, 10);

              if (batch.length === 0) break;

              const fresh = sinceTime
                ? batch.filter(r => new Date(r.published_at) > sinceTime)
                : batch;

              releases.push(...fresh);

              // Stop if we hit the watermark or ran out of data
              if (
                batch.length < 10 ||
                (sinceTime && batch.some(r => new Date(r.published_at) <= sinceTime))
              ) {
                break;
              }

              page++;
            }
          }

          // Add repository info to releases
          releases.forEach(release => {
            release.repository.id = repo.id;
          });

          // Filter by pre-release setting
          if (!includePreRelease) {
            releases = releases.filter(r => !r.prerelease);
          }

          allReleases.push(...releases);

        } catch (error) {
          failedRepos.push({
            repoId: repo.id,
            full_name: repo.full_name,
            error: error instanceof Error ? error.message : String(error)
          });
        }

        // Rate limiting protection between repos
        await new Promise(resolve => setTimeout(resolve, 150));
      }
    });

    await Promise.all(workers);

    // Sort by published date (newest first)
    const sortedReleases = allReleases.sort((a, b) =>
      new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
    );

    logger.info('githubApi', 'Update releases completed', { repoCount: repositories.length, releaseCount: sortedReleases.length, durationMs: Date.now() - startTime });

    return { releases: sortedReleases, failedRepos };
  }

  // 新增：获取仓库的增量releases（基于时间戳）
  async getIncrementalRepositoryReleases(
    owner: string,
    repo: string,
    since?: string,
    perPage = 10
  ): Promise<Release[]> {
    try {
      const endpoint = `/repos/${owner}/${repo}/releases?per_page=${perPage}`;

      const releases = await this.makeRequest<Release[]>(endpoint, { operationTag: 'release' });

      const mappedReleases = releases.map(release => ({
        id: release.id,
        tag_name: release.tag_name,
        name: release.name || release.tag_name,
        body: release.body || '',
        published_at: release.published_at,
        html_url: release.html_url,
        assets: release.assets || [],
        zipball_url: release.zipball_url,
        tarball_url: release.tarball_url,
        prerelease: release.prerelease ?? false,
        repository: {
          id: 0,
          full_name: `${owner}/${repo}`,
          name: repo,
        },
      }));

      // 如果提供了since时间戳，只返回更新的releases
      if (since) {
        const sinceDate = new Date(since);
        return mappedReleases.filter(release =>
          new Date(release.published_at) > sinceDate
        );
      }

      return mappedReleases;
    } catch (error) {
      logger.warn('githubApi', `Failed to fetch incremental releases for ${owner}/${repo}`, error);
      return [];
    }
  }

  async unstarRepository(owner: string, repo: string): Promise<void> {
    await this.makeRequest<void>(`/user/starred/${owner}/${repo}`, {
      method: 'DELETE',
    });
  }

  async starRepository(owner: string, repo: string): Promise<void> {
    await this.makeRequest<void>(`/user/starred/${owner}/${repo}`, {
      method: 'PUT',
    });
  }

  async checkRateLimit(): Promise<{ remaining: number; reset: number }> {
    const response = await this.makeRequest<GitHubRateLimitResponse>('/rate_limit');
    return {
      remaining: response.rate.remaining,
      reset: response.rate.reset,
    };
  }

  private buildPlatformQuery(platform: DiscoveryPlatform): string {
    switch (platform) {
      case 'Android':
        return 'android';
      case 'Macos':
        return 'macos OR mac OR osx';
      case 'Windows':
        return 'windows';
      case 'Linux':
        return 'linux';
      case 'All':
      default:
        return '';
    }
  }

  async searchMostStars(perPage = 10): Promise<SubscriptionRepo[]> {
    const data = await this.makeRequest<GitHubSearchRepoResponse>(
      `/search/repositories?q=stars:>1000&sort=stars&order=desc&per_page=${perPage}`
    );
    return (data.items || []).map((repo, index) => ({
      ...repo,
      rank: index + 1,
      channel: 'most-stars' as const,
    }));
  }

  async searchMostForks(perPage = 10): Promise<SubscriptionRepo[]> {
    const data = await this.makeRequest<GitHubSearchRepoResponse>(
      `/search/repositories?q=forks:>1000&sort=forks&order=desc&per_page=${perPage}`
    );
    return (data.items || []).map((repo, index) => ({
      ...repo,
      rank: index + 1,
      channel: 'most-forks' as const,
      forks_count: repo.forks_count,
    }));
  }

  async searchTrending(perPage = 10, timeRange: 'daily' | 'weekly' | 'monthly' = 'weekly'): Promise<SubscriptionRepo[]> {
    const startTime = Date.now();
    // 使用 GitHubTrendingRSS API
    const rssUrl = `https://mshibanami.github.io/GitHubTrendingRSS/${timeRange}/all.xml`;

    try {
      const response = await fetch(rssUrl, {
        headers: { 'Accept': 'application/rss+xml, application/xml, text/xml' }
      });

      if (!response.ok) {
        throw new Error(`RSS fetch failed: ${response.status}`);
      }

      const text = await response.text();
      const parser = new DOMParser();
      const xml = parser.parseFromString(text, 'text/xml');
      const items = xml.querySelectorAll('item');

      const repos: SubscriptionRepo[] = [];
      for (let i = 0; i < Math.min(items.length, perPage); i++) {
        const item = items[i];
        const title = item.querySelector('title')?.textContent || '';
        const link = item.querySelector('link')?.textContent || '';
        // description 可能包含 HTML，需要解码
        const descriptionEl = item.querySelector('description');
        let description = descriptionEl?.textContent || '';
        // 解码 HTML 实体
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = description;
        description = tempDiv.textContent || tempDiv.innerText || description;
        // 清理多余空白
        description = description.replace(/\s+/g, ' ').trim();

        // 解析 link 获取 owner/repo 格式
        const match = link.match(/github\.com\/([^/]+)\/([^/?#]+)/);
        const owner = match?.[1] || '';
        const repoName = match?.[2] || title;

        // 从 description 中提取 stars 和 forks（格式如 "⭐ 1,234 | 🍴 456"）
        const starsMatch = description.match(/⭐\s*([\d,]+)/);
        const forksMatch = description.match(/🍴\s*([\d,]+)/);
        const stars = starsMatch ? parseInt(starsMatch[1].replace(/,/g, '')) : 0;
        const forks = forksMatch ? parseInt(forksMatch[1].replace(/,/g, '')) : 0;

        repos.push({
          id: i + 1,
          name: repoName,
          full_name: `${owner}/${repoName}`,
          description: description.slice(0, 200),
          html_url: link,
          stargazers_count: stars,
          forks_count: forks,
          forks: forks,
          language: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          pushed_at: new Date().toISOString(),
          owner: { login: owner, avatar_url: `https://github.com/${owner}.png` },
          topics: [],
          rank: i + 1,
          channel: 'trending',
        });
      }

      // 如果 stars 或 forks 为 0，从 GitHub API 获取
      const reposNeedUpdate = repos.filter(r => r.stargazers_count === 0 || r.forks_count === 0);
      if (reposNeedUpdate.length > 0) {
        await Promise.all(reposNeedUpdate.map(async (r) => {
          try {
            const [owner, repo] = r.full_name.split('/');
            if (!owner || !repo) return;
            const data = await this.makeRequest<{
              stargazers_count: number;
              forks_count: number;
              language: string | null;
              description: string | null;
            }>(`/repos/${owner}/${repo}`, { operationTag: 'trending' });
            r.stargazers_count = data.stargazers_count ?? r.stargazers_count;
            r.forks_count = data.forks_count ?? r.forks_count;
            r.language = data.language;
            if (data.description && !r.description) {
              r.description = data.description;
            }
          } catch (e) {
            logger.warn('githubApi', `Failed to fetch repo details for ${r.full_name}`, e);
          }
          // 避免 GitHub API 限流
          await new Promise(resolve => setTimeout(resolve, 100));
        }));
      }

      logger.info('githubApi', 'Refresh trending completed', { repoCount: repos.length, durationMs: Date.now() - startTime });

      return repos;
    } catch (error) {
      logger.error('githubApi', 'Failed to fetch trending from RSS', error);
      return [];
    }
  }

  async searchDailyDevs(perPage = 10): Promise<SubscriptionDev[]> {
    const usersData = await this.makeRequest<GitHubSearchUserResponse>(
      `/search/users?q=followers:>1000&sort=followers&order=desc&per_page=${perPage}`
    );

    const devs: SubscriptionDev[] = [];
    for (let i = 0; i < (usersData.items || []).length; i++) {
      const searchUser = usersData.items[i];

      // The search API only returns basic fields; fetch the full profile for name/bio/followers/public_repos
      let userDetail: GitHubUserDetail = {
        login: searchUser.login,
        avatar_url: searchUser.avatar_url,
        html_url: searchUser.html_url,
        name: null,
        bio: null,
        public_repos: 0,
        followers: 0,
      };
      try {
        userDetail = await this.makeRequest<GitHubUserDetail>(`/users/${searchUser.login}`);
      } catch (error) {
        logger.warn('githubApi', `Failed to fetch user details for ${searchUser.login}`, error);
      }

      let topRepo: SubscriptionRepo | null = null;
      try {
        const reposData = await this.makeRequest<Repository[]>(
          `/users/${searchUser.login}/repos?sort=stars&per_page=1`
        );
        if (reposData && reposData.length > 0) {
          topRepo = {
            ...reposData[0],
            rank: 1,
            channel: 'most-dev' as const,
          };
        }
      } catch (error) {
        logger.warn('githubApi', `Failed to fetch top repo for ${searchUser.login}`, error);
      }
      devs.push({
        rank: i + 1,
        login: userDetail.login,
        avatar_url: userDetail.avatar_url,
        html_url: userDetail.html_url,
        name: userDetail.name,
        bio: userDetail.bio,
        public_repos: userDetail.public_repos,
        followers: userDetail.followers,
        topRepo,
      });
      if (i < (usersData.items || []).length - 1) {
        await new Promise(resolve => setTimeout(resolve, 150));
      }
    }
    return devs;
  }

  private buildLanguageQuery(language: ProgrammingLanguage): string {
    if (language === 'All') return '';
    const languageMap: Record<ProgrammingLanguage, string> = {
      'All': '',
      'Kotlin': 'Kotlin',
      'Java': 'Java',
      'JavaScript': 'JavaScript',
      'TypeScript': 'TypeScript',
      'Python': 'Python',
      'Swift': 'Swift',
      'Rust': 'Rust',
      'Go': 'Go',
      'CSharp': 'C#',
      'CPlusPlus': 'C++',
      'C': 'C',
      'Dart': 'Dart',
      'Ruby': 'Ruby',
      'PHP': 'PHP',
    };
    return `language:${languageMap[language]}`;
  }

  private buildSortParams(sortBy: SortBy, sortOrder: SortOrder): { sort: string; order: string } {
    const sortMap: Record<SortBy, string> = {
      'BestMatch': 'best-match',
      'MostStars': 'stars',
      'MostForks': 'forks',
    };
    const orderMap: Record<SortOrder, string> = {
      'Descending': 'desc',
      'Ascending': 'asc',
    };
    return {
      sort: sortMap[sortBy],
      order: orderMap[sortOrder],
    };
  }

  async getTrendingRepositories(
    platform: DiscoveryPlatform,
    page: number = 1,
    perPage: number = 20,
    timeRange: TrendingTimeRange = 'weekly'
  ): Promise<PaginatedDiscoveryRepositories> {
    const startTime = Date.now();
    const rssUrlMap: Record<TrendingTimeRange, string> = {
      daily: 'https://mshibanami.github.io/GitHubTrendingRSS/daily/all.xml',
      weekly: 'https://mshibanami.github.io/GitHubTrendingRSS/weekly/all.xml',
      monthly: 'https://mshibanami.github.io/GitHubTrendingRSS/monthly/all.xml',
    };
    const rssUrl = rssUrlMap[timeRange];

    try {
      const response = await fetch(rssUrl, {
        headers: { 'Accept': 'application/rss+xml, application/xml, text/xml' }
      });
      if (!response.ok) {
        throw new Error(`RSS fetch failed: ${response.status}`);
      }
      const text = await response.text();
      const parser = new DOMParser();
      const xml = parser.parseFromString(text, 'text/xml');
      const items = xml.querySelectorAll('item');

      const repos: DiscoveryRepo[] = [];
      const startIndex = (page - 1) * perPage;
      const endIndex = Math.min(startIndex + perPage, items.length);

      for (let i = startIndex; i < endIndex; i++) {
        const item = items[i];
        const title = item.querySelector('title')?.textContent || '';
        const link = item.querySelector('link')?.textContent || '';

        // Parse description - strip XML/HTML tags
        const descriptionEl = item.querySelector('description');
        let description = descriptionEl?.textContent || '';
        // Decode HTML entities and strip HTML tags
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = description;
        description = tempDiv.textContent || tempDiv.innerText || '';
        // Clean up extra whitespace
        description = description.replace(/\s+/g, ' ').trim();

        // Parse link to get owner/repo
        const match = link.match(/github\.com\/([^/]+)\/([^/?#]+)/);
        const owner = match?.[1] || '';
        const repoName = match?.[2] || title;

        // Extract stars and forks from description (format like "⭐ 1,234 | 🍴 456")
        const starsMatch = description.match(/⭐\s*([\d,]+)/);
        const forksMatch = description.match(/🍴\s*([\d,]+)/);
        const stars = starsMatch ? parseInt(starsMatch[1].replace(/,/g, '')) : 0;
        const forks = forksMatch ? parseInt(forksMatch[1].replace(/,/g, '')) : 0;

        repos.push({
          id: 0, // will be filled by GitHub API
          name: repoName,
          full_name: `${owner}/${repoName}`,
          description: description,
          html_url: link,
          stargazers_count: stars,
          forks_count: forks,
          forks: forks,
          language: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          pushed_at: new Date().toISOString(),
          owner: {
            login: owner,
            avatar_url: `https://github.com/${owner}.png`,
          },
          topics: [],
          rank: i + 1,
          channel: 'trending' as DiscoveryChannelId,
          platform,
        });
      }

      // Supplement missing fields via GitHub API
      const reposNeedUpdate = repos.filter(r => r.id === 0 || r.stargazers_count === 0 || r.forks_count === 0 || !r.language);
      if (reposNeedUpdate.length > 0) {
        await Promise.all(reposNeedUpdate.map(async (r) => {
          try {
            const [owner, repo] = r.full_name.split('/');
            if (!owner || !repo) return;
            const data = await this.makeRequest<{
              id: number;
              stargazers_count: number;
              forks_count: number;
              forks: number;
              language: string | null;
              description: string | null;
              topics: string[];
              created_at: string;
              updated_at: string;
              pushed_at: string;
            }>(`/repos/${owner}/${repo}`, { operationTag: 'trending' });
            r.id = data.id;
            r.stargazers_count = data.stargazers_count ?? r.stargazers_count;
            r.forks_count = data.forks_count ?? r.forks_count;
            r.forks = data.forks ?? r.forks;
            r.language = data.language ?? r.language;
            r.topics = data.topics ?? r.topics;
            r.created_at = data.created_at ?? r.created_at;
            r.updated_at = data.updated_at ?? r.updated_at;
            r.pushed_at = data.pushed_at ?? r.pushed_at;
            // Use GitHub API description as fallback (RSS description may contain emoji markers)
            if (data.description) {
              r.description = data.description;
            }
          } catch (e) {
            logger.warn('githubApi', `Failed to fetch repo details for ${r.full_name}`, e);
          }
          // Avoid GitHub API rate limiting
          await new Promise(resolve => setTimeout(resolve, 80));
        }));
      }

      // Assign rank based on position
      repos.forEach((r, idx) => { r.rank = startIndex + idx + 1; });

      logger.info('githubApi', 'Refresh trending completed', { repoCount: repos.length, durationMs: Date.now() - startTime });

      return {
        repos,
        hasMore: endIndex < items.length,
        nextPageIndex: page + 1,
        totalCount: items.length,
      };
    } catch (error) {
      logger.error('githubApi', 'Failed to fetch trending from RSS', error);
      return { repos: [], hasMore: false, nextPageIndex: 1, totalCount: 0 };
    }
  }

  async getHotReleaseRepositories(
    platform: DiscoveryPlatform,
    page: number = 1,
    perPage: number = 20
  ): Promise<PaginatedDiscoveryRepositories> {
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const platformQuery = this.buildPlatformQuery(platform);

    let query = `stars:>10 archived:false pushed:>=${fourteenDaysAgo}`;
    if (platformQuery) {
      query += ` ${platformQuery}`;
    }

    const data = await this.makeRequest<GitHubSearchRepoResponse>(
      `/search/repositories?q=${encodeURIComponent(query)}&sort=updated&order=desc&per_page=${perPage}&page=${page}`
    );

    const repos = (data.items || []).map((repo, index) => ({
      ...repo,
      rank: (page - 1) * perPage + index + 1,
      channel: 'hot-release' as DiscoveryChannelId,
      platform,
    }));

    return {
      repos,
      hasMore: repos.length === perPage,
      nextPageIndex: page + 1,
      totalCount: data.total_count,
    };
  }

  async getMostPopular(
    platform: DiscoveryPlatform,
    page: number = 1,
    perPage: number = 20
  ): Promise<PaginatedDiscoveryRepositories> {
    const sixMonthsAgo = new Date(Date.now() - 6 * 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const platformQuery = this.buildPlatformQuery(platform);

    let query = `stars:>1000 archived:false created:<${sixMonthsAgo} pushed:>=${oneYearAgo}`;
    if (platformQuery) {
      query += ` ${platformQuery}`;
    }

    const data = await this.makeRequest<GitHubSearchRepoResponse>(
      `/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=${perPage}&page=${page}`
    );

    const repos = (data.items || []).map((repo, index) => ({
      ...repo,
      rank: (page - 1) * perPage + index + 1,
      channel: 'most-popular' as DiscoveryChannelId,
      platform,
    }));

    return {
      repos,
      hasMore: repos.length === perPage,
      nextPageIndex: page + 1,
      totalCount: data.total_count,
    };
  }

  async searchByTopic(
    searchKeywords: string,
    platform: DiscoveryPlatform,
    page: number = 1,
    perPage: number = 20
  ): Promise<PaginatedDiscoveryRepositories> {
    const platformQuery = this.buildPlatformQuery(platform);

    let query = `${searchKeywords} in:name,description,topics stars:>10 archived:false`;
    if (platformQuery) {
      query += ` ${platformQuery}`;
    }

    const data = await this.makeRequest<GitHubSearchRepoResponse>(
      `/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=${perPage}&page=${page}`
    );

    const repos = (data.items || []).map((repo, index) => ({
      ...repo,
      rank: (page - 1) * perPage + index + 1,
      channel: 'topic' as DiscoveryChannelId,
      platform,
    }));

    return {
      repos,
      hasMore: repos.length === perPage,
      nextPageIndex: page + 1,
      totalCount: data.total_count,
    };
  }

  async getTopicRepositories(
    topic: TopicCategory,
    platform: DiscoveryPlatform,
    page: number = 1,
    perPage: number = 20
  ): Promise<PaginatedDiscoveryRepositories> {
    const topicKeywords: Record<TopicCategory, string> = {
      'ai': 'artificial-intelligence machine-learning ai',
      'ml': 'machine-learning deep-learning neural-network',
      'database': 'database sql nosql mongodb postgresql mysql',
      'web': 'web frontend backend react vue angular',
      'mobile': 'mobile android ios flutter react-native',
      'devtools': 'devtools ide editor tools',
      'security': 'security cybersecurity encryption',
      'game': 'game game-engine unity unreal',
    };

    return this.searchByTopic(topicKeywords[topic], platform, page, perPage);
  }

  async searchRepositories(
    query: string,
    platform: DiscoveryPlatform,
    language: ProgrammingLanguage,
    sortBy: SortBy,
    sortOrder: SortOrder,
    page: number = 1,
    perPage: number = 20
  ): Promise<PaginatedDiscoveryRepositories> {
    const platformQuery = this.buildPlatformQuery(platform);
    const languageQuery = this.buildLanguageQuery(language);
    const { sort, order } = this.buildSortParams(sortBy, sortOrder);

    let searchQuery = `${query} archived:false`;
    if (platformQuery) {
      searchQuery += ` ${platformQuery}`;
    }
    if (languageQuery) {
      searchQuery += ` ${languageQuery}`;
    }

    let url = `/search/repositories?q=${encodeURIComponent(searchQuery)}&per_page=${perPage}&page=${page}`;
    if (sort) {
      url += `&sort=${sort}&order=${order}`;
    }

    const data = await this.makeRequest<GitHubSearchRepoResponse>(url);

    const repos = (data.items || []).map((repo, index) => ({
      ...repo,
      rank: (page - 1) * perPage + index + 1,
      channel: 'search' as DiscoveryChannelId,
      platform,
    }));

    return {
      repos,
      hasMore: repos.length === perPage,
      nextPageIndex: page + 1,
      totalCount: data.total_count,
    };
  }



  async getUserOrganizations(): Promise<GitHubOrganization[]> {
    try {
      return await this.getPaginatedFromEndpoint<GitHubOrganization>('/user/orgs', 'fork');
    } catch (error) {
      logger.warn('githubApi', 'Failed to fetch user organizations', error);
      throw error;
    }
  }

  private async getPaginatedFromEndpoint<T>(endpoint: string, operationTag: string): Promise<T[]> {
    let allItems: T[] = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      const separator = endpoint.includes('?') ? '&' : '?';
      const items = await this.makeRequest<T[]>(
        `${endpoint}${separator}per_page=${perPage}&page=${page}`,
        { operationTag }
      );
      allItems = [...allItems, ...items];
      if (items.length < perPage) break;
      page++;
      // Rate limiting protection
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return allItems;
  }

  private async getForksFromEndpoint(endpoint: string): Promise<ForkRepo[]> {
    return this.getPaginatedFromEndpoint<ForkRepo>(endpoint, 'fork');
  }

  async getUserForks(): Promise<ForkRepo[]> {
    try {
      // Use /user/repos?type=forks to get only repositories the user has forked
      return await this.getForksFromEndpoint('/user/repos?type=forks&sort=updated');
    } catch (error) {
      logger.warn('githubApi', 'Failed to fetch user forks', error);
      throw error;
    }
  }

  async getOrganizationForks(orgLogin: string): Promise<ForkRepo[]> {
    try {
      return await this.getForksFromEndpoint(`/orgs/${encodeURIComponent(orgLogin)}/repos?type=forks&sort=updated`);
    } catch (error) {
      logger.warn('githubApi', 'Failed to fetch organization forks', { orgLogin, error });
      throw error;
    }
  }

  async syncFork(owner: string, repo: string, branch: string): Promise<{ hasUpdates: boolean; sourceUpdatedAt: string | null; mergeType?: string }> {
    // Use GitHub's merge upstream API to sync the fork with its upstream
    try {
      const result = await this.makeRequest<{ merge_type: string; message?: string }>(
        `/repos/${owner}/${repo}/merge-upstream`,
        {
          method: 'POST',
          body: JSON.stringify({ branch }),
          operationTag: 'fork',
        }
      );
      return {
        hasUpdates: result.merge_type !== 'none',
        sourceUpdatedAt: new Date().toISOString(),
        mergeType: result.merge_type,
      };
    } catch (error) {
      if (error instanceof Error) {
        const msg = error.message;
        if (msg.includes('404')) throw new Error('NOT_A_FORK');
        if (msg.includes('409')) throw new Error('MERGE_CONFLICT');
        if (msg.includes('422')) {
          return { hasUpdates: false, sourceUpdatedAt: null, mergeType: 'none' };
        }
      }
      throw error;
    }
  }

  // Check if a fork's branch is behind its upstream — returns true if "out-of-date"
  async checkForkSyncNeeded(owner: string, repo: string, branch: string, parentFullName?: string): Promise<{ needsSync: boolean, parentFullName?: string, parentHtmlUrl?: string }> {
    try {
      let parentOwner = '';
      let resultParentFullName = parentFullName;
      let resultParentHtmlUrl: string | undefined = undefined;

      if (parentFullName) {
        parentOwner = parentFullName.split('/')[0];
      } else {
        const repoData = await this.makeRequest<{ parent?: { owner: { login: string }, full_name: string, html_url: string } }>(`/repos/${owner}/${repo}`, { operationTag: 'fork' });
        if (!repoData.parent) return { needsSync: false };
        parentOwner = repoData.parent.owner.login;
        resultParentFullName = repoData.parent.full_name;
        resultParentHtmlUrl = repoData.parent.html_url;
      }

      const compareData = await this.makeRequest<{ behind_by: number }>(
        `/repos/${owner}/${repo}/compare/${parentOwner}:${branch}...${owner}:${branch}`,
        { operationTag: 'fork' }
      );
      
      return { 
        needsSync: compareData.behind_by > 0,
        parentFullName: resultParentFullName,
        parentHtmlUrl: resultParentHtmlUrl
      };
    } catch (error) {
      logger.warn('githubApi', `Failed to check sync status for ${owner}/${repo}`, error);
      return { needsSync: false };
    }
  }

  async getBranches(owner: string, repo: string): Promise<string[]> {
    try {
      const branches = await this.makeRequest<{ name: string }[]>(`/repos/${owner}/${repo}/branches?per_page=100`);
      return branches.map(b => b.name);
    } catch (error) {
      logger.warn('githubApi', `Failed to fetch branches for ${owner}/${repo}`, error);
      return [];
    }
  }

  async getRepositoryWorkflows(owner: string, repo: string): Promise<WorkflowDefinition[]> {
    try {
      // GET /repos/{owner}/{repo}/actions/workflows lists workflow files (definitions), not runs
      const data = await this.makeRequest<{ workflows: WorkflowDefinition[] }>(
        `/repos/${owner}/${repo}/actions/workflows?per_page=100`,
        { operationTag: 'workflow' }
      );
      return data.workflows || [];
    } catch (error) {
      logger.warn('githubApi', `Failed to fetch workflows for ${owner}/${repo}`, error);
      return [];
    }
  }

  async triggerWorkflowRun(owner: string, repo: string, workflowPath: string, branch: string): Promise<void> {
    // workflowPath is the file path (e.g. ".github/workflows/ci.yml") — URL-encode it
    const encodedPath = encodeURIComponent(workflowPath);
    await this.makeRequest<void>(
      `/repos/${owner}/${repo}/actions/workflows/${encodedPath}/dispatches`,
      {
        method: 'POST',
        body: JSON.stringify({ ref: branch }),
        operationTag: 'workflow',
      }
    );
  }
}

export const createGitHubOAuthUrl = (clientId: string, redirectUri: string): string => {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    // `gist` scope 是读写用户 gist（含 secret/私有 gist）所必需的，
    // 否则只能列出公共 gist，且无法创建/编辑/删除 gist。
    scope: 'read:user user:email repo gist',
    state: Math.random().toString(36).substring(7),
  });

  return `https://github.com/login/oauth/authorize?${params.toString()}`;
};
