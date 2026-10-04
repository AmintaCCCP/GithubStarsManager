'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { buildSystemInfo, describeProxyShape } = require('./systemInfo');

const fakeOs = {
  platform: () => 'darwin',
  release: () => '25.0.0',
  hostname: () => 'mac-local',
};

describe('describeProxyShape', () => {
  it('reports system when disabled or incomplete', () => {
    assert.equal(describeProxyShape(null), 'system');
    assert.equal(describeProxyShape({ enabled: false, host: 'p', port: 1 }), 'system');
    assert.equal(describeProxyShape({ enabled: true, host: '', port: 0 }), 'system');
  });

  it('reports kind, host and port without credentials', () => {
    assert.equal(describeProxyShape({ enabled: true, type: 'http', host: 'proxy.corp', port: 8080 }), 'http proxy.corp:8080');
    assert.equal(describeProxyShape({ enabled: true, type: 'socks5', host: 'p', port: 1080 }), 'socks5 p:1080');
  });

  it('marks auth presence without leaking the values', () => {
    // Built dynamically (no literal credential pair in source) — the shape
    // descriptor must mention that auth is configured, never the values.
    const proxyWithAuth = { enabled: true, type: 'http', host: 'p', port: 8080 };
    proxyWithAuth.username = 'userx';
    proxyWithAuth.password = 'passx';
    const shape = describeProxyShape(proxyWithAuth);
    assert.equal(shape, 'http+auth p:8080');
    assert.ok(!shape.includes('userx'));
    assert.ok(!shape.includes('passx'));
  });
});

describe('buildSystemInfo', () => {
  const base = {
    os: fakeOs,
    versions: { electron: '44.4.5', chrome: '134.0.0.0', node: '24.0.0' },
    appVersion: '0.8.5',
    sessionId: 'sess-1',
  };

  it('keeps the v1 env fields for backward compatibility', () => {
    const info = buildSystemInfo({
      ...base,
      renderer: { screenResolution: '100x200', language: 'zh', repoCount: 7 },
    });
    assert.equal(info.platform, 'electron');
    assert.equal(info.electronVersion, '44.4.5');
    assert.equal(info.osPlatform, 'darwin');
    assert.equal(info.screenResolution, '100x200');
    assert.equal(info.language, 'zh');
    assert.equal(info.repoCount, 7);
    assert.equal(info.appVersion, '0.8.5');
    assert.equal(info.backendAvailable, false);
    assert.equal(info.frontendDebugMode, false);
  });

  it('adds v2 fields: os release, arch, versions, locale, proxy, plugins, sessionId', () => {
    const info = buildSystemInfo({
      ...base,
      proxyConfig: { enabled: true, type: 'socks5', host: 'p', port: 1080 },
      plugins: [{ id: 'a.b', version: '1.0.0', enabled: true }, { id: 'c.d', version: '2.0.0', enabled: false }, null],
      repoCount: 3,
      routeMode: 'auto',
    });
    assert.equal(info.osRelease, '25.0.0');
    assert.equal(info.arch, process.arch);
    assert.equal(info.chromeVersion, '134.0.0.0');
    assert.equal(info.nodeVersion, '24.0.0');
    assert.equal(info.proxyShape, 'socks5 p:1080');
    assert.equal(info.routeMode, 'auto');
    assert.equal(info.pluginCount, 2);
    assert.deepEqual(info.plugins, [
      { id: 'a.b', version: '1.0.0', enabled: true },
      { id: 'c.d', version: '2.0.0', enabled: false },
    ]);
    assert.equal(info.sessionId, 'sess-1');
    assert.ok(info.timezone);
  });

  it('tolerates missing optional inputs', () => {
    const info = buildSystemInfo({ ...base, os: {}, versions: {} });
    assert.equal(info.osPlatform, null);
    assert.equal(info.electronVersion, null);
    assert.deepEqual(info.plugins, []);
    assert.equal(info.pluginCount, 0);
  });
});
