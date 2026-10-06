'use strict';

/**
 * Out-of-band fetch decorator for the main process network stacks
 * (npm undici fetch / Node built-in fetch). Arguments pass through untouched,
 * responses and errors pass through untouched — the tap only records.
 *
 * Level policy mirrors the renderer capture: normal mode records failures
 * only (fetch rejection → error, HTTP 4xx/5xx → warn); debug mode records
 * everything plus request/response previews behind the size/type/rate guards.
 * Rejection levels are refined by Chromium net error code: user/caller aborts
 * (net::ERR_ABORTED) are normal control flow → info, transient network
 * conditions (network changed / offline / connection reset) → warn.
 * Error chains are expanded with mainFetch.summarizeFetchError so undici's
 * opaque "fetch failed" becomes a usable cause chain.
 */

const { summarizeFetchError } = require('./mainFetch');
const redact = require('./redact');

const MAX_PREVIEW_BYTES = 4 * 1024;
const MAX_BODY_PREVIEW_BYTES = 256 * 1024;
const BINARY_CONTENT_RE = /^(image\/|audio\/|video\/|font\/|application\/(octet-stream|zip|gzip|x-tar|pdf|wasm))/i;
const STREAMING_CONTENT_TYPE = 'text/event-stream';
/** Body-capture rate budget: at most 60 body reads per minute across taps. */
const BODY_CAPTURE_BUDGET_PER_MINUTE = 60;

const bodyBudget = { windowStart: 0, used: 0 };

/** Chromium net error of a user/caller abort (AbortController, own timeout). */
const ABORT_NET_ERRORS = ['net::ERR_ABORTED'];
/** Chromium net errors of transient network conditions, not app failures. */
const TRANSIENT_NET_ERRORS = [
  'net::ERR_NETWORK_CHANGED',
  'net::ERR_INTERNET_DISCONNECTED',
  'net::ERR_CONNECTION_RESET',
];

/**
 * Failure level for a Chromium net error string. Chromium's net.fetch reports
 * "net::ERR_*" as the cause TEXT (not a .code property), so the match is
 * substring-based and covers both causeCode and causeMessage forms.
 */
function classifyNetErrorCode(text) {
  const value = typeof text === 'string' ? text : '';
  if (ABORT_NET_ERRORS.some((code) => value.includes(code))) return 'info';
  if (TRANSIENT_NET_ERRORS.some((code) => value.includes(code))) return 'warn';
  return 'error';
}

/** Failure level for a mainFetch.summarizeFetchError result. */
function classifyNetFailure(summary) {
  // summary only keeps the deepest cause WITH a .code — Chromium net errors
  // carry no .code, so "net::ERR_*" typically survives only inside
  // summary.message (the joined cause chain).
  const text = [summary?.causeCode, summary?.causeMessage, summary?.message]
    .filter((t) => typeof t === 'string')
    .join(' ');
  return classifyNetErrorCode(text);
}

function resetBodyBudgetForTest() {
  bodyBudget.windowStart = 0;
  bodyBudget.used = 0;
}

function takeBodyBudgetSlot(nowMs) {
  if (nowMs - bodyBudget.windowStart >= 60_000) {
    bodyBudget.windowStart = nowMs;
    bodyBudget.used = 0;
  }
  if (bodyBudget.used >= BODY_CAPTURE_BUDGET_PER_MINUTE) return false;
  bodyBudget.used += 1;
  return true;
}

function headerMapToPlain(headers) {
  const result = {};
  try {
    if (headers && typeof headers.forEach === 'function') {
      headers.forEach((value, key) => { result[key] = value; });
    } else if (headers && typeof headers === 'object') {
      for (const [key, value] of Object.entries(headers)) result[key] = Array.isArray(value) ? value.join(', ') : String(value);
    }
  } catch {
    return {};
  }
  return result;
}

/** Drop cookie payloads entirely; mask credentials in the remaining headers.
 * Routes through redact's shared "headers" object handling so Authorization /
 * X-Api-Key keep their scheme prefix ("Bearer ***…") like everywhere else. */
function sanitizeHeaderMap(headers) {
  return redact.sanitizeForLog({ headers }).headers;
}

/**
 * Body preview builder. JSON text is parsed and sanitized as an OBJECT first
 * — string-level rules cannot see field names (password, apiKey, access_token…)
 * embedded inside JSON. A truncated or malformed JSON body is AMBIGUOUS: we
 * cannot prove it is sanitized, so the preview is omitted entirely instead of
 * falling back to string rules. Non-JSON text keeps the string sanitizer.
 */
function buildBodyPreview(text, maxPreviewLength) {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') {
        const sanitized = JSON.stringify(redact.sanitizeForLog(parsed));
        if (typeof sanitized !== 'string') return undefined;
        return sanitized.slice(0, maxPreviewLength) + (sanitized.length > maxPreviewLength ? '…[truncated]' : '');
      }
    } catch {
      return undefined;
    }
  }
  return redact.sanitizeForLog(text.slice(0, maxPreviewLength)) + (text.length > maxPreviewLength ? '…[truncated]' : '');
}

/**
 * Request-body preview. Bodies beyond the capture budget are omitted rather
 * than truncated-and-parsed: a cut JSON would fail to parse and fall back to
 * string rules that cannot see field names.
 */
function requestPreviewFromBody(body) {
  if (typeof body !== 'string' || body.length === 0) return undefined;
  if (body.length > MAX_BODY_PREVIEW_BYTES) return undefined;
  return buildBodyPreview(body, MAX_PREVIEW_BYTES);
}

function safeUrl(input) {
  try {
    if (typeof input === 'string') return input;
    if (input && typeof input === 'object' && typeof input.url === 'string') return input.url;
    return String(input);
  } catch {
    return '';
  }
}

function responseContentType(response) {
  try {
    return (response?.headers?.get?.('content-type') || '').toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Read only the head of a clone branch with a hard byte cap, then cancel the
 * branch — a chunked text response without content-length must not be pulled
 * into memory in full (the 256 KiB cap is enforced on BYTES READ, not on the
 * declared header).
 */
async function readCloneHead(clone, maxBytes) {
  const reader = clone?.body?.getReader?.();
  if (!reader) return undefined;
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      text += decoder.decode(value, { stream: true });
      if (bytes > maxBytes) {
        try { await reader.cancel(); } catch { /* already closed */ }
        return undefined;
      }
    }
  } catch {
    return undefined;
  }
  return text;
}

async function readResponsePreview(response, nowMs) {
  const contentType = responseContentType(response);
  if (!contentType || contentType.includes(STREAMING_CONTENT_TYPE)) return undefined;
  if (BINARY_CONTENT_RE.test(contentType)) return undefined;
  const declaredLength = Number(response?.headers?.get?.('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_PREVIEW_BYTES) return undefined;
  if (!takeBodyBudgetSlot(nowMs)) return undefined;
  try {
    const text = await readCloneHead(response.clone(), MAX_BODY_PREVIEW_BYTES);
    if (!text || text.length === 0) return undefined;
    const preview = buildBodyPreview(text, MAX_PREVIEW_BYTES);
    if (preview === undefined) return undefined;
    return { preview, contentType };
  } catch {
    return undefined;
  }
}

/**
 * Wrap a fetch implementation.
 * @param {Function} fetchImpl the fetch to decorate (undici or built-in)
 * @param {object} options
 * @param {string} options.source            recorded as data.source ("main:undici" etc.)
 * @param {Function} options.record          entry sink (diagLogger.record)
 * @param {Function} [options.isDebugMode]   () => boolean; falsy records failures only
 */
function wrapFetch(fetchImpl, { source, record, isDebugMode } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('wrapFetch requires a fetch function');
  if (typeof record !== 'function') throw new TypeError('wrapFetch requires a record sink');

  return async function tappedFetch(input, init) {
    const startedAt = Date.now();
    const rawUrl = safeUrl(input);
    const method = String(
      init?.method
      || (input && typeof input === 'object' && input.method)
      || 'GET',
    ).toUpperCase();
    try {
      const response = await fetchImpl(input, init);
      const debug = typeof isDebugMode === 'function' ? !!isDebugMode() : false;
      const failed = response.status >= 400;
      if (debug || failed) {
        const data = {
          url: redact.redactUrl(rawUrl),
          method,
          status: response.status,
          durationMs: Date.now() - startedAt,
          source,
        };
        if (debug) {
          data.requestHeaders = sanitizeHeaderMap(headerMapToPlain(init?.headers));
          const bodyPreview = requestPreviewFromBody(init?.body);
          if (bodyPreview !== undefined) data.requestBody = bodyPreview;
          data.responseHeaders = sanitizeHeaderMap(headerMapToPlain(response.headers));
          const preview = await readResponsePreview(response, Date.now());
          if (preview) {
            data.responseBody = preview.preview;
            data.responseContentType = preview.contentType;
          }
        }
        try {
          record({
            level: failed ? 'warn' : 'debug',
            module: 'electron.netTap',
            message: `${method} ${redact.redactUrl(rawUrl)} → ${response.status}`,
            data,
          });
        } catch { /* recording must not break the request path */ }
      }
      return response;
    } catch (error) {
      const summary = summarizeFetchError(error);
      const level = classifyNetFailure(summary);
      const aborted = level === 'info';
      try {
        record({
          level,
          module: 'electron.netTap',
          message: `${method} ${redact.redactUrl(rawUrl)} ${aborted ? 'aborted' : 'failed'}`,
          data: {
            url: redact.redactUrl(rawUrl),
            method,
            durationMs: Date.now() - startedAt,
            source,
            causeCode: summary.causeCode,
            causeMessage: summary.causeMessage,
            detail: summary.message,
          },
        });
      } catch { /* recording must not replace the original error */ }
      throw error;
    }
  };
}

module.exports = {
  BODY_CAPTURE_BUDGET_PER_MINUTE,
  classifyNetErrorCode,
  classifyNetFailure,
  resetBodyBudgetForTest,
  wrapFetch,
};
