'use strict';

const { BlockList, isIP } = require('node:net');
const dns = require('node:dns');
const https = require('node:https');
const { protocolError } = require('./pluginProtocol');

const blocked = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24],
  ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blocked.addSubnet(network, prefix, 'ipv4');

// node:https 既不经 undici 也不经 Chromium session，netTap/webRequest 均无法
// 覆盖；这里提供模块级记录钩子，由 main.js 注入 diagLog.record（纯旁路，
// 钩子自身的异常必须被吞掉，绝不影响搜索请求）。
let networkRecorder = null;

function setNetworkRecorder(recorder) {
  networkRecorder = typeof recorder === 'function' ? recorder : null;
}

function recordNetwork(entry) {
  if (!networkRecorder) return;
  try { networkRecorder(entry); } catch { /* diagnostics must not break search */ }
}

function publicLookup(hostname, options, callback) {
  dns.lookup(hostname, { all: true, family: 4 }, (error, addresses) => {
    if (error) return callback(error);
    const address = addresses.find((item) => !blocked.check(item.address, 'ipv4'));
    if (!address) return callback(protocolError('PLUGIN_SEARCH_ENDPOINT_BLOCKED', 'Search service must resolve to a public address'));
    if (options?.all) callback(null, [{ address: address.address, family: 4 }]);
    else callback(null, address.address, 4);
  });
}

function searchUrl(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length > 2048) {
    throw protocolError('PLUGIN_SEARCH_ENDPOINT_INVALID', 'Search endpoint must be an HTTPS URL');
  }
  let url;
  try { url = new URL(endpoint); } catch {
    throw protocolError('PLUGIN_SEARCH_ENDPOINT_INVALID', 'Search endpoint must be an HTTPS URL');
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
    !host.includes('.') || host === 'localhost' || host.endsWith('.localhost') ||
    host.endsWith('.local') || isIP(host.replace(/^\[|\]$/g, ''))) {
    throw protocolError('PLUGIN_SEARCH_ENDPOINT_INVALID', 'Search endpoint must use a public HTTPS hostname without credentials');
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/search`;
  return url;
}

function validateSearchArgs(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args) ||
    Object.keys(args).some((field) => !['query', 'limit'].includes(field)) ||
    typeof args.query !== 'string' || !args.query.trim() || args.query.length > 200 ||
    (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 10))) {
    throw protocolError('PLUGIN_SEARCH_REQUEST_INVALID', 'Search query or result limit is invalid');
  }
  return { query: args.query.trim(), limit: args.limit ?? 5 };
}

function readSearchResponse(url) {
  const startedAt = Date.now();
  // Log only origin+pathname: the `q` query parameter carries the user's
  // search text, which must never reach the diagnostics journal.
  const requestUrl = `${url.origin}${url.pathname}`;
  const finish = (level, message, extra) => {
    if (extra === undefined) {
      recordNetwork({ level, module: 'plugins.webSearch', message: `GET ${requestUrl} → ${message}`, data: { url: requestUrl, durationMs: Date.now() - startedAt } });
    } else {
      recordNetwork({ level, module: 'plugins.webSearch', message: `GET ${requestUrl} failed`, data: { url: requestUrl, durationMs: Date.now() - startedAt, detail: message } });
    }
  };
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: 'GET', agent: false, timeout: 8000, family: 4, lookup: publicLookup,
      headers: { Accept: 'application/json' },
    }, (response) => {
      if (response.statusCode !== 200) {
        clearTimeout(deadline);
        response.resume();
        finish('error', response.statusCode);
        reject(protocolError('PLUGIN_SEARCH_FAILED', response.statusCode === 403
          ? 'Search service must enable JSON output' : 'Search service returned an error'));
        return;
      }
      const chunks = [];
      let bytes = 0;
      response.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > 256 * 1024) {
          request.destroy(protocolError('PLUGIN_SEARCH_RESPONSE_TOO_LARGE', 'Search response is too large'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        clearTimeout(deadline);
        finish('debug', response.statusCode);
        resolve(Buffer.concat(chunks).toString('utf8'));
      });
      response.on('error', (error) => {
        clearTimeout(deadline);
        finish('error', error?.code ?? 'response error');
        reject(error);
      });
    });
    const deadline = setTimeout(() => request.destroy(protocolError('PLUGIN_SEARCH_TIMEOUT', 'Search service timed out')), 8000);
    request.on('timeout', () => request.destroy(protocolError('PLUGIN_SEARCH_TIMEOUT', 'Search service timed out')));
    request.on('error', (error) => {
      clearTimeout(deadline);
      finish('error', error?.code ?? 'request error');
      reject(error);
    });
    request.end();
  });
}

async function searchSearxng(endpoint, args) {
  const { query, limit } = validateSearchArgs(args);
  const url = searchUrl(endpoint);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  let body;
  try {
    body = await readSearchResponse(url);
  } catch (error) {
    if (typeof error?.code === 'string' && error.code.startsWith('PLUGIN_SEARCH_')) throw error;
    throw protocolError('PLUGIN_SEARCH_FAILED', 'Search service could not be reached');
  }
  let data;
  try { data = JSON.parse(body); } catch {
    throw protocolError('PLUGIN_SEARCH_FAILED', 'Search service returned invalid JSON');
  }
  if (!Array.isArray(data?.results)) throw protocolError('PLUGIN_SEARCH_FAILED', 'Search service returned invalid results');
  return data.results.slice(0, limit * 3).flatMap((item) => {
    if (!item || typeof item !== 'object' || typeof item.title !== 'string' || typeof item.url !== 'string') return [];
    if (item.url.length > 2048) return [];
    try {
      const resultUrl = new URL(item.url);
      if (resultUrl.protocol !== 'https:' || resultUrl.username || resultUrl.password) return [];
    } catch { return []; }
    return [{ title: item.title.slice(0, 300), url: item.url, snippet: typeof item.content === 'string' ? item.content.slice(0, 1000) : '' }];
  }).slice(0, limit);
}

module.exports = { searchUrl, validateSearchArgs, searchSearxng, publicLookup, setNetworkRecorder };
