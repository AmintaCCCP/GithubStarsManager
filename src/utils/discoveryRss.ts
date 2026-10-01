/**
 * 从 RSS/Atom 订阅内容中提取 GitHub 仓库链接。
 * 订阅条目里的链接可能出现在 <link>、<guid>、description/content 等任意位置，
 * 因此直接对文本做模式提取（只取 owner/repo 两段，拒绝 GitHub 站内功能区路径）。
 */

/** GitHub 站内非仓库功能区（这些首段是 GitHub 保留路径，不可能是用户名）。 */
const NON_REPO_SEGMENTS = new Set([
  'topics', 'trending', 'features', 'marketplace', 'collections', 'explore',
  'sponsors', 'orgs', 'apps', 'search', 'settings', 'notifications', 'login',
  'join', 'pricing', 'security', 'events', 'about', 'contact', 'docs', 'site',
  'new', 'import', 'gist', 'gists', 'labs', 'customer-stories', 'readme',
  'maintainer', 'sponsored', 'enterprise', 'team', 'pricing',
]);

/** 末段不允许以点结尾，避免从正文句子里截出 "repo." 这样的尾部句号。 */
const GITHUB_REPO_LINK = /https?:\/\/github\.com\/([A-Za-z0-9_.-]*[A-Za-z0-9_-])\/([A-Za-z0-9_.-]*[A-Za-z0-9_-])/gi;

function isRssLike(text: string): boolean {
  if (/<html[\s>]/i.test(text)) return false;
  return /<(?:rss|feed|channel|item|entry)[\s>]/i.test(text);
}

export function parseDiscoveryRssRepositories(input: string): string[] {
  const text = input.trim();
  if (!text || text.length > 2_000_000 || !isRssLike(text)) {
    throw new Error('The URL did not return a valid RSS or Atom feed');
  }
  const names = new Map<string, string>();
  for (const match of text.matchAll(GITHUB_REPO_LINK)) {
    const owner = match[1];
    const repo = match[2];
    if (NON_REPO_SEGMENTS.has(owner.toLowerCase())) continue;
    const fullName = `${owner}/${repo}`;
    if (!names.has(fullName.toLowerCase())) names.set(fullName.toLowerCase(), fullName);
    // 订阅内容可能提及大量仓库，按出现顺序最多取前 30 个（与 JSON 上限一致）
    if (names.size === 30) break;
  }
  if (names.size === 0) throw new Error('No GitHub repository links were found in the feed');
  return [...names.values()];
}
