import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

interface Config {
  port: number;
  apiSecret: string | null;
  encryptionKey: string;
  dbPath: string;
  nodeEnv: string;
}

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
 * - Non-hex input (base64, plain text) → SHA-256 derived
 * - Too-long hex → truncated to 64 chars
 */
export function normalizeEncryptionKey(key: string): string {
  const trimmed = key.trim();

  // Already a valid 32-byte hex key — pass through unchanged
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return trimmed;
  }

  // Hex string but wrong length — derive via SHA-256 for deterministic 32-byte result
  if (/^[0-9a-fA-F]+$/.test(trimmed)) {
    if (trimmed.length > 64) {
      console.warn(`[config] ENCRYPTION_KEY is ${trimmed.length} hex chars, truncating to 64.`);
      return trimmed.slice(0, 64);
    }
    console.warn(`[config] ENCRYPTION_KEY is ${trimmed.length} hex chars (expected 64). Deriving 32-byte key via SHA-256. Previously encrypted data may need re-encryption.`);
    return crypto.createHash('sha256').update(trimmed, 'utf8').digest('hex');
  }

  // Non-hex input (base64, plain text, etc.) — derive via SHA-256
  console.warn('[config] ENCRYPTION_KEY is not a valid hex string. Deriving 32-byte key via SHA-256.');
  return crypto.createHash('sha256').update(trimmed, 'utf8').digest('hex');
}

function resolveEncryptionKey(dataDir: string): string {
  const envKey = process.env.ENCRYPTION_KEY;
  if (envKey) {
    return normalizeEncryptionKey(envKey);
  }

  const keyFilePath = path.join(dataDir, '.encryption-key');
  if (fs.existsSync(keyFilePath)) {
    const fileKey = fs.readFileSync(keyFilePath, 'utf-8').trim();
    return normalizeEncryptionKey(fileKey);
  }

  const newKey = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(keyFilePath, newKey, { mode: 0o600 });
  console.log('Generated new encryption key and saved to data/.encryption-key');
  return newKey;
}

function loadConfig(): Config {
  const dataDir = resolveDataDir();

  return {
    port: parseInt(process.env.PORT || '3000', 10),
    apiSecret: process.env.API_SECRET || null,
    encryptionKey: resolveEncryptionKey(dataDir),
    dbPath: process.env.DB_PATH || path.join(dataDir, 'data.db'),
    nodeEnv: process.env.NODE_ENV || 'development',
  };
}

export const config = loadConfig();
