/**
 * Installable Asset Detection 模型。
 *
 * 目标：统一回答「这个 Release 里哪一个资产可以在当前设备上安装」，
 * 供 Release 视图、Discovery、My Apps、AI、MCP 与插件复用同一份结果。
 *
 * 边界（roadmap §5.3）：
 * - 只做**识别**。不下载后执行、不自动选择来源不明的第三方镜像。
 * - 不因为扩展名像安装包就断言软件安全。
 * - 不确定时给出多个候选，而不是伪装成唯一正确答案。
 * - 用户始终可以手动选择其他 Release Asset。
 */

/** 当前支持识别的目标平台。 */
export type InstallablePlatform = 'windows' | 'macos' | 'linux' | 'android';

/** 设备/资产的 CPU 架构；`universal` 表示单一产物覆盖多种架构。 */
export type InstallableArchitecture = 'x64' | 'arm64' | 'x86' | 'universal';

/** 支持识别的安装包类型。 */
export type InstallablePackageType =
  | 'exe'
  | 'msi'
  | 'zip'
  | '7z'
  | 'dmg'
  | 'pkg'
  | 'deb'
  | 'rpm'
  | 'appimage'
  | 'tar.gz'
  | 'apk'
  | 'aab';

/**
 * 识别置信度。
 * - `high`：安装包类型与平台由决定性扩展名确定，且平台与目标平台一致。
 * - `medium`：安装包类型确定，平台靠文件名语义词推断，或架构无法确定。
 * - `low`：只能作为候选（例如通用 `.zip`、缺少平台标记的裸压缩包）。
 */
export type InstallableConfidence = 'high' | 'medium' | 'low';

export interface InstallableAsset {
  assetId: number;
  fileName: string;
  downloadUrl: string;
  size: number;

  platform: InstallablePlatform;
  architecture?: InstallableArchitecture;
  packageType: InstallablePackageType;

  confidence: InstallableConfidence;
  /** 人类可读的判定依据，用于向用户解释「为什么推荐这个」。 */
  reason: string;
}

/** 识别结果：候选按置信度与资产顺序稳定排序。 */
export interface InstallableAssetDetectionResult {
  /** 与目标平台匹配的候选（可能多于一个——不确定时并列展示）。 */
  matches: InstallableAsset[];
  /**
   * 被显式排除的资产及其原因（source code、checksum、signature、symbols、debug、
   * source archive、blockmap、非目标平台等）。用于回答「为什么某个资产没出现」。
   */
  excluded: Array<{ assetId: number; fileName: string; reason: string }>;
}

/** 识别上下文。默认取当前设备，测试可显式注入。 */
export interface InstallableAssetDetectionOptions {
  /** 目标平台；省略时表示「不按平台过滤」，返回所有平台的候选。 */
  platform?: InstallablePlatform;
  /** 目标架构；省略时不做架构过滤（架构信息仍会解析出来）。 */
  architecture?: InstallableArchitecture;
  /** AAB 只识别、不作为可直接安装的推荐（Android）。 */
  includeDetectOnly?: boolean;
}
