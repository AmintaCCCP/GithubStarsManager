const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { MAX_STORAGE_VALUE_BYTES, createPluginStorage } = require('./pluginStorage');

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
  assert.throws(() => storage.set('cyclic', (() => { const value = {}; value.self = value; return value; })()), {
    code: 'PLUGIN_STORAGE_VALUE_INVALID',
  });
  assert.throws(() => storage.set('large', 'x'.repeat(MAX_STORAGE_VALUE_BYTES + 1)), {
    code: 'PLUGIN_STORAGE_VALUE_TOO_LARGE',
  });
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
