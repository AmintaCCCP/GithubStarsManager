import { describe, expect, it } from 'vitest';
import {
  buildRepositorySourceUrl,
  compareParsedVersions,
  compareVersionStrings,
  createLinkedApplication,
  dedupeLinkedApplications,
  detectPlatformFromUserAgent,
  isPrereleaseVersion,
  normalizeLinkedApplication,
  normalizeLinkedApplications,
  normalizeRepositorySourceUrl,
  parseVersion,
  repositoryFullNameKey,
  resolveLinkedApplicationUpdateStatus,
  selectLatestRelease,
} from './linkedApplications';
import type { LinkedApplication } from '../types/linkedApplication';

const makeApplication = (overrides: Partial<LinkedApplication> = {}): LinkedApplication => ({
  id: 'app-1',
  repositoryFullName: 'owner/tool',
  displayName: 'Tool',
  installedVersion: '1.0.0',
  platform: 'windows',
  linkSource: 'manual',
  includePrereleases: false,
  repositorySourceUrl: 'https://github.com/owner/tool',
  linkedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('parseVersion', () => {
  it('parses plain, v-prefixed, and shortened tags', () => {
    expect(parseVersion('1.2.3')).toMatchObject({ major: 1, minor: 2, patch: 3, prerelease: [] });
    expect(parseVersion('v1.2.3')).toMatchObject({ major: 1, minor: 2, patch: 3 });
    expect(parseVersion('  V2.0  ')).toMatchObject({ major: 2, minor: 0, patch: 0 });
    expect(parseVersion('v3')).toMatchObject({ major: 3, minor: 0, patch: 0 });
  });

  it('keeps the prerelease identifiers of a semver tag', () => {
    expect(parseVersion('1.0.0-beta.1')?.prerelease).toEqual(['beta', '1']);
    expect(parseVersion('v1.0.0-rc.2')?.prerelease).toEqual(['rc', '2']);
    expect(isPrereleaseVersion('1.0.0-beta.1')).toBe(true);
    expect(isPrereleaseVersion('1.0.0')).toBe(false);
  });

  it('drops build metadata instead of treating it as a prerelease', () => {
    expect(parseVersion('1.0.0+build.7')).toMatchObject({ prerelease: [] });
    expect(isPrereleaseVersion('1.0.0+build.7')).toBe(false);
  });

  it('returns null instead of throwing for unparsable tags', () => {
    for (const tag of ['nightly-2026-01-01', 'release-1.2.3', 'presto', '', '   ', 'latest', null, undefined]) {
      expect(parseVersion(tag as string | null | undefined)).toBeNull();
    }
    expect(parseVersion('999999999999999999999.0.0')).toBeNull();
  });
});

describe('compareVersionStrings', () => {
  it('compares numerically, not lexically', () => {
    expect(compareVersionStrings('1.10.0', '1.9.0')).toBe(1);
    expect(compareVersionStrings('v1.2.3', '1.2.3')).toBe(0);
    expect(compareVersionStrings('2.0.0', 'v10.0.0')).toBe(-1);
  });

  it('orders prereleases below the matching stable release', () => {
    expect(compareVersionStrings('1.0.0-beta.1', '1.0.0')).toBe(-1);
    expect(compareVersionStrings('1.0.0', '1.0.0-beta.1')).toBe(1);
    expect(compareVersionStrings('1.0.0-alpha', '1.0.0-beta')).toBe(-1);
    expect(compareVersionStrings('1.0.0-beta.2', '1.0.0-beta.10')).toBe(-1);
  });

  it('returns null when either side cannot be parsed', () => {
    expect(compareVersionStrings('nightly', '1.0.0')).toBeNull();
    expect(compareVersionStrings('1.0.0', null)).toBeNull();
  });
});

describe('compareParsedVersions', () => {
  it('treats a longer prerelease chain as higher when the prefix matches', () => {
    const beta = parseVersion('1.0.0-beta')!;
    const betaOne = parseVersion('1.0.0-beta.1')!;
    expect(compareParsedVersions(beta, betaOne)).toBe(-1);
    expect(compareParsedVersions(betaOne, beta)).toBe(1);
  });

  it('compares very long numeric prerelease identifiers without precision loss', () => {
    const lower = parseVersion('1.0.0-beta.999999999999999999998')!;
    const higher = parseVersion('1.0.0-beta.999999999999999999999')!;
    expect(compareParsedVersions(lower, higher)).toBe(-1);
  });
});

describe('selectLatestRelease', () => {
  const stable = { tag_name: 'v1.9.0', published_at: '2026-01-01T00:00:00.000Z', prerelease: false };
  const newerPrerelease = { tag_name: 'v2.0.0-beta.1', published_at: '2026-02-01T00:00:00.000Z', prerelease: true };
  const oddStable = { tag_name: 'v1.10.0', published_at: '2025-12-01T00:00:00.000Z', prerelease: false };

  it('ignores prereleases unless they are opted in', () => {
    expect(selectLatestRelease([stable, newerPrerelease], false)).toEqual(stable);
    expect(selectLatestRelease([stable, newerPrerelease], true)).toEqual(newerPrerelease);
  });

  it('sorts by version rather than publish date', () => {
    expect(selectLatestRelease([oddStable, stable], false)).toEqual(oddStable);
  });

  it('also ignores prereleases that only say so in the tag', () => {
    const tagOnlyPrerelease = { tag_name: 'v3.0.0-rc.1', published_at: '2026-03-01T00:00:00.000Z' };
    expect(selectLatestRelease([stable, tagOnlyPrerelease], false)).toEqual(stable);
    const semanticPrerelease = { tag_name: 'v3.0.0-experimental.1', published_at: '2026-04-01T00:00:00.000Z' };
    expect(selectLatestRelease([stable, semanticPrerelease], false)).toEqual(stable);
  });

  it('ranks parseable versions ahead of unparseable tags consistently', () => {
    const latestVersion = { tag_name: 'v2.0.0', published_at: '2025-01-01T00:00:00.000Z' };
    const olderVersion = { tag_name: 'v1.0.0', published_at: '2027-01-01T00:00:00.000Z' };
    const nightly = { tag_name: 'nightly', published_at: '2026-01-01T00:00:00.000Z' };

    expect(selectLatestRelease([latestVersion, nightly, olderVersion], true)).toEqual(latestVersion);
    expect(selectLatestRelease([nightly, olderVersion, latestVersion], true)).toEqual(latestVersion);
  });

  it('returns null for empty input', () => {
    expect(selectLatestRelease([], false)).toBeNull();
    expect(selectLatestRelease(undefined, true)).toBeNull();
  });
});

describe('resolveLinkedApplicationUpdateStatus', () => {
  const stable = { tag_name: 'v1.2.0', published_at: '2026-01-01T00:00:00.000Z', prerelease: false };

  it('reports an available update when the release is newer', () => {
    expect(resolveLinkedApplicationUpdateStatus({
      installedVersion: '1.1.0',
      latestRelease: stable,
      includePrereleases: false,
    })).toBe('update-available');
  });

  it('reports up to date for equal or older releases', () => {
    expect(resolveLinkedApplicationUpdateStatus({
      installedVersion: 'v1.2.0',
      latestRelease: stable,
      includePrereleases: false,
    })).toBe('up-to-date');
    expect(resolveLinkedApplicationUpdateStatus({
      installedVersion: '1.3.0',
      latestRelease: stable,
      includePrereleases: false,
    })).toBe('up-to-date');
  });

  it('stays unknown when the installed version or the tag cannot be parsed', () => {
    expect(resolveLinkedApplicationUpdateStatus({
      installedVersion: null,
      latestRelease: stable,
      includePrereleases: false,
    })).toBe('unknown');
    expect(resolveLinkedApplicationUpdateStatus({
      installedVersion: 'nightly-2026-01-01',
      latestRelease: stable,
      includePrereleases: false,
    })).toBe('unknown');
    expect(resolveLinkedApplicationUpdateStatus({
      installedVersion: '1.0.0',
      latestRelease: { tag_name: 'nightly', published_at: '2026-01-01T00:00:00.000Z' },
      includePrereleases: false,
    })).toBe('unknown');
  });

  it('does not claim up-to-date from a release it was told to ignore', () => {
    expect(resolveLinkedApplicationUpdateStatus({
      installedVersion: '1.0.0',
      latestRelease: { tag_name: 'v2.0.0-beta.1', published_at: '2026-01-01T00:00:00.000Z', prerelease: true },
      includePrereleases: false,
    })).toBe('unknown');
    expect(resolveLinkedApplicationUpdateStatus({
      installedVersion: '1.0.0',
      latestRelease: { tag_name: 'v2.0.0-beta.1', published_at: '2026-01-01T00:00:00.000Z', prerelease: true },
      includePrereleases: true,
    })).toBe('update-available');
    expect(resolveLinkedApplicationUpdateStatus({
      installedVersion: '1.0.0',
      latestRelease: { tag_name: 'v2.0.0-experimental.1', published_at: '2026-01-01T00:00:00.000Z' },
      includePrereleases: false,
    })).toBe('unknown');
  });

  it('stays unknown without any release data', () => {
    expect(resolveLinkedApplicationUpdateStatus({
      installedVersion: '1.0.0',
      latestRelease: null,
      includePrereleases: true,
    })).toBe('unknown');
  });
});

describe('dedupeLinkedApplications', () => {
  it('keeps the first record per repository, comparing names case-insensitively', () => {
    const first = makeApplication({ id: 'first', repositoryFullName: 'Owner/Tool' });
    const duplicate = makeApplication({ id: 'duplicate', repositoryFullName: 'owner/tool' });
    const other = makeApplication({ id: 'other', repositoryFullName: 'owner/other-tool' });

    expect(dedupeLinkedApplications([first, duplicate, other]).map((app) => app.id)).toEqual(['first', 'other']);
  });

  it('drops records without a repository name', () => {
    expect(dedupeLinkedApplications([makeApplication({ repositoryFullName: '  ' })])).toEqual([]);
  });
});

describe('normalizeLinkedApplications', () => {
  it('returns an empty array for non-array input', () => {
    expect(normalizeLinkedApplications(undefined)).toEqual([]);
    expect(normalizeLinkedApplications({ id: 'x' })).toEqual([]);
  });

  it('drops records without an id or repository name and fills defaults', () => {
    const normalized = normalizeLinkedApplications([
      { repositoryFullName: 'owner/no-id' },
      { id: 'no-repo' },
      { id: 'valid', repositoryFullName: 'owner/tool' },
    ]);

    expect(normalized).toEqual([
      expect.objectContaining({
        id: 'valid',
        repositoryFullName: 'owner/tool',
        displayName: 'tool',
        installedVersion: null,
        platform: 'unknown',
        linkSource: 'manual',
        // 缺失该字段时默认只跟踪稳定版
        includePrereleases: false,
        repositorySourceUrl: 'https://github.com/owner/tool',
        linkedAt: '',
      }),
    ]);
  });

  it('is idempotent', () => {
    const once = normalizeLinkedApplications([
      {
        id: 'valid',
        repositoryFullName: 'owner/tool',
        displayName: '  Tool  ',
        installedVersion: ' 1.2.3 ',
        platform: 'macos',
        architecture: 'arm64',
        linkSource: 'manual',
        includePrereleases: false,
        lastCheckedAt: '2026-02-01T00:00:00.000Z',
        repositorySourceUrl: 'https://github.com/owner/tool',
        linkedAt: '2026-01-01T00:00:00.000Z',
      },
      { id: 'junk', repositoryFullName: 'owner/tool' },
    ]);
    expect(normalizeLinkedApplications(once)).toEqual(once);
    expect(once[0]).toMatchObject({
      displayName: 'Tool',
      installedVersion: '1.2.3',
      platform: 'macos',
      architecture: 'arm64',
      includePrereleases: false,
      lastCheckedAt: '2026-02-01T00:00:00.000Z',
    });
  });
});

describe('normalizeLinkedApplication', () => {
  it('rejects non-objects and malformed times', () => {
    expect(normalizeLinkedApplication(null)).toBeNull();
    expect(normalizeLinkedApplication('app')).toBeNull();
    expect(normalizeLinkedApplication([])).toBeNull();
    expect(normalizeLinkedApplication({ id: 'a', repositoryFullName: 'owner/tool', linkedAt: 'not-a-date' }))
      .toMatchObject({ linkedAt: '' });
  });

  it('replaces unsafe or mismatched repository source URLs', () => {
    expect(normalizeRepositorySourceUrl('javascript:alert(1)', 'owner/tool'))
      .toBe('https://github.com/owner/tool');
    expect(normalizeRepositorySourceUrl('https://github.com/other/tool', 'owner/tool'))
      .toBe('https://github.com/owner/tool');
    expect(normalizeRepositorySourceUrl('https://github.com/owner/tool/releases', 'owner/tool'))
      .toBe('https://github.com/owner/tool/releases');
  });

  it('rejects malformed repository full names', () => {
    expect(normalizeLinkedApplication({ id: 'a', repositoryFullName: 'owner/tool/extra' })).toBeNull();
    expect(normalizeLinkedApplication({ id: 'a', repositoryFullName: 'https://evil.example/x' })).toBeNull();
  });
});

describe('createLinkedApplication', () => {
  it('derives the display name from the repository and stamps metadata', () => {
    const application = createLinkedApplication(
      { repositoryFullName: ' owner/Awesome-Tool ', installedVersion: ' 2.1.0 ' },
      { id: 'id-1', now: '2026-03-01T00:00:00.000Z' },
    );

    expect(application).toEqual({
      id: 'id-1',
      repositoryFullName: 'owner/Awesome-Tool',
      displayName: 'Awesome-Tool',
      installedVersion: '2.1.0',
      platform: 'unknown',
      linkSource: 'manual',
      // 没有显式要求时默认只跟踪稳定版
      includePrereleases: false,
      repositorySourceUrl: 'https://github.com/owner/Awesome-Tool',
      linkedAt: '2026-03-01T00:00:00.000Z',
    });
  });

  it('keeps an explicit display name, platform, architecture and prerelease choice', () => {
    const application = createLinkedApplication(
      {
        repositoryFullName: 'owner/tool',
        displayName: ' My Editor ',
        installedVersion: '',
        platform: 'linux',
        architecture: 'x64',
        includePrereleases: false,
        repositorySourceUrl: 'https://github.com/owner/tool/releases',
      },
      { id: 'id-2', now: '2026-03-01T00:00:00.000Z' },
    );

    expect(application).toMatchObject({
      displayName: 'My Editor',
      installedVersion: null,
      platform: 'linux',
      architecture: 'x64',
      includePrereleases: false,
      repositorySourceUrl: 'https://github.com/owner/tool/releases',
    });
  });
});

describe('repository name helpers', () => {
  it('normalizes and keys repository names', () => {
    expect(repositoryFullNameKey(' Owner/Tool ')).toBe('owner/tool');
    expect(repositoryFullNameKey(undefined)).toBe('');
    expect(buildRepositorySourceUrl(' owner/tool ')).toBe('https://github.com/owner/tool');
    expect(buildRepositorySourceUrl('')).toBe('');
  });
});

describe('detectPlatformFromUserAgent', () => {
  it('maps common user agents', () => {
    expect(detectPlatformFromUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('windows');
    expect(detectPlatformFromUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('macos');
    expect(detectPlatformFromUserAgent('Mozilla/5.0 (X11; Linux x86_64)')).toBe('linux');
    expect(detectPlatformFromUserAgent('Mozilla/5.0 (Linux; Android 14)')).toBe('other');
  });

  it('falls back to unknown', () => {
    expect(detectPlatformFromUserAgent('')).toBe('unknown');
    expect(detectPlatformFromUserAgent(undefined)).toBe('unknown');
  });
});
