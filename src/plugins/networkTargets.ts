/**
 * V1.5 页面网络能力的渲染端闸门：主进程（electron/plugins/pluginPageBridge.js）
 * 在授权时校验同一份 host/path 白名单；这里在真正发起 fetch 前复核一次，
 * 两侧一致性由 `pluginPageBridge parity` 测试（src/plugins/networkTargets.test.ts）保证。
 */

export interface PluginNetworkRequestArgs {
  host: string;
  path: string;
  query?: Record<string, unknown>;
}

export const NETWORK_ALLOWED_HOSTS: readonly string[] = ['api.github.com'];

/** 与主进程 NETWORK_ALLOWED_REPO_PATHS 相同的只读指标端点模板。 */
export const NETWORK_ALLOWED_REPO_PATHS: readonly string[] = [
  '/repos/{owner}/{repo}',
  '/repos/{owner}/{repo}/stats/commit_activity',
  '/repos/{owner}/{repo}/stats/participation',
  '/repos/{owner}/{repo}/stats/code_frequency',
  '/repos/{owner}/{repo}/contributors',
  '/repos/{owner}/{repo}/languages',
  '/repos/{owner}/{repo}/releases',
  '/repos/{owner}/{repo}/pulls',
  '/repos/{owner}/{repo}/tags',
  '/repos/{owner}/{repo}/stargazers',
  '/repos/{owner}/{repo}/stargazers/history',
  '/repos/{owner}/{repo}/community/profile',
  '/repos/{owner}/{repo}/security-advisories',
];

/** 与主进程 NETWORK_ALLOWED_USER_PATHS 相同的所有者资料端点。 */
export const NETWORK_ALLOWED_USER_PATHS: readonly string[] = ['/users/{login}'];

const GITHUB_OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const GITHUB_REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const NETWORK_QUERY_KEYS = new Set(['per_page', 'page', 'state']);

/** 校验入参来自插件页面，不可信：签名收 unknown，内部自行收窄。 */
export function isAllowedNetworkTarget(input: unknown): boolean {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const args = input as Record<string, unknown>;
  if (typeof args.host !== 'string' || !NETWORK_ALLOWED_HOSTS.includes(args.host)) return false;
  const path = args.path;
  if (typeof path !== 'string' || !path || path.length > 500) return false;
  if (!path.startsWith('/') || /[?#\\\s]/.test(path) || !/^[\x21-\x7e]+$/.test(path)) return false;
  if (path.includes('//') || path.endsWith('/')) return false;
  const segments = path.split('/').filter(Boolean);
  // '.' / '..' 段会被 URL 规范化解析掉，造成路径越界，直接拒绝。
  if (segments.some((segment) => segment === '.' || segment === '..')) return false;
  if (segments[0] === 'users') {
    // 所有者资料：/users/{login}。
    return segments.length === 2 && GITHUB_OWNER_RE.test(segments[1]);
  }
  if (segments.length < 3 || segments[0] !== 'repos') return false;
  const [, owner, repo, ...tail] = segments;
  if (!GITHUB_OWNER_RE.test(owner) || !GITHUB_REPO_RE.test(repo)) return false;
  const templateMatches = NETWORK_ALLOWED_REPO_PATHS.some((template) => {
    const templateTail = template.split('/').filter(Boolean).slice(3);
    return templateTail.length === tail.length && templateTail.every((part, index) => part === tail[index]);
  });
  if (!templateMatches) return false;
  // 与主进程一致：query 仅允许 per_page / page（1–100 的整数）与 pulls 的 state。
  if (args.query === undefined) return true;
  if (!args.query || typeof args.query !== 'object' || Array.isArray(args.query)) return false;
  const query = args.query as Record<string, unknown>;
  if (Object.keys(query).some((key) => !NETWORK_QUERY_KEYS.has(key))) return false;
  if ('per_page' in query && (!Number.isInteger(query.per_page) || (query.per_page as number) < 1 || (query.per_page as number) > 100)) return false;
  if ('page' in query && (!Number.isInteger(query.page) || (query.page as number) < 1 || (query.page as number) > 100)) return false;
  if ('state' in query && !['open', 'closed', 'all'].includes(query.state as string)) return false;
  return true;
}

/** 组装最终请求 URL；只在 isAllowedNetworkTarget 通过后调用。 */
export function buildNetworkRequestUrl(args: PluginNetworkRequestArgs): string {
  const url = new URL(`https://${args.host}${args.path}`);
  for (const [key, value] of Object.entries(args.query ?? {})) {
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}
