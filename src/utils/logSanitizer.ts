/**
 * Log sanitization utility — masks all sensitive data at write time.
 * The ring buffer never contains raw secrets.
 */

// Sensitive field names that trigger masking
const SENSITIVE_FIELD_NAMES = new Set([
  'apiKey', 'api_key', 'api_key_encrypted', 'password', 'password_encrypted',
  'secret', 'token', 'githubToken', 'accessToken', 'authorization',
  'x-api-key', 'credentials', 'passwd', 'pwd', 'backendApiSecret',
  'mcp_token', 'mcpToken', 'authToken', 'auth_token', 'ct0',
]);

// URL query param keys to redact
const SENSITIVE_URL_PARAMS = ['key', 'api_key', 'apikey', 'token', 'access_token', 'secret', 'client_secret', 'password', 'auth'];

// Patterns for token/key detection
const GITHUB_TOKEN_RE = /^ghp_[a-zA-Z0-9]{36}$/;
const GENERIC_SECRET_RE = /^[a-zA-Z0-9+/=_-]{20,}$/; // long base64-ish strings

/**
 * Mask a secret string: show only last 4 chars.
 */
export function maskSecret(value: string): string {
  if (!value || value.length <= 4) return '****';
  return '***' + value.slice(-4);
}

/**
 * Mask an email: keep domain, mask local part.
 */
export function maskEmail(email: string): string {
  const atIndex = email.indexOf('@');
  if (atIndex <= 0) return '***@***';
  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex + 1);
  const maskedLocal = local.length <= 2 ? '**' : local[0] + '***';
  return maskedLocal + '@' + domain;
}

/**
 * Redact sensitive query params from a URL string.
 */
export function redactUrl(url: string): string {
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

/**
 * Mask a domain in a URL: show only first and last chars of hostname.
 */
export function maskUrlDomain(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    if (host.length <= 6) return parsed.toString();
    const maskedHost = host[0] + '***' + host.slice(-2);
    parsed.hostname = maskedHost;
    // Also redact query params (case-insensitive)
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

/**
 * Detect if a string looks like a GitHub token.
 */
function isGitHubToken(value: string): boolean {
  return GITHUB_TOKEN_RE.test(value);
}

/**
 * Detect if a string looks like a generic API key/secret.
 * Only flags if it's 20+ chars of alphanumeric/special chars.
 */
function looksLikeSecret(value: string): boolean {
  return value.length >= 20 && GENERIC_SECRET_RE.test(value);
}

/**
 * Detect if a string looks like an email address.
 */
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Recursively sanitize an object for logging.
 * Walks objects and arrays, masking sensitive field values,
 * token patterns, email addresses, and URLs.
 */
export function sanitizeForLog(input: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (input === null || input === undefined) return input;
  if (typeof input === 'string') return sanitizeString(input);
  if (typeof input === 'number' || typeof input === 'boolean') return input;
  if (typeof input === 'object') {
    if (seen.has(input as object)) return '[Circular]';
    seen.add(input as object);
    const result = Array.isArray(input)
      ? input.map((v) => sanitizeForLog(v, seen))
      : sanitizeObject(input as Record<string, unknown>, seen);
    seen.delete(input as object);
    return result;
  }
  // Functions, Symbols, etc. — convert to string and sanitize
  return sanitizeString(String(input));
}

function sanitizeString(value: string): string {
  // GitHub token pattern
  if (isGitHubToken(value)) return maskSecret(value);

  // MCP bearer tokens (gsm_mcp_…)
  if (value.startsWith('gsm_mcp_')) return maskSecret(value);

  // Plain-string secrets (e.g., sk-..., long base64-like strings)
  if (looksLikeSecret(value)) return maskSecret(value);

  // Email pattern
  if (EMAIL_RE.test(value)) return maskEmail(value);

  // URL containing sensitive query params
  if (value.startsWith('http://') || value.startsWith('https://')) {
    return redactUrl(value);
  }

  // Bearer token in Authorization header value
  if (value.startsWith('Bearer ') || value.startsWith('bearer ')) {
    const tokenPart = value.slice(7);
    return value.slice(0, 7) + maskSecret(tokenPart);
  }

  // Basic auth header
  if (value.startsWith('Basic ') || value.startsWith('basic ')) {
    return value.slice(0, 6) + '***';
  }

  return value;
}

function sanitizeObject(obj: Record<string, unknown>, seen: WeakSet<object>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();

    // Sensitive field name → always mask
    if (SENSITIVE_FIELD_NAMES.has(key) || SENSITIVE_FIELD_NAMES.has(lowerKey)) {
      result[key] = typeof value === 'string' ? maskSecret(value) : '****';
      continue;
    }

    // Field names containing partial matches
    if (lowerKey.includes('password') || lowerKey.includes('passwd') || lowerKey.includes('pwd')) {
      result[key] = typeof value === 'string' ? maskSecret(value) : '****';
      continue;
    }
    if (lowerKey.includes('token') || lowerKey.includes('secret') || lowerKey.includes('apikey')) {
      result[key] = typeof value === 'string' ? maskSecret(value) : '****';
      continue;
    }

    // Header objects: mask Authorization values
    if (typeof value === 'object' && value !== null && (lowerKey === 'headers' || lowerKey === 'header')) {
      result[key] = sanitizeHeaders(value as Record<string, unknown>, seen);
      continue;
    }

    // Recurse into nested objects/arrays
    result[key] = sanitizeForLog(value, seen);
  }
  return result;
}

function sanitizeHeaders(headers: Record<string, unknown>, seen: WeakSet<object>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey === 'authorization' || lowerKey === 'x-api-key') {
      result[key] = typeof value === 'string' ? sanitizeString(value) : '****';
    } else {
      result[key] = sanitizeForLog(value, seen);
    }
  }
  return result;
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
export function redactInline(text: string): string {
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

/** Maximum sanitized name length kept per error. */
const MAX_NAME_LENGTH = 120;

/**
 * Sanitize an Error object for logging.
 * Extracts message and stack, sanitizes any embedded secrets.
 * DOMException is handled explicitly: in some runtimes it does not inherit
 * from Error, and the previous `instanceof Error` guard would degrade it to
 * a message-only string, losing the independent name/stack fields.
 * The name is inline-redacted and capped too — custom error names are free-form
 * strings and can carry embedded credentials just like messages.
 */
export function sanitizeError(err: unknown): { message: string; stack?: string; name?: string } {
  const isErrorLike = err instanceof Error
    || (typeof DOMException !== 'undefined' && err instanceof DOMException);
  if (!isErrorLike) {
    return { message: redactInline(sanitizeString(String(err))) };
  }
  const { name, message, stack } = err as Error;
  return {
    name: redactInline(sanitizeString(String(name ?? ''))).slice(0, MAX_NAME_LENGTH),
    message: redactInline(sanitizeString(message)),
    stack: stack ? redactInline(sanitizeString(stack)).slice(0, MAX_STACK_LENGTH) : undefined,
  };
}