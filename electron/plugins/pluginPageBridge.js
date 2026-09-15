'use strict';

const { protocolError } = require('./pluginProtocol');

const METHODS = {
  'repositories.search': { capability: 'github', operation: 'searchRepositories', fields: ['query', 'limit'] },
  'repositories.get': { capability: 'github', operation: 'getRepository', fields: ['repositoryId'] },
  'releases.get': { capability: 'github', operation: 'getRelease', fields: ['releaseId'] },
  'storage.get': { capability: 'storage', operation: 'get', fields: ['key'] },
  'storage.set': { capability: 'storage', operation: 'set', fields: ['key', 'value'] },
  'storage.delete': { capability: 'storage', operation: 'delete', fields: ['key'] },
  'ai.generate': { capability: 'ai', operation: 'generate', fields: ['system', 'user', 'maxTokens'] },
  'web.search': { capability: 'web', operation: 'search', fields: ['query', 'limit'] },
};

function validatePageCapabilityRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
    Object.keys(input).some((field) => !['pluginId', 'pageId', 'method', 'args'].includes(field))) {
    throw protocolError('PLUGIN_PAGE_REQUEST_INVALID', 'Page request is invalid');
  }
  const { pluginId, pageId, method, args = {} } = input;
  if (typeof pluginId !== 'string' || typeof pageId !== 'string' || typeof method !== 'string' ||
    !Object.hasOwn(METHODS, method) || !args || typeof args !== 'object' || Array.isArray(args)) {
    throw protocolError('PLUGIN_PAGE_REQUEST_INVALID', 'Page request is invalid');
  }
  const definition = METHODS[method];
  if (Object.keys(args).some((field) => !definition.fields.includes(field))) {
    throw protocolError('PLUGIN_PAGE_REQUEST_INVALID', 'Page request has unknown arguments');
  }
  if (Buffer.byteLength(JSON.stringify(args), 'utf8') > 1024 * 1024) {
    throw protocolError('PLUGIN_PAGE_REQUEST_TOO_LARGE', 'Page request is too large');
  }
  if (method === 'repositories.search' &&
    (typeof args.query !== 'string' || args.query.length > 200 ||
      (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 100)))) {
    throw protocolError('PLUGIN_PAGE_REQUEST_INVALID', 'Repository search arguments are invalid');
  }
  if (method === 'repositories.get' && (!Number.isSafeInteger(args.repositoryId) || args.repositoryId <= 0)) {
    throw protocolError('PLUGIN_PAGE_REQUEST_INVALID', 'Repository id is invalid');
  }
  if (method === 'releases.get' && (!Number.isSafeInteger(args.releaseId) || args.releaseId <= 0)) {
    throw protocolError('PLUGIN_PAGE_REQUEST_INVALID', 'Release id is invalid');
  }
  if (method.startsWith('storage.') && (typeof args.key !== 'string' || !args.key)) {
    throw protocolError('PLUGIN_PAGE_REQUEST_INVALID', 'Storage key is invalid');
  }
  if (method === 'ai.generate' &&
    (typeof args.system !== 'string' || args.system.length > 2000 ||
      typeof args.user !== 'string' || !args.user.trim() || args.user.length > 8000 ||
      (args.maxTokens !== undefined && (!Number.isInteger(args.maxTokens) || args.maxTokens < 1 || args.maxTokens > 4000)))) {
    throw protocolError('PLUGIN_PAGE_REQUEST_INVALID', 'AI request arguments are invalid');
  }
  if (method === 'web.search' &&
    (typeof args.query !== 'string' || !args.query.trim() || args.query.length > 200 ||
      (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 10)))) {
    throw protocolError('PLUGIN_PAGE_REQUEST_INVALID', 'Web search arguments are invalid');
  }
  return { pluginId, pageId, capability: definition.capability, operation: definition.operation, args };
}

module.exports = { validatePageCapabilityRequest };
