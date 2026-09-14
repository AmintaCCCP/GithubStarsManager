'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createPluginManager } = require('./pluginManager');

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-manifests-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function manifest(id, overrides = {}) {
  return {
    manifestVersion: 1, apiVersion: '1', id, name: id, version: '1.0.0',
    main: 'index.js', permissions: [], contributes: {}, ...overrides,
  };
}

function plugin(root, directoryName, metadata, entry = '') {
  const directory = path.join(root, directoryName);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(metadata));
  if (entry !== null) fs.writeFileSync(path.join(directory, 'index.js'), entry);
  return directory;
}

test('lists valid first-level plugins without absolute paths or executing code', (t) => {
  const root = workspace(t);
  const marker = path.join(root, 'executed.txt');
  plugin(root, 'valid', manifest('com.example.valid'),
    `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed')`);
  fs.mkdirSync(path.join(root, 'nested'));
  plugin(path.join(root, 'nested'), 'ignored', manifest('com.example.ignored'));

  const result = createPluginManager({ pluginsRoot: root }).list();
  assert.deepEqual(result.plugins, [{ directoryName: 'valid', manifest: manifest('com.example.valid') }]);
  assert.deepEqual(result.invalidPlugins, [{ directoryName: 'nested', code: 'MANIFEST_NOT_FOUND', message: 'Plugin manifest cannot be read' }]);
  assert.equal(fs.existsSync(marker), false);
  assert.equal(JSON.stringify(result).includes(root), false);
});

test('one damaged manifest does not prevent scanning another plugin', (t) => {
  const root = workspace(t);
  plugin(root, 'valid', manifest('com.example.valid'));
  const broken = path.join(root, 'broken');
  fs.mkdirSync(broken);
  fs.writeFileSync(path.join(broken, 'manifest.json'), '{bad');
  assert.deepEqual(createPluginManager({ pluginsRoot: root }).scan().invalidPlugins.map((item) => item.code),
    ['MANIFEST_JSON_INVALID']);
});

test('rejects duplicate ids, escaping entries, and missing entries', (t) => {
  const root = workspace(t);
  plugin(root, 'alpha', manifest('com.example.duplicate'));
  plugin(root, 'beta', manifest('com.example.duplicate'));
  plugin(root, 'escape', manifest('com.example.escape', { main: '../outside.js' }), null);
  plugin(root, 'missing', manifest('com.example.missing'), null);
  const result = createPluginManager({ pluginsRoot: root }).scan();
  assert.deepEqual(result.invalidPlugins.map((item) => [item.directoryName, item.code]), [
    ['beta', 'PLUGIN_ID_DUPLICATE'],
    ['escape', 'PLUGIN_ENTRY_OUTSIDE_DIRECTORY'],
    ['missing', 'PLUGIN_ENTRY_NOT_FOUND'],
  ]);
});

test('rejects oversized manifests and entry symlinks outside the plugin directory', (t) => {
  const root = workspace(t);
  const oversized = plugin(root, 'oversized', manifest('com.example.oversized'));
  fs.writeFileSync(path.join(oversized, 'manifest.json'), ' '.repeat(256 * 1024 + 1));
  const outside = path.join(root, 'outside.js');
  fs.writeFileSync(outside, '');
  const linked = plugin(root, 'linked', manifest('com.example.linked'), null);
  try {
    fs.symlinkSync(outside, path.join(linked, 'index.js'));
  } catch (error) {
    if (error?.code === 'EPERM') return;
    throw error;
  }
  const result = createPluginManager({ pluginsRoot: root }).scan();
  assert.deepEqual(result.invalidPlugins.map((item) => [item.directoryName, item.code]), [
    ['linked', 'PLUGIN_ENTRY_OUTSIDE_DIRECTORY'],
    ['oversized', 'MANIFEST_TOO_LARGE'],
  ]);
});

test('returns empty lists when the plugins directory has not been created', (t) => {
  const root = path.join(workspace(t), 'absent');
  assert.deepEqual(createPluginManager({ pluginsRoot: root }).list(), { plugins: [], invalidPlugins: [] });
});

test('does not follow a symlinked manifest outside the plugin directory', (t) => {
  const root = workspace(t);
  const target = path.join(root, 'private.json');
  fs.writeFileSync(target, JSON.stringify(manifest('com.example.private')));
  const directory = path.join(root, 'linked-manifest');
  fs.mkdirSync(directory);
  try {
    fs.symlinkSync(target, path.join(directory, 'manifest.json'));
  } catch (error) {
    if (error?.code === 'EPERM') return;
    throw error;
  }
  const result = createPluginManager({ pluginsRoot: root }).scan();
  assert.equal(result.plugins.length, 0);
  assert.equal(result.invalidPlugins[0].code, 'MANIFEST_UNREADABLE');
});
