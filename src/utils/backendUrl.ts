/**
 * Backend URL normalization shared by the backend adapter (probing, storage)
 * and the login screen (pre-submit validation).
 */

const isLoopbackHostname = (hostname: string): boolean =>
  hostname === 'localhost' ||
  hostname.endsWith('.localhost') ||
  hostname.startsWith('127.') ||
  hostname === '[::1]' ||
  hostname === '::1';

/**
 * Normalize a user-supplied backend URL, or return null when it must be
 * rejected:
 *  - only http/https protocols are accepted;
 *  - remote backends must use HTTPS so the API key and the restored GitHub
 *    token never travel in cleartext (CWE-319); HTTP stays available for
 *    loopback development backends;
 *  - embedded userinfo credentials are stripped.
 */
export const normalizeBackendUrl = (value: string): string | null => {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.protocol === 'http:' && !isLoopbackHostname(url.hostname)) return null;
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    const normalized = url.toString().replace(/\/$/, '');
    return normalized.endsWith('/api') ? normalized : `${normalized}/api`;
  } catch {
    return null;
  }
};
