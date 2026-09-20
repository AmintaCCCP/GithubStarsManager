/**
 * 剪贴板里的 GitHub 链接识别（开发守则 §11）。
 *
 * 只做本地解析：非 GitHub 内容立即返回 null，调用方不得保存原始剪贴板文本。
 * 解析结果里带 `fullName` / `tag` / `login` 与规范化后的 `url`，供界面展示与打开。
 */

export type GitHubClipboardTargetKind = 'repository' | 'release' | 'developer';

export interface GitHubClipboardTarget {
  kind: GitHubClipboardTargetKind;
  /** 仓库类目标（kind 为 repository / release 时存在）。 */
  owner?: string;
  name?: string;
  /** kind 为 release 时存在。 */
  tag?: string;
  /** kind 为 developer 时存在。 */
  login?: string;
  /** 规范化后的 github.com 链接。 */
  url: string;
  /** 展示用标识：`owner/repo`、`owner/repo@tag` 或 `@login`。 */
  label: string;
}

const ALLOWED_HOSTS = new Set(['github.com', 'www.github.com']);

/** github.com 上被保留的一级路径，不可能是用户名。 */
const RESERVED_ROOTS = new Set([
  'about', 'account', 'apps', 'collections', 'contact', 'customer-stories', 'dashboard',
  'events', 'explore', 'features', 'issues', 'join', 'login', 'logout', 'marketplace',
  'new', 'notifications', 'orgs', 'pricing', 'pulls', 'search', 'security', 'settings',
  'signup', 'site', 'sponsors', 'topics', 'trending', 'watching',
]);

const OWNER_RE = /^(?=.{1,39}$)(?!-)(?!.*--)[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;
const REPOSITORY_RE = /^(?=.{1,100}$)[A-Za-z0-9._-]+$/;

/** 去掉结尾的 `.git`、多余斜杠与查询串/锚点带来的噪声。 */
const normalizeSegments = (pathname: string): string[] => pathname
  .split('/')
  .map((segment) => segment.trim())
  .filter(Boolean);

const trimTrailingClipboardPunctuation = (value: string): string => {
  let result = value;
  while (/[),.;!?\]}]$/.test(result)) {
    // A final `.` or `..` can be an actual URL path segment. Preserve it so URL
    // normalization cannot turn an invalid repository path into a profile URL.
    if (result.endsWith('.') && /\/\.\.?$/.test(result)) break;
    result = result.slice(0, -1);
  }
  return result;
};

const containsControlCharacter = (value: string): boolean => [...value].some((character) => {
  const codePoint = character.codePointAt(0) ?? 0;
  return codePoint <= 0x1f || codePoint === 0x7f;
});

export const parseGitHubClipboardTarget = (text: string | null | undefined): GitHubClipboardTarget | null => {
  if (typeof text !== 'string') return null;
  // 剪贴板里常常是一整段话；跳过其它站点，取其中第一个 GitHub URL。
  const matches = text.matchAll(/https?:\/\/[^\s<>"'`]+/gi);
  let parsed: URL | null = null;
  for (const match of matches) {
    try {
      const candidateText = trimTrailingClipboardPunctuation(match[0]);
      const rawPath = candidateText.match(/^https?:\/\/[^/?#]+([^?#]*)/i)?.[1] ?? '';
      if (rawPath.split('/').some((segment) => /^(?:\.|%2e){1,2}$/i.test(segment))) continue;
      const candidate = new URL(candidateText);
      if (ALLOWED_HOSTS.has(candidate.hostname.toLowerCase())
        && !candidate.username && !candidate.password && !candidate.port) {
        parsed = candidate;
        break;
      }
    } catch {
      // Continue looking for a later valid GitHub URL.
    }
  }
  if (!parsed) return null;

  const segments = normalizeSegments(parsed.pathname);
  if (segments.length === 0) return null;

  const [owner, rawName] = segments;
  if (!OWNER_RE.test(owner)) return null;

  if (segments.length === 1) {
    if (RESERVED_ROOTS.has(owner.toLowerCase())) return null;
    return { kind: 'developer', login: owner, url: `https://github.com/${owner}`, label: `@${owner}` };
  }

  const name = rawName.replace(/\.git$/i, '');
  if (!REPOSITORY_RE.test(name) || name === '.' || name === '..') return null;
  const repository = `${owner}/${name}`;
  const repositoryUrl = `https://github.com/${repository}`;

  if (segments[2] === 'releases' && segments[3] === 'tag' && segments[4]) {
    let tag: string;
    try {
      tag = decodeURIComponent(segments.slice(4).join('/'));
    } catch {
      return null;
    }
    if (!tag || tag.length > 255 || containsControlCharacter(tag)) return null;
    return {
      kind: 'release',
      owner,
      name,
      tag,
      url: `${repositoryUrl}/releases/tag/${encodeURIComponent(tag)}`,
      label: `${repository}@${tag}`,
    };
  }

  // 仓库内的其它路径（issues / tree / blob / pull…）一律归到所属仓库，与批量导入的口径一致。
  return { kind: 'repository', owner, name, url: repositoryUrl, label: repository };
};
