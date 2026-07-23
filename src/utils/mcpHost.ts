/** Default loopback bind for desktop MCP. */
export const MCP_DEFAULT_HOST = '127.0.0.1';
export const MCP_DEFAULT_PORT = 3927;

/**
 * Normalize MCP listen host for display and bind.
 * Maps unset / wildcard hosts to 127.0.0.1; non-loopback hosts are forced to loopback
 * (desktop MCP must not expose the token surface on 0.0.0.0 / public interfaces).
 */
export function normalizeMcpHost(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return MCP_DEFAULT_HOST;
  const host = raw.trim();
  if (host === '0.0.0.0' || host === '::' || host === '[::]') return MCP_DEFAULT_HOST;
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
    return host === 'localhost' ? MCP_DEFAULT_HOST : host;
  }
  // Force loopback for any other value
  return MCP_DEFAULT_HOST;
}
