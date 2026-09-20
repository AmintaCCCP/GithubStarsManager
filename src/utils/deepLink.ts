/**
 * Deep Link 解析与校验（开发守则 §12）。
 *
 * 支持：
 *   githubstarsmanager://repo/owner/name
 *   githubstarsmanager://release/owner/name/tag
 *   githubstarsmanager://developer/login
 *   githubstarsmanager://plugins/plugin-id
 *
 * 所有参数在这里重新校验，不信任来源：仓库名/用户名只允许 GitHub 实际会用到的字符，
 * 开发者主页里被保留的一级路径（settings、marketplace…）一律拒绝，插件 id 只允许
 * 反向域名风格。解析只产出"目标"，任何有副作用的动作都不在这里发生。
 */

export type DeepLinkTarget =
  | { kind: 'repository'; owner: string; name: string; url: string }
  | { kind: 'release'; owner: string; name: string; tag: string; url: string }
  | { kind: 'developer'; login: string; url: string }
  | { kind: 'plugin'; pluginId: string };

export const DEEP_LINK_PROTOCOL = 'githubstarsmanager:';
const DEEP_LINK_PREFIX = 'githubstarsmanager://';

const OWNER_RE = /^(?=.{1,39}$)(?!-)(?!.*--)[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;
const REPOSITORY_RE = /^(?=.{1,100}$)[A-Za-z0-9._-]+$/;
const PLUGIN_ID_RE = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/;

/** github.com 上被保留的一级路径，不可能是用户名。 */
const RESERVED_ROOTS = new Set([
  'about', 'account', 'apps', 'collections', 'contact', 'customer-stories', 'dashboard',
  'events', 'explore', 'features', 'issues', 'join', 'login', 'logout', 'marketplace',
  'new', 'notifications', 'orgs', 'pricing', 'pulls', 'search', 'security', 'settings',
  'signup', 'site', 'sponsors', 'topics', 'trending', 'watching',
]);

const isRepositoryName = (value: string): boolean => (
  REPOSITORY_RE.test(value) && value !== '.' && value !== '..'
);

const hasInvalidTagCharacter = (value: string): boolean => {
  const reserved = '~^:?*[]\\';
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f || reserved.includes(character)) return true;
  }
  return false;
};

const isReleaseTag = (value: string): boolean => (
  value.length > 0
  && value.length <= 255
  && !hasInvalidTagCharacter(value)
  && !value.includes('..')
  && !value.includes('@{')
  && !value.includes('//')
  && !value.startsWith('/')
  && !value.endsWith('/')
  && !value.endsWith('.')
);

export const parseDeepLink = (value: unknown): DeepLinkTarget | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.slice(0, DEEP_LINK_PREFIX.length).toLowerCase() !== DEEP_LINK_PREFIX) return null;

  // URL 会在暴露 pathname 前折叠 `.` / `..`，必须先检查原始片段。
  for (const rawSegment of trimmed.slice(DEEP_LINK_PREFIX.length).split('/')) {
    if (!rawSegment) continue;
    try {
      const decoded = decodeURIComponent(rawSegment);
      if (decoded === '.' || decoded === '..') return null;
    } catch {
      return null;
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol.toLowerCase() !== DEEP_LINK_PROTOCOL || parsed.username || parsed.password
    || parsed.port || parsed.search || parsed.hash) return null;

  // 双斜杠写法把 kind 放在 hostname；三斜杠写法则全部落在 pathname。
  const pathSegments = parsed.pathname.split('/');
  if (pathSegments[0] === '') pathSegments.shift();
  if (pathSegments[pathSegments.length - 1] === '') pathSegments.pop();
  if (pathSegments.some((segment) => segment === '')) return null;
  const rawSegments = parsed.hostname ? [parsed.hostname, ...pathSegments] : pathSegments;
  const segments: string[] = [];
  try {
    for (const segment of rawSegments) segments.push(decodeURIComponent(segment));
  } catch {
    return null;
  }
  if (segments.length === 0) return null;

  const [kind, ...args] = segments;

  switch (kind.toLowerCase()) {
    case 'repo': {
      const [owner, name, ...extra] = args;
      if (extra.length > 0 || !owner || !name) return null;
      if (!OWNER_RE.test(owner) || !isRepositoryName(name)) return null;
      return { kind: 'repository', owner, name, url: `https://github.com/${owner}/${name}` };
    }
    case 'release': {
      const [owner, name, ...tagParts] = args;
      if (!owner || !name || tagParts.length === 0) return null;
      if (!OWNER_RE.test(owner) || !isRepositoryName(name)) return null;
      // tag 里可能有斜杠（如 release/1.0），只校验整体不含反斜杠与空白
      const tag = tagParts.join('/');
      if (!isReleaseTag(tag)) return null;
      return {
        kind: 'release',
        owner,
        name,
        tag,
        url: `https://github.com/${owner}/${name}/releases/tag/${encodeURIComponent(tag)}`,
      };
    }
    case 'developer': {
      const [login, ...extra] = args;
      if (extra.length > 0 || !login) return null;
      if (!OWNER_RE.test(login) || RESERVED_ROOTS.has(login.toLowerCase())) return null;
      return { kind: 'developer', login, url: `https://github.com/${login}` };
    }
    case 'plugins': {
      const [pluginId, ...extra] = args;
      if (extra.length > 0 || !pluginId) return null;
      if (!PLUGIN_ID_RE.test(pluginId)) return null;
      return { kind: 'plugin', pluginId };
    }
    default:
      return null;
  }
};
