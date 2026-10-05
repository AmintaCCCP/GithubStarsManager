'use strict';

const { protocolError } = require('./pluginProtocol');

const METHODS = {
  'repositories.search': { capability: 'github', operation: 'searchRepositories', fields: ['query', 'limit'] },
  'repositories.get': { capability: 'github', operation: 'getRepository', fields: ['repositoryId'] },
  'releases.get': { capability: 'github', operation: 'getRelease', fields: ['releaseId'] },
  'storage.get': { capability: 'storage', operation: 'get', fields: ['key'] },
  'storage.set': { capability: 'storage', operation: 'set', fields: ['key', 'value'] },
  'storage.delete': { capability: 'storage', operation: 'delete', fields: ['key'] },
  'ai.generate': { capability: 'ai', operation: 'generate', fields: ['system', 'user', 'maxTokens'] },
  'web.search': { capability: 'web', operation: 'search', fields: ['query', 'limit'] },
  'network.request': { capability: 'network', operation: 'request', fields: ['host', 'path', 'query'] },
  'clipboard.write': { capability: 'clipboard', operation: 'write', fields: ['text'] },
  'clipboard.writeImage': { capability: 'clipboard', operation: 'writeImage', fields: ['dataBase64'] },
  'downloads.saveFile': { capability: 'downloads', operation: 'saveFile', fields: ['fileName', 'dataBase64'] },
};

// V1.5 页面网络能力：宿主按 `network:<host>` 权限代理只读 GET 请求。目标主机
// 与路径模式在这里白名单化；渲染端执行前用同一份清单复核（见
// src/plugins/networkTargets.ts，两侧一致性由 pluginPageBridge parity 测试保证）。
const NETWORK_ALLOWED_HOSTS = new Set(['api.github.com']);
// 只读公开指标端点。{owner}/{repo} 段在下方单独校验；不允许查询串——
// 分页参数走单独的 `query` 字段（仅 per_page/page），避免任意 URL 拼接。
const NETWORK_ALLOWED_REPO_PATHS = [
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
// 仓库所有者（用户或组织）资料，供维护者容器展示。
const NETWORK_ALLOWED_USER_PATHS = ['/users/{login}'];
const GITHUB_OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const GITHUB_REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const MAX_NETWORK_PATH_BYTES = 500;

// 生成型页面（如截图导出）需要回传二进制结果，单独放宽；base64 编码后
// 10 MiB 约对应 7.5 MiB 原始字节。其余方法维持 1 MiB 的通用上限。
const DEFAULT_MAX_ARGS_BYTES = 1024 * 1024;
const BINARY_RESULT_MAX_ARGS_BYTES = 10 * 1024 * 1024;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const MAX_CLIPBOARD_TEXT_CHARS = 200_000;
// 内容生成页需要把仓库 README 全文原样放进 ai.generate 正文（见
// examples/plugins/repo-info-card）。160k 字符在 UTF-8 下最多约 480 KB，
// 加上 JSON 转义仍远低于上面的 1 MiB 通用预算，渲染端同款闸门同样放行。
const MAX_AI_USER_CHARS = 160_000;

function argsBudget(method) {
  return method === 'clipboard.writeImage' || method === 'downloads.saveFile'
    ? BINARY_RESULT_MAX_ARGS_BYTES
    : DEFAULT_MAX_ARGS_BYTES;
}

function validateNetworkRequestArgs(args) {
  if (typeof args.host !== 'string' || !NETWORK_ALLOWED_HOSTS.has(args.host)) return false;
  if (typeof args.path !== 'string' || !args.path ||
    Buffer.byteLength(args.path, 'utf8') > MAX_NETWORK_PATH_BYTES) return false;
  // 只允许纯路径：不带查询串、片段、凭据、反斜杠或空白，避免任何拼接歧义。
  if (!args.path.startsWith('/') || /[?#\\\s]/.test(args.path) || !/^[\x21-\x7e]+$/.test(args.path)) return false;
  if (args.path.includes('//') || args.path.endsWith('/')) return false;
  const segments = args.path.split('/').filter(Boolean);
  // '.' / '..' 段会被 URL 规范化解析掉，造成路径越界，直接拒绝。
  if (segments.some((segment) => segment === '.' || segment === '..')) return false;
  if (segments[0] === 'users') {
    // 所有者资料：/users/{login}。
    return segments.length === 2 && NETWORK_ALLOWED_USER_PATHS.length > 0 && GITHUB_OWNER_RE.test(segments[1]);
  }
  if (segments[0] !== 'repos' || segments.length < 3) return false;
  const [repos, owner, repo, ...tail] = segments;
  if (repos !== 'repos' || !GITHUB_OWNER_RE.test(owner) || !GITHUB_REPO_RE.test(repo)) return false;
  // 模板尾段逐段比较：{owner}/{repo} 已单独校验，其余段必须与白名单完全一致。
  const tailMatches = NETWORK_ALLOWED_REPO_PATHS.some((template) => {
    const templateTail = template.split('/').filter(Boolean).slice(3);
    return templateTail.length === tail.length && templateTail.every((part, index) => part === tail[index]);
  });
  if (!tailMatches) return false;
  if (args.query === undefined) return true;
  if (!args.query || typeof args.query !== 'object' || Array.isArray(args.query)) return false;
  const keys = Object.keys(args.query);
  if (keys.some((key) => key !== 'per_page' && key !== 'page' && key !== 'state')) return false;
  if ('per_page' in args.query && (!Number.isInteger(args.query.per_page) || args.query.per_page < 1 || args.query.per_page > 100)) return false;
  if ('page' in args.query && (!Number.isInteger(args.query.page) || args.query.page < 1 || args.query.page > 100)) return false;
  if ('state' in args.query && !['open', 'closed', 'all'].includes(args.query.state)) return false;
  return true;
}

function validatePageCapabilityRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
    Object.keys(input).some((field) => !['pluginId', 'pageId', 'method', 'args'].includes(field))) {
    throw protocolError('PLUGIN_PAGE_REQUEST_INVALID', 'Page request is invalid');
  }
  const { pluginId, pageId, method, args = {} } = input;
  if (typeof pluginId !== 'string' || typeof pageId !== 'string' || typeof method !== 'string' ||
    !Object.hasOwn(METHODS, method) || !args || typeof args !== 'object' || Array.isArray(args)) {
    throw protocolError('PLUGIN_PAGE_REQUEST_INVALID', 'Page request is invalid');
  }
  const definition = METHODS[method];
  if (Object.keys(args).some((field) => !definition.fields.includes(field))) {
    throw protocolError('PLUGIN_PAGE_REQUEST_INVALID', 'Page request has unknown arguments');
  }
  if (Buffer.byteLength(JSON.stringify(args), 'utf8') > argsBudget(method)) {
    throw protocolError('PLUGIN_PAGE_REQUEST_TOO_LARGE', 'Page request is too large');
  }
  if (method === 'repositories.search' &&
    (typeof args.query !== 'string' || args.query.length > 200 ||
      (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 100)))) {
    throw protocolError('PLUGIN_PAGE_REQUEST_INVALID', 'Repository search arguments are invalid');
  }
  if (method === 'repositories.get' && (!Number.isSafeInteger(args.repositoryId) || args.repositoryId <= 0)) {
    throw protocolError('PLUGIN_PAGE_REQUEST_INVALID', 'Repository id is invalid');
  }
  if (method === 'releases.get' && (!Number.isSafeInteger(args.releaseId) || args.releaseId <= 0)) {
    throw protocolError('PLUGIN_PAGE_REQUEST_INVALID', 'Release id is invalid');
  }
  if (method.startsWith('storage.') && (typeof args.key !== 'string' || !args.key)) {
    throw protocolError('PLUGIN_PAGE_REQUEST_INVALID', 'Storage key is invalid');
  }
  if (method === 'ai.generate' &&
    (typeof args.system !== 'string' || args.system.length > 2000 ||
      typeof args.user !== 'string' || !args.user.trim() || args.user.length > MAX_AI_USER_CHARS ||
      (args.maxTokens !== undefined && (!Number.isInteger(args.maxTokens) || args.maxTokens < 1 || args.maxTokens > 4000)))) {
    throw protocolError('PLUGIN_PAGE_REQUEST_INVALID', 'AI request arguments are invalid');
  }
  if (method === 'web.search' &&
    (typeof args.query !== 'string' || !args.query.trim() || args.query.length > 200 ||
      (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 10)))) {
    throw protocolError('PLUGIN_PAGE_REQUEST_INVALID', 'Web search arguments are invalid');
  }
  if (method === 'network.request' && !validateNetworkRequestArgs(args)) {
    throw protocolError('PLUGIN_PAGE_REQUEST_INVALID', 'Network request arguments are invalid');
  }
  if (method === 'clipboard.write' &&
    (typeof args.text !== 'string' || args.text.length === 0 || args.text.length > MAX_CLIPBOARD_TEXT_CHARS)) {
    throw protocolError('PLUGIN_PAGE_REQUEST_INVALID', 'Clipboard text arguments are invalid');
  }
  if (method === 'clipboard.writeImage' || method === 'downloads.saveFile') {
    if (typeof args.dataBase64 !== 'string' || args.dataBase64.length === 0 ||
      !BASE64_RE.test(args.dataBase64) || Buffer.from(args.dataBase64, 'base64').length === 0) {
      throw protocolError('PLUGIN_PAGE_REQUEST_INVALID', 'Base64 payload arguments are invalid');
    }
  }
  if (method === 'downloads.saveFile' &&
    (typeof args.fileName !== 'string' || !args.fileName.trim() || args.fileName.length > 200 ||
      /[\\/]/.test(args.fileName) || args.fileName.startsWith('.'))) {
    throw protocolError('PLUGIN_PAGE_REQUEST_INVALID', 'Download file name arguments are invalid');
  }
  return { pluginId, pageId, capability: definition.capability, operation: definition.operation, args };
}

module.exports = {
  validatePageCapabilityRequest,
  NETWORK_ALLOWED_HOSTS,
  NETWORK_ALLOWED_REPO_PATHS,
  NETWORK_ALLOWED_USER_PATHS,
};
