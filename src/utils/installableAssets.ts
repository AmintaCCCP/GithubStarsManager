/**
 * Installable Asset Detection —— 判断一个 Release 里哪些资产可以在当前设备上安装。
 *
 * 复用与新增的边界（先读代码再动手的结论）：
 * - **复用**：平台判定直接调用 [`detectAssetPlatform`](./releaseAssets.ts) 与它导出的
 *   [`OS_TOKEN_PLATFORM`](./releaseAssets.ts)，不另写一份平台词表。
 * - **新增**：架构词表、包类型表、排除规则与置信度模型。仓库里唯一存在的架构词表在
 *   `examples/plugins/smart-release-recommender/worker.js`，那是沙箱内的第三方插件参考实现，
 *   `src/` 无法 import（插件也不能反向依赖 Core），因此这里必须有一份 Host 侧实现，
 *   并在下方注明与那份参考实现的对应关系。
 * - **不复用** [`PRESET_FILTERS`](../constants/presetFilters.ts)：它把 `zip` / `tar.gz`
 *   归入 Source、且用朴素子串匹配（`win` 会命中 `darwin`），与「可安装软件识别」的目标冲突。
 *
 * 边界（roadmap §5.3）：只识别，不执行；不宣称安装包安全；不确定时并列多个候选；
 * 用户始终可以在资产表里手动选择其他资产。
 */
import type { ReleaseAsset } from '../types';
import type {
  InstallableArchitecture,
  InstallableAsset,
  InstallableAssetDetectionOptions,
  InstallableAssetDetectionResult,
  InstallableConfidence,
  InstallablePackageType,
  InstallablePlatform,
} from '../types/installableAsset';
import { detectAssetPlatform, OS_TOKEN_PLATFORM, type AssetPlatform } from './releaseAssets';

/** 本阶段支持的目标平台；`ios` / `docker` 不属于「可安装到当前设备」的范畴。 */
const INSTALLABLE_PLATFORMS: readonly InstallablePlatform[] = ['windows', 'macos', 'linux', 'android'];

function toInstallablePlatform(platform: AssetPlatform | null): InstallablePlatform | null {
  return platform && (INSTALLABLE_PLATFORMS as readonly string[]).includes(platform)
    ? (platform as InstallablePlatform)
    : null;
}

/**
 * 包类型表：后缀 → 包类型 + 该后缀是否**决定性**地确定了平台。
 *
 * 按后缀长度降序匹配（`detectAssetPlatform` 的分层注释里说明了为什么必须先长后短）。
 * `decisivePlatform` 为 null 的容器格式（zip/7z/tar.gz）只说明「怎么装」，
 * 不说明「装在哪」——平台交给文件名里的 OS 词元判定。
 */
interface PackageTypeEntry {
  suffix: string;
  packageType: InstallablePackageType;
  decisivePlatform: InstallablePlatform | null;
  /** Android App Bundle 只能识别，不能当作可直接安装的推荐。 */
  detectOnly?: boolean;
}

const PACKAGE_TYPE_ENTRIES: PackageTypeEntry[] = [
  { suffix: '.appimage', packageType: 'appimage', decisivePlatform: 'linux' },
  { suffix: '.tar.gz', packageType: 'tar.gz', decisivePlatform: null },
  { suffix: '.msi', packageType: 'msi', decisivePlatform: 'windows' },
  { suffix: '.exe', packageType: 'exe', decisivePlatform: 'windows' },
  { suffix: '.dmg', packageType: 'dmg', decisivePlatform: 'macos' },
  { suffix: '.pkg', packageType: 'pkg', decisivePlatform: 'macos' },
  { suffix: '.deb', packageType: 'deb', decisivePlatform: 'linux' },
  { suffix: '.rpm', packageType: 'rpm', decisivePlatform: 'linux' },
  { suffix: '.apk', packageType: 'apk', decisivePlatform: 'android' },
  { suffix: '.aab', packageType: 'aab', decisivePlatform: 'android', detectOnly: true },
  { suffix: '.zip', packageType: 'zip', decisivePlatform: null },
  { suffix: '.7z', packageType: '7z', decisivePlatform: null },
];

/** 长后缀优先，避免 `.pkg` 抢在 `.tar.gz` 之类的前面。 */
const PACKAGE_TYPES: PackageTypeEntry[] = [...PACKAGE_TYPE_ENTRIES].sort(
  (left, right) => right.suffix.length - left.suffix.length,
);

/**
 * 排除规则：这些资产不是「可安装软件」，必须在候选之前剔除。
 * 规则集与 `examples/plugins/smart-release-recommender/worker.js` 的
 * `SOURCE_ARCHIVE` / checksum 正则保持同一意图，但覆盖范围更完整
 * （该参考实现只有 source / checksum / signature 三类）。
 */
const EXCLUSION_RULES: ReadonlyArray<{ reason: string; pattern: RegExp }> = [
  { reason: 'source code archive', pattern: /(?:^|[^a-z0-9])(?:source|src)(?:[^a-z0-9]?(?:code|archive))?(?=$|[^a-z0-9])|源码/ },
  { reason: 'checksum file', pattern: /(?:checksum|sha256sum|sha512sum|\.sha256$|\.sha512$|\.md5$|(?:^|[^a-z0-9])md5(?=$|[^a-z0-9]))/ },
  { reason: 'signature file', pattern: /\.(?:sig|asc|minisig|p7s)$|(?:^|[^a-z0-9])sigstore(?=$|[^a-z0-9])/ },
  { reason: 'debug symbols', pattern: /\.(?:pdb|dsym)$|(?:^|[^a-z0-9])(?:symbols?|dsym)(?=$|[^a-z0-9])/ },
  { reason: 'electron blockmap', pattern: /\.blockmap$/ },
  { reason: 'software bill of materials', pattern: /(?:^|[^a-z0-9])(?:sbom|spdx|cyclonedx)(?=$|[^a-z0-9])/ },
];

/**
 * 架构词表。
 * 与参考实现（worker.js L11-16）的差异有两点，都是刻意的：
 * - 不使用裸 `x86` 之外还接受 `ia32` / `i386…i686`（Electron 的 32 位命名）；
 *   `win32` 是 Windows 的平台名而不是 32 位标记，参考实现的注释也这么说，这里同样不当作架构。
 * - 增加 `universal`（macOS 通用二进制 / 多架构单一产物）。参考实现从不产出该值，
 *   于是 `project-macos-universal.dmg` 只靠平台得分胜出；这里把它识别成一等架构。
 */
const ARCH_RULES: ReadonlyArray<{ architecture: InstallableArchitecture; pattern: RegExp }> = [
  { architecture: 'universal', pattern: /(?:^|[^a-z0-9])(?:universal2?|multiarch)(?=$|[^a-z0-9])/ },
  { architecture: 'x64', pattern: /(?:^|[^a-z0-9])(?:x86[_-]?64|amd64|x64|win64)(?=$|[^a-z0-9])/ },
  { architecture: 'arm64', pattern: /(?:^|[^a-z0-9])(?:aarch64|arm64|arm64e)(?=$|[^a-z0-9])/ },
  { architecture: 'x86', pattern: /(?:^|[^a-z0-9])(?:ia32|i[3-6]86|x86(?![_-]?64))(?=$|[^a-z0-9])/ },
];

/** 置信度排序用权重（高在前）。 */
const CONFIDENCE_ORDER: Record<InstallableConfidence, number> = { high: 0, medium: 1, low: 2 };

/** 架构相对当前设备的贴合度：精确匹配最好，其次通用产物，最后是未知。 */
function architectureRank(
  architecture: InstallableArchitecture | undefined,
  deviceArchitecture: InstallableArchitecture | undefined,
): number {
  if (architecture === undefined) return 2;
  if (architecture === 'universal') return 1;
  return architecture === deviceArchitecture ? 0 : 1;
}

/** 从文件名解析包类型（后缀匹配，长后缀优先）。 */
function detectPackageType(fileName: string) {
  const name = fileName.toLowerCase();
  return PACKAGE_TYPES.find((entry) => name.endsWith(entry.suffix)) ?? null;
}

/** 文件名里声明的架构集合；空集表示没有声明。 */
function declaredArchitectures(fileName: string): Set<InstallableArchitecture> {
  const name = fileName.toLowerCase();
  const found = new Set<InstallableArchitecture>();
  for (const { architecture, pattern } of ARCH_RULES) {
    if (pattern.test(name)) found.add(architecture);
  }
  return found;
}

/** 文件名里声明的平台集合（复用 releaseAssets 的词表，不重复维护）。 */
function declaredPlatforms(fileName: string): Set<InstallablePlatform> {
  const found = new Set<InstallablePlatform>();
  for (const token of fileName.toLowerCase().split(/[^a-z0-9]+/)) {
    const platform = toInstallablePlatform(OS_TOKEN_PLATFORM[token] ?? null);
    if (platform) found.add(platform);
  }
  return found;
}

/**
 * 解析资产架构。
 * 返回 `ambiguous` 表示文件名同时声明了多个架构（如 `app-x64-arm64.zip`）——
 * 此时不猜，架构留空并降级置信度。
 */
function resolveArchitecture(fileName: string): {
  architecture?: InstallableArchitecture;
  ambiguous: boolean;
} {
  const declared = declaredArchitectures(fileName);
  if (declared.size === 0) return { ambiguous: false };
  // 通用产物覆盖所有架构，与具体架构同时出现时以通用为准（不矛盾）。
  if (declared.has('universal')) return { architecture: 'universal', ambiguous: false };
  if (declared.size === 1) return { architecture: [...declared][0], ambiguous: false };
  return { ambiguous: true };
}

/** 组装人类可读的判定依据。UI 另有本地化标签，这里同时供 AI/MCP/插件解释「为什么」。 */
function buildReason(input: {
  platform: InstallablePlatform;
  packageType: InstallablePackageType;
  architecture?: InstallableArchitecture;
  ambiguousArchitecture: boolean;
  platformFromExtension: boolean;
  detectOnly: boolean;
}): string {
  const platformLabel = input.platform === 'macos' ? 'macOS' : input.platform[0].toUpperCase() + input.platform.slice(1);
  const parts = [`${platformLabel} ${input.packageType} package`];
  if (input.architecture) parts.push(`declares ${input.architecture}`);
  if (input.ambiguousArchitecture) parts.push('declares multiple architectures');
  if (!input.architecture && !input.ambiguousArchitecture) parts.push('architecture not declared');
  parts.push(
    input.platformFromExtension
      ? 'platform from package extension'
      : 'platform inferred from filename',
  );
  if (input.detectOnly) parts.push('detect only — not directly installable');
  return parts.join('; ');
}

/**
 * 识别一个 Release 的资产集合。
 *
 * @param assets Release 资产（`Release.assets`）。
 * @param options 目标设备与过滤条件；省略 `platform` 表示「不按平台过滤」，返回全部候选。
 * @returns 候选（按置信度、架构贴合度、资产 id 稳定排序）与被排除资产及原因。
 */
export function detectInstallableAssets(
  assets: readonly ReleaseAsset[] | undefined,
  options: InstallableAssetDetectionOptions = {},
): InstallableAssetDetectionResult {
  const matches: InstallableAsset[] = [];
  const excluded: InstallableAssetDetectionResult['excluded'] = [];
  const targetPlatform = options.platform;
  const deviceArchitecture = options.architecture;

  for (const asset of assets ?? []) {
    const fileName = asset?.name ?? '';
    if (!fileName) continue;

    const lowercase = fileName.toLowerCase();
    const exclusion = EXCLUSION_RULES.find((rule) => rule.pattern.test(lowercase));
    if (exclusion) {
      excluded.push({ assetId: asset.id, fileName, reason: exclusion.reason });
      continue;
    }

    const packageInfo = detectPackageType(fileName);
    if (!packageInfo) {
      excluded.push({ assetId: asset.id, fileName, reason: 'not a supported installable package format' });
      continue;
    }
    // AAB 只识别、不直接安装：默认不进候选（roadmap §5.1）。
    if (packageInfo.detectOnly && !options.includeDetectOnly) {
      excluded.push({ assetId: asset.id, fileName, reason: 'Android App Bundle is detect-only and cannot be installed directly' });
      continue;
    }

    const declared = declaredPlatforms(fileName);
    if (declared.size > 1) {
      excluded.push({
        assetId: asset.id,
        fileName,
        reason: `filename declares multiple platforms (${[...declared].join(', ')})`,
      });
      continue;
    }

    // 平台来源优先级：文件名唯一平台 → 决定性扩展名。两者冲突时宁可排除也不猜。
    const fromExtension = packageInfo.decisivePlatform;
    let platform: InstallablePlatform | null = null;
    let platformFromExtension = false;
    if (declared.size === 1) {
      const declaredPlatform = [...declared][0];
      if (fromExtension && fromExtension !== declaredPlatform) {
        excluded.push({
          assetId: asset.id,
          fileName,
          reason: `package extension targets ${fromExtension} but the filename declares ${declaredPlatform}`,
        });
        continue;
      }
      platform = declaredPlatform;
    } else if (fromExtension) {
      platform = fromExtension;
      platformFromExtension = true;
    } else {
      // 容器本身不说明装在哪（例如 `myapp-1.0.zip`）。此时再复用既有
      // detectAssetPlatform 的最后一层——content_type 的 MIME 兜底——
      // 只有它还能提供平台证据；其余情形不猜（roadmap §5.3「不把 ZIP 一律当作可安装软件」），
      // 资产表里仍可手动下载。
      const fromContentType = toInstallablePlatform(
        detectAssetPlatform(fileName, asset.content_type),
      );
      if (!fromContentType) {
        excluded.push({
          assetId: asset.id,
          fileName,
          reason: 'portable archive without a declared target platform',
        });
        continue;
      }
      platform = fromContentType;
    }

    if (targetPlatform && platform !== targetPlatform) {
      excluded.push({
        assetId: asset.id,
        fileName,
        reason: `targets ${platform}, this device is ${targetPlatform}`,
      });
      continue;
    }

    const { architecture, ambiguous } = resolveArchitecture(fileName);
    if (ambiguous) {
      excluded.push({
        assetId: asset.id,
        fileName,
        reason: 'declares multiple architectures',
      });
      continue;
    }
    const usesWindowsX86Compatibility = platform === 'windows'
      && architecture === 'x86'
      && (deviceArchitecture === 'x64' || deviceArchitecture === 'arm64');
    if (
      deviceArchitecture
      && architecture
      && architecture !== 'universal'
      && architecture !== deviceArchitecture
      && !usesWindowsX86Compatibility
    ) {
      excluded.push({
        assetId: asset.id,
        fileName,
        reason: `targets ${architecture}, this device is ${deviceArchitecture}`,
      });
      continue;
    }

    // 置信度：决定性扩展名 + 已知架构 = 高；容器格式或架构未知则降级。
    let confidence: InstallableConfidence;
    if (usesWindowsX86Compatibility) confidence = 'medium';
    else if (fromExtension && architecture) confidence = 'high';
    else if (fromExtension) confidence = 'medium';
    else if (architecture) confidence = 'medium';
    else confidence = 'low';

    matches.push({
      assetId: asset.id,
      fileName,
      downloadUrl: asset.browser_download_url,
      size: asset.size,
      platform,
      architecture,
      packageType: packageInfo.packageType,
      confidence,
      reason: buildReason({
        platform,
        packageType: packageInfo.packageType,
        architecture,
        ambiguousArchitecture: false,
        platformFromExtension,
        detectOnly: packageInfo.detectOnly === true,
      }),
    });
  }

  matches.sort(
    (left, right) =>
      CONFIDENCE_ORDER[left.confidence] - CONFIDENCE_ORDER[right.confidence] ||
      architectureRank(left.architecture, deviceArchitecture) -
        architectureRank(right.architecture, deviceArchitecture) ||
      left.assetId - right.assetId,
  );

  return { matches, excluded };
}

/**
 * 仓库级便捷判断：该 Release 资产集合里是否存在当前设备可安装的软件。
 * 供 Discovery 筛选、Repository Health 与批量导入预览复用。
 */
export function hasInstallableAsset(
  assets: readonly ReleaseAsset[] | undefined,
  options: InstallableAssetDetectionOptions = {},
): boolean {
  return detectInstallableAssets(assets, options).matches.length > 0;
}
