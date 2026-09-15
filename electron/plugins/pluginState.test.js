const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createPluginStateStore } = require('./pluginState');

test('persists enabled state and granted permissions without runtime objects', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-plugin-state-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const statePath = path.join(directory, 'plugins-state.json');
  const store = createPluginStateStore(statePath);

  store.save({
    version: 1,
    plugins: {
      'com.example.exporter': {
        enabled: true,
        grantedPermissions: ['repositories:read'],
        runtime: { mustNotPersist: true },
      },
    },
  });

  assert.deepEqual(store.load(), {
    version: 2,
    searchEndpoint: null,
    plugins: {
      'com.example.exporter': {
        enabled: true,
        grantedPermissions: ['repositories:read'],
      },
    },
  });
  assert.equal(fs.readFileSync(statePath, 'utf8').includes('mustNotPersist'), false);
});

test('recovers with an empty state when the state file is damaged', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-plugin-state-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const statePath = path.join(directory, 'plugins-state.json');
  fs.writeFileSync(statePath, '{broken');

  assert.deepEqual(createPluginStateStore(statePath).load(), { version: 2, plugins: {}, searchEndpoint: null });
});

test('ignores invalid plugin ids from a tampered state file', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-plugin-state-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const statePath = path.join(directory, 'plugins-state.json');
  fs.writeFileSync(statePath, '{"version":1,"plugins":{"__proto__":{"enabled":true}}}');

  assert.deepEqual(createPluginStateStore(statePath).load(), { version: 2, plugins: {}, searchEndpoint: null });
});

test('migrates v1 plugin state without losing enabled plugins', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-plugin-state-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const statePath = path.join(directory, 'plugins-state.json');
  fs.writeFileSync(statePath, JSON.stringify({ version: 1, plugins: {
    'com.example.exporter': { enabled: true, grantedPermissions: ['repositories:read'] },
  } }));
  const state = createPluginStateStore(statePath).load();
  assert.equal(state.version, 2);
  assert.equal(state.searchEndpoint, null);
  assert.equal(state.plugins['com.example.exporter'].enabled, true);
});
