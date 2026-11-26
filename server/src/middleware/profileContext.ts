import type { Request, Response, NextFunction } from 'express';
import {
  acquireProfileDb,
  isValidProfileId,
  releaseProfileDb,
  runWithDbInstance,
} from '../db/connection.js';

/**
 * Routes `/api/*` requests to an isolated SQLite profile database when the
 * optional `X-GSM-Profile` header is provided.
 *
 * - Missing, empty, or `'default'` -> runs normally on `data/data.db` (0 overhead).
 * - Valid `p_[a-z0-9_-]{1,32}` -> runs inside AsyncLocalStorage bound to `profiles/<id>.db`.
 * - Anything else -> 400 Bad Request (prevents path traversal and invalid IDs).
 */
export function profileContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const rawHeader = req.header('X-GSM-Profile');

  if (rawHeader === undefined || rawHeader === '' || rawHeader === 'default') {
    next();
    return;
  }

  if (!isValidProfileId(rawHeader)) {
    res.status(400).json({
      error: 'Invalid X-GSM-Profile header',
      code: 'INVALID_PROFILE_HEADER',
    });
    return;
  }

  // Health check and profile management endpoints do not operate on the caller's
  // profile DB; avoid lazily creating a phantom profile DB file when X-GSM-Profile is set.
  if (
    (req.method === 'GET' && req.path === '/health') ||
    req.path === '/profiles' ||
    req.path.startsWith('/profiles/')
  ) {
    next();
    return;
  }

  let profileDb;
  try {
    profileDb = acquireProfileDb(rawHeader);
  } catch (err) {
    next(err);
    return;
  }

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    releaseProfileDb(rawHeader);
  };
  res.once('finish', release);
  res.once('close', release);

  try {
    runWithDbInstance(profileDb, () => {
      next();
    });
  } catch (err) {
    release();
    next(err);
  }
}
