/**
 * Utilities for detecting local and LAN (local area network) addresses.
 *
 * Used to guard cleartext HTTP transmission of AI API endpoints:
 * plain HTTP is allowed for local and LAN hosts, but forbidden for
 * public Internet endpoints to prevent credential leakage.
 */

/**
 * Normalizes host input and determines whether it represents a local or LAN address:
 * - Loopback: localhost, *.localhost, 127.0.0.0/8, 0.0.0.0, ::1, ::
 * - RFC 1918 Private IPv4: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
 * - RFC 6598 CGNAT / Shared Address Space: 100.64.0.0/10 (Tailscale, homelab VPNs)
 * - RFC 3927 Link-local IPv4: 169.254.0.0/16
 * - IPv6 Local / Private: fc00::/7 (ULA), fe80::/10 (Link-local)
 * - IPv4-mapped IPv6: ::ffff:x.x.x.x
 * - LAN / local hostnames: *.local, *.lan, *.home, *.internal, *.corp, *.home.arpa
 * - Single-label hostnames without dots (e.g. "ollama", "nas", "gpu-server")
 */
export function isLocalOrLanHost(input: string): boolean {
  if (!input || typeof input !== 'string') return false;
  let raw = input.trim();

  // If a full URL is provided, extract hostname
  if (/^https?:\/\//i.test(raw)) {
    try {
      raw = new URL(raw).hostname;
    } catch {
      raw = raw.replace(/^https?:\/\//i, '').split('/')[0] || '';
    }
  }

  let h = raw.toLowerCase().trim();

  // Strip brackets from IPv6 and strip port if present
  if (h.startsWith('[')) {
    const closeIdx = h.indexOf(']');
    if (closeIdx !== -1) {
      h = h.slice(1, closeIdx);
    }
  } else {
    // Strip port only when there is exactly one colon (hostname:port or IPv4:port).
    // IPv6 addresses have at least two colons and must not have their colons split.
    const colonCount = (h.match(/:/g) || []).length;
    if (colonCount === 1) {
      h = h.split(':')[0] || '';
    }
  }

  h = h.replace(/\.$/, '');
  if (!h) return false;

  // 1. Loopback / local aliases
  if (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h === '0.0.0.0' ||
    h === '::1' ||
    h === '::'
  ) {
    return true;
  }

  // 2. LAN domain suffixes (mDNS, private DNS, home networks)
  if (
    h.endsWith('.local') ||
    h.endsWith('.lan') ||
    h.endsWith('.home') ||
    h.endsWith('.internal') ||
    h.endsWith('.corp') ||
    h.endsWith('.home.arpa')
  ) {
    return true;
  }

  // 3. Single-label hostnames without dots or colons (e.g. "ollama", "nas")
  if (!h.includes('.') && !h.includes(':')) {
    return true;
  }

  // 4. IPv4-mapped IPv6 (::ffff:192.168.1.1 or ::ffff:c0a8:0101)
  if (h.startsWith('::ffff:')) {
    const mapped = h.slice(7);
    if (mapped.includes('.')) {
      h = mapped.split(':')[0] || '';
    } else {
      const hexParts = mapped.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
      if (hexParts) {
        const v1 = parseInt(hexParts[1], 16);
        const v2 = parseInt(hexParts[2], 16);
        h = `${(v1 >>> 8) & 0xff}.${v1 & 0xff}.${(v2 >>> 8) & 0xff}.${v2 & 0xff}`;
      }
    }
  }

  // 5. IPv4 ranges
  const ipv4Match = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [a, b, c, d] = [
      parseInt(ipv4Match[1], 10),
      parseInt(ipv4Match[2], 10),
      parseInt(ipv4Match[3], 10),
      parseInt(ipv4Match[4], 10),
    ];
    if (a > 255 || b > 255 || c > 255 || d > 255) return false;

    // Loopback: 127.0.0.0/8
    if (a === 127) return true;
    // 0.0.0.0
    if (a === 0 && b === 0 && c === 0 && d === 0) return true;
    // Class A private: 10.0.0.0/8
    if (a === 10) return true;
    // Class B private: 172.16.0.0/12
    if (a === 172 && b >= 16 && b <= 31) return true;
    // Class C private: 192.168.0.0/16
    if (a === 192 && b === 168) return true;
    // CGNAT / Shared Address Space: 100.64.0.0/10 (100.64.0.0 - 100.127.255.255)
    if (a === 100 && b >= 64 && b <= 127) return true;
    // Link-local: 169.254.0.0/16
    if (a === 169 && b === 254) return true;

    return false;
  }

  // 6. IPv6 private / local ranges
  if (h.includes(':')) {
    // Unique Local Address (ULA) fc00::/7
    if (h.startsWith('fc') || h.startsWith('fd')) return true;
    // Link-local fe80::/10
    if (
      h.startsWith('fe8') ||
      h.startsWith('fe9') ||
      h.startsWith('fea') ||
      h.startsWith('feb')
    ) {
      return true;
    }
  }

  return false;
}
