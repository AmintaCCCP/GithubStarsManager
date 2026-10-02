'use strict';

/**
 * 主进程统一出站请求 helper（WebDAV、X、Telegram 共用）。
 *
 * 背景：Node fetch（undici）的网络层失败一律是 TypeError('fetch failed')，
 * 真实原因（DNS、拒绝连接、证书校验、连接超时）挂在 error.cause 链上；
 * 且 undici 直连不跟随系统代理/系统证书库，常见场景下必然失败而
 * Chromium 网络栈（net.fetch）可以成功。因此：
 * 1. extractCauseChain / summarizeFetchError 把 cause 链还原成可诊断文本；
 * 2. fetchAcrossStacks 按序尝试多个网络栈，HTTP 响应（含 4xx/5xx）视为成功，
 *    只有抛异常（网络层失败）才尝试下一个栈；
 * 3. totalTimeoutMs 把多栈尝试的总耗时收敛在调用方的超时预算内。
 */

/** 沿 error.cause 链收集 { code, message }；AggregateError 合并各子错误。 */
function extractCauseChain(error, seen = new Set()) {
  const chain = [];
  let current = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const code = typeof current.code === 'string' ? current.code : undefined;
    const message = typeof current.message === 'string' ? current.message : String(current);
    chain.push({ code, message });
    // AggregateError（如 Happy Eyeballs 双栈拨号）的子错误挂在 errors 上；
    // seen 跨递归共享，防止子错误反向引用父错误时无限递归
    if (Array.isArray(current.errors)) {
      for (const sub of current.errors) {
        if (sub && typeof sub === 'object') chain.push(...extractCauseChain(sub, seen));
      }
    }
    current = current.cause;
  }
  return chain;
}

/**
 * 把任意异常归一成 { message, causeCode, causeMessage, timedOut }。
 * message 形如 "fetch failed <- ECONNREFUSED: connect ECONNREFUSED 10.0.0.5:5006"，
 * causeCode/causeMessage 取 cause 链上最深层（最接近操作系统）的那一条。
 */
function summarizeFetchError(error) {
  const chain = extractCauseChain(error);
  const name = (error && typeof error === 'object' && typeof error.name === 'string') ? error.name : '';
  const timedOut =
    name === 'TimeoutError' ||
    name === 'AbortError' ||
    // 覆盖 UND_ERR_CONNECT_TIMEOUT / ETIMEDOUT / "connect timed out" 等写法
    chain.some((c) => /TIMED[\s_]?OUT|TIMEOUT/i.test(c.code || '')) ||
    /timed[\s_]?out|timeout/i.test(chain.map((c) => c.message).join(' '));
  const distinct = [];
  for (const entry of chain) {
    const text = entry.code ? `${entry.code}: ${entry.message}` : entry.message;
    if (text && !distinct.includes(text)) distinct.push(text);
  }
  const deepestWithCode = [...chain].reverse().find((c) => c.code);
  return {
    message: distinct.join(' <- ') || (error instanceof Error ? error.message : String(error)),
    causeCode: deepestWithCode?.code,
    causeMessage: deepestWithCode?.message,
    timedOut,
  };
}

/**
 * 按序尝试多个网络栈。stacks[i] = { name, run(ctx) => Promise<Response> }。
 * ctx.remainingMs 是本次调用剩余的毫秒预算（传入 totalTimeoutMs 时才有定义），
 * 各栈用它设置自己的 AbortSignal.timeout，避免“每个栈各等一个完整超时”。
 *
 * 可选的 stack.onResponseRetryable(response)：栈对特定响应“视为未命中”，
 * 把机会让给下一栈。用于目标站按 TLS 指纹区别对待网络栈的场景——例如
 * x.com 边缘 WAF 对 Node 网络栈（undici）一律 403 HTML 挑战页，而
 * Chromium 栈可以过；若把 403 当普通响应返回，回退永远轮不到 Chromium。
 *
 * 返回值：{ response, stack }。任何栈拿到 HTTP 响应即返回，不回退；
 * 若所有栈的响应都被判为未命中，返回最后一个（仍是合法 HTTP 响应）。
 * 全部抛异常时抛出合并错误：err.message 含各栈失败明细；
 * err.timedOut 仅当所有栈都超时；err.failures 保留逐栈摘要。
 */
/** 单栈最小预算：与 timeoutSignalFromBudget 的信号下限一致，保证不超总预算 */
const MIN_STACK_BUDGET_MS = 1000;

/** 丢弃未消费的响应体：undici 的连接需显式 cancel 才能立即归还连接池 */
async function discardResponseBody(response) {
  try {
    await response?.body?.cancel?.();
  } catch {
    // 流已被取消/锁定/不支持 cancel：忽略
  }
}

async function fetchAcrossStacks(stacks, options = {}) {
  const { totalTimeoutMs } = options;
  const minStackBudgetMs = Number.isFinite(options.minStackBudgetMs)
    ? options.minStackBudgetMs
    : MIN_STACK_BUDGET_MS;
  const startedAt = Date.now();
  const failures = [];
  let retryableMiss = null;

  for (const stack of stacks) {
    let remainingMs;
    if (typeof totalTimeoutMs === 'number' && Number.isFinite(totalTimeoutMs)) {
      remainingMs = Math.trunc(totalTimeoutMs) - (Date.now() - startedAt);
      // 余量不足一次最小拨号尝试就不再进入下一个栈
      if (remainingMs < minStackBudgetMs) break;
    }
    try {
      const response = await stack.run({ remainingMs });
      if (typeof stack.onResponseRetryable === 'function' && stack.onResponseRetryable(response)) {
        await discardResponseBody(retryableMiss?.response);
        retryableMiss = { response, stack: stack.name };
        continue;
      }
      // 后续栈成功：先前未命中栈的响应被丢弃，取消其响应体归还连接
      await discardResponseBody(retryableMiss?.response);
      return { response, stack: stack.name };
    } catch (error) {
      failures.push({ name: stack.name, summary: summarizeFetchError(error) });
    }
  }

  if (retryableMiss) return retryableMiss;

  const combined = failures.map((f) => `${f.name}: ${f.summary.message}`).join('; ');
  const err = new Error(combined || 'all network stacks failed');
  err.failures = failures;
  err.timedOut = failures.length > 0 && failures.every((f) => f.summary.timedOut);
  const last = failures[failures.length - 1]?.summary;
  if (last?.causeCode) err.causeCode = last.causeCode;
  if (last?.causeMessage) err.causeMessage = last.causeMessage;
  throw err;
}

/** 由剩余预算构造超时信号；无预算信息时退回调用方给的固定毫秒数。 */
function timeoutSignalFromBudget(remainingMs, fallbackMs) {
  const budget = typeof remainingMs === 'number' ? remainingMs : fallbackMs;
  return AbortSignal.timeout(Math.max(MIN_STACK_BUDGET_MS, Math.trunc(budget)));
}

/** 3xx 里 fetch 规范允许自动跟随的状态码 */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * 手动跟随重定向。Chromium net.fetch 的 redirect:'follow' 在跨域跳转时不会
 * 剥除 Authorization/Cookie（Electron 44 实测），会破坏 fetch 规范的凭据
 * 隔离——携带凭据的请求（WebDAV Basic）必须走这里而不是直接 follow。
 *
 * 规则与 Fetch 规范对齐：仅 http(s) 目标；跨源跳转剥离 Authorization/Cookie；
 * 303（及 301/302+POST）降级为无 body 的 GET；其余保持原方法与 body。
 */
async function followRedirectsManually(fetchImpl, url, options, { maxRedirects = 10 } = {}) {
  let currentUrl = url;
  let method = options.method || 'GET';
  let body = options.body;

  for (let redirects = 0; ; redirects++) {
    const headers = { ...(options.headers ?? {}) };
    const response = await fetchImpl(currentUrl, {
      ...options,
      redirect: 'manual',
      method,
      body, // 303/转 GET 后必须显式清掉，否则原始 body 经 ...options 透传
      headers,
    });
    if (!REDIRECT_STATUSES.has(response.status)) return response;

    const location = response.headers.get('location');
    if (!location) return response;
    if (redirects >= maxRedirects - 1) {
      throw new Error(`too many redirects (limit ${maxRedirects})`);
    }

    const next = new URL(location, currentUrl);
    if (next.protocol !== 'http:' && next.protocol !== 'https:') {
      throw new Error(`redirect to unsupported protocol blocked: ${next.protocol}`);
    }
    // 跨源跳转剥离凭据头（同源 DAV 跳转如 /path → /path/ 不受影响）
    if (next.origin !== new URL(currentUrl).origin) {
      for (const key of Object.keys(headers)) {
        const lower = key.toLowerCase();
        if (lower === 'authorization' || lower === 'cookie') delete headers[key];
      }
    }
    // 303 一律转 GET；301/302 对 POST 转 GET（fetch 规范），其余方法原样保留
    const becomeGet = response.status === 303
      ? method !== 'GET' && method !== 'HEAD'
      : (response.status === 301 || response.status === 302) && method === 'POST';
    if (becomeGet) {
      method = 'GET';
      body = undefined;
      // 降级为 GET 后 body 相关的 Content-* 请求头一并移除（手动跳转不会被 fetch 自动清理）
      for (const key of Object.keys(headers)) {
        if (/^content-(type|length|encoding|language|location)$/i.test(key)) delete headers[key];
      }
    }
    options = { ...options, headers, body };
    currentUrl = next.toString();
  }
}

/**
 * 把 fetchAcrossStacks 的合并错误（或其他异常）归一成 IPC 失败返回体：
 * { success:false, timedOut, error, causeCode?, causeMessage? }
 * 供 webdav-request 等处理器的 catch 透传给渲染进程做错误码映射。
 */
function toFailureResult(error) {
  const summary = error && Array.isArray(error.failures)
    ? {
        message: error.message,
        timedOut: !!error.timedOut,
        causeCode: error.causeCode,
        causeMessage: error.causeMessage,
      }
    : summarizeFetchError(error);
  return {
    success: false,
    timedOut: summary.timedOut,
    error: summary.message,
    ...(summary.causeCode ? { causeCode: summary.causeCode } : {}),
    ...(summary.causeMessage ? { causeMessage: summary.causeMessage } : {}),
  };
}

module.exports = {
  MIN_STACK_BUDGET_MS,
  extractCauseChain,
  summarizeFetchError,
  fetchAcrossStacks,
  timeoutSignalFromBudget,
  followRedirectsManually,
  toFailureResult,
};
