import { describe, expect, it } from 'vitest';
import type { Release, ReleaseAsset } from '../types';
import {
  assetFingerprint,
  assetsFingerprint,
  effectiveReleaseTime,
  hasAssetsChanged,
} from './releaseAssets';

const makeAsset = (overrides: Partial<ReleaseAsset> = {}): ReleaseAsset => ({
  id: 1,
  name: 'app.dmg',
  size: 1000,
  download_count: 5,
  browser_download_url: 'https://example.com/app.dmg',
  content_type: 'application/octet-stream',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('assetFingerprint', () => {
  it('serializes id, updated_at and size', () => {
    const asset = makeAsset();
    expect(assetFingerprint(asset)).toBe('1:2026-01-01T00:00:00.000Z:1000');
  });

  it('differs when updated_at changes', () => {
    const a = makeAsset({ id: 1, updated_at: '2026-01-01T00:00:00.000Z' });
    const b = makeAsset({ id: 1, updated_at: '2026-01-02T00:00:00.000Z' });
    expect(assetFingerprint(a)).not.toBe(assetFingerprint(b));
  });

  it('differs when size changes', () => {
    const a = makeAsset({ id: 1, size: 1000 });
    const b = makeAsset({ id: 1, size: 2000 });
    expect(assetFingerprint(a)).not.toBe(assetFingerprint(b));
  });

  it('does not differ when only download_count changes (volatile metadata)', () => {
    const a = makeAsset({ id: 1, download_count: 5 });
    const b = makeAsset({ id: 1, download_count: 999 });
    expect(assetFingerprint(a)).toBe(assetFingerprint(b));
  });
});

describe('assetsFingerprint', () => {
  it('returns empty string for empty/undefined assets', () => {
    expect(assetsFingerprint(undefined)).toBe('');
    expect(assetsFingerprint([])).toBe('');
  });

  it('is stable regardless of asset order', () => {
    const assetA = makeAsset({ id: 1, name: 'a' });
    const assetB = makeAsset({ id: 2, name: 'b' });
    const assets1 = [assetB, assetA];
    const assets2 = [assetA, assetB];
    expect(assetsFingerprint(assets1)).toBe(assetsFingerprint(assets2));
  });

  it('changes when any asset field changes', () => {
    const before = [makeAsset({ id: 1, updated_at: '2026-01-01T00:00:00.000Z' })];
    const after = [makeAsset({ id: 1, updated_at: '2026-01-02T00:00:00.000Z' })];
    expect(assetsFingerprint(before)).not.toBe(assetsFingerprint(after));
  });
});

describe('hasAssetsChanged', () => {
  it('returns false when assets are identical', () => {
    const assets = [makeAsset({ id: 1 })];
    expect(hasAssetsChanged(assets, assets)).toBe(false);
    expect(hasAssetsChanged(assets, [makeAsset({ id: 1 })])).toBe(false);
  });

  it('returns true when assets differ', () => {
    const before = [makeAsset({ id: 1 })];
    const after = [makeAsset({ id: 1, size: 9999 })];
    expect(hasAssetsChanged(before, after)).toBe(true);
  });

  it('returns true when asset added/removed', () => {
    const one = [makeAsset({ id: 1 })];
    const two = [makeAsset({ id: 1 }), makeAsset({ id: 2 })];
    expect(hasAssetsChanged(one, two)).toBe(true);
  });

  it('returns false when only download_count changed across refreshes', () => {
    // download_count 在每次下载时会 +1；若纳入指纹会导致刷新必然“资产已更新”的噪声。
    const before = [makeAsset({ id: 1, download_count: 0 })];
    const after = [makeAsset({ id: 1, download_count: 12345 })];
    expect(hasAssetsChanged(before, after)).toBe(false);
  });
});

describe('effectiveReleaseTime', () => {
  const makeRelease = (overrides: Partial<Release> = {}): Release => ({
    id: 1,
    tag_name: 'v1',
    name: 'Release 1',
    body: null,
    published_at: '2026-01-01T00:00:00.000Z',
    html_url: 'https://github.com/owner/repo/releases/tag/v1',
    assets: [],
    repository: { id: 1, full_name: 'owner/repo', name: 'repo' },
    ...overrides,
  });

  it('falls back to published_at when there are no assets', () => {
    expect(effectiveReleaseTime(makeRelease())).toBe('2026-01-01T00:00:00.000Z');
    expect(effectiveReleaseTime(makeRelease({ assets: undefined }))).toBe('2026-01-01T00:00:00.000Z');
  });

  it('normalizes timestamps without millisecond precision', () => {
    const release = makeRelease({ published_at: '2026-01-01T00:00:00Z' });
    expect(effectiveReleaseTime(release)).toBe('2026-01-01T00:00:00.000Z');
  });

  it('uses published_at when assets were updated at or before publish time', () => {
    const release = makeRelease({
      assets: [makeAsset({ updated_at: '2026-01-01T00:00:00.000Z' })],
    });
    expect(effectiveReleaseTime(release)).toBe('2026-01-01T00:00:00.000Z');
  });

  it('returns the latest asset updated_at when it is newer than published_at', () => {
    const release = makeRelease({
      assets: [
        makeAsset({ id: 1, updated_at: '2026-01-05T00:00:00.000Z' }),
        makeAsset({ id: 2, updated_at: '2026-01-10T00:00:00.000Z' }),
      ],
    });
    expect(effectiveReleaseTime(release)).toBe('2026-01-10T00:00:00.000Z');
  });
});
