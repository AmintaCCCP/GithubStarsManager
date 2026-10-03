'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const { MAX_MANIFEST_BYTES, validateManifest } = require('./manifestSchema');
const { createMarketplaceStateStore, normalizeState } = require('./pluginMarketplaceState');
const { loadPluginRegistry } = require('./pluginRegistryFeed');
const { sanitizeText } = require('./pluginLogger');

/**
 * 插件市场（自助插件源）。
 *
 * 用户把"GitHub 仓库目录"添加为插件源；客户端用 GitHub contents API 列出目录，
 * 逐个子目录探测 manifest.json（raw.githubusercontent，只读）形成插件目录。
 * 安装时用 git trees API 拿到该插件目录的完整文件清单，逐文件下载到 staging
 * 目录，再复用 pluginManager.installFromDirectory 完成校验、拷贝与原子落位。
 * 更新 = 先（保留数据）卸载旧版本，再安装新下载的版本。
 *
 * 本模块不做信任背书：来源插件与本地安装的插件走完全相同的 manifest 校验、
 * 权限确认与启用流程；官方静态注册表的撤销/拉黑对照在渲染层另行叠加。
 */

/** 初始化种子源：本仓库自带的示例插件目录。 */
const DEFAULT_PLUGIN_SOURCE_URL = 'https://github.com/AmintaCCCP/GithubStarsManager/tree/main/examples/plugins';

const MAX_LISTING_BYTES = 4 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
/** 单个源目录下的子目录探测上限；超出部分截断并提示，防止异常大目录拖垮遍历。 */
const MAX_SOURCE_DIRECTORIES = 200;
/** 与 pluginManager 的安装限额保持一致。 */
const MAX_PLUGIN_PACKAGE_FILES = 2000;
const MAX_PLUGIN_PACKAGE_BYTES = 50 * 1024 * 1024;
const PROBE_CONCURRENCY = 4;
const DOWNLOAD_CONCURRENCY = 4;

const GITHUB_HOST = 'github.com';
const RAW_HOST = 'raw.githubusercontent.com';
const API_HOST = 'api.github.com';

// Windows 保留设备名与以点/空格结尾的文件名在 Windows 卷上会出问题；git 允许它们，所以下载前要拦。
const WINDOWS_RESERVED_RE = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i;

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function decodeSegment(segment) {
  try {
    return { ok: true, value: decodeURIComponent(segment) };
  } catch {
    return { ok: false };
  }
}

function segmentIsSafe(segment) {
  if (segment.length === 0) return false;
  if (segment === '.' || segment === '..') return false;
  // 拒绝路径分隔符与控制字符；其余字符交给 GitHub 端校验。
  for (const character of segment) {
    const code = character.codePointAt(0);
    if (code < 0x20 || code === 0x7f) return false;
    if (character === '/' || character === '\\') return false;
  }
  return true;
}

/**
 * 解析插件源 URL：https://github.com/{owner}/{repo}[/tree/{ref}[/path]]。
 *
 * GitHub 的 tag 可以含斜杠，与目录路径在 URL 上无法区分；这里按 GitHub 网页的
 * 同样规则处理：tree 后的第一段是 ref，其余是目录路径。带斜杠的 tag 不支持。
 */
function parseSourceUrl(input) {
  if (typeof input !== 'string' || input.length === 0 || input.length > 2048) return null;
  let url;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== GITHUB_HOST) return null;
  if (url.search || url.hash) return null;

  const rawSegments = url.pathname.split('/').filter((segment) => segment.length > 0);
  if (rawSegments.length < 2) return null;

  const decoded = [];
  for (const segment of rawSegments) {
    const result = decodeSegment(segment);
    if (!result.ok || !segmentIsSafe(result.value)) return null;
    decoded.push(result.value);
  }

  const owner = decoded[0];
  let repo = decoded[1];
  if (repo.toLowerCase().endsWith('.git')) repo = repo.slice(0, -4);
  if (repo.length === 0) return null;

  let ref = null;
  let pathSegments;
  if (decoded.length > 2 && decoded[2] === 'tree') {
    if (decoded.length === 3) return null;
    ref = decoded[3];
    if (ref === '.' || ref === '..' || ref.includes('\\')) return null;
    pathSegments = decoded.slice(4);
  } else {
    pathSegments = decoded.slice(2);
  }
  for (const segment of pathSegments) {
    if (!segmentIsSafe(segment)) return null;
  }

  return {
    owner,
    repo,
    ref,
    dirPath: pathSegments.join('/'),
    defaultName: pathSegments.length > 0 ? `${owner}/${repo}/${pathSegments.join('/')}` : `${owner}/${repo}`,
  };
}

function mapLimit(items, limit, mapper) {
  if (items.length === 0) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const results = new Array(items.length);
    let nextIndex = 0;
    let settled = 0;
    let failed = false;
    const launch = () => {
      if (failed) return;
      if (nextIndex >= items.length) {
        if (settled === items.length) resolve(results);
        return;
      }
      const index = nextIndex++;
      Promise.resolve()
        .then(() => mapper(items[index], index))
        .then((value) => {
          if (failed) return;
          results[index] = value;
          settled += 1;
          if (settled === items.length) resolve(results);
          else launch();
        })
        .catch((error) => {
          if (failed) return;
          failed = true;
          reject(error);
        });
    };
    for (let index = 0; index < Math.min(limit, items.length); index += 1) launch();
  });
}

/** 读响应体，流式累计字节数，超过上限立即中止。 */
async function readBodyCap(response, controller, maxBytes) {
  const contentLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    controller.abort();
    return { ok: false, error: { code: 'TOO_LARGE', message: 'Response exceeds the accepted size' } };
  }
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        totalBytes += chunk.byteLength;
        if (totalBytes > maxBytes) {
          controller.abort();
          await reader.cancel().catch(() => undefined);
          return { ok: false, error: { code: 'TOO_LARGE', message: 'Response exceeds the accepted size' } };
        }
        chunks.push(chunk);
      }
    } finally {
      reader.releaseLock?.();
    }
    return { ok: true, bytes: Buffer.concat(chunks, totalBytes) };
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return buffer.byteLength > maxBytes
    ? { ok: false, error: { code: 'TOO_LARGE', message: 'Response exceeds the accepted size' } }
    : { ok: true, bytes: buffer };
}

/**
 * 统一的取数通道：超时、HTTP 状态检查、限流识别、字节上限。
 * 返回 { ok: true, bytes } 或 { ok: false, error: { code, message, status? } }，
 * code 是中性错误（HTTP_ERROR/TIMEOUT/UNREACHABLE/TOO_LARGE/RATE_LIMITED/READ_FAILED），由调用方映射为具体语义。
 */
async function fetchCapped(fetchImpl, url, { headers = {}, maxBytes, requestTimeoutMs }) {
  if (typeof fetchImpl !== 'function') {
    return { ok: false, error: { code: 'UNREACHABLE', message: 'No fetch implementation was provided' } };
  }
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, requestTimeoutMs);
  try {
    const response = await fetchImpl(url, { redirect: 'follow', headers, signal: controller.signal });
    if (!response) {
      return { ok: false, error: { code: 'UNREACHABLE', message: 'Request returned no response' } };
    }
    if (!response.ok) {
      const rateLimited = response.status === 403
        || response.status === 429
        || response.headers?.get?.('x-ratelimit-remaining') === '0';
      return {
        ok: false,
        error: {
          code: rateLimited ? 'RATE_LIMITED' : 'HTTP_ERROR',
          message: `Request returned HTTP ${response.status}`,
          status: response.status,
        },
      };
    }
    const body = await readBodyCap(response, controller, maxBytes);
    if (!body.ok && timedOut) {
      return { ok: false, error: { code: 'TIMEOUT', message: 'Request timed out' } };
    }
    return body;
  } catch (error) {
    if (timedOut) {
      return { ok: false, error: { code: 'TIMEOUT', message: 'Request timed out' } };
    }
    return {
      ok: false,
      error: { code: 'UNREACHABLE', message: error instanceof Error ? error.message : 'Request failed' },
    };
  } finally {
    clearTimeout(timeout);
  }
}

function prefixedError(prefix, error) {
  return { code: `${prefix}_${error.code}`, message: sanitizeText(error.message) };
}

function githubApiHeaders() {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

/** 把路径（可能含多段，如 "plugins/fixture/manifest.json"）编码成安全的 URL 路径，保留段分隔符。 */
function encodePath(...pathParts) {
  return pathParts
    .filter((part) => part !== '')
    .flatMap((part) => part.split('/'))
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function createPluginMarketplace({
  statePath,
  stagingRoot,
  fetchImpl,
  pluginManager,
  requestTimeoutMs = REQUEST_TIMEOUT_MS,
  seedDefaultSource = true,
}) {
  if (typeof statePath !== 'string' || statePath.trim() === '') {
    throw new TypeError('statePath must be a non-empty string');
  }
  if (typeof stagingRoot !== 'string' || stagingRoot.trim() === '') {
    throw new TypeError('stagingRoot must be a non-empty string');
  }
  if (!pluginManager || typeof pluginManager.installFromDirectory !== 'function') {
    throw new TypeError('pluginManager with installFromDirectory is required');
  }

  const stateStore = createMarketplaceStateStore(statePath);
  const loaded = stateStore.load();
  // 区分"还没初始化"与"用户清空了所有源"：只有前者才种入默认源。
  const firstRun = loaded === null;
  let sources = loaded !== null ? loaded.sources : [];
  if (firstRun && seedDefaultSource) {
    sources = [{
      id: `src-${randomUUID()}`,
      url: DEFAULT_PLUGIN_SOURCE_URL,
      addedAt: new Date().toISOString(),
    }];
    stateStore.save({ version: 1, sources });
  }

  /** sourceId → { status: 'ok'|'error', plugins, warnings, error, fetchedAt } */
  const catalog = new Map();
  const defaultBranches = new Map();
  const refreshInFlight = new Map();
  let installChain = Promise.resolve();

  function persist() {
    stateStore.save({ version: 1, sources });
  }

  function findSource(sourceId) {
    return sources.find((source) => source.id === sourceId) || null;
  }

  /**
   * 源的去重键。URL 里没写 ref 时用已缓存的默认分支参与比较，
   * 避免"显式写 main"与"省略 ref 解析到 main"被当成两个源。
   */
  function canonicalKey(parsed) {
    const ref = parsed.ref ?? defaultBranches.get(`${parsed.owner}/${parsed.repo}`) ?? '';
    return `${parsed.owner}/${parsed.repo}@${ref}:${parsed.dirPath}`.toLowerCase();
  }

  function getState() {
    return {
      sources: sources.map((source) => ({ ...source })),
      entries: sources.map((source) => {
        const cached = catalog.get(source.id);
        return {
          source: { ...source },
          status: cached ? cached.status : 'pending',
          plugins: cached ? cached.plugins.map((plugin) => ({ ...plugin })) : [],
          warnings: cached ? [...cached.warnings] : [],
          error: cached && cached.error ? { ...cached.error } : null,
          fetchedAt: cached ? cached.fetchedAt : null,
        };
      }),
    };
  }

  /** 源 URL 没写 ref 时，取仓库的默认分支并缓存。 */
  async function resolveDefaultBranch(parsed) {
    if (parsed.ref) return { ok: true, ref: parsed.ref };
    const repoKey = `${parsed.owner}/${parsed.repo}`;
    const cached = defaultBranches.get(repoKey);
    if (cached) return { ok: true, ref: cached };
    const result = await fetchCapped(
      fetchImpl,
      `https://${API_HOST}/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`,
      { headers: githubApiHeaders(), maxBytes: MAX_LISTING_BYTES, requestTimeoutMs },
    );
    if (!result.ok) {
      return { ok: false, error: prefixedError('SOURCE_REPO_INFO', result.error) };
    }
    let branch = null;
    try {
      const parsed_ = JSON.parse(result.bytes.toString('utf8'));
      if (typeof parsed_.default_branch === 'string' && parsed_.default_branch !== '') branch = parsed_.default_branch;
    } catch {
      branch = null;
    }
    if (!branch || !segmentIsSafe(branch)) {
      return { ok: false, error: { code: 'SOURCE_REPO_INFO_JSON_INVALID', message: 'Repository metadata is not valid JSON or lacks a default branch' } };
    }
    defaultBranches.set(repoKey, branch);
    return { ok: true, ref: branch };
  }

  /**
   * 把 ref 名解析成不可变的提交 SHA。分支可能随时推进：若直接用 ref 名发请求，
   * 同一次遍历/安装里的目录枚举与文件下载可能来自不同提交；绑定 SHA 后该次
   * 操作内的 tree API、contents API 与所有 raw 下载都钉在同一个提交上。
   * 注意 SHA 不持久缓存——每次刷新/安装都重新解析，否则分支推进后用户永远
   * 看不到新版本。
   */
  async function resolveSourceCommit(parsed) {
    const ref = await resolveDefaultBranch(parsed);
    if (!ref.ok) return ref;
    const result = await fetchCapped(
      fetchImpl,
      `https://${API_HOST}/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`
      + `/commits/${encodeURIComponent(ref.ref)}`,
      { headers: githubApiHeaders(), maxBytes: MAX_LISTING_BYTES, requestTimeoutMs },
    );
    if (!result.ok) {
      return { ok: false, error: prefixedError('SOURCE_COMMIT', result.error) };
    }
    let sha = null;
    try {
      const payload = JSON.parse(result.bytes.toString('utf8'));
      if (typeof payload.sha === 'string' && /^[0-9a-f]{40}$/.test(payload.sha)) sha = payload.sha;
    } catch {
      sha = null;
    }
    if (!sha) {
      return { ok: false, error: { code: 'SOURCE_COMMIT_JSON_INVALID', message: 'Repository commit metadata is not valid JSON or lacks a commit SHA' } };
    }
    return { ok: true, sha };
  }

  /** 遍历一个源：列出目录，逐个子目录探测 manifest.json。 */
  async function listSourcePlugins(source) {
    const parsed = parseSourceUrl(source.url);
    if (!parsed) {
      return { status: 'error', plugins: [], warnings: [], error: { code: 'SOURCE_URL_INVALID', message: 'The source URL is not a GitHub repository directory' } };
    }
    const commit = await resolveSourceCommit(parsed);
    if (!commit.ok) {
      return { status: 'error', plugins: [], warnings: [], error: commit.error };
    }

    const contentsUrl = `https://${API_HOST}/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`
      + `/contents/${encodePath(parsed.dirPath)}?ref=${encodeURIComponent(commit.sha)}`;
    const listing = await fetchCapped(fetchImpl, contentsUrl, {
      headers: githubApiHeaders(),
      maxBytes: MAX_LISTING_BYTES,
      requestTimeoutMs,
    });
    if (!listing.ok) {
      const error = prefixedError('SOURCE_LIST', listing.error);
      if (listing.error.status === 404) {
        return { status: 'error', plugins: [], warnings: [], error: { code: 'SOURCE_PATH_NOT_FOUND', message: 'The source directory does not exist in this repository' } };
      }
      return { status: 'error', plugins: [], warnings: [], error };
    }
    let entries;
    try {
      entries = JSON.parse(listing.bytes.toString('utf8'));
    } catch {
      return { status: 'error', plugins: [], warnings: [], error: { code: 'SOURCE_LIST_JSON_INVALID', message: 'The directory listing is not valid JSON' } };
    }
    if (!Array.isArray(entries)) {
      return { status: 'error', plugins: [], warnings: [], error: { code: 'SOURCE_LIST_JSON_INVALID', message: 'The directory listing is not a JSON array' } };
    }

    const directories = entries
      .filter((entry) => entry && entry.type === 'dir' && typeof entry.name === 'string'
        && !entry.name.startsWith('.') && segmentIsSafe(entry.name))
      .map((entry) => entry.name);
    const warnings = [];
    if (directories.length > MAX_SOURCE_DIRECTORIES) {
      warnings.push(`The source lists more than ${MAX_SOURCE_DIRECTORIES} directories; only the first ${MAX_SOURCE_DIRECTORIES} were checked.`);
      directories.length = MAX_SOURCE_DIRECTORIES;
    }
    if (directories.length === 0) {
      return { status: 'ok', plugins: [], warnings, error: null, fetchedAt: new Date().toISOString() };
    }

    const probed = await mapLimit(directories, PROBE_CONCURRENCY, async (directory) => {
      const manifestUrl = `https://${RAW_HOST}/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`
        + `/${encodeURIComponent(commit.sha)}/${encodePath(parsed.dirPath, directory, 'manifest.json')}`;
      const response = await fetchCapped(fetchImpl, manifestUrl, {
        headers: { Accept: 'application/json' },
        maxBytes: MAX_MANIFEST_BYTES,
        requestTimeoutMs,
      });
      // 没有 manifest.json 的子目录不是插件：静默跳过，其余失败记为告警。
      if (!response.ok) {
        if (response.error.status === 404) return { skipped: true };
        return { skipped: false, warning: `${directory}: ${prefixedError('SOURCE_MANIFEST', response.error).message}` };
      }
      let manifest;
      try {
        manifest = JSON.parse(response.bytes.toString('utf8'));
      } catch {
        return { skipped: false, warning: `${directory}: manifest.json is not valid JSON` };
      }
      const validation = validateManifest(manifest);
      if (!validation.success) {
        return { skipped: false, warning: `${directory}: ${validation.message} (${validation.code})` };
      }
      return { skipped: false, plugin: { directoryName: directory, manifest: validation.data } };
    });

    const plugins = [];
    const seenIds = new Set();
    for (const probe of probed) {
      if (!probe || probe.skipped) continue;
      if (probe.warning) {
        warnings.push(probe.warning);
        continue;
      }
      const plugin = probe.plugin;
      if (seenIds.has(plugin.manifest.id)) {
        warnings.push(`${plugin.directoryName}: a plugin with id '${plugin.manifest.id}' is already listed by this source.`);
        continue;
      }
      seenIds.add(plugin.manifest.id);
      plugins.push(plugin);
    }
    plugins.sort((left, right) => left.manifest.name.localeCompare(right.manifest.name, 'en'));

    return { status: 'ok', plugins, warnings, error: null, fetchedAt: new Date().toISOString() };
  }

  function publishCatalog(sourceId, result) {
    // 遍历期间源可能已被删除：落库前确认它还在。
    if (!findSource(sourceId)) return;
    catalog.set(sourceId, result);
  }

  /**
   * 遍历一个源并发布目录。同一源的去重与过期防护都在这里做：
   * - 同一源已有遍历在途（含 URL 变更前发起的那次）时复用它；
   * - 遍历期间源被删除或 URL 被编辑，过期结果直接丢弃。
   */
  function refreshOne(source) {
    const inFlightKey = `${source.id}:${source.url}`;
    const existing = refreshInFlight.get(inFlightKey);
    if (existing) return existing;
    const urlAtStart = source.url;
    const promise = (async () => {
      try {
        const result = await listSourcePlugins(source);
        if (source.url !== urlAtStart || !findSource(source.id)) return;
        publishCatalog(source.id, result);
      } catch (error) {
        if (source.url !== urlAtStart || !findSource(source.id)) return;
        publishCatalog(source.id, {
          status: 'error',
          plugins: [],
          warnings: [],
          error: { code: 'SOURCE_LIST_UNREACHABLE', message: sanitizeText(error instanceof Error ? error.message : 'Source could not be fetched') },
          fetchedAt: new Date().toISOString(),
        });
      }
    })().finally(() => {
      if (refreshInFlight.get(inFlightKey) === promise) refreshInFlight.delete(inFlightKey);
    });
    refreshInFlight.set(inFlightKey, promise);
    return promise;
  }

  function clearStagingRoot() {
    try {
      if (!fs.existsSync(stagingRoot)) return;
      for (const entry of fs.readdirSync(stagingRoot)) {
        try { fs.rmSync(path.join(stagingRoot, entry), { recursive: true, force: true }); } catch { /* keep going */ }
      }
    } catch { /* staging cleanup is best-effort */ }
  }

  return {
    getState,
    async addSource(input) {
      const url = typeof input?.url === 'string' ? input.url.trim() : '';
      const parsed = parseSourceUrl(url);
      if (!parsed) {
        return { success: false, error: { code: 'SOURCE_URL_INVALID', message: 'Enter a GitHub repository directory URL, e.g. https://github.com/owner/repo/tree/main/plugins' } };
      }
      if (sources.length >= 50) {
        return { success: false, error: { code: 'SOURCE_LIMIT_REACHED', message: 'The plugin source list is full' } };
      }
      const canonical = canonicalKey(parsed);
      const duplicate = sources.find((source) => {
        const existing = parseSourceUrl(source.url);
        return existing && canonicalKey(existing) === canonical;
      });
      if (duplicate) {
        return { success: false, error: { code: 'SOURCE_ALREADY_EXISTS', message: 'This plugin source has already been added' } };
      }
      const name = typeof input?.name === 'string' && input.name.trim() !== '' ? input.name.trim().slice(0, 200) : parsed.defaultName;
      const source = { id: `src-${randomUUID()}`, url, ...(name ? { name } : {}), addedAt: new Date().toISOString() };
      sources.push(source);
      persist();
      await refreshOne(source);
      return { success: true, state: getState() };
    },
    async updateSource(input) {
      const id = typeof input?.id === 'string' ? input.id : '';
      const source = findSource(id);
      if (!source) {
        return { success: false, error: { code: 'SOURCE_NOT_FOUND', message: 'The plugin source was not found' } };
      }
      const nameInput = typeof input?.name === 'string' ? input.name.trim().slice(0, 200) : undefined;
      const urlInput = typeof input?.url === 'string' ? input.url.trim() : undefined;
      let refetch = false;
      if (urlInput !== undefined && urlInput !== source.url) {
        const parsed = parseSourceUrl(urlInput);
        if (!parsed) {
          return { success: false, error: { code: 'SOURCE_URL_INVALID', message: 'Enter a GitHub repository directory URL, e.g. https://github.com/owner/repo/tree/main/plugins' } };
        }
        const canonical = canonicalKey(parsed);
        const duplicate = sources.find((other) => {
          if (other.id === id) return false;
          const existing = parseSourceUrl(other.url);
          return existing && canonicalKey(existing) === canonical;
        });
        if (duplicate) {
          return { success: false, error: { code: 'SOURCE_ALREADY_EXISTS', message: 'This plugin source has already been added' } };
        }
        source.url = urlInput;
        refetch = true;
      }
      if (nameInput !== undefined) {
        if (nameInput === '') delete source.name;
        else source.name = nameInput;
      }
      persist();
      if (refetch) await refreshOne(source);
      return { success: true, state: getState() };
    },
    async removeSource(input) {
      const id = typeof input?.id === 'string' ? input.id : '';
      const index = sources.findIndex((source) => source.id === id);
      if (index === -1) {
        return { success: false, error: { code: 'SOURCE_NOT_FOUND', message: 'The plugin source was not found' } };
      }
      sources.splice(index, 1);
      catalog.delete(id);
      persist();
      return { success: true, state: getState() };
    },
    async refresh(options) {
      const sourceId = typeof options?.sourceId === 'string' ? options.sourceId : null;
      const targets = sourceId ? sources.filter((source) => source.id === sourceId) : [...sources];
      // 同一源的并发遍历在 refreshOne 内去重；这里只等全部目标完成。
      await Promise.all(targets.map((source) => refreshOne(source)));
      return { success: true, state: getState() };
    },

    /**
     * 从源安装一个插件：下载文件到 staging，再交给 pluginManager 完成安装。
     * replace 为 true 时（更新场景）先保留数据卸载旧版本。
     */
    install(request) {
      const sourceId = typeof request?.sourceId === 'string' ? request.sourceId : '';
      const directoryName = typeof request?.directoryName === 'string' ? request.directoryName : '';
      const replace = request?.replace === true;
      const expectedPluginId = typeof request?.expectedPluginId === 'string' ? request.expectedPluginId.trim() : '';
      const expectedVersion = typeof request?.expectedVersion === 'string' ? request.expectedVersion.trim() : '';
      // 安装与更新会卸载/重装插件，串行化避免并发安装互相踩踏。
      const run = () => installInner(sourceId, directoryName, replace, expectedPluginId, expectedVersion);
      const result = installChain.then(run, run);
      installChain = result.then(() => undefined, () => undefined);
      return result;
    },
    /** 测试辅助：把内存状态重置为指定源列表。 */
    __setSourcesForTests(next) {
      sources = normalizeState({ version: 1, sources: next }).sources;
    },
  };

  function validateRelativeEntry(stagingDirectory, relative) {
    if (relative === '' || relative.startsWith('/') || relative.includes('\\')) return false;
    const segments = relative.split('/');
    if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return false;
    if (segments.some((segment) => !segmentIsSafe(segment) || WINDOWS_RESERVED_RE.test(segment) || /[. ]$/.test(segment))) {
      return false;
    }
    return isInside(path.resolve(stagingDirectory), path.resolve(stagingDirectory, relative));
  }

  async function downloadPackageFiles(parsed, sha, directoryName, dirPath, stagingDirectory) {
    const treeUrl = `https://${API_HOST}/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`
      + `/git/trees/${encodeURIComponent(sha)}?recursive=1`;
    const tree = await fetchCapped(fetchImpl, treeUrl, {
      headers: githubApiHeaders(),
      maxBytes: MAX_LISTING_BYTES,
      requestTimeoutMs,
    });
    if (!tree.ok) {
      const error = prefixedError('SOURCE_TREE', tree.error);
      return { ok: false, error: tree.error.status === 404 ? { code: 'SOURCE_PATH_NOT_FOUND', message: 'The source directory does not exist in this repository' } : error };
    }
    let treePayload;
    try {
      treePayload = JSON.parse(tree.bytes.toString('utf8'));
    } catch {
      return { ok: false, error: { code: 'SOURCE_TREE_JSON_INVALID', message: 'The repository file tree is not valid JSON' } };
    }
    if (treePayload && treePayload.truncated === true) {
      return { ok: false, error: { code: 'SOURCE_TREE_TRUNCATED', message: 'The repository is too large to enumerate; plugin installation from this source is unavailable' } };
    }
    const blobs = Array.isArray(treePayload?.tree) ? treePayload.tree : [];
    const prefix = dirPath ? `${dirPath}/${directoryName}/` : `${directoryName}/`;
    const files = [];
    for (const entry of blobs) {
      if (typeof entry?.path !== 'string' || !entry.path.startsWith(prefix)) continue;
      if (entry.type === 'commit') {
        return { ok: false, error: { code: 'MARKETPLACE_SUBMODULE_UNSUPPORTED', message: 'The plugin directory contains a git submodule, which cannot be installed' } };
      }
      if (entry.type !== 'blob') continue;
      files.push(entry);
    }
    if (files.length === 0) {
      return { ok: false, error: { code: 'MARKETPLACE_PLUGIN_NOT_FOUND', message: 'No plugin files were found under this source directory' } };
    }
    if (files.length > MAX_PLUGIN_PACKAGE_FILES
      || files.reduce((total, entry) => total + (Number(entry.size) || 0), 0) > MAX_PLUGIN_PACKAGE_BYTES) {
      return { ok: false, error: { code: 'MARKETPLACE_PACKAGE_TOO_LARGE', message: 'The plugin package exceeds the installation limits' } };
    }

    let totalBytes = 0;
    await mapLimit(files, DOWNLOAD_CONCURRENCY, async (entry) => {
      const relative = entry.path.slice(prefix.length);
      if (!validateRelativeEntry(stagingDirectory, relative)) {
        throw Object.assign(new Error(`Plugin file path '${entry.path}' is unsafe`), { code: 'MARKETPLACE_ENTRY_UNSAFE' });
      }
      const target = path.join(stagingDirectory, relative);
      const response = await fetchCapped(
        fetchImpl,
        `https://${RAW_HOST}/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`
        + `/${encodeURIComponent(sha)}/${encodePath(entry.path)}`,
        { headers: { Accept: 'application/octet-stream' }, maxBytes: MAX_PLUGIN_PACKAGE_BYTES, requestTimeoutMs },
      );
      if (!response.ok) {
        throw Object.assign(
          new Error(prefixedError('MARKETPLACE_DOWNLOAD', response.error).message),
          { code: prefixedError('MARKETPLACE_DOWNLOAD', response.error).code },
        );
      }
      const bytes = response.bytes;
      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_PLUGIN_PACKAGE_BYTES) {
        throw Object.assign(new Error('The plugin package exceeds the installation limits'), { code: 'MARKETPLACE_PACKAGE_TOO_LARGE' });
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes);
      return undefined;
    });

    // 以实际下载的 manifest 为准，拿到插件 id 供更新流程卸载旧版本。
    const manifestPath = path.join(stagingDirectory, 'manifest.json');
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch {
      return { ok: false, error: { code: 'MARKETPLACE_MANIFEST_INVALID', message: 'The downloaded plugin manifest is missing or unreadable' } };
    }
    const validation = validateManifest(manifest);
    if (!validation.success) {
      return { ok: false, error: { code: 'MARKETPLACE_MANIFEST_INVALID', message: validation.message } };
    }
    return { ok: true, pluginId: validation.data.id, manifestVersion: validation.data.version };
  }

  /**
   * 撤销/拉黑表的匹配：versions 为空表示全部版本；多条命中时 revoke 优先、
   * 日期新的优先（与渲染层 pluginRegistryStatus 的判定保持一致）。
   */
  function findRemovalRecord(removed, pluginId, version) {
    const matches = (removed || []).filter((record) =>
      record && record.id === pluginId
      && Array.isArray(record.versions)
      && (record.versions.length === 0 || record.versions.includes(version)));
    if (matches.length === 0) return null;
    matches.sort((left, right) => (
      (left.action === 'revoke' ? 0 : 1) - (right.action === 'revoke' ? 0 : 1)
      || String(right.date || '').localeCompare(String(left.date || ''))
    ));
    return matches[0];
  }

  /**
   * 官方静态注册表的撤销/拉黑终审：在主进程执行，不依赖渲染层的提示。
   * 注册表暂时取不到时放行（与"对照提示"的定位一致；本地安装的信任模型不变）。
   */
  async function checkOfficialRemoval({ id, version }) {
    const registry = await loadPluginRegistry({ fetchImpl });
    if (!registry.success) return null;
    const record = findRemovalRecord(registry.registry.removed, id, version);
    if (!record) return null;
    return {
      code: record.action === 'revoke' ? 'MARKETPLACE_VERSION_REVOKED' : 'MARKETPLACE_VERSION_BLOCKED',
      message: `Version ${version} of '${id}' is ${record.action} by the official registry`,
    };
  }

  async function installInner(sourceId, directoryName, replace, expectedPluginId, expectedVersion) {
    // 请求必须带上用户在界面看到的插件身份——否则无法把下载内容与点击的条目
    // 对应起来，install 可能装上、甚至覆盖替换掉别的插件。
    if (!expectedPluginId || !expectedVersion) {
      return { success: false, error: { code: 'MARKETPLACE_IDENTITY_REQUIRED', message: 'The install request must carry the plugin identity shown to the user' } };
    }
    if (!directoryName || directoryName.includes('/') || directoryName.includes('\\') || directoryName === '.' || directoryName === '..') {
      return { success: false, error: { code: 'MARKETPLACE_PLUGIN_NOT_FOUND', message: 'No plugin files were found under this source directory' } };
    }
    const source = findSource(sourceId);
    if (!source) {
      return { success: false, error: { code: 'SOURCE_NOT_FOUND', message: 'The plugin source was not found' } };
    }
    const parsed = parseSourceUrl(source.url);
    if (!parsed) {
      return { success: false, error: { code: 'SOURCE_URL_INVALID', message: 'The source URL is not a GitHub repository directory' } };
    }
    const commit = await resolveSourceCommit(parsed);
    if (!commit.ok) {
      return { success: false, error: commit.error };
    }

    clearStagingRoot();
    fs.mkdirSync(stagingRoot, { recursive: true });
    const stagingDirectory = path.join(stagingRoot, randomUUID());
    try {
      const downloaded = await downloadPackageFiles(parsed, commit.sha, directoryName, parsed.dirPath, stagingDirectory);
      if (!downloaded.ok) return { success: false, error: downloaded.error };
      // 下载耗时期间源可能已被删除：落盘前再确认一次，避免"幽灵源"的插件进入本地列表。
      if (!findSource(sourceId)) {
        return { success: false, error: { code: 'SOURCE_NOT_FOUND', message: 'The plugin source was not found' } };
      }
      // 下载到的 manifest 必须与界面上的身份一致，防止"点 A 装 B"或"点 v2 装 v3"。
      if (expectedPluginId !== downloaded.pluginId || expectedVersion !== downloaded.manifestVersion) {
        return { success: false, error: { code: 'MARKETPLACE_PLUGIN_CHANGED', message: 'The plugin changed on the source while installing; refresh and try again' } };
      }
      // 官方撤销/拉黑记录在主进程终审（渲染层的检查只是提示）。
      const removal = await checkOfficialRemoval({ id: downloaded.pluginId, version: downloaded.manifestVersion });
      if (removal) {
        return { success: false, error: removal };
      }
      if (replace) {
        // 更新：pluginManager 原子换目录，失败自动回滚旧版本与启用状态。
        // 注意必须 await：try/finally 里的 return <promise> 不会等它 settlement，
        // 不 await 会导致 finally 提前清掉 staging，把异步替换流程踩塌。
        return await pluginManager.replaceFromDirectory(stagingDirectory);
      }
      return pluginManager.installFromDirectory(stagingDirectory);
    } catch (error) {
      return {
        success: false,
        error: {
          code: typeof error?.code === 'string' ? error.code : 'MARKETPLACE_INSTALL_FAILED',
          message: sanitizeText(error instanceof Error ? error.message : 'Plugin installation failed'),
        },
      };
    } finally {
      try { fs.rmSync(stagingDirectory, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  }
}

module.exports = {
  DEFAULT_PLUGIN_SOURCE_URL,
  MAX_PLUGIN_PACKAGE_BYTES,
  MAX_PLUGIN_PACKAGE_FILES,
  MAX_SOURCE_DIRECTORIES,
  REQUEST_TIMEOUT_MS,
  createPluginMarketplace,
  mapLimit,
  parseSourceUrl,
};
