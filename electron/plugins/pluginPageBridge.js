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
  'clipboard.write': { capability: 'clipboard', operation: 'write', fields: ['text'] },
  'clipboard.writeImage': { capability: 'clipboard', operation: 'writeImage', fields: ['dataBase64'] },
  'downloads.saveFile': { capability: 'downloads', operation: 'saveFile', fields: ['fileName', 'dataBase64'] },
};

// 生成型页面（如截图导出）需要回传二进制结果，单独放宽；base64 编码后
// 10 MiB 约对应 7.5 MiB 原始字节。其余方法维持 1 MiB 的通用上限。
const DEFAULT_MAX_ARGS_BYTES = 1024 * 1024;
const BINARY_RESULT_MAX_ARGS_BYTES = 10 * 1024 * 1024;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const MAX_CLIPBOARD_TEXT_CHARS = 200_000;

function argsBudget(method) {
  return method === 'clipboard.writeImage' || method === 'downloads.saveFile'
    ? BINARY_RESULT_MAX_ARGS_BYTES
    : DEFAULT_MAX_ARGS_BYTES;
}

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
  if (Buffer.byteLength(JSON.stringify(args), 'utf8') > argsBudget(method)) {
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
  if (method === 'clipboard.write' &&
    (typeof args.text !== 'string' || args.text.length === 0 || args.text.length > MAX_CLIPBOARD_TEXT_CHARS)) {
    throw protocolError('PLUGIN_PAGE_REQUEST_INVALID', 'Clipboard text arguments are invalid');
  }
  if (method === 'clipboard.writeImage' || method === 'downloads.saveFile') {
    if (typeof args.dataBase64 !== 'string' || args.dataBase64.length === 0 ||
      !BASE64_RE.test(args.dataBase64) || Buffer.from(args.dataBase64, 'base64').length === 0) {
      throw protocolError('PLUGIN_PAGE_REQUEST_INVALID', 'Base64 payload arguments are invalid');
    }
  }
  if (method === 'downloads.saveFile' &&
    (typeof args.fileName !== 'string' || !args.fileName.trim() || args.fileName.length > 200 ||
      /[\\/]/.test(args.fileName) || args.fileName.startsWith('.'))) {
    throw protocolError('PLUGIN_PAGE_REQUEST_INVALID', 'Download file name arguments are invalid');
  }
  return { pluginId, pageId, capability: definition.capability, operation: definition.operation, args };
}

module.exports = { validatePageCapabilityRequest };
