'use strict';

/**
 * 防回归门禁：主进程出站请求一律走 Node 内置 fetch 与 npm undici@8 的
 * dispatcher（getFetchDispatcher 的 ProxyAgent）混用，会在拨号前抛
 * UND_ERR_INVALID_ARG: invalid onRequestStart method（Electron 44 = Node 24，
 * 内置 undici 与 npm undici@8 的 handler 协议不兼容；已实测复现）。
 *
 * 约定：main.js 顶部分别导入同版本的 { fetch: undiciFetch, ProxyAgent }，
 * 任何需要 dispatcher 的出站调用必须用 undiciFetch，禁止裸调用全局 fetch。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MAIN_JS = path.join(__dirname, 'main.js');

/** 匹配裸调用全局 fetch( —— 排除 net.fetch / globalThis.fetch / undiciFetch 等 */
const BARE_FETCH_CALL = /(?<![.\w$])fetch\s*\(/g;

describe('outbound fetch gate (UND_ERR_INVALID_ARG regression)', () => {
  it('main.js 从 npm undici 同版本导入 fetch 与 ProxyAgent', () => {
    const source = fs.readFileSync(MAIN_JS, 'utf8');
    assert.match(
      source,
      /require\('undici'\)/,
      'main.js 必须从 npm undici 导入（getFetchDispatcher 的 ProxyAgent 与 fetch 须同源）',
    );
    assert.match(
      source,
      /\{\s*fetch:\s*undiciFetch\s*,\s*ProxyAgent\s*\}\s*=\s*require\('undici'\)/,
      'main.js 必须解构同版本的 undiciFetch 与 ProxyAgent',
    );
  });

  it('main.js 不再裸调用全局 fetch（一律走 undiciFetch/net.fetch）', () => {
    const source = fs.readFileSync(MAIN_JS, 'utf8');
    const offending = [];
    const lines = source.split('\n');
    lines.forEach((line, index) => {
      BARE_FETCH_CALL.lastIndex = 0;
      if (BARE_FETCH_CALL.test(line)) offending.push(`${index + 1}: ${line.trim()}`);
    });
    assert.deepEqual(
      offending,
      [],
      '发现裸调用全局 fetch 的出站请求（会与 undici@8 的 ProxyAgent 撞 handler 协议）：\n' + offending.join('\n'),
    );
  });

  it('End-to-end 形状：同一 undici 模块的 fetch + ProxyAgent 能走到网络层', async () => {
    // 不依赖外部网络：ProxyAgent 指向不可达地址，版本匹配时错误应发生在
    // 拨号阶段（ECONNREFUSED），而不是 handler 协议阶段（UND_ERR_INVALID_ARG）
    const { fetch: undiciFetch, ProxyAgent } = require('undici');
    const agent = new ProxyAgent('http://127.0.0.1:9');
    // 先结算成数据再断言：assert 失败绝不能落进处理请求错误的 catch
    const outcome = await undiciFetch('https://localhost.invalid/', {
      dispatcher: agent,
      signal: AbortSignal.timeout(5000),
    }).then(
      (response) => ({ response }),
      (error) => ({ error }),
    );
    assert.ok(
      outcome.error,
      `请求必须失败（目标不可达），实际返回了 HTTP ${outcome.response?.status}`,
    );
    const causeCode = outcome.error && outcome.error.cause && outcome.error.cause.code;
    assert.notEqual(causeCode, 'UND_ERR_INVALID_ARG', 'undici fetch 与 ProxyAgent 版本混用');
  });
});
