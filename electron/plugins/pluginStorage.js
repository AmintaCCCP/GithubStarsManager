'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { protocolError } = require('./pluginProtocol');

const MAX_STORAGE_KEY_LENGTH = 128;
const MAX_STORAGE_VALUE_BYTES = 64 * 1024;
const MAX_PLUGIN_STORAGE_BYTES = 1024 * 1024;
const PLUGIN_ID_RE = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function validateKey(key) {
  if (typeof key !== 'string' || key.length === 0 || key.length > MAX_STORAGE_KEY_LENGTH) {
    throw protocolError('PLUGIN_STORAGE_KEY_INVALID', 'Plugin storage key is invalid');
  }
}

function storageDataPath(dataRoot, pluginId) {
  if (typeof dataRoot !== 'string' || !PLUGIN_ID_RE.test(pluginId)) {
    throw new TypeError('Plugin storage requires a data root and valid plugin id');
  }
  return path.join(path.resolve(dataRoot), `${pluginId}.json`);
}

function createPluginStorage({ dataRoot, pluginId }) {
  const dataPath = storageDataPath(dataRoot, pluginId);

  function load() {
    let serialized;
    try {
      serialized = fs.readFileSync(dataPath, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return {};
      throw error;
    }
    const value = JSON.parse(serialized);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function save(value) {
    const serialized = `${JSON.stringify(value, null, 2)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > MAX_PLUGIN_STORAGE_BYTES) {
      throw protocolError('PLUGIN_STORAGE_QUOTA_EXCEEDED', 'Plugin storage quota exceeded');
    }
    fs.mkdirSync(path.dirname(dataPath), { recursive: true });
    const temporaryPath = `${dataPath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporaryPath, serialized, { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(temporaryPath, dataPath);
    } catch (error) {
      try {
        fs.unlinkSync(temporaryPath);
      } catch {
        // Preserve the original write error.
      }
      throw error;
    }
  }

  return {
    get(key) {
      validateKey(key);
      const value = load()[key];
      return value === undefined ? null : cloneJson(value);
    },
    set(key, value) {
      validateKey(key);
      let cloned;
      try {
        cloned = cloneJson(value);
      } catch {
        throw protocolError('PLUGIN_STORAGE_VALUE_INVALID', 'Plugin storage value must be JSON serializable');
      }
      if (Buffer.byteLength(JSON.stringify(cloned), 'utf8') > MAX_STORAGE_VALUE_BYTES) {
        throw protocolError('PLUGIN_STORAGE_VALUE_TOO_LARGE', 'Plugin storage value exceeds the size limit');
      }
      const stored = load();
      stored[key] = cloned;
      save(stored);
    },
    delete(key) {
      validateKey(key);
      const stored = load();
      const existed = Object.prototype.hasOwnProperty.call(stored, key);
      if (existed) {
        delete stored[key];
        save(stored);
      }
      return existed;
    },
  };
}

/**
 * Deletes the isolated storage file of an uninstalled plugin and any leftover temporary file.
 * Missing files are not an error; returns false when the data could not be removed.
 */
function removePluginStorage({ dataRoot, pluginId }) {
  const dataPath = storageDataPath(dataRoot, pluginId);
  if (!fs.existsSync(dataPath)) return true;
  try {
    fs.rmSync(dataPath, { force: true });
  } catch {
    return false;
  }
  const directory = path.dirname(dataPath);
  const prefix = `${path.basename(dataPath)}.`;
  try {
    for (const entry of fs.readdirSync(directory)) {
      if (entry.startsWith(prefix) && entry.endsWith('.tmp')) {
        try { fs.rmSync(path.join(directory, entry), { force: true }); } catch { /* Leftovers are not fatal. */ }
      }
    }
  } catch { /* The data file is already gone; a missing directory is fine. */ }
  return true;
}

module.exports = {
  MAX_PLUGIN_STORAGE_BYTES,
  MAX_STORAGE_KEY_LENGTH,
  MAX_STORAGE_VALUE_BYTES,
  createPluginStorage,
  removePluginStorage,
};
