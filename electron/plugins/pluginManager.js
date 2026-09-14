'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { MAX_MANIFEST_BYTES, validateManifest } = require('./manifestSchema');

function invalid(directoryName, code, message) {
  return { directoryName, code, message };
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function validateEntry(pluginDirectory, entry) {
  if (path.isAbsolute(entry) || /^[a-zA-Z]:/.test(entry)) {
    return invalid('', 'PLUGIN_ENTRY_OUTSIDE_DIRECTORY', 'Plugin entry must be relative');
  }
  const candidate = path.resolve(pluginDirectory, entry);
  if (!isInside(pluginDirectory, candidate)) {
    return invalid('', 'PLUGIN_ENTRY_OUTSIDE_DIRECTORY', 'Plugin entry is outside its directory');
  }
  let stat;
  try {
    stat = fs.statSync(candidate);
  } catch (error) {
    return invalid('', error?.code === 'ENOENT' ? 'PLUGIN_ENTRY_NOT_FOUND' : 'PLUGIN_ENTRY_UNREADABLE', 'Plugin entry cannot be read');
  }
  if (!stat.isFile()) return invalid('', 'PLUGIN_ENTRY_NOT_FILE', 'Plugin entry is not a file');
  try {
    if (!isInside(fs.realpathSync(pluginDirectory), fs.realpathSync(candidate))) {
      return invalid('', 'PLUGIN_ENTRY_OUTSIDE_DIRECTORY', 'Plugin entry is outside its directory');
    }
  } catch {
    return invalid('', 'PLUGIN_ENTRY_UNREADABLE', 'Plugin entry cannot be resolved');
  }
  return null;
}

function inspectPlugin(pluginDirectory, directoryName) {
  const manifestPath = path.join(pluginDirectory, 'manifest.json');
  let manifest;
  try {
    const stat = fs.lstatSync(manifestPath);
    if (!stat.isFile()) {
      return invalid(directoryName, 'MANIFEST_UNREADABLE', 'Plugin manifest must be a regular file');
    }
    const size = stat.size;
    if (size > MAX_MANIFEST_BYTES) {
      return invalid(directoryName, 'MANIFEST_TOO_LARGE', 'Plugin manifest is too large');
    }
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    const code = error?.code === 'ENOENT' ? 'MANIFEST_NOT_FOUND'
      : error instanceof SyntaxError ? 'MANIFEST_JSON_INVALID' : 'MANIFEST_UNREADABLE';
    return invalid(directoryName, code, 'Plugin manifest cannot be read');
  }
  const result = validateManifest(manifest);
  if (!result.success) return invalid(directoryName, result.code, result.message);
  const entryError = validateEntry(pluginDirectory, result.data.main);
  if (entryError) return { ...entryError, directoryName };
  return { directoryName, manifest: result.data };
}

function createPluginManager({ pluginsRoot }) {
  if (typeof pluginsRoot !== 'string' || pluginsRoot.trim() === '') {
    throw new TypeError('pluginsRoot must be a non-empty string');
  }
  const root = path.resolve(pluginsRoot);

  function scan() {
    if (!fs.existsSync(root)) return { plugins: [], invalidPlugins: [] };
    let directories;
    let realRoot;
    try {
      realRoot = fs.realpathSync(root);
      directories = fs.readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .sort((left, right) => left.name.localeCompare(right.name, 'en'));
    } catch {
      return { plugins: [], invalidPlugins: [invalid('.', 'PLUGIN_ROOT_UNREADABLE', 'Plugin root cannot be read')] };
    }
    const plugins = [];
    const invalidPlugins = [];
    const ids = new Set();
    for (const directory of directories) {
      const pluginDirectory = path.join(root, directory.name);
      let result;
      try {
        if (!isInside(realRoot, fs.realpathSync(pluginDirectory))) {
          result = invalid(directory.name, 'PLUGIN_DIRECTORY_OUTSIDE_ROOT', 'Plugin directory is outside the plugin root');
        }
      } catch {
        result = invalid(directory.name, 'PLUGIN_DIRECTORY_UNREADABLE', 'Plugin directory cannot be resolved');
      }
      result ??= inspectPlugin(pluginDirectory, directory.name);
      if (!result.manifest) {
        invalidPlugins.push(result);
      } else if (ids.has(result.manifest.id)) {
        invalidPlugins.push(invalid(directory.name, 'PLUGIN_ID_DUPLICATE', 'Plugin id is already in use'));
      } else {
        ids.add(result.manifest.id);
        plugins.push(result);
      }
    }
    return { plugins, invalidPlugins };
  }

  return { scan, list: scan };
}

module.exports = { createPluginManager };
