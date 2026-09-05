import { createRequire } from 'node:module';

/**
 * The root package.json is the application's only version authority.
 * server/package.json is a synchronized packaged-runtime copy maintained by
 * the root sync-version script so the backend can read the same value inside
 * its standalone Docker image.
 */
const require = createRequire(import.meta.url);
const serverPackage = require('../../package.json') as { version?: unknown };

if (typeof serverPackage.version !== 'string' || !serverPackage.version.trim()) {
  throw new Error('server/package.json is missing the synchronized application version');
}

export const MCP_SERVER_VERSION = serverPackage.version;
