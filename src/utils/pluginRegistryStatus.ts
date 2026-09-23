import type { PluginRegistry, PluginRegistryEntry, PluginRemovalEntry } from '../services/pluginRegistryService';

export type PluginRegistryStatus =
  | 'update-available'
  | 'up-to-date'
  | 'revoked'
  | 'blocked'
  | 'version-unknown'
  | 'not-in-registry';

export interface PluginPermissionDiff {
  /** 目标版本要求、而现在没有授予的权限——这是必须重新征求用户同意的那部分。 */
  added: string[];
  removed: string[];
}

export interface PluginRegistryAssessment {
  pluginId: string;
  installedVersion: string;
  status: PluginRegistryStatus;
  latestVersion: string | null;
  permissionDiff: PluginPermissionDiff;
  /** 撤销/拉黑时的原因。 */
  reason: string | null;
  /** 目标版本的数据用途说明（审核时写下的那句话）。 */
  dataUsage: string | null;
  removedAction: PluginRemovalEntry['action'] | null;
}

export interface InstalledPluginForRegistry {
  id: string;
  version: string;
  /** 当前生效的授权；缺失时退回 manifest 声明的权限。 */
  grantedPermissions?: string[];
  declaredPermissions?: string[];
}

const compareNumericIdentifiers = (left: string, right: string): number => {
  const a = left.replace(/^0+(?=\d)/, '');
  const b = right.replace(/^0+(?=\d)/, '');
  if (a.length !== b.length) return a.length > b.length ? 1 : -1;
  return a === b ? 0 : (a > b ? 1 : -1);
};

/** 语义化版本比较；无法解析时返回 NaN，调用者须单独处理。 */
export const comparePluginVersions = (left: string, right: string): number => {
  const parse = (value: string) => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(String(value).trim());
    return match ? { numbers: [match[1], match[2], match[3]], prerelease: match[4] ?? null } : null;
  };
  const a = parse(left);
  const b = parse(right);
  if (!a || !b) return NaN;
  for (let index = 0; index < 3; index += 1) {
    const comparison = compareNumericIdentifiers(a.numbers[index], b.numbers[index]);
    if (comparison !== 0) return comparison;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;
  const leftParts = a.prerelease.split('.');
  const rightParts = b.prerelease.split('.');
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const x = leftParts[index];
    const y = rightParts[index];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const xNumeric = /^\d+$/.test(x);
    const yNumeric = /^\d+$/.test(y);
    if (xNumeric && yNumeric) {
      const comparison = compareNumericIdentifiers(x, y);
      if (comparison !== 0) return comparison;
      continue;
    }
    if (xNumeric !== yNumeric) return xNumeric ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
};

const computePermissionDiff = (next: string[], current: string[]): PluginPermissionDiff => {
  const currentSet = new Set(current);
  const nextSet = new Set(next);
  return {
    added: next.filter((permission) => !currentSet.has(permission)),
    removed: current.filter((permission) => !nextSet.has(permission)),
  };
};

const REMOVAL_ACTION_PRIORITY: Record<PluginRemovalEntry['action'], number> = {
  revoke: 2,
  block: 1,
};

const findRemoval = (removed: PluginRemovalEntry[], pluginId: string, version: string): PluginRemovalEntry | null => (
  removed
    .filter((candidate) => (
      candidate.id === pluginId
      && (candidate.versions.length === 0 || candidate.versions.includes(version))
    ))
    .sort((left, right) => (
      REMOVAL_ACTION_PRIORITY[right.action] - REMOVAL_ACTION_PRIORITY[left.action]
      || right.date.localeCompare(left.date)
    ))[0] ?? null
);

/** 客户端支持的 Plugin API 版本；注册表里声明别的版本的条目一律不采用。 */
const SUPPORTED_API_VERSIONS = new Set(['1']);

/** 取"客户端支持的最高版本"——不是注册表里的最新版本。 */
export const pickInstallableEntry = (versions: PluginRegistryEntry[]): PluginRegistryEntry | null => {
  const compatible = versions
    .filter((entry) => SUPPORTED_API_VERSIONS.has(entry.apiVersion) && !Number.isNaN(comparePluginVersions(entry.version, entry.version)))
    .sort((left, right) => comparePluginVersions(right.version, left.version));
  return compatible[0] ?? null;
};

/**
 * 把已安装插件与注册表对照，得出每个插件的状态。
 *
 * 只做判断，不触发任何动作：撤销/拉黑只是提示与依据，停用与否由用户点。权限差异算的是
 * **目标版本相对"当前已授予"** 多出来的那部分——那正是需要重新征求同意的部分。
 */
export const assessInstalledPlugins = (
  installed: InstalledPluginForRegistry[],
  registry: PluginRegistry | null,
): PluginRegistryAssessment[] => {
  return installed.map((plugin) => {
    const base: PluginRegistryAssessment = {
      pluginId: plugin.id,
      installedVersion: plugin.version,
      status: 'not-in-registry',
      latestVersion: null,
      permissionDiff: { added: [], removed: [] },
      reason: null,
      dataUsage: null,
      removedAction: null,
    };
    if (!registry) return base;

    const removal = findRemoval(registry.removed, plugin.id, plugin.version);
    if (removal) {
      return {
        ...base,
        status: removal.action === 'revoke' ? 'revoked' : 'blocked',
        reason: removal.reason,
        removedAction: removal.action,
      };
    }

    const group = registry.plugins.find((candidate) => candidate.id === plugin.id);
    if (!group) return base;

    const entry = pickInstallableEntry(group.versions);
    if (!entry) return base;

    const current = plugin.grantedPermissions ?? plugin.declaredPermissions ?? [];
    const permissionDiff = computePermissionDiff(entry.permissions, current);
    const versionComparison = comparePluginVersions(entry.version, plugin.version);
    if (Number.isNaN(versionComparison)) {
      return { ...base, status: 'version-unknown', latestVersion: entry.version, dataUsage: entry.dataUsage };
    }
    const hasUpdate = versionComparison > 0;

    return {
      ...base,
      status: hasUpdate ? 'update-available' : 'up-to-date',
      latestVersion: entry.version,
      permissionDiff,
      dataUsage: entry.dataUsage,
    };
  });
};
