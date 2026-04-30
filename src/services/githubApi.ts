import {
  Repository,
  Release,
  GitHubUser,
  DiscoveryPlatform,
  ProgrammingLanguage,
  SortBy,
  SortOrder,
  PaginatedDiscoveryRepositories,
  DiscoveryChannelId,
  TopicCategory,
  SubscriptionRepo,
  SubscriptionDev,
  GitHubSearchUserResponse,
  GitHubUserDetail
} from '../types';

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

  constructor(token: string) {
    this.token = token;
  }

  private async makeRequest<T>(endpoint: string, options: RequestInit = {}, signal?: AbortSignal): Promise<T> {
    // Check rate limit before making request
    if (this.rateLimitRemaining !== null && this.rateLimitRemaining < 100 && this.rateLimitReset !== null) {
      const waitMs = (this.rateLimitReset * 1000) - Date.now();
      if (waitMs > 0) {
        console.log(`Rate limit low (${this.rateLimitRemaining}), waiting ${Math.ceil(waitMs / 1000)}s for reset...`);
        await new Promise(resolve => setTimeout(resolve, waitMs + 1000));
      }
    }

    const response = await fetch(`${GITHUB_API_BASE}${endpoint}`, {
      ...options,
      signal,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...options.headers,
      },
    });

    // Parse rate limit headers
    const remaining = response.headers.get('X-RateLimit-Remaining');
    const reset = response.headers.get('X-RateLimit-Reset');
    if (remaining !== null) {
      this.rateLimitRemaining = parseInt(remaining, 10);
    }
    if (reset !== null) {
      this.rateLimitReset = parseInt(reset, 10);
    }

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('GitHub token expired or invalid');
      }
      if (response.status === 403 && this.rateLimitRemaining === 0) {
        const resetDate = this.rateLimitReset
          ? new Date(this.rateLimitReset * 1000).toLocaleString()
          : 'unknown';
        throw new Error(`GitHub API rate limit exceeded. Resets at ${resetDate}`);
      }
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const data = response.status === 204 ? null : await response.json();

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

  async getRepositoryReadme(owner: string, repo: string, signal?: AbortSignal): Promise<string> {
    try {
      const response = await this.makeRequest<{ content: string; encoding: string }>(
        `/repos/${owner}/${repo}/readme`,
        undefined,
        signal
      );

      if (response.encoding === 'base64') {
        // 使用 TextDecoder 正确处理 UTF-8 编码，避免中文乱码
        const binaryString = atob(response.content);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        return new TextDecoder('utf-8').decode(bytes);
      }
      return response.content;
    } catch (error) {
      console.warn(`Failed to fetch README for ${owner}/${repo}:`, error);
      return '';
    }
  }

  async getRepositoryReleases(owner: string, repo: string, page = 1, perPage = 30): Promise<Release[]> {
    try {
      const releases = await this.makeRequest<Release[]>(
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
      console.warn(`Failed to fetch releases for ${owner}/${repo}:`, error);
      throw error; // Re-throw to let caller handle
    }
  }

  /**
   * Fetch all releases for a repository with pagination (up to 30)
   */
  async fetchAllReleasesForRepo(owner: string, repo: string, perPage = 30): Promise<Release[]> {
    const allReleases: Release[] = [];
    let page = 1;

    while (allReleases.length < perPage) {
      const batch = await this.makeRequest<Release[]>(
        `/repos/${owner}/${repo}/releases?page=${page}&per_page=${Math.min(perPage, 30)}`
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

      if (batch.length < perPage) break;
      page++;

      // Rate limiting protection between pages
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return allReleases.slice(0, perPage);
  }

  async getMultipleRepositoryReleases(
    repositories: Repository[],
    options: ReleaseFetchOptions = {}
  ): Promise<MultipleReleasesResult> {
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
            releases = await this.fetchAllReleasesForRepo(owner, name, 30);
          } else {
            // Already synced: incremental sync (fetch 10, filter client-side)
            const sinceTime = repo.last_release_fetch_time
              ? new Date(repo.last_release_fetch_time)
              : null;

            releases = await this.getRepositoryReleases(owner, name, 1, 10);

            // Client-side filtering by time
            if (sinceTime) {
              releases = releases.filter(r => {
                const publishedTime = new Date(r.published_at);
                return publishedTime > sinceTime;
              });
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

      const releases = await this.makeRequest<Release[]>(endpoint);

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
      console.warn(`Failed to fetch incremental releases for ${owner}/${repo}:`, error);
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
        const match = link.match(/github\.com\/([^\/]+)\/([^\/\?#]+)/);
        const owner = match?.[1] || '';
        const repoName = match?.[2] || title;

        // 从 description 中提取 stars 和 forks（格式如 "⭐ 1,234 | 🍴 456"）
        const starsMatch = description.match(/⭐\s*([\d,]+)/);
        const forksMatch = description.match(/🍴\s*([\d,]+)/);
        let stars = starsMatch ? parseInt(starsMatch[1].replace(/,/g, '')) : 0;
        let forks = forksMatch ? parseInt(forksMatch[1].replace(/,/g, '')) : 0;

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
            }>(`/repos/${owner}/${repo}`);
            r.stargazers_count = data.stargazers_count ?? r.stargazers_count;
            r.forks_count = data.forks_count ?? r.forks_count;
            r.language = data.language;
            if (data.description && !r.description) {
              r.description = data.description;
            }
          } catch (e) {
            console.warn(`Failed to fetch repo details for ${r.full_name}:`, e);
          }
          // 避免 GitHub API 限流
          await new Promise(resolve => setTimeout(resolve, 100));
        }));
      }

      return repos;
    } catch (error) {
      console.error('Failed to fetch trending from RSS:', error);
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
      } catch {
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
      } catch {
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
        const match = link.match(/github\.com\/([^\/]+)\/([^\/\?#]+)/);
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
            }>(`/repos/${owner}/${repo}`);
            r.id = data.id;
            r.stargazers_count = data.stargizers_count ?? r.stargazers_count;
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
            console.warn(`Failed to fetch repo details for ${r.full_name}:`, e);
          }
          // Avoid GitHub API rate limiting
          await new Promise(resolve => setTimeout(resolve, 80));
        }));
      }

      // Assign rank based on position
      repos.forEach((r, idx) => { r.rank = startIndex + idx + 1; });

      return {
        repos,
        hasMore: endIndex < items.length,
        nextPageIndex: page + 1,
        totalCount: items.length,
      };
    } catch (error) {
      console.error('Failed to fetch trending from RSS:', error);
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