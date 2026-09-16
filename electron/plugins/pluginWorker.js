'use strict';

const { parentPort, workerData } = require('node:worker_threads');

let plugin;
let nextHostRequestId = 1;
const pendingHostRequests = new Map();

function serializeError(error) {
  return {
    code: typeof error?.code === 'string' ? error.code : 'PLUGIN_RUNTIME_ERROR',
    message: error instanceof Error ? error.message : String(error),
  };
}

async function loadPlugin() {
  plugin = require(workerData.entryPath);
  if (!plugin || typeof plugin !== 'object') {
    throw new Error('Plugin entry must export an object');
  }
}

function callHost(capability, operation, args) {
  let requestBytes;
  try {
    requestBytes = Buffer.byteLength(JSON.stringify({ capability, operation, args }), 'utf8');
  } catch {
    return Promise.reject(Object.assign(new Error('Host capability arguments must be JSON serializable'), {
      code: 'PLUGIN_CAPABILITY_REQUEST_INVALID',
    }));
  }
  if (requestBytes > 128 * 1024) {
    return Promise.reject(Object.assign(new Error('Host capability request exceeds the size limit'), {
      code: 'PLUGIN_CAPABILITY_REQUEST_TOO_LARGE',
    }));
  }
  const requestId = nextHostRequestId;
  nextHostRequestId += 1;
  return new Promise((resolve, reject) => {
    pendingHostRequests.set(requestId, { resolve, reject });
    parentPort.postMessage({ type: 'host-request', requestId, request: { capability, operation, args } });
  });
}

function createContext() {
  const context = {
    pluginId: workerData.pluginId,
    permissions: Object.freeze([...workerData.permissions]),
    log: Object.freeze({
      debug: (message, metadata) => callHost('log', 'debug', { message, metadata }),
      info: (message, metadata) => callHost('log', 'info', { message, metadata }),
      warning: (message, metadata) => callHost('log', 'warning', { message, metadata }),
      error: (message, metadata) => callHost('log', 'error', { message, metadata }),
    }),
  };
  if (workerData.permissions.includes('storage')) {
    context.storage = Object.freeze({
      get: (key) => callHost('storage', 'get', { key }),
      set: (key, value) => callHost('storage', 'set', { key, value }),
      delete: (key) => callHost('storage', 'delete', { key }),
    });
  }
  const canReadRepositories = workerData.permissions.includes('repositories:read')
    || workerData.permissions.includes('privateRepositories:read');
  if (canReadRepositories || workerData.permissions.includes('releases:read')) {
    context.github = Object.freeze({
      ...(canReadRepositories ? {
        searchRepositories: (query, options = {}) => callHost('github', 'searchRepositories', { query, limit: options.limit ?? 20 }),
        getRepository: (repositoryId) => callHost('github', 'getRepository', { repositoryId }),
      } : {}),
      ...(workerData.permissions.includes('releases:read') ? {
        getRelease: (releaseId) => callHost('github', 'getRelease', { releaseId }),
      } : {}),
    });
  }
  return Object.freeze(context);
}

async function handleRequest(message) {
  const { requestId, method, payload } = message;
  try {
    let result;
    if (method === 'activate') {
      result = typeof plugin.activate === 'function'
        ? await plugin.activate(createContext())
        : undefined;
    } else if (method === 'deactivate') {
      result = typeof plugin.deactivate === 'function' ? await plugin.deactivate() : undefined;
    } else if (method === 'runAction') {
      if (typeof plugin.runAction !== 'function') {
        const error = new Error('Plugin does not export runAction');
        error.code = 'PLUGIN_ACTION_HANDLER_MISSING';
        throw error;
      }
      result = await plugin.runAction(payload);
    } else if (method === 'runProcessor') {
      if (typeof plugin.runProcessor !== 'function') {
        const error = new Error('Plugin does not export runProcessor');
        error.code = 'PLUGIN_PROCESSOR_HANDLER_MISSING';
        throw error;
      }
      result = await plugin.runProcessor(payload);
    } else if (method === 'runReleaseProcessor') {
      if (typeof plugin.runReleaseProcessor !== 'function') {
        const error = new Error('Plugin does not export runReleaseProcessor');
        error.code = 'PLUGIN_RELEASE_PROCESSOR_HANDLER_MISSING';
        throw error;
      }
      result = await plugin.runReleaseProcessor(payload);
    } else if (method === 'runExporter') {
      if (typeof plugin.runExporter !== 'function') {
        const error = new Error('Plugin does not export runExporter');
        error.code = 'PLUGIN_EXPORTER_HANDLER_MISSING';
        throw error;
      }
      result = await plugin.runExporter(payload);
    } else {
      const error = new Error(`Unknown plugin runtime method '${method}'`);
      error.code = 'PLUGIN_RUNTIME_METHOD_UNKNOWN';
      throw error;
    }
    parentPort.postMessage({ type: 'response', requestId, success: true, result });
  } catch (error) {
    parentPort.postMessage({ type: 'response', requestId, success: false, error: serializeError(error) });
  }
}

parentPort.on('message', (message) => {
  if (message?.type === 'host-response') {
    const pending = pendingHostRequests.get(message.requestId);
    if (!pending) return;
    pendingHostRequests.delete(message.requestId);
    if (message.success) pending.resolve(message.result);
    else {
      const error = new Error(message.error?.message || 'Host capability failed');
      error.code = message.error?.code || 'PLUGIN_CAPABILITY_FAILED';
      pending.reject(error);
    }
    return;
  }
  if (message?.type === 'request') void handleRequest(message);
});

void loadPlugin()
  .then(() => parentPort.postMessage({ type: 'ready' }))
  .catch((error) => parentPort.postMessage({ type: 'startup-error', error: serializeError(error) }));
