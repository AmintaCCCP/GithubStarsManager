'use strict';

const MAX_REPOSITORIES_PER_ACTION = 1000;
const MAX_RESULT_BYTES = 1024 * 1024;
const PLUGIN_ID_RE = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/;
const ACTION_ID_RE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const MAX_RELEASE_ASSETS = 500;

function protocolError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isJsonSerializable(value) {
  try {
    JSON.stringify(value);
    return true;
  } catch {
    return false;
  }
}

function validateRunActionRequest(input) {
  return validateRepositoryRequest(input, 'actionId');
}

function validateRepositoryRequest(input, contributionField) {
  if (!isRecord(input)) {
    throw protocolError('PLUGIN_REQUEST_INVALID', 'Plugin action request must be an object');
  }
  const unknown = Object.keys(input).find(
    (key) => !['pluginId', contributionField, 'repositories'].includes(key)
  );
  if (unknown) {
    throw protocolError('PLUGIN_REQUEST_INVALID', `Unknown plugin action field '${unknown}'`);
  }
  if (typeof input.pluginId !== 'string' || !PLUGIN_ID_RE.test(input.pluginId)) {
    throw protocolError('PLUGIN_REQUEST_INVALID', 'Plugin id is invalid');
  }
  if (typeof input[contributionField] !== 'string' || !ACTION_ID_RE.test(input[contributionField])) {
    throw protocolError('PLUGIN_REQUEST_INVALID', `Plugin ${contributionField} is invalid`);
  }
  if (!Array.isArray(input.repositories) || input.repositories.length > MAX_REPOSITORIES_PER_ACTION) {
    throw protocolError(
      'PLUGIN_REQUEST_INVALID',
      `Plugin action repositories must be an array with at most ${MAX_REPOSITORIES_PER_ACTION} items`
    );
  }

  const repositories = input.repositories.map(sanitizeRepository);

  return { pluginId: input.pluginId, [contributionField]: input[contributionField], repositories };
}

function sanitizeRepository(repository) {
  if (!isRecord(repository) || !Number.isSafeInteger(repository.id)) {
    throw protocolError('PLUGIN_REQUEST_INVALID', 'Plugin repository id must be a safe integer');
  }
  for (const field of ['name', 'full_name', 'html_url', 'created_at', 'updated_at', 'pushed_at']) {
    if (typeof repository[field] !== 'string') {
      throw protocolError('PLUGIN_REQUEST_INVALID', `Plugin repository field '${field}' must be a string`);
    }
  }
  if (!isRecord(repository.owner) || typeof repository.owner.login !== 'string') {
    throw protocolError('PLUGIN_REQUEST_INVALID', "Plugin repository field 'owner.login' must be a string");
  }

  return {
    id: repository.id,
    name: repository.name,
    full_name: repository.full_name,
    description: typeof repository.description === 'string' ? repository.description : null,
    html_url: repository.html_url,
    stargazers_count: Number.isFinite(repository.stargazers_count) ? repository.stargazers_count : 0,
    forks_count: Number.isFinite(repository.forks_count) ? repository.forks_count : 0,
    language: typeof repository.language === 'string' ? repository.language : null,
    created_at: repository.created_at,
    updated_at: repository.updated_at,
    pushed_at: repository.pushed_at,
    owner: { login: repository.owner.login },
    topics: Array.isArray(repository.topics)
      ? repository.topics.filter((topic) => typeof topic === 'string').slice(0, 100)
      : [],
    license: typeof repository.license === 'string' ? repository.license : null,
  };
}

function sanitizeRelease(input) {
  if (!isRecord(input) || !Number.isSafeInteger(input.id)) {
    throw protocolError('PLUGIN_REQUEST_INVALID', 'Plugin release id must be a safe integer');
  }
  for (const field of ['tag_name', 'published_at', 'html_url']) {
    if (typeof input[field] !== 'string') {
      throw protocolError('PLUGIN_REQUEST_INVALID', `Plugin release field '${field}' must be a string`);
    }
  }
  if (!isRecord(input.repository) || !Number.isSafeInteger(input.repository.id)) {
    throw protocolError('PLUGIN_REQUEST_INVALID', 'Plugin release repository is invalid');
  }
  for (const field of ['full_name', 'name']) {
    if (typeof input.repository[field] !== 'string') {
      throw protocolError('PLUGIN_REQUEST_INVALID', `Plugin release repository field '${field}' must be a string`);
    }
  }
  if (!Array.isArray(input.assets) || input.assets.length > MAX_RELEASE_ASSETS) {
    throw protocolError('PLUGIN_REQUEST_INVALID', `Plugin release assets must contain at most ${MAX_RELEASE_ASSETS} items`);
  }
  const assets = input.assets.map((asset) => {
    if (!isRecord(asset) || !Number.isSafeInteger(asset.id)) {
      throw protocolError('PLUGIN_REQUEST_INVALID', 'Plugin release asset id must be a safe integer');
    }
    for (const field of ['name', 'content_type', 'created_at', 'updated_at']) {
      if (typeof asset[field] !== 'string') {
        throw protocolError('PLUGIN_REQUEST_INVALID', `Plugin release asset field '${field}' must be a string`);
      }
    }
    return {
      id: asset.id,
      name: asset.name,
      size: Number.isFinite(asset.size) && asset.size >= 0 ? asset.size : 0,
      download_count: Number.isFinite(asset.download_count) && asset.download_count >= 0
        ? asset.download_count : 0,
      content_type: asset.content_type,
      created_at: asset.created_at,
      updated_at: asset.updated_at,
    };
  });
  return {
    id: input.id,
    tag_name: input.tag_name,
    name: typeof input.name === 'string' ? input.name : null,
    body: typeof input.body === 'string' ? input.body.slice(0, 256 * 1024) : null,
    published_at: input.published_at,
    html_url: input.html_url,
    prerelease: input.prerelease === true,
    repository: {
      id: input.repository.id,
      full_name: input.repository.full_name,
      name: input.repository.name,
    },
    assets,
  };
}

function validateRunReleaseProcessorRequest(input) {
  if (!isRecord(input)) {
    throw protocolError('PLUGIN_REQUEST_INVALID', 'Release processor request must be an object');
  }
  const unknown = Object.keys(input).find(
    (key) => !['pluginId', 'processorId', 'release', 'repository'].includes(key)
  );
  if (unknown) throw protocolError('PLUGIN_REQUEST_INVALID', `Unknown release processor field '${unknown}'`);
  if (typeof input.pluginId !== 'string' || !PLUGIN_ID_RE.test(input.pluginId)) {
    throw protocolError('PLUGIN_REQUEST_INVALID', 'Plugin id is invalid');
  }
  if (typeof input.processorId !== 'string' || !ACTION_ID_RE.test(input.processorId)) {
    throw protocolError('PLUGIN_REQUEST_INVALID', 'Plugin processorId is invalid');
  }
  const release = sanitizeRelease(input.release);
  let repository;
  if (input.repository !== undefined) {
    repository = validateRepositoryRequest({
      pluginId: input.pluginId,
      actionId: input.processorId,
      repositories: [input.repository],
    }, 'actionId').repositories[0];
    if (repository.id !== release.repository.id) {
      throw protocolError('PLUGIN_REQUEST_INVALID', 'Release does not belong to the supplied repository');
    }
  }
  return { pluginId: input.pluginId, processorId: input.processorId, release, ...(repository ? { repository } : {}) };
}

function validatePluginReleaseProcessorResult(input, allowedAssetIds) {
  if (!isRecord(input)) throw protocolError('PLUGIN_RESULT_INVALID', 'Release processor result must be an object');
  const unknown = Object.keys(input).find((key) => !['recommendedAssetId', 'confidence', 'reason'].includes(key));
  if (unknown) throw protocolError('PLUGIN_RESULT_INVALID', `Unknown release processor result field '${unknown}'`);
  if (!Number.isSafeInteger(input.recommendedAssetId) || !new Set(allowedAssetIds).has(input.recommendedAssetId)) {
    throw protocolError('PLUGIN_RESULT_INVALID', 'Recommended asset does not belong to the requested release');
  }
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
    throw protocolError('PLUGIN_RESULT_INVALID', 'Release recommendation confidence must be between 0 and 1');
  }
  if (typeof input.reason !== 'string' || input.reason.trim() === '' || input.reason.length > 2000) {
    throw protocolError('PLUGIN_RESULT_INVALID', 'Release recommendation reason must be a non-empty string');
  }
  return {
    recommendedAssetId: input.recommendedAssetId,
    confidence: input.confidence,
    reason: input.reason,
  };
}

function validateRunProcessorRequest(input) {
  return validateRepositoryRequest(input, 'processorId');
}

function validateRunExporterRequest(input) {
  return validateRepositoryRequest(input, 'exporterId');
}

function validatePluginActionResult(input) {
  if (!isRecord(input) || typeof input.type !== 'string' || !isJsonSerializable(input)) {
    throw protocolError('PLUGIN_RESULT_INVALID', 'Plugin action result must be a JSON-serializable object');
  }
  if (Buffer.byteLength(JSON.stringify(input), 'utf8') > MAX_RESULT_BYTES) {
    throw protocolError('PLUGIN_RESULT_TOO_LARGE', 'Plugin action result exceeds the size limit');
  }

  if (input.type === 'text') {
    if (typeof input.content !== 'string') {
      throw protocolError('PLUGIN_RESULT_INVALID', "Text result field 'content' must be a string");
    }
    if (
      input.suggestedAction !== undefined &&
      !['copy', 'save'].includes(input.suggestedAction)
    ) {
      throw protocolError('PLUGIN_RESULT_INVALID', "Text result field 'suggestedAction' is invalid");
    }
    return {
      type: 'text',
      content: input.content,
      ...(input.suggestedAction ? { suggestedAction: input.suggestedAction } : {}),
    };
  }

  if (input.type === 'open-external') {
    let url;
    try {
      url = new URL(input.url);
    } catch {
      throw protocolError('PLUGIN_RESULT_INVALID', 'External URL is invalid');
    }
    if (url.protocol !== 'https:' || url.username || url.password) {
      throw protocolError('PLUGIN_RESULT_INVALID', 'External URL must use HTTPS without credentials');
    }
    return { type: 'open-external', url: url.toString() };
  }

  if (input.type === 'notice') {
    if (!['info', 'warning', 'error'].includes(input.level) || typeof input.message !== 'string') {
      throw protocolError('PLUGIN_RESULT_INVALID', 'Plugin notice result is invalid');
    }
    return { type: 'notice', level: input.level, message: input.message };
  }

  throw protocolError('PLUGIN_RESULT_INVALID', `Unsupported plugin result type '${input.type}'`);
}

function validatePluginProcessorResult(input, allowedRepositoryIds) {
  if (!isRecord(input) || !Array.isArray(input.repositories) || input.repositories.length > MAX_REPOSITORIES_PER_ACTION) {
    throw protocolError('PLUGIN_RESULT_INVALID', 'Processor result must contain a repositories array');
  }
  const allowed = new Set(allowedRepositoryIds);
  const repositories = input.repositories.map((repository) => {
    if (!isRecord(repository) || !Number.isSafeInteger(repository.id) || !allowed.has(repository.id)) {
      throw protocolError('PLUGIN_RESULT_INVALID', 'Processor result contains an unknown repository id');
    }
    const result = { id: repository.id };
    if ('summary' in repository) {
      if (typeof repository.summary !== 'string') throw protocolError('PLUGIN_RESULT_INVALID', 'Processor summary must be a string');
      result.summary = repository.summary;
    }
    if ('category' in repository) {
      if (typeof repository.category !== 'string') throw protocolError('PLUGIN_RESULT_INVALID', 'Processor category must be a string');
      result.category = repository.category;
    }
    if ('tags' in repository) {
      if (!Array.isArray(repository.tags) || repository.tags.some((tag) => typeof tag !== 'string')) {
        throw protocolError('PLUGIN_RESULT_INVALID', 'Processor tags must be an array of strings');
      }
      result.tags = repository.tags.slice(0, 100);
    }
    return result;
  });
  if (Buffer.byteLength(JSON.stringify(repositories), 'utf8') > MAX_RESULT_BYTES) {
    throw protocolError('PLUGIN_RESULT_TOO_LARGE', 'Processor result exceeds the size limit');
  }
  return { repositories };
}

function validatePluginExporterResult(input) {
  if (!isRecord(input) || typeof input.content !== 'string') {
    throw protocolError('PLUGIN_RESULT_INVALID', 'Exporter result content must be a string');
  }
  if (Buffer.byteLength(input.content, 'utf8') > 5 * MAX_RESULT_BYTES) {
    throw protocolError('PLUGIN_RESULT_TOO_LARGE', 'Exporter result exceeds the size limit');
  }
  if (input.fileName !== undefined && (
    typeof input.fileName !== 'string' ||
    input.fileName.length === 0 ||
    input.fileName !== input.fileName.replace(/[\\/]/g, '')
  )) {
    throw protocolError('PLUGIN_RESULT_INVALID', 'Exporter fileName must not contain a path');
  }
  return {
    content: input.content,
    ...(input.fileName ? { fileName: input.fileName } : {}),
  };
}

module.exports = {
  MAX_REPOSITORIES_PER_ACTION,
  MAX_RESULT_BYTES,
  protocolError,
  validateRunActionRequest,
  validateRunProcessorRequest,
  validateRunExporterRequest,
  validateRunReleaseProcessorRequest,
  validatePluginActionResult,
  validatePluginProcessorResult,
  validatePluginExporterResult,
  validatePluginReleaseProcessorResult,
  sanitizeRepository,
  sanitizeRelease,
};
