import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { encrypt, decrypt } from '../../src/services/crypto.js';

// Generate a test key (32-byte hex = 64 hex chars)
const testKey = crypto.randomBytes(32).toString('hex');

describe('Crypto Service', () => {
  it('should encrypt and decrypt back to original', () => {
    const plaintext = 'sk-my-super-secret-api-key-12345';
    const encrypted = encrypt(plaintext, testKey);
    const decrypted = decrypt(encrypted, testKey);
    expect(decrypted).toBe(plaintext);
  });

  it('should produce different ciphertexts for same plaintext (random IV)', () => {
    const plaintext = 'same-plaintext';
    const encrypted1 = encrypt(plaintext, testKey);
    const encrypted2 = encrypt(plaintext, testKey);
    expect(encrypted1).not.toBe(encrypted2);

    // But both should decrypt to the same value
    expect(decrypt(encrypted1, testKey)).toBe(plaintext);
    expect(decrypt(encrypted2, testKey)).toBe(plaintext);
  });

  it('should throw error when decrypting with wrong key', () => {
    const plaintext = 'secret-data';
    const encrypted = encrypt(plaintext, testKey);
    const wrongKey = crypto.randomBytes(32).toString('hex');

    expect(() => decrypt(encrypted, wrongKey)).toThrow();
  });

  it('should throw error when ciphertext is tampered', () => {
    const plaintext = 'important-secret';
    const encrypted = encrypt(plaintext, testKey);

    // Tamper with the ciphertext part
    const parts = encrypted.split(':');
    const ciphertextBuf = Buffer.from(parts[1], 'base64');
    ciphertextBuf[0] = ciphertextBuf[0] ^ 0xff; // flip bits
    parts[1] = ciphertextBuf.toString('base64');
    const tampered = parts.join(':');

    expect(() => decrypt(tampered, testKey)).toThrow();
  });

  it('should throw error for invalid encrypted string format', () => {
    expect(() => decrypt('not-a-valid-format', testKey)).toThrow('Invalid encrypted string format');
  });

  it('should handle empty string', () => {
    const plaintext = '';
    const encrypted = encrypt(plaintext, testKey);
    const decrypted = decrypt(encrypted, testKey);
    expect(decrypted).toBe(plaintext);
  });

  it('should handle unicode content', () => {
    const plaintext = '你好世界 🌍 héllo';
    const encrypted = encrypt(plaintext, testKey);
    const decrypted = decrypt(encrypted, testKey);
    expect(decrypted).toBe(plaintext);
  });
});
