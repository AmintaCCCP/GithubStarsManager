/**
 * Encrypted storage for GitHub account tokens in Electron via safeStorage.
 *
 * Implements encrypted persistence under `<userData>/gh-accounts.enc` using the
 * same pattern as xAuthStorage.js. The payload is a JSON map of numeric GitHub
 * account-id strings to plaintext tokens, written only through safeStorage.
 * Injected with { fs, pathModule, userDataPath, safeStorage } for easy unit testing.
 *
 * Audit R2-B1: loadEncryptedGhAccounts distinguishes three outcomes so the
 * renderer never mistakes a transient read failure for "no tokens on disk":
 *   - `{ status: 'missing' }` — no file (or zero-byte file): disk holds no tokens;
 *   - `{ status: 'loaded', tokens }` — a valid decrypted token map;
 *   - `{ status: 'error', error }` — read/decrypt/parse failure: the disk state
 *     is UNKNOWN, and callers must not overwrite the file until a read succeeds.
 *
 * Audit R2-B4: writes go to a temp file in the same directory followed by
 * rename, so a failed/interrupted save keeps the previous map intact.
 */

const GH_ACCOUNTS_FILENAME = 'gh-accounts.enc';

function getGhAccountsPath(userDataPath, pathModule) {
  return pathModule.join(userDataPath, GH_ACCOUNTS_FILENAME);
}

const GH_ACCOUNT_ID_PATTERN = /^\d{1,20}$/;
const GH_TOKEN_PATTERN = /^[\x21-\x7E]{1,512}$/;
const GH_REMOVAL_NONCE_PATTERN = /^[A-Za-z0-9:_-]{1,64}$/;

/**
 * 只接受普通键值对象（Object.prototype 或 null 原型）。渲染进程参数不可信：
 * Date/Map 等结构化克隆产物同样通过 `typeof === 'object'`，但 Object.entries
 * 不会返回令牌条目——它们会被归一化为空映射并触发「清空全部凭据」的保存
 * 语义。显式 `{}` 的清除语义保持不变。
 */
function isPlainObject(value) {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Validate and normalize a token map; returns null when the payload is invalid. */
function normalizeGhAccounts(value) {
  if (value === null || value === undefined) return {};
  if (typeof value !== 'object' || Array.isArray(value) || !isPlainObject(value)) return null;
  const tokens = {};
  const entries = Object.entries(value);
  for (const [accountId, token] of entries) {
    if (!GH_ACCOUNT_ID_PATTERN.test(accountId)) return null;
    if (typeof token !== 'string' || !GH_TOKEN_PATTERN.test(token)) return null;
    tokens[accountId] = token;
  }
  return tokens;
}

/**
 * Normalize optional clearedRemovalMarkers metadata (`{ [accountId]: nonce }`)
 * written atomically alongside re-authorized credentials so a stale renderer
 * localStorage removal marker cannot mask or delete a newly saved PAT after
 * restart when localStorage update failed.
 */
function normalizeClearedRemovalMarkers(meta) {
  if (meta === undefined || meta === null) return null;
  if (typeof meta !== 'object' || Array.isArray(meta) || !isPlainObject(meta)) return null;
  const raw = meta.clearedRemovalMarkers;
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw) || !isPlainObject(raw)) return null;
  const result = {};
  for (const [accountId, nonce] of Object.entries(raw)) {
    if (!GH_ACCOUNT_ID_PATTERN.test(accountId)) continue;
    if (typeof nonce !== 'string' || !GH_REMOVAL_NONCE_PATTERN.test(nonce)) continue;
    result[accountId] = nonce;
  }
  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Audit R2-B4 fix-up: delete both the encrypted token map and the
 * interrupted-write temp file (`gh-accounts.enc.tmp`, which holds the full
 * encrypted token table when the process dies between write and rename).
 * Shared by explicit clear and empty-map save. Success is reported only when
 * both files are removed or already absent; any other failure surfaces
 * (Audit R2-B3) instead of reporting a wipe that did not fully happen.
 */
function removeGhAccountsFiles({ fs, pathModule, userDataPath }) {
  const filePath = getGhAccountsPath(userDataPath, pathModule);
  const tempPath = `${filePath}.tmp`;
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    if (!error || error.code !== 'ENOENT') {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  try {
    fs.unlinkSync(tempPath);
  } catch (error) {
    if (!error || error.code !== 'ENOENT') {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  return { success: true };
}

function saveEncryptedGhAccounts({ fs, pathModule, userDataPath, safeStorage, platform = process.platform }, tokens, meta) {
  const filePath = getGhAccountsPath(userDataPath, pathModule);
  const normalized = normalizeGhAccounts(tokens);
  if (normalized === null) {
    return { success: false, error: 'invalid gh-accounts payload' };
  }
  const accountIds = Object.keys(normalized);
  // Empty map (or null payload) means nothing left to keep on disk. Shares the
  // clear-path cleanup so an interrupted write's temp file cannot survive.
  if (accountIds.length === 0) {
    return removeGhAccountsFiles({ fs, pathModule, userDataPath });
  }
  // Linux 上密钥环缺失时 safeStorage 可能选择 basic_text 后端（固定明文口令，
  // 不提供预期的磁盘保护），isEncryptionAvailable() 在该后端下仍返回 true——
  // PAT 绝不落盘到明文后端，沿用「凭据未保存到磁盘」的失败语义。platform 仅
  // 为单元测试可注入（默认取真实 process.platform），与其余注入依赖一致。
  let selectedStorageBackend = null;
  try {
    selectedStorageBackend = safeStorage?.getSelectedStorageBackend?.() ?? null;
  } catch {
    selectedStorageBackend = null;
  }
  if (platform === 'linux' && selectedStorageBackend === 'basic_text') {
    return {
      success: false,
      error: 'SafeStorage is using the basic_text (plain-text) backend on this system; credentials not saved to disk.',
    };
  }
  if (!safeStorage || typeof safeStorage.isEncryptionAvailable !== 'function' || !safeStorage.isEncryptionAvailable()) {
    return {
      success: false,
      error: 'SafeStorage encryption is unavailable on this system; credentials not saved to disk.',
    };
  }
  // Audit R2-B4: atomic write — full payload goes to a temp file in the same
  // directory, then rename replaces the target. On any failure the previous
  // map stays intact and the temp file is cleaned up.
  const clearedRemovalMarkers = normalizeClearedRemovalMarkers(meta);
  const diskPayload = clearedRemovalMarkers
    ? { __v: 2, tokens: normalized, clearedRemovalMarkers }
    : normalized;
  const tempPath = `${filePath}.tmp`;
  try {
    const encrypted = safeStorage.encryptString(JSON.stringify(diskPayload));
    fs.writeFileSync(tempPath, encrypted);
    fs.renameSync(tempPath, filePath);
    return { success: true };
  } catch (error) {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch { /* best-effort cleanup */ }
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Audit R2-B1: structured load result. Never collapses a failed read into
 * "no tokens" — the renderer treats `{ status: 'error' }` as an unknown disk
 * state and refuses to overwrite the file (merge-only writes) until a load
 * succeeds.
 */
function loadEncryptedGhAccounts({ fs, pathModule, userDataPath, safeStorage }) {
  const filePath = getGhAccountsPath(userDataPath, pathModule);
  let buf;
  try {
    buf = fs.readFileSync(filePath);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { status: 'missing' };
    }
    return { status: 'error', error: error instanceof Error ? error.message : String(error) };
  }
  try {
    // A zero-byte file holds no tokens: treat like an absent file so the next
    // successful save can rewrite it.
    if (!buf || buf.length === 0) return { status: 'missing' };
    if (!safeStorage || typeof safeStorage.isEncryptionAvailable !== 'function' || !safeStorage.isEncryptionAvailable()) {
      return { status: 'error', error: 'SafeStorage encryption is unavailable; gh-accounts.enc cannot be read.' };
    }

    const payloadStr = safeStorage.decryptString(buf);
    let data;
    try {
      data = JSON.parse(payloadStr);
    } catch {
      // Audit fix: the decrypted payload may be non-JSON (tampered ciphertext
      // that still decrypts). V8 SyntaxError messages can include fragments of
      // the offending source — potentially decrypted token material — so the
      // raw message must never reach main.js failure logs. Return a fixed,
      // content-free error text instead.
      return { status: 'error', error: 'gh-accounts.enc does not contain valid JSON' };
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      // 解密成功但不是 Token 映射：内容未知，不能当作「磁盘为空」——
      // 否则下次保存会整表覆写丢掉未知内容。
      return { status: 'error', error: 'gh-accounts.enc does not contain a token map' };
    }
    if (data.__v === 2 && isPlainObject(data)) {
      const rawTokens = data.tokens;
      if (!rawTokens || typeof rawTokens !== 'object' || Array.isArray(rawTokens) || !isPlainObject(rawTokens)) {
        return { status: 'error', error: 'gh-accounts.enc does not contain a token map' };
      }
      const normalized = normalizeGhAccounts(rawTokens);
      if (normalized && Object.keys(normalized).length > 0) {
        const clearedRemovalMarkers = normalizeClearedRemovalMarkers(data);
        return clearedRemovalMarkers
          ? { status: 'loaded', tokens: normalized, clearedRemovalMarkers }
          : { status: 'loaded', tokens: normalized };
      }
      if (Object.keys(rawTokens).length === 0) {
        return { status: 'missing' };
      }
      return { status: 'error', error: 'gh-accounts.enc contains no valid token entries' };
    }
    const normalized = normalizeGhAccounts(data);
    if (normalized && Object.keys(normalized).length > 0) {
      return { status: 'loaded', tokens: normalized };
    }
    if (Object.keys(data).length === 0) {
      // 空映射：磁盘确认没有可保留的 Token。
      return { status: 'missing' };
    }
    // 非空映射但所有条目都非法：内容不可识别，同样按未知处理。
    return { status: 'error', error: 'gh-accounts.enc contains no valid token entries' };
  } catch (error) {
    // Corrupt payload / failed decrypt / fs error: disk state is unknown —
    // report an error so the renderer will not overwrite other accounts'
    // tokens based on a partial read.
    return { status: 'error', error: error instanceof Error ? error.message : String(error) };
  }
}

function clearEncryptedGhAccounts(ctx) {
  // Audit fix: explicit clear must also remove the interrupted-write temp file
  // (same directory, full encrypted token table) — only a wipe of both the
  // target and the temp file may report success.
  return removeGhAccountsFiles(ctx);
}

module.exports = {
  GH_ACCOUNTS_FILENAME,
  getGhAccountsPath,
  normalizeGhAccounts,
  saveEncryptedGhAccounts,
  loadEncryptedGhAccounts,
  clearEncryptedGhAccounts,
};
