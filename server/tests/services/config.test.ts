import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { normalizeEncryptionKey } from '../../src/config.js';

describe('normalizeEncryptionKey', () => {
  it('should pass through a valid 64-char hex key unchanged', () => {
    const validKey = crypto.randomBytes(32).toString('hex'); // 64 hex chars
    expect(normalizeEncryptionKey(validKey)).toBe(validKey);
  });

  it('should derive 32-byte key from short hex string (32 chars)', () => {
    const shortHex = '0123456789abcdef0123456789abcdef'; // 32 chars
    const result = normalizeEncryptionKey(shortHex);

    // Result should be 64 hex chars (32 bytes)
    expect(result).toHaveLength(64);
    expect(/^[0-9a-fA-F]{64}$/.test(result)).toBe(true);

    // Should be deterministic — same input produces same output
    expect(normalizeEncryptionKey(shortHex)).toBe(result);

    // Should be the SHA-256 of the input
    const expected = crypto.createHash('sha256').update(shortHex, 'utf8').digest('hex');
    expect(result).toBe(expected);
  });

  it('should derive key from non-hex string (base64-like)', () => {
    const base64Key = 'dGhpcyBpcyBhIGJhc2U2NCBrZXkgMTIzNA==';
    const result = normalizeEncryptionKey(base64Key);

    expect(result).toHaveLength(64);
    expect(/^[0-9a-fA-F]{64}$/.test(result)).toBe(true);

    const expected = crypto.createHash('sha256').update(base64Key, 'utf8').digest('hex');
    expect(result).toBe(expected);
  });

  it('should derive key from plain text string', () => {
    const plainKey = 'my-secret-key';
    const result = normalizeEncryptionKey(plainKey);

    expect(result).toHaveLength(64);
    expect(/^[0-9a-fA-F]{64}$/.test(result)).toBe(true);
  });

  it('should trim whitespace before processing', () => {
    const validKey = crypto.randomBytes(32).toString('hex');
    const paddedKey = `  ${validKey}  `;

    // Should match the trimmed version
    expect(normalizeEncryptionKey(paddedKey)).toBe(validKey);
  });

  it('should derive key from too-long hex string via SHA-256 (not truncate)', () => {
    const longHex = 'a'.repeat(80); // 80 hex chars
    const result = normalizeEncryptionKey(longHex);

    expect(result).toHaveLength(64);
    expect(/^[0-9a-fA-F]{64}$/.test(result)).toBe(true);

    // Should be SHA-256 derived, NOT truncated
    const expected = crypto.createHash('sha256').update(longHex, 'utf8').digest('hex');
    expect(result).toBe(expected);
    expect(result).not.toBe('a'.repeat(64)); // not a truncation
  });

  it('should handle the openssl rand -hex 16 scenario (32 chars)', () => {
    // Simulates what a user would get from: openssl rand -hex 16
    const opensslKey = crypto.randomBytes(16).toString('hex'); // 32 chars
    expect(opensslKey).toHaveLength(32);

    const result = normalizeEncryptionKey(opensslKey);
    expect(result).toHaveLength(64);

    // Must be a valid AES-256 key (32 bytes)
    const keyBuffer = Buffer.from(result, 'hex');
    expect(keyBuffer.length).toBe(32);
  });

  it('should produce a valid AES-256 key from any input', () => {
    const inputs = [
      'short',
      'a'.repeat(32),
      'a'.repeat(64),
      'a'.repeat(128),
      'base64+/==content',
      crypto.randomBytes(16).toString('hex'),
      crypto.randomBytes(32).toString('hex'),
    ];

    for (const input of inputs) {
      const result = normalizeEncryptionKey(input);
      const keyBuffer = Buffer.from(result, 'hex');
      expect(keyBuffer.length).toBe(32);
    }
  });

  it('should handle empty string input', () => {
    const result = normalizeEncryptionKey('');
    expect(result).toHaveLength(64);
    expect(/^[0-9a-fA-F]{64}$/.test(result)).toBe(true);

    // Deterministic
    expect(normalizeEncryptionKey('')).toBe(result);
  });

  it('should handle 64-char non-hex string (e.g. contains invalid hex chars)', () => {
    const nonHex64 = 'a'.repeat(63) + 'g'; // 64 chars but 'g' is not hex
    const result = normalizeEncryptionKey(nonHex64);

    expect(result).toHaveLength(64);
    expect(/^[0-9a-fA-F]{64}$/.test(result)).toBe(true);

    // Should be SHA-256 derived (not treated as valid hex)
    const expected = crypto.createHash('sha256').update(nonHex64, 'utf8').digest('hex');
    expect(result).toBe(expected);
  });
});
