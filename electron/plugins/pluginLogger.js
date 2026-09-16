'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_LOG_BYTES = 1024 * 1024;
const MAX_LOG_MESSAGE_LENGTH = 4000;
const SENSITIVE_KEY_RE = /(?:authorization|api[-_]?key|token|secret|password|credential)/i;
const TOKEN_RE = /(?:Bearer\s+)[^\s"']+|(?:gh[pousr]_|github_pat_|sk-)[A-Za-z0-9_-]+/gi;

function sanitizeText(value) {
  return String(value).slice(0, MAX_LOG_MESSAGE_LENGTH).replace(TOKEN_RE, '[REDACTED]');
}

function sanitizeMetadata(value, depth = 0) {
  if (depth > 4) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeMetadata(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, item]) => [
      key,
      SENSITIVE_KEY_RE.test(key) ? '[REDACTED]' : sanitizeMetadata(item, depth + 1),
    ]));
  }
  return typeof value === 'string' ? sanitizeText(value) : value;
}

function createPluginLogger({ logsRoot, pluginId }) {
  const logPath = path.join(path.resolve(logsRoot), `${pluginId}.log`);

  return {
    log(level, message, metadata) {
      const normalizedLevel = ['debug', 'info', 'warning', 'error'].includes(level) ? level : 'info';
      const entry = {
        at: new Date().toISOString(),
        level: normalizedLevel,
        message: sanitizeText(message),
        ...(metadata === undefined ? {} : { metadata: sanitizeMetadata(metadata) }),
      };
      const line = `${JSON.stringify(entry)}\n`;
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      try {
        if (fs.statSync(logPath).size + Buffer.byteLength(line, 'utf8') > MAX_LOG_BYTES) {
          const rotatedPath = `${logPath}.1`;
          try { fs.unlinkSync(rotatedPath); } catch {}
          fs.renameSync(logPath, rotatedPath);
        }
      } catch {}
      fs.appendFileSync(logPath, line, { encoding: 'utf8', mode: 0o600 });
    },
  };
}

/**
 * Deletes the log file and its rotated copy of an uninstalled plugin.
 * Missing files are not an error; returns false when a file could not be removed.
 */
function removePluginLogs({ logsRoot, pluginId }) {
  if (typeof logsRoot !== 'string' || !/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(pluginId)) {
    throw new TypeError('Plugin logs require a logs root and valid plugin id');
  }
  const logPath = path.join(path.resolve(logsRoot), `${pluginId}.log`);
  let removed = true;
  for (const target of [logPath, `${logPath}.1`]) {
    if (!fs.existsSync(target)) continue;
    try {
      fs.rmSync(target, { force: true });
    } catch {
      removed = false;
    }
  }
  return removed;
}

module.exports = { MAX_LOG_BYTES, createPluginLogger, removePluginLogs, sanitizeMetadata, sanitizeText };
