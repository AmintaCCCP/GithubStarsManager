import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  detectDevicePlatformSync,
  resetDeviceTargetCacheForTests,
  resolveDeviceArchitecture,
} from './deviceTarget';

/** 覆盖 navigator 上的只读属性（userAgentData / platform）。 */
function stubNavigator(values: {
  platform?: string;
  userAgent?: string;
  userAgentData?: unknown;
  maxTouchPoints?: number;
}): void {
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
  Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'maxTouchPoints');
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

  it('prefers an explicit Android user agent over a generic Linux platform', () => {
    stubNavigator({
      userAgentData: undefined,
      platform: 'Linux armv8l',
      userAgent: 'Mozilla/5.0 (Android 15; Mobile; rv:128.0) Gecko/128.0 Firefox/128.0',
    });
    expect(detectDevicePlatformSync()).toBe('android');
  });

  it('does not treat AppleWebKit as macOS or BSD as Linux', () => {
    stubNavigator({
      userAgentData: undefined,
      platform: '',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    });
    expect(detectDevicePlatformSync()).toBe('windows');

    stubNavigator({ platform: 'FreeBSD amd64', userAgent: 'Mozilla/5.0 (FreeBSD)' });
    expect(detectDevicePlatformSync()).toBeNull();
  });

  it('returns null instead of guessing on an unrecognised platform', () => {
    stubNavigator({ platform: 'SunOS', userAgent: 'Mozilla/5.0 (Unknown)' });
    expect(detectDevicePlatformSync()).toBeNull();
  });

  it('does not map iOS onto macOS', () => {
    // iOS 上没有 dmg/pkg，映射成 macOS 会推荐错误的安装包
    stubNavigator({
      userAgentData: { platform: 'iOS' },
      platform: 'iPhone',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
    });
    expect(detectDevicePlatformSync()).toBeNull();

    stubNavigator({ platform: 'iPad', userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)' });
    expect(detectDevicePlatformSync()).toBeNull();
  });

  it('does not map an iPad in desktop mode onto macOS', () => {
    stubNavigator({
      userAgentData: undefined,
      platform: 'MacIntel',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15',
      maxTouchPoints: 5,
    });
    expect(detectDevicePlatformSync()).toBeNull();
  });

  it('does not map ChromeOS onto Linux', () => {
    // ChromeOS 的 navigator.platform 是 "Linux x86_64"，只靠它会误判成 Linux
    stubNavigator({
      userAgentData: { platform: 'Chrome OS' },
      platform: 'Linux x86_64',
      userAgent: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36',
    });
    expect(detectDevicePlatformSync()).toBeNull();

    // 即使 userAgentData 不可用，UA 里的 CrOS 也要拦住
    stubNavigator({
      userAgentData: undefined,
      platform: 'Linux x86_64',
      userAgent: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36',
    });
    expect(detectDevicePlatformSync()).toBeNull();
  });

  it('treats Darwin as macOS rather than Windows', () => {
    // `darwin` 里含有 `win`：判定顺序若把 Windows 放在前面，Safari 会被当成 Windows
    stubNavigator({ userAgentData: undefined, platform: 'Darwin', userAgent: 'Mozilla/5.0 (Darwin)' });
    expect(detectDevicePlatformSync()).toBe('macos');
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
    const getHighEntropyValues = vi.fn().mockResolvedValue({ architecture: 'arm', bitness: '32' });
    stubNavigator({
      userAgentData: {
        getHighEntropyValues,
      },
    });
    await expect(resolveDeviceArchitecture()).resolves.toBeUndefined();
    await expect(resolveDeviceArchitecture()).resolves.toBeUndefined();
    expect(getHighEntropyValues).toHaveBeenCalledTimes(1);
  });
});
