/**
 * fetchCapture — a pass-through decorator around window.fetch that records a
 * network ledger for diagnostics. Requests/responses are forwarded untouched;
 * response bodies are only ever read from a clone(), never from the stream the
 * app consumes.
 *
 * Level policy: normal mode records failures only (fetch rejection → error,
 * user/timeout aborts → info, HTTP 4xx/5xx → warn); debug mode records every
 * request with request headers
 * (values masked, key names kept), a request-body preview (string bodies,
 * 8KB), and a response preview (16KB) behind three guards:
 *   1. size/type guard — content-length > 256KB or a binary content-type is
 *      never cloned (metadata only),
 *   2. streaming guard — decided by the RESPONSE content-type
 *      (text/event-stream skips body capture entirely),
 *   3. rate budget — at most 60 body captures per minute, degrading to
 *      metadata-only beyond that.
 *
 * The ledger is an independent ring buffer (1000 entries, FIFO) consumed by
 * the diagnostics panel and export bundle. Entries are also handed to the
 * diagnostics bridge (setNetworkEntrySink) so debug-mode traffic reaches the
 * main-process journal. The existing manual capture blocks in githubApi /
 * webdav / ai services stay untouched — they carry business context this
 * layer cannot know about, and the plan keeps both views without dedup.
 *
 * Not covered (by design, see plan §六): XMLHttpRequest / EventSource /
 * WebSocket — the repo has zero usages; add sibling probes here if any are
 * ever introduced.
 */

import type { LogEntry, LogLevel } from './logger';
import { sanitizeForLog, redactInline } from '../utils/logSanitizer';

const MAX_NETWORK_ENTRIES = 1000;
const REQUEST_BODY_PREVIEW_LENGTH = 8 * 1024;
const RESPONSE_BODY_PREVIEW_LENGTH = 16 * 1024;
const MAX_INLINE_BODY_BYTES = 256 * 1024;
const BODY_CAPTURE_BUDGET_PER_MINUTE = 60;
const STREAMING_CONTENT_TYPE = 'text/event-stream';
const BINARY_CONTENT_RE = /^(image\/|audio\/|video\/|font\/|application\/(octet-stream|zip|gzip|x-tar|pdf|wasm))/i;
/** Reading a clone branch longer than this is treated as a stuck stream. */
const PREVIEW_READ_TIMEOUT_MS = 4000;

export const BODY_CAPTURE_BUDGET = BODY_CAPTURE_BUDGET_PER_MINUTE;

const bodyBudget = { windowStart: 0, used: 0 };

let installed = false;
let originalFetch: ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) | null = null;
const ledger: LogEntry[] = [];
let entrySink: ((entry: LogEntry) => void) | null = null;
let ledgerIdSeq = 0;

function defaultDebugMode(): boolean {
  try {
    return sessionStorage.getItem('gsm:frontend-debug') === 'true';
  } catch {
    return false;
  }
}

let debugModeProbe: () => boolean = defaultDebugMode;

function takeBodyBudgetSlot(nowMs: number): boolean {
  if (nowMs - bodyBudget.windowStart >= 60_000) {
    bodyBudget.windowStart = nowMs;
    bodyBudget.used = 0;
  }
  if (bodyBudget.used >= BODY_CAPTURE_BUDGET_PER_MINUTE) return false;
  bodyBudget.used += 1;
  return true;
}

function toUrlString(input: RequestInfo | URL): string {
  try {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.toString();
    if (input && typeof input === 'object' && 'url' in input) return String(input.url);
    return String(input);
  } catch {
    return '';
  }
}

function toHeaderMap(headers: HeadersInit | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  try {
    if (!headers) return result;
    if (typeof Headers !== 'undefined' && headers instanceof Headers) {
      headers.forEach((value, key) => { result[key] = value; });
    } else if (Array.isArray(headers)) {
      for (const pair of headers as string[][]) {
        const [key, value] = pair;
        if (typeof key === 'string' && typeof value === 'string') result[key] = value;
      }
    } else {
      for (const [key, value] of Object.entries(headers as Record<string, string>)) {
        result[key] = String(value);
      }
    }
  } catch { /* header map is best-effort */ }
  return result;
}

/**
 * Mask header values: cookie payloads never enter the ledger; Authorization /
 * X-Api-Key keep their scheme prefix via the shared "headers" object path of
 * the sanitizer (same semantics as the main-process tap).
 */
function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const masked: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (lower === 'cookie' || lower === 'set-cookie') {
      masked[key] = '***';
      continue;
    }
    masked[key] = value;
  }
  return (sanitizeForLog({ headers: masked }) as Record<string, unknown>).headers as Record<string, string>;
}

/**
 * Body preview builder. JSON text is parsed and sanitized as an OBJECT first
 * — string-level rules cannot see field names (password, apiKey, access_token…)
 * embedded inside JSON. A truncated or malformed JSON body is AMBIGUOUS: we
 * cannot prove it is sanitized, so the preview is omitted entirely instead of
 * falling back to string rules. Non-JSON text keeps the string sanitizer.
 */
function buildBodyPreview(text: string, maxPreviewLength: number): string | undefined {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === 'object') {
        const sanitized = JSON.stringify(sanitizeForLog(parsed));
        if (typeof sanitized !== 'string') return undefined;
        return sanitized.slice(0, maxPreviewLength) + (sanitized.length > maxPreviewLength ? '…[truncated]' : '');
      }
    } catch {
      return undefined;
    }
  }
  return sanitizeForLog(text.slice(0, maxPreviewLength)) + (text.length > maxPreviewLength ? '…[truncated]' : '');
}

/**
 * Request-body preview. Bodies beyond the capture budget are omitted rather
 * than truncated-and-parsed: a cut JSON would fail to parse and fall back to
 * string rules that cannot see field names.
 */
function requestPreview(body: RequestInit['body']): string | undefined {
  if (typeof body !== 'string' || body.length === 0) return undefined;
  if (body.length > MAX_INLINE_BODY_BYTES) return undefined;
  return buildBodyPreview(body, REQUEST_BODY_PREVIEW_LENGTH);
}

function contentTypeOf(headers: Record<string, string>): string {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'content-type') return value.toLowerCase();
  }
  return '';
}

function isResponseStreamable(contentType: string, headers: Record<string, string>): boolean {
  if (contentType.includes(STREAMING_CONTENT_TYPE)) return false;
  if (BINARY_CONTENT_RE.test(contentType)) return false;
  const lengthHeader = Object.entries(headers).find(([key]) => key.toLowerCase() === 'content-length');
  const declared = Number(lengthHeader?.[1]);
  if (Number.isFinite(declared) && declared > MAX_INLINE_BODY_BYTES) return false;
  return true;
}

/**
 * Read only the head of a clone branch with a hard byte cap and a timeout,
 * then cancel the branch. Never reads the full body: chunked/NDJSON streams
 * larger than maxBytes are abandoned after the cap (or when stuck).
 */
async function readCloneHead(clone: Response, maxBytes: number): Promise<{ text: string; truncated: boolean } | undefined> {
  const reader = clone.body?.getReader?.();
  if (!reader) return undefined;
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  let truncated = false;
  let settle: () => void = () => {};
  const finished = new Promise<void>((resolve) => { settle = resolve; });
  const readAll = (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        text += decoder.decode(value, { stream: true });
        if (bytes > maxBytes) {
          truncated = true;
          break;
        }
      }
    } catch {
      truncated = true;
    } finally {
      settle();
    }
  })();
  let readAllSettled = false;
  void readAll.then(() => { readAllSettled = true; });
  const timeout = setTimeout(() => {
    if (!readAllSettled) truncated = true;
    settle();
  }, PREVIEW_READ_TIMEOUT_MS);
  try {
    await finished;
  } finally {
    clearTimeout(timeout);
    try { await reader.cancel(); } catch { /* already closed/cancelled */ }
  }
  return { text, truncated };
}

async function readResponsePreview(response: Response): Promise<{ preview: string; contentType: string } | undefined> {
  const headers = toHeaderMap(response.headers);
  const contentType = contentTypeOf(headers);
  if (!contentType) return undefined;
  if (!isResponseStreamable(contentType, headers)) return undefined;
  if (!takeBodyBudgetSlot(Date.now())) return undefined;
  try {
    const head = await readCloneHead(response.clone(), MAX_INLINE_BODY_BYTES);
    if (!head || head.text.length === 0) return undefined;
    const preview = buildBodyPreview(head.text, RESPONSE_BODY_PREVIEW_LENGTH);
    if (preview === undefined) return undefined;
    return { preview, contentType };
  } catch {
    return undefined;
  }
}

/**
 * Aborts are normal control flow, not failures: AbortController.abort()
 * surfaces as a DOMException named AbortError ("signal is aborted without
 * reason" in Chromium), AbortSignal.timeout() as a DOMException named
 * TimeoutError. Both record at info level; everything else stays at error.
 */
function errorNameOf(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const name = (error as { name?: unknown }).name;
  return typeof name === 'string' && name ? name : undefined;
}

function isAbortError(error: unknown): boolean {
  const name = errorNameOf(error);
  return name === 'AbortError'
    || (typeof DOMException !== 'undefined' && error instanceof DOMException && name === 'TimeoutError');
}

function recordEntry(level: LogLevel, message: string, data: Record<string, unknown>): void {
  const entry: LogEntry = {
    id: `net-${Date.now()}-${++ledgerIdSeq}`,
    timestamp: new Date().toISOString(),
    level,
    module: 'net.fetch',
    message,
    data,
    source: 'frontend',
  };
  ledger.push(entry);
  if (ledger.length > MAX_NETWORK_ENTRIES) ledger.shift();
  // Recording must never break the request path.
  try { entrySink?.(entry); } catch { /* sink failures are ignored */ }
}

function dispatchCompletion(
  response: Response,
  meta: { url: string; method: string; startedAt: number; requestHeaders?: Record<string, string>; requestBody?: string },
  debug: boolean,
): void {
  const failed = response.status >= 400;
  if (!debug && !failed) return;
  const record = (data: Record<string, unknown>): void => {
    recordEntry(failed ? 'warn' : 'debug', `${meta.method} ${sanitizeForLog(meta.url)} → ${response.status}`, data);
  };
  const base: Record<string, unknown> = {
    url: sanitizeForLog(meta.url),
    method: meta.method,
    status: response.status,
    durationMs: Date.now() - meta.startedAt,
    ...(debug
      ? {
          requestHeaders: meta.requestHeaders,
          ...(meta.requestBody !== undefined ? { requestBody: meta.requestBody } : {}),
          responseHeaders: sanitizeHeaders(toHeaderMap(response.headers)),
        }
      : {}),
  };
  if (!debug) {
    record(base);
    return;
  }
  // Debug mode: the ledger entry lands once the clone-branch preview has been
  // read (asynchronously, after the response has already been returned to the
  // app — the request path is never blocked by the capture).
  void readResponsePreview(response)
    .then((preview) => {
      record({
        ...base,
        ...(preview ? { responseBody: preview.preview, responseContentType: preview.contentType } : {}),
      });
    })
    .catch(() => record(base));
}

function install(
  wrapped: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): void {
  const descriptor = Object.getOwnPropertyDescriptor(window, 'fetch');
  // Keep the property configurable so uninstall() can restore the original.
  Object.defineProperty(window, 'fetch', {
    ...descriptor,
    configurable: true,
    writable: true,
    value: wrapped,
  });
}

/**
 * Decorate window.fetch once. Idempotent: repeated calls are no-ops. In the
 * vitest environment install explicitly (do not auto-install on import).
 */
export function installFetchCapture(options?: { isDebugMode?: () => boolean }): void {
  if (installed) return;
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  installed = true;
  if (options?.isDebugMode) debugModeProbe = options.isDebugMode;
  originalFetch = window.fetch.bind(globalThis);

  const tapped = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const startedAt = Date.now();
    const url = toUrlString(input);
    const method = String(init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const debug = (() => {
      try { return !!debugModeProbe(); } catch { return false; }
    })();
    const meta = {
      url,
      method,
      startedAt,
      ...(debug
        ? {
            requestHeaders: sanitizeHeaders(toHeaderMap(init?.headers ?? (input instanceof Request ? input.headers : undefined))),
            requestBody: requestPreview(init?.body),
          }
        : {}),
    };
    try {
      const response = await originalFetch!.call(globalThis, input, init);
      dispatchCompletion(response, meta, debug);
      return response;
    } catch (error) {
      const aborted = isAbortError(error);
      const errorName = errorNameOf(error);
      // 错误名也是自由文本（自定义 Error 子类可携带任意 name）：写日志前先做
      // 整值脱敏（长令牌形态的 name 只有整值规则能识别），再行内脱敏并限长。
      const sanitizedErrorName = errorName
        ? redactInline(sanitizeForLog(errorName) as string).slice(0, 120)
        : undefined;
      recordEntry(aborted ? 'info' : 'error', `${method} ${sanitizeForLog(url)} ${aborted ? 'aborted' : 'failed'}`, {
        url: sanitizeForLog(url),
        method,
        durationMs: Date.now() - startedAt,
        ...(sanitizedErrorName ? { errorName: sanitizedErrorName } : {}),
        detail: error instanceof Error ? sanitizeForLog(error.message) : String(error),
      });
      throw error;
    }
  };

  install(tapped);
}

/** Restore the original fetch (used by tests). */
export function uninstallFetchCapture(): void {
  if (!installed || !originalFetch) return;
  Object.defineProperty(window, 'fetch', {
    configurable: true,
    writable: true,
    value: originalFetch,
  });
  originalFetch = null;
  installed = false;
}

/** Network ledger snapshot (oldest first, capped at 1000 entries). */
export function getNetworkEntries(): LogEntry[] {
  return [...ledger];
}

export function clearNetworkEntries(): void {
  ledger.length = 0;
}

/** Wire ledger entries into the diagnostics bridge (main-process journal). */
export function setNetworkEntrySink(sink: ((entry: LogEntry) => void) | null): void {
  entrySink = sink;
}

/** Test helper: silence the ledger without uninstalling the fetch patch. */
export function resetFetchCaptureForTest(): void {
  ledger.length = 0;
  bodyBudget.windowStart = 0;
  bodyBudget.used = 0;
}
