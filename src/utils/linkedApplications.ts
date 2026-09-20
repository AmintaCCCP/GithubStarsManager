/**
 * My Apps（开发守则 §3）的纯逻辑：版本解析/比较、三态判定、去重与规范化。
 *
 * 这一层刻意不碰 React、Store、网络与 DOM：My Apps 的「有没有新版本」是本地事实推导，
 * 阶段 2 的后台轮询、阶段 3 的版本选择器都会复用同一份比较规则，散在组件里就会分叉。
 *
 * 设计口径（与阶段规划一致）：
 * - 解析不出来 → `unknown`，绝不猜、不抛错。
 * - `includePrereleases === false` 时预发布版本直接不参与比较（没有可比版本 → `unknown`）。
 * - 预发布判定复用 `src/utils/repositoryHealth.ts` 的 `isPrereleaseRelease`（先信 GitHub
 *   的 prerelease 标记，再按 tag 词元兜底），避免第二套口径。
 */
import type { Release } from '../types';
import { isPrereleaseRelease } from './repositoryHealth';
import type {
  CreateLinkedApplicationInput,
  LinkedApplication,
  LinkedApplicationArchitecture,
  LinkedApplicationLinkSource,
  LinkedApplicationPlatform,
} from '../types/linkedApplication';

/** 版本比较结果。`unknown` 表示「无法判定」而不是「没有更新」。 */
export type LinkedApplicationUpdateStatus = 'update-available' | 'up-to-date' | 'unknown';

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  /** semver 预发布标识（`1.0.0-beta.1` → `['beta', '1']`）；稳定版为空数组。 */
  prerelease: string[];
  /** 原始标签，便于展示与调试。 */
  raw: string;
}

/**
 * 宽松但不含糊的版本标签解析：
 * 接受 `1.2.3` / `v1.2.3` / `1.2` / `v1` / `1.0.0-beta.1` / `1.0.0+build.7`，
 * 其余一律返回 null（例如 `nightly-2026-01-01`、`release-1.2.3`、空串）。
 */
const VERSION_PATTERN = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/i;

const toInt = (value: string | undefined): number | null => {
  if (value === undefined) return 0;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
};

export function parseVersion(raw: string | null | undefined): ParsedVersion | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const match = VERSION_PATTERN.exec(trimmed);
  if (!match) return null;
  const major = toInt(match[1]);
  const minor = toInt(match[2]);
  const patch = toInt(match[3]);
  if (major === null || minor === null || patch === null) return null;
  const prerelease = typeof match[4] === 'string'
    ? match[4].split('.').filter((identifier) => identifier.length > 0)
    : [];
  return {
    major,
    minor,
    patch,
    prerelease,
    raw: trimmed,
  };
}

/** 按 semver 2.0.0 的优先级比较两个已解析版本。 */
export function compareParsedVersions(left: ParsedVersion, right: ParsedVersion): number {
  const coreKeys = ['major', 'minor', 'patch'] as const;
  for (const key of coreKeys) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }

  // 有预发布标识的版本低于同号稳定版（1.0.0-beta.1 < 1.0.0）。
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
  if (left.prerelease.length === 0) return 1;
  if (right.prerelease.length === 0) return -1;

  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftId = left.prerelease[index];
    const rightId = right.prerelease[index];
    if (leftId === undefined) return -1;
    if (rightId === undefined) return 1;
    const leftNumeric = /^\d+$/.test(leftId);
    const rightNumeric = /^\d+$/.test(rightId);
    if (leftNumeric && rightNumeric) {
      const normalizedLeft = leftId.replace(/^0+(?=\d)/, '');
      const normalizedRight = rightId.replace(/^0+(?=\d)/, '');
      if (normalizedLeft.length !== normalizedRight.length) {
        return normalizedLeft.length < normalizedRight.length ? -1 : 1;
      }
      if (normalizedLeft !== normalizedRight) return normalizedLeft < normalizedRight ? -1 : 1;
    } else if (leftNumeric) {
      return -1;
    } else if (rightNumeric) {
      return 1;
    } else if (leftId !== rightId) {
      return leftId < rightId ? -1 : 1;
    }
  }
  return 0;
}

/**
 * 比较两个版本标签。任一解析失败返回 null，由调用方落成 `unknown`。
 */
export function compareVersionStrings(left: string | null | undefined, right: string | null | undefined): number | null {
  const parsedLeft = parseVersion(left);
  const parsedRight = parseVersion(right);
  if (!parsedLeft || !parsedRight) return null;
  return compareParsedVersions(parsedLeft, parsedRight);
}

/** 标签本身是否带预发布标识（不依赖 GitHub 的 prerelease 标记）。 */
export function isPrereleaseVersion(raw: string | null | undefined): boolean {
  const parsed = parseVersion(raw);
  return parsed !== null && parsed.prerelease.length > 0;
}

function toTimestamp(value: unknown): number | null {
  if (typeof value !== 'string' || !value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

type ReleaseLike = Pick<Release, 'tag_name' | 'published_at'> & { prerelease?: boolean };

/**
 * 取「最新版本」对应的 Release。
 *
 * 排序优先按版本号（可解析时），标签不可解析才退回发布时间，避免 `v1.10.0` 被
 * `v1.9.0` 盖掉；同版本（或都不可解析）再按发布时间降序。
 * `includePrereleases === false` 时先剔除预发布条目（含 tag 词元兜底）。
 */
export function selectLatestRelease<T extends ReleaseLike>(
  releases: readonly T[] | null | undefined,
  includePrereleases: boolean,
): T | null {
  const candidates = (releases ?? []).filter(
    (release) => includePrereleases
      || (!isPrereleaseRelease(release) && !isPrereleaseVersion(release.tag_name)),
  );
  if (candidates.length === 0) return null;

  return candidates.slice().sort((left, right) => {
    const leftVersion = parseVersion(left.tag_name);
    const rightVersion = parseVersion(right.tag_name);
    if (leftVersion && !rightVersion) return -1;
    if (!leftVersion && rightVersion) return 1;
    if (leftVersion && rightVersion) {
      const byVersion = compareParsedVersions(rightVersion, leftVersion);
      if (byVersion !== 0) return byVersion;
    }
    const leftTime = toTimestamp(left.published_at) ?? 0;
    const rightTime = toTimestamp(right.published_at) ?? 0;
    return rightTime - leftTime;
  })[0];
}

export interface ResolveUpdateStatusInput {
  installedVersion: string | null | undefined;
  /** 候选最新 Release；null/undefined 表示还没查到或仓库没有 Release。 */
  latestRelease: ReleaseLike | null | undefined;
  includePrereleases: boolean;
}

/**
 * 三态判定：`update-available` / `up-to-date` / `unknown`。
 * 任何一处无法可靠解析都落回 `unknown`——阶段 2 明确要求 API 失败或版本不可解析时
 * 不得显示成「无更新」。
 */
export function resolveLinkedApplicationUpdateStatus({
  installedVersion,
  latestRelease,
  includePrereleases,
}: ResolveUpdateStatusInput): LinkedApplicationUpdateStatus {
  const installed = parseVersion(installedVersion);
  if (!installed) return 'unknown';
  if (!latestRelease) return 'unknown';
  if (!includePrereleases
    && (isPrereleaseRelease(latestRelease) || isPrereleaseVersion(latestRelease.tag_name))) {
    return 'unknown';
  }
  const latest = parseVersion(latestRelease.tag_name);
  if (!latest) return 'unknown';
  return compareParsedVersions(latest, installed) > 0 ? 'update-available' : 'up-to-date';
}

/** 仓库全名的规范化展示值（去首尾空格，保留原始大小写）。 */
export function normalizeRepositoryFullName(value: unknown): string {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,99})\/[A-Za-z0-9_.-]{1,100}$/.test(normalized)
    ? normalized
    : '';
}

/** 去重与匹配用的稳定 key。 */
export function repositoryFullNameKey(value: unknown): string {
  return normalizeRepositoryFullName(value).toLowerCase();
}

/** 仅凭仓库名拼出的来源地址；调用方有 html_url 时应优先传真实的那个。 */
export function buildRepositorySourceUrl(fullName: string): string {
  const normalized = normalizeRepositoryFullName(fullName);
  return normalized ? `https://github.com/${normalized}` : '';
}

/** Keep only HTTPS github.com URLs that point at the linked repository. */
export function normalizeRepositorySourceUrl(value: unknown, fullName: string): string {
  const fallback = buildRepositorySourceUrl(fullName);
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    const url = new URL(value.trim());
    const [owner, repository] = url.pathname.split('/').filter(Boolean);
    if (
      url.protocol !== 'https:'
      || url.hostname.toLowerCase() !== 'github.com'
      || url.username
      || url.password
      || repositoryFullNameKey(`${owner ?? ''}/${repository ?? ''}`) !== repositoryFullNameKey(fullName)
    ) {
      return fallback;
    }
    return value.trim();
  } catch {
    return fallback;
  }
}

const PLATFORMS: readonly LinkedApplicationPlatform[] = ['windows', 'macos', 'linux', 'other', 'unknown'];
const ARCHITECTURES: readonly LinkedApplicationArchitecture[] = ['x64', 'arm64', 'x86', 'arm', 'unknown'];
const LINK_SOURCES: readonly LinkedApplicationLinkSource[] = ['manual', 'detected'];

const isPlatform = (value: unknown): value is LinkedApplicationPlatform =>
  typeof value === 'string' && (PLATFORMS as readonly string[]).includes(value);

const isArchitecture = (value: unknown): value is LinkedApplicationArchitecture =>
  typeof value === 'string' && (ARCHITECTURES as readonly string[]).includes(value);

const isLinkSource = (value: unknown): value is LinkedApplicationLinkSource =>
  typeof value === 'string' && (LINK_SOURCES as readonly string[]).includes(value);

/** 按当前设备的 userAgent 猜测平台，只作为手动关联表单的默认值（用户可改）。 */
export function detectPlatformFromUserAgent(userAgent: unknown): LinkedApplicationPlatform {
  if (typeof userAgent !== 'string' || !userAgent) return 'unknown';
  const ua = userAgent.toLowerCase();
  if (/android|iphone|ipad|ipod/.test(ua)) return 'other';
  if (/windows|win32|win64/.test(ua)) return 'windows';
  if (/macintosh|mac os x|darwin/.test(ua)) return 'macos';
  if (/linux|x11|cros/.test(ua)) return 'linux';
  return 'unknown';
}

/**
 * 把任意来源的数据收敛成合法的 `LinkedApplication`；缺关键字段（id / 仓库名）时返回 null。
 * migrate、hydration 与 store 写入都走它，保证旧快照与脏数据不会把非法记录带进内存。
 */
export function normalizeLinkedApplication(value: unknown): LinkedApplication | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;

  const id = typeof record.id === 'string' ? record.id.trim() : '';
  const repositoryFullName = normalizeRepositoryFullName(record.repositoryFullName);
  if (!id || !repositoryFullName) return null;

  // 时间缺失时留空串（界面显示为「—」），不伪造一个具体时间；空串再跑一遍仍是空串，幂等。
  const linkedAt = typeof record.linkedAt === 'string' && toTimestamp(record.linkedAt) !== null
    ? record.linkedAt
    : '';

  const normalized: LinkedApplication = {
    id,
    repositoryFullName,
    displayName: typeof record.displayName === 'string' && record.displayName.trim()
      ? record.displayName.trim()
      : repositoryFullName.split('/').pop() || repositoryFullName,
    installedVersion: typeof record.installedVersion === 'string' && record.installedVersion.trim()
      ? record.installedVersion.trim()
      : null,
    platform: isPlatform(record.platform) ? record.platform : 'unknown',
    linkSource: isLinkSource(record.linkSource) ? record.linkSource : 'manual',
    includePrereleases: record.includePrereleases === true,
    repositorySourceUrl: normalizeRepositorySourceUrl(record.repositorySourceUrl, repositoryFullName),
    linkedAt,
  };

  if (typeof record.installPath === 'string' && record.installPath.trim()) {
    normalized.installPath = record.installPath.trim();
  }
  if (isArchitecture(record.architecture)) {
    normalized.architecture = record.architecture;
  }
  if (typeof record.lastCheckedAt === 'string' && toTimestamp(record.lastCheckedAt) !== null) {
    normalized.lastCheckedAt = record.lastCheckedAt;
  }

  return normalized;
}

/** 逐条规范化并丢弃非法项；非数组输入返回空数组。 */
export function normalizeLinkedApplications(value: unknown): LinkedApplication[] {
  if (!Array.isArray(value)) return [];
  return dedupeLinkedApplications(
    value
      .map((entry) => normalizeLinkedApplication(entry))
      .filter((entry): entry is LinkedApplication => entry !== null),
  );
}

/**
 * 按 `repositoryFullName`（小写比较）去重，保留数组中先出现的那条。
 * 同一仓库在同一时刻只允许一条关联记录：重复关联由上层提示，而不是静默合并。
 */
export function dedupeLinkedApplications(applications: readonly LinkedApplication[]): LinkedApplication[] {
  const seen = new Set<string>();
  const result: LinkedApplication[] = [];
  for (const application of applications) {
    const key = repositoryFullNameKey(application.repositoryFullName);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(application);
  }
  return result;
}

/** 生成记录 id；优先用 `crypto.randomUUID`，缺失时退回时间戳+随机串。 */
export function createLinkedApplicationId(): string {
  const cryptoApi = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  return `linked-app-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 纯工厂：把用户输入补成完整记录。时间与 id 由调用方注入，便于单测与幂等断言。
 */
export function createLinkedApplication(
  input: CreateLinkedApplicationInput,
  options: { id: string; now: string },
): LinkedApplication {
  const repositoryFullName = normalizeRepositoryFullName(input.repositoryFullName);
  const displayName = typeof input.displayName === 'string' && input.displayName.trim()
    ? input.displayName.trim()
    : repositoryFullName.split('/').pop() || repositoryFullName;
  const installedVersion = typeof input.installedVersion === 'string' && input.installedVersion.trim()
    ? input.installedVersion.trim()
    : null;

  const application: LinkedApplication = {
    id: options.id,
    repositoryFullName,
    displayName,
    installedVersion,
    platform: isPlatform(input.platform) ? input.platform : 'unknown',
    linkSource: isLinkSource(input.linkSource) ? input.linkSource : 'manual',
    // 默认只跟踪稳定版：把预发布当"有新版本"会让更新提示变得不可信，用户想跟预发布
    // 可以单独打开这个开关。
    includePrereleases: input.includePrereleases === true,
    repositorySourceUrl: normalizeRepositorySourceUrl(input.repositorySourceUrl, repositoryFullName),
    linkedAt: options.now,
  };

  if (typeof input.installPath === 'string' && input.installPath.trim()) {
    application.installPath = input.installPath.trim();
  }
  if (isArchitecture(input.architecture)) {
    application.architecture = input.architecture;
  }

  return application;
}
