/**
 * 当前设备的平台与架构识别。
 *
 * 用途：Installable Asset Detection 需要知道「这台设备是什么」，才能判断哪些 Release
 * 资产可安装。识别结果**只作为推荐信号**，不是不可取消的硬过滤（roadmap §7）。
 *
 * 为什么不用 Electron IPC 拿 `process.platform` / `process.arch`：
 * - Web 版没有 Electron 进程，必须有一套浏览器可用的实现；
 * - 新增一个只为读平台/架构的 IPC 会在 Host 侧扩大接口面，而
 *   `navigator.userAgentData` 在 Electron 渲染进程里同样报告宿主 OS/CPU 架构。
 * 因此这里统一走 Web API，宿主插件运行时的 `hostEnvironment`（process.platform/arch）
 * 保持不变、各管一摊。
 *
 * 架构只能**尽力而为**：`navigator.userAgentData` 的架构属于 high-entropy hints，
 * 只能异步获取。拿不到时返回 undefined，调用方应跳过架构过滤、并列展示候选，
 * 而不是猜一个。
 */
import type { InstallableArchitecture, InstallablePlatform } from '../types/installableAsset';

/** `navigator.userAgentData` 的最小类型（TS DOM lib 未内建 getHighEntropyValues）。 */
interface UADataLike {
  platform?: string;
  getHighEntropyValues?: (hints: string[]) => Promise<{
    architecture?: string;
    bitness?: string;
    platform?: string;
  }>;
}

function readUserAgentData(): UADataLike | null {
  if (typeof navigator === 'undefined') return null;
  const data = (navigator as Navigator & { userAgentData?: UADataLike }).userAgentData;
  return data ?? null;
}

/**
 * 把 `userAgentData.platform` / `navigator.platform` / UA 字符串归一化为目标平台。
 *
 * 判定顺序是刻意的：
 * 1. 先排除不支持的平台。iOS 与 ChromeOS 本仓库都不发布对应安装包，
 *    把它们当成 macOS / Linux 会让推荐组件向 iOS 用户推荐 `.dmg`、
 *    向 ChromeOS 用户推荐 `.deb` / `.rpm` / AppImage。这里返回 null，
 *    调用方按「平台未知」处理（并列候选且不声称适配）。
 * 2. macOS 必须排在 Windows 之前：`darwin` 里含有 `win`，顺序反了会把
 *    Safari 的 UA（`… Darwin …`）判成 Windows。
 */
function normalizePlatformToken(value: string | undefined | null): InstallablePlatform | null {
  if (!value) return null;
  const token = value.toLowerCase();

  // 不支持的平台：必须显式识别并放弃，而不是落到某个桌面平台上
  if (token.includes('iphone') || token.includes('ipad') || token.includes('ipod') || token.includes('ios')) {
    return null;
  }
  if (token.includes('cros') || token.includes('crkey') || token.includes('chromeos')) {
    return null;
  }

  if (token.includes('android')) return 'android';
  if (token.includes('mac') || token.includes('darwin') || token.includes('osx')) {
    return 'macos';
  }
  if (token.includes('windows') || token.includes('win32') || token.includes('win64') || token.includes('win')) {
    return 'windows';
  }
  if (token.includes('linux') || token.includes('x11') || token.includes('ubuntu')) {
    return 'linux';
  }
  return null;
}

/**
 * 任一设备信号表明是不支持的平台（iOS / ChromeOS）时返回 true。
 *
 * 单看 `navigator.platform` 不够：ChromeOS 上它是 `Linux x86_64`，会被当成 Linux；
 * iPad 也可能报 `MacIntel`。因此把三个信号一起看，只要有任何一个指向不支持的平台
 * 就放弃识别，而不是退回到某个桌面平台。
 */
function isUnsupportedPlatform(): boolean {
  const signals = [readUserAgentData()?.platform, navigator.platform, navigator.userAgent];
  const looksLikeTouchCapableMac = navigator.maxTouchPoints > 1
    && signals.some((signal) => normalizePlatformToken(signal) === 'macos');
  if (looksLikeTouchCapableMac) return true;
  return signals.some((signal) => {
    const token = (signal ?? '').toLowerCase();
    if (/(?:^|[^a-z])(?:iphone|ipad|ipod|ios)(?:$|[^a-z])/.test(token)) return true;
    return token.includes('cros') || token.includes('crkey') || token.includes('chromeos');
  });
}

/**
 * 同步识别当前设备平台。
 * 优先 `userAgentData.platform`（Chromium/Electron），回退 `navigator.platform`，
 * 最后回退 UA 字符串。无法识别时返回 null，调用方必须按「不按平台过滤」处理。
 */
export function detectDevicePlatformSync(): InstallablePlatform | null {
  if (typeof navigator === 'undefined') return null;
  if (isUnsupportedPlatform()) return null;
  const fromUserAgent = normalizePlatformToken(navigator.userAgent);
  // Firefox on Android reports navigator.platform as Linux armv8l. Prefer the
  // explicit Android marker over that generic Linux fallback.
  if (fromUserAgent === 'android') return fromUserAgent;
  const fromUAData = normalizePlatformToken(readUserAgentData()?.platform);
  if (fromUAData) return fromUAData;
  const fromPlatform = normalizePlatformToken(navigator.platform);
  if (fromPlatform) return fromPlatform;
  return fromUserAgent;
}

/** 把 high-entropy 的 `architecture` + `bitness` 组合归一化为目标架构。 */
function normalizeArchitecture(
  architecture: string | undefined,
  bitness: string | undefined,
): InstallableArchitecture | undefined {
  const arch = (architecture ?? '').toLowerCase();
  const bits = (bitness ?? '').toLowerCase();
  if (arch === 'x86') return bits === '64' ? 'x64' : bits === '32' ? 'x86' : undefined;
  if (arch === 'arm') return bits === '64' ? 'arm64' : undefined;
  if (arch === 'arm64' || arch === 'aarch64') return 'arm64';
  if (arch === 'x86_64' || arch === 'amd64' || arch === 'x64') return 'x64';
  return undefined;
}

/** 进程内缓存：架构在一次会话里不会变，避免多次异步探测。 */
let architectureCache: InstallableArchitecture | undefined;
let architectureProbe: Promise<InstallableArchitecture | undefined> | null = null;
let architectureProbeComplete = false;

/**
 * 尽力解析当前设备架构。
 * 拿不到 high-entropy hints 时返回 undefined（例如 Firefox/Safari，或 API 拒绝），
 * 调用方应据此放弃架构过滤而不是假定 x64。
 */
export function resolveDeviceArchitecture(): Promise<InstallableArchitecture | undefined> {
  if (architectureProbeComplete) return Promise.resolve(architectureCache);
  if (architectureProbe) return architectureProbe;
  const data = readUserAgentData();
  if (!data?.getHighEntropyValues) {
    architectureProbeComplete = true;
    return Promise.resolve(undefined);
  }

  architectureProbe = data
    .getHighEntropyValues(['architecture', 'bitness'])
    .then((values) => {
      architectureCache = normalizeArchitecture(values?.architecture, values?.bitness);
      architectureProbeComplete = true;
      return architectureCache;
    })
    .catch(() => {
      architectureProbeComplete = true;
      return undefined;
    })
    .finally(() => {
      architectureProbe = null;
    });

  return architectureProbe;
}

/** 仅供测试：清空架构缓存。 */
export function resetDeviceTargetCacheForTests(): void {
  architectureCache = undefined;
  architectureProbe = null;
  architectureProbeComplete = false;
}
