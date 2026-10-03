'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  DEFAULT_PLUGIN_SOURCE_URL,
  MAX_PLUGIN_PACKAGE_FILES,
  createPluginMarketplace,
  mapLimit,
  parseSourceUrl,
} = require('./pluginMarketplace');
const { createPluginManager } = require('./pluginManager');

const manifest = (overrides = {}) => ({
  manifestVersion: 1,
  id: 'com.example.marketplace-fixture',
  name: 'Marketplace Fixture',
  version: '1.0.0',
  apiVersion: '1',
  main: 'worker.js',
  permissions: ['storage'],
  contributes: {},
  ...overrides,
});

const SHA = 'a'.repeat(40);

const jsonHeaders = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

/** refs 名 → 提交 SHA 的解析端点（所有遍历/下载都会先解析到不可变 SHA）。 */
const commitRoute = (ref = 'main') => [`api.github.com/repos/owner/repo/commits/${ref}`, () => jsonHeaders({ sha: SHA })];

/** contents API 的目录响应：dirs 是目录名数组。返回工厂，避免 Response 被二次消费。 */
const contentsResponse = (dirs) => () => jsonHeaders(dirs.map((name) => ({ name, path: name, type: 'dir' })));

/** git trees API 响应：files 是 [path, size] 数组。 */
const treeResponse = (files, { truncated = false } = {}) => () => jsonHeaders({
  sha: 'treesha',
  truncated,
  tree: files.map(([p, size]) => ({ path: p, type: 'blob', size, mode: '100644' })),
});

const rawResponse = (body) => () => new Response(body, { status: 200 });

/** 构造 fetchImpl：url → Response | Error；未匹配的 URL 报 404。 */
function makeFetch(routes, { onRequest } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (onRequest) onRequest(url, options);
    const match = routes.find(([pattern]) => (
      typeof pattern === 'string' ? url.includes(pattern) : pattern.test(url)
    ));
    if (!match) return new Response('not found', { status: 404 });
    const value = match[1];
    if (value instanceof Error) throw value;
    if (typeof value === 'function') return value(url, options);
    return value;
  };
  return { fetchImpl, calls };
}

const validManifestJson = (overrides = {}) => JSON.stringify(manifest(overrides));

function setupFixtures(root, pluginFiles = {}) {
  const fixtures = {};
  for (const [relative, content] of Object.entries(pluginFiles)) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return fixtures;
}

describe('parseSourceUrl', () => {
  it('parses tree URLs with ref and directory path', () => {
    assert.deepEqual(parseSourceUrl('https://github.com/AmintaCCCP/GithubStarsManager/tree/main/examples/plugins'), {
      owner: 'AmintaCCCP',
      repo: 'GithubStarsManager',
      ref: 'main',
      dirPath: 'examples/plugins',
      defaultName: 'AmintaCCCP/GithubStarsManager/examples/plugins',
    });
  });

  it('accepts the bare repository root and derives the default name', () => {
    assert.deepEqual(parseSourceUrl('https://github.com/owner/repo'), {
      owner: 'owner',
      repo: 'repo',
      ref: null,
      dirPath: '',
      defaultName: 'owner/repo',
    });
  });

  it('accepts a path without a tree segment (the ref must then be resolved via the API)', () => {
    const parsed = parseSourceUrl('https://github.com/owner/repo/plugins/extra');
    assert.equal(parsed.ref, null);
    assert.equal(parsed.dirPath, 'plugins/extra');
  });

  it('rejects non-GitHub hosts, non-HTTPS, query strings, and traversal segments', () => {
    assert.equal(parseSourceUrl('http://github.com/owner/repo'), null);
    assert.equal(parseSourceUrl('https://gitlab.com/owner/repo'), null);
    assert.equal(parseSourceUrl('https://github.com/owner/repo?x=1'), null);
    assert.equal(parseSourceUrl('https://github.com/owner/repo/tree/main/..%2F..%2Fetc'), null);
    assert.equal(parseSourceUrl('https://github.com/owner/repo/tree/main/a%00b'), null);
    assert.equal(parseSourceUrl('https://github.com/owner'), null);
    assert.equal(parseSourceUrl('not a url'), null);
    assert.equal(parseSourceUrl(''), null);
  });

  it('decodes percent-encoded directory names', () => {
    const parsed = parseSourceUrl('https://github.com/owner/repo/tree/main/my%20plugins');
    assert.equal(parsed.dirPath, 'my plugins');
  });
});

describe('mapLimit', () => {
  it('runs tasks with bounded concurrency and preserves order', async () => {
    let running = 0;
    let peak = 0;
    const results = await mapLimit([1, 2, 3, 4, 5], 2, async (value) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return value * 2;
    });
    assert.deepEqual(results, [2, 4, 6, 8, 10]);
    assert.ok(peak <= 2, `concurrency peak ${peak} exceeded the limit`);
  });

  it('rejects on the first failure', async () => {
    await assert.rejects(
      mapLimit([1, 2], 2, async (value) => {
        if (value === 2) throw new Error('boom');
        return value;
      }),
      /boom/,
    );
  });
});

describe('plugin marketplace', () => {
  let tmpRoot;
  let statePath;
  let stagingRoot;
  let pluginsRoot;
  let stateFilePath;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'marketplace-test-'));
    statePath = path.join(tmpRoot, 'state');
    stagingRoot = path.join(tmpRoot, 'staging');
    pluginsRoot = path.join(tmpRoot, 'plugins');
    stateFilePath = path.join(statePath, 'plugins-marketplace.json');
  });

  function makeManager() {
    return createPluginManager({ pluginsRoot, statePath: path.join(tmpRoot, 'plugins-state.json') });
  }

  /** 绝大多数用例不关心种子行为：关闭默认源种子，让 entries[0] 就是新加的源。 */
  function makeMarketplace(fetchImpl, options = {}) {
    return createPluginMarketplace({
      statePath: stateFilePath,
      stagingRoot,
      fetchImpl,
      pluginManager: makeManager(),
      seedDefaultSource: false,
      ...options,
    });
  }

  it('seeds the default source on first run and persists it', async () => {
    const { fetchImpl } = makeFetch([]);
    const marketplace = createPluginMarketplace({
      statePath: stateFilePath,
      stagingRoot,
      fetchImpl,
      pluginManager: makeManager(),
    });
    const state = marketplace.getState();
    assert.equal(state.sources.length, 1);
    assert.equal(state.sources[0].url, DEFAULT_PLUGIN_SOURCE_URL);
    assert.equal(state.entries[0].status, 'pending');
    assert.equal(JSON.parse(fs.readFileSync(stateFilePath, 'utf8')).sources.length, 1);

    // 第二个实例读取同一文件，不再种入第二条默认源。
    const again = createPluginMarketplace({
      statePath: stateFilePath,
      stagingRoot,
      fetchImpl,
      pluginManager: makeManager(),
    });
    assert.equal(again.getState().sources.length, 1);
  });

  it('respects a user-cleared source list on restart', async () => {
    fs.mkdirSync(path.dirname(stateFilePath), { recursive: true });
    fs.writeFileSync(stateFilePath, JSON.stringify({ version: 1, sources: [] }));
    const { fetchImpl } = makeFetch([]);
    const marketplace = makeMarketplace(fetchImpl);
    assert.equal(marketplace.getState().sources.length, 0);
  });

  it('adds a source, lists its plugins by probing manifests, and skips non-plugin directories', async () => {
    const { fetchImpl, calls } = makeFetch([
      commitRoute(),
      ['api.github.com/repos/owner/repo/contents/plugins', contentsResponse(['good', 'bad-json', 'no-manifest', '.hidden'])],
      [`raw.githubusercontent.com/owner/repo/${SHA}/plugins/good/manifest.json`, rawResponse(validManifestJson())],
      [`raw.githubusercontent.com/owner/repo/${SHA}/plugins/bad-json/manifest.json`, rawResponse('{not json')],
      [`raw.githubusercontent.com/owner/repo/${SHA}/plugins/no-manifest/manifest.json`, new Response('nope', { status: 404 })],
    ]);
    const marketplace = makeMarketplace(fetchImpl);
    const result = await marketplace.addSource({ url: 'https://github.com/owner/repo/tree/main/plugins' });
    assert.equal(result.success, true);
    const [entry] = result.state.entries;
    assert.equal(entry.status, 'ok');
    assert.equal(entry.plugins.length, 1);
    assert.equal(entry.plugins[0].directoryName, 'good');
    assert.equal(entry.plugins[0].manifest.id, 'com.example.marketplace-fixture');
    // bad-json 产生告警；no-manifest 与 .hidden 静默跳过。
    assert.equal(entry.warnings.length, 1);
    assert.match(entry.warnings[0], /bad-json/);

    const manifestCalls = calls.filter((call) => call.url.includes('manifest.json'));
    assert.equal(manifestCalls.length, 3, 'the hidden directory must not be probed');
  });

  it('reports a source-level error when the directory listing fails', async () => {
    const { fetchImpl } = makeFetch([
      commitRoute(),
      ['api.github.com/repos/owner/repo/contents/plugins', new Response('nope', { status: 404 })],
    ]);
    const marketplace = makeMarketplace(fetchImpl);
    const result = await marketplace.addSource({ url: 'https://github.com/owner/repo/tree/main/plugins' });
    assert.equal(result.success, true);
    assert.equal(result.state.entries[0].status, 'error');
    assert.equal(result.state.entries[0].error.code, 'SOURCE_PATH_NOT_FOUND');
  });

  it('resolves the default branch when the URL omits a ref', async () => {
    const branchSha = 'b'.repeat(40);
    const { fetchImpl, calls } = makeFetch([
      // 顺序敏感：repo-info 与 commits 都是 /repos/owner/repo 的前缀，用正则精确匹配。
      [/\/repos\/owner\/repo\/commits\/develop$/, () => jsonHeaders({ sha: branchSha })],
      [/\/repos\/owner\/repo$/, () => jsonHeaders({ default_branch: 'develop' })],
      [`api.github.com/repos/owner/repo/contents/plugins?ref=${branchSha}`, contentsResponse(['good'])],
      [`raw.githubusercontent.com/owner/repo/${branchSha}/plugins/good/manifest.json`, rawResponse(validManifestJson())],
    ]);
    const marketplace = makeMarketplace(fetchImpl);
    const result = await marketplace.addSource({ url: 'https://github.com/owner/repo/plugins' });
    assert.equal(result.success, true);
    const [entry] = result.state.entries;
    assert.equal(entry.status, 'ok', JSON.stringify(entry.error));
    assert.equal(entry.plugins.length, 1);
    // 目录枚举与 manifest 探测都钉在解析出的提交 SHA 上。
    assert.ok(calls.some((call) => call.url.includes(`contents/plugins?ref=${branchSha}`)));
    assert.ok(calls.some((call) => call.url.includes(`/${branchSha}/plugins/good/manifest.json`)));
  });

  it('rejects duplicate sources regardless of cosmetic URL differences', async () => {
    const { fetchImpl } = makeFetch([['contents', contentsResponse([])]]);
    const marketplace = makeMarketplace(fetchImpl);
    await marketplace.addSource({ url: 'https://github.com/owner/repo/tree/main/plugins' });
    const duplicate = await marketplace.addSource({ url: 'https://github.com/Owner/repo/tree/main/plugins' });
    assert.equal(duplicate.success, false);
    assert.equal(duplicate.error.code, 'SOURCE_ALREADY_EXISTS');

    const differentPath = await marketplace.addSource({ url: 'https://github.com/owner/repo/tree/main/other' });
    assert.equal(differentPath.success, true);
  });

  it('updates a source url and removes a source', async () => {
    const { fetchImpl } = makeFetch([
      commitRoute(),
      ['contents/plugins', contentsResponse([])],
      ['contents/other', contentsResponse([])],
    ]);
    const marketplace = makeMarketplace(fetchImpl);
    const added = await marketplace.addSource({ url: 'https://github.com/owner/repo/tree/main/plugins' });
    const sourceId = added.state.sources[0].id;

    const renamed = await marketplace.updateSource({ id: sourceId, name: 'My plugins' });
    assert.equal(renamed.success, true);
    assert.equal(renamed.state.sources[0].name, 'My plugins');

    const moved = await marketplace.updateSource({ id: sourceId, url: 'https://github.com/owner/repo/tree/main/other' });
    assert.equal(moved.success, true);
    assert.equal(moved.state.sources[0].url, 'https://github.com/owner/repo/tree/main/other');

    const removed = await marketplace.removeSource({ id: sourceId });
    assert.equal(removed.success, true);
    assert.equal(removed.state.sources.length, 0);

    const missing = await marketplace.removeSource({ id: sourceId });
    assert.equal(missing.success, false);
    assert.equal(missing.error.code, 'SOURCE_NOT_FOUND');
  });

  it('installs a plugin by downloading files into staging and delegating to the plugin manager', async () => {
    const manifestJson = validManifestJson({ main: 'worker.js' });
    const { fetchImpl, calls } = makeFetch([
      commitRoute(),
      ['git/trees', treeResponse([
        ['plugins/fixture/manifest.json', manifestJson.length],
        ['plugins/fixture/worker.js', 32],
        ['plugins/other/manifest.json', 10],
        ['README.md', 5],
      ])],
      [`raw.githubusercontent.com/owner/repo/${SHA}/plugins/fixture/manifest.json`, rawResponse(manifestJson)],
      [`raw.githubusercontent.com/owner/repo/${SHA}/plugins/fixture/worker.js`, rawResponse('console.log("hi");\n')],
    ]);
    const pluginManager = makeManager();
    const marketplace = makeMarketplace(fetchImpl, { pluginManager });
    const added = await marketplace.addSource({ url: 'https://github.com/owner/repo/tree/main/plugins' });
    const sourceId = added.state.sources[0].id;

    const result = await marketplace.install({ sourceId, directoryName: 'fixture',
      expectedPluginId: 'com.example.marketplace-fixture',
      expectedVersion: '1.0.0',
    });
    assert.equal(result.success, true);
    // 安装的所有下载请求都钉在解析出的提交 SHA 上（分支推进不会混入不一致文件）。
    const rawCalls = calls.filter((call) => call.url.includes('raw.githubusercontent.com/owner/repo'));
    assert.ok(rawCalls.length >= 2);
    assert.ok(rawCalls.every((call) => call.url.includes(`/${SHA}/`)));
    assert.ok(calls.some((call) => call.url.includes(`git/trees/${SHA}`) || call.url.includes(`git/trees/${SHA.split('').join('')}`)));
    assert.equal(result.pluginId, 'com.example.marketplace-fixture');

    // 落位目录以 manifest id 命名，内容完整；staging 已清理。
    assert.deepEqual(fs.readdirSync(pluginsRoot), ['com.example.marketplace-fixture']);
    assert.equal(
      fs.readFileSync(path.join(pluginsRoot, 'com.example.marketplace-fixture', 'worker.js'), 'utf8'),
      'console.log("hi");\n',
    );
    assert.deepEqual(fs.readdirSync(stagingRoot), []);
  });

  it('replaces an installed plugin on update while keeping its data', async () => {
    const manifestJson = validManifestJson({ main: 'worker.js' });
    // Response 实例是一次性的：两次安装用工厂函数生成新响应。
    const { fetchImpl } = makeFetch([
      commitRoute(),
      ['git/trees', treeResponse([['plugins/fixture/manifest.json', manifestJson.length], ['plugins/fixture/worker.js', 32]])],
      [`raw.githubusercontent.com/owner/repo/${SHA}/plugins/fixture/manifest.json`, rawResponse(manifestJson)],
      [`raw.githubusercontent.com/owner/repo/${SHA}/plugins/fixture/worker.js`, rawResponse('console.log("hi");\n')],
    ]);
    const pluginManager = makeManager();
    const marketplace = makeMarketplace(fetchImpl, { pluginManager });
    const added = await marketplace.addSource({ url: 'https://github.com/owner/repo/tree/main/plugins' });
    const sourceId = added.state.sources[0].id;
    const first = await marketplace.install({ sourceId, directoryName: 'fixture',
      expectedPluginId: 'com.example.marketplace-fixture',
      expectedVersion: '1.0.0',
    });
    assert.equal(first.success, true, JSON.stringify(first));

    const second = await marketplace.install({ sourceId, directoryName: 'fixture', replace: true,
      expectedPluginId: 'com.example.marketplace-fixture',
      expectedVersion: '1.0.0',
    });
    assert.equal(second.success, true, JSON.stringify(second));
  });

  it('fails without replacing when the plugin is already installed', async () => {
    const manifestJson = validManifestJson({ main: 'worker.js' });
    const { fetchImpl } = makeFetch([
      commitRoute(),
      ['git/trees', treeResponse([['plugins/fixture/manifest.json', manifestJson.length], ['plugins/fixture/worker.js', 32]])],
      [`raw.githubusercontent.com/owner/repo/${SHA}/plugins/fixture/manifest.json`, rawResponse(manifestJson)],
      [`raw.githubusercontent.com/owner/repo/${SHA}/plugins/fixture/worker.js`, rawResponse('x\n')],
    ]);
    const pluginManager = makeManager();
    const marketplace = makeMarketplace(fetchImpl, { pluginManager });
    const added = await marketplace.addSource({ url: 'https://github.com/owner/repo/tree/main/plugins' });
    const sourceId = added.state.sources[0].id;
    const first = await marketplace.install({ sourceId, directoryName: 'fixture',
      expectedPluginId: 'com.example.marketplace-fixture',
      expectedVersion: '1.0.0',
    });
    assert.equal(first.success, true, JSON.stringify(first));

    const second = await marketplace.install({ sourceId, directoryName: 'fixture',
      expectedPluginId: 'com.example.marketplace-fixture',
      expectedVersion: '1.0.0',
    });
    assert.equal(second.success, false);
    assert.equal(second.error.code, 'PLUGIN_ALREADY_INSTALLED');
  });

  it('refuses to install a version revoked by the official registry (main-process check)', async () => {
    const manifestJson = validManifestJson({ main: 'worker.js' });
    const { fetchImpl } = makeFetch([
      commitRoute(),
      ['git/trees', treeResponse([['plugins/fixture/manifest.json', manifestJson.length], ['plugins/fixture/worker.js', 32]])],
      [`raw.githubusercontent.com/owner/repo/${SHA}/plugins/fixture/manifest.json`, rawResponse(manifestJson)],
      [`raw.githubusercontent.com/owner/repo/${SHA}/plugins/fixture/worker.js`, rawResponse('x\n')],
      // 官方注册表：插件列表为空；移除表里冻结了 1.0.0 的撤销记录。
      ['AmintaCCCP/GithubStarsManager/main/registry/community-plugins.json', () => new Response('[]', { status: 200 })],
      ['AmintaCCCP/GithubStarsManager/main/registry/removed-plugins.json', () => new Response(JSON.stringify([{
        id: 'com.example.marketplace-fixture',
        versions: ['1.0.0'],
        reason: 'leaked repository list',
        date: '2026-10-01',
        action: 'revoke',
      }]), { status: 200 })],
    ]);
    const marketplace = makeMarketplace(fetchImpl);
    const added = await marketplace.addSource({ url: 'https://github.com/owner/repo/tree/main/plugins' });
    const sourceId = added.state.sources[0].id;

    const result = await marketplace.install({ sourceId, directoryName: 'fixture',
      expectedPluginId: 'com.example.marketplace-fixture',
      expectedVersion: '1.0.0',
    });
    assert.equal(result.success, false);
    assert.equal(result.error.code, 'MARKETPLACE_VERSION_REVOKED');
    assert.deepEqual(fs.readdirSync(stagingRoot), []);
  });

  it('refuses to install when the downloaded manifest does not match the displayed identity', async () => {
    const manifestJson = validManifestJson({ main: 'worker.js' });
    const { fetchImpl } = makeFetch([
      commitRoute(),
      ['git/trees', treeResponse([['plugins/fixture/manifest.json', manifestJson.length], ['plugins/fixture/worker.js', 32]])],
      [`raw.githubusercontent.com/owner/repo/${SHA}/plugins/fixture/manifest.json`, rawResponse(manifestJson)],
      [`raw.githubusercontent.com/owner/repo/${SHA}/plugins/fixture/worker.js`, rawResponse('x\n')],
    ]);
    const marketplace = makeMarketplace(fetchImpl);
    const added = await marketplace.addSource({ url: 'https://github.com/owner/repo/tree/main/plugins' });
    const sourceId = added.state.sources[0].id;

    const result = await marketplace.install({
      sourceId,
      directoryName: 'fixture',
      expectedPluginId: 'com.example.something-else',
      expectedVersion: '1.0.0',
    });
    assert.equal(result.success, false);
    assert.equal(result.error.code, 'MARKETPLACE_PLUGIN_CHANGED');
    assert.deepEqual(fs.readdirSync(stagingRoot), []);
  });

  it('rolls back the old version and its state when the updated package is missing entries', async () => {
    const manifestJson = validManifestJson({ main: 'worker.js' });
    let treeFiles = [
      { path: 'plugins/fixture/manifest.json', type: 'blob', size: manifestJson.length },
      { path: 'plugins/fixture/worker.js', type: 'blob', size: 4 },
    ];
    const { fetchImpl } = makeFetch([
      commitRoute(),
      ['git/trees', () => jsonHeaders({ sha: 't', truncated: false, tree: treeFiles })],
      [`raw.githubusercontent.com/owner/repo/${SHA}/plugins/fixture/manifest.json`, rawResponse(manifestJson)],
      [`raw.githubusercontent.com/owner/repo/${SHA}/plugins/fixture/worker.js`, rawResponse('v1\n')],
    ]);
    const pluginManager = makeManager();
    const marketplace = makeMarketplace(fetchImpl, { pluginManager });
    const added = await marketplace.addSource({ url: 'https://github.com/owner/repo/tree/main/plugins' });
    const sourceId = added.state.sources[0].id;
    const first = await marketplace.install({ sourceId, directoryName: 'fixture',
      expectedPluginId: 'com.example.marketplace-fixture',
      expectedVersion: '1.0.0',
    });
    assert.equal(first.success, true, JSON.stringify(first));

    // 更新时的文件清单缺了 manifest 声明的入口：installFromDirectory 校验失败
    // → 回滚：旧目录原样回来，状态仍是"未启用"。
    treeFiles = [{ path: 'plugins/fixture/manifest.json', type: 'blob', size: manifestJson.length }];
    const second = await marketplace.install({ sourceId, directoryName: 'fixture', replace: true,
      expectedPluginId: 'com.example.marketplace-fixture',
      expectedVersion: '1.0.0',
    });
    assert.equal(second.success, false);
    assert.equal(second.error.code, 'PLUGIN_ENTRY_NOT_FOUND');
    assert.deepEqual(fs.readdirSync(pluginsRoot), ['com.example.marketplace-fixture']);
    assert.equal(fs.readFileSync(path.join(pluginsRoot, 'com.example.marketplace-fixture', 'worker.js'), 'utf8'), 'v1\n');
    const listed = await pluginManager.list();
    const rollbackPlugin = listed.plugins.find((plugin) => plugin.manifest.id === 'com.example.marketplace-fixture');
    assert.equal(rollbackPlugin.enabled, false);
  });

  it('refuses unsafe file paths from the tree', async () => {
    const manifestJson = validManifestJson({ main: 'worker.js' });
    const { fetchImpl } = makeFetch([
      commitRoute(),
      ['git/trees', treeResponse([
        ['plugins/fixture/manifest.json', manifestJson.length],
        ['plugins/fixture/../escape.js', 10],
      ])],
      [`raw.githubusercontent.com/owner/repo/${SHA}/plugins/fixture/manifest.json`, rawResponse(manifestJson)],
    ]);
    const marketplace = makeMarketplace(fetchImpl);
    const added = await marketplace.addSource({ url: 'https://github.com/owner/repo/tree/main/plugins' });
    const sourceId = added.state.sources[0].id;
    const result = await marketplace.install({ sourceId, directoryName: 'fixture',
      expectedPluginId: 'com.example.marketplace-fixture',
      expectedVersion: '1.0.0',
    });
    assert.equal(result.success, false);
    assert.equal(result.error.code, 'MARKETPLACE_ENTRY_UNSAFE');
    // 逃逸路径在写入前就被拒绝：staging 清空，目标文件不存在于任何位置。
    assert.deepEqual(fs.readdirSync(stagingRoot), []);
    assert.ok(!fs.existsSync(path.join(tmpRoot, 'escape.js')));
    assert.ok(!fs.existsSync(path.join(tmpRoot, 'escape')));
  });

  it('rejects packages that exceed the file-count limit', async () => {
    const manifestJson = validManifestJson({ main: 'worker.js' });
    const files = [['plugins/fixture/manifest.json', manifestJson.length]];
    for (let index = 0; index <= MAX_PLUGIN_PACKAGE_FILES; index += 1) {
      files.push([`plugins/fixture/blob-${index}.txt`, 1]);
    }
    const { fetchImpl } = makeFetch([
      commitRoute(),
      ['git/trees', treeResponse(files)],
      [`raw.githubusercontent.com/owner/repo/${SHA}/plugins/fixture/manifest.json`, rawResponse(manifestJson)],
    ]);
    const marketplace = makeMarketplace(fetchImpl);
    const added = await marketplace.addSource({ url: 'https://github.com/owner/repo/tree/main/plugins' });
    const result = await marketplace.install({ sourceId: added.state.sources[0].id, directoryName: 'fixture',
      expectedPluginId: 'com.example.marketplace-fixture',
      expectedVersion: '1.0.0',
    });
    assert.equal(result.success, false);
    assert.equal(result.error.code, 'MARKETPLACE_PACKAGE_TOO_LARGE');
  });

  it('reports a truncated repository tree instead of installing a partial package', async () => {
    const { fetchImpl } = makeFetch([
      commitRoute(),
      ['git/trees', treeResponse([['plugins/fixture/manifest.json', 10]], { truncated: true })],
    ]);
    const marketplace = makeMarketplace(fetchImpl);
    const added = await marketplace.addSource({ url: 'https://github.com/owner/repo/tree/main/plugins' });
    const result = await marketplace.install({ sourceId: added.state.sources[0].id, directoryName: 'fixture',
      expectedPluginId: 'com.example.marketplace-fixture',
      expectedVersion: '1.0.0',
    });
    assert.equal(result.success, false);
    assert.equal(result.error.code, 'SOURCE_TREE_TRUNCATED');
  });

  it('refuses to install when the plugin directory contains a submodule', async () => {
    const manifestJson = validManifestJson({ main: 'worker.js' });
    const { fetchImpl } = makeFetch([
      commitRoute(),
      ['git/trees', new Response(JSON.stringify({
        truncated: false,
        tree: [
          { path: 'plugins/fixture/manifest.json', type: 'blob', size: manifestJson.length },
          { path: 'plugins/fixture/vendor', type: 'commit', size: 0 },
        ],
      }), { status: 200 })],
    ]);
    const marketplace = makeMarketplace(fetchImpl);
    const added = await marketplace.addSource({ url: 'https://github.com/owner/repo/tree/main/plugins' });
    const result = await marketplace.install({ sourceId: added.state.sources[0].id, directoryName: 'fixture',
      expectedPluginId: 'com.example.marketplace-fixture',
      expectedVersion: '1.0.0',
    });
    assert.equal(result.success, false);
    assert.equal(result.error.code, 'MARKETPLACE_SUBMODULE_UNSUPPORTED');
  });

  it('surfaces download failures and cleans up staging', async () => {
    const manifestJson = validManifestJson({ main: 'worker.js' });
    const { fetchImpl } = makeFetch([
      commitRoute(),
      ['git/trees', treeResponse([['plugins/fixture/manifest.json', manifestJson.length], ['plugins/fixture/worker.js', 32]])],
      [`raw.githubusercontent.com/owner/repo/${SHA}/plugins/fixture/manifest.json`, rawResponse(manifestJson)],
      // worker.js 下载 404 → 安装失败
    ]);
    const marketplace = makeMarketplace(fetchImpl);
    const added = await marketplace.addSource({ url: 'https://github.com/owner/repo/tree/main/plugins' });
    const result = await marketplace.install({ sourceId: added.state.sources[0].id, directoryName: 'fixture',
      expectedPluginId: 'com.example.marketplace-fixture',
      expectedVersion: '1.0.0',
    });
    assert.equal(result.success, false);
    assert.equal(result.error.code, 'MARKETPLACE_DOWNLOAD_HTTP_ERROR');
    assert.deepEqual(fs.readdirSync(stagingRoot), []);
  });

  it('aborts an install when the source disappeared mid-flight', async () => {
    const { fetchImpl } = makeFetch([['contents/plugins', contentsResponse(['fixture'])]]);
    const marketplace = makeMarketplace(fetchImpl);
    const added = await marketplace.addSource({ url: 'https://github.com/owner/repo/tree/main/plugins' });
    const sourceId = added.state.sources[0].id;
    await marketplace.removeSource({ id: sourceId });

    const result = await marketplace.install({ sourceId, directoryName: 'fixture',
      expectedPluginId: 'com.example.marketplace-fixture',
      expectedVersion: '1.0.0',
    });
    assert.equal(result.success, false);
    assert.equal(result.error.code, 'SOURCE_NOT_FOUND');
  });

  it('refreshes a single source on demand and reports per-request timeouts', async () => {
    const { fetchImpl } = makeFetch([
      commitRoute(),
      // 永不结算，但监听 abort 信号（与真实 net.fetch 行为一致），超时后立即拒绝。
      ['api.github.com/repos/owner/repo/contents/plugins', (_url, { signal } = {}) => new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })],
    ]);
    const marketplace = makeMarketplace(fetchImpl, { requestTimeoutMs: 50 });
    const added = await marketplace.addSource({ url: 'https://github.com/owner/repo/tree/main/plugins' });
    assert.equal(added.state.entries[0].status, 'error');
    assert.equal(added.state.entries[0].error.code, 'SOURCE_LIST_TIMEOUT');

    const refreshed = await marketplace.refresh({ sourceId: added.state.sources[0].id });
    assert.equal(refreshed.success, true);
    assert.equal(refreshed.state.entries[0].error.code, 'SOURCE_LIST_TIMEOUT');
  });

  it('requires the displayed plugin identity in the install request', async () => {
    const { fetchImpl } = makeFetch([commitRoute(), ['contents/plugins', contentsResponse(['fixture'])]]);
    const marketplace = makeMarketplace(fetchImpl);
    const added = await marketplace.addSource({ url: 'https://github.com/owner/repo/tree/main/plugins' });
    const result = await marketplace.install({ sourceId: added.state.sources[0].id, directoryName: 'fixture' });
    assert.equal(result.success, false);
    assert.equal(result.error.code, 'MARKETPLACE_IDENTITY_REQUIRED');
  });

  it('re-resolves the commit SHA on every refresh so branch movement becomes visible', async () => {
    const shas = ['a'.repeat(40), 'b'.repeat(40)];
    // makeFetch 在调用处理器前就记录请求，处理器里自己计数，别用 calls 反推。
    let commitCallCount = 0;
    const { fetchImpl, calls } = makeFetch([
      ['api.github.com/repos/owner/repo/commits/main', () => {
        const sha = shas[Math.min(commitCallCount, shas.length - 1)];
        commitCallCount += 1;
        return jsonHeaders({ sha });
      }],
      ['contents/plugins', contentsResponse([])],
    ]);
    const marketplace = makeMarketplace(fetchImpl);
    const added = await marketplace.addSource({ url: 'https://github.com/owner/repo/tree/main/plugins' });
    assert.equal(added.success, true);
    await marketplace.refresh({ sourceId: added.state.sources[0].id });

    // 两次遍历各自解析一次提交，且 contents 请求分别钉在两个不同的 SHA 上。
    const contentsCalls = calls.filter((call) => call.url.includes('/contents/'));
    assert.equal(contentsCalls.length, 2);
    assert.ok(contentsCalls[0].url.includes(`ref=${shas[0]}`));
    assert.ok(contentsCalls[1].url.includes(`ref=${shas[1]}`));
  });

  it('propagates non-ENOENT state-file read errors instead of silently wiping the list', () => {
    fs.mkdirSync(stateFilePath, { recursive: true });
    const { fetchImpl } = makeFetch([]);
    assert.throws(
      () => createPluginMarketplace({
        statePath: stateFilePath,
        stagingRoot,
        fetchImpl,
        pluginManager: makeManager(),
      }),
      /EISDIR/,
    );
  });

  it('keeps reporting activation failure without pretending the update succeeded', async () => {
    const manifestJson = validManifestJson({ main: 'worker.js' });
    const { fetchImpl } = makeFetch([
      commitRoute(),
      ['git/trees', treeResponse([['plugins/fixture/manifest.json', manifestJson.length], ['plugins/fixture/worker.js', 32]])],
      [`raw.githubusercontent.com/owner/repo/${SHA}/plugins/fixture/manifest.json`, rawResponse(manifestJson)],
      [`raw.githubusercontent.com/owner/repo/${SHA}/plugins/fixture/worker.js`, rawResponse('v2\n')],
    ]);
    let activationShouldFail = false;
    const pluginManager = createPluginManager({
      pluginsRoot,
      statePath: path.join(tmpRoot, 'plugins-state.json'),
      runtimeFactory: () => ({
        activate: async () => {
          if (activationShouldFail) throw Object.assign(new Error('spawn failed'), { code: 'WORKER_SPAWN_FAILED' });
        },
        deactivate: async () => {},
        terminate: () => {},
      }),
    });
    const marketplace = createPluginMarketplace({
      statePath: stateFilePath,
      stagingRoot,
      fetchImpl,
      seedDefaultSource: false,
      pluginManager,
    });
    const added = await marketplace.addSource({ url: 'https://github.com/owner/repo/tree/main/plugins' });
    const sourceId = added.state.sources[0].id;
    const first = await marketplace.install({ sourceId, directoryName: 'fixture',
      expectedPluginId: 'com.example.marketplace-fixture',
      expectedVersion: '1.0.0',
    });
    assert.equal(first.success, true, JSON.stringify(first));
    const enabled = await pluginManager.enable('com.example.marketplace-fixture', ['storage']);
    assert.equal(enabled.success, true, JSON.stringify(enabled));

    activationShouldFail = true;
    const second = await marketplace.install({ sourceId, directoryName: 'fixture', replace: true,
      expectedPluginId: 'com.example.marketplace-fixture',
      expectedVersion: '1.0.0',
    });
    assert.equal(second.success, false);
    assert.equal(second.error.code, 'WORKER_SPAWN_FAILED');
    // 新版本文件已就位但激活失败：插件保持停用，错误状态由 recordError 记录。
    const listed = await pluginManager.list();
    const replaced = listed.plugins.find((plugin) => plugin.manifest.id === 'com.example.marketplace-fixture');
    assert.equal(replaced.enabled, false);
    assert.ok(replaced.lastError);
  });

  it('caches catalog state between getState calls', async () => {
    const { fetchImpl, calls } = makeFetch([
      commitRoute(),
      ['contents/plugins', contentsResponse([])],
    ]);
    const marketplace = makeMarketplace(fetchImpl);
    await marketplace.addSource({ url: 'https://github.com/owner/repo/tree/main/plugins' });
    const before = calls.length;
    const state = marketplace.getState();
    assert.equal(state.entries[0].status, 'ok');
    assert.equal(calls.length, before, 'getState must not trigger network requests');
  });
});
