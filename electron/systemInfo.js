'use strict';

/**
 * Environment snapshot for the diagnostics bundle and the startup journal
 * entry. Pure assembly: every input is provided by the caller so this stays
 * unit-testable without Electron. Secrets never enter this module — proxy
 * auth credentials are summarized as a shape ("user:pass@host:port"),
 * never their values.
 */

/**
 * Summarize proxy config into a shape descriptor without credentials.
 * { enabled, type, host, port, username, password } → "http user@host:port" style.
 */
function describeProxyShape(config) {
  if (!config || typeof config !== 'object' || !config.enabled || !config.host || !config.port) {
    return 'system';
  }
  const kind = config.type === 'socks5' ? 'socks5' : 'http';
  const withAuth = !!config.username;
  return `${kind}${withAuth ? '+auth' : ''} ${config.host}:${config.port}`;
}

/**
 * Build the environment snapshot.
 * @param {object} parts
 * @param {object} parts.os        Node os module ({ platform, release, arch, hostname }-like)
 * @param {object} parts.versions  process.versions (electron/chrome/node fields)
 * @param {string} parts.appVersion
 * @param {string} parts.sessionId
 * @param {object} [parts.proxyConfig]   persisted proxy config (never logged verbatim)
 * @param {Array}  [parts.plugins]       [{ id, version, enabled }]
 * @param {number} [parts.repoCount]
 * @param {string} [parts.routeMode]
 * @param {boolean} [parts.frontendDebug]
 * @param {boolean} [parts.backendDebug]
 * @param {boolean} [parts.backendAvailable]
 * @param {string} [parts.language]
 * @param {object} [parts.renderer]      renderer-provided env fields kept for v1 compat
 */
function buildSystemInfo({
  os,
  versions,
  appVersion,
  sessionId,
  proxyConfig,
  plugins = [],
  repoCount,
  routeMode,
  frontendDebug = false,
  backendDebug = false,
  backendAvailable = false,
  language,
  renderer = {},
}) {
  return {
    // v1 env block fields (kept for backward compatibility)
    platform: 'electron',
    electronVersion: versions?.electron ?? null,
    osPlatform: os?.platform?.() ?? null,
    screenResolution: renderer.screenResolution ?? null,
    backendAvailable: !!backendAvailable,
    language: language ?? renderer.language ?? null,
    repoCount: typeof repoCount === 'number' ? repoCount : (renderer.repoCount ?? null),
    frontendDebugMode: !!frontendDebug,
    backendDebugMode: !!backendDebug,
    appVersion,
    // v2 additions
    osRelease: os?.release?.() ?? null,
    arch: process.arch,
    chromeVersion: versions?.chrome ?? null,
    nodeVersion: versions?.node ?? null,
    locale: typeof Intl !== 'undefined' && Intl.DateTimeFormat ? Intl.DateTimeFormat().resolvedOptions().locale : null,
    timezone: typeof Intl !== 'undefined' && Intl.DateTimeFormat ? Intl.DateTimeFormat().resolvedOptions().timeZone : null,
    proxyShape: describeProxyShape(proxyConfig),
    routeMode: routeMode ?? null,
    pluginCount: Array.isArray(plugins) ? plugins.filter((p) => p && typeof p === 'object').length : 0,
    plugins: Array.isArray(plugins)
      ? plugins
          .filter((p) => p && typeof p === 'object')
          .map((p) => ({ id: String(p.id ?? ''), version: String(p.version ?? ''), enabled: !!p.enabled }))
          .slice(0, 100)
      : [],
    sessionId,
  };
}

module.exports = { buildSystemInfo, describeProxyShape };
