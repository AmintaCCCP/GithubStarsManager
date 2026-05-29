/**
 * Log sanitization utility — masks all sensitive data at write time.
 * The ring buffer never contains raw secrets.
 */

// Sensitive field names that trigger masking
const SENSITIVE_FIELD_NAMES = new Set([
  'apiKey', 'api_key', 'api_key_encrypted', 'password', 'password_encrypted',
  'secret', 'token', 'githubToken', 'accessToken', 'authorization',
  'x-api-key', 'credentials', 'passwd', 'pwd', 'backendApiSecret',
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
export function sanitizeForLog(input: unknown): unknown {
  if (input === null || input === undefined) return input;
  if (typeof input === 'string') return sanitizeString(input);
  if (typeof input === 'number' || typeof input === 'boolean') return input;
  if (Array.isArray(input)) return input.map(sanitizeForLog);
  if (typeof input === 'object') return sanitizeObject(input as Record<string, unknown>);
  // Functions, Symbols, etc. — convert to string and sanitize
  return sanitizeString(String(input));
}

function sanitizeString(value: string): string {
  // GitHub token pattern
  if (isGitHubToken(value)) return maskSecret(value);

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

function sanitizeObject(obj: Record<string, unknown>): Record<string, unknown> {
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
      result[key] = sanitizeHeaders(value as Record<string, unknown>);
      continue;
    }

    // Recurse into nested objects/arrays
    result[key] = sanitizeForLog(value);
  }
  return result;
}

function sanitizeHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey === 'authorization' || lowerKey === 'x-api-key') {
      result[key] = typeof value === 'string' ? sanitizeString(value) : '****';
    } else {
      result[key] = sanitizeForLog(value);
    }
  }
  return result;
}

/**
 * Sanitize an Error object for logging.
 * Extracts message and stack, sanitizes any embedded secrets.
 */
export function sanitizeError(err: unknown): { message: string; stack?: string; name?: string } {
  if (!(err instanceof Error)) {
    return { message: sanitizeString(String(err)) };
  }
  return {
    name: err.name,
    message: sanitizeString(err.message),
    stack: err.stack ? sanitizeString(err.stack) : undefined,
  };
}