const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { MAX_STORAGE_VALUE_BYTES, createPluginStorage, removePluginStorage } = require('./pluginStorage');

test('isolates JSON storage by plugin id and returns cloned values', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-plugin-data-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const first = createPluginStorage({ dataRoot: root, pluginId: 'com.example.first' });
  const second = createPluginStorage({ dataRoot: root, pluginId: 'com.example.second' });
  const value = { tags: ['one'] };

  first.set('settings', value);
  value.tags.push('mutated');
  const stored = first.get('settings');
  stored.tags.push('local-only');

  assert.deepEqual(first.get('settings'), { tags: ['one'] });
  assert.equal(second.get('settings'), null);
  assert.equal(first.delete('settings'), true);
  assert.equal(first.get('settings'), null);
});

test('rejects invalid keys, non-JSON values, and oversized values', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-plugin-data-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const storage = createPluginStorage({ dataRoot: root, pluginId: 'com.example.quota' });

  assert.throws(() => storage.set('', true), { code: 'PLUGIN_STORAGE_KEY_INVALID' });
  assert.throws(() => storage.set('__proto__', { polluted: true }), { code: 'PLUGIN_STORAGE_KEY_INVALID' });
  assert.throws(() => storage.set('constructor', true), { code: 'PLUGIN_STORAGE_KEY_INVALID' });
  assert.throws(() => storage.set('cyclic', (() => { const value = {}; value.self = value; return value; })()), {
    code: 'PLUGIN_STORAGE_VALUE_INVALID',
  });
  assert.throws(() => storage.set('large', 'x'.repeat(MAX_STORAGE_VALUE_BYTES + 1)), {
    code: 'PLUGIN_STORAGE_VALUE_TOO_LARGE',
  });
});

test('round-trips own properties without inheriting Object.prototype keys', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-plugin-data-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const storage = createPluginStorage({ dataRoot: root, pluginId: 'com.example.proto' });

  assert.equal(storage.get('toString'), null);
  storage.set('toString', 'own-value');
  assert.equal(storage.get('toString'), 'own-value');
  assert.equal(createPluginStorage({ dataRoot: root, pluginId: 'com.example.proto' }).get('toString'), 'own-value');
});

test('reports damaged storage instead of overwriting it', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-plugin-data-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dataPath = path.join(root, 'com.example.damaged.json');
  fs.writeFileSync(dataPath, '{damaged');
  const storage = createPluginStorage({ dataRoot: root, pluginId: 'com.example.damaged' });

  assert.throws(() => storage.get('settings'), SyntaxError);
  assert.throws(() => storage.set('settings', true), SyntaxError);
  assert.equal(fs.readFileSync(dataPath, 'utf8'), '{damaged');
});

test('removePluginStorage deletes the isolated file and leftover temporary files', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-plugin-data-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const storage = createPluginStorage({ dataRoot: root, pluginId: 'com.example.removed' });
  storage.set('settings', { enabled: true });
  const leftover = path.join(root, `com.example.removed.json.${process.pid}.tmp`);
  fs.writeFileSync(leftover, '{}');

  assert.equal(removePluginStorage({ dataRoot: root, pluginId: 'com.example.removed' }), true);
  assert.equal(fs.existsSync(path.join(root, 'com.example.removed.json')), false);
  assert.equal(fs.existsSync(leftover), false);
  assert.equal(removePluginStorage({ dataRoot: root, pluginId: 'com.example.removed' }), true);
});

test('removePluginStorage still deletes leftover temporary files when the data file is missing', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-plugin-data-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const leftover = path.join(root, `com.example.orphan.json.${process.pid}.tmp`);
  fs.writeFileSync(leftover, '{}');

  assert.equal(removePluginStorage({ dataRoot: root, pluginId: 'com.example.orphan' }), true);
  assert.equal(fs.existsSync(leftover), false);
});
