import { describe, expect, it } from 'vitest';
import type { DeviceTarget } from '../types/installableAsset';
import { evaluateCurrentSystem, type AssetLinkInput } from './assetCompatibility';

describe('asset compatibility benchmark', () => {
  it('classifies 1000 releases with 30 assets', () => {
    const device: DeviceTarget = {
      platform: 'macos',
      architecture: 'arm64',
      architectureSource: 'ua-ch',
      architectureSettled: true,
    };
    const start = performance.now();
    for (let release = 0; release < 1000; release++) {
      const links: AssetLinkInput[] = Array.from({ length: 30 }, (_, index) => ({
        index,
        name: index % 3 === 0
          ? `App-${release}-${index}-arm64.dmg`
          : index % 3 === 1
            ? `App-${release}-${index}-x64.exe`
            : `App-${release}-${index}-x86_64.AppImage`,
        url: `https://example.com/App-${release}-${index}`,
        assetId: release * 100 + index + 1,
      }));
      evaluateCurrentSystem(links, device);
    }
    const elapsed = performance.now() - start;
    console.info(`[bench] 1000 releases x 30 assets: ${elapsed.toFixed(1)}ms`);
    expect(elapsed).toBeGreaterThan(0);
  });
});
