'use strict';

/**
 * Deep Link 的 Electron 侧纯逻辑（开发守则 §12）。
 *
 * 只在主进程做两件事：从命令行参数里找出深链、校验它确实是本应用的协议。
 * 参数的业务校验在渲染进程（`src/utils/deepLink.ts`）再做一遍——主进程不猜参数含义，
 * 也不根据深链执行任何动作。
 */

const DEEP_LINK_SCHEME = 'githubstarsmanager:';
const DEEP_LINK_PREFIX = 'githubstarsmanager://';

/** 只接受本应用协议的绝对 URL；大小写不敏感，但会规范化协议部分。 */
function normalizeDeepLink(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.slice(0, DEEP_LINK_PREFIX.length).toLowerCase() !== DEEP_LINK_PREFIX) return null;
  const target = trimmed.slice(DEEP_LINK_PREFIX.length);
  // 只有协议头没有目标（`githubstarsmanager://`、`githubstarsmanager:///`）不算深链
  if (!target.replace(/^\/+/, '').trim()) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol.toLowerCase() !== DEEP_LINK_SCHEME) return null;
    return `${DEEP_LINK_PREFIX}${target}`;
  } catch {
    return null;
  }
}

/** 从 argv 里找出第一个深链（Windows / Linux 第二次启动就是这样传进来的）。 */
function findDeepLinkArg(argv) {
  if (!Array.isArray(argv)) return null;
  for (const arg of argv) {
    const found = normalizeDeepLink(arg);
    if (found) return found;
  }
  return null;
}

module.exports = { DEEP_LINK_PREFIX, DEEP_LINK_SCHEME, findDeepLinkArg, normalizeDeepLink };
