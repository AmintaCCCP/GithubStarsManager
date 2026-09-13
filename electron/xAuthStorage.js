/**
 * Encrypted storage for X auth cookies in Electron via safeStorage.
 *
 * Implements encrypted persistence under `<userData>/x-auth.enc`.
 * Injected with { fs, pathModule, userDataPath, safeStorage } for easy unit testing.
 */

const X_AUTH_FILENAME = 'x-auth.enc';

function getXAuthPath(userDataPath, pathModule) {
  return pathModule.join(userDataPath, X_AUTH_FILENAME);
}

function saveEncryptedXAuth({ fs, pathModule, userDataPath, safeStorage }, auth) {
  const filePath = getXAuthPath(userDataPath, pathModule);
  if (!auth || typeof auth.authToken !== 'string' || typeof auth.ct0 !== 'string') {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch { /* ignore */ }
    return { success: true };
  }
  const payload = JSON.stringify({
    authToken: auth.authToken.trim().replace(/^["']|["']$/g, '').trim(),
    ct0: auth.ct0.trim().replace(/^["']|["']$/g, '').trim(),
  });

  try {
    if (safeStorage && typeof safeStorage.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(payload);
      fs.writeFileSync(filePath, encrypted);
    } else {
      fs.writeFileSync(filePath, Buffer.from(payload, 'utf-8'));
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function loadEncryptedXAuth({ fs, pathModule, userDataPath, safeStorage }) {
  try {
    const filePath = getXAuthPath(userDataPath, pathModule);
    if (!fs.existsSync(filePath)) return null;
    const buf = fs.readFileSync(filePath);
    if (!buf || buf.length === 0) return null;

    let payloadStr;
    if (safeStorage && typeof safeStorage.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable()) {
      payloadStr = safeStorage.decryptString(buf);
    } else {
      payloadStr = buf.toString('utf-8');
    }

    const data = JSON.parse(payloadStr);
    if (data && typeof data.authToken === 'string' && typeof data.ct0 === 'string' && data.authToken && data.ct0) {
      return { authToken: data.authToken, ct0: data.ct0 };
    }
    return null;
  } catch {
    return null;
  }
}

function clearEncryptedXAuth({ fs, pathModule, userDataPath }) {
  try {
    const filePath = getXAuthPath(userDataPath, pathModule);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

module.exports = {
  X_AUTH_FILENAME,
  getXAuthPath,
  saveEncryptedXAuth,
  loadEncryptedXAuth,
  clearEncryptedXAuth,
};
