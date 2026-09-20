/**
 * My Apps（开发守则 §3）领域模型：把「本机安装的某个软件」与「已收藏的仓库」建立手动关联，
 * 用于记录用户当前装的是哪个版本，并与仓库的最新 Release 做本地比较。
 *
 * 本阶段（1a）的硬边界：
 * - 不执行安装器、不做静默安装/更新、不做通用卸载、不做降级、不申请系统权限。
 * - 不做本机软件扫描（那是 §19，排在 My Apps 稳定之后），所以 `linkSource` 目前只会是
 *   `'manual'`；`'detected'` 预留给后续的检测流程。
 * - 解除关联只删除这条本地记录，不动用户磁盘上的任何文件。
 */

/** 软件运行的平台。手动关联时由用户选择，`unknown` 是保守默认值。 */
export type LinkedApplicationPlatform = 'windows' | 'macos' | 'linux' | 'other' | 'unknown';

/** 软件运行的 CPU 架构。未知时留空（`architecture` 可选）或显式 `unknown`。 */
export type LinkedApplicationArchitecture = 'x64' | 'arm64' | 'x86' | 'arm' | 'unknown';

/** 关联来源。1a 只产生 `manual`；`detected` 留给 §19 的本机软件检测。 */
export type LinkedApplicationLinkSource = 'manual' | 'detected';

export interface LinkedApplication {
  /** 本地记录 id，与仓库无耦合（同一仓库只允许一条记录）。 */
  id: string;
  /** 关联的仓库全名（`owner/repo`）。去重与匹配统一按小写比较。 */
  repositoryFullName: string;
  /** 用户可见名称；默认取仓库名，用户可改。 */
  displayName: string;
  /** 用户当前安装的版本；未知时为 null（不猜）。 */
  installedVersion: string | null;
  /** 可选的安装路径，仅作为用户笔记保存，不会被读写文件。 */
  installPath?: string;
  platform: LinkedApplicationPlatform;
  architecture?: LinkedApplicationArchitecture;
  linkSource: LinkedApplicationLinkSource;
  /** 是否把预发布版本也纳入「最新版本」的比较。 */
  includePrereleases: boolean;
  /** 最近一次在界面上查询 Release 的时间（ISO 字符串）。 */
  lastCheckedAt?: string;
  /** 仓库来源地址（GitHub 页面），用于展示「来源」。 */
  repositorySourceUrl: string;
  /** 关联时间（ISO 字符串）。 */
  linkedAt: string;
}

/** 平台选项顺序即 UI 下拉顺序。 */
export const LINKED_APPLICATION_PLATFORMS: readonly LinkedApplicationPlatform[] = [
  'windows',
  'macos',
  'linux',
  'other',
  'unknown',
];

/** 架构选项顺序即 UI 下拉顺序。 */
export const LINKED_APPLICATION_ARCHITECTURES: readonly LinkedApplicationArchitecture[] = [
  'x64',
  'arm64',
  'x86',
  'arm',
  'unknown',
];

/** 可由用户编辑的字段（`id`/`linkedAt`/`repositoryFullName` 一经创建不可改）。 */
export type LinkedApplicationEditablePatch = Partial<
  Pick<
    LinkedApplication,
    | 'displayName'
    | 'installedVersion'
    | 'installPath'
    | 'platform'
    | 'architecture'
    | 'includePrereleases'
  >
>;

/** 创建一条关联记录所需的输入（其余元数据由纯工厂补齐）。 */
export interface CreateLinkedApplicationInput {
  repositoryFullName: string;
  repositorySourceUrl?: string;
  displayName?: string;
  installedVersion?: string | null;
  installPath?: string;
  platform?: LinkedApplicationPlatform;
  architecture?: LinkedApplicationArchitecture;
  includePrereleases?: boolean;
  linkSource?: LinkedApplicationLinkSource;
}
