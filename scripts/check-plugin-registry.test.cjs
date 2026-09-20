'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { collectViolations } = require('./check-plugin-registry.cjs');

function withRegistry(community, removed, callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-plugin-registry-'));
  fs.mkdirSync(path.join(root, 'registry'));
  fs.writeFileSync(path.join(root, 'registry', 'community-plugins.json'), JSON.stringify(community));
  fs.writeFileSync(path.join(root, 'registry', 'removed-plugins.json'), JSON.stringify(removed));
  try {
    callback(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const entry = (overrides = {}) => ({
  id: 'com.example.plugin',
  version: '1.0.0',
  permissions: ['repositories:read'],
  networkTargets: [],
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

test('rejects overlapping version-specific removal records', () => {
  withRegistry([], [
    { id: 'com.example.plugin', versions: ['1.0.0'], action: 'block' },
    { id: 'com.example.plugin', versions: ['1.0.0'], action: 'revoke' },
  ], (root) => assert.match(collectViolations(root).join('\n'), /overlaps entry 0/));
});

test('rejects an all-version removal record combined with another record', () => {
  withRegistry([], [
    { id: 'com.example.plugin', versions: [], action: 'revoke' },
    { id: 'com.example.plugin', versions: ['2.0.0'], action: 'block' },
  ], (root) => assert.match(collectViolations(root).join('\n'), /overlaps entry 0/));
});
