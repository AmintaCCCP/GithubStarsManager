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

/** 把 `userAgentData.platform` / `navigator.platform` / UA 字符串归一化为目标平台。 */
function normalizePlatformToken(value: string | undefined | null): InstallablePlatform | null {
  if (!value) return null;
  const token = value.toLowerCase();
  if (token.includes('android')) return 'android';
  if (token.includes('win')) return 'windows';
  if (token.includes('mac') || token.includes('darwin') || token.includes('iphone') || token.includes('ipad')) {
    return 'macos';
  }
  if (token.includes('linux') || token.includes('x11') || token.includes('crkey')) {
    // CrOS 不支持本仓库的 Linux 安装包格式，但归入 Linux 比归入「未知」更少误导；
    // 真正的兼容性判定发生在包类型层面（deb/rpm/AppImage）。
    return 'linux';
  }
  return null;
}

/**
 * 同步识别当前设备平台。
 * 优先 `userAgentData.platform`（Chromium/Electron），回退 `navigator.platform`，
 * 最后回退 UA 字符串。无法识别时返回 null，调用方必须按「不按平台过滤」处理。
 */
export function detectDevicePlatformSync(): InstallablePlatform | null {
  if (typeof navigator === 'undefined') return null;
  const fromUAData = normalizePlatformToken(readUserAgentData()?.platform);
  if (fromUAData) return fromUAData;
  const fromPlatform = normalizePlatformToken(navigator.platform);
  if (fromPlatform) return fromPlatform;
  return normalizePlatformToken(navigator.userAgent);
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

/**
 * 尽力解析当前设备架构。
 * 拿不到 high-entropy hints 时返回 undefined（例如 Firefox/Safari，或 API 拒绝），
 * 调用方应据此放弃架构过滤而不是假定 x64。
 */
export function resolveDeviceArchitecture(): Promise<InstallableArchitecture | undefined> {
  if (architectureCache !== undefined) return Promise.resolve(architectureCache);
  if (architectureProbe) return architectureProbe;
  const data = readUserAgentData();
  if (!data?.getHighEntropyValues) return Promise.resolve(undefined);

  architectureProbe = data
    .getHighEntropyValues(['architecture', 'bitness'])
    .then((values) => {
      architectureCache = normalizeArchitecture(values?.architecture, values?.bitness);
      return architectureCache;
    })
    .catch(() => undefined)
    .finally(() => {
      architectureProbe = null;
    });

  return architectureProbe;
}

/** 仅供测试：清空架构缓存。 */
export function resetDeviceTargetCacheForTests(): void {
  architectureCache = undefined;
  architectureProbe = null;
}
