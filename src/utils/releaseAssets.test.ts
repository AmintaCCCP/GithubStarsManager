import { describe, expect, it } from 'vitest';
import type { ReleaseAsset } from '../types';
import {
  assetFingerprint,
  assetsFingerprint,
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
  it('serializes id, updated_at, size and download_count', () => {
    const asset = makeAsset();
    expect(assetFingerprint(asset)).toBe('1:2026-01-01T00:00:00.000Z:1000:5');
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

  it('differs when download_count changes', () => {
    const a = makeAsset({ id: 1, download_count: 5 });
    const b = makeAsset({ id: 1, download_count: 6 });
    expect(assetFingerprint(a)).not.toBe(assetFingerprint(b));
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
});
