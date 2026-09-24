import { describe, expect, it } from 'vitest';
import {
  assessInstalledPlugins,
  comparePluginVersions,
  pickInstallableEntry,
} from './pluginRegistryStatus';
import type { PluginRegistry, PluginRegistryEntry } from '../services/pluginRegistryService';

const entry = (overrides: Partial<PluginRegistryEntry> = {}): PluginRegistryEntry => ({
  id: 'com.example.health',
  version: '1.3.0',
  apiVersion: '1',
  source: 'https://github.com/example/health',
  releaseUrl: 'https://github.com/example/health/releases/download/v1.3.0/health.zip',
  sha256: 'a'.repeat(64),
  permissions: ['repositories:read'],
  networkTargets: [],
  dataUsage: '只读本地仓库元数据，不外发。',
  review: { status: 'approved', date: '2026-09-21', commit: 'b'.repeat(40) },
  ...overrides,
});

const registry = (overrides: Partial<PluginRegistry> = {}): PluginRegistry => ({
  fetchedAt: '2026-09-21T04:00:00.000Z',
  plugins: [{ id: 'com.example.health', versions: [entry()] }],
  removed: [],
  rejected: [],
  error: null,
  ...overrides,
});

describe('comparePluginVersions', () => {
  it('orders releases and prereleases like semver', () => {
    expect(comparePluginVersions('1.2.0', '1.2.0')).toBe(0);
    expect(comparePluginVersions('1.3.0', '1.2.9')).toBe(1);
    expect(comparePluginVersions('1.0.0-beta.2', '1.0.0')).toBe(-1);
    expect(comparePluginVersions('1.0.0-beta.10', '1.0.0-beta.2')).toBe(1);
    expect(comparePluginVersions('1.10.0+build.1', '1.9.0')).toBe(1);
    expect(comparePluginVersions('1.0.0+build.1', '1.0.0+build.2')).toBe(0);
    expect(Number.isNaN(comparePluginVersions('1.2.0garbage', '1.2.0'))).toBe(true);
    expect(comparePluginVersions('9007199254740993.0.0', '9007199254740992.0.0')).toBe(1);
    expect(comparePluginVersions('1.0.0-beta.9007199254740993', '1.0.0-beta.9007199254740992')).toBe(1);
    expect(comparePluginVersions('1.0.0-beta.01.2', '1.0.0-beta.1.3')).toBe(-1);
  });
});

describe('pickInstallableEntry', () => {
  it('takes the highest version the client supports, not the newest in the registry', () => {
    const picked = pickInstallableEntry([
      entry({ version: '2.0.0', apiVersion: '2' }),
      entry({ version: '1.1.0' }),
      entry({ version: '1.4.0' }),
    ]);
    expect(picked?.version).toBe('1.4.0');
  });

  it('returns null when nothing is compatible', () => {
    expect(pickInstallableEntry([entry({ apiVersion: '9' })])).toBeNull();
  });
});

describe('assessInstalledPlugins', () => {
  it('reports an update with the permissions the new version would need', () => {
    const [assessment] = assessInstalledPlugins(
      [{ id: 'com.example.health', version: '1.0.0', grantedPermissions: ['storage'] }],
      registry({ plugins: [{ id: 'com.example.health', versions: [entry({ permissions: ['storage', 'repositories:read'] })] }] }),
    );

    expect(assessment).toMatchObject({
      status: 'update-available',
      latestVersion: '1.3.0',
      permissionDiff: { added: ['repositories:read'], removed: [] },
      reason: null,
    });
    expect(assessment.dataUsage).toContain('不外发');
  });

  it('marks up-to-date plugins and reports no permission diff', () => {
    const [assessment] = assessInstalledPlugins(
      [{ id: 'com.example.health', version: '1.3.0', grantedPermissions: ['repositories:read'] }],
      registry(),
    );

    expect(assessment.status).toBe('up-to-date');
    expect(assessment.permissionDiff).toEqual({ added: [], removed: [] });
  });

  it('does not claim an update result for an installed version that cannot be compared', () => {
    const [assessment] = assessInstalledPlugins(
      [{ id: 'com.example.health', version: '1.9' }],
      registry({ plugins: [{ id: 'com.example.health', versions: [entry({ version: '1.10.0' })] }] }),
    );

    expect(assessment).toMatchObject({ status: 'version-unknown', latestVersion: '1.10.0' });
  });

  it('flags revoked and blocked versions with the reason, before any update check', () => {
    const removed = [
      { id: 'com.example.health', versions: ['1.0.0'], reason: '未声明就向第三方发送了仓库列表', date: '2026-09-21', action: 'revoke' as const },
    ];
    const [revoked] = assessInstalledPlugins(
      [{ id: 'com.example.health', version: '1.0.0', grantedPermissions: [] }],
      registry({ removed }),
    );
    expect(revoked).toMatchObject({ status: 'revoked', reason: '未声明就向第三方发送了仓库列表', removedAction: 'revoke' });
    expect(revoked.latestVersion).toBeNull();

    // 撤销表里只列了 1.0.0，装的是 1.3.0 就不该被牵连
    const [untouched] = assessInstalledPlugins(
      [{ id: 'com.example.health', version: '1.3.0', grantedPermissions: [] }],
      registry({ removed }),
    );
    expect(untouched.status).toBe('up-to-date');
  });

  it('treats an empty version list as "every version of this plugin"', () => {
    const [assessment] = assessInstalledPlugins(
      [{ id: 'com.example.health', version: '9.9.9', grantedPermissions: [] }],
      registry({ removed: [{ id: 'com.example.health', versions: [], reason: '整包恶意，所有版本都撤销', date: '2026-09-21', action: 'block' }] }),
    );
    expect(assessment).toMatchObject({ status: 'blocked', removedAction: 'block' });
  });

  it('checks every matching removal record and prioritizes revoke over block', () => {
    const [assessment] = assessInstalledPlugins(
      [{ id: 'com.example.health', version: '1.0.0', grantedPermissions: [] }],
      registry({
        removed: [
          { id: 'com.example.health', versions: ['2.0.0'], reason: 'Only version 2 is blocked here', date: '2026-09-22', action: 'block' },
          { id: 'com.example.health', versions: [], reason: 'All versions are blocked pending review', date: '2026-09-21', action: 'block' },
          { id: 'com.example.health', versions: ['1.0.0'], reason: 'Version 1 must be revoked immediately', date: '2026-09-20', action: 'revoke' },
        ],
      }),
    );

    expect(assessment).toMatchObject({
      status: 'revoked',
      removedAction: 'revoke',
      reason: 'Version 1 must be revoked immediately',
    });
  });

  it('leaves locally installed plugins that are not in the registry alone', () => {
    const [assessment] = assessInstalledPlugins(
      [{ id: 'com.local.mine', version: '0.1.0', declaredPermissions: ['storage'] }],
      registry(),
    );
    expect(assessment).toMatchObject({ status: 'not-in-registry', latestVersion: null });
  });

  it('degrades to "not-in-registry" without a registry instead of guessing', () => {
    const [assessment] = assessInstalledPlugins([{ id: 'com.example.health', version: '1.0.0' }], null);
    expect(assessment.status).toBe('not-in-registry');
  });
});
