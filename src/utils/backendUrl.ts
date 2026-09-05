/**
 * Backend URL normalization shared by the backend adapter (probing, storage)
 * and the login screen (pre-submit validation).
 */

// Strict dotted-quad check: `127.example.com` also starts with "127." but is a
// remote hostname that could resolve to an attacker-controlled address.
const isIPv4Loopback = (hostname: string): boolean => {
  const octets = hostname.split('.');
  return (
    octets.length === 4 &&
    octets[0] === '127' &&
    octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
  );
};

const isLoopbackHostname = (hostname: string): boolean =>
  hostname === 'localhost' ||
  hostname.endsWith('.localhost') ||
  isIPv4Loopback(hostname) ||
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
