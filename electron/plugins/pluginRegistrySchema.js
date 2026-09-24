'use strict';

/**
 * 社区插件注册表的校验（开发守则 §17 / §18）。
 *
 * 注册表是从网络拿到的 JSON：**一条坏记录不能拖垮整个列表**——逐条校验，坏的丢弃并带上
 * 原因，好的照常返回。字段与取值域与 `registry/schemas/*.schema.json` 保持一致。
 */

const PLUGIN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,126}[A-Za-z0-9]$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HOST_RE = /^[a-z0-9.-]+$/;
const SUPPORTED_API_VERSIONS = new Set(['1']);

/** 与 manifestSchema 的权限枚举保持一致；注册表里出现未知权限就拒绝该条。 */
const PLUGIN_PERMISSIONS = new Set([
  'repositories:read',
  'repositories:write',
  'privateRepositories:read',
  'releases:read',
  'gists:read',
  'storage',
  'clipboard:write',
  'external:open',
  'ai:invoke',
  'web:search',
  'downloads:create',
  'network:fetch',
]);

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isHttpsGitHubUrl = (value) => {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && url.hostname.toLowerCase() === 'github.com';
  } catch {
    return false;
  }
};

/**
 * 校验一条插件注册记录。
 * @returns {{ ok: true, value: object } | { ok: false, code: string, message: string }}
 */
function validateRegistryEntry(value) {
  if (!isPlainObject(value)) return { ok: false, code: 'REGISTRY_ENTRY_INVALID', message: 'Entry is not an object' };

  if (typeof value.id !== 'string' || !PLUGIN_ID_RE.test(value.id)) {
    return { ok: false, code: 'REGISTRY_ID_INVALID', message: "Field 'id' is not a valid plugin id" };
  }
  if (typeof value.version !== 'string' || !SEMVER_RE.test(value.version)) {
    return { ok: false, code: 'REGISTRY_VERSION_INVALID', message: "Field 'version' is not a semantic version" };
  }
  if (typeof value.apiVersion !== 'string' || !SUPPORTED_API_VERSIONS.has(value.apiVersion)) {
    return { ok: false, code: 'REGISTRY_API_VERSION_UNSUPPORTED', message: "Field 'apiVersion' is not supported" };
  }
  if (!isHttpsGitHubUrl(value.source)) {
    return { ok: false, code: 'REGISTRY_SOURCE_INVALID', message: "Field 'source' must be an https github.com URL" };
  }
  if (!isHttpsGitHubUrl(value.releaseUrl)) {
    return { ok: false, code: 'REGISTRY_RELEASE_URL_INVALID', message: "Field 'releaseUrl' must be an https github.com URL" };
  }
  if (typeof value.sha256 !== 'string' || !SHA256_RE.test(value.sha256)) {
    return { ok: false, code: 'REGISTRY_SHA256_INVALID', message: "Field 'sha256' must be a lowercase hex digest" };
  }
  if (!Array.isArray(value.permissions) || !value.permissions.every((permission) => PLUGIN_PERMISSIONS.has(permission))) {
    return { ok: false, code: 'REGISTRY_PERMISSIONS_INVALID', message: "Field 'permissions' contains an unknown permission" };
  }
  if (!Array.isArray(value.networkTargets) || !value.networkTargets.every((host) => typeof host === 'string' && HOST_RE.test(host))) {
    return { ok: false, code: 'REGISTRY_NETWORK_TARGETS_INVALID', message: "Field 'networkTargets' contains an invalid host" };
  }
  if (typeof value.dataUsage !== 'string' || value.dataUsage.trim().length < 10) {
    return { ok: false, code: 'REGISTRY_DATA_USAGE_INVALID', message: "Field 'dataUsage' must explain what leaves the device" };
  }
  if (!isPlainObject(value.review)
    || value.review.status !== 'approved'
    || typeof value.review.date !== 'string' || !DATE_RE.test(value.review.date)
    || typeof value.review.commit !== 'string' || !/^[0-9a-f]{40}$/.test(value.review.commit)) {
    return { ok: false, code: 'REGISTRY_REVIEW_INVALID', message: "Field 'review' must record an approved review with date and commit" };
  }

  return {
    ok: true,
    value: {
      id: value.id,
      version: value.version,
      apiVersion: value.apiVersion,
      source: value.source,
      releaseUrl: value.releaseUrl,
      sha256: value.sha256,
      permissions: [...value.permissions],
      networkTargets: [...value.networkTargets],
      dataUsage: value.dataUsage.trim(),
      review: { status: 'approved', date: value.review.date, commit: value.review.commit },
    },
  };
}

/** 校验一条撤销记录。 */
function validateRemovedEntry(value) {
  if (!isPlainObject(value)) return { ok: false, code: 'REGISTRY_ENTRY_INVALID', message: 'Entry is not an object' };
  if (typeof value.id !== 'string' || !PLUGIN_ID_RE.test(value.id)) {
    return { ok: false, code: 'REGISTRY_ID_INVALID', message: "Field 'id' is not a valid plugin id" };
  }
  if (!Array.isArray(value.versions) || !value.versions.every((version) => typeof version === 'string')) {
    return { ok: false, code: 'REGISTRY_VERSIONS_INVALID', message: "Field 'versions' must be an array of strings" };
  }
  if (typeof value.reason !== 'string' || value.reason.trim().length < 10) {
    return { ok: false, code: 'REGISTRY_REASON_INVALID', message: "Field 'reason' must explain the removal" };
  }
  if (typeof value.date !== 'string' || !DATE_RE.test(value.date)) {
    return { ok: false, code: 'REGISTRY_DATE_INVALID', message: "Field 'date' must be YYYY-MM-DD" };
  }
  if (value.action !== 'revoke' && value.action !== 'block') {
    return { ok: false, code: 'REGISTRY_ACTION_INVALID', message: "Field 'action' must be 'revoke' or 'block'" };
  }

  return {
    ok: true,
    value: {
      id: value.id,
      versions: [...value.versions],
      reason: value.reason.trim(),
      date: value.date,
      action: value.action,
    },
  };
}

/** 逐条校验一个数组，坏的进 `rejected`。 */
function validateList(value, validator) {
  if (!Array.isArray(value)) return { accepted: [], rejected: [{ code: 'REGISTRY_NOT_ARRAY', message: 'Registry list is not an array' }] };
  const accepted = [];
  const rejected = [];
  value.forEach((entry, index) => {
    const result = validator(entry);
    if (result.ok) accepted.push(result.value);
    else rejected.push({ index, code: result.code, message: result.message });
  });
  return { accepted, rejected };
}

module.exports = {
  PLUGIN_PERMISSIONS,
  SUPPORTED_API_VERSIONS,
  validateList,
  validateRegistryEntry,
  validateRemovedEntry,
};
