'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { validateManifest } = require('./manifestSchema');

function manifest(overrides = {}) {
  return {
    manifestVersion: 1,
    apiVersion: '1',
    id: 'com.example.sample',
    name: 'Sample',
    version: '1.0.0',
    main: 'index.js',
    permissions: [],
    contributes: {},
    ...overrides,
  };
}

test('accepts the minimal manifest and returns serializable metadata', () => {
  const input = manifest();
  const result = validateManifest(input);
  assert.equal(result.success, true);
  assert.deepEqual(result.data, input);
  assert.notEqual(result.data, input);
});

test('rejects missing, malformed, and unknown fields with stable codes', () => {
  const missing = manifest();
  delete missing.name;
  assert.equal(validateManifest(missing).code, 'MANIFEST_FIELD_REQUIRED');
  assert.equal(validateManifest(manifest({ name: 3 })).code, 'MANIFEST_FIELD_INVALID');
  assert.equal(validateManifest(manifest({ surprise: true })).code, 'MANIFEST_UNKNOWN_FIELD');
  assert.equal(validateManifest(manifest({ contributes: { pages: [] } })).code, 'MANIFEST_UNKNOWN_FIELD');
  assert.equal(validateManifest(manifest({ contributes: { constructor: [] } })).code, 'MANIFEST_UNKNOWN_FIELD');
  assert.equal(validateManifest(null).code, 'MANIFEST_FIELD_INVALID');
});

test('rejects incompatible versions and malformed identifiers', () => {
  assert.equal(validateManifest(manifest({ manifestVersion: 2 })).code, 'MANIFEST_VERSION_UNSUPPORTED');
  assert.equal(validateManifest(manifest({ apiVersion: '2' })).code, 'PLUGIN_API_VERSION_UNSUPPORTED');
  assert.equal(validateManifest(manifest({ id: '../escape' })).code, 'MANIFEST_FIELD_INVALID');
  assert.equal(validateManifest(manifest({ version: 'latest' })).code, 'MANIFEST_FIELD_INVALID');
});

test('accepts only declared, unique permissions', () => {
  assert.equal(validateManifest(manifest({ permissions: ['repositories:read'] })).success, true);
  assert.equal(validateManifest(manifest({ permissions: ['network:example.com'] })).code, 'MANIFEST_PERMISSION_UNKNOWN');
  assert.equal(validateManifest(manifest({ permissions: ['storage', 'storage'] })).code, 'MANIFEST_FIELD_INVALID');
});

test('validates contribution metadata without running an extension', () => {
  const actions = { repositoryActions: [{ id: 'copy-markdown', title: 'Copy Markdown', placement: 'bulk-toolbar' }] };
  assert.equal(validateManifest(manifest({ permissions: ['repositories:read'], contributes: actions })).success, true);
  assert.equal(validateManifest(manifest({ contributes: actions })).code, 'MANIFEST_PERMISSION_REQUIRED');
  assert.equal(validateManifest(manifest({ permissions: ['repositories:read'], contributes: {
    repositoryActions: [{ ...actions.repositoryActions[0], unknown: true }],
  } })).code, 'MANIFEST_UNKNOWN_FIELD');
  assert.equal(validateManifest(manifest({ permissions: ['repositories:read'], contributes: {
    repositoryActions: [actions.repositoryActions[0], actions.repositoryActions[0]],
  } })).code, 'MANIFEST_FIELD_INVALID');
});
