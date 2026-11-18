/**
 * Encrypted storage for GitHub account tokens in Electron via safeStorage.
 *
 * Implements encrypted persistence under `<userData>/gh-accounts.enc` using the
 * same pattern as xAuthStorage.js. The payload is a JSON map of numeric GitHub
 * account-id strings to plaintext tokens, written only through safeStorage.
 * Injected with { fs, pathModule, userDataPath, safeStorage } for easy unit testing.
 */

const GH_ACCOUNTS_FILENAME = 'gh-accounts.enc';

function getGhAccountsPath(userDataPath, pathModule) {
  return pathModule.join(userDataPath, GH_ACCOUNTS_FILENAME);
}

const GH_ACCOUNT_ID_PATTERN = /^\d{1,20}$/;
const GH_TOKEN_PATTERN = /^[\x21-\x7E]{1,512}$/;

/** Validate and normalize a token map; returns null when the payload is invalid. */
function normalizeGhAccounts(value) {
  if (value === null || value === undefined) return {};
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  const tokens = {};
  const entries = Object.entries(value);
  for (const [accountId, token] of entries) {
    if (!GH_ACCOUNT_ID_PATTERN.test(accountId)) return null;
    if (typeof token !== 'string' || !GH_TOKEN_PATTERN.test(token)) return null;
    tokens[accountId] = token;
  }
  return tokens;
}

function saveEncryptedGhAccounts({ fs, pathModule, userDataPath, safeStorage }, tokens) {
  const filePath = getGhAccountsPath(userDataPath, pathModule);
  const normalized = normalizeGhAccounts(tokens);
  if (normalized === null) {
    return { success: false, error: 'invalid gh-accounts payload' };
  }
  const accountIds = Object.keys(normalized);
  // Empty map (or null payload) means nothing left to keep on disk.
  if (accountIds.length === 0) {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch { /* ignore */ }
    return { success: true };
  }
  if (!safeStorage || typeof safeStorage.isEncryptionAvailable !== 'function' || !safeStorage.isEncryptionAvailable()) {
    return {
      success: false,
      error: 'SafeStorage encryption is unavailable on this system; credentials not saved to disk.',
    };
  }
  try {
    const encrypted = safeStorage.encryptString(JSON.stringify(normalized));
    fs.writeFileSync(filePath, encrypted);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function loadEncryptedGhAccounts({ fs, pathModule, userDataPath, safeStorage }) {
  try {
    const filePath = getGhAccountsPath(userDataPath, pathModule);
    if (!fs.existsSync(filePath)) return null;
    if (!safeStorage || typeof safeStorage.isEncryptionAvailable !== 'function' || !safeStorage.isEncryptionAvailable()) {
      return null;
    }
    const buf = fs.readFileSync(filePath);
    if (!buf || buf.length === 0) return null;

    const payloadStr = safeStorage.decryptString(buf);
    const data = JSON.parse(payloadStr);
    const normalized = normalizeGhAccounts(data);
    if (normalized && Object.keys(normalized).length > 0) {
      return normalized;
    }
    return null;
  } catch {
    return null;
  }
}

function clearEncryptedGhAccounts({ fs, pathModule, userDataPath }) {
  try {
    const filePath = getGhAccountsPath(userDataPath, pathModule);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

module.exports = {
  GH_ACCOUNTS_FILENAME,
  getGhAccountsPath,
  normalizeGhAccounts,
  saveEncryptedGhAccounts,
  loadEncryptedGhAccounts,
  clearEncryptedGhAccounts,
};
