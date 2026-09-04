import type { Release, ReleaseAsset } from '../types';

/**
 * 计算单个资产的指纹。
 * 资产指纹用于判断某条 Release 的资产内容是否发生变化。
 * 依据：GitHub 资产一旦被替换/重传，`updated_at` 会更新；用 `size` 做兜底，
 * 覆盖同时间戳内出现大小变化的极端情况。
 * 注意：`download_count` 是易变元数据（每次下载都会 +1），若纳入指纹会导致
 * 指纹在两次刷新间必然变化，从而让增量刷新的“无变化则短路”失效，故不纳入。
 */
export function assetFingerprint(asset: ReleaseAsset): string {
  return [asset.id, asset.updated_at, asset.size].join(':');
}

/**
 * 计算一组资产的稳定指纹。
 * 对资产数组做稳定排序（按 id）后逐个序列化，保证幂等：
 * - 同一组资产无论顺序如何，指纹一致；
 * - 资产未变化时指纹不变，可用于短路（不触发 store/后端写入）。
 */
export function assetsFingerprint(assets: ReleaseAsset[] | undefined): string {
  if (!Array.isArray(assets) || assets.length === 0) return '';
  const sorted = [...assets].sort((a, b) => a.id - b.id);
  return sorted.map(assetFingerprint).join('|');
}

/**
 * 判断两组资产的指纹是否一致（即资产是否发生变化）。
 * 用于增量刷新时判断已存在 Release 的资产是否需要更新。
 */
export function hasAssetsChanged(
  current: ReleaseAsset[] | undefined,
  incoming: ReleaseAsset[] | undefined
): boolean {
  return assetsFingerprint(current) !== assetsFingerprint(incoming);
}

/**
 * 返回相对本地资产集合新增或发生变化的资产 ID。
 * 资产被删除时没有可展示的资产行，因此不会出现在返回值中；删除仍由
 * hasAssetsChanged 识别并触发 Release 整体更新。
 */
export function changedAssetIds(
  current: ReleaseAsset[] | undefined,
  incoming: ReleaseAsset[] | undefined,
): number[] {
  const currentById = new Map((current || []).map(asset => [asset.id, asset]));
  return (incoming || [])
    .filter(asset => {
      const previous = currentById.get(asset.id);
      return !previous || assetFingerprint(previous) !== assetFingerprint(asset);
    })
    .map(asset => asset.id);
}

/**
 * 从最新拉取的 Release 中筛出“相对本地已变化”的条目。
 * 只比对本地已存在 id 的 Release（新增条目由调用方 addReleases 处理）；
 * 触发条件为资产指纹变化 **或** 发布内容（body/name/tag_name）变化：
 * 增量同步按 published_at 水印只拉取新 Release，已存在 Release 的 body 若在
 * 首次同步时为空（或上游事后补了 release notes）将永远得不到更新，导致
 * 日志/总结按钮缺失。最新 Release 的完整对象在每次刷新都会重新拉取，
 * 因此在这里顺带比对 body，保证空日志能被回填。
 * 无任何变化则跳过，保证幂等，避免重复触发 store/后端写入。
 * 供刷新入口（ReleaseTimeline.handleRefresh）与测试复用。
 */
export function findReleasesWithChangedAssets(
  latestReleases: Release[] | undefined,
  currentReleases: Release[]
): Release[] {
  const byId = new Map(currentReleases.map(r => [r.id, r]));
  return (latestReleases || []).flatMap((latest) => {
    const local = byId.get(latest.id);
    if (!local) return [];
    const assetsChanged = hasAssetsChanged(local.assets, latest.assets);
    // body 可能为 null/''：统一按空字符串比对，避免 null 与 '' 的抖动；
    // name 同理归一化（后端旧数据可能存 null，而 API 层回退为 tag_name）。
    const bodyChanged = (local.body ?? '') !== (latest.body ?? '');
    const metaChanged =
      (local.name ?? '') !== (latest.name ?? '') || local.tag_name !== latest.tag_name;
    if (!assetsChanged && !bodyChanged && !metaChanged) return [];

    return [{
      ...latest,
      updated_asset_ids: changedAssetIds(local.assets, latest.assets),
    }];
  });
}

/**
 * 计算 Release 的有效展示时间。
 * GitHub 的 Release 对象没有 updated_at，资产变更时 published_at 不会变化；
 * 资产更新时间已包含在 assets[].updated_at 中（每次替换/重传都会更新）。
 * 取 published_at 与所有资产 updated_at 中的较新者，作为用户可见的更新时间。
 * 返回标准化 ISO 字符串（toISOString），保证不同时间戳格式（含/不含毫秒）可稳定比较。
 */
export function effectiveReleaseTime(release: Pick<Release, 'published_at' | 'assets'>): string {
  let latest = new Date(release.published_at).getTime();
  if (Array.isArray(release.assets)) {
    for (const asset of release.assets) {
      const assetTime = new Date(asset.updated_at).getTime();
      if (!Number.isNaN(assetTime) && assetTime > latest) {
        latest = assetTime;
      }
    }
  }
  return new Date(latest).toISOString();
}

/**
 * 在一组 Release 中找到有效更新时间最新的条目。
 *
 * 仓库分类视图展示的是多个 Release，但仓库容器的更新时间应反映
 * 所有可见条目中的最新发布时间或资产更新时间，而不是只看最新发布的版本。
 * 对发布时间无效的条目跳过，避免单条损坏数据阻断整个仓库分组的渲染。
 */
export function latestEffectiveRelease<T extends Pick<Release, 'published_at' | 'assets'>>(
  releases: readonly T[],
): T | null {
  let latestRelease: T | null = null;
  let latestTime = -Infinity;

  for (const release of releases) {
    if (Number.isNaN(new Date(release.published_at).getTime())) {
      continue;
    }

    const effectiveTime = new Date(effectiveReleaseTime(release)).getTime();
    if (!Number.isNaN(effectiveTime) && effectiveTime > latestTime) {
      latestRelease = release;
      latestTime = effectiveTime;
    }
  }

  return latestRelease;
}

/**
 * 判断 Release 容器是否应展示“资产已更新”标识。
 *
 * 唯一事实来源是 `updated_asset_ids`：它只在增量刷新发现“资产相对上次拉取发生了变化”
 * 时由 findReleasesWithChangedAssets 写入，且随用户逐条点击资产或点击 Release 而清除。
 * 不能用“资产 updated_at 晚于 published_at”推断——GitHub 上资产几乎总是在 Release
 * 创建之后上传的，该条件对大多数 Release 恒为真，会造成大面积误报。
 */
export function shouldShowAssetsUpdatedIndicator(
  release: Pick<Release, 'updated_asset_ids'>
): boolean {
  return (release.updated_asset_ids?.length ?? 0) > 0;
}

/**
 * 资产所属平台（与 platformMeta 的平台键一致，可直接取品牌图标）。
 */
export type AssetPlatform = 'macos' | 'windows' | 'linux' | 'android' | 'ios' | 'docker';

/**
 * 平台推断规则（detectAssetPlatform）按四层依次判定，命中即返回：
 *
 * 1. 决定性扩展名 —— 安装包/包管理器格式只属于一个平台：
 *    .dmg/.pkg/.app.tar.gz(macOS)、.exe/.msi/.msix/.appx(Windows)、
 *    .AppImage/.deb/.rpm/.snap/.flatpak/.pkg.tar.zst(Arch)(Linux)、
 *    .apk/.aab(Android)、.ipa(iOS)。
 *    注意后缀按长度优先匹配：'.pkg.tar.zst' 必须先于 '.pkg' 判定，
 *    否则 Arch 包会被误判成 macOS。
 * 2. 文件名 OS 语义段 —— 覆盖 GoReleaser（{name}-{os}-{arch}）、
 *    Rust triple（x86_64-pc-windows-msvc、aarch64-apple-darwin）等主流
 *    命名约定。做法是按非字母数字分词后查词表，例如
 *    'alist-darwin-arm64.tar.gz' → [alist, darwin, arm64, tar, gz] → darwin → macos。
 *    裸二进制（无扩展名）同样适用；同文件名出现多个 OS 词时取最靠前的
 *    （命名约定中 OS 段紧跟产品名）。
 *    词表用整词匹配而非子串，天然避开 darwin 里的 win、search/archive 里的 arch。
 * 3. 架构词（arm64/aarch64/x86_64/amd64/mips…）是跨平台的，不参与判定——
 *    macOS 的 aarch64 包和 Linux 的 aarch64 包只有 OS 段不同。
 * 4. MIME 类型兜底（GitHub 常给二进制填 application/octet-stream，
 *    仅当文件名毫无线索且 content_type 有明确平台语义时生效）。
 *
 * 全部不命中返回 null：BSD（freebsd 等）刻意不映射到 Linux，宁缺毋滥。
 */

/** OS 语义词表：token → 平台。 */
export const OS_TOKEN_PLATFORM: Record<string, AssetPlatform> = {
  // macOS（含历史写法 osx 与内核名 darwin）
  macos: 'macos', mac: 'macos', osx: 'macos', darwin: 'macos', apple: 'macos',
  // Windows（win32/win64 常见于 C++ 生态，mingw 是其工具链）
  windows: 'windows', win: 'windows', win32: 'windows', win64: 'windows', mingw: 'windows',
  // Linux（发行版与 libc 变体：alpine/musl 只出现在 Linux 生态）
  linux: 'linux', ubuntu: 'linux', debian: 'linux', fedora: 'linux', redhat: 'linux',
  archlinux: 'linux', arch: 'linux', manjaro: 'linux', alpine: 'linux', musl: 'linux',
  raspberrypi: 'linux', raspbian: 'linux', nixos: 'linux',
  // 移动端
  android: 'android',
  ios: 'ios', ipados: 'ios', iphone: 'ios',
  // 容器镜像（docker save 导出的 tar 等）
  docker: 'docker',
};

/** 决定性扩展名 → 平台；使用时按后缀长度降序逐个 endsWith。 */
const PLATFORM_EXTENSIONS: ReadonlyArray<readonly [suffix: string, platform: AssetPlatform]> = ([
  ['.app.tar.gz', 'macos'], ['.app.zip', 'macos'],
  ['.dmg', 'macos'], ['.pkg', 'macos'],
  ['.exe', 'windows'], ['.msi', 'windows'], ['.msix', 'windows'],
  ['.appx', 'windows'], ['.appxbundle', 'windows'],
  ['.appinstaller', 'windows'], ['.msibundle', 'windows'],
  ['.appimage', 'linux'], ['.flatpak', 'linux'], ['.snap', 'linux'],
  ['.deb', 'linux'], ['.rpm', 'linux'],
  ['.pkg.tar.zst', 'linux'], ['.pkg.tar.xz', 'linux'],
  ['.apk', 'android'], ['.aab', 'android'], ['.apks', 'android'],
  ['.ipa', 'ios'],
] as Array<[string, AssetPlatform]>).sort((a, b) => b[0].length - a[0].length);

/** content_type 中的平台语义片段 → 平台。 */
const CONTENT_TYPE_PLATFORM: ReadonlyArray<readonly [pattern: RegExp, platform: AssetPlatform]> = [
  [/android\.package-archive/, 'android'],
  [/apple-diskimage/, 'macos'],
  [/x-msdownload|x-msi|x-ms-installer/, 'windows'],
  [/x-deb|redhat-package-manager|x-rpm/, 'linux'],
];

/** 把文件名切成小写语义 token；分隔符为字母数字以外的任意字符。 */
function tokenize(name: string): string[] {
  return name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * 根据资产文件名（可选 content_type）推断其所属平台。
 * 分层规则见上方 AssetPlatform 注释；全部不命中时返回 null，
 * 调用方应隐藏平台标识而不是猜测。
 */
export function detectAssetPlatform(fileName: string, contentType?: string): AssetPlatform | null {
  const name = fileName.toLowerCase();

  // 第 1 层：决定性扩展名（长后缀优先，避免 .pkg 吞掉 .pkg.tar.zst）
  for (const [suffix, platform] of PLATFORM_EXTENSIONS) {
    if (name.endsWith(suffix)) {
      return platform;
    }
  }

  // 第 2 层：文件名 OS 语义段（裸二进制同样适用；多 OS 词取最靠前者）
  const tokens = tokenize(fileName);
  for (let i = 0; i < tokens.length; i++) {
    const platform = OS_TOKEN_PLATFORM[tokens[i]];
    if (platform) {
      return platform;
    }
  }

  // 第 3/4 层：MIME 兜底（架构词不参与判定）
  if (contentType) {
    const type = contentType.toLowerCase();
    for (const [pattern, platform] of CONTENT_TYPE_PLATFORM) {
      if (pattern.test(type)) {
        return platform;
      }
    }
  }

  return null;
}
