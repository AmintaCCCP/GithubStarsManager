import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { decrypt } from '../services/crypto.js';
import { config } from '../config.js';
import { logger } from '../services/logger.js';

const router = Router();

/**
 * POST /api/sync/auth
 *
 * Returns the credentials the browser needs to re-establish a session after a
 * tab/device switch. This route is mounted under the existing /api middleware,
 * so it is only reachable when the caller already proves knowledge of
 * `API_SECRET` (Bearer). It therefore only echoes data an authorized client is
 * already entitled to; an unauthenticated caller is rejected by authMiddleware.
 *
 * Response: { github_token: string | null }
 * (api_secret is intentionally NOT returned — the client must already hold it
 *  to authenticate, so echoing it would serve no purpose and invite misuse.)
 */
// Defence-in-depth: the response carries the decrypted GitHub PAT, so make it
// uncacheable at every layer even though helmet() already sets no-store globally.
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, no-cache, must-revalidate' };

router.post('/api/sync/auth', (_req, res) => {
  try {
    const db = getDb();
    const tokenRow = db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get('github_token') as { value: string } | undefined;

    if (!tokenRow?.value) {
      res.set(NO_STORE_HEADERS).json({ github_token: null });
      return;
    }

    let token: string;
    try {
      token = decrypt(tokenRow.value, config.encryptionKey);
    } catch {
      logger.error('authRestore', 'Failed to decrypt GitHub token for auth restore');
      res.set(NO_STORE_HEADERS).json({ github_token: null });
      return;
    }

    res.set(NO_STORE_HEADERS).json({ github_token: token });
  } catch (err) {
    logger.errorFromError('authRestore', 'POST /api/sync/auth error', err);
    res.status(500).json({ error: 'Failed to restore auth', code: 'AUTH_RESTORE_FAILED' });
  }
});

export default router;