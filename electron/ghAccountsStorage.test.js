const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  getGhAccountsPath,
  saveEncryptedGhAccounts,
  loadEncryptedGhAccounts,
  clearEncryptedGhAccounts,
  GH_ACCOUNTS_FILENAME,
} = require('./ghAccountsStorage');

describe('ghAccountsStorage path helper', () => {
  it('nests gh-accounts.enc under userDataPath', () => {
    const res = getGhAccountsPath('/mock/user/data', path);
    assert.equal(res, path.join('/mock/user/data', GH_ACCOUNTS_FILENAME));
  });
});

describe('ghAccountsStorage save, load, clear', () => {
  const makeCtx = ({ available = true } = {}) => {
    const storage = new Map();
    const fakeFs = {
      existsSync: (p) => storage.has(p),
      writeFileSync: (p, data) => storage.set(p, data),
      readFileSync: (p) => storage.get(p),
      unlinkSync: (p) => storage.delete(p),
    };
    const fakeSafeStorage = available
      ? {
          isEncryptionAvailable: () => true,
          encryptString: (str) => Buffer.from(`ENC:${str}`, 'utf-8'),
          decryptString: (buf) => {
            const str = buf.toString('utf-8');
            assert.ok(str.startsWith('ENC:'));
            return str.slice(4);
          },
        }
      : { isEncryptionAvailable: () => false };
    return { ctx: { fs: fakeFs, pathModule: path, userDataPath: '/test/data', safeStorage: fakeSafeStorage }, storage };
  };

  it('saves and loads account tokens with safeStorage encryption', () => {
    const { ctx } = makeCtx();

    // Initial load: missing file yields null
    assert.equal(loadEncryptedGhAccounts(ctx), null);

    const saveRes = saveEncryptedGhAccounts(ctx, { '42': 'ghp_token_1', '1002': 'github_pat_x' });
    assert.deepEqual(saveRes, { success: true });

    const loaded = loadEncryptedGhAccounts(ctx);
    assert.deepEqual(loaded, { '42': 'ghp_token_1', '1002': 'github_pat_x' });

    const clearRes = clearEncryptedGhAccounts(ctx);
    assert.deepEqual(clearRes, { success: true });
    assert.equal(loadEncryptedGhAccounts(ctx), null);
  });

  it('unlinks the file when saving an empty map (nothing to persist)', () => {
    const { ctx, storage } = makeCtx();
    storage.set(path.join('/test/data', GH_ACCOUNTS_FILENAME), Buffer.from('existing', 'utf-8'));

    assert.deepEqual(saveEncryptedGhAccounts(ctx, {}), { success: true });
    assert.equal(storage.size, 0);
    assert.deepEqual(saveEncryptedGhAccounts(ctx, null), { success: true });
  });

  it('returns error and does not write plaintext file when safeStorage is unavailable', () => {
    const { ctx, storage } = makeCtx({ available: false });

    const saveRes = saveEncryptedGhAccounts(ctx, { '42': 'ghp_token_1' });
    assert.equal(saveRes.success, false);
    assert.equal(storage.size, 0);
    assert.equal(loadEncryptedGhAccounts(ctx), null);
  });

  it('handles corrupted file gracefully returning null', () => {
    const storage = new Map();
    storage.set(path.join('/test/data', GH_ACCOUNTS_FILENAME), Buffer.from('not-json-garbage', 'utf-8'));
    const fakeFs = {
      existsSync: (p) => storage.has(p),
      readFileSync: (p) => storage.get(p),
    };
    const ctx = { fs: fakeFs, pathModule: path, userDataPath: '/test/data', safeStorage: null };
    assert.equal(loadEncryptedGhAccounts(ctx), null);
  });

  it('rejects invalid payloads: non-numeric ids, control chars, oversized tokens, wrong types', () => {
    const { ctx, storage } = makeCtx();

    assert.equal(saveEncryptedGhAccounts(ctx, { 'abc': 'ghp_token' }).success, false);
    assert.equal(saveEncryptedGhAccounts(ctx, { '42': 'token\ninvalid' }).success, false);
    assert.equal(saveEncryptedGhAccounts(ctx, { '42': 'a'.repeat(513) }).success, false);
    assert.equal(saveEncryptedGhAccounts(ctx, { '42': 123 }).success, false);
    assert.equal(saveEncryptedGhAccounts(ctx, ['42']).success, false);
    assert.equal(storage.size, 0);
  });
});
