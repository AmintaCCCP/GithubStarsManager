import { Repository, Release, GitHubUser } from '../types';
import { backend } from './backendAdapter';

export class GitHubApiService {
  constructor() {}

  private getAuthHeaders(): Record<string, string> {
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

  private async makeRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = backend.backendUrl;
    if (!url) throw new Error('Backend not available');

    // Remove leading slash for proxy path matching
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint.substring(1) : endpoint;
    const [path, search] = cleanEndpoint.split('?');
    const targetUrl = `${url}/proxy/github/${path}${search ? '?' + search : ''}`;

    const proxyBody = {
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(proxyBody)
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('GitHub token expired or invalid');
      }
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const data = response.status === 204 ? null : await response.json();

    // 如果是starred repositories的响应，需要处理特殊格式
    if (endpoint.includes('/user/starred') && Array.isArray(data)) {
      return data.map((item: any) => {
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

  async getRepositoryReadme(owner: string, repo: string): Promise<string> {
    try {
      const response = await this.makeRequest<{ content: string; encoding: string }>(
        `/repos/${owner}/${repo}/readme`
      );
      
      if (response.encoding === 'base64') {
        return atob(response.content);
      }
      return response.content;
    } catch (error) {
      console.warn(`Failed to fetch README for ${owner}/${repo}:`, error);
      return '';
    }
  }

  async getRepositoryReleases(owner: string, repo: string, page = 1, perPage = 30): Promise<Release[]> {
    try {
      const releases = await this.makeRequest<any[]>(
        `/repos/${owner}/${repo}/releases?page=${page}&per_page=${perPage}`
      );
      
      return releases.map(release => ({
        id: release.id,
        tag_name: release.tag_name,
        name: release.name || release.tag_name,
        body: release.body || '',
        published_at: release.published_at,
        html_url: release.html_url,
        assets: release.assets || [],
        repository: {
          id: 0, // Will be set by caller
          full_name: `${owner}/${repo}`,
          name: repo,
        },
      }));
    } catch (error) {
      console.warn(`Failed to fetch releases for ${owner}/${repo}:`, error);
      return [];
    }
  }

  async getMultipleRepositoryReleases(repositories: Repository[]): Promise<Release[]> {
    const allReleases: Release[] = [];
    
    for (const repo of repositories) {
      const [owner, name] = repo.full_name.split('/');
      const releases = await this.getRepositoryReleases(owner, name, 1, 5);
      
      // Add repository info to releases
      releases.forEach(release => {
        release.repository.id = repo.id;
      });
      
      allReleases.push(...releases);
      
      // Rate limiting protection
      await new Promise(resolve => setTimeout(resolve, 150));
    }

    // Sort by published date (newest first)
    return allReleases.sort((a, b) => 
      new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
    );
  }

  // 新增：获取仓库的增量releases（基于时间戳）
  async getIncrementalRepositoryReleases(
    owner: string, 
    repo: string, 
    since?: string, 
    perPage = 10
  ): Promise<Release[]> {
    try {
      let endpoint = `/repos/${owner}/${repo}/releases?per_page=${perPage}`;
      
      const releases = await this.makeRequest<any[]>(endpoint);
      
      const mappedReleases = releases.map(release => ({
        id: release.id,
        tag_name: release.tag_name,
        name: release.name || release.tag_name,
        body: release.body || '',
        published_at: release.published_at,
        html_url: release.html_url,
        assets: release.assets || [],
        repository: {
          id: 0, // Will be set by caller
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
      console.warn(`Failed to fetch incremental releases for ${owner}/${repo}:`, error);
      return [];
    }
  }

  async unstarRepository(owner: string, repo: string): Promise<void> {
    await this.makeRequest<void>(`/user/starred/${owner}/${repo}`, {
      method: 'DELETE',
    });
  }

  async checkRateLimit(): Promise<{ remaining: number; reset: number }> {
    const response = await this.makeRequest<any>('/rate_limit');
    return {
      remaining: response.rate.remaining,
      reset: response.rate.reset,
    };
  }
}

export const createGitHubOAuthUrl = (clientId: string, redirectUri: string): string => {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'read:user user:email repo',
    state: Math.random().toString(36).substring(7),
  });
  
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
};