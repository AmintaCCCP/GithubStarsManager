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
  TopicCategory
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



export class GitHubApiService {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  private async makeRequest<T>(endpoint: string, options: RequestInit = {}, signal?: AbortSignal): Promise<T> {
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

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('GitHub token expired or invalid');
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
        repository: {
          id: 0,
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
    perPage: number = 20
  ): Promise<PaginatedDiscoveryRepositories> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const platformQuery = this.buildPlatformQuery(platform);
    
    let query = `stars:>50 archived:false pushed:>=${thirtyDaysAgo}`;
    if (platformQuery) {
      query += ` ${platformQuery}`;
    }

    const data = await this.makeRequest<GitHubSearchRepoResponse>(
      `/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=${perPage}&page=${page}`
    );

    const repos = (data.items || []).map((repo, index) => ({
      ...repo,
      rank: (page - 1) * perPage + index + 1,
      channel: 'trending' as DiscoveryChannelId,
      platform,
    }));

    return {
      repos,
      hasMore: repos.length === perPage,
      nextPageIndex: page + 1,
      totalCount: data.total_count,
    };
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

    const data = await this.makeRequest<GitHubSearchRepoResponse>(
      `/search/repositories?q=${encodeURIComponent(searchQuery)}&sort=${sort}&order=${order}&per_page=${perPage}&page=${page}`
    );

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