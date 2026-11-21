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
  const makeCtx = ({ available = true, fsOverrides = {} } = {}) => {
    const storage = new Map();
    // 第 12 轮审计修复：文件缺失必须抛出带 code:'ENOENT' 的错误（真实 fs 语义）
    //——readFileSync 返回 undefined 会让用例走「空内容」分支而不是「文件缺失」
    // 异常分支，unlinkSync 同样不会抛 ENOENT，首次加载与空映射保存用例即使把
    // 真实的文件缺失当错误处理也照常通过。
    const fsError = (op, p) => {
      const err = new Error(`ENOENT: no such file or directory, ${op} '${p}'`);
      err.code = 'ENOENT';
      return err;
    };
    const fakeFs = {
      existsSync: (p) => storage.has(p),
      writeFileSync: (p, data) => storage.set(p, data),
      readFileSync: (p) => {
        if (!storage.has(p)) throw fsError('open', p);
        return storage.get(p);
      },
      unlinkSync: (p) => {
        if (!storage.has(p)) throw fsError('unlink', p);
        storage.delete(p);
      },
      renameSync: (from, to) => {
        if (!storage.has(from)) throw fsError('rename', from);
        storage.set(to, storage.get(from));
        storage.delete(from);
      },
      ...fsOverrides,
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

    // Initial load: missing file yields a structured "missing" result (R2-B1)
    assert.deepEqual(loadEncryptedGhAccounts(ctx), { status: 'missing' });

    const saveRes = saveEncryptedGhAccounts(ctx, { '42': 'ghp_token_1', '1002': 'github_pat_x' });
    assert.deepEqual(saveRes, { success: true });

    const loaded = loadEncryptedGhAccounts(ctx);
    assert.deepEqual(loaded, { status: 'loaded', tokens: { '42': 'ghp_token_1', '1002': 'github_pat_x' } });

    const clearRes = clearEncryptedGhAccounts(ctx);
    assert.deepEqual(clearRes, { success: true });
    assert.deepEqual(loadEncryptedGhAccounts(ctx), { status: 'missing' });
  });

  it('writes atomically via a same-directory temp file (R2-B4)', () => {
    const { ctx, storage } = makeCtx();
    const filePath = path.join('/test/data', GH_ACCOUNTS_FILENAME);
    const tempPath = `${filePath}.tmp`;

    // 第 12 轮审计修复：记录 writeFileSync 与 renameSync 的调用参数——必须先
    // 写入与目标同目录的临时文件（跨文件系统 rename 会失败），再将该临时文件
    // 重命名为目标文件。
    const writeTargets = [];
    let renameFrom = null;
    let renameTo = null;
    const recordingCtx = {
      ...ctx,
      fs: {
        ...ctx.fs,
        writeFileSync: (p, data) => {
          writeTargets.push(p);
          storage.set(p, data);
        },
        renameSync: (from, to) => {
          renameFrom = from;
          renameTo = to;
          storage.set(to, storage.get(from));
          storage.delete(from);
        },
      },
    };

    const saveRes = saveEncryptedGhAccounts(recordingCtx, { '42': 'ghp_token_1' });
    assert.deepEqual(saveRes, { success: true });
    assert.deepEqual(writeTargets, [tempPath]);
    assert.equal(renameFrom, tempPath);
    assert.equal(renameTo, filePath);
    // Temp file is gone after the rename; only the target remains.
    assert.equal(storage.has(tempPath), false);
    assert.ok(storage.has(filePath));
  });

  it('keeps the previous map intact when the write fails mid-way (R2-B4)', () => {
    const { ctx, storage } = makeCtx();
    const filePath = path.join('/test/data', GH_ACCOUNTS_FILENAME);

    // First save establishes a known-good file.
    assert.deepEqual(saveEncryptedGhAccounts(ctx, { '42': 'ghp_old_token' }), { success: true });
    const previousPayload = storage.get(filePath);

    // Rename fails: the old file must survive and the temp file must be cleaned up.
    const failingCtx = {
      ...ctx,
      fs: {
        ...ctx.fs,
        renameSync: () => {
          throw new Error('rename failed: device busy');
        },
      },
    };
    const saveRes = saveEncryptedGhAccounts(failingCtx, { '1002': 'github_pat_new' });
    assert.equal(saveRes.success, false);
    assert.match(saveRes.error, /rename failed/);
    assert.equal(storage.get(filePath), previousPayload);
    assert.equal(storage.has(`${filePath}.tmp`), false);
  });

  it('unlinks the file when saving an empty map (nothing to persist)', () => {
    const { ctx, storage } = makeCtx();
    storage.set(path.join('/test/data', GH_ACCOUNTS_FILENAME), Buffer.from('existing', 'utf-8'));

    assert.deepEqual(saveEncryptedGhAccounts(ctx, {}), { success: true });
    assert.equal(storage.size, 0);
    assert.deepEqual(saveEncryptedGhAccounts(ctx, null), { success: true });
  });

  it('returns success when saving an empty map without an existing file (R2-B3)', () => {
    const { ctx } = makeCtx();
    assert.deepEqual(saveEncryptedGhAccounts(ctx, {}), { success: true });
  });

  it('reports failure when the empty-map unlink fails on an existing file (R2-B3)', () => {
    const { ctx, storage } = makeCtx({
      fsOverrides: {
        unlinkSync: () => {
          throw new Error('EACCES: file locked');
        },
      },
    });
    storage.set(path.join('/test/data', GH_ACCOUNTS_FILENAME), Buffer.from('existing', 'utf-8'));

    const saveRes = saveEncryptedGhAccounts(ctx, {});
    assert.equal(saveRes.success, false);
    assert.match(saveRes.error, /EACCES/);
    // The stale file survives: the caller knows the wipe did not happen.
    assert.equal(storage.size, 1);
  });

  it('returns error and does not write plaintext file when safeStorage is unavailable', () => {
    const { ctx, storage } = makeCtx({ available: false });

    const saveRes = saveEncryptedGhAccounts(ctx, { '42': 'ghp_token_1' });
    assert.equal(saveRes.success, false);
    assert.equal(storage.size, 0);
    // R2-B1: unreadable disk state (encryption unavailable) is an error, not "missing".
    storage.set(path.join('/test/data', GH_ACCOUNTS_FILENAME), Buffer.from('existing', 'utf-8'));
    const loadRes = loadEncryptedGhAccounts(ctx);
    assert.equal(loadRes.status, 'error');
    assert.equal(typeof loadRes.error, 'string');
  });

  it('handles corrupted file gracefully returning a structured error (R2-B1)', () => {
    // Audit fix: this case must actually exercise the JSON parse. Reuse the
    // working encrypt/decrypt stub from the neighbouring cases and make
    // decryption return invalid JSON — `safeStorage: null` short-circuits
    // before decryption and only re-proves the keyring-unavailable path that
    // the previous test already covers.
    const storage = new Map();
    storage.set(path.join('/test/data', GH_ACCOUNTS_FILENAME), Buffer.from('tampered-ciphertext', 'utf-8'));
    const fakeFs = {
      existsSync: (p) => storage.has(p),
      readFileSync: (p) => storage.get(p),
    };
    const ctx = {
      fs: fakeFs,
      pathModule: path,
      userDataPath: '/test/data',
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (str) => Buffer.from(`ENC:${str}`, 'utf-8'),
        decryptString: () => 'not-json-garbage',
      },
    };
    const loadRes = loadEncryptedGhAccounts(ctx);
    assert.equal(loadRes.status, 'error');
    // Fixed, content-free error text: a raw SyntaxError message may contain
    // fragments of the decrypted payload and must never reach failure logs.
    assert.equal(loadRes.error, 'gh-accounts.enc does not contain valid JSON');
  });

  it('removes the interrupted-write temp file when clearing credentials (audit fix)', () => {
    const { ctx, storage } = makeCtx();
    const filePath = path.join('/test/data', GH_ACCOUNTS_FILENAME);
    const tempPath = `${filePath}.tmp`;
    storage.set(filePath, Buffer.from('ENC:existing', 'utf-8'));
    // A process crash between writeFileSync and renameSync leaves the full
    // encrypted token table in the temp file: explicit clear must remove it too.
    storage.set(tempPath, Buffer.from('ENC:interrupted-write', 'utf-8'));

    assert.deepEqual(clearEncryptedGhAccounts(ctx), { success: true });
    assert.equal(storage.has(filePath), false);
    assert.equal(storage.has(tempPath), false);
    assert.equal(storage.size, 0);
  });

  it('removes the leftover temp file when saving an empty map (audit fix)', () => {
    const { ctx, storage } = makeCtx();
    const filePath = path.join('/test/data', GH_ACCOUNTS_FILENAME);
    storage.set(`${filePath}.tmp`, Buffer.from('ENC:interrupted-write', 'utf-8'));

    assert.deepEqual(saveEncryptedGhAccounts(ctx, {}), { success: true });
    assert.equal(storage.size, 0);
  });

  it('reports failure when the temp file cannot be removed during clear (audit fix)', () => {
    const { ctx, storage } = makeCtx();
    const filePath = path.join('/test/data', GH_ACCOUNTS_FILENAME);
    const tempPath = `${filePath}.tmp`;
    storage.set(tempPath, Buffer.from('ENC:interrupted-write', 'utf-8'));
    const lockedCtx = {
      ...ctx,
      fs: {
        ...ctx.fs,
        unlinkSync: (p) => {
          if (p === tempPath) throw new Error('EACCES: temp file locked');
          storage.delete(p);
        },
      },
    };

    const res = clearEncryptedGhAccounts(lockedCtx);
    assert.equal(res.success, false);
    assert.match(res.error, /EACCES/);
    // The temp file holding the encrypted token table survives: the caller
    // knows the wipe did not fully happen.
    assert.equal(storage.has(tempPath), true);
  });

  it('treats a zero-byte file as missing so the next save can rewrite it', () => {
    const storage = new Map();
    storage.set(path.join('/test/data', GH_ACCOUNTS_FILENAME), Buffer.alloc(0));
    const fakeFs = {
      existsSync: (p) => storage.has(p),
      readFileSync: (p) => storage.get(p),
    };
    const ctx = {
      fs: fakeFs,
      pathModule: path,
      userDataPath: '/test/data',
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (str) => Buffer.from(`ENC:${str}`, 'utf-8'),
        decryptString: (buf) => buf.toString('utf-8').slice(4),
      },
    };
    assert.deepEqual(loadEncryptedGhAccounts(ctx), { status: 'missing' });
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

  it('rejects non-plain objects (Date/Map) so they cannot act as a clear instruction (audit R14)', () => {
    const { ctx, storage } = makeCtx();
    const filePath = path.join('/test/data', GH_ACCOUNTS_FILENAME);
    const existingPayload = Buffer.from('ENC:existing', 'utf-8');
    storage.set(filePath, existingPayload);

    // Date 可通过结构化克隆且 typeof === 'object'，但 Object.entries 不返回
    // 令牌条目——旧行为会把它当空映射清空整份凭据并报告成功。
    const dateRes = saveEncryptedGhAccounts(ctx, new Date('2026-01-01T00:00:00.000Z'));
    assert.equal(dateRes.success, false);
    assert.match(dateRes.error, /invalid/);

    const mapRes = saveEncryptedGhAccounts(ctx, new Map([['42', 'ghp_token']]));
    assert.equal(mapRes.success, false);
    assert.match(mapRes.error, /invalid/);

    // 传入非普通对象时原文件不得被修改（既不清空也不重写）。
    assert.equal(storage.size, 1);
    assert.equal(storage.get(filePath), existingPayload);

    // 显式空对象的清除语义保持不变。
    assert.deepEqual(saveEncryptedGhAccounts(ctx, {}), { success: true });
    assert.equal(storage.size, 0);
  });

  it('refuses to save PATs when Linux falls back to the basic_text backend (audit R14)', () => {
    const { ctx, storage } = makeCtx();

    const basicTextCtx = {
      ...ctx,
      platform: 'linux',
      safeStorage: {
        ...ctx.safeStorage,
        getSelectedStorageBackend: () => 'basic_text',
      },
    };
    const res = saveEncryptedGhAccounts(basicTextCtx, { '42': 'ghp_token_1' });
    assert.equal(res.success, false);
    assert.match(res.error, /basic_text/);
    assert.equal(storage.size, 0);

    // 其它密钥环后端（非 basic_text）不受影响。
    const keyringCtx = {
      ...ctx,
      platform: 'linux',
      safeStorage: {
        ...ctx.safeStorage,
        getSelectedStorageBackend: () => 'gnome_libsecret',
      },
    };
    assert.deepEqual(saveEncryptedGhAccounts(keyringCtx, { '42': 'ghp_token_1' }), { success: true });
    assert.equal(storage.size, 1);

    // getSelectedStorageBackend 异常时按「非 basic_text」处理，回到既有可用性检查。
    const throwingCtx = {
      ...ctx,
      platform: 'linux',
      safeStorage: {
        ...ctx.safeStorage,
        getSelectedStorageBackend: () => {
          throw new Error('backend probe failed');
        },
      },
    };
    assert.deepEqual(saveEncryptedGhAccounts(throwingCtx, { '43': 'github_pat_x' }), { success: true });
  });
});
