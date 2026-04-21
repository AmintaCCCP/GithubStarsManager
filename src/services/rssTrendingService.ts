import { DiscoveryRepo, RSSTimeRange, PaginatedDiscoveryRepositories } from '../types';
import { GitHubApiService } from './githubApi';

interface RSSItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
}

const RSS_BASE_URL = 'https://mshibanami.github.io/GitHubTrendingRSS';

const RSS_URLS: Record<RSSTimeRange, string> = {
  daily: `${RSS_BASE_URL}/daily/all.xml`,
  weekly: `${RSS_BASE_URL}/weekly/all.xml`,
  monthly: `${RSS_BASE_URL}/monthly/all.xml`,
};

const MAX_CONCURRENT_REQUESTS = 8;

export class RSSTrendingService {
  private githubApi: GitHubApiService;

  constructor(githubToken: string) {
    this.githubApi = new GitHubApiService(githubToken);
  }

  async fetchRSSTrending(
    timeRange: RSSTimeRange,
    onProgress?: (current: number, total: number) => void
  ): Promise<PaginatedDiscoveryRepositories> {
    const rssUrl = RSS_URLS[timeRange];
    
    let response: Response;
    try {
      response = await fetch(rssUrl);
    } catch (fetchError) {
      console.error('[RSSTrending] Network error:', fetchError);
      throw new Error(`Network error while fetching RSS feed: ${fetchError instanceof Error ? fetchError.message : 'Unknown error'}`);
    }

    if (!response.ok) {
      console.error(`[RSSTrending] HTTP error: ${response.status} ${response.statusText}`);
      throw new Error(`Failed to fetch RSS feed: ${response.status} ${response.statusText}`);
    }

    let xmlText: string;
    try {
      xmlText = await response.text();
    } catch (textError) {
      console.error('[RSSTrending] Error reading response:', textError);
      throw new Error(`Failed to read RSS feed response: ${textError instanceof Error ? textError.message : 'Unknown error'}`);
    }

    if (!xmlText || xmlText.trim().length === 0) {
      console.error('[RSSTrending] Empty RSS feed response');
      return {
        repos: [],
        hasMore: false,
        nextPageIndex: 2,
        totalCount: 0,
      };
    }

    let items: RSSItem[];
    try {
      items = this.parseRSS(xmlText);
    } catch (parseError) {
      console.error('[RSSTrending] Error parsing RSS:', parseError);
      throw new Error(`Failed to parse RSS feed: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`);
    }

    if (!items || items.length === 0) {
      console.warn('[RSSTrending] No items found in RSS feed');
      return {
        repos: [],
        hasMore: false,
        nextPageIndex: 2,
        totalCount: 0,
      };
    }

    const repoInfos = items
      .map((item, index) => ({ item, index, info: this.extractRepoInfo(item) }))
      .filter((entry): entry is { item: RSSItem; index: number; info: { owner: string; repo: string } } => entry.info !== null);

    if (repoInfos.length === 0) {
      console.warn('[RSSTrending] No valid repository info extracted from RSS items');
      return {
        repos: [],
        hasMore: false,
        nextPageIndex: 2,
        totalCount: 0,
      };
    }

    const repos: DiscoveryRepo[] = [];
    let completed = 0;
    const total = repoInfos.length;

    onProgress?.(0, total);

    const batches: typeof repoInfos[] = [];
    for (let i = 0; i < repoInfos.length; i += MAX_CONCURRENT_REQUESTS) {
      batches.push(repoInfos.slice(i, i + MAX_CONCURRENT_REQUESTS));
    }

    for (const batch of batches) {
      const results = await Promise.allSettled(
        batch.map(async ({ info, index }) => {
          try {
            const fullRepo = await this.githubApi.getRepository(info.owner, info.repo);
            if (fullRepo) {
              return {
                ...fullRepo,
                rank: index + 1,
                channel: 'rss-trending' as const,
                platform: 'All' as const,
              };
            }
            return null;
          } catch (repoError) {
            console.warn(`[RSSTrending] Failed to fetch repo ${info.owner}/${info.repo}:`, repoError);
            return null;
          }
        })
      );

      for (const result of results) {
        completed++;
        if (result.status === 'fulfilled' && result.value) {
          repos.push(result.value);
        } else if (result.status === 'rejected') {
          console.warn(`[RSSTrending] Promise rejected:`, result.reason);
        }
        onProgress?.(completed, total);
      }
    }

    repos.sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));

    return {
      repos,
      hasMore: false,
      nextPageIndex: 2,
      totalCount: repos.length,
    };
  }

  private parseRSS(xmlText: string): RSSItem[] {
    if (!xmlText || typeof xmlText !== 'string') {
      return [];
    }

    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'text/xml');

    const parseError = xmlDoc.querySelector('parsererror');
    if (parseError) {
      console.error('[RSSTrending] XML parse error:', parseError.textContent);
      throw new Error('Invalid XML format in RSS feed');
    }

    const items: RSSItem[] = [];
    const itemElements = xmlDoc.querySelectorAll('item');

    itemElements.forEach((item) => {
      try {
        const title = item.querySelector('title')?.textContent || '';
        const link = item.querySelector('link')?.textContent || '';
        const description = item.querySelector('description')?.textContent || '';
        const pubDate = item.querySelector('pubDate')?.textContent || '';

        if (title || link) {
          items.push({ title, link, description, pubDate });
        }
      } catch (itemError) {
        console.warn('[RSSTrending] Error parsing RSS item:', itemError);
      }
    });

    return items;
  }

  private extractRepoInfo(item: RSSItem): { owner: string; repo: string } | null {
    if (!item || typeof item !== 'object') {
      return null;
    }

    if (item.title && typeof item.title === 'string') {
      const match = item.title.match(/^([^/]+)\/([^:\s]+)/);
      if (match && match[1] && match[2]) {
        return { owner: match[1], repo: match[2] };
      }
    }

    if (item.link && typeof item.link === 'string') {
      const urlMatch = item.link.match(/github\.com\/([^/]+)\/([^/]+)/);
      if (urlMatch && urlMatch[1] && urlMatch[2]) {
        return { owner: urlMatch[1], repo: urlMatch[2] };
      }
    }

    return null;
  }
}
