import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  detectDevicePlatformSync,
  resetDeviceTargetCacheForTests,
  resolveDeviceArchitecture,
} from './deviceTarget';

/** 覆盖 navigator 上的只读属性（userAgentData / platform）。 */
function stubNavigator(values: { platform?: string; userAgent?: string; userAgentData?: unknown }): void {
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(navigator, key, {
      value,
      configurable: true,
      writable: true,
    });
  }
}

afterEach(() => {
  resetDeviceTargetCacheForTests();
  Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'userAgentData');
  vi.restoreAllMocks();
});

describe('detectDevicePlatformSync', () => {
  it('prefers userAgentData.platform', () => {
    stubNavigator({ userAgentData: { platform: 'Windows' }, platform: 'Linux x86_64' });
    expect(detectDevicePlatformSync()).toBe('windows');
  });

  it('maps macOS and Android platforms', () => {
    stubNavigator({ userAgentData: { platform: 'macOS' } });
    expect(detectDevicePlatformSync()).toBe('macos');

    stubNavigator({ userAgentData: { platform: 'Android' } });
    expect(detectDevicePlatformSync()).toBe('android');
  });

  it('falls back to navigator.platform', () => {
    stubNavigator({ userAgentData: undefined, platform: 'Linux x86_64' });
    expect(detectDevicePlatformSync()).toBe('linux');

    stubNavigator({ platform: 'MacIntel' });
    expect(detectDevicePlatformSync()).toBe('macos');
  });

  it('falls back to the user agent string', () => {
    stubNavigator({ platform: '', userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Electron/41' });
    expect(detectDevicePlatformSync()).toBe('linux');
  });

  it('returns null instead of guessing on an unrecognised platform', () => {
    stubNavigator({ platform: 'SunOS', userAgent: 'Mozilla/5.0 (Unknown)' });
    expect(detectDevicePlatformSync()).toBeNull();
  });
});

describe('resolveDeviceArchitecture', () => {
  it('derives x64 from the high-entropy architecture and bitness hints', async () => {
    const getHighEntropyValues = vi.fn().mockResolvedValue({ architecture: 'x86', bitness: '64' });
    stubNavigator({ userAgentData: { platform: 'Windows', getHighEntropyValues } });

    await expect(resolveDeviceArchitecture()).resolves.toBe('x64');
    expect(getHighEntropyValues).toHaveBeenCalledWith(['architecture', 'bitness']);
  });

  it('derives arm64 and x86', async () => {
    stubNavigator({
      userAgentData: {
        getHighEntropyValues: vi.fn().mockResolvedValue({ architecture: 'arm', bitness: '64' }),
      },
    });
    await expect(resolveDeviceArchitecture()).resolves.toBe('arm64');

    resetDeviceTargetCacheForTests();
    stubNavigator({
      userAgentData: {
        getHighEntropyValues: vi.fn().mockResolvedValue({ architecture: 'x86', bitness: '32' }),
      },
    });
    await expect(resolveDeviceArchitecture()).resolves.toBe('x86');
  });

  it('caches the result so the hint API is queried once', async () => {
    const getHighEntropyValues = vi.fn().mockResolvedValue({ architecture: 'arm', bitness: '64' });
    stubNavigator({ userAgentData: { getHighEntropyValues } });

    await resolveDeviceArchitecture();
    await resolveDeviceArchitecture();

    expect(getHighEntropyValues).toHaveBeenCalledTimes(1);
  });

  it('returns undefined when the hint API is unavailable', async () => {
    stubNavigator({ userAgentData: { platform: 'Windows' } });
    await expect(resolveDeviceArchitecture()).resolves.toBeUndefined();
  });

  it('returns undefined instead of failing when the hint call rejects', async () => {
    stubNavigator({
      userAgentData: {
        getHighEntropyValues: vi.fn().mockRejectedValue(new Error('not allowed')),
      },
    });
    await expect(resolveDeviceArchitecture()).resolves.toBeUndefined();
  });

  it('does not invent an architecture for 32-bit ARM', async () => {
    stubNavigator({
      userAgentData: {
        getHighEntropyValues: vi.fn().mockResolvedValue({ architecture: 'arm', bitness: '32' }),
      },
    });
    await expect(resolveDeviceArchitecture()).resolves.toBeUndefined();
  });
});
