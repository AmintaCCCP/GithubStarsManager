'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PAGE_SCHEME = 'plugin-page';
function pageCsp(pluginId) {
  const localSource = `${PAGE_SCHEME}://${pluginId}`;
  return [
    "default-src 'none'",
    `script-src ${localSource}`,
    `style-src ${localSource}`,
    `img-src ${localSource} data:`,
    `font-src ${localSource} data:`,
    "connect-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function isInsideOrEqual(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function pageUrl(pluginId, pageId) {
  return `${PAGE_SCHEME}://${pluginId}/${pageId}/index.html`;
}

function readPageResource(urlValue, pluginDirectory, manifest) {
  let url;
  try { url = new URL(urlValue); } catch { return null; }
  if (url.protocol !== `${PAGE_SCHEME}:` || url.hostname !== manifest.id || url.search || url.hash) return null;
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length < 2) return null;
  let decoded;
  try { decoded = segments.map((segment) => decodeURIComponent(segment)); } catch { return null; }
  if (decoded.some((segment) => !segment || segment === '.' || segment === '..' || /[\\/:\x00-\x1f]/.test(segment))) return null;
  const [pageId, ...resourceParts] = decoded;
  const page = manifest.contributes.pages?.find((item) => item.id === pageId);
  if (!page) return null;
  const pageRoot = path.resolve(pluginDirectory, path.dirname(page.entry));
  const resource = resourceParts.join('/') === 'index.html'
    ? path.resolve(pluginDirectory, page.entry)
    : path.resolve(pageRoot, ...resourceParts);
  if (!isInsideOrEqual(pageRoot, resource)) return null;
  if (resource === path.resolve(pluginDirectory, 'manifest.json') ||
    (manifest.main && resource === path.resolve(pluginDirectory, manifest.main))) return null;
  try {
    if (!isInsideOrEqual(fs.realpathSync(pageRoot), fs.realpathSync(resource))) return null;
    const stat = fs.statSync(resource);
    if (!stat.isFile() || stat.size > 20 * 1024 * 1024) return null;
    const mimeType = MIME_TYPES[path.extname(resource).toLowerCase()];
    if (!mimeType) return null;
    return { body: fs.readFileSync(resource), mimeType };
  } catch {
    return null;
  }
}

module.exports = { PAGE_SCHEME, pageCsp, pageUrl, readPageResource };
