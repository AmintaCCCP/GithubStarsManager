import type { DiscoveryChannelId, DiscoveryRepo, PaginatedDiscoveryRepositories } from '../types';
import type { GitHubApiService } from './githubApi';
import { normalizeDiscoveryFeedUrl, parseDiscoveryFeedRepositories } from '../utils/discoveryFeeds';

const MAX_RESPONSE_CHARS = 128_000;

/** Validate the public feed before it can be saved as a channel. */
export async function readExternalDiscoveryFeed(sourceUrl: string): Promise<string[]> {
  const url = normalizeDiscoveryFeedUrl(sourceUrl);
  if (!url) throw new Error('A feed must use a valid HTTPS URL');

  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'omit' });
  } catch {
    throw new Error('Could not read the feed. Check its URL and browser CORS permissions.');
  }
  if (!response.ok) throw new Error(`Feed request failed: ${response.status}`);
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_CHARS) throw new Error('Feed response is too large');
  const text = await response.text();
  if (text.length > MAX_RESPONSE_CHARS) throw new Error('Feed response is too large');
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('Feed did not return valid JSON');
  }
  return parseDiscoveryFeedRepositories(payload);
}

/** Resolve feed links through the existing GitHub API, keeping the feed itself read-only. */
export async function loadExternalDiscoveryFeed(
  sourceUrl: string,
  channelId: DiscoveryChannelId,
  api: GitHubApiService,
): Promise<PaginatedDiscoveryRepositories> {
  const names = await readExternalDiscoveryFeed(sourceUrl);
  const repos: DiscoveryRepo[] = [];
  for (let start = 0; start < names.length; start += 5) {
    const batch = await Promise.all(names.slice(start, start + 5).map(async (fullName) => {
      const [owner, repo] = fullName.split('/');
      try {
        return await api.getRepositoryDetails(owner, repo);
      } catch {
        return null;
      }
    }));
    for (const detail of batch) {
      if (detail) repos.push({ ...detail, rank: repos.length + 1, channel: channelId, platform: 'All' });
    }
  }
  if (names.length > 0 && repos.length === 0) throw new Error('None of the feed repositories could be loaded from GitHub');
  return { repos, hasMore: false, nextPageIndex: 2, totalCount: repos.length };
}
