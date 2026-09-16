'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { MAX_MANIFEST_BYTES, validateManifest } = require('./manifestSchema');
const { createPluginRuntime } = require('./pluginRuntime');
const {
  validateRunActionRequest,
  validateRunProcessorRequest,
  validateRunExporterRequest,
  validateRunReleaseProcessorRequest,
} = require('./pluginProtocol');
const { createPluginStateStore } = require('./pluginState');
const { createPluginStorage, removePluginStorage } = require('./pluginStorage');
const { createPluginLogger, removePluginLogs, sanitizeText } = require('./pluginLogger');
const { createCapabilityRouter } = require('./capabilityRouter');
const { createPluginCatalog } = require('./pluginCatalog');
const { pageUrl, readPageResource } = require('./pluginPage');
const { validatePageCapabilityRequest } = require('./pluginPageBridge');
const { searchUrl, searchSearxng } = require('./webSearch');

const MAX_PLUGIN_PACKAGE_FILES = 2000;
const MAX_PLUGIN_PACKAGE_BYTES = 50 * 1024 * 1024;

function invalid(directoryName, code, message) {
  return { directoryName, code, message };
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function validateEntry(pluginDirectory, relativeEntry) {
  if (typeof relativeEntry !== 'string' || path.isAbsolute(relativeEntry)) {
    return { code: 'PLUGIN_ENTRY_OUTSIDE_DIRECTORY', message: 'Plugin entry must be a relative path' };
  }
  const candidate = path.resolve(pluginDirectory, relativeEntry);
  if (!isInside(pluginDirectory, candidate)) {
    return { code: 'PLUGIN_ENTRY_OUTSIDE_DIRECTORY', message: 'Plugin entry resolves outside its plugin directory' };
  }

  let stat;
  try {
    stat = fs.statSync(candidate);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { code: 'PLUGIN_ENTRY_NOT_FOUND', message: `Plugin entry '${relativeEntry}' does not exist` };
    }
    return { code: 'PLUGIN_ENTRY_UNREADABLE', message: `Plugin entry '${relativeEntry}' cannot be inspected` };
  }
  if (!stat.isFile()) {
    return { code: 'PLUGIN_ENTRY_NOT_FILE', message: `Plugin entry '${relativeEntry}' is not a file` };
  }

  try {
    const realPluginDirectory = fs.realpathSync(pluginDirectory);
    const realCandidate = fs.realpathSync(candidate);
    if (!isInside(realPluginDirectory, realCandidate)) {
      return { code: 'PLUGIN_ENTRY_OUTSIDE_DIRECTORY', message: 'Plugin entry symlink resolves outside its plugin directory' };
    }
  } catch {
    return { code: 'PLUGIN_ENTRY_UNREADABLE', message: `Plugin entry '${relativeEntry}' cannot be resolved` };
  }
  return null;
}

function safeError(error, fallbackCode = 'PLUGIN_OPERATION_FAILED') {
  return {
    code: typeof error?.code === 'string' ? error.code : fallbackCode,
    message: sanitizeText(error instanceof Error ? error.message : 'Plugin operation failed'),
  };
}

function samePermissions(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  // Compare unique sets so duplicated or extra entries cannot satisfy the confirmation check.
  const expected = new Set(left);
  if (expected.size !== left.length) return false;
  const provided = new Set(right);
  if (provided.size !== right.length) return false;
  return right.every((permission) => expected.has(permission));
}

function inspectPluginSource(sourceDirectory) {
  const resolvedSource = path.resolve(sourceDirectory);
  let manifest;
  try {
    const manifestPath = path.join(resolvedSource, 'manifest.json');
    if (fs.statSync(manifestPath).size > MAX_MANIFEST_BYTES) {
      throw Object.assign(new Error('Plugin manifest exceeds the size limit'), { code: 'MANIFEST_TOO_LARGE' });
    }
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    const code = error?.code === 'MANIFEST_TOO_LARGE'
      ? error.code
      : error instanceof SyntaxError ? 'MANIFEST_JSON_INVALID' : 'MANIFEST_UNREADABLE';
    throw Object.assign(new Error(code === 'MANIFEST_TOO_LARGE' ? error.message : 'Plugin manifest cannot be read'), { code });
  }
  const validation = validateManifest(manifest);
  if (!validation.success) throw Object.assign(new Error(validation.message), { code: validation.code });
  manifest = validation.data;
  const entries = [manifest.main, ...(manifest.contributes.pages || []).map((page) => page.entry)].filter(Boolean);
  for (const relativeEntry of entries) {
    const error = validateEntry(resolvedSource, relativeEntry);
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
  }
  return { resolvedSource, manifest };
}

function copyPluginPackage(sourceDirectory, targetDirectory) {
  let fileCount = 0;
  let totalBytes = 0;

  function copyDirectory(source, target) {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      const sourcePath = path.join(source, entry.name);
      const targetPath = path.join(target, entry.name);
      if (entry.isSymbolicLink()) {
        throw Object.assign(new Error('Plugin packages cannot contain symbolic links'), { code: 'PLUGIN_PACKAGE_SYMLINK' });
      }
      if (entry.isDirectory()) {
        copyDirectory(sourcePath, targetPath);
        continue;
      }
      if (!entry.isFile()) continue;
      fileCount += 1;
      totalBytes += fs.statSync(sourcePath).size;
      if (fileCount > MAX_PLUGIN_PACKAGE_FILES || totalBytes > MAX_PLUGIN_PACKAGE_BYTES) {
        throw Object.assign(new Error('Plugin package exceeds the installation limits'), { code: 'PLUGIN_PACKAGE_TOO_LARGE' });
      }
      fs.copyFileSync(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
    }
  }

  copyDirectory(sourceDirectory, targetDirectory);
}

function createPluginManager({
  pluginsRoot,
  statePath,
  runtimeFactory = createPluginRuntime,
  runtimeTimeoutMs,
  dataRoot,
  logsRoot,
  catalog = createPluginCatalog(),
  webSearch = searchSearxng,
}) {
  if (typeof pluginsRoot !== 'string' || pluginsRoot.trim() === '') {
    throw new TypeError('pluginsRoot must be a non-empty string');
  }
  const resolvedRoot = path.resolve(pluginsRoot);
  const stateStore = createPluginStateStore(
    statePath || path.join(path.dirname(resolvedRoot), 'plugins-state.json')
  );
  const resolvedDataRoot = path.resolve(dataRoot || path.join(path.dirname(resolvedRoot), 'plugin-data'));
  const resolvedLogsRoot = path.resolve(logsRoot || path.join(path.dirname(resolvedRoot), 'plugin-logs'));
  let state = stateStore.load();
  const runtimes = new Map();
  const activations = new Map();
  let initialized = false;
  let scanCache = null;

  function saveState() {
    stateStore.save(state);
  }

  function stateFor(pluginId) {
    return state.plugins[pluginId] || { enabled: false, grantedPermissions: [] };
  }

  function recordError(pluginId, error) {
    const current = stateFor(pluginId);
    state.plugins[pluginId] = {
      ...current,
      enabled: false,
      lastError: { ...safeError(error), at: new Date().toISOString() },
    };
    saveState();
  }

  function failRuntime(pluginId, error) {
    runtimes.get(pluginId)?.terminate();
    runtimes.delete(pluginId);
    recordError(pluginId, error);
  }

  function findPlugin(pluginId) {
    const scanResult = scanCache || scan();
    return scanResult.plugins.find((plugin) => plugin.manifest.id === pluginId) || null;
  }

  async function authorizePageRequest(request) {
    let validated;
    try { validated = validatePageCapabilityRequest(request); }
    catch (error) { return { success: false, error: safeError(error) }; }
    const plugin = findPlugin(validated.pluginId);
    if (!plugin?.manifest.contributes.pages?.some((page) => page.id === validated.pageId)) {
      return { success: false, error: { code: 'PLUGIN_PAGE_NOT_FOUND', message: 'Plugin page was not found' } };
    }
    if (!stateFor(validated.pluginId).enabled || (plugin.manifest.main && !runtimes.has(validated.pluginId))) {
      return { success: false, error: { code: 'PLUGIN_NOT_ACTIVE', message: 'Plugin is not active' } };
    }
    try {
      const router = createCapabilityRouter({
        storage: createPluginStorage({ dataRoot: resolvedDataRoot, pluginId: validated.pluginId }),
        logger: createPluginLogger({ logsRoot: resolvedLogsRoot, pluginId: validated.pluginId }),
        catalog,
      });
      const value = await router.handle(plugin.manifest.permissions, validated);
      return { success: true, value };
    } catch (error) {
      return { success: false, error: safeError(error) };
    }
  }

  function activatePlugin(plugin) {
    if (!plugin.manifest.main) return Promise.resolve();
    const pluginId = plugin.manifest.id;
    const inFlight = activations.get(pluginId);
    if (inFlight) return inFlight;
    if (runtimes.has(pluginId)) return Promise.resolve();

    const activation = (async () => {
      const entryPath = path.join(resolvedRoot, plugin.directoryName, plugin.manifest.main);
      const permissions = plugin.manifest.permissions;
      const capabilityRouter = createCapabilityRouter({
        storage: createPluginStorage({ dataRoot: resolvedDataRoot, pluginId }),
        logger: createPluginLogger({ logsRoot: resolvedLogsRoot, pluginId }),
        catalog,
      });
      const runtime = runtimeFactory({
        entryPath,
        pluginId,
        permissions,
        capabilityHandler: (request) => capabilityRouter.handle(permissions, request),
        ...(runtimeTimeoutMs === undefined ? {} : { timeoutMs: runtimeTimeoutMs }),
      });
      runtimes.set(pluginId, runtime);
      try {
        await runtime.activate();
      } catch (error) {
        runtimes.delete(pluginId);
        runtime.terminate();
        throw error;
      }
    })();

    const tracked = activation.finally(() => {
      if (activations.get(pluginId) === tracked) activations.delete(pluginId);
    });
    activations.set(pluginId, tracked);
    return tracked;
  }

  function scanFresh() {
    if (!fs.existsSync(resolvedRoot)) return { plugins: [], invalidPlugins: [] };

    let rootRealPath;
    let entries;
    try {
      rootRealPath = fs.realpathSync(resolvedRoot);
      entries = fs.readdirSync(resolvedRoot, { withFileTypes: true });
    } catch {
      return {
        plugins: [],
        invalidPlugins: [invalid('.', 'PLUGIN_ROOT_UNREADABLE', 'Plugin root cannot be read')],
      };
    }

    const plugins = [];
    const invalidPlugins = [];
    const ids = new Map();
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));

    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const directoryName = entry.name;
      const pluginDirectory = path.join(resolvedRoot, directoryName);

      let pluginDirectoryRealPath;
      try {
        pluginDirectoryRealPath = fs.realpathSync(pluginDirectory);
      } catch {
        invalidPlugins.push(invalid(directoryName, 'PLUGIN_DIRECTORY_UNREADABLE', 'Plugin directory cannot be resolved'));
        continue;
      }
      if (!isInside(rootRealPath, pluginDirectoryRealPath)) {
        invalidPlugins.push(invalid(directoryName, 'PLUGIN_DIRECTORY_OUTSIDE_ROOT', 'Plugin directory symlink resolves outside the plugin root'));
        continue;
      }

      const manifestPath = path.join(pluginDirectory, 'manifest.json');
      let manifestText;
      try {
        if (fs.statSync(manifestPath).size > MAX_MANIFEST_BYTES) {
          invalidPlugins.push(invalid(directoryName, 'MANIFEST_TOO_LARGE', 'Plugin manifest exceeds the size limit'));
          continue;
        }
        manifestText = fs.readFileSync(manifestPath, 'utf8');
      } catch (error) {
        const code = error && error.code === 'ENOENT' ? 'MANIFEST_NOT_FOUND' : 'MANIFEST_UNREADABLE';
        invalidPlugins.push(invalid(directoryName, code, 'Plugin manifest cannot be read'));
        continue;
      }

      let manifest;
      try {
        manifest = JSON.parse(manifestText);
      } catch {
        invalidPlugins.push(invalid(directoryName, 'MANIFEST_JSON_INVALID', 'Plugin manifest is not valid JSON'));
        continue;
      }

      const validation = validateManifest(manifest);
      if (!validation.success) {
        invalidPlugins.push(invalid(directoryName, validation.code, validation.message));
        continue;
      }
      manifest = validation.data;

      if (ids.has(manifest.id)) {
        invalidPlugins.push(invalid(
          directoryName,
          'PLUGIN_ID_DUPLICATE',
          `Plugin id '${manifest.id}' is already provided by '${ids.get(manifest.id)}'`
        ));
        continue;
      }

      const entryPaths = [];
      if (manifest.main) entryPaths.push(manifest.main);
      for (const page of manifest.contributes.pages || []) entryPaths.push(page.entry);
      const entryError = entryPaths.map((entryPath) => validateEntry(pluginDirectory, entryPath)).find(Boolean);
      if (entryError) {
        invalidPlugins.push(invalid(directoryName, entryError.code, entryError.message));
        continue;
      }

      ids.set(manifest.id, directoryName);
      plugins.push({ directoryName, manifest });
    }

    return { plugins, invalidPlugins };
  }

  function scan() {
    scanCache = scanFresh();
    return scanCache;
  }

  return {
    scan,
    updateSnapshot(snapshot) {
      try {
        return { success: true, counts: catalog.update(snapshot) };
      } catch (error) {
        return { success: false, error: safeError(error, 'PLUGIN_SNAPSHOT_INVALID') };
      }
    },
    async initialize() {
      if (initialized) return;
      initialized = true;
      const { plugins } = scan();
      for (const plugin of plugins) {
        const pluginState = stateFor(plugin.manifest.id);
        if (!pluginState.enabled) continue;
        if (!samePermissions(plugin.manifest.permissions, pluginState.grantedPermissions)) {
          recordError(plugin.manifest.id, {
            code: 'PLUGIN_PERMISSIONS_CHANGED',
            message: 'Plugin permissions changed and must be confirmed again',
          });
          continue;
        }
        try {
          await activatePlugin(plugin);
        } catch (error) {
          recordError(plugin.manifest.id, error);
        }
      }
    },
    async list() {
      await this.initialize();
      const result = scan();
      return {
        ...result,
        plugins: result.plugins.map((plugin) => {
          const pluginState = stateFor(plugin.manifest.id);
          return {
            ...plugin,
            enabled: pluginState.enabled,
            status: pluginState.lastError
              ? 'error'
              : pluginState.enabled
                ? (plugin.manifest.main && !runtimes.has(plugin.manifest.id) ? 'error' : 'active')
                : 'disabled',
            grantedPermissions: [...pluginState.grantedPermissions],
            ...(pluginState.lastError ? { lastError: { ...pluginState.lastError } } : {}),
          };
        }),
      };
    },
    installFromDirectory(sourceDirectory) {
      if (typeof sourceDirectory !== 'string' || sourceDirectory.trim() === '') {
        return { success: false, error: { code: 'PLUGIN_INSTALL_SOURCE_INVALID', message: 'Plugin source directory is invalid' } };
      }
      let inspected;
      try {
        inspected = inspectPluginSource(sourceDirectory);
      } catch (error) {
        return { success: false, error: safeError(error, 'PLUGIN_INSTALL_SOURCE_INVALID') };
      }
      const targetDirectory = path.join(resolvedRoot, inspected.manifest.id);
      if (fs.existsSync(targetDirectory)) {
        return { success: false, error: { code: 'PLUGIN_ALREADY_INSTALLED', message: 'Plugin is already installed' } };
      }
      fs.mkdirSync(resolvedRoot, { recursive: true });
      const temporaryDirectory = path.join(
        resolvedRoot,
        `.installing-${inspected.manifest.id}-${process.pid}-${Date.now()}`
      );
      try {
        copyPluginPackage(inspected.resolvedSource, temporaryDirectory);
        const copied = inspectPluginSource(temporaryDirectory);
        if (copied.manifest.id !== inspected.manifest.id) {
          throw Object.assign(new Error('Plugin manifest changed during installation'), { code: 'PLUGIN_INSTALL_CHANGED' });
        }
        fs.renameSync(temporaryDirectory, targetDirectory);
        scanCache = null;
        return { success: true, pluginId: inspected.manifest.id };
      } catch (error) {
        try { fs.rmSync(temporaryDirectory, { recursive: true, force: true }); } catch {}
        return { success: false, error: safeError(error, 'PLUGIN_INSTALL_FAILED') };
      }
    },
    async enable(pluginId, grantedPermissions) {
      const plugin = findPlugin(pluginId);
      if (!plugin) {
        return { success: false, error: { code: 'PLUGIN_NOT_FOUND', message: 'Plugin was not found' } };
      }
      if (!samePermissions(plugin.manifest.permissions, grantedPermissions)) {
        return {
          success: false,
          error: {
            code: 'PLUGIN_PERMISSION_CONFIRMATION_REQUIRED',
            message: 'All requested plugin permissions must be confirmed',
          },
        };
      }
      if (stateFor(pluginId).enabled && (!plugin.manifest.main || runtimes.has(pluginId))) return { success: true };
      try {
        await activatePlugin(plugin);
        state.plugins[pluginId] = {
          enabled: true,
          grantedPermissions: [...grantedPermissions],
        };
        saveState();
        return { success: true };
      } catch (error) {
        recordError(pluginId, error);
        return { success: false, error: safeError(error) };
      }
    },
    async disable(pluginId) {
      const plugin = findPlugin(pluginId);
      if (!plugin) {
        return { success: false, error: { code: 'PLUGIN_NOT_FOUND', message: 'Plugin was not found' } };
      }
      const pendingActivation = activations.get(pluginId);
      if (pendingActivation) {
        // Wait for the in-flight activation, otherwise its Worker would stay alive after this disable.
        try {
          await pendingActivation;
        } catch {
          // The activation caller reports its own failure; disable still has to clean up.
        }
      }
      const runtime = runtimes.get(pluginId);
      try {
        if (runtime) await runtime.deactivate();
      } catch (error) {
        runtime.terminate();
      } finally {
        runtimes.delete(pluginId);
      }
      state.plugins[pluginId] = {
        enabled: false,
        grantedPermissions: [...stateFor(pluginId).grantedPermissions],
      };
      saveState();
      return { success: true };
    },
    getPage(pluginId, pageId) {
      const plugin = findPlugin(pluginId);
      const page = plugin?.manifest.contributes.pages?.find((item) => item.id === pageId);
      if (!plugin || !page) {
        return { success: false, error: { code: 'PLUGIN_PAGE_NOT_FOUND', message: 'Plugin page was not found' } };
      }
      if (!stateFor(pluginId).enabled || (plugin.manifest.main && !runtimes.has(pluginId))) {
        return { success: false, error: { code: 'PLUGIN_NOT_ACTIVE', message: 'Plugin is not active' } };
      }
      return { success: true, url: pageUrl(pluginId, pageId) };
    },
    readPageResource(urlValue) {
      let pluginId;
      try { pluginId = new URL(urlValue).hostname; } catch { return null; }
      const plugin = findPlugin(pluginId);
      if (!plugin || !stateFor(pluginId).enabled || (plugin.manifest.main && !runtimes.has(pluginId))) return null;
      return readPageResource(urlValue, path.join(resolvedRoot, plugin.directoryName), plugin.manifest);
    },
    async requestPageCapability(request) {
      return authorizePageRequest(request);
    },
    getSearchEndpoint() {
      return { endpoint: state.searchEndpoint };
    },
    configureWebSearch(endpoint) {
      if (endpoint !== null) {
        try { searchUrl(endpoint); }
        catch (error) { return { success: false, error: safeError(error) }; }
      }
      state.searchEndpoint = endpoint;
      saveState();
      return { success: true };
    },
    async searchWeb(request) {
      const authorization = await authorizePageRequest({ ...request, method: 'web.search' });
      if (!authorization.success) return authorization;
      if (!state.searchEndpoint) {
        return { success: false, error: { code: 'PLUGIN_SEARCH_NOT_CONFIGURED', message: 'Web search service is not configured' } };
      }
      try {
        return { success: true, value: await webSearch(state.searchEndpoint, request.args) };
      } catch (error) {
        return { success: false, error: safeError(error) };
      }
    },
    async uninstall(pluginId, removePluginData) {
      if (removePluginData !== undefined && typeof removePluginData !== 'boolean') {
        return {
          success: false,
          error: { code: 'PLUGIN_UNINSTALL_OPTIONS_INVALID', message: 'Plugin uninstall options are invalid' },
        };
      }
      const plugin = findPlugin(pluginId);
      if (!plugin) {
        return { success: false, error: { code: 'PLUGIN_NOT_FOUND', message: 'Plugin was not found' } };
      }
      const disabled = await this.disable(pluginId);
      if (!disabled.success) return disabled;

      const pluginDirectory = path.join(resolvedRoot, plugin.directoryName);
      try {
        const rootRealPath = fs.realpathSync(resolvedRoot);
        const pluginRealPath = fs.realpathSync(pluginDirectory);
        if (!isInside(rootRealPath, pluginRealPath)) {
          return {
            success: false,
            error: { code: 'PLUGIN_DIRECTORY_OUTSIDE_ROOT', message: 'Plugin directory is outside the plugin root' },
          };
        }
        fs.rmSync(pluginDirectory, { recursive: true, force: false });
        delete state.plugins[pluginId];
        saveState();
        scanCache = null;
      } catch (error) {
        return { success: false, error: safeError(error, 'PLUGIN_UNINSTALL_FAILED') };
      }
      // The installed directory is already gone, so a data-removal failure is reported instead of
      // being thrown: the caller can tell the user that files are still on disk.
      let dataRemoved = false;
      if (removePluginData) {
        try {
          const storageRemoved = removePluginStorage({ dataRoot: resolvedDataRoot, pluginId });
          const logsRemoved = removePluginLogs({ logsRoot: resolvedLogsRoot, pluginId });
          dataRemoved = storageRemoved && logsRemoved;
        } catch {
          dataRemoved = false;
        }
      }
      return { success: true, dataRemoved };
    },
    async runAction(request) {
      let validated;
      try {
        validated = validateRunActionRequest(request);
      } catch (error) {
        return { success: false, error: safeError(error) };
      }
      const plugin = findPlugin(validated.pluginId);
      if (!plugin) {
        return { success: false, error: { code: 'PLUGIN_NOT_FOUND', message: 'Plugin was not found' } };
      }
      const action = (plugin.manifest.contributes.repositoryActions || [])
        .find((contribution) => contribution.id === validated.actionId);
      if (!action) {
        return { success: false, error: { code: 'PLUGIN_ACTION_NOT_FOUND', message: 'Plugin action was not found' } };
      }
      if (!stateFor(validated.pluginId).enabled || !runtimes.has(validated.pluginId)) {
        return { success: false, error: { code: 'PLUGIN_NOT_ACTIVE', message: 'Plugin is not active' } };
      }
      try {
        const result = await runtimes.get(validated.pluginId).runAction({
          actionId: validated.actionId,
          repositories: validated.repositories,
        });
        if (result.type === 'open-external' && !plugin.manifest.permissions.includes('external:open')) {
          return {
            success: false,
            error: { code: 'PLUGIN_PERMISSION_DENIED', message: "Permission 'external:open' is required" },
          };
        }
        if (
          result.type === 'text' &&
          result.suggestedAction === 'copy' &&
          !plugin.manifest.permissions.includes('clipboard:write')
        ) {
          return {
            success: false,
            error: { code: 'PLUGIN_PERMISSION_DENIED', message: "Permission 'clipboard:write' is required" },
          };
        }
        return { success: true, result };
      } catch (error) {
        failRuntime(validated.pluginId, error);
        return { success: false, error: safeError(error) };
      }
    },
    async runProcessor(request) {
      let validated;
      try {
        validated = validateRunProcessorRequest(request);
      } catch (error) {
        return { success: false, error: safeError(error) };
      }
      const plugin = findPlugin(validated.pluginId);
      const contribution = plugin?.manifest.contributes.repositoryProcessors?.find(
        (processor) => processor.id === validated.processorId
      );
      if (!plugin || !contribution) {
        return { success: false, error: { code: 'PLUGIN_PROCESSOR_NOT_FOUND', message: 'Plugin processor was not found' } };
      }
      if (!stateFor(validated.pluginId).enabled || !runtimes.has(validated.pluginId)) {
        return { success: false, error: { code: 'PLUGIN_NOT_ACTIVE', message: 'Plugin is not active' } };
      }
      try {
        return {
          success: true,
          result: await runtimes.get(validated.pluginId).runProcessor({
            processorId: validated.processorId,
            repositories: validated.repositories,
          }),
        };
      } catch (error) {
        failRuntime(validated.pluginId, error);
        return { success: false, error: safeError(error) };
      }
    },
    async runReleaseProcessor(request) {
      let validated;
      try {
        validated = validateRunReleaseProcessorRequest(request);
      } catch (error) {
        return { success: false, error: safeError(error) };
      }
      const plugin = findPlugin(validated.pluginId);
      const contribution = plugin?.manifest.contributes.releaseProcessors?.find(
        (processor) => processor.id === validated.processorId
      );
      if (!plugin || !contribution) {
        return { success: false, error: { code: 'PLUGIN_RELEASE_PROCESSOR_NOT_FOUND', message: 'Plugin release processor was not found' } };
      }
      if (!stateFor(validated.pluginId).enabled || !runtimes.has(validated.pluginId)) {
        return { success: false, error: { code: 'PLUGIN_NOT_ACTIVE', message: 'Plugin is not active' } };
      }
      // Update the Host snapshot before the plugin can query it, but keep a rejected snapshot from
      // being recorded as a plugin runtime failure.
      try {
        catalog.upsert(request.repository, request.release);
      } catch (error) {
        return { success: false, error: safeError(error, 'PLUGIN_RELEASE_SNAPSHOT_INVALID') };
      }
      try {
        return {
          success: true,
          result: await runtimes.get(validated.pluginId).runReleaseProcessor({
            processorId: validated.processorId,
            release: validated.release,
            ...(validated.repository ? { repository: validated.repository } : {}),
            hostEnvironment: { os: process.platform, arch: process.arch },
          }),
        };
      } catch (error) {
        failRuntime(validated.pluginId, error);
        return { success: false, error: safeError(error) };
      }
    },
    getDownloadAsset(pluginId, releaseId, assetId) {
      const plugin = findPlugin(pluginId);
      if (!plugin) return { success: false, error: { code: 'PLUGIN_NOT_FOUND', message: 'Plugin was not found' } };
      if (!stateFor(pluginId).enabled || !runtimes.has(pluginId)) {
        return { success: false, error: { code: 'PLUGIN_NOT_ACTIVE', message: 'Plugin is not active' } };
      }
      if (!plugin.manifest.permissions.includes('downloads:create')) {
        return { success: false, error: { code: 'PLUGIN_PERMISSION_DENIED', message: "Permission 'downloads:create' is required" } };
      }
      let resolved;
      try {
        resolved = catalog.getDownloadAsset(releaseId, assetId);
      } catch (error) {
        return { success: false, error: safeError(error) };
      }
      if (!resolved) {
        return { success: false, error: { code: 'PLUGIN_ASSET_NOT_FOUND', message: 'Release asset was not found in the Host snapshot' } };
      }
      return { success: true, value: resolved };
    },
    async runExporter(request) {
      let validated;
      try {
        validated = validateRunExporterRequest(request);
      } catch (error) {
        return { success: false, error: safeError(error) };
      }
      const plugin = findPlugin(validated.pluginId);
      const contribution = plugin?.manifest.contributes.exporters?.find(
        (exporter) => exporter.id === validated.exporterId
      );
      if (!plugin || !contribution) {
        return { success: false, error: { code: 'PLUGIN_EXPORTER_NOT_FOUND', message: 'Plugin exporter was not found' } };
      }
      if (!stateFor(validated.pluginId).enabled || !runtimes.has(validated.pluginId)) {
        return { success: false, error: { code: 'PLUGIN_NOT_ACTIVE', message: 'Plugin is not active' } };
      }
      try {
        const result = await runtimes.get(validated.pluginId).runExporter({
          exporterId: validated.exporterId,
          repositories: validated.repositories,
        });
        const defaultName = `${validated.pluginId}-${validated.exporterId}${contribution.fileExtension}`;
        const fileName = result.fileName?.toLowerCase().endsWith(contribution.fileExtension.toLowerCase())
          ? result.fileName
          : `${result.fileName || defaultName}${result.fileName ? contribution.fileExtension : ''}`;
        return {
          success: true,
          result: { content: result.content, fileName, mimeType: contribution.mimeType },
        };
      } catch (error) {
        failRuntime(validated.pluginId, error);
        return { success: false, error: safeError(error) };
      }
    },
    shutdown() {
      for (const runtime of runtimes.values()) runtime.terminate();
      runtimes.clear();
    },
  };
}

module.exports = { createPluginManager };
