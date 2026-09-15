'use strict';

const MANIFEST_VERSION = 1;
const PLUGIN_API_VERSION = '1';

const TOP_LEVEL_FIELDS = new Set([
  'manifestVersion',
  'id',
  'name',
  'version',
  'description',
  'author',
  'apiVersion',
  'main',
  'permissions',
  'contributes',
]);
const CONTRIBUTION_FIELDS = new Set(['repositoryActions', 'repositoryProcessors', 'releaseProcessors', 'exporters', 'pages']);
const REPOSITORY_ACTION_FIELDS = new Set(['id', 'title', 'icon', 'placement']);
const PROCESSOR_FIELDS = new Set(['id', 'title']);
const EXPORTER_FIELDS = new Set(['id', 'title', 'fileExtension', 'mimeType']);
const PAGE_FIELDS = new Set(['id', 'title', 'entry']);
const BASE_PERMISSIONS = new Set([
  'repositories:read',
  'repositories:write',
  'privateRepositories:read',
  'releases:read',
  'gists:read',
  'storage',
  'clipboard:write',
  'external:open',
  'downloads:create',
  'ai:invoke',
  'web:search',
]);
const PLUGIN_ID_RE = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/;
const CONTRIBUTION_ID_RE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const SEMVER_RE = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const DOMAIN_RE = /^(?=.{1,253}$)(?!-)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const MAX_MANIFEST_BYTES = 256 * 1024;

function failure(code, message) {
  return { success: false, code, message };
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function firstUnknownField(value, allowed) {
  return Object.keys(value).find((key) => !allowed.has(key));
}

function requiredString(manifest, field) {
  if (!(field in manifest)) {
    return failure('MANIFEST_FIELD_REQUIRED', `Manifest field '${field}' is required`);
  }
  if (typeof manifest[field] !== 'string' || manifest[field].trim() === '') {
    return failure('MANIFEST_FIELD_INVALID', `Manifest field '${field}' must be a non-empty string`);
  }
  return null;
}

function validatePermission(permission) {
  if (BASE_PERMISSIONS.has(permission)) return true;
  if (!permission.startsWith('network:')) return false;
  const domain = permission.slice('network:'.length);
  return DOMAIN_RE.test(domain) && domain.toLowerCase() !== 'localhost';
}

function validateRepositoryActions(actions) {
  if (!Array.isArray(actions)) {
    return failure('MANIFEST_FIELD_INVALID', "Manifest field 'contributes.repositoryActions' must be an array");
  }
  const ids = new Set();
  for (let index = 0; index < actions.length; index += 1) {
    const action = actions[index];
    const prefix = `contributes.repositoryActions[${index}]`;
    if (!isRecord(action)) {
      return failure('MANIFEST_FIELD_INVALID', `Manifest field '${prefix}' must be an object`);
    }
    const unknown = firstUnknownField(action, REPOSITORY_ACTION_FIELDS);
    if (unknown) {
      return failure('MANIFEST_UNKNOWN_FIELD', `Unknown manifest field '${prefix}.${unknown}'`);
    }
    for (const field of ['id', 'title', 'placement']) {
      if (typeof action[field] !== 'string' || action[field].trim() === '') {
        return failure('MANIFEST_FIELD_INVALID', `Manifest field '${prefix}.${field}' must be a non-empty string`);
      }
    }
    if (!CONTRIBUTION_ID_RE.test(action.id)) {
      return failure('MANIFEST_FIELD_INVALID', `Manifest field '${prefix}.id' has an invalid format`);
    }
    if (ids.has(action.id)) {
      return failure('MANIFEST_FIELD_INVALID', `Manifest field '${prefix}.id' must be unique`);
    }
    ids.add(action.id);
    if (!['repository-card', 'bulk-toolbar'].includes(action.placement)) {
      return failure('MANIFEST_FIELD_INVALID', `Manifest field '${prefix}.placement' is unsupported`);
    }
    if ('icon' in action && (typeof action.icon !== 'string' || action.icon.trim() === '')) {
      return failure('MANIFEST_FIELD_INVALID', `Manifest field '${prefix}.icon' must be a non-empty string`);
    }
  }
  return null;
}

function validatePages(pages) {
  if (!Array.isArray(pages)) {
    return failure('MANIFEST_FIELD_INVALID', "Manifest field 'contributes.pages' must be an array");
  }
  const ids = new Set();
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    const prefix = `contributes.pages[${index}]`;
    if (!isRecord(page)) {
      return failure('MANIFEST_FIELD_INVALID', `Manifest field '${prefix}' must be an object`);
    }
    const unknown = firstUnknownField(page, PAGE_FIELDS);
    if (unknown) {
      return failure('MANIFEST_UNKNOWN_FIELD', `Unknown manifest field '${prefix}.${unknown}'`);
    }
    for (const field of ['id', 'title', 'entry']) {
      if (typeof page[field] !== 'string' || page[field].trim() === '') {
        return failure('MANIFEST_FIELD_INVALID', `Manifest field '${prefix}.${field}' must be a non-empty string`);
      }
    }
    if (!page.entry.toLowerCase().endsWith('.html')) {
      return failure('MANIFEST_FIELD_INVALID', `Manifest field '${prefix}.entry' must name an HTML file`);
    }
    if (!CONTRIBUTION_ID_RE.test(page.id) || ids.has(page.id)) {
      return failure('MANIFEST_FIELD_INVALID', `Manifest field '${prefix}.id' must be valid and unique`);
    }
    ids.add(page.id);
  }
  return null;
}

function validateSimpleContributions(items, field, allowedFields, requiredFields) {
  if (!Array.isArray(items)) {
    return failure('MANIFEST_FIELD_INVALID', `Manifest field 'contributes.${field}' must be an array`);
  }
  const ids = new Set();
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const prefix = `contributes.${field}[${index}]`;
    if (!isRecord(item)) {
      return failure('MANIFEST_FIELD_INVALID', `Manifest field '${prefix}' must be an object`);
    }
    const unknown = firstUnknownField(item, allowedFields);
    if (unknown) return failure('MANIFEST_UNKNOWN_FIELD', `Unknown manifest field '${prefix}.${unknown}'`);
    for (const requiredField of requiredFields) {
      if (typeof item[requiredField] !== 'string' || item[requiredField].trim() === '') {
        return failure('MANIFEST_FIELD_INVALID', `Manifest field '${prefix}.${requiredField}' must be a non-empty string`);
      }
    }
    if (!CONTRIBUTION_ID_RE.test(item.id) || ids.has(item.id)) {
      return failure('MANIFEST_FIELD_INVALID', `Manifest field '${prefix}.id' must be valid and unique`);
    }
    ids.add(item.id);
  }
  return null;
}

function validateManifest(input) {
  if (!isRecord(input)) {
    return failure('MANIFEST_FIELD_INVALID', 'Manifest must be a JSON object');
  }

  const unknown = firstUnknownField(input, TOP_LEVEL_FIELDS);
  if (unknown) return failure('MANIFEST_UNKNOWN_FIELD', `Unknown manifest field '${unknown}'`);

  for (const field of ['id', 'name', 'version', 'apiVersion']) {
    const error = requiredString(input, field);
    if (error) return error;
  }
  if (!('manifestVersion' in input)) {
    return failure('MANIFEST_FIELD_REQUIRED', "Manifest field 'manifestVersion' is required");
  }
  if (input.manifestVersion !== MANIFEST_VERSION) {
    return failure(
      'MANIFEST_VERSION_UNSUPPORTED',
      `Unsupported manifestVersion '${input.manifestVersion}'; expected ${MANIFEST_VERSION}`
    );
  }
  if (input.apiVersion !== PLUGIN_API_VERSION) {
    return failure(
      'PLUGIN_API_VERSION_UNSUPPORTED',
      `Unsupported apiVersion '${input.apiVersion}'; expected ${PLUGIN_API_VERSION}`
    );
  }
  if (!PLUGIN_ID_RE.test(input.id)) {
    return failure('MANIFEST_FIELD_INVALID', "Manifest field 'id' has an invalid format");
  }
  if (!SEMVER_RE.test(input.version)) {
    return failure('MANIFEST_FIELD_INVALID', "Manifest field 'version' must use semantic versioning");
  }
  for (const field of ['description', 'author', 'main']) {
    if (field in input && (typeof input[field] !== 'string' || input[field].trim() === '')) {
      return failure('MANIFEST_FIELD_INVALID', `Manifest field '${field}' must be a non-empty string`);
    }
  }

  if (!Array.isArray(input.permissions)) {
    return failure('MANIFEST_FIELD_REQUIRED', "Manifest field 'permissions' is required and must be an array");
  }
  const permissions = new Set();
  for (const permission of input.permissions) {
    if (typeof permission !== 'string' || !validatePermission(permission)) {
      return failure('MANIFEST_PERMISSION_UNKNOWN', `Unknown plugin permission '${String(permission)}'`);
    }
    if (permissions.has(permission)) {
      return failure('MANIFEST_FIELD_INVALID', `Plugin permission '${permission}' is duplicated`);
    }
    permissions.add(permission);
  }

  if (!isRecord(input.contributes)) {
    return failure('MANIFEST_FIELD_REQUIRED', "Manifest field 'contributes' is required and must be an object");
  }
  const unknownContribution = firstUnknownField(input.contributes, CONTRIBUTION_FIELDS);
  if (unknownContribution) {
    return failure(
      'MANIFEST_UNKNOWN_FIELD',
      `Unknown manifest field 'contributes.${unknownContribution}'`
    );
  }
  if ('repositoryActions' in input.contributes) {
    const error = validateRepositoryActions(input.contributes.repositoryActions);
    if (error) return error;
  }
  if ('pages' in input.contributes) {
    const error = validatePages(input.contributes.pages);
    if (error) return error;
  }
  if ('repositoryProcessors' in input.contributes) {
    const error = validateSimpleContributions(
      input.contributes.repositoryProcessors,
      'repositoryProcessors',
      PROCESSOR_FIELDS,
      ['id', 'title']
    );
    if (error) return error;
  }
  if ('releaseProcessors' in input.contributes) {
    const error = validateSimpleContributions(
      input.contributes.releaseProcessors,
      'releaseProcessors',
      PROCESSOR_FIELDS,
      ['id', 'title']
    );
    if (error) return error;
  }
  if ('exporters' in input.contributes) {
    const error = validateSimpleContributions(
      input.contributes.exporters,
      'exporters',
      EXPORTER_FIELDS,
      ['id', 'title', 'fileExtension', 'mimeType']
    );
    if (error) return error;
    for (const exporter of input.contributes.exporters) {
      if (!/^\.[a-z0-9]{1,10}$/i.test(exporter.fileExtension) || !/^[\w.+-]+\/[\w.+-]+$/.test(exporter.mimeType)) {
        return failure('MANIFEST_FIELD_INVALID', 'Exporter fileExtension or mimeType is invalid');
      }
    }
  }
  if (
    [input.contributes.repositoryActions, input.contributes.repositoryProcessors, input.contributes.exporters]
      .some((items) => Array.isArray(items) && items.length > 0) &&
    !permissions.has('repositories:read')
  ) {
    return failure(
      'MANIFEST_PERMISSION_REQUIRED',
      "Repository contributions require permission 'repositories:read'"
    );
  }
  if (
    Array.isArray(input.contributes.releaseProcessors) &&
    input.contributes.releaseProcessors.length > 0 &&
    !permissions.has('releases:read')
  ) {
    return failure(
      'MANIFEST_PERMISSION_REQUIRED',
      "Release contributions require permission 'releases:read'"
    );
  }
  const hasMain = typeof input.main === 'string';
  const hasPage = Array.isArray(input.contributes.pages) && input.contributes.pages.length > 0;
  if (!hasMain && !hasPage) {
    return failure('MANIFEST_FIELD_REQUIRED', "Manifest requires either 'main' or a contributed page entry");
  }

  return { success: true, data: JSON.parse(JSON.stringify(input)) };
}

module.exports = {
  MANIFEST_VERSION,
  PLUGIN_API_VERSION,
  MAX_MANIFEST_BYTES,
  validateManifest,
};
