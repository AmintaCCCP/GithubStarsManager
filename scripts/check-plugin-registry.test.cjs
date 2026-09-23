'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { collectViolations } = require('./check-plugin-registry.cjs');

function withRegistry(community, removed, callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-plugin-registry-'));
  fs.mkdirSync(path.join(root, 'registry', 'schemas'), { recursive: true });
  fs.writeFileSync(path.join(root, 'registry', 'community-plugins.json'), JSON.stringify(community));
  fs.writeFileSync(path.join(root, 'registry', 'removed-plugins.json'), JSON.stringify(removed));
  for (const name of ['community-plugin.schema.json', 'removed-plugin.schema.json']) {
    fs.copyFileSync(
      path.resolve(__dirname, '..', 'registry', 'schemas', name),
      path.join(root, 'registry', 'schemas', name),
    );
  }
  try {
    callback(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const entry = (overrides = {}) => ({
  id: 'com.example.plugin',
  version: '1.0.0',
  apiVersion: '1',
  source: 'https://github.com/example/plugin',
  releaseUrl: 'https://github.com/example/plugin/releases/download/v1.0.0/plugin.zip',
  sha256: 'a'.repeat(64),
  permissions: ['repositories:read'],
  networkTargets: [],
  dataUsage: 'Repository metadata stays on this device.',
  review: { status: 'approved', date: '2026-09-23', commit: 'b'.repeat(40) },
  ...overrides,
});

const removedEntry = (overrides = {}) => ({
  id: 'com.example.plugin',
  versions: ['1.0.0'],
  reason: 'This version is no longer safe to install.',
  date: '2026-09-23',
  action: 'block',
  ...overrides,
});

test('allows different versions and matching network declarations', () => {
  withRegistry([
    entry(),
    entry({ version: '1.1.0', permissions: ['network:api.example.com'], networkTargets: ['api.example.com'] }),
  ], [], (root) => assert.deepEqual(collectViolations(root), []));
});

test('rejects duplicate id and version pairs even when other fields differ', () => {
  withRegistry([entry(), entry({ permissions: ['storage'] })], [], (root) => {
    assert.match(collectViolations(root).join('\n'), /duplicate \(id, version\)/);
  });
});

test('requires networkTargets to exactly match network permissions', () => {
  withRegistry([
    entry({ permissions: ['network:api.example.com'], networkTargets: [] }),
    entry({ id: 'com.example.other', networkTargets: ['unused.example.com'] }),
  ], [], (root) => {
    const violations = collectViolations(root);
    assert.equal(violations.filter((item) => item.includes('networkTargets')).length, 2);
  });
});

test('validates each community and removal record against its schema', () => {
  withRegistry([
    { id: 'com.example.plugin', version: '1.0.0', permissions: [], networkTargets: [] },
  ], [
    { id: 'com.example.plugin', versions: [], action: 'revoke' },
  ], (root) => {
    const violations = collectViolations(root).join('\n');
    assert.match(violations, /community-plugins\.json.*required property 'apiVersion'/);
    assert.match(violations, /removed-plugins\.json.*required property 'reason'/);
  });
});

test('rejects overlapping version-specific removal records', () => {
  withRegistry([], [
    removedEntry(),
    removedEntry({ action: 'revoke' }),
  ], (root) => assert.match(collectViolations(root).join('\n'), /overlaps entry 0/));
});

test('rejects an all-version removal record combined with another record', () => {
  withRegistry([], [
    removedEntry({ versions: [], action: 'revoke' }),
    removedEntry({ versions: ['2.0.0'] }),
  ], (root) => assert.match(collectViolations(root).join('\n'), /overlaps entry 0/));
});
