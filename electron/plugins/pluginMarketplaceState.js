'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

/**
 * 插件市场（自助插件源）的状态文件：记录用户添加的插件源列表。
 *
 * 状态层只做结构规范化与"看起来像 GitHub 目录 URL"的宽松校验；URL 的完整解析
 * （owner/repo/ref/path）由 pluginMarketplace.js 负责。这样持久化层不依赖解析
 * 规则，解析规则演进时旧状态文件不会失效。
 */

const STATE_VERSION = 1;
const MAX_SOURCES = 50;
const MAX_SOURCE_URL_BYTES = 2048;
const MAX_SOURCE_NAME_BYTES = 200;

/** 源必须是 GitHub 仓库目录（或仓库根）；完整形态校验在添加时由解析器完成。 */
function isPlausibleSourceUrl(url) {
  if (typeof url !== 'string' || url.length === 0 || url.length > MAX_SOURCE_URL_BYTES) return false;
  if (/\s/.test(url)) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname.toLowerCase() === 'github.com';
  } catch {
    return false;
  }
}

function normalizeSource(input) {
  if (!input || typeof input !== 'object') return null;
  if (typeof input.id !== 'string' || !/^src-[0-9a-f-]{4,64}$/.test(input.id)) return null;
  if (!isPlausibleSourceUrl(input.url)) return null;
  const name = typeof input.name === 'string' && input.name.trim() !== ''
    ? input.name.trim().slice(0, MAX_SOURCE_NAME_BYTES)
    : null;
  return {
    id: input.id,
    url: input.url,
    ...(name ? { name } : {}),
    addedAt: typeof input.addedAt === 'string' && input.addedAt !== ''
      ? input.addedAt
      : new Date(0).toISOString(),
  };
}

function emptyState() {
  return { version: STATE_VERSION, sources: [] };
}

function normalizeState(input) {
  if (!input || input.version !== STATE_VERSION || !Array.isArray(input.sources)) {
    return emptyState();
  }
  const seen = new Set();
  const sources = [];
  for (const candidate of input.sources) {
    const source = normalizeSource(candidate);
    if (!source || seen.has(source.url.toLowerCase())) continue;
    seen.add(source.url.toLowerCase());
    sources.push(source);
    if (sources.length >= MAX_SOURCES) break;
  }
  return { version: STATE_VERSION, sources };
}

function createMarketplaceStateStore(statePath) {
  if (typeof statePath !== 'string' || statePath.trim() === '') {
    throw new TypeError('statePath must be a non-empty string');
  }
  const resolvedPath = path.resolve(statePath);

  return {
    /** 文件不存在时返回 null，让调用方能区分"还没初始化"和"用户清空了源"。 */
    load() {
      let text;
      try {
        text = fs.readFileSync(resolvedPath, 'utf8');
      } catch (error) {
        if (error && error.code === 'ENOENT') return null;
        // 其他读取错误（权限、I/O）直接上抛：把"读不到"当成"空列表"会让下一次
        // addSource 的保存覆盖掉用户原有的源列表。
        throw error;
      }
      try {
        return normalizeState(JSON.parse(text));
      } catch {
        return emptyState();
      }
    },
    save(state) {
      const normalized = normalizeState(state);
      fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
      const temporaryPath = `${resolvedPath}.${process.pid}.${randomUUID()}.tmp`;
      try {
        fs.writeFileSync(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, {
          encoding: 'utf8',
          mode: 0o600,
        });
        fs.renameSync(temporaryPath, resolvedPath);
      } catch (error) {
        try {
          fs.unlinkSync(temporaryPath);
        } catch {
          // Ignore cleanup errors; the original save error is more useful.
        }
        throw error;
      }
    },
  };
}

module.exports = {
  MAX_SOURCES,
  STATE_VERSION,
  createMarketplaceStateStore,
  emptyState,
  isPlausibleSourceUrl,
  normalizeState,
  normalizeSource,
};
