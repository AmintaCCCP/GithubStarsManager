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

/** 判断是否运行在 Vercel serverless（文件系统只读，不允许落盘）。 */
const isServerless = (): boolean => process.env.VERCEL === '1' || !!process.env.TURSO_DATABASE_URL;

/** Resolve the data directory path, creating it if it doesn't exist. */
function resolveDataDir(): string {
  const dataDir = path.resolve(process.cwd(), 'data');
  if (!isServerless() && !fs.existsSync(dataDir)) {
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
 */
function resolveEncryptionKey(dataDir: string): string {
  const envKey = process.env.ENCRYPTION_KEY;
  if (envKey) {
    return normalizeEncryptionKey(envKey);
  }

  // Serverless（Vercel + Turso）文件系统只读，无法落盘：ENCRYPTION_KEY 必须
  // 由环境变量显式提供，否则每次冷启动都会生成新密钥、无法解密既有数据。
  if (isServerless()) {
    throw new Error(
      'ENCRYPTION_KEY environment variable is required in serverless/Turso mode. ' +
      'Generate once with: openssl rand -hex 32'
    );
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
  return newKey;
}

/** Load all server configuration from environment variables and defaults. */
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
