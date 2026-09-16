'use strict';

const path = require('node:path');
const { Worker } = require('node:worker_threads');
const {
  protocolError,
  validatePluginActionResult,
  validatePluginProcessorResult,
  validatePluginExporterResult,
  validatePluginReleaseProcessorResult,
} = require('./pluginProtocol');

const DEFAULT_PLUGIN_TIMEOUT_MS = 5000;

function createPluginRuntime({
  entryPath,
  pluginId,
  permissions,
  timeoutMs = DEFAULT_PLUGIN_TIMEOUT_MS,
  WorkerClass = Worker,
  capabilityHandler = async () => {
    throw protocolError('PLUGIN_CAPABILITY_UNKNOWN', 'No Host capability is available');
  },
}) {
  let worker = null;
  let nextRequestId = 1;
  let readyPromise = null;
  const pending = new Map();

  function rejectPending(error) {
    for (const request of pending.values()) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    pending.clear();
  }

  function terminate(error) {
    const current = worker;
    worker = null;
    readyPromise = null;
    rejectPending(error);
    if (current) void current.terminate();
  }

  function ensureWorker() {
    if (worker && readyPromise) return readyPromise;

    // Listeners are bound to the Worker instance that created them: a replaced
    // Worker can still emit 'exit', 'error', or a queued message afterwards, and
    // those late events must never tear down the current runtime.
    const runtimeWorker = new WorkerClass(path.join(__dirname, 'pluginWorker.js'), {
      workerData: { entryPath, pluginId, permissions: [...permissions] },
    });
    worker = runtimeWorker;
    readyPromise = new Promise((resolve, reject) => {
      const startupTimeout = setTimeout(() => {
        const error = protocolError('PLUGIN_RUNTIME_TIMEOUT', 'Plugin runtime did not start in time');
        reject(error);
        terminate(error);
      }, timeoutMs);

      runtimeWorker.on('message', (message) => {
        if (worker !== runtimeWorker) return;
        if (message?.type === 'host-request') {
          const requestWorker = runtimeWorker;
          void Promise.resolve()
            .then(() => capabilityHandler(message.request))
            .then(
              (result) => {
                if (worker === requestWorker) requestWorker?.postMessage({
                  type: 'host-response', requestId: message.requestId, success: true, result,
                });
              },
              (cause) => {
                if (worker === requestWorker) requestWorker?.postMessage({
                  type: 'host-response',
                  requestId: message.requestId,
                  success: false,
                  error: {
                    code: typeof cause?.code === 'string' ? cause.code : 'PLUGIN_CAPABILITY_FAILED',
                    message: cause instanceof Error ? cause.message : 'Host capability failed',
                  },
                });
              }
            );
          return;
        }
        if (message?.type === 'ready') {
          clearTimeout(startupTimeout);
          resolve();
          return;
        }
        if (message?.type === 'startup-error') {
          clearTimeout(startupTimeout);
          const error = protocolError(message.error?.code || 'PLUGIN_RUNTIME_ERROR', message.error?.message || 'Plugin failed to load');
          reject(error);
          terminate(error);
          return;
        }
        if (message?.type !== 'response') return;
        const request = pending.get(message.requestId);
        if (!request) return;
        pending.delete(message.requestId);
        clearTimeout(request.timeout);
        if (message.success) {
          request.resolve(message.result);
        } else {
          request.reject(protocolError(message.error?.code || 'PLUGIN_RUNTIME_ERROR', message.error?.message || 'Plugin call failed'));
        }
      });
      runtimeWorker.on('error', (cause) => {
        if (worker !== runtimeWorker) return;
        clearTimeout(startupTimeout);
        const error = protocolError('PLUGIN_RUNTIME_ERROR', cause.message || 'Plugin worker failed');
        reject(error);
        terminate(error);
      });
      runtimeWorker.on('exit', (code) => {
        if (worker !== runtimeWorker) return;
        clearTimeout(startupTimeout);
        const error = protocolError('PLUGIN_RUNTIME_EXITED', `Plugin worker exited with code ${code}`);
        reject(error);
        terminate(error);
      });
    });
    return readyPromise;
  }

  async function invoke(method, payload) {
    await ensureWorker();
    if (!worker) throw protocolError('PLUGIN_RUNTIME_NOT_ACTIVE', 'Plugin runtime is not active');
    const requestId = nextRequestId;
    nextRequestId += 1;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const error = protocolError('PLUGIN_RUNTIME_TIMEOUT', `Plugin method '${method}' timed out`);
        pending.delete(requestId);
        reject(error);
        terminate(error);
      }, timeoutMs);
      pending.set(requestId, { resolve, reject, timeout });
      worker.postMessage({ type: 'request', requestId, method, payload });
    });
  }

  return {
    async activate() {
      await invoke('activate');
    },
    async runAction(payload) {
      return validatePluginActionResult(await invoke('runAction', payload));
    },
    async runProcessor(payload) {
      const result = await invoke('runProcessor', payload);
      return validatePluginProcessorResult(result, payload.repositories.map((repository) => repository.id));
    },
    async runReleaseProcessor(payload) {
      const result = await invoke('runReleaseProcessor', payload);
      return validatePluginReleaseProcessorResult(
        result,
        payload.release.assets.map((asset) => asset.id)
      );
    },
    async runExporter(payload) {
      return validatePluginExporterResult(await invoke('runExporter', payload));
    },
    async deactivate() {
      if (!worker) return;
      try {
        await invoke('deactivate');
      } finally {
        terminate(protocolError('PLUGIN_RUNTIME_STOPPED', 'Plugin runtime stopped'));
      }
    },
    terminate() {
      terminate(protocolError('PLUGIN_RUNTIME_STOPPED', 'Plugin runtime stopped'));
    },
    isActive() {
      return worker !== null;
    },
  };
}

module.exports = { DEFAULT_PLUGIN_TIMEOUT_MS, createPluginRuntime };
