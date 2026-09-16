const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createPluginManager } = require('./pluginManager');

function createWorkspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-plugins-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function writePlugin(root, directoryName, manifest, files = {}) {
  const directory = path.join(root, directoryName);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(directory, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return directory;
}

function validManifest(id, overrides = {}) {
  return {
    manifestVersion: 1,
    id,
    name: id,
    version: '1.0.0',
    apiVersion: '1',
    main: 'worker.js',
    permissions: [],
    contributes: {},
    ...overrides,
  };
}

test('scans valid first-level plugin directories without exposing absolute paths', (t) => {
  const root = createWorkspace(t);
  writePlugin(root, 'markdown', validManifest('com.example.markdown'), {
    'worker.js': 'module.exports = {};',
  });

  const result = createPluginManager({ pluginsRoot: root }).scan();

  assert.deepEqual(result.invalidPlugins, []);
  assert.equal(result.plugins.length, 1);
  assert.deepEqual(result.plugins[0], {
    directoryName: 'markdown',
    manifest: validManifest('com.example.markdown'),
  });
  assert.equal(JSON.stringify(result).includes(root), false);
});

test('reports damaged plugins without preventing valid plugins from loading', (t) => {
  const root = createWorkspace(t);
  writePlugin(root, 'valid', validManifest('com.example.valid'), { 'worker.js': '' });
  const damaged = path.join(root, 'damaged');
  fs.mkdirSync(damaged);
  fs.writeFileSync(path.join(damaged, 'manifest.json'), '{broken');
  fs.mkdirSync(path.join(root, 'missing-manifest'));

  const result = createPluginManager({ pluginsRoot: root }).scan();

  assert.deepEqual(result.plugins.map((plugin) => plugin.manifest.id), ['com.example.valid']);
  assert.deepEqual(
    result.invalidPlugins.map((plugin) => [plugin.directoryName, plugin.code]),
    [
      ['damaged', 'MANIFEST_JSON_INVALID'],
      ['missing-manifest', 'MANIFEST_NOT_FOUND'],
    ]
  );
});

test('rejects duplicate plugin ids deterministically', (t) => {
  const root = createWorkspace(t);
  writePlugin(root, 'alpha', validManifest('com.example.duplicate'), { 'worker.js': '' });
  writePlugin(root, 'beta', validManifest('com.example.duplicate'), { 'worker.js': '' });

  const result = createPluginManager({ pluginsRoot: root }).scan();

  assert.deepEqual(result.plugins.map((plugin) => plugin.directoryName), ['alpha']);
  assert.deepEqual(result.invalidPlugins, [
    {
      directoryName: 'beta',
      code: 'PLUGIN_ID_DUPLICATE',
      message: "Plugin id 'com.example.duplicate' is already provided by 'alpha'",
    },
  ]);
});

test('rejects escaping, missing, and directory entry paths', (t) => {
  const root = createWorkspace(t);
  fs.writeFileSync(path.join(root, 'outside.js'), '');
  writePlugin(root, 'escape', validManifest('com.example.escape', { main: '../outside.js' }));
  writePlugin(root, 'missing', validManifest('com.example.missing'));
  writePlugin(root, 'directory', validManifest('com.example.directory', { main: 'runtime' }), {
    'runtime/.keep': '',
  });

  const result = createPluginManager({ pluginsRoot: root }).scan();

  assert.deepEqual(
    result.invalidPlugins.map((plugin) => [plugin.directoryName, plugin.code]),
    [
      ['directory', 'PLUGIN_ENTRY_NOT_FILE'],
      ['escape', 'PLUGIN_ENTRY_OUTSIDE_DIRECTORY'],
      ['missing', 'PLUGIN_ENTRY_NOT_FOUND'],
    ]
  );
});

test('scanning reads metadata but never executes plugin code', (t) => {
  const root = createWorkspace(t);
  const marker = path.join(root, 'executed.txt');
  writePlugin(root, 'side-effect', validManifest('com.example.side-effect'), {
    'worker.js': `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed');`,
  });

  const result = createPluginManager({ pluginsRoot: root }).scan();

  assert.equal(result.plugins.length, 1);
  assert.equal(fs.existsSync(marker), false);
});

test('reuses cached discovery for lookups and scan explicitly refreshes it', (t) => {
  const root = createWorkspace(t);
  writePlugin(root, 'page', validManifest('com.example.cached', {
    main: undefined,
    contributes: { pages: [{ id: 'dashboard', title: 'Dashboard', entry: 'index.html' }] },
  }), { 'index.html': '<!doctype html>' });
  const manager = createPluginManager({ pluginsRoot: root });
  const originalRead = fs.readFileSync;
  let manifestReads = 0;
  fs.readFileSync = function (...args) {
    if (String(args[0]).endsWith('manifest.json')) manifestReads += 1;
    return originalRead.apply(this, args);
  };
  t.after(() => { fs.readFileSync = originalRead; });

  manager.scan();
  manager.getPage('com.example.cached', 'dashboard');
  manager.getPage('com.example.cached', 'dashboard');
  assert.equal(manifestReads, 1);
  manager.scan();
  assert.equal(manifestReads, 2);
});

test('rejects page entry paths that escape or do not exist', (t) => {
  const root = createWorkspace(t);
  const pageManifest = validManifest('com.example.page', {
    main: undefined,
    contributes: {
      pages: [{ id: 'dashboard', title: 'Dashboard', entry: '../outside.html' }],
    },
  });
  delete pageManifest.main;
  writePlugin(root, 'page', pageManifest);

  const result = createPluginManager({ pluginsRoot: root }).scan();
  assert.equal(result.invalidPlugins[0].code, 'PLUGIN_ENTRY_OUTSIDE_DIRECTORY');
});

test('rejects symlinked plugin directories and entry files that escape the plugin root', (t) => {
  const root = createWorkspace(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-plugin-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, 'worker.js'), '');
  fs.writeFileSync(
    path.join(outside, 'manifest.json'),
    JSON.stringify(validManifest('com.example.linked-directory'))
  );

  const directoryLink = path.join(root, 'linked-directory');
  const entryDirectory = writePlugin(root, 'linked-entry', validManifest('com.example.linked-entry'));
  try {
    fs.symlinkSync(outside, directoryLink, 'junction');
    fs.symlinkSync(path.join(outside, 'worker.js'), path.join(entryDirectory, 'worker.js'), 'file');
  } catch (error) {
    t.skip(`Symlink creation is unavailable: ${error.message}`);
    return;
  }

  const result = createPluginManager({ pluginsRoot: root }).scan();
  assert.deepEqual(
    result.invalidPlugins.map((plugin) => [plugin.directoryName, plugin.code]),
    [
      ['linked-directory', 'PLUGIN_DIRECTORY_OUTSIDE_ROOT'],
      ['linked-entry', 'PLUGIN_ENTRY_OUTSIDE_DIRECTORY'],
    ]
  );
});

function createFakeRuntime(events, actionResult = { type: 'text', content: 'ok' }) {
  return {
    async activate() { events.push('activate'); },
    async deactivate() { events.push('deactivate'); },
    async runAction(input) { events.push(['runAction', input]); return actionResult; },
    async runProcessor(input) { events.push(['runProcessor', input]); return { repositories: [] }; },
    async runReleaseProcessor(input) { events.push(['runReleaseProcessor', input]); return { recommendedAssetId: 3, confidence: 0.9, reason: 'Windows x64' }; },
    async runExporter(input) { events.push(['runExporter', input]); return { content: '# Export' }; },
    terminate() { events.push('terminate'); },
  };
}

test('requires exact permission confirmation before enabling and persists lifecycle state', async (t) => {
  const root = createWorkspace(t);
  const statePath = path.join(root, '..', `${path.basename(root)}-state.json`);
  t.after(() => fs.rmSync(statePath, { force: true }));
  writePlugin(root, 'exporter', validManifest('com.example.exporter', {
    permissions: ['repositories:read'],
    contributes: {
      repositoryActions: [{ id: 'export', title: 'Export', placement: 'bulk-toolbar' }],
    },
  }), { 'worker.js': '' });
  const events = [];
  const manager = createPluginManager({
    pluginsRoot: root,
    statePath,
    runtimeFactory: () => createFakeRuntime(events),
  });

  assert.equal((await manager.list()).plugins[0].status, 'disabled');
  assert.equal((await manager.enable('com.example.exporter', [])).error.code, 'PLUGIN_PERMISSION_CONFIRMATION_REQUIRED');
  assert.deepEqual(await manager.enable('com.example.exporter', ['repositories:read']), { success: true });
  assert.equal((await manager.list()).plugins[0].status, 'active');
  assert.deepEqual(events, ['activate']);

  assert.deepEqual(await manager.disable('com.example.exporter'), { success: true });
  assert.equal((await manager.list()).plugins[0].status, 'disabled');
  assert.deepEqual(events, ['activate', 'deactivate']);
  assert.equal(JSON.parse(fs.readFileSync(statePath, 'utf8')).plugins['com.example.exporter'].enabled, false);
});

test('rejects duplicated or unknown granted permissions instead of enabling', async (t) => {
  const root = createWorkspace(t);
  const statePath = path.join(root, '..', `${path.basename(root)}-state.json`);
  t.after(() => fs.rmSync(statePath, { force: true }));
  writePlugin(root, 'duplicates', validManifest('com.example.duplicates', {
    permissions: ['repositories:read', 'ai:invoke'],
  }), { 'worker.js': '' });
  const events = [];
  const manager = createPluginManager({
    pluginsRoot: root,
    statePath,
    runtimeFactory: () => createFakeRuntime(events),
  });

  const duplicated = await manager.enable('com.example.duplicates', ['repositories:read', 'repositories:read']);
  assert.equal(duplicated.error.code, 'PLUGIN_PERMISSION_CONFIRMATION_REQUIRED');
  const unknown = await manager.enable('com.example.duplicates', ['repositories:read', 'made:up']);
  assert.equal(unknown.error.code, 'PLUGIN_PERMISSION_CONFIRMATION_REQUIRED');
  assert.deepEqual(events, []);

  assert.deepEqual(
    await manager.enable('com.example.duplicates', ['repositories:read', 'ai:invoke']),
    { success: true }
  );
  assert.deepEqual(events, ['activate']);
});

test('coalesces concurrent activation requests for the same plugin', async (t) => {
  const root = createWorkspace(t);
  const statePath = path.join(root, '..', `${path.basename(root)}-state.json`);
  t.after(() => fs.rmSync(statePath, { force: true }));
  writePlugin(root, 'shared', validManifest('com.example.shared'), { 'worker.js': '' });
  const events = [];
  let runtimeCount = 0;
  const manager = createPluginManager({
    pluginsRoot: root,
    statePath,
    runtimeFactory: () => { runtimeCount += 1; return createFakeRuntime(events); },
  });

  const [first, second] = await Promise.all([
    manager.enable('com.example.shared', []),
    manager.enable('com.example.shared', []),
  ]);

  assert.deepEqual(first, { success: true });
  assert.deepEqual(second, { success: true });
  assert.equal(runtimeCount, 1);
  assert.deepEqual(events, ['activate']);
});

test('concurrent enable waits for a failing in-flight activation instead of reporting success', async (t) => {
  const root = createWorkspace(t);
  const statePath = path.join(root, '..', `${path.basename(root)}-state.json`);
  t.after(() => fs.rmSync(statePath, { force: true }));
  writePlugin(root, 'failing', validManifest('com.example.failing'), { 'worker.js': '' });
  let releaseActivation;
  const gate = new Promise((resolve) => { releaseActivation = resolve; });
  const manager = createPluginManager({
    pluginsRoot: root,
    statePath,
    runtimeFactory: () => ({
      async activate() {
        await gate;
        throw Object.assign(new Error('startup failed'), { code: 'PLUGIN_RUNTIME_ERROR' });
      },
      terminate() {},
    }),
  });

  const first = manager.enable('com.example.failing', []);
  const second = manager.enable('com.example.failing', []);
  releaseActivation();
  const [left, right] = await Promise.all([first, second]);
  assert.equal(left.success, false);
  assert.equal(right.success, false);
  assert.equal(left.error.code, 'PLUGIN_RUNTIME_ERROR');
  assert.equal(right.error.code, 'PLUGIN_RUNTIME_ERROR');
  assert.equal((await manager.list()).plugins[0].status, 'error');
});

test('never leaves an active Worker when a plugin is disabled during activation', async (t) => {
  const root = createWorkspace(t);
  const statePath = path.join(root, '..', `${path.basename(root)}-state.json`);
  t.after(() => fs.rmSync(statePath, { force: true }));
  writePlugin(root, 'slow', validManifest('com.example.slow'), { 'worker.js': '' });
  const events = [];
  let releaseActivation;
  const gate = new Promise((resolve) => { releaseActivation = resolve; });
  const manager = createPluginManager({
    pluginsRoot: root,
    statePath,
    runtimeFactory: () => ({
      async activate() { events.push('activate'); await gate; events.push('activated'); },
      async deactivate() { events.push('deactivate'); },
      async runAction() { return { type: 'text', content: 'ok' }; },
      terminate() { events.push('terminate'); },
    }),
  });

  const enabling = manager.enable('com.example.slow', []);
  releaseActivation();
  const disabled = await manager.disable('com.example.slow');

  assert.deepEqual(await enabling, { success: true });
  assert.deepEqual(disabled, { success: true });
  assert.deepEqual(events, ['activate', 'activated', 'deactivate']);
  assert.equal((await manager.list()).plugins[0].status, 'disabled');
});

test('serializes overlapping enable and disable so a later disable wins', async (t) => {
  const root = createWorkspace(t);
  const statePath = path.join(root, '..', `${path.basename(root)}-state.json`);
  t.after(() => fs.rmSync(statePath, { force: true }));
  writePlugin(root, 'overlap', validManifest('com.example.overlap'), { 'worker.js': '' });
  const events = [];
  let releaseDisable;
  const gate = new Promise((resolve) => { releaseDisable = resolve; });
  const manager = createPluginManager({
    pluginsRoot: root,
    statePath,
    runtimeFactory: () => ({
      async activate() { events.push('activate'); },
      async deactivate() { events.push('deactivate-start'); await gate; events.push('deactivate-end'); },
      terminate() { events.push('terminate'); },
    }),
  });

  assert.deepEqual(await manager.enable('com.example.overlap', []), { success: true });
  const disabling = manager.disable('com.example.overlap');
  const reenabled = manager.enable('com.example.overlap', []);
  releaseDisable();
  assert.deepEqual(await disabling, { success: true });
  assert.deepEqual(await reenabled, { success: true });
  assert.deepEqual(events, ['activate', 'deactivate-start', 'deactivate-end', 'activate']);
  assert.equal((await manager.list()).plugins[0].status, 'active');
});

test('restores enabled plugins and disables them when permissions change', async (t) => {
  const root = createWorkspace(t);
  const statePath = path.join(root, '..', `${path.basename(root)}-state.json`);
  t.after(() => fs.rmSync(statePath, { force: true }));
  writePlugin(root, 'plugin', validManifest('com.example.restore'), { 'worker.js': '' });
  fs.writeFileSync(statePath, JSON.stringify({
    version: 1,
    plugins: {
      'com.example.restore': { enabled: true, grantedPermissions: [] },
    },
  }));
  const restoredEvents = [];
  const restored = createPluginManager({
    pluginsRoot: root,
    statePath,
    runtimeFactory: () => createFakeRuntime(restoredEvents),
  });
  await restored.initialize();
  assert.deepEqual(restoredEvents, ['activate']);

  const manifestPath = path.join(root, 'plugin', 'manifest.json');
  const changed = validManifest('com.example.restore', { permissions: ['storage'] });
  fs.writeFileSync(manifestPath, JSON.stringify(changed));
  const changedManager = createPluginManager({
    pluginsRoot: root,
    statePath,
    runtimeFactory: () => createFakeRuntime([]),
  });
  const listed = await changedManager.list();
  assert.equal(listed.plugins[0].enabled, false);
  assert.equal(listed.plugins[0].lastError.code, 'PLUGIN_PERMISSIONS_CHANGED');
});

test('runs only declared actions for active plugins with sanitized repository data', async (t) => {
  const root = createWorkspace(t);
  const statePath = path.join(root, '..', `${path.basename(root)}-state.json`);
  t.after(() => fs.rmSync(statePath, { force: true }));
  writePlugin(root, 'actions', validManifest('com.example.actions', {
    permissions: ['repositories:read'],
    contributes: {
      repositoryActions: [{ id: 'export', title: 'Export', placement: 'bulk-toolbar' }],
    },
  }), { 'worker.js': '' });
  const events = [];
  const manager = createPluginManager({
    pluginsRoot: root,
    statePath,
    runtimeFactory: () => createFakeRuntime(events),
  });
  await manager.enable('com.example.actions', ['repositories:read']);

  const missing = await manager.runAction({
    pluginId: 'com.example.actions', actionId: 'missing', repositories: [],
  });
  assert.equal(missing.error.code, 'PLUGIN_ACTION_NOT_FOUND');

  const result = await manager.runAction({
    pluginId: 'com.example.actions',
    actionId: 'export',
    repositories: [{
      id: 1,
      name: 'project',
      full_name: 'owner/project',
      description: null,
      html_url: 'https://github.com/owner/project',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      pushed_at: '2026-01-01T00:00:00Z',
      owner: { login: 'owner', avatar_url: 'private' },
      topics: [],
      token: 'must not cross',
    }],
  });
  assert.deepEqual(result, { success: true, result: { type: 'text', content: 'ok' } });
  const actionInput = events.find((event) => Array.isArray(event))[1];
  assert.equal('token' in actionInput.repositories[0], false);
  assert.equal('avatar_url' in actionInput.repositories[0].owner, false);
});

test('disables a plugin before uninstalling only its validated directory', async (t) => {
  const root = createWorkspace(t);
  const statePath = path.join(root, '..', `${path.basename(root)}-state.json`);
  t.after(() => fs.rmSync(statePath, { force: true }));
  const pluginDirectory = writePlugin(root, 'remove-me', validManifest('com.example.remove'), {
    'worker.js': '',
  });
  const sibling = path.join(root, 'keep.txt');
  fs.writeFileSync(sibling, 'keep');
  const events = [];
  const manager = createPluginManager({
    pluginsRoot: root,
    statePath,
    runtimeFactory: () => createFakeRuntime(events),
  });
  await manager.enable('com.example.remove', []);

  assert.deepEqual(await manager.uninstall('com.example.remove'), { success: true, dataRemoved: false });
  assert.deepEqual(events, ['activate', 'deactivate']);
  assert.equal(fs.existsSync(pluginDirectory), false);
  assert.equal(fs.readFileSync(sibling, 'utf8'), 'keep');
  assert.equal((await manager.list()).plugins.length, 0);
});

test('keeps or deletes isolated plugin storage and logs according to uninstall choice', async (t) => {
  const workspace = createWorkspace(t);
  const pluginsRoot = path.join(workspace, 'plugins');
  const dataRoot = path.join(workspace, 'plugin-data');
  const logsRoot = path.join(workspace, 'plugin-logs');
  const statePath = path.join(workspace, 'plugins-state.json');
  writePlugin(pluginsRoot, 'keep-data', validManifest('com.example.keep-data', { permissions: ['storage'] }), {
    'worker.js': '',
  });
  writePlugin(pluginsRoot, 'wipe-data', validManifest('com.example.wipe-data', { permissions: ['storage'] }), {
    'worker.js': '',
  });
  fs.mkdirSync(dataRoot, { recursive: true });
  fs.mkdirSync(logsRoot, { recursive: true });
  fs.writeFileSync(path.join(dataRoot, 'com.example.keep-data.json'), '{"settings":true}\n');
  fs.writeFileSync(path.join(logsRoot, 'com.example.keep-data.log'), 'keep\n');
  fs.writeFileSync(path.join(dataRoot, 'com.example.wipe-data.json'), '{"settings":true}\n');
  fs.writeFileSync(path.join(logsRoot, 'com.example.wipe-data.log'), 'wipe\n');
  fs.writeFileSync(path.join(logsRoot, 'com.example.wipe-data.log.1'), 'rotated\n');
  const manager = createPluginManager({
    pluginsRoot,
    statePath,
    dataRoot,
    logsRoot,
    runtimeFactory: () => createFakeRuntime([]),
  });
  await manager.enable('com.example.keep-data', ['storage']);
  await manager.enable('com.example.wipe-data', ['storage']);

  assert.deepEqual(await manager.uninstall('com.example.keep-data', false), { success: true, dataRemoved: false });
  assert.equal(fs.existsSync(path.join(dataRoot, 'com.example.keep-data.json')), true);
  assert.equal(fs.existsSync(path.join(logsRoot, 'com.example.keep-data.log')), true);

  assert.deepEqual(await manager.uninstall('com.example.wipe-data', true), { success: true, dataRemoved: true });
  assert.equal(fs.existsSync(path.join(dataRoot, 'com.example.wipe-data.json')), false);
  assert.equal(fs.existsSync(path.join(logsRoot, 'com.example.wipe-data.log')), false);
  assert.equal(fs.existsSync(path.join(logsRoot, 'com.example.wipe-data.log.1')), false);
  assert.equal((await manager.uninstall('com.example.wipe-data', 'yes')).error.code, 'PLUGIN_UNINSTALL_OPTIONS_INVALID');
});

test('does not disable a plugin when a release snapshot is invalid', async (t) => {
  const root = createWorkspace(t);
  const statePath = path.join(root, '..', `${path.basename(root)}-state.json`);
  t.after(() => fs.rmSync(statePath, { force: true }));
  writePlugin(root, 'release', validManifest('com.example.release', {
    permissions: ['releases:read'],
    contributes: { releaseProcessors: [{ id: 'recommend', title: 'Recommend' }] },
  }), { 'worker.js': '' });
  const events = [];
  const manager = createPluginManager({
    pluginsRoot: root,
    statePath,
    runtimeFactory: () => createFakeRuntime(events),
  });
  await manager.enable('com.example.release', ['releases:read']);
  const result = await manager.runReleaseProcessor({
    pluginId: 'com.example.release',
    processorId: 'recommend',
    release: {
      id: 20,
      tag_name: 'v1',
      published_at: '2026-01-01',
      html_url: 'https://github.com/owner/project/releases/tag/v1',
      repository: { id: 1, full_name: 'owner/project', name: 'project' },
      assets: [{
        id: 21,
        name: 'app.zip',
        size: 1,
        download_count: 0,
        browser_download_url: 'https://evil.example/app.zip',
        content_type: 'application/zip',
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
      }],
    },
  });
  assert.equal(result.success, false);
  assert.equal(result.error.code, 'PLUGIN_SNAPSHOT_INVALID');
  assert.equal((await manager.list()).plugins[0].status, 'active');
  assert.deepEqual(events, ['activate']);
});

test('runs declared processors and exporters for active plugins', async (t) => {
  const root = createWorkspace(t);
  const statePath = path.join(root, '..', `${path.basename(root)}-state.json`);
  t.after(() => fs.rmSync(statePath, { force: true }));
  writePlugin(root, 'tools', validManifest('com.example.tools', {
    permissions: ['repositories:read'],
    contributes: {
      repositoryProcessors: [{ id: 'health', title: 'Health' }],
      exporters: [{ id: 'markdown', title: 'Markdown', fileExtension: '.md', mimeType: 'text/markdown' }],
    },
  }), { 'worker.js': '' });
  const events = [];
  const manager = createPluginManager({
    pluginsRoot: root,
    statePath,
    runtimeFactory: () => createFakeRuntime(events),
  });
  await manager.enable('com.example.tools', ['repositories:read']);
  const repositories = [{
    id: 1, name: 'p', full_name: 'o/p', html_url: 'https://github.com/o/p',
    created_at: '2026-01-01', updated_at: '2026-01-01', pushed_at: '2026-01-01',
    owner: { login: 'o' }, topics: [],
  }];

  assert.deepEqual(await manager.runProcessor({
    pluginId: 'com.example.tools', processorId: 'health', repositories,
  }), { success: true, result: { repositories: [] } });
  assert.deepEqual(await manager.runExporter({
    pluginId: 'com.example.tools', exporterId: 'markdown', repositories,
  }), {
    success: true,
    result: {
      content: '# Export',
      fileName: 'com.example.tools-markdown.md',
      mimeType: 'text/markdown',
    },
  });
});

test('runs declared release processors and authorizes only Host-known asset downloads', async (t) => {
  const root = createWorkspace(t);
  const statePath = path.join(root, '..', `${path.basename(root)}-state.json`);
  t.after(() => fs.rmSync(statePath, { force: true }));
  writePlugin(root, 'release', validManifest('com.example.release', {
    permissions: ['releases:read', 'downloads:create'],
    contributes: { releaseProcessors: [{ id: 'recommend', title: 'Recommend' }] },
  }), { 'worker.js': '' });
  const events = [];
  const manager = createPluginManager({ pluginsRoot: root, statePath, runtimeFactory: () => createFakeRuntime(events) });
  await manager.enable('com.example.release', ['releases:read', 'downloads:create']);
  const release = {
    id: 2, tag_name: 'v1', name: null, body: null, published_at: '2026-01-01',
    html_url: 'https://github.com/o/p/releases/tag/v1', repository: { id: 1, full_name: 'o/p', name: 'p' },
    assets: [{ id: 3, name: 'p-x64.exe', size: 10, download_count: 0,
      browser_download_url: 'https://github.com/o/p/releases/download/v1/p-x64.exe',
      content_type: 'application/octet-stream', created_at: '2026-01-01', updated_at: '2026-01-01' }],
  };
  assert.equal((await manager.runReleaseProcessor({
    pluginId: 'com.example.release', processorId: 'recommend', release,
  })).success, true);
  assert.equal(manager.getDownloadAsset('com.example.release', 2, 3).success, true);
  assert.equal(manager.getDownloadAsset('com.example.release', 2, 4).error.code, 'PLUGIN_ASSET_NOT_FOUND');
  const payload = events.find((event) => Array.isArray(event) && event[0] === 'runReleaseProcessor')[1];
  assert.equal('browser_download_url' in payload.release.assets[0], false);
  assert.equal(typeof payload.hostEnvironment.os, 'string');
});

test('installs a validated local directory as disabled without copying symlinks', async (t) => {
  const root = createWorkspace(t);
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-plugin-source-'));
  t.after(() => fs.rmSync(sourceRoot, { recursive: true, force: true }));
  const source = writePlugin(sourceRoot, 'source', validManifest('com.example.install'), {
    'worker.js': 'module.exports = {};',
  });
  const manager = createPluginManager({ pluginsRoot: root });

  assert.deepEqual(manager.installFromDirectory(source), {
    success: true,
    pluginId: 'com.example.install',
  });
  const listed = await manager.list();
  assert.equal(listed.plugins[0].manifest.id, 'com.example.install');
  assert.equal(listed.plugins[0].enabled, false);
  assert.equal(fs.existsSync(path.join(root, 'com.example.install', 'worker.js')), true);

  const linked = writePlugin(sourceRoot, 'linked', validManifest('com.example.linked-install'), {
    'worker.js': 'module.exports = {};',
  });
  try {
    fs.symlinkSync(path.join(source, 'worker.js'), path.join(linked, 'extra-link.js'), 'file');
  } catch (error) {
    t.diagnostic(`Symlink creation unavailable: ${error.message}`);
    return;
  }
  assert.equal(manager.installFromDirectory(linked).error.code, 'PLUGIN_PACKAGE_SYMLINK');
  assert.equal(fs.existsSync(path.join(root, 'com.example.linked-install')), false);
});

test('rejects oversized manifests and activates page-only plugins without a Worker', async (t) => {
  const root = createWorkspace(t);
  const oversized = path.join(root, 'oversized');
  fs.mkdirSync(oversized);
  fs.writeFileSync(path.join(oversized, 'manifest.json'), ' '.repeat(256 * 1024 + 1));

  const pageManifest = validManifest('com.example.page-only', {
    contributes: { pages: [{ id: 'dashboard', title: 'Dashboard', entry: 'index.html' }] },
  });
  delete pageManifest.main;
  writePlugin(root, 'page-only', pageManifest, { 'index.html': '<!doctype html>' });
  const statePath = path.join(root, '..', `${path.basename(root)}-state.json`);
  t.after(() => fs.rmSync(statePath, { force: true }));
  const manager = createPluginManager({ pluginsRoot: root, statePath });

  const listed = await manager.list();
  assert.equal(listed.invalidPlugins[0].code, 'MANIFEST_TOO_LARGE');
  const enabled = await manager.enable('com.example.page-only', []);
  assert.deepEqual(enabled, { success: true });
  assert.equal(manager.getPage('com.example.page-only', 'dashboard').url,
    'plugin-page://com.example.page-only/dashboard/index.html');
  assert.equal((await manager.list()).plugins[0].status, 'active');
  assert.deepEqual(await manager.disable('com.example.page-only'), { success: true });
  assert.equal(manager.getPage('com.example.page-only', 'dashboard').error.code, 'PLUGIN_NOT_ACTIVE');
});

test('page requests use the declared Host capability and stop after disable', async (t) => {
  const root = createWorkspace(t);
  const statePath = path.join(root, '..', `${path.basename(root)}-state.json`);
  t.after(() => fs.rmSync(statePath, { force: true }));
  const manifest = validManifest('com.example.health-page', {
    permissions: ['repositories:read'],
    contributes: { pages: [{ id: 'dashboard', title: 'Dashboard', entry: 'ui/index.html' }] },
  });
  delete manifest.main;
  writePlugin(root, 'health-page', manifest, { 'ui/index.html': '<!doctype html>' });
  const manager = createPluginManager({ pluginsRoot: root, statePath });
  manager.updateSnapshot({ repositories: [{
    id: 1, name: 'repo', full_name: 'owner/repo', html_url: 'https://github.com/owner/repo',
    description: 'Example', stargazers_count: 5, created_at: '2026-01-01',
    updated_at: '2026-01-01', pushed_at: '2026-01-01', owner: { login: 'owner' }, topics: [],
  }], releases: [] });
  assert.deepEqual(await manager.enable(manifest.id, manifest.permissions), { success: true });
  const result = await manager.requestPageCapability({
    pluginId: manifest.id, pageId: 'dashboard', method: 'repositories.search', args: { query: 'owner', limit: 5 },
  });
  assert.equal(result.success, true);
  assert.equal(result.value[0].full_name, 'owner/repo');
  assert.equal((await manager.requestPageCapability({
    pluginId: manifest.id, pageId: 'dashboard', method: 'releases.get', args: { releaseId: 1 },
  })).error.code, 'PLUGIN_PERMISSION_DENIED');
  await manager.disable(manifest.id);
  assert.equal((await manager.requestPageCapability({
    pluginId: manifest.id, pageId: 'dashboard', method: 'repositories.search', args: { query: 'owner' },
  })).error.code, 'PLUGIN_NOT_ACTIVE');
});

test('AI page requests only authorize a declared and enabled permission', async (t) => {
  const root = createWorkspace(t);
  const statePath = path.join(root, '..', `${path.basename(root)}-state.json`);
  t.after(() => fs.rmSync(statePath, { force: true }));
  const manifest = validManifest('com.example.ai-page', {
    permissions: ['ai:invoke'],
    contributes: { pages: [{ id: 'dashboard', title: 'AI', entry: 'ui/index.html' }] },
  });
  delete manifest.main;
  writePlugin(root, 'ai-page', manifest, { 'ui/index.html': '<!doctype html>' });
  const manager = createPluginManager({ pluginsRoot: root, statePath });
  const request = { pluginId: manifest.id, pageId: 'dashboard', method: 'ai.generate', args: { system: '', user: 'Example' } };
  assert.equal((await manager.requestPageCapability(request)).error.code, 'PLUGIN_NOT_ACTIVE');
  assert.deepEqual(await manager.enable(manifest.id, manifest.permissions), { success: true });
  assert.deepEqual(await manager.requestPageCapability(request), { success: true, value: null });
  await manager.disable(manifest.id);
  assert.equal((await manager.requestPageCapability(request)).error.code, 'PLUGIN_NOT_ACTIVE');
});

test('web search uses only the user-configured endpoint after page authorization', async (t) => {
  const root = createWorkspace(t);
  const statePath = path.join(root, '..', `${path.basename(root)}-state.json`);
  t.after(() => fs.rmSync(statePath, { force: true }));
  const manifest = validManifest('com.example.search-page', {
    permissions: ['web:search'],
    contributes: { pages: [{ id: 'dashboard', title: 'Search', entry: 'ui/index.html' }] },
  });
  delete manifest.main;
  writePlugin(root, 'search-page', manifest, { 'ui/index.html': '<!doctype html>' });
  const calls = [];
  const manager = createPluginManager({ pluginsRoot: root, statePath,
    webSearch: async (endpoint, args) => { calls.push([endpoint, args]); return [{ title: 'Example' }]; },
  });
  const request = { pluginId: manifest.id, pageId: 'dashboard', args: { query: 'Example', limit: 2 } };
  assert.equal((await manager.searchWeb(request)).error.code, 'PLUGIN_NOT_ACTIVE');
  assert.deepEqual(await manager.enable(manifest.id, manifest.permissions), { success: true });
  assert.equal((await manager.searchWeb(request)).error.code, 'PLUGIN_SEARCH_NOT_CONFIGURED');
  assert.equal(manager.configureWebSearch('http://localhost:8888').error.code, 'PLUGIN_SEARCH_ENDPOINT_INVALID');
  assert.deepEqual(manager.configureWebSearch('https://search.example.com'), { success: true });
  assert.deepEqual(await manager.searchWeb(request), { success: true, value: [{ title: 'Example' }] });
  assert.deepEqual(calls, [['https://search.example.com', { query: 'Example', limit: 2 }]]);
  assert.deepEqual(manager.getSearchEndpoint(), { endpoint: 'https://search.example.com' });
  await manager.disable(manifest.id);
  assert.equal((await manager.searchWeb(request)).error.code, 'PLUGIN_NOT_ACTIVE');
  assert.equal(calls.length, 1);
});
