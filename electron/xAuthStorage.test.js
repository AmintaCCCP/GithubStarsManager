const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  getXAuthPath,
  saveEncryptedXAuth,
  loadEncryptedXAuth,
  clearEncryptedXAuth,
  X_AUTH_FILENAME,
} = require('./xAuthStorage');

describe('xAuthStorage path helper', () => {
  it('nests x-auth.enc under userDataPath', () => {
    const res = getXAuthPath('/mock/user/data', path);
    assert.equal(res, path.join('/mock/user/data', X_AUTH_FILENAME));
  });
});

describe('xAuthStorage save, load, clear', () => {
  it('saves and loads with safeStorage encryption available', () => {
    const storage = new Map();
    const fakeFs = {
      existsSync: (p) => storage.has(p),
      writeFileSync: (p, data) => storage.set(p, data),
      readFileSync: (p) => storage.get(p),
      unlinkSync: (p) => storage.delete(p),
    };
    const fakeSafeStorage = {
      isEncryptionAvailable: () => true,
      encryptString: (str) => Buffer.from(`ENC:${str}`, 'utf-8'),
      decryptString: (buf) => {
        const str = buf.toString('utf-8');
        assert.ok(str.startsWith('ENC:'));
        return str.slice(4);
      },
    };
    const ctx = { fs: fakeFs, pathModule: path, userDataPath: '/test/data', safeStorage: fakeSafeStorage };

    // Initial load: missing file yields null
    assert.equal(loadEncryptedXAuth(ctx), null);

    // Save
    const saveRes = saveEncryptedXAuth(ctx, { authToken: ' token_123 ', ct0: ' "ct0_456" ' });
    assert.deepEqual(saveRes, { success: true });

    // Load
    const loaded = loadEncryptedXAuth(ctx);
    assert.deepEqual(loaded, { authToken: 'token_123', ct0: 'ct0_456' });

    // Clear
    const clearRes = clearEncryptedXAuth(ctx);
    assert.deepEqual(clearRes, { success: true });
    assert.equal(loadEncryptedXAuth(ctx), null);
  });

  it('returns error and does not write plaintext file when safeStorage encryption is unavailable', () => {
    const storage = new Map();
    const fakeFs = {
      existsSync: (p) => storage.has(p),
      writeFileSync: (p, data) => storage.set(p, data),
      readFileSync: (p) => storage.get(p),
      unlinkSync: (p) => storage.delete(p),
    };
    const fakeSafeStorage = {
      isEncryptionAvailable: () => false,
    };
    const ctx = { fs: fakeFs, pathModule: path, userDataPath: '/test/data', safeStorage: fakeSafeStorage };

    const saveRes = saveEncryptedXAuth(ctx, { authToken: 'my_auth', ct0: 'my_ct0' });
    assert.equal(saveRes.success, false);
    assert.equal(storage.size, 0);
    const loaded = loadEncryptedXAuth(ctx);
    assert.equal(loaded, null);
  });

  it('handles corrupted file gracefully returning null', () => {
    const storage = new Map();
    storage.set(path.join('/test/data', X_AUTH_FILENAME), Buffer.from('not-json-garbage', 'utf-8'));
    const fakeFs = {
      existsSync: (p) => storage.has(p),
      readFileSync: (p) => storage.get(p),
    };
    const ctx = { fs: fakeFs, pathModule: path, userDataPath: '/test/data', safeStorage: null };
    assert.equal(loadEncryptedXAuth(ctx), null);
  });

  it('unlinks file if saving empty auth', () => {
    const storage = new Map();
    storage.set(path.join('/test/data', X_AUTH_FILENAME), Buffer.from('existing', 'utf-8'));
    const fakeFs = {
      existsSync: (p) => storage.has(p),
      unlinkSync: (p) => storage.delete(p),
    };
    const ctx = { fs: fakeFs, pathModule: path, userDataPath: '/test/data', safeStorage: null };
    saveEncryptedXAuth(ctx, null);
    assert.equal(storage.size, 0);
  });

  it('rejects oversized tokens (>512 chars) or invalid cookie characters', () => {
    const fakeFs = {
      existsSync: () => false,
      writeFileSync: () => {},
    };
    const fakeSafeStorage = {
      isEncryptionAvailable: () => true,
      encryptString: (str) => Buffer.from(str),
    };
    const ctx = { fs: fakeFs, pathModule: path, userDataPath: '/test/data', safeStorage: fakeSafeStorage };

    // Oversized token
    const longToken = 'a'.repeat(513);
    const resOversized = saveEncryptedXAuth(ctx, { authToken: longToken, ct0: 'valid_ct0' });
    assert.equal(resOversized.success, false);
    assert.equal(resOversized.error, 'invalid auth cookies');

    // Invalid characters (e.g. newline or control chars)
    const resInvalidChar = saveEncryptedXAuth(ctx, { authToken: 'token\ninvalid', ct0: 'valid_ct0' });
    assert.equal(resInvalidChar.success, false);
    assert.equal(resInvalidChar.error, 'invalid auth cookies');
  });
});
