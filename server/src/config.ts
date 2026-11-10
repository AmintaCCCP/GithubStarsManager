import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

interface Config {
  port: number;
  apiSecret: string | null;
  /** Where the active API secret came from: 'env' (operator-set), 'generated'
   *  (server-side random secret in data/.api-secret) or null (dev mode). */
  apiSecretSource: 'env' | 'generated' | null;
  allowInsecureNoAuth: boolean;
  encryptionKey: string;
  dbPath: string;
  nodeEnv: string;
}

/** Resolve the data directory path, creating it if it doesn't exist. */
function resolveDataDir(): string {
  const dataDir = path.resolve(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return dataDir;
}

/**
 * Normalize an encryption key to a 64-char hex string (32 bytes) suitable for AES-256.
 *
 * Backward compatibility:
 * - Valid 64-char hex string → returned as-is (no change for existing users)
 * - Short hex (e.g. 32 chars from `openssl rand -hex 16`) → SHA-256 derived
 * - Non-hex input (base64, plain text, too-long hex) → SHA-256 derived
 */
export function normalizeEncryptionKey(key: string): string {
  const trimmed = key.trim();

  // Already a valid 32-byte hex key — pass through unchanged
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return trimmed;
  }

  // Hex string but wrong length — derive via SHA-256 for deterministic 32-byte result
  if (/^[0-9a-fA-F]+$/.test(trimmed)) {
    console.warn(`[config] ENCRYPTION_KEY is ${trimmed.length} hex chars (expected 64). Deriving 32-byte key via SHA-256. Previously encrypted data may need re-encryption.`);
    return crypto.createHash('sha256').update(trimmed, 'utf8').digest('hex');
  }

  // Non-hex input (base64, plain text, etc.) — derive via SHA-256
  console.warn('[config] ENCRYPTION_KEY is not a valid hex string. Deriving 32-byte key via SHA-256.');
  return crypto.createHash('sha256').update(trimmed, 'utf8').digest('hex');
}

/**
 * Resolve the AES-256 encryption key from env var, key file, or auto-generation.
 * All non-standard formats are normalized to a 64-char hex string (32 bytes).
 * Exported for tests.
 */
export function resolveEncryptionKey(dataDir: string): string {
  const envKey = process.env.ENCRYPTION_KEY;
  if (envKey) {
    return normalizeEncryptionKey(envKey);
  }

  const keyFilePath = path.join(dataDir, '.encryption-key');
  if (fs.existsSync(keyFilePath)) {
    const fileKey = fs.readFileSync(keyFilePath, 'utf-8').trim();
    const normalized = normalizeEncryptionKey(fileKey);
    // Persist normalized key so future startups (even without normalization) use the correct format
    if (normalized !== fileKey) {
      fs.writeFileSync(keyFilePath, normalized, { mode: 0o600 });
      console.log('[config] Normalized encryption key written back to data/.encryption-key');
    }
    return normalized;
  }

  const newKey = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(keyFilePath, newKey, { mode: 0o600 });
  console.log('Generated new encryption key and saved to data/.encryption-key');
  console.warn(
    '[config] ⚠️  Backup data/.encryption-key now. Your data and this key live on the same volume; ' +
      'if the volume is lost, all encrypted secrets (GitHub token, AI keys, WebDAV passwords) are unrecoverable.',
  );
  return newKey;
}

/**
 * Parse the ALLOW_INSECURE_NO_AUTH escape hatch: '1' or 'true' (case-insensitive)
 * opts a deployment back into the legacy no-auth dev mode when API_SECRET is unset.
 */
export function isInsecureNoAuthEnabled(value: string | undefined): boolean {
  return typeof value === 'string' && /^(1|true)$/i.test(value.trim());
}

export interface ResolvedApiSecret {
  /** The active secret, or null in explicit dev mode (no auth). */
  secret: string | null;
  /** 'env' when operator-set, 'generated' for any server-side secret. */
  source: 'env' | 'generated' | null;
}

/**
 * Resolve the API auth secret:
 * 1. API_SECRET env var set (non-blank) → use it (trimmed).
 * 2. ALLOW_INSECURE_NO_AUTH=1/true → return null (dev mode: auth middleware
 *    allows all requests after a loud warning).
 * 3. Otherwise auto-generate a per-deployment secret, persisted as
 *    <dataDir>/.api-secret so restarts and connected clients reuse it.
 *
 * Read-before-write: an existing .api-secret is always reused, never
 * overwritten. If the file cannot be written (read-only volume, race lost to a
 * concurrent start), the server falls back to a per-process random secret
 * instead of crash-looping — auth stays on, with a loud error explaining the fix.
 */
export function resolveApiSecret(dataDir: string): ResolvedApiSecret {
  const envSecret = process.env.API_SECRET;
  if (envSecret && envSecret.trim()) {
    return { secret: envSecret.trim(), source: 'env' };
  }

  // Explicit dev escape hatch — auth middleware will warn loudly.
  if (isInsecureNoAuthEnabled(process.env.ALLOW_INSECURE_NO_AUTH)) {
    return { secret: null, source: null };
  }

  const secretFilePath = path.join(dataDir, '.api-secret');

  // Reuse the existing secret; never regenerate or truncate it.
  if (fs.existsSync(secretFilePath)) {
    try {
      const existing = fs.readFileSync(secretFilePath, 'utf-8').trim();
      if (existing) return { secret: existing, source: 'generated' };
      console.error('[config] data/.api-secret exists but is empty. Using a temporary in-memory secret for this run; delete the empty file (or set API_SECRET) and restart to persist a new one.');
      return { secret: crypto.randomBytes(32).toString('hex'), source: 'generated' };
    } catch (error) {
      console.error(`[config] Failed to read existing data/.api-secret: ${(error as Error).message}. Using a temporary in-memory secret for this run; fix the file permissions or set API_SECRET to make it persistent.`);
      return { secret: crypto.randomBytes(32).toString('hex'), source: 'generated' };
    }
  }

  const generated = crypto.randomBytes(32).toString('hex');
  try {
    // flag 'wx' — never clobber a file that appeared concurrently.
    fs.writeFileSync(secretFilePath, generated, { mode: 0o600, flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      // A concurrent startup created the file first — its secret wins.
      try {
        const existing = fs.readFileSync(secretFilePath, 'utf-8').trim();
        if (existing) return { secret: existing, source: 'generated' };
      } catch { /* fall through to ephemeral below */ }
    }
    console.error(`[config] Failed to persist data/.api-secret: ${(error as Error).message}. Using a temporary in-memory secret for this run (it changes on every restart); set the API_SECRET environment variable, or make the data directory writable, to avoid this.`);
    return { secret: crypto.randomBytes(32).toString('hex'), source: 'generated' };
  }

  console.warn('──────────────────────────────────────────────────────────────────');
  console.warn('🔒 API_SECRET was not set — a secure random secret has been generated (security hardening).');
  console.warn(`   Saved to: ${secretFilePath}`);
  console.warn('   All /api requests now require this secret as a Bearer token.');
  console.warn('   Retrieve it: cat ' + secretFilePath);
  console.warn('   (Docker deployments: docker compose exec backend cat /app/data/.api-secret —');
  console.warn('    this banner is also visible again via docker compose logs backend)');
  console.warn('   The Web UI will ask for this API Secret once when connecting.');
  console.warn('   To choose your own secret instead, set API_SECRET in your .env / compose environment.');
  console.warn('──────────────────────────────────────────────────────────────────');
  return { secret: generated, source: 'generated' };
}

/** Load all server configuration from environment variables and defaults. */
function loadConfig(): Config {
  const dataDir = resolveDataDir();
  const resolvedSecret = resolveApiSecret(dataDir);

  return {
    port: parseInt(process.env.PORT || '3000', 10),
    apiSecret: resolvedSecret.secret,
    apiSecretSource: resolvedSecret.source,
    allowInsecureNoAuth: isInsecureNoAuthEnabled(process.env.ALLOW_INSECURE_NO_AUTH),
    encryptionKey: resolveEncryptionKey(dataDir),
    dbPath: process.env.DB_PATH || path.join(dataDir, 'data.db'),
    nodeEnv: process.env.NODE_ENV || 'development',
  };
}

export const config = loadConfig();
