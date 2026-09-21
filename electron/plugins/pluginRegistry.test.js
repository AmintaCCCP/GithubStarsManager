'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  validateList,
  validateRegistryEntry,
  validateRemovedEntry,
} = require('./pluginRegistrySchema');
const { compareVersions, loadPluginRegistry } = require('./pluginRegistryFeed');

const approvedEntry = (overrides = {}) => ({
  id: 'com.example.repo-health',
  version: '1.2.0',
  apiVersion: '1',
  source: 'https://github.com/example/plugin',
  releaseUrl: 'https://github.com/example/plugin/releases/download/v1.2.0/plugin.zip',
  sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  permissions: ['repositories:read', 'storage'],
  networkTargets: [],
  dataUsage: '只读取本地已收藏仓库的元数据用于计算健康分，不外发。',
  review: { status: 'approved', date: '2026-09-21', commit: '0123456789abcdef0123456789abcdef01234567' },
  ...overrides,
});

test('accepts a well-formed registry entry', () => {
  const result = validateRegistryEntry(approvedEntry());
  assert.equal(result.ok, true);
  assert.equal(result.value.id, 'com.example.repo-health');
  assert.deepEqual(result.value.permissions, ['repositories:read', 'storage']);
});

test('rejects entries that could not be installed safely', () => {
  const cases = [
    [{ id: 'bad id!' }, 'REGISTRY_ID_INVALID'],
    [{ version: 'v1.2' }, 'REGISTRY_VERSION_INVALID'],
    [{ apiVersion: '2' }, 'REGISTRY_API_VERSION_UNSUPPORTED'],
    [{ source: 'https://gitlab.com/example/plugin' }, 'REGISTRY_SOURCE_INVALID'],
    [{ releaseUrl: 'https://github.com.evil.example/plugin.zip' }, 'REGISTRY_RELEASE_URL_INVALID'],
    [{ sha256: 'ABC' }, 'REGISTRY_SHA256_INVALID'],
    [{ permissions: ['repositories:read', 'filesystem:write'] }, 'REGISTRY_PERMISSIONS_INVALID'],
    [{ networkTargets: ['https://evil.example'] }, 'REGISTRY_NETWORK_TARGETS_INVALID'],
    [{ dataUsage: 'short' }, 'REGISTRY_DATA_USAGE_INVALID'],
    [{ review: { status: 'pending', date: '2026-09-21', commit: 'x'.repeat(40) } }, 'REGISTRY_REVIEW_INVALID'],
  ];
  for (const [overrides, code] of cases) {
    const result = validateRegistryEntry(approvedEntry(overrides));
    assert.equal(result.ok, false, `expected ${code}`);
    assert.equal(result.code, code);
  }
  assert.equal(validateRegistryEntry('nope').ok, false);
  assert.equal(validateRegistryEntry(null).ok, false);
});

test('validates removal entries and their action', () => {
  assert.equal(validateRemovedEntry({
    id: 'com.example.bad', versions: ['1.0.0'], reason: '未声明就向第三方发送仓库列表', date: '2026-09-21', action: 'revoke',
  }).ok, true);
  assert.equal(validateRemovedEntry({
    id: 'com.example.bad', versions: [], reason: '未声明就向第三方发送仓库列表', date: '2026-09-21', action: 'delete',
  }).code, 'REGISTRY_ACTION_INVALID');
});

test('drops only the bad entries when validating a list', () => {
  const result = validateList([approvedEntry(), { id: 'broken' }, approvedEntry({ id: 'com.example.other' })], validateRegistryEntry);
  assert.equal(result.accepted.length, 2);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].index, 1);
  assert.equal(validateList('nope', validateRegistryEntry).rejected[0].code, 'REGISTRY_NOT_ARRAY');
});

test('compares semantic versions and orders prereleases before releases', () => {
  assert.equal(compareVersions('1.2.0', '1.2.0'), 0);
  assert.equal(compareVersions('1.3.0', '1.2.9'), 1);
  assert.equal(compareVersions('1.2.0', '1.3.0'), -1);
  assert.equal(compareVersions('1.0.0-beta.2', '1.0.0'), -1);
  assert.equal(compareVersions('1.0.0', '1.0.0-beta.2'), 1);
  assert.equal(compareVersions('1.0.0-beta.2', '1.0.0-beta.10'), -1);
  assert.equal(compareVersions('1.10.0+build.1', '1.9.0'), 1);
  assert.equal(compareVersions('1.0.0+build.1', '1.0.0+build.2'), 0);
  assert.equal(compareVersions('1.2.0garbage', '1.2.0'), 1);
});

test('loads, validates and groups the registry, newest version first', async () => {
  const fetchImpl = async (url) => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(url.endsWith('community-plugins.json')
      ? [approvedEntry({ version: '1.0.0' }), approvedEntry({ version: '1.2.0' }), { id: 'broken' }]
      : [{ id: 'com.example.bad', versions: ['1.0.0'], reason: '向第三方发送了仓库列表', date: '2026-09-21', action: 'revoke' }]),
  });

  const result = await loadPluginRegistry({ fetchImpl });

  assert.equal(result.success, true);
  assert.equal(result.registry.plugins.length, 1);
  assert.deepEqual(result.registry.plugins[0].versions.map((entry) => entry.version), ['1.2.0', '1.0.0']);
  assert.equal(result.registry.removed[0].action, 'revoke');
  assert.equal(result.registry.rejected.length, 1);
});

test('preserves multiple removal records for the same plugin', async () => {
  const fetchImpl = async (url) => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(url.endsWith('community-plugins.json') ? [] : [
      { id: 'com.example.bad', versions: ['1.0.0'], reason: 'Version 1.0.0 has a security issue', date: '2026-09-20', action: 'block' },
      { id: 'com.example.bad', versions: ['2.0.0'], reason: 'Version 2.0.0 leaked repository data', date: '2026-09-21', action: 'revoke' },
    ]),
  });

  const result = await loadPluginRegistry({ fetchImpl });

  assert.equal(result.success, true);
  assert.equal(result.registry.removed.length, 2);
  assert.deepEqual(result.registry.removed.map((entry) => entry.versions[0]), ['1.0.0', '2.0.0']);
});

test('still returns the half that loaded when one file fails', async () => {
  const fetchImpl = async (url) => (url.endsWith('community-plugins.json')
    ? { ok: true, status: 200, text: async () => JSON.stringify([approvedEntry()]) }
    : { ok: false, status: 404, text: async () => '' });

  const result = await loadPluginRegistry({ fetchImpl });

  assert.equal(result.success, true);
  assert.equal(result.registry.plugins.length, 1);
  assert.equal(result.registry.removed.length, 0);
  assert.equal(result.registry.rejected[0].code, 'REGISTRY_HTTP_ERROR');
  assert.equal(result.registry.error.code, 'REGISTRY_HTTP_ERROR');
});

test('fails cleanly when nothing can be read', async () => {
  const failing = async () => { throw new Error('offline'); };
  const result = await loadPluginRegistry({ fetchImpl: failing });
  assert.equal(result.success, false);
  assert.equal(result.error.code, 'REGISTRY_UNREACHABLE');

  const notJson = async () => ({ ok: true, status: 200, text: async () => 'not json' });
  const second = await loadPluginRegistry({ fetchImpl: notJson });
  assert.equal(second.success, false);
  assert.equal(second.error.code, 'REGISTRY_JSON_INVALID');

  assert.equal((await loadPluginRegistry({})).error.code, 'REGISTRY_FETCH_UNAVAILABLE');
});

test('refuses an oversized registry body', async () => {
  const huge = async () => ({ ok: true, status: 200, text: async () => 'x'.repeat(4 * 1024 * 1024 + 1) });
  const result = await loadPluginRegistry({ fetchImpl: huge });
  assert.equal(result.success, false);
  assert.equal(result.error.code, 'REGISTRY_TOO_LARGE');
});

test('counts UTF-8 bytes when a response has no readable stream', async () => {
  const huge = async () => ({ ok: true, status: 200, text: async () => '界'.repeat(1_500_000) });
  const result = await loadPluginRegistry({ fetchImpl: huge });
  assert.equal(result.success, false);
  assert.equal(result.error.code, 'REGISTRY_TOO_LARGE');
});

test('stops reading a streamed response once the byte limit is exceeded', async () => {
  let cancelCount = 0;
  const streamed = async () => {
    let readCount = 0;
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: {
        getReader: () => ({
          read: async () => {
            readCount += 1;
            return { done: false, value: Buffer.alloc(readCount === 1 ? 3 * 1024 * 1024 : 2 * 1024 * 1024) };
          },
          cancel: async () => { cancelCount += 1; },
          releaseLock: () => undefined,
        }),
      },
      text: async () => { throw new Error('full-buffer fallback should not run'); },
    };
  };

  const result = await loadPluginRegistry({ fetchImpl: streamed });
  assert.equal(result.success, false);
  assert.equal(result.error.code, 'REGISTRY_TOO_LARGE');
  assert.equal(cancelCount, 2);
});

test('aborts a stalled feed independently and returns the other feed', async () => {
  const fetchImpl = async (url, options) => {
    if (url.endsWith('community-plugins.json')) {
      return { ok: true, status: 200, text: async () => JSON.stringify([approvedEntry()]) };
    }
    return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
  };

  const result = await loadPluginRegistry({ fetchImpl, requestTimeoutMs: 5 });
  assert.equal(result.success, true);
  assert.equal(result.registry.plugins.length, 1);
  assert.equal(result.registry.error.code, 'REGISTRY_TIMEOUT');
});
