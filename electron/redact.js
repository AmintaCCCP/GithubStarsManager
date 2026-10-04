'use strict';

/**
 * Main-process log sanitization — mirrors src/utils/logSanitizer.ts /
 * server/src/services/logSanitizer.ts behavior for diagnostics written by
 * electron/diagLogger. The renderer copies cannot be imported from plain-CJS
 * electron code, so this is the fourth copy of the rules; shared test vectors
 * in tests/fixtures/sanitization-vectors.json lock the four copies to the
 * same observable behavior (see redact.test.js / logSanitizer.vectors.test.ts
 * and server/tests/services/logSanitizer.vectors.test.ts).
 */

// Union of the sensitive field names from the renderer and backend copies.
const SENSITIVE_FIELD_NAMES = new Set([
  'apiKey', 'api_key', 'api_key_encrypted', 'password', 'password_encrypted',
  'secret', 'token', 'githubToken', 'accessToken', 'authorization',
  'x-api-key', 'credentials', 'passwd', 'pwd', 'backendApiSecret',
  'mcp_token', 'mcpToken', 'authToken', 'auth_token', 'auth_token_encrypted', 'ct0',
]);

// Header names whose values are always dropped entirely (cookie values are
// full credentials; the sanitizer keeps key names but never cookie payloads).
const DROPPED_HEADER_VALUES = new Set(['cookie', 'set-cookie']);

const SENSITIVE_URL_PARAMS = ['key', 'api_key', 'apikey', 'token', 'access_token', 'secret', 'client_secret', 'password', 'auth'];

const GITHUB_TOKEN_RE = /^ghp_[a-zA-Z0-9]{36}$/;
const GENERIC_SECRET_RE = /^[a-zA-Z0-9+/=_-]{20,}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Maximum length of any sanitized string (matches renderer preview budgets). */
const MAX_STRING_LENGTH = 16 * 1024;

function maskSecret(value) {
  if (!value || value.length <= 4) return '****';
  return '***' + value.slice(-4);
}

function maskEmail(email) {
  const atIndex = email.indexOf('@');
  if (atIndex <= 0) return '***@***';
  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex + 1);
  const maskedLocal = local.length <= 2 ? '**' : local[0] + '***';
  return maskedLocal + '@' + domain;
}

function redactUrl(url) {
  try {
    const parsed = new URL(url);
    for (const [key] of parsed.searchParams) {
      if (SENSITIVE_URL_PARAMS.includes(key.toLowerCase())) {
        parsed.searchParams.set(key, '***');
      }
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

function isGitHubToken(value) {
  return GITHUB_TOKEN_RE.test(value);
}

function looksLikeSecret(value) {
  return value.length >= 20 && GENERIC_SECRET_RE.test(value);
}

function sanitizeString(value) {
  if (isGitHubToken(value)) return maskSecret(value);
  if (value.startsWith('gsm_mcp_')) return maskSecret(value);
  if (looksLikeSecret(value)) return maskSecret(value);
  if (EMAIL_RE.test(value)) return maskEmail(value);
  if (value.startsWith('http://') || value.startsWith('https://')) return redactUrl(value);
  if (value.startsWith('Bearer ') || value.startsWith('bearer ')) return value.slice(0, 7) + maskSecret(value.slice(7));
  if (value.startsWith('Basic ') || value.startsWith('basic ')) return value.slice(0, 6) + '***';
  return value;
}

function sanitizeHeaders(headers, seen) {
  const result = {};
  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (DROPPED_HEADER_VALUES.has(lowerKey)) {
      result[key] = '***';
      continue;
    }
    if (lowerKey === 'authorization' || lowerKey === 'x-api-key') {
      result[key] = typeof value === 'string' ? sanitizeString(value) : '****';
    } else {
      result[key] = sanitizeForLog(value, seen);
    }
  }
  return result;
}

function sanitizeObject(obj, seen) {
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();

    if (SENSITIVE_FIELD_NAMES.has(key) || SENSITIVE_FIELD_NAMES.has(lowerKey)) {
      result[key] = typeof value === 'string' ? maskSecret(value) : '****';
      continue;
    }
    if (lowerKey.includes('password') || lowerKey.includes('passwd') || lowerKey.includes('pwd')) {
      result[key] = typeof value === 'string' ? maskSecret(value) : '****';
      continue;
    }
    if (lowerKey.includes('token') || lowerKey.includes('secret') || lowerKey.includes('apikey')) {
      result[key] = typeof value === 'string' ? maskSecret(value) : '****';
      continue;
    }
    if (typeof value === 'object' && value !== null && (lowerKey === 'headers' || lowerKey === 'header')) {
      result[key] = sanitizeHeaders(value, seen);
      continue;
    }
    result[key] = sanitizeForLog(value, seen);
  }
  return result;
}

/**
 * Recursively sanitize arbitrary input for logging. Objects/arrays are walked
 * (cycle-safe), strings are pattern-masked, and any string exceeding
 * MAX_STRING_LENGTH is truncated so a huge payload cannot bloat the journal.
 */
function sanitizeForLog(input, seen = new Set()) {
  if (input === null || input === undefined) return input;
  if (typeof input === 'string') {
    const sanitized = sanitizeString(input);
    return sanitized.length > MAX_STRING_LENGTH ? sanitized.slice(0, MAX_STRING_LENGTH) + '…[truncated]' : sanitized;
  }
  if (typeof input === 'number' || typeof input === 'boolean') return input;
  if (typeof input === 'object') {
    if (seen.has(input)) return '[Circular]';
    seen.add(input);
    const result = Array.isArray(input)
      ? input.map((v) => sanitizeForLog(v, seen))
      : sanitizeObject(input, seen);
    seen.delete(input);
    return result;
  }
  return sanitizeString(String(input));
}

/**
 * Substring-level redaction for free-form error text (messages, stacks).
 * sanitizeString only recognizes values that match a pattern in full, so a
 * credential embedded inside prose would otherwise survive into the journal.
 * Order matters: URL first (it may contain tokens), then scheme-prefixed
 * credentials, then bare token shapes, then emails. Every sanitizer copy
 * (redact.js, renderer, backend) keeps this list byte-identical and is pinned
 * by the shared errorMessages vectors.
 */
function redactInline(text) {
  return String(text)
    .replace(/https?:\/\/[^\s"'<>]+/g, (url) => redactUrl(url))
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 ***')
    .replace(/\bghp_[A-Za-z0-9]{36}\b/g, (value) => maskSecret(value))
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, (value) => maskSecret(value))
    .replace(/\bgsm_mcp_\S+/g, (value) => maskSecret(value))
    .replace(/[^@\s"'<>]+@[^@\s"'<>]+\.[A-Za-z]{2,}/g, (value) => maskEmail(value));
}

/** Maximum sanitized stack length kept per error. */
const MAX_STACK_LENGTH = 8000;

/**
 * Sanitize an Error-like value into a plain { name, message, stack } record.
 * Whole-value redaction (sanitizeString) plus substring redaction for
 * credentials embedded in messages/stacks.
 */
function sanitizeError(err) {
  if (!(err instanceof Error)) {
    return { message: redactInline(sanitizeString(String(err))) };
  }
  return {
    name: err.name,
    message: redactInline(sanitizeString(err.message)),
    stack: err.stack ? redactInline(sanitizeString(err.stack)).slice(0, MAX_STACK_LENGTH) : undefined,
  };
}

module.exports = {
  MAX_STRING_LENGTH,
  SENSITIVE_URL_PARAMS,
  maskEmail,
  maskSecret,
  redactUrl,
  sanitizeError,
  sanitizeForLog,
  sanitizeString,
};
