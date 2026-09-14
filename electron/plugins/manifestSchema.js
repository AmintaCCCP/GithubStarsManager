'use strict';

const MANIFEST_VERSION = 1;
const PLUGIN_API_VERSION = '1';
const MAX_MANIFEST_BYTES = 256 * 1024;
const FIELDS = new Set([
  'manifestVersion', 'apiVersion', 'id', 'name', 'version', 'description',
  'author', 'main', 'permissions', 'contributes',
]);
const PERMISSIONS = new Set([
  'repositories:read', 'repositories:write', 'privateRepositories:read',
  'releases:read', 'gists:read', 'storage', 'clipboard:write', 'external:open',
]);
const ID_RE = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/;
const CONTRIBUTION_ID_RE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const CONTRIBUTIONS = {
  repositoryActions: { fields: ['id', 'title', 'icon', 'placement'], required: ['id', 'title', 'placement'] },
  repositoryProcessors: { fields: ['id', 'title'], required: ['id', 'title'] },
  exporters: { fields: ['id', 'title', 'fileExtension', 'mimeType'], required: ['id', 'title', 'fileExtension', 'mimeType'] },
};
const SEMVER_RE = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function failure(code, message) {
  return { success: false, code, message };
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateContributions(contributes, permissions) {
  for (const [kind, items] of Object.entries(contributes)) {
    if (!Object.hasOwn(CONTRIBUTIONS, kind)) {
      return failure('MANIFEST_UNKNOWN_FIELD', `Unknown contribution type '${kind}'`);
    }
    const schema = CONTRIBUTIONS[kind];
    if (!Array.isArray(items)) return failure('MANIFEST_FIELD_INVALID', `Contribution '${kind}' must be an array`);
    if (items.length > 0 && !permissions.has('repositories:read')) {
      return failure('MANIFEST_PERMISSION_REQUIRED', "Repository contributions require 'repositories:read'");
    }
    const ids = new Set();
    for (const item of items) {
      if (!isObject(item)) return failure('MANIFEST_FIELD_INVALID', `Contribution '${kind}' must contain objects`);
      if (Object.keys(item).some((field) => !schema.fields.includes(field))) {
        return failure('MANIFEST_UNKNOWN_FIELD', `Unknown contribution field in '${kind}'`);
      }
      if (schema.required.some((field) => typeof item[field] !== 'string' || item[field].trim() === '')) {
        return failure('MANIFEST_FIELD_INVALID', `Contribution '${kind}' has a missing or invalid field`);
      }
      if (!CONTRIBUTION_ID_RE.test(item.id) || ids.has(item.id)) {
        return failure('MANIFEST_FIELD_INVALID', `Contribution '${kind}' id must be valid and unique`);
      }
      ids.add(item.id);
      if (kind === 'repositoryActions' && !['repository-card', 'bulk-toolbar'].includes(item.placement)) {
        return failure('MANIFEST_FIELD_INVALID', 'Repository action placement is unsupported');
      }
      if ('icon' in item && (typeof item.icon !== 'string' || item.icon.trim() === '')) {
        return failure('MANIFEST_FIELD_INVALID', 'Repository action icon must be a non-empty string');
      }
      if (kind === 'exporters' && (!/^\.[a-z0-9]{1,10}$/i.test(item.fileExtension) || !/^[\w.+-]+\/[\w.+-]+$/.test(item.mimeType))) {
        return failure('MANIFEST_FIELD_INVALID', 'Exporter format is invalid');
      }
    }
  }
  return null;
}

function validateManifest(input) {
  if (!isObject(input)) return failure('MANIFEST_FIELD_INVALID', 'Manifest must be an object');

  const unknown = Object.keys(input).find((field) => !FIELDS.has(field));
  if (unknown) return failure('MANIFEST_UNKNOWN_FIELD', `Unknown manifest field '${unknown}'`);

  for (const field of ['id', 'name', 'version', 'apiVersion', 'main']) {
    if (!(field in input)) return failure('MANIFEST_FIELD_REQUIRED', `Manifest field '${field}' is required`);
    if (typeof input[field] !== 'string' || input[field].trim() === '') {
      return failure('MANIFEST_FIELD_INVALID', `Manifest field '${field}' must be a non-empty string`);
    }
  }
  for (const field of ['description', 'author']) {
    if (field in input && (typeof input[field] !== 'string' || input[field].trim() === '')) {
      return failure('MANIFEST_FIELD_INVALID', `Manifest field '${field}' must be a non-empty string`);
    }
  }
  if (!('manifestVersion' in input)) {
    return failure('MANIFEST_FIELD_REQUIRED', "Manifest field 'manifestVersion' is required");
  }
  if (input.manifestVersion !== MANIFEST_VERSION) {
    return failure('MANIFEST_VERSION_UNSUPPORTED', 'Unsupported manifestVersion');
  }
  if (input.apiVersion !== PLUGIN_API_VERSION) {
    return failure('PLUGIN_API_VERSION_UNSUPPORTED', 'Unsupported apiVersion');
  }
  if (!ID_RE.test(input.id) || !SEMVER_RE.test(input.version)) {
    return failure('MANIFEST_FIELD_INVALID', 'Plugin id or version has an invalid format');
  }
  if (!Array.isArray(input.permissions)) {
    return failure('MANIFEST_FIELD_REQUIRED', "Manifest field 'permissions' must be an array");
  }
  const permissions = new Set();
  for (const permission of input.permissions) {
    if (typeof permission !== 'string' || !PERMISSIONS.has(permission)) {
      return failure('MANIFEST_PERMISSION_UNKNOWN', 'Unknown plugin permission');
    }
    if (permissions.has(permission)) {
      return failure('MANIFEST_FIELD_INVALID', 'Plugin permissions must be unique');
    }
    permissions.add(permission);
  }
  if (!isObject(input.contributes)) {
    return failure('MANIFEST_FIELD_REQUIRED', "Manifest field 'contributes' must be an object");
  }
  const contributionError = validateContributions(input.contributes, permissions);
  if (contributionError) return contributionError;

  return { success: true, data: JSON.parse(JSON.stringify(input)) };
}

module.exports = { MANIFEST_VERSION, PLUGIN_API_VERSION, MAX_MANIFEST_BYTES, validateManifest };
