import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';

let warnedOnce = false;

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip auth for health check
  if (req.method === 'GET' && req.path === '/api/health') {
    next();
    return;
  }

  // Dev mode: no API_SECRET set
  if (!config.apiSecret) {
    if (!warnedOnce) {
      console.warn('⚠️  API_SECRET not set — auth disabled (dev mode)');
      warnedOnce = true;
    }
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    return;
  }

  const token = authHeader.slice(7);

  // Constant-time comparison
  const tokenBuf = Buffer.from(token);
  const secretBuf = Buffer.from(config.apiSecret);

  if (tokenBuf.length !== secretBuf.length || !crypto.timingSafeEqual(tokenBuf, secretBuf)) {
    res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    return;
  }

  next();
}
