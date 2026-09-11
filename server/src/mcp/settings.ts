import crypto from 'node:crypto';
import { db } from '../db/client.js';
import { encrypt, decrypt } from '../services/crypto.js';
import { config } from '../config.js';
import { logger } from '../services/logger.js';

export const MCP_SETTING_ENABLED = 'mcp_enabled';
export const MCP_SETTING_TOKEN = 'mcp_token';

/** AES-GCM ciphertext format used by services/crypto: iv:ciphertext:tag */
function looksEncrypted(value: string): boolean {
  const parts = value.split(':');
  return parts.length === 3 && parts.every((p) => p.length > 0);
}

export function generateMcpToken(): string {
  return `gsm_mcp_${crypto.randomBytes(24).toString('base64url')}`;
}

export async function getSettingRaw(key: string): Promise<string | null> {
  const row = await db.get<{ value: string | null }>('SELECT value FROM settings WHERE key = ?', key);
  return row?.value ?? null;
}

export async function setSettingRaw(key: string, value: string | null): Promise<void> {
  await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', key, value);
}

export async function isMcpEnabled(): Promise<boolean> {
  const raw = await getSettingRaw(MCP_SETTING_ENABLED);
  return raw === '1' || raw === 'true';
}

export async function setMcpEnabled(enabled: boolean): Promise<void> {
  await setSettingRaw(MCP_SETTING_ENABLED, enabled ? '1' : '0');
}

/** Returns plaintext MCP token, or null if unset / undecryptable. */
export async function getMcpTokenPlain(): Promise<string | null> {
  const stored = await getSettingRaw(MCP_SETTING_TOKEN);
  if (!stored) return null;
  try {
    if (looksEncrypted(stored)) {
      return decrypt(stored, config.encryptionKey);
    }
    // Legacy / resilience: accept plaintext only if it looks like our token prefix
    if (stored.startsWith('gsm_mcp_')) {
      return stored;
    }
    logger.warn('mcp.token', 'Ignoring mcp_token with unexpected format');
    return null;
  } catch (err) {
    logger.warn('mcp.token', 'Failed to decrypt mcp_token', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function setMcpTokenPlain(token: string): Promise<void> {
  if (!token || typeof token !== 'string') {
    throw new Error('MCP token must be a non-empty string');
  }
  const encrypted = encrypt(token, config.encryptionKey);
  await setSettingRaw(MCP_SETTING_TOKEN, encrypted);
}

/**
 * Create token only if missing. Does not enable MCP.
 * Token is durable in SQLite (encrypted); never rotated here — only resetMcpToken() does.
 */
export async function ensureMcpToken(): Promise<string> {
  const existing = await getMcpTokenPlain();
  if (existing) return existing;
  const token = generateMcpToken();
  await setMcpTokenPlain(token);
  return token;
}

/** Explicit user-initiated rotation only. */
export async function resetMcpToken(): Promise<string> {
  const token = generateMcpToken();
  await setMcpTokenPlain(token);
  return token;
}

/**
 * Constant-time string compare. Different lengths always return false without
 * short-circuiting the comparison on shared prefix length of the shorter buffer.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    // Compare against self-sized zero buffer to keep roughly constant work for wrong length
    const dummy = Buffer.alloc(aBuf.length);
    crypto.timingSafeEqual(aBuf, dummy);
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}
