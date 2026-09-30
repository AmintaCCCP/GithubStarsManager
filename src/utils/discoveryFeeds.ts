import type { DiscoveryChannel } from '../types';

const MAX_FEEDS = 10;
const FEED_ID = /^external:[a-z0-9-]{1,64}$/;
const REPOSITORY_NAME = /^[A-Za-z0-9_.-]+$/;

export function normalizeDiscoveryFeedUrl(input: string): string | null {
  try {
    const url = new URL(input.trim());
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || input.length > 2048) return null;
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

export function isExternalDiscoveryChannelId(id: string): id is `external:${string}` {
  return FEED_ID.test(id);
}

/** Keep only valid user feeds from a persisted snapshot. Built-in channels are normalized elsewhere. */
export function normalizeExternalDiscoveryChannels(input: unknown): DiscoveryChannel[] {
  if (!Array.isArray(input)) return [];
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();
  const feeds: DiscoveryChannel[] = [];
  for (const value of input) {
    if (!value || typeof value !== 'object') continue;
    const item = value as Record<string, unknown>;
    if (typeof item.id !== 'string' || !isExternalDiscoveryChannelId(item.id)) continue;
    if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 60) continue;
    if (typeof item.sourceUrl !== 'string') continue;
    const sourceUrl = normalizeDiscoveryFeedUrl(item.sourceUrl);
    if (!sourceUrl || seenIds.has(item.id) || seenUrls.has(sourceUrl)) continue;
    seenIds.add(item.id);
    seenUrls.add(sourceUrl);
    feeds.push({
      id: item.id,
      name: item.name.trim(),
      nameEn: item.name.trim(),
      icon: 'search',
      description: sourceUrl,
      sourceUrl,
      enabled: item.enabled !== false,
    });
    if (feeds.length === MAX_FEEDS) break;
  }
  return feeds;
}

export function parseDiscoveryFeedRepositories(input: unknown): string[] {
  if (!input || typeof input !== 'object' || !Array.isArray((input as { repositories?: unknown }).repositories)) {
    throw new Error('Invalid feed format: expected { "repositories": ["https://github.com/owner/repo"] }');
  }
  const repositories = (input as { repositories: unknown[] }).repositories;
  if (repositories.length > 30) throw new Error('Feed contains more than 30 repositories');
  const names = new Map<string, string>();
  for (const value of repositories) {
    if (typeof value !== 'string') throw new Error('Feed contains an invalid repository link');
    let fullName = value.trim();
    if (fullName.startsWith('https://github.com/')) {
      const url = new URL(fullName);
      if (url.hostname !== 'github.com' || url.search || url.hash) throw new Error('Feed contains an invalid repository link');
      fullName = url.pathname.replace(/^\//, '').replace(/\/$/, '');
    }
    const parts = fullName.split('/');
    if (parts.length !== 2 || !parts.every(part => REPOSITORY_NAME.test(part))) {
      throw new Error('Feed contains an invalid repository link');
    }
    if (!names.has(fullName.toLowerCase())) names.set(fullName.toLowerCase(), fullName);
  }
  return [...names.values()];
}
